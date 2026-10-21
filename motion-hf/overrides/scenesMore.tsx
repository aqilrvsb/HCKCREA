// Laju v2 "Pro" scene kit, round 3 — more explainer devices the AI director can reach for.
// Everything is a pure function of the frame (HyperFrames captures chunks in any order).
//   chat      a message thread (bubbles + typing dots), a comment sheet, or a notification stack —
//             only words the speaker says (a question they read out, a message they quote)
//   split     a versus split screen: two coloured halves (MITOS | FAKTA, SEBELUM | SELEPAS), each
//             item ticks ✓ or crosses ✗ on its word
//   annotate  a held sentence; a key word gets marked and a hand-drawn connector runs to a
//             handwritten note (the Vox annotate gesture)
//   swap      a word slot that rolls through options and lands on the final word (a line entrance)
//   focus     manga focus lines that burst around the speaker's face on a word (a camera move)
//   banner    a news strip over the speaker: a blinking "TERKINI" tag, the headline wiping open, a ticker
// Ideas from the HyperFrames registry (chat-thread, notification-stack, comparison-split, vox-annotate,
// kinetic-type-swap, ticker-takeover — Apache-2.0), re-written here as frame math.
import React from 'react';
import { AbsoluteFill, Easing, interpolate } from 'remotion';
import { W, clamp, fitSize } from '../../motion/src/lib';
import type { Face } from './look';
import { HandMark, Stroke, fitWrap, pathOf, rng, roughArrow, textWidth, wrapLines } from './scenesKit';
export { fitWrap, wrapLines };

const UI: Face = { family: "'Inter', sans-serif", weight: 700, charW: 0.56, upper: false, track: 0 };
const UI_BOLD: Face = { family: "'Inter', sans-serif", weight: 800, charW: 0.58, upper: false, track: 0 };
const HAND = "'Permanent Marker', cursive";
const HAND_FACE: Face = { family: HAND, weight: 400, charW: 0.62, upper: false, track: 0 };


const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const popIn = (d: number, n = 6, k = 1.7) => interpolate(d, [0, n], [0, 1], { ...clamp, easing: Easing.out(Easing.back(k)) });
const AVATAR = ['#F59E0B', '#10B981', '#6366F1', '#EC4899', '#0EA5E9', '#EF4444', '#8B5CF6'];
const hashStr = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const initialOf = (s?: string) => (s ? (Array.from(s.replace(/^@/, '').trim())[0] ?? '').toUpperCase() : '');

/** A smooth stack position: the layout at the last change eases into the layout now over `n` frames. */
const settle = (frame: number, events: number[], at: (fr: number) => number, n = 6) => {
  const last = events.filter((e) => e <= frame).reduce((a, b) => Math.max(a, b), -1e9);
  if (last < -1e8) return at(frame);
  const from = at(last - 1);
  const to = at(frame);
  return from + (to - from) * ease((frame - last) / n);
};

// ── chat · comments · notifications ─────────────────────────────────────────

export type ChatStyle = 'chat' | 'comments' | 'notif';
export type ChatMsg = { f: number; text: string; who: 'them' | 'me'; name?: string; likes?: string };

const Avatar: React.FC<{ name?: string; size: number; i: number }> = ({ name, size, i }) => {
  const ini = initialOf(name);
  const bg = ini ? AVATAR[(hashStr(name ?? '') + i) % AVATAR.length] : '#C9CDD2';
  return (
    <div style={{ width: size, height: size, borderRadius: 999, background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {ini
        ? <span style={{ fontFamily: UI_BOLD.family, fontWeight: 800, fontSize: size * 0.46, color: '#fff' }}>{ini}</span>
        : <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24"><circle cx="12" cy="8" r="4.2" fill="#fff" /><path d="M3.5 22c0-4.7 3.8-8 8.5-8s8.5 3.3 8.5 8z" fill="#fff" /></svg>}
    </div>
  );
};

const Heart: React.FC<{ size: number; filled: boolean }> = ({ size, filled }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.5 1.1 5.3 3 1.8-1.9 3.2-3 5.3-3 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"
    fill={filled ? '#FE2C55' : 'none'} stroke={filled ? '#FE2C55' : '#9a9a9a'} strokeWidth="2" /></svg>
);

const VIS = 820; // the stack's visible height (body top 400 → just above the captions)

export const ChatBody: React.FC<{ msgs: ChatMsg[]; style: ChatStyle; title?: string; frame: number; s: number; dark: boolean; accent: string }> =
  ({ msgs, style, title, frame, s, dark, accent }) => {
    if (style === 'comments') return <CommentSheet msgs={msgs} title={title} frame={frame} s={s} />;
    if (style === 'notif') return <NotifStack msgs={msgs} title={title} frame={frame} accent={accent} />;
    // ── a message thread ──
    const FS = 62;
    const LH = FS * 1.22;
    const maxT = 720;
    const lay = msgs.map((m) => {
      const lines = wrapLines(m.text, UI, FS, maxT);
      const w = Math.min(maxT, Math.max(...lines.map((l) => textWidth(l, UI, FS)))) + 64;
      const nameH = m.who === 'them' && m.name ? 40 : 0;
      return { lines, w, h: lines.length * LH + 44 + nameH, nameH };
    });
    const headH = title ? 130 : 0;
    // a "them" message is preceded by typing dots (12 frames) when there is room since the last one
    const typingAt = (i: number) => (msgs[i].who === 'them' && (i === 0 || msgs[i].f - msgs[i - 1].f >= 16) ? msgs[i].f - 12 : msgs[i].f);
    const shownH = (fr: number) => {
      let h = 0;
      msgs.forEach((m, i) => {
        if (fr >= m.f) h += lay[i].h + 18;
        else if (fr >= typingAt(i)) h += 92 + 18;
      });
      return h;
    };
    const events = msgs.flatMap((m, i) => [m.f, typingAt(i)]);
    const scroll = settle(frame, events, (fr) => Math.max(0, shownH(fr) - (VIS - headH)));
    const them = dark ? { bg: '#EDEDED', ink: '#111' } : { bg: '#E6E7EA', ink: '#111' };
    const me = { bg: '#2F7BFF', ink: '#fff' };
    let y = 0;
    const out: React.ReactNode[] = [];
    msgs.forEach((m, i) => {
      const d = frame - m.f;
      const t0 = typingAt(i);
      if (frame < t0) return;
      const L = lay[i];
      const left = m.who === 'them';
      const yy = y;
      if (d < 0) {
        // typing dots
        const k = popIn(frame - t0, 5);
        out.push(
          <div key={`t${i}`} style={{ position: 'absolute', top: yy, left: 0, width: 150, height: 92, borderRadius: 46, background: them.bg, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 12, transform: `scale(${k.toFixed(3)})`, transformOrigin: 'left bottom' }}>
            {[0, 1, 2].map((j) => <span key={j} style={{ width: 18, height: 18, borderRadius: 9, background: '#8E8E93',
              transform: `translateY(${(-7 * Math.max(0, Math.sin(((frame - t0) / 9) * Math.PI * 2 - j * 1.1))).toFixed(1)}px)`, opacity: 0.55 + 0.45 * Math.max(0, Math.sin(((frame - t0) / 9) * Math.PI * 2 - j * 1.1)) }} />)}
          </div>,
        );
        y += 92 + 18;
        return;
      }
      const k = popIn(d, 6, 1.6);
      const col = left ? them : me;
      out.push(
        <div key={i} style={{ position: 'absolute', top: yy, [left ? 'left' : 'right']: 0, display: 'flex', flexDirection: 'column', alignItems: left ? 'flex-start' : 'flex-end',
          transform: `translateY(${((1 - k) * 30).toFixed(1)}px) scale(${(0.7 + 0.3 * k).toFixed(3)})`, transformOrigin: left ? 'left bottom' : 'right bottom', opacity: Math.min(1, k * 1.5) } as React.CSSProperties}>
          {L.nameH > 0 && <span style={{ fontFamily: UI_BOLD.family, fontWeight: 800, fontSize: 28, color: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)', margin: '0 0 8px 22px' }}>{m.name}</span>}
          <div style={{ width: L.w, background: col.bg, color: col.ink, borderRadius: 40, [left ? 'borderBottomLeftRadius' : 'borderBottomRightRadius']: 10, padding: '22px 32px',
            fontFamily: UI.family, fontWeight: 700, fontSize: FS, lineHeight: `${LH}px`, boxShadow: '0 10px 24px rgba(0,0,0,0.18)' } as React.CSSProperties}>
            {L.lines.map((l, j) => <div key={j} style={{ whiteSpace: 'nowrap' }}>{l}</div>)}
          </div>
        </div>,
      );
      y += L.h + 18;
    });
    const hk = popIn(frame - s, 6);
    return (
      <div style={{ position: 'relative', width: 920, margin: '0 auto', height: VIS, marginTop: -40 }}>
        {title && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 108, display: 'flex', alignItems: 'center', gap: 22, padding: '0 10px',
            borderBottom: `2px solid ${dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)'}`, transform: `translateY(${((1 - hk) * -30).toFixed(1)}px)`, opacity: hk }}>
            <Avatar name={title} size={78} i={0} />
            <span style={{ fontFamily: UI_BOLD.family, fontWeight: 800, fontSize: fitSize(title, 46, 700, 1, 0.6, 28), color: dark ? '#fff' : '#111' }}>{title}</span>
          </div>
        )}
        <div style={{ position: 'absolute', top: headH, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${(-scroll).toFixed(1)}px)` }}>{out}</div>
        </div>
      </div>
    );
  };

/** A comment sheet: rows slide up into a white panel, the newest glows for a moment. */
const CommentSheet: React.FC<{ msgs: ChatMsg[]; title?: string; frame: number; s: number }> = ({ msgs, title, frame, s }) => {
  const FS = 58;
  const LH = FS * 1.2;
  const maxT = 640;
  const lay = msgs.map((m) => {
    const lines = wrapLines(m.text, UI, FS, maxT).slice(0, 4);
    return { lines, h: Math.max(104, lines.length * LH + (m.name ? 46 : 0)) + 44 };
  });
  const headH = 104;
  // the sheet is as tall as its comments (no empty white panel), up to the visible height
  const sheetH = Math.min(VIS, Math.max(380, headH + lay.reduce((h, x) => h + x.h, 0) + 24));
  const shownH = (fr: number) => msgs.reduce((h, m, i) => h + (fr >= m.f ? lay[i].h : 0), 0);
  const scroll = settle(frame, msgs.map((m) => m.f), (fr) => Math.max(0, shownH(fr) - (VIS - headH - 40)));
  const rise = interpolate(frame - s, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  let y = 0;
  return (
    <div style={{ position: 'relative', width: 960, height: sheetH, margin: '0 auto', marginTop: -40, background: '#fff', borderRadius: 40, boxShadow: '0 30px 70px rgba(0,0,0,0.45)',
      overflow: 'hidden', transform: `translateY(${((1 - rise) * 380).toFixed(1)}px)`, opacity: Math.min(1, rise * 2) }}>
      <div style={{ height: headH, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, borderBottom: '2px solid #eee' }}>
        <div style={{ width: 70, height: 8, borderRadius: 4, background: '#ddd' }} />
        <span style={{ fontFamily: UI_BOLD.family, fontWeight: 800, fontSize: 36, color: '#222' }}>{title || 'Komen'}</span>
      </div>
      <div style={{ position: 'absolute', top: headH, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: `translateY(${(-scroll).toFixed(1)}px)` }}>
          {msgs.map((m, i) => {
            const d = frame - m.f;
            if (d < 0) return null;
            const yy = y;
            y += lay[i].h;
            const k = interpolate(d, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
            const glow = interpolate(d, [0, 4, 30, 44], [0, 1, 1, 0], clamp);
            return (
              <div key={i} style={{ position: 'absolute', top: yy, left: 0, right: 0, height: lay[i].h, display: 'flex', gap: 24, padding: '20px 34px',
                background: `rgba(255,236,150,${(0.45 * glow).toFixed(3)})`, transform: `translateY(${((1 - k) * 40).toFixed(1)}px)`, opacity: k }}>
                <Avatar name={m.name} size={96} i={i} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {m.name && <span style={{ fontFamily: UI_BOLD.family, fontWeight: 800, fontSize: 34, color: '#8a8a8a' }}>{m.name}</span>}
                  {lay[i].lines.map((l, j) => <span key={j} style={{ fontFamily: UI.family, fontWeight: 700, fontSize: FS, lineHeight: `${LH}px`, color: '#161616', whiteSpace: 'nowrap' }}>{l}</span>)}
                </div>
                <div style={{ width: 70, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 10 }}>
                  <Heart size={48} filled={!!m.likes && d > 10} />
                  {m.likes && <span style={{ fontFamily: UI_BOLD.family, fontWeight: 800, fontSize: 28, color: '#8a8a8a' }}>{m.likes}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/** Notification banners dropping in from the top, the newest on top pushing the rest down. */
const NotifStack: React.FC<{ msgs: ChatMsg[]; title?: string; frame: number; accent: string }> = ({ msgs, title, frame, accent }) => {
  const FS = 46;
  const LH = FS * 1.22;
  const lay = msgs.map((m) => {
    const lines = wrapLines(m.text, UI, FS, 680).slice(0, 3);
    return { lines, h: 104 + lines.length * LH };
  });
  const GAP = 22;
  /** y of message i at frame fr (newest landed first), or null while it has not landed. */
  const yAt = (i: number, fr: number) => {
    if (fr < msgs[i].f) return null;
    let y = 0;
    for (let j = msgs.length - 1; j > i; j--) if (fr >= msgs[j].f) y += lay[j].h + GAP;
    return y;
  };
  const events = msgs.map((m) => m.f);
  return (
    <div style={{ position: 'relative', width: 940, height: VIS, margin: '0 auto', marginTop: -40 }}>
      {msgs.map((m, i) => {
        const d = frame - m.f;
        if (d < 0) return null;
        const y = settle(frame, events, (fr) => yAt(i, fr) ?? -lay[i].h - 60, 7);
        const k = interpolate(d, [0, 7], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.3)) });
        const fade = y + lay[i].h > VIS ? Math.max(0, 1 - (y + lay[i].h - VIS) / 160) : 1;
        if (fade <= 0) return null;
        const name = m.name || title || '';
        return (
          <div key={i} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: lay[i].h, transform: `translateY(${y.toFixed(1)}px) scale(${(0.94 + 0.06 * k).toFixed(3)})`,
            opacity: Math.min(k * 1.4, fade), background: 'rgba(248,248,250,0.97)', borderRadius: 40, padding: '24px 30px', display: 'flex', gap: 24,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)' }}>
            <div style={{ width: 100, height: 100, borderRadius: 26, background: accent, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="56" height="56" viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.8V3.5a1.5 1.5 0 0 0-3 0v.7A7 7 0 0 0 5 11v5l-2 2v1h18v-1z" fill="#fff" /></svg>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontFamily: UI_BOLD.family, fontWeight: 800, fontSize: 40, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden' }}>{name}</span>
                <span style={{ fontFamily: UI.family, fontWeight: 700, fontSize: 30, color: '#8a8a8a', marginLeft: 16 }}>sekarang</span>
              </div>
              {lay[i].lines.map((l, j) => <span key={j} style={{ fontFamily: UI.family, fontWeight: 700, fontSize: FS, lineHeight: `${LH}px`, color: '#262626', whiteSpace: 'nowrap' }}>{l}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── split (versus) ──────────────────────────────────────────────────────────

export type SplitSide = { title: string; tone?: string; items: { f: number; text: string }[] };

/** Two coloured halves side by side; titles slam, each item ticks / crosses on its word. Full frame. */
export const SplitBody: React.FC<{ sides: SplitSide[]; marks: boolean; frame: number; s: number; face: Face; colorOf: (t?: string) => string }> =
  ({ sides, marks, frame, s, face, colorOf }) => {
    const f = frame - s;
    const half = W / 2;
    const cols = [colorOf(sides[0].tone) || '#E5484D', colorOf(sides[1].tone) || '#25A55F'];
    const up = (t: string) => (face.upper ? t.toUpperCase() : t);
    const titleSize = Math.min(...sides.map((sd) => fitSize(up(sd.title), 112 * (face.charW < 0.5 ? 1.22 : 1), half - 90, 1, face.charW, 40)));
    const textW = marks ? half - 64 - 96 : half - 84;
    const all = sides.flatMap((sd) => sd.items.map((it) => up(it.text)));
    let size = Math.min(...all.map((t) => fitWrap(t, face, 78 * (face.charW < 0.5 ? 1.2 : 1), textW, 3, 30)));
    // the taller column must fit between the titles and the captions
    const colH = (sz: number) => Math.max(...sides.map((sd) => sd.items.reduce((h, it) => h + Math.max(84, wrapLines(up(it.text), face, sz, textW).length * sz * 1.06) + 46, 0)));
    while (size > 30 && colH(size) > 740) size -= 2;
    const vs = popIn(f - 6, 6, 2.2);
    return (
      <AbsoluteFill>
        {sides.slice(0, 2).map((sd, si) => {
          const k = interpolate(f, [0, 7], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          const x = si === 0 ? -(1 - k) * half : (1 - k) * half;
          const col = cols[si];
          const darkInk = col === '#FFD93B' || col === '#FFFFFF' || col === '#3DDC97';
          const ink = darkInk ? '#111' : '#fff';
          let y = 470;
          return (
            <div key={si} style={{ position: 'absolute', top: 0, bottom: 0, left: si === 0 ? 0 : half, width: half, background: col, transform: `translateX(${x.toFixed(1)}px)`, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: si === 0 ? 'linear-gradient(160deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.28) 100%)' : 'linear-gradient(200deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.28) 100%)' }} />
              <div style={{ position: 'absolute', top: 268, left: 0, right: 0, textAlign: 'center', fontFamily: face.family, fontWeight: face.weight, fontSize: titleSize, letterSpacing: face.track,
                color: ink, lineHeight: 1, textShadow: darkInk ? 'none' : '0 6px 0 rgba(0,0,0,0.22)',
                transform: `scale(${(1.5 - 0.5 * interpolate(f - 2 - si * 3, [0, 4], [0, 1], clamp)).toFixed(3)})`, opacity: f - 2 - si * 3 >= 0 ? 1 : 0 }}>{up(sd.title)}</div>
              {sd.items.map((it, i) => {
                const d = frame - it.f;
                const lines = wrapLines(up(it.text), face, size, textW);
                const h = Math.max(84, lines.length * size * 1.06);
                const yy = y;
                y += h + 46;
                if (d < 0) return null;
                const p = interpolate(d, [0, 5], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
                const draw = interpolate(d, [3, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
                const cross = si === 0;
                const tick = pathOf([[16, 40], [32, 56], [62, 20]]);
                const c1 = pathOf([[20, 20], [58, 58]]);
                const c2 = pathOf([[58, 20], [20, 58]]);
                return (
                  <div key={i} style={{ position: 'absolute', top: yy, left: 40, right: 24, display: 'flex', gap: 22, alignItems: 'flex-start',
                    transform: `translateX(${((1 - p) * (si === 0 ? -200 : 200)).toFixed(1)}px)`, opacity: Math.min(1, p * 1.6) }}>
                    {marks && (
                      <div style={{ width: 78, height: 78, borderRadius: 999, background: darkInk ? '#111' : '#fff', flexShrink: 0, position: 'relative', marginTop: Math.max(0, (size * 1.06 - 78) / 2) }}>
                        <svg width={78} height={78} viewBox="0 0 78 78" style={{ position: 'absolute', inset: 0 }}>
                          {cross
                            ? <><Stroke d={c1.d} len={c1.len} p={draw * 2} color={col} width={11} /><Stroke d={c2.d} len={c2.len} p={draw * 2 - 1} color={col} width={11} /></>
                            : <Stroke d={tick.d} len={tick.len} p={draw} color={col} width={12} />}
                        </svg>
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      {lines.map((l, j) => <span key={j} style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 1.06, letterSpacing: face.track, color: ink, whiteSpace: 'nowrap' }}>{l}</span>)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {/* the divider and the VS badge */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: half - 5, width: 10, background: '#fff', transform: `scaleY(${interpolate(f, [2, 9], [0, 1], clamp).toFixed(3)})`, transformOrigin: 'top center',
          boxShadow: '0 0 24px rgba(0,0,0,0.35)' }} />
        {vs > 0 && (
          <div style={{ position: 'absolute', left: half - 74, top: 1010, width: 148, height: 148, borderRadius: 999, background: '#111', border: '8px solid #fff', display: 'flex', alignItems: 'center',
            justifyContent: 'center', transform: `scale(${vs.toFixed(3)}) rotate(-8deg)`, boxShadow: '0 12px 30px rgba(0,0,0,0.45)' }}>
            <span style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 60, color: '#fff' }}>VS</span>
          </div>
        )}
      </AbsoluteFill>
    );
  };

// ── annotate (Vox style) ─────────────────────────────────────────────────────

export type NoteMark = 'highlight' | 'circle' | 'underline' | 'box';
export type Note = { f: number; word: string; note: string; mark: NoteMark };
const normW = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** A held sentence in the middle; each note marks its word and a hand connector draws to a handwritten note. Full frame. */
export const AnnotateBody: React.FC<{ text: string; notes: Note[]; frame: number; s: number; face: Face; dark: boolean; accent: string }> =
  ({ text, notes, frame, s, face, dark }) => {
    const f = frame - s;
    const shown = face.upper ? text.toUpperCase() : text;
    const maxW = W - 180;
    const size = fitWrap(shown, face, 112 * (face.charW < 0.5 ? 1.2 : 1), maxW, 3, 44);
    const lines = wrapLines(shown, face, size, maxW);
    const lh = size * 1.14;
    const blockH = lines.length * lh;
    const top = 880 - blockH / 2;
    // every word's box
    const words: { t: string; x: number; y: number; w: number; li: number; gi: number }[] = [];
    const space = textWidth(' ', face, size);
    lines.forEach((ln, li) => {
      const lw = textWidth(ln, face, size);
      let x = (W - lw) / 2;
      for (const t of ln.split(' ')) {
        const w = textWidth(t, face, size);
        words.push({ t, x, y: top + li * lh, w, li, gi: words.length });
        x += w + space;
      }
    });
    const ink = dark ? '#fff' : '#111';
    const noteCol = dark ? '#FFD93B' : '#E5262B';
    // each note's run of words (first match of its tokens, in order)
    const runs = notes.map((n) => {
      const toks = n.word.split(/\s+/).map(normW).filter(Boolean);
      if (!toks.length) return null;
      for (let i = 0; i + toks.length <= words.length; i++) {
        if (toks.every((tk, j) => normW(words[i + j].t) === tk || (j === toks.length - 1 && normW(words[i + j].t).startsWith(tk)))) return words.slice(i, i + toks.length);
      }
      const one = words.find((w) => normW(w.t).includes(toks[0]));
      return one ? [one] : null;
    });
    // highlighted words read dark on the yellow
    const lit = new Set<number>();
    notes.forEach((n, k) => {
      const r = runs[k];
      if (r && n.mark === 'highlight' && frame - n.f >= 4) r.forEach((w) => lit.add(w.gi));
    });
    const slots = [top - 250, top + blockH + 130, top - 440];
    return (
      <AbsoluteFill>
        {/* highlight sweeps (under the text) */}
        {notes.map((n, k) => {
          const r = runs[k];
          if (!r || n.mark !== 'highlight') return null;
          const p = interpolate(frame - n.f, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
          if (p <= 0) return null;
          const byLine = new Map<number, typeof r>();
          r.forEach((w) => byLine.set(w.li, [...(byLine.get(w.li) ?? []), w]));
          return [...byLine.values()].map((seg, j) => {
            const x0 = seg[0].x - size * 0.1;
            const x1 = seg[seg.length - 1].x + seg[seg.length - 1].w + size * 0.1;
            return <div key={`${k}-${j}`} style={{ position: 'absolute', left: x0, top: seg[0].y + size * 0.12, width: (x1 - x0) * p, height: size * 0.92, background: '#FFE45C',
              borderRadius: size * 0.08, transform: 'rotate(-1deg)' }} />;
          });
        })}
        {/* the sentence */}
        {words.map((w) => {
          const d = f - w.gi * 1.4;
          const p = interpolate(d, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          return <span key={w.gi} style={{ position: 'absolute', left: w.x, top: w.y, fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: `${lh}px`,
            letterSpacing: face.track, color: lit.has(w.gi) ? '#111' : ink, whiteSpace: 'nowrap', opacity: p, transform: `translateY(${((1 - p) * 40).toFixed(1)}px)` }}>{w.t}</span>;
        })}
        {/* marks, connectors, notes */}
        {notes.map((n, k) => {
          const r = runs[k];
          const d = frame - n.f;
          if (!r || d < 0 || k > 2) return null;
          const seg = r.filter((w) => w.li === r[0].li);
          const x0 = seg[0].x;
          const lastW = seg[seg.length - 1];
          // "TAMPAL," → the mark frames "TAMPAL"
          const x1 = lastW.x + textWidth(lastW.t.replace(/[^\p{L}\p{N}%]+$/u, '') || lastW.t, face, size);
          const cx = (x0 + x1) / 2;
          const above = k !== 1;
          const ny = slots[k];
          const noteSize = fitSize(n.note, 70, 760, 1, 0.62, 40);
          const nw = Math.min(800, textWidth(n.note, HAND_FACE, noteSize));
          const nx = Math.max(70, Math.min(W - 70 - nw, cx - nw / 2 + (k === 2 ? 60 : k === 0 ? -40 : 0)));
          // connector: from the note's edge to the word's edge
          const fromY = above ? ny + noteSize * 1.15 : ny - 12;
          const toY = above ? seg[0].y + size * 0.05 : seg[0].y + lh - size * 0.05;
          const a = roughArrow(Math.max(nx + 30, Math.min(nx + nw - 30, cx + (k === 1 ? 40 : -30))), fromY, cx, toY, 4242 + k * 97);
          const pa = interpolate(d, [6, 14], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
          const ph = interpolate(d, [14, 17], [0, 1], clamp);
          const pn = interpolate(d, [12, 24], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
          return (
            <React.Fragment key={`n${k}`}>
              {n.mark !== 'highlight' && (
                <div style={{ position: 'absolute', left: x0, top: seg[0].y + (lh - size * 1.02) / 2 }}>
                  <HandMark mark={n.mark} w={x1 - x0} h={size * 1.02} d={d + 5} color={noteCol} seed={seedFromNote(n, k)} />
                </div>
              )}
              <svg width={W} height={1920} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
                <Stroke d={a.shaft.d} len={a.shaft.len} p={pa} color={noteCol} width={7} />
                <Stroke d={a.head.d} len={a.head.len} p={ph} color={noteCol} width={7} />
              </svg>
              <div style={{ position: 'absolute', left: nx, top: ny, fontFamily: HAND, fontSize: noteSize, lineHeight: 1.15, color: noteCol, whiteSpace: 'nowrap',
                clipPath: `inset(-20% ${((1 - pn) * 100).toFixed(1)}% -20% -5%)`, transform: `rotate(${k % 2 ? 2 : -3}deg)` }}>{n.note}</div>
            </React.Fragment>
          );
        })}
      </AbsoluteFill>
    );
  };
const seedFromNote = (n: Note, k: number) => hashStr(`${n.word}|${n.note}|${k}`);

// ── word swap (a line entrance) ─────────────────────────────────────────────

/** A slot that rolls through `options` (≈ 5 frames each) and lands on `text` with a bump. */
export const SwapText: React.FC<{ text: string; options: string[]; d: number; style: React.CSSProperties; measure: (t: string) => number }> = ({ text, options, d, style, measure }) => {
  const seq = [...options, text];
  const hold = options.length > 3 ? 4 : 5;
  const wMax = Math.max(...seq.map((t) => measure(t)));
  if (d < 0) return <span style={{ ...style, display: 'inline-block', width: wMax, opacity: 0 }}>{text}</span>;
  const k = Math.min(seq.length - 1, Math.floor(d / hold));
  const inStep = d - k * hold;
  const roll = k < seq.length - 1 || inStep < 3 ? interpolate(inStep, [0, 3], [1, 0], { ...clamp, easing: Easing.out(Easing.cubic) }) : 0;
  const final = k === seq.length - 1;
  const bump = final ? interpolate(d - k * hold, [0, 2, 7], [1, 1.14, 1], clamp) : 1;
  return (
    <span style={{ ...style, display: 'inline-block', width: wMax, textAlign: 'center', overflow: 'hidden', verticalAlign: 'bottom' }}>
      <span style={{ display: 'inline-block', transform: `translateY(${(roll * 100).toFixed(1)}%) scale(${bump.toFixed(3)})`, opacity: final ? 1 : 0.85,
        filter: roll > 0.1 ? `blur(${(roll * 6).toFixed(1)}px)` : undefined }}>{seq[k]}</span>
    </span>
  );
};

// ── manga focus lines (a camera move on the speaker) ─────────────────────────

/** Radial speed lines around (cx, cy), clear inside radius r; they re-seed every 2 frames for 20 frames. */
export const FocusLines: React.FC<{ cx: number; cy: number; r: number; d: number; seed: number }> = ({ cx, cy, r, d, seed }) => {
  if (d < 0 || d > 22) return null;
  const k = interpolate(d, [0, 2, 15, 22], [0, 1, 1, 0], clamp);
  const rr = rng(seed + Math.floor(d / 2) * 7919);
  const N = 84;
  const R = 2400;
  const polys: string[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (rr() - 0.5) * 0.06;
    const da = 0.004 + rr() * 0.011;
    const rin = r * (1.15 + rr() * 0.55) * (1 - 0.12 * Math.min(1, d / 15));
    polys.push([
      `${(cx + Math.cos(a - da) * R).toFixed(0)},${(cy + Math.sin(a - da) * R).toFixed(0)}`,
      `${(cx + Math.cos(a) * rin).toFixed(0)},${(cy + Math.sin(a) * rin).toFixed(0)}`,
      `${(cx + Math.cos(a + da) * R).toFixed(0)},${(cy + Math.sin(a + da) * R).toFixed(0)}`,
    ].join(' '));
  }
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity: k }}>
      <AbsoluteFill style={{ background: `radial-gradient(circle ${Math.round(r * 1.5)}px at ${cx.toFixed(0)}px ${cy.toFixed(0)}px, rgba(0,0,0,0) 60%, rgba(0,0,0,0.32) 100%)` }} />
      <svg width={W} height={1920} style={{ position: 'absolute', inset: 0 }}>
        {polys.map((pt, i) => <polygon key={i} points={pt} fill="#fff" opacity={0.88} />)}
      </svg>
    </AbsoluteFill>
  );
};

// ── news banner (over the speaker) ──────────────────────────────────────────

export const BANNER_H = 236;

/** A blinking tag, the headline bar wiping open and a ticker; d = frames since it landed, out 1 → 0 on exit. */
export const NewsBanner: React.FC<{ tag: string; text: string; ticker?: string; d: number; out: number; top: number; face: Face; color?: string }> =
  ({ tag, text, ticker, d, out, top, face, color = '#E5262B' }) => {
    if (d < 0) return null;
    const t = interpolate(d, [0, 5], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    const bar = interpolate(d, [3, 11], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    const tk = interpolate(d, [9, 14], [0, 1], clamp);
    const head = face.upper ? text.toUpperCase() : text;
    const size = fitWrap(head, face, 64 * (face.charW < 0.5 ? 1.2 : 1), 940, 2, 32);
    const lines = wrapLines(head, face, size, 940);
    const blink = Math.floor(d / 15) % 2 === 0;
    const tape = ticker ? `${ticker.toUpperCase()}   •   ` : '';
    const tapeW = ticker ? textWidth(tape, UI_BOLD, 32) : 1;
    const shift = ticker ? (Math.max(0, d - 9) * 5) % tapeW : 0;
    return (
      <div style={{ position: 'absolute', left: 30, right: 30, top, opacity: out, transform: `translateY(${((1 - out) * -30).toFixed(1)}px)` }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, background: color, padding: '8px 22px', transform: `translateX(${((1 - t) * -600).toFixed(1)}px)`,
          boxShadow: '0 6px 0 rgba(0,0,0,0.25)' }}>
          <span style={{ width: 18, height: 18, borderRadius: 9, background: '#fff', opacity: blink ? 1 : 0.25 }} />
          <span style={{ fontFamily: "'Archivo Black', sans-serif", fontSize: 40, color: '#fff', letterSpacing: 1, lineHeight: 1.1 }}>{tag.toUpperCase()}</span>
        </div>
        <div style={{ background: '#fff', padding: '14px 26px', clipPath: `inset(0 ${((1 - bar) * 100).toFixed(1)}% 0 0)`, boxShadow: '0 10px 26px rgba(0,0,0,0.35)' }}>
          {lines.map((l, i) => <div key={i} style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 1.08, letterSpacing: face.track, color: '#111', whiteSpace: 'nowrap' }}>{l}</div>)}
        </div>
        {ticker && (
          <div style={{ height: 56, background: '#111', overflow: 'hidden', opacity: tk, position: 'relative' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, whiteSpace: 'nowrap', transform: `translateX(${(-shift).toFixed(1)}px)`, fontFamily: UI_BOLD.family, fontWeight: 800, fontSize: 32,
              lineHeight: '56px', color: '#fff' }}>{tape.repeat(Math.ceil((W * 2) / tapeW) + 1)}</div>
          </div>
        )}
      </div>
    );
  };

// ── speaker cut-out effects (props.cutouts: BiRefNet alpha video of the speaker) ─────────────────────

/** A huge word behind the speaker's head (the cut-out of the speaker is drawn over it): its lower third behind the top of the head. */
export const BehindText: React.FC<{ text: string; d: number; out: number; headTop: number; face: Face; color: string }> = ({ text, d, out, headTop, face, color }) => {
  if (d < 0) return null;
  const t = face.upper ? text.toUpperCase() : text;
  const size = Math.min(520, Math.floor((1000 * 100) / Math.max(1, textWidth(t, face, 100))));
  const p = interpolate(d, [0, 7], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: Math.max(220, headTop - size * 0.72), textAlign: 'center', fontFamily: face.family, fontWeight: face.weight, fontSize: size,
      lineHeight: 1.05, letterSpacing: face.track, color, whiteSpace: 'nowrap', opacity: Math.min(1, p * 1.5) * out,
      transform: `translateY(${((1 - p) * 60).toFixed(1)}px) scale(${(1.18 - 0.18 * p).toFixed(3)})`, textShadow: '0 12px 40px rgba(0,0,0,0.35)' }}>{t}</div>
  );
};

/** Where the speaker sticker sits over a scene: the face's centre moves to the corner, scaled down, white die-cut outline. */
export const stickerStyle = (side: 'left' | 'right', fx: number, fy: number, d: number): React.CSSProperties => {
  const k = 0.42;
  const tx = side === 'left' ? 230 : 850;
  // the frame's bottom edge (where the body is cut off) runs off the bottom of the screen
  const ty = Math.max(1440, 1920 - (1920 - fy) * k + 12);
  const p = spring01(d);
  const o = 5;
  return {
    transformOrigin: '0 0',
    transform: `translate(${(tx - fx * k).toFixed(1)}px, ${(ty - fy * k + (1 - p) * 700).toFixed(1)}px) scale(${k})`,
    filter: `drop-shadow(${o}px 0 0 #fff) drop-shadow(-${o}px 0 0 #fff) drop-shadow(0 ${o}px 0 #fff) drop-shadow(0 -${o}px 0 #fff) drop-shadow(0 18px 24px rgba(0,0,0,0.45))`,
  };
};
const spring01 = (d: number) => interpolate(d, [0, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.5)) });
