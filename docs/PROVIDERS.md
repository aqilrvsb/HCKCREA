# Generation Providers — Knowledge Reference

Single source of truth for every upstream AI provider this platform routes to.
When you're debugging cascade behavior, polling failures, or task-id formats —
start here.

Updated through migration 0036 (slot rotation cascade).

---

## Cascade architecture

Image generation and video generation each route through a 3-slot cascade
configured by admin in `/admin/settings`.

- **Slot config:** `app_settings.video_cascade_slots` / `image_cascade_slots`
  hold `{ slots: ["slot1", "slot2", "slot3"] }`.
- **Round-robin start:** Postgres sequences `video_cascade_rotation` /
  `image_cascade_rotation` are bumped by `next_cascade_slot(asset)` RPC
  on every task submit. Atomic, race-free.
- **Walk:** start at rotated slot, walk through all 3 cyclically, then
  retry the starting slot once. 4 attempts total. See
  `lib/cascade-rotation.ts:walkOrder`.
- **Polling provider:** the slot that accepts the task stamps
  `metadata.provider = "p1" | "p2" | "p4" | "p5"` (slots `p2-a` + `p2-b`
  both poll as `p2`). `settleHistoryRow` reads this to pick the correct
  status endpoint.

**Available slot identifiers:**

| Slot | Provider | Asset support |
|---|---|---|
| `p1` | GeminiGen (Google direct) | image + video |
| `p2-a` | Crun.ai, account A (default key) | image + video |
| `p2-b` | Crun.ai, account B (fallback key) | image + video |
| `p4` | Grsai | **image only** |
| `p5` | APIMart | image + video |

`p3` (Mountsea) is still in the codebase (`lib/p3.ts`) for legacy rows but
is **NOT a slot option** in the current cascade. Existing rows with
`metadata.provider = "p3"` continue to poll correctly via `p3GetStatus`.

---

## P1 — GeminiGen

Google direct via geminigen.ai. Most lenient content filter, most reliable
uptime. Default base `https://api.geminigen.ai`.

- **Client:** `lib/p1.ts`
- **Settings:** `getP1Config()` reads `p1_base`, `p1_key`, `p1_veo_path`,
  `p1_grok_path`, `p1_image_path`, `p1_seedance_path`, `p1_status_path`
- **Auth:** `Authorization: Bearer <p1_key>`
- **Submit endpoints** (all paths admin-tunable via settings):
  - Image: `POST /uapi/v1/generate_image`
  - Veo video: `POST /uapi/v1/video-gen/veo`
  - Grok video: `POST /uapi/v1/video-gen/grok`
  - Seedance: `POST /uapi/v1/video-gen/seedance`
- **Poll:** `GET /uapi/v1/history/{uuid}` (template via `p1_status_path`)
- **Webhook receiver:** `app/api/callback/p1/route.ts`
- **Status values:** `pending` | `running` | `succeeded` | `failed`
- **Output URL location:** flat in response (mapped by `p1GetStatus`)

## P2 — Crun.ai

Multi-model gateway. Used for Veo, Grok, Seedance, and Nano Banana family.
Two API keys supported (account A + B) — same endpoint, different
credentials, used for cross-account rate-limit bypass.

- **Client:** `lib/p2.ts`
- **Settings:** `getP2Config()` reads `p2_base`, `p2_key`, `p2_key_b`,
  `p2_create_path`, `p2_status_path`, `p2_model_*`
- **Auth:** `Authorization: Bearer <p2_key>` (or `p2_key_b` via
  `apiKeyOverride`)
- **Submit:** `POST {base}{create_path}` (default
  `https://crun.ai/api/v1/client/job/CreateTask`)
- **Poll:** `POST {base}{status_path}` (default
  `https://crun.ai/api/v1/client/job/TaskInfo`)
- **Webhook receiver:** `app/api/callback/p2/route.ts`
- **Status values:** `submitted` | `running` | `succeeded` | `failed`
- **Output URL location:** `data.result.output_url` (varies by model;
  `p2GetStatus` normalizes)

**Slot keying:** the cascade differentiates `p2-a` and `p2-b` only at
submit-time via `apiKeyOverride`. After submit, both fall under
`metadata.provider = "p2"` because the polling endpoint is identical.

## P3 — Mountsea (legacy)

`api.mountsea.ai`. Image (Gemini nano-banana) + Veo + Grok.
**Not in current slot rotation** but still functional for legacy rows.

- **Client:** `lib/p3.ts`
- **Settings:** key via `process.env.MOUNTSEA_API_KEY`
- **Auth:** `Authorization: Bearer <key>`
- **Submit:**
  - Image: `POST /gemini/image/generate`
  - Video: `POST /gemini/video/generate`
  - Grok: `POST /xai/videos`
- **Poll:** `GET /gemini/task/result?taskId=<id>` (unified for all
  task types)
- **Webhook receiver:** `app/api/callback/p3/route.ts`
- **Status values:** `queued` | `processing` | `running` | `completed`
  | `failed` | `cancelled` | `timeout`
- **Output URL location:** `data.result.imageUrls[0]` (image) or
  `data.result.videoUrl` (video)

## P4 — Grsai

`grsaiapi.com` (Global). **Image only.** Cheapest Nano Banana Pro at 2K
(~3× cheaper than p2). Exclusive `nano-banana-fast` model.

- **Client:** `lib/p4.ts`
- **Settings:** `getP4Config()` reads `p4_key`, `p4_image_default`
- **Base:** `https://grsaiapi.com`
- **Auth:** `Authorization: Bearer <p4_key>` (key starts `sk-`)
- **Submit:**
  - Nano Banana family: `POST /v1/draw/nano-banana`
    - Body: `{ model, prompt, urls?: [], aspectRatio, imageSize, webHook: "-1", shutProgress: true }`
    - `model` ∈ `nano-banana | nano-banana-2 | nano-banana-fast | nano-banana-pro | ...`
    - `webHook: "-1"` is the special "return id immediately, I'll poll" mode
  - GPT Image 2: `POST /v1/draw/completions`
    - Body: `{ model: "gpt-image-2", prompt, aspectRatio (pixel string), quality, urls?: [] }`
- **Poll:** `POST /v1/draw/result` with body `{ id: "<task_id>" }`
- **Webhook receiver:** `app/api/callback/p4/route.ts`
- **Status values:** `running` | `succeeded` | `failed`
- **Output URL location:** `data.result.results[0].url` (under `data` or
  top-level depending on whether response came from poll vs stream/webhook;
  `p4GetStatus` handles both)
- **Failure reason field:** `data.failure_reason` ∈ `output_moderation`
  | `input_moderation` | `error`. Grsai's docs say `"error"` is transient —
  resubmit retries succeed.
- **Pricing reference (image, at $1 = 133.2k credits with +100% gift):**
  - nano-banana-fast: $0.003/img
  - nano-banana-2: $0.009/img
  - nano-banana-pro: $0.014/img

## P5 — APIMart

`api.apimart.ai`. OpenAI-compatible gateway. **Image + video.** Cheapest
Veo 3.1 Fast we found ($0.08/gen flat). Same endpoint accepts gpt-image-2
and the full Gemini image family.

- **Client:** `lib/p5.ts`
- **Settings:** `getP5Config()` reads `p5_key`, `p5_image_default`,
  `p5_video_default`
- **Base:** `https://api.apimart.ai`
- **Auth:** `Authorization: Bearer <p5_key>` (key starts `sk-`)
- **Submit:**
  - Image: `POST /v1/images/generations`
    - Body: `{ model, prompt, size, n: 1, image_urls?: [] }`
    - `model` ∈ `gpt-image-2 | gemini-3-pro-image-preview |
      gemini-3.1-flash-image-preview | gemini-2.5-flash-image-preview`
    - `size` ∈ `1:1 | 2:3 | 3:2` (APIMart's documented enum; cascade maps
      9:16 → 2:3, 16:9 → 3:2)
    - Max 5 reference images, 10MB each
  - Video: `POST /v1/videos/generations`
    - Body: `{ model, prompt, duration, aspect_ratio, image_urls?: [],
      generation_type?: "frame" | "reference", resolution?: "720p" | "1080p" | "4k" }`
    - `model` ∈ `veo3.1-fast | veo3.1-quality | veo3.1-lite |
      grok-imagine-1.0-video-apimart`
    - Veo 3.1 duration fixed at 8s. Grok per-second-billed.
    - Max 3 reference images for `reference` generation_type
- **Poll:** `GET /v1/tasks/{task_id}?language=en`
- **Webhook receiver:** `app/api/callback/p5/route.ts`
- **Status values:** `pending` | `processing` | `completed` | `failed` | `cancelled`
- **Output URL location:**
  - Images: `data.result.images[0].url[0]` (URL is nested in array)
  - Videos: `data.result.videos[0].url[0]` (same nesting)
  - Thumbnail: `data.result.thumbnail_url`
  - `p5GetStatus` defensively unwraps to a single string
- **Error message field:** `data.error.message`
- **Pricing reference:**
  - gpt-image-2: $0.006/pic
  - gemini-2.5-flash-image-preview: $0.013/pic
  - gemini-3.1-flash-image-preview: $0.030/pic (Banana 2)
  - gemini-3-pro-image-preview: $0.040/pic (Banana Pro)
  - veo3.1-fast: $0.080/gen (per video, flat)
  - grok-imagine-1.0-video-apimart: $0.007/sec

---

## Status normalization

All `pXGetStatus` clients return the same shape so `settleHistoryRow`
doesn't need provider-specific branching for state:

```ts
type Result = {
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};
```

Mapping table:

| Provider | Pending | Running | Success | Failed |
|---|---|---|---|---|
| p1 | `pending` | `running` | `succeeded` | `failed` |
| p2 | `submitted` | `running` | `succeeded` | `failed` |
| p3 | `queued`, `processing`, `running` | _(merged with pending)_ | `completed` | `failed`, `cancelled`, `timeout` |
| p4 | _(no explicit pending)_ | `running` | `succeeded` | `failed` |
| p5 | `pending` | `processing` | `completed` | `failed`, `cancelled` |

---

## How a task moves through the system

```
User clicks Generate
  │
  ▼
Entry route (e.g. /api/generate/image)
  │  • inserts placeholder history row (status=pending)
  │  • calls generateImageWithCascade(...)
  │
  ▼
Image cascade (lib/image-cascade.ts)
  │  • getImageSlots() ← admin-configured
  │  • nextStartSlot("image") ← Postgres seq, atomic
  │  • walkOrder(slots, start) ← 4-attempt list
  │  • for each slot: tryImageSlot → p2/p4/p5/p1.create*
  │  • returns { taskId, actualProvider, tierLog }
  │
  ▼
Entry route stamps history row:
  • task_id = <upstream id>
  • metadata.provider = actualProvider  (used by settle.ts)
  • metadata.tier_log  = [...]
  │
  ▼
Polling (3 paths, all converge on settleHistoryRow):
  • Auto-poll cron: /api/worker/poll-pending (every ~60s)
  • Manual check icon: /api/generate/status?id=...
  • Webhook (if upstream supports): /api/callback/p<N>
  │
  ▼
settleHistoryRow(hist) — lib/settle.ts
  • reads hist.metadata.provider → picks pXGetStatus
  • if succeeded: uploads outputUrl to Backblaze B2, marks done, deducts credit
  • if failed: marks failed, may auto-retry up to N times via image-cascade
    again (with skipSlot to avoid re-firing the broken slot)
```

---

## Adding a new provider (e.g. pN)

1. Build `lib/pN.ts` with `pNCreate*` + `pNGetStatus` matching the same
   `{ status, outputUrl, error, raw }` shape.
2. Add `getPNConfig()` to `lib/settings.ts`.
3. Wire into `lib/cascade-rotation.ts`:
   - Add to `SlotProvider` union.
   - Add to `slotToProvider()` mapping.
   - Update `sanitizeSlots` allow-lists for video/image as appropriate.
4. Wire into `lib/image-cascade.ts:tryImageSlot` and/or
   `lib/video-cascade.ts:tryVideoSlot`.
5. Wire into `lib/settle.ts:rowProvider` switch + the import.
6. Wire into inline pollers: `app/api/generate/viral/talking-object/route.ts`
   + `lib/refine-frame.ts`.
7. Add `app/api/callback/pN/route.ts` (copy from p4/p5).
8. Add `pN_key` row to `app_settings` (migration or admin UI paste).
9. Add `pN` option to admin UI slot dropdowns.

That's the whole checklist. Anything missed → `settle.ts` errors with
"unknown provider" on poll.
