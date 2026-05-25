# GeminiOmni Provider — Original Video Tab Design

**Goal:** Add **GeminiOmni** (Google Gemini Omni via Crun.ai) as a 4th provider chip in the Original Video tab, fully wired into the existing cascade / fallback / event-driven settle / auto-poll / recheck / resubmit infrastructure.

**Out of scope:** Video-reference mode (`video_list` API field), resolution picker, duration picker, multi-aspect (1:1/2:3/3:2). All fixed.

---

## 1. Behavior Summary

| Knob | Value | Rationale |
|---|---|---|
| Display name | **GeminiOmni** | One word, matches user direction |
| Provider id | `gemini` | Same shape as `veo`/`grok`/`sora2` |
| Crun model id | `google/gemini-omni` | Per Crun.ai doc |
| Image modes | `text` + `ingredient` (multi-ref) | GeminiOmni has only `img_urls` — no first-frame distinction; same pattern as Grok |
| Multi-ref cap | **3** | Matches Veo cap; keeps `REF_SLOTS=3` so no UI layout change |
| Duration | **Fixed 10s** | Mirrors Veo's "Fixed 8s" pill |
| Aspect ratio | **9:16 or 16:9** | GeminiOmni API limits; same as Sora 2 |
| Resolution | **Fixed 1080p** | Hardcoded server-side; no picker |
| Pricing model | **Flat per-video** (mirrors Veo) | Admin sets `rate_gemini.per_video_10s` |
| Cascade asset | `"gemini"` (new pool) | Independent main/fallback slot lists |
| Initial slot | `p2-a` (Crun) | First provider; second provider added later via admin |
| Chip color | Cyan/blue gradient `#3b82f6 → #06b6d4`, emoji 🔷 | Visually distinct from Veo gold / Grok orange / Sora 2 red |

---

## 2. Architecture

GeminiOmni reuses the existing infrastructure that powers Veo/Grok/Sora 2. No new pipelines; only additions to existing branch logic.

```
[Original Video tab]
       │  POST { model: "gemini", image_urls, prompt, ... }
       ▼
[/api/generate/cinema]
       │  modelChoice === "gemini"
       │  duration=10, resolution="1080p"
       │  asset="gemini"
       ▼
[generateVideoWithCascade  (lib/video-cascade.ts)]
       │  getGeminiMainSlots() → ["p2-a", "none", …]
       │  round-robin pick → tryVideoSlot("p2-a")
       ▼
[p2CreateTask  (lib/p2.ts)]
       │  isGemini branch → body = { model, input:{prompt, img_urls(<=3), duration:10, aspect_ratio, resolution:"1080p"} }
       │  callback_url auto-attached → /api/callback/p2
       ▼
[Crun.ai]
       │  task accepted → task_id
       │  ... task runs ...
       │  task done → POST callback → /api/callback/p2
       ▼
[settle.ts → p2GetStatus → history.update(status=done, output_url=…)]
```

Status flow always finishes via one of three paths:

1. **Event-driven (preferred):** Crun POSTs `/api/callback/p2` when task finishes → settle runs → history row flips to `done`.
2. **Auto-poll fallback:** `/api/worker/poll-pending` cron walks pending rows, calls `p2GetStatus`, settles them.
3. **Manual recheck:** User clicks "Check Status" on a stuck row → same `p2GetStatus` path.

All three already exist for `veo`/`grok`/`sora2`. GeminiOmni inherits them automatically because:
- Row's `metadata.provider="p2"` is stamped at create-time (already done by cascade)
- Settle dispatches by `metadata.provider`, not by `modelChoice`

---

## 3. File Changes

### 3.1 `lib/cascade-rotation.ts` — add Gemini slot pool

- Extend `CascadeAsset` type: add `"gemini"`
- Add `DEFAULT_GEMINI_MAIN: SlotProvider[]` = `["p2-a", "p2-b", "none", "none", "none", "none", "none", "none", "none", "none"]`
- Add `DEFAULT_GEMINI_FALLBACK: SlotProvider[]` = `["none", "none", "none", "none", "none", "none", "none", "none", "none", "none"]` (filled when second provider is added)
- Add two new exports:
  - `getGeminiMainSlots(): Promise<SlotProvider[]>` — reads `gemini_main_slots` + `gemini_main_count`
  - `getGeminiFallbackSlots(): Promise<SlotProvider[]>` — reads `gemini_fallback_slots` + `gemini_fallback_count`
- Both use `VIDEO_ALLOWED` for slot validation (same as Sora 2)

### 3.2 `lib/video-cascade.ts` — wire Gemini asset

- Extend `VideoCascadeInput.asset` union: `"video" | "grok" | "cinema" | "sora2" | "gemini"`
- Add branch to `getMains` and `getFbs` resolution:
  ```ts
  asset === "gemini" ? getGeminiMainSlots : ...
  asset === "gemini" ? getGeminiFallbackSlots : ...
  ```

### 3.3 `lib/p2.ts` — add GeminiOmni body builder

In `p2CreateTaskInternal`, add a new detection branch alongside the existing `isVeo`/`isGrok`/`isSeedance` checks:

```ts
const isGemini = m.includes("gemini-omni");
```

Update the catch-all order so `isBanana` excludes Gemini:
```ts
const isBanana = !isVideo && !isGptImage && !isGrok && !isSeedance && !isZImage && !isGemini;
```

Add a Gemini body-build block:
```ts
} else if (isGemini) {
  // GeminiOmni: img_urls (1-7, we cap at 3 via caller), duration, aspect_ratio,
  // resolution. No "frame" mode — model treats refs generically.
  if (imgUrls.length > 0) innerInput.img_urls = imgUrls.slice(0, 3);
  innerInput.duration = Number(input.durationMode || 10);
  if (input.aspectRatio) innerInput.aspect_ratio = input.aspectRatio;
  innerInput.resolution = String(input.resolution || "1080p").toLowerCase();
}
```

Also add Gemini to the `pickProvider` asset detection so admin's `gen_provider_<asset>` can route Gemini to p1 if it ever supports GeminiOmni:
```ts
const isGemini = m.includes("gemini-omni");
const asset = isGemini ? "gemini" : isSeedance ? "seedance" : ...
```

### 3.4 `app/api/generate/cinema/route.ts` — add gemini branch

- Extend `modelChoice` union: `"grok" | "veo" | "sora2" | "gemini"`
- Body parse: `body?.model === "gemini" ? "gemini" : ...`
- Duration force when `modelChoice === "gemini"`: set `duration = 10`
- Resolution force when `modelChoice === "gemini"`: set `resolution = "1080p"`
- Image mode clamp when `modelChoice === "gemini"`: `frame → ingredient` (since GeminiOmni doesn't distinguish; treat single image as a 1-element ingredient list). Keep `text` and `ingredient` as-is.
- Model id pick:
  ```ts
  if (modelChoice === "gemini") model = "google/gemini-omni";
  ```
- Cost branch:
  ```ts
  else if (modelChoice === "gemini") {
    const geminiFlat = await getGeminiRate("10");
    cost = Number(geminiFlat.toFixed(4));
  }
  ```
- Cascade asset:
  ```ts
  asset:
    modelChoice === "grok" ? "grok" :
    modelChoice === "sora2" ? "sora2" :
    modelChoice === "gemini" ? "gemini" :
    "video"
  ```
- Metadata stamping (both at insert + after success): add Gemini branch to `cinemaProvider`:
  ```ts
  cinemaProvider:
    modelChoice === "veo" ? "veo" :
    modelChoice === "sora2" ? "apipod" :
    modelChoice === "gemini" ? "crun" :
    "grok-imagine"
  ```

### 3.5 `app/api/gemini/rate/route.ts` — NEW FILE

Mirror `/api/veo/rate`:
```ts
import { NextResponse } from "next/server";
import { getGeminiRate } from "@/lib/settings";

export async function GET() {
  const rate = await getGeminiRate("10");
  return NextResponse.json({ rate });
}
```

### 3.6 `lib/settings.ts` — add `getGeminiRate` helper

Mirror `getVeoRate`. Reads `rate_gemini` setting with shape `{ per_video_10s: number }`. Falls back to a sensible default (e.g. cinema rate × 4) so the row doesn't break if admin hasn't configured it.

### 3.7 `app/dashboard/tabs/original-video.tsx` — add 4th chip

- Extend `Provider` union: `"veo" | "grok" | "sora2" | "gemini"`
- Add `PROVIDER_THEME.gemini`:
  ```ts
  gemini: {
    primary: "#06b6d4",
    soft: "rgba(6,182,212,0.25)",
    faint: "rgba(6,182,212,0.08)",
    gradient: "linear-gradient(135deg, #3b82f6, #06b6d4)",
    emoji: "🔷",
  }
  ```
- Add `PROVIDER_MODES.gemini = ["text", "ingredient"]`
- Update `getRefCap`: when `gemini + ingredient` return `3`
- Provider picker grid: change `grid-cols-3` → `grid-cols-2 sm:grid-cols-4` so 4 chips fit; update the `(["veo", "grok", "sora2"] as const)` array to include `"gemini"`
- Display label: `p === "gemini" ? "GeminiOmni"`
- Add `geminiFlatRate` state + `fetch("/api/gemini/rate")` in the existing useEffect
- Aspect ratio select: add `provider === "gemini"` to the `else if` that suppresses 1:1/2:3/3:2 options (only show 9:16 / 16:9)
- Duration block: add a Gemini branch that renders the same "Fixed 10s" pill as Veo's "Fixed 8s"
- `useEffect` provider-change clamp: `if (provider === "gemini" && duration !== 10) setDuration(10);`
- Cost preview: add `else if (provider === "gemini" && geminiFlatRate != null) estCost = geminiFlatRate.toFixed(2);`
- Submit body: `resolution` field for Gemini = `"1080p"` (server already forces this, but send correct value to match what user sees)
- Generate button label branch: `provider === "gemini" ? "GeminiOmni"`

### 3.8 `app/dashboard/sections/history-grid.tsx` — add isGeminiRow + exclude Extend

Mirror `isSora2Row` detection at line ~855:
```ts
const isGeminiRow =
  modelChoiceLower === "gemini" ||
  /gemini-omni/i.test(rawModelLower);
```

Update `canExtend` to exclude Gemini rows (same reason as Grok/Sora 2 — extend pipeline is Veo-only):
```ts
const canExtend = isVideo && !isCinema && !isClonePrompt &&
  !isGrokRow && !isSora2Row && !isGeminiRow &&
  item.status === "done" && item.output_url;
```

Resubmit logic already reads `metadata.image_urls` + `metadata.modelChoice` — no change needed, will fire `/api/generate/cinema` with `model=gemini` automatically.

### 3.9 `app/admin/settings/page.tsx` — Gemini cascade UI + rate input

Mirror the Sora 2 patches that already exist:

- Add `rateGemini` state + corresponding load branch (line ~271 area):
  ```ts
  if (row.key === "rate_gemini") setRateGemini(fmt(row.value?.per_video_10s));
  ```
- Add `geminiMainCount` / `geminiMainSlots` / `geminiFallbackCount` / `geminiFallbackSlots` state + load branches (lines ~461-477 area)
- Add the rate save in the save loop (line ~568 area): write `rate_gemini` with `{ per_video_10s: parseFloat(rateGemini) }`
- Add to the "known keys" list (~line 1050) and "internal keys" list (~line 1080) and "cascade keys" list (~line 1150):
  ```ts
  "rate_gemini",
  "gemini_rotation_counter", "gemini_fallback_counter",
  "gemini_main_count", "gemini_main_slots", "gemini_fallback_count", "gemini_fallback_slots"
  ```
- Render a new "Gemini Rate" input next to the Sora 2 rate input
- Render a new "Gemini Cascade" slot table mirroring the Sora 2 slot table

---

## 4. End-to-End Requirements Verification

| Requirement | How it works |
|---|---|
| **Usage tracking** | `history.cost` is set at row creation by cinema route's `after()` block. `/admin/usage` page already reads all history rows. Gemini rows show up automatically with the right cost. |
| **History working** | `tab='original-video'` stamped on insert (same as Veo/Grok/Sora 2). History grid filter already includes this tab. |
| **Cascade** | `asset='gemini'` routes through new `gemini_main_slots` pool. Round-robin pick + skip-slot logic unchanged. |
| **Fallback** | `gemini_fallback_slots` pool walked when all main attempts fail. Admin clicks Resubmit → bypasses round-robin and starts at first fallback (existing `forceFirstFallback` path). |
| **Event-driven settle** | `p2CreateTask` auto-attaches `callback_url` via `buildP2CallbackUrl()`. Crun POSTs `/api/callback/p2` when task completes → settle.ts updates history row. |
| **Auto-poll** | `/api/worker/poll-pending` cron iterates pending rows by age. Dispatches via `metadata.provider="p2"` → `p2GetStatus`. Works for Gemini rows without code change. |
| **Recheck** | History grid "Check Status" button hits `/api/generate/status` which calls the same `p2GetStatus`. Works for Gemini rows without code change. |
| **Resubmit (image reference)** | History grid Resubmit button POSTs `/api/generate/cinema` with `metadata.image_urls` + `model=metadata.modelChoice`. Since we stamp `modelChoice='gemini'` and `image_urls` correctly, resubmit re-fires Gemini with same refs. |

---

## 5. Manual Admin Setup (post-deploy)

1. Open `/admin/settings`
2. Set "Gemini Rate" — RM per 10s video (e.g. RM4.00)
3. In "Gemini Cascade" section, set Main slot 0 to `p2-a` (and optionally `p2-b` as slot 1)
4. Leave Fallback empty for now — second provider gets added here later

---

## 6. Future Provider (separate spec)

When the next GeminiOmni-compatible provider's docs arrive:
1. Add adapter (if new API) or reuse existing (if it's an already-supported provider like p5/p6)
2. Add slot id to `SlotProvider` union if new (e.g. `p7-a`)
3. Add slot id to `VIDEO_ALLOWED`
4. Admin adds the new slot to `gemini_fallback_slots` in `/admin/settings`
5. Done — Gemini cascade now has automatic fallback

No core changes to `video-cascade.ts`, `cinema/route.ts`, or `original-video.tsx` needed for that addition.
