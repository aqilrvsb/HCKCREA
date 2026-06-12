# "Live" Package Integration — Host Live × PeningLab

> HANDOFF SPEC for the PeningLab workspace. A fully working real-time AI talking-head
> live-streaming product ("Host Live") exists as a standalone app. This doc tells you
> everything needed to integrate it into PeningLab as a new **Live package**: a client
> with the Live package logs into PeningLab and gets the Live studio UI; admin manages
> per-client GPU/keys in admin settings.
>
> Source app (working, deployed): **github.com/aqilrvsb/talking-head-live** (local:
> `C:\Users\User\talking-head-live`, live at talking-head-live.vercel.app).
> Full infra replication guide for new client GPUs: `CLIENT-SETUP.md` in that repo.

## 1. What the product is (sales story for the package page)

AI avatar that hosts TikTok Live 24/7 — replaces a human live host.
Human host: mahal (RM3–5k/mo), 4–6 jam max, tak konsisten, kena train, MC/cuti.
PeningLive host: RM-fixed/mo, 24 jam nonstop, ikut script sendiri, jawab chat customer
guna product knowledge, suara Malay natural (cloned voices), tukar avatar/template bila-bila.

## 2. Architecture (per client — 1 GPU = 1 client)

```
PeningLab dashboard (Live tab) ──WebRTC (Cloudflare TURN)──► client's GPU box (Vast.ai)
  studio UI: scripts/rundown/teleprompter                      AVTR-1 renderer+streamer
  control datachannel: say/ask/kb/cfg/interrupt                + MiniMax TTS + OpenRouter
  permanent URL per client: clientN.peningcast.com (Cloudflare named tunnel)
```

- ONE domain (peningcast.com) serves all clients via subdomains; one tunnel per client.
- Keys (MiniMax/OpenRouter/TURN/Vast) live ON the GPU box (`/workspace/turn.env`), never in the browser.
- The box auto-boots everything on instance start (`/root/onstart.sh` → `boot.sh`).

## 3. What to port into PeningLab

### 3.1 The studio UI (client-facing)
Copy from `talking-head-live`:
- `app/page.tsx` → becomes the Live tab/page component (e.g. `app/dashboard/tabs/live.tsx`
  or a dedicated `/dashboard/live` route). It is self-contained React (no external state).
- The CSS in `app/globals.css` from “Left panel = video …” downward (stage, queue-col,
  prompter-col, tabs, script-card, usage-card, loop-row, unmute-btn classes) — scope or
  port into PeningLab’s styling system.
- `public/avatars/` (18 stock Malaysian hosts + manifest.json) and `public/overlays/`
  (25 transparent templates + manifest.json).

Key change when porting: `const BACKEND` (top of page.tsx) must come from the client's
config (their `backend_url`) fetched from PeningLab DB — not a hardcoded constant.
Everything else works as-is.

### 3.2 The studio UI already includes (don't rebuild)
- Script library (many titled scripts) + Rundown (ordered playlist, ↑↓/✕, Loop,
  Pause/Resume, ⟳ Restart) + read-only teleprompter with line + word-level karaoke
  (timed by real audio durations from the backend).
- Gapless speech driver: sends one 12–15-word chunk at a time over the "control"
  datachannel with ids; backend queues + pipelines (depth 2); `say_done {id, duration,
  chars}` paces the next send and carries EXACT MiniMax-billed characters.
- Customer chat (`ask`) → barge-in → OpenRouter answer grounded in the Products
  knowledge base (`kb` message updates the system prompt live) → auto-resume script.
- Voice volume (WebAudio gain 0–300%) + speed (`cfg` message, live) sliders.
- Usage tab: voice chars (exact billed, per session) + GPU hours/cost via the box's
  `/gpu-usage` + GPU power buttons via a server-side `/api/gpu` route.
- localStorage persistence of scripts/rundown/settings (consider migrating to DB
  per PeningLab user — table suggestion below).

### 3.3 Backend HTTP endpoints each client GPU exposes (already built)
| Endpoint | Purpose |
|---|---|
| `GET /avatars` | list registered avatars + backgrounds |
| `POST /register-avatar?avatar_id=X` (raw image body) | upload client’s own host photo |
| `GET /ice-servers` | TURN config for WebRTC |
| `POST /offer` | WebRTC SDP; body includes `engine:{type:"minimax",voice_id,system_prompt,speed}`, `avatar_id`, `background_id` |
| `GET /active` | is a stream session live (idle watchdog uses this) |
| `GET /gpu-usage` | `{runtime_hours, dph_usd, cost_usd, state}` from Vast (key stays on box) |

Datachannel ("control") protocol:
`{kind:"say",text,id}` `{kind:"ask",text,id}` `{kind:"kb",text}` `{kind:"cfg",text:'{"speed":1.1}'}`
`{kind:"interrupt"}` ← browser→box; box→browser: `{kind:"say_done",duration,id,chars}`, `{kind:"line",...}`.

## 4. PeningLab-side work

### 4.1 Package/plan
- Add package key `live` to the plans system (pricing suggestion: Starter RM1,499/mo
  4h/day · Pro RM2,499/mo 12h/day · Always-On RM3,999/mo 24/7 — adjust to taste;
  margin over ~RM160/mo GPU 8h/day + voice costs).
- Checkout flow: reuse existing PeningLab billing; package grants access to the Live tab.

### 4.2 DB (Supabase — note a fresh project `peninglive` ref tcykmwxmbzwjzqlvrxrt exists,
but using PeningLab's existing project keeps one login — recommended)
```sql
create table live_client_config (
  user_id uuid primary key references profiles(id),
  backend_url text default '',        -- https://clientN.peningcast.com
  vast_instance_id text default '',   -- their dedicated GPU
  active boolean default true,
  notes text default '',
  updated_at timestamptz default now()
);
-- optional: move studio state server-side
create table live_studio_state (
  user_id uuid primary key references profiles(id),
  scripts jsonb default '[]', rundown jsonb default '[]',
  products_kb text default '', settings jsonb default '{}',
  usage_voice_chars bigint default 0, gpu_baseline_hours numeric default 0,
  period_start date
);
```

### 4.3 Admin (`/admin/settings` + clients page)
Per client (Live package holders): set `backend_url`, `vast_instance_id`, active toggle.
Global admin settings keys: `VAST_API_KEY` (powers start/stop + usage), and reference
fields for MINIMAX_API_KEY / OPENROUTER_API_KEY / CF tunnel + TURN (these actually live
on each GPU box — store for provisioning reference).

### 4.4 GPU power API (port from talking-head-live `app/api/gpu/route.ts`)
POST `{action:"start"|"stop"|"status"}` → Vast `PUT /api/v0/instances/{id}/ {state}`.
Change: read `vast_instance_id` from the logged-in user's `live_client_config` (admin key
from settings) instead of env vars. Box self-boots on start (~2–3 min to ready).

## 5. Provisioning a new Live client (ops runbook — see CLIENT-SETUP.md for detail)
1. Rent Vast RTX 4090 (~$0.40–0.50/hr), build AVTR-1 (~60 min), scp `backend/` files
   from talking-head-live repo (9 modified source files + box scripts), fill turn.env.
2. New Cloudflare tunnel + route `clientN.peningcast.com → localhost:8000`.
3. Install `/root/onstart.sh` → `bash /workspace/boot.sh` (auto-boot).
4. In PeningLab admin: set the client's `backend_url` + `vast_instance_id`. Done.

## 6. Gotchas (hard-won — read before debugging)
- MiniMax: API spends platform.minimax.io console "Credit Balance" (top-up), NOT audio
  subscriptions. Caps ~5000 chars/request → NEVER send whole scripts; the chunking
  driver handles this.
- Vercel deploys blocked unless commit author's GitHub is linked to the Vercel account.
- Cloudflare tunnel route: trailing space in URL field = "invalid port"; leftover DNS
  record = "record already exists" (delete in DNS → Records).
- Never create box scripts via SSH heredocs (escaping corrupts them) — always scp the
  repo copies; strip CRLF (`sed -i 's/\r$//'`).
- AVTR-1 license: renderer/streamer = PolyForm Noncommercial → email hello@avaturn.me
  for commercial license BEFORE charging customers (also swap InsightFace→MediaPipe).
- Video element: route audio through WebAudio GainNode (volume boost) and handle
  autoplay-block with a "tap to enable sound" button (already in the ported UI).
- GPU idle watchdog auto-stops the box after ~8 idle minutes (saves credit); the
  Usage tab's Turn ON button (or any instance start) brings it back, same URL.

## 7. Credentials map (DO NOT commit values)
All in `C:\Users\User\Documents\vast.txt`: Vast API key, HF token, OpenRouter key+model,
Cloudflare TURN key id+token, MiniMax key, Cloudflare tunnel token. Current pilot GPU:
Vast instance 40601765 (Taiwan 4090, ssh2.vast.ai:11764, key ~/.ssh/vast_avtr),
backend https://live.peningcast.com.
