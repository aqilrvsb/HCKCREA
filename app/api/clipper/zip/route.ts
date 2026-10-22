import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMotionConfig } from "@/lib/motion";
import { CLIPPER_TAB } from "@/lib/clipper";

// POST /api/clipper/zip { ids } — the client's finished CLIPPER clips in one ZIP (built on Modal, stored on B2).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const ids = (Array.isArray(b?.ids) ? b.ids : []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 40);
  if (!ids.length) return NextResponse.json({ error: "Tiada klip dipilih." }, { status: 400 });
  const admin = createAdminClient();
  const { data: rows } = await admin.from("history").select("id, prompt, output_url, status, metadata->clipper")
    .in("id", ids).eq("user_id", user.id).eq("tab", CLIPPER_TAB).eq("status", "done");
  // the posting kit per clip (title / hook / caption / hashtags) from its analysis
  const jobIds = [...new Set((rows ?? []).map((r: any) => r.clipper?.job_id).filter((x: unknown): x is string => typeof x === "string"))];
  const { data: jobs } = jobIds.length
    ? await admin.from("history").select("id, metadata->analysis->clips").in("id", jobIds).eq("user_id", user.id)
    : { data: [] as any[] };
  const kitOf = (r: any) => {
    const clips: any[] = (jobs ?? []).find((j: any) => j.id === r.clipper?.job_id)?.clips ?? [];
    const c = clips.find((x) => Math.abs(Number(x?.start) - Number(r.clipper?.start)) < 6) ?? null;
    return { title: r.clipper?.title || r.prompt || "", hook: r.clipper?.hook || c?.hook || "", caption: c?.caption || "", hashtags: Array.isArray(c?.hashtags) ? c.hashtags : [] };
  };
  const items = (rows ?? []).filter((r: any) => r.output_url).map((r: any) => ({ url: r.output_url, name: r.prompt || "klip", kit: kitOf(r) }));
  if (!items.length) return NextResponse.json({ error: "Tiada klip siap untuk dimuat turun." }, { status: 400 });
  const cfg = await getMotionConfig();
  if (!cfg) return NextResponse.json({ error: "Motion renderer not configured" }, { status: 500 });
  const key = `users/${user.id.replace(/[^A-Za-z0-9_-]/g, "")}/clipper/zips/${randomUUID().replace(/-/g, "")}.zip`;
  const r = await fetch(`${cfg.api_url}/zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: cfg.secret, key, items }),
    signal: AbortSignal.timeout(280_000),
  }).catch((e) => ({ ok: false, json: async () => ({ error: String(e?.message || e) }) } as any));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.url) return NextResponse.json({ error: `ZIP gagal: ${j?.error || "cuba lagi"}` }, { status: 502 });
  return NextResponse.json({ ok: true, url: j.url, count: items.length });
}
