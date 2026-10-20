import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";

// GET /vgc/… — Motion "Custom Style": the VGC Prompt Vault (Coach Am, used
// with permission as a partner) with PeningLab's bridge added, so the filled
// prompt is generated directly instead of copied into Claude Code. The files
// live in the private `vgc-vault` storage bucket (scripts/vgc-sync.mjs), never
// in this public repo, and are served only to signed-in Motion clients.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
};
// per-instance cache: the vault changes only when vgc-sync runs
const cache = new Map<string, { body: ArrayBuffer; at: number }>();
const TTL_MS = 5 * 60_000;

export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const rel = path.join("/") || "index.html";
  if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.includes("..")) return new Response("Not found", { status: 404 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return rel === "index.html" ? Response.redirect(new URL("/login", req.url), 302) : new Response("Unauthorized", { status: 401 });
  }
  if (!(await isTabAllowedForUser(user.id, "motion"))) return new Response("Forbidden", { status: 403 });

  let hit = cache.get(rel);
  if (!hit || Date.now() - hit.at > TTL_MS) {
    const { data, error } = await createAdminClient().storage.from("vgc-vault").download(rel);
    if (error || !data) return new Response("Not found", { status: 404 });
    hit = { body: await data.arrayBuffer(), at: Date.now() };
    cache.set(rel, hit);
  }
  const ext = (rel.split(".").pop() || "").toLowerCase();
  return new Response(hit.body, {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
