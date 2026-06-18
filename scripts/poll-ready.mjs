// Poll an endpoint's /avatars until the renderer is READY (200), up to ~9 min.
import { readFileSync } from "node:fs";
const id = process.argv[2] || "aa097f9c349c7863";
const url = `https://${id}-${id}.runsync.novita.dev/avatars`;
const t0 = Date.now();
for (let i = 1; i <= 27; i++) {
  let code = 0;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    code = r.status;
  } catch (e) { code = 0; }
  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`t+${sec}s  try ${i}  /avatars -> ${code || "no-response"}`);
  if (code === 200) { console.log(`READY ✅ in ${sec}s`); process.exit(0); }
  if (i < 27) await new Promise((r) => setTimeout(r, 20000));
}
console.log("NOT ready within ~9min — still booting or env issue.");
