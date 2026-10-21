// Procedural music bed (+ optional VO mix), generalised from peningbot-promo
// music_ad1.mjs. No samples → no licensing. Usage:
//   node scripts/music.mjs job.json
// job.json:
//   { totalSec, seed?, mood?: "chill"|"upbeat"|"hype",
//     speech: [[startSec, endSec], ...],          // music ducks under these
//     marks?: { reveal?, price?, cta?, final? },  // section boundaries (sec)
//     bedOut: "/abs/bed.wav",
//     mix?: { vo: [{ file, start }], out: "/abs/final.wav", bedVol?: 0.55 } }
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const SR = 44100, DUR = Math.max(1, job.totalSec), N = Math.ceil(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);      // music (ducked under VO)
const VL = new Float32Array(N), VR = new Float32Array(N);    // reverb send
const XL = new Float32Array(N), XR = new Float32Array(N);    // hits (lighter ducking)
const TAU = Math.PI * 2;
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
let seed = Number(job.seed) || 11;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;

const mood = ['chill', 'upbeat', 'hype'].includes(job.mood) ? job.mood : 'upbeat';
const BPM = { chill: 88, upbeat: 100, hype: 116 }[mood];
const KEY = [-3, -2, 0, 2, 3][Math.floor(rnd() * 5)];        // transpose so every job sounds a bit different
const B = 60 / BPM, BAR = 4 * B;

function put(i, l, r, send = 0, sfx = false) {
  if (i < 0 || i >= N) return;
  if (sfx) { XL[i] += l; XR[i] += r; } else { L[i] += l; R[i] += r; }
  if (send) { VL[i] += l * send; VR[i] += r * send; }
}
const panLR = (p) => [Math.cos(p * Math.PI / 2) * 1.41, Math.sin(p * Math.PI / 2) * 1.41];

// ── instruments (verbatim from music_ad1.mjs) ────────────────────────────────
function piano(t0, m, vel, len = 2.5, pan = 0.5, send = 0.35) {
  const f = mtof(m + KEY), s0 = Math.floor(t0 * SR), n = Math.floor((len + 0.4) * SR);
  const [gl, gr] = panLR(pan);
  const H = 7, Bk = 0.00035;
  const fk = [], ak = [], dk = [];
  for (let k = 1; k <= H; k++) { fk.push(f * k * Math.sqrt(1 + Bk * k * k)); ak.push(Math.pow(k, -1.4) * (k === 1 ? 1 : 0.8)); dk.push((1.8 + 90 / f) / (1 + 0.45 * k)); }
  let lp = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    let v = 0;
    for (let k = 0; k < H; k++) v += ak[k] * Math.sin(TAU * fk[k] * t) * Math.exp(-t / dk[k]);
    const hammer = t < 0.012 ? (lp += 0.3 * (noise() - lp)) * (1 - t / 0.012) * 0.6 : 0;
    const rel = t > len ? Math.max(0, 1 - (t - len) / 0.4) : 1;
    const out = (v * 0.5 + hammer) * Math.min(1, t / 0.003) * rel * vel;
    put(s0 + j, out * gl, out * gr, send);
  }
}
function pad(t0, notes, len, vol, { cutoff = 1400, atk = 0.9, rel = 1.2, send = 0.5 } = {}) {
  const s0 = Math.floor(t0 * SR), n = Math.floor((len + rel) * SR);
  for (const [ni, m] of notes.entries()) {
    for (const [ci, cents] of [-9, 0, 9].entries()) {
      const f = mtof(m + KEY) * Math.pow(2, cents / 1200);
      const [gl, gr] = panLR(0.2 + 0.3 * ci + (ni % 2) * 0.05);
      let ph = rnd(), a1 = 0, a2 = 0;
      for (let j = 0; j < n; j++) {
        const t = j / SR;
        ph += f / SR; if (ph >= 1) ph -= 1;
        const fc = cutoff * (1 + 0.15 * Math.sin(TAU * 0.2 * (t0 + t)));
        const a = 1 - Math.exp(-TAU * fc / SR);
        a1 += a * ((2 * ph - 1) - a1); a2 += a * (a1 - a2);
        const env = Math.min(1, t / atk) * (t > len ? Math.max(0, 1 - (t - len) / rel) : 1);
        const out = a2 * env * vol;
        put(s0 + j, out * gl, out * gr, send);
      }
    }
  }
}
function bass(t0, m, len, vol, { cutoff = 500, pluck = false } = {}) {
  const f = mtof(m + KEY), s0 = Math.floor(t0 * SR), n = Math.floor((len + 0.08) * SR);
  let ph = 0, a1 = 0, a2 = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    ph += f / SR; if (ph >= 1) ph -= 1;
    const fc = pluck ? 180 + cutoff * Math.exp(-t / 0.09) : cutoff;
    const a = 1 - Math.exp(-TAU * fc / SR);
    a1 += a * ((2 * ph - 1) - a1); a2 += a * (a1 - a2);
    const env = Math.min(1, t / 0.005) * (t > len ? Math.max(0, 1 - (t - len) / 0.08) : 1) * (pluck ? 0.55 + 0.45 * Math.exp(-t / 0.25) : 1);
    const out = (a2 * 0.7 + Math.sin(TAU * ph) * 0.6) * env * vol;
    put(s0 + j, out, out, 0);
  }
}
function pluckSynth(t0, m, vol, pan = 0.5, send = 0.3, dec = 0.18) {
  const f = mtof(m + KEY), s0 = Math.floor(t0 * SR), n = Math.floor(0.9 * SR);
  const [gl, gr] = panLR(pan);
  let ph = 0, a1 = 0, a2 = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    ph += f / SR; if (ph >= 1) ph -= 1;
    const sq = (ph < 0.5 ? 1 : -1) * 0.6 + (2 * ph - 1) * 0.4;
    const fc = 300 + 5000 * Math.exp(-t / 0.06), a = 1 - Math.exp(-TAU * fc / SR);
    a1 += a * (sq - a1); a2 += a * (a1 - a2);
    const out = a2 * Math.min(1, t / 0.002) * Math.exp(-t / dec) * vol;
    put(s0 + j, out * gl, out * gr, send);
  }
}
function bell(t0, m, vol, pan = 0.5, send = 0.45) {
  const f = mtof(m + KEY), s0 = Math.floor(t0 * SR), n = Math.floor(1.6 * SR);
  const [gl, gr] = panLR(pan);
  for (let j = 0; j < n; j++) {
    const t = j / SR;
    const idx = 2.2 * Math.exp(-t / 0.25);
    const v = Math.sin(TAU * f * t + idx * Math.sin(TAU * f * 3.5 * t)) * 0.7 + Math.sin(TAU * f * 2 * t) * 0.15 * Math.exp(-t / 0.3);
    const out = v * Math.min(1, t / 0.003) * Math.exp(-t / 0.55) * vol;
    put(s0 + j, out * gl, out * gr, send);
  }
}
function tone(t0, len, f, vol, { atk = 0.01, dec = 0.3, sweep = null, pan = 0.5, send = 0, sfx = true } = {}) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(len * SR); let ph = 0;
  const [gl, gr] = panLR(pan);
  for (let j = 0; j < n; j++) {
    const t = j / SR; ph += TAU * (sweep ? sweep(t) : f) / SR;
    const out = Math.sin(ph) * Math.min(1, t / atk) * Math.exp(-t / dec) * vol;
    put(s0 + j, out * gl, out * gr, send, sfx);
  }
}
function noiseHit(t0, len, vol, { dec = 0.1, lpA = 0.3, hp = false, pan = 0.5, send = 0, sfx = false } = {}) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(len * SR); let lp = 0;
  const [gl, gr] = panLR(pan);
  for (let j = 0; j < n; j++) { const t = j / SR, x = noise(); lp += lpA * (x - lp); const v = (hp ? x - lp : lp) * Math.exp(-t / dec) * vol; put(s0 + j, v * gl, v * gr, send, sfx); }
}
const kick = (t, v) => tone(t, 0.5, 0, v, { atk: 0.002, dec: 0.16, sweep: (x) => 45 + 120 * Math.exp(-x / 0.03), sfx: false });
const clap = (t, v) => { for (const o of [0, 0.011, 0.022]) noiseHit(t + o, 0.2, v * (o ? 0.6 : 1), { dec: 0.05, lpA: 0.5, hp: true, send: 0.25 }); noiseHit(t + 0.03, 0.4, v * 0.5, { dec: 0.14, lpA: 0.35, send: 0.4 }); };
const hat = (t, v, pan = 0.6) => noiseHit(t, 0.06, v, { dec: 0.014, lpA: 0.2, hp: true, pan });
function riser(tA, tB, vol) {
  const s0 = Math.max(0, Math.floor(tA * SR)), s1 = Math.min(N, Math.floor(tB * SR)); let lp = 0, ph = 0;
  for (let i = s0; i < s1; i++) {
    const p = (i - s0) / Math.max(1, s1 - s0), fc = 250 * Math.pow(9000 / 250, p), a = 1 - Math.exp(-TAU * fc / SR);
    lp += a * (noise() - lp); ph += TAU * (120 + 800 * p * p) / SR;
    const v = (lp + Math.sin(ph) * 0.25) * p * p * vol; put(i, v, v, 0.3, true);
  }
}
function impact(t0, vol, bright = 0.45) {
  const s0 = Math.floor(t0 * SR), n = Math.floor(2.4 * SR); let ph = 0, lp = 0;
  for (let j = 0; j < n; j++) {
    const t = j / SR, f = 36 + 34 * Math.exp(-t / 0.07); ph += TAU * f / SR;
    const fc = 180 + 7000 * Math.exp(-t / 0.22), a = 1 - Math.exp(-TAU * fc / SR); lp += a * (noise() - lp);
    const v = (Math.sin(ph) * Math.exp(-t / 0.8) + lp * bright * Math.exp(-t / 0.45)) * vol;
    put(s0 + j, v, v, 0.25, true);
  }
}

// ── arrangement ───────────────────────────────────────────────────────────────
const m = job.marks || {};
const clampT = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const T_REVEAL = clampT(m.reveal ?? Math.min(DUR * 0.25, 6), 0, DUR);
const T_CTA = clampT(m.cta ?? DUR * 0.85, T_REVEAL, DUR);
const T_PRICE = m.price !== undefined ? clampT(m.price, T_REVEAL, T_CTA) : null;
const T_FINAL = clampT(m.final ?? (DUR > 10 ? DUR - 2.5 : DUR), T_CTA, DUR);

const chord = { Am: [57, 60, 64], F: [53, 57, 60], C: [48, 55, 60, 64], G: [55, 59, 62], Em: [52, 55, 59], Dm: [50, 53, 57] };
const root = { Am: 45, F: 41, C: 36, G: 43, Em: 40, Dm: 38 };
const PROGS = [['C', 'G', 'Am', 'F'], ['Am', 'F', 'C', 'G'], ['F', 'C', 'G', 'Am'], ['C', 'Am', 'F', 'G']];
const grooveProg = PROGS[Math.floor(rnd() * PROGS.length)];
const kickVol = { chill: 0.26, upbeat: 0.4, hype: 0.48 }[mood];

// HOOK — curious, a little tense
for (let t = 0, k = 0; t < T_REVEAL - 0.05; t += BAR, k++) {
  const c = ['Am', 'F', 'C', 'G'][k % 4];
  pad(t, chord[c].map((x) => x + 12), Math.min(BAR, T_REVEAL - t), 0.016, { cutoff: 1100, atk: 0.4, rel: 0.6 });
  for (let s = 0; s < 8; s++) {
    const tt = t + s * B / 2; if (tt >= T_REVEAL - 0.1) break;
    const notes = chord[c].map((x) => x + 12);
    pluckSynth(tt, notes[s % notes.length], 0.05, 0.35 + 0.3 * (s % 2), 0.25, 0.12);
    hat(tt + B / 4, 0.03, 0.65);
  }
  if (mood !== 'chill') for (const b of [0, 2]) { const tt = t + b * B; if (tt < T_REVEAL - 0.1) kick(tt, kickVol * 0.8); }
  if (k % 2 === 1) bass(t, root[c], BAR * 0.95, 0.07, { cutoff: 380 });
}

function groove(tA, tB, { kickOn = true, arp = true, hook = true } = {}) {
  for (let t = tA, k = 0; t < tB - 0.05; t += BAR, k++) {
    const c = grooveProg[k % 4], len = Math.min(BAR, tB - t);
    pad(t, chord[c].map((x) => x + 12), len, 0.014, { cutoff: 1800, atk: 0.15, rel: 0.5 });
    for (let s = 0; s < 8; s++) {
      const tt = t + s * B / 2; if (tt >= tB - 0.05) break;
      bass(tt, root[c] + (s % 4 === 3 ? 12 : 0), B / 2 * 0.85, 0.09, { cutoff: 700, pluck: true });
      if (arp) { const n = chord[c].map((x) => x + 24); pluckSynth(tt, n[(s + k) % n.length], 0.045, 0.3 + 0.4 * (s % 2), 0.3, 0.14); }
      hat(tt + B / 4, 0.035, 0.6); if (mood === 'hype') hat(tt, 0.02, 0.4);
    }
    for (let b = 0; b < 4; b++) { const tt = t + b * B; if (tt >= tB - 0.05) break; if (kickOn) kick(tt, kickVol); if (b % 2) clap(tt, mood === 'chill' ? 0.07 : 0.12); }
    if (hook && k % 4 === 0) [72, 76, 79, 76].forEach((x, j) => { const tt = t + j * B; if (tt < tB - 0.2) bell(tt, x, 0.05, 0.55, 0.45); });
  }
}

if (T_REVEAL > 0.8) { riser(T_REVEAL - Math.min(1.6, T_REVEAL), T_REVEAL, 0.12); impact(T_REVEAL, 0.3, 0.35); }
if (T_PRICE !== null) {
  groove(T_REVEAL, T_PRICE);
  groove(T_PRICE, T_CTA, { kickOn: false, hook: false });
  if (T_CTA - T_PRICE > 1.5) riser(T_CTA - 1.4, T_CTA, 0.1);
} else {
  groove(T_REVEAL, T_CTA);
}
if (T_FINAL - T_CTA > 0.5) { impact(T_CTA, 0.22, 0.3); groove(T_CTA, T_FINAL); }
if (DUR - T_FINAL > 0.8) {
  for (const x of [48, 55, 60, 64, 67, 72]) piano(T_FINAL, x, 0.12, Math.min(2.6, DUR - T_FINAL), 0.5, 0.6);
  bell(T_FINAL, 84, 0.06, 0.5, 0.6);
  pad(T_FINAL, [48, 55, 60, 64], Math.max(0.3, DUR - T_FINAL - 0.4), 0.02, { cutoff: 1600, atk: 0.1, rel: 0.5 });
}

// ── reverb (Freeverb-style) on the send bus ───────────────────────────────────
{
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116], aps = [556, 441, 341, 225], spread = 23, fb = 0.83, damp = 0.25;
  const run = (IN, off) => {
    const out = new Float32Array(N);
    for (const d0 of combs) {
      const d = d0 + off, buf = new Float32Array(d); let idx = 0, store = 0;
      for (let i = 0; i < N; i++) { const y = buf[idx]; store = y * (1 - damp) + store * damp; buf[idx] = IN[i] * 0.015 + store * fb; out[i] += y; idx = (idx + 1) % d; }
    }
    for (const d0 of aps) {
      const d = d0 + off, buf = new Float32Array(d); let idx = 0;
      for (let i = 0; i < N; i++) { const b = buf[idx]; const y = -out[i] + b; buf[idx] = out[i] + b * 0.5; out[i] = y; idx = (idx + 1) % d; }
    }
    return out;
  };
  const wl = run(VL, 0), wr = run(VR, spread);
  for (let i = 0; i < N; i++) { L[i] += wl[i] * 0.9; R[i] += wr[i] * 0.9; }
}

// ── duck under speech, sum ────────────────────────────────────────────────────
{
  // the bed dips 150 ms BEFORE each phrase (the first syllable is never masked), stays down through
  // pauses under 0.4 s (no pumping between words) and comes back slowly (450 ms)
  const speak = new Uint8Array(N);
  const spans = (job.speech || []).map(([a0, b0]) => [Math.max(0, a0 - 0.15), b0]).sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const sp of spans) { const last = merged[merged.length - 1]; if (last && sp[0] - last[1] < 0.4) last[1] = Math.max(last[1], sp[1]); else merged.push([...sp]); }
  for (const [a0, b0] of merged) { const a = Math.max(0, Math.floor(a0 * SR)), b = Math.min(N, Math.floor(b0 * SR)); for (let i = a; i < b; i++) speak[i] = 1; }
  let g = 1, gx = 1;
  const att = 1 - Math.exp(-1 / (0.06 * SR)), rel = 1 - Math.exp(-1 / (0.45 * SR));
  for (let i = 0; i < N; i++) {
    const tg = speak[i] ? 0.3 : 1, tx = speak[i] ? 0.7 : 1;
    g += (tg < g ? att : rel) * (tg - g); gx += (tx < gx ? att : rel) * (tx - gx);
    L[i] = L[i] * g + XL[i] * gx; R[i] = R[i] * g + XR[i] * gx;
  }
}

// ── master: soft clip, normalise, fades, write ────────────────────────────────
let peak = 1e-9;
for (let i = 0; i < N; i++) { L[i] = Math.tanh(L[i] * 1.4); R[i] = Math.tanh(R[i] * 1.4); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
const gN = 0.8 / peak;
for (let i = 0; i < N; i++) { const t = i / SR; const fade = t > DUR - 1.5 ? Math.max(0, (DUR - t) / 1.5) : t < 0.05 ? t / 0.05 : 1; L[i] *= gN * fade; R[i] *= gN * fade; }
const buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4); }
writeFileSync(job.bedOut, buf);
// leave room for the voice: a gentle dip where speech intelligibility lives (2.5 kHz)
try {
  const tmp = job.bedOut.replace(/\.wav$/i, '') + '_eq.wav';
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', job.bedOut, '-af', 'equalizer=f=2500:t=q:w=1:g=-3', '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s16le', tmp]);
  writeFileSync(job.bedOut, readFileSync(tmp));
} catch (e) { console.log('bed eq skipped:', String(e).slice(0, 120)); }
console.log(`bed ${DUR.toFixed(2)}s mood=${mood} bpm=${BPM} key=${KEY}`);

// ── optional: mix the voice-over over the bed ─────────────────────────────────
if (job.mix && Array.isArray(job.mix.vo) && job.mix.vo.length) {
  const bedVol = job.mix.bedVol ?? 0.55;
  const args = ['-v', 'error', '-y', '-i', job.bedOut];
  job.mix.vo.forEach((v) => args.push('-i', v.file));
  const chains = job.mix.vo.map((v, i) => { const ms = Math.max(0, Math.round(v.start * 1000)); return `[${i + 1}:a]aresample=44100,adelay=${ms}|${ms}[v${i}]`; });
  const filter = [
    ...chains,
    `${job.mix.vo.map((_, i) => `[v${i}]`).join('')}amix=inputs=${job.mix.vo.length}:normalize=0,highpass=f=70,equalizer=f=3000:t=q:w=1:g=2,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,loudnorm=I=-15:TP=-1.5:LRA=9[vo]`,
    `[0:a]volume=${bedVol}[bed]`,
    `[bed][vo]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]`,
  ].join(';');
  args.push('-filter_complex', filter, '-map', '[out]', '-t', String(DUR), '-ar', '44100', '-ac', '2', job.mix.out);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  console.log(`mix ${job.mix.out}`);
}
