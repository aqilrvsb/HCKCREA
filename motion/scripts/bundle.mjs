// Pre-bundle the compositions once (at Modal image build) so each job only
// renders — no per-job webpack build. Public files (sfx/) are copied in.
import { bundle } from '@remotion/bundler';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const out = await bundle({
  entryPoint: path.join(root, 'src', 'index.ts'),
  outDir: path.join(root, 'build'),
  publicDir: path.join(root, 'public'),
});
console.log('bundled →', out);
