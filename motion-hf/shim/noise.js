// @remotion/noise for the Laju v2 shim: the same simplex noise seeded the same
// way (createNoise2D fed by Remotion's random(seed)), so idle drift matches.
import { createNoise2D } from "simplex-noise";
import { random } from "remotion";

const cache = new Map();
export const noise2D = (seed, x, y) => {
  let n = cache.get(seed);
  if (!n) {
    n = createNoise2D(() => random(seed));
    cache.set(seed, n);
  }
  return n(x, y);
};
