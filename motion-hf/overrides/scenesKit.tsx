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
//   backgrounds        notebook · chalk · grid · gradient
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate } from 'remotion';
import { W, clamp, fitSize } from '../../motion/src/lib';
import type { Look } from './look';

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
    ctx.font = `${face.weight} ${size}px ${face.family}`;
    w = ctx.measureText(text).width + Math.max(0, text.length - 1) * (face.track || 0);
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
const pathOf = (pts: Pt[]) => {
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
export const roughEllipse = (w: number, h: number, seed: number) => {
  const r = rng(seed);
  const start = -Math.PI * (0.62 + r() * 0.16);
  const turn = (1.1 + r() * 0.12) * Math.PI * 2;
  const ph = r() * 6;
  const pts: Pt[] = [];
  for (let i = 0; i <= 56; i++) {
    const u = i / 56;
    const t = start + u * turn;
    const wob = 1 + 0.035 * Math.sin(3 * t + ph) + (r() - 0.5) * 0.02 + 0.05 * u;
    pts.push([w / 2 + Math.cos(t) * (w / 2) * wob, h / 2 + Math.sin(t) * (h / 2) * wob]);
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
  if (mark === 'circle') {
    const e = roughEllipse(w + pad * 1.6, h + pad * 0.55, seed);
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

export type TextEnter = 'type' | 'scramble' | 'letters' | 'rise';
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
    const circle = n > 3 ? 92 : 110;
    const titleSize = Math.min(...steps.map((st) => fitSize(face.upper ? st.title.toUpperCase() : st.title, 84 * (face.charW < 0.5 ? 1.22 : 1), W - 340, 1, face.charW, 36)));
    const gap = n > 3 ? 46 : 62;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 90px', marginTop: -40 }}>
        {heading && <div style={{ alignSelf: 'center', marginBottom: 28 }}>{heading}</div>}
        {steps.map((st, i) => {
          const d = frame - st.f;
          const pop = interpolate(d, [0, 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) });
          const line = interpolate(d, [-6, 2], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
          const col = colorOf(st.tone) || '#FFD93B';
          const title = face.upper ? st.title.toUpperCase() : st.title;
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
                  <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: titleSize, lineHeight: 1.04, color: ink, letterSpacing: face.track }}>{title}</span>
                  {st.sub && <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(st.sub.toUpperCase(), 44, W - 340, 1, face.charW, 26), color: dark ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.62)', marginTop: 4 }}>{st.sub.toUpperCase()}</span>}
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
