# Motion on HyperFrames — complete kit — Plan

**Spec:** `docs/superpowers/specs/2026-10-21-motion-hf-complete-kit-design.md`

**Architecture:** the AI director (lib/motion-director.ts, PRO_DIRECTION) plans JSON; `cleanDirection` / `cleanScene`
validate it; motion-hf/overrides render it on HyperFrames; modal_motion.py prepares media (voice, matte) and renders.

## Global constraints
- Pure functions of the frame (chunks render in any order). Fail-soft everywhere.
- Only words / numbers / places / prices the speaker says appear on screen; never invented reviews or names.
- Licence-clean only (MIT / Apache / BSD / OFL / CC0 / public domain). The repo is public.
- Deploy modal_motion.py and modal_vgc.py to both Modal profiles. Test on admin drafts only.

## Done (2026-10-21)

- [x] Research: 5 parallel tracks (speaker/footage, captions, graphics/assets, sound/voice, transitions/camera).
- [x] Scenes: chat (comments / thread / notif), split, annotate, map (Malaysia, Natural Earth), receipt.
- [x] Lines: `swap` enter. Moves: `lines`, `tilt`, `smash`, `spotlight`; directional whip blur. `banner` news strip.
- [x] Caption looks (11 presets), Malay line breaking, TikTok-safe width, face-aware height; font-load-safe `textWidth`.
- [x] Speaker cut-out: `matte_windows` (BiRefNet-lite, L40S/L4), `behind` text, spotlight, speaker sticker over scenes.
- [x] Voice: DeepFilterNet3 + spliced fades + presence chain (Default and Custom Style); two-pass loudnorm; better ducking.
- [x] Director schema + validation for all of the above; Custom Style EXPLAINER_RULES list the same devices.
- [x] Local still / render tests for every piece; GPU matte timed (~50 fps on L40S at 576×1024).

## Next (ranked by impact)

### 1. Emoji / sticker licence clean-up (owner decision first)
Giphy stickers are licensed for non-commercial use; Animated Noto Emoji need attribution (CC BY 4.0). Replace with
Microsoft Fluent Emoji 3D (MIT; spring pop + idle bob) and useAnimations / Remocn icons (MIT).
- [ ] Bundle Fluent 3D PNGs (default skin tone, ~55 MB) into the HF image with a keyword index.
- [ ] `LottieEmoji` → Fluent renderer behind a setting; Giphy sticker search off.

### 2. Music library (ACE-Step 1.5, MIT)
- [ ] Generate 200–500 instrumental beds offline on a Modal GPU (moods × BPM × lengths), store beat/downbeat grids.
- [ ] Pick a bed per video; align the drop to the hook reveal; end on the final downbeat.

### 3. Product focus
- [ ] OWLv2 / Grounding DINO (Apache-2.0) with the seller's product photo as the query at 2–3 fps → product box track.
- [ ] Moves "product punch" (zoom to the product) and callouts that point at the product in hand.

### 4. Transitions and texture
- [ ] Probe the `hf-seek` + `__render_frame_` WebGL hook with two B-roll videos; if it holds, port 6 gl-transitions (MIT).
- [ ] Multi-sample motion blur on slams (6 samples, plus-lighter) only on moving frames.
- [ ] Speed ramps on muted B-roll clips (`data-automation` rate lane).
- [ ] Face-centred split-screen B-roll (speaker bottom half, B-roll top half).

### 5. Sound polish
- [ ] Normalise every SFX one-shot to −18 LUFS momentary max at build time; per-category offsets under the voice.
  Measured 2026-10-21: the 48 measurable files span −22.5 … −12.1 LUFS (most −17 … −13); 26 are shorter than the
  400 ms momentary window and need a peak / RMS measure. Low priority: the per-event `vol` values were tuned by ear.
- [ ] Riser ending exactly on reveals; whoosh peak on the cut frame.

### 6. Custom Style parity
- [ ] Offer the speaker cut-out (matte_windows) to Custom Style / Padat workspaces as a ready file.
