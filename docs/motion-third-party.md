# Motion engine — third-party skills, assets and libraries

Everything vendored into the Motion engines (`modal_vgc.py` image for Padat and
Custom Style; `motion-hf/` for Laju v2), with the pinned commit and its licence.
Owner's decision, 2026-10-20: material without a commercial licence may be used
now. The owner will apply for permission, and each such item is kept in
`/opt/pending-license/` so it can be removed in one step.

## Licensed

| Item | Where | Source @ commit | Licence |
|---|---|---|---|
| HyperFrames CLI + skills + registry (210 blocks, 237 components) | image, `/opt/hf-skills`, `/opt/hf-registry` | heygen-com/hyperframes v0.8.181 (ae02e5a) | Apache-2.0 |
| motion-video-kit references (critic loop, motion grammar) | `/opt/mvk` | echris6/motion-video-kit @ e4b1c00 | MIT |
| GSAP skills (core, timeline, plugins, utils, performance) | `/opt/hf-skills/gsap-*` | greensock/gsap-skills @ aed9cfd | MIT |
| herk-edit-kit short-form quality gates + motion philosophy | `/opt/mvk/herk` | nateherkai/herk-edit-kit @ 10511e5 | MIT + pipeline-use permission |
| motionmaxxing references, measured moments, lint/look scripts | `/opt/refs/motionmaxxing` | Tejashmakwana/motionmaxxing @ 8c8ec0f | Apache-2.0 |
| render-safe seams reference | `/opt/refs/community` | heygen-com/hyperframes-community-skills @ ba7a0bb | Apache-2.0 |
| sfx-kit: 320 synthesized SFX + metadata | `/opt/sfx/sfxkit` | wyzowl/sfx-kit @ 92780e7 | CC0 |
| 103 CC0 sounds (the Mixkit "runtime" list is removed) | `/opt/sfx/cc0` | Barty-Bart/motion-graphics @ 3d83d98 | MIT / CC0 |
| GSAP 3.14.2, Preact, lottie-web, simplex-noise, preact-render-to-string | `motion-hf/` | npm | GSAP no-charge licence; MIT |
| Permanent Marker / Patrick Hand fonts | `motion-hf/fonts` | Google Fonts | Apache-2.0 / OFL |
| HyperFrames registry blocks: count-up, star-rating-fill, shutter-slam (jsDelivr GSAP tag removed) | `motion-hf/blocks` | heygen-com/hyperframes @ ae02e5a | Apache-2.0 |
| HyperFrames distributed renderer (`@hyperframes/producer`) | `motion-hf` dependency | npm 0.8.181 | Apache-2.0 |
| Anton, Bebas Neue, Poppins, Archivo Black, Inter, Montserrat (fetched by HyperFrames from Google Fonts at render) | Laju v2 Pro looks | Google Fonts | OFL |

## Pending licence (permission to be requested)

| Item | Where | Source @ commit | Licence as published |
|---|---|---|---|
| Tareabox 9:16 blocks and components (40). Excluded: media of unknown origin, the author's likeness, and Pexels/Mixkit streaming | `/opt/pending-license/tareabox` | Tareabox/tareabox-catalog-free @ caa6e9b | Tareabox Free Catalog License v1.0 |
| disney-animation-rule-skill | `/opt/pending-license/…`, also installed as a skill | vibe-motion/skills @ 4c86c0d | none stated |
| sound-design reference | `/opt/pending-license/misbahsy` | misbahsy/tiktok-ig-shorts @ 04ddc66 | none stated |

## Ideas only (no text or code copied)

AGPL repos whose ideas inform our own rubric and rules: geekjourneyx/hyperframes-motion-director
(anti-slideshow gates), op7418/guizang-product-video-skill (SFX onset placement, first-frame
check), calesthio/OpenMontage (distinct-composition check).

## Techniques taken as ideas (no code copied)

Laju v2 Pro numbers come from public write-ups and repos: TikTok / Reels safe zones (Socialync, Upload-Post),
caption sizing and active-word pops (remotion-dev/template-tiktok — no licence, ideas only; Upload-Post/avatar-mix — MIT),
crash-zoom and SFX alignment rules (Vincentwei1021/video-shotcraft — Apache-2.0), handheld-drift octaves and
transition durations (HyperFrames skills — Apache-2.0).
