// CLIPPER director eval: how well does each director version find the moments viewers actually replay?
//
// Answer key = YouTube's "most replayed" heatmap (RHAPSODY, arXiv 2505.19429). The heatmap is HIDDEN from the
// director (heatmap: []) — it only sees the title + transcript, exactly like an Upload / Google Drive source.
// Data: fetch.py caches <dir>/videos/<id>.json (meta, heat, lines). Picks are cached per version in
// <dir>/picks/<version>/<id>.json so a rerun only re-scores (pass --force to call the LLM again).
//
//   npx tsx --env-file=.env.local scripts/clipper-eval/run.ts --dir <cache dir> [--versions v1,v2] [--only ID,ID]
//       [--concurrency 3] [--count 5] [--random-n 200] [--no-deadline] [--force] [--score-only]
//
// Writes <dir>/results.json (aggregate + per video + every pick) and <dir>/picks.md (for eyeballing).
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as v2 from "@/lib/clipper";
import { withDeadline } from "@/lib/openrouter";
import * as v1 from "./clipper-v1";

type HeatPoint = { start: number; end: number; value: number };
type Line = { start: number; end: number; text: string };
type Video = { id: string; url: string; lang_hint: string; meta: { title?: string; channel?: string; duration: number }; lang?: string | null; heat: HeatPoint[]; lines: Line[] };
type Clip = { start: number; end: number; title: string; hook?: string; score: number; scores?: unknown; reason?: string; quote?: string; text?: string };
type CallRec = { role: string; model: string; ms: number; status: number; reqChars: number; resChars: number; error?: string };
type Picks = {
  version: string; id: string; ran_at: string; ms: number; director: string | null; fallback: boolean; summary: string;
  error?: string; calls: CallRec[]; deadline_ms: number | null; clips: Clip[];
};

const VERSIONS: Record<string, { label: string; directClips: (o: any) => Promise<{ summary: string; clips: Clip[]; director: string | null; fallback: boolean }>; cleanOptions: (r: any) => any }> = {
  v1: { label: "v1 — commit 06e7f87: one pass over the whole transcript + one repair pass", directClips: v1.directClips, cleanOptions: v1.cleanOptions },
  v2: { label: "v2 — lib/clipper.ts (working tree): ~25-min parts in parallel → pool → two judges", directClips: v2.directClips, cleanOptions: v2.cleanOptions },
};

// ── args ─────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const has = (k: string) => a.includes(`--${k}`);
  return {
    dir: path.resolve(get("dir") || process.env.CLIPPER_EVAL_DIR || path.join(os.tmpdir(), "clipper-eval")),
    versions: (get("versions") || "v1,v2").split(",").map((s) => s.trim()).filter((v) => v in VERSIONS),
    only: (get("only") || "").split(",").map((s) => s.trim()).filter(Boolean),
    concurrency: Math.max(1, Number(get("concurrency") || 3)),
    count: Math.max(1, Number(get("count") || 5)),
    randomN: Math.max(10, Number(get("random-n") || 200)),
    deadline: !has("no-deadline"),
    force: has("force"),
    scoreOnly: has("score-only"),
  };
}
const ARGS = parseArgs();
const BUDGET_MS = 270_000; // app/api/clipper/plan/route.ts BUDGET_MS — the director's real-world time box
const TOP_FRAC = 0.10;      // "hit" = overlaps a bucket in the top 10 % of heat values…
const SKIP_HEAD = 0.03;     // …ignoring the first 3 % of the video (intros / chapter-skip spikes)

// ── LLM call accounting: every POST …/chat/completions inside a run is recorded on that run ──────────────────────
const callStore = new AsyncLocalStorage<CallRec[]>();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? "");
  const store = callStore.getStore();
  if (!store || !/\/chat\/completions\/?$/.test(url)) return realFetch(input, init);
  const rec: CallRec = { role: "?", model: "?", ms: 0, status: 0, reqChars: 0, resChars: 0 };
  try {
    const b = JSON.parse(String(init?.body ?? "{}"));
    rec.model = String(b.model ?? "?");
    const msgs: any[] = Array.isArray(b.messages) ? b.messages : [];
    rec.reqChars = msgs.reduce((n, m) => n + (typeof m?.content === "string" ? m.content.length : 0), 0);
    const sys = String(msgs[0]?.content ?? "");
    rec.role = /strict final judge/.test(sys) ? "judge" : /checking viral clip candidates/.test(sys) ? "repair" : /MASTER DIRECTOR/.test(sys) ? "finder" : "other";
  } catch { /* not JSON */ }
  store.push(rec);
  const t = Date.now();
  try {
    const res = await realFetch(input, init);
    rec.status = res.status;
    rec.ms = Date.now() - t;
    const text = res.text.bind(res);
    (res as any).text = async () => {
      try { const s = await text(); rec.resChars = s.length; return s; }
      catch (e: any) { rec.error = String(e?.name || e?.message || e).slice(0, 80); throw e; }
      finally { rec.ms = Date.now() - t; }
    };
    return res;
  } catch (e: any) {
    rec.ms = Date.now() - t;
    rec.error = String(e?.name || e?.message || e).slice(0, 80);
    throw e;
  }
}) as typeof fetch;

// ── metrics ──────────────────────────────────────────────────────────────────
/** Mean heat over [s, e], each overlapping bucket weighted by how much of it the span covers. */
function heatOver(heat: HeatPoint[], s: number, e: number): number {
  let w = 0, a = 0;
  for (const h of heat) {
    const ov = Math.min(h.end, e) - Math.max(h.start, s);
    if (ov > 0) { a += h.value * ov; w += ov; }
  }
  if (w > 0) return a / w;
  const mid = (s + e) / 2; // past the heatmap's end: the nearest bucket
  return heat.reduce((b, h) => (Math.abs((h.start + h.end) / 2 - mid) < Math.abs((b.start + b.end) / 2 - mid) ? h : b)).value;
}
/** The answer key: the top 10 % heat buckets (ties included), buckets in the first 3 % of the video excluded. */
function topBuckets(heat: HeatPoint[], dur: number): HeatPoint[] {
  const elig = heat.filter((h) => (h.start + h.end) / 2 >= SKIP_HEAD * dur);
  if (!elig.length) return [];
  const k = Math.max(1, Math.round(TOP_FRAC * elig.length));
  const thr = [...elig].sort((x, y) => y.value - x.value)[k - 1].value;
  return elig.filter((h) => h.value >= thr);
}
const hits = (top: HeatPoint[], s: number, e: number) => top.some((h) => h.end > s && h.start < e);
/** Seeded PRNG (mulberry32) so the random baseline is identical across reruns. */
function rng(seedStr: string) {
  let a = createHash("sha1").update(seedStr).digest().readUInt32LE(0);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Where a pick's heat sits among EVERY same-length window of the video (2 s steps): 0.5 = what chance gives. */
function heatPercentile(heat: HeatPoint[], dur: number, len: number, v: number): number {
  let below = 0, eq = 0, n = 0;
  for (let s = 0; s + len <= dur; s += 2) {
    const h = heatOver(heat, s, s + len);
    if (Math.abs(h - v) < 1e-9) eq++; else if (h < v) below++;
    n++;
  }
  return n ? (below + eq / 2) / n : 0.5;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
const r3 = (x: number) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

type Scored = {
  version: string; n: number; p_at_k: number; p_strict: number; hits: number; mean_heat: number; mean_pct: number;
  rand_p: number; rand_heat: number; lift: number; ms: number; calls: number; calls_by_role: Record<string, number>;
  req_chars: number; director: string | null; fallback: boolean; error?: string;
  picks: { rank: number; start: number; end: number; len: number; score: number; heat: number; pct: number; hit: boolean; title: string; hook?: string; reason?: string; quote?: string; link: string }[];
};
function score(v: Video, p: Picks): Scored {
  const dur = v.meta.duration || v.lines[v.lines.length - 1].end;
  const top = topBuckets(v.heat, dur);
  const k = ARGS.count;
  const picks = p.clips.map((c, i) => {
    const heat = heatOver(v.heat, c.start, c.end);
    return {
      rank: i + 1, start: c.start, end: c.end, len: Math.round((c.end - c.start) * 10) / 10, score: c.score,
      heat: r3(heat)!, pct: r3(heatPercentile(v.heat, dur, c.end - c.start, heat))!, hit: hits(top, c.start, c.end),
      title: c.title, hook: c.hook, reason: c.reason, quote: c.quote, link: `https://youtu.be/${v.id}?t=${Math.floor(c.start)}`,
    };
  });
  const topk = picks.slice(0, k);
  // random baseline: N spans with the same lengths as this version's top-k picks, uniform over the video
  const lens = topk.length ? topk.map((x) => x.end - x.start) : [40];
  const rand = rng(`${v.id}:${p.version}`);
  let rh = 0, rp = 0;
  for (let i = 0; i < ARGS.randomN; i++) {
    const L = Math.min(lens[i % lens.length], dur);
    const s = rand() * (dur - L);
    rh += heatOver(v.heat, s, s + L);
    rp += hits(top, s, s + L) ? 1 : 0;
  }
  const meanHeat = mean(topk.map((x) => x.heat));
  const randHeat = rh / ARGS.randomN;
  const byRole: Record<string, number> = {};
  for (const c of p.calls) byRole[c.role] = (byRole[c.role] ?? 0) + 1;
  const h = topk.filter((x) => x.hit).length;
  return {
    version: p.version, n: picks.length, hits: h, p_at_k: topk.length ? h / topk.length : 0, p_strict: h / k,
    mean_heat: meanHeat, mean_pct: mean(topk.map((x) => x.pct)), rand_p: rp / ARGS.randomN, rand_heat: randHeat,
    lift: meanHeat / randHeat, ms: p.ms, calls: p.calls.length, calls_by_role: byRole,
    req_chars: p.calls.reduce((a, c) => a + c.reqChars, 0), director: p.director, fallback: p.fallback,
    ...(p.error ? { error: p.error } : {}), picks,
  };
}

// ── running a director ───────────────────────────────────────────────────────
/** The eval set = videos.json minus backup / exclude entries (or exactly --only), each read from fetch.py's cache. */
function loadVideos(): Video[] {
  const list: { id: string; lang?: string; backup?: boolean; exclude?: string }[] = JSON.parse(fs.readFileSync(path.join(__dirname, "videos.json"), "utf8")).videos;
  const want = ARGS.only.length ? list.filter((x) => ARGS.only.includes(x.id)) : list.filter((x) => !x.backup && !x.exclude);
  const out: Video[] = [];
  for (const x of want) {
    const f = path.join(ARGS.dir, "videos", `${x.id}.json`);
    if (!fs.existsSync(f)) { console.warn(`! ${x.id}: not fetched (run fetch.py) — skipped`); continue; }
    out.push({ ...(JSON.parse(fs.readFileSync(f, "utf8")) as Video), lang_hint: x.lang || "ms" });
  }
  return out;
}

async function runVersion(ver: string, v: Video): Promise<Picks> {
  const file = path.join(ARGS.dir, "picks", ver, `${v.id}.json`);
  if (fs.existsSync(file) && !ARGS.force) {
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) as Picks;
    if (!cached.error || ARGS.scoreOnly) return cached;
  }
  if (ARGS.scoreOnly) throw new Error(`no cached picks for ${ver}/${v.id}`);
  const impl = VERSIONS[ver];
  // the same normalisation as app/api/clipper/plan/route.ts
  const num = (x: unknown) => Math.round((Number(x) || 0) * 100) / 100;
  const lines = v.lines.map((l) => ({ start: num(l.start), end: num(l.end), text: String(l.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400) }))
    .filter((l) => l.text && l.end > l.start);
  const meta = { title: v.meta.title ?? null, channel: v.meta.channel ?? null, duration: Number(v.meta.duration) || lines[lines.length - 1].end, language: v.lang ?? null };
  const options = impl.cleanOptions({ duration: "auto", count: ARGS.count, language: v.lang_hint || "ms" });
  const calls: CallRec[] = [];
  const t0 = Date.now();
  const deadline = ARGS.deadline ? t0 + BUDGET_MS : undefined;
  let out: Picks;
  try {
    const go = () => impl.directClips({ meta, heatmap: [], lines, options, ...(deadline ? { deadline } : {}) }); // heatmap HIDDEN
    const r = await callStore.run(calls, () => (deadline ? withDeadline(deadline, go) : go()));
    out = { version: ver, id: v.id, ran_at: new Date().toISOString(), ms: Date.now() - t0, director: r.director, fallback: r.fallback, summary: r.summary,
      calls, deadline_ms: deadline ? BUDGET_MS : null,
      clips: r.clips.map((c) => ({ start: c.start, end: c.end, title: c.title, hook: c.hook, score: c.score, scores: (c as any).scores, reason: c.reason, quote: c.quote, text: (c.text ?? "").slice(0, 600) })) };
  } catch (e: any) {
    out = { version: ver, id: v.id, ran_at: new Date().toISOString(), ms: Date.now() - t0, director: null, fallback: false, summary: "", calls, deadline_ms: deadline ? BUDGET_MS : null, clips: [], error: String(e?.message || e).slice(0, 400) };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** Paired bootstrap 95 % CI of mean(b − a) over videos. */
function bootCI(a: number[], b: number[], iters = 4000): [number, number] {
  const d = a.map((x, i) => b[i] - x).filter(Number.isFinite);
  if (d.length < 2) return [NaN, NaN];
  const r = rng("bootstrap");
  const ms: number[] = [];
  for (let k = 0; k < iters; k++) { let s = 0; for (let i = 0; i < d.length; i++) s += d[Math.floor(r() * d.length)]; ms.push(s / d.length); }
  ms.sort((x, y) => x - y);
  return [ms[Math.floor(0.025 * iters)], ms[Math.floor(0.975 * iters)]];
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  const videos = loadVideos();
  if (!videos.length) throw new Error("no videos");
  console.log(`${videos.length} videos · versions ${ARGS.versions.join(", ")} · top-${ARGS.count} · deadline ${ARGS.deadline ? `${BUDGET_MS / 1000}s` : "off"} · ${ARGS.dir}`);
  const per: { v: Video; s: Record<string, Scored>; picks: Record<string, Picks> }[] = await pool(videos, ARGS.concurrency, async (v) => {
    const s: Record<string, Scored> = {}, picks: Record<string, Picks> = {};
    for (const ver of ARGS.versions) {
      const p = await runVersion(ver, v).catch((e) => ({ version: ver, id: v.id, ran_at: "", ms: 0, director: null, fallback: false, summary: "", calls: [], deadline_ms: null, clips: [], error: String(e?.message || e) } as Picks));
      picks[ver] = p;
      s[ver] = score(v, p);
      const x = s[ver];
      console.log(`  ${v.id} ${ver}: P@${ARGS.count} ${x.p_at_k.toFixed(2)} (rand ${x.rand_p.toFixed(2)}) heat ${x.mean_heat.toFixed(2)} (rand ${x.rand_heat.toFixed(2)}) · ${Math.round(x.ms / 1000)}s · ${x.calls} calls${p.error ? ` · ERROR ${p.error}` : ""}${p.fallback ? " · FALLBACK" : ""}`);
    }
    return { v, s, picks };
  });

  // aggregate (videos where the version produced picks)
  const agg: Record<string, any> = {};
  for (const ver of ARGS.versions) {
    const ok = per.filter((r) => r.s[ver] && r.s[ver].n > 0);
    const S = ok.map((r) => r.s[ver]);
    agg[ver] = {
      label: VERSIONS[ver].label, videos: ok.length, failed: per.length - ok.length,
      p_at_k: r3(mean(S.map((x) => x.p_at_k))), p_at_k_strict: r3(mean(S.map((x) => x.p_strict))), random_p_at_k: r3(mean(S.map((x) => x.rand_p))),
      mean_heat: r3(mean(S.map((x) => x.mean_heat))), random_heat: r3(mean(S.map((x) => x.rand_heat))),
      heat_lift: r3(mean(S.map((x) => x.lift))), heat_percentile: r3(mean(S.map((x) => x.mean_pct))),
      mean_clip_len: r3(mean(S.flatMap((x) => x.picks.slice(0, ARGS.count).map((p) => p.len)))),
      // "auto" length caps a clip at 90 s: how many picks sit at the cap (the model wanted longer)
      share_len_ge_85s: r3(mean(S.flatMap((x) => x.picks.slice(0, ARGS.count).map((p) => (p.len >= 85 ? 1 : 0))))),
      short_lists: S.filter((x) => x.n < ARGS.count).length,
      mean_sec: r3(mean(S.map((x) => x.ms / 1000))), mean_llm_calls: r3(mean(S.map((x) => x.calls))),
      total_llm_calls: S.reduce((a, x) => a + x.calls, 0), fallbacks: S.filter((x) => x.fallback).length,
      directors: [...new Set(S.map((x) => x.director).filter(Boolean))],
    };
  }
  let h2h: any = null;
  if (ARGS.versions.includes("v1") && ARGS.versions.includes("v2")) {
    const both = per.filter((r) => r.s.v1?.n && r.s.v2?.n);
    const a = both.map((r) => r.s.v1.p_at_k), b = both.map((r) => r.s.v2.p_at_k);
    const la = both.map((r) => r.s.v1.lift), lb = both.map((r) => r.s.v2.lift);
    h2h = {
      videos: both.length,
      p_at_k_v2_minus_v1: r3(mean(b) - mean(a)), p_at_k_ci95: bootCI(a, b).map(r3),
      p_strict_v2_minus_v1: r3(mean(both.map((r) => r.s.v2.p_strict)) - mean(both.map((r) => r.s.v1.p_strict))),
      p_strict_ci95: bootCI(both.map((r) => r.s.v1.p_strict), both.map((r) => r.s.v2.p_strict)).map(r3),
      lift_v2_minus_v1: r3(mean(lb) - mean(la)), lift_ci95: bootCI(la, lb).map(r3),
      v2_better: both.filter((r) => r.s.v2.p_at_k > r.s.v1.p_at_k).length, tie: both.filter((r) => r.s.v2.p_at_k === r.s.v1.p_at_k).length,
      v1_better: both.filter((r) => r.s.v2.p_at_k < r.s.v1.p_at_k).length,
    };
  }
  const sha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex").slice(0, 12);
  const results = {
    generated_at: new Date().toISOString(),
    config: { k: ARGS.count, top_frac: TOP_FRAC, skip_head: SKIP_HEAD, random_n: ARGS.randomN, deadline_ms: ARGS.deadline ? BUDGET_MS : null, options: { duration: "auto", count: ARGS.count, language: "per video (videos.json lang)" }, heatmap_shown_to_director: false },
    code: { v1: "git 06e7f87:lib/clipper.ts (scripts/clipper-eval/clipper-v1.ts)", v2_lib_clipper_sha256: sha(path.resolve("lib/clipper.ts")) },
    aggregate: agg, head_to_head: h2h,
    per_video: per.map(({ v, s, picks }) => ({
      id: v.id, title: v.meta.title, channel: v.meta.channel, duration_min: Math.round((v.meta.duration || 0) / 60), lang: v.lang, lang_hint: v.lang_hint,
      lines: v.lines.length, answer_key: topBuckets(v.heat, v.meta.duration).map((h) => ({ start: h.start, end: h.end, value: h.value })),
      versions: Object.fromEntries(Object.entries(s).map(([ver, x]) => [ver, { ...x, mean_heat: r3(x.mean_heat), mean_pct: r3(x.mean_pct), rand_p: r3(x.rand_p), rand_heat: r3(x.rand_heat), lift: r3(x.lift), summary: picks[ver].summary, calls_detail: picks[ver].calls }])),
    })),
  };
  fs.writeFileSync(path.join(ARGS.dir, "results.json"), JSON.stringify(results, null, 1));

  // picks.md — every pick, for a human to eyeball against the answer key
  const md: string[] = [`# CLIPPER director eval — picks`, ``, `Generated ${results.generated_at}. Heat = mean "most replayed" value over the clip (0–1); pct = percentile among every same-length window of the video (0.5 = chance); ✅ = overlaps a top-10 % bucket.`, ``];
  for (const { v, s } of per) {
    md.push(`## ${v.meta.title} (${v.id}, ${Math.round(v.meta.duration / 60)} min, ${v.meta.channel})`, ``);
    md.push(`Answer key (top heat buckets): ${topBuckets(v.heat, v.meta.duration).sort((a, b) => a.start - b.start).map((h) => `${mmss(h.start)}–${mmss(h.end)} (${h.value.toFixed(2)})`).join(", ")}`, ``);
    for (const ver of ARGS.versions) {
      const x = s[ver];
      if (!x) continue;
      md.push(`**${ver}** — P@${ARGS.count} ${x.p_at_k.toFixed(2)} (random ${x.rand_p.toFixed(2)}), heat ${x.mean_heat.toFixed(2)} (random ${x.rand_heat.toFixed(2)}), ${Math.round(x.ms / 1000)} s, ${x.calls} LLM calls${x.error ? `, ERROR: ${x.error}` : ""}`, ``);
      md.push(`| # | span | len | score | heat | pct | hit | title / hook |`, `|---|---|---|---|---|---|---|---|`);
      for (const p of x.picks) md.push(`| ${p.rank} | [${mmss(p.start)}–${mmss(p.end)}](${p.link}) | ${Math.round(p.len)}s | ${p.score} | ${p.heat.toFixed(2)} | ${p.pct.toFixed(2)} | ${p.hit ? "✅" : ""} | ${String(p.title).replace(/\|/g, "/")} — _${String(p.hook ?? "").replace(/\|/g, "/")}_ |`);
      md.push(``);
    }
  }
  fs.writeFileSync(path.join(ARGS.dir, "picks.md"), md.join("\n"));

  // console summary
  console.log(`\nAGGREGATE (mean over videos; P@${ARGS.count} = share of the top-${ARGS.count} picks overlapping a top-10 % heat bucket; P@k/k = hits ÷ k, a short list counts as misses)`);
  console.log(`version  videos  P@k    P@k/k  rand-P  heat   rand-heat  lift   pct    len   sec   calls`);
  for (const ver of ARGS.versions) {
    const a = agg[ver];
    console.log(`${ver.padEnd(8)} ${String(a.videos).padEnd(7)} ${a.p_at_k?.toFixed(2).padEnd(6)} ${a.p_at_k_strict?.toFixed(2).padEnd(6)} ${a.random_p_at_k?.toFixed(2).padEnd(7)} ${a.mean_heat?.toFixed(2).padEnd(6)} ${a.random_heat?.toFixed(2).padEnd(10)} ${a.heat_lift?.toFixed(2).padEnd(6)} ${a.heat_percentile?.toFixed(2).padEnd(6)} ${String(Math.round(a.mean_clip_len)).padEnd(5)} ${String(Math.round(a.mean_sec)).padEnd(5)} ${a.mean_llm_calls?.toFixed(1)}`);
  }
  if (h2h) console.log(`v2 − v1: P@k ${h2h.p_at_k_v2_minus_v1} (95% CI ${h2h.p_at_k_ci95.join("…")}), strict ${h2h.p_strict_v2_minus_v1} (CI ${h2h.p_strict_ci95.join("…")}), lift ${h2h.lift_v2_minus_v1} (CI ${h2h.lift_ci95.join("…")}); v2 better on ${h2h.v2_better}, tie ${h2h.tie}, v1 better ${h2h.v1_better}`);
  console.log(`\nPER VIDEO`);
  for (const { v, s } of per) {
    const cols = ARGS.versions.map((ver) => s[ver] ? `${ver} P ${s[ver].p_at_k.toFixed(2)} h ${s[ver].mean_heat.toFixed(2)}/${s[ver].rand_heat.toFixed(2)}` : `${ver} -`).join(" | ");
    console.log(`${v.id} ${String(Math.round(v.meta.duration / 60)).padStart(3)}m ${v.lang_hint} | ${cols} | ${String(v.meta.title).slice(0, 50)}`);
  }
  console.log(`\n→ ${path.join(ARGS.dir, "results.json")}\n→ ${path.join(ARGS.dir, "picks.md")}`);
})().catch((e) => { console.error(e); process.exit(1); });
