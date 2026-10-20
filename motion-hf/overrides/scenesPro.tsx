// Laju v2 "Pro" explainer scenes — full-screen motion-graphic scenes the
// director lays over the speaker while the voice keeps playing (the news /
// explainer TikTok style), plus big stacked "side" words beside the speaker.
// Every line, entry and sticker enters on its own spoken word.
//   build:    a small heading, then lines that slam or slide in (numbered points,
//             a stat build like "MDR · 0.35% · 0.6%", a closing question)
//   timeline: kicker + title, then entries (dot · date pill · two lines)
//   collage:  a ransom-note title (letter tiles), then stickers: notes, strips, bursts, tags
//   card:     heading + a picture card (the B-roll image of that moment) + caption, as a
//             polaroid, a web-article card (source · date · headline · picture, highlighter
//             sweep on chosen words) or a FLOAT card over the speaker with a badge ("VIRAL")
//   compare:  2–4 columns (value · bar · label) that grow on their words — a vs b, before / after
//   side:     1–3 big words beside the speaker's head (sizes mixed, or one huge word centred)
// Lines can strike through, get a marker sweep or count up to their number, get a hand-drawn circle /
// underline / arrow / box or sparkles, enter as type / scramble / letters / rise, carry an animated emoji.
//   checklist · steps · ring and the phone card, notebook / chalk / grid / gradient backgrounds: scenesKit.tsx
// Backgrounds: dark (charcoal, warm glow, faint grid) · red · accent · paper · cork · yellow · blue.
// Entries: slam = 1.7× → 1 with a 10 px blur in 3 frames; slide = from the left with a blur in 4 frames.
import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, useVideoConfig } from 'remotion';
import { W, clamp, fitSize } from '../../motion/src/lib';
import type { Look } from './look';
import { LottieEmoji } from './emoji';
import type { LottieMap } from '../../motion/src/types';
import {
  ChecklistBody, EnterText, HandMark, KitBackground, PhoneCard, RingsBody, Sparkles, StepsBody, kitBgLight, seedOf, textWidth,
  type CheckItem, type KitBg, type Mark, type Ring, type Step, type TextEnter,
} from './scenesKit';

export type Tone = 'white' | 'yellow' | 'green' | 'red' | 'blue' | 'accent' | 'black';
export type Bg = 'dark' | 'red' | 'accent' | 'paper' | 'cork' | 'yellow' | 'blue' | KitBg;
export type LineFx = 'strike' | 'marker' | 'count' | Mark | 'sparkle';
export type LineEnter = 'slam' | 'slide' | TextEnter;
export type PlacedLine = { f: number; text: string; tone?: Tone; box?: 'yellow' | 'black' | 'white' | 'accent' | 'none'; size?: 'sm' | 'md' | 'lg' | 'xl'; enter?: LineEnter; fx?: LineFx; emoji?: string };
export type PlacedEntry = { f: number; date: string; lines: string[]; tone?: Tone };
export type PlacedSticker = { f: number; text: string; sub?: string; kind: 'note' | 'strip' | 'burst' | 'tag'; tone?: Tone };
export type PlacedBar = { f: number; label: string; value: string; tone?: Tone };
export type CardStyle = 'polaroid' | 'article' | 'float' | 'phone';
export type SceneEnter = 'cut' | 'push' | 'zoom' | 'whip' | 'wipe' | 'rise' | 'iris';
export type { CheckItem, Ring, Step };
export type PlacedScene = {
  kind: 'build' | 'timeline' | 'collage' | 'card' | 'compare' | 'checklist' | 'steps' | 'ring'; s: number; e: number; bg: Bg;
  heading?: string; kicker?: string; title?: string; caption?: string; image?: string;
  /** card look; a float card sits over the speaker (no background) at `top`, scaled by `scale` */
  style?: CardStyle; source?: string; date?: string; badge?: string; highlight?: string[]; top?: number; scale?: number;
  enter?: SceneEnter;
  lines?: PlacedLine[]; entries?: PlacedEntry[]; stickers?: PlacedSticker[]; bars?: PlacedBar[];
  items?: CheckItem[]; steps?: Step[]; rings?: Ring[];
};
export type SideSize = 'sm' | 'md' | 'lg';
export type PlacedSide = { s: number; e: number; words: { f: number; text: string; tone?: Tone; size?: SideSize }[]; align: 'left' | 'right' | 'center' };

const TOP = 400; // the content block sits in the upper-middle of the frame, like a pro explainer
const TOP_BUILD = 450; // builds grow downward from a little lower (≤ 6 lines end above the captions)

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
  notebook: '#FBF8EF', chalk: '#1E3A2F', grid: '#F5F6F1', gradient: '#160F2E',
};
const KIT_BGS = new Set<string>(['notebook', 'chalk', 'grid', 'gradient']);
/** Text on a light background reads dark. */
const lightBg = (bg: Bg) => bg === 'paper' || bg === 'yellow' || kitBgLight(bg);

export const SceneBg: React.FC<{ bg: Bg; f: number; accent: string }> = ({ bg, f, accent }) => {
  if (KIT_BGS.has(bg)) return <KitBackground bg={bg as KitBg} f={f} accent={accent} />;
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

/** fitSize for the display face: a condensed face (Anton, Bebas) reads ~20 % smaller at the same size, so it gets more. */
const fitFace = (text: string, base: number, width: number, lines: number, face: Look['display'], min: number) =>
  fitSize(text, base * (face.charW < 0.5 ? 1.22 : 1), width, lines, face.charW, min);

const SIZE = { sm: 64, md: 118, lg: 160, xl: 224 };

const normWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** The first number in `text` counted up from 0 (d frames after the cue), separators kept. */
const countText = (text: string, d: number) => {
  const m = text.match(/\d[\d.,]*/);
  if (!m || m.index === undefined) return text;
  const raw = m[0].replace(/[.,]$/, '');
  const thousands = /^\d{1,3}([,.]\d{3})+$/.test(raw);
  const sep = thousands ? raw.replace(/\d/g, '')[0] : '';
  const decSep = !thousands && /[.,]/.test(raw) ? raw.replace(/\d/g, '')[0] : '';
  const num = parseFloat(thousands ? raw.split(sep).join('') : raw.replace(',', '.'));
  if (!Number.isFinite(num)) return text;
  const dec = decSep ? (raw.split(decSep)[1] ?? '').length : 0;
  const p = interpolate(d, [0, 16], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  let v = (num * p).toFixed(dec);
  if (thousands) v = Math.round(num * p).toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  else if (decSep === ',') v = v.replace('.', ',');
  return text.slice(0, m.index) + v + text.slice(m.index + raw.length);
};

/** Text with a highlighter sweeping across the chosen words (p = 0 → 1). */
const Highlighted: React.FC<{ text: string; words?: string[]; p: number; color?: string }> = ({ text, words, p, color = '#FFE45C' }) => {
  const keys = new Set((words ?? []).flatMap((w) => w.split(/\s+/)).map(normWord).filter(Boolean));
  if (!keys.size || p <= 0) return <>{text}</>;
  return (
    <>
      {text.split(/(\s+)/).map((tok, i) => (keys.has(normWord(tok))
        ? <span key={i} style={{ backgroundImage: `linear-gradient(${color}, ${color})`, backgroundRepeat: 'no-repeat', backgroundSize: `${(p * 100).toFixed(1)}% 78%`, backgroundPosition: '0 70%', padding: '0 3px', margin: '0 -3px' }}>{tok}</span>
        : <React.Fragment key={i}>{tok}</React.Fragment>))}
    </>
  );
};

const TEXT_ENTERS = new Set<string>(['type', 'scramble', 'letters', 'rise']);
const MARKS = new Set<string>(['circle', 'underline', 'arrow', 'box']);

const Line: React.FC<{ l: PlacedLine; frame: number; look: Look; accent: string; bg: Bg; lottie?: LottieMap }> = ({ l, frame, look, accent, bg, lottie }) => {
  const face = look.display;
  const d = frame - l.f;
  const full = face.upper ? l.text.toUpperCase() : l.text;
  const single = (full.match(/\d[\d.,]*/g) ?? []).length === 1;
  const text = l.fx === 'count' && single && d >= 0 ? countText(full, d) : full;
  const base = SIZE[l.size ?? 'md'];
  const size = fitFace(text, base, W - 160, 1, face, 30);
  const box = l.box && l.box !== 'none' ? l.box : null;
  const boxBg = box === 'yellow' ? '#FFD93B' : box === 'black' ? '#111' : box === 'white' ? '#fff' : box === 'accent' ? look.hi : 'transparent';
  let color = toneColor(l.tone, look, accent);
  if (box === 'yellow' || box === 'white' || (box === 'accent' && look.hi !== '#111111')) color = '#111';
  if (box === 'black') color = l.tone && l.tone !== 'white' && l.tone !== 'black' ? color : '#fff';
  if (!box && lightBg(bg) && (!l.tone || l.tone === 'white')) color = '#111';
  // a boxed line already carries its emphasis: a marker sweep under the box would only turn its text dark
  const mk = l.fx === 'marker' && !box ? interpolate(d, [3, 11], [0, 1], { ...clamp, easing: Easing.out(Easing.quad) }) : 0;
  const st = l.fx === 'strike' ? interpolate(d, [7, 13], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) }) : 0;
  if (mk > 0.4) color = '#111';
  const textEnter = l.enter && TEXT_ENTERS.has(l.enter) ? (l.enter as TextEnter) : null;
  const seed = seedOf(`${l.text}|${l.f}`);
  const textStyle: React.CSSProperties = {
    position: 'relative', fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 1.02, letterSpacing: face.track, color,
    background: boxBg, padding: box ? `${size * 0.04}px ${size * 0.18}px` : 0, borderRadius: box ? 6 : 0, opacity: st > 0 ? 1 - 0.3 * st : 1,
    transform: box ? 'rotate(-1.2deg)' : undefined, whiteSpace: 'nowrap', display: 'inline-block',
  };
  // the block the hand marks / sparkles frame: the measured text (+ the box padding)
  const bw = textWidth(text, face, size) + (box ? size * 0.36 : 0);
  const bh = size * 1.02 + (box ? size * 0.08 : 0);
  const markColor = lightBg(bg) ? '#F2443F' : '#FFD93B';
  const es = l.emoji ? interpolate(d - 2, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2.2)) }) : 0;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', ...(textEnter ? (d < 0 ? { opacity: 0 } : {}) : enterStyle(d, (l.enter as 'slam' | 'slide' | undefined) ?? (l.size === 'sm' ? 'slide' : 'slam'))) }}>
      <span style={{ position: 'relative', display: 'inline-block' }}>
        {mk > 0 && <span style={{ position: 'absolute', left: -size * 0.12, right: -size * 0.12, top: size * 0.1, bottom: size * 0.02, background: '#FFE45C',
          transform: `scaleX(${mk}) rotate(-1.2deg)`, transformOrigin: 'left center', borderRadius: size * 0.06 }} />}
        {textEnter ? <EnterText text={text} kind={textEnter} d={d} seed={seed} style={textStyle} /> : <span style={textStyle}>{text}</span>}
        {st > 0 && <span style={{ position: 'absolute', left: -size * 0.08, right: -size * 0.08, top: '50%', height: Math.max(8, size * 0.1), marginTop: -Math.max(4, size * 0.05),
          background: '#F2443F', transform: `scaleX(${st}) rotate(-4deg)`, transformOrigin: 'left center', borderRadius: 4, boxShadow: '0 3px 0 rgba(0,0,0,0.3)' }} />}
        {l.fx && MARKS.has(l.fx) && <HandMark mark={l.fx as Mark} w={bw} h={bh} d={d} color={markColor} seed={seed} />}
        {l.fx === 'sparkle' && <Sparkles w={bw} h={bh} d={d} seed={seed} color={lightBg(bg) ? '#F2443F' : '#FFE45C'} />}
        {l.emoji && es > 0 && (
          // a sticker on the line's top-right corner (beside a centred line it would leave the frame)
          <span style={{ position: 'absolute', right: -Math.min(size, 120) * 0.62, top: -Math.min(size, 120) * 0.55, transform: `scale(${es.toFixed(3)}) rotate(${(12 - (1 - es) * 30).toFixed(1)}deg)` }}>
            <LottieEmoji char={l.emoji} size={Math.max(70, Math.min(size, 120) * 0.95)} lottie={lottie} />
          </span>
        )}
      </span>
    </div>
  );
};

/** compare: columns that grow on their words; numeric values set the bar heights, words alone read as a "vs". */
const Compare: React.FC<{ sc: PlacedScene; frame: number; look: Look; accent: string; ink: string }> = ({ sc, frame, look, accent, ink }) => {
  const face = look.display;
  const bars = sc.bars ?? [];
  const nums = bars.map((b) => parseFloat((b.value.match(/\d[\d.,]*/)?.[0] ?? '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')));
  const numeric = nums.every((n) => Number.isFinite(n)) && Math.max(...nums) > 0;
  const max = numeric ? Math.max(...nums) : 1;
  const colW = Math.min(300, Math.floor((W - 160) / Math.max(2, bars.length)) - 60);
  const H = 560;
  if (!numeric) {
    // words only: tiles side by side (a vs b), each landing on its word
    const gap = bars.length === 2 ? 110 : 30; // a pair leaves room for the VS badge between them
    const tileW = Math.min(400, Math.floor((W - 120 - gap * (bars.length - 1)) / bars.length));
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 44, marginTop: -20 }}>
        {sc.title && <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(sc.title.toUpperCase(), 84, W - 200, 1, face, 32), color: ink, ...enterStyle(frame - sc.s, 'slam') }}>{sc.title.toUpperCase()}</div>}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', gap, position: 'relative' }}>
          {bars.map((b, i) => {
            const d = frame - b.f;
            const p = interpolate(d, [0, 5], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
            const col = toneColor(b.tone ?? (['white', 'yellow', 'green', 'red'] as Tone[])[i % 4], look, accent);
            const dark = col === '#111111' || col === '#F2443F' || col === '#4FB3FF';
            const v = face.upper ? b.value.toUpperCase() : b.value;
            return (
              <div key={i} style={{ width: tileW, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, opacity: d < 0 ? 0 : 1,
                transform: `scale(${(0.6 + 0.4 * p).toFixed(3)}) rotate(${(i % 2 ? 2 : -2) * p}deg)` }}>
                <div style={{ width: '100%', minHeight: 300, background: col, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
                  boxShadow: '10px 12px 0 rgba(0,0,0,0.28)' }}>
                  <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(v, 104, tileW - 56, /\s/.test(v) ? 2 : 1, face, 36), color: dark ? '#fff' : '#111', lineHeight: 1, textAlign: 'center' }}>{v}</span>
                </div>
                <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(b.label.toUpperCase(), 50, tileW, 2, face, 24), color: ink, textAlign: 'center', lineHeight: 1.05 }}>{b.label.toUpperCase()}</span>
              </div>
            );
          })}
          {bars.length === 2 && frame >= bars[1].f && (
            <div style={{ position: 'absolute', left: '50%', top: 150, transform: `translate(-50%, -50%) scale(${interpolate(frame - bars[1].f, [0, 5], [1.8, 1], clamp)}) rotate(-8deg)`,
              width: 120, height: 120, borderRadius: 99, background: '#111', border: '6px solid #fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Archivo Black', sans-serif", fontSize: 50 }}>VS</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, marginTop: -40 }}>
      {sc.title && <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(sc.title.toUpperCase(), 78, W - 200, 1, face, 32), color: ink, ...enterStyle(frame - sc.s, 'slam') }}>{sc.title.toUpperCase()}</div>}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 40, height: H + 150, position: 'relative' }}>
        {bars.map((b, i) => {
          const d = frame - b.f;
          const grow = interpolate(d, [0, 10], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.3)) });
          const h = numeric ? 90 + (H - 90) * (nums[i] / max) : H * 0.72;
          const col = toneColor(b.tone ?? (['yellow', 'green', 'red', 'blue'] as Tone[])[i % 4], look, accent);
          const v = face.upper ? b.value.toUpperCase() : b.value;
          return (
            <div key={i} style={{ width: colW, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: d < 0 ? 0 : 1 }}>
              <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(v, 84, colW + 30, 1, face, 34), color: col, lineHeight: 1, ...enterStyle(d - 4, 'slam') }}>{numeric ? countText(v, d) : v}</span>
              <div style={{ width: '100%', height: h, background: col, borderRadius: '14px 14px 0 0', transform: `scaleY(${grow})`, transformOrigin: 'bottom center',
                boxShadow: 'inset 0 -12px 0 rgba(0,0,0,0.18)' }} />
              <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(b.label.toUpperCase(), 46, colW + 40, 2, face, 24), color: ink, textAlign: 'center', lineHeight: 1.05 }}>{b.label.toUpperCase()}</span>
            </div>
          );
        })}
        {!numeric && bars.length === 2 && frame >= bars[1].f && (
          <div style={{ position: 'absolute', left: '50%', top: '42%', transform: `translate(-50%, -50%) scale(${interpolate(frame - bars[1].f, [0, 5], [1.8, 1], clamp)}) rotate(-8deg)`,
            width: 130, height: 130, borderRadius: 99, background: '#111', border: '6px solid #fff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: "'Archivo Black', sans-serif", fontSize: 54 }}>VS</div>
        )}
      </div>
    </div>
  );
};

const RANSOM_FONTS = ["'Archivo Black', sans-serif", "'Permanent Marker', cursive", "'Bebas Neue', sans-serif", "'Patrick Hand', cursive", "'Anton', sans-serif", "'Montserrat', sans-serif"];
const RANSOM_BG = ['#ffffff', '#111111', '#F2443F', '#FFD93B', '#4FB3FF', '#F6C1D3', '#ffffff'];
const hashN = (s: number) => { const x = Math.sin(s * 91.7 + 13.3) * 43758.5453; return x - Math.floor(x); };

const Ransom: React.FC<{ text: string; f: number }> = ({ text, f }) => {
  const letters = Array.from(text.toUpperCase());
  // tiles carry padding and gaps (~1.12 em each); a long title wraps onto two lines at its space
  const longestWord = Math.max(...text.split(/\s+/).map((w) => w.length), 1);
  const perLine = letters.length > 9 ? Math.max(longestWord, Math.ceil(letters.length / 2)) : letters.length;
  const size = Math.min(132, Math.floor((W - 170) / Math.max(4, perLine) / 1.12));
  // each word is one unbreakable group of tiles; lines break only between words
  let n = 0;
  const words = text.toUpperCase().split(/\s+/).filter(Boolean).map((w) => Array.from(w).map((ch) => ({ ch, i: n++ })));
  return (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', columnGap: size * 0.45, rowGap: size * 0.22, padding: '0 50px' }}>
      {words.map((word, wi) => (
        <span key={wi} style={{ display: 'inline-flex', gap: size * 0.08, whiteSpace: 'nowrap' }}>
          {word.map(({ ch, i }) => {
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
        </span>
      ))}
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
    const size = 340;
    return (
      <div style={{ position: 'relative', width: size, height: size, transform: `scale(${p}) rotate(${rot * 2}deg)` }}>
        <Burst size={size} color={color} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 40 }}>
          <span style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(text, 88, 270, 2, face, 32), color: '#111', lineHeight: 1 }}>{text}</span>
          {st.sub && <span style={{ fontFamily: face.family, fontSize: 28, color: '#111', marginTop: 8 }}>{st.sub.toUpperCase()}</span>}
        </div>
      </div>
    );
  }
  if (st.kind === 'note') {
    return (
      <div style={{ transform: `scale(${p}) rotate(${rot}deg)`, background: '#FFD93B', padding: '24px 34px', boxShadow: '8px 10px 0 rgba(0,0,0,0.28)',
        fontFamily: "'Anton', 'Bebas Neue', sans-serif", fontSize: fitSize(text, 124, 500, 2, 0.48, 50), lineHeight: 1.04, color: '#111', maxWidth: 580 }}>{text}</div>
    );
  }
  if (st.kind === 'strip') {
    const bg = st.tone === 'red' ? '#F2443F' : st.tone === 'yellow' ? '#FFD93B' : st.tone === 'blue' ? '#4FB3FF' : '#7FD7A6';
    return (
      <div style={{ transform: `translateX(${(1 - p) * -300}px) rotate(${-1.5}deg)`, background: bg, border: '4px solid #111',
        padding: '12px 30px', fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(text, 78, 900, 1, face, 32), color: '#111' }}>{text}</div>
    );
  }
  // tag: black marker text on white tape
  return (
    <div style={{ transform: `scale(${p}) rotate(${rot}deg)`, background: '#fff', padding: '8px 24px',
      boxShadow: '5px 6px 0 rgba(0,0,0,0.25)', fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(text, 92, 860, 1, face, 34), color: toneColor(st.tone === 'white' || st.tone === 'yellow' ? 'black' : st.tone, look, accent) }}>{text}</div>
  );
};

export const ScenePro: React.FC<{ sc: PlacedScene; frame: number; look: Look; accent: string; lottie?: LottieMap }> = ({ sc, frame, look, accent, lottie }) => {
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
          <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(sc.heading.toUpperCase(), 58, W - 200, 1, face, 28), color: ink, marginBottom: 12,
            ...enterStyle(f, 'slide') }}>{sc.heading.toUpperCase()}</div>
        )}
        {(sc.lines ?? []).map((l, i) => <Line key={i} l={l} frame={frame} look={look} accent={accent} bg={sc.bg} lottie={lottie} />)}
      </div>
    );
  } else if (sc.kind === 'timeline') {
    body = (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '0 100px', gap: 30, marginTop: -60 }}>
        <div style={{ alignSelf: 'center', textAlign: 'center' }}>
          {sc.kicker && <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: 42, color: '#FFD93B', ...enterStyle(f, 'slide') }}>{sc.kicker.toUpperCase()}</div>}
          {sc.title && <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(sc.title.toUpperCase(), 78, W - 200, 1, face, 32), color: ink, ...enterStyle(f - 2, 'slam') }}>{sc.title.toUpperCase()}</div>}
        </div>
        {(sc.entries ?? []).map((en, i) => {
          const d = frame - en.f;
          const col = toneColor(en.tone ?? (['green', 'red', 'yellow'] as Tone[])[i % 3], look, accent);
          return (
            <div key={i} style={{ display: 'flex', gap: 22, alignItems: 'flex-start', ...enterStyle(d, 'slide') }}>
              <div style={{ width: 36, height: 36, borderRadius: 99, border: `8px solid ${col}`, marginTop: 12, flexShrink: 0 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ alignSelf: 'flex-start', background: '#fff', color: '#111', fontFamily: face.family, fontWeight: face.weight, fontSize: 48, padding: '2px 16px',
                  transform: d >= 0 && d < 4 ? `skewX(${-14 * (1 - d / 4)}deg)` : undefined }}>{en.date.toUpperCase()}</span>
                {en.lines.slice(0, 2).map((t, j) => (
                  <span key={j} style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(t.toUpperCase(), 70, W - 320, 1, face, 30), lineHeight: 1.05,
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 46, marginTop: -60 }}>
        {sc.heading && (
          <div style={{ alignSelf: 'flex-start', marginLeft: 80, background: '#111', color: '#fff', padding: '8px 22px', transform: 'rotate(-2deg)', boxShadow: '5px 6px 0 rgba(0,0,0,0.25)',
            fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(sc.heading.toUpperCase(), 54, W - 240, 1, face, 28), ...enterStyle(f, 'slide') }}>{sc.heading.toUpperCase()}</div>
        )}
        {sc.title && <Ransom text={sc.title} f={f} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: 36, rowGap: 30, padding: '0 60px', maxHeight: 760 }}>
          {(sc.stickers ?? []).map((st, i) => <Sticker key={i} st={st} frame={frame} look={look} accent={accent} i={i} />)}
        </div>
      </div>
    );
  } else if (sc.kind === 'compare') {
    body = <Compare sc={sc} frame={frame} look={look} accent={accent} ink={ink} />;
  } else if (sc.kind === 'checklist' || sc.kind === 'steps' || sc.kind === 'ring') {
    const colorOf = (t?: string) => (t ? toneColor(t as Tone, look, accent) : '');
    const heading = sc.heading && (
      <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(sc.heading.toUpperCase(), 64, W - 200, 1, face, 30), color: dark ? '#FFD93B' : '#111', ...enterStyle(f, 'slide') }}>{sc.heading.toUpperCase()}</div>
    );
    body = sc.kind === 'checklist'
      ? <ChecklistBody items={sc.items ?? []} frame={frame} face={face} ink={ink} dark={dark} heading={heading} colorOf={colorOf} />
      : sc.kind === 'steps'
        ? <StepsBody steps={sc.steps ?? []} frame={frame} face={face} ink={ink} dark={dark} heading={heading} colorOf={colorOf} />
        : <RingsBody rings={sc.rings ?? []} frame={frame} face={face} ink={ink} dark={dark} heading={heading} colorOf={colorOf} />;
  } else if (sc.kind === 'card') {
    const p = interpolate(f, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.4)) });
    const sweep = interpolate(f, [14, 26], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
    const heading = sc.heading && <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(sc.heading.toUpperCase(), 46, W - 200, 1, face, 24), color: dark ? '#FFD93B' : '#111', ...enterStyle(f, 'slide') }}>{sc.heading.toUpperCase()}</div>;
    const lift = `translateY(${(1 - p) * 80}px) rotate(${-2 + (1 - p) * 4}deg) scale(${0.85 + 0.15 * p})`;
    if (sc.style === 'phone' && sc.image) {
      const cap = sc.caption ?? sc.title ?? '';
      body = (
        <PhoneCard image={sc.image} f={f} heading={heading} caption={cap ? (
          <div style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: fitFace(face.upper ? cap.toUpperCase() : cap, 58, W - 180, 2, face, 30), color: ink, textAlign: 'center',
            padding: '0 80px', lineHeight: 1.08, ...enterStyle(f - 8, 'slide') }}><Highlighted text={face.upper ? cap.toUpperCase() : cap} words={sc.highlight} p={sweep} /></div>
        ) : undefined} />
      );
    } else if (!sc.image) {
      const cap = sc.caption ?? sc.title ?? '';
      const article = sc.style === 'article';
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
          {heading}
          <div style={{ position: 'relative', width: 860, background: '#fff', padding: '54px 56px 46px', borderRadius: 14, boxShadow: '0 30px 60px rgba(0,0,0,0.45)', transform: lift }}>
            {article && <div style={{ position: 'absolute', top: 0, right: 0, width: 64, height: 64, borderTopRightRadius: 14, background: `linear-gradient(225deg, ${sc.bg === 'accent' ? accent : BG_COLOR[sc.bg]} 50%, #d4d4d4 50%)` }} />}
            {!article && <div style={{ position: 'absolute', left: 36, top: -34, fontFamily: 'Georgia, serif', fontSize: 170, lineHeight: 1, color: look.hi === '#FFD93B' ? '#F2443F' : look.hi }}>“</div>}
            <div style={{ fontFamily: article ? "'Inter', sans-serif" : face.family, fontWeight: article ? 800 : face.weight, color: '#141414', lineHeight: 1.16,
              fontSize: article ? fitSize(cap, 76, 790, 4, 0.56, 40) : fitFace(face.upper ? cap.toUpperCase() : cap, cap.length < 44 ? 112 : 92, 750, 4, face, 44) }}>
              <Highlighted text={article || !face.upper ? cap : cap.toUpperCase()} words={sc.highlight} p={sweep} />
            </div>
            {(sc.source || sc.date) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 24 }}>
                {sc.source && <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 26, color: '#222', letterSpacing: 1 }}>{sc.source.toUpperCase()}</span>}
                {sc.date && <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 24, color: '#888' }}>{sc.date}</span>}
              </div>
            )}
          </div>
        </div>
      );
    } else if (sc.style === 'article') {
      const cap = sc.caption ?? sc.title ?? '';
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, marginTop: -40 }}>
          {heading}
          <div style={{ position: 'relative', width: 900, background: '#fff', padding: '36px 40px 32px', borderRadius: 14, boxShadow: '0 30px 60px rgba(0,0,0,0.45)', transform: lift }}>
            <div style={{ position: 'absolute', top: 0, right: 0, width: 64, height: 64, borderTopRightRadius: 14, background: `linear-gradient(225deg, ${sc.bg === 'accent' ? accent : BG_COLOR[sc.bg]} 50%, #d4d4d4 50%)` }} />
            <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: fitSize(cap, 52, 800, 3, 0.56, 32), color: '#141414', lineHeight: 1.2, paddingRight: 30 }}>
              <Highlighted text={cap} words={sc.highlight} p={sweep} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 18 }}>
              {sc.source && <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 24, color: '#222', letterSpacing: 1 }}>{sc.source.toUpperCase()}</span>}
              {sc.date && <span style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 22, color: '#888' }}>{sc.date}</span>}
              <span style={{ marginLeft: 'auto', width: 48, height: 48, borderRadius: 99, background: '#E5392F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="24" height="24" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3" fill="#fff" /><circle cx="6" cy="12" r="3" fill="#fff" /><circle cx="18" cy="19" r="3" fill="#fff" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" stroke="#fff" strokeWidth="2" /></svg>
              </span>
            </div>
            {sc.image && <Img src={sc.image} style={{ width: '100%', height: 470, objectFit: 'cover', borderRadius: 8, display: 'block', marginTop: 22 }} />}
          </div>
        </div>
      );
    } else {
      body = (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26 }}>
          {heading}
          <div style={{ width: 860, background: '#fff', padding: 18, borderRadius: 10, boxShadow: '0 30px 60px rgba(0,0,0,0.45)', transform: lift }}>
            {sc.image && <Img src={sc.image} style={{ width: '100%', height: 560, objectFit: 'cover', borderRadius: 4, display: 'block' }} />}
            {sc.caption && <div style={{ fontFamily: 'Georgia, serif', fontSize: fitSize(sc.caption, 40, 800, 2, 0.5, 26), color: '#222', padding: '16px 8px 6px', lineHeight: 1.25 }}>
              <Highlighted text={sc.caption} words={sc.highlight} p={sweep} /></div>}
          </div>
        </div>
      );
    }
  }
  void fps;
  return (
    <AbsoluteFill style={sceneEnter(sc.enter, f)}>
      <SceneBg bg={sc.bg} f={f} accent={accent} />
      {/* a slow push-in keeps a long scene alive (a card holds 10 s+ in the reference) */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: sc.kind === 'build' ? TOP_BUILD : TOP, transformOrigin: '50% 30%',
        transform: `scale(${(1 + (sc.kind === 'card' ? 0.04 : 0.035) * Math.min(1, f / Math.max(1, sc.e - sc.s))).toFixed(4)})` }}>{body}</div>
    </AbsoluteFill>
  );
};

/** How a full-screen scene arrives: a hard cut (the explainer default), a push, a zoom-through or a whip. */
const sceneEnter = (kind: SceneEnter | undefined, f: number): React.CSSProperties => {
  if (!kind || kind === 'cut' || f >= 7) return {};
  const p = interpolate(f, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  if (kind === 'push') return { transform: `translateX(${((1 - p) * W).toFixed(1)}px)` };
  if (kind === 'zoom') return { transform: `scale(${(1.35 - 0.35 * p).toFixed(4)})`, filter: p < 0.98 ? `blur(${(14 * (1 - p)).toFixed(1)}px)` : undefined, opacity: Math.min(1, 0.2 + p) };
  if (kind === 'wipe') return { clipPath: `inset(0 ${((1 - p) * 100).toFixed(1)}% 0 0)` };
  if (kind === 'rise') return { transform: `translateY(${((1 - p) * 700).toFixed(1)}px)`, opacity: Math.min(1, 0.3 + p) };
  if (kind === 'iris') return { clipPath: `circle(${(p * 120).toFixed(1)}% at 50% 42%)` };
  return { transform: `translateX(${((1 - p) * -W * 0.9).toFixed(1)}px)`, filter: p < 0.98 ? `blur(${(26 * (1 - p)).toFixed(1)}px)` : undefined };
};

/** A news / source card floating over the speaker (no background), with a badge chip like "VIRAL". */
export const FloatCard: React.FC<{ sc: PlacedScene; frame: number; look: Look }> = ({ sc, frame, look }) => {
  const f = frame - sc.s;
  const pin = interpolate(f, [0, 6], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.7)) });
  const out = interpolate(frame, [sc.e - 5, sc.e], [1, 0], clamp);
  const sweep = interpolate(f, [12, 24], [0, 1], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const k = sc.scale ?? 1;
  const cap = sc.caption ?? sc.title ?? '';
  const badge = sc.badge ? (look.display.upper ? sc.badge.toUpperCase() : sc.badge) : '';
  return (
    <div style={{ position: 'absolute', left: '50%', top: sc.top ?? 300, width: 600, transformOrigin: '50% 0%', opacity: out,
      transform: `translateX(-50%) scale(${(k * (0.6 + 0.4 * pin) * (0.92 + 0.08 * out)).toFixed(4)}) rotate(${(-2 + (1 - pin) * 6).toFixed(2)}deg)` }}>
      <div style={{ background: '#fff', padding: 14, borderRadius: 10, boxShadow: '0 24px 50px rgba(0,0,0,0.5)' }}>
        {sc.image && <Img src={sc.image} style={{ width: '100%', height: 300, objectFit: 'cover', borderRadius: 4, display: 'block' }} />}
        {cap && <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: fitSize(cap, 34, 560, sc.image ? 2 : 4, 0.56, 22), color: '#141414', lineHeight: 1.2, padding: '12px 6px 4px' }}>
          <Highlighted text={cap} words={sc.highlight} p={sweep} /></div>}
        {(sc.source || sc.date) && <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 18, color: '#888', padding: '2px 6px' }}>{[sc.source?.toUpperCase(), sc.date].filter(Boolean).join(' · ')}</div>}
      </div>
      {badge && (
        <div style={{ position: 'absolute', left: -18, top: -30, background: '#E5262B', color: '#fff', padding: '6px 20px', borderRadius: 6, transform: `rotate(-6deg) scale(${interpolate(f, [3, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.back(2)) })})`,
          fontFamily: "'Archivo Black', sans-serif", fontSize: 36, letterSpacing: 1, boxShadow: '4px 5px 0 rgba(0,0,0,0.3)' }}>{badge}</div>
      )}
    </div>
  );
};

const SIDE_K: Record<SideSize, number> = { sm: 0.4, md: 0.68, lg: 1 };

export const SideWords: React.FC<{ side: PlacedSide; frame: number; look: Look; accent: string; faceTop?: number | null }> = ({ side, frame, look, accent, faceTop }) => {
  const face = look.display;
  const out = interpolate(frame, [side.e - 5, side.e], [1, 0], clamp);
  const center = side.align === 'center';
  const maxW = center ? W - 180 : 560;
  // one base size for the stack; each word is a share of it, the widest one fits the band
  // sizes are relative within the stack: its biggest word is always full size (a lone "sm" word never comes out tiny)
  const top1 = Math.max(...side.words.map((w) => SIDE_K[w.size ?? 'lg']));
  const k = (w: PlacedSide['words'][number]) => SIDE_K[w.size ?? 'lg'] / top1;
  const base = Math.min(center ? 250 : 178, ...side.words.map((w) => Math.floor(maxW / (Math.max(3, w.text.length) * face.charW * k(w)))));
  const origin = center ? 'center center' : side.align === 'left' ? 'left center' : 'right center';
  const sizeOf = (w: PlacedSide['words'][number]) => Math.max(52, base * k(w));
  // the stack ends just above the head (a centred word may sit on the hair line), never under the TikTok tabs
  const stackH = side.words.reduce((h, w) => h + sizeOf(w) * 0.98, 0);
  // no face tracked then (the speaker holds the product up to the lens): the words keep to the top band
  // (the tracked box starts at the brows and the virtual camera zooms in up to ~1.2×: end well above it)
  const top = faceTop == null ? 250 : Math.max(250, Math.round(faceTop - (center ? 50 : 70) - stackH));
  return (
    <div style={{ position: 'absolute', top, ...(center ? { left: 0, right: 0 } : { [side.align]: 64 }), display: 'flex', flexDirection: 'column',
      alignItems: center ? 'center' : side.align === 'left' ? 'flex-start' : 'flex-end', opacity: out } as React.CSSProperties}>
      {side.words.map((w, i) => {
        const tone = w.tone ?? (center ? 'white' : i === side.words.length - 1 && side.words.length > 1 ? 'yellow' : 'white');
        // a big centred white word reads as embossed metal (gradient face, hard shadow); the rest are flat colour
        const gloss = center && tone === 'white';
        const size = sizeOf(w);
        return (
          <span key={i} style={{ fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: 0.98, letterSpacing: face.track,
            ...(gloss
              ? { backgroundImage: 'linear-gradient(180deg, #ffffff 0%, #f1f1f1 45%, #bfbfbf 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
                  filter: 'drop-shadow(0 7px 0 rgba(0,0,0,0.38)) drop-shadow(0 14px 22px rgba(0,0,0,0.35))' }
              : { color: toneColor(tone, look, accent), textShadow: '0 6px 18px rgba(0,0,0,0.45)' }),
            transformOrigin: origin, ...enterStyle(frame - w.f, 'slam') } as React.CSSProperties}>{face.upper ? w.text.toUpperCase() : w.text}</span>
        );
      })}
    </div>
  );
};
