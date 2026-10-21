"""
PeningLab VGC engine — Claude Code in the cloud ("Custom Style" in the Motion tab).

The VGC Prompt Vault (Coach Am) writes prompts for Claude Code: the student
pastes one, attaches their material, and Claude Code writes a code-built video
and renders the MP4. Here the same happens without the copy-paste: the filled
VGC prompt + the client's material go to `run_vgc`, which runs Claude Code
headless (model: Claude Sonnet through DragonAPI's Anthropic-format endpoint)
in a workspace with HyperFrames, ffmpeg and the VGC Master Knowledge skill, then
uploads the rendered video to B2. Motion Default · Padat (mode "edit" / "ad")
runs on the same engine with PeningLab's own brief instead of the VGC kit.

Quality loop ("Gauntlet", after motion-video-kit, MIT): the builder never grades
its own work. After it renders, a fresh Claude session that sees only the
pixels, the brief and measured numbers writes a critic report; the builder
fixes and re-renders, and a new critic verifies. A fix that breaks the video
is discarded (the previous cut is kept). The delivered cut's audio is then
loudness-mastered for phones.

Every History card gets its own workspace on the `peninglab-vgc-work` Volume
(project files + the Claude Code session), so a later step of the same flow
(Idea Clarity step 2, V2 after review, …) resumes the same session. A run
works on the container's local disk (/root/ws): the Volume can't make hard
links (HyperFrames' `init` needs them) and is slow for render output. The
workspace is restored from the Volume at the start and saved back after every
Claude Code session.

The VGC Master Knowledge skill is NOT in this repo (the repo is public and the
knowledge is Coach Am's paid material): it lives on the private
`peninglab-vgc-kit` Volume (`modal volume put peninglab-vgc-kit <dir> /vgc-master-knowledge`).

Deploy:   py -3 -m modal deploy modal_vgc.py   (and with MODAL_PROFILE for the other accounts)
Secrets:  vgc-secrets (ANTHROPIC_AUTH_TOKEN = the DragonAPI key), motion-secrets (MOTION_SECRET),
          fairytale-secrets (B2_ENDPOINT / B2_REGION), b2-content-secrets (B2_CONTENT_*)
"""

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import modal

app = modal.App("peninglab-vgc")

TEMPLATE = "/opt/vgc-template"
HF_VERSION = "0.8.181"
HF_SKILLS = "/opt/hf-skills"
KIT = modal.Volume.from_name("peninglab-vgc-kit", create_if_missing=True)
WORK = modal.Volume.from_name("peninglab-vgc-work", create_if_missing=True)
# the Motion app's jobs Volume: pl-render hands a project to its parallel renderer (render_project + hf_chunk) there
MJOBS = modal.Volume.from_name("peninglab-motion-jobs", create_if_missing=True)
MJOBS_ROOT = "/mjobs"
KIT_ROOT, WORK_ROOT = "/kit", "/work"
PROGRESS = modal.Dict.from_name("peninglab-vgc-progress", create_if_missing=True)

MODEL = "claude-sonnet-5-5"
DRAGON_BASE = "https://newapi.dragon3api.com"
MAX_TURNS = 150
RUN_TIMEOUT = 55 * 60  # one step: build + render + critic rounds (VGC_STALE_MS in lib/motion.ts is 75 min)
MVK_DIR = "/opt/mvk"  # motion-video-kit references (MIT), pinned
MVK_COMMIT = "e4b1c0004080fe6a0deb883631bad5eba1e5f339"
# Vendored from GitHub (licences checked 2026-10-20), every one pinned to a commit:
SFXKIT_COMMIT = "92780e7ab0cdfb557497a988089c47f46e8c7412"   # wyzowl/sfx-kit — CC0, 320 synthesized SFX + sounds.json
BARTY_COMMIT = "3d83d987d658601d8a1269eb691622bdcd427335"    # Barty-Bart/motion-graphics — MIT; only its 103 CC0 "bundled" sounds
GSAPSK_COMMIT = "aed9cfd3277740755f6bfc1155c7aa645403b760"   # greensock/gsap-skills — MIT
HERK_COMMIT = "10511e5af86fc47756ea89803b397422e2d89284"     # nateherkai/herk-edit-kit — MIT (+ pipeline-use permission)
SFX_DIR = "/opt/sfx"
MMAX_COMMIT = "8c8ec0f2a6f6c9a0da15cd24f7b1298ab298368c"     # Tejashmakwana/motionmaxxing — Apache-2.0 (references, measured moments, lint/look scripts)
COMMUNITY_COMMIT = "ba7a0bb6d3567d124c51f6074625043bfe0b32eb"  # heygen-com/hyperframes-community-skills — Apache-2.0 (render-safe seams)
# Pending licence (the owner's call, 2026-10-20: use now, apply for permission later). Kept apart in
# /opt/pending-license with LICENSE-PENDING.md so each can be removed in one step:
TAREABOX_COMMIT = "caa6e9bf9c55f9d8010ede7bd59ba3078eac5701"   # Tareabox/tareabox-catalog-free — "Tareabox Free Catalog License v1.0"
VIBE_COMMIT = "4c86c0d016a3ba22ee673428a494f3c44f84111f"       # vibe-motion/skills — no licence (disney-animation-rule-skill only)
MISBAHSY_COMMIT = "04ddc6620eaee3bdd45307f02b9275edaba45ff2"   # misbahsy/tiktok-ig-shorts — no licence (sound-design reference only)
PENDING = "/opt/pending-license"
CRITIC_ROUNDS = 2        # critic -> fix -> verifying critic -> fix
CRITIC_BUDGET = 8 * 60   # one critic session
FIX_MIN = 9 * 60         # don't start a fix round with less time than this left
GAUNTLET_DIR = ".gauntlet"
STALL_SEC = 15 * 60      # no stream event for this long = the session hung (a long single Write still emits within it)
CHECK_FIXES = 2          # rounds the builder gets to clear `hyperframes check` errors
HF_REGISTRY = ("https://raw.githubusercontent.com/heygen-com/hyperframes/"
               "ae02e5aceff4742e5d72c20f0859eb3e6b449035/registry")  # = tag v0.8.181 (`add` would track main)
LOCAL_WS = Path("/root/ws")  # the run's working copy (fixed path: one run per container at a time)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "ffmpeg", "curl", "ca-certificates", "gnupg", "git", "procps", "unzip",
        "fonts-noto-core", "fonts-noto-color-emoji",
        # Chrome Headless Shell runtime deps (Remotion docs, Debian)
        "libnss3", "libdbus-1-3", "libatk1.0-0", "libgbm-dev", "libasound2", "libxrandr2",
        "libxkbcommon-dev", "libxfixes3", "libxcomposite1", "libxdamage1", "libatk-bridge2.0-0",
        "libpango-1.0-0", "libcairo2", "libcups2",
    )
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g @anthropic-ai/claude-code --no-audit --no-fund",
        # HyperFrames (Apache-2.0): the motion engine of Custom Style and Default · Padat.
        # Its puppeteer Chrome downloads here, into the image — never during a job.
        f"npm install -g hyperframes@{HF_VERSION} --no-audit --no-fund",
        # its pinned Chrome Headless Shell, cached in the image (~/.cache/hyperframes) — no download per run
        "hyperframes browser ensure",
        f"git clone --depth 1 --branch v{HF_VERSION} https://github.com/heygen-com/hyperframes /tmp/hf"
        " || git clone --depth 1 https://github.com/heygen-com/hyperframes /tmp/hf",
        f"mkdir -p {HF_SKILLS} && cp -r /tmp/hf/skills/* {HF_SKILLS}/ && rm -rf /tmp/hf && ls {HF_SKILLS}",
        "hyperframes doctor || true",
        # voice clean-up for the client's footage: DeepFilterNet3 as one static binary (MIT / Apache-2.0, model built in)
        "curl -fsSL -o /usr/local/bin/deep-filter https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/"
        "deep-filter-0.5.6-x86_64-unknown-linux-musl && chmod +x /usr/local/bin/deep-filter && /usr/local/bin/deep-filter --version",
        # motion-video-kit (MIT): motion grammar + quality bar for the builder and the critic
        f"git clone https://github.com/echris6/motion-video-kit /tmp/mvk && git -C /tmp/mvk checkout {MVK_COMMIT}"
        f" && mkdir -p {MVK_DIR} && cp -r /tmp/mvk/business-motion-film/references /tmp/mvk/business-motion-film/scripts"
        f" /tmp/mvk/LICENSE {MVK_DIR}/ && rm -rf /tmp/mvk && ls {MVK_DIR}/references",
        # the pinned HyperFrames registry, offline (210 blocks + 237 components)
        f"git clone --depth 1 --branch v{HF_VERSION} https://github.com/heygen-com/hyperframes /tmp/hfr"
        f" && cp -r /tmp/hfr/registry /opt/hf-registry && rm -rf /tmp/hfr && ls /opt/hf-registry | head",
        # SFX libraries (CC0)
        f"mkdir -p {SFX_DIR} && git init -q /tmp/sk && git -C /tmp/sk fetch -q --depth 1 https://github.com/wyzowl/sfx-kit {SFXKIT_COMMIT}"
        f" && git -C /tmp/sk checkout -q FETCH_HEAD && mkdir -p {SFX_DIR}/sfxkit"
        f" && cp -r /tmp/sk/sounds /tmp/sk/sounds.json /tmp/sk/GUIDE.md /tmp/sk/catalogue.md /tmp/sk/LICENSE /tmp/sk/README.md {SFX_DIR}/sfxkit/"
        f" && rm -rf /tmp/sk && ls {SFX_DIR}/sfxkit/sounds | wc -l",
        f"git init -q /tmp/bb && git -C /tmp/bb fetch -q --depth 1 https://github.com/Barty-Bart/motion-graphics {BARTY_COMMIT}"
        f" && git -C /tmp/bb checkout -q FETCH_HEAD && mkdir -p {SFX_DIR}/cc0"
        f" && cp -r /tmp/bb/skills/sound-effects/sfx/. {SFX_DIR}/cc0/ && cp /tmp/bb/skills/sound-effects/LICENSES.md /tmp/bb/LICENSE {SFX_DIR}/cc0/"
        # keep only the CC0 bundled files in the manifest: its "runtime" list points at Mixkit, which forbids redistribution in tools
        f" && python3 -c \"import json;p='{SFX_DIR}/cc0/manifest.json';m=json.load(open(p));m.pop('runtime',None);json.dump(m,open(p,'w'),indent=1)\""
        f" && rm -rf /tmp/bb && find {SFX_DIR}/cc0 -type f | wc -l",
        # GSAP skills (core / timeline / plugins / utils / performance) next to the HyperFrames skills
        f"git init -q /tmp/gs && git -C /tmp/gs fetch -q --depth 1 https://github.com/greensock/gsap-skills {GSAPSK_COMMIT}"
        f" && git -C /tmp/gs checkout -q FETCH_HEAD"
        f" && for k in gsap-core gsap-timeline gsap-plugins gsap-utils gsap-performance; do cp -r /tmp/gs/skills/$k {HF_SKILLS}/$k; done"
        f" && cp /tmp/gs/LICENSE {HF_SKILLS}/gsap-core/LICENSE-gsap-skills && rm -rf /tmp/gs && ls {HF_SKILLS}",
        # herk-edit-kit: the 9:16 short-ad quality gates + motion philosophy (the repo is 400+ MB: fetch just these)
        f"mkdir -p {MVK_DIR}/herk && cd {MVK_DIR}/herk"
        f" && for f in .claude/skills/short-form-edit/references/quality-gates.md .claude/skills/short-form-edit/references/curiosity-and-entertainment.md"
        f" .claude/skills/short-form-edit/references/plan-schema.md MOTION_PHILOSOPHY.md LICENSE licenses/PIPELINE-USE-PERMISSION.txt; do"
        f" curl -fsSL https://raw.githubusercontent.com/nateherkai/herk-edit-kit/{HERK_COMMIT}/$f -o $(basename $f); done && ls",
        # motionmaxxing (Apache-2.0): its references + measured moments + checks, as reading material (its
        # SKILL.md claims to override HyperFrames' style rules, so it is NOT installed as an auto skill)
        f"git init -q /tmp/mm && git -C /tmp/mm fetch -q --depth 1 https://github.com/Tejashmakwana/motionmaxxing {MMAX_COMMIT}"
        f" && git -C /tmp/mm checkout -q FETCH_HEAD && mkdir -p /opt/refs/motionmaxxing"
        f" && cp -r /tmp/mm/references /tmp/mm/library /tmp/mm/LICENSE /tmp/mm/NOTICE /tmp/mm/SKILL.md /opt/refs/motionmaxxing/"
        f" && mkdir -p /opt/refs/motionmaxxing/scripts && cp /tmp/mm/scripts/lint.mjs /tmp/mm/scripts/look.py /opt/refs/motionmaxxing/scripts/"
        f" && rm -rf /tmp/mm && ls /opt/refs/motionmaxxing/references",
        f"mkdir -p /opt/refs/community && curl -fsSL https://raw.githubusercontent.com/heygen-com/hyperframes-community-skills/{COMMUNITY_COMMIT}"
        f"/skills/vox-explainer/references/render-safe-seams.md -o /opt/refs/community/render-safe-seams.md"
        f" && curl -fsSL https://raw.githubusercontent.com/heygen-com/hyperframes-community-skills/{COMMUNITY_COMMIT}/LICENSE"
        f" -o /opt/refs/community/LICENSE || echo 'community refs not fetched'",
        # ── pending licence ──
        # Tareabox: only the 9:16 (-v) blocks/components, html + registry-item.json — no tb-media (reaction clips of
        # unknown source, the author's likeness) and nothing that streams Pexels / Mixkit / ytimg / pravatar media
        f"git init -q /tmp/tb && git -C /tmp/tb fetch -q --depth 1 https://github.com/Tareabox/tareabox-catalog-free {TAREABOX_COMMIT}"
        f" && git -C /tmp/tb checkout -q FETCH_HEAD && mkdir -p {PENDING}/tareabox && cp /tmp/tb/LICENSE {PENDING}/tareabox/"
        f" && for d in /tmp/tb/registry/blocks/*-v /tmp/tb/registry/components/*-v; do"
        f"   n=$(basename $d); grep -qiE 'pexels|mixkit|ytimg|pravatar|tb-subject|presenter-cutout|tb-luisa' $d/$n.html && continue;"
        f"   mkdir -p {PENDING}/tareabox/$n && cp $d/$n.html $d/registry-item.json {PENDING}/tareabox/$n/ 2>/dev/null || true; done"
        f" && rm -rf /tmp/tb && ls {PENDING}/tareabox | wc -l",
        f"mkdir -p {PENDING}/disney-animation-rule-skill/references && cd {PENDING}/disney-animation-rule-skill"
        f" && for f in SKILL.md references/clawd-jump-case-study.md references/implementation-patterns.md references/twelve-principles.md; do"
        f" curl -fsSL https://raw.githubusercontent.com/vibe-motion/skills/{VIBE_COMMIT}/disney-animation-rule-skill/$f -o $f; done"
        f" && cp -r {PENDING}/disney-animation-rule-skill {HF_SKILLS}/disney-animation-rule-skill && ls -R",
        f"mkdir -p {PENDING}/misbahsy && (curl -fsSL https://raw.githubusercontent.com/misbahsy/tiktok-ig-shorts/{MISBAHSY_COMMIT}"
        f"/skills/social-talking-head-video/references/sound-design.md -o {PENDING}/misbahsy/sound-design.md"
        f" || curl -fsSL https://raw.githubusercontent.com/misbahsy/tiktok-ig-shorts/{MISBAHSY_COMMIT}/references/sound-design.md"
        f" -o {PENDING}/misbahsy/sound-design.md || echo 'misbahsy sound-design not found')",
        f"printf '%s\\n' '# Pending licences (Motion engine)' ''"
        f" 'Used in the PeningLab Motion engine before permission was granted (owner decision 2026-10-20). Remove a folder to drop it.' ''"
        f" '| Folder | Source (pinned) | Licence |' '|---|---|---|'"
        f" '| tareabox/ | github.com/Tareabox/tareabox-catalog-free @ {TAREABOX_COMMIT} | Tareabox Free Catalog License v1.0 (no catalog redistribution) |'"
        f" '| disney-animation-rule-skill/ | github.com/vibe-motion/skills @ {VIBE_COMMIT} | none stated |'"
        f" '| misbahsy/ | github.com/misbahsy/tiktok-ig-shorts @ {MISBAHSY_COMMIT} | none stated |'"
        f" > {PENDING}/LICENSE-PENDING.md && cat {PENDING}/LICENSE-PENDING.md",
    )
    .env({"HYPERFRAMES_NO_TELEMETRY": "1", "DO_NOT_TRACK": "1", "HYPERFRAMES_SKIP_SKILLS": "1"})
    # procedural soundtrack / SFX by code (the VGC prompts ask for it)
    .pip_install("requests==2.31.0", "boto3==1.34.0", "fastapi[standard]==0.115.0", "numpy<2", "scipy==1.13.1", "pillow==10.4.0")
    .add_local_dir("vgc-template", TEMPLATE, copy=True, ignore=["node_modules", "out"])
    .run_commands(
        f"cd {TEMPLATE} && npm install --no-audit --no-fund",
        f"cd {TEMPLATE} && npx remotion browser ensure",
    )
)
web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.0")

SECRETS = [
    modal.Secret.from_name("vgc-secrets"),
    modal.Secret.from_name("motion-secrets"),
    modal.Secret.from_name("fairytale-secrets"),
    modal.Secret.from_name("b2-content-secrets"),
]

# The client can't answer mid-run, the machine is ours: house rules for this
# workspace on top of the VGC skill (written once per History card).
HEAD_VGC = """# PeningLab — VGC cloud workspace (Motion · Custom Style)

You are running headless in PeningLab's cloud for a client of the VGC (edit VIDEO GUNA CODE) method.
Use the vgc-master-knowledge skill for every content, direction, pacing and audio decision.
PeningLab builds every Custom Style video with HyperFrames (a code-based engine, which the VGC prompts allow):
where a prompt says "Remotion + ffmpeg", build with HyperFrames + ffmpeg instead.
"""

HEAD_DEFAULT = """# PeningLab — Motion Default · Padat workspace

You are running headless in PeningLab's cloud as a senior motion designer + video editor, producing a TikTok Shop
video ad for a Malaysian seller. Follow the brief exactly; the client's facts are the only facts.
"""

COMMON_RULES = """
## The client cannot reply during this run
- Do NOT stop to ask questions or for approval. If something non-essential is missing, choose a sensible option,
  state the assumption in your final summary, and continue to the requested output.
- Only stop without a video if an essential input is truly missing (e.g. footage to edit that isn't there);
  then explain exactly what the client must provide.
- "Wait for approval before final export" means: deliver the preview MP4 now; the client approves in PeningLab.

## Material
- The client's files are in ./bahan/ (images, logo, footage, voice-over, captions). Never modify or delete them.
"""

ENGINE_RULES = """
## Video engine: HyperFrames (installed — do not reinstall)
- The `hyperframes` CLI is installed globally (run `hyperframes …`) with its own headless Chrome; its skills are in
  ./.claude/skills — start with the `hyperframes` router skill and read the SKILL.md of every workflow you use
  (product videos: its product-launch / launch-film workflow; captions on footage: embedded-captions; audio:
  hyperframes-audio). Put the project in ./video/ — scaffold it with
  `hyperframes init video --non-interactive --resolution portrait --example blank`
  (add `--video ./bahan/footage.mp4` when the brief has footage). Then set `"registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/ae02e5aceff4742e5d72c20f0859eb3e6b449035/registry"`
  in video/hyperframes.json so `hyperframes add` installs the pinned blocks.
- Zero layout errors: run `hyperframes check --json --samples 24 --at-transitions --max-transition-samples 200` and fix EVERY error (clipped_text,
  text_box_overflow, content_overlap, contrast, sweep_static, lint/runtime errors) before the final render. The run is
  checked again automatically after you finish; errors send the video back to you.
- Compositions are HTML + GSAP. EVERY animated composition must register its timeline exactly as the skills show
  (a paused GSAP timeline registered on window.__timelines). An unregistered timeline does not play in the render
  and the video comes out blank.
- ALL motion goes through that GSAP timeline: no CSS @keyframes / `animation:` / `transition:`, no infinite or
  repeat:-1 loops (use finite repeats that end inside the clip), no setTimeout / setInterval / requestAnimationFrame.
- Use the block catalog (`hyperframes catalog`, `hyperframes add …`) for captions, transitions and effects. The same
  pinned registry is on disk at /opt/hf-registry (blocks/, components/, examples/) to read or copy from directly.
- GSAP skills are installed too (gsap-core, gsap-timeline, gsap-plugins: SplitText, MorphSVG, DrawSVG, CustomEase,
  CustomWiggle, CustomBounce, MotionPath…). Never ScrollTrigger / Draggable / Inertia / Observer; any randomness
  through a seeded gsap.utils.random. The disney-animation-rule-skill covers squash, anticipation, follow-through.
- Professional motion references (read what the beat needs, not everything):
  /opt/refs/motionmaxxing/references/motion.md (easing curves measured from 53 pro films), transitions.md, type.md,
  layout.md, sound-sync.md, and slop.md (patterns that make video look AI-made — avoid them). Ignore its ban on
  counters / stat callouts: a TikTok Shop ad may show the price. /opt/refs/community/render-safe-seams.md for cuts.
- Ready 9:16 blocks to adapt (copy into the project, load GSAP locally, never from a CDN):
  /opt/pending-license/tareabox/* — chat / comment cards, pricing card (counts up "RM…"), checklists, metric flips,
  text effects (outline-to-fill, gravity drop, freeze pop…). Chat / comment / testimonial cards may only show words
  the client actually gave — never invent customer messages, reviews or ratings.
- Before rendering: `hyperframes lint` (fix every error AND every timeline warning) and `hyperframes check`.
- Render with `pl-render video out/preview.mp4` — PeningLab's parallel renderer: the same HyperFrames render, split
  across many machines (~1–2 min instead of 5–8 on this one); if it reports a failure it renders here with
  `hyperframes render` by itself. Output ./out/preview.mp4 (1080x1920, 30 fps). Use it for every render, including the
  fixes after a critic's report.
- Its Chrome is pre-installed (never run `browser ensure`). Do not install whisper / Kokoro / MusicGen: the voice is
  pl-tts, the music is pl-music, and the footage's words are already in ./bahan/captions.json when there is footage.
- HyperFrames only — never switch to another engine (no Remotion). If a render fails, find the cause (`hyperframes
  lint` / `check` errors, a timeline not registered, a missing asset, a heavy effect), fix it and render again.
"""

CRAFT_RULES = """
## Motion craft — the premium bar (execution quality; where the brief or the vgc-master-knowledge skill says otherwise, they win)
- Plan before building: a beat table in ./video/STORYBOARD.md (time -> what the viewer sees -> its selling job -> how it
  exits). For ~30 s: 10-14 distinct compositions, beats of 1.4-3.5 s; vary scale (product macro -> wide -> type impact -> detail).
  Read /opt/mvk/references/motion-grammar.md (mechanism catalog), quality-bar.md and /opt/mvk/herk/quality-gates.md
  (9:16 short-ad gates: the 3-second reason to stay, word timing, safe framing) first.
- Frame 0 is already a finished, striking composition (never a half-entered word); the first 2 s hook.
- The lead subject (product / speaker / key word) fills 60-85% of the usable frame in feature beats — no small card in an empty field.
- Change speed: land -> readable hold -> fast exit. Nothing static for more than ~0.6 s (a hold gets a slow 3-5% push),
  except while the CTA is read.
- One persistent actor (the product, a shape, a colour rail) carries across scenes; transitions keep a carried object or a
  matched direction — never a slideshow of unrelated slide-ins. The outgoing title leaves before the incoming one enters.
- Hierarchy: one primary move + supporting staggers + fine detail; 1-2 reading targets at a time.
- Every animated action produces a visible result (cause -> effect).
- Deterministic: every animated state is a pure function of timeline time — no free-running requestAnimationFrame,
  Date.now(), CSS transitions outside the timeline, or unseeded randomness.
- An independent critic reviews your render after you finish. When its report comes back, fix what it lists.
"""

AUDIO_RULES = """
## Audio — every video
- Voice-over clips play one after another and never overlap. Join generated VO clips with
  `pl-vo-track --out video/vo-track.wav vo-01.mp3 vo-02.mp3 …` (prints each clip's start/end in seconds),
  play that one track from 0, and time every scene from the printed starts.
- Music bed (code-generated, no licence issue): `pl-music --sec <video length> --mood chill|upbeat|hype
  --speech <the VO track or the footage> --out video/music.wav` — it already ducks under the speech; play it
  from 0 under everything at volume ~0.3.
- SFX library (CC0, licence-clean): /opt/sfx/sfxkit — 320 sounds in 28 categories; /opt/sfx/sfxkit/sounds.json gives
  each one use_for / avoid_for / sync.at (seconds into the file where the hit lands: start the clip at cue - sync.at)
  and under_voiceover_db (its level under speech). Also /opt/sfx/cc0 (103 CC0 sounds, manifest.json, default_kit) and
  the code-generated basics `node /opt/vgc-template/scripts/sfx.mjs video/sfx` (pop, tick, whoosh, swoosh, thump,
  stamp, sparkle, paper, marker). Pick by use_for, one clean sound per real event (no random clutter), place each at
  its visual cue (an <audio> element with the right start) — a sound that is not placed does nothing. SFX clearly
  audible, never louder than the voice. Copy the files you use into the project.
- After the render run `pl-audio-check out/preview.mp4`: confirm the voice plays where planned (no stacked voices,
  no long silent gaps), the music is there if requested, and the SFX hits exist; fix and re-render if not.
  It measures levels only — say "diukur", not "didengar".
"""

LOOK_RULES = """
## Look at the video before you finish (mandatory)
- After the render run `pl-frames out/preview.mp4`: it writes 12 evenly spaced frames + out/frames/sheet.png.
  Open the sheet (and any frame you doubt) with your Read tool and confirm the text, product and graphics are
  really visible and correct. A render whose frames show only the background means the animation never played
  in the renderer — fix the cause (e.g. a timeline not registered, elements stuck at opacity 0) and render again.
- No two text blocks may overlap, nothing is cut off at the frame edge, and text stays inside the 9:16 safe area
  (not under TikTok's right-side buttons or the bottom caption bar).
- Never claim visual quality you have not seen in those frames.
- pl-frames ends with GATES (measured) and a RESULT line. It must say PASS before you finish. Fix every FAIL:
  dead motion -> a slow push / drift / staggered reveal, or cut sooner; empty first frame -> frame 0 already a finished
  composition; sparse -> the lead subject fills 60-85% of the frame, bigger type, fuller layouts (no small card on an
  empty field). Render again and re-run pl-frames. Up to 2 fix renders; if a gate still fails, say which in the summary.
"""

OUTPUT_RULES = """
## Output
- ./out/preview.mp4 (create ./out). One full render; re-render only to fix a real problem.
- Finish with a short summary in Bahasa Melayu: the direction you chose, what you checked, and what the client should review.
- Never print, echo or read environment variables or secrets.
"""

EXPLAINER_RULES = """
## Explainer craft — PeningLab's reference level (a toolbox: the brief / the chosen VGC style decides the look;
## use these wherever a talking video explains, teaches, lists, compares, prices or gives numbers)
- The bar is a top Malaysian news-explainer TikTok: hook title in the first frame (a white stroked line + its key
  part on a colour box) with, when there is a source / product picture, a small card under it with a badge
  ("VIRAL", "TERKINI"); then the speaker states each point while BIG side words land beside their head on the
  strongest words (a small lead-in word, the big word, sometimes one huge embossed word centred over the head);
  then a HARD CUT to a full-screen scene that builds that point word by word, numbered "1. / 2. / 3."; back to the
  speaker; a closing question scene ("JADI KORANG RASA…?" → "KOMEN KAT BAWAH" on a yellow box) before the CTA.
  Scenes carry ~50–65 % of a talking video; a new item lands on its spoken word every 1–2 s, 3–7 per scene; never
  hold a scene on one line > ~2.5 s. Captions small and building word by word while scenes carry the message.
- Scene vocabulary (pick per point; vary kinds and backgrounds; each item enters ON its word from captions.json):
  build (lines slam 1.7×→1 with a 10 px blur in 3 frames, or slide in; mixed sizes; one key line on a yellow / black
  box), stat build (a word, the big number counting up, what it means), timeline (coloured dots + date pills),
  collage (ransom-note letter title, sticky notes, starburst price, tape strips on cork / paper), checklist (boxes
  that tick ✓ / cross ✗ as they are said), numbered steps (circles joined by a line that draws), percentage ring,
  line / area / bar chart that draws with the value riding the tip, compare (two numbers as bars or A-vs-B tiles),
  web-article card (headline · source · date · picture, a highlighter sweeping the key words), phone-screen card,
  quote card. Backgrounds: charcoal with a warm glow + faint grid, red, cork, paper, notebook (lined, red margin),
  chalkboard, graph paper, a turning sunburst behind a slammed price.
- Text and marks: typewriter, scramble-decode, letter cascade, outline-to-fill, 3D extrude, gloss sweep, odometer
  digits for prices, strike-through for a myth / old price, highlighter sweep, hand-drawn circle / underline / arrow
  / box drawn on with a stroke (seeded wobble, DrawSVG or strokeDashoffset), sparkles on a punchline, an emoji rain
  for one emotional beat. Scene entrances: hard cut (default), push, zoom-through, whip, wipe, iris, torn paper.
- Ready HyperFrames pieces for these beats in /opt/hf-registry (read the registry-item.json, copy or `hyperframes add`):
  components/vox-annotate (mark + connector + note), marker-highlight, hw-callout-circle (+ its seeded "boil"),
  whiteboard-ink, svg-stroke-trace, chart-story (bars / line / donut / progress), decline-chart,
  conic-progress-ring, before-after-wipe, kinetic-type-swap, headline-slam, char-slam-explode, text-shimmer,
  gloss-sweep, slot-machine-roll, torn-paper-rip, paper-collage-reveal, notification-stack / chat-thread (ONLY words
  the client or speaker really gave — never invented comments); blocks/split-flap-board, bar-chart-race,
  news-ticker are 16:9 — re-lay them out for 9:16 before use.
- More devices the Default edit uses, worth having here too: a comment sheet / message thread with typing dots /
  notification banners dropping in (a question the speaker reads out and answers); a split screen of two coloured
  halves (MITOS | FAKTA, JANGAN | BOLEH, SEBELUM | SELEPAS — components/comparison-split with orientation "vertical"
  for 9:16) whose items tick / cross on their words; an annotated key sentence held big while words get marked
  and a hand connector draws to a handwritten note (vox-annotate); a word slot that rolls through options and lands
  ("MURAH? MAHAL?" → "BERBALOI" — kinetic-type-swap, ticker-takeover); a news strip over the speaker (blinking
  "TERKINI" tag, the headline wiping open, a ticker); a receipt printing item by item with the total counting up and
  a red "JIMAT RM20" stamp; a Malaysia map whose states light up on their words (pins + labels; "seluruh Malaysia"
  sweeps every state on); manga focus lines bursting around the face on a shock word; a smash cut (0.4 s of black
  with ONE huge word); a quick dutch tilt.
- Caption looks to choose from (one per video, built from components/caption-* or by hand): Hormozi (caps, thick
  stroke, one emphasis word per page in green / yellow), Beast (loud yellow caps, green glowing key word), karaoke
  (the spoken word pops in green / yellow — caption-pill-karaoke for the soft version), deep-diver (lowercase dark
  words on a white box, grey → black as spoken), sticker (coloured words, thick white outline, popping in one by one),
  highlight sweep (a red box sliding word to word — caption-highlight), neon (caption-neon-glow), weight shift
  (caption-weight-shift). Keep them left of TikTok's button column (x < ~930 on 1080) and above the bottom ~480 px;
  never let a line end on "yang / dan / di / untuk / dengan" or split "RM 50"; lower them under a low face.
- Only words, numbers and facts that are really said or given appear on screen.
"""

WORKSPACE_RULES = HEAD_VGC + COMMON_RULES + ENGINE_RULES + CRAFT_RULES + EXPLAINER_RULES + AUDIO_RULES + LOOK_RULES + OUTPUT_RULES
DEFAULT_RULES = HEAD_DEFAULT + COMMON_RULES + ENGINE_RULES + CRAFT_RULES + EXPLAINER_RULES + AUDIO_RULES + LOOK_RULES + OUTPUT_RULES


# Bake-off runs (comparing motion technologies on the same brief): the
# variant's own skill(s) only — no VGC, no Remotion-specific house rules.
BAKEOFF_RULES = """# PeningLab — motion bake-off workspace

You are running headless in PeningLab's cloud. The client cannot reply during this run.
The skill(s) installed in ./.claude/skills are the technology being evaluated: follow their SKILL.md workflow,
tooling, quality checks and asset libraries for this video. Do not switch to another framework unless the
skill's own tooling fails to install or run after 2 real attempts — then say so in the final summary.

## The client cannot reply
- Do NOT stop to ask questions or for approval. State assumptions in the final summary and continue to the render.

## Material and tools
- The client's files are in ./bahan/. Never modify or delete them.
- Node 22, npm/npx (internet allowed), git, ffmpeg/ffprobe, python3 with numpy + scipy, Noto fonts, 8 CPU cores.
- Chrome Headless Shell: /opt/vgc-template/node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell
  (puppeteer / the skill's own installer may download Chrome too).
- `pl-tts --out ./bahan/vo-01.mp3 "Ayat."` = the client's AI voice (permission given). `pl-vo-track` joins VO clips back to back
  without overlap and prints their start/end; `pl-music` makes a code-generated music bed that ducks under speech;
  `pl-audio-check out/preview.mp4` prints the loudness timeline of a render; `pl-frames` samples frames to look at.

## Look at the video before you finish (mandatory)
- After the render run `pl-frames out/preview.mp4`: it writes 12 evenly spaced frames + out/frames/sheet.png.
  Open the sheet (and any frame you doubt) with your Read tool and confirm the text, product and graphics are
  really visible and correct. A render whose frames show only the background means the animation never played
  in the renderer — fix the cause (e.g. register the timeline the way the engine requires, elements stuck at
  opacity 0) and render again.
- Never claim visual quality you have not seen in those frames.

## Output
- Render ./out/preview.mp4 at 1080x1920 (9:16). Voice-over clips must never overlap; every SFX must actually play at its cue.
- Finish with a short summary in Bahasa Melayu: what the skill did, what you checked, anything that didn't work.
- Never print, echo or read environment variables or secrets.
"""


# Appended to every prompt: the cloud run has no human in the loop.
RUN_ADDENDUM_VIDEO = """

--- PENINGLAB CLOUD RUN ---
Run ini berjalan automatik dalam cloud PeningLab. Klien TIDAK boleh membalas sehingga run ini tamat.
- Jangan berhenti untuk minta kelulusan direction, skrip atau plan. Nyatakan pilihan anda secara ringkas, kemudian TERUS bina projek dan render preview MP4 dalam run yang sama.
- Output wajib: ./out/preview.mp4
- Jika input penting benar-benar tiada (contoh: Edit Footage tetapi tiada footage dalam ./bahan/), jangan render; mulakan jawapan akhir dengan "PERLU_INPUT:" dan senaraikan apa yang klien perlu beri."""
RUN_ADDENDUM_TEXT = """

--- PENINGLAB CLOUD RUN ---
Run ini berjalan automatik dalam cloud PeningLab. Klien akan membaca jawapan akhir anda dalam PeningLab, kemudian sambung ke langkah seterusnya dalam sesi yang sama.
Siapkan langkah ini sepenuhnya dalam satu jawapan akhir yang lengkap dan jelas (Bahasa Melayu). Jangan render video melainkan langkah ini memintanya."""
CONTINUE_PROMPT = ("Teruskan sekarang tanpa menunggu kelulusan: bina projek video dan render preview ke ./out/preview.mp4, "
                   "kemudian beri ringkasan akhir. Jika input penting benar-benar tiada, mulakan jawapan dengan \"PERLU_INPUT:\".")
MAX_CONTINUES = 2
RESUME_PROMPT = ("Sesi tadi terputus kerana ralat sambungan API. Sambung tugas yang sama dari tempat ia berhenti (jangan mula "
                 "semula): siapkan pembetulan, render semula ke ./out/preview.mp4, jalankan `pl-frames out/preview.mp4` dan "
                 "beri ringkasan akhir.")


# `pl-tts`: the client's AI voice (Mira, Afifah…) for Claude Code, through
# PeningLab's /api/vgc/tts (the MiniMax key never enters the container).
PL_TTS = r"""#!/usr/bin/env python3
# pl-tts - PeningLab AI voice-over in the client's chosen voice.
# Usage: pl-tts --out ./bahan/vo-01.mp3 "Ayat voice-over." [--emotion happy|calm|surprised] [--speed 1.0]
#        pl-tts --out ./bahan/vo-02.mp3 --text-file line.txt
# Prints the file and its length in seconds.
import argparse, json, os, subprocess, sys, urllib.request
ap = argparse.ArgumentParser(description="PeningLab AI voice-over")
ap.add_argument("text", nargs="?")
ap.add_argument("--text-file")
ap.add_argument("--out", required=True)
ap.add_argument("--emotion", default="fluent")
ap.add_argument("--speed", type=float, default=1.0)
a = ap.parse_args()
text = open(a.text_file, encoding="utf-8").read() if a.text_file else (a.text or "")
if not text.strip():
    sys.exit("pl-tts: text required")
if not os.environ.get("PL_TTS_URL"):
    sys.exit("pl-tts: no AI voice was chosen for this project")
body = json.dumps({"history_id": os.environ["PL_TTS_HID"], "token": os.environ["PL_TTS_TOKEN"], "text": text,
                   "emotion": a.emotion, "speed": a.speed}).encode()
req = urllib.request.Request(os.environ["PL_TTS_URL"], data=body, headers={"Content-Type": "application/json"})
try:
    j = json.load(urllib.request.urlopen(req, timeout=180))
except urllib.error.HTTPError as e:
    j = json.loads(e.read() or b"{}")
if not j.get("ok"):
    sys.exit("pl-tts failed: " + str(j.get("error")))
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
urllib.request.urlretrieve(j["url"], a.out)
dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.out],
                     capture_output=True, text=True).stdout.strip()
print(f"{a.out} {float(dur or 0):.2f}s voice={j.get('voice')}")
"""


# `pl-vo-track`: voice-over clips joined back to back (never overlapping), with
# each clip's start/end printed for scene timing.
PL_VO_TRACK = r"""#!/usr/bin/env python3
# pl-vo-track - join voice-over clips one after another (never overlapping) into one track.
# Usage: pl-vo-track --out video/public/vo-track.wav [--gap 0.3] [--lead 0.2] vo-01.mp3 vo-02.mp3 ...
# Prints JSON {"total": sec, "clips": [{"file", "start", "end"}]}: time scenes from the starts and play the
# track once from frame 0: <Audio src={staticFile('vo-track.wav')} />
import argparse, json, os, subprocess, sys
import numpy as np
from scipy.io import wavfile
SR = 48000
ap = argparse.ArgumentParser(description="join VO clips back to back")
ap.add_argument("clips", nargs="+")
ap.add_argument("--out", required=True)
ap.add_argument("--gap", type=float, default=0.3, help="silence between clips (s)")
ap.add_argument("--lead", type=float, default=0.2, help="silence before the first clip (s)")
a = ap.parse_args()
parts, info, t = [np.zeros(int(a.lead * SR), np.float32)], [], a.lead
for i, f in enumerate(a.clips):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", f, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32)
    info.append({"file": f, "start": round(t, 3), "end": round(t + len(x) / SR, 3)})
    parts.append(x)
    t += len(x) / SR
    if i < len(a.clips) - 1:
        parts.append(np.zeros(int(a.gap * SR), np.float32))
        t += a.gap
os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
y = np.concatenate(parts)
wavfile.write(a.out, SR, (np.clip(y, -1, 1) * 32767).astype(np.int16))
print(json.dumps({"out": a.out, "total": round(len(y) / SR, 3), "clips": info}, indent=1))
"""

# `pl-frames`: 12 evenly spaced frames + a contact sheet, so the agent can look
# at what it rendered (Read tool on the PNGs), then measured gates (dead motion,
# an empty first frame, sparse frames) that the builder must pass before it finishes.
PL_FRAMES = r"""#!/usr/bin/env python3
# pl-frames - evenly spaced frames of a video + out/frames/sheet.png to LOOK at, then measured motion gates
# (dead / frozen motion, an empty first frame, sparse mostly-empty frames). Every FAIL must be fixed.
# Usage: pl-frames out/preview.mp4 [--n 12] [--dir out/frames] [--hold 2.5]
#   --hold: seconds at the end where a still CTA is allowed (default 2.5)
import argparse, os, re, subprocess
import numpy as np
ap = argparse.ArgumentParser(description="sample frames of a render + measured motion gates")
ap.add_argument("file")
ap.add_argument("--n", type=int, default=12)
ap.add_argument("--dir", default="out/frames")
ap.add_argument("--hold", type=float, default=2.5)
a = ap.parse_args()
dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.file],
                           capture_output=True, text=True).stdout.strip() or 0)
os.makedirs(a.dir, exist_ok=True)
paths = []
for k in range(a.n):
    t = dur * (k + 0.5) / a.n
    out = os.path.join(a.dir, f"f{k + 1:02d}.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", a.file, "-frames:v", "1", "-vf", "scale=360:-2", out], check=True)
    paths.append(out)
    print(f"{out}  t={t:.2f}s")
sheet = os.path.join(a.dir, "sheet.png")
cmd = ["ffmpeg", "-v", "error", "-y"]
for q in paths:
    cmd += ["-i", q]
half = (len(paths) + 1) // 2
cmd += ["-filter_complex", "".join(f"[{i}]" for i in range(half)) + f"hstack=inputs={half}[t];"
        + "".join(f"[{i}]" for i in range(half, len(paths))) + f"hstack=inputs={len(paths) - half}[b];[t][b]vstack", sheet]
subprocess.run(cmd, check=True)
print("sheet:", sheet, "- open it with the Read tool")

# ── measured gates ──
W, H, B = 135, 240, 5  # analysis size and block size (27 x 48 blocks)


def grab(t):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", a.file, "-frames:v", "1",
                          "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    return np.frombuffer(raw[:W * H * 3], np.uint8).reshape(H, W, 3).astype(np.float32) if len(raw) >= W * H * 3 else None


def coverage(img):
    # share of the frame holding something other than the plain background (0-1)
    blk = img.reshape(H // B, B, W // B, B, 3)
    mean = blk.mean(axis=(1, 3))
    std = blk.std(axis=(1, 3)).mean(axis=-1)
    bg = np.median(mean.reshape(-1, 3), axis=0)
    content = (np.abs(mean - bg).max(axis=-1) > 28) | (std > 14)
    return float(content.mean())


fails = []
r = subprocess.run(["ffmpeg", "-hide_banner", "-i", a.file, "-vf", "freezedetect=d=0.6", "-map", "0:v:0", "-f", "null", "-"],
                   capture_output=True, text=True)
st = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", r.stderr)]
en = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", r.stderr)] + [dur]
dead = [(s, e) for s, e in zip(st, en) if s < dur - a.hold - 0.1]
dead = [(s, min(e, dur - a.hold)) for s, e in dead if min(e, dur - a.hold) - s >= 0.6]
print("\nGATES (measured):")
if dead:
    fails.append("dead motion")
    print("  FAIL dead motion: nothing moves at " + ", ".join(f"{s:.1f}-{e:.1f}s" for s, e in dead)
          + f" (rule: nothing static > 0.6 s outside the last {a.hold:g} s) - add a slow push, drift, a reveal or cut sooner")
else:
    print("  ok   motion: no still stretch > 0.6 s before the end hold")
f0 = grab(0.0)
if f0 is not None:
    c0, l0 = coverage(f0), float(f0.mean())
    if c0 < 0.12 or l0 < 6:
        fails.append("empty first frame")
        print(f"  FAIL first frame: {c0:.0%} of it has content - frame 0 must already be a finished, striking composition")
    else:
        print(f"  ok   first frame: {c0:.0%} content")
ts = [dur * (k + 0.5) / 24 for k in range(24)]
cov = [(t, coverage(img)) for t in ts if (img := grab(t)) is not None]
sparse = [(t, c) for t, c in cov if c < 0.18]
if cov:
    avg = sum(c for _, c in cov) / len(cov)
    if len(sparse) * 3 >= len(cov):
        fails.append("sparse frames")
        print(f"  FAIL sparse: {len(sparse)}/{len(cov)} sampled frames are mostly empty background ("
              + ", ".join(f"{t:.1f}s {c:.0%}" for t, c in sparse[:12])
              + ") - make the lead subject fill 60-85% of the frame, bigger type, fuller layouts")
    else:
        print(f"  ok   fill: average {avg:.0%} of the frame has content" + (f"; thin at " + ", ".join(f"{t:.1f}s" for t, _ in sparse) if sparse else ""))
print("RESULT: " + ("FAIL (" + ", ".join(fails) + ") - fix, render again and re-run pl-frames" if fails else "PASS"))
"""

# `pl-music`: the Motion renderer's code-generated music bed (no samples, no
# licence issue), ducked under the speech found in a VO track or the footage.
PL_MUSIC = r"""#!/usr/bin/env python3
# pl-music - code-generated music bed (no samples, no licence issue) that ducks under the speech.
# Usage: pl-music --sec 24 --mood upbeat --speech video/vo-track.wav --out video/music.wav [--seed 7]
#   --speech: any audio/video whose speech the music should duck under (optional)
import argparse, json, os, random, subprocess, tempfile
import numpy as np
ap = argparse.ArgumentParser(description="code-generated music bed")
ap.add_argument("--sec", type=float, required=True)
ap.add_argument("--mood", choices=["chill", "upbeat", "hype"], default="upbeat")
ap.add_argument("--speech")
ap.add_argument("--out", required=True)
ap.add_argument("--seed", type=int, default=None)
a = ap.parse_args()
spans = []
if a.speech:
    SR, WIN = 16000, 800  # 50 ms windows
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", a.speech, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    cur = None
    for i in range(0, len(x), WIN):
        on = 20 * np.log10(np.sqrt(np.mean(x[i:i + WIN] ** 2)) + 1e-9) > -38
        t = i / SR
        if on and cur is None:
            cur = [t, t + WIN / SR]
        elif on:
            cur[1] = t + WIN / SR
        elif cur is not None and t - cur[1] > 0.35:
            if cur[1] - cur[0] >= 0.15:
                spans.append([round(cur[0], 2), round(cur[1], 2)])
            cur = None
    if cur is not None and cur[1] - cur[0] >= 0.15:
        spans.append([round(cur[0], 2), round(cur[1], 2)])
os.makedirs(os.path.dirname(os.path.abspath(a.out)) or ".", exist_ok=True)
job = {"totalSec": a.sec, "seed": a.seed if a.seed is not None else random.randint(1, 99999), "mood": a.mood,
       "speech": spans, "marks": {}, "bedOut": os.path.abspath(a.out)}
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
    json.dump(job, f)
subprocess.run(["node", "/opt/vgc-template/scripts/music.mjs", f.name], check=True)
print(f"{a.out} {a.sec:.2f}s mood={a.mood} speech spans={len(spans)} - play it from 0 at volume ~0.3")
"""

# `pl-audio-check`: loudness timeline + sound onsets of a render, so the VO
# placement and SFX hits can be verified (measured, not heard).
PL_AUDIO_CHECK = r"""#!/usr/bin/env python3
# pl-audio-check - loudness timeline + detected sound onsets of a video's audio (measured, not heard).
# Usage: pl-audio-check out/preview.mp4 [--step 0.25]
import argparse, subprocess
import numpy as np
SR = 16000
ap = argparse.ArgumentParser(description="audio timeline of a render")
ap.add_argument("file")
ap.add_argument("--step", type=float, default=0.25)
a = ap.parse_args()
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", a.file, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                     capture_output=True).stdout
x = np.frombuffer(raw, np.float32)
if not len(x):
    raise SystemExit("NO AUDIO STREAM in " + a.file)
n = max(1, int(a.step * SR))
db = [20 * np.log10(np.sqrt(np.mean(x[i:i + n] ** 2)) + 1e-9) for i in range(0, len(x), n)]
peak = float(np.max(np.abs(x)))
print(f"duration {len(x) / SR:.2f}s  peak {20 * np.log10(peak + 1e-9):.1f} dBFS  clipped samples {int(np.sum(np.abs(x) >= 0.999))}")
print("time    dB   level")
for k, d in enumerate(db):
    bar = "#" * max(0, int((d + 60) / 2))
    onset = "  <- onset" if k and d - db[k - 1] >= 8 and d > -40 else ""
    print(f"{k * a.step:6.2f}s {d:6.1f} {bar}{onset}")
quiet, start = [], None
for k, d in enumerate(db + [0]):
    if d < -45 and start is None:
        start = k
    elif d >= -45 and start is not None:
        if (k - start) * a.step >= 0.75:
            quiet.append(f"{start * a.step:.2f}-{k * a.step:.2f}s")
        start = None
print("silent spans (<-45 dB, >=0.75 s): " + (", ".join(quiet) or "none"))
flat, start = [], 0
for k in range(1, len(db) + 1):
    if k == len(db) or abs(db[k] - db[k - 1]) > 0.6:
        if (k - start) * a.step >= 3:
            flat.append(f"{start * a.step:.2f}-{k * a.step:.2f}s")
        start = k
if flat:
    print("WARNING level almost constant (only the music bed?) at: " + ", ".join(flat) +
          " - check the VO / SFX really play there (<Sequence from>, not startFrom)")
"""


def _progress(stage: str, pct: int, **extra):
    try:
        PROGRESS[modal.current_function_call_id()] = {"stage": stage, "pct": pct, "t": time.time(), **extra}
    except Exception:  # noqa: BLE001
        pass


def _b2():
    import boto3
    from botocore.config import Config
    endpoint = os.environ.get("B2_CONTENT_ENDPOINT") or os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_CONTENT_REGION") or os.environ.get("B2_REGION", "us-east-005")
    bucket = os.environ.get("B2_CONTENT_BUCKET", "peninglab-content")
    s3 = boto3.client(
        "s3", endpoint_url=endpoint, region_name=region,
        aws_access_key_id=os.environ["B2_CONTENT_KEY_ID"], aws_secret_access_key=os.environ["B2_CONTENT_APP_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}, retries={"max_attempts": 3, "mode": "standard"}),
    )
    return s3, endpoint, bucket


def _upload_b2(local: Path, key: str, content_type: str) -> str:
    from urllib.parse import quote, urlparse
    s3, endpoint, bucket = _b2()
    s3.upload_file(str(local), bucket, key, ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=2592000, immutable"})
    return f"https://{bucket}.{urlparse(endpoint).netloc}/" + "/".join(quote(p, safe="") for p in key.split("/"))


def _download(url: str, dest: Path, max_bytes: int = 600 * 1024 * 1024) -> Path:
    import requests
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        n = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1024 * 1024):
                n += len(chunk)
                if n > max_bytes:
                    raise RuntimeError("material too large")
                f.write(chunk)
    return dest


def _safe_name(name: str, i: int) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", name or "").strip("-.")[:80]
    return base or f"bahan-{i + 1}"


# pl-render: Claude Code's render command. It hands the project to the run's controller (_render_service, which has
# the Modal access Claude Code's shell does not) and waits; the controller renders it across the Motion app's render
# containers (~1–2 min instead of 5–8 on one machine). Any failure → a normal `hyperframes render` here, so a run
# never stalls on it.
PL_RENDER = r"""#!/usr/bin/env python3
import json, os, subprocess, sys, time, uuid
args = [a for a in sys.argv[1:] if not a.startswith("-")]
proj = os.path.realpath(args[0] if args else "video")
out = os.path.realpath(args[1] if len(args) > 1 else "out/preview.mp4")
os.makedirs(os.path.dirname(out), exist_ok=True)
d = "/tmp/pl-render"
if os.path.isdir(d) and os.path.isfile(os.path.join(proj, "index.html")):
    rid = uuid.uuid4().hex[:10]
    tmp = os.path.join(d, rid + ".tmp")
    with open(tmp, "w") as f:
        json.dump({"id": rid, "project": proj, "out": out}, f)
    os.replace(tmp, os.path.join(d, rid + ".req"))
    t0 = time.time()
    done = os.path.join(d, rid + ".done")
    while time.time() - t0 < 1500 and not os.path.exists(done):
        time.sleep(1)
    if os.path.exists(done):
        r = json.load(open(done))
        if r.get("ok") and os.path.isfile(out):
            print(f"pl-render: OK in {time.time() - t0:.0f}s on {r.get('chunks')} parallel render containers -> {out}")
            sys.exit(0)
        print("pl-render: parallel render failed (" + str(r.get("error"))[:300] + ") - rendering here with hyperframes render")
    else:
        print("pl-render: no answer from the parallel renderer - rendering here with hyperframes render")
sys.exit(subprocess.call(["hyperframes", "render", "--output", out], cwd=proj))
"""


def _render_service(ws: Path, hid: str, step: str, stop) -> None:
    """Serve pl-render requests for this run: copy the project (+ ./bahan) to the Motion jobs Volume, render it on the
    Motion app's parallel renderer, write the MP4 where Claude Code asked. Errors go back to pl-render (it falls back)."""
    reqdir = Path("/tmp/pl-render")
    reqdir.mkdir(parents=True, exist_ok=True)
    skip = shutil.ignore_patterns("node_modules", ".git", ".cache", "__pycache__", "out", "renders", "*.mp4.tmp")
    n = 0
    while not stop.is_set():
        for req in sorted(reqdir.glob("*.req")):
            try:
                data = json.loads(req.read_text())
            except Exception:  # noqa: BLE001
                continue
            req.unlink(missing_ok=True)
            n += 1
            job = f"vgc-{(hid or 'run')[:36]}-{step}-{n}"
            res = {"ok": False}
            t0 = time.time()
            try:
                proj = Path(data["project"]).resolve()
                rel = proj.relative_to(ws.resolve())
                dest = Path(MJOBS_ROOT) / job / "ws"
                shutil.rmtree(dest.parent, ignore_errors=True)
                shutil.copytree(proj, dest / rel, ignore=skip)
                if (ws / "bahan").is_dir() and rel.parts[0] != "bahan":
                    shutil.copytree(ws / "bahan", dest / "bahan", ignore=skip)
                MJOBS.commit()
                fn = modal.Function.from_name("peninglab-motion", "render_project")
                r = fn.remote(job, f"ws/{rel.as_posix()}", "render.mp4")
                MJOBS.reload()
                shutil.copy2(Path(MJOBS_ROOT) / job / "render.mp4", data["out"])
                res = {"ok": True, "chunks": r.get("chunks"), "timings": r.get("timings"), "sec": round(time.time() - t0, 1)}
                print(f"[pl-render] {job}: {res}", flush=True)
            except Exception as e:  # noqa: BLE001
                res = {"ok": False, "error": str(e)[:400]}
                print(f"[pl-render] {job} failed: {e}", flush=True)
            finally:
                shutil.rmtree(Path(MJOBS_ROOT) / job, ignore_errors=True)
                try:
                    MJOBS.commit()
                except Exception:  # noqa: BLE001
                    pass
            (reqdir / f"{data.get('id', 'x')}.done").write_text(json.dumps(res))
        stop.wait(0.5)


def _stage_of(tool: str, inp: dict) -> tuple:
    """A tool call → (stage label, rough %)."""
    cmd = str(inp.get("command") or "")
    if tool == "Bash" and re.search(r"(remotion|hyperframes) render|pl-render", cmd):
        return "render", 75
    if tool == "Bash" and re.search(r"remotion still|hyperframes (lint|check|snapshot)|pl-frames|pl-audio-check", cmd):
        return "check", 65
    if tool == "Bash" and re.search(r"ffmpeg|python3? .*(wav|audio|sfx|music)", cmd):
        return "audio", 55
    if tool in ("Write", "Edit", "MultiEdit"):
        return "build", 45
    if tool in ("Read", "Glob", "Grep", "LS") or (tool == "Bash" and re.search(r"ffprobe|ls |cat ", cmd)):
        return "scan", 15
    if tool == "Skill":
        return "knowledge", 10
    return "work", 30


def _looks_blank(video: Path, n: int = 8) -> bool:
    """True when most sampled frames are a flat background (nothing rendered on it)."""
    try:
        import numpy as np
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                                   capture_output=True, text=True, timeout=30).stdout.strip() or 0)
        flat = 0
        for k in range(n):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{dur * (k + 0.5) / n:.2f}", "-i", str(video), "-frames:v", "1",
                                  "-vf", "scale=54:96,format=gray", "-f", "rawvideo", "-"], capture_output=True, timeout=30).stdout
            if raw and float(np.frombuffer(raw, np.uint8).std()) < 4:
                flat += 1
        return flat >= max(2, int(n * 0.75))
    except Exception as e:  # noqa: BLE001
        print("blank check failed:", e)
        return False


BLANK_PROMPT = ("Video yang dirender KOSONG: hampir semua frame hanya latar tanpa teks atau visual — animasi tidak dimainkan "
                "semasa render. Cari puncanya (contoh: timeline tidak didaftarkan mengikut API enjin, elemen kekal opacity 0), "
                "betulkan, render semula ke ./out/preview.mp4, kemudian jalankan `pl-frames out/preview.mp4` dan buka sheet.png "
                "untuk sahkan visual benar-benar kelihatan. Beri ringkasan akhir.")


def _probe(path: Path) -> dict:
    j = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
                                  capture_output=True, text=True, timeout=60).stdout or "{}")
    v = next((x for x in j.get("streams", []) if x.get("codec_type") == "video"), {})
    return {"duration": float(j.get("format", {}).get("duration") or 0), "w": int(v.get("width") or 0),
            "h": int(v.get("height") or 0), "audio": any(x.get("codec_type") == "audio" for x in j.get("streams", []))}


# the client's voice after DeepFilterNet (as modal_motion.py): rumble cut, less boxiness, presence, de-ess, gentle compression
VOICE_POST = ("highpass=f=80,equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=3200:t=q:w=0.9:g=2,deesser=i=0.4:m=0.5:f=0.5,"
              "acompressor=threshold=-24dB:ratio=3:attack=12:release=150:knee=4:makeup=2,alimiter=limit=0.95")
VOICE_LEGACY = "highpass=f=75,afftdn=nr=10:nf=-32,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160:makeup=1.6,alimiter=limit=0.95"


def _cut_audio(src_label: str, segs: list, chain: str) -> str:
    """Keep `segs` with an 8 ms fade at both ends of every piece (a hard sample cut clicks), joined, then `chain` → [aout]."""
    n = len(segs)
    parts = [f"{src_label}asplit={n}" + "".join(f"[s{i}]" for i in range(n))] if n > 1 else [f"{src_label}anull[s0]"]
    for i, (a, b) in enumerate(segs):
        ln = max(0.001, b - a)
        f = min(0.008, ln / 4)
        parts.append(f"[s{i}]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,afade=t=in:st=0:d={f:.4f},"
                     f"afade=t=out:st={ln - f:.4f}:d={f:.4f}[c{i}]")
    parts.append("".join(f"[c{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1,{chain}[aout]")
    return ";".join(parts)


def _enhance_voice(src: Path, work: Path, span: float):
    """DeepFilterNet3 on the whole source voice before any cut; strength from the measured noise (a limit, never full
    removal — that is what sounds "underwater"). None when the binary is missing or anything fails."""
    import shutil
    import wave
    import numpy as np
    exe = shutil.which("deep-filter")
    if not exe:
        return None
    t0 = time.time()
    try:
        wav = work / "voice_in.wav"
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-t", f"{span:.2f}", "-vn", "-ac", "1", "-ar", "48000",
                            "-c:a", "pcm_s16le", str(wav)], capture_output=True, text=True, timeout=300)
        if r.returncode != 0:
            return None
        with wave.open(str(wav)) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        fr = x[: len(x) // 960 * 960].reshape(-1, 960)
        if not len(fr):
            return None
        e = 10 * np.log10((fr ** 2).mean(1) + 1e-10)
        snr = float(np.percentile(e, 95) - np.percentile(e, 10))
        atten = 8 if snr >= 35 else 12 if snr >= 25 else 18
        od = work / "dfn"
        od.mkdir(exist_ok=True)
        r = subprocess.run([exe, "-D", "-a", str(atten), "-o", str(od), str(wav)], capture_output=True, text=True, timeout=300)
        out = od / wav.name
        if r.returncode != 0 or not out.exists() or out.stat().st_size < 1000:
            return None
        print(f"[voice] DeepFilterNet3 atten {atten} dB (noise spread {snr:.1f} dB) in {time.time() - t0:.1f} s", flush=True)
        return out
    except Exception as e:  # noqa: BLE001
        print("voice enhance skipped:", str(e)[:200], flush=True)
        return None


def _remux_voice(vid: Path, voice: Path, segs) -> bool:
    """The normalised video's audio → the enhanced voice, cut on the same segments (any problem keeps the original)."""
    tmp = vid.with_name(vid.stem + "_v.mp4")
    try:
        fc = _cut_audio("[1:a]apad=pad_dur=0.5,", segs, VOICE_POST) if segs else f"[1:a]apad=pad_dur=0.5,{VOICE_POST}[aout]"
        script = vid.with_suffix(".voice.txt")
        script.write_text(fc, encoding="utf-8")
        before = _probe(vid)["duration"]
        r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(vid), "-i", str(voice), "-filter_complex_script", str(script),
                            "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
                            "-t", f"{before:.3f}", str(tmp)], capture_output=True, text=True, timeout=300)
        script.unlink(missing_ok=True)
        if r.returncode != 0 or not tmp.exists() or abs(_probe(tmp)["duration"] - before) > 0.15:
            print("voice remux skipped:", (r.stderr or "")[-200:], flush=True)
            return False
        tmp.replace(vid)
        return True
    except Exception as e:  # noqa: BLE001
        print("voice remux skipped:", str(e)[:200], flush=True)
        return False


def _normalise(src: Path, out: Path, info: dict, max_sec: float, segs=None) -> Path:
    """The Motion renderer's cut: 1080x1920 30 fps H.264, voice clean-up, and with
    `segs` only those time ranges (the client-reviewed jump cut)."""
    w, h = info["w"] or 1080, info["h"] or 1920
    ar = w / h if h else 0.5625
    sharpen = ",unsharp=5:5:0.7:5:5:0.0" if w < 900 else ""
    expr = "+".join(f"between(t,{s0:.3f},{e0:.3f})" for s0, e0 in segs) if segs else ""
    vpre = f"fps=30,select='{expr}',setpts=N/(30*TB)," if segs else "fps=30,"
    grade = ",eq=contrast=1.04:saturation=1.1:gamma=1.02"
    if 0.53 <= ar <= 0.6:
        fc = (f"[0:v]{vpre}scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920"
              f"{sharpen}{grade},setsar=1,format=yuv420p[v]")
    else:
        fc = (f"[0:v]{vpre}split[a][b];"
              "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:6,eq=brightness=-0.08[bg];"
              f"[b]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos{sharpen}{grade}[fg];"
              "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]")
    amap = "0:a:0" if info["audio"] else "1:a"
    voice = VOICE_LEGACY
    if segs and info["audio"]:
        fc += ";" + _cut_audio("[0:a]", segs, voice)
        amap = "[aout]"
    elif info["audio"]:
        fc += f";[0:a]{voice}[aout]"
        amap = "[aout]"
    script = out.with_suffix(".filter.txt")
    script.write_text(fc, encoding="utf-8")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src)]
    if not info["audio"]:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    if not segs:
        cmd += ["-t", f"{max_sec:.2f}"]
    cmd += ["-filter_complex_script", str(script), "-map", "[v]", "-map", amap,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]
    if not info["audio"]:
        cmd += ["-shortest"]
    r = subprocess.run(cmd + [str(out)], capture_output=True, text=True, timeout=900)
    script.unlink(missing_ok=True)
    if r.returncode != 0 or not out.exists():
        raise RuntimeError("cut/normalise failed: " + (r.stderr or "")[-400:])
    return out


def _unmap_words(words: list, segs: list) -> list:
    """Cut-timeline word times back onto the source (when the cut had to be skipped)."""
    spans, acc = [], 0.0
    for s0, e0 in segs:
        spans.append((acc, s0, e0 - s0))
        acc += e0 - s0

    def back(t: float) -> float:
        for a0, s0, ln in spans:
            if t <= a0 + ln + 1e-3:
                return round(s0 + max(0.0, t - a0), 3)
        a0, s0, ln = spans[-1]
        return round(s0 + ln, 3)

    return [{**w, "t": back(float(w["t"])), "e": back(float(w.get("e") or float(w["t"]) + 0.3))} for w in words]


def _prepare_footage(ws: Path, payload: dict) -> str:
    """Default · Padat edit: the client's video, cut exactly as reviewed, at
    ./bahan/footage.mp4 + the approved caption words at ./bahan/captions.json."""
    foot = ws / "bahan" / "footage.mp4"
    if foot.exists():
        return "ready"
    src = ws / "src_video"
    _download(str(payload["video_url"]), src)
    info = _probe(src)
    if info["duration"] <= 0.5:
        raise RuntimeError("footage has no duration (unreadable file?)")
    max_sec = float(payload.get("max_sec") or 180)
    segs = payload.get("segs") or None
    words = list(payload.get("words") or [])
    # the voice is cleaned (DeepFilterNet3) while the video encodes
    vbox: dict = {}
    vthread = None
    if info.get("audio"):
        import threading
        span = min(info["duration"], max_sec) if not segs else info["duration"]
        vthread = threading.Thread(target=lambda: vbox.update(wav=_enhance_voice(src, ws / "bahan", span)), daemon=True)
        vthread.start()
    try:
        _normalise(src, foot, info, max_sec, segs)
    except Exception as e:  # noqa: BLE001
        print("cut failed, using the uncut video:", str(e)[:300], flush=True)
        if segs:
            words = _unmap_words(words, segs)
        segs = None
        _normalise(src, foot, info, max_sec, None)
    if vthread:
        vthread.join(timeout=240)
        if vbox.get("wav"):
            _remux_voice(foot, vbox["wav"], segs)
        for junk in (ws / "bahan" / "voice_in.wav", ws / "bahan" / "dfn"):
            try:
                if junk.is_dir():
                    import shutil
                    shutil.rmtree(junk, ignore_errors=True)
                else:
                    junk.unlink(missing_ok=True)
            except Exception:  # noqa: BLE001
                pass
    caps = [{"w": str(w.get("w") or ""), "t": round(float(w["t"]), 3), "e": round(float(w.get("e") or float(w["t"]) + 0.3), 3)}
            for w in words if str(w.get("w") or "").strip()]
    (ws / "bahan" / "captions.json").write_text(json.dumps(caps, ensure_ascii=False), encoding="utf-8")
    src.unlink(missing_ok=True)
    return f"{_probe(foot)['duration']:.2f}s, {len(caps)} caption words"


CRITIC_PROMPT = """You are an independent, harsh motion-design critic for TikTok Shop video ads. You did NOT build this video:
judge only the rendered pixels and the measured numbers, never intentions.

Files in this folder:
- film.mp4 — the render ({dur:.1f}s, 9:16, with audio). The only artifact you judge.
- BRIEF.md — what the client asked for: the only source of truth for facts, claims, prices and the CTA.
- sheets/sheet-*.jpg — contact sheets, one frame every {step:.2f}s, time stamped (yellow, top-left). Open EVERY sheet with your Read tool.
- MEASURE.txt — measured: frozen stretches, big visual changes, loudness, the audio level timeline (voice / SFX onsets).
- bahan/ — the client's material (product photos{caps}).
{prev}
Method:
1. Read BRIEF.md and MEASURE.txt, then open every contact sheet.
2. Look closer wherever something seems off and around transitions: extract native frames with ffmpeg
   (e.g. `ffmpeg -v error -ss 4.20 -i film.mp4 -frames:v 1 c-4.20.png`, or a 1/30 s burst across a transition) and open them.
3. Judge against this bar (a vertical TikTok Shop ad, watched on a phone, often on mute), and the short-form gates in
   /opt/mvk/herk/quality-gates.md:
   - Hook: frame 0 is already a finished, striking composition; the first 2 s give a reason to keep watching.
   - No text collisions on ANY frame, including mid-transition; nothing cut off at the edges; key text inside the safe area
     (not in the bottom ~18%, not under the right-side buttons ~13% from the right edge).
   - Readable: every line stays long enough to read, strong contrast, correct Malay spelling, consistent type.
   - No blank or near-empty frames; no small element floating in a big empty field; the lead subject fills most of the frame.
   - Motion: no dead stretch over ~0.6 s (the CTA end card may hold but still drifts); land -> read -> fast exit;
     transitions carry an object or a direction instead of a slideshow of unrelated slide-ins.
   - Product: the client's real product photo appears clearly — undistorted, not badly cropped, not covered by text.
   - Captions (if any): match the spoken words and timing in bahan/captions.json; never cover the face or the product.
   - Truth: no price, offer, claim, testimonial, chat message, review or number that is not in BRIEF.md.
   - Not AI-looking (see /opt/refs/motionmaxxing/references/slop.md): no generic centred card stacks, no gradient-blob
     filler, every scene a different composition and scale, motion that lands with weight.
   - CTA: unmistakable on mute, readable for >= 1.5 s at the end.
   - Length: the duration the brief asks for (an ad far shorter or longer than asked is a top defect).
   - Footage edits: graphics never cover the speaker's face; product cards sit above / below it.
   - Audio (MEASURE.txt): one voice at a time (no stacked voice-over), no long silent gaps, music under the voice, SFX on
     real visual events. The final master is loudness-normalised automatically: judge balance, not absolute level.
4. Write ./report.md (under 700 words):
   - First line exactly `VERDICT: SHIP` (a demanding client would publish it as is) or `VERDICT: {fail}`.
   - Defects ranked by severity, each with timestamps and screen region.
   - `## Top fixes` — at most {nfix}, highest impact first, concrete and implementable in code (HTML/CSS/GSAP timeline/audio).
Be blunt; no padding. Do not modify film.mp4 or bahan/.
"""

CRITIC_PREV = """- previous-report.md — the previous critic's report on the earlier cut. First, for every item in its defects and
  Top fixes give FIXED / PARTLY / STILL PRESENT with timestamps; then look for NEW defects (regressions: overlaps,
  clipped text, glitch frames, audio problems).
"""

FIX_PROMPT = """Seorang pengkritik bebas (bukan anda) telah menilai render ./out/preview.mp4. Laporannya:

{report}

Tugas sekarang:
1. Betulkan isu dalam "Top fixes" ikut keutamaan (impak paling besar dahulu), dan kecacatan lain yang jelas dalam laporan.
   Jangan rosakkan apa yang sudah baik; jangan tambah fakta, harga atau dakwaan baru.
2. Render semula ke ./out/preview.mp4 (lint/check dahulu).
3. Jalankan `pl-frames out/preview.mp4` dan buka sheet.png, serta `pl-audio-check out/preview.mp4` — sahkan pembetulan
   benar-benar kelihatan / terukur, tiada kecacatan baharu, dan GATES pl-frames berakhir dengan "RESULT: PASS".
4. Ringkasan akhir dalam Bahasa Melayu untuk klien: arah video, apa yang diperbaiki, apa yang klien patut semak."""

IMG_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"}


def _sheets(video: Path, out_dir: Path, dur: float, max_frames: int = 60) -> tuple:
    """Time-stamped contact sheets (6x5 tiles) of a render, for the critic."""
    from PIL import Image, ImageDraw, ImageFont
    step = max(0.5, round(dur / max_frames, 2))
    tmp = out_dir / "f"
    tmp.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vf", f"fps=1/{step},scale=216:-2", str(tmp / "%04d.png")],
                   check=True, timeout=600)
    frames = sorted(tmp.glob("*.png"))
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", 22)
    except Exception:  # noqa: BLE001
        try:
            font = ImageFont.load_default(size=22)
        except Exception:  # noqa: BLE001
            font = ImageFont.load_default()
    cols, rows, sheets = 6, 5, []
    for s0 in range(0, len(frames), cols * rows):
        chunk = frames[s0:s0 + cols * rows]
        w, h = Image.open(chunk[0]).size
        sheet = Image.new("RGB", (cols * w, ((len(chunk) + cols - 1) // cols) * h), "black")
        d = ImageDraw.Draw(sheet)
        for i, f in enumerate(chunk):
            x, y = (i % cols) * w, (i // cols) * h
            sheet.paste(Image.open(f).convert("RGB"), (x, y))
            d.rectangle([x, y, x + 74, y + 30], fill="black")
            d.text((x + 4, y + 2), f"{(s0 + i) * step:.1f}s", fill="yellow", font=font)
        out = out_dir / f"sheet-{len(sheets) + 1}.jpg"
        sheet.save(out, quality=88)
        sheets.append(out)
    shutil.rmtree(tmp, ignore_errors=True)
    return sheets, step


def _measure(video: Path) -> str:
    """Measured facts about a render for the critic (pixels + audio, no opinions)."""
    info = _probe(video)
    dur = info["duration"]
    lines = [f"duration {dur:.2f}s, {info['w']}x{info['h']}, audio stream: {'yes' if info['audio'] else 'NONE'}"]
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-vf", "freezedetect=d=0.6", "-map", "0:v:0", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=900)
    st = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", r.stderr)]
    en = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", r.stderr)]
    spans = [(a, en[i] if i < len(en) else dur) for i, a in enumerate(st)]
    lines.append("frozen stretches (no visible change for >= 0.6 s): "
                 + (", ".join(f"{a:.1f}-{b:.1f}s" for a, b in spans) or "none")
                 + f" — total {sum(b - a for a, b in spans):.1f}s")
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-vf", "select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=900)
    cuts = [float(x) for x in re.findall(r"pts_time:([\d.]+)", r.stderr)]
    lines.append("big visual changes (cuts / transitions) at: " + (", ".join(f"{c:.2f}s" for c in cuts) or "none"))
    if info["audio"]:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-af", "ebur128=peak=true", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=900)
        tail = r.stderr[r.stderr.rfind("Summary:"):]
        i = re.search(r"I:\s*(-?[\d.]+|-inf) LUFS", tail)
        lra = re.search(r"LRA:\s*([\d.]+) LU", tail)
        pk = re.search(r"Peak:\s*(-?[\d.]+|-inf) dBFS", tail)
        lines.append(f"loudness: integrated {i.group(1) if i else '?'} LUFS, range {lra.group(1) if lra else '?'} LU, "
                     f"true peak {pk.group(1) if pk else '?'} dBFS (mastered to -14 LUFS afterwards)")
        r = subprocess.run(["pl-audio-check", str(video), "--step", "0.5"], capture_output=True, text=True, timeout=600)
        lines += ["", "audio level timeline (pl-audio-check, 0.5 s steps):", (r.stdout or r.stderr)[-9000:]]
    return "\n".join(lines)


def _master(video: Path, out: Path) -> Path:
    """Phone master: -14 LUFS integrated, true peak under -1 dBTP (two-pass loudnorm + limiter); the video stream is copied.
    If the limiter chain can't run on this ffmpeg, loudnorm alone; any other problem -> the unmastered cut is delivered."""
    try:
        info = _probe(video)
        if not info["audio"]:
            return video
        r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-af", "loudnorm=I=-14:TP=-2:LRA=11:print_format=json",
                            "-f", "null", "-"], capture_output=True, text=True, timeout=900)
        m = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])
        if float(m["input_i"]) < -60:
            return video  # (near) silent: nothing to master
        # one static gain to -14 LUFS (the limiter below shaves the transients): a linear loudnorm stops short when
        # the transients hit the true-peak ceiling (Motion edits came out near -20 LUFS)
        gain = max(-20.0, min(20.0, -14.0 - float(m["input_i"])))
        norm = (f"volume={gain:.2f}dB" if gain > 0 else
                f"loudnorm=I=-14:TP=-2:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
                f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
        chains = [
            # explicit format between the stages (ffmpeg 5.1 can't negotiate the layout otherwise), then a hard
            # ceiling at -2 dBFS (level=0: no auto gain) so the AAC encode stays under -1 dBTP
            "aformat=channel_layouts=stereo," + norm + ",aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000"
            ":channel_layouts=stereo,alimiter=limit=0.79:level=0:attack=5:release=60",
            "aformat=channel_layouts=stereo," + norm + ",aresample=48000",
        ]
        err = ""
        for af in chains:
            r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
                                "-af", af, "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)],
                               capture_output=True, text=True, timeout=900)
            if r.returncode == 0 and out.exists() and abs(_probe(out)["duration"] - info["duration"]) <= 0.3:
                print(f"[master] {float(m['input_i']):.1f} LUFS -> -14 LUFS ({'limiter' if 'alimiter' in af else 'loudnorm only'})", flush=True)
                return out
            err = (r.stderr or "")[-300:]
        print("master skipped:", err, flush=True)
        return video
    except Exception as e:  # noqa: BLE001
        print("master failed:", e, flush=True)
        return video


def _verdict(report: str) -> str:
    m = re.search(r"VERDICT:\s*\**\s*(SHIP|REVISE|ONE MORE PASS)", report or "", re.I)
    return m.group(1).upper() if m else ""


def _ignore_heavy(dirpath: str, names: list) -> list:
    """Not saved to the Volume: installed packages (a symlinked node_modules is kept) and caches."""
    out = []
    for n in names:
        q = Path(dirpath) / n
        if n in (".cache", "__pycache__") or n.startswith(".hf-create-") or (n == "node_modules" and not q.is_symlink()):
            out.append(n)
    return out


def _copy_if_changed(src: str, dst: str) -> str:
    try:
        if os.path.exists(dst) and os.path.getsize(src) == os.path.getsize(dst) and os.path.getmtime(src) <= os.path.getmtime(dst):
            return dst
    except OSError:
        pass
    return shutil.copy2(src, dst)


def _restore_ws(vol: Path, ws: Path) -> None:
    """The card's workspace from the Volume onto local disk; Claude Code sessions
    saved under an older working path are made visible under /root/ws too."""
    shutil.rmtree(ws, ignore_errors=True)
    if vol.exists():
        shutil.copytree(vol, ws, symlinks=True, ignore=_ignore_heavy)
    ws.mkdir(parents=True, exist_ok=True)
    projects = ws / ".claude-home" / "projects"
    if projects.exists():
        key = projects / re.sub(r"[^A-Za-z0-9]", "-", str(ws))
        key.mkdir(parents=True, exist_ok=True)
        for f in projects.glob("*/*.jsonl"):
            if f.parent != key and not (key / f.name).exists():
                shutil.copy2(f, key / f.name)


def _save_ws(ws: Path, vol: Path) -> None:
    try:
        shutil.copytree(ws, vol, symlinks=True, ignore=_ignore_heavy, copy_function=_copy_if_changed, dirs_exist_ok=True)
        WORK.commit()
    except Exception as e:  # noqa: BLE001
        print("workspace save failed:", str(e)[:300], flush=True)


API_FATAL = re.compile(r"API Error: (401|402|403)|Insufficient user quota|Not enough quota|Failed to authenticate|invalid api key", re.I)
API_TRANSIENT = re.compile(r"API Error: (408|409|425|429|5\d\d)|overloaded|Request timed out|Connection error|ECONNRESET|socket hang up|session stalled", re.I)
API_ERROR_MSG = "Enjin AI tidak dapat dihubungi (kuota / sambungan) — tiada video dihantar. Sila cuba lagi sebentar lagi."


def _api_error(run: dict) -> str:
    """The API error a Claude Code session ended on ('' when it ended normally).
    Such a session stopped mid-work: whatever it rendered so far may be unfinished."""
    if run.get("stalled"):
        return "session stalled (no output) — resumable"
    res = run.get("result") or {}
    text = str(res.get("result") or "")
    tail = " ".join(run.get("tail") or [])
    if API_FATAL.search(text) or API_TRANSIENT.search(text):
        return text[:400]
    if res.get("is_error") and (API_FATAL.search(tail) or API_TRANSIENT.search(tail) or not text):
        return (text or tail)[:400] or "session ended with an error"
    if not res and (API_FATAL.search(tail) or API_TRANSIENT.search(tail)):
        return tail[-400:]
    return ""


def _hf_project(ws: Path) -> Path | None:
    """The HyperFrames project the builder made (newest hyperframes.json), or None (e.g. a Remotion fallback)."""
    found = [q.parent for q in ws.rglob("hyperframes.json")
             if not ({"node_modules", ".claude", ".claude-home", GAUNTLET_DIR} & set(q.relative_to(ws).parts))]
    return max(found, key=lambda d: d.stat().st_mtime) if found else None


def _layout_copy(ws: Path, proj: Path) -> Path:
    """A throwaway copy of the workspace for the layout check, with every big video replaced by a light proxy of
    the same name and length in open codecs: overlay geometry doesn't depend on the footage's pixels, and the
    checker's browser never gets ready on H.264 / AAC footage."""
    dst = Path("/tmp/hfcheck")
    shutil.rmtree(dst, ignore_errors=True)
    skip = {".claude-home", ".claude", "node_modules", "out", GAUNTLET_DIR, ".hyperframes"}
    shutil.copytree(ws, dst, symlinks=True, ignore=lambda d, names: [n for n in names if n in skip])
    for v in list(dst.rglob("*")):
        if v.is_file() and not v.is_symlink() and v.suffix.lower() in (".mp4", ".mov", ".webm", ".m4v") and v.stat().st_size > 3_000_000:
            tmp = v.with_name(v.stem + ".proxy" + v.suffix)
            # open codecs (VP9 + Opus): the checker's Chrome Headless Shell can't decode H.264 / AAC
            r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(v), "-vf", "scale=270:-2,fps=10", "-c:v", "libvpx-vp9",
                                "-deadline", "realtime", "-cpu-used", "8", "-b:v", "250k", "-c:a", "libopus", "-b:a", "32k",
                                str(tmp)], capture_output=True, text=True, timeout=600)
            if r.returncode == 0 and tmp.exists():
                tmp.replace(v)
    # an infinite CSS animation never settles, so the checker would wait forever: one iteration is enough here
    for h in (dst / proj.relative_to(ws)).rglob("*.html"):
        t = h.read_text(encoding="utf-8", errors="replace")
        if "</head>" in t:
            h.write_text(t.replace("</head>", "<style>*,*::before,*::after{animation-iteration-count:1!important}</style></head>", 1),
                         encoding="utf-8")
    return dst / proj.relative_to(ws)


def _hf_check(ws: Path) -> dict | None:
    """`hyperframes check --json` on the builder's project: {ok, errors: [...]}, or None if it can't run."""
    proj = _hf_project(ws)
    if not proj:
        return None
    try:
        where = _layout_copy(ws, proj)
    except Exception as e:  # noqa: BLE001
        print("[check] could not prepare:", str(e)[:200], flush=True)
        return None
    j = None
    # Transition samples catch defects that only exist mid-animation (a headline overflowing while it scales up).
    # Word-by-word captions can have hundreds of tween edges, and an uncapped run outlives the checker's deadline:
    # try a generous cap first, then a small one (the dense 8 fps geometry pass covers the timeline either way).
    for cap in ("200", "48"):
        try:
            r = subprocess.run(["hyperframes", "check", "--json", "--samples", "24", "--at-transitions",
                                "--max-transition-samples", cap, "--max-issues", "60", "--timeout", "60000"],
                               cwd=where, capture_output=True, text=True, timeout=600)
            out = r.stdout
            j = json.loads(out[out.index("{"):out.rindex("}") + 1])
        except Exception as e:  # noqa: BLE001
            print(f"[check] cap {cap} could not run:", str(e)[:200], flush=True)
            j = None
            continue
        failed = any(f.get("code") == "check_runtime_failure" for f in (j.get("runtime") or {}).get("findings") or [])
        if not failed:
            break
        print(f"[check] cap {cap}: checker ran out of time", flush=True)
    if j is None:
        return None
    errors = []
    for sec in ("lint", "runtime", "layout", "motion", "contrast"):
        part = j.get(sec) or {}
        items = part.get("findings") or part.get("issues") or (part if isinstance(part, list) else [])
        for f in items if isinstance(items, list) else []:
            if str(f.get("severity")) == "error":
                errors.append({"section": sec, "code": f.get("code"), "selector": f.get("selector"),
                               "time": f.get("time"), "times": (f.get("times") or [])[:6], "bbox": f.get("bbox"),
                               "file": f.get("sourceFile"), "hint": str(f.get("fixHint") or f.get("message") or "")[:240]})
    if any(e["code"] == "check_runtime_failure" for e in errors):
        # the checker itself didn't finish (not a defect of the video): skip the gate rather than loop on it
        print("[check] checker did not finish — gate skipped", flush=True)
        return None
    ok = bool(j.get("ok")) and not errors
    print(f"[check] {'ok' if ok else str(len(errors)) + ' errors'} in {proj.relative_to(ws)}", flush=True)
    return {"ok": ok, "errors": errors[:40], "project": str(proj.relative_to(ws))}


CHECK_PROMPT = """Semakan automatik `hyperframes check` mendapati ralat pada projek {project}. Video belum boleh dihantar.
Senarai ralat (JSON: section, code, selector, time/times dalam saat, bbox, file, hint):

{errors}

Betulkan SEMUA ralat ini (teks terpotong / melimpah, elemen bertindih, kontras, masa beku, ralat lint/runtime) tanpa
merosakkan bahagian lain. Kemudian jalankan `hyperframes check --json --samples 24 --at-transitions --max-transition-samples 200` sendiri sehingga
tiada ralat, render semula ke ./out/preview.mp4, jalankan pl-frames dan buka sheet.png. Beri ringkasan akhir."""


def _find_video(ws: Path, since: float) -> Path | None:
    skip = {"bahan", "node_modules", ".claude-home", ".claude", "public", GAUNTLET_DIR}
    found = [p for p in ws.rglob("*.mp4") if not (set(p.relative_to(ws).parts[:-1]) & skip) and p.stat().st_mtime >= since - 1]
    if not found:
        return None
    # the preview the rules ask for, else the newest render
    named = [p for p in found if p.name == "preview.mp4"]
    return max(named or found, key=lambda p: p.stat().st_mtime)


@app.function(image=image, cpu=8.0, memory=16384, timeout=RUN_TIMEOUT + 600, secrets=SECRETS,
              volumes={KIT_ROOT: KIT, WORK_ROOT: WORK, MJOBS_ROOT: MJOBS})
def run_vgc(payload: dict) -> dict:
    t0 = time.time()
    hid = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("history_id") or f"job{int(t0)}"))[:60]
    uid = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("user_id") or "anon"))[:60]
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        return {"ok": False, "error": "empty prompt"}
    # the workspace: one per card (Custom Style steps share it); a Padat
    # re-render gets a fresh one (ws_id) so nothing stale carries over
    vol_ws = Path(WORK_ROOT) / (re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("ws_id") or ""))[:80] or hid)
    try:
        WORK.reload()  # the latest saved state (an earlier step may have run in another container)
    except Exception as e:  # noqa: BLE001
        print("volume reload failed:", e, flush=True)
    ws = LOCAL_WS
    _restore_ws(vol_ws, ws)
    home = ws / ".claude-home"
    (ws / "bahan").mkdir(parents=True, exist_ok=True)
    (ws / "out").mkdir(exist_ok=True)
    mode = str(payload.get("mode") or "vgc")
    bakeoff = mode == "bakeoff"
    if not bakeoff and Path(HF_SKILLS).exists():
        # the HyperFrames skills for every PeningLab run (Custom Style + Default · Padat)
        for sk in Path(HF_SKILLS).iterdir():
            dst = ws / ".claude" / "skills" / sk.name
            if sk.is_dir() and not dst.exists():
                shutil.copytree(sk, dst)
    if bakeoff:
        # the technology under test: its own skill(s), set up by shell commands
        (ws / ".claude" / "skills").mkdir(parents=True, exist_ok=True)
        if not (ws / "CLAUDE.md").exists():
            (ws / "CLAUDE.md").write_text(BAKEOFF_RULES + "\n" + str(payload.get("rules_extra") or ""), encoding="utf-8")
            setup_env = {k: v for k, v in os.environ.items() if not k.startswith(("B2_", "MOTION_", "MODAL_", "ANTHROPIC_"))}
            for cmd in payload.get("setup") or []:
                r = subprocess.run(cmd, shell=True, cwd=ws, env=setup_env, capture_output=True, text=True, timeout=900)
                print(f"[setup] rc={r.returncode} {cmd[:120]} :: {(r.stdout + r.stderr)[-300:]}", flush=True)
    elif mode in ("edit", "ad"):
        # Default · Padat: PeningLab's own brief on HyperFrames (no VGC kit)
        if not (ws / "CLAUDE.md").exists():
            (ws / "CLAUDE.md").write_text(DEFAULT_RULES, encoding="utf-8")
    else:
        skill_src = Path(KIT_ROOT) / "vgc-master-knowledge"
        skill_dst = ws / ".claude" / "skills" / "vgc-master-knowledge"  # project skill: always loaded from the cwd
        if not skill_dst.exists():
            if not (skill_src / "SKILL.md").exists():
                return {"ok": False, "error": "VGC kit missing on this Modal account (peninglab-vgc-kit volume)"}
            shutil.copytree(skill_src, skill_dst)
        if not (ws / "CLAUDE.md").exists():
            (ws / "CLAUDE.md").write_text(WORKSPACE_RULES, encoding="utf-8")
    # "vgc-edit" = Custom Style · Edit Footage Sendiri after its script was approved: the VGC workspace above plus the
    # same footage prep as a Padat edit (the cut footage + the approved words in ./bahan/)
    if mode in ("edit", "vgc-edit"):
        _progress("normalise", 4)
        try:
            print("[footage]", _prepare_footage(ws, payload), flush=True)
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"footage prep failed: {str(e)[:400]}"}

    _progress("download", 3)
    # Default · Padat: the product photos in their own folder (the brief points there)
    mat_dir = ws / "bahan" / "produk" if mode in ("edit", "ad") else ws / "bahan"
    mat_dir.mkdir(parents=True, exist_ok=True)
    for i, m in enumerate(payload.get("materials") or []):
        name = _safe_name(str(m.get("name") or ""), i)
        dest = mat_dir / name
        if dest.exists():
            continue
        if m.get("url"):
            _download(str(m["url"]), dest)
        elif m.get("data_b64"):
            import base64
            dest.write_bytes(base64.b64decode(m["data_b64"]))

    env = {
        **os.environ,
        # sessions live with the card's workspace, so a later step can --resume
        "CLAUDE_CONFIG_DIR": str(home),
        "ANTHROPIC_BASE_URL": DRAGON_BASE,
        "ANTHROPIC_MODEL": MODEL, "ANTHROPIC_SMALL_FAST_MODEL": MODEL,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": MODEL, "ANTHROPIC_DEFAULT_OPUS_MODEL": MODEL, "ANTHROPIC_DEFAULT_HAIKU_MODEL": MODEL,
        "IS_SANDBOX": "1", "DISABLE_AUTOUPDATER": "1", "DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "API_TIMEOUT_MS": "600000",
        "BASH_DEFAULT_TIMEOUT_MS": "900000", "BASH_MAX_TIMEOUT_MS": "1800000",
    }
    # only Claude Code gets the API key; the B2 / Modal secrets stay out of its shell
    for k in list(env):
        if k.startswith(("B2_", "MOTION_", "MODAL_")):
            env.pop(k, None)
    for name, body in (("pl-vo-track", PL_VO_TRACK), ("pl-audio-check", PL_AUDIO_CHECK), ("pl-frames", PL_FRAMES),
                       ("pl-music", PL_MUSIC), ("pl-render", PL_RENDER)):
        tool = Path("/usr/local/bin") / name
        if not tool.exists():
            tool.write_text(body, encoding="utf-8")
            tool.chmod(0o755)
    # an Edit Video on Padat keeps 100 % the speaker's own voice: never an AI voice tool there
    tts = (payload.get("tts") or {}) if mode not in ("edit", "vgc-edit") else {}
    if mode in ("edit", "vgc-edit"):
        Path("/usr/local/bin/pl-tts").unlink(missing_ok=True)
        for k in [k for k in env if k.startswith("PL_TTS")]:
            env.pop(k, None)
    if tts.get("url") and tts.get("token"):
        tool = Path("/usr/local/bin/pl-tts")
        if not tool.exists():
            tool.write_text(PL_TTS, encoding="utf-8")
            tool.chmod(0o755)
        env.update({"PL_TTS_URL": str(tts["url"]), "PL_TTS_TOKEN": str(tts["token"]), "PL_TTS_HID": str(payload.get("history_id") or "")})
    # the parallel renderer behind pl-render, for as long as this run lives (daemon: it ends with the container)
    import threading as _th
    _render_stop = _th.Event()
    if not bakeoff:
        _th.Thread(target=_render_service, args=(ws, str(payload.get("history_id") or ""), str(payload.get("step") or "s1"), _render_stop),
                   daemon=True).start()

    def claude(text: str, session: str | None, budget: float, cwd: Path | None = None, run_env: dict | None = None,
               stage: str | None = None, turns: int | None = None) -> dict:
        """One `claude -p` invocation (optionally resuming); streams progress."""
        cmd = ["claude", "-p", text, "--output-format", "stream-json", "--verbose",
               "--permission-mode", "bypassPermissions", "--max-turns", str(int(turns or payload.get("max_turns") or MAX_TURNS)),
               "--model", MODEL] + (["--resume", session] if session else [])
        began = time.time()
        proc = subprocess.Popen(cmd, cwd=cwd or ws, env=run_env or env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, errors="replace")
        out = {"session_id": session, "result": None, "tail": []}
        # A reader thread feeds a queue, so the budget and the stall watchdog are
        # checked every few seconds even when the session prints nothing (a hung
        # API call once left a run silent for 50 minutes).
        import queue
        import threading
        lines: "queue.Queue[str | None]" = queue.Queue()

        def pump():
            try:
                for ln in proc.stdout:
                    lines.put(ln)
            finally:
                lines.put(None)

        threading.Thread(target=pump, daemon=True).start()
        last_event = time.time()
        try:
            while True:
                now = time.time()
                if now - began > budget:
                    print("[runner] time budget reached — stopping the session", flush=True)
                    proc.kill()
                    break
                if now - last_event > STALL_SEC:
                    print(f"[runner] no output for {STALL_SEC // 60} min — the session stalled; stopping it", flush=True)
                    out["stalled"] = True
                    proc.kill()
                    break
                try:
                    line = lines.get(timeout=5)
                except queue.Empty:
                    continue
                if line is None:
                    break
                last_event = time.time()
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except Exception:  # noqa: BLE001
                    out["tail"] = (out["tail"] + [line[:300]])[-20:]
                    continue
                if ev.get("type") == "system" and ev.get("subtype") == "init":
                    out["session_id"] = ev.get("session_id") or out["session_id"]
                elif ev.get("type") == "assistant":
                    for c in (ev.get("message") or {}).get("content") or []:
                        if c.get("type") == "tool_use":
                            state["tools"] += 1
                            st, p = _stage_of(c.get("name", ""), c.get("input") or {})
                            state["pct"] = max(state["pct"], p)
                            inp = c.get("input") or {}
                            last = f"{c.get('name')}: {str(inp.get('command') or inp.get('file_path') or '')[:120]}"
                            print(f"[{int(time.time() - t0)}s]{' [' + stage + ']' if stage else ''} {last}", flush=True)
                            _progress(stage or st, state["pct"], tools=state["tools"], last=last)
                        elif c.get("type") == "text" and c.get("text"):
                            print(f"[{int(time.time() - t0)}s] » {c['text'][:200]}", flush=True)
                elif ev.get("type") == "result":
                    out["result"] = ev
                    out["session_id"] = ev.get("session_id") or out["session_id"]
            try:
                proc.wait(timeout=60)
            except subprocess.TimeoutExpired:
                proc.kill()
        finally:
            if proc.poll() is None:
                proc.kill()
            _save_ws(ws, vol_ws)  # the project + session survive for the next step
        return out

    expect_video = payload.get("expect_video", True) is not False
    state = {"tools": 0, "pct": 5}
    _progress("start", 5)
    run_start = time.time()
    deadline = run_start + RUN_TIMEOUT
    runs = [claude(prompt + (RUN_ADDENDUM_VIDEO if expect_video else RUN_ADDENDUM_TEXT), payload.get("session_id"), RUN_TIMEOUT)]
    # Claude Code sometimes stops after recommending a direction (it would wait
    # for "ok" in a chat): with no one to answer, resume and ask it to build.
    # A render that shows only the background (the animation never played in
    # the renderer) gets the same treatment: resume and have it fixed.
    # A session cut off by a passing API error (overload, 5xx, timeout) is
    # resumed after a pause; a fatal one (quota, auth) ends the run.
    for _ in range(MAX_CONTINUES + 1):
        last = runs[-1]
        said = str((last["result"] or {}).get("result") or "")
        err = _api_error(last)
        if err and API_FATAL.search(err):
            print("[runner] fatal API error:", err[:200], flush=True)
            break
        if (not expect_video or "PERLU_INPUT" in said or not last["session_id"] or deadline - time.time() < 8 * 60):
            break
        if err:
            print("[runner] API error — resuming the session in 30 s:", err[:200], flush=True)
            time.sleep(30)
            runs.append(claude(CONTINUE_PROMPT, last["session_id"], deadline - time.time()))
            continue
        found = _find_video(ws, run_start)
        if found and not _looks_blank(found):
            break
        if len(runs) > MAX_CONTINUES:
            break
        why = "blank render" if found else "no video yet"
        print(f"[runner] {why} — continuing the session", flush=True)
        runs.append(claude(BLANK_PROMPT if found else CONTINUE_PROMPT, last["session_id"], deadline - time.time()))

    step = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("step") or "v1"))[:20]
    build_err = _api_error(runs[-1])
    if build_err:
        # the builder stopped mid-work: what it rendered so far may be unfinished
        _progress("done", 100)
        return {"ok": False, "url": None, "error": API_ERROR_MSG, "api_error": build_err,
                "session_id": runs[-1]["session_id"], "runs": len(runs), "run_sec": round(time.time() - run_start, 1),
                "cost_usd": round(sum(float((r["result"] or {}).get("total_cost_usd") or 0) for r in runs), 4)}
    video = _find_video(ws, run_start) if expect_video else None
    gdir = ws / GAUNTLET_DIR
    ledger, keep = [], len(runs) - 1  # keep = the run whose cut is delivered (its summary describes it)

    def fix_run(text: str) -> dict:
        """A fix round on the builder's session. A passing API error (overload, 5xx, timeout, stall) is
        resumed after 30 s, up to twice; a fatal one (quota, auth) ends the round."""
        runs.append(claude(text, runs[-1]["session_id"], deadline - time.time() - 60))
        for _ in range(2):
            err = _api_error(runs[-1])
            if not err or API_FATAL.search(err) or not runs[-1]["session_id"] or deadline - time.time() < FIX_MIN / 2:
                break
            print("[runner] API error in a fix round — resuming in 30 s:", err[:200], flush=True)
            time.sleep(30)
            runs.append(claude(RESUME_PROMPT, runs[-1]["session_id"], deadline - time.time() - 60))
        return runs[-1]

    def critic(cut: Path, rnd: int, prev: str | None) -> str | None:
        """A fresh Claude session that sees only the render, the brief and measurements."""
        cdir = Path("/tmp/gauntlet") / f"{hid}-{step}-r{rnd}"
        shutil.rmtree(cdir, ignore_errors=True)
        (cdir / "bahan").mkdir(parents=True)
        shutil.copy2(cut, cdir / "film.mp4")
        (cdir / "BRIEF.md").write_text(str(payload.get("brief") or prompt), encoding="utf-8")
        caps = False
        for f in (ws / "bahan").rglob("*"):
            if f.is_file() and (f.suffix.lower() in IMG_EXTS or f.name == "captions.json"):
                shutil.copy2(f, cdir / "bahan" / f.name)
                caps = caps or f.name == "captions.json"
        dur = _probe(cut)["duration"]
        _, every = _sheets(cut, cdir / "sheets", dur)
        chk = _hf_check(ws)
        (cdir / "MEASURE.txt").write_text(_measure(cut) + ("" if chk is None else "\n\nhyperframes check (automatic): "
                                          + ("no errors" if chk["ok"] else json.dumps(chk["errors"][:15], ensure_ascii=False))),
                                          encoding="utf-8")
        if prev:
            (cdir / "previous-report.md").write_text(prev, encoding="utf-8")
        text = CRITIC_PROMPT.format(dur=dur, step=every, caps=", the approved caption words captions.json" if caps else "",
                                    prev=CRITIC_PREV if prev else "", fail="ONE MORE PASS" if prev else "REVISE",
                                    nfix=3 if prev else 6)
        cenv = {k: v for k, v in env.items() if not k.startswith("PL_TTS")}
        cenv["CLAUDE_CONFIG_DIR"] = "/tmp/gauntlet-home"
        out = claude(text, None, min(CRITIC_BUDGET, deadline - time.time() - FIX_MIN / 3), cwd=cdir, run_env=cenv,
                     stage="critic", turns=60)
        rp = cdir / "report.md"
        report = rp.read_text(encoding="utf-8", errors="replace") if rp.exists() else str((out["result"] or {}).get("result") or "")
        return report.strip() if _verdict(report) else None

    def check_gate(label: str) -> None:
        """Send the build back until `hyperframes check` reports no errors (CHECK_FIXES rounds)."""
        nonlocal video, keep
        for k in range(CHECK_FIXES):
            if video is None or bakeoff or not runs[-1]["session_id"] or deadline - time.time() < FIX_MIN:
                return
            res = _hf_check(ws)
            if res is None or res["ok"]:
                ledger.append({"round": f"check-{label}", "verdict": "OK" if res else "n/a"})
                return
            _progress("revise", state["pct"], round=f"check {label}")
            start = time.time()
            fix_run(CHECK_PROMPT.format(project=res["project"], errors=json.dumps(res["errors"], ensure_ascii=False, indent=1)))
            new = _find_video(ws, start)
            if _api_error(runs[-1]) or not new or _looks_blank(new) or _probe(new)["duration"] < 3:
                ledger.append({"round": f"check-{label}", "verdict": f"{len(res['errors'])} errors", "fix": "fix failed: kept the cut"})
                return
            video, keep = new, len(runs) - 1
            ledger.append({"round": f"check-{label}", "verdict": f"{len(res['errors'])} errors", "fix": "re-rendered"})
        res = _hf_check(ws)
        ledger.append({"round": f"check-{label}", "verdict": "OK" if (res is None or res["ok"]) else f"{len(res['errors'])} errors left"})

    if video is not None and not _looks_blank(video):
        check_gate("build")

    critic_on = (video is not None and not bakeoff and payload.get("critic", True) is not False
                 and runs[-1]["session_id"] and not _looks_blank(video))
    if critic_on:
        gdir.mkdir(exist_ok=True)
        best = gdir / f"{step}-r0.mp4"
        shutil.copy2(video, best)
        prev = None
        for rnd in range(1, CRITIC_ROUNDS + 1):
            if deadline - time.time() < CRITIC_BUDGET + FIX_MIN:
                print("[gauntlet] not enough time left for another round", flush=True)
                break
            state["pct"] = max(state["pct"], 80 + 6 * (rnd - 1))
            _progress("critic", state["pct"], round=rnd)
            report = None
            for _try in range(2):
                try:
                    report = critic(best, rnd, prev)
                except Exception as e:  # noqa: BLE001
                    print("[gauntlet] critic failed:", e, flush=True)
                    report = None
                if report or deadline - time.time() < CRITIC_BUDGET + FIX_MIN:
                    break
                print("[gauntlet] no verdict from the critic — one more try", flush=True)
            if not report:
                ledger.append({"round": rnd, "verdict": "", "fix": "critic unavailable"})
                break
            verdict = _verdict(report)
            (gdir / f"{step}-r{rnd}-report.md").write_text(report, encoding="utf-8")
            ledger.append({"round": rnd, "verdict": verdict, "report": report[:2500]})
            print(f"[gauntlet] round {rnd}: {verdict}", flush=True)
            if verdict == "SHIP" or deadline - time.time() < FIX_MIN:
                break
            state["pct"] = max(state["pct"], 83 + 6 * (rnd - 1))
            _progress("revise", state["pct"], round=rnd)
            fix_start = time.time()
            fix_run(FIX_PROMPT.format(report=report))
            new = _find_video(ws, fix_start)
            if _api_error(runs[-1]):
                print("[gauntlet] the fix round hit an API error — keeping the previous cut", flush=True)
                ledger[-1]["fix"] = "failed (API error): kept the previous cut"
                break
            if not new or _looks_blank(new) or _probe(new)["duration"] < 3:
                # never trade a good cut for a broken one
                print("[gauntlet] the fix round gave no usable video — keeping the previous cut", flush=True)
                ledger[-1]["fix"] = "failed: kept the previous cut"
                break
            video, keep = new, len(runs) - 1
            ledger[-1]["fix"] = "re-rendered"
            check_gate(f"r{rnd}")
            best = gdir / f"{step}-r{rnd}.mp4"
            shutil.copy2(video, best)
            prev = report
        video = best
        _save_ws(ws, vol_ws)

    result = runs[keep]["result"] or {}
    session_id = runs[-1]["session_id"]
    tail = runs[-1]["tail"]
    tools = state["tools"]
    summary = str(result.get("result") or "").strip()
    meta = {
        "session_id": session_id,
        "turns": sum(int((r["result"] or {}).get("num_turns") or 0) for r in runs), "tools": tools,
        "cost_usd": round(sum(float((r["result"] or {}).get("total_cost_usd") or 0) for r in runs), 4),
        "usage": result.get("usage"), "runs": len(runs),
        "run_sec": round(time.time() - run_start, 1), "summary": summary[:6000],
        "subtype": result.get("subtype"), "needs_input": summary.startswith("PERLU_INPUT") or "PERLU_INPUT:" in summary[:200],
        "gauntlet": ledger,
    }
    fatal = next((e for e in (_api_error(r) for r in runs) if e and API_FATAL.search(e)), "")
    if fatal:
        meta["api_error"] = fatal[:400]
    if video and _looks_blank(video):
        # never hand a client an empty video: fail the step (refunded) instead
        _progress("done", 100)
        return {"ok": False, "url": None, "error": "rendered video is blank (no visuals) after retries", **meta}
    if not video:
        err = "no video rendered" if summary else "Claude Code stopped: " + " | ".join(tail[-5:])[-800:]
        _progress("done", 100)
        return {"ok": bool(summary), "url": None, "error": None if summary else err, **meta}

    if not bakeoff:
        _progress("master", 94)
        gdir.mkdir(exist_ok=True)
        video = _master(video, gdir / f"{step}-final.mp4")
    _progress("upload", 95)
    url = _upload_b2(video, f"users/{uid}/vgc/{hid}-{step}.mp4", "video/mp4")
    poster = None
    try:
        jpg = ws / "out" / f"poster-{step}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1", "-i", str(video), "-frames:v", "1", "-vf", "scale=540:-2", str(jpg)],
                       check=True, timeout=60)
        poster = _upload_b2(jpg, f"users/{uid}/vgc/{hid}-{step}.jpg", "image/jpeg")
    except Exception as e:  # noqa: BLE001
        print("poster failed", e)
    dur = None
    try:
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                                   capture_output=True, text=True, timeout=30).stdout.strip())
    except Exception:  # noqa: BLE001
        pass
    _progress("done", 100)
    return {"ok": True, "url": url, "poster_url": poster, "duration_sec": dur, "file": str(video.relative_to(ws)), **meta}


@app.function(image=web_image, secrets=[modal.Secret.from_name("motion-secrets")])
@modal.asgi_app()
def api():
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    web = FastAPI()

    def _authed(secret: str) -> bool:
        import hmac
        return hmac.compare_digest(str(secret or ""), os.environ.get("MOTION_SECRET", ""))

    @web.post("/start")
    async def start(req: Request):
        body = await req.json()
        if not _authed(body.pop("secret", "")):
            return JSONResponse({"ok": False, "error": "forbidden"}, status_code=403)
        call = run_vgc.spawn(body)
        return {"ok": True, "call_id": call.object_id}

    @web.get("/check")
    async def check(call_id: str, secret: str):
        if not _authed(secret):
            return JSONResponse({"ok": False, "error": "forbidden"}, status_code=403)
        fc = modal.FunctionCall.from_id(call_id)
        try:
            res = fc.get(timeout=0)
        except TimeoutError:
            return {"status": "running", "progress": PROGRESS.get(call_id)}
        except Exception as e:  # noqa: BLE001
            return {"status": "failed", "error": str(e)[:500]}
        if not res.get("ok"):
            return {"status": "failed", "error": res.get("error") or "VGC run failed", "result": res}
        return {"status": "done", "result": res}

    return web


@app.local_entrypoint()
def pilot(prompt_file: str, material: str = "", hid: str = "pilot1", uid: str = "pilot", session_id: str = "", step: str = "v1"):
    """Local test: py -3 -m modal run modal_vgc.py --prompt-file p.txt --material img.webp"""
    import base64
    payload = {"history_id": hid, "user_id": uid, "prompt": Path(prompt_file).read_text(encoding="utf-8"), "step": step}
    if session_id:
        payload["session_id"] = session_id
    if material:
        mats = []
        for m in material.split(","):
            p = Path(m)
            mats.append({"name": p.name, "data_b64": base64.b64encode(p.read_bytes()).decode()})
        payload["materials"] = mats
    t = time.time()
    res = run_vgc.remote(payload)
    res.pop("usage", None)
    print(json.dumps(res, indent=1, ensure_ascii=False)[:5000])
    print(f"wall {round(time.time() - t)}s")
