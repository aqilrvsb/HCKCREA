// Laju v2 "Pro" scene kit — the extra craft the director can reach for inside explainer
// scenes (overrides/scenesPro.tsx). Everything is a pure function of the frame:
//   hand-drawn marks   circle / underline / arrow / box drawn on with a stroke sweep
//                      (seeded wobble, two passes like a marker — rough.js-style, no dependency)
//   text entrances     type (typewriter + caret) · scramble (glyphs settle into the word) ·
//                      letters (per-letter pop cascade) · rise (wipes up out of a mask)
//   sparkles           seeded 4-point stars that pop around a punchline
//   checklist          rows whose box ticks (✓) or crosses (✗) on the spoken word
//   steps              numbered circles joined by a line that draws to the next step
//   rings              percentage rings that fill while the number counts up
//   phone              a phone-screen card for an app / page / screenshot picture
//   backgrounds        notebook · chalk · grid · gradient · burst (a rotating sunburst)
//   chart              a line / area / bar chart that draws on its spoken points, the value riding the tip
//   number roll        odometer digits that spin into place · outline-to-fill · 3D extrude · shine sweep
//   rain               an emoji rain over a scene (closed-form fall, seeded) · torn-paper scene entrance
// Ideas from the HyperFrames registry (chart-story, decline-chart, hw-* boil, torn-paper-rip, Apache-2.0) and
// Remocn (rolling-number, outline-fill-track-text, extrude-pop, MIT) — re-written here as pure frame math.
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate } from 'remotion';
import { W, clamp, fitSize } from '../../motion/src/lib';
import type { Look } from './look';
import { LottieEmoji } from './emoji';
import type { LottieMap } from '../../motion/src/types';

// ── measuring and seeds ──────────────────────────────────────────────────────

let ctx: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();
/** Rendered width (px) of `text` in a face — measured with the page's own fonts, an estimate without a canvas. */
export const textWidth = (text: string, face: Look['display'], size: number): number => {
  const key = `${face.family}|${face.weight}|${size}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  if (ctx === undefined) {
    try { ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; } catch { ctx = null; }
  }
  let w = text.length * size * face.charW;
  if (ctx) {
    const font = `${face.weight} ${size}px ${face.family}`;
    ctx.font = font;
    w = ctx.measureText(text).width + Math.max(0, text.length - 1) * (face.track || 0);
    // a face that has not loaded yet measures in the fallback font: keep the estimate's worth of room and don't cache it
    let ready = true;
    try { ready = typeof document === 'undefined' || !document.fonts || document.fonts.check(font, text); } catch { ready = true; }
    if (!ready) {
      try { void document.fonts.load(font, text); } catch { /* ignore */ }
      return Math.max(w, text.length * size * face.charW);
    }
  }
  widths.set(key, w);
  return w;
};

/** mulberry32 — the same stream on every render chunk. */
export const rng = (seed: number) => {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const seedOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ── hand-drawn strokes ───────────────────────────────────────────────────────

type Pt = [number, number];
/** A smooth path through points (quadratic midpoints) and its length (polyline). */
export const pathOf = (pts: Pt[]) => {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    len += Math.hypot(x1 - x0, y1 - y0);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    d += i === 1 ? ` L${mx.toFixed(1)} ${my.toFixed(1)}` : ` Q${x0.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  return { d, len: Math.max(1, len) };
};

/** A marker loop around a w×h box: a little over one turn, wobbling, starting top-left. */
export const roughEllipse = (w: number, h: number, seed: number, boil = 0) => {
  const r = rng(seed);
  const jb = boil ? rng(boil) : null;
  const start = -Math.PI * (0.62 + r() * 0.16);
  const turn = (1.1 + r() * 0.12) * Math.PI * 2;
  const ph = r() * 6;
  const pts: Pt[] = [];
  for (let i = 0; i <= 56; i++) {
    const u = i / 56;
    const t = start + u * turn;
    const wob = 1 + 0.035 * Math.sin(3 * t + ph) + (r() - 0.5) * 0.02 + 0.05 * u;
    const jx = jb ? (jb() - 0.5) * 3 : 0;
    const jy = jb ? (jb() - 0.5) * 3 : 0;
    pts.push([w / 2 + Math.cos(t) * (w / 2) * wob + jx, h / 2 + Math.sin(t) * (h / 2) * wob + jy]);
  }
  return pathOf(pts);
};

/** A hand underline from x0 to x1 at y: a slight wave, then a shorter second pass. */
export const roughUnderline = (x0: number, x1: number, y: number, seed: number) => {
  const r = rng(seed);
  const pts: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    pts.push([x0 + (x1 - x0) * u, y + Math.sin(u * Math.PI * 1.6 + r()) * 5 + (r() - 0.5) * 3 - u * 6]);
  }
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    pts.push([x1 - (x1 - x0) * 0.85 * u, y + 12 + Math.sin(u * Math.PI * 1.3 + r()) * 4 + (r() - 0.5) * 3]);
  }
  return pathOf(pts);
};

/** A curved arrow from (x0, y0) to (x1, y1) with a two-stroke head. */
export const roughArrow = (x0: number, y0: number, x1: number, y1: number, seed: number) => {
  const r = rng(seed);
  const cx = (x0 + x1) / 2 - (y1 - y0) * 0.35;
  const cy = (y0 + y1) / 2 + (x1 - x0) * 0.2;
  const pts: Pt[] = [];
  for (let i = 0; i <= 20; i++) {
    const u = i / 20;
    const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * cx + u * u * x1 + (r() - 0.5) * 2;
    const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * cy + u * u * y1 + (r() - 0.5) * 2;
    pts.push([x, y]);
  }
  const shaft = pathOf(pts);
  const [ax, ay] = pts[pts.length - 3];
  const ang = Math.atan2(y1 - ay, x1 - ax);
  const head = 34;
  const h1: Pt = [x1 - Math.cos(ang - 0.5) * head, y1 - Math.sin(ang - 0.5) * head];
  const h2: Pt = [x1 - Math.cos(ang + 0.5) * head, y1 - Math.sin(ang + 0.5) * head];
  return { shaft, head: pathOf([h1, [x1, y1], h2]) };
};

/** A path drawn on from 0 → 1. */
export const Stroke: React.FC<{ d: string; len: number; p: number; color: string; width: number; opacity?: number }> = ({ d, len, p, color, width, opacity = 1 }) =>
  p <= 0 ? null : (
    <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" opacity={opacity}
      strokeDasharray={len.toFixed(1)} strokeDashoffset={(len * (1 - Math.min(1, p))).toFixed(1)} />
  );

export type Mark = 'circle' | 'underline' | 'arrow' | 'box';

/** A hand-drawn mark around a text block of w×h (px), drawn on `d` frames after the line lands. */
export const HandMark: React.FC<{ mark: Mark; w: number; h: number; d: number; color: string; seed: number }> = ({ mark, w, h, d, color, seed }) => {
  const p = interpolate(d, [5, 15], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  if (p <= 0) return null;
  const pad = h * 0.45;
  const sw = Math.max(7, h * 0.07);
  const box = { left: -pad, top: -pad, width: w + pad * 2, height: h + pad * 2 };
  let paths: React.ReactNode;
  // once drawn, the ink "boils": a seeded jitter that changes every 3 frames (hand-drawn animation feel)
  const boil = p >= 1 ? seed + Math.floor(d / 3) * 977 : 0;
  if (mark === 'circle') {
    const e = roughEllipse(w + pad * 1.6, h + pad * 0.55, seed, boil);
    paths = <g transform={`translate(${pad * 0.2} ${pad * 0.72})`}><Stroke d={e.d} len={e.len} p={p} color={color} width={sw} /></g>;
  } else if (mark === 'underline') {
    const u = roughUnderline(pad - h * 0.05, pad + w + h * 0.05, pad + h * 1.02, seed);
    paths = <Stroke d={u.d} len={u.len} p={p} color={color} width={sw} />;
  } else if (mark === 'box') {
    const r = rng(seed);
    const j = () => (r() - 0.5) * 8;
    const x0 = pad * 0.35;
    const y0 = pad * 0.5;
    const x1 = pad * 1.65 + w;
    const y1 = pad * 1.5 + h;
    const b = pathOf([[x0 + j(), y0 + j()], [x1 + j(), y0 + j()], [x1 + j(), y1 + j()], [x0 + j(), y1 + j()], [x0 + j() + 10, y0 + j() - 4]]);
    paths = <Stroke d={b.d} len={b.len} p={p} color={color} width={sw} />;
  } else {
    // arrow from below-left pointing at the start of the text
    const a = roughArrow(pad - h * 0.55, pad + h * 2.4, pad - h * 0.12, pad + h * 0.75, seed);
    const pa = interpolate(d, [5, 13], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
    const ph = interpolate(d, [13, 17], [0, 1], clamp);
    paths = <><Stroke d={a.shaft.d} len={a.shaft.len} p={pa} color={color} width={sw} /><Stroke d={a.head.d} len={a.head.len} p={ph} color={color} width={sw} /></>;
  }
  return (
    <svg width={box.width} height={box.height + (mark === 'arrow' ? h * 1.6 : 0)} style={{ position: 'absolute', left: mark === 'arrow' ? -pad - h * 0.9 : box.left, top: box.top, overflow: 'visible', pointerEvents: 'none' }}>
      {paths}
    </svg>
  );
};

// ── text entrances ───────────────────────────────────────────────────────────

export type TextEnter = 'type' | 'scramble' | 'letters' | 'rise' | 'outline';
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&?';

/** The line's text as it enters: the full text keeps its width (hidden letters are transparent), so nothing jumps. */
export const EnterText: React.FC<{ text: string; kind: TextEnter; d: number; seed: number; style: React.CSSProperties }> = ({ text, kind, d, seed, style }) => {
  const chars = Array.from(text);
  if (kind === 'type') {
    const shown = Math.max(0, Math.min(chars.length, Math.floor((d + 1) * 1.6)));
    const caret = d >= 0 && (shown < chars.length || (d < shown / 1.6 + 18 && Math.floor(d / 6) % 2 === 0));
    // the caret is a zero-width inline bar between the typed part and the (transparent) rest
    return (
      <span style={style}>
        <span>{chars.slice(0, shown).join('')}</span>
        <span style={{ display: 'inline-block', width: '0.07em', height: '0.82em', marginRight: '-0.07em', verticalAlign: '-0.04em',
          background: caret ? ((style.color as string) || '#fff') : 'transparent' }} />
        <span style={{ color: 'transparent', WebkitTextStroke: '0px' } as React.CSSProperties}>{chars.slice(shown).join('')}</span>
      </span>
    );
  }
  if (kind === 'scramble') {
    return (
      <span style={style}>
        {chars.map((ch, i) => {
          if (ch === ' ') return <React.Fragment key={i}> </React.Fragment>;
          const settle = 3 + i * 0.8;
          if (d >= settle) return <React.Fragment key={i}>{ch}</React.Fragment>;
          const r = rng(seed + i * 131 + Math.floor(Math.max(0, d) / 2) * 7)();
          return <span key={i} style={{ opacity: d < 0 ? 0 : 0.75 }}>{GLYPHS[Math.floor(r * GLYPHS.length)]}</span>;
        })}
      </span>
    );
  }
  if (kind === 'letters') {
    return (
      <span style={style}>
        {chars.map((ch, i) => {
          if (ch === ' ') return <React.Fragment key={i}> </React.Fragment>;
          const p = interpolate(d - i * 0.9, [0, 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.2)) });
          return <span key={i} style={{ display: 'inline-block', transform: `translateY(${((1 - p) * 0.5).toFixed(3)}em) scale(${p.toFixed(3)})`, opacity: p > 0 ? 1 : 0 }}>{ch}</span>;
        })}
      </span>
    );
  }
  if (kind === 'outline') {
    // the outline lands first, then the fill sweeps across it
    const p = interpolate(d, [4, 14], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    const col = (style.color as string) || '#fff';
    return (
      <span style={{ position: 'relative', display: 'inline-block' }}>
        <span style={{ ...style, color: 'transparent', WebkitTextStroke: `3px ${col}` } as React.CSSProperties}>{text}</span>
        <span style={{ ...style, position: 'absolute', left: 0, top: 0, clipPath: `inset(0 ${((1 - p) * 100).toFixed(1)}% 0 0)` }}>{text}</span>
      </span>
    );
  }
  // rise: the text slides up out of a mask
  const p = interpolate(d, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', paddingBottom: '0.06em' }}>
      <span style={{ ...style, display: 'inline-block', transform: `translateY(${((1 - p) * 110).toFixed(1)}%)` }}>{text}</span>
    </span>
  );
};

// ── sparkles ─────────────────────────────────────────────────────────────────

/** Seeded 4-point stars popping around a w×h block, `d` frames after it lands. */
export const Sparkles: React.FC<{ w: number; h: number; d: number; seed: number; color?: string }> = ({ w, h, d, seed, color = '#FFE45C' }) => {
  if (d < 2 || d > 30) return null;
  const r = rng(seed);
  const stars = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 + r() * 0.6;
    return { x: w / 2 + Math.cos(a) * (w / 2 + 30 + r() * 40), y: h / 2 + Math.sin(a) * (h / 2 + 24 + r() * 30), s: 18 + r() * 26, t0: 2 + r() * 8 };
  });
  return (
    <svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {stars.map((st, i) => {
        const k = interpolate(d - st.t0, [0, 5, 14], [0, 1, 0], clamp);
        if (k <= 0) return null;
        const s = st.s * k;
        return (
          <path key={i} transform={`translate(${st.x.toFixed(1)} ${st.y.toFixed(1)}) rotate(${(d * 6 + i * 40) % 360})`} fill={color}
            d={`M0 ${-s} Q${s * 0.12} ${-s * 0.12} ${s} 0 Q${s * 0.12} ${s * 0.12} 0 ${s} Q${-s * 0.12} ${s * 0.12} ${-s} 0 Q${-s * 0.12} ${-s * 0.12} 0 ${-s}Z`} />
        );
      })}
    </svg>
  );
};

// ── scene bodies ─────────────────────────────────────────────────────────────

const slideIn = (d: number): React.CSSProperties => {
  if (d < 0) return { opacity: 0 };
  const p = interpolate(d, [0, 4], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return { transform: `translateX(${((1 - p) * -380).toFixed(1)}px)`, filter: p < 0.98 ? `blur(${(10 * (1 - p)).toFixed(1)}px)` : undefined, opacity: Math.min(1, 0.4 + p) };
};

export type CheckItem = { f: number; text: string; mark: 'check' | 'cross'; tone?: string };
/** Checklist rows: the box lands with its text, then the tick / cross draws in. */
export const ChecklistBody: React.FC<{ items: CheckItem[]; frame: number; face: Look['display']; ink: string; dark: boolean; heading?: React.ReactNode; colorOf: (t?: string) => string }> =
  ({ items, frame, face, ink, dark, heading, colorOf }) => {
    const size = Math.min(...items.map((it) => fitSize((face.upper ? it.text.toUpperCase() : it.text), 84 * (face.charW < 0.5 ? 1.22 : 1), W - 330, 1, face.charW, 36)));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 30, padding: '0 90px', marginTop: -30 }}>
        {heading && <div style={{ alignSelf: 'center', marginBottom: 6 }}>{heading}</div>}
        {items.map((it, i) => {
          const d = frame - it.f;
          const p = interpolate(d, [3, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          const col = it.mark === 'cross' ? '#F2443F' : colorOf(it.tone) || '#3DDC97';
          const tick = pathOf([[18, 46], [36, 64], [70, 22]]);
          const c1 = pathOf([[22, 22], [64, 64]]);
          const c2 = pathOf([[64, 22], [22, 64]]);
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 30, ...slideIn(d) }}>
              <div style={{ width: 86, height: 86, flexShrink: 0, borderRadius: 16, border: `7px solid ${dark ? '#fff' : '#111'}`, background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', position: 'relative' }}>
                <svg width={86} height={86} viewBox="0 0 86 86" style={{ position: 'absolute', left: -7, top: -7, overflow: 'visible' }}>
                  {it.mark === 'cross'
                    ? <><Stroke d={c1.d} len={c1.len} p={p * 2} color={col} width={12} /><Stroke d={c2.d} len={c2.len} p={p * 2 - 1} color={col} width={12} /></>
                    : <Stroke d={tick.d} len={tick.len} p={p} color={col} width={13} />}
                </svg>
              </div>
              <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 1.05, letterSpacing: face.track, color: ink,
                opacity: it.mark === 'cross' && p > 0.9 ? 0.82 : 1 }}>{face.upper ? it.text.toUpperCase() : it.text}</span>
            </div>
          );
        })}
      </div>
    );
  };

export type Step = { f: number; title: string; sub?: string; tone?: string };
/** Numbered steps: each circle lands with its title; the line to it draws from the step before. */
export const StepsBody: React.FC<{ steps: Step[]; frame: number; face: Look['display']; ink: string; dark: boolean; heading?: React.ReactNode; colorOf: (t?: string) => string }> =
  ({ steps, frame, face, ink, dark, heading, colorOf }) => {
    const n = steps.length;
    const circle = n > 3 ? 104 : 124;
    const gap = n > 3 ? 40 : 56;
    // the circle carries the number: "1. Tampal" → "Tampal"
    const titleOf = (t: string) => { const x = t.replace(/^\s*(\d+|[a-z])\s*[.):\-]\s*/i, '').trim() || t; return face.upper ? x.toUpperCase() : x; };
    // one size for every title; long ones wrap onto a second line instead of shrinking the rest
    const titleSize = Math.min(...steps.map((st) => fitSize(titleOf(st.title), (n > 3 ? 92 : 104) * (face.charW < 0.5 ? 1.22 : 1), W - 360, 2, face.charW, 44)));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 90px', marginTop: -40 }}>
        {heading && <div style={{ alignSelf: 'center', marginBottom: 28 }}>{heading}</div>}
        {steps.map((st, i) => {
          const d = frame - st.f;
          const pop = interpolate(d, [0, 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
          const line = interpolate(d, [-6, 2], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
          const col = colorOf(st.tone) || '#FFD93B';
          const title = titleOf(st.title);
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
              {i > 0 && <div style={{ width: 10, height: gap, marginLeft: circle / 2 - 5, background: dark ? 'rgba(255,255,255,0.85)' : '#111', borderRadius: 5,
                transform: `scaleY(${line.toFixed(3)})`, transformOrigin: 'top center' }} />}
              <div style={{ display: 'flex', alignItems: 'center', gap: 30 }}>
                <div style={{ width: circle, height: circle, flexShrink: 0, borderRadius: 999, background: col, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transform: `scale(${pop.toFixed(3)})`, boxShadow: '0 8px 0 rgba(0,0,0,0.25)' }}>
                  <span style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: circle * 0.52, color: '#111', lineHeight: 1 }}>{i + 1}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', ...slideIn(d - 1) }}>
                  <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: titleSize, lineHeight: 1.0, color: ink, letterSpacing: face.track, maxWidth: W - 360 }}>{title}</span>
                  {st.sub && <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(st.sub.toUpperCase(), 50 * (face.charW < 0.5 ? 1.2 : 1), W - 360, 1, face.charW, 28), color: dark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.62)', marginTop: 6 }}>{st.sub.toUpperCase()}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

export type Ring = { f: number; value: number; label: string; tone?: string };
/** Percentage rings: the arc fills while its number counts up, the label under it. */
export const RingsBody: React.FC<{ rings: Ring[]; frame: number; face: Look['display']; ink: string; dark: boolean; heading?: React.ReactNode; colorOf: (t?: string) => string }> =
  ({ rings, frame, face, ink, dark, heading, colorOf }) => {
    const n = rings.length;
    const size = n === 1 ? 460 : n === 2 ? 380 : 290;
    const sw = n === 1 ? 44 : 34;
    const rad = size / 2 - sw / 2 - 4;
    const C = 2 * Math.PI * rad;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, marginTop: -30 }}>
        {heading}
        <div style={{ display: 'flex', justifyContent: 'center', gap: n === 3 ? 34 : 60, flexWrap: 'wrap' }}>
          {rings.map((rg, i) => {
            const d = frame - rg.f;
            const p = interpolate(d, [0, 20], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
            const pop = interpolate(d, [0, 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.8)) });
            const col = colorOf(rg.tone) || ['#FFD93B', '#3DDC97', '#4FB3FF'][i % 3];
            const v = Math.max(0, Math.min(100, rg.value));
            const label = face.upper ? rg.label.toUpperCase() : rg.label;
            return (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, opacity: d < 0 ? 0 : 1, transform: `scale(${(0.7 + 0.3 * pop).toFixed(3)})` }}>
                <div style={{ position: 'relative', width: size, height: size }}>
                  <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                    <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke={dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'} strokeWidth={sw} />
                    <circle cx={size / 2} cy={size / 2} r={rad} fill="none" stroke={col} strokeWidth={sw} strokeLinecap="round"
                      strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - (p * v) / 100)).toFixed(1)} />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size * 0.27, color: ink, lineHeight: 1 }}>{Math.round(p * v)}%</span>
                  </div>
                </div>
                <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(label, n === 1 ? 64 : 48, size + 40, 2, face.charW, 26), color: ink, textAlign: 'center', lineHeight: 1.05, maxWidth: size + 60 }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

/** A phone screen showing the picture (an app, a page, a screenshot), caption under it. */
export const PhoneCard: React.FC<{ image?: string; caption?: React.ReactNode; f: number; heading?: React.ReactNode }> = ({ image, caption, f, heading }) => {
  const p = interpolate(f, [0, 7], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, marginTop: -40 }}>
      {heading}
      <div style={{ width: 404, height: 700, borderRadius: 64, background: '#0d0d0f', padding: 14, boxShadow: '0 40px 80px rgba(0,0,0,0.5), inset 0 0 0 3px #2a2a2e',
        transform: `translateY(${((1 - p) * 140).toFixed(1)}px) rotate(${(-3 + (1 - p) * 8).toFixed(2)}deg)`, position: 'relative' }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 52, overflow: 'hidden', background: '#f2f2f2', position: 'relative' }}>
          {image && <Img src={image} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
        </div>
        <div style={{ position: 'absolute', top: 26, left: '50%', width: 112, height: 30, marginLeft: -56, borderRadius: 18, background: '#0d0d0f' }} />
      </div>
      {caption}
    </div>
  );
};

// ── backgrounds ──────────────────────────────────────────────────────────────

export type KitBg = 'notebook' | 'chalk' | 'grid' | 'gradient';
export const KIT_BG_COLOR: Record<KitBg, string> = { notebook: '#FBF8EF', chalk: '#1E3A2F', grid: '#F5F6F1', gradient: '#160F2E' };
export const kitBgLight = (bg: string) => bg === 'notebook' || bg === 'grid';

export const KitBackground: React.FC<{ bg: KitBg; f: number; accent: string }> = ({ bg, f, accent }) => {
  if (bg === 'notebook') {
    return (
      <AbsoluteFill style={{ background: KIT_BG_COLOR.notebook }}>
        <AbsoluteFill style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 62px, rgba(70,120,210,0.30) 62px, rgba(70,120,210,0.30) 65px)', backgroundPosition: '0 30px' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 118, width: 4, background: 'rgba(230,70,70,0.55)' }} />
        <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0) 60%, rgba(120,90,40,0.12) 100%)' }} />
      </AbsoluteFill>
    );
  }
  if (bg === 'chalk') {
    return (
      <AbsoluteFill style={{ background: KIT_BG_COLOR.chalk }}>
        <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.8px), radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1.5px)', backgroundSize: '11px 11px, 17px 17px', backgroundPosition: '0 0, 5px 8px' }} />
        <AbsoluteFill style={{ background: 'radial-gradient(ellipse 60% 30% at 30% 25%, rgba(255,255,255,0.07), rgba(255,255,255,0) 70%), radial-gradient(ellipse 50% 25% at 75% 70%, rgba(255,255,255,0.05), rgba(255,255,255,0) 70%)' }} />
        <AbsoluteFill style={{ boxShadow: 'inset 0 0 0 26px #6b4a2c, inset 0 0 0 30px #3e2a18, inset 0 0 120px rgba(0,0,0,0.55)' }} />
      </AbsoluteFill>
    );
  }
  if (bg === 'grid') {
    return (
      <AbsoluteFill style={{ background: KIT_BG_COLOR.grid }}>
        <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(60,120,210,0.16) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(60,120,210,0.16) 1.5px, transparent 1.5px)', backgroundSize: '48px 48px' }} />
        <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(60,120,210,0.22) 2px, transparent 2px), linear-gradient(90deg, rgba(60,120,210,0.22) 2px, transparent 2px)', backgroundSize: '192px 192px' }} />
      </AbsoluteFill>
    );
  }
  // gradient: two soft colour fields drifting over a deep base
  const a = Math.sin(f / 50);
  const b = Math.cos(f / 63);
  return (
    <AbsoluteFill style={{ background: KIT_BG_COLOR.gradient }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle 620px at ${(300 + a * 140).toFixed(0)}px ${(520 + b * 120).toFixed(0)}px, ${accent}AA 0%, ${accent}00 70%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(circle 560px at ${(800 - b * 120).toFixed(0)}px ${(1250 + a * 140).toFixed(0)}px, #2F7BFFAA 0%, #2F7BFF00 70%)` }} />
      <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1.6px)', backgroundSize: '7px 7px' }} />
    </AbsoluteFill>
  );
};


// ── number roll · extrude · shine ────────────────────────────────────────────

/** Odometer digits: every digit spins into place (the right-most spins most), the rest of the text stays. */
export const RollText: React.FC<{ text: string; d: number; style: React.CSSProperties; measure?: (ch: string) => number }> = ({ text, d, style, measure }) => {
  const chars = Array.from(text);
  const digitIdx = chars.map((c, i) => (/\d/.test(c) ? i : -1)).filter((i) => i >= 0);
  return (
    <span style={{ ...style, display: 'inline-flex', alignItems: 'flex-start' }}>
      {chars.map((ch, i) => {
        if (!/\d/.test(ch)) return <span key={i} style={{ whiteSpace: 'pre' }}>{ch}</span>;
        const rank = digitIdx.length - 1 - digitIdx.indexOf(i); // 0 = right-most
        const target = Number(ch);
        const spins = 1 + rank;
        const p = interpolate(d, [0, 14 + rank * 3], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
        const pos = p * (spins * 10 + target);
        return (
          // each column is as wide as its final digit (the widest digit would leave gaps: "1 2")
          <span key={i} style={{ display: 'inline-block', height: '1.02em', overflow: 'hidden', lineHeight: '1.02em', ...(measure ? { width: measure(ch), textAlign: 'center' as const } : {}) }}>
            <span style={{ display: 'block', transform: `translateY(${(-pos * 1.02).toFixed(3)}em)` }}>
              {Array.from({ length: spins * 10 + target + 1 }, (_, k) => <span key={k} style={{ display: 'block', height: '1.02em' }}>{k % 10}</span>)}
            </span>
          </span>
        );
      })}
    </span>
  );
};

/** A stacked 3D extrude (grows in with a spring-ish ease) for a text style. */
export const extrudeShadow = (d: number, color = 'rgba(0,0,0,0.55)') => {
  const n = Math.round(interpolate(d, [0, 8], [0, 10], { ...clamp, easing: Easing.out(Easing.back(1.6)) }));
  return Array.from({ length: Math.max(0, n) }, (_, i) => `${i + 1}px ${i + 1}px 0 ${color}`).join(', ') || 'none';
};

/** A gloss band that sweeps once across the text (overlay copy, background-clipped). */
export const Shine: React.FC<{ text: string; d: number; style: React.CSSProperties }> = ({ text, d, style }) => {
  const p = interpolate(d, [6, 20], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  if (p <= 0 || p >= 1) return null;
  return (
    <span style={{ ...style, position: 'absolute', left: 0, top: 0, color: 'transparent', background: 'none', boxShadow: 'none', textShadow: 'none', WebkitTextStroke: '0px',
      backgroundImage: 'linear-gradient(110deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.95) 50%, rgba(255,255,255,0) 60%)', backgroundSize: '250% 100%',
      backgroundPosition: `${(150 - p * 200).toFixed(1)}% 0`, WebkitBackgroundClip: 'text', backgroundClip: 'text', pointerEvents: 'none' } as React.CSSProperties}>{text}</span>
  );
};

// ── chart ────────────────────────────────────────────────────────────────────

export type ChartPoint = { f: number; label: string; value: number };
const fmtNum = (v: number, dec: number) => v.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** A line / area / bar chart: each point lands on its word, the line draws to it, the value rides the tip. */
export const ChartBody: React.FC<{ points: ChartPoint[]; type: 'line' | 'area' | 'bars'; unit?: string; frame: number; face: Look['display']; ink: string; dark: boolean;
  heading?: React.ReactNode; color: string }> = ({ points, type, unit, frame, face, ink, dark, heading, color }) => {
  const Wp = 880;
  const Hp = 520;
  const n = points.length;
  const vals = points.map((pt) => pt.value);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(...vals) * 1.12 || 1;
  const dec = vals.some((v) => !Number.isInteger(v)) ? Math.min(2, Math.max(...vals.map((v) => (String(v).split('.')[1] ?? '').length))) : 0;
  const pre = unit && /^[A-Za-z$£€¥]/.test(unit) && unit.length <= 3 && !/%|jam|hari/i.test(unit) ? unit : '';
  const suf = pre ? '' : unit ?? '';
  const x = (i: number) => (n === 1 ? Wp / 2 : 40 + (i * (Wp - 80)) / (n - 1));
  const y = (v: number) => Hp - ((v - lo) / (hi - lo)) * Hp;
  const grid = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';
  const labelSize = fitSize(points.map((pt) => pt.label).join('  ').toUpperCase(), 36, Wp, 1, face.charW, 20);
  if (type === 'bars') {
    const bw = Math.min(150, (Wp - 40) / n - 28);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, marginTop: -30 }}>
        {heading}
        <div style={{ position: 'relative', width: Wp, height: Hp + 70 }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: Hp, height: 4, background: grid }} />
          {points.map((pt, i) => {
            const d = frame - pt.f;
            const g = interpolate(d, [0, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.3)) });
            const h = (Hp - y(pt.value)) * g;
            return (
              <div key={i} style={{ position: 'absolute', left: x(i) - bw / 2, width: bw, top: 0, height: Hp + 70, opacity: d < 0 ? 0 : 1 }}>
                <div style={{ position: 'absolute', bottom: 70, left: 0, right: 0, height: h, background: color, borderRadius: '12px 12px 0 0', boxShadow: 'inset 0 -10px 0 rgba(0,0,0,0.18)' }} />
                <div style={{ position: 'absolute', bottom: 70 + h + 8, left: -30, right: -30, textAlign: 'center', fontFamily: face.family, fontWeight: face.weight, fontSize: Math.min(52, bw * 0.5), color: ink }}>
                  {pre}{fmtNum(pt.value * g, dec)}{suf}</div>
                <div style={{ position: 'absolute', bottom: 18, left: -30, right: -30, textAlign: 'center', fontFamily: face.family, fontWeight: face.weight, fontSize: labelSize, color: ink }}>{pt.label.toUpperCase()}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  // line / area: the drawn length follows the landed points (each segment draws in the 8 frames before its point lands)
  const seg = points.slice(1).map((pt, i) => Math.hypot(x(i + 1) - x(i), y(pt.value) - y(points[i].value)));
  const total = seg.reduce((a, b) => a + b, 0) || 1;
  let drawn = 0;
  let tip: [number, number, number] = [x(0), y(points[0].value), points[0].value];
  seg.forEach((len, i) => {
    const sp = interpolate(frame - points[i + 1].f, [-8, 0], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
    if (sp <= 0) return;
    drawn += len * sp;
    const a = points[i];
    const b = points[i + 1];
    tip = [x(i) + (x(i + 1) - x(i)) * sp, y(a.value) + (y(b.value) - y(a.value)) * sp, a.value + (b.value - a.value) * sp];
  });
  const started = frame - points[0].f >= 0;
  const d = points.map((pt, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(pt.value).toFixed(1)}`).join(' ');
  const falling = vals[vals.length - 1] < vals[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, marginTop: -30, opacity: started ? 1 : 0 }}>
      {heading}
      <div style={{ position: 'relative', width: Wp, height: Hp + 70 }}>
        <svg width={Wp} height={Hp} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
          {[0.25, 0.5, 0.75, 1].map((k) => <line key={k} x1={0} x2={Wp} y1={Hp * k} y2={Hp * k} stroke={grid} strokeWidth={2} />)}
          {type === 'area' && (
            <>
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={0.55} /><stop offset="1" stopColor={color} stopOpacity={0.02} /></linearGradient>
                <clipPath id="chartClip"><rect x={0} y={-40} width={Math.max(0, tip[0])} height={Hp + 80} /></clipPath>
              </defs>
              <path d={`${d} L${x(n - 1)} ${Hp} L${x(0)} ${Hp} Z`} fill="url(#chartFill)" clipPath="url(#chartClip)" />
            </>
          )}
          <path d={d} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={total.toFixed(1)} strokeDashoffset={(total - drawn).toFixed(1)} />
          {points.map((pt, i) => (frame - pt.f >= 0 ? <circle key={i} cx={x(i)} cy={y(pt.value)} r={13} fill={dark ? '#fff' : '#111'} stroke={color} strokeWidth={6} /> : null))}
        </svg>
        {/* the value rides the tip of the line */}
        <div style={{ position: 'absolute', left: tip[0], top: tip[1] - 96, transform: 'translateX(-50%)', background: falling ? '#F2443F' : color, color: '#111',
          fontFamily: face.family, fontWeight: face.weight, fontSize: 56, padding: '4px 18px', borderRadius: 10, whiteSpace: 'nowrap', boxShadow: '0 8px 0 rgba(0,0,0,0.25)' }}>
          {pre}{fmtNum(tip[2], dec)}{suf}
        </div>
        {points.map((pt, i) => (
          <div key={i} style={{ position: 'absolute', left: x(i), top: Hp + 18, transform: 'translateX(-50%)', fontFamily: face.family, fontWeight: face.weight,
            fontSize: labelSize, color: ink, opacity: frame - pt.f >= 0 ? 1 : 0.25, whiteSpace: 'nowrap' }}>{pt.label.toUpperCase()}</div>
        ))}
      </div>
    </div>
  );
};

// ── rain · burst background · torn-paper entrance ────────────────────────────

/** An emoji rain for a scene (closed-form fall per seeded particle; f = frames into the scene). */
export const Rain: React.FC<{ emoji: string; f: number; fps: number; seed: number; lottie?: LottieMap }> = ({ emoji, f, fps, seed, lottie }) => {
  const r = rng(seed);
  const t = f / fps;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', overflow: 'hidden' }}>
      {Array.from({ length: 12 }, (_, i) => {
        const x0 = r() * 1080;
        const delay = r() * 1.6;
        const v = 700 + r() * 600;
        const size = 80 + r() * 70;
        const spin = (r() - 0.5) * 220;
        const tt = t - delay;
        if (tt < 0) return null;
        const yy = -180 + v * tt + 140 * tt * tt;
        if (yy > 2000) return null;
        return (
          <div key={i} style={{ position: 'absolute', left: x0 - size / 2, top: yy, transform: `rotate(${(spin * tt).toFixed(1)}deg)`, opacity: 0.95 }}>
            <LottieEmoji char={emoji} size={size} lottie={lottie} />
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** A sunburst that turns slowly behind a slammed word (two tones of the colour, vignetted). */
export const BurstBackground: React.FC<{ f: number; color: string }> = ({ f, color }) => (
  <AbsoluteFill style={{ background: color }}>
    <AbsoluteFill style={{ background: `repeating-conic-gradient(from ${(f * 0.5).toFixed(1)}deg at 50% 42%, rgba(255,255,255,0.13) 0deg 9deg, rgba(0,0,0,0) 9deg 18deg)` }} />
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 42%, rgba(0,0,0,0) 30%, rgba(0,0,0,0.42) 100%)' }} />
  </AbsoluteFill>
);

/** Torn-paper entrance: the scene rises with a jagged top edge (seeded) over 9 frames. */
export const tearClip = (f: number, seed: number): React.CSSProperties => {
  if (f >= 9) return {};
  const p = interpolate(f, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const r = rng(seed);
  const edge = (1 - p) * 1920;
  const pts: string[] = [];
  for (let i = 0; i <= 18; i++) pts.push(`${((i / 18) * 100).toFixed(2)}% ${(edge + (r() - 0.5) * 70).toFixed(1)}px`);
  return { clipPath: `polygon(${pts.join(', ')}, 100% 100%, 0% 100%)` };
};
