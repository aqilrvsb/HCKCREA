// CLIPPER live preview — shared by the Studio preview (browser), /api/clipper/preview and the clip render's plan
// (/api/motion/plan), so the preview and the final clip make the same choices: the same "AI pilih" caption look,
// hook style and font (seeded by the clip), and the same keyword colours / zooms (one polish call, reused by the
// render). The timeline steps mirror modal_motion.py (_cold_open, _clip_segments, _remap_words) closely enough
// for a preview; the render stays the source of truth.

export type PWord = { w: string; t: number; e: number };
/** a transcript line of an analysis (B2 transcript.json); "wt" = its words' [start, end] (newer analyses) */
export type TLine = { start: number; end: number; text: string; spk?: string; wt?: [number, number][] };
export type PolishKeyword = { i: number; color: string; emoji?: string };
export type PolishZoom = { at: string; to?: string; scale: number };
/** the polish made for a preview, kept on the analysis row and reused by the render */
export type PolishRef = { words: string[]; keywords: PolishKeyword[]; zooms: PolishZoom[] };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The key a clip's preview data is stored under (start / end as the render route rounds them). */
export const clipKey = (start: number, end: number) => `${(Math.round(start * 100) / 100).toFixed(2)}-${(Math.round(end * 100) / 100).toFixed(2)}`;

/** FNV-1a over the clip's identity: the seed of its "random" picks (caption look, hook style, font, the look). */
export function clipSeed(jobId: string, start: number, end: number): number {
  const s = `${jobId}|${clipKey(start, end)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const pickBy = <T>(seed: number, salt: number, xs: readonly T[]): T => xs[(Math.imul((seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0, 0x85ebca6b) >>> 0) % xs.length];

const AUTO_LOOKS = ["hormozi", "karaoke", "beast", "popline", "fill", "sweep"] as const;
const HOOK_STYLES = ["headline", "slam", "blocks"] as const;
const FONTS = ["montserrat", "archivo", "anton"] as const;

/** "AI pilih": the clip's caption look, hook style and font — the same in the preview and the render. */
export function clipPicks(seed: number, captionLook?: string | null) {
  return {
    caption_look: captionLook && captionLook !== "tiktok" ? captionLook : pickBy(seed, 1, AUTO_LOOKS),
    hook_style: pickBy(seed, 2, HOOK_STYLES),
    font: pickBy(seed, 3, FONTS),
  };
}

/** The clip's cold open as the render route accepts it (source seconds), or null. */
export function clipFlash(c: { start: number; end: number; flash?: { start: number; end: number } | null }, coldOpen: boolean) {
  const fs0 = Number(c.flash?.start), fe0 = Number(c.flash?.end);
  return coldOpen && Number.isFinite(fs0) && Number.isFinite(fe0) && fs0 >= c.start + 2 && fe0 <= c.end + 0.5 && fe0 - fs0 >= 0.8
    ? { start: Math.round(fs0 * 100) / 100, end: Math.round(Math.min(fe0, fs0 + 3.2) * 100) / 100 } : null;
}

/** The clip's words (clip seconds) from the analysis transcript: each line's own word timings when it has them,
 *  else the line's time shared out by word length. */
export function previewWords(lines: TLine[], start: number, end: number): { words: PWord[]; aligned: boolean } {
  const out: PWord[] = [];
  let aligned = true;
  for (const ln of lines) {
    if (!(ln && ln.end > start && ln.start < end)) continue;
    const toks = String(ln.text || "").split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    let tm: [number, number][];
    if (Array.isArray(ln.wt) && ln.wt.length === toks.length) {
      tm = ln.wt.map((x) => [Number(x[0]) || 0, Number(x[1]) || 0]);
    } else {
      aligned = false;
      const span = Math.max(0.2, ln.end - ln.start);
      const wts = toks.map((t) => Math.max(2, t.length) + 1);
      const sum = wts.reduce((a, b) => a + b, 0);
      let acc = 0;
      tm = wts.map((x) => {
        const a = ln.start + (acc / sum) * span;
        acc += x;
        return [a, ln.start + (acc / sum) * span - 0.02];
      });
    }
    toks.forEach((w, k) => {
      const [t, e] = tm[k];
      if (t < start - 0.05 || t >= end) return;
      out.push({ w, t: r3(Math.max(0, t - start)), e: r3(Math.max(t + 0.05, Math.min(end, e)) - start) });
    });
  }
  return { words: out, aligned };
}

// ── the clip's timeline: cold open + shortened pauses (modal_motion.py _cold_open / _clip_segments) ──
type SW = PWord & { si: number; teaser?: boolean };
const FILLER = /^(e+r+m*|e+m+|a{2,}h*|a+h+|u+h+|u+m+|h+m+|m{2,}|e+h+|uh|um)$/;
const wnorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const isFiller = (w: string) => {
  const n = wnorm(w);
  return !!n && FILLER.test(n) && n !== "eh" && n !== "ehh";
};

function coldOpen(words: SW[], dur: number, fs: number, fe: number) {
  const sents: SW[][] = [];
  let cur: SW[] = [];
  for (const w of words) {
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) {
      sents.push(cur);
      cur = [];
    }
  }
  if (cur.length) sents.push(cur);
  const ov = (s: SW[]) => Math.min(s[s.length - 1].e, fe) - Math.max(s[0].t, fs);
  const best = sents.length ? sents.reduce((a, b) => (ov(b) > ov(a) ? b : a)) : [];
  const inside = best.length && ov(best) > 0.3 && sents.length > 1
    ? best.filter((w) => w.t >= best[best.length - 1].e - 4.0)
    : words.filter((w) => w.t >= fs - 0.2 && w.e <= fe + 0.35);
  if (inside.length < 2 || !dur) return null;
  const a = Math.max(0, inside[0].t - 0.08), b = Math.min(dur, inside[inside.length - 1].e + 0.15);
  return b - a >= 0.8 && b - a <= 4.5 ? { fs: a, fe: b, inside } : null;
}

export type Timeline = {
  /** what plays: clip seconds [a, b) at timeline second `at` */
  segs: { a: number; b: number; at: number; teaser?: boolean }[];
  /** the caption words on the timeline; si = the word's index in the clip's words */
  words: (PWord & { si: number; teaser?: boolean })[];
  dur: number;
  /** timeline seconds where one kept piece joins the next (the composition's jump-cut beat) */
  cuts: number[];
  /** timeline second of the white flash after the cold open (null: none) */
  flashAt: number | null;
};

export function previewTimeline(words: PWord[], clipDur: number, o: { flash?: { start: number; end: number } | null; jumpcut: boolean; aligned: boolean }): Timeline {
  const src: SW[] = words.map((w, si) => ({ ...w, si }));
  let teaser = 0, fs = 0;
  let vw: SW[] = src;
  if (o.flash && src.length) {
    const got = coldOpen(src, clipDur, o.flash.start, o.flash.end);
    if (got) {
      teaser = got.fe - got.fs;
      fs = got.fs;
      vw = [
        ...got.inside.map((w) => ({ ...w, t: r3(w.t - got.fs), e: r3(w.e - got.fs), teaser: true })),
        ...src.map((w) => ({ ...w, t: r3(w.t + teaser), e: r3(w.e + teaser) })),
      ];
    }
  }
  const vdur = teaser + clipDur;
  let vsegs: [number, number][] = [[0, vdur]];
  let tw: SW[] = vw;
  if (o.jumpcut && vw.length) {
    const gap = o.aligned ? 0.45 : 0.6;
    const kept = vw.filter((w) => !isFiller(w.w));
    const segs: [number, number][] = [];
    for (const w of kept) {
      const s = Math.max(0, w.t - 0.12), e = Math.min(vdur, w.e + 0.18);
      if (e <= s) continue;
      if (segs.length && s - segs[segs.length - 1][1] <= gap) segs[segs.length - 1][1] = Math.max(segs[segs.length - 1][1], e);
      else segs.push([s, e]);
    }
    if (segs.length && segs[0][0] < 0.4) segs[0][0] = 0;
    if (segs.length && vdur - segs[segs.length - 1][1] < 0.4) segs[segs.length - 1][1] = vdur;
    if (segs.length && vdur - segs.reduce((a, [s, e]) => a + e - s, 0) > 0.8) {
      vsegs = segs;
      const starts: number[] = [];
      let acc = 0;
      for (const [s, e] of segs) {
        starts.push(acc);
        acc += e - s;
      }
      tw = [];
      for (const w of kept) {
        const k = segs.findIndex(([s, e]) => s - 1e-3 <= w.t && w.t <= e + 1e-3);
        if (k < 0) continue;
        const nt = starts[k] + (w.t - segs[k][0]);
        tw.push({ ...w, t: r3(nt), e: r3(Math.max(starts[k] + (Math.min(w.e, segs[k][1]) - segs[k][0]), nt + 0.05)) });
      }
    }
  }
  // pieces of the virtual timeline (teaser + clip) → the clip's own seconds; a piece across the teaser's end splits
  const toSrc = (v: number) => (v < teaser ? fs + v : v - teaser);
  const segs: Timeline["segs"] = [];
  const cuts: number[] = [];
  let at = 0, flashAt: number | null = null;
  vsegs.forEach(([s, e], i) => {
    if (i > 0) cuts.push(r3(at));
    const parts: [number, number][] = s < teaser && e > teaser ? [[s, teaser], [teaser, e]] : [[s, e]];
    for (const [ps, pe] of parts) {
      if (pe - ps < 0.02) continue;
      if (teaser && flashAt === null && ps >= teaser - 1e-6) flashAt = r3(at);
      segs.push({ a: r3(toSrc(ps)), b: r3(toSrc(ps) + (pe - ps)), at: r3(at), ...(ps < teaser ? { teaser: true } : {}) });
      at += pe - ps;
    }
  });
  return { segs, words: tw, dur: r3(at), cuts, flashAt };
}

/** The polish (made on the clip's words) on the timeline's words: the clip body only, not the teaser copy. */
export function polishOnTimeline(tl: Timeline, keywords: PolishKeyword[], zooms: PolishZoom[]) {
  const at = new Map<number, number>();
  tl.words.forEach((w, k) => { if (!w.teaser && !at.has(w.si)) at.set(w.si, k); });
  const near = (si: number) => {
    for (let d = 0; d < 6; d++) {
      if (at.has(si + d)) return at.get(si + d)!;
      if (at.has(si - d)) return at.get(si - d)!;
    }
    return -1;
  };
  const kw = keywords.map((k) => (at.has(k.i) ? { ...k, i: at.get(k.i)! } : null)).filter(Boolean) as PolishKeyword[];
  const zm = zooms.map((z) => {
    const a = near(Number(/^w(\d+)/.exec(z.at)?.[1] ?? -1));
    if (a < 0 || tl.words[a].t < 2) return null;
    const b = z.to ? near(Number(/^w(\d+)/.exec(z.to)?.[1] ?? -1)) : -1;
    return { at: `w${a}`, ...(b > a ? { to: `w${b}$` } : {}), scale: z.scale };
  }).filter(Boolean) as PolishZoom[];
  return { keywords: kw, zooms: zm };
}

/** Word-by-word alignment (longest common subsequence on letters / digits): index in a → index in b, or -1. */
export function alignWords(a: string[], b: string[]): number[] {
  const na = a.slice(0, 1500).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  const nb = b.slice(0, 1500).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  const n = na.length, m = nb.length;
  const dp = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * (m + 1) + j] = na[i] && na[i] === nb[j]
        ? dp[(i + 1) * (m + 1) + j + 1] + 1
        : Math.max(dp[(i + 1) * (m + 1) + j], dp[i * (m + 1) + j + 1]);
    }
  }
  const map = new Array<number>(a.length).fill(-1);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (na[i] && na[i] === nb[j]) {
      map[i] = j;
      i++;
      j++;
    } else if (dp[(i + 1) * (m + 1) + j] >= dp[i * (m + 1) + j + 1]) i++;
    else j++;
  }
  return map;
}

/** The render's words got their polish from the preview: keywords / zooms moved onto the render's own words
 *  (re-transcribed, with the cold open in front and pauses cut). null: too few words match — polish afresh. */
export function reusePolish(ref: PolishRef, words: { w: string; t: number }[]) {
  if (!ref?.words?.length || !words.length) return null;
  const map = alignWords(ref.words, words.map((w) => w.w));
  if (map.filter((x) => x >= 0).length / ref.words.length < 0.5) return null;
  const near = (i: number) => {
    for (let d = 0; d < 6; d++) {
      if (map[i + d] >= 0) return map[i + d];
      if (map[i - d] >= 0) return map[i - d];
    }
    return -1;
  };
  const keywords = (ref.keywords || []).map((k) => (map[k.i] >= 0 ? { ...k, i: map[k.i] } : null)).filter(Boolean) as PolishKeyword[];
  const zooms = (ref.zooms || []).map((z) => {
    const a = near(Number(/^w(\d+)/.exec(z.at)?.[1] ?? -1));
    if (a < 0 || words[a].t < 2) return null;
    const b = z.to ? near(Number(/^w(\d+)/.exec(z.to)?.[1] ?? -1)) : -1;
    return { at: `w${a}`, ...(b > a ? { to: `w${b}$` } : {}), scale: z.scale };
  }).filter(Boolean) as PolishZoom[];
  return { keywords, zooms };
}

/** The source's faces over one clip (Modal clip_faces: largest face 4× a second, source-normalised, clip seconds). */
export type SrcFaces = { w: number; h: number; faces: { t: number; x: number; y: number; w: number; h: number }[] };
const OUT = 9 / 16;

/** The faces on the preview's 9:16 frame and timeline — what the render's face track sees on the framed clip:
 *  "face" centres the speaker (the camera follows them), "center" crops the middle, "fit" shows the whole frame. */
export function previewFaces(src: SrcFaces | null | undefined, tl: Timeline, frame: string) {
  if (!src?.faces?.length || !src.w || !src.h || frame === "split") return [];
  const A = src.w / src.h;
  const map = (f: SrcFaces["faces"][number]) => {
    if (frame === "fit") {
      if (A >= OUT) {
        const hh = OUT / A; // the whole frame's height on the 9:16 canvas
        return { x: f.x, w: f.w, y: (1 - hh) / 2 + f.y * hh, h: f.h * hh };
      }
      const ww = A / OUT;
      return { x: (1 - ww) / 2 + f.x * ww, w: f.w * ww, y: f.y, h: f.h };
    }
    if (A > OUT) {
      const fr = OUT / A; // the part of the width a 9:16 crop keeps
      const w = Math.min(1, f.w / fr);
      return frame === "face" ? { x: 0.5 - w / 2, w, y: f.y, h: f.h } : { x: (f.x - (1 - fr) / 2) / fr, w, y: f.y, h: f.h };
    }
    const fr = A / OUT; // a source taller than 9:16 loses a little top and bottom
    return { x: f.x, w: f.w, y: (f.y - (1 - fr) / 2) / fr, h: Math.min(1, f.h / fr) };
  };
  const out: { t: number; x: number; y: number; w: number; h: number }[] = [];
  for (const s of tl.segs) {
    for (const f of src.faces) {
      if (f.t < s.a - 0.01 || f.t >= s.b) continue;
      const m = map(f);
      out.push({ t: r3(s.at + f.t - s.a), x: r3(Math.max(0, m.x)), y: r3(Math.max(0, m.y)), w: r3(m.w), h: r3(m.h) });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** "face" on a wide source: where the camera centres over time (face centre x, clip seconds) — null: no follow. */
export function faceTrack(src: SrcFaces | null | undefined, frame: string) {
  if (frame !== "face" || !src?.faces?.length || !src.w || !src.h || src.w / src.h <= OUT + 0.01) return null;
  return src.faces.map((f) => ({ t: f.t, cx: r3(f.x + f.w / 2) }));
}

/** Google Noto animated emoji (as the render fetches them) for the keywords' emoji: char → Lottie URL. */
export function emojiLottie(keywords: PolishKeyword[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keywords) {
    if (!k.emoji || out[k.emoji]) continue;
    const cp = Array.from(k.emoji).map((c) => c.codePointAt(0)!).filter((c) => c !== 0xfe0f).map((c) => c.toString(16)).join("_");
    out[k.emoji] = `https://fonts.gstatic.com/s/e/notoemoji/latest/${cp}/lottie.json`;
  }
  return out;
}

/** The composition's props — what modal_motion.py _edit_finish gives MotionEditPro for a "Klip + caption" clip. */
export function previewProps(o: {
  video: string; tl: Timeline; seed: number; hook?: string | null; captions: boolean; captionLook?: string | null;
  captionPos: "low" | "mid"; polish: boolean; keywords: PolishKeyword[]; zooms: PolishZoom[];
  faces?: { t: number; x: number; y: number; w: number; h: number }[];
}) {
  const picks = clipPicks(o.seed, o.captionLook);
  const words = o.tl.words.map((w) => ({ w: w.w, t: w.t, e: w.e }));
  return {
    fps: 30, durationInFrames: Math.max(1, Math.floor(o.tl.dur * 30)), video: o.video, words,
    captions: { on: o.captions, style: o.captionLook === "tiktok" ? "tiktok" : "pop", pos: o.captionPos, maxWords: 3 },
    accent: "#FFD93B", overlays: [], zooms: o.polish ? o.zooms : [], hook: o.hook ? { text: o.hook } : null,
    sfx: false, style: "gempak", faces: o.faces ?? [], broll: [], facts: [], keywords: o.polish ? o.keywords : [],
    lottie: o.polish ? emojiLottie(o.keywords) : {}, progress: true, cuts: o.tl.cuts,
    direction: { ...picks, end_card: "none", progress: o.polish && o.tl.dur > 35 ? "bar" : "none", fx: "light", captions: "big", camera: "calm" },
    lookSeed: o.seed,
  };
}
