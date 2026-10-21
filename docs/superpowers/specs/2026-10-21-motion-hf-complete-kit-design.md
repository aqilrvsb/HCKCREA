# Motion on HyperFrames — the complete kit — Design

Date: 2026-10-21 · Status: requested by the user ("make sure our hyperframe — highest quality complete set perfect… so that only
need master director ai planning only to structure… deep research github… superpower skill") · Extends Laju v2 Pro (HyperFrames only,
commit c6d0b7a).

## Goal

The HyperFrames toolkit itself is complete and polished, so that the AI director only plans structure (which tool, where, on
which spoken word) and is never limited by a missing capability. Every new tool is: a pure function of the frame, safe by
construction (layout rules keep it off the face, inside TikTok's safe area, readable), described to the director in one line,
validated by `cleanScene` / `cleanDirection`, and fail-soft.

## Research basis (2026-10-21, five parallel research agents)

| Track | Main findings |
|---|---|
| Speaker & footage | HyperFrames decodes VP9-with-alpha WebM to PNG frames (engine source), so a person matte can be a second muted video. BiRefNet (MIT, code + weights) is the best licence-clean matte; RVM is GPL-3.0, MatAnyone / RMBG-2.0 non-commercial. Speed ramps (`data-automation` rate lane) and WebGL `.cube` grading exist in HyperFrames but are not wired. |
| Captions & kinetic type | 14 creator caption looks reduce to one parametric schema (case, highlight target, background, palette rotation, lines, words). Gaps: captions ignored the face; the block ran under TikTok's button column (x ≈ 930+). Malay line breaks: never end on yang/dan/di/untuk…, keep "RM 50" together. Remocn (MIT, 30 caption components) and the HyperFrames registry (17 caption components) port cleanly. |
| Graphics & assets | Licence traps in production today: **Giphy** content is "personal and non-commercial" only; **Animated Noto Emoji** is CC BY 4.0 (attribution). Clean alternatives: Microsoft Fluent Emoji (MIT, 3D), useAnimations (MIT Lottie), Remocn animated icons (MIT), Tabler / Lucide / Phosphor (MIT/ISC). Malaysia map: Natural Earth admin-1 (public domain). No open-source receipt / coupon / Venn: build them. |
| Sound & voice | DeepFilterNet3 (MIT/Apache-2.0) as a static binary, no torch; denoise BEFORE cutting; 8 ms fades at every splice (hard sample cuts click); two-pass loudnorm (single pass pumps the room noise); duck music −12 dB with 150 ms look-ahead. Music generation: ACE-Step 1.5 (MIT) for an offline library; MusicGen weights are non-commercial; madmom models CC BY-NC-SA; essentia AGPL; aubio GPL. |
| Transitions & camera | Renders run on SwiftShader: shader transitions cost 30–650 ms/frame (possible via the `hf-seek` + `__render_frame_` hook, unverified on our page). Cheap wins: one-direction whip blur, smash cut to black with a word, dutch tilt, spotlight, focus lines. Five WebGPU registry blocks will not render here. Editing rules: one main transition for 60–70 % of cuts. |

## What the kit gains (this round)

### Speaker cut-out (GPU)
- `matte_windows` (Modal, `gpu=["L40S","L4"]`): BiRefNet-lite at 576×1024 (the frame's own 9:16), fp16, a 3-frame median,
  largest connected subject only (a lamp or shelf the model also finds is dropped), → VP9 + alpha WebM per window + the
  measured top of the head. ~50 fps on L40S; spawned at the start of `_edit_finish`, collected before the render.
- Windows come from the plan (`_matte_plan`): `behind` words, `spotlight` moves, scenes with `speaker`; merged, ≤ 30 s.
- Composition: one `<Sequence>` per window, never re-parented — on the speaker shot it takes the camera's exact transform
  (drawn over the word behind / the dimmed room); during a `speaker` scene it becomes a die-cut sticker (white outline,
  bottom corner, its cut-off edge off-screen) and the explainer captions step aside.
- Director: `behind: [{at,to,text,tone}]` (the viral "text behind the person"), move `spotlight`, scene `speaker: left|right`.
- Without a cut-out (matte failed) every one of these effects is skipped — nothing renders wrong.

### New scenes
- `chat` (comments sheet / message thread with typing dots / notification banners) — only words the speaker says.
- `split` (two coloured halves, items tick ✓ / cross ✗ on their words: MITOS | FAKTA).
- `annotate` (Vox: a held sentence, words marked, hand connectors to handwritten notes).
- `map` (Malaysia: states light on their words with pins + label chips; "seluruh Malaysia" sweeps west → east).
- `receipt` (prints item by item, the total counts up, a red stamp).

### Lines, camera, overlays
- Line enter `swap` (a slot rolls through options and lands on the word).
- Moves `lines` (manga focus lines + punch-in), `tilt` (dutch accent, cover-scaled), `smash` (0.4 s black with one word),
  `spotlight`; whips blur along their motion only (SVG `feGaussianBlur stdDeviation="x 0"`).
- `banner` (news strip over the speaker: blinking tag, headline wipe, ticker; top band or lower third, never on the face).

### Captions
- `caption_look` presets (overrides/captionsLooks.tsx): hormozi, beast, karaoke, popline, deep, pill, fill, pod, sticker,
  sweep, neon — one renderer, measured layout, Malay-aware balanced line breaks, emphasis word (keyword → number → longest),
  emoji above on the top line / beside lower down.
- All big captions: block left of x ≈ 930, lowered under a low face (≤ y 1440).
- `textWidth` no longer caches a measurement made before the font loaded.

### Voice & music
- DeepFilterNet3 on the whole source voice (strength from the measured noise spread: 8 / 12 / 18 dB limit), in parallel
  with the video encode; then the cut with 8 ms fades per splice, presence EQ, de-esser, gentle compression; remuxed only
  if the length matches (else the old chain). Same in Custom Style (`modal_vgc.py`).
- Two-pass loudnorm on the final mix (−14 LUFS, linear gain).
- Music bed: ducks to 0.30 under speech, 150 ms before each phrase, holds through pauses < 0.4 s, 450 ms release, and a
  −3 dB dip at 2.5 kHz to leave room for the voice.

## Out of scope / backlog (ranked, see the plan)

Fluent 3D emoji to replace Noto / Giphy stickers (licence — needs the owner's decision), ACE-Step music library, shader
transitions via `hf-seek`, motion blur on slams, speed ramps on B-roll, product tracking (OWLv2 / Grounding DINO +
SAM2.1) for "zoom to the product", depth parallax on photos (Depth-Anything-V2-Small), Tabler / Remocn animated icons,
face-centred split-screen B-roll, SFX loudness normalisation, a cut-out for Custom Style.

## Error handling

Every new step is fail-soft: no `deep-filter` binary / any error → the old voice chain; remux length mismatch → keep the
original; matte failure → no cut-out effects; an unknown place on the map → that place is skipped; an annotate note whose
word is not in the sentence → dropped by `cleanScene`; a `swap` line without options → a normal line.
