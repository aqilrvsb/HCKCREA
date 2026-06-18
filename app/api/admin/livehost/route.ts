import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { malaysiaDayToUtcRange } from "@/lib/date-util";

// Admin: list Livehost clients + set each one's streaming config
// (backend_url = their GPU tunnel URL, vast_instance_id = their GPU).

async function requireAdmin() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const admin = createAdminClient();
  const url = new URL(req.url);
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";
  // all profiles on the livehost plan + their config (if any)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, plan, plan_expires_at")
    .eq("plan", "livehost");
  const ids = (profiles || []).map((p) => p.id);
  const { data: cfgs } = ids.length
    ? await admin.from("live_client_config").select("*").in("user_id", ids)
    : { data: [] as any[] };
  const byId = new Map((cfgs || []).map((c) => [c.user_id, c]));
  // emails live in auth.users — fetch and map
  const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((usersPage?.users || []).map((u) => [u.id, u.email || ""]));
  // per-client usage aggregation within the MYT date range
  const fromUtc = start ? malaysiaDayToUtcRange(start, "start") : "";
  const toUtc = end ? malaysiaDayToUtcRange(end, "end") : "";
  let sessQ = admin
    .from("live_sessions")
    .select("user_id, started_at, ended_at, last_seen, voice_chars, comment_chars, status")
    .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  if (fromUtc) sessQ = sessQ.gte("started_at", fromUtc);
  if (toUtc) sessQ = sessQ.lte("started_at", toUtc);
  const { data: sessions } = await sessQ;
  const now = Date.now();
  const agg = new Map<string, { sec: number; chars: number; count: number; live: boolean }>();
  for (const sx of sessions || []) {
    const endMs = sx.ended_at ? new Date(sx.ended_at).getTime() : now;
    const durSec = Math.max(0, Math.round((endMs - new Date(sx.started_at).getTime()) / 1000));
    const a = agg.get(sx.user_id) || { sec: 0, chars: 0, count: 0, live: false };
    a.sec += durSec;
    // include both script voice + comment-reply voice in the per-client total
    a.chars += (Number(sx.voice_chars) || 0) + (Number(sx.comment_chars) || 0);
    a.count += 1;
    if (sx.status === "active") a.live = true;
    agg.set(sx.user_id, a);
  }

  // live GPU status per instance (Novita)
  const novitaKey = (await getSettings(["novita_api_key"]))["novita_api_key"];
  const gpuStatus = new Map<string, string>();
  if (novitaKey) {
    await Promise.all(
      (cfgs || [])
        .filter((c) => c.vast_instance_id)
        .map(async (c) => {
          try {
            const r = await fetch(
              `https://api.novita.ai/gpu-instance/openapi/v1/gpu/instance?instanceId=${c.vast_instance_id}`,
              { headers: { Authorization: `Bearer ${novitaKey}` }, cache: "no-store" },
            );
            const d = await r.json();
            const sNow = String((d?.data || d)?.status || "unknown");
            gpuStatus.set(c.user_id, sNow === "exited" ? "stopped" : sNow);
          } catch {
            gpuStatus.set(c.user_id, "unknown");
          }
        }),
    );
  }

  const rates = await getSettings(["livehost_gpu_rate_hour", "livehost_voice_rate_1k", "livehost_audio_rate_gen", "livehost_min_balance", "livehost_warm_window_sec", "livehost_llm", "livehost_ext_version", "livehost_ext_download_url"]);
  const llmRaw = rates["livehost_llm"] || {};

  // Real Novita GPUs (1 client = 1 GPU). Populate the assign dropdown from what
  // we actually have on Novita, cross-referenced with who it's assigned to
  // (live_client_config.gpu_endpoint_id). No pool table / round-robin.
  const { listNovitaEndpoints } = await import("@/lib/livehost-pool");
  const eps = await listNovitaEndpoints();
  const epToUser = new Map<string, string>();
  for (const c of cfgs || []) if (c.gpu_endpoint_id) epToUser.set(c.gpu_endpoint_id, c.user_id);
  const pool = eps.map((e) => ({
    endpointId: e.id,
    label: `${e.name || e.id} · ${e.state || "?"}`,
    status: e.state,
    assignedUserId: epToUser.get(e.id) || null,
    assignedEmail: epToUser.get(e.id) ? (emailById.get(epToUser.get(e.id)!) || "") : "",
  }));

  return NextResponse.json({
    pool,
    llm: {
      main: llmRaw.main || { provider: "grsai", model: "gemini-3.1-flash-lite" },
      fallback: (Array.isArray(llmRaw.fallbacks) && llmRaw.fallbacks[0]) || llmRaw.fallback || { provider: "openrouter", model: "openai/gpt-4.1" },
    },
    rates: {
      gpuRateHour: rates["livehost_gpu_rate_hour"] || "6.00",
      voiceRate1k: rates["livehost_voice_rate_1k"] || "0.30",
      audioRateGen: rates["livehost_audio_rate_gen"] || "0.30",
      minBalance: rates["livehost_min_balance"] || "5.00",
      warmWindowSec: rates["livehost_warm_window_sec"] || "900",
    },
    ext: {
      version: rates["livehost_ext_version"] || "1.0.0",
      downloadUrl: rates["livehost_ext_download_url"] || "",
    },
    clients: (profiles || []).map((p) => ({
      id: p.id,
      email: emailById.get(p.id) || "",
      name: p.full_name || "",
      plan: p.plan,
      plan_expires_at: p.plan_expires_at,
      backend_url: byId.get(p.id)?.backend_url || "",
      vast_instance_id: byId.get(p.id)?.vast_instance_id || "",
      notes: byId.get(p.id)?.notes || "",
      provision_status: byId.get(p.id)?.provision_status || "",
      gpu_status: gpuStatus.get(p.id) || "no gpu",
      gpu_allowed: !!byId.get(p.id)?.gpu_allowed,
      gpu_on: !!byId.get(p.id)?.gpu_on,
      gpu_on_at: byId.get(p.id)?.gpu_on_at || null,
      gpu_endpoint_id: byId.get(p.id)?.gpu_endpoint_id || "",
      usage: (() => {
        const a = agg.get(p.id) || { sec: 0, chars: 0, count: 0, live: false };
        const gpuRateN = parseFloat(rates["livehost_gpu_rate_hour"] || "6") || 6;
        const _vrN = parseFloat(rates["livehost_voice_rate_1k"] ?? "");
        const voiceRateN = Number.isFinite(_vrN) ? _vrN : 0.3;
        const gpuCost = (a.sec / 3600) * gpuRateN;
        const voiceCost = (a.chars / 1000) * voiceRateN;
        return {
          streamSec: a.sec,
          sessions: a.count,
          live: a.live,
          voiceChars: a.chars,
          gpuCost: +gpuCost.toFixed(2),
          voiceCost: +voiceCost.toFixed(2),
          totalCost: +(gpuCost + voiceCost).toFixed(2),
        };
      })(),
    })).sort((a, b) => a.email.localeCompare(b.email)),
  });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const { userId, backendUrl, vastInstanceId, notes, rates, llm, action, ext } = body || {};

  // Livehost extension version + download URL (for version gating + install).
  if (ext) {
    const admin = createAdminClient();
    const updates: [string, string][] = [];
    if (ext.version != null) updates.push(["livehost_ext_version", String(ext.version)]);
    if (ext.downloadUrl != null) updates.push(["livehost_ext_download_url", String(ext.downloadUrl)]);
    for (const [key, value] of updates) {
      await admin.from("app_settings").upsert({
        key, value: JSON.stringify(value), category: "livehost", updated_at: new Date().toISOString(),
      });
    }
    invalidateSettingsCache(updates.map(([k]) => k));
    return NextResponse.json({ ok: true });
  }

  // Manual provisioning trigger (same path the payment webhook uses).
  if (action === "provision" && userId) {
    const { provisionLivehost } = await import("@/lib/livehost-provision");
    const res = await provisionLivehost(userId);
    return NextResponse.json(res);
  }
  if (action === "check" && userId) {
    const { checkProvisionReady } = await import("@/lib/livehost-provision");
    return NextResponse.json({ status: await checkProvisionReady(userId) });
  }

  // Admin assigns a pre-created pool GPU to a client (the dropdown). endpointId
  // "" = unassign (free the GPU back to the pool). The client then turns it
  // on/off themselves at their Usage tab.
  if (action === "gpu_assign" && userId) {
    const { assignClientGpu } = await import("@/lib/livehost-pool");
    const r = await assignClientGpu(userId, String(body.endpointId || "").trim());
    return NextResponse.json({ ...r }, { status: r.ok ? 200 : 400 });
  }

  // Admin can also turn a client's GPU on/off directly (same billing path as the
  // client's Usage-tab control). on requires the client be assigned a GPU first.
  if ((action === "gpu_on" || action === "gpu_off") && userId) {
    const { setClientGpu } = await import("@/lib/livehost-pool");
    const r = await setClientGpu(userId, action === "gpu_on");
    return NextResponse.json({ ...r }, { status: r.ok ? 200 : 400 });
  }

  // AI Livehost chat-model cascade (main + fallback), same shape as Clone model.
  if (llm) {
    const admin = createAdminClient();
    const norm = (s: any) => ({
      provider: s?.provider === "grsai" ? "grsai" : "openrouter",
      model: String(s?.model || "").trim(),
    });
    const value = { main: norm(llm.main), fallbacks: llm.fallback?.model ? [norm(llm.fallback)] : [] };
    if (!value.main.model) return NextResponse.json({ error: "main model required" }, { status: 400 });
    await admin.from("app_settings").upsert({
      key: "livehost_llm",
      value,
      category: "livehost",
      updated_at: new Date().toISOString(),
    });
    invalidateSettingsCache(["livehost_llm"]);
    return NextResponse.json({ ok: true });
  }

  // Global client-facing rates update (RM/GPU-hour + RM/1k voice chars).
  if (rates) {
    const admin = createAdminClient();
    const updates: [string, string][] = [];
    if (rates.gpuRateHour != null) updates.push(["livehost_gpu_rate_hour", String(rates.gpuRateHour)]);
    if (rates.voiceRate1k != null) updates.push(["livehost_voice_rate_1k", String(rates.voiceRate1k)]);
    if (rates.audioRateGen != null) updates.push(["livehost_audio_rate_gen", String(rates.audioRateGen)]);
    if (rates.minBalance != null) updates.push(["livehost_min_balance", String(rates.minBalance)]);
    if (rates.warmWindowSec != null) updates.push(["livehost_warm_window_sec", String(rates.warmWindowSec)]);
    for (const [key, value] of updates) {
      await admin.from("app_settings").upsert({
        key,
        value: JSON.stringify(value),
        category: "livehost",
        updated_at: new Date().toISOString(),
      });
    }
    invalidateSettingsCache(updates.map(([k]) => k));
    return NextResponse.json({ ok: true });
  }

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("live_client_config").upsert({
    user_id: userId,
    backend_url: String(backendUrl || "").trim().replace(/\/+$/, ""),
    vast_instance_id: String(vastInstanceId || "").trim(),
    notes: String(notes || ""),
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
