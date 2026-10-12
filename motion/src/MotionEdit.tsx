// "Edit Video" — the client's own (normalised, optionally jump-cut) video
// full-bleed, directed like a pro short-form edit: hook headline, word-synced
// stickers placed AROUND the speaker's face (layout.ts), B-roll cutaways
// (sales-site photos / stock clips) through @remotion/transitions, fact cards,
// face-centred punch-ins plus an alternating punch on every jump cut so the
// cuts read as camera changes, impacts (shake + flash + burst), light sweeps,
// confetti, re-hook, beg-kuning CTA, keyword-coloured captions, a progress
// bar, guideline tape, and an SFX layer on every visual event.
import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Easing, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { BRollFullSeries, BRollPipLayer, type PlacedBRoll } from './broll';
import { RENDER } from './elements';
import { ConfettiRain, Flash, LightSweep, ProgressBar, shakeOffset, type Impact } from './effects';
import { TapeLayer } from './guard';
import { layoutEdit } from './layout';
import { Captions, SfxTrack, SlotStack, toPages } from './layers';
import { clamp, makeEditCue, safeAccent, type Placed } from './lib';
import { sfxFor, type SfxEvent, type SfxEventName } from './sfx';
import type { EditProps, Item, ItemType } from './types';

const DEFAULT_DUR = 2.6; // seconds an overlay stays when the plan gives no `to`
const BROLL_DUR = 2.4;

const EVENT_FOR: Partial<Record<ItemType, SfxEventName>> = {
  headline: 'headline', note: 'note', tag: 'tag', stamp: 'stamp', chip: 'chip', tape: 'tape', scribble: 'scribble', price: 'price',
  check: 'check', emoji: 'emoji', counter: 'counter', bigword: 'bigword', callout: 'callout', arrow: 'arrow', stars: 'stars', cta: 'cta', fact: 'fact',
  circle: 'circle', underline: 'underline', point: 'point', gif: 'gif', confetti: 'confetti',
};
const IMPACT_TYPES = new Set<ItemType>(['bigword', 'stamp', 'price', 'cta']);
const CONFETTI_COLORS = (accent: string) => ['#FFD93B', '#ffffff', accent, '#ff5c8a', '#22c55e', '#38bdf8'];

export const MotionEdit: React.FC<EditProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const accent = safeAccent(p.accent);
  const style = p.style ?? 'gempak';
  const gempak = style === 'gempak';
  const cap = p.captions ?? { on: true, style: 'pop', pos: 'low', maxWords: 3 };
  const capCenter = cap.pos === 'mid' ? 1180 : 1470;

  const plan = useMemo(() => {
    const cue = makeEditCue(p.words ?? []);
    const fr = (sec: number) => Math.max(0, Math.round(sec * fps));
    const last = durationInFrames - 1;
    const hookEnd = p.hook?.text ? Math.min(last, fr(cue(p.hook.to, 2.4))) : 0;

    // overlays + facts + re-hook + CTA all go through the slot layout
    const extra: Item[] = [];
    for (const fc of p.facts ?? []) extra.push({ t: 'fact', text: fc.text, sub: fc.source, at: fc.at, to: fc.to, zone: 'top' });
    if (p.rehook?.text) extra.push({ t: 'tape', text: p.rehook.text, at: p.rehook.at, to: cue(p.rehook.at, 0) + 2.2, zone: 'top' });
    if (p.cta?.text) extra.push({ t: 'cta', text: p.cta.text, sub: p.cta.sub, at: p.cta.at, to: durationInFrames / fps, zone: 'bottom' });

    const placed: Placed[] = [...(p.overlays ?? []).slice(0, 48), ...extra].map((it: Item, k) => {
      let s = fr(cue(it.at, k * 3));
      s = Math.min(Math.max(s, 0), Math.max(0, last - 12));
      let e = it.to !== undefined ? fr(cue(it.to, s / fps + DEFAULT_DUR)) : s + fr(it.t === 'bigword' ? 1.1 : DEFAULT_DUR);
      e = Math.min(e, durationInFrames);
      if (e < s + 14) e = Math.min(durationInFrames, s + 14);
      return { it, s, e, key: k };
    });

    // B-roll windows (no overlaps, never during the hook's first second)
    const broll: PlacedBRoll[] = [];
    for (const [k, b] of (p.broll ?? []).slice(0, 16).entries()) {
      let s = fr(cue(b.at, 0));
      let e = b.to !== undefined ? fr(cue(b.to, s / fps + BROLL_DUR)) : s + fr(BROLL_DUR);
      s = Math.max(s, fr(1));
      e = Math.min(Math.max(e, s + fr(1.2)), s + fr(4), durationInFrames - 2);
      const prev = broll[broll.length - 1];
      if (prev && s < prev.e + 4) s = prev.e + 4;
      if (e - s < fr(1)) continue;
      broll.push({ s, e, src: b.src, video: b.video, blur: b.blur, layout: b.layout, label: b.label, k });
    }
    const pips = broll.filter((b) => b.layout === 'pip').map((b) => ({ s: b.s, e: b.e }));

    // Face-aware slots: no sticker over the speaker's face.
    const capH = cap.style === 'tiktok' ? 220 : 236; // two caption lines + a little air
    const slots = layoutEdit(placed, {
      faces: p.faces, fps, hookEnd, pips,
      labels: broll.filter((b) => b.layout === 'full' && b.label).map((b) => ({ s: b.s - 9, e: b.e })),
      captions: cap.on ? { a: capCenter - capH / 2, b: capCenter + capH / 2 } : null,
    });

    const zooms = (p.zooms ?? []).slice(0, 40).map((z) => {
      const s = fr(cue(z.at, 0));
      const e = z.to !== undefined ? fr(cue(z.to, s / fps + 1.6)) : s + fr(1.6);
      return { s, e: Math.max(e, s + 10), k: Math.min(1.35, Math.max(1.04, z.scale ?? 1.14)) };
    });
    const cutFrames = (p.cuts ?? []).map((c) => fr(c)).filter((c) => c > 0 && c < last).sort((a, b) => a - b);

    // impacts drive shake + flash
    const impacts: Impact[] = [];
    if (p.hook?.text) impacts.push({ frame: 2, power: 1 });
    for (const pl of placed) if (IMPACT_TYPES.has(pl.it.t)) impacts.push({ frame: pl.s + (pl.it.t === 'price' && pl.it.sub ? 9 : 0), power: 0.9 });
    for (const b of broll) if (b.layout === 'full') impacts.push({ frame: b.s, power: 0.6 });
    if (gempak) for (const z of zooms) impacts.push({ frame: z.s, power: 0.3 });

    const sweeps: number[] = [];
    if (hookEnd > 0) sweeps.push(Math.max(0, hookEnd - 6));
    if (p.rehook?.text) sweeps.push(fr(cue(p.rehook.at, 0)));
    if (p.cta?.text) sweeps.push(Math.max(0, fr(cue(p.cta.at, 0)) - 4));

    // confetti: explicit confetti items + (gempak) the price reveal and the CTA
    const confetti = placed.filter((pl) => pl.it.t === 'confetti' || (gempak && (pl.it.t === 'price' || pl.it.t === 'cta'))).map((pl) => pl.s);

    // sound design
    const events: SfxEvent[] = [];
    if (p.hook?.text) events.push(...sfxFor('hook', 1, style, 0));
    placed.forEach((pl, k) => {
      const isRehook = p.rehook?.text && pl.it.t === 'tape' && pl.it.text === p.rehook.text;
      const ev: SfxEventName | undefined = isRehook ? 'rehook' : EVENT_FOR[pl.it.t];
      if (ev) events.push(...sfxFor(ev, pl.s, style, k));
    });
    broll.forEach((b, k) => events.push(...sfxFor(b.layout === 'full' ? 'broll_full' : 'broll_pip', b.s - (b.layout === 'full' ? 9 : 0), style, k)));
    if (gempak) zooms.forEach((z, k) => events.push(...sfxFor('zoom', z.s, style, k)));
    cutFrames.forEach((c, k) => { if (k % 2 === 0) events.push(...sfxFor('cut', c, style, k)); });

    return {
      placed, slots, zooms, broll, impacts, sweeps, confetti, cutFrames, sfx: events, hookEnd,
      pages: cap.on ? toPages(p.words ?? [], Math.min(6, Math.max(1, cap.maxWords || 3))) : [],
    };
  }, [p.words, p.overlays, p.zooms, p.hook, p.facts, p.rehook, p.cta, p.broll, p.faces, p.cuts, fps, durationInFrames,
    cap.on, cap.maxWords, cap.style, capCenter, style, gempak]);

  // Jump-cut masking: every other segment is framed tighter (instant, like a
  // second camera angle) — the jump reads as an intentional cut.
  let seg = 0;
  for (const c of plan.cutFrames) if (frame >= c) seg++;
  const base = seg % 2 === 1 ? (gempak ? 1.12 : 1.07) : 1;

  // punch-in: ease in over 5 frames (overshoot in gempak), hold, ease out over 7
  let z = base;
  let zoomAt = base > 1 ? frame : -1;
  for (const zm of plan.zooms) {
    if (frame < zm.s - 1 || frame > zm.e + 8) continue;
    const a = interpolate(frame, [zm.s, zm.s + 5], [0, 1], { ...clamp, easing: gempak ? Easing.out(Easing.back(1.8)) : Easing.out(Easing.cubic) });
    const b = interpolate(frame, [zm.e, zm.e + 7], [1, 0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    const v = Math.max(base, 1 + (zm.k - 1) * Math.min(a, b) + (base - 1) * 0.5);
    if (v > z) { z = v; zoomAt = zm.s; }
  }
  // zoom towards the face (nearest face sample)
  let origin = '50% 42%';
  if (zoomAt >= 0 && p.faces && p.faces.length) {
    const t = zoomAt / fps;
    let best = p.faces[0];
    for (const fc of p.faces) if (Math.abs(fc.t - t) < Math.abs(best.t - t)) best = fc;
    origin = `${Math.round((best.x + best.w / 2) * 100)}% ${Math.round((best.y + best.h / 2) * 100)}%`;
  }

  const shake = gempak ? shakeOffset(frame, plan.impacts, 18) : { x: 0, y: 0, r: 0 };
  const Headline = RENDER.headline;
  const hookOut = interpolate(frame, [plan.hookEnd - 6, plan.hookEnd], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px) rotate(${shake.r}deg)` }}>
        <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: origin }}>
          <OffthreadVideo src={p.video} toneMapped={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <TapeLayer tracks={p.tapes} />
        </AbsoluteFill>

        <BRollFullSeries items={plan.broll} />

        {p.hook?.text && frame < plan.hookEnd && (
          <AbsoluteFill>
            <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 38%)', opacity: hookOut }} />
            <div style={{ position: 'absolute', left: 70, right: 70, top: 230, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
              <Headline it={{ t: 'headline', text: p.hook.text, at: 0, tone: 'yellow' }} f={frame} out={hookOut} i={0} ink="#ffffff" accent={accent} maxW={940} surface="dark" style={style} />
              {p.hook.sub && (
                <RENDER.tape it={{ t: 'tape', text: p.hook.sub, at: 0 }} f={Math.max(0, frame - 8)} out={hookOut} i={1} ink="#ffffff" accent={accent} maxW={940} surface="dark" style={style} />
              )}
            </div>
          </AbsoluteFill>
        )}

        <BRollPipLayer items={plan.broll} />
        <SlotStack placed={plan.placed} slots={plan.slots} ink="#ffffff" accent={accent} style={style} lottie={p.lottie} />
        {gempak && <LightSweep at={plan.sweeps} />}

        {cap.on && (
          <Captions pages={plan.pages} style={cap.style} accent={accent} centerY={capCenter}
            keywords={p.keywords} lottie={p.lottie} gempak={gempak} censor={p.censor} />
        )}
      </AbsoluteFill>

      {/* final-QA patches are measured on the finished frame → outside every transform */}
      <AbsoluteFill style={{ pointerEvents: 'none' }}><TapeLayer tracks={p.patchTapes} /></AbsoluteFill>
      <ConfettiRain at={plan.confetti} colors={CONFETTI_COLORS(accent)} />
      {gempak && <Flash impacts={plan.impacts.filter((im) => im.power >= 0.7)} />}
      {(p.progress ?? gempak) && <ProgressBar color={accent} />}
      {p.sfx && <SfxTrack events={plan.sfx} />}
      {p.music && <Audio src={p.music} volume={p.musicVolume ?? 0.3} />}
    </AbsoluteFill>
  );
};
