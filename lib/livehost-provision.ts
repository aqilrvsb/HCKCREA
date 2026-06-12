import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting, getSettings, invalidateSettingsCache } from "@/lib/settings";

// AUTO-PROVISION a Livehost client's complete streaming stack:
//   1. Cloudflare named tunnel + DNS:  lh-XXXX.peningcast.com
//   2. Novita SGP 4090 instance (60GB) whose container command curls our
//      /api/livehost/bootstrap — the box then BUILDS ITSELF (~30 min)
//   3. live_client_config row so the studio + billing + watchdogs work
// Fast parts only (~10s) — fits a Vercel function; the long build runs on the
// GPU itself. Requires app_settings: cloudflare_api_token (user-created, with
// Account:Cloudflare Tunnel:Edit + Zone:DNS:Edit), novita_api_key,
// livehost_box_secret (+ the livehost_* engine keys for bootstrap).

const CF = "https://api.cloudflare.com/client/v4";
const NOVITA = "https://api.novita.ai/gpu-instance/openapi/v1/gpu/instance";
const DOMAIN = "peningcast.com";

type ProvisionResult = { ok: boolean; status: string; backendUrl?: string; instanceId?: string };

async function cf(path: string, token: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${CF}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const d = await r.json().catch(() => ({}));
  if (!d.success) throw new Error(`CF ${path}: ${JSON.stringify(d.errors || d).slice(0, 200)}`);
  return d.result;
}

export async function provisionLivehost(userId: string): Promise<ProvisionResult> {
  const admin = createAdminClient();
  const setStatus = async (provision_status: string, extra: Record<string, string> = {}) => {
    await admin.from("live_client_config").upsert({
      user_id: userId,
      provision_status,
      updated_at: new Date().toISOString(),
      ...extra,
    });
  };

  try {
    // idempotency: skip when already provisioned
    const { data: existing } = await admin
      .from("live_client_config")
      .select("backend_url, vast_instance_id, provision_status")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.backend_url && existing?.vast_instance_id && existing.provision_status === "ready") {
      return { ok: true, status: "already provisioned", backendUrl: existing.backend_url };
    }

    const s = await getSettings(["cloudflare_api_token", "cloudflare_account_id", "novita_api_key", "livehost_box_secret"]);
    const cfToken = s["cloudflare_api_token"];
    const cfAccountId = s["cloudflare_account_id"];
    const novitaKey = s["novita_api_key"];
    const boxSecret = s["livehost_box_secret"];
    if (!cfToken) {
      await setStatus("pending: add cloudflare_api_token in app_settings");
      return { ok: false, status: "cloudflare_api_token missing" };
    }
    if (!novitaKey || !boxSecret) {
      await setStatus("pending: novita_api_key / livehost_box_secret missing");
      return { ok: false, status: "settings missing" };
    }

    const slug = "lh-" + userId.replace(/-/g, "").slice(0, 8);
    const hostname = `${slug}.${DOMAIN}`;
    const backendUrl = `https://${hostname}`;

    // --- Cloudflare: account + zone ---
    // account id from settings (token may lack account-listing permission)
    let accountId = cfAccountId;
    if (!accountId) {
      const accounts = await cf(`/accounts?per_page=5`, cfToken);
      accountId = accounts?.[0]?.id;
    }
    if (!accountId) throw new Error("no Cloudflare account id (set cloudflare_account_id)");
    const zones = await cf(`/zones?name=${DOMAIN}`, cfToken);
    const zoneId = zones?.[0]?.id;
    if (!zoneId) throw new Error(`zone ${DOMAIN} not found`);

    // --- tunnel (reuse by name when re-provisioning) ---
    let tunnel = (await cf(
      `/accounts/${accountId}/cfd_tunnel?name=${slug}&is_deleted=false`,
      cfToken,
    ))?.[0];
    if (!tunnel) {
      tunnel = await cf(`/accounts/${accountId}/cfd_tunnel`, cfToken, {
        method: "POST",
        body: JSON.stringify({ name: slug, config_src: "cloudflare" }),
      });
    }
    const tunnelId = tunnel.id;
    const tunnelToken = await cf(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`, cfToken);

    // ingress: hostname -> localhost:8000
    await cf(`/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, cfToken, {
      method: "PUT",
      body: JSON.stringify({
        config: {
          ingress: [
            { hostname, service: "http://localhost:8000" },
            { service: "http_status:404" },
          ],
        },
      }),
    });

    // DNS CNAME slug -> tunnel
    const existingDns = await cf(`/zones/${zoneId}/dns_records?name=${hostname}`, cfToken);
    if (!existingDns?.length) {
      await cf(`/zones/${zoneId}/dns_records`, cfToken, {
        method: "POST",
        body: JSON.stringify({
          type: "CNAME",
          name: slug,
          content: `${tunnelId}.cfargotunnel.com`,
          proxied: true,
        }),
      });
    }

    // save tunnel BEFORE creating the instance (bootstrap reads it from DB)
    await setStatus("tunnel ready — creating GPU", {
      backend_url: backendUrl,
      tunnel_token: String(tunnelToken),
      tunnel_id: tunnelId,
    });

    // --- Novita instance: self-building via bootstrap ---
    const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://peninglab.com";
    const bootstrapUrl = `${origin}/api/livehost/bootstrap?s=${boxSecret}&u=${userId}`;
    const createBody = {
      name: slug,
      productId: "4090.16c62g",
      gpuNum: 1,
      rootfsSize: 60,
      imageUrl: "nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04",
      kind: "gpu",
      ports: "22/tcp",
      clusterId: "as-sgp-2",
      billingMode: "onDemand",
      month: 0,
      command: `bash -c 'apt-get update && apt-get install -y curl ca-certificates && curl -fsSL "${bootstrapUrl}" -o /root/bootstrap.sh && bash /root/bootstrap.sh > /workspace_boot.log 2>&1 || sleep infinity'`,
    };
    const r = await fetch(`${NOVITA}/create`, {
      method: "POST",
      headers: { Authorization: `Bearer ${novitaKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(createBody),
    });
    const created = await r.json().catch(() => ({}));
    const instanceId = created?.id;
    if (!instanceId) throw new Error(`novita create failed: ${JSON.stringify(created).slice(0, 200)}`);

    await setStatus("building (~30 min) — GPU is installing itself", {
      vast_instance_id: instanceId,
    });
    invalidateSettingsCache();
    return { ok: true, status: "provisioning started", backendUrl, instanceId };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 180);
    await setStatus(`error: ${msg}`);
    return { ok: false, status: msg };
  }
}

// Mark ready once the box answers (called by admin refresh / status check).
export async function checkProvisionReady(userId: string): Promise<string> {
  const admin = createAdminClient();
  const { data: cfg } = await admin
    .from("live_client_config")
    .select("backend_url, provision_status")
    .eq("user_id", userId)
    .maybeSingle();
  if (!cfg?.backend_url) return cfg?.provision_status || "";
  if (cfg.provision_status === "ready") return "ready";
  try {
    const r = await fetch(`${cfg.backend_url}/avatars`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      await admin
        .from("live_client_config")
        .update({ provision_status: "ready", updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      return "ready";
    }
  } catch {}
  return cfg.provision_status || "";
}
