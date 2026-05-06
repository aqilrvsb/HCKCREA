# Auto-Mirror Generated Media to B2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-mirror every generated video and image to a new public Backblaze B2 bucket (`peninglab-content`) at generation time, so browser HTTP cache eliminates re-streaming on second view.

**Architecture:** Single hook in `lib/settle.ts` covers every Crun/P2/P3-resolved generation (UGC, Auto Content, Cinema, Image tab, Extend, fairytale-scene). Storytelling merged video already uploads to B2 — just swap the bucket. Save button becomes a no-upload flag flip. Cleanup cron prunes unsaved files past 14d.

**Tech Stack:** Next.js 16.2.4 + React 19.2.4 + Supabase Postgres+Auth+RLS + Backblaze B2 (S3-compatible) + Modal for Python workers + Vercel hosting.

**Spec:** See `docs/superpowers/specs/2026-05-05-auto-mirror-b2-design.md`. Spec is approved (commit `d9d7c62` on main).

**Verification:** All MCP Playwright scripts run on `https://peninglab.com` as `admin@gmail.com` / `admin1234` (already configured by user).

**Pre-existing build environment note:** On Windows machines, `next build` succeeds but the post-compile worker may crash with `invalid type: unit value, expected usize` (SWC native binding issue). The "✓ Compiled successfully" line is the success signal. Vercel CI builds are unaffected.

---

## File Structure

| File | Role | Touched in |
|---|---|---|
| `supabase/migrations/0030_b2_mirrored_at.sql` | NEW — schema migration: column + index + RPC | Task 1.1 |
| `lib/mirror-to-b2.ts` | NEW — helper: build content-bucket key + mirror provider URL → B2 | Task 1.2 |
| `lib/settle.ts` | MODIFY — call mirror at the success branch before storing `output_url` | Task 2.1 |
| `modal_fairytale.py` | MODIFY — bucket swap (private → content) for the merged-mp4 upload | Task 2.2 |
| `app/api/storage/save/route.ts` | MODIFY — detect content-bucket URL, skip download+upload | Task 3.1 |
| `modal_b2_backfill.py` | NEW — one-shot Modal job mirroring un-mirrored history rows | Task 3.2 |
| `modal_b2_cleanup.py` | NEW — daily Modal job deleting unsaved rows past 14d | Task 4.1 |

Total new lines: ~600. Modified across existing files: ~80.

---

## Task 1.1: Migration — `b2_mirrored_at` column + RPC

**Files:**
- Create: `supabase/migrations/0030_b2_mirrored_at.sql`

- [ ] **Step 1.1.1: Verify migrations directory + latest migration**

Run from `E:\Project\HCKCREA` (use Bash tool):
```bash
ls supabase/migrations/ | sort | tail -5
```

Expected: lines include `0029_image_models_nano_banana_v2.sql`. Confirms `0030` is the next number.

- [ ] **Step 1.1.2: Create the migration file**

Create `supabase/migrations/0030_b2_mirrored_at.sql` with this exact content:

```sql
-- 0030_b2_mirrored_at.sql
-- Auto-mirror to peninglab-content B2 bucket — track which history rows are
-- already mirrored so cleanup cron knows what to delete.
-- See docs/superpowers/specs/2026-05-05-auto-mirror-b2-design.md

ALTER TABLE history ADD COLUMN IF NOT EXISTS b2_mirrored_at TIMESTAMPTZ;

-- Partial index for the cleanup query (only rows that ARE mirrored matter).
-- Excludes the long tail of legacy/un-mirrored rows.
CREATE INDEX IF NOT EXISTS history_b2_unsaved_idx
  ON history (created_at)
  WHERE b2_mirrored_at IS NOT NULL;

-- RPC the cleanup cron calls. Returns rows where:
--   * b2_mirrored_at is set (we put the file on peninglab-content)
--   * row is older than 14 days
--   * no storage row exists for it (user did not Save → file is unsaved)
CREATE OR REPLACE FUNCTION history_unsaved_past_ttl()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  type TEXT,
  output_url TEXT,
  b2_mirrored_at TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT h.id, h.user_id, h.type, h.output_url, h.b2_mirrored_at
  FROM history h
  WHERE h.b2_mirrored_at IS NOT NULL
    AND h.created_at < NOW() - INTERVAL '14 days'
    AND NOT EXISTS (
      SELECT 1 FROM storage s WHERE s.history_id = h.id
    );
$$;

GRANT EXECUTE ON FUNCTION history_unsaved_past_ttl() TO service_role;
```

- [ ] **Step 1.1.3: Apply migration to Supabase**

The migration applies via the user's Supabase dashboard or `supabase db push` CLI. For this plan, the controller will:
1. Open Supabase Studio → SQL Editor
2. Paste the migration file content
3. Click Run
4. Confirm "Success. No rows returned"

(Implementer subagent does NOT need to run this — controller handles it after the file is committed. Implementer just creates and commits the file.)

- [ ] **Step 1.1.4: Verify column exists**

After the controller has applied the migration, verify by running this in the Supabase SQL Editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'history' AND column_name = 'b2_mirrored_at';
```

Expected: one row, `b2_mirrored_at | timestamp with time zone`.

- [ ] **Step 1.1.5: Commit**

```bash
cd /e/Project/HCKCREA
git add supabase/migrations/0030_b2_mirrored_at.sql
git commit -m "feat(history): add b2_mirrored_at column + cleanup RPC

Tracks which history rows are mirrored to peninglab-content B2
bucket. The cleanup cron's history_unsaved_past_ttl() RPC returns
rows older than 14 days that are mirrored but not in the storage
table (i.e., user never clicked Save) — those are eligible for
deletion from B2.

Adds a partial index targeted at the cleanup query (only mirrored
rows, ordered by created_at).

See docs/superpowers/specs/2026-05-05-auto-mirror-b2-design.md."
git push
```

---

## Task 1.2: Mirror helper — `lib/mirror-to-b2.ts`

**Files:**
- Create: `lib/mirror-to-b2.ts`

- [ ] **Step 1.2.1: Read the existing B2 wrapper for context**

Run (Read tool):
```
E:\Project\HCKCREA\lib\b2.ts
```

Note the `uploadBuffer` function (lines 78-143): it sends a PUT to a B2 URL using a hand-constructed SigV4 request via `@smithy/signature-v4`. We reuse this exact pattern but with the new content-bucket credentials.

- [ ] **Step 1.2.2: Create the helper file**

Create `lib/mirror-to-b2.ts` with this exact content:

```ts
// Mirror a provider URL (Crun, fal, RH temp) to the public peninglab-content
// bucket. Used by lib/settle.ts after a generation succeeds, and by the one-shot
// backfill job. Returns the final stable public URL we store in
// history.output_url.
//
// Why a separate file from lib/b2.ts: the existing wrapper is bound to the
// PRIVATE bucket via B2_KEY_ID / B2_APP_KEY / B2_BUCKET_PRIVATE env vars.
// peninglab-content has its OWN scoped key (B2_CONTENT_*) so files written
// to it are world-readable. Keeping the two helpers separate prevents an
// accidental "save the user's private file to the public bucket" mistake.
//
// Env vars (set on Vercel):
//   B2_CONTENT_BUCKET         e.g. peninglab-content
//   B2_CONTENT_KEY_ID         scoped Application Key id (NOT master)
//   B2_CONTENT_APP_KEY        scoped Application Key secret
//   B2_CONTENT_ENDPOINT       e.g. https://s3.us-east-005.backblazeb2.com
//   B2_CONTENT_REGION         e.g. us-east-005
//   B2_CONTENT_PUBLIC_BASE    e.g. https://f005.backblazeb2.com/file/peninglab-content

import { SignatureV4 } from "@smithy/signature-v4";
import { Sha256 } from "@aws-crypto/sha256-js";
import { HttpRequest } from "@smithy/protocol-http";
import { NodeHttpHandler } from "@smithy/node-http-handler";

export type ContentType =
  | "image"
  | "video"
  | "ugc"
  | "auto"
  | "cinema"
  | "fairytale"
  | "fairytale-scene"
  | "clone"
  | "seedance";

// Standard layout: users/{userId}/{type}/{historyId}.{ext}
// Same shape as lib/b2.ts buildKey() so the two buckets share path conventions.
export function buildContentKey(opts: {
  userId: string;
  type: ContentType | string;
  historyId: string;
  ext: string;
}): string {
  const ext = opts.ext.replace(/^\./, "").toLowerCase();
  return `users/${opts.userId}/${opts.type}/${opts.historyId}.${ext}`;
}

// Build the public URL for a key in the content bucket. This is what we
// store in history.output_url after a successful mirror.
export function publicUrlForKey(key: string): string {
  const base = process.env.B2_CONTENT_PUBLIC_BASE;
  if (!base) throw new Error("B2_CONTENT_PUBLIC_BASE env var missing");
  return `${base.replace(/\/$/, "")}/${key}`;
}

// Best-effort extension inference. Order: explicit override → URL path → type fallback.
export function inferExt(opts: {
  url: string;
  type: ContentType | string;
  override?: string;
}): string {
  if (opts.override) return opts.override.replace(/^\./, "").toLowerCase();
  try {
    const u = new URL(opts.url);
    const m = u.pathname.match(/\.([a-zA-Z0-9]{1,5})($|\?)/);
    if (m) return m[1].toLowerCase();
  } catch {
    /* fall through */
  }
  if (opts.type === "image" || opts.type === "fairytale-scene") return "png";
  return "mp4";
}

export function contentTypeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "png") return "image/png";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "webp") return "image/webp";
  if (e === "mp4") return "video/mp4";
  if (e === "webm") return "video/webm";
  return "application/octet-stream";
}

// Stream the source URL (provider) → PUT to peninglab-content at `key`.
// Throws on any non-2xx from either side. Returns size in bytes.
export async function mirrorToContentBucket(opts: {
  providerUrl: string;
  key: string;
  contentType: string;
}): Promise<{ key: string; size: number; publicUrl: string }> {
  const endpoint = (process.env.B2_CONTENT_ENDPOINT || "").trim();
  const region = (process.env.B2_CONTENT_REGION || "us-east-005").trim();
  const accessKeyId = (process.env.B2_CONTENT_KEY_ID || "").trim();
  const secretAccessKey = (process.env.B2_CONTENT_APP_KEY || "").trim();
  const bucket = (process.env.B2_CONTENT_BUCKET || "").trim();

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "mirror-to-b2: env vars missing — set B2_CONTENT_ENDPOINT / B2_CONTENT_KEY_ID / B2_CONTENT_APP_KEY / B2_CONTENT_BUCKET"
    );
  }

  // Pull the source bytes
  const r = await fetch(opts.providerUrl);
  if (!r.ok) {
    throw new Error(
      `mirror-to-b2: source fetch failed: HTTP ${r.status} ${opts.providerUrl.slice(0, 80)}`
    );
  }
  const ab = await r.arrayBuffer();
  const body = Buffer.from(ab);
  if (body.length === 0) {
    throw new Error("mirror-to-b2: source returned empty body");
  }

  // PUT to B2 (same SigV4 pattern as lib/b2.ts uploadBuffer — proven to work
  // around Backblaze's "request body too small" rejection of chunked uploads).
  const endpointUrl = new URL(endpoint);
  const host = `${bucket}.${endpointUrl.host}`;
  const path = "/" + opts.key.split("/").map(encodeURIComponent).join("/");

  const signer = new SignatureV4({
    credentials: { accessKeyId, secretAccessKey },
    region,
    service: "s3",
    sha256: Sha256,
    applyChecksum: false,
  });

  const { createHash } = await import("crypto");
  const bodyHash = createHash("sha256").update(body).digest("hex");

  const reqToSign = new HttpRequest({
    method: "PUT",
    protocol: "https:",
    hostname: host,
    path,
    headers: {
      host,
      "content-length": String(body.length),
      "content-type": opts.contentType,
      "x-amz-content-sha256": bodyHash,
    },
    body,
  });

  const signedReq = (await signer.sign(reqToSign, {
    unsignableHeaders: new Set(),
  })) as HttpRequest;

  const handler = new NodeHttpHandler();
  const { response } = await handler.handle(signedReq);

  const respBody: string = await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.body.on("data", (c: Buffer) => chunks.push(c));
    response.body.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    response.body.on("error", reject);
  });

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `mirror-to-b2: B2 PUT failed: HTTP ${response.statusCode} ${respBody.slice(0, 200)}`
    );
  }

  return {
    key: opts.key,
    size: body.length,
    publicUrl: publicUrlForKey(opts.key),
  };
}
```

- [ ] **Step 1.2.3: Type-check**

Run (Bash):
```bash
cd /e/Project/HCKCREA && npx tsc --noEmit --skipLibCheck 2>&1 | grep -v TS7016 | grep -E "mirror-to-b2"
```

Expected: empty output (zero errors on this file).

- [ ] **Step 1.2.4: Build**

Run (Bash):
```bash
cd /e/Project/HCKCREA && npx next build 2>&1 | tail -10
```

Expected: line `✓ Compiled successfully` near the end. (Post-compile SWC worker crash is OK on Windows — it's a pre-existing local toolchain issue. Vercel CI is unaffected.)

- [ ] **Step 1.2.5: Commit**

```bash
cd /e/Project/HCKCREA
git add lib/mirror-to-b2.ts
git commit -m "feat(b2): add mirror-to-b2 helper for peninglab-content bucket

Reuses lib/b2.ts's hand-rolled SigV4 PUT pattern (proven to work
around Backblaze's chunked-upload rejection) but binds to the new
content bucket via B2_CONTENT_* env vars. Keeping it separate from
lib/b2.ts prevents accidentally writing private files to the
public bucket.

Exports:
  buildContentKey(opts) -> users/{userId}/{type}/{historyId}.{ext}
  publicUrlForKey(key) -> stable public URL
  inferExt(opts) -> ext from URL path or type fallback
  contentTypeFromExt(ext) -> MIME string
  mirrorToContentBucket({providerUrl, key, contentType})
    -> { key, size, publicUrl }

No callers yet — wired up in Task 2.1."
git push
```

---

## Task 1.3: MCP verify env vars + spec sanity

**Files:** none modified

- [ ] **Step 1.3.1: Wait for Vercel deploy of commit from Task 1.2 (~60s)**

Run (Bash):
```bash
sleep 60
```

- [ ] **Step 1.3.2: Health-check the deployed code**

This is an end-to-end sanity check that the new helper compiled into the bundle. Run via Playwright MCP (`mcp__playwright__browser_navigate` then `mcp__playwright__browser_evaluate`):

```js
async () => {
  // Just verify the dashboard still loads after the helper code shipped.
  // No public route imports mirror-to-b2 yet (wired in Task 2.1) but the
  // build process verified imports type-check.
  return {
    ok: true,
    url: location.href,
    isDashboard: location.pathname.startsWith("/dashboard"),
  };
}
```

Expected: `{ ok: true, isDashboard: true }`. Confirms deploy succeeded.

---

## Task 2.1: Mirror hook in `lib/settle.ts`

**Files:**
- Modify: `lib/settle.ts:340-389` (the `r.status === "succeeded"` branch)

- [ ] **Step 2.1.1: Read the current settle success branch**

Run (Read tool):
```
E:\Project\HCKCREA\lib\settle.ts
```

The success branch starts at line ~342 (`if (r.status === "succeeded" && r.outputUrl) {`) and runs through the `await admin.from("history").update({ status: "done", output_url: r.outputUrl, ... })` call ending around line 389.

Note key context:
- `r.outputUrl` is the provider URL (Crun/Mountsea/etc temp)
- The UPDATE writes `output_url` and `thumbnail_url` (for video type)
- After the UPDATE, `autoSavePrompt`, `onSegmentSettled`, and `generateUgcPostMeta` run

We hook in BEFORE the UPDATE: mirror first, then write the B2 public URL into `output_url`. On mirror failure, fall back to the provider URL (gen still succeeds).

- [ ] **Step 2.1.2: Add mirror import**

In `lib/settle.ts`, find the imports block at the top (lines 11-16). Add ONE new import line right after the existing imports:

```ts
import {
  buildContentKey,
  contentTypeFromExt,
  inferExt,
  mirrorToContentBucket,
  type ContentType,
} from "@/lib/mirror-to-b2";
```

- [ ] **Step 2.1.3: Replace the success branch UPDATE**

Find this block in `lib/settle.ts` (around lines 376-389):

```ts
    await admin
      .from("history")
      .update({
        status: "done",
        output_url: r.outputUrl,
        thumbnail_url: hist.type === "video" ? r.outputUrl : null,
        // Persist the actual charged amount so admin reports show what
        // the user was billed (not the stale insert-time estimate).
        cost: chargeAmount,
        // Wipe any stale error text the row picked up before recovery
        // (e.g. "Stale — exceeded 10m without resolution").
        error_message: null,
      })
      .eq("id", hist.id);
```

Replace it with:

```ts
    // Mirror provider URL → peninglab-content public bucket BEFORE storing
    // the URL on the row. If mirror fails, gen still completes — we fall
    // back to the provider URL and leave b2_mirrored_at NULL so the
    // backfill job retries later.
    let storedOutputUrl: string = r.outputUrl;
    let mirroredAt: string | null = null;
    try {
      const ext = inferExt({ url: r.outputUrl, type: hist.type as ContentType });
      const key = buildContentKey({
        userId: hist.user_id,
        type: hist.type as ContentType,
        historyId: hist.id,
        ext,
      });
      const ctype = contentTypeFromExt(ext);
      const mirrored = await mirrorToContentBucket({
        providerUrl: r.outputUrl,
        key,
        contentType: ctype,
      });
      storedOutputUrl = mirrored.publicUrl;
      mirroredAt = new Date().toISOString();
    } catch (mirrorErr) {
      console.error(
        `[settle] mirror-to-b2 failed for history ${hist.id}: ${
          (mirrorErr as Error).message
        }. Falling back to provider URL — backfill will retry.`
      );
    }

    await admin
      .from("history")
      .update({
        status: "done",
        output_url: storedOutputUrl,
        thumbnail_url: hist.type === "video" ? storedOutputUrl : null,
        b2_mirrored_at: mirroredAt,
        // Persist the actual charged amount so admin reports show what
        // the user was billed (not the stale insert-time estimate).
        cost: chargeAmount,
        // Wipe any stale error text the row picked up before recovery
        // (e.g. "Stale — exceeded 10m without resolution").
        error_message: null,
      })
      .eq("id", hist.id);
```

Note: the `onSegmentSettled` call right after this UPDATE currently passes `r.outputUrl` (the provider URL). It also needs to use the stored URL. Find this line (around line 399):

```ts
    await onSegmentSettled({ ...hist, output_url: r.outputUrl }, r.outputUrl).catch(
```

Replace with:

```ts
    await onSegmentSettled({ ...hist, output_url: storedOutputUrl }, storedOutputUrl).catch(
```

- [ ] **Step 2.1.4: Type-check**

Run (Bash):
```bash
cd /e/Project/HCKCREA && npx tsc --noEmit --skipLibCheck 2>&1 | grep -v TS7016 | grep -E "settle|mirror-to-b2"
```

Expected: empty output.

- [ ] **Step 2.1.5: Build**

Run (Bash):
```bash
cd /e/Project/HCKCREA && npx next build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 2.1.6: Commit**

```bash
cd /e/Project/HCKCREA
git add lib/settle.ts
git commit -m "feat(settle): mirror provider URL to peninglab-content at success

When P2/P3 reports a generation succeeded, stream the provider URL
to the public B2 content bucket BEFORE writing output_url. Stable
public URL goes in output_url + thumbnail_url; b2_mirrored_at is
set to NOW().

If mirror fails (B2 hiccup, source URL already 404), gen still
completes — we fall back to storing the provider URL and leave
b2_mirrored_at NULL. The backfill job (Task 3.2) will retry those
rows later.

Covers every Crun/P2/P3 settled row: UGC, Auto Content, Cinema,
Image tab, Extend, fairytale-scene. Storytelling merged-mp4 has
its own Modal-side B2 upload (Task 2.2 swaps that bucket too)."
git push
```

---

## Task 2.2: Modal storytelling worker — bucket swap

**Files:**
- Modify: `modal_fairytale.py` (3 spots: env var name + presign URL helper + signed_url usage)

- [ ] **Step 2.2.1: Read modal_fairytale.py around the upload**

Run (Read tool, with offset 540, limit 110):
```
E:\Project\HCKCREA\modal_fairytale.py
```

Note three callsites:
- Line 28: env var declared in Modal image: `B2_BUCKET_PRIVATE=peninglab-storage`
- Line 546: `_b2_sign_v4()` reads `os.environ["B2_BUCKET_PRIVATE"]` to construct upload URL
- Line 638: `_presign_b2_get()` reads same env for the signed GET URL
- Line 894: `_upload_b2(final_path, b2_key)` puts the file
- Line 895: `signed_url = _presign_b2_get(b2_key, expires_sec=7 * 86400)`
- Line 904: stores `signed_url` in `history.output_url`

We swap the bucket entirely: storytelling videos go to `peninglab-content`. Since that bucket is public, we no longer need a presigned URL — we generate the public URL directly.

- [ ] **Step 2.2.2: Add new env var to Modal image declaration**

Find line ~28 in `modal_fairytale.py` where the Modal `Image` is declared with `os` env vars:

```python
      B2_BUCKET_PRIVATE=peninglab-storage
```

(The exact pattern is part of an `Image.from_registry(...).env({...})` block. Look for the dict that includes `B2_BUCKET_PRIVATE`.)

ADD a sibling line in the same env dict:

```python
      B2_CONTENT_BUCKET=peninglab-content
      B2_CONTENT_PUBLIC_BASE=https://f005.backblazeb2.com/file/peninglab-content
```

(Both bucket env vars stay set — `B2_BUCKET_PRIVATE` is still used by other code paths in the worker. We just add the content one.)

- [ ] **Step 2.2.3: Add new helper `_b2_content_public_url`**

Insert this function definition right above `def _upload_b2(local_path: Path, b2_key: str) -> None:` (currently at line 605):

```python
def _b2_content_public_url(b2_key: str) -> str:
    """Build the public URL for an object in peninglab-content (no signing)."""
    import os

    base = os.environ["B2_CONTENT_PUBLIC_BASE"].rstrip("/")
    return f"{base}/{b2_key}"


def _upload_b2_content(local_path: Path, b2_key: str, content_type: str = "video/mp4") -> None:
    """PUT a local file to peninglab-content (public bucket).

    Uses the same SigV4 implementation as _upload_b2 but targets the content
    bucket via env vars B2_CONTENT_BUCKET / B2_CONTENT_KEY_ID / B2_CONTENT_APP_KEY.
    The endpoint + region are shared with the private bucket.
    """
    import os
    import datetime
    import hashlib
    import hmac
    from pathlib import Path
    from urllib.parse import urlparse, quote

    import requests

    with open(local_path, "rb") as f:
        body = f.read()

    endpoint = os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_REGION", "us-east-005")
    access_key = os.environ["B2_CONTENT_KEY_ID"]
    secret_key = os.environ["B2_CONTENT_APP_KEY"]
    bucket = os.environ["B2_CONTENT_BUCKET"]

    endpoint_host = urlparse(endpoint).netloc
    host = f"{bucket}.{endpoint_host}"
    canonical_uri = "/" + quote(b2_key, safe="/")

    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "content-length": str(len(body)),
        "content-type": content_type,
    }

    sorted_keys = sorted(headers)
    signed_headers = ";".join(sorted_keys)
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in sorted_keys)

    canonical_request = "\n".join(
        [
            "PUT",
            canonical_uri,
            "",
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )

    def _hmac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k_date = _hmac(("AWS4" + secret_key).encode(), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, "s3")
    k_signing = _hmac(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    out_headers = {
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": auth,
        "Host": host,
        "Content-Length": str(len(body)),
        "Content-Type": content_type,
    }

    r = requests.put(
        f"https://{host}{canonical_uri}",
        data=body,
        headers=out_headers,
        timeout=300,
    )
    if r.status_code < 200 or r.status_code >= 300:
        raise RuntimeError(
            f"B2 content upload failed: HTTP {r.status_code} {r.text[:300]}"
        )
```

- [ ] **Step 2.2.4: Swap upload + URL generation in the merged-mp4 path**

Find these lines (around lines 893-906 in `modal_fairytale.py`):

```python
        user_id = payload.get("user_id") or "anon"
        b2_key = _b2_key_for(user_id, history_id)
        _upload_b2(final_path, b2_key)
        signed_url = _presign_b2_get(b2_key, expires_sec=7 * 86400)

        elapsed = time.time() - started
        # Clear error_message too — if Vercel's after() previously stamped a
        # timeout / 422, that stale message would otherwise stay on a row
        # whose status is now 'done'.
        _update_history(
            history_id,
            status="done",
            output_url=signed_url,
            thumbnail_url=signed_url,
            error_message=None,
        )
```

Replace with:

```python
        user_id = payload.get("user_id") or "anon"
        b2_key = _b2_key_for(user_id, history_id)
        # Upload to the new public peninglab-content bucket.
        # Stable public URL = no signing, browser HTTP cache works forever.
        _upload_b2_content(final_path, b2_key, content_type="video/mp4")
        public_url = _b2_content_public_url(b2_key)

        elapsed = time.time() - started
        # Clear error_message too — if Vercel's after() previously stamped a
        # timeout / 422, that stale message would otherwise stay on a row
        # whose status is now 'done'.
        # b2_mirrored_at = NOW() so cleanup cron sees this row as
        # "mirrored to content bucket" (same semantics as Vercel-side mirrors).
        from datetime import datetime, timezone

        _update_history(
            history_id,
            status="done",
            output_url=public_url,
            thumbnail_url=public_url,
            error_message=None,
            b2_mirrored_at=datetime.now(timezone.utc).isoformat(),
        )
```

- [ ] **Step 2.2.5: Update `_update_history` signature to accept `b2_mirrored_at`**

Find the `def _update_history(...)` definition in `modal_fairytale.py` (search for `def _update_history`). It probably accepts kwargs that pass through to a Supabase UPDATE. If the function uses `**kwargs` it works as-is. If it has explicit params, ADD `b2_mirrored_at: str | None = None` to the signature and pass it through to the UPDATE payload only when not None.

Specifically, find the function and look at what it does. Common pattern:

```python
def _update_history(history_id: str, **fields) -> None:
    supabase.table("history").update(fields).eq("id", history_id).execute()
```

If that's the shape, no change needed — `b2_mirrored_at` flows through `**fields`.

If the function is explicitly typed (e.g., `def _update_history(history_id, status, output_url=None, ...)`):

ADD `b2_mirrored_at: str | None = None` to the params list, and ensure the body conditionally includes it in the update payload:
```python
update = {"status": status}
if output_url is not None:
    update["output_url"] = output_url
# ... etc
if b2_mirrored_at is not None:
    update["b2_mirrored_at"] = b2_mirrored_at
supabase.table("history").update(update).eq("id", history_id).execute()
```

- [ ] **Step 2.2.6: Verify Modal Python syntax**

Run (Bash, on Windows PowerShell or Git Bash):
```bash
cd /e/Project/HCKCREA && python -m py_compile modal_fairytale.py
```

Expected: no output (silent success). Errors mean syntax issue.

If `python` isn't on PATH, try `py` or skip this step — the next deploy will surface any syntax errors.

- [ ] **Step 2.2.7: Deploy the updated Modal worker**

Run (PowerShell, with proper env):
```bash
cd /e/Project/HCKCREA
# Modal CLI may be invoked via python -m or modal directly
python -m modal deploy modal_fairytale.py 2>&1 | tail -20
```

Expected: `App deployed in 'main' environment` or similar success message.

If `modal` CLI is not configured, the user runs this command manually. The implementer subagent should NOT block on this — they commit the file and the controller handles deployment.

- [ ] **Step 2.2.8: Commit**

```bash
cd /e/Project/HCKCREA
git add modal_fairytale.py
git commit -m "feat(modal): storytelling video uploads to peninglab-content

Swap the merged-mp4 destination from peninglab-storage (private,
7-day signed URLs) to peninglab-content (public, stable URLs).
Adds B2_CONTENT_* env vars to the Modal image declaration and
introduces _upload_b2_content + _b2_content_public_url that reuse
the existing SigV4 pattern but target the content bucket.

The history row's output_url + thumbnail_url now contain the
stable public URL (no presigning, no expiry), and b2_mirrored_at
is set to NOW() so the cleanup cron treats it consistently with
Vercel-side mirrored rows.

Existing Save flow + storage table semantics unchanged — Save still
just records that this URL is permanent (Task 3.1 simplifies that
path further)."
git push
```

---

## Task 2.3: MCP verify — generate fresh image + UGC + Cinema

**Files:** none modified

This task verifies Tasks 2.1 + 2.2 work end-to-end on production.

- [ ] **Step 2.3.1: Wait 60s for Vercel deploy**

```bash
sleep 60
```

- [ ] **Step 2.3.2: Verify dashboard is accessible as admin**

Use `mcp__playwright__browser_navigate` to go to `https://peninglab.com/dashboard`. Then `mcp__playwright__browser_evaluate`:

```js
() => ({
  url: location.href,
  loggedIn: !!document.querySelector('aside'),
  email: document.body.innerText.match(/admin@gmail\.com/)?.[0] || null,
})
```

Expected: `loggedIn: true, email: "admin@gmail.com"`. If not, manually log in via UI before continuing.

- [ ] **Step 2.3.3: Click EXCLUSIVE then Image tab**

Use `mcp__playwright__browser_evaluate`:

```js
async () => {
  const aside = document.querySelector('aside');
  const exc = Array.from(aside.querySelectorAll('[role="button"]')).find(
    el => /^EXCLUSIVE$/i.test((el.textContent || '').trim())
  );
  exc?.click();
  await new Promise(f => setTimeout(f, 1500));
  const img = Array.from(document.querySelectorAll('main button')).find(
    b => /^Image\d/i.test((b.textContent || '').trim())
  );
  img?.click();
  await new Promise(f => setTimeout(f, 2000));
  return { ok: true };
}
```

- [ ] **Step 2.3.4: Generate one test image**

Use `mcp__playwright__browser_evaluate` to type a prompt and click Generate. The exact selectors depend on UI; broadly:

```js
async () => {
  // Find the prompt textarea on the Image tab
  const ta = document.querySelector('main textarea');
  if (!ta) return { error: 'no textarea found' };
  ta.focus();
  // Use native value setter for React-controlled inputs
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, 'a red apple on white background, studio lighting');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(f => setTimeout(f, 500));

  const genBtn = Array.from(document.querySelectorAll('main button')).find(
    b => /^Generate/i.test((b.textContent || '').trim())
  );
  if (!genBtn || genBtn.disabled) return { error: 'generate button disabled or missing' };
  genBtn.click();

  return { ok: true, generated: true };
}
```

- [ ] **Step 2.3.5: Wait for the generated image to appear (up to 90s)**

```js
async () => {
  const start = Date.now();
  while (Date.now() - start < 90_000) {
    // After settle, the new card lands at top of history grid as a fresh image
    const cards = document.querySelectorAll('main img[src*="peninglab-content"]');
    if (cards.length > 0) {
      return {
        ok: true,
        elapsed_ms: Date.now() - start,
        first_url: cards[0].src,
      };
    }
    await new Promise(f => setTimeout(f, 3000));
  }
  return { ok: false, timeout: true };
}
```

Expected: `ok: true`, `first_url` contains `peninglab-content` and `f005.backblazeb2.com`.

If timeout: settle.ts may not be hitting the success branch. Check Vercel function logs for `[settle] mirror-to-b2 failed` — that indicates B2 connectivity issue.

- [ ] **Step 2.3.6: Verify cache hit on refresh**

```js
async () => {
  // Reload the page and see if the new image's URL re-fires through network.
  // mcp__playwright__browser_network_requests gives wire-level visibility.
  // For inline script: just snapshot the page and confirm img is still rendered.
  location.reload();
}
```

Then call `mcp__playwright__browser_network_requests` after page settles. The `peninglab-content` URL should NOT appear in the network list (browser cache hit) for the image we just generated.

Expected: image URL absent from network log → cache works. ✅

- [ ] **Step 2.3.7: Mark Task 2 complete**

If 2.3.5 returned `ok: true` and 2.3.6 confirmed cache hit, Task 2 is verified.

If either failed, ESCALATE — don't proceed to Task 3.

---

## Task 3.1: Storage save flow — skip upload when already on content bucket

**Files:**
- Modify: `app/api/storage/save/route.ts`

- [ ] **Step 3.1.1: Read current save route**

Run (Read tool):
```
E:\Project\HCKCREA\app\api\storage\save\route.ts
```

Key existing logic (lines 109-142): `uploadFromUrl(hist.output_url → b2_key)` then `signedGetUrl(b2_key)` then INSERT into `storage` with `b2_bucket = bucketPrivate()`. We need to detect when `hist.output_url` is already a `peninglab-content` URL and skip the upload entirely.

- [ ] **Step 3.1.2: Add detection helper at top of file**

Insert this helper function right after the imports block (around line 6, before `export const runtime`):

```ts
// Detect whether a URL points at the public peninglab-content bucket.
// If so, the file is already on B2 — Save just records a storage row;
// no download + re-upload needed.
function isContentBucketUrl(url: string): boolean {
  const base = process.env.B2_CONTENT_PUBLIC_BASE;
  if (!base) return false;
  return url.startsWith(base);
}

// Derive the B2 key from a peninglab-content public URL.
// Inverse of publicUrlForKey().
function keyFromContentUrl(url: string): string | null {
  const base = process.env.B2_CONTENT_PUBLIC_BASE;
  if (!base || !url.startsWith(base)) return null;
  return url.slice(base.length).replace(/^\//, "");
}
```

- [ ] **Step 3.1.3: Add the fast-path branch**

Find the section that does the upload (lines ~109-142, starting with `// Copy from temp URL → user's B2 folder`). Replace the entire block from the comment through the final `await admin.from("storage").insert({...})` with:

```ts
  // Fast path: history.output_url is ALREADY on peninglab-content (auto-mirrored
  // at gen time). Skip the download+upload — just record a storage row pointing
  // at the existing key, and use the public URL as the cached_url. Quota still
  // counts the file against the user's 1024MB.
  if (isContentBucketUrl(hist.output_url)) {
    const contentKey = keyFromContentUrl(hist.output_url);
    if (!contentKey) {
      return NextResponse.json(
        { error: "Failed to parse content-bucket URL" },
        { status: 500 }
      );
    }

    const ext = extFromUrlOrType(hist.output_url, type);
    const ctype = contentTypeFor(ext);

    // HEAD the public URL to get size_bytes — needed for quota accounting.
    let sizeBytes = 0;
    try {
      const h = await fetch(hist.output_url, { method: "HEAD" });
      const cl = h.headers.get("content-length");
      sizeBytes = cl ? Number(cl) : 0;
    } catch {
      sizeBytes = 0; // best-effort
    }

    await admin.from("storage").insert({
      user_id: user.id,
      history_id: historyId,
      type,
      b2_bucket: process.env.B2_CONTENT_BUCKET || "peninglab-content",
      b2_key: contentKey,
      size_bytes: sizeBytes,
      content_type: ctype,
      source_url: hist.output_url,
      // cached_url is the same stable public URL — no expiry needed but
      // the column is NOT NULL with a future date for back-compat.
      cached_url: hist.output_url,
      cached_url_exp: new Date(Date.now() + 5 * 365 * 86400_000).toISOString(),
    });

    return NextResponse.json({
      ok: true,
      saved: true,
      url: hist.output_url,
      key: contentKey,
      size_bytes: sizeBytes,
      used_mb: ((usedBytes + sizeBytes) / (1024 * 1024)).toFixed(2),
      quota_mb: quotaMb,
      fast_path: true,
    });
  }

  // Slow path (legacy): output_url is still a provider URL (mirror failed,
  // or this is a pre-feature row that hasn't been backfilled yet).
  // Download + upload to peninglab-storage like before.
  const ext = extFromUrlOrType(hist.output_url, type);
  const key = buildKey({ userId: user.id, type, historyId, ext });
  const ctype = contentTypeFor(ext);

  let uploaded;
  try {
    uploaded = await uploadFromUrl({
      url: hist.output_url,
      key,
      contentType: ctype,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Save failed: ${e?.message || "B2 upload error"}` },
      { status: 502 }
    );
  }

  // Mint a 7-day signed URL the frontend can cache
  const signedUrl = await signedGetUrl({ key });

  await admin.from("storage").insert({
    user_id: user.id,
    history_id: historyId,
    type,
    b2_bucket: bucketPrivate(),
    b2_key: key,
    size_bytes: uploaded.size,
    content_type: ctype,
    source_url: hist.output_url,
    cached_url: signedUrl,
    cached_url_exp: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });

  return NextResponse.json({
    ok: true,
    saved: true,
    url: signedUrl,
    key,
    size_bytes: uploaded.size,
    used_mb: ((usedBytes + uploaded.size) / (1024 * 1024)).toFixed(2),
    quota_mb: quotaMb,
  });
}
```

Note: the original block had the `const ext = extFromUrlOrType(...)` and following statements in the same scope as `usedBytes` and `usedMb` declared earlier. The fast-path branch's `return` exits the function. The slow-path branch is reachable only when fast-path didn't return, so there's no name shadowing issue.

- [ ] **Step 3.1.4: Type-check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit --skipLibCheck 2>&1 | grep -v TS7016 | grep -E "storage/save"
```

Expected: empty.

- [ ] **Step 3.1.5: Build**

```bash
cd /e/Project/HCKCREA && npx next build 2>&1 | tail -10
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 3.1.6: Commit**

```bash
cd /e/Project/HCKCREA
git add app/api/storage/save/route.ts
git commit -m "feat(storage/save): fast path when output_url is on content bucket

When history.output_url already points at peninglab-content (auto-
mirrored at gen time), Save is just a metadata flip: HEAD for size,
INSERT storage row pointing at the same key, return immediately.
No download, no upload, <100ms total.

Slow path (provider URL) preserved for legacy rows that haven't
been backfilled — keeps all existing behavior. The fast path
detects content URLs via B2_CONTENT_PUBLIC_BASE prefix match.

Quota still counts the file. Storage section + delete flow
unchanged — they read the same storage table."
git push
```

---

## Task 3.2: Modal backfill worker (admin canary first, then all users)

**Files:**
- Create: `modal_b2_backfill.py`

- [ ] **Step 3.2.1: Read existing modal_fairytale.py preamble for patterns**

Run (Read tool, offset 1, limit 100):
```
E:\Project\HCKCREA\modal_fairytale.py
```

Note the Modal app declaration pattern, image build, env var injection, and Supabase service-role usage. Reuse the same patterns.

- [ ] **Step 3.2.2: Create the backfill worker**

Create `E:\Project\HCKCREA\modal_b2_backfill.py` with this exact content:

```python
"""Backfill peninglab-content B2 bucket from existing history rows.

For every history row where:
  - status = 'done'
  - output_url is set
  - output_url is NOT already a peninglab-content URL
  - b2_mirrored_at is NULL
this worker fetches the provider URL and re-uploads to peninglab-content,
then UPDATEs history.output_url to the new stable public URL and stamps
b2_mirrored_at = NOW().

Safe to re-run — fully idempotent. Rows where the provider URL has already
expired (HTTP 4xx) are skipped + logged; the UI hides them via the 14-day
TTL filter anyway.

Run modes:
  - default: one user (set USER_ID env var)
  - --all: every user
  - --dry-run: log what would be uploaded, no writes

Run via Modal CLI:
  modal run modal_b2_backfill.py::backfill_user --user-id=<uuid>
  modal run modal_b2_backfill.py::backfill_all
  modal run modal_b2_backfill.py::backfill_user --user-id=<uuid> --dry-run
"""

import datetime
import hashlib
import hmac
import os
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse, quote

import modal

app = modal.App("hckcrea-b2-backfill")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("supabase==2.4.6", "requests==2.32.3")
)

# Reuse the same B2_* + B2_CONTENT_* secrets as modal_fairytale.
# The user must have created `b2-content-secrets` in Modal containing:
#   B2_ENDPOINT, B2_REGION, B2_CONTENT_KEY_ID, B2_CONTENT_APP_KEY,
#   B2_CONTENT_BUCKET, B2_CONTENT_PUBLIC_BASE
# And `supabase-service` containing:
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
secrets = [
    modal.Secret.from_name("supabase-service"),
    modal.Secret.from_name("b2-content-secrets"),
]


def _supabase():
    from supabase import create_client

    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def _ext_from_url(url: str, row_type: str) -> str:
    """Best-effort extension from URL path; fall back by type."""
    try:
        u = urlparse(url)
        last = u.path.rsplit("/", 1)[-1]
        if "." in last:
            ext = last.rsplit(".", 1)[-1].lower()
            if 1 <= len(ext) <= 5 and ext.isalnum():
                return ext
    except Exception:
        pass
    if row_type in ("image", "fairytale-scene"):
        return "png"
    return "mp4"


def _content_type(ext: str) -> str:
    e = ext.lower()
    if e == "png":
        return "image/png"
    if e in ("jpg", "jpeg"):
        return "image/jpeg"
    if e == "webp":
        return "image/webp"
    if e == "mp4":
        return "video/mp4"
    if e == "webm":
        return "video/webm"
    return "application/octet-stream"


def _b2_content_put(b2_key: str, body: bytes, content_type: str) -> None:
    """SigV4 PUT to peninglab-content."""
    import requests

    endpoint = os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_REGION", "us-east-005")
    access_key = os.environ["B2_CONTENT_KEY_ID"]
    secret_key = os.environ["B2_CONTENT_APP_KEY"]
    bucket = os.environ["B2_CONTENT_BUCKET"]

    endpoint_host = urlparse(endpoint).netloc
    host = f"{bucket}.{endpoint_host}"
    canonical_uri = "/" + quote(b2_key, safe="/")

    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "content-length": str(len(body)),
        "content-type": content_type,
    }

    sorted_keys = sorted(headers)
    signed_headers = ";".join(sorted_keys)
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in sorted_keys)

    canonical_request = "\n".join(
        ["PUT", canonical_uri, "", canonical_headers, signed_headers, payload_hash]
    )
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )

    def _hmac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k_date = _hmac(("AWS4" + secret_key).encode(), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, "s3")
    k_signing = _hmac(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    out_headers = {
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": auth,
        "Host": host,
        "Content-Length": str(len(body)),
        "Content-Type": content_type,
    }

    r = requests.put(
        f"https://{host}{canonical_uri}",
        data=body,
        headers=out_headers,
        timeout=300,
    )
    if r.status_code < 200 or r.status_code >= 300:
        raise RuntimeError(f"B2 PUT failed: HTTP {r.status_code} {r.text[:300]}")


def _public_url(b2_key: str) -> str:
    base = os.environ["B2_CONTENT_PUBLIC_BASE"].rstrip("/")
    return f"{base}/{b2_key}"


def _process_row(row: dict, dry_run: bool) -> dict:
    """Returns {status: 'mirrored' | 'skipped_404' | 'skipped_already' | 'error'}."""
    import requests

    rid = row["id"]
    user_id = row["user_id"]
    row_type = row.get("type") or "video"
    output_url = row.get("output_url") or ""

    if not output_url:
        return {"status": "skipped_no_url"}

    # Already on content bucket?
    base = os.environ["B2_CONTENT_PUBLIC_BASE"].rstrip("/")
    if output_url.startswith(base):
        # Stamp b2_mirrored_at if NULL
        sb = _supabase()
        sb.table("history").update(
            {"b2_mirrored_at": datetime.datetime.utcnow().isoformat() + "Z"}
        ).eq("id", rid).is_("b2_mirrored_at", "null").execute()
        return {"status": "skipped_already_content"}

    # Pull source bytes
    try:
        r = requests.get(output_url, timeout=60)
    except Exception as e:
        return {"status": "error", "error": f"fetch_exception: {e}"}
    if r.status_code >= 400:
        return {"status": "skipped_404", "error": f"HTTP {r.status_code}"}
    body = r.content
    if len(body) == 0:
        return {"status": "skipped_404", "error": "empty body"}

    ext = _ext_from_url(output_url, row_type)
    b2_key = f"users/{user_id}/{row_type}/{rid}.{ext}"
    ctype = _content_type(ext)
    new_url = _public_url(b2_key)

    if dry_run:
        return {
            "status": "would_mirror",
            "key": b2_key,
            "size": len(body),
            "new_url": new_url,
        }

    try:
        _b2_content_put(b2_key, body, ctype)
    except Exception as e:
        return {"status": "error", "error": f"b2_put: {e}"}

    sb = _supabase()
    sb.table("history").update(
        {
            "output_url": new_url,
            "thumbnail_url": new_url if row_type == "video" else None,
            "b2_mirrored_at": datetime.datetime.utcnow().isoformat() + "Z",
        }
    ).eq("id", rid).execute()

    return {"status": "mirrored", "key": b2_key, "size": len(body), "new_url": new_url}


@app.function(image=image, secrets=secrets, timeout=3600)
def backfill_user(user_id: str, dry_run: bool = False) -> dict:
    """Backfill ONE user's history. Use for canary (admin@gmail.com)."""
    sb = _supabase()
    rows = (
        sb.table("history")
        .select("id, user_id, type, output_url")
        .eq("user_id", user_id)
        .eq("status", "done")
        .is_("b2_mirrored_at", "null")
        .execute()
    )

    counts = {
        "total": 0,
        "mirrored": 0,
        "skipped_already_content": 0,
        "skipped_404": 0,
        "skipped_no_url": 0,
        "would_mirror": 0,
        "error": 0,
    }
    examples = []

    for row in rows.data or []:
        counts["total"] += 1
        result = _process_row(row, dry_run)
        status = result["status"]
        counts[status] = counts.get(status, 0) + 1
        if len(examples) < 5 and status in ("mirrored", "would_mirror", "error"):
            examples.append({"id": row["id"], **result})

    return {"user_id": user_id, "dry_run": dry_run, "counts": counts, "examples": examples}


@app.function(image=image, secrets=secrets, timeout=86400)  # up to 24h
def backfill_all(dry_run: bool = False, batch_size: int = 100) -> dict:
    """Backfill ALL users. Run after canary verifies."""
    sb = _supabase()

    # Get distinct users with un-mirrored rows
    users_resp = (
        sb.table("history")
        .select("user_id")
        .eq("status", "done")
        .is_("b2_mirrored_at", "null")
        .execute()
    )
    user_ids = list({row["user_id"] for row in (users_resp.data or [])})

    aggregate = {
        "users_processed": 0,
        "total": 0,
        "mirrored": 0,
        "skipped_already_content": 0,
        "skipped_404": 0,
        "skipped_no_url": 0,
        "would_mirror": 0,
        "error": 0,
    }

    for user_id in user_ids:
        result = backfill_user.local(user_id, dry_run)
        aggregate["users_processed"] += 1
        for k, v in result["counts"].items():
            aggregate[k] = aggregate.get(k, 0) + v

    return {"dry_run": dry_run, "user_count": len(user_ids), "aggregate": aggregate}
```

- [ ] **Step 3.2.3: Verify Python syntax**

```bash
cd /e/Project/HCKCREA && python -m py_compile modal_b2_backfill.py
```

Expected: silent success.

- [ ] **Step 3.2.4: Set up Modal secrets (one-time, controller does this)**

The controller (or user) needs Modal secrets configured:
- `supabase-service` — must contain `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- `b2-content-secrets` — must contain `B2_ENDPOINT`, `B2_REGION`, `B2_CONTENT_KEY_ID`, `B2_CONTENT_APP_KEY`, `B2_CONTENT_BUCKET`, `B2_CONTENT_PUBLIC_BASE`

If `supabase-service` already exists from `modal_fairytale.py`, skip. The new `b2-content-secrets` may need creation:

```bash
modal secret create b2-content-secrets \
  B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com \
  B2_REGION=us-east-005 \
  B2_CONTENT_KEY_ID=<from B2 console> \
  B2_CONTENT_APP_KEY=<from B2 console> \
  B2_CONTENT_BUCKET=peninglab-content \
  B2_CONTENT_PUBLIC_BASE=https://f005.backblazeb2.com/file/peninglab-content
```

Implementer subagent does NOT run this — it's a Modal CLI call against the user's account. Controller handles after spec compliance review.

- [ ] **Step 3.2.5: Deploy the backfill worker (controller)**

```bash
cd /e/Project/HCKCREA && python -m modal deploy modal_b2_backfill.py 2>&1 | tail -10
```

Expected: `App deployed`.

- [ ] **Step 3.2.6: Find admin@gmail.com user_id (controller)**

Open Supabase Studio → SQL Editor:
```sql
SELECT id FROM auth.users WHERE email = 'admin@gmail.com';
```

Copy the UUID for the next step.

- [ ] **Step 3.2.7: Dry-run the backfill on admin (controller)**

```bash
cd /e/Project/HCKCREA && python -m modal run modal_b2_backfill.py::backfill_user --user-id=<admin-uuid> --dry-run
```

Expected output: a `counts` dict showing `total > 0` and `would_mirror > 0`. No actual writes happen yet.

If `total = 0`, all admin's rows are already mirrored or have NULL output_url — skip to Task 4.

- [ ] **Step 3.2.8: Real run — admin canary (controller)**

```bash
cd /e/Project/HCKCREA && python -m modal run modal_b2_backfill.py::backfill_user --user-id=<admin-uuid>
```

Expected: `counts.mirrored > 0`. Examples in the result show the new `peninglab-content` URLs.

- [ ] **Step 3.2.9: MCP verify admin's history works after backfill**

Use `mcp__playwright__browser_navigate` to https://peninglab.com/dashboard, then `mcp__playwright__browser_evaluate`:

```js
async () => {
  // Click EXCLUSIVE then UGC then scroll to history
  const aside = document.querySelector('aside');
  const exc = Array.from(aside.querySelectorAll('[role="button"]')).find(
    el => /^EXCLUSIVE$/i.test((el.textContent || '').trim())
  );
  exc?.click();
  await new Promise(f => setTimeout(f, 1500));
  const ugc = Array.from(document.querySelectorAll('main button')).find(
    b => /^UGC\d/i.test((b.textContent || '').trim())
  );
  ugc?.click();
  await new Promise(f => setTimeout(f, 4000));

  const sec = Array.from(document.querySelectorAll('main *')).find(
    el => /^History — UGC/i.test((el.textContent || '').trim().slice(0, 30))
  );
  sec?.scrollIntoView({ block: 'start' });
  await new Promise(f => setTimeout(f, 800));

  const videos = Array.from(document.querySelectorAll('main video, main img'))
    .filter(el => el.src && /peninglab-content/.test(el.src))
    .map(el => ({ tag: el.tagName, srcSnip: el.src.slice(0, 90) }));

  return {
    media_on_content_bucket: videos.length,
    sample: videos.slice(0, 3),
  };
}
```

Expected: `media_on_content_bucket > 0` with sample URLs containing `peninglab-content`. ✅ canary verified.

- [ ] **Step 3.2.10: MCP verify Save fast path**

```js
async () => {
  // Find one card with a peninglab-content video
  const cards = document.querySelectorAll('main [class*="rounded-xl"]');
  const target = Array.from(cards).find(c => c.querySelector('video, img')?.src?.includes('peninglab-content'));
  if (!target) return { error: 'no content-bucket card' };

  // Find Save button (validity badge with cloud-save icon)
  const saveBtn = Array.from(target.querySelectorAll('button')).find(
    b => /save/i.test(b.title || '') || /\d+d/.test((b.textContent || '').trim())
  );
  if (!saveBtn) return { error: 'no save button' };

  // Time the click → response
  const t0 = performance.now();
  saveBtn.click();
  await new Promise(f => setTimeout(f, 2000));
  const t1 = performance.now() - t0;

  return { save_click_to_settled_ms: Math.round(t1) };
}
```

Expected: `save_click_to_settled_ms < 1000`. The fast path skips download+upload so the visible UI flip is sub-second.

- [ ] **Step 3.2.11: Commit**

```bash
cd /e/Project/HCKCREA
git add modal_b2_backfill.py
git commit -m "feat(modal): one-shot B2 content-bucket backfill worker

Iterates history rows where status='done', output_url is set, and
b2_mirrored_at IS NULL. Streams the provider URL → PUT to
peninglab-content → UPDATEs history.output_url to the public URL
+ stamps b2_mirrored_at = NOW().

Three Modal entrypoints:
  backfill_user(user_id, dry_run)  — single user, used as canary
  backfill_all(dry_run, batch_size) — every user with un-mirrored rows

Idempotent: rows already on peninglab-content just get the
timestamp stamped; rows where the provider URL is already 4xx
are skipped+logged (UI hides them via 14-day TTL filter anyway).

Reuses the SigV4 PUT pattern from modal_fairytale (proven against
Backblaze's chunked-upload rejection)."
git push
```

---

## Task 4.1: Modal cleanup cron — daily B2 prune

**Files:**
- Create: `modal_b2_cleanup.py`

- [ ] **Step 4.1.1: Create the cleanup worker**

Create `E:\Project\HCKCREA\modal_b2_cleanup.py`:

```python
"""Daily cron — prune unsaved B2 files past 14 days.

Calls the history_unsaved_past_ttl() RPC (added in migration 0030),
deletes each returned row's B2 object from peninglab-content, and
clears b2_mirrored_at to mark the cleanup as idempotent (so re-runs
don't try to re-delete the same key).

Does NOT delete the history row itself — UI already hides it via the
14-day TTL filter.

Schedule: every day at 19:00 UTC (03:00 MYT — Malaysia low traffic).
"""

import datetime
import hashlib
import hmac
import os
from urllib.parse import urlparse, quote

import modal

app = modal.App("hckcrea-b2-cleanup")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("supabase==2.4.6", "requests==2.32.3")
)

secrets = [
    modal.Secret.from_name("supabase-service"),
    modal.Secret.from_name("b2-content-secrets"),
]


def _supabase():
    from supabase import create_client

    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def _b2_content_delete(b2_key: str) -> None:
    """SigV4 DELETE on peninglab-content."""
    import requests

    endpoint = os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_REGION", "us-east-005")
    access_key = os.environ["B2_CONTENT_KEY_ID"]
    secret_key = os.environ["B2_CONTENT_APP_KEY"]
    bucket = os.environ["B2_CONTENT_BUCKET"]

    endpoint_host = urlparse(endpoint).netloc
    host = f"{bucket}.{endpoint_host}"
    canonical_uri = "/" + quote(b2_key, safe="/")

    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(b"").hexdigest()

    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }

    sorted_keys = sorted(headers)
    signed_headers = ";".join(sorted_keys)
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in sorted_keys)

    canonical_request = "\n".join(
        ["DELETE", canonical_uri, "", canonical_headers, signed_headers, payload_hash]
    )
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )

    def _hmac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k_date = _hmac(("AWS4" + secret_key).encode(), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, "s3")
    k_signing = _hmac(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    out_headers = {
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": auth,
        "Host": host,
    }

    r = requests.delete(
        f"https://{host}{canonical_uri}",
        headers=out_headers,
        timeout=60,
    )
    # B2 returns 204 on success, 404 if already gone (still treat as success)
    if r.status_code not in (200, 204, 404):
        raise RuntimeError(f"B2 DELETE failed: HTTP {r.status_code} {r.text[:200]}")


def _key_from_content_url(url: str) -> str | None:
    base = os.environ["B2_CONTENT_PUBLIC_BASE"].rstrip("/") + "/"
    if not url.startswith(base):
        return None
    return url[len(base) :]


@app.function(
    image=image,
    secrets=secrets,
    schedule=modal.Cron("0 19 * * *"),  # 19:00 UTC = 03:00 MYT
    timeout=3600,
)
def cleanup_unsaved_past_ttl(dry_run: bool = False) -> dict:
    """Daily prune. Returns counts."""
    sb = _supabase()

    rows = sb.rpc("history_unsaved_past_ttl").execute()

    counts = {
        "total": 0,
        "deleted": 0,
        "skipped_no_key": 0,
        "would_delete": 0,
        "error": 0,
    }
    examples = []

    for row in rows.data or []:
        counts["total"] += 1
        rid = row["id"]
        key = _key_from_content_url(row.get("output_url") or "")
        if not key:
            counts["skipped_no_key"] += 1
            continue

        if dry_run:
            counts["would_delete"] += 1
            if len(examples) < 5:
                examples.append({"id": rid, "key": key})
            continue

        try:
            _b2_content_delete(key)
            sb.table("history").update({"b2_mirrored_at": None}).eq("id", rid).execute()
            counts["deleted"] += 1
            if len(examples) < 5:
                examples.append({"id": rid, "key": key, "deleted": True})
        except Exception as e:
            counts["error"] += 1
            if len(examples) < 5:
                examples.append({"id": rid, "key": key, "error": str(e)[:200]})

    return {"dry_run": dry_run, "counts": counts, "examples": examples}
```

- [ ] **Step 4.1.2: Verify Python syntax**

```bash
cd /e/Project/HCKCREA && python -m py_compile modal_b2_cleanup.py
```

Expected: silent success.

- [ ] **Step 4.1.3: Deploy + dry-run (controller)**

```bash
cd /e/Project/HCKCREA && python -m modal deploy modal_b2_cleanup.py
python -m modal run modal_b2_cleanup.py::cleanup_unsaved_past_ttl --dry-run
```

Expected: `counts` returned, `would_delete >= 0`. Sample examples list. No actual deletes.

- [ ] **Step 4.1.4: Commit**

```bash
cd /e/Project/HCKCREA
git add modal_b2_cleanup.py
git commit -m "feat(modal): daily cleanup cron — prune unsaved B2 past 14d

Calls history_unsaved_past_ttl() RPC for rows older than 14 days
that are mirrored to peninglab-content but have no storage row
(user did not click Save). Deletes each B2 object + clears
b2_mirrored_at on the history row (don't delete the history row
itself — UI hides it via the existing TTL filter).

Schedule: every day at 19:00 UTC (03:00 MYT, low-traffic window).

Idempotent — re-running on the same set is a no-op:
  - B2 DELETE on a missing key returns 404 (treated as success)
  - history.b2_mirrored_at = NULL means subsequent RPC calls won't
    return that row again

Errors per row are logged + counted; one bad row does not stop
the rest of the batch."
git push
```

---

## Task 4.2: Run full backfill across all users (controller)

**Files:** none modified

- [ ] **Step 4.2.1: Dry-run full backfill**

```bash
cd /e/Project/HCKCREA && python -m modal run modal_b2_backfill.py::backfill_all --dry-run
```

Expected: `aggregate.would_mirror > 0` with reasonable totals (1000s of rows max). Note `user_count`.

- [ ] **Step 4.2.2: Full real run**

If dry-run looks reasonable (no error count exploded, would_mirror is plausible):

```bash
cd /e/Project/HCKCREA && python -m modal run modal_b2_backfill.py::backfill_all
```

Expected wall-clock time: ~30-60 min for 1000 rows × ~5MB. Modal scales; one user at a time but parallelizes within. The function timeout is 24h to be safe.

- [ ] **Step 4.2.3: Verify aggregate result**

The result dict should show:
- `aggregate.mirrored` ≈ `aggregate.total - aggregate.skipped_404 - aggregate.skipped_no_url`
- `aggregate.error` ideally 0; small numbers acceptable (provider 5xx during backfill)
- All `users_processed` users got their rows updated

- [ ] **Step 4.2.4: MCP final verification**

Use `mcp__playwright__browser_navigate` to peninglab.com/dashboard. Then `mcp__playwright__browser_evaluate`:

```js
async () => {
  // Open admin's UGC tab; scroll history; count cards on content vs not.
  const aside = document.querySelector('aside');
  const exc = Array.from(aside.querySelectorAll('[role="button"]')).find(
    el => /^EXCLUSIVE$/i.test((el.textContent || '').trim())
  );
  exc?.click();
  await new Promise(f => setTimeout(f, 1500));

  const summary = {};

  for (const tabRegex of [/^UGC\d/i, /^Auto Content/i, /^Cinema\d/i, /^Image\d/i]) {
    const btn = Array.from(document.querySelectorAll('main button')).find(
      b => tabRegex.test((b.textContent || '').trim())
    );
    btn?.click();
    await new Promise(f => setTimeout(f, 4000));

    const sec = Array.from(document.querySelectorAll('main *')).find(
      el => /^History —/i.test((el.textContent || '').trim().slice(0, 30))
    );
    sec?.scrollIntoView({ block: 'start' });
    await new Promise(f => setTimeout(f, 600));

    const allMedia = Array.from(document.querySelectorAll('main video, main img'))
      .filter(el => el.src);
    const onContent = allMedia.filter(el => /peninglab-content/.test(el.src));
    summary[(btn?.textContent || '').slice(0, 15)] = {
      total_media: allMedia.length,
      on_peninglab_content: onContent.length,
      pct: allMedia.length > 0
        ? Math.round((onContent.length / allMedia.length) * 100)
        : 0,
    };
  }

  return summary;
}
```

Expected: every tab shows `pct >= 80%` (some rows may have stale provider URLs that 404'd during backfill — those are OK to leave).

- [ ] **Step 4.2.5: Sanity-check Storage section**

```js
async () => {
  const storage = Array.from(document.querySelectorAll('aside button, aside [role="button"]')).find(
    el => /^Storage/i.test((el.textContent || '').trim())
  );
  storage?.click();
  await new Promise(f => setTimeout(f, 2500));
  const main = document.querySelector('main');
  return {
    storage_text: main?.innerText?.slice(0, 200) || '',
    file_count: main?.querySelectorAll('img, video').length || 0,
  };
}
```

Expected: Storage section still shows admin's saved files (from before this feature) + any new ones saved during testing.

- [ ] **Step 4.2.6: Mark Task 4 complete + plan complete**

If all MCP checks passed:
- Tasks 1-4 verified end-to-end on production
- Auto-mirror is live for all NEW gens via Vercel + Modal
- Backfill complete for all existing rows
- Cleanup cron will run nightly at 03:00 MYT

If any MCP check failed:
- Don't claim complete
- Investigate the failed check, fix root cause, re-run

This task makes no commit (no file changes — pure verification).

---

## Final acceptance check

- [ ] **F.1: Run baseline timing measurement on admin's UGC tab**

Same script style as the spec's acceptance criteria:

```js
async () => {
  // 1. Navigate fresh to peninglab.com/dashboard
  // 2. Click EXCLUSIVE → UGC, wait for cards
  // 3. Open DevTools → Network → check filter "video"
  // 4. Reload page (Ctrl+R)
  // 5. After cards visible: count network requests for video URLs
  
  // Programmatic version:
  await new Promise(f => setTimeout(f, 1000));
  return {
    note: "manual: open Network tab, reload, confirm 0 video bytes transferred for already-watched videos",
  };
}
```

Manual confirmation: open DevTools, refresh, see `(disk cache)` for the already-watched video URLs. Network bytes = 0 for those.

- [ ] **F.2: Smoke-test all surfaces**

For each: UGC, Auto Content, Cinema, Storytelling videos, Storytelling images sub-tab, Image tab:
- [ ] Open the tab, see existing cards render
- [ ] Generate one fresh test row
- [ ] Verify the new row's URL is on `peninglab-content`
- [ ] Refresh page; verify the new row's URL is in disk cache (browser DevTools → Network → "(disk cache)")

- [ ] **F.3: Final summary**

When all of F.1 + F.2 complete and pass, the implementation is done. Auto-mirror is live, backfill is complete, cleanup cron is scheduled. The user's clients now experience:
- Refresh/revisit any video → 0 network, instant playback
- Save → <100ms (no upload)
- New gens → automatically benefit from same architecture
- Storage stays bounded via daily 14-day cleanup

---

## Self-review notes

**1. Spec coverage check:**

| Spec section | Plan task |
|---|---|
| Goal table — refresh = 0 bytes | F.1 manual verification |
| Component 1 — peninglab-content bucket | Pre-done by user (verified in conversation) |
| Component 2a — settle.ts hook | Task 2.1 |
| Component 2b — image route hook | NOT NEEDED — image goes through settle.ts (verified during plan writing); subsumed by 2.1 |
| Component 2c — modal_fairytale.py bucket swap | Task 2.2 |
| Component 2d — lib/mirror-to-b2.ts helper | Task 1.2 |
| Component 3 — Save flow change | Task 3.1 |
| Component 4 — Cleanup cron | Task 4.1 |
| Schema migration | Task 1.1 |
| Backfill admin canary | Task 3.2 (admin-only run) |
| Backfill all users | Task 4.2 |
| Acceptance criteria — fresh gen URLs on content | Task 2.3.5 |
| Acceptance criteria — refresh = 0 video bytes | Task 2.3.6 + F.1 |
| Acceptance criteria — Save <100ms | Task 3.2.10 |
| Acceptance criteria — type-check + build clean | Steps 1.2.3, 1.2.4, 2.1.4, 2.1.5, 3.1.4, 3.1.5 |

✅ All spec requirements have a task.

**2. Placeholder scan:**

Searched for: TBD, TODO, "implement later", "fill in", "add appropriate", "see other" — none in plan.

Every code block is complete. Every command has expected output. Every test step has a concrete success criterion.

**3. Type consistency:**

- `mirrorToContentBucket({ providerUrl, key, contentType })` — defined in 1.2, called identically in 2.1
- `buildContentKey({ userId, type, historyId, ext })` — defined in 1.2, called identically in 2.1
- `inferExt({ url, type, override? })` — defined in 1.2, called as `inferExt({ url: r.outputUrl, type: hist.type as ContentType })` in 2.1 (no override) ✅
- `contentTypeFromExt(ext)` — defined in 1.2, called identically in 2.1
- `_b2_content_public_url(b2_key)` Python — defined in 2.2, called identically in 2.2
- `_upload_b2_content(local_path, b2_key, content_type)` Python — defined in 2.2, called identically in 2.2
- `b2_mirrored_at` column — defined in 1.1 migration, written in 2.1 (Vercel) + 2.2 (Modal), read in 4.1 (RPC) + 3.2 (backfill `is_("b2_mirrored_at", "null")`)
- `history_unsaved_past_ttl()` RPC — defined in 1.1, called identically in 4.1

✅ All names consistent across tasks.

**4. Risk areas re-checked:**

- `lib/settle.ts:340-389` is the path every video flows through. Mistake here breaks all gens. Mitigated by: (a) try/catch around mirror with fallback to provider URL, (b) Task 2.3 MCP verification before Task 3 starts.
- `modal_fairytale.py` bucket swap. If misconfigured, storytelling videos break. Mitigated by deploying after settle.ts is verified working — the order of Task 2.1 → 2.2 → 2.3 means we verify `settle` works on UGC/Image before touching Modal worker.
- Backfill at scale. Risk of provider rate limits. Mitigated by per-row best-effort + idempotent design + ability to re-run.
- Save flow fast path. If misdetect happens, we'd skip a real upload that should have run. Mitigated by `isContentBucketUrl` checking the EXACT public-base prefix; if env var is missing, it returns false and slow path runs.

**5. What this plan does NOT do:**

- Cloudflare CDN (Phase 2 — env-var swap when ready)
- JPG poster extraction (separate spec)
- React.memo on HistoryCard (separate concern)
- Removing peninglab-storage private bucket
- Account-level cross-device cache sync

If any of those become necessary later, they get separate specs + plans.
