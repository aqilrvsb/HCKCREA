// Laju v2 "Pro" — the Edit Video composition HyperFrames renders. Built on the
// Laju templates in motion/src (sticker elements, slot layout around the face,
// SFX map, guard tape, confetti) with these upgrades:
//   • a per-video LOOK (look.ts): hook style, caption treatment, typeface,
//     colour grade, camera feel, B-roll transitions, section-break light,
//     end card, progress bar, grain — so no two videos share one template
//   • virtual camera on the speaker: alternating jump-cut punch-in, a crash
//     zoom on the hook, a slow push-in that breathes inside every shot, seeded
//     3-octave handheld drift, emphasis bumps on keywords, and a bump in the
//     middle of any stretch > 3.2 s with nothing new on screen
//   • captions inside TikTok's safe area (captionsPro), kinetic hooks (hookPro),
//     B-roll with whip / zoom-through / flash / glitch entries and PiP cards
//     that never cover the face (brollPro), a pressing CTA end card (endCardPro)
//   • beat sync: with music on, B-roll and sticker entrances land on the beat
//     (± 4 frames) of the generated bed (props.musicBpm)
//   • restraint: shake on the 4 strongest hits, flashes on the hook, the CTA
//     and the first cutaway only
// Everything is a pure function of the frame (HyperFrames seeks any frame).
import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Easing, OffthreadVideo, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { noise2D } from '@remotion/noise';
import { BRollFullSeries, BRollPipLayer, fitPip, type PlacedBRoll } from './brollPro';
import { CaptionsPro } from './captionsPro';
import { CAP_LOOKS, CaptionsLook, type CapLookId } from './captionsLooks';
import { EndCardPro } from './endCardPro';
import { BreakFxLayer, Grain, ProgressPro, TextureLayer } from './fxPro';
import { HookPro, hookBottom } from './hookPro';
import { FloatCard, ScenePro, SideWords, sceneOnLight, setStyleSurface, type Bg, type CardStyle, type ChatStyle, type LineEnter, type LineFx, type Note, type PlacedScene, type PlacedSide, type SceneEnter, type SideSize, type Tone } from './scenesPro';
import { BANNER_H, BehindText, FocusLines, NewsBanner, stickerStyle } from './scenesMore';
import { lookFor, type Direction } from './look';
import { HeadlineBack, HeadlineFront, PANEL, boxColor, headCamera, headClip, overTop, pipDock, variantFor, type HeadKind, type PlacedHeadline } from './headline';
import { BLOCKS, BLOCK_BOX } from './blocks';
import { recordBlock } from '../runtime/collect.js';
import { ConfettiRain, Flash, shakeOffset, type Impact } from '../../motion/src/effects';
import { TapeLayer } from '../../motion/src/guard';
import { layoutEdit } from '../../motion/src/layout';
import { SfxTrack, SlotStack, toPages } from '../../motion/src/layers';
import { makeEditCue, safeAccent, type Placed } from '../../motion/src/lib';
import { seedFrom, sfxFor, type SfxEvent, type SfxEventName } from '../../motion/src/sfx';
import type { EditProps, Face, Item, ItemType } from '../../motion/src/types';

/** Extra props the Pro edit reads (all optional: older jobs render without them). */
type ProProps = EditProps & { lookSeed?: number; musicBpm?: number; direction?: Direction | null;
  /** the speaker cut out (alpha WebM) over windows of the edit, seconds — for text behind the speaker, spotlight, sticker */
  cutouts?: { src: string; s: number; e: number; top?: number }[];
  /** QA stills only (made before the matte returns): the planned cut-out windows, seconds */
  cutoutsPlanned?: { s: number; e: number }[];
  /** REQUIRED headline layouts (lib/motion-headline.ts): over the speaker, a split panel, the speaker docked in a box */
  headlines?: { kind: HeadKind; at: string | number; to?: string | number; lead?: string; big: string; box?: string; media?: { src: string; video?: boolean } }[] };

const DEFAULT_DUR = 2.6;
const BROLL_DUR = 2.4;
const DEAD_GAP = 3.2; // seconds without a visual event before an emphasis bump is added
const OVERSCAN = 1.03; // the handheld drift never shows the frame edge
const BEAT_SNAP = 4; // frames an entrance may move to land on the beat

const EVENT_FOR: Partial<Record<ItemType, SfxEventName>> = {
  headline: 'headline', note: 'note', tag: 'tag', stamp: 'stamp', chip: 'chip', tape: 'tape', scribble: 'scribble', price: 'price',
  check: 'check', emoji: 'emoji', counter: 'counter', bigword: 'bigword', callout: 'callout', arrow: 'arrow', stars: 'stars', fact: 'fact',
  circle: 'circle', underline: 'underline', point: 'point', gif: 'gif', confetti: 'confetti',
};
const IMPACT_TYPES = new Set<ItemType>(['bigword', 'stamp', 'price']);
const CONFETTI_COLORS = (accent: string, second: string) => ['#FFD93B', '#ffffff', accent, second === '#111111' ? '#ff5c8a' : second, '#22c55e', '#38bdf8'];

const TONES = new Set<Tone>(['white', 'yellow', 'green', 'red', 'blue', 'accent', 'black']);
const BGS = new Set<Bg>(['dark', 'red', 'accent', 'paper', 'cork', 'yellow', 'blue', 'notebook', 'chalk', 'grid', 'gradient', 'burst', 'style']);
const ENTERS = new Set<SceneEnter>(['cut', 'push', 'zoom', 'whip', 'wipe', 'rise', 'iris', 'tear']);
const LINE_FX = new Set<LineFx>(['strike', 'marker', 'count', 'circle', 'underline', 'arrow', 'box', 'sparkle', 'roll', 'extrude', 'shine']);
const LINE_ENTERS = new Set<string>(['slam', 'slide', 'type', 'scramble', 'letters', 'rise', 'outline', 'swap']);
const NOTE_MARKS = new Set<string>(['highlight', 'circle', 'underline', 'box']);
/** One emoji (a pictographic cluster, ≤ 8 code units) or nothing. */
const emojiOf = (v: unknown) => (typeof v === 'string' && v.length <= 8 && /\p{Extended_Pictographic}/u.test(v) ? v.trim() : undefined);
/** Every item of a scene that lands on a word (for timing rules, events and SFX). */
const sceneItems = (sc: PlacedScene) => [...(sc.lines ?? []), ...(sc.entries ?? []), ...(sc.stickers ?? []), ...(sc.bars ?? []),
  ...(sc.items ?? []), ...(sc.steps ?? []), ...(sc.rings ?? []), ...(sc.chart?.points ?? []), ...(sc.chat?.msgs ?? []),
  ...(sc.sides ?? []).flatMap((sd) => sd.items), ...(sc.notes ?? []), ...(sc.places ?? []), ...(sc.receipt?.items ?? []),
  ...(sc.receipt?.total ? [sc.receipt.total] : []), ...(sc.receipt?.stamp ? [sc.receipt.stamp] : [])].map((x) => x.f);
const SIDE_SIZES = new Set<SideSize>(['sm', 'md', 'lg']);
const txt = (v: unknown, n: number) => {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp >= n * 0.6 ? cut.slice(0, sp) : cut).trim(); // clip at a word boundary
};
const tone = (v: unknown): Tone | undefined => (TONES.has(v as Tone) ? (v as Tone) : undefined);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === 'object') : []);

const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

/** Face box nearest to time t (seconds). */
const faceAt = (faces: Face[] | undefined, t: number): Face | undefined => {
  if (!faces?.length) return undefined;
  let best = faces[0];
  for (const fc of faces) if (Math.abs(fc.t - t) < Math.abs(best.t - t)) best = fc;
  return best;
};

export const MotionEditPro: React.FC<ProProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const accent = safeAccent(p.accent);
  const style = p.style ?? 'gempak';
  const gempak = style === 'gempak';
  const cap = p.captions ?? { on: true, style: 'pop', pos: 'low', maxWords: 3 };
  // TikTok's UI covers ~660 px at the bottom and a ~180 px button column on the right (from y ≈ 840)
  const capCenter = cap.pos === 'mid' ? 1180 : 1330;
  // the director's caption look (a creator style); TikTok's own white-box style keeps its renderer
  const capLook = (() => {
    if (cap.style === 'tiktok') return null;
    const id = (p.direction as { caption_look?: string } | null | undefined)?.caption_look;
    if (id && id in CAP_LOOKS) return id as CapLookId;
    // the director left it out: the client's own pick maps onto its creator look, else one drawn from the video's seed
    if (cap.style === 'karaoke') return 'karaoke' as CapLookId;
    if (cap.style === 'box') return 'sweep' as CapLookId;
    const pool: CapLookId[] = ['hormozi', 'karaoke', 'popline', 'sweep', 'sticker', 'fill', 'beast', 'pod', 'deep', 'pill', 'neon'];
    const seed = Number.isInteger(p.lookSeed) ? (p.lookSeed as number) : seedFrom(`${p.hook?.text ?? ''}|${(p.words ?? []).length}`);
    return pool[(seed >>> 3) % pool.length];
  })();

  const plan = useMemo(() => {
    const words = p.words ?? [];
    const cue = makeEditCue(words);
    const fr = (sec: number) => Math.max(0, Math.round(sec * fps));
    const last = durationInFrames - 1;
    const vseed = seedFrom(`${p.hook?.text ?? ''}|${words.slice(0, 60).map((w) => w.w).join(' ')}|${durationInFrames}`);
    const look = lookFor(Number.isInteger(p.lookSeed) ? (p.lookSeed as number) : vseed, accent, style, p.direction,
      (p.hook?.text ?? '').trim().split(/\s+/).filter(Boolean).length);
    // a picked style's colours and surface, for the scenes drawn from here on
    setStyleSurface(look.palette, look.texture);
    // the virtual camera zooms in around the face (jump cut × breathing push × overscan): everything that keeps
    // clear of the face plans against the face as it appears on screen, not the raw tracked box
    const camK = Math.min(1.3, look.camera.jump * (1 + look.camera.push) * OVERSCAN);
    const faces: Face[] = (p.faces ?? []).map((fc) => {
      const w = Math.min(1, fc.w * camK);
      const h = Math.min(1, fc.h * camK);
      return { ...fc, x: Math.max(0, fc.x + fc.w / 2 - w / 2), y: Math.max(0, fc.y + fc.h / 2 - h / 2), w, h };
    });
    const hookEnd = p.hook?.text ? Math.min(last, fr(cue(p.hook.to, 2.4))) : 0;
    const ctaStart = p.cta?.text ? Math.min(Math.max(0, fr(cue(p.cta.at, 0))), Math.max(0, last - fr(1.6))) : -1;

    // beat grid of the generated music bed (it starts on a downbeat at 0)
    const beat = p.music && p.musicBpm && p.musicBpm > 40 ? (60 / p.musicBpm) * fps : 0;
    const onBeat = (f: number) => {
      if (!beat) return f;
      const g = Math.round(f / beat) * beat;
      return Math.abs(g - f) <= BEAT_SNAP ? Math.round(g) : f;
    };

    // ── HEADLINES (required in every video): one at a time, after the hook, before the CTA; each gets its layout
    //    variant and box colour from the video's seed; a split moves the speaker into the other half, a pip docks them ──
    const hseed = Number.isInteger(p.lookSeed) ? (p.lookSeed as number) : vseed;
    const heads: PlacedHeadline[] = [];
    {
      const hStart = Math.max(fr(1.2), hookEnd ? hookEnd + 6 : 0);
      const hLimit = ctaStart >= 0 ? ctaStart - 4 : last - 2;
      const gap = fr(1.2);
      const raws = (p.headlines ?? []).slice(0, 5)
        .map((h) => ({ h, at: cue(h.at, -1) }))
        .filter((x) => x.at >= 0 && txt(x.h.big, 18))
        .sort((a, b) => a.at - b.at)
        .map(({ h }) => {
          const kind: HeadKind = h.kind === 'split' || h.kind === 'pip' ? h.kind : 'over';
          const want = fr(kind === 'over' ? 3.0 : 3.6);
          const s0 = Math.max(onBeat(fr(cue(h.at, 0))), hStart);
          const to = h.to !== undefined ? fr(cue(h.to, s0 / fps + want / fps)) : s0 + want;
          return { h, kind, s0, len: Math.min(Math.max(to - s0, fr(2.4)), fr(5)) };
        });
      // the latest each one may start so every later one still fits before the CTA: a headline the AI put on the
      // clip's last words (where the closing CTA goes) moves earlier instead of being dropped
      const latest: number[] = [];
      for (let i = raws.length - 1, end = hLimit; i >= 0; i--) {
        latest[i] = end - raws[i].len;
        end = latest[i] - gap;
      }
      for (let ri = 0; ri < raws.length; ri++) {
        const { h, kind, s0, len } = raws[ri];
        const prev = heads[heads.length - 1];
        const s = Math.max(hStart, prev ? prev.e + gap : 0, Math.min(s0, latest[ri]));
        const e = Math.min(s + len, hLimit);
        if (e - s < fr(1.8)) continue;
        const i = heads.length;
        const v = variantFor(kind, hseed, i);
        const face = faceAt(p.faces, s / fps);
        const media = h.media?.src ? { src: h.media.src, video: !!h.media.video } : undefined;
        const base = { kind, s, e, k: i, lead: txt(h.lead, 34), big: txt(h.big, 18).toUpperCase(), box: txt(h.box, 34) || undefined,
          media, v, color: boxColor(hseed, i, accent, look) };
        if (kind === 'split') {
          const top = v <= 2;
          const fcy = face ? (face.y + face.h / 2) * 1920 : 760;
          // the face centred in the speaker's half: below a top panel, above a bottom one
          const dy = top ? Math.max(0, Math.min(PANEL, PANEL + (1920 - PANEL) * 0.4 - fcy)) : Math.min(0, Math.max(-PANEL, (1920 - PANEL) * 0.5 - fcy));
          heads.push({ ...base, top, dy });
        } else if (kind === 'pip') {
          heads.push({ ...base, pip: pipDock(face, v === 1) });
        } else {
          heads.push({ ...base, y: overTop(face, base) });
        }
      }
    }

    const extra: Item[] = [];
    for (const fc of p.facts ?? []) extra.push({ t: 'fact', text: fc.text, sub: fc.source, at: fc.at, to: fc.to, zone: 'top' });
    if (p.rehook?.text) extra.push({ t: 'tape', text: p.rehook.text, at: p.rehook.at, to: cue(p.rehook.at, 0) + 2.2, zone: 'top' });

    // the end card owns the top of the frame once it is up: stickers end there
    const placed: Placed[] = [...(p.overlays ?? []).slice(0, 48), ...extra].map((it: Item, k) => {
      let s = onBeat(fr(cue(it.at, k * 3)));
      s = Math.min(Math.max(s, 0), Math.max(0, last - 12));
      let e = it.to !== undefined ? fr(cue(it.to, s / fps + DEFAULT_DUR)) : s + fr(it.t === 'bigword' ? 1.1 : DEFAULT_DUR);
      e = Math.min(e, durationInFrames);
      if (e < s + 14) e = Math.min(durationInFrames, s + 14);
      return { it, s, e, key: k };
    }).filter((pl) => ctaStart < 0 || pl.s < ctaStart - 6).map((pl) => (ctaStart >= 0 && pl.e > ctaStart ? { ...pl, e: Math.max(pl.s + 14, ctaStart) } : pl));

    // B-roll windows (no overlaps, never while the hook title is up — a card over the title hid it — cleared for the end card);
    // a card with no room above the face goes full-screen
    const broll: PlacedBRoll[] = [];
    for (const [k, b] of (p.broll ?? []).slice(0, 16).entries()) {
      let s = onBeat(fr(cue(b.at, 0)));
      let e = b.to !== undefined ? fr(cue(b.to, s / fps + BROLL_DUR)) : s + fr(BROLL_DUR);
      s = Math.max(s, fr(1), p.hook?.text ? hookEnd + 2 : 0);
      e = Math.min(Math.max(e, s + fr(1.2)), s + fr(4), durationInFrames - 2, ctaStart >= 0 ? ctaStart : durationInFrames - 2);
      const prev = broll[broll.length - 1];
      if (prev && s < prev.e + 4) s = prev.e + 4;
      if (e - s < fr(1)) continue;
      let layout = b.layout;
      const box = layout === 'pip' ? fitPip(faces, s / fps, e / fps, b.label) : null;
      if (layout === 'pip' && !box) layout = 'full';
      broll.push({ s, e, src: b.src, video: b.video, blur: b.blur, layout, label: b.label, k, ...(box ? { box } : {}) });
    }
    // explainer scenes: full-screen motion graphics over the voice, each line on its spoken word
    const scenes: PlacedScene[] = [];
    const floats: PlacedScene[] = [];
    for (const raw of arr(p.direction?.scenes).slice(0, 16)) {
      const kind = String(raw.kind);
      if (!['build', 'timeline', 'collage', 'card', 'compare', 'checklist', 'steps', 'ring', 'chart', 'chat', 'split', 'annotate', 'map', 'receipt'].includes(kind)) continue;
      const float = kind === 'card' && raw.style === 'float';
      const s = onBeat(fr(cue(raw.at as string | number, -1)));
      // a float card may open the video (under the hook title); full-screen scenes wait for the hook to end
      if (s < 0 || (float ? s < fr(0.3) : s <= hookEnd)) continue;
      let e = raw.to !== undefined ? fr(cue(raw.to as string | number, s / fps + 3)) : s + fr(3);
      e = Math.min(Math.max(e, s + fr(1.5)), s + fr(float ? 8 : 14), ctaStart >= 0 ? ctaStart - 2 : last);
      if (e - s < fr(1.2)) continue;
      if (float ? floats.some((x) => s < x.e + 2 && e > x.s - 2) : scenes.some((x) => s < x.e + 2 && e > x.s - 2)) continue;
      const at = (c: unknown) => Math.min(Math.max(fr(cue(c as string | number, s / fps)), s), e - 8);
      const sc: PlacedScene = { kind: kind as PlacedScene['kind'], s, e, bg: BGS.has(raw.bg as Bg) ? (raw.bg as Bg) : 'dark',
        heading: txt(raw.heading, 40) || undefined, kicker: txt(raw.kicker, 24) || undefined, title: txt(raw.title, 30) || undefined,
        caption: txt(raw.caption, 110) || undefined, enter: ENTERS.has(raw.enter as SceneEnter) ? (raw.enter as SceneEnter) : undefined };
      if (kind === 'card') {
        sc.style = (['polaroid', 'article', 'float', 'phone'].includes(String(raw.style)) ? raw.style : 'polaroid') as CardStyle;
        sc.source = txt(raw.source, 24) || undefined;
        sc.date = txt(raw.date, 24) || undefined;
        sc.badge = txt(raw.badge, 14) || undefined;
        sc.highlight = (Array.isArray(raw.highlight) ? raw.highlight : []).map((x) => txt(x, 30)).filter(Boolean).slice(0, 4);
      }
      if (kind === 'build') {
        sc.lines = arr(raw.lines).slice(0, 6).map((l) => ({
          f: at(l.at), text: txt(l.text, 26), tone: tone(l.tone),
          box: (['yellow', 'black', 'white', 'accent', 'none'].includes(String(l.box)) ? l.box : 'none') as 'yellow' | 'black' | 'white' | 'accent' | 'none',
          size: (['sm', 'md', 'lg', 'xl'].includes(String(l.size)) ? l.size : 'md') as 'sm' | 'md' | 'lg' | 'xl',
          enter: LINE_ENTERS.has(String(l.enter)) ? (l.enter as LineEnter) : undefined,
          fx: LINE_FX.has(l.fx as LineFx) ? (l.fx as LineFx) : undefined,
          emoji: emojiOf(l.emoji),
          options: l.enter === 'swap' ? (Array.isArray(l.options) ? l.options : []).map((o) => txt(o, 26)).filter(Boolean).slice(0, 4) : undefined,
        })).filter((l) => l.text).map((l) => (l.enter === 'swap' && !l.options?.length ? { ...l, enter: undefined, options: undefined } : l));
        if (!sc.lines.length) continue;
      } else if (kind === 'timeline') {
        sc.entries = arr(raw.entries).slice(0, 4).map((en) => ({
          f: at(en.at), date: txt(en.date, 20), lines: (Array.isArray(en.lines) ? en.lines : [en.text]).map((x) => txt(x, 24)).filter(Boolean).slice(0, 2), tone: tone(en.tone),
        })).filter((en) => en.date && en.lines.length);
        if (!sc.entries.length) continue;
      } else if (kind === 'collage') {
        sc.stickers = arr(raw.stickers).slice(0, 4).map((st) => ({
          f: at(st.at), text: txt(st.text, 24), sub: txt(st.sub, 20) || undefined,
          kind: (['note', 'strip', 'burst', 'tag'].includes(String(st.kind)) ? st.kind : 'tag') as 'note' | 'strip' | 'burst' | 'tag', tone: tone(st.tone),
        })).filter((st) => st.text);
        if (!sc.title && !sc.stickers.length) continue;
      } else if (kind === 'compare') {
        sc.bars = arr(raw.bars).slice(0, 4).map((b) => ({ f: at(b.at), label: txt(b.label, 16), value: txt(b.value, 12), tone: tone(b.tone) }))
          .filter((b) => b.label && b.value);
        if (sc.bars.length < 2) continue;
      } else if (kind === 'chart') {
        const ch = (raw.chart && typeof raw.chart === 'object' ? raw.chart : raw) as Record<string, unknown>;
        const points = arr(ch.points).slice(0, 8).map((pt) => ({ f: at(pt.at), label: txt(pt.label, 10), value: Number(pt.value) }))
          .filter((pt) => pt.label && Number.isFinite(pt.value));
        if (points.length < 2) continue;
        sc.chart = { type: ch.type === 'bars' ? 'bars' : ch.type === 'area' ? 'area' : 'line', unit: txt(ch.unit, 6) || undefined, points };
      } else if (kind === 'checklist') {
        sc.items = arr(raw.items).slice(0, 6).map((it) => ({ f: at(it.at), text: txt(it.text, 28), mark: it.mark === 'cross' ? 'cross' as const : 'check' as const, tone: tone(it.tone) }))
          .filter((it) => it.text);
        if (!sc.items.length) continue;
      } else if (kind === 'steps') {
        sc.steps = arr(raw.steps).slice(0, 4).map((st) => ({ f: at(st.at), title: txt(st.title, 28), sub: txt(st.sub, 30) || undefined, tone: tone(st.tone) }))
          .filter((st) => st.title);
        if (sc.steps.length < 2) continue;
      } else if (kind === 'chat') {
        const style = (['chat', 'comments', 'notif'].includes(String(raw.style)) ? raw.style : 'chat') as ChatStyle;
        const msgs = arr(raw.messages).slice(0, 6).map((m) => ({ f: at(m.at), text: txt(m.text, 90), who: m.who === 'me' ? 'me' as const : 'them' as const,
          name: txt(m.name, 20) || undefined, likes: txt(m.likes, 8) || undefined })).filter((m) => m.text);
        if (!msgs.length) continue;
        sc.chat = { style, msgs };
      } else if (kind === 'split') {
        const sides = arr(raw.sides).slice(0, 2).map((sd) => ({ title: txt(sd.title, 14), tone: tone(sd.tone),
          items: arr(sd.items).slice(0, 4).map((it) => ({ f: at(it.at), text: txt(it.text, 30) })).filter((it) => it.text) }));
        if (sides.length < 2 || sides.some((sd) => !sd.title)) continue;
        sc.sides = sides;
        sc.marks = raw.marks !== false;
      } else if (kind === 'map') {
        sc.places = arr(raw.places).slice(0, 6).map((pl) => ({ f: at(pl.at), name: txt(pl.name, 30), label: txt(pl.label, 18) || undefined, tone: tone(pl.tone) }))
          .filter((pl) => pl.name);
        if (!sc.places.length) continue;
      } else if (kind === 'receipt') {
        const items = arr(raw.items).slice(0, 6).map((it) => ({ f: at(it.at), label: txt(it.label, 22), value: txt(it.value, 12) })).filter((it) => it.label && it.value);
        const tot = raw.total && typeof raw.total === 'object' ? (raw.total as Record<string, unknown>) : null;
        const stp = raw.stamp && typeof raw.stamp === 'object' ? (raw.stamp as Record<string, unknown>) : null;
        const total = tot && txt(tot.value, 12) ? { f: at(tot.at), label: txt(tot.label, 12) || 'JUMLAH', value: txt(tot.value, 12) } : undefined;
        const stamp = stp && txt(stp.text, 16) ? { f: at(stp.at), text: txt(stp.text, 16) } : undefined;
        if (!items.length) continue;
        sc.receipt = { items, total, stamp };
      } else if (kind === 'annotate') {
        sc.text = txt(raw.text, 80) || undefined;
        sc.notes = arr(raw.notes).slice(0, 3).map((n) => ({ f: at(n.at), word: txt(n.word, 30), note: txt(n.note, 26),
          mark: (NOTE_MARKS.has(String(n.mark)) ? n.mark : 'highlight') as Note['mark'] })).filter((n) => n.word && n.note);
        if (!sc.text || !sc.notes.length) continue;
      } else if (kind === 'ring') {
        sc.rings = arr(raw.rings).slice(0, 3).map((rg) => ({ f: at(rg.at), value: Math.max(0, Math.min(100, Number(rg.value))), label: txt(rg.label, 20), tone: tone(rg.tone) }))
          .filter((rg) => Number.isFinite(rg.value) && rg.label);
        if (!sc.rings.length) continue;
      }
      // never sit on a finished scene: cut back to the speaker ~3.5 s after its last item lands (a card may hold 11 s, as in the reference)
      const items = sceneItems(sc);
      if (sc.kind !== 'card') {
        const head = !!(sc.heading || sc.title || sc.kicker || sc.text || sc.sides);
        // too thin to cut away for: the speaker carries it
        if (items.length + (head ? 1 : 0) < 2) continue;
        // no empty opening frame: without a heading the scene opens on its first item
        const first = Math.min(...items);
        if (!head && first - sc.s > fr(0.4)) sc.s = first - 3;
        // a heading alone is not worth seconds of a scene: it gets ~1 s before the first item (the speaker keeps the rest);
        // an annotate sentence / split titles are content themselves and may open early
        else if (head && sc.kind !== 'annotate' && sc.kind !== 'split' && first - sc.s > fr(1.6)) sc.s = first - fr(1);
      }
      const hold = sc.kind === 'card' ? sc.s + fr(11) : Math.max(sc.s, ...items) + fr(3.5);
      sc.e = Math.max(sc.s + fr(1.5), Math.min(sc.e, hold));
      const rain = emojiOf(raw.rain);
      if (rain && !float) sc.rain = rain;
      if ((raw.speaker === 'left' || raw.speaker === 'right') && !float) sc.speaker = raw.speaker;
      (float ? floats : scenes).push(sc);
    }
    scenes.sort((a, b) => a.s - b.s);
    // the last item that lands gets ≥ 1.1 s on screen (a scene that ends on its own punchline wastes it),
    // as far as the next scene and the CTA allow
    scenes.forEach((sc, i) => {
      const items = sceneItems(sc);
      if (!items.length) return;
      const want = Math.max(...items) + fr(1.1);
      const room = Math.min(scenes[i + 1] ? scenes[i + 1].s - 2 : last, ctaStart >= 0 ? ctaStart - 2 : last);
      if (sc.e < want) sc.e = Math.max(sc.e, Math.min(want, room));
    });
    // a float card never shares the screen with a full-screen scene
    for (let i = floats.length - 1; i >= 0; i--) if (scenes.some((sc) => floats[i].s < sc.e && floats[i].e > sc.s)) floats.splice(i, 1);
    // a card shows the picture of the B-roll planned at that moment; a scene or a float card replaces any B-roll under it
    for (const sc of [...scenes, ...floats]) {
      const under = broll.filter((b) => b.s < sc.e && b.e > sc.s);
      if (sc.kind === 'card' && !sc.image && under.length) sc.image = under[0].src;
      // a card is one still: a picture card may hold ~9 s, a text-only quote card ~5.5 s (then back to the speaker)
      if (sc.kind === 'card' && sc.style !== 'float') sc.e = Math.min(sc.e, sc.s + fr(sc.image ? 9 : 5.5));
    }
    for (let i = broll.length - 1; i >= 0; i--) if ([...scenes, ...floats].some((sc) => broll[i].s < sc.e && broll[i].e > sc.s)) broll.splice(i, 1);
    const inScene = (f: number) => scenes.some((sc) => f >= sc.s && f < sc.e);

    // big stacked words beside the speaker (never during a scene)
    // with no end card the CTA moment belongs to the speaker, and side words may carry it
    const noCard = look.endcard === 'none';
    const sideEnd = ctaStart >= 0 && !noCard ? ctaStart : last;
    const sides: PlacedSide[] = [];
    for (const raw of arr(p.direction?.side).slice(0, 10)) {
      const s = fr(cue(raw.at as string | number, -1));
      if (s < 0 || s <= hookEnd || inScene(s) || s >= sideEnd - fr(1)) continue;
      let e = raw.to !== undefined ? fr(cue(raw.to as string | number, s / fps + 2)) : s + fr(2.2);
      e = Math.min(Math.max(e, s + fr(1.2)), s + fr(4), sideEnd);
      const sc = scenes.find((x) => x.s > s);
      if (sc && e > sc.s) e = sc.s;
      if (e - s < fr(1) || sides.some((x) => s < x.e && e > x.s) || floats.some((x) => s < x.e && e > x.s)) continue;
      // the band above the head is shared with B-roll cards and fact cards: those keep it
      if (broll.some((x) => x.layout === 'pip' && s < x.e + 4 && e > x.s - 4) || placed.some((pl) => pl.it.t === 'fact' && s < pl.e && e > pl.s)) continue;
      const words = arr(raw.words).slice(0, 3).map((w) => ({ f: Math.min(Math.max(fr(cue(w.at as string | number, s / fps)), s), e - 6), text: txt(w.text, 16), tone: tone(w.tone),
        size: SIDE_SIZES.has(w.size as SideSize) ? (w.size as SideSize) : undefined }))
        .filter((w) => w.text);
      if (!words.length) continue;
      sides.push({ s, e, words, align: raw.align === 'right' ? 'right' : raw.align === 'center' ? 'center' : 'left' });
    }

    // news banners (a "TERKINI" strip): above the head when there is room, else a lower third above the captions
    const banners: { s: number; e: number; tag: string; text: string; ticker?: string; top: number }[] = [];
    for (const raw of arr((p.direction as Record<string, unknown> | null | undefined)?.banner).slice(0, 2)) {
      const s = fr(cue(raw.at as string | number, -1));
      const text = txt(raw.text, 48);
      if (!text || s < 0 || s <= hookEnd || inScene(s) || (ctaStart >= 0 && s >= ctaStart - fr(1.5))) continue;
      let e = raw.to !== undefined ? fr(cue(raw.to as string | number, s / fps + 3.5)) : s + fr(3.5);
      e = Math.min(Math.max(e, s + fr(2)), s + fr(6), ctaStart >= 0 ? ctaStart : last);
      const nextScene = scenes.find((x) => x.s > s);
      if (nextScene && e > nextScene.s) e = nextScene.s;
      if (e - s < fr(1.5) || sides.some((x) => s < x.e && e > x.s) || floats.some((x) => s < x.e && e > x.s) || banners.some((x) => s < x.e + 6 && e > x.s - 6)
        || broll.some((x) => s < x.e + 4 && e > x.s - 4)) continue;
      const near = faces.filter((x) => x.t >= s / fps - 0.3 && x.t <= e / fps + 0.3);
      const fTop = near.length ? Math.min(...near.map((x) => x.y)) * 1920 : 700;
      const fBot = near.length ? Math.max(...near.map((x) => x.y + x.h)) * 1920 : 1000;
      const low = (cap.on ? capCenter - 135 : 1240) - BANNER_H - 20;
      const top = fTop - 50 - BANNER_H >= 230 ? 230 : low > fBot + 10 ? low : -1;
      if (top < 0) continue;
      banners.push({ s, e, tag: txt(raw.tag, 12) || 'TERKINI', text, ticker: txt(raw.ticker, 90) || undefined, top: Math.round(top) });
    }
    // ── the speaker cut-out (props.cutouts): text behind the speaker, spotlight, speaker sticker over a scene ──
    const cuts = (p.cutouts ?? []).map((c) => ({ src: c.src, s: Math.round(c.s * fps), e: Math.round(c.e * fps), top: c.top })).filter((c) => c.src && c.e > c.s + 2);
    const covered = (s: number, e: number) => cuts.some((c) => c.s <= s && c.e >= e);
    // QA stills are made before the matte returns: there the planned windows stand in for the cut-outs, so the
    // stills carry the same text behind the speaker — and drop the same stickers — as the final render
    const behindWins: { s: number; e: number; top?: number }[] = cuts.length ? cuts
      : (p.cutoutsPlanned ?? []).map((c) => ({ s: Math.round(c.s * fps), e: Math.round(c.e * fps) })).filter((c) => c.e > c.s + 2);
    const behindCovered = (s: number, e: number) => behindWins.some((c) => c.s <= s && c.e >= e);
    for (const sc of scenes) if (sc.speaker && !covered(sc.s, sc.e)) sc.speaker = undefined;
    const behinds: { s: number; e: number; text: string; tone?: Tone; headTop: number; fitW?: number }[] = [];
    for (const raw of arr((p.direction as Record<string, unknown> | null | undefined)?.behind).slice(0, 3)) {
      const s = fr(cue(raw.at as string | number, -1));
      const text = txt(raw.text, 14);
      if (!text || s < 0 || s <= hookEnd || inScene(s) || (ctaStart >= 0 && s >= ctaStart - fr(1))) continue;
      let e = raw.to !== undefined ? fr(cue(raw.to as string | number, s / fps + 2.5)) : s + fr(2.5);
      e = Math.min(Math.max(e, s + fr(1.2)), s + fr(4), ctaStart >= 0 ? ctaStart : last);
      const nextScene = scenes.find((x) => x.s > s);
      if (nextScene && e > nextScene.s) e = nextScene.s;
      const holder = behindWins.find((c) => c.s <= s && c.e > s);
      if (holder && holder.e < e && holder.e - s >= fr(1)) e = holder.e;
      if (e - s < fr(1) || !behindCovered(s, e) || behinds.some((x) => s < x.e && e > x.s) || sides.some((x) => s < x.e && e > x.s)
        || banners.some((x) => s < x.e && e > x.s) || broll.some((x) => s < x.e + 4 && e > x.s - 4)) continue;
      const fc = faceAt(p.faces, s / fps);
      if (!fc) continue;
      // the word stands on the top of the head: the head covers its lower part, the rest reads above and around it
      const cut = behindWins.find((c) => c.s <= s && c.e >= e);
      const headTop = typeof cut?.top === 'number' ? cut.top : (fc.y - fc.h * 0.35) * 1920;
      behinds.push({ s, e, text, tone: tone(raw.tone), headTop: Math.max(300, headTop) });
    }
    const spots: { s: number; e: number }[] = [];

    // manga focus lines burst around the face on the director's word (with a punch-in)
    const focus: { f: number; cx: number; cy: number; r: number }[] = [];

    // float cards sit in the band above the face; during the hook, under the hook title
    // (a speaker framed high leaves no room under the hook title: the card then waits for the title to clear)
    for (let i = floats.length - 1; i >= 0; i--) {
      const fc = floats[i];
      const faceY = (faceAt(faces, fc.s / fps)?.y ?? 0.36) * 1920;
      const h = fc.image ? 430 : 260; // card height at scale 1 (600 px wide)
      const fit = (top: number) => Math.min(1, (faceY + 150 - top) / h);
      let top = 270;
      if (fc.s < hookEnd && p.hook?.text) {
        const under = hookBottom(p.hook.text, p.hook.sub, look, faceY) + 46;
        if (fit(under) >= 0.85) top = under;
        else {
          fc.s = hookEnd + 2;
          if (fc.e - fc.s < fr(1.2)) { floats.splice(i, 1); continue; }
        }
      }
      fc.top = Math.round(top);
      fc.scale = Math.max(0.72, fit(top));
    }

    const pips = broll.filter((b) => b.layout === 'pip').map((b) => ({ s: b.s, e: b.e }));

    for (let i = placed.length - 1; i >= 0; i--) {
      const pl = placed[i];
      if (inScene(pl.s)) { placed.splice(i, 1); continue; }
      // side words carry that line (the reference look): a sticker on the same moment would repeat it
      if (pl.it.t !== 'confetti' && [...sides, ...banners, ...behinds].some((x) => pl.s < x.e && pl.e > x.s)) { placed.splice(i, 1); continue; }
      const next = scenes.find((sc) => sc.s > pl.s && sc.s < pl.e);
      if (next) placed[i] = { ...pl, e: Math.max(pl.s + 14, next.s) };
    }

    // director-placed HyperFrames registry blocks: one sticker slot each, so the layout keeps them off the
    // face, the captions and the other stickers; one instance per block type, clear of the hook and end card
    const blocks: { key: number; block: string; vars: Record<string, string | number | boolean>; s: number; e: number }[] = [];
    for (const [k, g] of (p.direction?.graphics ?? []).slice(0, 4).entries()) {
      const def = BLOCKS[String(g?.block)];
      if (!def || blocks.some((b) => b.block === g.block)) continue;
      const vars = def.vars(g as Record<string, unknown>);
      if (!vars) continue;
      const s = onBeat(fr(cue(g.at, -1)));
      if (s < 0 || s < hookEnd + 4 || (ctaStart >= 0 && s > ctaStart - fr(def.min))) continue;
      let e = g.to !== undefined ? fr(cue(g.to, s / fps + def.min)) : s + fr(def.min + 0.6);
      e = Math.min(Math.max(e, s + fr(def.min)), s + fr(def.max), ctaStart >= 0 ? ctaStart : last);
      if (e - s < fr(def.min) - 1) continue;
      // the band above the face is the block's: never while a B-roll card, a cutaway or another block is up
      if (broll.some((x) => s < x.e + 4 && e > x.s - 4) || blocks.some((x) => s < x.e + 6 && e > x.s - 6)
        || scenes.some((x) => s < x.e && e > x.s) || sides.some((x) => s < x.e && e > x.s) || floats.some((x) => s < x.e && e > x.s)
        || banners.some((x) => s < x.e && e > x.s)) continue;
      blocks.push({ key: 900 + k, block: String(g.block), vars, s, e });
    }

    // 1080p phone footage goes soft beyond ~1.25× (the sticker layout pads the face by the zoom in each window)
    const zooms = (p.zooms ?? []).slice(0, 40).map((z) => {
      const s = fr(cue(z.at, 0));
      const e = z.to !== undefined ? fr(cue(z.to, s / fps + 1.6)) : s + fr(1.6);
      return { s, e: Math.max(e, s + 10), k: Math.min(1.25, Math.max(1.04, z.scale ?? 1.14)) };
    });
    const cutFrames = (p.cuts ?? []).map((c) => fr(c)).filter((c) => c > 0 && c < last).sort((a, b) => a - b);

    // the text behind the speaker lives in the camera layer (it zooms with the head): sized so it still fits the
    // screen at the camera's largest scale in its window (jump-cut zoom, planned zoom, push-in, bump, punch-type
    // moves, overscan), scaled about the face it zooms around
    const oddSeg = (f: number) => cutFrames.filter((c) => f >= c).length % 2 === 1;
    for (const b of behinds) {
      const base = oddSeg(b.s) || cutFrames.some((c) => c > b.s && c < b.e && oddSeg(c)) ? look.camera.jump : 1;
      const zk = Math.max(base, ...zooms.filter((z) => z.s - 1 < b.e && z.e + 8 > b.s).map((z) => 1 + (z.k - 1) + (base - 1) * 0.5));
      const moved = (p.direction?.moves ?? []).some((mv) => ['punch', 'crash', 'lines', 'smash', 'tilt'].includes(String(mv.move))
        && fr(cue(mv.at, -1)) <= b.e && fr(cue(mv.at, -1)) + 26 >= b.s);
      const k = zk * (1 + look.camera.push) * (1 + look.camera.bump) * (moved ? 1.15 : 1) * OVERSCAN;
      const fc = faceAt(p.faces, b.s / fps);
      const ox = fc ? (fc.x + fc.w / 2) * 1080 : 540;
      b.fitW = Math.round(Math.max(480, Math.min(1000, 2 * Math.min(540 - ox + (ox - 24) / k, (1056 - ox) / k - (540 - ox)))));
    }

    const capH = cap.style === 'tiktok' ? 220 : 250;
    const slots = layoutEdit(placed, {
      faces, fps, hookEnd, pips: [...pips, ...blocks.map((b) => ({ s: b.s, e: b.e })), ...sides.map((x) => ({ s: x.s, e: x.e })), ...floats.map((x) => ({ s: x.s, e: x.e }))],
      labels: broll.filter((b) => b.layout === 'full' && b.label).map((b) => ({ s: b.s - 9, e: b.e })),
      captions: cap.on ? { a: capCenter - capH / 2, b: capCenter + capH / 2 } : null,
      zoomAt: (s, e) => Math.max(1, ...zooms.filter((z) => z.s < e && z.e > s).map((z) => z.k)),
    });
    // a sticker the layout found no room for (clear of the eyes, the captions and the other stickers) is dropped
    // here, so it plays no sound effect / impact either
    for (let i = placed.length - 1; i >= 0; i--) if (placed[i].it.t !== 'confetti' && !slots.has(placed[i].key)) placed.splice(i, 1);

    for (const b of blocks) {
      recordBlock({
        key: b.key, block: b.block, vars: b.vars, start: b.s / fps, duration: (b.e - b.s) / fps, box: BLOCK_BOX,
        theme: { brand: look.hi, accent: look.second === '#111111' ? '#2EC4FF' : look.second, accent2: accent, font: look.display.family },
      });
    }

    // emphasis bumps: keyword words (≥ 2.4 s apart, not inside a zoom, the hook or the end card),
    // then one in the middle of every dead stretch
    const inZoom = (f: number) => zooms.some((z) => f >= z.s - 6 && f <= z.e + 10);
    const bumps: number[] = [];
    const tryBump = (f: number) => {
      if (f <= hookEnd + 6 || (ctaStart >= 0 && f >= ctaStart - 6) || inZoom(f) || inScene(f)) return false;
      if (bumps.some((b) => Math.abs(b - f) < fr(2.4))) return false;
      bumps.push(f);
      return true;
    };
    for (const k of p.keywords ?? []) { const w = words[k.i]; if (w) tryBump(fr(w.t)); }
    const events = [
      ...placed.map((pl) => pl.s), ...blocks.map((b) => b.s), ...broll.map((b) => b.s),
      ...scenes.flatMap((sc) => [sc.s, sc.e, ...sceneItems(sc)]),
      ...floats.map((x) => x.s),
      ...sides.map((x) => x.s), ...zooms.map((z) => z.s), ...cutFrames, ...bumps,
      hookEnd, ...(ctaStart >= 0 ? [ctaStart] : [durationInFrames]),
    ].sort((a, b) => a - b);
    for (let i = 1; i < events.length; i++) {
      const a = events[i - 1];
      const b = events[i];
      if (b - a < fr(DEAD_GAP)) continue;
      const mid = (a + b) / 2;
      let best = -1;
      for (const w of words) {
        const wf = fr(w.t);
        if (wf <= a + fr(0.8) || wf >= b - fr(0.8) || w.w.replace(/[^\p{L}\p{N}]/gu, '').length < 4) continue;
        if (best < 0 || Math.abs(wf - mid) < Math.abs(best - mid)) best = wf;
      }
      if (best > 0) tryBump(best);
    }
    // the director's signature camera moves on chosen words
    const crashes: { f: number; k: number }[] = [];
    const punches: { f: number; k: number }[] = [];
    const whips: { f: number; k: number; dir: number }[] = [];
    const tilts: { f: number; dir: number }[] = [];
    const smashes: { f: number; text: string }[] = [];
    const directed: Impact[] = [];
    for (const [n, mv] of (p.direction?.moves ?? []).slice(0, 12).entries()) {
      const f = fr(cue(mv.at, -1));
      if (f < 0 || f > last - 8 || (ctaStart >= 0 && f >= ctaStart)) continue;
      const k = Math.min(1.5, Math.max(0.5, Number(mv.power) || 1));
      if (mv.move === 'crash') crashes.push({ f, k });
      else if (mv.move === 'punch') punches.push({ f, k });
      else if (mv.move === 'whip') whips.push({ f, k, dir: n % 2 ? 1 : -1 });
      else if (mv.move === 'shake') directed.push({ frame: f, power: Math.min(1, 0.7 * k) });
      else if (mv.move === 'bump') tryBump(f);
      else if (mv.move === 'tilt') tilts.push({ f, dir: n % 2 ? 1 : -1 });
      else if (mv.move === 'spotlight' && !inScene(f) && covered(f, f + fr(2.4)) && !spots.some((x) => f < x.e && f + fr(2.4) > x.s)) spots.push({ s: f, e: f + fr(2.4) });
      else if (mv.move === 'smash' && !inScene(f) && f > hookEnd) {
        // a smash cut: 12 frames of black with one huge word, then a hard cut back with a punch-in
        const text = txt((mv as { text?: unknown }).text, 14);
        if (text && !smashes.some((x) => Math.abs(x.f - f) < fr(3))) { smashes.push({ f, text }); punches.push({ f: f + 12, k: 1.1 }); }
      }
      else if (mv.move === 'lines' && !inScene(f) && !focus.some((x) => Math.abs(x.f - f) < fr(2))) {
        const fc = faceAt(p.faces, f / fps);
        if (!fc) continue;
        focus.push({ f, cx: (fc.x + fc.w / 2) * 1080, cy: (fc.y + fc.h / 2) * 1920, r: Math.max(fc.w * 1080, fc.h * 1920) * 0.62 * camK });
        punches.push({ f, k: 0.8 * k });
      }
    }
    bumps.sort((a, b) => a - b);

    const impacts: Impact[] = [];
    if (p.hook?.text) impacts.push({ frame: 2, power: 1 });
    for (const pl of placed) if (IMPACT_TYPES.has(pl.it.t)) impacts.push({ frame: pl.s + (pl.it.t === 'price' && pl.it.sub ? 9 : 0), power: 0.9 });
    for (const b of broll) if (b.layout === 'full') impacts.push({ frame: b.s, power: 0.6 });
    if (ctaStart >= 0) impacts.push({ frame: ctaStart, power: 0.8 });
    if (gempak) for (const z of zooms) impacts.push({ frame: z.s, power: 0.3 });
    const light = p.direction?.fx === 'light';
    const shakes = [...(light ? [] : [...impacts].sort((a, b) => b.power - a.power || a.frame - b.frame).slice(0, 4)), ...directed.slice(0, 3)];
    const firstFull = broll.find((b) => b.layout === 'full');
    const flashes = light ? [] : impacts.filter((im) => im.frame === 2 || im.frame === ctaStart || (firstFull && im.frame === firstFull.s));

    const breaks: number[] = [];
    if (hookEnd > 0 && !light) breaks.push(Math.max(0, hookEnd - 6));
    if (p.rehook?.text && !light) breaks.push(fr(cue(p.rehook.at, 0)));
    if (ctaStart >= 0 && !light) breaks.push(Math.max(0, ctaStart - 4));

    {
      const hit = (s: number, e: number) => heads.some((h) => s < h.e + 4 && e > h.s - 4);
      const drop = <T extends { s: number; e: number }>(xs: T[]) => { for (let i = xs.length - 1; i >= 0; i--) if (hit(xs[i].s, xs[i].e)) xs.splice(i, 1); };
      drop(broll); drop(scenes); drop(floats); drop(sides); drop(banners); drop(placed); drop(behinds); drop(spots); drop(blocks);
      for (let i = smashes.length - 1; i >= 0; i--) if (hit(smashes[i].f, smashes[i].f + 12)) smashes.splice(i, 1);
      for (let i = focus.length - 1; i >= 0; i--) if (hit(focus[i].f, focus[i].f + 22)) focus.splice(i, 1);
    }
    const confetti = placed.filter((pl) => pl.it.t === 'confetti' || (gempak && !light && pl.it.t === 'price')).map((pl) => pl.s);
    if (gempak && !light && ctaStart >= 0 && !noCard) confetti.push(ctaStart + 4);

    const sfx: SfxEvent[] = [];
    const hookPick = Number.isInteger(p.hookSfx) && (p.hookSfx as number) >= 0 ? (p.hookSfx as number) : vseed;
    if (p.hook?.text) sfx.push(...sfxFor('hook', 1, style, hookPick));
    placed.forEach((pl, k) => {
      const isRehook = p.rehook?.text && pl.it.t === 'tape' && pl.it.text === p.rehook.text;
      const ev: SfxEventName | undefined = isRehook ? 'rehook' : EVENT_FOR[pl.it.t];
      if (ev) sfx.push(...sfxFor(ev, pl.s, style, vseed + k));
    });
    broll.forEach((b, k) => sfx.push(...sfxFor(b.layout === 'full' ? 'broll_full' : 'broll_pip', b.s - (b.layout === 'full' ? 9 : 0), style, vseed + k)));
    heads.forEach((h, k) => sfx.push(...sfxFor(h.kind === 'over' ? 'headline' : 'broll_full', h.s - (h.kind === 'over' ? 0 : 6), style, vseed + 131 + k)));
    if (gempak) zooms.forEach((z, k) => sfx.push(...sfxFor('zoom', z.s, style, vseed + k)));
    cutFrames.forEach((c, k) => { if (k % 2 === 0) sfx.push(...sfxFor('cut', c, style, vseed + k)); });
    if (ctaStart >= 0) sfx.push(...sfxFor('cta', ctaStart, style, vseed + 7));
    blocks.forEach((b, k) => sfx.push(...sfxFor(k % 2 ? 'bigword' : 'headline', b.s, style, vseed + 61 + k)));
    scenes.forEach((sc, k) => {
      sfx.push(...sfxFor('broll_full', sc.s - 6, style, vseed + 71 + k));
      (sc.lines ?? []).forEach((l, j) => { if (l.f > sc.s + 2) sfx.push(...sfxFor(l.size === 'xl' || l.size === 'lg' ? 'bigword' : 'chip', l.f, style, vseed + 80 + k * 7 + j)); });
      (sc.entries ?? []).forEach((x, j) => sfx.push(...sfxFor('check', x.f, style, vseed + 90 + k * 7 + j)));
      (sc.stickers ?? []).forEach((x, j) => sfx.push(...sfxFor(x.kind === 'burst' ? 'stamp' : x.kind === 'note' ? 'note' : x.kind === 'strip' ? 'tape' : 'tag', x.f, style, vseed + 100 + k * 7 + j)));
      (sc.bars ?? []).forEach((x, j) => sfx.push(...sfxFor(j === 0 ? 'counter' : 'chip', x.f, style, vseed + 110 + k * 7 + j)));
      (sc.items ?? []).forEach((x, j) => sfx.push(...sfxFor('check', x.f + 3, style, vseed + 150 + k * 7 + j)));
      (sc.steps ?? []).forEach((x, j) => sfx.push(...sfxFor('chip', x.f, style, vseed + 160 + k * 7 + j)));
      (sc.rings ?? []).forEach((x, j) => sfx.push(...sfxFor('counter', x.f, style, vseed + 170 + k * 7 + j)));
      (sc.lines ?? []).forEach((l, j) => { if (l.fx === 'circle' || l.fx === 'underline' || l.fx === 'arrow' || l.fx === 'box') sfx.push(...sfxFor('scribble', l.f + 5, style, vseed + 180 + k * 7 + j)); });
      (sc.lines ?? []).forEach((l, j) => { if (l.fx === 'strike') sfx.push(...sfxFor('scribble', l.f + 7, style, vseed + 130 + k * 7 + j)); });
    });
    floats.forEach((x, k) => sfx.push(...sfxFor('fact', x.s, style, vseed + 140 + k)));
    sides.forEach((x, k) => sfx.push(...sfxFor('headline', x.words[0].f, style, vseed + 120 + k)));
    crashes.forEach((c, k) => sfx.push(...sfxFor('bigword', c.f, style, vseed + 41 + k)));
    focus.forEach((x, k) => sfx.push(...sfxFor('bigword', x.f, style, vseed + 191 + k)));
    smashes.forEach((x, k) => sfx.push(...sfxFor('stamp', x.f, style, vseed + 261 + k)));
    behinds.forEach((x, k) => sfx.push(...sfxFor('bigword', x.s, style, vseed + 281 + k)));
    spots.forEach((x, k) => sfx.push(...sfxFor('zoom', x.s, style, vseed + 291 + k)));
    tilts.forEach((x, k) => sfx.push(...sfxFor('zoom', x.f, style, vseed + 271 + k)));
    banners.forEach((x, k) => sfx.push(...sfxFor('fact', x.s, style, vseed + 201 + k)));
    scenes.forEach((sc, k) => {
      (sc.chat?.msgs ?? []).forEach((m, j) => sfx.push(...sfxFor(sc.chat?.style === 'notif' ? 'fact' : 'note', m.f, style, vseed + 210 + k * 7 + j)));
      (sc.sides ?? []).forEach((sd, si) => sd.items.forEach((it, j) => sfx.push(...sfxFor('check', it.f + 3, style, vseed + 230 + k * 9 + si * 4 + j))));
      (sc.notes ?? []).forEach((n, j) => sfx.push(...sfxFor(n.mark === 'circle' ? 'circle' : n.mark === 'box' ? 'scribble' : 'underline', n.f, style, vseed + 250 + k * 7 + j)));
      (sc.places ?? []).forEach((pl, j) => sfx.push(...sfxFor('point', pl.f, style, vseed + 300 + k * 7 + j)));
      (sc.receipt?.items ?? []).forEach((it, j) => sfx.push(...sfxFor('tape', it.f, style, vseed + 320 + k * 7 + j)));
      if (sc.receipt?.total) sfx.push(...sfxFor('counter', sc.receipt.total.f, style, vseed + 340 + k));
      if (sc.receipt?.stamp) sfx.push(...sfxFor('stamp', sc.receipt.stamp.f, style, vseed + 350 + k));
    });
    whips.forEach((w, k) => sfx.push(...sfxFor('broll_full', w.f - 4, style, vseed + 53 + k)));

    // the speaker's face over the whole end card (they move, the camera drifts): the CTA card keeps clear of it
    const ctaBand = (() => {
      if (ctaStart < 0 || !faces?.length) return null;
      const hits = faces.filter((fc) => fc.t >= ctaStart / fps - 0.25);
      const list = hits.length ? hits : [faceAt(faces, ctaStart / fps) as Face];
      const top = Math.min(...list.map((fc) => fc.y)) * 1920;
      const bot = Math.max(...list.map((fc) => fc.y + fc.h)) * 1920;
      return { top: top - (bot - top) * 0.06, bottom: bot + (bot - top) * 0.06 };
    })();

    return {
      heads, look, faces, placed, slots, zooms, broll, scenes, floats, sides, banners, focus, tilts, smashes, cuts, behinds, spots, shakes, flashes, breaks, confetti, cutFrames, bumps, crashes, punches, whips, sfx, hookEnd, ctaStart, ctaBand,
      pages: cap.on ? toPages(words, Math.min(6, Math.max(1, capLook ? CAP_LOOKS[capLook].maxWords : cap.maxWords || 3))) : [],
    };
  }, [p.words, p.overlays, p.zooms, p.hook, p.facts, p.rehook, p.cta, p.broll, p.faces, p.headlines, p.cuts, p.hookSfx, p.keywords, p.music, p.musicBpm,
    p.lookSeed, p.direction, accent, fps, durationInFrames, cap.on, cap.maxWords, cap.style, capCenter, style, gempak, capLook]);
  const look = plan.look;
  const cam = look.camera;

  // ── virtual camera on the speaker ──
  let seg = 0;
  let segStart = 0;
  for (const c of plan.cutFrames) if (frame >= c) { seg++; segStart = c; }
  const base = seg % 2 === 1 ? cam.jump : 1;
  // slow push-in inside the shot, easing back the same way in a long shot (the frame breathes)
  const u = (frame - segStart) / fps;
  const cyc = (u % 9) / 4.5;
  const push = 1 + cam.push * smooth(cyc <= 1 ? cyc : 2 - cyc);
  // crash zoom on the hook: in over 6 frames, settle by 11, then ease out across the hook
  let crash = 1;
  if (plan.hookEnd > 0 && frame <= plan.hookEnd) {
    if (frame < 6) crash = 1 + 0.10 * Math.pow(frame / 6, 2);
    else if (frame < 11) crash = 1.10 - 0.04 * smooth((frame - 6) / 5);
    else crash = 1.06 - 0.06 * smooth((frame - 11) / Math.max(1, plan.hookEnd - 11));
  }
  let z = base;
  let zoomAt = base > 1 ? frame : -1;
  for (const zm of plan.zooms) {
    if (frame < zm.s - 1 || frame > zm.e + 8) continue;
    const a = interpolate(frame, [zm.s, zm.s + 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: gempak ? Easing.out(Easing.back(1.8)) : Easing.out(Easing.cubic) });
    const b = interpolate(frame, [zm.e, zm.e + 7], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
    const v = Math.max(base, 1 + (zm.k - 1) * Math.min(a, b) + (base - 1) * 0.5);
    if (v > z) { z = v; zoomAt = zm.s; }
  }
  // directed crash zooms (in over 6 frames, settle by 11, out by 26) and punch-ins (in 4, hold 14, out 8)
  for (const c of plan.crashes) {
    const d = frame - c.f;
    if (d < 0 || d > 26) continue;
    const v = d < 6 ? 0.10 * Math.pow(d / 6, 2) : d < 11 ? 0.10 - 0.04 * smooth((d - 6) / 5) : 0.06 * (1 - smooth((d - 11) / 15));
    crash = Math.max(crash, 1 + v * c.k);
  }
  let punch = 1;
  for (const pc of plan.punches) {
    const d = frame - pc.f;
    if (d < 0 || d > 26) continue;
    const v = d < 4 ? smooth(d / 4) : d < 18 ? 1 : 1 - smooth((d - 18) / 8);
    punch = Math.max(punch, 1 + 0.12 * pc.k * v);
  }
  // directed whip: the shot swishes out and back over 8 frames with a motion blur
  let whipX = 0;
  let whipBlur = 0;
  for (const w of plan.whips) {
    const d = frame - w.f;
    if (d < 0 || d > 8) continue;
    const ph = Math.sin((d / 8) * Math.PI);
    whipX = w.dir * 240 * w.k * ph * (d < 4 ? 1 : -1);
    whipBlur = 18 * ph;
  }
  // dutch tilt accent: in over 5 frames, hold, out over 7 (scaled so no corner shows)
  let tilt = 0;
  for (const tl of plan.tilts) {
    const d = frame - tl.f;
    if (d < 0 || d > 30) continue;
    const v = d < 5 ? smooth(d / 5) : d < 23 ? 1 : 1 - smooth((d - 23) / 7);
    tilt = tl.dir * 4 * v;
  }
  const tiltK = 1 + 0.122 * (Math.abs(tilt) / 4);
  // emphasis bump: up in 3 frames (overshoot), back over 12
  let bump = 1;
  for (const bf of plan.bumps) {
    const d = frame - bf;
    if (d < 0 || d > 16) continue;
    const up = interpolate(d, [0, 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(2)) });
    const down = interpolate(d, [4, 16], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
    bump = Math.max(bump, 1 + cam.bump * Math.min(up, down));
  }
  const fNow = faceAt(p.faces, (zoomAt >= 0 ? zoomAt : frame) / fps);
  const origin = fNow ? `${Math.round((fNow.x + fNow.w / 2) * 100)}% ${Math.round((fNow.y + fNow.h / 2) * 100)}%` : '50% 42%';
  // handheld drift: three noise octaves (~0.15 / 0.6 / 1.6 Hz), y at 1.3× the x frequency
  const t = frame / fps;
  const oct = (seed: string, k: number) => 5.5 * noise2D(seed, t * 0.15 * k, 0) + 2.4 * noise2D(seed, t * 0.6 * k, 5.3) + 0.9 * noise2D(seed, t * 1.6 * k, 9.1);
  const hx = cam.drift * oct('cam-x', 1) + whipX;
  const hy = cam.drift * oct('cam-y', 1.3);
  const hr = cam.drift * 0.3 * noise2D('cam-r', t * 0.22, 7.1);

  const camTransform = `translate(${hx.toFixed(2)}px, ${hy.toFixed(2)}px) rotate(${(hr + tilt).toFixed(3)}deg) scale(${(z * push * bump * crash * punch * tiltK * OVERSCAN).toFixed(4)})`;
  const shake = gempak ? shakeOffset(frame, plan.shakes, 14) : { x: 0, y: 0, r: 0 };
  // cut-out effects at this frame
  const behind = plan.behinds.find((x) => frame >= x.s && frame < x.e);
  const spot = plan.spots.find((x) => frame >= x.s - 2 && frame < x.e + 6);
  const spotK = spot ? Math.min(interpolate(frame, [spot.s - 2, spot.s + 5], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
    interpolate(frame, [spot.e - 2, spot.e + 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })) : 0;
  const stickerScene = plan.scenes.find((sc) => sc.speaker && frame >= sc.s && frame < sc.e);
  const camCut = !stickerScene && (!!behind || spotK > 0);
  const stickerFace = (() => {
    const fc = stickerScene ? faceAt(p.faces, stickerScene.s / fps) : undefined;
    return { x: fc ? (fc.x + fc.w / 2) * 1080 : 540, y: fc ? (fc.y + fc.h / 2) * 1920 : 760 };
  })();
  const faceTop = (faceAt(plan.faces, 1)?.y ?? 0.38) * 1920;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px) rotate(${shake.r}deg)` }}>
        <HeadlineBack heads={plan.heads} frame={frame} look={look} />
        <AbsoluteFill style={headClip(plan.heads, frame) ?? undefined}>
        <AbsoluteFill style={headCamera(plan.heads, frame) ?? undefined}>
        {/* a whip streaks along its motion only (horizontal blur) */}
        {whipBlur > 0.5 && (
          <svg width={0} height={0} style={{ position: 'absolute' }}>
            <filter id="hf-whip" x="-10%" y="0%" width="120%" height="100%"><feGaussianBlur stdDeviation={`${(whipBlur * 2.2).toFixed(1)} 0`} /></filter>
          </svg>
        )}
        <AbsoluteFill style={{ transform: camTransform, transformOrigin: origin, filter: whipBlur > 0.5 ? `${look.grade.filter} url(#hf-whip)` : look.grade.filter }}>
          <OffthreadVideo src={p.video} toneMapped={false} style={{ width: '100%', height: '100%', objectFit: 'cover', ...(spotK > 0.02 ? { filter: `blur(${(12 * spotK).toFixed(1)}px)` } : {}) }} />
          <TapeLayer tracks={p.tapes} />
          {spotK > 0 && <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 55% at 50% 40%, rgba(0,0,0,${(0.35 * spotK).toFixed(3)}) 0%, rgba(0,0,0,${(0.72 * spotK).toFixed(3)}) 100%)` }} />}
          {behind && <BehindText text={behind.text} d={frame - behind.s} out={interpolate(frame, [behind.e - 6, behind.e], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
            headTop={behind.headTop} fitW={behind.fitW} face={look.display} color={behind.tone ? (behind.tone === 'white' ? '#fff' : behind.tone === 'yellow' ? '#FFD93B' : behind.tone === 'red' ? '#F2443F' : behind.tone === 'green' ? '#3DDC97' : behind.tone === 'blue' ? '#4FB3FF' : look.hi) : '#fff'} />}
        </AbsoluteFill>
        {/* the speaker cut out (one element per window, never re-parented): on the speaker shot it takes the camera's exact
            transform and is drawn over the word behind / the dimmed room; during a "speaker" scene it is a die-cut sticker over it */}
        {plan.cuts.map((c, i) => (
          <Sequence key={`cut${i}`} from={c.s} durationInFrames={c.e - c.s}>
            <AbsoluteFill style={stickerScene
              ? { ...stickerStyle(stickerScene.speaker as 'left' | 'right', stickerFace.x, stickerFace.y, frame - stickerScene.s), zIndex: 5 }
              : { transform: camTransform, transformOrigin: origin, filter: look.grade.filter, opacity: camCut ? 1 : 0 }}>
              <OffthreadVideo src={c.src} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </AbsoluteFill>
          </Sequence>
        ))}
        </AbsoluteFill>
        </AbsoluteFill>
        {look.grade.lift && <AbsoluteFill style={{ background: look.grade.lift, pointerEvents: 'none' }} />}
        <AbsoluteFill style={{ background: `radial-gradient(ellipse 78% 62% at 50% 44%, rgba(0,0,0,0) 58%, rgba(0,0,0,${look.grade.vignette}) 100%)`, pointerEvents: 'none' }} />

        <BRollFullSeries items={plan.broll} look={look} />

        {p.hook?.text && frame < plan.hookEnd && (
          <HookPro text={p.hook.text} sub={p.hook.sub} frame={frame} end={plan.hookEnd} look={look} faceTop={faceTop} />
        )}

        {plan.focus.map((x, i) => (frame >= x.f && frame <= x.f + 22 ? <FocusLines key={`fl${i}`} cx={x.cx} cy={x.cy} r={x.r} d={frame - x.f} seed={x.f * 31 + 7} /> : null))}
        <BRollPipLayer items={plan.broll} />
        <SlotStack placed={plan.placed} slots={plan.slots} ink="#ffffff" accent={accent} style={style} lottie={p.lottie} />
        {gempak && <BreakFxLayer at={plan.breaks} kind={look.breakFx} />}
        {plan.sides.map((sd, i) => (frame >= sd.s && frame < sd.e
          ? <SideWords key={`sd${i}`} side={sd} frame={frame} look={look} accent={accent}
              faceTop={(() => {
                // the highest face top around that moment; a lone detection (the product held up to the lens) doesn't count
                const near = plan.faces.filter((x) => Math.abs(x.t - sd.s / fps) < 0.6);
                return near.length >= 2 ? Math.min(...near.map((x) => x.y)) * 1920 : null;
              })()} /> : null))}
        {plan.floats.map((fc, i) => (frame >= fc.s && frame < fc.e ? <FloatCard key={`fc${i}`} sc={fc} frame={frame} look={look} /> : null))}
        {plan.banners.map((b, i) => (frame >= b.s && frame < b.e
          ? <NewsBanner key={`nb${i}`} tag={b.tag} text={b.text} ticker={b.ticker} d={frame - b.s} out={interpolate(frame, [b.e - 6, b.e], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
              top={b.top} face={look.display} /> : null))}
        {plan.scenes.map((sc, i) => (frame >= sc.s && frame < sc.e ? <ScenePro key={`sc${i}`} sc={sc} frame={frame} look={look} accent={accent} lottie={p.lottie} /> : null))}
        <HeadlineFront heads={plan.heads} frame={frame} look={look} />

        {cap.on && (() => {
          // a headline layout carries the words while it is up
          if (plan.heads.some((h) => frame >= h.s && frame < h.e)) return null;
          const inSc = plan.scenes.some((sc) => frame >= sc.s && frame < sc.e);
          // a low face pushes the captions down (the box the camera zoom makes of it)
          const faceBottom = (tt: number) => { if (inSc) return null; const fc = faceAt(plan.faces, tt); return fc ? (fc.y + fc.h) * 1920 : null; };
          return capLook && !inSc && p.direction?.captions !== 'subtle'
            ? <CaptionsLook pages={plan.pages} lookId={capLook} look={look} centerY={capCenter} keywords={p.keywords} lottie={p.lottie} censor={p.censor} faceBottom={faceBottom} />
            : <CaptionsPro pages={plan.pages} style={cap.style} accent={accent} centerY={capCenter} look={look} subtle={p.direction?.captions === 'subtle' || inSc}
                onLight={plan.scenes.some((sc) => frame >= sc.s && frame < sc.e && sceneOnLight(sc.bg))}
                keywords={p.keywords} lottie={p.lottie} gempak={gempak} censor={p.censor} faceBottom={faceBottom} avoid={stickerScene?.speaker} />;
        })()}
        {/* a CTA the client chose (basket / LIVE) always shows, even on a look without an end card */}
        {p.cta?.text && plan.ctaStart >= 0 && (look.endcard !== 'none' || (p.cta as { kind?: string }).kind) && (
          <EndCardPro text={p.cta.text} sub={p.cta.sub} start={plan.ctaStart} frame={frame} faceTop={plan.ctaBand?.top ?? 730} faceBottom={plan.ctaBand?.bottom} capTop={cap.on ? capCenter - 140 : undefined} look={look}
            ctaKind={(p.cta as { kind?: string }).kind === 'live' ? 'live' : 'bag'} />
        )}
      </AbsoluteFill>

      {plan.smashes.map((x, i) => (frame >= x.f && frame < x.f + 12 ? (
        <AbsoluteFill key={`sm${i}`} style={{ background: '#000', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: "'Anton', sans-serif", fontSize: Math.min(300, Math.floor(900 / Math.max(1, x.text.length * 0.47))), color: '#fff', lineHeight: 1,
            letterSpacing: 2, transform: `scale(${(1.08 - 0.08 * Math.min(1, (frame - x.f) / 10)).toFixed(3)})`, textAlign: 'center', padding: '0 60px' }}>{x.text.toUpperCase()}</span>
        </AbsoluteFill>
      ) : null))}
      <AbsoluteFill style={{ pointerEvents: 'none' }}><TapeLayer tracks={p.patchTapes} /></AbsoluteFill>
      <ConfettiRain at={plan.confetti} colors={CONFETTI_COLORS(accent, look.second)} />
      {gempak && <Flash impacts={plan.flashes} />}
      <Grain amount={look.grain} />
      <TextureLayer kind={look.texture} />
      {(p.progress ?? gempak) && <ProgressPro kind={look.progress} color={accent} />}
      {p.sfx && <SfxTrack events={plan.sfx} />}
      {p.music && <Audio src={p.music} volume={p.musicVolume ?? 0.3} />}
    </AbsoluteFill>
  );
};
