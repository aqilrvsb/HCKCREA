# Motion v2 "Gempak" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Motion v2 — director plan + Google B-roll/fact cards (Serper) + gempak component library + SFX library + jump cuts + face-aware zoom + visual QA + parallel chunk rendering + Motion tab v2 (prompt presets, caption toggle, style, HD/720p, multi-job, variations).

**Architecture:** LLM (`model_motion`, GPT-6 Astra main) writes a JSON director plan; Next enriches it with Serper images/facts and a vision pick; Modal prepares media (jump cuts, face boxes, B-roll assets), runs a stills-based vision QA patch, then renders frame-range chunks in parallel containers sharing a Modal Volume and stitches them with ffmpeg.

**Tech Stack:** Next 16, Supabase, Remotion 4.0.527 (+ @remotion/lottie), Modal (Python 3.11, faster-whisper, mediapipe, ffmpeg, Node 20), Serper.dev.

**Spec:** `docs/superpowers/specs/2026-10-12-motion-gempak-v2-design.md`

## Global Constraints

- Remotion packages pinned to `4.0.527` (all `@remotion/*` identical versions).
- No blurred `box-shadow` / `text-shadow` / CSS `filter` in per-frame components (hard offset shadows only).
- Every new pipeline step is fail-soft (see spec "Error handling").
- Never invent prices, ratings, sales numbers, scarcity, medical claims; fact cards need a source domain or are dropped.
- Secrets (Serper key, MOTION_SECRET) live in `app_settings` / Modal secrets only.
- Output 1080×1920 30 fps by default; 720p only when the user picks it.
- Assets bundled must be CC0 / own procedural; Noto emoji credited (CC BY 4.0).

## Review Focus

- Video with no speech (music only) → no words: plan still renders (hook + zooms), no crash in jump cut / captions.
- Jump cut removes >50% of the video → fall back to the uncut video.
- Serper returns hotlink-protected / tiny / non-image URLs → next candidate; none → moment dropped.
- A chunk container fails → retry once → whole-job single render.
- Many jobs submitted at once (5 videos) → each row reserves its own credit; insufficient balance stops the rest with a clear error, no orphan rows.

---

### Task 1: Renderer contract v2 (types, SFX rules, effects primitives)
**Files:** Modify `motion/src/types.ts`, `motion/src/lib.ts`; Create `motion/src/effects.tsx`, `motion/src/sfx.ts`; Modify `motion/package.json` (+ `@remotion/lottie@4.0.527`, `lottie-web`).
**Produces:** `Style = 'gempak'|'clean'`; `Face`, `BRoll`, `FactCard`, `CaptionKey`, `Rehook`, `CtaSpec`; item types `bigword|callout|arrow|stars|cta`; `sfxFor(event, style, seed) → {name, vol, len}[]` resolving library names with procedural fallback; `<Flash/>`, `shakeOffset(frame, impacts, style)`, `<Burst/>`, `<LightSweep/>`, `<ProgressBar/>`.
- [ ] Add packages, `npm install`, `npx tsc -p .` passes.
- [ ] Implement + still-render a test composition frame for each effect.

### Task 2: New elements + B-roll + fact card + captions keywords
**Files:** Modify `motion/src/elements.tsx`, `motion/src/layers.tsx`; Create `motion/src/broll.tsx`, `motion/src/emoji.tsx`.
**Produces:** `RENDER.bigword|callout|arrow|stars|cta`; `<BRollLayer items/>` (full: blurred fill + Ken Burns + punch-in; pip: tilted bordered card); `<FactCardView/>`; `<LottieEmoji char size/>` (Noto lottie from job dir, static fallback); `Captions` accepts `keywords` (colour + emoji per word index).
- [ ] Remove blurred shadows from existing elements.
- [ ] Stills for each new element reviewed on a contact sheet.

### Task 3: MotionEdit v2 + MotionAd v2 compositions
**Files:** Modify `motion/src/MotionEdit.tsx`, `motion/src/MotionAd.tsx`, `motion/src/sample.ts`.
**Consumes:** Tasks 1–2. **Produces:** EditProps v2 fields consumed by Modal: `style, faces, broll, facts, keywords, rehook, cta, lottie (char→url map), progress`.
- [ ] Face-centred zoom origin; impacts → shake/flash; B-roll + facts layered under captions; SFX per event.
- [ ] Sample props render full MP4 locally; contact sheet review.

### Task 4: Render scripts (chunks, audio-only, stills, scale)
**Files:** Modify `motion/scripts/render.mjs`; Create `motion/scripts/stills.mjs`.
**Produces:** `render.mjs <serve> <comp> <props> <out> [--from N --to M --muted --audio-only]` honouring `RENDER_SCALE`; `stills.mjs <serve> <comp> <props> <outDir> <frame,frame,...>`.
- [ ] Local: render 2 chunks + audio, ffmpeg concat+mux, compare duration/frames to single render.

### Task 5: Modal pipeline v2
**Files:** Modify `modal_motion.py`.
**Produces:** jump cut + word remap, face track (mediapipe), plan call v2, B-roll asset prep, QA stills → `/api/motion/qa`, chunked parallel render (`render_chunk.map`, Volume `peninglab-motion-jobs`) with fallback, `scale`, lottie download, sharper normalise; `cpu`/`memory` tuned.
- [ ] Unit-test jump-cut segment + remap helpers (pure functions) with pytest-style asserts run locally (`py -3 -c`).
- [ ] Deploy; run Edit job on the Gluvera clip.

### Task 6: Next director v2 (prompts, search, vision pick, facts, QA, validators)
**Files:** Modify `lib/motion.ts`, `app/api/motion/plan/route.ts`; Create `app/api/motion/qa/route.ts`; Consumes `lib/motion-search.ts`, `lib/motion-prompts.ts`.
**Produces:** `planEdit` v2 returning `{hook, accent, mood, overlays, zooms, broll[{at,to,layout,candidates[]}], facts[{at,to,text,source}], keywords, rehook, cta}`; `qaPatch(stills, plan) → patch`; validators for new types.
- [ ] Tests `tests/motion/plan-validate.test.ts` for validators (new types, cue ranges, fact source required).

### Task 7: Routes + Motion tab v2
**Files:** Modify `app/api/motion/create/route.ts`, `app/api/motion/edit/route.ts`, `app/api/motion/rate/route.ts`, `app/dashboard/tabs/motion.tsx`.
**Produces:** options `prompt, style, resolution, jumpcut, broll, facts, variations`; brain line; prompt presets; caption toggle; multi-file; variations; Noto credit.
- [ ] Typecheck; manual UI check on prod with Playwright.

### Task 8: Deploy + end-to-end retest
- [ ] Push, Vercel READY, Modal deployed.
- [ ] Gluvera clip Edit Video (gempak, HD) — contact sheet + timing + billing row.
- [ ] Buat Iklan with 2 variations + 3 parallel Edit jobs.
- [ ] Compare against peningbot-promo Ad1 contact sheet; fix gaps.
