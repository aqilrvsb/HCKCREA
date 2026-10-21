import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";

// GET /vgc/… — Motion "Custom Style": the VGC Prompt Vault (Coach Am, used
// with permission as a partner) with PeningLab's bridge added, so the filled
// prompt is generated directly instead of copied into Claude Code. The files
// live in the private `vgc-vault` storage bucket (scripts/vgc-sync.mjs), never
// in this public repo, and are served only to signed-in Motion clients.
//
// The page is served as ONE response: its ~15 stylesheets, ~17 scripts and content.json are put inline here
// (each was its own request through this route — a sign-in check + a storage read each on a cold instance,
// ~18 s before Custom Style could show anything). Images still come one by one, cached by the browser.
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
// per-instance cache: the vault changes only when vgc-sync runs (the bridge: vgc-bridge-up)
const cache = new Map<string, { body: ArrayBuffer; at: number }>();
const TTL_MS = 5 * 60_000;
let page: { html: string; at: number } | null = null;

async function file(rel: string): Promise<ArrayBuffer | null> {
  const hit = cache.get(rel);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.body;
  const { data, error } = await createAdminClient().storage.from("vgc-vault").download(rel);
  if (error || !data) return null;
  const body = await data.arrayBuffer();
  cache.set(rel, { body, at: Date.now() });
  return body;
}
const text = async (rel: string) => { const b = await file(rel); return b ? new TextDecoder().decode(b) : null; };

/** index.html with every /vgc stylesheet and script inline (same order; scripts at the end of <body>, where
 *  deferred scripts run) and content.json answered from memory. null when a piece is missing → the plain page. */
async function bundled(): Promise<string | null> {
  if (page && Date.now() - page.at < TTL_MS) return page.html;
  let html = await text("index.html");
  if (!html) return null;
  const links = [...html.matchAll(/<link rel="stylesheet" href="\/vgc\/([A-Za-z0-9._-]+\.css)(?:\?[^"]*)?">/g)];
  const scripts = [...html.matchAll(/<script src="\/vgc\/([A-Za-z0-9._-]+\.js)(?:\?[^"]*)?"( defer)?><\/script>\s*/g)];
  const [css, js, content] = await Promise.all([
    Promise.all(links.map((m) => text(m[1]))),
    Promise.all(scripts.map((m) => text(m[1]))),
    text("content.json"),
  ]);
  if (css.some((c) => c === null) || js.some((c) => c === null)) return null;
  // replacer functions throughout: the vault's code contains "$1" / "$&", which a replacement string would expand
  links.forEach((m, i) => { html = html!.replace(m[0], () => `<style data-src="${m[1]}">${css[i]!.replace(/<\/style/gi, "<\\/style")}</style>`); });
  for (const m of scripts) html = html.replace(m[0], () => "");
  // the page's own non-deferred script (the bridge) ran before the deferred ones: keep that order
  const order = scripts.map((m, i) => ({ defer: !!m[2], i })).sort((a, b) => Number(a.defer) - Number(b.defer));
  const inline = order.map(({ i }) => `<script data-src="${scripts[i][1]}">${js[i]!.replace(/<\/script/gi, "<\\/script")}</script>`).join("\n");
  const preload = content
    ? `<script>(()=>{const c=${JSON.stringify(content).replace(/</g, "\\u003c")};const f=window.fetch.bind(window);`
      + `window.fetch=(u,o)=>String(u).split("?")[0]==="/vgc/content.json"?Promise.resolve(new Response(c,{headers:{"Content-Type":"application/json"}})):f(u,o);})();</script>`
    : "";
  html = html.replace("</body>", () => `${preload}\n${inline}\n</body>`);
  page = { html, at: Date.now() };
  return html;
}

export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  const rel = path.join("/") || "index.html";
  if (!/^[A-Za-z0-9._/-]+$/.test(rel) || rel.includes("..")) return new Response("Not found", { status: 404 });

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return rel === "index.html" ? Response.redirect(new URL("/login", req.url), 302) : new Response("Unauthorized", { status: 401 });
  }
  const headers = { "X-Robots-Tag": "noindex, nofollow" };

  if (rel === "index.html") {
    if (!(await isTabAllowedForUser(user.id, "motion"))) return new Response("Forbidden", { status: 403 });
    const html = await bundled();
    if (html) return new Response(html, { headers: { ...headers, "Content-Type": TYPES.html, "Cache-Control": "private, max-age=60" } });
  }

  const body = await file(rel);
  if (!body) return new Response("Not found", { status: 404 });
  const ext = (rel.split(".").pop() || "").toLowerCase();
  return new Response(body, {
    headers: {
      ...headers,
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      // images and fonts don't change between syncs (a sync renames or re-versions them): keep them a day
      "Cache-Control": rel.startsWith("assets/") ? "private, max-age=86400" : "private, max-age=300",
    },
  });
}
