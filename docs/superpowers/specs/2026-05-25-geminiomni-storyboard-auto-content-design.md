# GeminiOmni Storyboard Mode — Auto Content Tab Design

**Goal:** Add **GeminiOmni** as a 3rd provider for the Auto Content tab with a unique two-stage pipeline: generate a key-frame storyboard image via **GPT Image 2** first, then have **GeminiOmni** animate that storyboard into a 10s video. Users keep picking from the existing 18 frameworks; the storyboard step is invisible scaffolding that only fires when GeminiOmni is the chosen provider.

**Why:** GeminiOmni's `img_urls` field treats a single ref image as a strong starting reference for the entire 10s. A purpose-built storyboard (composition + character + product baked in) gives the model far more control over the final frame than passing raw product/character refs directly. Result: tighter scene fidelity, less drift, less "AI guess" of how the elements compose.

**Out of scope:**
- Adding a new framework (we use the existing 18).
- Exposing storyboard-mode for Veo or Sora 2 (Gemini-only feature).
- Letting users preview/edit the storyboard before animation (V1 ships fire-and-forget).
- A separate cron stage — pipeline runs inline within the existing per-row async loop.

---

## 1. Behavior Summary

| Knob | Value | Rationale |
|---|---|---|
| Provider chip in Auto Content | **GeminiOmni** (third chip after Veo / Sora 2) | Same chip styling as the Original Video tab's GeminiOmni chip (cyan/blue, 🔷) |
| Pipeline | 2-stage (storyboard → animate) | Only when `providerChoice === "gemini"` |
| Storyboard model | `gpt-image-2` via `generateImageWithCascade` | Reuses existing 4-slot cascade (p2/p4/p5/p6) — no new infra |
| Storyboard prompt source | New `storyboardPrompt` field on master plan JSON | LLM authors it explicitly; mechanical fallback when LLM omits it |
| Storyboard retries | **3 cascade passes max** | Each pass walks all 4 cascade slots (up to 12 provider attempts total). All fail → row marked failed. |
| Storyboard caching | `metadata.storyboard_url` on the history row | Resubmit reuses cached URL — saves RM 0.30 on retry |
| Video model | `google/gemini-omni` via existing `asset='gemini'` cascade | Tasks 1-14 already shipped this |
| Video inputs | `img_urls = [storyboardUrl]` (single image) | NOT the user's raw refs — the storyboard IS the ref |
| Aspect ratio | 9:16 or 16:9 | Storyboard renders at GPT Image 2's "2:3" (9:16 → 2:3 maps cleanly) |
| Duration | Fixed 10s (matches Original Video tab) | GeminiOmni hard constraint |
| Resolution | Fixed 1080p | GeminiOmni hard constraint |
| Cost preview UI | Shows video-only price (RM 0.40) | Per user direction — storyboard fee hidden in preview |
| Actual deduction | Storyboard cost + video cost (RM ~0.30 + RM ~0.40 = RM ~0.70/row) | Real charges, visible in admin/usage |
| Master plan LLM | Upgraded to emit `storyboardPrompt` field | Existing `imagePrompt` field stays (legacy/future use); new field is dedicated |

---

## 2. Architecture

The pipeline lives inside the existing per-row async loop in `app/api/generate/auto-content/route.ts`. When `providerChoice === "gemini"`, the loop body branches into a 2-stage path. Other providers (Veo, Sora 2) skip the storyboard stage entirely.

```
User submits Auto Content batch (providerChoice = "gemini")
   │
   ▼
[Pre-flight credit check]
   │  cost-per-row = gptImageRate (~0.30) + geminiRate (~0.40)
   │  multiplied by quantity for batch budget
   ▼
[Master plan LLM]   model_custom_idea cascade
   │  System prompt UPGRADED: must emit storyboardPrompt
   │  per scene (alongside existing imagePrompt + videoPromptShot1)
   ▼
[plans[] array]
   │
   ▼
Promise.all(plans.map(async (item, idx) => {
   │
   if (providerChoice === "gemini") {
     │
     ▼
   STAGE 1 — Storyboard generation (with retry)
     │  prompt = item.storyboardPrompt
     │          || buildStoryboardFallback(item)  ← mechanical derive
     │  refs   = imagesForVideo(idx)              ← user uploads
     │
     │  for attempt in 1..3:
     │    result = await generateImageWithCascade({
     │      primaryModel: "gpt-image-2",
     │      prompt, aspectRatio,
     │      imageUrls: refs,
     │    })
     │    if (result.ok) {
     │      poll task to completion (~20s)
     │      storyboardUrl = poll.outputUrl
     │      break
     │    }
     │  if (no storyboardUrl after 3 passes) {
     │    insert history row status="failed",
     │      error_message="Storyboard generation failed after 3 cascade passes"
     │    return  ← row never animates
     │  }
     │
     ▼
   STAGE 2 — GeminiOmni animates
     │  videoRefs = [storyboardUrl]  ← single image
     │  generateVideoWithCascade({
     │    primaryModel: "google/gemini-omni",
     │    imageUrls: videoRefs,
     │    asset: "gemini",
     │    prompt: item.videoPromptShot1,
     │    durationMode: "10",
     │    aspectRatio,
     │  })
     │
   } else {
     // Existing Veo / Sora 2 path unchanged
     videoRefs = imagesForVideo(idx)
     generateVideoWithCascade({ ..., imageUrls: videoRefs })
   }
   │
   ▼
[Insert history row]
   │  cost = storyboardCost + videoCost  (Gemini rows)
   │       OR videoCost                  (Veo/Sora 2 rows)
   │  metadata: {
   │    storyboard_url, storyboard_cost, video_cost,
   │    storyboard_attempts, storyboardPrompt,
   │    ...existing fields
   │  }
   │
   ▼
[Cascade settle / callback / auto-poll]
   │  Tasks 1-14 already handle Gemini rows in settle.ts
   │  Storyboard is a separate completed image — no settle needed for it
}))
```

### Failure paths

| What fails | Behavior |
|---|---|
| Storyboard cascade pass 1 returns error | Log, retry pass 2 |
| Storyboard cascade pass 2 returns error | Log, retry pass 3 |
| Storyboard cascade pass 3 returns error | Insert history row `status='failed'`, error message says "Storyboard generation failed after 3 cascade passes". No video call. No GeminiOmni cost. Storyboard cost charged only if at least one slot accepted+billed (defensive: charge nothing if all 3 passes errored at create-time). |
| Storyboard succeeds but image task poll times out | Treat as cascade fail → retry the cascade pass |
| Storyboard succeeds, GeminiOmni create fails | Existing cascade fallback (asset='gemini' pool) walks. If ALL gemini slots fail, row marked failed. Storyboard URL preserved in metadata for resubmit. |
| Storyboard succeeds, GeminiOmni runs but task fails | settle.ts auto-resubmit (already gemini-aware) re-fires GeminiOmni reusing `metadata.storyboard_url`. No storyboard regeneration. |
| User clicks Resubmit on failed row | retry/route.ts reads `metadata.storyboard_url`. If present, re-fires GeminiOmni only. If missing (storyboard step itself failed), re-runs the full 2-stage pipeline. |

### Why retry storyboard but not video at this layer

Storyboard retry is a NEW concept (3 passes of the cascade). GeminiOmni video retry is handled by the existing cascade fallback pool + settle.ts auto-resubmit + manual Resubmit button — those code paths already work and were validated in Tasks 1-14.

---

## 3. File Changes

### 3.1 `lib/auto-content-storyboard.ts` *(NEW)*

Small helper module — keeps the auto-content route file from growing further.

Exports:

- `buildStoryboardFallback(plan: Plan): string` — derives a storyboard image prompt from `plan.videoPromptShot1` when the LLM omits `storyboardPrompt`. Strips the `Spoken dialog:` block via the same regex `extractDialogBlock()` already uses in the route file. Prepends `"Photoreal first-frame storyboard. "` so GPT Image 2 treats it as a static composition.
- `MAX_STORYBOARD_RETRIES = 3` — constant.
- `runStoryboardCascadeWithRetry({ prompt, aspectRatio, imageUrls, userId })` — async helper that wraps `generateImageWithCascade` in a 3-pass loop. Returns `{ ok: true, taskId, slot, attempts }` or `{ ok: false, error, attempts, tierLogs }`. The cascade itself handles per-pass slot rotation; this helper retries the WHOLE walk on full-cascade failure.
- `pollImageTaskToCompletion({ taskId, slot, maxWaitMs = 60_000 })` — polls the image cascade's status until done/failed/timeout. Reuses existing polling primitives (likely `lib/p2.ts:p2GetStatus`, dispatched by slot prefix).

### 3.2 `lib/openrouter.ts` (or wherever model_custom_idea system prompt lives — research the route)

The Auto Content route at `app/api/generate/auto-content/route.ts:386-1531` contains the master plan system prompt inline. Extend the `<image_prompt_rules>` block (around line 1211-1233) with a new `<storyboard_prompt_rules>` section that instructs the LLM to also emit a `storyboardPrompt` field per scene. Rules:

- The storyboardPrompt describes a SINGLE FROZEN MOMENT — the most visually arresting frame of the 10s scene
- Must include: character (per locks if framework needs one), product (if any), setting, lighting, camera angle, pose. NO motion verbs, NO dialog, NO timing.
- 300-500 char target (GPT Image 2 sweet spot)
- Style suffix locked: `, photoreal cinematic 85mm lens, soft natural lighting, vertical 9:16 composition.`
- For UGC frameworks: character + product TOGETHER in frame (different from the existing `imagePrompt` which says character ONLY)
- For Product frameworks: hero product shot with environment
- For Lifestyle frameworks: scene + product, possibly with character incidental

Add the field to the JSON schema in the prompt:

```json
{
  "framework": "...",
  "imagePrompt": "...",          // existing, unused for now
  "storyboardPrompt": "...",     // NEW — required for GeminiOmni mode
  "videoPromptShot1": "...",
  "videoPromptShot2": "...",
  "caption": "...",
  "coverTitle": "...",
  "coverSubtitle": "..."
}
```

The plan type (`route.ts:183-195`) gets a new optional `storyboardPrompt?: string` field. Fallback to `buildStoryboardFallback(item)` when the LLM omits it.

### 3.3 `app/api/generate/auto-content/route.ts`

Main edits:

1. **Type:** Add `storyboardPrompt?: string` to the `Plan` type.
2. **System prompt:** Insert `<storyboard_prompt_rules>` block (per §3.2 above).
3. **JSON validator:** When `providerChoice === "gemini"`, accept missing `storyboardPrompt` (fall back to mechanical derive). Do not reject the plan.
4. **Pre-flight cost** (around line 146-156): When `providerChoice === "gemini"`, add `gptImageRate` to the per-row cost in the credit check. Use `getGptImageRate()` from `lib/settings.ts`.
5. **Per-row loop** (around line 1988-2030): Add the storyboard branch shown in §2 architecture. Helper imports from `lib/auto-content-storyboard.ts`.
6. **Asset selection** (around line 2000): When `providerChoice === "gemini"`, set:
   - `model = "google/gemini-omni"`
   - `asset = "gemini"`
   - Body's `imageUrls = [storyboardUrl]` (only one)
7. **Cost stamping** (around line 2052): Gemini rows get `cost = storyboardCost + videoCost`. Metadata gets:
   ```ts
   metadata: {
     storyboard_url: storyboardUrl,
     storyboard_cost: storyboardCost,
     storyboard_attempts: attempts,
     storyboardPrompt: usedPrompt,    // for audit / future fine-tune
     video_cost: videoCost,
     modelChoice: "gemini",
     ...existing fields
   }
   ```
8. **Tab tag:** Gemini rows keep `tab='auto'` (Auto Content tab) — same as today.

### 3.4 `app/dashboard/tabs/auto-content.tsx`

Add GeminiOmni as a 3rd provider:

- Extend `provider` state type from `"veo" | "grok"` to `"veo" | "grok" | "gemini"`. (Note: the existing `"grok"` value internally represents Sora 2 — pre-existing quirk. Don't touch it.)
- Add a new chip button alongside the existing Veo / Sora 2 chips. Cyan/blue theme matching the Original Video tab's GeminiOmni chip.
- When `provider === "gemini"`:
  - Hide the duration picker (Gemini is fixed 10s)
  - Show a small "Fixed 10s · 1080p" pill
  - Cost preview: `geminiFlatRate.toFixed(2)` (no storyboard add-on per user direction)
  - Fetch `/api/gemini/rate` for the preview
- Submit body: include `provider: "gemini"` (new key — backend reads this on the route)

### 3.5 `app/api/history/retry/route.ts`

When the row being resubmitted has `metadata.modelChoice === "gemini"` AND `metadata.storyboard_url` is present:
- Skip the storyboard cascade
- Use `metadata.storyboard_url` as the single image input
- Re-fire GeminiOmni directly

When the row has `metadata.modelChoice === "gemini"` but `metadata.storyboard_url` is missing (storyboard step itself failed originally):
- Re-run the full 2-stage pipeline (storyboard + animate)
- This means the retry route's body needs to either:
  - Inline the storyboard helper (duplication risk), OR
  - Call back into `/api/generate/auto-content` with `replay_id` or similar (cleaner but adds an endpoint roundtrip)

Recommended: inline the storyboard call — same `runStoryboardCascadeWithRetry` helper from `lib/auto-content-storyboard.ts`. Single source of truth for the retry behavior.

### 3.6 `lib/settle.ts`

Existing Gemini auto-retry branch (added in Task 9, lines ~451-459) needs one tweak: when re-firing through `generateVideoWithCascade`, pass `imageUrls: [meta.storyboard_url]` instead of `meta.image_urls` for rows where `meta.storyboard_url` is present. Otherwise the cascade would re-pass the user's raw refs and re-introduce the drift the storyboard solved.

Pseudocode:
```ts
const isGeminiStoryboard = meta.modelChoice === "gemini" && meta.storyboard_url;
const refsForRetry = isGeminiStoryboard
  ? [meta.storyboard_url]
  : (Array.isArray(meta.image_urls) ? meta.image_urls : []);
```

### 3.7 `app/dashboard/sections/history-grid.tsx` *(optional, non-blocking)*

If we want to show the storyboard preview alongside the video thumbnail on Gemini-storyboard rows: small badge or expandable section reading `item.metadata?.storyboard_url`. Punt for V1; metadata-only is fine until users ask.

---

## 4. End-to-End Requirements Verification

| Requirement | How it works |
|---|---|
| **Existing 18 frameworks** | UI passes selected framework IDs unchanged. Master plan picks the right framework template. No framework code changes. |
| **GeminiOmni only feature** | Branch keyed on `providerChoice === "gemini"`. Veo/Sora 2 paths untouched. |
| **GPT Image 2 storyboard first** | `generateImageWithCascade({primaryModel: "gpt-image-2"})` — already cascade-routed across 4 slots. |
| **Retry up to 3 times** | `runStoryboardCascadeWithRetry` helper wraps the cascade in a 3-pass loop. |
| **LLM emits storyboardPrompt** | System prompt upgrade in `route.ts` + new Plan type field + JSON parsing. |
| **Mechanical fallback prompt** | `buildStoryboardFallback(plan)` when LLM omits the field. |
| **Cost preview hides storyboard fee** | Tab UI reads only `geminiFlatRate`. Backend pre-flight DOES add storyboard cost to credit check (still real money). |
| **Resubmit reuses storyboard** | retry route + settle.ts both branch on `metadata.storyboard_url` presence. |
| **History row consistency** | Same `tab='auto'` as existing Auto Content rows. Same per-row insert pattern. metadata extended. |
| **Usage tracking** | `priceFor(userId, "image_generate", "gpt_image")` for the storyboard fee + existing video deduction. Two line items in admin/usage. |
| **Failure cascade** | 3 storyboard passes → fail row OR storyboard ok + video cascade exhausted → fail row. settle.ts auto-resubmit kicks in for transient failures (gemini cascade pool). |

---

## 5. Manual Admin Setup (post-deploy)

None new. Tasks 1-14 already provisioned the GeminiOmni rate + cascade pool. GPT Image 2 is already running in production. No new app_settings keys.

Admin should verify (one-time):
- `rate_gpt_image` is set in `/admin/settings` (already required for the existing image flow)
- `rate_gemini.per_video_10s` is set (already done in Task 13)

---

## 6. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Latency: ~2 min/row (storyboard ~20s + animate ~90s) | Medium | `maxDuration=300` on route covers batches up to ~10 in parallel. For bigger batches, defer to `after()` (existing pattern). |
| Cost surprise: user sees RM 0.40 preview but charged RM 0.70 | Medium | Surface "GPT Image 2 (storyboard)" line item in admin/usage. Add a clarifying tooltip on the Auto Content GeminiOmni chip: "Storyboard pre-render included in cost". Optional follow-up if users complain. |
| Master plan LLM omits `storyboardPrompt` field | Low | Mechanical fallback derives one from `videoPromptShot1`. Row never breaks. |
| Storyboard cascade exhausts (3 passes × 4 slots = 12 failures) | Low | Real possibility on platform-wide GPT Image 2 outage. Row fails cleanly with diagnostic in `error_message`. User resubmits. |
| Storyboard generation succeeds but image is off-theme | Low | Reuse on resubmit may re-introduce the bad frame. If admin / user wants to force regen, future enhancement: "Regenerate storyboard" button. Punted for V1. |
| Plan format breakage on existing rows | Low | New `storyboardPrompt` field is OPTIONAL in the Plan type. Existing parsing logic unchanged. Old rows without the field still work for Veo/Sora 2. |
| 9:16 → 2:3 aspect mismatch on storyboard | Low | Storyboard is a reference, not the final output. GeminiOmni re-renders at 9:16. Minor cropping in the storyboard is invisible to end user. |

---

## 7. Out of Scope (future work)

- Storyboard preview UI on the history card
- "Regenerate storyboard" button (separate from full Resubmit)
- Storyboard mode for Veo or Sora 2
- Letting user pick storyboard model (GPT Image 2 vs Banana Pro vs Imagen)
- Multi-frame storyboard (3 keyframes feeding GeminiOmni's 3-image reference fusion mode)
- Master plan UI showing the storyboard prompt before fire (would require a 3rd "preview" mode alongside AI Plan / Verify Plan / Manual Plan)
