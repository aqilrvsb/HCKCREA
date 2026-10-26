// Laju v2 HEADLINES — required in every video with a person on camera (Motion Default / Custom with a video and
// every CLIPPER clip; the owner's call, 2026-10-22). The video runs on the full-frame speaker, then:
//   over  — a three-line headline arrives over the speaker (an italic serif lead-in, one huge condensed line, a
//           short line in a colour box), clear of the face;
//   split — a B-roll panel takes one half (top or bottom), the speaker moves into the other half, the headline
//           rides the seam;
//   pip   — the B-roll fills the frame while the speaker shrinks and docks into a small box bottom-right.
// Each has variants (entrance, panel shape, box colour) drawn per video, so no two videos look alike.
// Motion follows the HyperFrames motion doctrine (heygen-com/hyperframes .claude/skills): entries decelerate on
// expo.out, exits accelerate on power-in and keep travelling the same way (up), text carries a 10 px blur at speed,
// lines arrive as a waterfall from below, the speaker's frame is the carrier that docks into the box.
import React from 'react';
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate } from 'remotion';
import { inkOn } from '../../motion/src/lib';
import type { Face } from '../../motion/src/types';
import type { Look } from './look';

export type HeadKind = 'over' | 'split' | 'pip';
export type PlacedHeadline = {
  kind: HeadKind; s: number; e: number; k: number;
  lead: string; big: string; box?: string;
  media?: { src: string; video?: boolean };
  /** layout / entrance variant (see VARIANTS) */
  v: number;
  color: string;
  /** split: the panel's half; the speaker's vertical move (px, + = down) to sit in the other half */
  top?: boolean; dy?: number;
  /** pip: the speaker's dock (screen px) and the scale that puts the face in it */
  pip?: { x: number; y: number; w: number; h: number; scale: number; fx: number; fy: number; round: boolean };
  /** over: the text block's top (px), clear of the face */
  y?: number;
};

export const PANEL = 900; // the split panel's height on the 1080 × 1920 frame
const IN = 15; // entry frames (~0.5 s)
const OUT = 9; // exit frames (~0.3 s)
const BOX_COLORS = ['#FF6A13', '#FF3D7F', '#2EC4FF', '#FFD93B', '#3DDC97'];

const c01 = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const easeIn = (d: number, len = IN) => interpolate(d, [0, len], [0, 1], { ...c01, easing: Easing.out(Easing.exp) });
const easeOut = (d: number, len = OUT) => interpolate(d, [0, len], [0, 1], { ...c01, easing: Easing.in(Easing.poly(4)) });

/** How far the layout is in (0 → 1 on entry, 1 → 0 on exit) at a frame. */
export const headK = (h: PlacedHeadline, frame: number) => {
  if (frame < h.s || frame >= h.e) return 0;
  return Math.min(easeIn(frame - h.s, 13), 1 - easeOut(frame - (h.e - OUT)));
};

/** Layout + entrance variant for headline k of a video (seeded: the same video always gets the same). */
export const variantFor = (kind: HeadKind, seed: number, k: number) => {
  const n = kind === 'split' ? 5 : 3;
  return ((seed >>> (3 + k)) + k * 2) % n;
};
export const boxColor = (seed: number, k: number, accent: string, look: Look) => {
  const pool = [BOX_COLORS[(seed >>> 5) % BOX_COLORS.length], accent, look.second, look.hi].filter((c) => /^#[0-9a-f]{6}$/i.test(c || ''));
  return pool[(k + (seed >>> 9)) % pool.length] || '#FF6A13';
};

/** The camera move a headline asks of the speaker's layer at this frame (null: none). */
export function headCamera(heads: PlacedHeadline[], frame: number): React.CSSProperties | null {
  const h = heads.find((x) => frame >= x.s && frame < x.e);
  if (!h) return null;
  const k = headK(h, frame);
  if (h.kind === 'split' && h.dy) return { transform: `translateY(${(h.dy * k).toFixed(1)}px)` };
  if (h.kind === 'pip' && h.pip) {
    const p = h.pip;
    const s = 1 + (p.scale - 1) * k;
    // the face centre lands on the dock's centre; the frame around it is clipped to the dock
    const tx = (p.x + p.w / 2 - p.scale * p.fx) * k;
    const ty = (p.y + p.h / 2 - p.scale * p.fy) * k;
    return { transform: `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`, transformOrigin: '0 0' };
  }
  return null;
}
/** The dock's clip (screen px) while the speaker is shrunk; applied on an un-transformed wrapper. */
export function headClip(heads: PlacedHeadline[], frame: number): React.CSSProperties | null {
  const h = heads.find((x) => frame >= x.s && frame < x.e && x.kind === 'pip' && x.pip);
  if (!h || !h.pip) return null;
  const k = headK(h, frame);
  const p = h.pip;
  const l = p.x * k, t = p.y * k, r = (1080 - p.x - p.w) * k, b = (1920 - p.y - p.h) * k;
  const rad = p.round ? Math.min(p.w, p.h) / 2 : 44;
  return { clipPath: `inset(${t.toFixed(1)}px ${r.toFixed(1)}px ${b.toFixed(1)}px ${l.toFixed(1)}px round ${(rad * k).toFixed(1)}px)` };
}

// ── text ──
// Anton caps, as shares of the em: M / W are wide, I / 1 / punctuation thin, the rest ~0.5 — one average for every
// letter let "MACADAMIA" run past the frame (two M's)
const antonEm = (t: string) => [...t.toUpperCase()].reduce((a, ch) => a + (/[MW]/.test(ch) ? 0.64 : /[IJ1!.,:;'|]/.test(ch) ? 0.27 : ch === ' ' ? 0.22 : 0.5), 0);
const bigSize = (t: string, width = 1000) => Math.max(110, Math.min(270, Math.floor((width - t.length * 1.5) / Math.max(1, antonEm(t)))));
const leadSize = (t: string, width = 980) => Math.max(58, Math.min(104, Math.floor(width / Math.max(1, t.length * 0.42))));
const SHADOW = '0 6px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.5)';

/** A line arriving as a waterfall from below (expo.out, 10 px blur at speed) and leaving upward (power-in). */
function wf(frame: number, h: PlacedHeadline, delay: number, from: 'below' | 'left' | 'big' = 'below'): React.CSSProperties {
  const d = frame - h.s - delay;
  if (d < 0) return { opacity: 0 };
  const k = easeIn(d);
  const out = easeOut(frame - (h.e - OUT));
  const blur = 10 * (1 - k) + 10 * out;
  const tIn = from === 'left' ? `translateX(${(-90 * (1 - k)).toFixed(1)}px)` : from === 'big' ? `scale(${(1.25 - 0.25 * k).toFixed(3)})` : `translateY(${(70 * (1 - k)).toFixed(1)}px)`;
  return {
    opacity: Math.max(0, (0.15 + 0.85 * k) * (1 - out)),
    transform: `${tIn} translateY(${(-60 * out).toFixed(1)}px)`,
    filter: blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : undefined,
  };
}
/** The boxed line: its box wipes open left → right, then the words land. */
function boxStyle(frame: number, h: PlacedHeadline, delay: number): React.CSSProperties {
  const d = frame - h.s - delay;
  const k = easeIn(d, 12);
  const out = easeOut(frame - (h.e - OUT));
  return {
    clipPath: `inset(0 ${((1 - k) * 100).toFixed(1)}% 0 0)`,
    opacity: d < 0 ? 0 : 1 - out,
    transform: `translateY(${(-60 * out).toFixed(1)}px)`,
  };
}

function Lines({ h, frame, align, width, bigStyle }: { h: PlacedHeadline; frame: number; align: 'center' | 'left'; width: number; bigStyle?: 'below' | 'left' | 'big' }) {
  const ink = inkOn(h.color);
  const bs = bigSize(h.big, width);
  const items = align === 'center' ? 'center' : 'flex-start';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: items, gap: 6, width }}>
      {h.lead && (
        <div style={{ ...wf(frame, h, 0), fontFamily: "'Playfair Display', serif", fontStyle: 'italic', fontWeight: 500, fontSize: leadSize(h.lead, width),
          color: '#fff', lineHeight: 1.05, letterSpacing: -1, textShadow: SHADOW, textAlign: align, whiteSpace: 'nowrap' }}>{h.lead}</div>
      )}
      <div style={{ ...wf(frame, h, 4, bigStyle), fontFamily: "'Anton', sans-serif", fontSize: bs, color: '#fff', lineHeight: 0.92,
        letterSpacing: 1, textShadow: SHADOW, textAlign: align, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{h.big}</div>
      {h.box && (
        <div style={{ ...boxStyle(frame, h, 9), marginTop: 14, background: h.color, color: ink, padding: '8px 22px', borderRadius: 4,
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, fontSize: 50, lineHeight: 1.15, whiteSpace: 'nowrap',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>{h.box}</div>
      )}
    </div>
  );
}

/** What fills a panel: the B-roll (a slow push in, never idle), or the look's own surface with the big word. */
function Fill({ h, frame, look }: { h: PlacedHeadline; frame: number; look: Look }) {
  const t = Math.max(0, frame - h.s) / Math.max(1, h.e - h.s);
  const push = `scale(${(1.04 + 0.08 * t).toFixed(4)})`;
  if (h.media?.src) {
    return h.media.video
      ? <OffthreadVideo src={h.media.src} muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: push }} />
      : <Img src={h.media.src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: push }} />;
  }
  const bg = look.palette?.bg ?? '#141414';
  return (
    <AbsoluteFill style={{ background: `radial-gradient(120% 90% at 30% 20%, ${h.color}55 0%, ${bg} 55%, #000 100%)`, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: -40, top: '18%', fontFamily: "'Anton', sans-serif", fontSize: 420, lineHeight: 0.85, color: 'rgba(255,255,255,0.06)',
        whiteSpace: 'nowrap', transform: `translateX(${(-160 * t).toFixed(1)}px)` }}>{`${h.big} ${h.big}`}</div>
    </AbsoluteFill>
  );
}

/** Behind the speaker's layer: the full-frame B-roll a "pip" docks the speaker over. */
export function HeadlineBack({ heads, frame, look }: { heads: PlacedHeadline[]; frame: number; look: Look }) {
  const h = heads.find((x) => frame >= x.s && frame < x.e && x.kind === 'pip');
  if (!h) return null;
  return (
    <AbsoluteFill>
      <Fill h={h} frame={frame} look={look} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.05) 45%, rgba(0,0,0,0.35) 100%)' }} />
    </AbsoluteFill>
  );
}

/** Over the speaker: the split panel and every headline's words. */
export function HeadlineFront({ heads, frame, look }: { heads: PlacedHeadline[]; frame: number; look: Look }) {
  const h = heads.find((x) => frame >= x.s && frame < x.e);
  if (!h) return null;
  const k = headK(h, frame);
  const d = frame - h.s;

  if (h.kind === 'over') {
    // v0 centred waterfall · v1 editorial, left-aligned, the big line sweeping in from the left · v2 the big line
    // arrives oversized and retracts (an arrival beat)
    const left = h.v === 1;
    const y = h.y ?? 1060;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        <AbsoluteFill style={{ opacity: k, background: `linear-gradient(180deg, rgba(0,0,0,0) ${Math.max(0, (y - 260) / 19.2).toFixed(1)}%, rgba(0,0,0,0.5) ${((y + 200) / 19.2).toFixed(1)}%, rgba(0,0,0,0) ${Math.min(100, (y + 700) / 19.2).toFixed(1)}%)` }} />
        <div style={{ position: 'absolute', top: y, left: left ? 70 : 40, right: left ? undefined : 40, display: 'flex', justifyContent: left ? 'flex-start' : 'center' }}>
          <Lines h={h} frame={frame} align={left ? 'left' : 'center'} width={left ? 940 : 1000} bigStyle={h.v === 1 ? 'left' : h.v === 2 ? 'big' : 'below'} />
        </div>
      </AbsoluteFill>
    );
  }

  if (h.kind === 'pip') {
    const p = h.pip;
    // the dock's frame (a thin white ring / border) once the speaker has landed in it
    const ring = p ? (
      <div style={{ position: 'absolute', left: p.x - 6, top: p.y - 6, width: p.w + 12, height: p.h + 12, borderRadius: p.round ? '50%' : 50,
        border: `6px solid ${h.v === 2 ? h.color : '#fff'}`, opacity: Math.max(0, (k - 0.7) / 0.3), boxShadow: '0 18px 40px rgba(0,0,0,0.45)' }} />
    ) : null;
    const y = h.v === 1 ? 300 : 360;
    return (
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {ring}
        <div style={{ position: 'absolute', top: y, left: h.v === 1 ? 70 : 40, right: h.v === 1 ? undefined : 40, display: 'flex', justifyContent: h.v === 1 ? 'flex-start' : 'center' }}>
          <Lines h={h} frame={frame} align={h.v === 1 ? 'left' : 'center'} width={h.v === 1 ? 940 : 1000} bigStyle={h.v === 2 ? 'big' : 'below'} />
        </div>
      </AbsoluteFill>
    );
  }

  // split — v0 top slide · v1 top unroll · v2 top card · v3 bottom slide · v4 bottom card
  const top = h.top !== false;
  const card = h.v === 2 || h.v === 4;
  const unroll = h.v === 1;
  const inset = card ? 30 : 0;
  const ph = card ? PANEL - 40 : PANEL;
  const enter = easeIn(d, 14);
  const out = easeOut(frame - (h.e - OUT));
  // panels travel along their own axis: in from their edge, out the same way they came (top panels exit up)
  const off = top ? -(PANEL + 40) : PANEL + 40;
  const ty = unroll ? 0 : off * (1 - enter) + off * out;
  const rot = card ? (top ? -3 : 3) * (1 - enter) : 0;
  const clip = unroll ? `inset(0 0 ${((1 - enter + out) * 100).toFixed(1)}% 0)` : undefined;
  const panelTop = top ? inset : 1920 - ph - inset;
  const seam = top ? panelTop + ph : panelTop;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: inset, right: inset, top: panelTop, height: ph, overflow: 'hidden', borderRadius: card ? 40 : 0,
        transform: `translateY(${ty.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`, clipPath: clip, boxShadow: card ? '0 24px 60px rgba(0,0,0,0.55)' : '0 10px 40px rgba(0,0,0,0.45)' }}>
        <Fill h={h} frame={frame} look={look} />
        <AbsoluteFill style={{ background: top ? 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)' : 'linear-gradient(0deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)' }} />
      </div>
      {/* the headline rides the seam: the lead-in inside the panel, the big line across the seam, the box beyond it */}
      <div style={{ position: 'absolute', left: 40, right: 40, top: top ? seam - bigSize(h.big) * 0.5 - leadSize(h.lead) - 20 : seam - 60,
        display: 'flex', justifyContent: 'center' }}>
        <Lines h={h} frame={frame} align="center" width={1000} bigStyle={card ? 'big' : 'below'} />
      </div>
    </AbsoluteFill>
  );
}

/** Where an "over" headline's words go: below the face when there's room, else above it, else the lower third. */
export function overTop(face: Face | undefined, h: { lead: string; big: string; box?: string }) {
  const blockH = (h.lead ? leadSize(h.lead) + 6 : 0) + bigSize(h.big) * 0.95 + (h.box ? 90 : 0);
  if (!face) return 1060;
  const fTop = face.y * 1920, fBot = (face.y + face.h) * 1920;
  if (fBot + 50 + blockH <= 1700) return Math.round(fBot + 50);
  if (fTop - 50 - blockH >= 200) return Math.round(fTop - 50 - blockH);
  return Math.round(1700 - blockH);
}

/** The speaker's dock for a "pip": bottom-right, the face scaled to fill about half its width. */
export function pipDock(face: Face | undefined, round: boolean) {
  const w = round ? 400 : 380, h = round ? 400 : 520;
  const x = 1080 - 48 - w, y = 1920 - 300 - h;
  const fw = (face?.w ?? 0.3) * 1080;
  const scale = Math.max(0.28, Math.min(0.7, (w * 0.55) / Math.max(60, fw)));
  const fx = face ? (face.x + face.w / 2) * 1080 : 540;
  const fy = face ? (face.y + face.h / 2) * 1920 : 760;
  return { x, y, w, h, scale, fx, fy, round };
}
