// Animated emoji via Google Noto Animated Emoji (Lottie, CC BY 4.0 — credited
// on the Motion tab). The job downloads the JSON next to the other assets and
// passes a char → URL map; anything missing falls back to the static glyph.
import React, { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import { Lottie, type LottieAnimationData } from '@remotion/lottie';
import type { LottieMap } from './types';

const cache = new Map<string, Promise<LottieAnimationData | null>>();

const load = (url: string) => {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    cache.set(url, p);
  }
  return p;
};

export const LottieEmoji: React.FC<{ char: string; size: number; lottie?: LottieMap }> = ({ char, size, lottie }) => {
  const url = lottie?.[char];
  const [data, setData] = useState<LottieAnimationData | null>(null);
  const [handle] = useState(() => (url ? delayRender(`emoji ${char}`, { timeoutInMilliseconds: 20000 }) : null));

  useEffect(() => {
    if (!url || handle === null) return;
    let alive = true;
    load(url).then((d) => {
      if (alive) setData(d);
      continueRender(handle);
    });
    return () => { alive = false; };
  }, [url, handle]);

  if (!url || !data) {
    return <span style={{ fontSize: size * 0.88, lineHeight: 1, display: 'inline-block' }}>{char}</span>;
  }
  return (
    <div style={{ width: size, height: size, display: 'inline-block' }}>
      <Lottie animationData={data} loop style={{ width: size, height: size }} />
    </div>
  );
};
