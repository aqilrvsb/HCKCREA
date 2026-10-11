// Render one job:  node scripts/render.mjs <serveUrl|bundleDir> <MotionAd|MotionEdit> <props.json> <out.mp4>
// Prints "PROGRESS <0-100>" lines so the Modal job can report render %.
import { readFileSync } from 'node:fs';
import { renderMedia, selectComposition } from '@remotion/renderer';

const [, , serveUrl, id, propsPath, outPath] = process.argv;
const inputProps = JSON.parse(readFileSync(propsPath, 'utf8'));
const concurrency = Number(process.env.RENDER_CONCURRENCY || 0) || null;

const composition = await selectComposition({ serveUrl, id, inputProps, timeoutInMilliseconds: 120000 });
let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: outPath,
  inputProps,
  concurrency,
  crf: 20,
  x264Preset: 'veryfast',
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioBitrate: '192k',
  timeoutInMilliseconds: 240000,
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 100);
    if (pct !== last && (pct % 5 === 0 || pct === 100)) { last = pct; console.log(`PROGRESS ${pct}`); }
  },
});
console.log('DONE', outPath);
