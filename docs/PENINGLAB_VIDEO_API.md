# PeningLab Generate-Video API — Developer Documentation

> Everything an AI/developer needs to build a **Custom GPT** (or any client)
> that generates videos on PeningLab. Self-contained — no codebase access
> required.

---

## 1. What this API does

PeningLab exposes a small REST API that lets an external app:

1. **Authenticate a client** (by email + password) and get their API key.
2. **Start a video generation** job (Veo / GeminiOmni / Grok / Seedance / Sora 2).
3. **Poll** the job until the video is ready and get the final `output_url`.
4. (Bonus) Generate **images**, check **balance**, list **models**.

**Video generation is asynchronous.** `generate/video` returns a `task_id`
immediately (the video is NOT ready yet). You must poll `status/{task_id}`
every ~30 seconds until `status` becomes `done` (typically 1–5 minutes).

**Base URL:** `https://peninglab.com`

Every generation **bills credits** to the account that owns the key/session.

---

## 2. Authentication — two modes

### Mode A — Per-client login (recommended for a multi-client GPT)
The GPT asks each client for their PeningLab **email + password**, calls
`POST /api/mcp/login`, and receives that client's **`api_key`**. The key is
then passed as a **parameter** (`api_key` in the JSON body for POST, or
`?api_key=` in the query for GET). Each client's generations bill **their
own** account.

- GPT Action **Authentication type = None** (the key travels in params).
- Requires the client's account to be on an **active Pro or Premium plan**.

### Mode B — Static key (single account / server-to-server)
Mint one key for one account and send it as a header on every call:

```
Authorization: Bearer pl_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- All calls bill that one account.
- Works on every endpoint below (header wins if both header + param given).

Key format: `pl_live_` + 32 hex chars. Only the account owner can mint keys
(dashboard) or receive one via `/api/mcp/login`.

---

## 3. Endpoints

### 3.1 `POST /api/mcp/login`  — verify client, return their key
**Body**
```json
{ "email": "client@example.com", "password": "theirPassword" }
```
**200**
```json
{ "ok": true, "api_key": "pl_live_....", "email": "client@example.com", "balance": 56.5, "plan": "pro" }
```
**Errors**: `400` email/password missing · `401` invalid credentials ·
`403` account not on an active Pro/Premium plan.

> Each successful login mints a fresh key and revokes the previous "Custom
> GPT" key for that user (one active key per client). Password verification
> is delegated to the auth provider (rate-limited). Always HTTPS.

---

### 3.1b `POST /api/mcp/upload`  — get a permanent public URL for an image  ⚠️ REQUIRED for image inputs
`generateVideo` will NOT accept a raw ChatGPT file, a base64 blob, or an
unhosted/login-protected link. Always convert the image to a fetchable URL
here first, then pass it in `generateVideo.image_urls`.

**Auth:** `api_key` in body **or** `Authorization: Bearer` header.

**PRIMARY (Custom GPT) — `openaiFileIdRefs` (zero-touch, native):**
A Custom GPT Action **cannot** read raw image bytes, but it CAN attach files
via the special **`openaiFileIdRefs`** parameter. ChatGPT injects a
**5-minute public `download_link`** for each image the user uploaded **or the
GPT generated** (e.g. a storyboard). Our endpoint fetches those links within
the 5 minutes and rehosts to permanent storage — no pasting, native quality.
```json
{
  "api_key": "pl_live_....",
  "openaiFileIdRefs": [
    { "name": "storyboard.png", "download_link": "https://files.oaiusercontent.com/...(5-min)" }
  ]
}
```
> Declare `openaiFileIdRefs` in the Action schema (see §6) — ChatGPT fills it
> automatically from the attached/generated image. Nothing to host, nothing
> to paste.

**FALLBACK — `image_url` (if the client pastes a public link):**
```json
{ "api_key": "pl_live_....", "image_url": "https://client-site.com/product.jpg" }
```

**Server-to-server only — `image_base64`** (NOT usable from a ChatGPT Action,
since the model can't access file bytes; for scripts holding the file):
```json
{ "api_key": "pl_live_....", "image_base64": "data:image/png;base64,iVBORw0..." }
```

**200**
```json
{ "ok": true, "url": "https://.../mcp-uploads/.../abc.jpg", "urls": ["https://.../abc.jpg"] }
```
`url` = first uploaded; `urls` = all (openaiFileIdRefs can carry several).
Use them in `generateVideo.image_urls`. Max 15 MB each · up to 4 refs.
Errors: `400` no input · `413` too large · `502` source fetch failed.

---

### 3.2 `POST /api/mcp/generate/video`  — start a video job
**Auth:** `api_key` in body **or** `Authorization: Bearer` header.

**Body**
```json
{
  "api_key": "pl_live_....",         // omit if using Bearer header
  "prompt": "A Malay woman holding a skincare bottle, talking to camera, cozy bedroom",
  "model": "gemini",                  // veo | gemini | grok | seedance | sora2
  "image_urls": ["https://.../frame.jpg"],  // optional, public https URLs
  "image_mode": "frame",              // text | frame | ingredient (default text)
  "aspect_ratio": "9:16",             // default 9:16
  "duration": 10,                     // optional, per-model rules (see §4)
  "resolution": "1080p"               // optional: 480p | 720p | 1080p
}
```
**200**
```json
{ "ok": true, "task_id": "uuid", "estimated_cost": 0.5, "model": "gemini", "duration": 10 }
```
**Errors**: `400` prompt missing · `401` bad key · `402` insufficient
credits · `403` plan gate.

> `task_id` is what you poll next. The video is NOT in this response.

---

### 3.3 `GET /api/mcp/status/{task_id}`  — poll a job
**Auth:** `?api_key=` query **or** `Authorization: Bearer` header.

`GET /api/mcp/status/{task_id}?api_key=pl_live_....`

**200 — still rendering**
```json
{ "ok": true, "status": "pending", "task_id": "uuid", "balance": 56.0 }
```
**200 — done**
```json
{
  "ok": true, "status": "done", "task_id": "uuid",
  "output_url": "https://.../video.mp4",
  "cost": 0.5, "balance": 55.5, "duration_sec": 10,
  "model": "google/gemini-omni", "provider": "crun", "slot": "p2-a"
}
```
**200 — failed**
```json
{ "ok": true, "status": "failed", "task_id": "uuid", "error": "…", "balance": 56.0 }
```
Poll every ~30s. `status` is one of `pending` | `done` | `failed`.
`404` if the `task_id` doesn't belong to the key's account.

---

### 3.4 `POST /api/mcp/generate/image`  *(bonus)*
**Body**: `{ api_key?, prompt, model, image_urls?, aspect_ratio? }`
`model`: `nano-banana-pro` | `gpt-image-2`. Same async pattern → poll
`status/{task_id}`. (Header-auth today; body `api_key` supported on video +
status. If you need body-auth on image too, request it.)

### 3.5 `GET /api/mcp/models`  — list models + constraints (header auth)
Returns each model's `rate`, `unit`, and machine-readable `constraints`
(duration/image limits/modes/aspect-ratios/resolutions). Call this first if
you want to validate inputs dynamically.

### 3.6 `GET /api/mcp/balance`  — credit balance (header auth)
### 3.7 `GET /api/mcp/auth-check`  — validate a key (header auth)
Returns `{ ok, email, balance, plan }` — handy to confirm setup.

---

## 4. Video models & rules

| model      | duration                    | resolution | notes |
|------------|-----------------------------|------------|-------|
| `veo`      | **8s** (fixed)              | 720p       | Veo 3.1 Fast. Modes: text/frame/ingredient (≤3 imgs). |
| `gemini`   | **10s** (fixed)             | 1080p      | GeminiOmni. References/frame; **max 2 images**. Most stable default. |
| `grok`     | 6–30s (default 6)           | 720p       | Grok Imagine 1.5 — **requires an image** (frame). |
| `seedance` | 4–15s (default 5)           | 720p/480p  | Seedance 2.0. Up to ~5 refs. |
| `sora2`    | 8 or 12s                    | 720p       | May be disabled server-side. |

`aspect_ratio`: `9:16` (default, vertical/TikTok) · `16:9` · `1:1`.
`image_mode`: `text` (no image) · `frame` (start frame) · `ingredient` (refs).

**Recommended default:** `model: "gemini"` (fixed 10s, 1080p) or `"veo"`
(8s) for the most reliable output. `grok` needs an image.

---

## 5. Full flow (per-client GPT)

```
1. login(email, password)                         -> api_key
2. IF there's an image (client upload OR a GPT-generated storyboard):
     uploadImage(api_key, openaiFileIdRefs:<attached image>) -> url   (ChatGPT auto-attaches; zero-touch. Fallback: image_url if they paste a link.)
3. generateVideo(api_key, prompt, model, image_urls:[url]) -> task_id
4. loop: getVideoStatus(task_id, api_key)
        status == "pending" -> wait ~30s, repeat
        status == "done"    -> return output_url
        status == "failed"  -> show error
```

---

## 6. OpenAPI 3.1 schema (paste into Custom GPT → Actions → Schema)

Set the GPT Action **Authentication = None** (key travels as a parameter).

```yaml
openapi: 3.1.0
info: { title: PeningLab Video API, version: "1.0.0" }
servers: [{ url: https://peninglab.com }]
paths:
  /api/mcp/login:
    post:
      operationId: login
      summary: Verify a client's PeningLab email + password; returns their api_key.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email: { type: string }
                password: { type: string }
      responses:
        "200":
          description: Authenticated.
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok: { type: boolean }
                  api_key: { type: string }
                  balance: { type: number }
                  plan: { type: string }
  /api/mcp/upload:
    post:
      operationId: uploadImage
      summary: Convert an attached/generated image (openaiFileIdRefs) or a link into a public URL for generateVideo.image_urls.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [api_key]
              properties:
                api_key: { type: string }
                openaiFileIdRefs:
                  type: array
                  description: PRIMARY. ChatGPT auto-fills this with the attached/generated image(s); each item carries a 5-min download_link we fetch.
                  items:
                    type: string
                image_url: { type: string, description: Fallback — rehost an existing public link. }
      responses:
        "200":
          description: Uploaded.
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok: { type: boolean }
                  url: { type: string, description: Use this in generateVideo.image_urls. }
  /api/mcp/generate/video:
    post:
      operationId: generateVideo
      summary: Start a video job on the client's account. Returns task_id.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [api_key, prompt, model]
              properties:
                api_key: { type: string }
                prompt: { type: string }
                model: { type: string, enum: [veo, gemini, grok, seedance, sora2] }
                image_urls: { type: array, items: { type: string } }
                image_mode: { type: string, enum: [text, frame, ingredient], default: text }
                aspect_ratio: { type: string, default: "9:16" }
                duration: { type: integer }
      responses:
        "200":
          description: Job accepted.
          content:
            application/json:
              schema:
                type: object
                properties:
                  ok: { type: boolean }
                  task_id: { type: string }
                  estimated_cost: { type: number }
  /api/mcp/status/{task_id}:
    get:
      operationId: getVideoStatus
      summary: Poll a video job. When status is done, output_url is the video.
      parameters:
        - { name: task_id, in: path, required: true, schema: { type: string } }
        - { name: api_key, in: query, required: true, schema: { type: string } }
      responses:
        "200":
          description: Job state.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status: { type: string, enum: [pending, done, failed] }
                  output_url: { type: string }
                  error: { type: string }
                  balance: { type: number }
```

---

## 7. GPT builder — instructions to paste

> You generate videos via the PeningLab API. First ask the client for their
> **PeningLab email and password** (once per conversation). Call **login**;
> if it fails, tell them to check their credentials or that they need an
> active **Pro/Premium** plan. Keep the returned **api_key** private (never
> show it). To make a video: call **generateVideo** with `api_key`, the
> `prompt`, and a `model` (default `"gemini"`; use `"veo"` for 8s;
> `"grok"` needs an image in `image_urls` with `image_mode:"frame"`). You
> If there is an **image** — one the client uploaded OR a storyboard YOU
> generated — call **uploadImage** and let ChatGPT attach it via
> `openaiFileIdRefs` (this happens automatically; do not ask the client to
> host or paste anything). Use the returned `url` in
> `generateVideo.image_urls`. If the attachment doesn't come through, ask
> the client for a public image link and pass it as `image_url` instead.
> Never pass a raw ChatGPT file straight into generateVideo. You
> receive a `task_id`. Then poll **getVideoStatus** with that `task_id` and
> the `api_key` every ~30 seconds until `status` is `done`, then give the
> client the `output_url`. If `status` is `failed`, show the `error`. Videos
> take 1–5 minutes — tell the client to wait.

---

## 8. Errors & handling

| HTTP | meaning | what the GPT should do |
|------|---------|------------------------|
| 400  | missing field (prompt/email/password) | ask for the missing input |
| 401  | invalid key / invalid credentials | re-login |
| 402  | insufficient credits | tell client to top up at peninglab.com |
| 403  | not Pro/Premium (active) | tell client to upgrade |
| 404  | task not found / not theirs | re-check task_id |
| 5xx  | transient server/provider issue | wait + retry the poll |

A `status:"failed"` result is a per-job failure (bad prompt / provider
issue). PeningLab auto-retries most *transient* provider failures
server-side, so a poll may go `failed`→`pending`→`done` on its own; if it
stays `failed`, surface the `error` and let the client edit the prompt.

---

## 9. Notes & constraints

- **Async only** — never expect the video in the `generateVideo` response.
- **Polling** — ~30s interval; total wait 1–5 min. Custom GPT Actions may
  time out on a single call, but each poll is a fresh short call, so keep
  polling.
- **Credits** — each generation deducts on success; `balance` is returned in
  status/login responses so you can warn on low funds.
- **Plan gate** — API access requires an **active Pro or Premium** account.
- **Security** — in per-client mode the client's password passes through the
  GPT platform to `/api/mcp/login` over HTTPS; inform clients. Consider
  Mode B (static key) if you don't want to handle client passwords.
- **Image URLs** must be **public https** URLs the server can fetch.
