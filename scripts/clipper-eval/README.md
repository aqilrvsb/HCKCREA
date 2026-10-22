# CLIPPER director eval

This measures how well the CLIPPER director picks the moments that viewers actually replay. It doesn't try to judge by eye.

**Answer key:** YouTube's "most replayed" heatmap, the approach used by RHAPSODY (arXiv 2505.19429). The director
never sees it: the eval passes `heatmap: []`, so the director gets only the title, the channel and the caption
transcript. That is the same input it gets for an Upload or Google Drive source.

| file | what |
|---|---|
| `videos.json` | the eval set: 15 podcasts of 38–157 min (11 Malay, 4 English). It also lists backups and excluded videos, with the reason each was excluded |
| `fetch.py` | reads each video's meta, heatmap (about 100 buckets) and caption lines through the deployed Modal `peninglab-motion.yt_task("info", …)` (the production reader, through the WARP proxy) and caches one JSON per video |
| `clipper-v1.ts` | the director at commit `06e7f87`: one LLM pass over the whole transcript, then one repair pass. Only the imports and the job-settling code changed |
| `run.ts` | runs v1 (`clipper-v1.ts`) and v2 (`lib/clipper.ts`, chunk → pool → two judges) on each video, scores them against the heatmap, and writes `results.json` and `picks.md` |

## Run

Use a cache folder outside the repo, for example `C:/Users/User/AppData/Local/Temp/clipper-eval`. If you leave out
`--dir`, both scripts use `$CLIPPER_EVAL_DIR`, and then `<os tmp>/clipper-eval`.

```bash
# 1. dataset (free on rerun: each video is cached; uses MODAL_PROFILE=aqilrvsb unless MODAL_PROFILE is set)
py -3 scripts/clipper-eval/fetch.py --dir "$DIR"            # --only ID,ID  --backups  --force

# 2. both directors + metrics (picks are cached per version/video; only missing ones call the LLM)
npx tsx --env-file=.env.local scripts/clipper-eval/run.ts --dir "$DIR" --concurrency 2

# re-score from cached picks only (no LLM), e.g. after changing a metric
npx tsx --env-file=.env.local scripts/clipper-eval/run.ts --dir "$DIR" --score-only

# test a new director change: --force reruns the LLM (or delete $DIR/picks/v2)
npx tsx --env-file=.env.local scripts/clipper-eval/run.ts --dir "$DIR" --versions v2 --force
```

`run.ts` options:

- `--versions v1,v2`
- `--only ID,ID`
- `--count 5` (k, and the clip count asked for)
- `--random-n 200`
- `--no-deadline` (by default each run gets the production 270 s budget, through `withDeadline` and `deadline`, the same as `/api/clipper/plan`)
- `--force`
- `--score-only`

The model settings come from Supabase `app_settings.model_motion`, which `orChat` reads through the
service-role client in `.env.local`. No shims are needed. Each call goes to whatever provider and model the admin has
set, so the cascade (including fallbacks) is part of what gets measured. Every call's model is recorded in
`results.json`.

Director options are `cleanOptions({ duration: "auto", count: 5, language })`. `language` comes from the per-video
`lang` field in `videos.json` (`ms` or `en`). `meta.language` is the caption language, as in production.

## Metrics

All metrics are per video and per version, computed over the top-k picks (k = 5) in the director's own order.
Every video-level number is then averaged over the videos.

- **heat of a pick**: the mean heatmap value (0–1) over the clip's span. Each overlapping bucket is weighted by how much of it the clip covers.
- **hit**: the span overlaps a bucket in the video's top 10 % of heat values (ties included). Buckets whose midpoint falls in the first 3 % of the video are left out, because intros and "skip to the good part" spikes would count otherwise. With about 100 buckets, about 10 buckets form the answer key.
- **P@k**: the hits among the top-k picks, divided by min(k, number of picks). `short_lists` counts the videos where a version returned fewer than k picks.
- **random baseline**: 200 seeded uniform-random spans with the same lengths as that version's top-k picks. It gives the expected P@k and the expected heat. It is length-matched per version because longer clips overlap more buckets and would hit more often by chance.
- **heat lift**: the picks' mean heat ÷ the random mean heat. 1.0 means no better than chance.
- **heat percentile (`pct`)**: where a pick's heat ranks among every same-length window of the video, in 2 s steps. 0.5 means chance and 1.0 means the single best window.
- **v2 − v1**: the paired difference over videos, with a bootstrap 95 % CI (4000 resamples) and a count of wins, ties and losses.
- **cost**: wall time and the number of LLM HTTP calls per run. A wrapper around `fetch` counts the calls and tags each by role: `finder`, `repair` (v1) or `judge` (v2). `reqChars` is the prompt size.

- **P@k/k (strict)**: the hits ÷ k, so a version that returns fewer than k clips is charged a miss for each missing one. This matters because v1 often returns fewer than 5 clips.

## Baseline: first run, 2026-10-22

The run used 15 videos, the model was `model_motion` = dragon/claude-sonnet-5-5, and the production 270 s deadline was on.

| | P@5 | P@5 strict | random P@5 | heat | random heat | lift | pct | mean len | sec | LLM calls |
|---|---|---|---|---|---|---|---|---|---|---|
| v1 | 0.21 | 0.16 | 0.23 | 0.25 | 0.23 | 1.09 | 0.54 | 76 s | 50 | 2.4 |
| v2 | 0.32 | 0.32 | 0.23 | 0.23 | 0.23 | 1.02 | 0.56 | 69 s | 58 | 7.0 |

v2 − v1, strict P@5: +0.16 (95 % CI +0.03…+0.29). Non-strict P@5: +0.11 (CI −0.05…+0.26). Heat lift: −0.07 (CI −0.31…+0.16).

On mean heat, both versions are at chance level (pct ≈ 0.55). A new director change should beat these numbers on the same cached
videos. Run `--versions v2 --force` after moving the old `picks/v2` folder aside.

### Caveats

- **The heatmap is a proxy.** "Most replayed" on a long video is what people re-watch or seek to there. A moment can make a great short and still not be replayed in the long video, and the reverse also happens. RHAPSODY shows the heatmap carries real signal, but it is not ground truth for TikTok performance.
- **Buckets are coarse.** Each bucket is the video's duration ÷ 100: 23 s on a 38-min video, 94 s on a 157-min one. A hit means "in the right neighbourhood", not "the exact cut". The length-matched baseline already accounts for this.
- **A hit can be a near miss.** Any overlap counts, so a clip that grazes a top bucket by a few seconds is a hit even when its own heat is low. Read P@k together with heat and pct.
- **The sample is small.** With 15 videos the per-video P@5 takes the values 0, 0.2, 0.4 and so on, so read the confidence intervals before trusting a difference.
- **No audio signals.** Captions come from YouTube ASR and carry no speaker or audio tags. Malay speech is often labelled `id`. Production may add diarization and audio tags (`spk`, `tags`) that v2's prompt uses, and they are absent here.
- **The model varies.** Temperature is 0.4 and the provider cascade can fall back to a different model. Rerunning with `--force` gives a different sample.
