# GeminiOmni Original Video Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GeminiOmni (Google Gemini Omni via Crun.ai) as 4th provider chip in the HCKCREA Original Video tab, fully wired into existing cascade / fallback / event-driven settle / auto-poll / recheck / resubmit infrastructure.

**Architecture:** Mechanically mirror the existing Sora 2 wiring at every layer (cascade asset, p2 body builder, settle/retry branches, admin UI, frontend chip). No new pipelines — every existing system gains one branch. Backend ships first (cascade + helpers + branches), frontend chip ships last so users can't trigger Gemini until everything is live.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres (app_settings), Crun.ai (P2) provider, React 19, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-25-geminiomni-original-video-design.md`

---

## File Structure

| File | Responsibility | Change kind |
|---|---|---|
| `lib/deduct.ts` | Add `gemini` to `PriceModelHint` + price branch | Modify |
| `lib/settings.ts` | Add `getGeminiRate("10")` helper | Modify |
| `app/api/gemini/rate/route.ts` | Public flat-rate endpoint | **Create** |
| `lib/cascade-rotation.ts` | Add `"gemini"` to `CascadeAsset`, default slot lists, `getGeminiMain/FallbackSlots` | Modify |
| `lib/video-cascade.ts` | Extend `asset` union, wire Gemini main/fallback getters | Modify |
| `lib/p2.ts` | Add `isGemini` body-build branch + route Gemini through pickProvider | Modify |
| `app/api/generate/cinema/route.ts` | Add `"gemini"` to `modelChoice` union, force 10s+1080p, cost, asset, metadata | Modify |
| `lib/settle.ts` | Add Gemini branches to `inferModelHint`, cascade asset detection, model fallback picker, videoAsset type | Modify |
| `app/api/history/retry/route.ts` | Add Gemini branches to model picker and asset detection | Modify |
| `app/dashboard/sections/history-grid.tsx` | Add `isGeminiRow` + exclude from `canExtend` | Modify |
| `app/dashboard/tabs/original-video.tsx` | Add 4th chip (theme, modes, rate, fixed 10s, fixed 1080p) | Modify |
| `app/admin/settings/page.tsx` | Add `rateGemini` input + Gemini cascade slot UI | Modify |

Each task = one commit + push. Backend infra (Tasks 1-9) ships first behind the existing tab UI (which doesn't expose `model=gemini` yet, so /api/generate/cinema can't actually be called with it). The frontend chip lands in Task 11; admin settings in Task 12. Smoke test in Task 13.

**Constraints (from project memory):**
- Always push after committing (don't ask) — Vercel auto-deploys.
- No version bumps (this is HCKCREA, not the extension).
- No `Date.toISOString()` for user-facing dates (UTC+8 Malaysia user). Internal `new Date().toISOString()` in metadata fields is fine — that's machine-readable timestamp storage, not a user-facing string.
- No test runner configured for this layer; verification is via dev server + Vercel preview + admin UI.

---

## Task 1: Add `gemini` to PriceModelHint

**Files:**
- Modify: `lib/deduct.ts:31-37` (extend `PriceModelHint` union)
- Modify: `lib/deduct.ts:57-64` (add branch reading `rate_gemini`)

- [ ] **Step 1: Extend the `PriceModelHint` type**

Open `lib/deduct.ts`. Find lines 31-37:

```ts
export type PriceModelHint =
  | "banana_pro"
  | "gpt_image"
  | "veo"
  | "grok"
  | "seedance"
  | "sora2";
```

Replace with:

```ts
export type PriceModelHint =
  | "banana_pro"
  | "gpt_image"
  | "veo"
  | "grok"
  | "seedance"
  | "sora2"
  | "gemini";
```

- [ ] **Step 2: Add the gemini branch to `priceFor`**

In the same file, find the `sora2` branch (lines 57-64):

```ts
  if (modelHint === "sora2") {
    // Sora 2 per-second rate. Admin sets sora2_rate; falls back to
    // cinema rate × 2 (matches /api/generate/cinema and /api/generate/sora2).
    const { getSetting } = await import("@/lib/settings");
    const cfg = await getSetting<{ rate: number }>("sora2_rate");
    if (typeof cfg?.rate === "number") return cfg.rate;
    return (await getGrokRate()) * 2;
  }
```

Immediately after the closing `}` of that block, insert:

```ts
  if (modelHint === "gemini") {
    // GeminiOmni (Crun) — flat per-10s-video rate. Admin sets
    // rate_gemini.per_video_10s; falls back to Veo's 8s rate × 1.25
    // when missing (rough proxy — Gemini's compute footprint is similar).
    const { getGeminiRate } = await import("@/lib/settings");
    return await getGeminiRate("10");
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run:

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | head -40
```

Expected: no errors mentioning `lib/deduct.ts` or `PriceModelHint`. There may be unrelated errors in the repo — that's fine, only this file matters here.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/deduct.ts && \
  git commit -m "$(cat <<'EOF'
feat(pricing): add gemini hint to PriceModelHint

Routes gemini-tagged generations through getGeminiRate("10") so
settle.ts can deduct the correct flat per-video rate. Prerequisite
for the GeminiOmni provider rollout — branch is dormant until
the Gemini path actually fires (Task 11 ships the UI).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 2: Add `getGeminiRate` helper

**Files:**
- Modify: `lib/settings.ts` (add after `getVeoRate` at line 352)

- [ ] **Step 1: Insert the helper**

Open `lib/settings.ts`. Find the `getVeoRate` function (lines 345-352):

```ts
export async function getVeoRate(durationMode: "8" | "16" = "8"): Promise<number> {
  const v = await getSetting<any>("rate_veo");
  const key = durationMode === "16" ? "per_video_16s" : "per_video_8s";
  const n = Number(v?.[key]);
  if (Number.isFinite(n) && n > 0) return n;
  const cost = await getCreditCosts();
  return durationMode === "16" ? cost.video_16s : cost.video_8s;
}
```

Immediately after the closing `}` (line 352), insert:

```ts
// GeminiOmni (Crun /api/v1/client/job/CreateTask, model="google/gemini-omni")
// — flat per-video rate. Tab fixes duration at 10s + resolution at 1080p,
// so admin only sets one number (rate_gemini.per_video_10s). When
// unconfigured, falls through to Veo's 8s rate so the row still bills
// something sane (cinema rate × duration doesn't apply — Gemini is flat).
export async function getGeminiRate(durationMode: "10" = "10"): Promise<number> {
  const v = await getSetting<any>("rate_gemini");
  const key = durationMode === "10" ? "per_video_10s" : "per_video_10s";
  const n = Number(v?.[key]);
  if (Number.isFinite(n) && n > 0) return n;
  // Sane default: Veo's 8s rate. Admin can override in /admin/settings.
  return await getVeoRate("8");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "(settings\.ts|getGeminiRate)" | head -20
```

Expected: no errors mentioning `settings.ts` or `getGeminiRate`.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/settings.ts && \
  git commit -m "$(cat <<'EOF'
feat(settings): add getGeminiRate helper

Reads rate_gemini.per_video_10s from app_settings with a Veo-8s
fallback so the GeminiOmni cost preview + settle deduction work
even when the admin hasn't seeded a rate yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 3: Create `/api/gemini/rate` endpoint

**Files:**
- Create: `app/api/gemini/rate/route.ts`

- [ ] **Step 1: Verify parent directory does not yet exist**

```bash
ls /e/Project/HCKCREA/app/api/gemini 2>&1 | head -3
```

Expected: `No such file or directory` (or an empty dir if you ran an exploratory `mkdir`). If it exists with files, stop and check what's there.

- [ ] **Step 2: Create the route file**

Create `app/api/gemini/rate/route.ts` with this exact content:

```ts
import { NextResponse } from "next/server";
import { getGeminiRate } from "@/lib/settings";

// GET /api/gemini/rate — admin-set FLAT per-video rate for GeminiOmni (10s).
// Used by Original Video tab to show live cost preview when the GeminiOmni
// chip is active. Mirrors /api/veo/rate. Non-sensitive pricing info, no
// auth needed.
export const dynamic = "force-dynamic";

export async function GET() {
  const rate = await getGeminiRate("10");
  return NextResponse.json({ rate });
}
```

- [ ] **Step 3: Verify the route resolves in a build**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "gemini/rate" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/gemini/rate/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(api): GET /api/gemini/rate flat per-10s-video rate

Mirrors /api/veo/rate. Feeds the GeminiOmni chip's cost preview
in the Original Video tab. Reads rate_gemini.per_video_10s via
getGeminiRate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

- [ ] **Step 5: Verify the endpoint responds in production**

After Vercel finishes deploying (~1 min), curl the live endpoint:

```bash
curl -s https://peninglab.com/api/gemini/rate
```

Expected: `{"rate":<some-number>}`. The number will be whatever Veo's 8s rate is right now (the fallback) — that's expected since `rate_gemini` hasn't been seeded yet. Will be replaced once admin saves a real rate in Task 12.

---

## Task 4: Add Gemini cascade slot pool

**Files:**
- Modify: `lib/cascade-rotation.ts` (extend `CascadeAsset`, add defaults, add helpers)

- [ ] **Step 1: Add default slot lists**

Open `lib/cascade-rotation.ts`. Find the existing `DEFAULT_SORA2_FALLBACK` block (around line 62):

```ts
const DEFAULT_SORA2_MAIN: SlotProvider[] = ["p6-a", "p6-b", "p6-c", "none", "none", "none", "none", "none", "none", "none"];
const DEFAULT_SORA2_FALLBACK: SlotProvider[] = ["p6-d", "p6-e", "none", "none", "none", "none", "none", "none", "none", "none"];
```

Immediately after those two lines, append:

```ts
// GeminiOmni (Crun /api/v1/client/job/CreateTask, model="google/gemini-omni")
// — Crun is the only provider currently supporting this model, so MAIN
// rotates between the two Crun accounts (p2-a / p2-b). FALLBACK is empty
// at launch; when a second GeminiOmni-capable provider is wired in, admin
// adds its slot id here.
const DEFAULT_GEMINI_MAIN: SlotProvider[] = ["p2-a", "p2-b", "none", "none", "none", "none", "none", "none", "none", "none"];
const DEFAULT_GEMINI_FALLBACK: SlotProvider[] = ["none", "none", "none", "none", "none", "none", "none", "none", "none", "none"];
```

- [ ] **Step 2: Extend the `CascadeAsset` type**

In the same file, find line 170:

```ts
export type CascadeAsset = "video" | "image" | "grok" | "cinema" | "sora2";
```

Replace with:

```ts
export type CascadeAsset = "video" | "image" | "grok" | "cinema" | "sora2" | "gemini";
```

- [ ] **Step 3: Add the two Gemini slot helpers**

In the same file, find the existing `getSora2FallbackSlots` function (around lines 162-168):

```ts
export async function getSora2FallbackSlots(): Promise<SlotProvider[]> {
  const [count, raw] = await Promise.all([
    getSlotCount("sora2_fallback_count"),
    getSetting<{ slots: SlotProvider[] }>("sora2_fallback_slots"),
  ]);
  return sanitizeSlotList(raw?.slots, count, VIDEO_ALLOWED, DEFAULT_SORA2_FALLBACK);
}
```

Immediately after the closing `}` of that function, insert:

```ts
// GeminiOmni cascade — uses VIDEO_ALLOWED so admin can pick any video-
// capable slot (today only p2-a/p2-b actually accept google/gemini-omni
// at the provider; the rest fail at create and the cascade walks on).
// Once a second provider supports Gemini, no code change needed — admin
// just adds its slot to the FALLBACK list in /admin/settings.
export async function getGeminiMainSlots(): Promise<SlotProvider[]> {
  const [count, raw] = await Promise.all([
    getSlotCount("gemini_main_count"),
    getSetting<{ slots: SlotProvider[] }>("gemini_main_slots"),
  ]);
  return sanitizeSlotList(raw?.slots, count, VIDEO_ALLOWED, DEFAULT_GEMINI_MAIN);
}

export async function getGeminiFallbackSlots(): Promise<SlotProvider[]> {
  const [count, raw] = await Promise.all([
    getSlotCount("gemini_fallback_count"),
    getSetting<{ slots: SlotProvider[] }>("gemini_fallback_slots"),
  ]);
  return sanitizeSlotList(raw?.slots, count, VIDEO_ALLOWED, DEFAULT_GEMINI_FALLBACK);
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "cascade-rotation|CascadeAsset|getGemini" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/cascade-rotation.ts && \
  git commit -m "$(cat <<'EOF'
feat(cascade): add gemini asset pool + default slot lists

DEFAULT_GEMINI_MAIN seeds the two Crun accounts; FALLBACK is empty
until a second GeminiOmni-capable provider is wired in. CascadeAsset
union extended so video-cascade can route gemini through its own
round-robin counter (gemini_rotation_counter app_setting).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 5: Wire Gemini asset in video-cascade

**Files:**
- Modify: `lib/video-cascade.ts:42-43` (import), `lib/video-cascade.ts:74-75` (asset union), `lib/video-cascade.ts:213-231` (resolver)

- [ ] **Step 1: Import the new helpers**

Open `lib/video-cascade.ts`. Find the import block (lines 29-43):

```ts
import {
  getVideoMainSlots,
  getVideoFallbackSlots,
  getGrokMainSlots,
  getGrokFallbackSlots,
  getCinemaMainSlots,
  getCinemaFallbackSlots,
  getSora2MainSlots,
  getSora2FallbackSlots,
  nextMainStartIndex,
  nextFallbackStartIndex,
  slotToProvider,
  type SlotProvider,
  type CascadeAsset,
} from "@/lib/cascade-rotation";
```

Replace with:

```ts
import {
  getVideoMainSlots,
  getVideoFallbackSlots,
  getGrokMainSlots,
  getGrokFallbackSlots,
  getCinemaMainSlots,
  getCinemaFallbackSlots,
  getSora2MainSlots,
  getSora2FallbackSlots,
  getGeminiMainSlots,
  getGeminiFallbackSlots,
  nextMainStartIndex,
  nextFallbackStartIndex,
  slotToProvider,
  type SlotProvider,
  type CascadeAsset,
} from "@/lib/cascade-rotation";
```

- [ ] **Step 2: Extend the asset union in `VideoCascadeInput`**

In the same file, find the comment block + `asset?` field (around lines 70-75):

```ts
  /** Which cascade pool to draw from. Defaults to "video" (UGC + Auto
   *  Content + Veo cinema). "grok" routes through the Grok cascade
   *  (typically p6-a..h). "cinema" routes through the Cinema (Seedance)
   *  cascade (p1 + p6). Each asset has independent slot lists +
   *  round-robin counters in lib/cascade-rotation.ts. */
  asset?: "video" | "grok" | "cinema" | "sora2";
```

Replace with:

```ts
  /** Which cascade pool to draw from. Defaults to "video" (UGC + Auto
   *  Content + Veo cinema). "grok" routes through the Grok cascade
   *  (typically p6-a..h). "cinema" routes through the Cinema (Seedance)
   *  cascade (p1 + p6). "gemini" routes through the GeminiOmni cascade
   *  (p2-a + p2-b at launch). Each asset has independent slot lists +
   *  round-robin counters in lib/cascade-rotation.ts. */
  asset?: "video" | "grok" | "cinema" | "sora2" | "gemini";
```

- [ ] **Step 3: Add Gemini branches to `getMains` / `getFbs`**

In the same file, find the `getMains` / `getFbs` resolver block (lines 216-231):

```ts
  const getMains =
    asset === "grok"
      ? getGrokMainSlots
      : asset === "cinema"
        ? getCinemaMainSlots
        : asset === "sora2"
          ? getSora2MainSlots
          : getVideoMainSlots;
  const getFbs =
    asset === "grok"
      ? getGrokFallbackSlots
      : asset === "cinema"
        ? getCinemaFallbackSlots
        : asset === "sora2"
          ? getSora2FallbackSlots
          : getVideoFallbackSlots;
```

Replace with:

```ts
  const getMains =
    asset === "grok"
      ? getGrokMainSlots
      : asset === "cinema"
        ? getCinemaMainSlots
        : asset === "sora2"
          ? getSora2MainSlots
          : asset === "gemini"
            ? getGeminiMainSlots
            : getVideoMainSlots;
  const getFbs =
    asset === "grok"
      ? getGrokFallbackSlots
      : asset === "cinema"
        ? getCinemaFallbackSlots
        : asset === "sora2"
          ? getSora2FallbackSlots
          : asset === "gemini"
            ? getGeminiFallbackSlots
            : getVideoFallbackSlots;
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "video-cascade" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/video-cascade.ts && \
  git commit -m "$(cat <<'EOF'
feat(cascade): route gemini asset through video-cascade

Imports getGeminiMain/FallbackSlots, extends the asset union, and
adds the matching resolver branches so generateVideoWithCascade with
asset='gemini' walks the dedicated Gemini main+fallback pools.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 6: Add `isGemini` body builder in p2.ts

**Files:**
- Modify: `lib/p2.ts:31-44` (pickProvider asset detection), `lib/p2.ts:145-151` (model branch detection), `lib/p2.ts:201-247` (body block)

- [ ] **Step 1: Add Gemini detection in `pickProvider`**

Open `lib/p2.ts`. Find lines 31-44 (the `pickProvider` function):

```ts
async function pickProvider(model: string, userId?: string): Promise<"p1" | "p2"> {
  const m = model.toLowerCase();
  const isGrok = m.includes("grok");
  const isSeedance = !isGrok && m.includes("seedance");
  const isVideo = !isGrok && !isSeedance && m.includes("veo");
  const asset = isSeedance
    ? "seedance"
    : isGrok
      ? "cinema"
      : isVideo
        ? "video"
        : "image";
  return await getGenProvider(asset, userId);
}
```

Replace with:

```ts
async function pickProvider(model: string, userId?: string): Promise<"p1" | "p2"> {
  const m = model.toLowerCase();
  const isGrok = m.includes("grok");
  const isSeedance = !isGrok && m.includes("seedance");
  // GeminiOmni model id is "google/gemini-omni" — match "gemini-omni"
  // specifically to avoid clashing with "veo" or other Google models.
  const isGemini = !isGrok && !isSeedance && m.includes("gemini-omni");
  const isVideo = !isGrok && !isSeedance && !isGemini && m.includes("veo");
  // Gemini routes through the "video" asset for the gen_provider_<asset>
  // admin toggle (getGenProvider only knows about a fixed enum). Crun is
  // currently the only Gemini host, so video's existing toggle is fine —
  // when a second Gemini provider ships, we can split it out then.
  const asset = isSeedance
    ? "seedance"
    : isGrok
      ? "cinema"
      : isVideo || isGemini
        ? "video"
        : "image";
  return await getGenProvider(asset, userId);
}
```

- [ ] **Step 2: Add `isGemini` to the internal model-branch detection**

In the same file, find lines 145-151 (inside `p2CreateTaskInternal`):

```ts
  const m = input.model.toLowerCase();
  const isGrok = m.includes("grok-imagine");
  const isSeedance = !isGrok && m.includes("seedance");
  const isVideo = !isGrok && !isSeedance && m.includes("veo");
  const isGptImage = !isGrok && !isSeedance && m.includes("gpt-image");
  const isZImage = !isGrok && !isSeedance && !isVideo && !isGptImage && m === "z-image";
  const isBanana = !isVideo && !isGptImage && !isGrok && !isSeedance && !isZImage;
```

Replace with:

```ts
  const m = input.model.toLowerCase();
  const isGrok = m.includes("grok-imagine");
  const isSeedance = !isGrok && m.includes("seedance");
  // GeminiOmni — google/gemini-omni. Detect before isVideo because the
  // model name contains "google" not "veo", and before isBanana because
  // the catch-all default would otherwise eat it.
  const isGemini = !isGrok && !isSeedance && m.includes("gemini-omni");
  const isVideo = !isGrok && !isSeedance && !isGemini && m.includes("veo");
  const isGptImage = !isGrok && !isSeedance && !isGemini && m.includes("gpt-image");
  const isZImage = !isGrok && !isSeedance && !isVideo && !isGemini && !isGptImage && m === "z-image";
  const isBanana = !isVideo && !isGptImage && !isGrok && !isSeedance && !isZImage && !isGemini;
```

- [ ] **Step 3: Add the Gemini body-build block**

In the same file, find the `isBanana` body block (around line 241-246):

```ts
  } else if (isBanana) {
    // nano-banana-pro: resolution dial + native aspect ratio support.
    if (input.aspectRatio) innerInput.aspect_ratio = input.aspectRatio;
    innerInput.resolution = (input.resolution || "2K").toUpperCase();
    if (imgUrls.length > 0) innerInput.img_urls = imgUrls;
  }
```

Immediately before that block (so the new `isGemini` branch is checked before `isBanana`'s default catch-all), insert:

```ts
  } else if (isGemini) {
    // GeminiOmni (google/gemini-omni via Crun /api/v1/client/job/CreateTask).
    // API accepts up to 7 img_urls; UX caps at 3 in /api/generate/cinema
    // before this call, so slice is defensive. duration must be one of
    // 4|6|8|10 (we always send 10 — Original Video tab fixes it).
    // resolution lowercase per Crun spec; tab fixes at "1080p".
    if (imgUrls.length > 0) innerInput.img_urls = imgUrls.slice(0, 3);
    innerInput.duration = Number(input.durationMode || 10);
    if (input.aspectRatio) innerInput.aspect_ratio = input.aspectRatio;
    innerInput.resolution = String(input.resolution || "1080p").toLowerCase();
```

The result should read `} else if (isGemini) { … } else if (isBanana) { … }` — verify the braces line up after inserting.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "lib/p2\.ts" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/p2.ts && \
  git commit -m "$(cat <<'EOF'
feat(p2): handle google/gemini-omni model in body builder

Adds isGemini detection in both pickProvider (gen_provider toggle)
and p2CreateTaskInternal (request body). GeminiOmni body shape:
img_urls (<=3), duration, aspect_ratio, resolution (lowercase).
Branch ordered before isVideo / isBanana so the catch-all default
doesn't eat it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 7: Extend `/api/generate/cinema` with gemini branch

**Files:**
- Modify: `app/api/generate/cinema/route.ts` (multiple insert points)

- [ ] **Step 1: Extend `modelChoice` parsing and force 10s + 1080p**

Open `app/api/generate/cinema/route.ts`. Find lines 46-64:

```ts
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  const resolution = body?.resolution === "480p" ? "480p" : "720p";
  const modelChoice: "grok" | "veo" | "sora2" =
    body?.model === "veo"
      ? "veo"
      : body?.model === "sora2"
        ? "sora2"
        : "grok";
  // Per-provider duration constraints:
  //   • Veo    → fixed 8s (model only emits 8s natively)
  //   • Sora 2 → 8 or 12 (APIPod's sora-2-vip enum)
  //   • Grok   → 6-30 (slider, per-second billing)
  const duration =
    modelChoice === "veo"
      ? 8
      : modelChoice === "sora2"
        ? body?.duration === 12 || body?.duration === "12"
          ? 12
          : 8
        : Math.min(30, Math.max(6, Math.round(Number(body?.duration || 6))));
```

Replace with:

```ts
  const aspectRatio = String(body?.aspect_ratio || "9:16");
  // Gemini fixes resolution at 1080p; other providers honour the request
  // body (or default to 720p). Sora 2 / Veo / Grok still go through their
  // existing 720/480p validation.
  const modelChoice: "grok" | "veo" | "sora2" | "gemini" =
    body?.model === "veo"
      ? "veo"
      : body?.model === "sora2"
        ? "sora2"
        : body?.model === "gemini"
          ? "gemini"
          : "grok";
  const resolution =
    modelChoice === "gemini"
      ? "1080p"
      : body?.resolution === "480p"
        ? "480p"
        : "720p";
  // Per-provider duration constraints:
  //   • Veo     → fixed 8s (model only emits 8s natively)
  //   • Sora 2  → 8 or 12 (APIPod's sora-2-vip enum)
  //   • Gemini  → fixed 10s (Original Video tab UX choice; API accepts
  //              4|6|8|10 but the chip only exposes 10)
  //   • Grok    → 6-30 (slider, per-second billing)
  const duration =
    modelChoice === "veo"
      ? 8
      : modelChoice === "sora2"
        ? body?.duration === 12 || body?.duration === "12"
          ? 12
          : 8
        : modelChoice === "gemini"
          ? 10
          : Math.min(30, Math.max(6, Math.round(Number(body?.duration || 6))));
```

- [ ] **Step 2: Clamp `imageMode` for Gemini (frame → ingredient)**

In the same file, find lines 70-79:

```ts
  let imageModeRaw: "text" | "frame" | "ingredient" =
    body?.image_mode === "ingredient"
      ? "ingredient"
      : body?.image_mode === "frame" || body?.image_mode === "image"
        ? "frame"
        : "text";
  // Clamp ingredient → frame for Grok/Sora 2 (they don't support r2v).
  if (imageModeRaw === "ingredient" && modelChoice !== "veo") {
    imageModeRaw = "frame";
  }
  const imageMode = imageModeRaw;
```

Replace with:

```ts
  let imageModeRaw: "text" | "frame" | "ingredient" =
    body?.image_mode === "ingredient"
      ? "ingredient"
      : body?.image_mode === "frame" || body?.image_mode === "image"
        ? "frame"
        : "text";
  // Clamp ingredient → frame for Grok/Sora 2 (they don't support r2v).
  // Gemini is the inverse: it only has img_urls (no first-frame concept),
  // so "frame" → "ingredient" with a single image. The cinema route still
  // sends "ingredient" so video-cascade + p2 see the canonical mode.
  if (imageModeRaw === "ingredient" && modelChoice !== "veo" && modelChoice !== "gemini") {
    imageModeRaw = "frame";
  }
  if (imageModeRaw === "frame" && modelChoice === "gemini") {
    imageModeRaw = "ingredient";
  }
  const imageMode = imageModeRaw;
```

- [ ] **Step 3: Add Gemini to `cinemaProvider` metadata stamping at INSERT**

In the same file, find lines 128-148 (the initial `metadata` block for the placeholder insert):

```ts
      metadata: {
        imageMode,
        resolution,
        aspectRatio: imageMode !== "text" ? null : aspectRatio,
        cinemaProvider:
          modelChoice === "veo"
            ? "veo"
            : modelChoice === "sora2"
              ? "apipod"
              : "grok-imagine",
        modelChoice,
        featureType,
        // Full attachment array for Resubmit re-fire
        image_urls: effectiveImageUrls,
        upload_status: "queued",
        // Sora 2 routing — let history grid + admin chip detection pick
        // up the SORA 2 tag (matches existing detection patterns).
        ...(modelChoice === "sora2"
          ? {
              model: "sora-2-vip",
              sora2Provider: "apipod",
            }
          : {}),
      },
```

Replace with:

```ts
      metadata: {
        imageMode,
        resolution,
        aspectRatio: imageMode !== "text" ? null : aspectRatio,
        cinemaProvider:
          modelChoice === "veo"
            ? "veo"
            : modelChoice === "sora2"
              ? "apipod"
              : modelChoice === "gemini"
                ? "crun"
                : "grok-imagine",
        modelChoice,
        featureType,
        // Full attachment array for Resubmit re-fire
        image_urls: effectiveImageUrls,
        upload_status: "queued",
        // Sora 2 routing — let history grid + admin chip detection pick
        // up the SORA 2 tag (matches existing detection patterns).
        ...(modelChoice === "sora2"
          ? {
              model: "sora-2-vip",
              sora2Provider: "apipod",
            }
          : {}),
        // Gemini routing — stamp the canonical model id so retry/settle
        // pick it back up via meta.model when modelChoice is unset on
        // legacy rows. cinemaProvider="crun" already disambiguates.
        ...(modelChoice === "gemini"
          ? {
              model: "google/gemini-omni",
            }
          : {}),
      },
```

- [ ] **Step 4: Add Gemini cost branch in the `after()` block**

In the same file, find lines 176-190 (the cost branch inside `after()`):

```ts
      let cost: number;
      if (modelChoice === "veo") {
        const veoFlat = await getVeoRate("8");
        cost = Number(veoFlat.toFixed(4));
      } else if (modelChoice === "sora2") {
        const sora2RateSetting = await getSetting<{ rate: number }>("sora2_rate");
        const ratePerSec =
          typeof sora2RateSetting?.rate === "number"
            ? sora2RateSetting.rate
            : cinemaRatePerSec * 2;
        cost = Number((ratePerSec * duration).toFixed(4));
      } else {
        // Grok per-second
        cost = Number((cinemaRatePerSec * duration).toFixed(4));
      }
```

Replace with:

```ts
      let cost: number;
      if (modelChoice === "veo") {
        const veoFlat = await getVeoRate("8");
        cost = Number(veoFlat.toFixed(4));
      } else if (modelChoice === "sora2") {
        const sora2RateSetting = await getSetting<{ rate: number }>("sora2_rate");
        const ratePerSec =
          typeof sora2RateSetting?.rate === "number"
            ? sora2RateSetting.rate
            : cinemaRatePerSec * 2;
        cost = Number((ratePerSec * duration).toFixed(4));
      } else if (modelChoice === "gemini") {
        // GeminiOmni — flat per-video rate, duration is fixed 10s
        // server-side so we don't multiply.
        const geminiFlat = await getGeminiRate("10");
        cost = Number(geminiFlat.toFixed(4));
      } else {
        // Grok per-second
        cost = Number((cinemaRatePerSec * duration).toFixed(4));
      }
```

- [ ] **Step 5: Add `getGeminiRate` to imports**

In the same file, find line 5:

```ts
import { getCinemaRate, getP2Config, getSetting, getVeoRate } from "@/lib/settings";
```

Replace with:

```ts
import { getCinemaRate, getGeminiRate, getP2Config, getSetting, getVeoRate } from "@/lib/settings";
```

- [ ] **Step 6: Add Gemini branch to the model-id picker**

In the same file, find lines 199-209 (the model-id pick block):

```ts
      let model: string | undefined;
      if (modelChoice === "veo") {
        model = imageMode === "ingredient"
          ? cfg.videoR2V
          : imageMode === "frame"
            ? cfg.videoI2V
            : cfg.videoT2V;
      } else if (modelChoice === "sora2") {
        model = "sora2"; // p6.ts apipodVideoModel maps to "sora-2-vip"
      } else {
        model = imageMode !== "text" ? cfg.grokI2V : cfg.grokT2V;
      }
```

Replace with:

```ts
      let model: string | undefined;
      if (modelChoice === "veo") {
        model = imageMode === "ingredient"
          ? cfg.videoR2V
          : imageMode === "frame"
            ? cfg.videoI2V
            : cfg.videoT2V;
      } else if (modelChoice === "sora2") {
        model = "sora2"; // p6.ts apipodVideoModel maps to "sora-2-vip"
      } else if (modelChoice === "gemini") {
        // GeminiOmni — single Crun model id regardless of imageMode
        // (text + ingredient both go to the same endpoint; p2.ts handles
        // the conditional img_urls payload).
        model = "google/gemini-omni";
      } else {
        model = imageMode !== "text" ? cfg.grokI2V : cfg.grokT2V;
      }
```

- [ ] **Step 7: Add Gemini to the cascade asset selector**

In the same file, find lines 268-281 (the `generateVideoWithCascade` call's `asset` field):

```ts
      const result = await generateVideoWithCascade({
        primaryModel: model,
        prompt,
        imageUrls: imgs,
        durationMode: String(duration),
        aspectRatio,
        imageMode: imgMode,
        asset:
          modelChoice === "grok"
            ? "grok"
            : modelChoice === "sora2"
              ? "sora2"
              : "video",
      });
```

Replace with:

```ts
      const result = await generateVideoWithCascade({
        primaryModel: model,
        prompt,
        imageUrls: imgs,
        durationMode: String(duration),
        aspectRatio,
        imageMode: imgMode,
        asset:
          modelChoice === "grok"
            ? "grok"
            : modelChoice === "sora2"
              ? "sora2"
              : modelChoice === "gemini"
                ? "gemini"
                : "video",
      });
```

- [ ] **Step 8: Add Gemini stamping to the failure + success metadata blocks**

There are two more `cinemaProvider:` ternaries — one at line ~304 (failure branch) and one at line ~329 (success branch). Apply the same pattern to both.

Find lines 303-308 (failure metadata):

```ts
            cinemaProvider:
              modelChoice === "veo"
                ? "veo"
                : modelChoice === "sora2"
                  ? "apipod"
                  : "grok-imagine",
```

Replace with:

```ts
            cinemaProvider:
              modelChoice === "veo"
                ? "veo"
                : modelChoice === "sora2"
                  ? "apipod"
                  : modelChoice === "gemini"
                    ? "crun"
                    : "grok-imagine",
```

Find lines 327-332 (success metadata — same ternary):

```ts
          cinemaProvider:
            modelChoice === "veo"
              ? "veo"
              : modelChoice === "sora2"
                ? "apipod"
                : "grok-imagine",
```

Replace with the same expanded ternary:

```ts
          cinemaProvider:
            modelChoice === "veo"
              ? "veo"
              : modelChoice === "sora2"
                ? "apipod"
                : modelChoice === "gemini"
                  ? "crun"
                  : "grok-imagine",
```

Find lines 357-362 (the catch-block metadata — third occurrence of the same ternary). Apply the same expanded form:

```ts
          cinemaProvider:
            modelChoice === "veo"
              ? "veo"
              : modelChoice === "sora2"
                ? "apipod"
                : modelChoice === "gemini"
                  ? "crun"
                  : "grok-imagine",
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "cinema/route" | head -20
```

Expected: no errors.

- [ ] **Step 10: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/generate/cinema/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(cinema): add gemini modelChoice branch

Wires GeminiOmni end-to-end through /api/generate/cinema:
- modelChoice union extended; duration forced to 10s, resolution to 1080p
- imageMode frame→ingredient clamp (Gemini has no first-frame concept)
- cost via getGeminiRate("10") flat per-video
- model id "google/gemini-omni"
- cascade asset='gemini' so the row walks the dedicated pool
- metadata cinemaProvider="crun" + meta.model="google/gemini-omni"
  stamped in placeholder + success + failure + catch metadata blocks
  so settle / retry / history grid all see consistent tagging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 8: Patch `/api/history/retry` for Gemini

**Files:**
- Modify: `app/api/history/retry/route.ts:171-189` (model picker), `app/api/history/retry/route.ts:294-305` (asset detection)

- [ ] **Step 1: Add Gemini to the model fallback picker**

Open `app/api/history/retry/route.ts`. Find lines 171-189 (the `else if (row.tab === "cinema" || row.tab === "original-video")` branch):

```ts
    } else if (row.tab === "cinema" || row.tab === "original-video") {
      // Cinema + Original Video can be Veo, Grok, or Sora 2 —
      // disambiguate via the row's modelChoice tag stamped at insert
      // time. Falls back to Grok for legacy rows that pre-date the
      // modelChoice metadata.
      if (meta.modelChoice === "veo") {
        model = refImage ? cfg.videoR2V : cfg.videoT2V;
      } else if (meta.modelChoice === "sora2") {
        // p6.ts apipodVideoModel maps "sora2" → "sora-2-vip" regardless
        // of refs (sora-2-vip is a single endpoint).
        model = "sora2";
      } else {
        model = refImage ? cfg.grokI2V : cfg.grokT2V;
      }
    } else {
```

Replace with:

```ts
    } else if (row.tab === "cinema" || row.tab === "original-video") {
      // Cinema + Original Video can be Veo, Grok, Sora 2, or GeminiOmni
      // — disambiguate via the row's modelChoice tag stamped at insert
      // time. Falls back to Grok for legacy rows that pre-date the
      // modelChoice metadata.
      if (meta.modelChoice === "veo") {
        model = refImage ? cfg.videoR2V : cfg.videoT2V;
      } else if (meta.modelChoice === "sora2") {
        // p6.ts apipodVideoModel maps "sora2" → "sora-2-vip" regardless
        // of refs (sora-2-vip is a single endpoint).
        model = "sora2";
      } else if (meta.modelChoice === "gemini") {
        // GeminiOmni — single Crun model id; p2.ts builds the body
        // shape (img_urls + duration + 1080p) based on imageMode.
        model = "google/gemini-omni";
      } else {
        model = refImage ? cfg.grokI2V : cfg.grokT2V;
      }
    } else {
```

- [ ] **Step 2: Add Gemini asset detection**

In the same file, find lines 294-305:

```ts
    let asset: "video" | "grok" | "cinema" | "sora2" = "video";
    if (row.tab === "sora2") asset = "sora2";
    else if (meta.modelChoice === "sora2" || /sora/i.test(model)) {
      asset = "sora2";
    }
    else if (row.tab === "seedance") asset = "cinema";
    else if (
      row.tab === "cinema" &&
      (meta.modelChoice === "grok" || /grok/i.test(model))
    ) {
      asset = "grok";
    }
```

Replace with:

```ts
    let asset: "video" | "grok" | "cinema" | "sora2" | "gemini" = "video";
    if (row.tab === "sora2") asset = "sora2";
    else if (meta.modelChoice === "sora2" || /sora/i.test(model)) {
      asset = "sora2";
    }
    else if (meta.modelChoice === "gemini" || /gemini-omni/i.test(model)) {
      // GeminiOmni rows route through the dedicated gemini cascade pool
      // so resubmits walk the same provider family (Crun) the original
      // fire used — not the generic video pool which may route p6/p5.
      asset = "gemini";
    }
    else if (row.tab === "seedance") asset = "cinema";
    else if (
      row.tab === "cinema" &&
      (meta.modelChoice === "grok" || /grok/i.test(model))
    ) {
      asset = "grok";
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "history/retry" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/history/retry/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(retry): handle gemini rows in Resubmit path

Adds modelChoice='gemini' to both the model-id fallback picker and
the cascade asset detection. Without this, clicking Resubmit on a
failed GeminiOmni row would fall through to Grok's model id +
generic 'video' cascade — wrong provider, wrong slot pool.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 9: Patch `lib/settle.ts` for Gemini

**Files:**
- Modify: `lib/settle.ts:36-46` (inferModelHint), `lib/settle.ts:435-454` (cascade asset detection), `lib/settle.ts:519-535` (model fallback picker), `lib/settle.ts:686-687` (videoAsset type)

- [ ] **Step 1: Add `gemini` to `inferModelHint`**

Open `lib/settle.ts`. Find lines 36-46:

```ts
function inferModelHint(model?: string | null): PriceModelHint | undefined {
  const m = String(model || "").toLowerCase();
  if (!m) return undefined;
  if (m.includes("sora")) return "sora2";
  if (m.includes("seedance")) return "seedance";
  if (m.includes("grok")) return "grok";
  if (m.includes("veo")) return "veo";
  if (m.includes("nano-banana") || m.includes("banana")) return "banana_pro";
  if (m.includes("gpt-image")) return "gpt_image";
  return undefined;
}
```

Replace with:

```ts
function inferModelHint(model?: string | null): PriceModelHint | undefined {
  const m = String(model || "").toLowerCase();
  if (!m) return undefined;
  if (m.includes("sora")) return "sora2";
  if (m.includes("seedance")) return "seedance";
  if (m.includes("grok")) return "grok";
  // Gemini check ordered before veo because the model id is
  // "google/gemini-omni" — substring matches neither "sora" nor "grok"
  // but we want to claim it BEFORE the broader "veo" includes pattern
  // in case a future google/veo3-1 string contains a substring overlap.
  if (m.includes("gemini-omni")) return "gemini";
  if (m.includes("veo")) return "veo";
  if (m.includes("nano-banana") || m.includes("banana")) return "banana_pro";
  if (m.includes("gpt-image")) return "gpt_image";
  return undefined;
}
```

- [ ] **Step 2: Add Gemini branch to cascade asset detection (`tryAutoRetry`)**

In the same file, find lines 435-454:

```ts
  let cascadeAsset: CascadeAsset | "image";
  if (isImageRowForCap) cascadeAsset = "image";
  else if (hist.tab === "sora2") cascadeAsset = "sora2";
  else if (
    meta.modelChoice === "sora2" ||
    /sora/i.test(rowModel)
  ) {
    // Auto Content Sora 2 rows (tab='auto', metadata.modelChoice='sora2')
    // also route through the sora2 cascade.
    cascadeAsset = "sora2";
  }
  else if (hist.tab === "seedance") cascadeAsset = "cinema";
  else if (
    (hist.tab === "cinema" || hist.tab === "original-video") &&
    (meta.modelChoice === "grok" || /grok/i.test(rowModel))
  ) {
    cascadeAsset = "grok";
  } else {
    cascadeAsset = "video";
  }
```

Replace with:

```ts
  let cascadeAsset: CascadeAsset | "image";
  if (isImageRowForCap) cascadeAsset = "image";
  else if (hist.tab === "sora2") cascadeAsset = "sora2";
  else if (
    meta.modelChoice === "sora2" ||
    /sora/i.test(rowModel)
  ) {
    // Auto Content Sora 2 rows (tab='auto', metadata.modelChoice='sora2')
    // also route through the sora2 cascade.
    cascadeAsset = "sora2";
  }
  else if (
    meta.modelChoice === "gemini" ||
    /gemini-omni/i.test(rowModel)
  ) {
    // GeminiOmni rows route through the dedicated gemini cascade pool
    // so auto-resubmit walks the same Crun-backed slots, not the generic
    // video pool which may include p6 keys that don't accept this model.
    cascadeAsset = "gemini";
  }
  else if (hist.tab === "seedance") cascadeAsset = "cinema";
  else if (
    (hist.tab === "cinema" || hist.tab === "original-video") &&
    (meta.modelChoice === "grok" || /grok/i.test(rowModel))
  ) {
    cascadeAsset = "grok";
  } else {
    cascadeAsset = "video";
  }
```

- [ ] **Step 3: Add Gemini branch to the model fallback picker**

In the same file, find lines 519-535:

```ts
    } else if (hist.tab === "cinema" || hist.tab === "original-video") {
      // Both cinema (Viral) and original-video tabs share the same
      // 3-provider routing. Disambiguate by modelChoice when present:
      //   • sora2 → "sora2" (p6.ts maps to sora-2-vip)
      //   • veo   → cfg.videoR2V / cfg.videoT2V
      //   • grok or unset → cfg.grokI2V / cfg.grokT2V
      if (meta.modelChoice === "sora2" || /sora/i.test(model)) {
        model = "sora2";
      } else if (meta.modelChoice === "veo") {
        model = refImage ? cfg.videoR2V : cfg.videoT2V;
      } else {
        model = refImage ? cfg.grokI2V : cfg.grokT2V;
      }
    } else {
```

Replace with:

```ts
    } else if (hist.tab === "cinema" || hist.tab === "original-video") {
      // Both cinema (Viral) and original-video tabs share the same
      // 4-provider routing. Disambiguate by modelChoice when present:
      //   • sora2  → "sora2" (p6.ts maps to sora-2-vip)
      //   • veo    → cfg.videoR2V / cfg.videoT2V
      //   • gemini → "google/gemini-omni" (Crun via p2)
      //   • grok or unset → cfg.grokI2V / cfg.grokT2V
      if (meta.modelChoice === "sora2" || /sora/i.test(model)) {
        model = "sora2";
      } else if (meta.modelChoice === "veo") {
        model = refImage ? cfg.videoR2V : cfg.videoT2V;
      } else if (meta.modelChoice === "gemini") {
        model = "google/gemini-omni";
      } else {
        model = refImage ? cfg.grokI2V : cfg.grokT2V;
      }
    } else {
```

- [ ] **Step 4: Extend `videoAsset` type alias**

In the same file, find lines 686-687:

```ts
    const videoAsset: "video" | "grok" | "cinema" | "sora2" =
      cascadeAsset === "image" ? "video" : cascadeAsset;
```

Replace with:

```ts
    const videoAsset: "video" | "grok" | "cinema" | "sora2" | "gemini" =
      cascadeAsset === "image" ? "video" : cascadeAsset;
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "settle\.ts" | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/settle.ts && \
  git commit -m "$(cat <<'EOF'
feat(settle): handle gemini rows in event-driven retry + pricing

Patches lib/settle.ts in four places:
- inferModelHint: gemini-omni → "gemini" so deduct picks rate_gemini
- tryAutoRetry asset detection: gemini rows → cascade asset "gemini"
- model fallback picker: modelChoice='gemini' → "google/gemini-omni"
- videoAsset type alias extended to include "gemini"

Without these, an auto-resubmit fired by settle.ts after a Gemini
failure would walk the wrong slot pool and pick the wrong model id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 10: Add `isGeminiRow` exclusion in history-grid

**Files:**
- Modify: `app/dashboard/sections/history-grid.tsx:849-865` (canExtend block)

- [ ] **Step 1: Add `isGeminiRow` detection + exclude from canExtend**

Open `app/dashboard/sections/history-grid.tsx`. Find lines 849-865:

```ts
  const modelChoiceLower = String(
    (item.metadata as any)?.modelChoice || ""
  ).toLowerCase();
  const isGrokRow =
    modelChoiceLower === "grok" ||
    /grok-imagine|grok-3/.test(rawModelLower);
  const isSora2Row =
    modelChoiceLower === "sora2" ||
    /sora/i.test(rawModelLower);
  const canExtend =
    isVideo &&
    !isCinema &&
    !isClonePrompt &&
    !isGrokRow &&
    !isSora2Row &&
    item.status === "done" &&
    item.output_url;
```

Replace with:

```ts
  const modelChoiceLower = String(
    (item.metadata as any)?.modelChoice || ""
  ).toLowerCase();
  const isGrokRow =
    modelChoiceLower === "grok" ||
    /grok-imagine|grok-3/.test(rawModelLower);
  const isSora2Row =
    modelChoiceLower === "sora2" ||
    /sora/i.test(rawModelLower);
  // GeminiOmni rows are excluded from Extend for the same reason as
  // Grok / Sora 2 — extend pipeline is hard-wired to Veo i2v + Banana
  // refine. Chaining a Veo seg-2 onto a Gemini seg-1 produces a visible
  // style cut.
  const isGeminiRow =
    modelChoiceLower === "gemini" ||
    /gemini-omni/i.test(rawModelLower);
  const canExtend =
    isVideo &&
    !isCinema &&
    !isClonePrompt &&
    !isGrokRow &&
    !isSora2Row &&
    !isGeminiRow &&
    item.status === "done" &&
    item.output_url;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "history-grid" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/dashboard/sections/history-grid.tsx && \
  git commit -m "$(cat <<'EOF'
feat(history-grid): exclude gemini rows from Extend

Mirrors the existing Sora 2 / Grok exclusion — the Extend pipeline
is hard-wired to Veo i2v so chaining a Gemini seg-1 produces a
style cut. canExtend now requires !isGeminiRow alongside the other
two provider gates.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 11: Add GeminiOmni chip to Original Video tab

**Files:**
- Modify: `app/dashboard/tabs/original-video.tsx` (multiple insert points)

- [ ] **Step 1: Extend `Provider` type and add theme**

Open `app/dashboard/tabs/original-video.tsx`. Find line 31:

```ts
type Provider = "veo" | "grok" | "sora2";
```

Replace with:

```ts
type Provider = "veo" | "grok" | "sora2" | "gemini";
```

Then find the `PROVIDER_THEME` const (lines 37-66). After the `sora2:` entry's closing `}` (line 65), insert (before the closing `}` of `PROVIDER_THEME`):

```ts
,
  gemini: {
    // GeminiOmni — blue/cyan gradient (#3b82f6 → #06b6d4). Distinct
    // from Veo's gold, Grok's orange, Sora 2's red so the 4-chip row
    // reads as four visibly different providers at a glance.
    primary: "#06b6d4",
    soft: "rgba(6,182,212,0.25)",
    faint: "rgba(6,182,212,0.08)",
    gradient: "linear-gradient(135deg, #3b82f6, #06b6d4)",
    emoji: "🔷",
  },
```

So the final block ends with `sora2: { … }, gemini: { … }, };`.

- [ ] **Step 2: Add Gemini modes + ref cap**

In the same file, find lines 76-80 (`PROVIDER_MODES`):

```ts
const PROVIDER_MODES: Record<Provider, ImageMode[]> = {
  veo: ["text", "frame", "ingredient"],
  grok: ["text", "ingredient"],
  sora2: ["text", "frame"],
};
```

Replace with:

```ts
const PROVIDER_MODES: Record<Provider, ImageMode[]> = {
  veo: ["text", "frame", "ingredient"],
  grok: ["text", "ingredient"],
  sora2: ["text", "frame"],
  // GeminiOmni: text + ingredient (multi-ref up to 3). API has no
  // first-frame concept (just generic img_urls) — frame mode would
  // be UX duplication of single-image ingredient mode.
  gemini: ["text", "ingredient"],
};
```

Then find `getRefCap` (lines 85-90):

```ts
function getRefCap(provider: Provider, mode: ImageMode): number {
  if (mode === "text") return 0;
  if (mode === "frame") return provider === "veo" ? 2 : 1;
  // ingredient
  return 3;
}
```

Replace with:

```ts
function getRefCap(provider: Provider, mode: ImageMode): number {
  if (mode === "text") return 0;
  if (mode === "frame") return provider === "veo" ? 2 : 1;
  // ingredient — Veo + Grok + GeminiOmni all cap at 3 (Gemini API allows
  // 7 but Original Video tab UX matches Veo's 3 for layout consistency).
  return 3;
}
```

- [ ] **Step 3: Add Gemini rate state + fetch**

In the same file, find lines 120-122 (the rate state block):

```ts
  const [veoFlatRate, setVeoFlatRate] = useState<number | null>(null);
  const [grokRatePerSec, setGrokRatePerSec] = useState<number | null>(null);
  const [sora2RatePerSec, setSora2RatePerSec] = useState<number | null>(null);
```

Replace with:

```ts
  const [veoFlatRate, setVeoFlatRate] = useState<number | null>(null);
  const [grokRatePerSec, setGrokRatePerSec] = useState<number | null>(null);
  const [sora2RatePerSec, setSora2RatePerSec] = useState<number | null>(null);
  // GeminiOmni — flat per-10s-video rate (like Veo, not per-second).
  const [geminiFlatRate, setGeminiFlatRate] = useState<number | null>(null);
```

Then in the useEffect (lines 127-153), find the existing Sora 2 fetch block (lines 143-149):

```ts
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setSora2RatePerSec(d.rate);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
```

Replace with:

```ts
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setSora2RatePerSec(d.rate);
      })
      .catch(() => {});
    // GeminiOmni flat per-video rate (rate_gemini.per_video_10s).
    fetch("/api/gemini/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setGeminiFlatRate(d.rate);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
```

- [ ] **Step 4: Add Gemini duration clamp in provider-change effect**

In the same file, find lines 158-168 (the provider-change useEffect):

```ts
  useEffect(() => {
    if (!PROVIDER_MODES[provider].includes(imageMode)) {
      setImageMode("text");
    }
    if (provider === "veo" && duration !== 8) setDuration(8);
    if (provider === "sora2" && duration !== 8 && duration !== 12) {
      setDuration(8);
    }
    if (provider === "grok" && (duration < 8 || duration > 30)) {
      setDuration(Math.min(30, Math.max(8, duration)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
```

Replace with:

```ts
  useEffect(() => {
    if (!PROVIDER_MODES[provider].includes(imageMode)) {
      setImageMode("text");
    }
    if (provider === "veo" && duration !== 8) setDuration(8);
    if (provider === "sora2" && duration !== 8 && duration !== 12) {
      setDuration(8);
    }
    if (provider === "grok" && (duration < 8 || duration > 30)) {
      setDuration(Math.min(30, Math.max(8, duration)));
    }
    // GeminiOmni — fixed 10s.
    if (provider === "gemini" && duration !== 10) setDuration(10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);
```

- [ ] **Step 5: Add Gemini cost-preview branch**

In the same file, find lines 185-192 (the `estCost` cost preview block):

```ts
  let estCost: string | null = null;
  if (provider === "veo" && veoFlatRate != null) {
    estCost = veoFlatRate.toFixed(2);
  } else if (provider === "grok" && grokRatePerSec != null) {
    estCost = (grokRatePerSec * duration).toFixed(2);
  } else if (provider === "sora2" && sora2RatePerSec != null) {
    estCost = (sora2RatePerSec * duration).toFixed(2);
  }
```

Replace with:

```ts
  let estCost: string | null = null;
  if (provider === "veo" && veoFlatRate != null) {
    estCost = veoFlatRate.toFixed(2);
  } else if (provider === "grok" && grokRatePerSec != null) {
    estCost = (grokRatePerSec * duration).toFixed(2);
  } else if (provider === "sora2" && sora2RatePerSec != null) {
    estCost = (sora2RatePerSec * duration).toFixed(2);
  } else if (provider === "gemini" && geminiFlatRate != null) {
    // Gemini is flat per-video (10s fixed) — don't multiply by duration.
    estCost = geminiFlatRate.toFixed(2);
  }
```

- [ ] **Step 6: Add 4th chip to the provider picker grid**

In the same file, find lines 273-303 (the provider picker grid). Change the grid columns from 3 to 4, and add `"gemini"` to the chip array:

Current:

```tsx
        <div className="grid grid-cols-3 gap-2 mb-4">
          {(["veo", "grok", "sora2"] as const).map((p) => {
            const active = provider === p;
            const t = PROVIDER_THEME[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className="px-3 py-2.5 rounded-xl text-xs font-extrabold transition-all"
                style={
                  active
                    ? {
                        background: t.gradient,
                        color: p === "veo" ? "#1a1a1a" : "white",
                        boxShadow: `0 4px 12px ${t.soft}`,
                        border: "1px solid transparent",
                      }
                    : {
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-primary)",
                      }
                }
              >
                {t.emoji}{" "}
                {p === "veo" ? "Veo 3.1" : p === "grok" ? "Grok" : "Sora 2"}
              </button>
            );
          })}
        </div>
```

Replace with:

```tsx
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
          {(["veo", "grok", "sora2", "gemini"] as const).map((p) => {
            const active = provider === p;
            const t = PROVIDER_THEME[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className="px-3 py-2.5 rounded-xl text-xs font-extrabold transition-all"
                style={
                  active
                    ? {
                        background: t.gradient,
                        color: p === "veo" ? "#1a1a1a" : "white",
                        boxShadow: `0 4px 12px ${t.soft}`,
                        border: "1px solid transparent",
                      }
                    : {
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-primary)",
                      }
                }
              >
                {t.emoji}{" "}
                {p === "veo"
                  ? "Veo 3.1"
                  : p === "grok"
                    ? "Grok"
                    : p === "sora2"
                      ? "Sora 2"
                      : "GeminiOmni"}
              </button>
            );
          })}
        </div>
```

- [ ] **Step 7: Restrict aspect ratio options for Gemini**

In the same file, find lines 525-533 (the aspect ratio `<select>` options):

```tsx
              {provider === "veo" || provider === "grok" ? (
                <>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="2:3">2:3</option>
                  <option value="3:2">3:2</option>
                </>
              ) : null}
```

Wrap that ternary so Gemini doesn't get the extra options. The existing condition `provider === "veo" || provider === "grok"` already excludes Gemini (and Sora 2) — so no change needed here. **Skip this step** if the condition still reads exactly as above. (Listed for completeness — confirm the check passes by reading the diff after Step 8.)

- [ ] **Step 8: Add Gemini fixed-duration pill**

In the same file, find lines 538-549 (the Veo "Fixed 8s" pill block) and the wider duration block. The structure is:

```tsx
            {provider === "veo" && (
              <div … >Fixed 8s</div>
            )}
            {provider === "grok" && ( <input type="range" … /> )}
            {provider === "sora2" && ( <div grid-cols-2> … </div> )}
```

After the `provider === "sora2"` block's closing `)}` (around line 592), insert a new block before the parent `</div>`:

Find:

```tsx
            {provider === "sora2" && (
              <div className="grid grid-cols-2 gap-2">
                {([8, 12] as const).map((d) => {
                  ...
                })}
              </div>
            )}
          </div>
```

Replace with:

```tsx
            {provider === "sora2" && (
              <div className="grid grid-cols-2 gap-2">
                {([8, 12] as const).map((d) => {
                  const active = duration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      className="px-2 py-2 rounded-lg text-xs font-extrabold transition-all"
                      style={
                        active
                          ? {
                              background: theme.gradient,
                              color: "white",
                              boxShadow: `0 4px 12px ${theme.soft}`,
                            }
                          : {
                              background: "var(--color-bg)",
                              border: "1px solid var(--color-border)",
                              color: "var(--color-text-primary)",
                            }
                      }
                    >
                      {d}s
                    </button>
                  );
                })}
              </div>
            )}
            {provider === "gemini" && (
              <div
                className="px-3 py-2 rounded-lg text-sm font-bold text-center"
                style={{
                  background: theme.faint,
                  border: `1px solid ${theme.soft}`,
                  color: theme.primary,
                }}
              >
                Fixed 10s
              </div>
            )}
          </div>
```

(The Sora 2 map block is repeated verbatim so the new Gemini pill lands cleanly after it — the engineer should diff carefully to confirm no Sora 2 content was lost.)

- [ ] **Step 9: Send `resolution` field on Gemini submits**

In the same file, find lines 213-231 (the `submit()` fetch body):

```ts
      const r = await fetch("/api/generate/cinema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          image_url: pubUrls[0] || "",
          image_urls: pubUrls,
          duration,
          resolution: "720p",
          aspect_ratio: aspect,
          // Cinema route uses "text" / "frame" / "ingredient" directly.
          image_mode: imageMode,
          model: provider, // "veo" | "grok" | "sora2"
          // Tag so history grid can route this row into the Original
          // Video tab (separate from legacy Cinema / Grok rows).
          feature: "original-video",
          project_id: projectId,
        }),
      });
```

Replace with:

```ts
      const r = await fetch("/api/generate/cinema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          image_url: pubUrls[0] || "",
          image_urls: pubUrls,
          duration,
          // Gemini forces 1080p server-side; we still send the right
          // value here so the optimistic UI cost preview matches what
          // /api/generate/cinema will actually compute.
          resolution: provider === "gemini" ? "1080p" : "720p",
          aspect_ratio: aspect,
          // Cinema route uses "text" / "frame" / "ingredient" directly.
          image_mode: imageMode,
          model: provider, // "veo" | "grok" | "sora2" | "gemini"
          // Tag so history grid can route this row into the Original
          // Video tab (separate from legacy Cinema / Grok rows).
          feature: "original-video",
          project_id: projectId,
        }),
      });
```

- [ ] **Step 10: Update the Generate button label**

In the same file, find lines 607-614 (the submit button label):

```tsx
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </span>
          ) : (
            `${theme.emoji} Generate ${provider === "veo" ? "Veo" : provider === "grok" ? "Grok" : "Sora 2"} Video${estCost ? ` · ~RM${estCost}` : ""}`
          )}
```

Replace with:

```tsx
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </span>
          ) : (
            `${theme.emoji} Generate ${provider === "veo" ? "Veo" : provider === "grok" ? "Grok" : provider === "sora2" ? "Sora 2" : "GeminiOmni"} Video${estCost ? ` · ~RM${estCost}` : ""}`
          )}
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "original-video" | head -20
```

Expected: no errors.

- [ ] **Step 12: Visual smoke test in browser**

Start the dev server:

```bash
cd /e/Project/HCKCREA && npm run dev
```

Open `http://localhost:3000/dashboard` → click **Original Video** tab. Verify:
1. Four chips render: Veo 3.1 / Grok / Sora 2 / GeminiOmni
2. Clicking GeminiOmni chip applies cyan/blue gradient
3. Image-mode picker only shows "Text only" + "References"
4. Duration shows a "Fixed 10s" pill
5. Aspect ratio dropdown shows only 9:16 + 16:9 (no 1:1/2:3/3:2)
6. Generate button label: "🔷 Generate GeminiOmni Video · ~RM<x>"

If anything is wrong, fix inline and re-run TypeScript check before committing.

- [ ] **Step 13: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/dashboard/tabs/original-video.tsx && \
  git commit -m "$(cat <<'EOF'
feat(original-video): add GeminiOmni 4th provider chip

Mirrors the Veo / Grok / Sora 2 wiring: theme, modes (text +
ingredient), getRefCap 3, fixed 10s duration pill, /api/gemini/rate
cost preview, submit body sends model='gemini' + resolution='1080p'.
Provider grid switches from grid-cols-3 to grid-cols-2 sm:grid-cols-4
so the 4 chips fit on small + large screens.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 12: Wire admin settings page (rate + cascade UI)

**Files:**
- Modify: `app/admin/settings/page.tsx` (multiple insert points; mirror Sora 2 wiring everywhere)

- [ ] **Step 1: Add `rateGemini` state**

Open `app/admin/settings/page.tsx`. Find line 67:

```ts
  const [rateSeedance, setRateSeedance] = useState("");
```

Immediately before line 68 (`const [savingRates …`), insert:

```ts
  // GeminiOmni flat per-10s-video rate. Stored as
  // app_settings.rate_gemini = { per_video_10s: number }. /api/gemini/rate
  // serves this to the Original Video tab's GeminiOmni cost preview.
  const [rateGemini, setRateGemini] = useState("");
```

- [ ] **Step 2: Add Gemini cascade state**

In the same file, find lines 159-162:

```ts
  const [sora2MainCount, setSora2MainCount] = useState(10);
  const [sora2FallbackCount, setSora2FallbackCount] = useState(10);
  const [sora2MainSlots, setSora2MainSlots] = useState<SlotV[]>([]);
  const [sora2FallbackSlots, setSora2FallbackSlots] = useState<SlotV[]>([]);
```

Immediately after line 162, insert:

```ts
  // GeminiOmni cascade — Crun is currently the only Gemini host so
  // MAIN defaults seed p2-a / p2-b; FALLBACK is empty until a second
  // provider is wired in.
  const [geminiMainCount, setGeminiMainCount] = useState(10);
  const [geminiFallbackCount, setGeminiFallbackCount] = useState(10);
  const [geminiMainSlots, setGeminiMainSlots] = useState<SlotV[]>([]);
  const [geminiFallbackSlots, setGeminiFallbackSlots] = useState<SlotV[]>([]);
```

Then find line 163:

```ts
  const [savingMfSlots, setSavingMfSlots] = useState<"video" | "image" | "grok" | "cinema" | "sora2" | null>(null);
```

Replace with:

```ts
  const [savingMfSlots, setSavingMfSlots] = useState<"video" | "image" | "grok" | "cinema" | "sora2" | "gemini" | null>(null);
```

- [ ] **Step 3: Hydrate rate + slot state from app_settings**

In the same file, find line 276 (the `rateSora2` load):

```ts
        if (row.key === "sora2_rate") setRateSora2(fmt(row.value?.rate));
```

Immediately after that line, insert:

```ts
        if (row.key === "rate_gemini") setRateGemini(fmt(row.value?.per_video_10s));
```

Then find lines 460-477 (the Sora 2 cascade hydration block). After the closing `}` of the `sora2_fallback_slots` branch (line 477), insert:

```ts
        // GeminiOmni cascade
        if (row.key === "gemini_main_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setGeminiMainCount(Math.floor(n));
        }
        if (row.key === "gemini_fallback_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setGeminiFallbackCount(Math.floor(n));
        }
        if (row.key === "gemini_main_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "gemini_main_count")?.value?.count) || 10;
          setGeminiMainSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
        if (row.key === "gemini_fallback_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "gemini_fallback_count")?.value?.count) || 10;
          setGeminiFallbackSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
```

- [ ] **Step 4: Extend `saveMainFallback` signature + branches**

In the same file, find line 485 (the function signature):

```ts
  async function saveMainFallback(asset: "video" | "image" | "grok" | "cinema" | "sora2") {
```

Replace with:

```ts
  async function saveMainFallback(asset: "video" | "image" | "grok" | "cinema" | "sora2" | "gemini") {
```

Then find lines 489-512 (the count + slot selectors inside that function):

```ts
      const mainCount =
        asset === "video" ? videoMainCount
        : asset === "image" ? imageMainCount
        : asset === "grok" ? grokMainCount
        : asset === "sora2" ? sora2MainCount
        : cinemaMainCount;
      const fbCount =
        asset === "video" ? videoFallbackCount
        : asset === "image" ? imageFallbackCount
        : asset === "grok" ? grokFallbackCount
        : asset === "sora2" ? sora2FallbackCount
        : cinemaFallbackCount;
      const main =
        asset === "video" ? videoMainSlots
        : asset === "image" ? imageMainSlots
        : asset === "grok" ? grokMainSlots
        : asset === "sora2" ? sora2MainSlots
        : cinemaMainSlots;
      const fb =
        asset === "video" ? videoFallbackSlots
        : asset === "image" ? imageFallbackSlots
        : asset === "grok" ? grokFallbackSlots
        : asset === "sora2" ? sora2FallbackSlots
        : cinemaFallbackSlots;
```

Replace with:

```ts
      const mainCount =
        asset === "video" ? videoMainCount
        : asset === "image" ? imageMainCount
        : asset === "grok" ? grokMainCount
        : asset === "sora2" ? sora2MainCount
        : asset === "gemini" ? geminiMainCount
        : cinemaMainCount;
      const fbCount =
        asset === "video" ? videoFallbackCount
        : asset === "image" ? imageFallbackCount
        : asset === "grok" ? grokFallbackCount
        : asset === "sora2" ? sora2FallbackCount
        : asset === "gemini" ? geminiFallbackCount
        : cinemaFallbackCount;
      const main =
        asset === "video" ? videoMainSlots
        : asset === "image" ? imageMainSlots
        : asset === "grok" ? grokMainSlots
        : asset === "sora2" ? sora2MainSlots
        : asset === "gemini" ? geminiMainSlots
        : cinemaMainSlots;
      const fb =
        asset === "video" ? videoFallbackSlots
        : asset === "image" ? imageFallbackSlots
        : asset === "grok" ? grokFallbackSlots
        : asset === "sora2" ? sora2FallbackSlots
        : asset === "gemini" ? geminiFallbackSlots
        : cinemaFallbackSlots;
```

- [ ] **Step 5: Add Gemini rate save in `saveModelRates`**

In the same file, find lines 583-590 (the Sora 2 rate save block inside `saveModelRates`'s `Promise.all`):

```ts
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "sora2_rate",
            value: { rate: num(rateSora2, 0.20) },
          }),
        }),
```

Immediately after the closing `}),` of that block (before the `fetch` for `rate_seedance`), insert:

```ts
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "rate_gemini",
            value: { per_video_10s: num(rateGemini, 0.40) },
          }),
        }),
```

- [ ] **Step 6: Add Gemini rate input to the rates card UI**

In the same file, find lines 1589-1605 (the Sora 2 rate input card):

```tsx
          {/* Sora 2 (OpenAI via APIPod) — per-second rate. Used by:
              standalone Sora 2 tab + Auto Content when Sora 2 picker
              selected. Defaults to 0.20/sec (~2x Grok rate per APIPod
              docs: "more stable but higher unit price"). */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" /> Sora 2 <span className="text-[10px] font-normal text-[var(--color-text-muted)]">(OpenAI) / second</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateSora2}
                onChange={(e) => setRateSora2(e.target.value)}
                className="input !pl-10"
                placeholder="0.20"
              />
            </div>
          </div>
```

Immediately after that block's closing `</div>` (before the Seedance block at line 1606), insert:

```tsx
          {/* GeminiOmni (Google via Crun) — flat per-10s-video rate.
              Original Video tab fixes duration at 10s + resolution at
              1080p so admin only sets one number. Default RM 0.40 mirrors
              Veo's 8s rate (Gemini's compute footprint is similar). */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" /> GeminiOmni <span className="text-[10px] font-normal text-[var(--color-text-muted)]">(Google) / 10s video</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateGemini}
                onChange={(e) => setRateGemini(e.target.value)}
                className="input !pl-10"
                placeholder="0.40"
              />
            </div>
          </div>
```

- [ ] **Step 7: Add Gemini cascade entry to the `assets` config**

In the same file, find lines 1310-1341 (the Sora 2 cascade entry inside `assets = [`). Immediately after the closing `}` of that entry (line 1341), and before the `];` that closes the array, insert:

```tsx
          {
            // GeminiOmni cascade — Crun is the primary backend (p2-a /
            // p2-b). VIDEO_ALLOWED is the same pool other video assets
            // use; non-p2 slots will fail at create today (Crun is the
            // only host) but the option list stays consistent so admin
            // can wire in a second provider later without code changes.
            asset: "gemini",
            color: "#06b6d4", // cyan — matches GeminiOmni chip theme
            options: [
              { value: "p1", label: "P1 — GeminiGen" },
              { value: "p2-a", label: "P2 — Crun (key A)" },
              { value: "p2-b", label: "P2 — Crun (key B)" },
              { value: "p5", label: "P5 — APIMart" },
              { value: "p6-a", label: "P6 — APIPod (A)" },
              { value: "p6-b", label: "P6 — APIPod (B)" },
              { value: "p6-c", label: "P6 — APIPod (C)" },
              { value: "p6-d", label: "P6 — APIPod (D)" },
              { value: "p6-e", label: "P6 — APIPod (E)" },
              { value: "p6-f", label: "P6 — APIPod (F)" },
              { value: "p6-g", label: "P6 — APIPod (G)" },
              { value: "p6-h", label: "P6 — APIPod (H)" },
              { value: "none", label: "— None —" },
            ],
            mainCount: geminiMainCount,
            setMainCount: setGeminiMainCount,
            fbCount: geminiFallbackCount,
            setFbCount: setGeminiFallbackCount,
            mainSlots: geminiMainSlots,
            setMainSlots: (s) => setGeminiMainSlots(s as SlotV[]),
            fbSlots: geminiFallbackSlots,
            setFbSlots: (s) => setGeminiFallbackSlots(s as SlotV[]),
          },
```

- [ ] **Step 8: Add Gemini keys to the visible-known-keys lists**

In the same file, find line 1050 (`"rate_veo",`) and ~line 1056 (`"sora2_rate",`). Add `"rate_gemini",` to that array. Search for `"sora2_rate"` and add immediately after:

Find:

```ts
    "rate_veo",
```

(In a known-keys array. Verify it's in a string array of allowed keys, not inside a load block.)

Add a sibling entry. Specifically, find the existing `"sora2_rate"` entry — it appears twice in the file. Add `"rate_gemini"` next to whichever is in the rates-known-keys list.

Use this command to locate both lines:

```bash
grep -n '"sora2_rate"' /e/Project/HCKCREA/app/admin/settings/page.tsx
```

For the line in the known-keys array (NOT inside the save block — the save block is around line 587), add `"rate_gemini",` on the next line.

Then find line ~1084 (`"sora2_fallback_counter",`) and add Gemini's two counters:

```ts
    "sora2_rotation_counter",
    "sora2_fallback_counter",
```

Replace with:

```ts
    "sora2_rotation_counter",
    "sora2_fallback_counter",
    "gemini_rotation_counter",
    "gemini_fallback_counter",
```

Then find lines 1153-1156 (the cascade-keys array):

```ts
    "sora2_main_count",
    "sora2_main_slots",
    "sora2_fallback_count",
    "sora2_fallback_slots",
```

Replace with:

```ts
    "sora2_main_count",
    "sora2_main_slots",
    "sora2_fallback_count",
    "sora2_fallback_slots",
    "gemini_main_count",
    "gemini_main_slots",
    "gemini_fallback_count",
    "gemini_fallback_slots",
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "admin/settings/page" | head -20
```

Expected: no errors.

- [ ] **Step 10: Visual smoke test in browser**

`npm run dev` (if not still running), then open `http://localhost:3000/admin/settings`. Verify:
1. Rates card shows a **GeminiOmni (Google) / 10s video** input next to Sora 2
2. Cascade card shows a **GEMINI CASCADE** block with main + fallback slot pickers
3. Defaults: main slot 0 = `p2-a`, slot 1 = `p2-b`, rest `none`; fallback all `none`
4. Editing the rate and clicking "Save Rates" persists (refresh and confirm value sticks)
5. Editing a cascade slot and clicking "Save gemini cascade" persists

- [ ] **Step 11: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/admin/settings/page.tsx && \
  git commit -m "$(cat <<'EOF'
feat(admin): GeminiOmni rate input + cascade slot UI

Mirrors the Sora 2 wiring in /admin/settings:
- rateGemini state + rate_gemini.per_video_10s persistence
- geminiMain/FallbackCount + Slots state + hydration
- Gemini rate input in the Rates card (next to Sora 2)
- Gemini cascade entry in the Cascade card (cyan color, full VIDEO
  slot pool options, default seeds p2-a + p2-b)
- saveMainFallback signature extended to include "gemini"
- Internal counter keys and known cascade keys registered so the raw
  app_settings editor below picks them up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 13: End-to-end smoke test on production

**Files:** None modified — verification only.

- [ ] **Step 1: Wait for Vercel deploy**

After the Task 12 push, wait for Vercel to finish deploying (typically 60-90s). The build status is visible at the repo's GitHub Actions / Vercel dashboard. If you have `gh` CLI configured:

```bash
cd /e/Project/HCKCREA && gh run list --limit 1
```

- [ ] **Step 2: Seed the admin rate**

Open `https://peninglab.com/admin/settings`. In the Rates card, set **GeminiOmni** to a real rate (e.g. `0.40`). Click **Save Rates**. Confirm the success toast.

Curl-verify the rate endpoint:

```bash
curl -s https://peninglab.com/api/gemini/rate
```

Expected: `{"rate":0.4}`.

- [ ] **Step 3: Confirm cascade defaults**

In `/admin/settings` Cascade card, locate the **GEMINI CASCADE** block. Confirm:
- Main slot 0 = `p2-a`, slot 1 = `p2-b` (or whatever the round-robin counter shows)
- Fallback = all `none`

If the defaults haven't auto-populated, click **Save gemini cascade** once to persist them.

- [ ] **Step 4: Fire a text-only GeminiOmni generation**

Open `https://peninglab.com/dashboard`. Pick the **Original Video** tab. Click the 🔷 **GeminiOmni** chip. Enter a simple prompt:

> "A glass perfume bottle on a reflective surface, slow camera dolly-in, soft studio lighting."

Verify the cost preview reads `~RM0.40` (or whatever rate is set). Click **Generate GeminiOmni Video**.

Confirm:
1. New history row appears with the spinning loader
2. Eventually flips to `done` with a playable mp4 (typically 60-120s for Crun video)
3. Cost on the row reads RM0.40 (or your seeded rate)

If the row fails, check `/admin/errors` for the tier_log — confirm it shows `1:p2-a:google/gemini-omni`.

- [ ] **Step 5: Fire a multi-ref GeminiOmni generation**

Same tab, GeminiOmni chip. Switch image mode to **References**. Pick 2-3 attachment images. Same simple prompt. Generate.

Confirm:
1. Cost preview unchanged (`~RM0.40` — Gemini is flat per video, not per-image)
2. Row succeeds with playable mp4
3. Reference image visible on the card thumbnail

- [ ] **Step 6: Verify history grid + Resubmit**

In the history grid, locate any failed GeminiOmni row (you can simulate by temporarily setting all main slots to `none` then re-firing — that will fail). Click **Resubmit**. Confirm:
1. Row flips back to pending immediately
2. tier_log on the row eventually shows `1:p2-X:google/gemini-omni` (whichever fallback was tried)
3. Reference images preserved across the resubmit

- [ ] **Step 7: Verify Extend is correctly hidden**

On a successful GeminiOmni row, confirm the **Extend** button is NOT shown (per the `isGeminiRow` exclusion in Task 10). The Save / Download / Delete actions should be present as normal.

- [ ] **Step 8: Verify usage tracking**

Open `https://peninglab.com/admin/usage`. Filter by user_id (yours) or look for the most recent rows. Confirm:
1. GeminiOmni generations appear in the usage table
2. The "cost" column shows the RM amount you set as the rate
3. The "model" column shows `google/gemini-omni`

- [ ] **Step 9: Mark done**

If all 8 prior steps pass, GeminiOmni is fully wired. No commit needed for this task.

If any step fails, file the failure with the exact symptom + browser console / Vercel log excerpt and stop — fix before declaring the feature complete.

---

## Self-Review

**1. Spec coverage check**

| Spec section | Plan task |
|---|---|
| §1 Behavior Summary (chip color, modes, duration, resolution, pricing model) | Tasks 2, 7, 11 |
| §2 Architecture (cascade + p2 + settle + callback paths) | Tasks 4, 5, 6, 9 |
| §3.1 cascade-rotation.ts | Task 4 |
| §3.2 video-cascade.ts | Task 5 |
| §3.3 p2.ts isGemini | Task 6 |
| §3.4 cinema/route.ts | Task 7 |
| §3.5 /api/gemini/rate (new file) | Task 3 |
| §3.6 getGeminiRate helper | Task 2 |
| §3.7 original-video.tsx (chip + modes + rate + duration + cost) | Task 11 |
| §3.8 history-grid isGeminiRow | Task 10 |
| §3.9 admin settings page (rate + cascade UI) | Task 12 |
| §4 E2E requirements (usage, history, cascade, fallback, event-driven, auto-poll, recheck, resubmit) | All tasks + verified in Task 13 |
| §5 Manual admin setup | Task 13 Step 2 |
| §6 Future provider (out of scope by design) | n/a |

**Gap found during planning** (corrected inline): Spec §4 claimed "Resubmit (image reference)" and "Auto-poll" worked without code change. They DON'T — `/api/history/retry/route.ts` and `lib/settle.ts` + `lib/deduct.ts` all have explicit modelChoice branches. Tasks 1, 8, 9 added.

**2. Placeholder scan** — searched for "TBD", "TODO", "fill in", "implement later", "similar to Task". None present in the plan body.

**3. Type consistency check**

- `PriceModelHint` extended to `… | "gemini"` in Task 1; used in Task 9 step 1. ✓
- `CascadeAsset` extended to `… | "gemini"` in Task 4; used in Tasks 5, 9. ✓
- `Provider` extended to `… | "gemini"` in Task 11; used in same file across all steps. ✓
- `modelChoice` extended to `"grok" | "veo" | "sora2" | "gemini"` in Task 7; used in Tasks 8, 9, 11. ✓
- `videoAsset` extended in Task 9 step 4 to match the cascade union. ✓
- `saveMainFallback` parameter extended in Task 12 step 4. ✓
- `getGeminiRate("10")` signature: defined Task 2, used Task 1 + 3 + 7. ✓
- `getGeminiMainSlots` / `getGeminiFallbackSlots`: defined Task 4, used Task 5. ✓
- `app_settings` key `rate_gemini.per_video_10s`: written in Task 12 step 5, read in Task 2 + Task 1 + Task 7. ✓
- `cinemaProvider="crun"` for Gemini: stamped in Task 7, no consumer reads it as a routing key (only used for display) so safe. ✓
- `meta.modelChoice === "gemini"`: stamped in Task 7, read in Tasks 8, 9, 10. ✓

All type and naming changes are internally consistent.
