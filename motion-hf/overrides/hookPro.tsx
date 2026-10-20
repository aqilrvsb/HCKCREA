// Laju v2 "Pro" hook titles — six styles (the video's look picks one). All
// sit in the band between TikTok's top tabs (y ≥ 250) and the speaker's face,
// show their first word on frame 0, have every word in by ~0.5 s, hold, and
// clear in the last 7 frames of the hook.
//   slam:   words slam in 1.6→1 with a 12→0 px blur, key word on a highlight block
//   rise:   words rise from below, blur-to-sharp cascade, key word in the accent colour
//   blocks: each line on its own colour block, sliding in from alternate sides
//   marker: the line lands at once, then a marker sweeps the key word and an underline draws
//   stack:  one word per line in the display face, popping in turn, colours alternating
//   headline: the news-explainer title — white stroked line(s), then the last part wiped in on a colour box
import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useVideoConfig } from 'remotion';
import { W, clamp, fitSize } from '../../motion/src/lib';
import type { Look } from './look';

const TOP = 260;

/** The word that carries the hook: the longest (ties → the later one). */
const keyIndex = (words: string[]) => {
  let key = 0;
  words.forEach((w, i) => { if (w.replace(/[^\p{L}\p{N}]/gu, '').length >= words[key].replace(/[^\p{L}\p{N}]/gu, '').length) key = i; });
  return key;
};

/** Greedy line breaking for the measured face. */
const toLines = (words: string[], size: number, charW: number, maxW: number) => {
  const lines: number[][] = [[]];
  let width = 0;
  words.forEach((w, i) => {
    const ww = w.length * size * charW;
    const add = (lines[lines.length - 1].length ? size * 0.3 : 0) + ww;
    if (lines[lines.length - 1].length && width + add > maxW) { lines.push([i]); width = ww; } else { lines[lines.length - 1].push(i); width += add; }
  });
  return lines;
};

const splitWords = (s: string, upper: boolean) => {
  const raw = s.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return upper ? raw.map((w) => w.toUpperCase()) : raw;
};

/** "headline": the title in white (stroked) lines, then its last part on a colour box — the news-explainer hook. */
function headlineLayout(text: string, sub: string | undefined, look: Look) {
  const face = look.display;
  const maxW = W - 130;
  let top = splitWords(text, face.upper).slice(0, 12);
  let box = sub ? splitWords(sub, face.upper).slice(0, 6) : [];
  const size = fitSize(top.join(' '), face.charW < 0.5 ? 132 : 104, maxW, 2, face.charW, 52);
  let lines = toLines(top, size, face.charW, maxW);
  if (!box.length && lines.length > 1) {
    box = lines[lines.length - 1].map((i) => top[i]);
    top = top.slice(0, lines[lines.length - 1][0]);
    lines = toLines(top, size, face.charW, maxW);
  } else if (!box.length && top.length >= 3) {
    const cut = Math.ceil(top.length * 0.55);
    box = top.slice(cut);
    top = top.slice(0, cut);
    lines = toLines(top, size, face.charW, maxW);
  }
  const boxSize = box.length ? Math.min(size, fitSize(box.join(' '), size, maxW - 60, 1, face.charW, 40)) : 0;
  return { size, top, lines, box, boxSize, height: lines.length * size * 1.06 + (box.length ? boxSize * 1.24 + 14 : 0) };
}

/** Where the hook's text block ends (y, px): a float card shown during the hook sits below it. */
export function hookBottom(text: string, sub: string | undefined, look: Look, faceTop: number): number {
  if (look.hook === 'headline') return TOP + headlineLayout(text, sub, look).height;
  const face = look.display;
  const words = splitWords(text, face.upper).slice(0, 12);
  const room = Math.max(300, Math.min(600, faceTop - 50 - TOP - (sub ? 96 : 0)));
  if (look.hook === 'stack') return TOP + room + (sub ? 96 : 0);
  const maxW = W - 130;
  let size = fitSize(words.join(' '), face.charW < 0.5 ? 190 : 150, maxW, 3, face.charW, 64);
  let lines = toLines(words, size, face.charW, maxW);
  while (size > 64 && lines.length * size * 1.06 > room) { size -= 4; lines = toLines(words, size, face.charW, maxW); }
  return TOP + lines.length * size * (look.hook === 'blocks' ? 1.18 : 1.06) + (sub ? 96 : 0);
}

const Headline: React.FC<{ text: string; sub?: string; frame: number; end: number; look: Look }> = ({ text, sub, frame, end, look }) => {
  const { fps } = useVideoConfig();
  const face = look.display;
  const L = headlineLayout(text, sub, look);
  const out = interpolate(frame, [end - 7, end], [0, 1], clamp);
  const stroke = Math.max(6, Math.round(L.size / 10));
  const wipe = interpolate(frame, [5, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.25) 26%, rgba(0,0,0,0) 42%)', opacity: 1 - out }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: TOP, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 1 - out, transform: `translateY(${-out * 40}px)` }}>
        {L.lines.map((ln, li) => {
          const s = spring({ frame: frame - li * 2 + 3, fps, config: { damping: 16, stiffness: 240, mass: 0.7 } });
          return (
            <div key={li} style={{ display: 'flex', justifyContent: 'center', columnGap: L.size * 0.26, height: L.size * 1.06, opacity: Math.min(1, s * 1.4), transform: `translateY(${(1 - s) * -30}px)` }}>
              {ln.map((i) => (
                <span key={i} style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: L.size, lineHeight: 1.04, letterSpacing: face.track, color: '#fff',
                  WebkitTextStroke: `${stroke}px #000`, paintOrder: 'stroke fill', textShadow: '0 6px 0 rgba(0,0,0,0.3)' } as React.CSSProperties}>{L.top[i]}</span>
              ))}
            </div>
          );
        })}
        {L.box.length > 0 && (
          <div style={{ marginTop: 14, background: look.hi, padding: `${L.boxSize * 0.04}px ${L.boxSize * 0.22}px`, borderRadius: 6, transform: 'rotate(-1deg)',
            clipPath: `inset(0 ${((1 - wipe) * 100).toFixed(1)}% 0 0)`, boxShadow: '0 10px 0 rgba(0,0,0,0.3)' }}>
            <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: L.boxSize, lineHeight: 1.1, letterSpacing: face.track, color: '#111', whiteSpace: 'nowrap' }}>{L.box.join(' ')}</span>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const HookPro: React.FC<{ text: string; sub?: string; frame: number; end: number; look: Look; faceTop: number }> = ({ text, sub, frame, end, look, faceTop }) => {
  const { fps } = useVideoConfig();
  if (look.hook === 'headline') return <Headline text={text} sub={sub} frame={frame} end={end} look={look} />;
  const face = look.display;
  const words = splitWords(text, face.upper).slice(0, 12);
  const key = keyIndex(words);
  const room = Math.max(300, Math.min(600, faceTop - 50 - TOP - (sub ? 96 : 0)));
  const maxW = W - 130;
  const stack = look.hook === 'stack';
  let size = stack ? Math.min(200, Math.floor(room / Math.min(words.length, 5) / 1.0)) : fitSize(words.join(' '), face.charW < 0.5 ? 190 : 150, maxW, 3, face.charW, 64);
  let lines = stack ? words.map((_, i) => [i]) : toLines(words, size, face.charW, maxW);
  while (!stack && size > 64 && lines.length * size * 1.06 > room) { size -= 4; lines = toLines(words, size, face.charW, maxW); }
  if (stack && words.length > 5) { size = Math.floor(room / 5); }
  const out = interpolate(frame, [end - 7, end], [0, 1], clamp);
  const stroke = Math.max(7, Math.round(size / 9));
  const lineH = size * (stack ? 0.98 : 1.06);

  const wordEl = (i: number, extra: React.CSSProperties = {}, color = '#fff', strokeOn = true) => (
    <span key={i} style={{ position: 'relative', display: 'inline-block', fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 1.04,
      letterSpacing: face.track, color, WebkitTextStroke: strokeOn ? `${stroke}px #000` : '0px', paintOrder: 'stroke fill',
      textShadow: strokeOn ? '0 8px 0 rgba(0,0,0,0.32)' : 'none', ...extra } as React.CSSProperties}>{words[i]}</span>
  );
  const exitFor = (i: number) => Math.min(1, Math.max(0, frame - (end - 7) - i * 0.6) / 6);

  let body: React.ReactNode;
  if (look.hook === 'blocks') {
    body = lines.map((ln, li) => {
      const d = frame - li * 4 + 4;
      const s = spring({ frame: d, fps, config: { damping: 15, stiffness: 260, mass: 0.7 } });
      const from = li % 2 ? 1 : -1;
      const hasKey = ln.includes(key);
      const ex = exitFor(li);
      return (
        <div key={li} style={{ display: 'flex', justifyContent: 'center', transform: `translateX(${(1 - s) * from * 700 + ex * from * -200}px) rotate(${from * -1.5}deg)`, opacity: (d >= 0 ? 1 : 0) * (1 - ex) }}>
          <div style={{ display: 'flex', columnGap: size * 0.26, alignItems: 'baseline', background: hasKey ? look.hi : look.second === '#ffffff' ? '#ffffff' : '#111',
            padding: `${size * 0.04}px ${size * 0.22}px`, borderRadius: size * 0.08, boxShadow: '0 12px 0 rgba(0,0,0,0.35)' }}>
            {ln.map((i) => wordEl(i, {}, hasKey || look.second === '#ffffff' ? '#111' : '#fff', false))}
          </div>
        </div>
      );
    });
  } else {
    body = lines.map((ln, li) => (
      <div key={li} style={{ display: 'flex', justifyContent: 'center', columnGap: size * 0.26, height: lineH }}>
        {ln.map((i) => {
          const isKey = i === key;
          const ex = exitFor(i);
          if (look.hook === 'rise') {
            const d = frame - i * 2 + 4;
            const s = spring({ frame: d, fps, config: { damping: 16, stiffness: 220, mass: 0.7 } });
            return wordEl(i, { opacity: (d >= 0 ? Math.min(1, s * 1.3) : 0) * (1 - ex), transform: `translateY(${(1 - s) * 70 - ex * 50}px)`,
              filter: s < 0.96 ? `blur(${(10 * (1 - s)).toFixed(1)}px)` : undefined }, isKey ? look.hi : '#fff');
          }
          if (look.hook === 'marker') {
            const land = spring({ frame: frame + 6, fps, config: { damping: 18, stiffness: 240, mass: 0.7 } });
            const sweep = interpolate(frame, [6, 16], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) });
            const draw = interpolate(frame, [12, 22], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
            return (
              <span key={i} style={{ position: 'relative', display: 'inline-block', opacity: (1 - ex), transform: `scale(${0.9 + 0.1 * land}) translateY(${-ex * 50}px)` }}>
                {isKey && <span style={{ position: 'absolute', left: -size * 0.1, right: -size * 0.1, top: size * 0.16, bottom: size * 0.02, background: look.hi,
                  borderRadius: size * 0.1, transform: `scaleX(${sweep}) rotate(-1.5deg)`, transformOrigin: 'left center' }} />}
                {wordEl(i, {}, isKey ? '#111' : '#fff', !isKey)}
                {isKey && (
                  <svg width="100%" height={size * 0.3} viewBox="0 0 100 20" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, bottom: -size * 0.24, overflow: 'visible' }}>
                    <path d="M2 12 C 25 4, 50 18, 98 8" fill="none" stroke={look.second === '#111111' ? '#fff' : look.second} strokeWidth={5} strokeLinecap="round"
                      pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
                  </svg>
                )}
              </span>
            );
          }
          // slam / stack
          const d = frame - i * 3 + 5;
          const s = spring({ frame: d, fps, config: { damping: 13, stiffness: 330, mass: 0.6 } });
          const vis = d >= 0 ? Math.min(1, (d + 1) / 2) : 0;
          const hl = interpolate(d, [4, 9], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
          const color = stack ? (i % 2 ? look.hi : '#fff') : isKey ? '#111' : '#fff';
          return (
            <span key={i} style={{ position: 'relative', display: 'inline-block', opacity: vis * (1 - ex),
              filter: s < 0.97 ? `blur(${(12 * (1 - s)).toFixed(1)}px)` : undefined,
              transform: `translateY(${(1 - s) * -34 - ex * 60}px) scale(${1.6 - 0.6 * s}) rotate(${isKey && !stack ? -2 : stack ? (i % 2 ? 2 : -2) : 0}deg)` }}>
              {isKey && !stack && <span style={{ position: 'absolute', left: -size * 0.14, right: -size * 0.14, top: size * 0.06, bottom: size * 0.02, background: look.hi,
                borderRadius: size * 0.12, transform: `scaleX(${hl})`, transformOrigin: 'left center', boxShadow: '0 10px 0 rgba(0,0,0,0.3)' }} />}
              {wordEl(i, {}, color, !(isKey && !stack))}
            </span>
          );
        })}
      </div>
    ));
  }

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.34) 28%, rgba(0,0,0,0) 48%)', opacity: 1 - out }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: TOP, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: look.hook === 'blocks' ? size * 0.12 : 0 }}>
        {body}
        {sub && (
          <div style={{ marginTop: 22, opacity: interpolate(frame, [8, 13], [0, 1], clamp) * (1 - out) }}>
            <div style={{ fontFamily: "'Permanent Marker', cursive", fontSize: fitSize(sub, 52, W - 260, 1, 0.6), color: '#111', background: '#fff', padding: '6px 26px',
              transform: `rotate(-2deg) translateX(${interpolate(frame, [8, 14], [-80, 0], { ...clamp, easing: Easing.out(Easing.back(1.6)) })}px)`,
              boxShadow: '6px 8px 0 rgba(0,0,0,0.35)' }}>{sub}</div>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
