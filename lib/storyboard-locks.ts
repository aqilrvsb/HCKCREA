// Storyboard planner + prompt helpers.
//
// Hard prompt locks are appended to the FINAL storyboard image prompt. These
// are deliberately NOT part of the planner's system prompt: the image model
// never sees that prompt, and without a hard product rule it treated the
// packaging as a design to reinterpret (wrong brand colour, different cap,
// warped silhouette, invented label text).
//
// Since 2026-11-20 storyboards are drawn by Nano Banana 2.1 and planned by
// Sonnet 5.5 (model_custom_idea: code28 → DragonAPI). This module also holds
// the render-engine notes for the planner, the CONCEPT-based NO-REPEAT memory
// and the shared planner call.
//
// Shared by /api/generate/storyboard and .../storyboard/replace so a Tukar
// regenerates under exactly the same rules as the original fire.

import { orChat } from "@/lib/openrouter";

/**
 * ABSOLUTE PRODUCT LOCK.
 *
 * Also states WHICH reference images are the product: refImages is ordered
 * avatar-first, so without an explicit index map the model can mistake a
 * presenter photo for the product (or vice versa).
 *
 * Pass the counts ACTUALLY sent to the provider (i.e. after the cap-5 slice),
 * not the counts the user uploaded — a lock pointing at an image that was
 * never attached is worse than no lock at all.
 */
export function productLockRule(avatarCount: number, productCount: number): string {
  if (productCount < 1) return "";
  const first = avatarCount + 1;
  const last = avatarCount + productCount;
  const which =
    productCount === 1
      ? `Reference image ${first} is the PRODUCT`
      : `Reference images ${first}–${last} are the PRODUCT (the SAME product, different angles)`;
  const avatarNote =
    avatarCount > 0
      ? ` Reference image${avatarCount > 1 ? `s 1–${avatarCount} are` : " 1 is"} the presenter's FACE, NOT the product — never blend the two.`
      : "";
  return (
    `\n\nABSOLUTE PRODUCT LOCK — ${which}.${avatarNote} Every frame that shows the product MUST reproduce it EXACTLY as photographed: ` +
    `identical brand colour and colour placement, identical cap/lid colour and shape, identical bottle/tube/jar/pouch silhouette and proportions, ` +
    `identical label artwork and logo, and all label text copied VERBATIM character-for-character in the same font, size and position. ` +
    `Do NOT restyle, recolour, resize, simplify, re-letter, translate, mirror, invent or "improve" any part of the packaging — ` +
    `no alternative colourways, no different cap, no redrawn logo, no substituted or made-up words, no extra badges or stickers. ` +
    `Treat the product as a PHOTOGRAPHIC ASSET to be copied faithfully into each frame, not a design to reinterpret. ` +
    `If a frame cannot render the label sharply and correctly, angle the product away, crop it, or throw it out of focus — ` +
    `NEVER invent text or guess the artwork to fill the gap.`
  );
}

// ── Render-engine notes for the planner ─────────────────────────────────────
// The planner (Sonnet 5.5) is text-only; Nano Banana 2.1 (Gemini image)
// receives the prompt PLUS the reference photos (avatar first, then product).
// Gemini follows flowing descriptive sentences and explicit layout better than
// tag lists / negative lists, renders quoted caption text faithfully, and keeps
// products exact when told to copy the attached photos.
export function nanoBananaGuide(noSubtitle: boolean): string {
  return [
    "",
    "",
    "<render_engine>",
    "Your prompt is sent to Google Nano Banana 2.1 (a Gemini image model) together with the client's reference photos (presenter face first if any, then the product photos). Write it the way this model follows best:",
    "- Clear, flowing natural-language sentences — not keyword lists, tags, weights or parameters, and no negative-prompt list. Describe what you want to see.",
    "- State the layout once, exactly (e.g. 'nine equal panels in a 3x3 grid, flush edge-to-edge with thin white gutters'), then describe every panel in reading order as 'Panel 1: …', 'Panel 2: …' — subject, action, camera framing, setting and light.",
    "- Call the product 'the product from the reference photos' and say it must match them exactly — packaging colour, shape, cap, logo and label. Never invent a colour, material or design; only add product details given in the brief.",
    "- Keep one consistent presenter across all panels (same face, hijab or hair, outfit) unless the sub-style needs different people.",
    noSubtitle
      ? "- No captions: every panel is pure imagery."
      : "- Captions: write each panel's caption inside double quotes exactly as it must appear, and describe the caption style once (e.g. big bold white sans-serif with a soft shadow, lower third). No other text in the panels.",
    "- UGC = photorealistic smartphone footage (natural window or room light, real Malaysian home, true skin texture). Product Commercial = studio-grade light and deliberate art direction.",
    "- Keep the whole image prompt under about 2,500 characters.",
    "</render_engine>",
  ].join("\n");
}

// Planner output format (CONCEPT line, then the prompt) — appended to the user prompt.
export const STORYBOARD_OUTPUT_FORMAT = [
  "",
  "",
  "<output_format>",
  'Line 1: "CONCEPT: " followed by one sentence naming this storyboard\'s hook, setting, presenter styling, light and panel layout (used to keep future storyboards different).',
  'Then one blank line, then the image prompt, starting with "ONE single 9:16 storyboard grid for ONE video only."',
  "No other preamble, headings or markdown.",
  "</output_format>",
].join("\n");

// ── NO-REPEAT memory ────────────────────────────────────────────────────────
// Each planned storyboard carries a one-line CONCEPT (hook · setting · presenter
// styling · light · layout) that the planner writes as its first line. It is
// stripped from the image prompt, saved as metadata.concept and used as the
// "already used" memory. (The old memory kept the first 180 chars of the
// prompt — which is only the grid boilerplate, identical for every grid.)
export const OPENER_RE = /^ONE single 9:16 storyboard grid for ONE video only\.?\s*/i;

export function splitConcept(raw: string): { concept: string; prompt: string } {
  const m = raw.match(/^\s*\**\s*CONCEPT\s*\**\s*:\s*(.+?)\s*(?:\r?\n|$)/i);
  if (!m) return { concept: "", prompt: raw.trim() };
  return { concept: m[1].replace(/\*+/g, "").trim().slice(0, 260), prompt: raw.slice(m[0].length).trim() };
}

// Fingerprint for rows saved before metadata.concept existed: Panel/Frame 1's
// description, else the first sentences that aren't grid boilerplate.
export function conceptOf(prompt: string, metaConcept?: unknown): string {
  const saved = typeof metaConcept === "string" ? metaConcept.trim() : "";
  if (saved.length > 20) return saved.slice(0, 260);
  const p = String(prompt || "").replace(/\s+/g, " ").replace(OPENER_RE, "");
  const first = p.match(/(?:panel|frame)\s*1\s*[:.)\-–—]\s*(.{20,240})/i);
  if (first) return first[1].trim();
  return p
    .split(/(?<=\.)\s+/)
    .filter((s) => !/grid|layout|aspect ratio|full-bleed|gutter|timecode|header/i.test(s))
    .join(" ")
    .slice(0, 240);
}

const GENERIC_WORDS = new Set([
  "storyboard", "product", "products", "presenter", "malaysian", "panel", "panels", "frame", "frames",
  "with", "from", "that", "this", "into", "then", "their", "while", "shot", "shots", "video", "grid",
  "layout", "concept", "hook", "setting", "light", "lighting", "look", "style", "styling",
]);

function conceptWords(s: string, extraStop: Set<string>): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9à-ÿ ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !GENERIC_WORDS.has(w) && !extraStop.has(w))
  );
}

// Jaccard overlap of the meaningful words — 1 = identical concept.
export function conceptSimilarity(a: string, b: string, extraStop: Set<string> = new Set()): number {
  const A = conceptWords(a, extraStop);
  const B = conceptWords(b, extraStop);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// ≥ this overlap with any already-used concept → ask the planner once more.
export const TOO_SIMILAR = 0.4;

// ── Shared planner call ─────────────────────────────────────────────────────
// Asks the planner (model_custom_idea = Sonnet 5.5 via code28, DragonAPI next)
// for the CONCEPT line + image prompt. If the concept is too close to one
// already used (past 7 days in this project, or earlier in this batch), asks
// ONCE more naming the clash, and keeps whichever version is less similar.
export async function planStoryboardPrompt(opts: {
  systemPrompt: string;
  userPrompt: string;
  avoidList: string[];
  productName: string;
  temperature?: number;
}): Promise<{ prompt: string; concept: string; retried: boolean } | null> {
  const productStop = new Set(
    String(opts.productName || "")
      .toLowerCase()
      .split(/[^a-z0-9à-ÿ]+/)
      .filter((w) => w.length > 3)
  );
  const closest = (c: string) =>
    opts.avoidList.reduce(
      (best, prev, k) => {
        const sc = conceptSimilarity(c, prev, productStop);
        return sc > best.score ? { score: sc, idx: k } : best;
      },
      { score: 0, idx: -1 }
    );
  const plan = async (userPrompt: string, temperature: number) => {
    const llm = await orChat({ modelKey: "model_custom_idea", systemPrompt: opts.systemPrompt, userPrompt, temperature, maxTokens: 1400 });
    if (!llm.ok || !llm.content || llm.content.trim().length <= 40) return null;
    const parts = splitConcept(llm.content.trim());
    if (parts.prompt.length <= 40) return null;
    return { prompt: parts.prompt, concept: parts.concept || conceptOf(parts.prompt) };
  };

  let got = await plan(opts.userPrompt, opts.temperature ?? 0.95);
  let retried = false;
  if (got && opts.avoidList.length) {
    const near = closest(got.concept);
    if (near.score >= TOO_SIMILAR) {
      retried = true;
      const revision =
        `\n\n<revision>\nYour first idea — "${got.concept}" — is too close to already-used concept ${near.idx + 1} ` +
        `("${opts.avoidList[near.idx]}"). Write a clearly different storyboard: change the hook, the setting, ` +
        `the presenter styling, the light and the panel layout.\n</revision>`;
      const again = await plan(opts.userPrompt + revision, 1);
      if (again && closest(again.concept).score < near.score) got = again;
    }
  }
  return got ? { ...got, retried } : null;
}

// Past-7-day storyboard concepts for the NO-REPEAT memory — scoped to the
// project (TikTok duplicate detection is per account/brand), else the user's
// unscoped storyboards. Best-effort: returns [] on any error.
export async function loadPastConcepts(
  admin: any,
  opts: { projectId: string | null; userId: string; excludeId?: string }
): Promise<string[]> {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    let q = admin
      .from("history")
      .select("id, prompt, metadata")
      .eq("type", "image")
      .eq("tab", "image")
      .filter("metadata->>feature", "eq", "storyboard")
      .gte("created_at", weekAgo);
    q = opts.projectId ? q.eq("project_id", opts.projectId) : q.eq("user_id", opts.userId);
    const { data } = await q.order("created_at", { ascending: false }).limit(40);
    return (data || [])
      .filter((r: any) => r.id !== opts.excludeId)
      // Skip rows still holding the placeholder label (never planned).
      .filter((r: any) => !/^(Storyboard ·|Campaign \d)/i.test(String(r.prompt || "")))
      .map((r: any) => conceptOf(String(r.prompt || ""), r?.metadata?.concept))
      .filter((c: string) => c.length > 30);
  } catch {
    return [];
  }
}
