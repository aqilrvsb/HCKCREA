// Laju v2 "Pro" explainer scenes — full-screen motion-graphic scenes the
// director lays over the speaker while the voice keeps playing (the news /
// explainer TikTok style), plus big stacked "side" words beside the speaker.
// Every line, entry and sticker enters on its own spoken word.
//   build:    a small heading, then lines that slam or slide in (numbered points,
//             a stat build like "MDR · 0.35% · 0.6%", a closing question)
//   timeline: kicker + title, then entries (dot · date pill · two lines)
//   collage:  a ransom-note title (letter tiles), then stickers: notes, strips, bursts, tags
//   card:     heading + a picture card (the B-roll image of that moment) + caption
//   side:     1–3 big words stacked beside the speaker's head (scene-less)
// Backgrounds: dark (charcoal, warm glow, faint grid) · red · accent · paper · cork · yellow · blue.
// Entries: slam = 1.7× → 1 with a 10 px blur in 3 frames; slide = from the left with a blur in 4 frames.
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, useVideoConfig } from 'remotion';
import { W, clamp, fitSize } from '../../motion/src/lib';
import type { Look } from './look';

export type Tone = 'white' | 'yellow' | 'green' | 'red' | 'blue' | 'accent' | 'black';
export type Bg = 'dark' | 'red' | 'accent' | 'paper' | 'cork' | 'yellow' | 'blue';
export type PlacedLine = { f: number; text: string; tone?: Tone; box?: 'yellow' | 'black' | 'white' | 'accent' | 'none'; size?: 'sm' | 'md' | 'lg' | 'xl'; enter?: 'slam' | 'slide' };
export type PlacedEntry = { f: number; date: string; lines: string[]; tone?: Tone };
export type PlacedSticker = { f: number; text: string; sub?: string; kind: 'note' | 'strip' | 'burst' | 'tag'; tone?: Tone };
export type PlacedScene = {
  kind: 'build' | 'timeline' | 'collage' | 'card'; s: number; e: number; bg: Bg;
  heading?: string; kicker?: string; title?: string; caption?: string; image?: string;
  lines?: PlacedLine[]; entries?: PlacedEntry[]; stickers?: PlacedSticker[];
};
export type PlacedSide = { s: number; e: number; words: { f: number; text: string; tone?: Tone }[]; align: 'left' | 'right' };

const TOP = 300; // below TikTok's top tabs, room for the heading

export const toneColor = (t: Tone | undefined, look: Look, accent: string): string => {
  switch (t) {
    case 'yellow': return '#FFD93B';
    case 'green': return '#3DDC97';
    case 'red': return '#F2443F';
    case 'blue': return '#4FB3FF';
    case 'accent': return look.hi === '#FFD93B' ? accent : look.hi;
    case 'black': return '#111111';
    default: return '#FFFFFF';
  }
};

const BG_COLOR: Record<Bg, string> = {
  dark: '#121517', red: '#EF4B4F', accent: '#222', paper: '#E9E0CC', cork: '#8C6B4B', yellow: '#FFD93B', blue: '#2F7BFF',
};
/** Text on a light background reads dark. */
const lightBg = (bg: Bg) => bg === 'paper' || bg === 'yellow';

export const SceneBg: React.FC<{ bg: Bg; f: number; accent: string }> = ({ bg, f, accent }) => {
  const base = bg === 'accent' ? accent : BG_COLOR[bg];
  const drift = Math.sin(f / 70) * 30;
  return (
    <AbsoluteFill style={{ background: base }}>
      {bg === 'dark' && (
        <>
          <AbsoluteFill style={{ background: `radial-gradient(circle 360px at ${820 + drift}px 180px, rgba(255,196,90,0.22) 0%, rgba(255,196,90,0) 70%)` }} />
          <AbsoluteFill style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)', backgroundSize: '54px 54px' }} />
          <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)' }} />
        </>
      )}
      {(bg === 'red' || bg === 'accent' || bg === 'blue' || bg === 'yellow') && (
        <AbsoluteFill style={{ background: `linear-gradient(135deg, rgba(255,255,255,0) 55%, rgba(255,255,255,0.10) 55%, rgba(255,255,255,0.10) 80%, rgba(255,255,255,0) 80%)`, transform: `translateX(${drift}px)` }} />
      )}
      {(bg === 'paper' || bg === 'cork') && (
        <AbsoluteFill style={{
          backgroundImage: bg === 'paper'
            ? 'radial-gradient(rgba(0,0,0,0.06) 1px, transparent 1.6px), radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1.4px)'
            : 'radial-gradient(rgba(0,0,0,0.14) 1.2px, transparent 2px), radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1.6px)',
          backgroundSize: '9px 9px, 13px 13px', backgroundPosition: '0 0, 4px 6px',
        }} />
      )}
    </AbsoluteFill>
  );
};

/** Entry transform for a line / word landing at frame `d` frames after its cue (negative = not yet). */
const enterStyle = (d: number, kind: 'slam' | 'slide' = 'slam'): React.CSSProperties => {
  if (d < 0) return { opacity: 0 };
  if (kind === 'slide') {
    const p = interpolate(d, [0, 4], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    return { transform: `translateX(${(1 - p) * -420}px)`, filter: p < 0.98 ? `blur(${(12 * (1 - p)).toFixed(1)}px)` : undefined, opacity: Math.min(1, 0.4 + p) };
  }
  const p = interpolate(d, [0, 3], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return { transform: `scale(${1.7 - 0.7 * p})`, filter: p < 0.98 ? `blur(${(10 * (1 - p)).toFixed(1)}px)` : undefined, opacity: Math.min(1, 0.3 + p) };
};

const SIZE = { sm: 46, md: 86, lg: 122, xl: 188 };

const Line: React.FC<{ l: PlacedLine; frame: number; look: Look; accent: string; bg: Bg }> = ({ l, frame, look, accent, bg }) => {
  const face = look.display;
  const text = face.upper ? l.text.toUpperCase() : l.text;
  const base = SIZE[l.size ?? 'md'];
  const size = fitSize(text, base, W - 160, 1, face.charW, 30);
  const box = l.box && l.box !== 'none' ? l.box : null;
  const boxBg = box === 'yellow' ? '#FFD93B' : box === 'black' ? '#111' : box === 'white' ? '#fff' : box === 'accent' ? look.hi : 'transparent';
  let color = toneColor(l.tone, look, accent);
  if (box === 'yellow' || box === 'white' || (box === 'accent' && look.hi !== '#111111')) color = '#111';
  if (box === 'black') color = l.tone && l.tone !== 'white' && l.tone !== 'black' ? color : '#fff';
  if (!box && lightBg(bg) && (!l.tone || l.tone === 'white')) color = '#111';
  return (
    <div style={{ display: 'flex', justifyContent: 'center', ...enterStyle(frame - l.f, l.enter ?? (l.size === 'sm' ? 'slide' : 'slam')) }}>
      <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 1.02, letterSpacing: face.track, color,
        background: boxBg, padding: box ? `${size * 0.04}px ${size * 0.18}px` : 0, borderRadius: box ? 6 : 0,
        transform: box ? 'rotate(-1.2deg)' : undefined, whiteSpace: 'nowrap' }}>{text}</span>
    </div>
  );
};

const RANSOM_FONTS = ["'Archivo Black', sans-serif", "'Permanent Marker', cursive", "'Bebas Neue', sans-serif", "'Patrick Hand', cursive", "'Anton', sans-serif", "'Montserrat', sans-serif"];
const RANSOM_BG = ['#ffffff', '#111111', '#F2443F', '#FFD93B', '#4FB3FF', '#F6C1D3', '#ffffff'];
const hashN = (s: number) => { const x = Math.sin(s * 91.7 + 13.3) * 43758.5453; return x - Math.floor(x); };

const Ransom: React.FC<{ text: string; f: number }> = ({ text, f }) => {
  const letters = Array.from(text.toUpperCase());
  // tiles carry padding and gaps: ~1.12 em each, so the title always fits inside the frame
  const size = Math.min(92, Math.floor((W - 170) / Math.max(4, letters.length) / 1.12));
  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: size * 0.08 }}>
      {letters.map((ch, i) => {
        if (ch === ' ') return <span key={i} style={{ width: size * 0.45 }} />;
        const r = hashN(i + text.length * 7);
        const bg = RANSOM_BG[Math.floor(hashN(i * 3 + 1) * RANSOM_BG.length)];
        const dark = bg === '#111111' || bg === '#F2443F' || bg === '#4FB3FF';
        const on = f - i * 1.2 >= 0;
        return (
          <span key={i} style={{ display: 'inline-block', fontFamily: RANSOM_FONTS[Math.floor(r * RANSOM_FONTS.length)], fontSize: size * (0.8 + hashN(i + 5) * 0.3),
            background: bg, color: dark ? '#fff' : '#111', padding: `${size * 0.04}px ${size * 0.1}px`, lineHeight: 1.05,
            transform: `rotate(${(hashN(i + 9) - 0.5) * 14}deg) scale(${on ? 1 : 0})`, boxShadow: '3px 4px 0 rgba(0,0,0,0.25)' }}>{ch}</span>
        );
      })}
    </div>
  );
};

const Burst: React.FC<{ size: number; color: string }> = ({ size, color }) => {
  const n = 18;
  const pts = Array.from({ length: n * 2 }, (_, i) => {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? 0.82 : 1;
    return `${50 + Math.cos(a) * 50 * r},${50 + Math.sin(a) * 50 * r}`;
  }).join(' ');
  return <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: 'absolute', inset: 0 }}><polygon points={pts} fill={color} /></svg>;
};

const Sticker: React.FC<{ st: PlacedSticker; frame: number; look: Look; accent: string; i: number }> = ({ st, frame, look, accent, i }) => {
  const d = frame - st.f;
  if (d < 0) return null;
  const p = interpolate(d, [0, 4], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.8)) });
  const rot = (i % 2 ? 1 : -1) * (2 + (i % 3));
  const face = look.display;
  const text = st.text.toUpperCase();
  if (st.kind === 'burst') {
    const color = st.tone === 'red' ? '#F2443F' : st.tone === 'yellow' ? '#FFD93B' : st.tone === 'green' ? '#3DDC97' : '#8EC9EE';
    const size = 300;
    return (
      <div style={{ position: 'relative', width: size, height: size, transform: `scale(${p}) rotate(${rot * 2}deg)`, alignSelf: i % 2 ? 'flex-end' : 'center', marginRight: i % 2 ? 60 : 0 }}>
        <Burst size={size} color={color} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40 }}>
          <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(text, 64, 210, 2, face.charW, 28), color: '#111', lineHeight: 1 }}>{text}</span>
          {st.sub && <span style={{ fontFamily: face.family, fontSize: 24, color: '#111', marginTop: 6 }}>{st.sub.toUpperCase()}</span>}
        </div>
      </div>
    );
  }
  if (st.kind === 'note') {
    return (
      <div style={{ alignSelf: 'flex-start', marginLeft: 70, transform: `scale(${p}) rotate(${rot}deg)`, background: '#FFD93B', padding: '26px 34px', boxShadow: '8px 10px 0 rgba(0,0,0,0.28)',
        fontFamily: "'Anton', 'Bebas Neue', sans-serif", fontSize: fitSize(text, 84, 460, 2, 0.48, 40), lineHeight: 1.04, color: '#111', maxWidth: 520 }}>{text}</div>
    );
  }
  if (st.kind === 'strip') {
    const bg = st.tone === 'red' ? '#F2443F' : st.tone === 'yellow' ? '#FFD93B' : st.tone === 'blue' ? '#4FB3FF' : '#7FD7A6';
    return (
      <div style={{ alignSelf: 'flex-start', marginLeft: 50, transform: `translateX(${(1 - p) * -300}px) rotate(${-1.5}deg)`, background: bg, border: '4px solid #111',
        padding: '8px 22px', fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(text, 48, 900, 1, face.charW, 26), color: '#111' }}>{text}</div>
    );
  }
  // tag: black marker text on white tape
  return (
    <div style={{ alignSelf: i % 2 ? 'flex-end' : 'flex-start', margin: '0 70px', transform: `scale(${p}) rotate(${rot}deg)`, background: '#fff', padding: '8px 24px',
      boxShadow: '5px 6px 0 rgba(0,0,0,0.25)', fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(text, 52, 800, 1, face.charW, 26), color: toneColor(st.tone === 'white' ? 'black' : st.tone, look, accent) }}>{text}</div>
  );
};

export const ScenePro: React.FC<{ sc: PlacedScene; frame: number; look: Look; accent: string }> = ({ sc, frame, look, accent }) => {
  const { fps } = useVideoConfig();
  const f = frame - sc.s;
  const face = look.display;
  const dark = !lightBg(sc.bg);
  const ink = dark ? '#fff' : '#111';
  let body: React.ReactNode = null;
  if (sc.kind === 'build') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {sc.heading && (
          <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(sc.heading.toUpperCase(), 44, W - 200, 1, face.charW, 24), color: ink, marginBottom: 6,
            ...enterStyle(f, 'slide') }}>{sc.heading.toUpperCase()}</div>
        )}
        {(sc.lines ?? []).map((l, i) => <Line key={i} l={l} frame={frame} look={look} accent={accent} bg={sc.bg} />)}
      </div>
    );
  } else if (sc.kind === 'timeline') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 110px', gap: 26 }}>
        <div style={{ alignSelf: 'center', textAlign: 'center' }}>
          {sc.kicker && <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: 36, color: '#FFD93B', ...enterStyle(f, 'slide') }}>{sc.kicker.toUpperCase()}</div>}
          {sc.title && <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(sc.title.toUpperCase(), 64, W - 220, 1, face.charW, 30), color: ink, ...enterStyle(f - 2, 'slam') }}>{sc.title.toUpperCase()}</div>}
        </div>
        {(sc.entries ?? []).map((en, i) => {
          const d = frame - en.f;
          const col = toneColor(en.tone ?? (['green', 'red', 'yellow'] as Tone[])[i % 3], look, accent);
          return (
            <div key={i} style={{ display: 'flex', gap: 22, alignItems: 'flex-start', ...enterStyle(d, 'slide') }}>
              <div style={{ width: 30, height: 30, borderRadius: 99, border: `7px solid ${col}`, marginTop: 10, flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ alignSelf: 'flex-start', background: '#fff', color: '#111', fontFamily: face.family, fontWeight: face.weight, fontSize: 40, padding: '2px 14px',
                  transform: d >= 0 && d < 4 ? `skewX(${-14 * (1 - d / 4)}deg)` : undefined }}>{en.date.toUpperCase()}</span>
                {en.lines.slice(0, 2).map((t, j) => (
                  <span key={j} style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(t.toUpperCase(), 56, W - 340, 1, face.charW, 28), lineHeight: 1.05,
                    color: j === 0 ? ink : col }}>{t.toUpperCase()}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  } else if (sc.kind === 'collage') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 34 }}>
        {sc.title && <Ransom text={sc.title} f={f} />}
        {(sc.stickers ?? []).map((st, i) => <Sticker key={i} st={st} frame={frame} look={look} accent={accent} i={i} />)}
      </div>
    );
  } else if (sc.kind === 'card') {
    const p = interpolate(f, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
        {sc.heading && <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitSize(sc.heading.toUpperCase(), 46, W - 200, 1, face.charW, 24), color: dark ? '#FFD93B' : '#111', ...enterStyle(f, 'slide') }}>{sc.heading.toUpperCase()}</div>}
        <div style={{ width: 860, background: '#fff', padding: 18, borderRadius: 10, boxShadow: '0 30px 60px rgba(0,0,0,0.45)', transform: `translateY(${(1 - p) * 80}px) rotate(${-2 + (1 - p) * 4}deg) scale(${0.85 + 0.15 * p})` }}>
          {sc.image && <Img src={sc.image} style={{ width: '100%', height: 560, objectFit: 'cover', borderRadius: 4, display: 'block' }} />}
          {sc.caption && <div style={{ fontFamily: 'Georgia, serif', fontSize: fitSize(sc.caption, 40, 800, 2, 0.5, 26), color: '#222', padding: '16px 8px 6px', lineHeight: 1.25 }}>{sc.caption}</div>}
        </div>
      </div>
    );
  }
  void fps;
  return (
    <AbsoluteFill>
      <SceneBg bg={sc.bg} f={f} accent={accent} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: TOP }}>{body}</div>
    </AbsoluteFill>
  );
};

export const SideWords: React.FC<{ side: PlacedSide; frame: number; look: Look; accent: string }> = ({ side, frame, look, accent }) => {
  const face = look.display;
  const out = interpolate(frame, [side.e - 5, side.e], [1, 0], clamp);
  const longest = Math.max(...side.words.map((w) => w.text.length), 3);
  const size = Math.min(178, Math.floor(560 / (longest * face.charW)));
  return (
    <div style={{ position: 'absolute', top: 280, [side.align === 'left' ? 'left' : 'right']: 64, display: 'flex', flexDirection: 'column',
      alignItems: side.align === 'left' ? 'flex-start' : 'flex-end', opacity: out } as React.CSSProperties}>
      {side.words.map((w, i) => (
        <span key={i} style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 0.98, letterSpacing: face.track,
          color: toneColor(w.tone ?? (i === side.words.length - 1 ? 'yellow' : 'white'), look, accent), WebkitTextStroke: '6px rgba(0,0,0,0.0)',
          textShadow: '0 6px 18px rgba(0,0,0,0.45)', transformOrigin: side.align === 'left' ? 'left center' : 'right center',
          ...enterStyle(frame - w.f, 'slam') } as React.CSSProperties}>{face.upper ? w.text.toUpperCase() : w.text}</span>
      ))}
    </div>
  );
};
