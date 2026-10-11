// Render one job (or one chunk of it):
//   node scripts/render.mjs <serveUrl|bundleDir> <MotionAd|MotionEdit> <props.json> <out> [--from N --to M] [--muted] [--audio-only]
// Env: RENDER_CONCURRENCY (default: Remotion's), RENDER_SCALE (1 = 1080x1920, 0.6667 = 720x1280).
// Prints "PROGRESS <0-100>" lines so the Modal job can report render %.
import { readFileSync } from 'node:fs';
import { renderMedia, selectComposition } from '@remotion/renderer';

const args = process.argv.slice(2);
const [serveUrl, id, propsPath, outPath] = args;
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : undefined;
};

const inputProps = JSON.parse(readFileSync(propsPath, 'utf8'));
const concurrency = Number(process.env.RENDER_CONCURRENCY || 0) || null;
const scale = Number(process.env.RENDER_SCALE || 1) || 1;
const audioOnly = flag('--audio-only');
const from = opt('--from');
const to = opt('--to');

const composition = await selectComposition({ serveUrl, id, inputProps, timeoutInMilliseconds: 120000 });
const frameRange = from !== undefined && to !== undefined
  ? [Math.max(0, from), Math.min(composition.durationInFrames - 1, to)]
  : null;

let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: audioOnly ? 'wav' : 'h264',
  outputLocation: outPath,
  inputProps,
  concurrency,
  scale,
  frameRange,
  muted: flag('--muted'),
  ...(audioOnly ? {} : { crf: 20, x264Preset: 'superfast', pixelFormat: 'yuv420p', audioCodec: 'aac', audioBitrate: '192k' }),
  offthreadVideoThreads: 4,
  timeoutInMilliseconds: 240000,
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 100);
    if (pct !== last && (pct % 5 === 0 || pct === 100)) { last = pct; console.log(`PROGRESS ${pct}`); }
  },
});
console.log('DONE', outPath);
