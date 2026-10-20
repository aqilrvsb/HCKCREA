// Assets a frame needs synchronously. Remotion waits for them with
// delayRender(); here they are fetched once before the timeline is
// registered, so every seek draws a complete frame.
export const LOTTIE_DATA = new Map();

export async function preloadLottie(map) {
  const urls = Object.values(map || {}).filter(Boolean);
  await Promise.all(urls.map(async (url) => {
    try {
      const r = await fetch(url);
      if (r.ok) LOTTIE_DATA.set(url, await r.json());
    } catch {
      // missing emoji animation → the static glyph is drawn instead
    }
  }));
}
