// "Edit Video" — the client's own (normalised 1080x1920) video full-bleed,
// with punch-in zooms, an opening hook headline, word-synced overlays
// (stickers, notes, prices, ticks…), TikTok captions, SFX and an optional
// ducked music bed.
import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Easing, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { RENDER } from './elements';
import { Captions, SfxTrack, ZoneStack, toPages, type ZoneBoxes } from './layers';
import { SFX_FOR, clamp, makeEditCue, packRows, safeAccent, type Placed, type SfxEvent } from './lib';
import type { EditProps, Item } from './types';

const DEFAULT_DUR = 2.6; // seconds an overlay stays when the plan gives no `to`

const boxesFor = (pos: 'low' | 'mid', captionsOn: boolean): ZoneBoxes => ({
  top: { top: 190, height: 430, justify: 'flex-start' },
  middle: { top: 700, height: 420, justify: 'center' },
  bottom: !captionsOn
    ? { top: 1180, height: 400, justify: 'flex-end' }
    : pos === 'low'
      ? { top: 1130, height: 230, justify: 'flex-end' }
      : { top: 1290, height: 300, justify: 'flex-start' },
});

export const MotionEdit: React.FC<EditProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const accent = safeAccent(p.accent);
  const cap = p.captions ?? { on: true, style: 'pop', pos: 'low', maxWords: 3 };
  const boxes = boxesFor(cap.pos, cap.on);

  const { rows, zooms, sfx, pages, hookEnd } = useMemo(() => {
    const cue = makeEditCue(p.words ?? []);
    const fr = (sec: number) => Math.max(0, Math.round(sec * fps));
    const last = durationInFrames - 1;

    const hookEnd = p.hook?.text ? Math.min(last, fr(cue(p.hook.to, 2.4))) : 0;

    const placed: Placed[] = (p.overlays ?? []).slice(0, 40).map((it: Item, k) => {
      let s = fr(cue(it.at, k * 3));
      s = Math.min(Math.max(s, 0), Math.max(0, last - 12));
      let e = it.to !== undefined ? fr(cue(it.to, s / fps + DEFAULT_DUR)) : s + fr(DEFAULT_DUR);
      e = Math.min(e, durationInFrames);
      if (e < s + 14) e = Math.min(durationInFrames, s + 14);
      // the hook owns the top zone while it is up
      const zone = it.zone === 'top' && s < hookEnd ? 'middle' : it.zone;
      return { it: { ...it, zone }, s, e, key: k };
    });

    const zooms = (p.zooms ?? []).slice(0, 30).map((z) => {
      const s = fr(cue(z.at, 0));
      const e = z.to !== undefined ? fr(cue(z.to, s / fps + 1.6)) : s + fr(1.6);
      return { s, e: Math.max(e, s + 10), k: Math.min(1.35, Math.max(1.04, z.scale ?? 1.14)) };
    });

    const events: SfxEvent[] = [];
    if (p.hook?.text) events.push({ frame: 2, name: 'thump', vol: 0.4, len: 30 });
    for (const pl of placed) {
      const m = SFX_FOR[pl.it.t];
      if (m) events.push({ frame: pl.s, name: m.name, vol: m.vol * 0.85, len: m.len ?? 40 });
    }
    for (const z of zooms) events.push({ frame: Math.max(0, z.s - 3), name: 'swoosh', vol: 0.16, len: 24 });

    return {
      rows: packRows(placed), zooms, sfx: events, hookEnd,
      pages: cap.on ? toPages(p.words ?? [], Math.min(6, Math.max(1, cap.maxWords || 3))) : [],
    };
  }, [p.words, p.overlays, p.zooms, p.hook, fps, durationInFrames, cap.on, cap.maxWords]);

  // punch-in: ease in over 5 frames, hold, ease out over 7
  let z = 1;
  for (const zm of zooms) {
    if (frame < zm.s - 1 || frame > zm.e + 8) continue;
    const a = interpolate(frame, [zm.s, zm.s + 5], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
    const b = interpolate(frame, [zm.e, zm.e + 7], [1, 0], { ...clamp, easing: Easing.inOut(Easing.cubic) });
    z = Math.max(z, 1 + (zm.k - 1) * Math.min(a, b));
  }

  const Headline = RENDER.headline;
  const hookOut = interpolate(frame, [hookEnd - 6, hookEnd], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: '50% 42%' }}>
        <OffthreadVideo src={p.video} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>

      {p.hook?.text && frame < hookEnd && (
        <AbsoluteFill>
          <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 38%)', opacity: hookOut }} />
          <div style={{ position: 'absolute', left: 70, right: 70, top: 230, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
            <Headline it={{ t: 'headline', text: p.hook.text, at: 0, tone: 'yellow' }} f={frame} out={hookOut} i={0} ink="#ffffff" accent={accent} maxW={940} surface="dark" />
            {p.hook.sub && (
              <RENDER.tape it={{ t: 'tape', text: p.hook.sub, at: 0 }} f={Math.max(0, frame - 8)} out={hookOut} i={1} ink="#ffffff" accent={accent} maxW={940} surface="dark" />
            )}
          </div>
        </AbsoluteFill>
      )}

      <ZoneStack rows={rows} boxes={boxes} ink="#ffffff" accent={accent} surface="dark" />

      {cap.on && <Captions pages={pages} style={cap.style} accent={accent} centerY={cap.pos === 'mid' ? 1180 : 1470} />}
      {p.sfx && <SfxTrack events={sfx} />}
      {p.music && <Audio src={p.music} volume={p.musicVolume ?? 0.35} />}
    </AbsoluteFill>
  );
};
