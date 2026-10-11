// Pre-bundle the compositions once (at Modal image build) so each job only
// renders — no per-job webpack build. Public files (sfx/, sfx-lib/) are copied
// in. Before bundling, record which library SFX actually exist so the
// renderer never points at a missing file (src/sfx-available.json).
import { bundle } from '@remotion/bundler';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const manifestPath = path.join(root, 'public', 'sfx-lib', 'manifest.json');
let names = [];
if (existsSync(manifestPath)) {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    names = (m.files || [])
      .filter((f) => f && f.name && existsSync(path.join(root, 'public', 'sfx-lib', f.file || `${f.name}.mp3`)))
      .map((f) => f.name);
  } catch (e) {
    console.warn('sfx-lib manifest unreadable, using procedural SFX only:', e.message);
  }
}
writeFileSync(path.join(root, 'src', 'sfx-available.json'), JSON.stringify({ names }, null, 1));
console.log(`sfx-lib: ${names.length} library sounds available`);

const out = await bundle({
  entryPoint: path.join(root, 'src', 'index.ts'),
  outDir: path.join(root, 'build'),
  publicDir: path.join(root, 'public'),
});
console.log('bundled →', out);
