// Short synthesized SFX -> public/sfx/*.wav (no samples, no licensing). Ported from peningbot-promo.
import { mkdirSync, writeFileSync } from 'node:fs';

const SR = 44100, TAU = Math.PI * 2;
const OUT = new URL('../public/sfx/', import.meta.url);
mkdirSync(OUT, { recursive: true });
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;

function save(name, L, R = L) {
  let peak = 1e-9;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.9 / peak, N = L.length, buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(L[i] * g * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(R[i] * g * 32767), 46 + i * 4); }
  writeFileSync(new URL(`${name}.wav`, OUT), buf);
  console.log(name, (N / SR).toFixed(2) + 's');
}
const arr = (sec) => new Float32Array(Math.ceil(sec * SR));

// pop: sticky note landing — short pitched blip + soft paper tick
{ const a = arr(0.18); let ph = 0;
  for (let i = 0; i < a.length; i++) { const t = i / SR; const f = 280 + 900 * Math.exp(-t / 0.018); ph += TAU * f / SR;
    a[i] = Math.sin(ph) * Math.exp(-t / 0.045) * 0.9 + noise() * Math.exp(-t / 0.006) * 0.25; }
  save('pop', a); }

// thump: headline slap — low body + click
{ const a = arr(0.35); let ph = 0, lp = 0;
  for (let i = 0; i < a.length; i++) { const t = i / SR; const f = 70 + 140 * Math.exp(-t / 0.03); ph += TAU * f / SR;
    lp += 0.25 * (noise() - lp);
    a[i] = Math.sin(ph) * Math.exp(-t / 0.12) + lp * Math.exp(-t / 0.02) * 0.6; }
  save('thump', a); }

// paper: tape laid down — filtered noise swipe
{ const a = arr(0.32); let lp = 0, hp = 0;
  for (let i = 0; i < a.length; i++) { const t = i / SR, p = t / 0.32; const x = noise();
    lp += 0.35 * (x - lp); hp = x - lp;
    const env = Math.sin(Math.min(1, p) * Math.PI) ** 1.5;
    a[i] = (hp * 0.7 + lp * 0.3) * env * (0.6 + 0.4 * Math.sin(TAU * 38 * t)); }
  save('paper', a); }

// swoosh: card/presenter slides in
{ const L = arr(0.45), R = arr(0.45); let lp = 0;
  for (let i = 0; i < L.length; i++) { const t = i / SR, p = t / 0.45;
    const fc = 300 + 4200 * Math.sin(Math.min(1, p) * Math.PI); const a = 1 - Math.exp(-TAU * fc / SR); lp += a * (noise() - lp);
    const env = Math.sin(Math.min(1, p) * Math.PI) ** 2; const pan = 0.5 + 0.4 * (p - 0.5);
    L[i] = lp * env * Math.cos(pan * Math.PI / 2); R[i] = lp * env * Math.sin(pan * Math.PI / 2); }
  save('swoosh', L, R); }

// whoosh: scene change — longer, airier
{ const L = arr(0.6), R = arr(0.6); let lp = 0;
  for (let i = 0; i < L.length; i++) { const t = i / SR, p = t / 0.6;
    const fc = 500 + 6000 * p * p; const a = 1 - Math.exp(-TAU * fc / SR); lp += a * (noise() - lp);
    const env = p < 0.8 ? (p / 0.8) ** 2 : Math.exp(-(p - 0.8) / 0.05); const pan = 0.2 + 0.6 * p;
    L[i] = lp * env * Math.cos(pan * Math.PI / 2); R[i] = lp * env * Math.sin(pan * Math.PI / 2); }
  save('whoosh', L, R); }

// tick: check mark drawn — two bright clicks
{ const a = arr(0.2); for (const [o, f] of [[0, 2400], [0.07, 3200]]) {
    const s0 = Math.floor(o * SR); for (let j = 0; s0 + j < a.length; j++) { const t = j / SR; a[s0 + j] += Math.sin(TAU * f * t) * Math.exp(-t / 0.012); } }
  save('tick', a); }

// stamp: rubber stamp — thud + body + slap
{ const a = arr(0.5); let ph = 0, lp = 0;
  for (let i = 0; i < a.length; i++) { const t = i / SR; const f = 55 + 90 * Math.exp(-t / 0.025); ph += TAU * f / SR;
    lp += 0.12 * (noise() - lp);
    a[i] = Math.sin(ph) * Math.exp(-t / 0.16) * 1.1 + lp * Math.exp(-t / 0.05) * 1.4 + noise() * Math.exp(-t / 0.004) * 0.5; }
  save('stamp', a); }

// marker: felt pen scribble — bandpassed noise with stroke rhythm (long; trimmed in video)
{ const a = arr(2.6); let lp1 = 0, lp2 = 0;
  for (let i = 0; i < a.length; i++) { const t = i / SR; const x = noise();
    lp1 += 0.5 * (x - lp1); lp2 += 0.08 * (lp1 - lp2); const band = lp1 - lp2;
    const strokes = 0.55 + 0.45 * Math.abs(Math.sin(TAU * 4.3 * t + Math.sin(TAU * 1.1 * t)));
    a[i] = band * strokes * Math.min(1, t / 0.02); }
  save('marker', a); }

// sparkle: "best kan" — quick rising bell arpeggio
{ const L = arr(0.9), R = arr(0.9);
  [84, 88, 91, 96].forEach((m, k) => { const f = 440 * Math.pow(2, (m - 69) / 12); const s0 = Math.floor(k * 0.06 * SR);
    for (let j = 0; s0 + j < L.length; j++) { const t = j / SR; const v = Math.sin(TAU * f * t + 1.5 * Math.exp(-t / 0.2) * Math.sin(TAU * f * 3 * t)) * Math.exp(-t / 0.3);
      const pan = 0.25 + 0.17 * k; L[s0 + j] += v * Math.cos(pan * Math.PI / 2); R[s0 + j] += v * Math.sin(pan * Math.PI / 2); } });
  save('sparkle', L, R); }
