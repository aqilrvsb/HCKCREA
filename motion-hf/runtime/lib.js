// Laju v2 (HyperFrames) — shared math, colour, cue and layout helpers.
// A faithful port of motion/src/lib.ts plus the parts of Remotion the Laju
// compositions rely on (spring, interpolate, Easing), so every frame comes out
// with the same numbers as the Remotion renderer. Pure functions: used by the
// Node build step (planning) and by the browser runtime (drawing).

export const W = 1080;
export const H = 1920;
export const SAFE_X = 70;
export const EXIT = 6; // frames an element takes to fade out

export const FONT = {
  marker: "'Permanent Marker', cursive",
  hand: "'Patrick Hand', cursive",
  black: "'Archivo Black', sans-serif",
  inter: "'Inter', sans-serif",
  caption: "'Montserrat', sans-serif",
};

export const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// ── Remotion spring (remotion/src/spring/spring-utils.ts) ─────────────────────
function advance(anim, now, c, m, k) {
  const deltaTime = Math.min(now - anim.lastTimestamp, 64);
  const v0 = -anim.velocity;
  const x0 = anim.toValue - anim.current;
  const zeta = c / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  const omega1 = omega0 * Math.sqrt(1 - zeta ** 2);
  const t = deltaTime / 1000;
  const sin1 = Math.sin(omega1 * t);
  const cos1 = Math.cos(omega1 * t);
  const underEnv = Math.exp(-zeta * omega0 * t);
  const underFrag = underEnv * (sin1 * ((v0 + zeta * omega0 * x0) / omega1) + x0 * cos1);
  const underPos = anim.toValue - underFrag;
  const underVel = zeta * omega0 * underFrag - underEnv * (cos1 * (v0 + zeta * omega0 * x0) - omega1 * x0 * sin1);
  const critEnv = Math.exp(-omega0 * t);
  const critPos = anim.toValue - critEnv * (x0 + (v0 + omega0 * x0) * t);
  const critVel = critEnv * (v0 * (t * omega0 - 1) + t * x0 * omega0 * omega0);
  return {
    toValue: anim.toValue,
    lastTimestamp: now,
    current: zeta < 1 ? underPos : critPos,
    velocity: zeta < 1 ? underVel : critVel,
  };
}

const springCache = new Map();
/** Remotion `spring({frame, fps, config})` from 0 to 1 (same physics, same numbers). */
export function spring(frame, fps, { damping = 10, mass = 1, stiffness = 100 } = {}) {
  const key = `${frame}|${fps}|${damping}|${mass}|${stiffness}`;
  const hit = springCache.get(key);
  if (hit !== undefined) return hit;
  let anim = { lastTimestamp: 0, current: 0, toValue: 1, velocity: 0 };
  const fc = Math.max(0, frame);
  const rest = fc % 1;
  for (let f = 0; f <= Math.floor(fc); f++) anim = advance(anim, (f / fps) * 1000, damping, mass, stiffness);
  if (rest > 0) anim = advance(anim, (fc / fps) * 1000, damping, mass, stiffness);
  springCache.set(key, anim.current);
  return anim.current;
}

export const popS = (f, fps, stiff = 180, damp = 12) => spring(f, fps, { damping: damp, stiffness: stiff, mass: 0.7 });

// ── Remotion Easing (react-native Easing) ─────────────────────────────────────
const clampUnit = (t) => Math.min(1, Math.max(0, t));
function bezier(x1, y1, x2, y2) {
  // Remotion/bezier-easing: Newton-Raphson + subdivision
  const A = (a1, a2) => 1 - 3 * a2 + 3 * a1;
  const B = (a1, a2) => 3 * a2 - 6 * a1;
  const C = (a1) => 3 * a1;
  const calc = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const slope = (t, a1, a2) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
  const tForX = (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2);
      if (s === 0) break;
      t -= (calc(t, x1, x2) - x) / s;
    }
    if (t < 0 || t > 1 || Math.abs(calc(t, x1, x2) - x) > 1e-6) {
      let a = 0, b = 1;
      t = x;
      for (let i = 0; i < 30; i++) {
        const cx = calc(t, x1, x2) - x;
        if (Math.abs(cx) < 1e-7) break;
        if (cx > 0) b = t; else a = t;
        t = (a + b) / 2;
      }
    }
    return t;
  };
  return (x) => (x === 0 || x === 1 ? x : calc(tForX(x), y1, y2));
}
export const Easing = {
  linear: (t) => t,
  ease: (t) => bezier(0.42, 0, 1, 1)(t),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  poly: (n) => (t) => t ** n,
  sin: (t) => 1 - Math.cos((t * Math.PI) / 2),
  circle: (t) => { const u = clampUnit(t); return 1 - Math.sqrt(1 - u * u); },
  exp: (t) => 2 ** (10 * (t - 1)),
  elastic: (b = 1) => { const p = b * Math.PI; return (t) => 1 - Math.cos((t * Math.PI) / 2) ** 3 * Math.cos(t * p); },
  back: (s = 1.70158) => (t) => t * t * ((s + 1) * t - s),
  bounce: (t) => {
    const u = clampUnit(t);
    if (u < 1 / 2.75) return 7.5625 * u * u;
    if (u < 2 / 2.75) { const x = u - 1.5 / 2.75; return 7.5625 * x * x + 0.75; }
    if (u < 2.5 / 2.75) { const x = u - 2.25 / 2.75; return 7.5625 * x * x + 0.9375; }
    const x = u - 2.625 / 2.75; return 7.5625 * x * x + 0.984375;
  },
  bezier,
  in: (e) => e,
  out: (e) => (t) => 1 - e(1 - t),
  inOut: (e) => (t) => (t < 0.5 ? e(t * 2) / 2 : 1 - e((1 - t) * 2) / 2),
};

/** Remotion `interpolate(x, input, output, {extrapolateLeft/Right, easing})` — like Remotion, both ends
 *  EXTEND unless `left` / `right` say "clamp". */
export function interpolate(x, input, output, opts = {}) {
  const { easing = (t) => t, left = "extend", right = "extend" } = opts;
  let i = 1;
  while (i < input.length - 1 && x > input[i]) i++;
  const i0 = input[i - 1], i1 = input[i], o0 = output[i - 1], o1 = output[i];
  let v = x;
  if (v < i0) { if (left === "clamp") v = i0; }
  if (v > i1) { if (right === "clamp") v = i1; }
  if (i0 === i1) return o0;
  let t = (v - i0) / (i1 - i0);
  t = easing(t);
  return o0 + t * (o1 - o0);
}
// shorthand for Remotion's `interpolate(..., {...clamp, easing})`: clamp both ends
export const ip = (x, input, output, easing) =>
  interpolate(x, input, output, { left: "clamp", right: "clamp", ...(easing ? { easing } : {}) });

// ── text fit ──────────────────────────────────────────────────────────────────
/** Largest font size (≤ base) at which `text` fits `maxLines` lines of `width` px (char-count estimate). */
export const fitSize = (text, base, width, maxLines, charW = 0.6, min = 22) => {
  const t = String(text || "").trim();
  const n = Math.max(1, t.length);
  const longest = Math.max(1, ...t.split(/\s+/).map((w) => w.length));
  const byLines = (width * maxLines) / (n * charW * 1.12);
  const byWord = width / (longest * charW * 1.04);
  return Math.max(min, Math.floor(Math.min(base, byLines, byWord)));
};

// ── colour ────────────────────────────────────────────────────────────────────
const hexRgb = (hex) => {
  let h = String(hex || "").replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) return [255, 217, 59];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
export const lum = (hex) => {
  const [r, g, b] = hexRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const inkOn = (bg) => (lum(bg) > 0.45 ? "#111111" : "#ffffff");
export const shade = (hex, k) => {
  const [r, g, b] = hexRgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${r},${g},${b})`;
};
export const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };
export const safeAccent = (hex) =>
  /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex || "") ? (String(hex).startsWith("#") ? hex : `#${hex}`) : "#FFD93B";
export const highlight = (accent) => (lum(accent) < 0.18 ? "#FFD93B" : accent);

export const TONE = (tone, accent, fallback) => {
  switch (tone ?? fallback) {
    case "yellow": return { bg: "#FFD93B", fg: "#111111" };
    case "white": return { bg: "#F7F4EC", fg: "#111111" };
    case "red": return { bg: "#E11D48", fg: "#ffffff" };
    case "green": return { bg: "#16A34A", fg: "#ffffff" };
    case "dark": return { bg: "#111111", fg: "#ffffff" };
    case "accent": return { bg: accent, fg: inkOn(accent) };
    default: return { bg: "#FFD93B", fg: "#111111" };
  }
};

// ── cues ──────────────────────────────────────────────────────────────────────
const NUM = /^[+-]?\d*\.?\d+$/;

/** Buat Iklan cue → seconds ("l3", "l3@harga", "l3@harga#2", "l3$", "+0.3" offsets, or seconds). */
export const makeAdCue = (lines) => (c, fallback) => {
  if (c === undefined || c === null || c === "") return fallback;
  if (typeof c === "number") return Number.isFinite(c) ? c : fallback;
  const s = String(c).trim();
  if (NUM.test(s)) return parseFloat(s);
  const m = s.match(/^([a-z0-9_]+)(?:@([^#$+-]+?)(?:#(\d+))?)?(\$)?([+-]\d*\.?\d+)?$/i);
  if (!m) return fallback;
  const l = lines.find((x) => x.id === m[1]);
  if (!l) return fallback;
  let t;
  if (m[4]) t = l.sceneEnd;
  else if (m[2]) {
    const want = norm(m[2]);
    const hits = l.words.filter((w) => { const n = norm(w.w); return n.startsWith(want) || (want.length > 3 && n.includes(want)); });
    const w = hits[(Number(m[3]) || 1) - 1] || hits[0];
    t = l.audioStart + (w ? w.t : 0);
  } else t = l.sceneStart;
  return t + (m[5] ? parseFloat(m[5]) : 0);
};

/** Edit Video cue → seconds ("w12" word start, "w12$" word end, "w12+0.2", or seconds). */
export const makeEditCue = (words) => (c, fallback) => {
  if (c === undefined || c === null || c === "") return fallback;
  if (typeof c === "number") return Number.isFinite(c) ? c : fallback;
  const s = String(c).trim();
  if (NUM.test(s)) return parseFloat(s);
  const m = s.match(/^w(\d+)(\$)?([+-]\d*\.?\d+)?$/i);
  if (!m) return fallback;
  const w = words[Math.min(words.length - 1, Number(m[1]))];
  if (!w) return fallback;
  const base = m[2] ? (w.e ?? w.t + 0.3) : w.t;
  return base + (m[3] ? parseFloat(m[3]) : 0);
};

// ── zone layout (Buat Iklan) ──────────────────────────────────────────────────
export const packRows = (placed) => {
  const out = { top: [], middle: [], bottom: [] };
  for (const p of [...placed].sort((a, b) => a.s - b.s)) {
    const z = p.it.zone && out[p.it.zone] ? p.it.zone : "middle";
    const rows = out[z];
    const row = rows.find((r) => r[r.length - 1].e <= p.s);
    if (row) row.push(p); else rows.push([p]);
  }
  return out;
};

export const tilt = (i, amp = 2.2) => [-1, 0.7, -0.4, 1, -0.8, 0.5][i % 6] * amp;

// ── deterministic noise (for idle drift) ──────────────────────────────────────
// Remotion's noise2D is seeded simplex noise; a seeded value-noise with smooth
// interpolation gives the same kind of slow, repeatable wobble.
const hash2 = (seed, x, y) => {
  let h = 2166136261 ^ seed;
  h = Math.imul(h ^ (x | 0), 16777619);
  h = Math.imul(h ^ (y | 0), 16777619);
  h ^= h >>> 13; h = Math.imul(h, 1274126177); h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
};
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export const seedOf = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export function noise2D(seed, x, y) {
  const sd = typeof seed === "number" ? seed : seedOf(seed);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = fade(x - x0), ty = fade(y - y0);
  const a = hash2(sd, x0, y0), b = hash2(sd, x0 + 1, y0), c = hash2(sd, x0, y0 + 1), d = hash2(sd, x0 + 1, y0 + 1);
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

// deterministic pseudo-random in [0,1) for effect particles (effects.tsx rnd)
export const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
