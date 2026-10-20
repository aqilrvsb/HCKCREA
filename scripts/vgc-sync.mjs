// Upload the VGC Prompt Vault (Coach Am — used with permission) to the private
// `vgc-vault` bucket served by app/vgc/[[...path]]/route.ts, with PeningLab's
// bridge (vgc-bridge/) added. The vault itself is never committed: this repo
// is public. Run after pulling a newer vault copy:
//   node scripts/vgc-sync.mjs <folder with index.html, *.js, *.css, content.json, assets/>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SRC = process.argv[2];
if (!SRC) throw new Error("usage: node scripts/vgc-sync.mjs <vault folder>");
const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const SKIP = new Set(["route-entry.js", "asset-list.txt"]);
const version = Date.now().toString(36);

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// The vault is built for its own domain root: point every absolute path at /vgc/.
function transform(rel, buf) {
  const ext = extname(rel);
  if (![".html", ".js", ".css"].includes(ext)) return buf;
  let s = buf.toString("utf8");
  if (rel === "index.html") {
    s = s
      .replace(/<script[^>]*src="\/route-entry\.js"[^>]*><\/script>\s*/, "") // rewrites the URL to the vault's code
      .replace(/<link rel="canonical"[^>]*>\s*/, "")
      .replace(/<script>\(function\(\)\{function c\(\)[\s\S]*?<\/script>/, "") // host's bot-check snippet
      .replace(/(href|src)="\/(?!\/)/g, '$1="/vgc/')
      .replace("</head>", `<link rel="stylesheet" href="/vgc/peninglab.css?v=${version}">\n</head>`)
      .replace("</body>", `<script src="/vgc/peninglab.js?v=${version}"></script>\n</body>`);
  } else if (ext === ".js") {
    s = s.replace(/fetch\('\/content\.json'\)/g, "fetch('/vgc/content.json')").replace(/(["'`])\/assets\//g, "$1/vgc/assets/");
  } else {
    s = s.replace(/url\((['"]?)\/assets\//g, "url($1/vgc/assets/");
  }
  return Buffer.from(s, "utf8");
}

const files = walk(SRC)
  .map((p) => ({ path: p, rel: relative(SRC, p).split("\\").join("/") }))
  .filter((f) => !SKIP.has(f.rel) && TYPES[extname(f.rel)]);
const bridge = ["peninglab.js", "peninglab.css"].map((n) => ({ path: join(ROOT, "vgc-bridge", n), rel: n }));

let ok = 0;
for (const f of [...files, ...bridge]) {
  const body = transform(f.rel, readFileSync(f.path));
  const { error } = await sb.storage.from("vgc-vault").upload(f.rel, body, { contentType: TYPES[extname(f.rel)], upsert: true });
  if (error) console.log(`✗ ${f.rel}: ${error.message}`);
  else ok++;
}
console.log(`vgc-vault: ${ok}/${files.length + bridge.length} files uploaded (bridge v=${version})`);
