# Peninglab MCP — Design Spec

**Goal:** Build a public npm package `@peninglab/mcp` that exposes peninglab.com's image and video generation as MCP tools. AI agents and other projects can install the package, authenticate with a private API key, and trigger any admin-configured generation model. The MCP tool internally polls peninglab.com every 60s and returns the final URL synchronously to the AI agent — no webhook infrastructure required on the consumer side. Latest credit balance returned with every successful call.

**Out of scope (V1):**
- Auto Content batch generation (defer to V2 — adds multi-row + framework dispatcher complexity)
- Storytelling pipeline
- Clone Prompt generation
- Streaming progress updates (just initial submit + final result)
- Multi-user API keys (single shared key for now; user owns the key)
- Public OpenAPI spec / non-MCP REST consumers (focus on MCP shape only)

---

## 1. Architecture

```
[AI agent / other project]
   │  calls MCP tool: generate_video({ model, prompt, ... })
   ▼
[@peninglab/mcp npm package — stdio MCP server]
   │  reads PENINGLAB_API_KEY env var
   │  exposes tools: generate_image, generate_video, list_models,
   │                 get_balance, get_status
   │
   │  ── Step 1: submit task ──
   ▼
HTTPS POST /api/mcp/generate/video
   │  Authorization: Bearer <PENINGLAB_API_KEY>
   ▼
[peninglab.com Next.js routes /api/mcp/*]
   │  - validate API key against app_settings.mcp_api_key
   │  - dispatch to existing /api/generate/* infrastructure
   │  - stamp metadata.mcp_caller_id
   │  - returns { task_id, estimated_cost, balance_after_estimate }
   ▼
[existing cascade fires]
   │  Crun → APIMart → APIPod cascade, settle.ts, B2 upload, etc.
   │  (this proceeds asynchronously in the background)
   │
   │  ── Step 2: package polls every 60s ──
[@peninglab/mcp npm package]
   │  GET /api/mcp/status/{task_id}  ← every 60s
   │  GET /api/mcp/status/{task_id}  ← every 60s
   │  GET /api/mcp/status/{task_id}  ← status: "done" + output_url
   ▼
[MCP tool returns to AI agent]
   │  { url, cost, balance, model, duration }
   ▼
[AI agent receives final URL — synchronous from its POV]
```

The polling loop is completely internal to the npm package. The AI agent
sees a single synchronous-feeling tool call: `generate_video(...)` → returns
finished URL after the wait. No webhook infrastructure, no public URL,
nothing exotic required on the consumer side.

### Key infrastructure reuse

| Reused | Reason |
|---|---|
| Cascade pools (image / video / cinema / sora2 / gemini / grok) | MCP just selects model name; existing cascade handles routing |
| settle.ts + auto-retry + retry route | Webhook firing piggybacks on existing settle path |
| getXxxRate helpers + per-model rate settings | Model price discovery uses same source |
| Supabase `history` table | MCP rows insert here with `metadata.mcp_caller_id` tag |
| Credit deduction (lib/deduct.ts) | MCP calls deduct exactly like UI calls |
| Backblaze B2 upload + 30-day lifecycle | Output URLs are B2 URLs (same as UI surfaces) |
| Admin /admin/usage analytics | MCP rows visible there; new `MCP` tab tag for filtering |

---

## 2. Distribution

**Package:** `@peninglab/mcp` on public npm registry.

```bash
# Caller installs:
npm install -g @peninglab/mcp
# OR via npx with no install:
npx @peninglab/mcp
```

**Why public:** Package is just a thin MCP wrapper. Without the secret API key (which only the user controls), the package can't do anything. Public distribution = zero friction for the user across projects.

**Caller's MCP config (`claude_desktop_config.json` style):**

```json
{
  "mcpServers": {
    "peninglab": {
      "command": "npx",
      "args": ["@peninglab/mcp"],
      "env": {
        "PENINGLAB_API_KEY": "pl_live_..."
      }
    }
  }
}
```

---

## 3. New API endpoints

All endpoints under `/api/mcp/*`. Authentication: `Authorization: Bearer <PENINGLAB_API_KEY>` header. Returns 401 on mismatch.

### 3.1 `GET /api/mcp/auth-check`
Validates the API key. Returns the user account it's bound to.

Response:
```json
{
  "ok": true,
  "user_id": "uuid",
  "email": "aithi.cloud@gmail.com",
  "balance": 42.50,
  "plan": "founder"
}
```

### 3.2 `GET /api/mcp/models`
Lists all generation models the admin has configured with rates.

Response:
```json
{
  "ok": true,
  "models": [
    { "name": "nano-banana-pro", "type": "image", "rate": 0.20, "unit": "per_image" },
    { "name": "gpt-image-2",     "type": "image", "rate": 0.30, "unit": "per_image" },
    { "name": "veo",             "type": "video", "rate": 0.40, "unit": "per_video_8s" },
    { "name": "sora2",           "type": "video", "rate": 0.20, "unit": "per_second" },
    { "name": "gemini",          "type": "video", "rate": 1.30, "unit": "per_video_10s" },
    { "name": "seedance",        "type": "video", "rate": 0.40, "unit": "per_second" }
  ]
}
```

Reads from existing rate settings: `rate_banana_pro`, `rate_gpt_image`, `rate_veo`, `sora2_rate`, `rate_gemini`, `rate_seedance`.

### 3.3 `POST /api/mcp/generate/image`
Fires an image generation. Returns immediately with `task_id`.

Body:
```json
{
  "model": "nano-banana-pro",
  "prompt": "A glass perfume bottle on marble, soft studio light",
  "image_urls": ["https://..."],
  "aspect_ratio": "9:16",
  "callback_url": "https://my-project.com/peninglab-webhook"
}
```

- `model` required (must match a model from `/api/mcp/models`)
- `prompt` required
- `image_urls` optional (for img2img / refs)
- `aspect_ratio` optional (default `1:1`)
No `callback_url` — caller polls `/api/mcp/status/:id` (npm package does this internally, every 60s).

Response:
```json
{
  "ok": true,
  "task_id": "history-row-uuid",
  "estimated_cost": 0.20,
  "balance_after_estimate": 42.30
}
```

Server flow: reuses `/api/generate/image` logic (cascade, settle, B2 upload), stamps `metadata.mcp_caller_id = <api-key-hash>` on the history row. Credit pre-flight check fires the same as UI calls — returns 402 if balance insufficient.

### 3.4 `POST /api/mcp/generate/video`
Same shape as image but for video.

Body:
```json
{
  "model": "seedance",
  "prompt": "Drone shot over snowy mountains at sunrise",
  "image_urls": ["https://..."],
  "image_mode": "text",
  "duration": 5,
  "aspect_ratio": "16:9"
}
```

- `model` required (`veo` / `sora2` / `gemini` / `seedance` / `grok`)
- `image_mode` one of `text` / `frame` / `ingredient`
- `duration`: model-specific range validation server-side (Veo fixed 8, Sora 2 8/12, Gemini fixed 10, Seedance 4-15, Grok 6-30)

Response: same shape as image.

Server flow: dispatches to existing `/api/generate/cinema` logic with model-routed cascade. Pre-flight credit check fires the same as UI calls. Final deduction happens on settle (when status flips to done) via the existing `deduct()` helper.

### 3.5 `GET /api/mcp/status/:task_id`
Returns current status of a task. **This is the primary mechanism** — the npm package polls this every 60s until status is `done` or `failed`. Lightweight DB read; safe to hammer.

Response (still pending):
```json
{
  "ok": true,
  "status": "pending",
  "task_id": "...",
  "created_at": "2026-05-31T..."
}
```

Response (done):
```json
{
  "ok": true,
  "status": "done",
  "task_id": "...",
  "output_url": "https://peninglab-content.../...mp4",
  "cost": 0.40,
  "balance": 42.10,
  "duration_sec": 8,
  "model": "veo"
}
```

Response (failed):
```json
{
  "ok": true,
  "status": "failed",
  "task_id": "...",
  "error": "Cascade exhausted: all providers failed"
}
```

### 3.6 `GET /api/mcp/balance`
Returns current credit balance.

Response:
```json
{
  "ok": true,
  "balance": 42.10,
  "plan": "founder"
}
```

---

## 4. settle.ts — NO changes needed

Because the MCP uses polling instead of webhooks, `lib/settle.ts` is untouched. The existing settle flow already:
1. Polls the upstream provider task
2. Updates `history.status` to `done`/`failed`
3. Sets `history.output_url`
4. Deducts credits via `deduct()`
5. Auto-rehosts to Backblaze B2

The MCP npm package just calls `/api/mcp/status/:task_id` every 60s, which reads the current `history` row state. Whatever settle.ts has written by that point is what the caller gets.

**Why no patch:** simpler code surface, no webhook delivery failures, no HMAC signing complexity, no retry backoff state. The existing async cron + event-driven settle path already does everything we need — the MCP just observes.

---

## 5. API key management

### 5.1 Storage
- New `app_settings` row: `mcp_api_key` with value `{ "key": "pl_live_<random>", "created_at": "...", "last_used_at": "..." }`
- Hash stored separately (avoid logging the raw key)

### 5.2 Admin UI
- New section in `/admin/settings`: "MCP API Key"
- "Generate Key" button — creates random 32-char key prefixed `pl_live_`, displays once, never shows raw value again
- "Regenerate" button — invalidates old key, generates new
- Shows: created_at, last_used_at, recent usage count

### 5.3 Validation
- Helper `validateMcpKey(req)` in `lib/mcp-auth.ts`
- Reads `Authorization: Bearer <key>` header
- Hash the incoming key, compare against stored hash
- Returns the user_id (which is the master user — currently you, the admin)
- All MCP-triggered rows are billed to this single user account

---

## 6. The npm package

### 6.1 Structure

```
@peninglab/mcp/
├── package.json          # bin: { "peninglab-mcp": "./dist/server.js" }
├── README.md
├── src/
│   ├── server.ts         # stdio MCP server entry point
│   ├── client.ts         # fetch wrapper for peninglab.com API
│   ├── tools/
│   │   ├── generate-image.ts
│   │   ├── generate-video.ts
│   │   ├── list-models.ts
│   │   ├── get-balance.ts
│   │   └── get-status.ts
│   └── types.ts
└── dist/                 # compiled
```

### 6.2 Tool schemas (exposed via MCP listTools)

Each tool follows the standard MCP shape: name, description, inputSchema (JSON Schema), outputs as text content.

**`generate_image`:**
```typescript
{
  name: "generate_image",
  description: "Generate an image via peninglab.com. Waits for completion and returns the final URL synchronously (internally polls every 60s, up to 10 min).",
  inputSchema: {
    type: "object",
    required: ["model", "prompt"],
    properties: {
      model: { type: "string", description: "Model name from list_models" },
      prompt: { type: "string", description: "Image generation prompt" },
      image_urls: { type: "array", items: { type: "string" }, description: "Optional reference images for img2img" },
      aspect_ratio: { type: "string", enum: ["1:1", "9:16", "16:9", "2:3", "3:2"], default: "1:1" }
    }
  }
}
```

Output (returned synchronously after polling):
```typescript
{
  url: string,        // final B2 URL
  cost: number,       // RM charged
  balance: number,    // remaining credits after deduct
  model: string,
  task_id: string     // for reference / debug
}
```

**`generate_video`:** same shape + `image_mode`, `duration`. Same wait-for-completion semantics.

**`list_models`:** no input. Returns array of `{ name, type, rate, unit }`.

**`get_balance`:** no input. Returns `{ balance, plan }`.

**`get_status`:** input `task_id`. For manual lookup of a task the package already submitted (rare — usually unneeded since generate_* waits internally).

### 6.3 Internal polling loop (the primary pattern)

When the AI agent calls `generate_image` or `generate_video`:

1. Package calls `POST /api/mcp/generate/*` → receives `task_id`
2. Package starts polling `GET /api/mcp/status/:task_id` every **60 seconds**
3. When `status === "done"` → return `{ url, cost, balance, ... }` to AI agent
4. When `status === "failed"` → throw MCP error with reason
5. **Max wait: 10 minutes** (configurable via `PENINGLAB_MAX_WAIT_SEC` env var). If exceeded, throws "Task still pending after 10 min; check manually with get_status(task_id)" so the AI agent can decide what to do.

The 60s interval is the balance:
- **Long jobs (Seedance 1-min video, ~5 min inference)**: ~5 polls. Cheap.
- **Short jobs (image gen, ~20s inference)**: 1 poll catches it. Lightly stale (up to 60s wait past completion) but fine.

For latency-sensitive callers, the env var `PENINGLAB_POLL_INTERVAL_SEC` can drop the interval (e.g. 15s for snappier UX on image gen).

**Tool call timeout caveat:** Claude Code / Cursor / other MCP clients typically allow long tool execution times (no hard limit in the MCP spec itself). If a specific client has a 5-min tool timeout, the AI agent can simply re-call `get_status(task_id)` to check the same task — it persists on the server.

---

## 7. Cost & deduction (charged the SAME as UI calls)

**Critical guarantee:** MCP-triggered generations charge the user's account **exactly the same way** UI-triggered generations do. No free rides for the MCP. The flow:

1. **Pre-flight check** (in `/api/mcp/generate/*` before submitting): call `priceFor(user.id, reason, modelHint)` to compute cost. If `profiles.credits < cost`, return HTTP 402 immediately with `{ error: "Insufficient credits", balance: <current>, needed: <cost> }`. The AI agent sees this as a tool error and can react.

2. **Insert history row** with the calculated cost and `status: "pending"`. Same row shape as UI calls — same `tab`, `type`, `metadata.model`, etc.

3. **Cascade fires** through existing infrastructure (`generateVideoWithCascade` / `generateImageWithCascade`). No new code path.

4. **Settle path** (existing `lib/settle.ts`) runs on success and calls `deduct(user.id, reason, amount, history.id)` exactly the same as UI calls. Credit deducted, balance updated, ledger row written.

5. **MCP polling endpoint** (`/api/mcp/status/:id`) reads the now-updated `profiles.credits` and returns the fresh balance to the caller alongside the output URL.

**Audit & visibility:**
- All MCP rows tagged `metadata.mcp_caller_id = <hashed-key>` so admin can filter in `/admin/usage`
- Same row appears in admin's per-model breakdown tile (Veo Videos / Seedance / etc.) — counted exactly like UI rows
- New "Source" badge in `/admin/usage` detail log: `UI` (default) vs `MCP` (when `metadata.mcp_caller_id` present)

**What this guarantees:**
- Running a generation via MCP costs the same RM as the same generation via UI
- Admin sees real spend in usage analytics
- No way to bypass billing by routing through MCP
- Balance returned with every MCP response always reflects the true ledger state

---

## 8. Security

- API key: never logged, never returned after creation, stored only as bcrypt hash
- HTTPS only (Vercel default)
- Rate limit on `/api/mcp/*`: 60 req/min per API key (prevent runaway loops)
- Webhook signature: HMAC-SHA256 of body with API key as secret
- All MCP rows visible in admin/usage so user has full audit trail

---

## 9. End-to-end requirements verification

| Requirement | How it works |
|---|---|
| Single hidden API key | `app_settings.mcp_api_key` (one row, bcrypt hashed) |
| Synchronous wait for result | npm package polls `/api/mcp/status/:task_id` every 60s; returns to AI agent when status flips to done |
| Credits charged the same as UI | Pre-flight `priceFor` + `hasEnoughCredits` checks + settle path deducts via `deduct()` — identical to UI flow |
| All admin-configured models accessible | `/api/mcp/models` reads existing rate settings; backend dispatches via existing cascade |
| Cascade fallback works transparently | Reuses existing settle.ts auto-retry — no new logic |
| Balance returned with every result | `/api/mcp/status` reads fresh `profiles.credits` and returns it alongside output_url |
| Failure handling | Cascade exhaust → row fails → status endpoint returns `status: "failed"` + error_message |
| Audit trail | All MCP rows tagged `metadata.mcp_caller_id`, visible in admin/usage with `MCP` source badge |

---

## 10. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| API key leaked → drains credits | High | Rate limit per key (60 req/min); admin can regenerate; alert email on >RM 50 spent in 1 hour |
| MCP polling exceeds AI agent's tool execution timeout (5-10 min depending on client) | Medium | AI agent can re-call `get_status(task_id)` for the same task — server keeps state. Document in package README. |
| Caller spams `/api/mcp/generate/*` without checking balance | Medium | Pre-flight `priceFor` + `hasEnoughCredits` returns 402 immediately if balance insufficient |
| Model name typo by caller | Low | Validate against `/api/mcp/models` list, return 400 with valid model list |
| Status endpoint hammered (polls every 60s × N concurrent jobs) | Low | Single Supabase row read per call; negligible. Vercel function rate limits are fine at this scale. |
| Cascade fails completely → row sits `failed` forever | Low | Existing settle.ts auto-resubmit handles this; if all retries exhaust, status endpoint returns `failed` with the error message and AI agent surfaces it. |

---

## 11. V2 roadmap (out of scope for V1)

- Auto Content batch generation tool (`generate_auto_content_batch`)
- Storytelling pipeline tool
- Streaming progress events (SSE) for long jobs
- Multi-user API keys (one key per consuming project)
- OpenAPI / non-MCP REST spec for non-AI consumers
- Cost quoting tool (`get_quote` before generate)
- Cancel pending tasks

---

## 12. Out-of-band coordination

After spec approval and plan execution:
1. Admin generates the API key once in /admin/settings
2. Admin publishes `@peninglab/mcp` v0.1.0 to npm (one-time `npm publish` from the new package directory)
3. In each consuming project, add the MCP config snippet to `claude_desktop_config.json` (or Cursor's settings) with the API key
4. Restart the MCP client (Claude Desktop / Cursor) → tools appear → use
