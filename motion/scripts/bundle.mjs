// Pre-bundle the compositions once (at Modal image build) so each job only
// renders — no per-job webpack build. Public files (sfx/, sfx-lib/) are copied
// in. Before bundling, record which library SFX actually exist so the
// renderer never points at a missing file (src/sfx-available.json).
import { bundle } from '@remotion/bundler';
import { mouseClick, pageTurn, shutterModern, whip, whoosh } from '@remotion/sfx';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const lib = path.join(root, 'public', 'sfx-lib');

// @remotion/sfx sounds whose detail page says "License: Creative Commons 0"
// (checked 2026-10-12) — pulled into the local library at build time so a
// render never depends on remotion.media being reachable.
const REMOTION_SFX = { rsfx_whoosh: whoosh, rsfx_whip: whip, rsfx_page_turn: pageTurn, rsfx_click: mouseClick, rsfx_shutter: shutterModern };
const files = {};
for (const [name, url] of Object.entries(REMOTION_SFX)) {
  const file = `${name}.wav`;
  const dest = path.join(lib, file);
  if (!existsSync(dest)) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      console.warn(`@remotion/sfx ${name} not fetched (${e.message}) — skipped`);
      continue;
    }
  }
  files[name] = file;
}

const manifestPath = path.join(lib, 'manifest.json');
if (existsSync(manifestPath)) {
  try {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const f of m.files || []) {
      const file = f && f.name ? f.file || `${f.name}.mp3` : null;
      if (file && existsSync(path.join(lib, file))) files[f.name] = file;
    }
  } catch (e) {
    console.warn('sfx-lib manifest unreadable, using procedural SFX only:', e.message);
  }
}
const names = Object.keys(files);
writeFileSync(path.join(root, 'src', 'sfx-available.json'), JSON.stringify({ names, files }, null, 1));
console.log(`sfx-lib: ${names.length} library sounds available`);

const out = await bundle({
  entryPoint: path.join(root, 'src', 'index.ts'),
  outDir: path.join(root, 'build'),
  publicDir: path.join(root, 'public'),
});
console.log('bundled →', out);
