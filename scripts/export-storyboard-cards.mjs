// One-off: export the confidential storyboard sub-category specs from
// app_settings into clean local markdown files (gitignored) so they can be
// handed to another AI. Pages 2/3 are stored double-encoded ({"value":"..."})
// with UTF-8→Latin-1 mojibake; this un-wraps + repairs them.
//
// Run: node scripts/export-storyboard-cards.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Load NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
const env = {};
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* fall back to process.env */ }
const URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// Repair UTF-8 bytes that were mis-decoded as Windows-1252 (â€" → —, â€¢ → •,
// â€œ/â€ → “/”, etc.). The 0x80–0x9F specials (€ ” — • …) are OUTSIDE Latin-1,
// so we map each CP1252 code point back to its byte, then decode as UTF-8.
// Gated on mojibake detection so already-clean UTF-8 (page 1) is left untouched.
const CP1252_REV = {
  0x20ac:0x80,0x201a:0x82,0x0192:0x83,0x201e:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,
  0x02c6:0x88,0x2030:0x89,0x0160:0x8a,0x2039:0x8b,0x0152:0x8c,0x017d:0x8e,0x2018:0x91,
  0x2019:0x92,0x201c:0x93,0x201d:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02dc:0x98,
  0x2122:0x99,0x0161:0x9a,0x203a:0x9b,0x0153:0x9c,0x017e:0x9e,0x0178:0x9f,
};
function fixMojibake(s) {
  if (!/â€|Ã.|Â./.test(s)) return s; // already clean UTF-8
  const bytes = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xff) bytes.push(cp);
    else if (CP1252_REV[cp] != null) bytes.push(CP1252_REV[cp]);
    else for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
  }
  return Buffer.from(bytes).toString("utf8");
}

const KEYS = [
  { key: "storyboard_subcards", file: "page1-proven.md" },
  { key: "storyboard_subcards_p2", file: "page2.md" },
  { key: "storyboard_subcards_p3", file: "page3.md" },
];

mkdirSync("storyboard-cards-export", { recursive: true });

for (const { key, file } of KEYS) {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) { console.error(key, "→ not found", error?.message || ""); continue; }
  // value.text is EITHER a string (page 1) OR a nested object {value:"markdown"}
  // (pages 2/3, stored via a JSON-wrapped import).
  const node = data.value?.text;
  let text = "";
  if (typeof node === "string") text = node;
  else if (node && typeof node === "object" && typeof node.value === "string") text = node.value;
  else text = String(node ?? "");
  console.error(`[${key}] extracted len=${text.length}, head=${JSON.stringify(text.slice(0, 40))}`);
  text = fixMojibake(text).replace(/\r\n/g, "\n");
  writeFileSync(`storyboard-cards-export/${file}`, text, "utf8");
  console.log(`✓ ${file} — ${text.length.toLocaleString()} chars`);
}
console.log("Done → storyboard-cards-export/");
