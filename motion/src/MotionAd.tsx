// "Buat Iklan" — scrapbook ad on a mat/paper/dark/accent/blur background,
// generalised from peningbot-promo Ad1: scenes cut on the VO timeline, a
// product (or presenter) hero, zone-stacked elements cued to spoken words,
// karaoke captions, procedural SFX and a generic brand end card.
import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Background, Captions, SfxTrack, ZoneStack, inkForBg, toPages, type ZoneBoxes } from './layers';
import { F, clamp, fitSize, inkOn, lum, makeAdCue, packRows, popS, rgba, safeAccent, type Placed } from './lib';
import { Flash, LightSweep, shakeOffset, type Impact } from './effects';
import { sfxFor, type SfxEvent, type SfxEventName } from './sfx';
import type { AdProps, AdScene, Brand, Hero, ImageAsset, Word, Zone } from './types';

const boxesFor = (captions: boolean): ZoneBoxes => ({
  top: { top: 200, height: 520, justify: 'flex-start' },
  middle: { top: 720, height: 440, justify: 'center' },
  bottom: captions ? { top: 1100, height: 240, justify: 'flex-end' } : { top: 1180, height: 420, justify: 'flex-end' },
});
const CAPTION_Y = 1500;

type BuiltScene = AdScene & { start: number; end: number; rows: Record<Zone, Placed[][]>; carryHero: boolean };

// ── hero ──────────────────────────────────────────────────────────────────────
const ProductHero: React.FC<{ img: ImageAsset; side: 'L' | 'C' | 'R'; f: number; carry: boolean; tiltDeg: number }> = ({ img, side, f, carry, tiltDeg }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = carry ? 1 : popS(f, fps, 150, 14);
  const bob = Math.sin(frame / 24) * 8;
  const dx = side === 'L' ? -170 : side === 'R' ? 170 : 0;
  const k = side === 'C' ? 1 : 0.84;
  const wrap: React.CSSProperties = {
    position: 'absolute', left: '50%', top: 980, transform: `translate(-50%, -50%) translate(${dx}px, ${(1 - s) * 90 + bob}px) scale(${k * (0.86 + 0.14 * s)}) rotate(${tiltDeg + (1 - s) * 6}deg)`,
    opacity: Math.min(1, carry ? 1 : f / 4),
  };
  if (img.cutout) {
    return (
      <div style={wrap}>
        <Img src={img.cutout} style={{ maxWidth: 820, maxHeight: 760, objectFit: 'contain', display: 'block' }} />
      </div>
    );
  }
  return (
    <div style={wrap}>
      <div style={{ background: '#fff', padding: 18, paddingBottom: 54, borderRadius: 10, boxShadow: '12px 14px 0 rgba(0,0,0,0.4)' }}>
        <Img src={img.url} style={{ maxWidth: 660, maxHeight: 640, objectFit: 'contain', display: 'block', borderRadius: 4 }} />
      </div>
      <div style={{ position: 'absolute', top: -18, left: '50%', marginLeft: -70, width: 140, height: 38, background: 'rgba(238,232,214,0.88)',
        transform: 'rotate(-4deg)' }} />
    </div>
  );
};

const PresenterHero: React.FC<{ img: ImageAsset; side: 'L' | 'C' | 'R'; f: number; carry: boolean }> = ({ img, side, f, carry }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!img.cutout) return <ProductHero img={img} side={side} f={f} carry={carry} tiltDeg={2} />;
  const s = carry ? 1 : popS(f, fps, 160, 13);
  const pos: React.CSSProperties = side === 'L' ? { left: -40 } : side === 'R' ? { right: -40 } : { left: '50%' };
  const tx = side === 'C' ? 'translateX(-50%) ' : '';
  return (
    <div style={{ position: 'absolute', bottom: 0, ...pos, height: 1080, transformOrigin: 'bottom center',
      transform: `${tx}translateY(${(1 - s) * 60 + Math.sin(frame / 22) * 4}px) scale(${0.86 + 0.14 * s}) rotate(${Math.sin(frame / 35) * 0.5}deg)`,
      opacity: Math.min(1, carry ? 1 : f / 4) }}>
      <Img src={img.cutout} style={{ height: '100%' }} />
    </div>
  );
};

// ── end card ──────────────────────────────────────────────────────────────────
const EndCard: React.FC<{ f: number; brand: Brand; accent: string; img?: ImageAsset }> = ({ f, brand, accent, img }) => {
  const { fps } = useVideoConfig();
  const o = interpolate(f, [0, 8], [0, 1], clamp);
  const s = popS(f - 4, fps, 160, 14);
  const s2 = popS(f - 12, fps, 220, 12);
  const s3 = popS(f - 18, fps, 220, 12);
  const name = brand.name || '';
  const nameSize = fitSize(name, 120, 900, 2, 0.68);
  const ctaInk = inkOn(accent);
  return (
    <AbsoluteFill style={{ background: '#fff', opacity: o, alignItems: 'center', justifyContent: 'center' }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 30%, ${rgba(accent, 0.22)} 0%, rgba(255,255,255,0) 60%)` }} />
      <div style={{ transform: `scale(${0.82 + 0.18 * s})`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 26, padding: '0 70px', textAlign: 'center' }}>
        {img && (
          <Img src={img.cutout || img.url} style={{ maxWidth: 640, maxHeight: img.cutout ? 620 : 520, objectFit: 'contain',
            borderRadius: img.cutout ? 0 : 18, boxShadow: img.cutout ? 'none' : '10px 12px 0 rgba(0,0,0,0.18)' }} />
        )}
        <div style={{ fontFamily: F.black, fontSize: nameSize, color: '#0c1f15', letterSpacing: -2, lineHeight: 1.02 }}>{name}</div>
        {brand.tagline && (
          <div style={{ fontFamily: F.inter, fontWeight: 700, fontSize: fitSize(brand.tagline, 50, 900, 2, 0.52), color: '#3d4a44', lineHeight: 1.15 }}>{brand.tagline}</div>
        )}
        {brand.price && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, transform: `scale(${0.6 + 0.4 * s2})` }}>
            {brand.oldPrice && (
              <div style={{ position: 'relative', fontFamily: F.black, fontSize: 52, color: '#6b7280' }}>
                {brand.oldPrice}
                <div style={{ position: 'absolute', left: -6, right: -6, top: '50%', height: 6, background: '#dc2626', transform: 'rotate(-6deg)' }} />
              </div>
            )}
            <div style={{ fontFamily: F.black, fontSize: 92, color: '#111', background: '#FFD93B', padding: '4px 26px', borderRadius: 14, transform: 'rotate(-2deg)' }}>{brand.price}</div>
          </div>
        )}
        {brand.cta && (
          <div style={{ marginTop: 8, background: accent, color: ctaInk, fontFamily: F.inter, fontWeight: 900, fontSize: fitSize(brand.cta, 54, 820, 1, 0.58),
            borderRadius: 999, padding: '20px 56px', transform: `scale(${0.6 + 0.4 * s3})`, boxShadow: '8px 10px 0 rgba(0,0,0,0.25)' }}>{brand.cta}</div>
        )}
        {brand.handle && <div style={{ fontFamily: F.inter, fontWeight: 800, fontSize: 40, color: '#3d4a44', opacity: s3 }}>{brand.handle}</div>}
      </div>
    </AbsoluteFill>
  );
};

// ── composition ───────────────────────────────────────────────────────────────
export const MotionAd: React.FC<AdProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const accent = safeAccent(p.brand?.accent);
  const images = p.images ?? [];
  const boxes = boxesFor(!!p.captions);

  const style = p.style ?? 'gempak';
  const gempak = style === 'gempak';

  const { scenes, sfx, pages, endStart, impacts, sweeps } = useMemo(() => {
    const cue = makeAdCue(p.lines ?? []);
    const fr = (sec: number) => Math.max(0, Math.round(sec * fps));
    const list = (p.scenes ?? []).map((sc, k) => ({
      sc, start: k === 0 ? 0 : fr(cue(sc.from, p.lines?.[Math.min(k, (p.lines?.length ?? 1) - 1)]?.sceneStart ?? k * 3)),
    }));
    // an end card always comes last
    list.sort((a, b) => (a.sc.endcard ? 1 : 0) - (b.sc.endcard ? 1 : 0) || a.start - b.start);
    for (let k = 1; k < list.length; k++) if (list[k].start <= list[k - 1].start) list[k].start = list[k - 1].start + 15;
    const built: BuiltScene[] = list.map(({ sc, start }, k) => {
      const end = k + 1 < list.length ? list[k + 1].start : durationInFrames;
      const placed: Placed[] = (sc.items ?? []).slice(0, 9).map((it, j) => {
        let s = fr(cue(it.at, start / fps));
        s = Math.min(Math.max(s, start), Math.max(start, end - 10));
        let e = it.to !== undefined ? fr(cue(it.to, end / fps)) : end;
        e = Math.min(e, end);
        if (e < s + 12) e = Math.min(end, s + 12);
        return { it, s, e, key: k * 100 + j };
      });
      const prev = list[k - 1]?.sc;
      const carryHero = !!prev && !prev.endcard && !!sc.hero && !!prev.hero && prev.hero.kind === sc.hero.kind && prev.hero.image === sc.hero.image && prev.hero.side === sc.hero.side;
      return { ...sc, start, end, rows: packRows(placed), carryHero };
    });

    const events: SfxEvent[] = [];
    const impacts: Impact[] = [{ frame: 2, power: 0.8 }];
    const sweeps: number[] = [];
    let n = 0;
    built.forEach((sc, k) => {
      if (k > 0) events.push(...sfxFor('scene', sc.start, style, k));
      if (sc.endcard) { events.push(...sfxFor('stars', sc.start + 10, style, k)); sweeps.push(sc.start); return; }
      if (k === 0) events.push(...sfxFor('hook', 1, style, 0));
      if (sc.hero && sc.hero.kind !== 'none' && !sc.carryHero) events.push(...sfxFor('hero', sc.start, style, k));
      const act = (p.lines ?? []).find((l) => l.id === String(sc.from).split(/[@$+-]/)[0])?.act;
      if (act === 'reveal' || act === 'cta') { sweeps.push(sc.start); impacts.push({ frame: sc.start, power: 0.6 }); }
      for (const z of Object.values(sc.rows)) for (const row of z) for (const pl of row) {
        const ev = pl.it.t as SfxEventName;
        events.push(...sfxFor(ev, pl.s, style, n++));
        if (pl.it.t === 'bigword' || pl.it.t === 'stamp' || pl.it.t === 'price' || pl.it.t === 'cta') {
          impacts.push({ frame: pl.s + (pl.it.t === 'price' && pl.it.sub ? 9 : 0), power: 0.9 });
        }
      }
    });

    // captions: absolute word times, pages never cross a VO line
    const words: Word[] = [];
    const breaks = new Set<number>();
    for (const l of p.lines ?? []) {
      breaks.add(words.length);
      l.words.forEach((w, k) => {
        const next = l.words[k + 1];
        words.push({ w: w.w, t: l.audioStart + w.t, e: l.audioStart + (next ? next.t : l.audioDur) });
      });
    }
    const end = built.find((s) => s.endcard);
    return { scenes: built, sfx: events, pages: toPages(words, 4, breaks), endStart: end ? end.start : undefined, impacts, sweeps };
  }, [p.scenes, p.lines, fps, durationInFrames, style]);
  const shake = gempak ? shakeOffset(frame, impacts, 16) : { x: 0, y: 0, r: 0 };

  const sc = scenes.find((s) => frame >= s.start && frame < s.end) ?? scenes[scenes.length - 1];
  const heroImg = (h?: Hero) => (h && h.kind !== 'none' ? images[Math.min(images.length - 1, Math.max(0, h.image ?? 0))] : undefined);

  let body: React.ReactNode = null;
  if (sc) {
    const f = frame - sc.start;
    if (sc.endcard) {
      body = <EndCard f={f} brand={p.brand} accent={accent} img={images[0]} />;
    } else {
      const bg = sc.bg ?? 'mat';
      const ink = inkForBg(bg, accent);
      const zoom = interpolate(frame, [sc.start, sc.end], [1, 1.025], clamp);
      const enter = interpolate(f, [0, 4], [1.04, 1], clamp);
      const img = heroImg(sc.hero);
      const side = sc.hero?.side ?? 'C';
      body = (
        <AbsoluteFill>
          <Background bg={bg} accent={accent} blurUrl={(images[sc.hero?.image ?? 0] ?? images[0])?.blur} />
          <AbsoluteFill style={{ transform: `scale(${zoom * enter})` }}>
            {img && sc.hero?.kind === 'presenter' && <PresenterHero img={img} side={side} f={f} carry={sc.carryHero} />}
            {img && sc.hero?.kind === 'product' && <ProductHero img={img} side={side} f={f} carry={sc.carryHero} tiltDeg={(scenes.indexOf(sc) % 2 ? 2 : -2)} />}
            <ZoneStack rows={sc.rows} boxes={boxes} ink={ink} accent={accent} surface={bg === 'paper' ? 'light' : bg === 'accent' ? 'accent' : 'dark'} style={style} lottie={p.lottie} />
          </AbsoluteFill>
        </AbsoluteFill>
      );
    }
  }

  return (
    <AbsoluteFill style={{ background: '#111' }}>
      <AbsoluteFill style={{ transform: `translate(${shake.x}px, ${shake.y}px) rotate(${shake.r}deg)` }}>
        {body}
        {gempak && <LightSweep at={sweeps} />}
        {p.captions && (
          <Captions pages={pages} style={p.captionStyle ?? 'pop'} accent={accent} centerY={CAPTION_Y} hideFrom={endStart}
            hiOverride={sc?.bg === 'accent' ? (lum(accent) > 0.5 ? '#111111' : '#FFD93B') : undefined} lottie={p.lottie} gempak={gempak} />
        )}
      </AbsoluteFill>
      {gempak && <Flash impacts={impacts.filter((im) => im.power >= 0.8)} />}
      {p.sfx && <SfxTrack events={sfx} />}
      {p.audio && <Audio src={p.audio} />}
    </AbsoluteFill>
  );
};
