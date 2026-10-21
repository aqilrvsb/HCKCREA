// Motion · "Saya nak pilih sendiri" — the 40 styles of the VGC Prompt Vault (Coach Am, used as a partner).
//
// The styles, their card previews and the brief each one gives the AI live ONLY in the private `vgc-vault` bucket
// (this repo is public): this file loads the vault's own scripts at run time and asks them for the list, the preview
// markup and the brief — nothing of the vault is copied here, so a vault update (scripts/vgc-sync.mjs) reaches
// Default by itself. Server-only.
import vm from "node:vm";
import { createAdminClient } from "@/lib/supabase/admin";

export type VaultStyle = {
  id: string;
  name: string;
  group: string;
  desc: string;
  native: boolean;
  bestFor?: string;
  /** [background, text, accent] — the 30 visual styles only */
  colors?: string[];
  /** the card preview, drawn by the vault's own code (needs `css` below) */
  sample: string;
  /** the full brief the vault gives the AI for this style */
  brief: string;
};
type Vault = { styles: VaultStyle[]; css: string; fonts: string[] };

const TTL_MS = 5 * 60_000;
let cache: { at: number; vault: Vault } | null = null;
let loading: Promise<Vault> | null = null;

async function text(rel: string): Promise<string> {
  const { data, error } = await createAdminClient().storage.from("vgc-vault").download(rel);
  if (error || !data) throw new Error(`vgc-vault: ${rel} missing`);
  return data.text();
}

/** Split on commas outside parentheses / brackets (selector lists). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Every selector of the vault's CSS put under `.vgc-scope`, so the previews can't touch the dashboard. */
export function scopeCss(css: string, scope = ".vgc-scope"): string {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let out = "", i = 0;
  const block = (from: number): number => { // index just past the matching "}"
    let depth = 0;
    for (let j = from; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) return j + 1;
    }
    return css.length;
  };
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    const end = block(open);
    const body = css.slice(open + 1, end - 1);
    if (/^@(media|supports|container)/i.test(head)) out += `${head}{${scopeCss(body, scope)}}`;
    else if (/^@/.test(head)) {
      if (!/^@(import|font-face)/i.test(head)) out += `${head}{${body}}`; // keyframes etc. as they are
    } else if (head) {
      const sel = splitTop(head).map((s) => s.trim()).filter(Boolean).map((s) =>
        /^(:root|html|body)$/i.test(s) ? scope : `${scope} ${s.replace(/^(:root|html|body)\s+/i, "")}`);
      out += `${sel.join(",")}{${body}}`;
    }
    i = end;
  }
  return out;
}

async function build(): Promise<Vault> {
  const [fmt, presets, natives, visuals, library, libCss, demoCss, baseCss] = await Promise.all([
    text("prompt-format.js"), text("style-presets.js"), text("native-styles.js"), text("concept-visuals.js"),
    text("style-library.js"), text("style-library.css"), text("concept-demos.css"), text("style.css"),
  ]);
  // the library keeps its preview function private: hand it out (and the selection, for the Fast Track brief)
  const exposed = library.replace("return {init,presets,", "return {sample,_selected:selected,init,presets,");
  if (exposed === library) throw new Error("vgc-vault: style-library.js changed shape");
  const ctx: Record<string, unknown> = { console: { log() {}, warn() {}, error() {} } };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const [name, code] of [["prompt-format.js", fmt], ["style-presets.js", presets], ["native-styles.js", natives],
    ["concept-visuals.js", visuals], ["style-library.js", exposed]] as const) {
    vm.runInContext(code, ctx, { filename: name, timeout: 2000 });
  }
  const lib = ctx.StyleLibrary as { presets: any[]; sample: (s: any) => string; brief: (s: any) => string } | undefined;
  if (!lib?.presets?.length) throw new Error("vgc-vault: no styles");
  // the vault's own gallery order: the 10 editing concepts, then the 30 visual styles
  const all = [...lib.presets.filter((s) => s.native), ...lib.presets.filter((s) => !s.native)];
  const styles: VaultStyle[] = all.map((s) => ({
    id: String(s.id), name: String(s.name), group: String(s.group ?? ""), desc: String(s.desc ?? ""), native: !!s.native,
    ...(s.bestFor ? { bestFor: String(s.bestFor) } : {}),
    ...(Array.isArray(s.colors) ? { colors: s.colors.map(String) } : {}),
    sample: lib.sample(s),
    brief: lib.brief(s),
  }));
  // the vault's fonts (@import) and colour / font tokens (:root) — the previews use them
  const fonts = [...baseCss.matchAll(/@import\s+url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]).filter((u) => u.startsWith("https://fonts.googleapis.com/"));
  const root = baseCss.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
  const tokens = root.split(";").map((d) => d.trim()).filter((d) => d.startsWith("--")).join(";");
  const css = `.vgc-scope{${tokens}}` + scopeCss(libCss) + scopeCss(demoCss);
  return { styles, css, fonts };
}

export async function vgcVault(): Promise<Vault> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.vault;
  loading ??= build().then((vault) => { cache = { at: Date.now(), vault }; return vault; }).finally(() => { loading = null; });
  return loading;
}

/** One style (null: unknown id, or the vault can't be read). */
export async function vgcStyle(id: string | undefined | null): Promise<VaultStyle | null> {
  if (!id) return null;
  try {
    return (await vgcVault()).styles.find((s) => s.id === id) ?? null;
  } catch {
    return null;
  }
}
