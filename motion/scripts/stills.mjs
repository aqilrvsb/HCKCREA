// Render QA / preview stills:
//   node scripts/stills.mjs <serveUrl|bundleDir> <MotionAd|MotionEdit> <props.json> <outDir> <frame,frame,...> [scale]
// Writes <outDir>/still_<frame>.jpg and prints "STILL <frame> <path>" per frame.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderStill, selectComposition } from '@remotion/renderer';

const [, , serveUrl, id, propsPath, outDir, framesArg, scaleArg] = process.argv;
const inputProps = JSON.parse(readFileSync(propsPath, 'utf8'));
const scale = Number(scaleArg) || 0.5;
mkdirSync(outDir, { recursive: true });

const composition = await selectComposition({ serveUrl, id, inputProps, timeoutInMilliseconds: 120000 });
const frames = String(framesArg || '0')
  .split(',')
  .map((x) => Math.max(0, Math.min(composition.durationInFrames - 1, Math.round(Number(x)))))
  .filter((x, i, a) => Number.isFinite(x) && a.indexOf(x) === i);

for (const frame of frames) {
  const output = path.join(outDir, `still_${frame}.jpg`);
  await renderStill({ composition, serveUrl, output, inputProps, frame, imageFormat: 'jpeg', jpegQuality: 82, scale, timeoutInMilliseconds: 120000 });
  console.log(`STILL ${frame} ${output}`);
}
