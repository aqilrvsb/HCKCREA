# Livehost — Complete A-Z Documentation (PeningLab "Live" package)

> THE reference for everything Livehost. Status: **integrated and deployed on
> peninglab.com**. Last major update: 2026-06-13 (Novita migration + session billing).
> Source studio app (reference/lab): github.com/aqilrvsb/talking-head-live
> GPU ops runbook for provisioning: that repo's CLIENT-SETUP.md.

## 1. What Livehost is

AI avatar that hosts TikTok Live 24/7 — replaces a human live host.
Sales story: human host mahal (RM3–5k/mo), 4–6 jam max, tak konsisten, kena train;
Livehost: fixed monthly, nonstop, ikut script, jawab chat customer dari product
knowledge, suara Malay natural, tukar avatar/template bila-bila.

## 2. Architecture (per client — 1 GPU = 1 client)

```
PeningLab dashboard (Livehost tabs) ──WebRTC (Cloudflare TURN)──► client's GPU (Novita SGP)
   studio UI + billing                                              AVTR-1 renderer+streamer
   control datachannel: say/ask/kb/cfg/interrupt                    + MiniMax TTS + OpenRouter
   per-client URL: clientN.peningcast.com (Cloudflare named tunnel, token lives on GPU)
```

- **GPU provider: Novita.ai** (migrated from Vast 2026-06-13). Cluster `as-sgp-2`
  (Singapore), product `4090.16c62g` = RTX 4090 @ **$0.35/hr**, billed per second,
  $0 GPU while stopped, disk $0.10/GB/mo with first 60GB free.
  API: `https://api.novita.ai/gpu-instance/openapi/v1/...`, key in app_settings
  reference + local vast.txt (`novita` line). Instances created with
  `nvidia/cuda:12.8.1-cudnn-runtime-ubuntu24.04` + sshd via `command`.
- Engine keys (MiniMax/OpenRouter/TURN/tunnel token) live ON the GPU box
  (`/workspace/turn.env`), never in PeningLab DB or browser.
- ONE peningcast.com domain serves all clients via subdomains (free, unlimited).

## 3. What exists in this repo (all deployed)

### Client-facing (LivehostDashboard — users with plan `livehost`)
- `app/dashboard/livehost-dashboard.tsx` — sidebar: Dashboard, **Livehost, Scripts,
  Products, Usage**, Billing. Studio is ALWAYS mounted (hidden when other views) so
  the WebRTC stream survives navigation. Studio views get edge-to-edge layout (p-2).
- `app/dashboard/livehost-studio.tsx` — the entire studio (CSS scoped `.lh-studio`):
  - **Livehost view**: 9:16 stage (drag/zoom/XY position, fullscreen ⛶, overlay
    templates), Rundown (script play order, ↑↓/✕, 🔁 Loop, ⏸ Pause/▶ Resume,
    ⟳ Restart), karaoke teleprompter (line + word-level sweep timed by real audio
    durations), avatar picker (18 stock Malaysian hosts + own-photo upload →
    face-detect register), voice picker (6 Malay voices) + Volume (WebAudio gain
    0–300%) + Speed (0.7–1.5×, live), customer chat (barge-in → grounded answer →
    auto-resume), Start/Stop.
  - **Scripts view**: unlimited titled scripts; edits apply live to unspoken parts.
  - **Products view**: knowledge base grounding chat answers (kb pushed live).
  - **Usage view**: month total + 50-session table (see §5) + GPU power buttons.
- Assets: `public/avatars/` (18 stock + manifest), `public/overlays/` (25 + manifest).

### APIs
| Route | Purpose |
|---|---|
| `GET /api/livehost/config` | logged-in client's `backend_url` (+hasGpu) from live_client_config |
| `POST /api/livehost/gpu` | start/stop/status of the client's GPU (key: app_settings `vast_api_key` for Vast legacy — **TODO switch to Novita API** when provisioning automation lands; instance id per client) |
| `POST/GET /api/livehost/session` | session metering: start/heartbeat/stop + usage GET (rates, sessions, month totals) |
| `GET/POST /api/admin/livehost` | admin: list livehost clients + upsert per-client config; POST `{rates}` updates global price rates |

### Admin (`/admin/livehost`, nav item "Livehost")
- **Client price rates (global)**: GPU RM/hour + Voice RM/1,000 chars — what clients
  are billed/shown in Usage. Cost basis: GPU ~RM1.65/hr (Novita $0.35), voice
  ~RM0.14/1k (MiniMax bills per character — `usage_characters` in every TTS response).
  Defaults seeded: RM6.00/hr + RM0.30/1k.
- **Per-client config**: `backend_url` (GPU tunnel URL) + `vast_instance_id`
  (provider instance id) + notes. This is ALL a client needs to stream.

### DB (Supabase project zoxgcqlqovkvlrmpcikt, all RLS service-role-only)
```sql
live_client_config(user_id pk → auth.users, backend_url, vast_instance_id, notes, updated_at)
live_sessions(id pk, user_id, started_at, last_seen, ended_at, voice_chars, status active|ended|crashed)
app_settings keys: vast_api_key, livehost_gpu_rate_hour, livehost_voice_rate_1k (category 'livehost')
plans.ts: livehost { price: 500, days: 30, credits: 0 }
```

## 4. The GPU backend (built/maintained outside this repo)

Each client GPU runs AVTR-1 (github.com/avaturn-live/avtr-1) + our modifications
(vendored in talking-head-live repo `backend/`):
- MiniMax+OpenRouter conversation engine (say-queue, gapless 12–15-word chunks,
  silence trimming, barge-in), control datachannel, CORS, /register-avatar,
  /active, /gpu-usage, 1080×1920@25fps NVENC.
- HTTP endpoints the studio calls: `/avatars`, `/register-avatar`, `/ice-servers`,
  `/offer`, `/active`, `/gpu-usage`.
- Datachannel protocol: browser→GPU `{kind:"say"|"ask",text,id}`, `{kind:"kb"|"cfg",text}`,
  `{kind:"interrupt"}`; GPU→browser `{kind:"say_done",duration,id,chars}` (chars =
  EXACT MiniMax billed characters → drives voice billing), `{kind:"line",...}`.
- Box scripts: `/workspace/boot.sh` (streamer+tunnel+watchdog tmux), auto-run at
  every instance start via `/root/onstart.sh`.

## 4b. AI chat model (admin-configurable cascade)

- Admin sets the chat-answer LLM at **/admin/livehost → "AI Livehost — chat model"**:
  Main + Fallback, provider (grsai | openrouter) + model. Stored in
  app_settings `livehost_llm` (same schema as Clone model; parsed by
  `parseModelSetting`, creds via `providerCreds` — or_key / p4_key).
- Delivery: GPU boxes call `GET /api/livehost/engine-config` with header
  `x-box-secret` = app_settings `livehost_box_secret` → resolved
  `{base, key, model}` slots. Keys never touch a browser. Box env needs
  `LIVEHOST_CONFIG_URL` + `LIVEHOST_BOX_SECRET` in `/workspace/turn.env`;
  engine caches 2 min, tries main → fallback → env OPENROUTER_* as last resort.
- Box-side patch required after AVTR-1 build: `event_bus.py ready_timeout
  5.0 → 30.0` (slow ICE connects otherwise crash sessions with
  "EventBus.publish() timed out").

## 5. Billing & metering (how money is tracked)

- **Source of truth = `live_sessions`** (server-side, not browser):
  - Start pressed → row inserted (exact second). Heartbeat every 30s updates
    `last_seen` + cumulative `voice_chars` (from say_done `chars`).
  - Stop pressed / tab closed (sendBeacon) → `ended_at` exact second, status `ended`.
  - **Crash**: no heartbeat for >2 min → session closed AT `last_seen`, status
    `crashed` (lazy-closed on next start/usage read). No second is unbilled/overbilled.
- **Client cost = duration × admin GPU rate + voice_chars × admin voice rate.**
  Rates are dynamic (admin changes apply immediately; historical sessions are
  recomputed at current rates — change rates at month boundaries if that matters).
- Usage tab shows: month total (combined), rate disclosure, per-session table
  (date/time to the second, duration, GPU/voice/total RM, LIVE/ended/crashed badge).

## 6. Provisioning a new client (manual today → auto soon)

Manual (today, ~60–90 min — see talking-head-live/CLIENT-SETUP.md):
1. Novita API: create instance (SGP 4090, 120GB, cuda image + sshd command).
2. SSH: build AVTR-1 (pixi → download artifacts w/ HF token → build-trt-engines),
   scp the 9 modified files + box scripts from talking-head-live/backend/, write
   turn.env (MiniMax/OpenRouter/TURN keys + VAST/NOVITA key for watchdog), register
   18 stock avatars, install /root/onstart.sh → boot.sh.
3. Cloudflare: new tunnel (Zero Trust → Networks → Connectors) → token to box →
   route clientN.peningcast.com → localhost:8000.
4. Admin → Livehost: paste backend_url + instance id. Client can stream.

**Auto-provisioning (the target, build next):** payment webhook →
(a) Novita create-instance from prebaked template/image (~5 min),
(b) Cloudflare API create tunnel + DNS (needs CF API token with Tunnel+DNS edit),
(c) insert live_client_config row. Blockers: bake the template (golden image from
the SGP box once verified; investigate Novita instance→image snapshot or
registry image + Image Prewarm), and decide destroy-on-sleep (client stops →
destroy instance = RM0 idle; custom avatars persisted to B2 and re-registered at boot).

## 7. Unit economics (for pricing decisions)

| Item | Your cost | Suggested client rate |
|---|---|---|
| GPU streaming | RM1.65/hr (Novita $0.35) | RM6/hr (default seeded) |
| Voice | ~RM0.14/1k chars | RM0.30/1k (default seeded) |
| Sleeping instance | ~RM23/mo (110GB − 60GB free × $0.10) → RM0 after trim/destroy-on-sleep | included in base package |
| Tunnels/subdomains/TURN(1TB)/Vercel/Supabase | RM0 | — |

NEVER sell unlimited flat-rate: 24/7 streamer costs ~RM1,180/mo GPU. Use base
package + included hours + per-hour overage, or pure per-hour.

## 8. Gotchas (hard-won)

- MiniMax API spends platform.minimax.io console "Credit Balance" (top-up), NOT
  audio-app subscriptions. Bills per character (`usage_characters`).
- MiniMax caps ~5000 chars/request → never send whole scripts (chunking handles it).
- Novita API is behind Cloudflare bot protection → use curl-like clients, not
  python-urllib (403 error 1010).
- Vast (legacy): stopped instance can FAIL to restart ("resources_unavailable,
  state change queued") if host GPU taken — the reason we migrated to Novita.
  Old Vast instance 40601765 may still exist; destroy once Novita verified
  (its onstart would fight for the live.peningcast.com tunnel token).
- Cloudflare tunnel route: trailing space = "invalid port"; leftover DNS record =
  "record already exists" (delete in DNS → Records first).
- Never create box scripts via SSH heredocs (escaping corrupts) — scp from repo,
  then `sed -i 's/\r$//'` (Windows CRLF).
- Vercel blocks deploys if commit author's GitHub isn't linked to the Vercel account.
- AVTR-1 license: renderer/streamer PolyForm NONCOMMERCIAL → must email
  hello@avaturn.me for commercial license BEFORE charging customers (and swap
  InsightFace → MediaPipe).
- `keepDataDay`/`releaseDataAt` fields exist on Novita instances — verify stopped-
  instance data retention before relying on long sleeps.

## 9. Credentials map (NEVER commit values)

`C:\Users\User\Documents\vast.txt`: Vast key (64-hex), HF token (hf_), OpenRouter
(sk-or-) + model, Cloudflare TURN key id+token, MiniMax (sk-api-), Cloudflare
tunnel token (eyJ…, label cftunnel), Novita (sk_…, label novita Ai).
Pilot client: meow@gmail.com / live.peningcast.com / (instance id in admin).
Current GPU: Novita instance b8f3a01378654e93, as-sgp-2, hostlive-sgp-1,
ssh proxy.as-sgp-2.gpu-instance.novita.ai:39655 (key ~/.ssh/vast_avtr).
