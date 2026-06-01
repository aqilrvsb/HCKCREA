# Peninglab MCP — Design Spec

**Goal:** Build a public npm package `@peninglab/mcp` that exposes peninglab.com's image and video generation as MCP tools. AI agents and other projects can install the package, authenticate with a private API key, and trigger any admin-configured generation model. Results come back via webhook (with long-poll fallback). Latest credit balance returned with every successful call.

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
   │
   ▼
[@peninglab/mcp npm package — stdio MCP server]
   │  reads PENINGLAB_API_KEY env var
   │  exposes tools: generate_image, generate_video, list_models,
   │                 get_balance, get_status
   ▼
HTTPS calls to peninglab.com
   │  Authorization: Bearer <PENINGLAB_API_KEY>
   ▼
[peninglab.com Next.js routes /api/mcp/*]
   │  - validate API key against app_settings.mcp_api_key
   │  - dispatch to existing /api/generate/* infrastructure
   │  - stamp metadata.mcp_callback_url + mcp_caller_id
   ▼
[existing cascade fires]
   │  Crun → APIMart → APIPod cascade, settle.ts, B2 upload, etc.
   ▼
[settle.ts auto-poll OR p* callback]
   │  on status → done: read metadata.mcp_callback_url
   │  if present → POST { task_id, status, output_url, cost, balance } to it
   ▼
[caller's webhook OR caller is long-polling /api/mcp/status/:id]
   │
   ▼
[AI agent receives final URL]
```

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
- `callback_url` optional (if absent, caller must poll `/api/mcp/status/:id`)

Response:
```json
{
  "ok": true,
  "task_id": "history-row-uuid",
  "estimated_cost": 0.20,
  "balance_after_estimate": 42.30
}
```

Server flow: reuses `/api/generate/image` logic (cascade, settle, B2 upload), stamps `metadata.mcp_caller_id = <api-key-hash>` and `metadata.mcp_callback_url = <url>` on the history row.

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
  "aspect_ratio": "16:9",
  "callback_url": "https://my-project.com/peninglab-webhook"
}
```

- `model` required (`veo` / `sora2` / `gemini` / `seedance` / `grok`)
- `image_mode` one of `text` / `frame` / `ingredient`
- `duration`: model-specific range validation server-side (Veo fixed 8, Sora 2 8/12, Gemini fixed 10, Seedance 4-15, Grok 6-30)

Response: same shape as image.

Server flow: dispatches to existing `/api/generate/cinema` logic with model-routed cascade.

### 3.5 `GET /api/mcp/status/:task_id`
Returns current status of a task. Use this if caller didn't provide `callback_url` OR webhook delivery failed.

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

## 4. Webhook firing (settle.ts patch)

In `lib/settle.ts`, after a row settles to `done` (or `failed`), check for `metadata.mcp_callback_url`. If present, fire a webhook:

```ts
// Pseudocode added near the end of settleHistoryRow on done branch
if (meta.mcp_callback_url && typeof meta.mcp_callback_url === "string") {
  void fireMcpCallback(meta.mcp_callback_url, {
    task_id: hist.id,
    status: "done",
    output_url: hist.output_url,
    cost: chargeAmount,
    balance: <refreshed from profiles>,
    duration_sec: hist.duration,
    model: hist.metadata?.model,
  });
}
```

Same fire on `failed` branch.

**Retry strategy:**
- Initial fire with 5-second timeout
- On non-2xx OR timeout: retry after 30s, then 5min, then 30min, then give up
- Track attempts in `metadata.mcp_callback_attempts`

**Signing:** Include `X-Peninglab-Signature: hmac-sha256(api_key, body)` header so caller can verify webhook authenticity.

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
  description: "Generate an image via peninglab.com. Returns task_id; result delivered via webhook OR via get_status polling.",
  inputSchema: {
    type: "object",
    required: ["model", "prompt"],
    properties: {
      model: { type: "string", description: "Model name from list_models" },
      prompt: { type: "string", description: "Image generation prompt" },
      image_urls: { type: "array", items: { type: "string" }, description: "Optional reference images for img2img" },
      aspect_ratio: { type: "string", enum: ["1:1", "9:16", "16:9", "2:3", "3:2"], default: "1:1" },
      callback_url: { type: "string", description: "Optional webhook URL — server pings this when done. If omitted, use get_status to poll." }
    }
  }
}
```

**`generate_video`:** same shape + `image_mode`, `duration`.

**`list_models`:** no input.

**`get_balance`:** no input.

**`get_status`:** input `task_id`.

### 6.3 Long-poll fallback

If caller doesn't provide `callback_url`, the MCP tool internally polls `/api/mcp/status/:id` every 5 seconds for up to 5 minutes, then returns whatever state it found. This makes the tool feel synchronous to the AI agent ("call → wait → get URL").

For longer-running jobs (Gemini 10s video can take 2+ min, Seedance 1-min video can take 5+ min), the long-poll might time out. Document this clearly — recommend webhook for production.

---

## 7. Cost & deduction

- MCP calls deduct from the same `profiles.credits` table the UI uses
- All MCP rows are tagged `metadata.mcp_caller_id = <hashed-key>` for admin audit
- Admin usage table gains a new column or filter: "MCP" vs "UI" source
- Pre-flight credit check on every MCP call: return 402 with `{ error: "Insufficient credits", balance: <current> }` if not enough

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
| Webhook callback delivery | settle.ts fires after row done, with retry + HMAC signing |
| Long-poll fallback | npm package polls `/api/mcp/status/:id` if no callback_url given |
| All admin-configured models accessible | `/api/mcp/models` reads existing rate settings; backend dispatches via existing cascade |
| Cascade fallback works transparently | Reuses existing settle.ts auto-retry — no new logic |
| Balance returned with every result | Settle.ts re-reads `profiles.credits` after deduct, includes in webhook payload + `/api/mcp/status` response |
| Failure handling | Cascade exhaust → row fails → webhook fires with `status: "failed"` + error message |
| Audit trail | All MCP rows tagged `metadata.mcp_caller_id`, visible in admin/usage |

---

## 10. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Webhook delivery fails (caller's server down) | Medium | 4-retry exponential backoff; caller can still poll `/api/mcp/status/:id` |
| API key leaked → drains credits | High | Rate limit per key; admin can regenerate; alert email on >RM 50 spent in 1 hour |
| Long-poll times out on slow video gen | Low | Document recommendation: use webhook for video >1 min |
| Vercel 300s function timeout on long-poll | Medium | Cap long-poll at 270s (Vercel limit is 300s), return `status: "still_pending"` with `task_id` so caller can retry |
| Caller spams `/api/mcp/generate/*` without checking balance | Medium | Pre-flight check returns 402 immediately if balance insufficient |
| Model name typo by caller | Low | Validate against `/api/mcp/models` list, return 400 with valid model list |

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
