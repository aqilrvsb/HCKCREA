// HyperFrames registry blocks the director can place in a Pro edit (vendored in
// motion-hf/blocks, Apache-2.0). The director picks the block, its moment and
// its words; here each one gets its box size, its time window limits and a
// sanitiser that turns the director's fields into the block's own variables
// (never more than the block declares, text clipped to what fits). Colours come
// from the look through CSS variables: "green" in a block = --brand (the
// caption highlight), "blue" = --accent (the look's second colour).
// Only one instance of a block per video: its timeline registers under the
// block's own id. The kit keeps the blocks that read well as a 9:16 overlay
// (checked on real footage); the registry's other text blocks came out small
// or carried demo content in a vertical frame.

type Vars = Record<string, string | number | boolean>;
export type BlockDef = { w: number; h: number; min: number; max: number; vars: (g: Record<string, unknown>) => Vars | null };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const numOr = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

export const BLOCKS: Record<string, BlockDef> = {
  'shutter-slam': { w: 980, h: 320, min: 2.6, max: 5, vars: (g) => { const text = str(g.text, 14); return text ? { text, accent: 'green', blur: 'shutter', cues: '', exit: 'fade' } : null; } },
  'count-up': {
    w: 900, h: 320, min: 2.8, max: 4.5,
    vars: (g) => {
      const end = Number(g.end);
      if (!Number.isFinite(end)) return null;
      return { start: numOr(g.start, 0), end, prefix: str(g.prefix, 4), suffix: str(g.suffix, 4), accent: 'green', glow: true, exit: 'fade' };
    },
  },
  'star-rating-fill': {
    w: 820, h: 230, min: 2.6, max: 4,
    vars: (g) => { const r = Number(g.rating); return Number.isFinite(r) && r > 0 && r <= 5 ? { rating: Math.round(r * 10) / 10, starCount: 5, showValue: 'yes' } : null; },
  },

};

/** Every block is a 16:9 scene (its type scales with the box): it is mounted full-width at 16:9 in the band
 *  above the speaker's face, which stickers leave free while it plays (like a picture-in-picture card). */
export const BLOCK_BOX = { left: 0, top: 170, width: 1080, height: 608 };
