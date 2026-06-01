# Peninglab MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@peninglab/mcp` npm package + 6 new HCKCREA API endpoints so AI agents in other projects can trigger image/video generation on peninglab.com (with the same credit-deduction guarantees as the UI) using a single admin-managed API key. Polling-only — no webhooks.

**Architecture:** Two artifacts. (1) HCKCREA exposes `/api/mcp/*` endpoints that wrap the existing image/video cascade infrastructure, with API-key auth and `metadata.mcp_caller_id` audit tagging. (2) A standalone `@peninglab/mcp` npm package (stdio MCP server) that other projects install — it submits jobs to peninglab.com and polls `/api/mcp/status/:task_id` every 60s until done, returning the final URL synchronously to the AI agent.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Auth), bcrypt for API key hashing, Node 18+ for the npm package, `@modelcontextprotocol/sdk` (the official MCP TypeScript SDK).

**Spec:** `docs/superpowers/specs/2026-05-31-peninglab-mcp-design.md`

---

## File Structure

| File | Responsibility | Change kind |
|---|---|---|
| `lib/mcp-auth.ts` | `validateMcpKey(req)` helper — header parse, bcrypt compare, return user_id | **Create** |
| `app/api/mcp/auth-check/route.ts` | Validate key, return user info + balance | **Create** |
| `app/api/mcp/models/route.ts` | List admin-configured models with rates | **Create** |
| `app/api/mcp/balance/route.ts` | Return current credit balance | **Create** |
| `app/api/mcp/status/[task_id]/route.ts` | Return history row state + balance | **Create** |
| `app/api/mcp/generate/image/route.ts` | Submit image gen via existing image cascade, MCP-tagged | **Create** |
| `app/api/mcp/generate/video/route.ts` | Submit video gen via existing video cascade, MCP-tagged | **Create** |
| `app/admin/settings/page.tsx` | Add "MCP API Key" card (generate / regenerate, show last_used_at) | Modify |
| `app/admin/usage/page.tsx` | Add "MCP" source badge when `metadata.mcp_caller_id` present | Modify |
| `E:\Project\peninglab-mcp\package.json` | npm package manifest with `bin` entry | **Create** (new directory) |
| `E:\Project\peninglab-mcp\src\server.ts` | MCP server bootstrap | **Create** |
| `E:\Project\peninglab-mcp\src\client.ts` | Fetch wrapper with API key auth | **Create** |
| `E:\Project\peninglab-mcp\src\poll.ts` | Internal polling helper (60s × 10min default) | **Create** |
| `E:\Project\peninglab-mcp\src\types.ts` | Shared type definitions | **Create** |
| `E:\Project\peninglab-mcp\src\tools\*.ts` | 5 tool implementations | **Create** |
| `E:\Project\peninglab-mcp\README.md` | Install + config docs | **Create** |

Each HCKCREA task = one commit + one push. The npm package (Tasks 10-15) lives in a separate folder; tasks build it incrementally and the user runs `npm publish` once at the end (manual, not automated).

**Constraints (from project memory + spec):**
- Always push after committing in HCKCREA repo.
- No version bumps (HCKCREA, not extension).
- No `Date.toISOString()` for user-facing strings (Malaysia UTC+8); fine for internal metadata timestamps.
- No test runner — verify via `npx tsc --noEmit -p .` + manual smoke testing.
- Credits charged identically to UI calls (`priceFor` + `hasEnoughCredits` pre-flight, `deduct()` via existing settle path).

---

## Task 1: API key auth helper

**Files:**
- Create: `lib/mcp-auth.ts`

The helper reads `Authorization: Bearer <key>` from the request, bcrypt-compares to `app_settings.mcp_api_key.hash`, and returns the user_id bound to it (the admin's user — there's only one MCP key in V1). Also updates `last_used_at` for audit.

- [ ] **Step 1: Verify `bcryptjs` is already a dependency**

```bash
cd /e/Project/HCKCREA && grep -E '"bcrypt' package.json
```

Expected output: some bcrypt-related dependency. If empty, install:

```bash
cd /e/Project/HCKCREA && npm install bcryptjs && npm install --save-dev @types/bcryptjs
```

- [ ] **Step 2: Create the helper file**

Create `E:\Project\HCKCREA\lib\mcp-auth.ts`:

```ts
// MCP API key validation. Single shared key stored as bcrypt hash in
// app_settings.mcp_api_key.{hash, prefix, created_at, last_used_at,
// owner_user_id}. The owner_user_id is the admin who generated the key
// — all MCP-triggered rows bill to this account.
//
// Auth header: Authorization: Bearer <plaintext-key>
// Plaintext keys are prefixed "pl_live_" + 32 hex chars.

import { createAdminClient } from "@/lib/supabase/admin";
import { getSetting } from "@/lib/settings";
import bcrypt from "bcryptjs";

type McpKeySetting = {
  hash: string;
  prefix: string; // first 12 chars of the key for display ("pl_live_abcd")
  created_at: string;
  last_used_at: string | null;
  owner_user_id: string;
};

export type McpAuthResult =
  | { ok: true; userId: string; keyPrefix: string }
  | { ok: false; error: string; status: number };

// Parse Bearer header → plaintext key
function parseBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/);
  return m ? m[1].trim() : null;
}

export async function validateMcpKey(req: Request): Promise<McpAuthResult> {
  const key = parseBearer(req);
  if (!key) {
    return { ok: false, error: "Missing Authorization: Bearer header", status: 401 };
  }
  if (!key.startsWith("pl_live_") || key.length < 20) {
    return { ok: false, error: "Invalid key format", status: 401 };
  }

  const cfg = await getSetting<McpKeySetting>("mcp_api_key");
  if (!cfg?.hash || !cfg?.owner_user_id) {
    return { ok: false, error: "MCP not configured — admin must generate a key first", status: 503 };
  }

  const matches = await bcrypt.compare(key, cfg.hash);
  if (!matches) {
    return { ok: false, error: "Invalid API key", status: 401 };
  }

  // Best-effort update of last_used_at — don't block on it.
  void (async () => {
    try {
      const admin = createAdminClient();
      await admin
        .from("app_settings")
        .update({
          value: { ...cfg, last_used_at: new Date().toISOString() },
        })
        .eq("key", "mcp_api_key");
    } catch {}
  })();

  return { ok: true, userId: cfg.owner_user_id, keyPrefix: cfg.prefix };
}

// Returns a SHA-256-style hash of the key prefix for use as
// metadata.mcp_caller_id — gives audit visibility without leaking the
// real key. Just hashes the key prefix (first 12 chars) — that's a
// stable identifier that survives key rotation.
export function mcpCallerId(keyPrefix: string): string {
  return `mcp_${keyPrefix}`;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "mcp-auth" | head -10
```

Expected: no errors mentioning `lib/mcp-auth.ts`.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/mcp-auth.ts package.json package-lock.json && \
  git commit -m "$(cat <<'EOF'
feat(mcp): API key validation helper

validateMcpKey(req) reads Authorization: Bearer header, bcrypt-compares
to app_settings.mcp_api_key.hash, returns the owner user_id. Updates
last_used_at best-effort. mcpCallerId(prefix) returns the stable
audit identifier stamped on history.metadata.mcp_caller_id.

Dormant until /api/mcp/* routes consume it in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 2: `/api/mcp/auth-check` route

**Files:**
- Create: `app/api/mcp/auth-check/route.ts`

Smallest possible endpoint to verify a key works end-to-end before any generation. Returns user + balance.

- [ ] **Step 1: Create the route file**

Create `E:\Project\HCKCREA\app\api\mcp\auth-check\route.ts`:

```ts
import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/mcp/auth-check — validates the API key and returns the
// account info bound to it. Used by the npm package on first call
// (and by `peninglab-mcp test` if we ever add a CLI command) to
// confirm the key is configured correctly.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("email, credits, plan")
    .eq("id", auth.userId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    user_id: auth.userId,
    key_prefix: auth.keyPrefix,
    email: profile?.email ?? null,
    balance: Number(profile?.credits ?? 0),
    plan: profile?.plan ?? "light",
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "auth-check" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/mcp/auth-check/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(mcp): GET /api/mcp/auth-check endpoint

Validates the API key via validateMcpKey() and returns the account
info bound to it (user_id, email, balance, plan). Used as the
"can the npm package talk to peninglab.com?" smoke test.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 3: `/api/mcp/models` route

**Files:**
- Create: `app/api/mcp/models/route.ts`

Lists all admin-configured generation models with their current rates. The npm package calls this once on init to populate the model list for AI agents to discover.

- [ ] **Step 1: Create the route file**

Create `E:\Project\HCKCREA\app\api\mcp\models\route.ts`:

```ts
import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import {
  getBananaProRate,
  getGptImageRate,
  getVeoRate,
  getGrokRate,
  getSeedanceRate,
  getGeminiRate,
  getSetting,
} from "@/lib/settings";

// GET /api/mcp/models — list every generation model the admin has
// configured a rate for. Includes per-model rate + unit so callers
// can compute cost ahead of generate.
//
// Read-only and cheap (cached settings).

export const dynamic = "force-dynamic";

type ModelEntry = {
  name: string;
  type: "image" | "video";
  rate: number;
  unit: "per_image" | "per_second" | "per_video_8s" | "per_video_10s";
};

export async function GET(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [bananaPro, gptImage, veo, grok, seedance, gemini, sora2] = await Promise.all([
    getBananaProRate(),
    getGptImageRate(),
    getVeoRate("8"),
    getGrokRate(),
    getSeedanceRate(),
    getGeminiRate("10"),
    (async () => {
      const cfg = await getSetting<{ rate: number }>("sora2_rate");
      return typeof cfg?.rate === "number" ? cfg.rate : (await getGrokRate()) * 2;
    })(),
  ]);

  const models: ModelEntry[] = [
    { name: "nano-banana-pro", type: "image", rate: bananaPro, unit: "per_image" },
    { name: "gpt-image-2",     type: "image", rate: gptImage,  unit: "per_image" },
    { name: "veo",             type: "video", rate: veo,       unit: "per_video_8s" },
    { name: "grok",            type: "video", rate: grok,      unit: "per_second" },
    { name: "sora2",           type: "video", rate: sora2,     unit: "per_second" },
    { name: "gemini",          type: "video", rate: gemini,    unit: "per_video_10s" },
    { name: "seedance",        type: "video", rate: seedance,  unit: "per_second" },
  ];

  return NextResponse.json({ ok: true, models });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "mcp/models" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/mcp/models/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(mcp): GET /api/mcp/models endpoint

Returns the list of generation models admin has rates configured for,
with their per-model rate + unit. Used by the npm package on init so
AI agents can discover the available model catalogue.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 4: `/api/mcp/balance` route

**Files:**
- Create: `app/api/mcp/balance/route.ts`

- [ ] **Step 1: Create the route file**

Create `E:\Project\HCKCREA\app\api\mcp\balance\route.ts`:

```ts
import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/mcp/balance — return current credit balance for the
// account bound to the API key. Stateless, no side effects.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("credits, plan")
    .eq("id", auth.userId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    balance: Number(profile?.credits ?? 0),
    plan: profile?.plan ?? "light",
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "mcp/balance" | head -10
```

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/mcp/balance/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(mcp): GET /api/mcp/balance endpoint

Returns current credit balance for the account bound to the API key.
No side effects — pure read of profiles.credits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 5: `/api/mcp/status/[task_id]` route

**Files:**
- Create: `app/api/mcp/status/[task_id]/route.ts`

The polling endpoint. The npm package hits this every 60s. Returns history row state + (when done) the output URL + cost + fresh balance.

- [ ] **Step 1: Create the route file**

Create `E:\Project\HCKCREA\app\api\mcp\status\[task_id]\route.ts`:

```ts
import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/mcp/status/:task_id — the polling endpoint. npm package
// hits this every 60s until status flips to done / failed.
//
// task_id is the history.id (UUID). We re-read the row + the user's
// fresh balance on every call so the caller always gets the latest
// ledger state alongside the output URL.
//
// Returns 404 if the task_id doesn't belong to the API key owner —
// security: one key can only see its own tasks.

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ task_id: string }> }
) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { task_id } = await params;
  if (!task_id || typeof task_id !== "string") {
    return NextResponse.json({ error: "task_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("history")
    .select("id, user_id, status, output_url, cost, prompt, type, duration, error_message, metadata, created_at")
    .eq("id", task_id)
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (error || !row) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  // Fresh balance read so the caller has up-to-date credits even if
  // settle.ts just deducted.
  const { data: profile } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", auth.userId)
    .maybeSingle();
  const balance = Number(profile?.credits ?? 0);

  if (row.status === "done") {
    return NextResponse.json({
      ok: true,
      status: "done",
      task_id: row.id,
      output_url: row.output_url,
      cost: Number(row.cost ?? 0),
      balance,
      duration_sec: row.duration,
      model: (row.metadata as any)?.model ?? null,
      created_at: row.created_at,
    });
  }

  if (row.status === "failed") {
    return NextResponse.json({
      ok: true,
      status: "failed",
      task_id: row.id,
      error: row.error_message ?? "Generation failed",
      balance,
    });
  }

  // pending (cascade still firing) or running (provider task in flight)
  return NextResponse.json({
    ok: true,
    status: "pending",
    task_id: row.id,
    created_at: row.created_at,
    balance,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "mcp/status" | head -10
```

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add 'app/api/mcp/status/[task_id]/route.ts' && \
  git commit -m "$(cat <<'EOF'
feat(mcp): GET /api/mcp/status/:task_id endpoint

The polling endpoint. npm package hits this every 60s until status
flips to done / failed. Returns the row state + fresh profiles.credits
so caller always sees up-to-date balance alongside output_url.

Returns 404 if task_id doesn't belong to the API key owner —
prevents cross-account visibility.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 6: `/api/mcp/generate/image` route

**Files:**
- Create: `app/api/mcp/generate/image/route.ts`

Submits an image generation. Mirrors `/api/generate/image`'s structure but uses API-key auth instead of session, and stamps `metadata.mcp_caller_id` for audit. Reuses `generateImageWithCascade` + `priceFor` exactly like the UI route.

- [ ] **Step 1: Create the route file**

Create `E:\Project\HCKCREA\app\api\mcp\generate\image\route.ts`:

```ts
import { NextResponse, after } from "next/server";
import { validateMcpKey, mcpCallerId } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config } from "@/lib/settings";
import { generateImageWithCascade } from "@/lib/image-cascade";

// POST /api/mcp/generate/image — MCP-triggered image generation.
//
// Mirrors /api/generate/image's flow but with:
//   1. API-key auth (validateMcpKey instead of session cookie)
//   2. Pre-flight credit check (UI route skips because nav-gate blocks
//      it; MCP has no such gate so we check explicitly)
//   3. metadata.mcp_caller_id stamped for audit + admin/usage badge
//
// Reuses the same cascade + settle path so deduction happens
// identically to UI calls.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim();
  const requestedModel = String(body?.model || "").trim();
  const imageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((x: any) => typeof x === "string" && !!x)
    : [];
  const aspectRatio = String(body?.aspect_ratio || "1:1");

  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }
  if (!requestedModel) {
    return NextResponse.json({ error: "model required" }, { status: 400 });
  }

  // Resolve model hint for priceFor. The model name from the caller
  // matches the names in /api/mcp/models — nano-banana-pro, gpt-image-2.
  const lower = requestedModel.toLowerCase();
  const modelHint: "banana_pro" | "gpt_image" | undefined =
    lower.includes("banana") ? "banana_pro" :
    lower.includes("gpt-image") ? "gpt_image" :
    undefined;

  // Pre-flight credit check. MCP has no nav gate so we must check
  // explicitly. UI route skips this because the dashboard blocks users
  // with credits < RM1 from reaching tabs.
  const cost = await priceFor(auth.userId, "image_generate", modelHint);
  const hasFunds = await hasEnoughCredits(auth.userId, cost);
  if (!hasFunds) {
    const admin = createAdminClient();
    const { data: p } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", auth.userId)
      .maybeSingle();
    return NextResponse.json(
      {
        error: "Insufficient credits",
        balance: Number(p?.credits ?? 0),
        needed: cost,
      },
      { status: 402 }
    );
  }

  // Insert placeholder row tagged with mcp_caller_id so admin/usage
  // can show the MCP badge.
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: auth.userId,
      project_id: null,
      type: "image",
      tab: "image",
      status: "pending",
      prompt,
      reference_url: imageUrls[0] ?? null,
      task_id: null,
      cost,
      metadata: {
        aspectRatio,
        image_urls: imageUrls,
        upload_status: "queued",
        mcp_caller_id: mcpCallerId(auth.keyPrefix),
        model: requestedModel,
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }
  const historyId = hist.id;

  // Background work — mirrors UI image route's after() block. Resolves
  // p2 config, fires cascade, updates row with task_id + actual model.
  after(async () => {
    try {
      const cfg = await getP2Config();
      const primaryModel = requestedModel || cfg.imageDefault || "nano-banana-pro";
      const result = await generateImageWithCascade({
        primaryModel,
        prompt,
        aspectRatio,
        imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      });
      if (result.ok) {
        await admin
          .from("history")
          .update({
            task_id: result.taskId,
            metadata: {
              aspectRatio,
              image_urls: imageUrls,
              upload_status: "done",
              mcp_caller_id: mcpCallerId(auth.keyPrefix),
              model: result.actualModel,
              provider: result.actualProvider,
              slot: result.actualSlot,
              tier_log: result.tierLog,
            },
          })
          .eq("id", historyId);
      } else {
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: result.error,
            metadata: {
              aspectRatio,
              image_urls: imageUrls,
              upload_status: "failed",
              mcp_caller_id: mcpCallerId(auth.keyPrefix),
              tier_log: result.tierLog,
            },
          })
          .eq("id", historyId);
      }
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
        })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    task_id: historyId,
    estimated_cost: cost,
    model: requestedModel,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "mcp/generate/image" | head -10
```

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/mcp/generate/image/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(mcp): POST /api/mcp/generate/image endpoint

MCP-triggered image generation. Mirrors UI image route's structure
but uses API-key auth, has explicit pre-flight credit check (no
nav-gate fallback), and stamps metadata.mcp_caller_id for admin
audit + /admin/usage badge.

Reuses generateImageWithCascade + the existing settle path so credit
deduction happens identically to UI calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 7: `/api/mcp/generate/video` route

**Files:**
- Create: `app/api/mcp/generate/video/route.ts`

Submits video gen. Mirrors `/api/generate/cinema`'s flow but with API-key auth + mcp_caller_id tagging. Dispatches model name to the right cascade asset (veo → video pool, sora2 → sora2 pool, gemini → gemini pool, seedance → cinema pool, grok → grok pool).

- [ ] **Step 1: Create the route file**

Create `E:\Project\HCKCREA\app\api\mcp\generate\video\route.ts`:

```ts
import { NextResponse, after } from "next/server";
import { validateMcpKey, mcpCallerId } from "@/lib/mcp-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceFor, hasEnoughCredits } from "@/lib/deduct";
import { getP2Config, getCinemaRate, getVeoRate, getGeminiRate, getSeedanceRate, getSetting } from "@/lib/settings";
import { generateVideoWithCascade } from "@/lib/video-cascade";

// POST /api/mcp/generate/video — MCP-triggered video generation.
//
// Reuses the cinema route's cascade dispatch logic but with:
//   1. API-key auth instead of session
//   2. Explicit pre-flight credit check
//   3. mcp_caller_id stamped for audit
//   4. Accepts model name directly (veo / sora2 / gemini / seedance / grok)
//
// Model → cascade asset mapping (same as cinema route):
//   veo / unset → "video"  (cfg.videoT2V / I2V / R2V)
//   sora2       → "sora2"
//   gemini      → "gemini"
//   seedance    → "cinema"
//   grok        → "grok"

export const dynamic = "force-dynamic";

type ModelChoice = "veo" | "sora2" | "gemini" | "seedance" | "grok";

export async function POST(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt || "").trim().substring(0, 5000);
  const requestedModel = String(body?.model || "").trim().toLowerCase();
  const imageUrls: string[] = Array.isArray(body?.image_urls)
    ? body.image_urls.filter((x: any) => typeof x === "string" && !!x)
    : [];
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const imageMode: "text" | "frame" | "ingredient" =
    body?.image_mode === "ingredient"
      ? "ingredient"
      : body?.image_mode === "frame"
        ? "frame"
        : "text";

  if (!prompt) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  const modelChoice: ModelChoice =
    requestedModel === "sora2" ? "sora2" :
    requestedModel === "gemini" ? "gemini" :
    requestedModel === "seedance" ? "seedance" :
    requestedModel === "grok" ? "grok" :
    "veo";

  // Per-provider duration validation (same as cinema route)
  const duration =
    modelChoice === "veo" ? 8 :
    modelChoice === "sora2" ? (body?.duration === 12 || body?.duration === "12" ? 12 : 8) :
    modelChoice === "gemini" ? 10 :
    modelChoice === "seedance"
      ? Math.min(15, Math.max(4, Math.round(Number(body?.duration || 5))))
      : Math.min(30, Math.max(6, Math.round(Number(body?.duration || 6))));

  // Resolution: Gemini fixed 1080p, others default 720p
  const resolution =
    modelChoice === "gemini" ? "1080p"
      : (body?.resolution === "480p" ? "480p" : "720p");

  // Pre-flight cost calculation
  let cost = 0;
  if (modelChoice === "veo") {
    cost = Number((await getVeoRate("8")).toFixed(4));
  } else if (modelChoice === "sora2") {
    const setting = await getSetting<{ rate: number }>("sora2_rate");
    const cinemaRate = await getCinemaRate();
    const ratePerSec = typeof setting?.rate === "number" ? setting.rate : cinemaRate * 2;
    cost = Number((ratePerSec * duration).toFixed(4));
  } else if (modelChoice === "gemini") {
    cost = Number((await getGeminiRate("10")).toFixed(4));
  } else if (modelChoice === "seedance") {
    cost = Number(((await getSeedanceRate()) * duration).toFixed(4));
  } else {
    // grok
    cost = Number(((await getCinemaRate()) * duration).toFixed(4));
  }

  // Pre-flight funds check
  const hasFunds = await hasEnoughCredits(auth.userId, cost);
  if (!hasFunds) {
    const admin = createAdminClient();
    const { data: p } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", auth.userId)
      .maybeSingle();
    return NextResponse.json(
      {
        error: "Insufficient credits",
        balance: Number(p?.credits ?? 0),
        needed: cost,
      },
      { status: 402 }
    );
  }

  // Insert placeholder row
  const admin = createAdminClient();
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: auth.userId,
      project_id: null,
      type: "video",
      tab: "original-video",
      status: "pending",
      prompt,
      reference_url: imageUrls[0] || null,
      task_id: null,
      duration,
      cost,
      metadata: {
        imageMode,
        resolution,
        aspectRatio: imageMode !== "text" ? null : aspectRatio,
        cinemaProvider:
          modelChoice === "veo" ? "veo" :
          modelChoice === "sora2" ? "apipod" :
          modelChoice === "gemini" ? "crun" :
          modelChoice === "seedance" ? "bytedance" :
          "grok-imagine",
        modelChoice,
        featureType: "original-video",
        image_urls: imageUrls,
        upload_status: "queued",
        mcp_caller_id: mcpCallerId(auth.keyPrefix),
        ...(modelChoice === "sora2" ? { model: "sora-2-vip", sora2Provider: "apipod" } : {}),
        ...(modelChoice === "gemini" ? { model: "google/gemini-omni" } : {}),
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }
  const historyId = hist.id;

  // Background fire — resolves model id, fires cascade, updates row.
  after(async () => {
    try {
      const cfg = await getP2Config();
      let model: string;
      if (modelChoice === "veo") {
        model = imageMode === "ingredient" ? cfg.videoR2V
          : imageMode === "frame" ? cfg.videoI2V
          : cfg.videoT2V;
      } else if (modelChoice === "sora2") {
        model = "sora2";
      } else if (modelChoice === "gemini") {
        model = "google/gemini-omni";
      } else if (modelChoice === "seedance") {
        model = "seedance"; // p2/p6 adapters auto-resolve t2v/i2v/r2v
      } else {
        model = imageMode !== "text" ? cfg.grokI2V : cfg.grokT2V;
      }

      const imgs = imageMode === "text" ? []
        : modelChoice === "sora2" ? imageUrls.slice(0, 1)
        : modelChoice === "seedance" ? imageUrls.slice(0, 5)
        : imageUrls.slice(0, 3);

      const result = await generateVideoWithCascade({
        primaryModel: model,
        prompt,
        imageUrls: imgs,
        durationMode: String(duration),
        aspectRatio,
        imageMode,
        asset:
          modelChoice === "grok" ? "grok" :
          modelChoice === "sora2" ? "sora2" :
          modelChoice === "gemini" ? "gemini" :
          modelChoice === "seedance" ? "cinema" :
          "video",
      });

      if (result.ok) {
        await admin.from("history").update({
          task_id: result.taskId,
          metadata: {
            imageMode, resolution,
            aspectRatio: imageMode !== "text" ? null : aspectRatio,
            cinemaProvider:
              modelChoice === "veo" ? "veo" :
              modelChoice === "sora2" ? "apipod" :
              modelChoice === "gemini" ? "crun" :
              modelChoice === "seedance" ? "bytedance" :
              "grok-imagine",
            modelChoice,
            featureType: "original-video",
            image_urls: imageUrls,
            upload_status: "done",
            mcp_caller_id: mcpCallerId(auth.keyPrefix),
            model: result.actualModel,
            provider: result.actualProvider,
            slot: result.actualSlot,
            ...(result.keyIndex !== undefined ? { p6_key_index: result.keyIndex } : {}),
            fallback_used: result.fallbackUsed,
            tier_log: result.tierLog,
          },
        }).eq("id", historyId);
      } else {
        await admin.from("history").update({
          status: "failed",
          error_message: result.error,
          metadata: {
            imageMode, resolution,
            aspectRatio: imageMode !== "text" ? null : aspectRatio,
            cinemaProvider:
              modelChoice === "veo" ? "veo" :
              modelChoice === "sora2" ? "apipod" :
              modelChoice === "gemini" ? "crun" :
              modelChoice === "seedance" ? "bytedance" :
              "grok-imagine",
            modelChoice,
            featureType: "original-video",
            image_urls: imageUrls,
            upload_status: "failed",
            mcp_caller_id: mcpCallerId(auth.keyPrefix),
            tier_log: result.tierLog,
          },
        }).eq("id", historyId);
      }
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Background error",
        })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    task_id: historyId,
    estimated_cost: cost,
    model: modelChoice,
    duration,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "mcp/generate/video" | head -10
```

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/mcp/generate/video/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(mcp): POST /api/mcp/generate/video endpoint

MCP-triggered video generation. Mirrors cinema route's cascade
dispatch (veo / sora2 / gemini / seedance / grok → correct asset
pool) with API-key auth + mcp_caller_id audit tagging.

Pre-flight credit check returns 402 with current balance + needed
amount if insufficient. Settle path is unchanged so credit deduction
happens identically to UI calls.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 8: Admin "MCP API Key" card

**Files:**
- Modify: `app/admin/settings/page.tsx` — add new card after the Model Pricing section
- Create: `app/api/admin/mcp-key/route.ts` — generate / regenerate the key

The card has:
- "Generate Key" button (shown when no key configured)
- "Regenerate" button (shown when key exists) — confirms before action
- Display: key prefix, created_at, last_used_at
- Shows the plaintext key ONCE after generation (copy to clipboard button)

- [ ] **Step 1: Create the key generator route**

Create `E:\Project\HCKCREA\app\api\admin\mcp-key\route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateSettingsCache } from "@/lib/settings";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// POST /api/admin/mcp-key — generate (or regenerate) the MCP API key.
// Returns the plaintext key ONCE. Subsequent reads only return the
// prefix + metadata (the bcrypt hash is never decryptable).
//
// Auth: must be an admin user (profiles.is_admin = true).
//
// Body: {} — no input required. Always generates a fresh key.

export async function POST() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Generate fresh key: 32 random hex chars + pl_live_ prefix.
  const random = crypto.randomBytes(16).toString("hex"); // 32 chars
  const plaintext = `pl_live_${random}`;
  const prefix = plaintext.substring(0, 12); // "pl_live_abcd"
  const hash = await bcrypt.hash(plaintext, 10);

  await admin
    .from("app_settings")
    .upsert(
      {
        key: "mcp_api_key",
        value: {
          hash,
          prefix,
          created_at: new Date().toISOString(),
          last_used_at: null,
          owner_user_id: user.id,
        },
        description: "MCP API key (single shared key, hashed)",
        category: "internal",
      },
      { onConflict: "key" }
    );

  invalidateSettingsCache(["mcp_api_key"]);

  return NextResponse.json({
    ok: true,
    key: plaintext, // shown ONCE; admin must copy it now
    prefix,
    created_at: new Date().toISOString(),
  });
}

// GET /api/admin/mcp-key — read the current key's metadata (NOT the
// plaintext). Returns null if no key configured yet.
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!me?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: row } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "mcp_api_key")
    .maybeSingle();
  const v = (row?.value as any) || null;

  return NextResponse.json({
    ok: true,
    configured: !!v?.hash,
    prefix: v?.prefix ?? null,
    created_at: v?.created_at ?? null,
    last_used_at: v?.last_used_at ?? null,
  });
}
```

- [ ] **Step 2: Add the MCP API Key card to admin/settings/page.tsx**

Open `app/admin/settings/page.tsx`. Search for the closing of the Model Pricing card to find a good insertion point:

```bash
cd /e/Project/HCKCREA && grep -n 'Model Pricing\|Per-model rates' app/admin/settings/page.tsx | head -5
```

Find a stable anchor. Open the file, scroll down past the Model Pricing card's closing `</div>` (the one wrapping the `card p-6 mb-6 border-2 border-violet-100` section). After that closing div, paste this new card. Read the file with `Read` to confirm exact location first, then use Edit with surrounding context as the anchor.

Insert (after the Model Pricing card's closing div):

```tsx
      {/* MCP API Key — single shared key for the @peninglab/mcp npm
          package. Admin generates once, copies the plaintext value
          shown only at creation, configures it in consuming projects'
          MCP config files. */}
      <McpKeyCard />
```

Then add the component at the bottom of the file, BEFORE the final closing of the component (search for the last `</div>` of the main return JSX):

```tsx
function McpKeyCard() {
  const [meta, setMeta] = useState<{ configured: boolean; prefix: string | null; created_at: string | null; last_used_at: string | null }>({
    configured: false, prefix: null, created_at: null, last_used_at: null,
  });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/mcp-key", { cache: "no-store" });
      const d = await r.json();
      if (d?.ok) setMeta({
        configured: !!d.configured,
        prefix: d.prefix ?? null,
        created_at: d.created_at ?? null,
        last_used_at: d.last_used_at ?? null,
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function generate() {
    if (meta.configured) {
      const ok = window.confirm(
        "Regenerating will invalidate the existing key. Any other projects using the old key will stop working until you update them. Continue?"
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/admin/mcp-key", { method: "POST" });
      const d = await r.json();
      if (d?.ok && d?.key) {
        setShowKey(d.key);
        await load();
      } else {
        alert(d?.error || "Generate failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyKey() {
    if (!showKey) return;
    try {
      await navigator.clipboard.writeText(showKey);
      alert("Copied to clipboard");
    } catch {
      alert("Copy failed — copy manually from the box above");
    }
  }

  return (
    <div className="card p-6 mb-6 border-2 border-cyan-100 bg-cyan-50/40">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-display font-bold text-lg">MCP API Key</h2>
      </div>
      <p className="text-xs text-[var(--color-text-secondary)] mb-4">
        Single shared key for the <code>@peninglab/mcp</code> npm package. Shown
        once at generation — copy and paste into consuming projects' MCP config.
        Bcrypt-hashed on the server; not recoverable if lost (regenerate to issue
        a new one).
      </p>

      {loading ? (
        <div className="text-sm text-[var(--color-text-muted)]">Loading…</div>
      ) : meta.configured ? (
        <div className="space-y-2 text-sm">
          <div><b>Prefix:</b> <code>{meta.prefix}…</code></div>
          <div><b>Created:</b> {meta.created_at ? new Date(meta.created_at).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" }) : "—"}</div>
          <div><b>Last used:</b> {meta.last_used_at ? new Date(meta.last_used_at).toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur" }) : "Never"}</div>
        </div>
      ) : (
        <div className="text-sm text-[var(--color-text-muted)] mb-3">No key configured yet.</div>
      )}

      {showKey && (
        <div className="mt-4 p-3 rounded-lg border-2 border-amber-300 bg-amber-50">
          <div className="text-xs font-bold text-amber-900 mb-2">
            ⚠ Copy this now — it will not be shown again
          </div>
          <code className="block break-all text-xs bg-white p-2 rounded border border-amber-200">
            {showKey}
          </code>
          <button
            onClick={() => void copyKey()}
            className="mt-2 px-3 py-1 rounded bg-amber-600 text-white text-xs font-bold"
          >
            Copy to clipboard
          </button>
        </div>
      )}

      <button
        onClick={() => void generate()}
        disabled={busy}
        className="btn-primary text-sm mt-4 disabled:opacity-50"
      >
        {busy ? "Generating…" : meta.configured ? "Regenerate Key" : "Generate Key"}
      </button>
    </div>
  );
}
```

Important: `useState` and `useEffect` must already be imported in `app/admin/settings/page.tsx` (they are — verify with grep). If not, add to imports.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "admin/settings|admin/mcp-key" | head -10
```

Expected: no new errors. Pre-existing `lucide-react` warnings are fine.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/admin/settings/page.tsx app/api/admin/mcp-key/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(admin): MCP API Key management UI

New card in /admin/settings to generate / regenerate the single
shared MCP API key. Plaintext shown ONCE at generation (copy to
clipboard). Bcrypt hash + metadata persisted to app_settings.mcp_api_key.

POST /api/admin/mcp-key generates fresh key (32 random hex with
pl_live_ prefix), invalidates settings cache, returns plaintext.

GET /api/admin/mcp-key returns metadata only (no plaintext recoverable).

Confirmation modal before regenerate to prevent accidental key
rotation that would break consuming projects.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 9: `/admin/usage` MCP source badge

**Files:**
- Modify: `app/admin/usage/page.tsx` — add badge column for MCP-triggered rows

The Detail Log table gains an inline "MCP" badge in the Action column (or as a separate small chip) when `metadata.mcp_caller_id` is present on the row.

- [ ] **Step 1: Find the existing Action cell rendering in usage page**

```bash
cd /e/Project/HCKCREA && grep -n '{r.reason}\|reason.*chip\|action.*cell' app/admin/usage/page.tsx | head -10
```

- [ ] **Step 2: Add MCP badge in the Action cell**

Open `app/admin/usage/page.tsx`. Find the cell that renders `r.reason` (the lime badge) inside the row map. Add a sibling MCP badge that only renders when `r.metadata?.mcp_caller_id` is present.

Around the line that has:
```tsx
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap"
                            style={{
                              background: "rgba(200,245,62,0.1)",
                              color: "var(--color-lime)",
                              border: "1px solid rgba(200,245,62,0.25)",
                            }}
                          >
                            {r.reason}
                          </span>
```

Wrap it in a flex container and add the MCP badge after:

```tsx
                          <div className="flex items-center gap-1.5">
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap"
                              style={{
                                background: "rgba(200,245,62,0.1)",
                                color: "var(--color-lime)",
                                border: "1px solid rgba(200,245,62,0.25)",
                              }}
                            >
                              {r.reason}
                            </span>
                            {(r.metadata as any)?.mcp_caller_id && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold whitespace-nowrap"
                                style={{
                                  background: "rgba(6,182,212,0.12)",
                                  color: "#06b6d4",
                                  border: "1px solid rgba(6,182,212,0.3)",
                                }}
                                title={`Triggered via MCP (${(r.metadata as any).mcp_caller_id})`}
                              >
                                MCP
                              </span>
                            )}
                          </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "admin/usage" | head -10
```

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/admin/usage/page.tsx && \
  git commit -m "$(cat <<'EOF'
feat(admin/usage): MCP source badge on Detail Log rows

When metadata.mcp_caller_id is present (set by the /api/mcp/generate/*
routes), shows a small cyan "MCP" badge next to the existing reason
chip. Title attribute carries the caller_id for hover audit.

Lets admin filter MCP-triggered usage from UI-triggered at a glance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 10: Scaffold npm package directory + package.json

**Files (NEW directory — outside HCKCREA repo):**
- Create: `E:\Project\peninglab-mcp\package.json`
- Create: `E:\Project\peninglab-mcp\tsconfig.json`
- Create: `E:\Project\peninglab-mcp\.gitignore`
- Create: `E:\Project\peninglab-mcp\.npmignore`

- [ ] **Step 1: Create the directory and verify it's clean**

```bash
mkdir -p /e/Project/peninglab-mcp && ls /e/Project/peninglab-mcp
```

Expected: empty directory.

- [ ] **Step 2: Create package.json**

Create `E:\Project\peninglab-mcp\package.json`:

```json
{
  "name": "@peninglab/mcp",
  "version": "0.1.0",
  "description": "MCP server for peninglab.com — generate images and videos from any AI agent that supports the Model Context Protocol.",
  "type": "module",
  "main": "dist/server.js",
  "bin": {
    "peninglab-mcp": "dist/server.js"
  },
  "files": ["dist", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "prepublishOnly": "npm run build"
  },
  "engines": {
    "node": ">=18.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0"
  },
  "keywords": ["mcp", "ai", "image-generation", "video-generation", "peninglab"],
  "author": "Aqil Az",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/aqilrvsb/peninglab-mcp"
  },
  "homepage": "https://peninglab.com"
}
```

- [ ] **Step 3: Create tsconfig.json**

Create `E:\Project\peninglab-mcp\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create .gitignore and .npmignore**

Create `E:\Project\peninglab-mcp\.gitignore`:

```
node_modules
dist
.env
.env.local
*.log
```

Create `E:\Project\peninglab-mcp\.npmignore`:

```
src
tsconfig.json
.gitignore
node_modules
.env
.env.local
*.log
.github
```

- [ ] **Step 5: Initialize git + install deps**

```bash
cd /e/Project/peninglab-mcp && git init -q && npm install 2>&1 | tail -5
```

Expected: dependencies installed, no errors. If `@modelcontextprotocol/sdk` version 1.0.0 doesn't exist yet at install time, run:

```bash
cd /e/Project/peninglab-mcp && npm install @modelcontextprotocol/sdk@latest --save 2>&1 | tail -5
```

- [ ] **Step 6: Initial commit (local — not pushed since GitHub repo doesn't exist yet)**

```bash
cd /e/Project/peninglab-mcp && \
  git add package.json tsconfig.json .gitignore .npmignore && \
  git commit -m "chore: scaffold @peninglab/mcp package"
```

---

## Task 11: types.ts + client.ts (fetch wrapper)

**Files:**
- Create: `E:\Project\peninglab-mcp\src\types.ts`
- Create: `E:\Project\peninglab-mcp\src\client.ts`

- [ ] **Step 1: Create src/types.ts**

```bash
mkdir -p /e/Project/peninglab-mcp/src/tools
```

Create `E:\Project\peninglab-mcp\src\types.ts`:

```ts
// Shared types matching the /api/mcp/* response shapes on peninglab.com.

export type ModelType = "image" | "video";

export type ModelEntry = {
  name: string;
  type: ModelType;
  rate: number;
  unit: "per_image" | "per_second" | "per_video_8s" | "per_video_10s";
};

export type SubmitResponse = {
  ok: true;
  task_id: string;
  estimated_cost: number;
  model: string;
  duration?: number;
};

export type StatusPending = {
  ok: true;
  status: "pending";
  task_id: string;
  created_at: string;
  balance: number;
};

export type StatusDone = {
  ok: true;
  status: "done";
  task_id: string;
  output_url: string;
  cost: number;
  balance: number;
  duration_sec: number | null;
  model: string | null;
  created_at: string;
};

export type StatusFailed = {
  ok: true;
  status: "failed";
  task_id: string;
  error: string;
  balance: number;
};

export type StatusResponse = StatusPending | StatusDone | StatusFailed;
```

- [ ] **Step 2: Create src/client.ts**

Create `E:\Project\peninglab-mcp\src\client.ts`:

```ts
// HTTP client for peninglab.com /api/mcp/* endpoints. Single API key
// sourced from PENINGLAB_API_KEY env var; base URL configurable via
// PENINGLAB_BASE_URL (defaults to https://peninglab.com).

const DEFAULT_BASE = "https://peninglab.com";

function baseUrl(): string {
  return (process.env.PENINGLAB_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

function apiKey(): string {
  const k = process.env.PENINGLAB_API_KEY;
  if (!k) {
    throw new Error(
      "PENINGLAB_API_KEY env var not set. Add it to your MCP config under env: { PENINGLAB_API_KEY: 'pl_live_...' }"
    );
  }
  return k;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text().catch(() => "");
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`peninglab HTTP ${res.status}: non-JSON response: ${text.substring(0, 200)}`);
  }
  if (!res.ok) {
    const err = json?.error || `HTTP ${res.status}`;
    const extra = json?.balance !== undefined
      ? ` (balance: RM ${json.balance}, needed: RM ${json.needed ?? "?"})`
      : "";
    throw new Error(`${err}${extra}`);
  }
  return json as T;
}

export const client = {
  authCheck: () => req<{ ok: true; balance: number; email: string; plan: string }>("/api/mcp/auth-check"),
  models: () => req<{ ok: true; models: import("./types.js").ModelEntry[] }>("/api/mcp/models"),
  balance: () => req<{ ok: true; balance: number; plan: string }>("/api/mcp/balance"),
  status: (taskId: string) =>
    req<import("./types.js").StatusResponse>(`/api/mcp/status/${encodeURIComponent(taskId)}`),
  generateImage: (body: {
    model: string;
    prompt: string;
    image_urls?: string[];
    aspect_ratio?: string;
  }) =>
    req<import("./types.js").SubmitResponse>("/api/mcp/generate/image", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  generateVideo: (body: {
    model: string;
    prompt: string;
    image_urls?: string[];
    image_mode?: "text" | "frame" | "ingredient";
    duration?: number;
    aspect_ratio?: string;
    resolution?: "480p" | "720p";
  }) =>
    req<import("./types.js").SubmitResponse>("/api/mcp/generate/video", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /e/Project/peninglab-mcp && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit (local only)**

```bash
cd /e/Project/peninglab-mcp && \
  git add src/types.ts src/client.ts && \
  git commit -m "feat: add types + HTTP client wrapper"
```

---

## Task 12: src/poll.ts — internal polling helper

**Files:**
- Create: `E:\Project\peninglab-mcp\src\poll.ts`

- [ ] **Step 1: Create the polling helper**

Create `E:\Project\peninglab-mcp\src\poll.ts`:

```ts
// Internal polling loop. The MCP tools call this after submitting a
// task — it blocks until status is done / failed or max wait exceeded.
//
// Defaults:
//   interval: 60s  (overridable via PENINGLAB_POLL_INTERVAL_SEC)
//   max wait: 600s (overridable via PENINGLAB_MAX_WAIT_SEC)

import { client } from "./client.js";
import type { StatusResponse } from "./types.js";

function intervalMs(): number {
  const env = Number(process.env.PENINGLAB_POLL_INTERVAL_SEC);
  return Number.isFinite(env) && env > 0 ? env * 1000 : 60_000;
}

function maxWaitMs(): number {
  const env = Number(process.env.PENINGLAB_MAX_WAIT_SEC);
  return Number.isFinite(env) && env > 0 ? env * 1000 : 600_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntilDone(taskId: string): Promise<StatusResponse> {
  const start = Date.now();
  const interval = intervalMs();
  const deadline = start + maxWaitMs();

  // First poll happens immediately (in case the task is super fast).
  // Subsequent polls wait `interval` between calls.
  let first = true;
  while (Date.now() < deadline) {
    if (!first) {
      await sleep(interval);
    }
    first = false;

    const status = await client.status(taskId);
    if (status.status === "done" || status.status === "failed") {
      return status;
    }
    // status === "pending" — keep polling
  }

  throw new Error(
    `Task ${taskId} still pending after ${maxWaitMs() / 1000}s. Use get_status(task_id="${taskId}") to check later.`
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/peninglab-mcp && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 3: Commit**

```bash
cd /e/Project/peninglab-mcp && \
  git add src/poll.ts && \
  git commit -m "feat: add internal polling helper with env-configurable interval + timeout"
```

---

## Task 13: Tool implementations

**Files:**
- Create: `E:\Project\peninglab-mcp\src\tools\generate-image.ts`
- Create: `E:\Project\peninglab-mcp\src\tools\generate-video.ts`
- Create: `E:\Project\peninglab-mcp\src\tools\list-models.ts`
- Create: `E:\Project\peninglab-mcp\src\tools\get-balance.ts`
- Create: `E:\Project\peninglab-mcp\src\tools\get-status.ts`

Each tool exports `{ name, description, inputSchema, handler }`. The server registers them with the MCP SDK.

- [ ] **Step 1: Create generate-image tool**

Create `E:\Project\peninglab-mcp\src\tools\generate-image.ts`:

```ts
import { client } from "../client.js";
import { pollUntilDone } from "../poll.js";

export const generateImageTool = {
  name: "generate_image",
  description:
    "Generate an image via peninglab.com. Waits for completion and returns the final URL synchronously (polls every 60s internally, up to 10 min by default). Use list_models() first to discover available image models.",
  inputSchema: {
    type: "object" as const,
    required: ["model", "prompt"],
    properties: {
      model: {
        type: "string",
        description: "Image model name (e.g. 'nano-banana-pro', 'gpt-image-2'). Get the list via list_models().",
      },
      prompt: {
        type: "string",
        description: "Image generation prompt — describe what to render.",
      },
      image_urls: {
        type: "array",
        items: { type: "string" },
        description: "Optional reference image URLs for img2img.",
      },
      aspect_ratio: {
        type: "string",
        enum: ["1:1", "9:16", "16:9", "2:3", "3:2"],
        description: "Aspect ratio (default 1:1).",
      },
    },
  },
  async handler(input: {
    model: string;
    prompt: string;
    image_urls?: string[];
    aspect_ratio?: string;
  }) {
    const submit = await client.generateImage({
      model: input.model,
      prompt: input.prompt,
      image_urls: input.image_urls,
      aspect_ratio: input.aspect_ratio,
    });

    const final = await pollUntilDone(submit.task_id);

    if (final.status === "failed") {
      throw new Error(`Image generation failed: ${final.error}`);
    }

    return {
      url: final.output_url,
      cost: final.cost,
      balance: final.balance,
      model: final.model || input.model,
      task_id: final.task_id,
    };
  },
};
```

- [ ] **Step 2: Create generate-video tool**

Create `E:\Project\peninglab-mcp\src\tools\generate-video.ts`:

```ts
import { client } from "../client.js";
import { pollUntilDone } from "../poll.js";

export const generateVideoTool = {
  name: "generate_video",
  description:
    "Generate a video via peninglab.com. Waits for completion and returns the final URL synchronously (polls every 60s internally, up to 10 min by default). Use list_models() first to discover available video models.",
  inputSchema: {
    type: "object" as const,
    required: ["model", "prompt"],
    properties: {
      model: {
        type: "string",
        description: "Video model name: 'veo', 'sora2', 'gemini', 'seedance', or 'grok'.",
      },
      prompt: {
        type: "string",
        description: "Video generation prompt.",
      },
      image_urls: {
        type: "array",
        items: { type: "string" },
        description: "Optional reference image URLs (for frame / ingredient modes).",
      },
      image_mode: {
        type: "string",
        enum: ["text", "frame", "ingredient"],
        description: "Image mode: text (no refs), frame (start/end frame i2v), ingredient (multi-ref r2v).",
      },
      duration: {
        type: "integer",
        description: "Duration in seconds (model-specific range; Veo fixed 8, Sora 2 8/12, Gemini fixed 10, Seedance 4-15, Grok 6-30).",
      },
      aspect_ratio: {
        type: "string",
        description: "Aspect ratio (default 9:16).",
      },
    },
  },
  async handler(input: {
    model: string;
    prompt: string;
    image_urls?: string[];
    image_mode?: "text" | "frame" | "ingredient";
    duration?: number;
    aspect_ratio?: string;
  }) {
    const submit = await client.generateVideo({
      model: input.model,
      prompt: input.prompt,
      image_urls: input.image_urls,
      image_mode: input.image_mode,
      duration: input.duration,
      aspect_ratio: input.aspect_ratio,
    });

    const final = await pollUntilDone(submit.task_id);

    if (final.status === "failed") {
      throw new Error(`Video generation failed: ${final.error}`);
    }

    return {
      url: final.output_url,
      cost: final.cost,
      balance: final.balance,
      model: final.model || input.model,
      duration_sec: final.duration_sec,
      task_id: final.task_id,
    };
  },
};
```

- [ ] **Step 3: Create list-models, get-balance, get-status tools**

Create `E:\Project\peninglab-mcp\src\tools\list-models.ts`:

```ts
import { client } from "../client.js";

export const listModelsTool = {
  name: "list_models",
  description: "List all generation models available on peninglab.com with their current rates.",
  inputSchema: { type: "object" as const, properties: {} },
  async handler() {
    const r = await client.models();
    return { models: r.models };
  },
};
```

Create `E:\Project\peninglab-mcp\src\tools\get-balance.ts`:

```ts
import { client } from "../client.js";

export const getBalanceTool = {
  name: "get_balance",
  description: "Return current credit balance (RM) on peninglab.com.",
  inputSchema: { type: "object" as const, properties: {} },
  async handler() {
    const r = await client.balance();
    return { balance: r.balance, plan: r.plan };
  },
};
```

Create `E:\Project\peninglab-mcp\src\tools\get-status.ts`:

```ts
import { client } from "../client.js";

export const getStatusTool = {
  name: "get_status",
  description:
    "Look up a task by its task_id. Returns current state (pending / done / failed). Useful for tasks that exceeded the generate_* tool's max wait — call this later to check.",
  inputSchema: {
    type: "object" as const,
    required: ["task_id"],
    properties: {
      task_id: { type: "string", description: "Task ID returned by a previous generate_* call." },
    },
  },
  async handler(input: { task_id: string }) {
    return await client.status(input.task_id);
  },
};
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /e/Project/peninglab-mcp && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
cd /e/Project/peninglab-mcp && \
  git add src/tools && \
  git commit -m "feat: add 5 MCP tools (generate_image, generate_video, list_models, get_balance, get_status)"
```

---

## Task 14: src/server.ts — stdio MCP server bootstrap

**Files:**
- Create: `E:\Project\peninglab-mcp\src\server.ts`

- [ ] **Step 1: Create the server entry point**

Create `E:\Project\peninglab-mcp\src\server.ts`:

```ts
#!/usr/bin/env node
// @peninglab/mcp — stdio MCP server. Spawned by Claude Desktop /
// Cursor / any MCP client. Exposes 5 tools that proxy to
// peninglab.com /api/mcp/*.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { generateImageTool } from "./tools/generate-image.js";
import { generateVideoTool } from "./tools/generate-video.js";
import { listModelsTool } from "./tools/list-models.js";
import { getBalanceTool } from "./tools/get-balance.js";
import { getStatusTool } from "./tools/get-status.js";

const TOOLS = [
  generateImageTool,
  generateVideoTool,
  listModelsTool,
  getBalanceTool,
  getStatusTool,
];

const server = new Server(
  { name: "peninglab-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }
  try {
    const result = await (tool.handler as (input: unknown) => Promise<unknown>)(
      request.params.arguments ?? {}
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e: any) {
    return {
      content: [{ type: "text", text: `Error: ${e?.message || String(e)}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Build the package to verify it compiles**

```bash
cd /e/Project/peninglab-mcp && npm run build 2>&1 | tail -10 && ls dist/
```

Expected: `dist/server.js` exists.

- [ ] **Step 3: Smoke test the binary**

```bash
cd /e/Project/peninglab-mcp && PENINGLAB_API_KEY=pl_live_dummy node dist/server.js < /dev/null
```

Expected: it starts (no immediate crash), then exits cleanly when stdin closes. If you see "MCP server transport error" because there's no MCP client on the other end of the pipe, that's actually expected — the test is just confirming the script loads without TypeScript / import errors.

- [ ] **Step 4: Commit**

```bash
cd /e/Project/peninglab-mcp && \
  git add src/server.ts && \
  git commit -m "feat: MCP server bootstrap — wires 5 tools to stdio transport"
```

---

## Task 15: README + final packaging

**Files:**
- Create: `E:\Project\peninglab-mcp\README.md`
- Create: `E:\Project\peninglab-mcp\LICENSE`

- [ ] **Step 1: Create README.md**

Create `E:\Project\peninglab-mcp\README.md`:

```markdown
# @peninglab/mcp

MCP server for [peninglab.com](https://peninglab.com) — generate images and videos from any AI agent that supports the Model Context Protocol.

## What it does

Exposes 5 tools to your AI agent:

- `generate_image({ model, prompt, image_urls?, aspect_ratio? })` — fires an image generation and returns the final URL.
- `generate_video({ model, prompt, image_urls?, image_mode?, duration?, aspect_ratio? })` — fires a video generation and returns the final URL.
- `list_models()` — list available models with current rates.
- `get_balance()` — current credit balance (RM).
- `get_status({ task_id })` — look up a task by ID (for long-running jobs).

The `generate_*` tools wait for completion internally — they poll every 60 seconds for up to 10 minutes by default, then return the final URL synchronously to the AI agent. No webhook infrastructure required.

## Setup

### 1. Get an API key from peninglab.com

Log in to peninglab.com → `/admin/settings` → MCP API Key section → **Generate Key**. Copy the plaintext value (shown once).

### 2. Install + configure

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

\`\`\`json
{
  "mcpServers": {
    "peninglab": {
      "command": "npx",
      "args": ["-y", "@peninglab/mcp"],
      "env": {
        "PENINGLAB_API_KEY": "pl_live_..."
      }
    }
  }
}
\`\`\`

**Cursor** (`~/.cursor/mcp.json`): same shape.

Restart your MCP client → the 5 tools become available.

## Configuration

Environment variables (all optional except `PENINGLAB_API_KEY`):

| Variable | Default | Purpose |
|---|---|---|
| `PENINGLAB_API_KEY` | (required) | Your `pl_live_...` key from peninglab.com admin |
| `PENINGLAB_BASE_URL` | `https://peninglab.com` | Override for staging / self-hosted instances |
| `PENINGLAB_POLL_INTERVAL_SEC` | `60` | How often to poll task status |
| `PENINGLAB_MAX_WAIT_SEC` | `600` | Max wait per generate call before timing out |

## Costs

MCP-triggered generations charge the same RM rate as UI-triggered ones from the same peninglab.com account. The tool result includes `cost` (this call) and `balance` (remaining credits) so your AI agent can decide what to do next.

## License

MIT.
```

- [ ] **Step 2: Create LICENSE**

Create `E:\Project\peninglab-mcp\LICENSE`:

```
MIT License

Copyright (c) 2026 Muhammad Aqil Azfar Bin Che Abd Aziz

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Final commit**

```bash
cd /e/Project/peninglab-mcp && \
  git add README.md LICENSE && \
  git commit -m "docs: README + MIT LICENSE"
```

- [ ] **Step 4: Hand off the publish step to the user**

The plan does NOT auto-publish to npm — that's a one-shot user action with billing implications. Tell the user:

> The package is built and committed locally at `E:\Project\peninglab-mcp`. To publish to npm:
>
> 1. Create the GitHub repo `aqilrvsb/peninglab-mcp` (or skip — repo URL in package.json is informational)
> 2. `cd /e/Project/peninglab-mcp`
> 3. `npm login` (first time only)
> 4. `npm publish --access public`
>
> First publish takes ~30 seconds. After that, anyone can `npx @peninglab/mcp` to run it. They still need YOUR API key to actually use the tools.

---

## Task 16: End-to-end smoke test on production

**Files:** None modified.

- [ ] **Step 1: Wait for Vercel deploy of Tasks 1-9 to complete**

Vercel auto-deploys on push. Last HCKCREA commit is the `/admin/usage` MCP badge from Task 9. Wait ~60-90s after that push.

- [ ] **Step 2: Generate the API key**

Open https://peninglab.com/admin/settings → scroll to "MCP API Key" card → click **Generate Key** → copy the plaintext value to a secure location.

- [ ] **Step 3: Verify auth-check works**

```bash
curl -sS https://peninglab.com/api/mcp/auth-check \
  -H "Authorization: Bearer pl_live_YOUR_KEY_HERE" | jq
```

Expected: `{ "ok": true, "user_id": "...", "balance": <your-credits>, "plan": "..." }`.

- [ ] **Step 4: List models**

```bash
curl -sS https://peninglab.com/api/mcp/models \
  -H "Authorization: Bearer pl_live_YOUR_KEY_HERE" | jq
```

Expected: array of 7 models with rates.

- [ ] **Step 5: Submit a test image generation**

```bash
TASK_ID=$(curl -sS https://peninglab.com/api/mcp/generate/image \
  -H "Authorization: Bearer pl_live_YOUR_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{"model":"nano-banana-pro","prompt":"A glass perfume bottle on a marble surface, soft studio light, vertical 9:16"}' \
  | jq -r .task_id)

echo "Task ID: $TASK_ID"
```

Expected: task_id printed.

- [ ] **Step 6: Poll until done**

```bash
while true; do
  RESP=$(curl -sS "https://peninglab.com/api/mcp/status/$TASK_ID" -H "Authorization: Bearer pl_live_YOUR_KEY_HERE")
  STATUS=$(echo "$RESP" | jq -r .status)
  echo "Status: $STATUS"
  if [ "$STATUS" = "done" ]; then echo "$RESP" | jq; break; fi
  if [ "$STATUS" = "failed" ]; then echo "FAILED: $RESP"; break; fi
  sleep 15
done
```

Expected: eventually returns `{ "status": "done", "output_url": "https://...", "cost": ..., "balance": ... }`.

- [ ] **Step 7: Verify the row appears in /admin/usage with MCP badge**

Open https://peninglab.com/admin/usage → find the row from your test gen → confirm "MCP" badge appears next to the action chip.

- [ ] **Step 8: Smoke test the npm package locally**

```bash
cd /e/Project/peninglab-mcp && \
  PENINGLAB_API_KEY=pl_live_YOUR_KEY_HERE npx -y . <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
EOF
```

Expected: JSON response listing the 5 tools. (Stdio protocol — the input is one JSON-RPC frame, output is one frame back.)

- [ ] **Step 9: (Optional) Configure in Claude Desktop / Cursor and test from the AI agent**

Add the config snippet from the README. Restart the MCP client. In a fresh chat, ask the AI agent to call `list_models()` or `generate_image()` with a test prompt. Confirm the tool calls succeed end-to-end.

- [ ] **Step 10: Mark feature complete**

If all 9 steps pass, the MCP integration is fully live. No commit needed for this task.

---

## Self-Review

**1. Spec coverage**

| Spec section | Plan task |
|---|---|
| §1 Architecture | Tasks 1-7 (backend) + Tasks 10-14 (npm package) |
| §2 Distribution | Tasks 10 + 15 (npm publish handoff) |
| §3.1 auth-check | Task 2 |
| §3.2 models | Task 3 |
| §3.3 generate/image | Task 6 |
| §3.4 generate/video | Task 7 |
| §3.5 status | Task 5 |
| §3.6 balance | Task 4 |
| §4 No settle.ts changes | Verified — no task touches settle.ts ✓ |
| §5 API key management | Task 8 |
| §6 npm package | Tasks 10-15 |
| §7 Credits charged identically to UI | Tasks 6 + 7 use `priceFor` + `hasEnoughCredits` like UI route; insert history row that flows through the existing settle.ts deduct path. mcp_caller_id stamped for audit. ✓ |
| §8 Security (HTTPS, hash, signing) | Bcrypt hash in Task 1; signing not needed (no webhook); rate limiting deferred (V2) |
| §9 E2E verification | Task 16 smoke test |
| §10 Risks | Mitigations baked in: pre-flight 402 (Task 6/7), task ownership check (Task 5), polling timeout configurable (Task 12) |

**2. Placeholder scan** — no "TBD", "TODO", "fill in", "similar to Task" found in the plan body.

**3. Type consistency**

- `McpAuthResult` defined Task 1; consumed Tasks 2-7 via `validateMcpKey(req)`.
- `ModelEntry` defined Task 11 (npm package types); used Task 13's tools.
- `SubmitResponse`, `StatusResponse` (and its 3 variants) defined Task 11; consumed Task 13.
- `mcpCallerId(prefix)` defined Task 1; called in Tasks 6 + 7 metadata stamping.
- Backend `metadata.mcp_caller_id` written in Tasks 6+7, read in Task 9's badge JSX. ✓
- `pollUntilDone(taskId)` signature defined Task 12; called Task 13. ✓
- npm package env var `PENINGLAB_API_KEY` referenced in Tasks 11 (client), 15 (README) — consistent name. ✓

All types, signatures, and metadata key names are internally consistent.
