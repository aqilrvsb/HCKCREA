// Media collector. HyperFrames needs every <video> / <audio> / animated image
// in the static HTML with its timing, before any script runs. Rather than
// re-deriving the compositions' planning, the build step renders the real
// composition at every frame in Node with this collector switched on: each
// media element reports where it sits (the absolute start of its Sequence)
// and the frames it is visible, so the static timing always matches what the
// composition draws.
export const COLLECT = { on: false, frame: 0, seen: new Map() };

/** Called by the shim's media components while collecting. */
export function record(kind, src, ctx, extra = {}) {
  if (!COLLECT.on || !src) return;
  // inside a Sequence the media's own time starts at the Sequence start;
  // outside one (abs 0, dur Infinity) it starts when it first appears
  const inSeq = ctx.dur !== Infinity || ctx.abs !== 0;
  const key = `${kind}|${src}|${inSeq ? ctx.abs : "free"}`;
  const cur = COLLECT.seen.get(key);
  if (cur) {
    cur.last = COLLECT.frame;
    return;
  }
  COLLECT.seen.set(key, {
    kind, src, inSeq, abs: ctx.abs, dur: ctx.dur, first: COLLECT.frame, last: COLLECT.frame, ...extra,
  });
}

/** The collected media as page.mjs entries (seconds). */
export function collected(fps, totalFrames) {
  const out = [];
  for (const m of COLLECT.seen.values()) {
    const start = m.inSeq ? m.abs : m.first;
    const end = m.inSeq && m.dur !== Infinity ? Math.min(m.abs + m.dur, totalFrames) : Math.min(m.last + 1, totalFrames);
    if (end <= start) continue;
    const base = { src: m.src, start: start / fps, duration: (end - start) / fps };
    if (m.kind === "audio") out.push({ kind: "audio", ...base, volume: m.volume ?? 1 });
    else if (m.kind === "video") out.push({ kind: "video", ...base, hasAudio: !m.muted, volume: m.volume ?? 1 });
    else out.push({ kind: "image", ...base });
  }
  return out.sort((a, b) => a.start - b.start);
}
