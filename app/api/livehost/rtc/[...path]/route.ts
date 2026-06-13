import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

// RUNPOD SERVERLESS SIGNALING PROXY.
// The studio (browser) talks to /api/livehost/rtc/<path>; we resolve the
// logged-in client's RunPod endpoint and forward to
//   https://<endpointId>.api.runpod.ai/<path>
// injecting the RunPod API key server-side (the key NEVER reaches the browser,
// and RunPod LB endpoints require Bearer auth on every request). Covers
// /ice-servers, /offer, /keepalive, /avatars, /register-avatar, /ping.
// WebRTC MEDIA does not go through here — it flows browser <-> Cloudflare TURN
// <-> worker directly; this proxy only carries the HTTP signaling.

async function resolveEndpoint(): Promise<
  { endpointId: string; key: string } | { error: string; status: number }
> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "unauthenticated", status: 401 };

  const admin = createAdminClient();
  const { data } = await admin
    .from("live_client_config")
    .select("vast_instance_id, backend_url")
    .eq("user_id", user.id)
    .maybeSingle();

  // RunPod clients store the endpoint id in vast_instance_id and use the
  // /api/livehost/rtc backend. A non-proxy backend_url means this client is
  // still on the legacy (Novita) path and shouldn't hit this proxy.
  const endpointId = data?.vast_instance_id;
  if (!endpointId || !String(data?.backend_url || "").includes("/api/livehost/rtc")) {
    return { error: "no RunPod endpoint for this client", status: 404 };
  }
  const key = (await getSetting<string>("runpod_api_key")) || "";
  if (!key) return { error: "runpod_api_key not set", status: 500 };
  return { endpointId, key };
}

async function forward(req: Request, pathParts: string[]) {
  const r = await resolveEndpoint();
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });

  const path = (pathParts || []).join("/");
  const search = new URL(req.url).search;
  const target = `https://${r.endpointId}.api.runpod.ai/${path}${search}`;

  const headers: Record<string, string> = { Authorization: `Bearer ${r.key}` };
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
    headers["Content-Type"] = req.headers.get("content-type") || "application/json";
  }

  try {
    const resp = await fetch(target, { ...init, signal: AbortSignal.timeout(30000) });
    const body = await resp.text();
    return new NextResponse(body, {
      status: resp.status,
      headers: { "content-type": resp.headers.get("content-type") || "application/json" },
    });
  } catch (e: any) {
    // Worker cold-starting or unreachable — surface 503 so the studio retries.
    return NextResponse.json({ error: String(e?.message || e).slice(0, 120) }, { status: 503 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
