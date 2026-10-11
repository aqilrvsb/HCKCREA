# Motion v2 "Gempak" — Design

Date: 2026-10-12 · Status: approved by user ("okey finish all") · Supersedes nothing (extends Motion v1, commit e571ec3)

## Goal

Make the Motion tab (Buat Iklan + Edit Video) produce videos that beat a hand-made Claude Code + Remotion motion ad (benchmark: `E:\Project\peningbot-promo` Ad1) — automatically, in parallel, in the background — for Malaysian TikTok Shop sellers.

## What the user asked for (verbatim intent)

1. Caption on/off — when OFF hide every caption option.
2. Show which AI model is used.
3. A real prompt box with suggestions modelled on PeningLab's Malaysian "beg kuning" prompts.
4. Much more "gempak": stronger motion, more sound, more beautiful.
5. HD by default.
6. Many jobs at once, running hidden in the background, with cascade fallbacks everywhere.
7. Pictures / B-roll / everything needed for "perfect motion".
8. Auto-"Google": while the person talks, fetch matching images + facts from the web. Provider: **Serper.dev** (user choice; user accepts the copyright risk of web images in ads).
9. Must beat "skill motion video in Claude Code".

## Research basis (2026-10-12, four parallel research agents)

- TikTok/VidMob: hook title + product/price in the first 3 s (+44% conversion with CTA in opening frame), visual change every 2–4 s, captions +58% recall, product cutaways +17% 6-s view, music+voice 2× conversion, ≥120 BPM beds.
- No competitor (Submagic, CapCut, Captions/Mirage, Opus, Vizard, Veed) plans word-synced commerce overlays — our moat.
- Render speed: Chrome paint on CPU is the bottleneck (not decode). Wins: split frame ranges across containers (~N×), drop blurred box/text shadows & big gradients (1.3–2×), `scale` for 720p (1.6–2×), `toneMapped={false}`, `offthreadVideoThreads`.
- Assets safe to bundle: Kenney (CC0) + Freesound CC0 SFX; Google Noto Animated Emoji Lottie (CC BY 4.0 → credit line); procedural overlays.
- Face: MediaPipe Face Detector (Apache-2.0, ~2 ms/frame CPU). Avoid YOLO-face (AGPL), InsightFace models (non-commercial).
- Jump cuts: VAD (Silero inside faster-whisper) + word gaps; remap word times after cuts.
- Search: Google CSE closed to new customers, Bing retired. Serper.dev = Google Images + Google web, ≈ USD 0.30–1 / 1k queries. Brave/Tavily as optional fallbacks.
- Remotion license: Free License covers PeningLab (company headcount ≤ 3; clients don't count). Company License only if the team grows to 4+.

## Architecture (Approach A: Director + component library + visual QA)

The LLM never writes code. It writes a **director plan** (JSON); a fixed, polished Remotion component library renders it. A **visual QA pass** (render key stills → vision model → plan patch) replaces the human "render stills and look" loop that makes Claude Code good.

### Edit Video pipeline (Modal `run_job`, orchestrator)

1. Download → normalise to 1080×1920 30 fps (lanczos; unsharp when upscaling from < 900 px wide).
2. Transcribe (faster-whisper small, VAD, Malay filler-friendly initial prompt) → words.
3. **Jump cuts** (option, default ON): drop silences > 0.35 s (keep 0.12 s), drop non-lexical fillers (erm/emm/aaa/uh/um/eh/hmm) and immediate word repeats; cut with ffmpeg; remap word times.
4. **Face track**: MediaPipe face detector at 5 fps on a 640 px copy → smoothed boxes → `faces[]` (zoom origin, keep-out zone).
5. **Director plan**: POST transcript + options to `/api/motion/plan` (Next, `model_motion` cascade). Next also runs **Serper** image searches for B-roll moments and web searches for fact moments (cached), a vision pick of the best image per moment, and an LLM fact-card writer (source domain required, `null` if unsupported). Returns the full plan with candidate URLs.
6. Assets: download/validate B-roll images (≥ 500 px, decodable), fallback to next candidate; failure ⇒ moment dropped.
7. **Visual QA**: render ≤ 6 stills at the busiest moments → POST to `/api/motion/qa` (vision, `model_motion`) → JSON patch (move zone / shorten / drop overlay / swap B-roll layout) → apply. Any failure ⇒ keep plan.
8. **Parallel render**: frames split into chunks (≈ 600 frames each, ≤ 6) rendered muted on separate containers via `render_chunk.map`; audio rendered once (audio-only codec); ffmpeg concat (stream copy) + mux. Any chunk failure ⇒ one retry ⇒ fallback to single-container render.
9. Upload MP4 + poster to B2, report result.

Buat Iklan uses the same steps where they apply (no jump cut/face/search; QA + parallel render + new library + SFX library + variations).

### Component library additions (Remotion)

- **Style packs** `gempak` (default) / `clean`: density, SFX, shake/flash/particles on/off.
- **B-roll**: `broll` fullscreen (Ken Burns + blurred fill) and `pip` (tilted card with border, slide in); whoosh in/out.
- **Fact card**: glass card with icon, ≤ 12 words, "Sumber: domain".
- **New items**: `bigword` (huge kinetic 1–2 words), `callout` (speech bubble), `arrow` (hand-drawn path + label), `stars` (rating/social proof, only from brief/speech), `cta` ("Tekan beg kuning" end card with animated arrow).
- **Price reveal sequence**: strike old price → slam new → counter → ka-ching + sparkle.
- **Effects**: flash punch-cut, screen shake (seeded noise), particle bursts, light-leak sweep at section breaks (CSS gradient, not WebGL), progress bar, mid-video re-hook banner.
- **Animated emoji**: Google Noto Lottie (`fonts.gstatic.com/s/e/notoemoji/latest/{cp}/lottie.json`, cached into job dir) via `@remotion/lottie`; static emoji fallback. Credit line on the Motion tab.
- **Captions**: keyword colours from the plan (benefit = green, price = yellow, pain = red, brand = accent), optional emoji after a word; exact fitting via `@remotion/layout-utils`; OFF hides all caption UI.
- **Performance rules**: no blurred `box-shadow`/`text-shadow`/`filter` in per-frame elements (hard offset shadows instead); `OffthreadVideo toneMapped={false}`; `offthreadVideoThreads: 4`; `x264Preset: 'superfast'`.

### Sound

- Bundled SFX library `motion/public/sfx-lib/` (Kenney CC0 + Freesound CC0), manifest with source + license per file, procedural `sfx/` kept as fallback.
- Event → SFX rule table, seeded variant choice, one SFX per visual event, louder in `gempak`.
- Music: procedural beds (existing) with `gempak` → hype/upbeat ≥ 120 BPM; Edit Video music option default OFF (speech videos), ducked.

### UI (Motion tab)

- Mode chips; **Prompt** textarea + suggestion chips (Malaysian TikTok Shop presets from `lib/motion-prompts.ts`).
- Caption toggle (OFF hides style + position).
- Style: Gempak / Clean. Resolution: HD 1080p (default) / 720p laju.
- Edit Video: multi-file picker (≤ 5), options: Jump cut, Google B-roll, Fakta (web), Muzik, SFX.
- Buat Iklan: variations 1–3.
- "🧠 AI: <model_motion main>" line; Noto emoji credit.
- Jobs panel (≤ 12) — every job independent, runs server-side; closing the tab is fine.

### Admin / settings

- `motion_search` app setting: ordered providers `[{provider: "serper"|"brave"|"tavily", key}]` (Serper first). Admin card "Motion Search (Google)" with main + fallbacks, keys masked.
- `motion_search_cache` table (query hash, kind, provider, results, created_at); 30-day reuse.
- Existing: `model_motion`, `rate_motion`, `motion_modal`.

### Cost (per 60 s Edit Video, est.)

Search ≈ 10 queries ≈ USD 0.003–0.01; vision pick + QA ≈ USD 0.01; Modal CPU-seconds ≈ unchanged (parallel split). Price to client unchanged (rate_motion per second).

## Error handling (all fail-soft)

| Step | Failure | Behaviour |
|---|---|---|
| Jump cut | ffmpeg/VAD error | use uncut video |
| Face track | mediapipe error / no face | centre zooms, no keep-out |
| Plan LLM | cascade exhausted | captions-only plan (existing) |
| Search | provider error | next provider in `motion_search`; all fail ⇒ no B-roll / facts |
| Image download | bad/small/undecodable | next candidate; none ⇒ drop moment |
| Fact card | unsupported by snippets | `null` ⇒ no card |
| QA | any error | render plan as-is |
| Chunk render | chunk fails twice | single-container render |
| Whole job | exception | row failed + full refund (existing) |

## Testing

- Unit: jump-cut keep-segment builder + word remap; cue resolution; plan validators (new item types, B-roll, facts); search cascade + cache (mocked fetch).
- Render: stills of every new component (local `remotion still`), contact sheet review.
- End-to-end on prod: Gluvera clip (88 s) Edit Video, a Buat Iklan with 2 variations, 3 parallel jobs; verify billing rows, refunds on forced failure, render time.
- Benchmark: side-by-side contact sheet vs peningbot-promo Ad1.

## Out of scope (Phase 2)

Text-behind-subject (person matte), Stable Audio music library, AI-generated B-roll video, beat-synced cuts.
