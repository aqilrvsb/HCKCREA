// Laju v2 "Pro" captions — word-synced pages like motion/src/layers.tsx, with
// the treatment set by the video's look (look.ts):
//   active word: pop (scale 1.14 in 2 frames, back in 4) · colour · box · underline bar
//   keywords: colour, an optional marker-highlight sweep behind the word, and the
//             keyword emoji popping above it (back-out, ±6°) or beside it
//   page: enters scale 0.82→1 / y +40→0 in ~5 frames, leaves in 4 (fade + 0.95)
// The "tiktok" caption style (TikTok's own white box) stays the shared one.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { LottieEmoji } from './emoji';
import { TapeStrip } from '../../motion/src/guard';
import { Captions as SharedCaptions } from '../../motion/src/layers';
import { W, clamp, fitSize, popS } from '../../motion/src/lib';
import type { CaptionKey, CaptionStyle, KeyColor, LottieMap, Word } from '../../motion/src/types';
import type { Look } from './look';

type PWord = Word & { gi: number };
type Page = { words: PWord[]; start: number; end: number };

const KEY_COLOR: Record<KeyColor, string> = { benefit: '#4ade80', price: '#FFD93B', pain: '#f87171', brand: '#ffffff', accent: '#ffffff' };
const MAX_W = W - 220; // narrower than the frame: clear of TikTok's right-hand buttons

export const CaptionsPro: React.FC<{
  pages: Page[]; style: CaptionStyle; accent: string; centerY: number; look: Look;
  keywords?: CaptionKey[]; lottie?: LottieMap; gempak?: boolean; censor?: number[];
  /** explainer look: small words building one by one (the graphics carry the message) */
  subtle?: boolean;
}> = (props) => {
  const { pages, style, centerY, look, keywords, lottie, gempak, censor, subtle } = props;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (subtle) return <SubtleCaptions pages={pages} centerY={centerY} look={look} keywords={keywords} censor={censor} />;
  if (style === 'tiktok') {
    return <SharedCaptions pages={pages} style={style} accent={props.accent} centerY={centerY} keywords={keywords} lottie={lottie} gempak={gempak} censor={censor} />;
  }
  const t = frame / fps;
  const page = pages.find((p) => t >= p.start - 0.06 && t < p.end);
  if (!page) return null;
  const hi = look.hi;
  const keyOf = new Map<number, CaptionKey>((keywords ?? []).map((k) => [k.i, k]));
  const taped = new Set(censor ?? []);
  const face = look.caption;
  const text = page.words.map((w) => w.w).join(' ');
  const base = face.charW < 0.5 ? 122 : 98; // condensed faces run larger
  const size = fitSize(face.upper ? text.toUpperCase() : text, base, MAX_W, 2, face.charW, 44);
  const pf = Math.round((t - page.start) * fps);
  const enter = popS(pf + 2, fps, 300, 18);
  const leaveF = Math.round((page.end - t) * fps);
  const leave = leaveF < 4 ? leaveF / 4 : 1;
  let cur = -1;
  page.words.forEach((w, k) => { if (t >= w.t - 0.02) cur = k; });
  const active = style === 'box' ? 'box' : style === 'karaoke' ? 'color' : look.active;
  const stroke = Math.max(7, Math.round(size / 8));
  let emojiSeen = false;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: (W - MAX_W) / 2 - 20, width: MAX_W + 40, top: centerY,
        transform: `translateY(-50%) translateY(${(1 - enter) * 40}px) scale(${(0.82 + 0.18 * enter) * (0.95 + 0.05 * leave)})`, opacity: leave,
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: size * 0.32, rowGap: size * 0.12 }}>
        {page.words.map((w, k) => {
          const spoken = k <= cur;
          const isCur = k === cur;
          const wf = Math.round((t - w.t) * fps);
          if (taped.has(w.gi)) {
            const tw = Math.max(size * 1.4, w.w.length * size * face.charW * 0.95);
            return (
              <span key={k} style={{ display: 'inline-block', width: tw, height: size * 0.95, verticalAlign: 'middle', transform: `rotate(${(w.gi % 3) - 1.5}deg)` }}>
                <TapeStrip w={tw} h={size * 0.95} seed={w.gi + 3} />
              </span>
            );
          }
          const key = keyOf.get(w.gi);
          const keyCol = key ? (key.color === 'brand' || key.color === 'accent' ? hi : KEY_COLOR[key.color]) : null;
          // active pop: up to 1.14 in 2 frames, back over 4
          const pop = isCur && active === 'pop' ? interpolate(wf, [0, 2, 6], [1, 1.14, 1.05], { ...clamp, easing: Easing.out(Easing.cubic) }) : 1;
          const marker = look.marker && keyCol && spoken
            ? interpolate(wf, [0, 12], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) }) : 0;
          const showEmoji = !!(key?.emoji && spoken && !emojiSeen);
          if (showEmoji) emojiSeen = true;
          const es = popS(wf, fps, 360, 11);
          const color = marker > 0 ? '#111' : isCur && active === 'box' ? '#111' : keyCol && spoken ? keyCol : (isCur && active !== 'underline') ? hi
            : style === 'karaoke' && !spoken ? 'rgba(255,255,255,0.42)' : '#fff';
          const word = face.upper ? w.w.toUpperCase() : w.w;
          return (
            <span key={k} style={{ position: 'relative', display: 'inline-block', transform: `scale(${pop}) translateY(${spoken ? 0 : 2}px)`, transformOrigin: 'center bottom' }}>
              {marker > 0 && (
                <span style={{ position: 'absolute', left: -size * 0.12, right: -size * 0.12, top: size * 0.12, bottom: size * 0.04, background: keyCol ?? hi,
                  borderRadius: size * 0.1, transform: `scaleX(${marker}) rotate(-1.5deg)`, transformOrigin: 'left center', opacity: 0.95 }} />
              )}
              {isCur && active === 'box' && (
                <span style={{ position: 'absolute', left: -size * 0.14, right: -size * 0.14, top: size * 0.04, bottom: 0, background: keyCol ?? hi,
                  borderRadius: size * 0.16, transform: `rotate(-2deg) scale(${0.9 + 0.1 * popS(wf, fps, 420, 14)})` }} />
              )}
              <span style={{ position: 'relative', fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 1.08, letterSpacing: face.track,
                color, WebkitTextStroke: color === '#111' ? '0px' : `${stroke}px #000`, paintOrder: 'stroke fill',
                textShadow: color === '#111' ? 'none' : '0 6px 14px rgba(0,0,0,0.55)' } as React.CSSProperties}>{word}</span>
              {isCur && active === 'underline' && (
                <span style={{ position: 'absolute', left: 0, right: 0, bottom: -size * 0.12, height: Math.max(8, size * 0.11), borderRadius: 99,
                  background: hi, transform: `scaleX(${interpolate(wf, [0, 4], [0, 1], clamp)})`, transformOrigin: 'left center', boxShadow: '0 3px 0 #000' }} />
              )}
              {showEmoji && (look.emojiAbove ? (
                <span style={{ position: 'absolute', left: '50%', bottom: '100%', marginLeft: -size * 0.55, marginBottom: size * 0.05,
                  transform: `scale(${es}) rotate(${(w.gi % 2 ? 6 : -6) * es}deg)`, transformOrigin: '50% 100%' }}>
                  <LottieEmoji char={key!.emoji!} size={size * 1.1} lottie={lottie} />
                </span>
              ) : (
                <span style={{ display: 'inline-block', marginLeft: size * 0.12, verticalAlign: 'middle', transform: `scale(${es}) rotate(${(w.gi % 2 ? 6 : -6) * es}deg)` }}>
                  <LottieEmoji char={key!.emoji!} size={size * 1.0} lottie={lottie} />
                </span>
              ))}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Explainer captions: small caps words that build as they are spoken, the next word
// faintly previewed; keywords take their colour. No pops — the scenes are the show.
const SubtleCaptions: React.FC<{ pages: Page[]; centerY: number; look: Look; keywords?: CaptionKey[]; censor?: number[] }> = ({ pages, centerY, look, keywords, censor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const page = pages.find((p) => t >= p.start - 0.06 && t < p.end);
  if (!page) return null;
  const keyOf = new Map<number, CaptionKey>((keywords ?? []).map((k) => [k.i, k]));
  const taped = new Set(censor ?? []);
  const face = look.caption;
  let cur = -1;
  page.words.forEach((w, k) => { if (t >= w.t - 0.02) cur = k; });
  const size = face.charW < 0.5 ? 66 : 54;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', left: 110, right: 150, top: centerY, transform: 'translateY(-50%)', display: 'flex', flexWrap: 'wrap',
        justifyContent: 'center', columnGap: size * 0.3, rowGap: 4 }}>
        {page.words.map((w, k) => {
          if (k > cur + 1) return null;
          const key = keyOf.get(w.gi);
          const col = taped.has(w.gi) ? '#d9ccaa' : key ? (key.color === 'brand' || key.color === 'accent' ? look.hi : KEY_COLOR[key.color]) : '#fff';
          return (
            <span key={k} style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size, letterSpacing: 1, color: col, opacity: k <= cur ? 1 : 0.32,
              textShadow: '0 3px 10px rgba(0,0,0,0.6)', WebkitTextStroke: '2px rgba(0,0,0,0.35)', paintOrder: 'stroke fill' } as React.CSSProperties}>
              {taped.has(w.gi) ? '▇▇▇' : w.w.toUpperCase()}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
