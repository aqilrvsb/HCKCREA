// MASTER-PLAN batch caption/cover generation.
//
// Instead of firing one LLM call per video (40 videos = 40 calls → many time out
// / return incomplete under load), this plans a CHUNK of videos in ONE call —
// the model "thinks across" the whole chunk, so it also keeps them distinct.
// Used by the Editor's bulk Generate (see /api/ugc/generate-post-meta-batch).
// The per-video endpoint (extension) is untouched.
//
// Supports BOTH modes, matching lib/ugc-post-meta.ts exactly:
//   • detailOnly (Guna Info Product sahaja) → round-robin MAIN hook + rotating
//     cover ANGLE per video, STRICT grounding on the product detail, no scene.
//   • normal → category-matched loose hook energy + the video's own scene, angle
//     seeded per-video.

import { createAdminClient } from "@/lib/supabase/admin";
import { orChat } from "@/lib/openrouter";
import { HOOK_BANK, pickHooks, inferHookCategory } from "@/lib/hook-bank";
import { FM_HOOKS } from "@/lib/hook-bank-fm";
import { COVER_ANGLES } from "@/lib/ugc-post-meta";

// Pick n distinct items from an array by seed (stride 7), no global RNG.
function pickN(arr: string[], n: number, seed: number): string[] {
  if (!arr.length) return [];
  const start = Math.abs(Math.floor(seed)) % arr.length;
  const out: string[] = [];
  for (let k = 0; k < n; k++) out.push(arr[(start + k * 7) % arr.length]);
  return Array.from(new Set(out));
}

// Run thunks with a bounded concurrency so a 100-video batch (many chunks) never
// fires dozens of LLM calls at once and trips provider rate limits.
async function runPool(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (i < tasks.length) { const t = tasks[i++]; await t(); }
  });
  await Promise.all(workers);
}

export type BatchMetaOut = {
  caption: string;
  hashtags: string[];
  cover_title: string;
  cover_subtitle: string;
  tiktok_product_id: string | null;
  product_name: string | null;
};

type Item = {
  row: any;
  meta: Record<string, any>;
  prompt: string;
  pName: string;
  pDetail: string;
  tid: string;
  mainHook: string;
  angle: string;
  refHooks: string[];
};

const FALLBACK_HASHTAGS = ["#TikTokShopMalaysia", "#ViralMY", "#MestiCuba", "#ReviewJujur", "#FYPMalaysia"];

// Enforce EXACTLY 5 hashtags on a caption (same rule as the single-video path).
function enforceHashtags(caption: string): string {
  const tokens = caption.split(/\s+/);
  const hashIdxs = tokens.map((t, i) => (t.startsWith("#") ? i : -1)).filter((i) => i >= 0);
  if (hashIdxs.length > 5) {
    const drop = new Set(hashIdxs.slice(5));
    return tokens.filter((_, i) => !drop.has(i)).join(" ");
  }
  if (hashIdxs.length < 5) {
    const existing = new Set(hashIdxs.map((i) => tokens[i].toLowerCase()));
    const need = 5 - hashIdxs.length;
    const pad: string[] = [];
    for (const tag of FALLBACK_HASHTAGS) {
      if (!existing.has(tag.toLowerCase())) pad.push(tag);
      if (pad.length === need) break;
    }
    return `${caption.trim()} ${pad.join(" ")}`.trim();
  }
  return caption;
}

// Tolerant parse of a JSON ARRAY the LLM returns (fences / trailing commas).
function parseMetaArray(raw: string): any[] | null {
  let s = String(raw || "").trim();
  if (s.startsWith("```")) s = s.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start >= 0 && end > start) s = s.substring(start, end + 1);
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : null; } catch { /* repair */ }
  try {
    const repaired = s.replace(/,\s*([}\]])/g, "$1");
    const a = JSON.parse(repaired);
    return Array.isArray(a) ? a : null;
  } catch { return null; }
}

// One master LLM call for a chunk of items that SHARE a product. Returns an
// array aligned to `chunk` (index j → the j-th video's {caption, cover_title,
// cover_subtitle}), or null on failure.
async function runMasterChunk(chunk: Item[], opts: { detailOnly?: boolean; modelKey?: any }): Promise<any[] | null> {
  const n = chunk.length;
  const p0 = chunk[0];
  const productName = p0.pName;
  const productDetail = p0.pDetail;

  const systemPrompt = `You write TikTok post metadata for Malaysian UGC creators. Output ONLY a JSON ARRAY — no markdown, no prose. The array MUST have EXACTLY ${n} objects, in the SAME order as the videos listed, each exactly: {"caption": "...", "cover_title": "...", "cover_subtitle": "..."}.

Per object:
- caption: 2-3 sentences in informal Bahasa Melayu (korang, aku, ni, tu, memang, gila), 50-280 chars. OPEN with that video's MAIN HOOK kept PUNCHY and close to given (do not weaken it, do not force the product name into it), then 1 line of value about the product, ending with EXACTLY 5 viral hashtags of DIFFERENT categories (product category, benefit, problem/solution, Malaysian trending, buying intent). NO duplicate tags.
- cover_title: EXACTLY 2 words, ALL CAPS, ends with "?" or "!". It MUST express that video's COVER ANGLE (NOT always the product's main pain), NEVER the product name. Rotate with the angle: pain→"KERAP KENCING?", result→"GULA STABIL!", urgency→"JANGAN TUNGGU!", curiosity→"RAHSIA DIA?", price→"MURAH GILA?", social→"RAMAI DAH!".
- cover_subtitle: 3-6 words, ALL CAPS, completes the title in the SAME angle.

CRITICAL: all ${n} objects MUST be DISTINCT from each other — different caption wording AND a different 2-word cover_title each (never repeat a title).${
    opts.detailOnly
      ? ` STRICT GROUNDING: write ONLY from the Product name + detail below. Do NOT invent any benefit / ingredient / problem not in the detail, and never drift to an unrelated niche.`
      : ""
  }`;

  const lines = chunk
    .map((it, j) =>
      opts.detailOnly
        ? `${j + 1}. MAIN HOOK: "${it.mainHook}" | COVER ANGLE: "${it.angle}"`
        : `${j + 1}. SCENE: "${it.prompt.slice(0, 220).replace(/\s+/g, " ").trim()}" | HOOK ENERGY: "${it.mainHook}" | COVER ANGLE: "${it.angle}"`
    )
    .join("\n");

  const userPrompt = `${opts.detailOnly ? "Write purely from the product info below (no scene)." : "Each video has its OWN scene — use it as context for that video's caption."}

Product: ${productName || "(unknown — derive a generic Malay-friendly UGC angle from the detail)"}
${productDetail ? `Product detail: ${productDetail}` : ""}

Write ONE object per video, IN THIS ORDER (${n} total):
${lines}

Return the JSON ARRAY only. Start with [ and end with ].`;

  const TIMEOUT_MS = 60_000;
  const llm = await Promise.race([
    orChat({
      modelKey: opts.modelKey || "model_custom_idea",
      systemPrompt,
      userPrompt,
      temperature: 0.85,
      // ~180 tokens/object + headroom.
      maxTokens: Math.min(8000, 400 + n * 220),
    }),
    new Promise<{ ok: false; content?: string; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, content: undefined, error: `timeout ${TIMEOUT_MS / 1000}s` }), TIMEOUT_MS)
    ),
  ]);
  if (!llm.ok || !llm.content) return null;
  return parseMetaArray(llm.content);
}

// Persist one video's parsed meta (hashtags + cover normalise + update row).
// Returns the output or null if the parsed object is incomplete.
async function persistOne(admin: any, it: Item, parsed: any): Promise<BatchMetaOut | null> {
  const rawCap = String(parsed?.caption || "").trim();
  const rawT = String(parsed?.cover_title || "").trim();
  const rawS = String(parsed?.cover_subtitle || "").trim();
  if (rawCap.length < 20 || !rawT || !rawS) return null;

  const caption = enforceHashtags(rawCap);
  const coverTitle = rawT.toUpperCase().split(/\s+/).slice(0, 2).join(" ");
  const coverSubtitle = rawS.toUpperCase();
  const meta = {
    ...it.meta,
    cover_title: coverTitle,
    cover_subtitle: coverSubtitle,
    tiktok_product_id: it.tid || it.meta.tiktok_product_id || null,
    product_name: it.pName || it.meta.product_name || null,
    product_detail: it.pDetail || it.meta.product_detail || null,
  };
  await admin.from("history").update({ caption, metadata: meta }).eq("id", it.row.id);
  const hashtags = caption.split(/\s+/).filter((t: string) => t.startsWith("#")).slice(0, 5);
  return { caption, hashtags, cover_title: coverTitle, cover_subtitle: coverSubtitle, tiktok_product_id: it.tid || null, product_name: it.pName || null };
}

export async function generateUgcPostMetaBatch(
  historyIds: string[],
  opts: {
    productUrl?: string;
    productName?: string;
    productDetail?: string;
    detailOnly?: boolean;
    fmMode?: boolean; // detail-only: use the Fendi Mohd hook bank instead of trending
    modelKey?: "model_custom_idea" | "model_editor_text";
    userIdGuard?: string;
    chunkSize?: number;
  } = {}
): Promise<{ ok: boolean; results: Record<string, BatchMetaOut>; errors: Record<string, string> }> {
  const results: Record<string, BatchMetaOut> = {};
  const errors: Record<string, string> = {};
  const ids = (historyIds || []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!ids.length) return { ok: false, results, errors };

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("history")
    .select("id, user_id, type, tab, prompt, caption, reference_url, metadata")
    .in("id", ids);
  let fetched = (rows || []) as any[];
  if (opts.userIdGuard) fetched = fetched.filter((r) => r.user_id === opts.userIdGuard);
  if (!fetched.length) return { ok: false, results, errors };

  const byId = new Map(fetched.map((r) => [r.id, r]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as any[];
  const userId = ordered[0].user_id;

  // Resolve each row's product fields (+ framed_from fallback) and scene.
  const items: Item[] = await Promise.all(
    ordered.map(async (row) => {
      const meta = (row.metadata || {}) as Record<string, any>;
      let prompt = String(row.prompt || "");
      let pName = String(opts.productName || meta.product_name || "").trim();
      let pDetail = String(opts.productDetail || meta.product_detail || meta.detail || "").trim();
      if (meta.framed_from) {
        const { data: orig } = await admin.from("history").select("prompt, metadata").eq("id", String(meta.framed_from)).maybeSingle();
        if (orig) {
          const om = (orig.metadata || {}) as Record<string, any>;
          if (!pDetail) pDetail = String(om.product_detail || om.detail || "").trim();
          if (!pName) pName = String(om.product_name || "").trim();
          if (orig.prompt && /framed intro/i.test(prompt)) prompt = String(orig.prompt);
        }
      }
      let tid = String(meta.tiktok_product_id || "");
      const purl = String(opts.productUrl || "");
      if (purl) { const m = purl.match(/(\d{13,20})/); if (m) tid = m[1]; }
      return { row, meta, prompt, pName, pDetail, tid, mainHook: "", angle: "", refHooks: [] };
    })
  );

  // Reserve one round-robin block for the whole batch (detailOnly only), so each
  // video gets the NEXT sequential hook + angle without n separate RPC calls.
  let rrBase = 0;
  if (opts.detailOnly) {
    try {
      const { data } = await admin.rpc("reserve_hook_indices", { uid: userId, n: items.length });
      const v = Number(data);
      if (Number.isFinite(v) && v >= items.length) rrBase = v - items.length; // indices rrBase+1 .. rrBase+n
    } catch { /* fall back to seed below */ }
  }

  // Detail-mode round-robin pool: Fendi Mohd bank when FM mode is ON, else the
  // neutral trending bank.
  const detailPool = opts.fmMode && FM_HOOKS.length ? FM_HOOKS : HOOK_BANK.trending;
  items.forEach((it, i) => {
    const seed = Array.from(it.row.id as string).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    if (opts.detailOnly) {
      const idx = rrBase + i + 1; // 1-based sequential
      it.mainHook = detailPool[(idx - 1) % detailPool.length];
      it.angle = COVER_ANGLES[(idx - 1) % COVER_ANGLES.length];
      it.refHooks = pickN(detailPool, 4, seed).filter((h) => h !== it.mainHook).slice(0, 3);
    } else {
      const cat = inferHookCategory(`${it.pName} ${it.pDetail} ${it.prompt.slice(0, 300)}`);
      it.mainHook = pickHooks(cat, 1, seed)[0] || HOOK_BANK.trending[seed % HOOK_BANK.trending.length];
      it.angle = COVER_ANGLES[seed % COVER_ANGLES.length];
      it.refHooks = pickHooks(cat, 4, seed).slice(0, 3);
    }
  });

  // Group by product so one master call never mixes two products (bulk Generate
  // is one product; bulk Regenerate-caption without a picked product may not be).
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const key = (it.pName || "").toLowerCase() || "__none__";
    (groups.get(key) || groups.set(key, []).get(key)!).push(it);
  }

  const CHUNK = Math.max(1, Math.min(12, opts.chunkSize || 8));
  const CONCURRENCY = 6; // at most 6 master calls in flight, whatever the batch size
  const runChunk = async (chunk: Item[]) => {
    let parsed: any[] | null = null;
    try { parsed = await runMasterChunk(chunk, { detailOnly: opts.detailOnly, modelKey: opts.modelKey }); } catch { parsed = null; }
    for (let j = 0; j < chunk.length; j++) {
      const it = chunk[j];
      const out = parsed ? await persistOne(admin, it, parsed[j]) : null;
      if (out) { results[it.row.id] = out; delete errors[it.row.id]; }
      else errors[it.row.id] = "incomplete";
    }
  };
  const chunkify = (arr: Item[]): Item[][] => {
    const out: Item[][] = [];
    for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK));
    return out;
  };

  // Round 0: all chunks across all product groups, bounded concurrency (each
  // chunk = ONE LLM call, so 100 videos ≈ 13 calls, 6 at a time — never 100).
  const firstChunks: Item[][] = [];
  for (const g of groups.values()) firstChunks.push(...chunkify(g));
  await runPool(firstChunks.map((c) => () => runChunk(c)), CONCURRENCY);

  // Retry rounds: re-plan ONLY the misses. Up to 3 more rounds so a big batch
  // ends with everything complete (no silent skips) rather than partial.
  for (let round = 0; round < 3; round++) {
    const missing = items.filter((it) => !results[it.row.id]);
    if (!missing.length) break;
    await runPool(chunkify(missing).map((c) => () => runChunk(c)), CONCURRENCY);
  }

  return { ok: Object.keys(results).length > 0, results, errors };
}
