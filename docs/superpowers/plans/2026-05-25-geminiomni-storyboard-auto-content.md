# GeminiOmni Storyboard Auto Content — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GeminiOmni as the 3rd provider chip in the Auto Content tab. For every row in a Gemini batch, run a 2-stage pipeline: GPT Image 2 generates a storyboard from user refs + the master plan's new `storyboardPrompt` field, then GeminiOmni animates that storyboard into a 10s video.

**Architecture:** Storyboard step lives in a new helper module (`lib/auto-content-storyboard.ts`) consumed inside the existing per-row `Promise.all` loop in `app/api/generate/auto-content/route.ts`. Cascade calls reuse the existing `generateImageWithCascade` + 4-slot image pool for the storyboard; the animate step reuses the existing `asset='gemini'` video cascade from Tasks 1-14. Cost = `getGptImageRate() + getGeminiRate("10")` per row.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, Crun (P2) for GPT Image 2 + GeminiOmni primary, APIMart (P5) for GeminiOmni fallback, React 19, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-05-25-geminiomni-storyboard-auto-content-design.md`

---

## File Structure

| File | Responsibility | Change kind |
|---|---|---|
| `lib/auto-content-storyboard.ts` | Storyboard helpers: prompt fallback, 3-pass cascade retry, image-task polling dispatcher | **Create** |
| `app/api/generate/auto-content/route.ts` | Plan type field, system prompt `<storyboard_prompt_rules>` block, pre-flight cost, per-row branch, metadata stamping | Modify (5 separate insertion points across 4 tasks) |
| `app/dashboard/tabs/auto-content.tsx` | 3rd provider chip (cyan/blue, 🔷), gemini cost preview fetch | Modify |
| `app/api/history/retry/route.ts` | Reuse `metadata.storyboard_url` for Gemini rows | Modify |
| `lib/settle.ts` | Pass `[metadata.storyboard_url]` for Gemini auto-retry rows | Modify |

Each task = one commit + one push. Backend infra ships first (Tasks 1-6) so the route can accept `provider: "gemini"` before the UI chip exists. UI chip lands in Task 7. Retry/settle patches (Tasks 8-9) close the loop. Task 10 is user-driven smoke test.

**Constraints (from project memory):**
- Always push after committing (Vercel auto-deploys).
- No version bumps (HCKCREA, not the extension).
- No `Date.toISOString()` for user-facing dates (UTC+8 Malaysia user). Internal metadata timestamps are fine.
- No test runner — verify via `npx tsc --noEmit` + Vercel preview + manual smoke test in Task 10.

---

## Task 1: Create storyboard helper module

**Files:**
- Create: `lib/auto-content-storyboard.ts`

- [ ] **Step 1: Create the helper module**

Create `E:\Project\HCKCREA\lib\auto-content-storyboard.ts` with this exact content:

```ts
// Storyboard helpers for the Auto Content tab's GeminiOmni 2-stage
// pipeline. Stage 1 = GPT Image 2 generates a single key-frame
// storyboard from the user's reference images + the master plan's
// storyboardPrompt. Stage 2 = GeminiOmni animates that storyboard.
//
// This module is consumed only when providerChoice === "gemini" in
// app/api/generate/auto-content/route.ts. Veo / Sora 2 paths are
// unaffected.

import { generateImageWithCascade } from "@/lib/image-cascade";
import { p2GetStatus } from "@/lib/p2";
import { p4GetStatus } from "@/lib/p4";
import { p5GetStatus } from "@/lib/p5";
import { p6GetStatus, type P6Slot } from "@/lib/p6";
import type { SlotProvider } from "@/lib/cascade-rotation";

// Per spec §1: 3 cascade-walk passes max. Each pass walks all 4 image
// slots (p2-a, p2-b, p4, p5/p6) so up to 12 provider attempts total
// before the row fails.
export const MAX_STORYBOARD_RETRIES = 3;

// Strip the "Spoken dialog:" timing block + any trailing whitespace from
// a videoPromptShot1 string. Mirrors the regex used by extractDialogBlock
// in app/api/generate/auto-content/route.ts so the storyboard prompt is
// pure visual description, no audio/dialog markers.
function stripDialogBlock(prompt: string): string {
  return prompt
    .replace(/\n*spoken\s+dialog[:\s][\s\S]*$/i, "")
    .replace(/\n*dialog[:\s][\s\S]*$/i, "")
    .trim();
}

// Fallback storyboard prompt builder — used when the master plan LLM
// omits the storyboardPrompt field. Derives one mechanically from the
// videoPromptShot1 (the existing scene description), stripping dialog
// + prepending a static-frame prefix so GPT Image 2 treats it as a
// composition prompt, not a motion description.
export function buildStoryboardFallback(plan: {
  videoPromptShot1?: string;
  framework?: string;
}): string {
  const sceneText = stripDialogBlock(String(plan.videoPromptShot1 || ""));
  const prefix = "Photoreal first-frame storyboard. ";
  const suffix =
    ", photoreal cinematic 85mm lens, soft natural lighting, vertical 9:16 composition.";
  // Cap at ~600 chars (GPT Image 2 sweet spot — long prompts dilute
  // composition fidelity).
  const body = sceneText.substring(0, 600 - prefix.length - suffix.length);
  return prefix + body + suffix;
}

// Result type for a single storyboard pass.
export type StoryboardCascadeResult =
  | {
      ok: true;
      taskId: string;
      slot: SlotProvider;
      attempts: number;
    }
  | {
      ok: false;
      error: string;
      attempts: number;
      tierLogs: Array<{ pass: number; tierLog: any[] }>;
    };

// Run the image cascade up to MAX_STORYBOARD_RETRIES times. Each pass
// uses fullCascade=true so it walks all main + fallback slots. We retry
// the whole cascade if the entire walk fails — covers transient
// platform-wide outages that resolve within seconds.
export async function runStoryboardCascadeWithRetry(input: {
  prompt: string;
  aspectRatio: string;
  imageUrls: string[];
}): Promise<StoryboardCascadeResult> {
  const tierLogs: Array<{ pass: number; tierLog: any[] }> = [];
  let lastError = "Storyboard cascade not attempted";

  for (let attempt = 1; attempt <= MAX_STORYBOARD_RETRIES; attempt++) {
    const r = await generateImageWithCascade({
      primaryModel: "gpt-image-2",
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      imageUrls: input.imageUrls,
      fullCascade: true,
    });
    if (r.ok) {
      return {
        ok: true,
        taskId: r.taskId,
        slot: r.actualSlot,
        attempts: attempt,
      };
    }
    tierLogs.push({ pass: attempt, tierLog: r.tierLog });
    lastError = r.error;
    // Short pause between full-cascade passes — gives transient outages
    // time to clear. 2s × 2 retries = max 4s extra latency on full fail.
    if (attempt < MAX_STORYBOARD_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return {
    ok: false,
    error: `Storyboard cascade failed after ${MAX_STORYBOARD_RETRIES} passes: ${lastError}`,
    attempts: MAX_STORYBOARD_RETRIES,
    tierLogs,
  };
}

// Poll an image task to completion. Dispatches to the right adapter
// based on the slot label that accepted the task. Returns the final
// outputUrl or null on failure / timeout.
//
// Default 60s timeout — GPT Image 2 typically completes in 15-30s on
// p2/p4/p5, slightly longer on p6. 60s gives 2× headroom without
// blocking the route past the 300s maxDuration budget.
export async function pollImageTaskUntilDone(input: {
  taskId: string;
  slot: SlotProvider;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Promise<{ ok: true; outputUrl: string } | { ok: false; error: string }> {
  const maxWaitMs = input.maxWaitMs ?? 60_000;
  const pollIntervalMs = input.pollIntervalMs ?? 3_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    let status: { status: string; outputUrl?: string; error?: string };
    try {
      if (input.slot === "p2-a" || input.slot === "p2-b") {
        const r = await p2GetStatus(input.taskId, "p2");
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else if (input.slot === "p4") {
        const r = await p4GetStatus(input.taskId);
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else if (input.slot === "p5") {
        const r = await p5GetStatus(input.taskId);
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else if (input.slot.startsWith("p6-")) {
        const r = await p6GetStatus(input.taskId, input.slot as P6Slot, "image");
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else if (input.slot === "p1") {
        // p1 (GeminiGen) — p2GetStatus dispatches to p1 when provider="p1".
        const r = await p2GetStatus(input.taskId, "p1");
        status = { status: r.status, outputUrl: r.outputUrl, error: r.error };
      } else {
        return { ok: false, error: `Unknown slot ${input.slot} for polling` };
      }
    } catch (e: any) {
      return { ok: false, error: `Poll exception: ${e?.message || String(e)}` };
    }

    if (status.status === "succeeded" && status.outputUrl) {
      return { ok: true, outputUrl: status.outputUrl };
    }
    if (status.status === "failed") {
      return { ok: false, error: status.error || "Image task reported failed" };
    }
    // pending / running — keep polling
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return { ok: false, error: `Storyboard poll timeout after ${maxWaitMs}ms` };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "auto-content-storyboard" | head -20
```

Expected: no errors mentioning `auto-content-storyboard.ts`.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/auto-content-storyboard.ts && \
  git commit -m "$(cat <<'EOF'
feat(storyboard): helper module for Auto Content GeminiOmni 2-stage

Exports:
- MAX_STORYBOARD_RETRIES = 3
- buildStoryboardFallback(plan) → derives storyboard prompt from
  videoPromptShot1 when master plan LLM omits the storyboardPrompt
  field
- runStoryboardCascadeWithRetry({prompt, aspectRatio, imageUrls})
  → wraps generateImageWithCascade in a 3-pass full-cascade loop
- pollImageTaskUntilDone({taskId, slot}) → polls the right p*GetStatus
  adapter based on the cascade's actualSlot return

Dormant until Task 5 wires the call sites into auto-content/route.ts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 2: Add `storyboardPrompt` field to Plan type + JSON parser

**Files:**
- Modify: `app/api/generate/auto-content/route.ts:183-195` (Plan type)
- Modify: `app/api/generate/auto-content/route.ts:200-220` (manual/approved plan parsing)
- Modify: `app/api/generate/auto-content/route.ts:1691-1703` (LLM plan JSON parsing)

- [ ] **Step 1: Extend the `Plan` type**

Open `app/api/generate/auto-content/route.ts`. Find lines 183-195:

```ts
  type Plan = {
    framework: string;
    frameworkType: "ugc" | "product" | "lifestyle";
    needsCharacterImage: boolean;
    targetEmotion: string;
    hookAngle: string;
    imagePrompt: string;
    videoPromptShot1: string;
    videoPromptShot2: string;
    caption: string;
    coverTitle: string;
    coverSubtitle: string;
  };
```

Replace with:

```ts
  type Plan = {
    framework: string;
    frameworkType: "ugc" | "product" | "lifestyle";
    needsCharacterImage: boolean;
    targetEmotion: string;
    hookAngle: string;
    imagePrompt: string;
    // NEW (storyboard mode): purpose-built single-frame prompt for
    // GPT Image 2 storyboard generation. Required when providerChoice
    // === "gemini"; mechanically derived from videoPromptShot1 via
    // buildStoryboardFallback() when the LLM omits it. Other providers
    // ignore this field.
    storyboardPrompt: string;
    videoPromptShot1: string;
    videoPromptShot2: string;
    caption: string;
    coverTitle: string;
    coverSubtitle: string;
  };
```

- [ ] **Step 2: Parse `storyboardPrompt` in the manual/approved branch**

In the same file, find lines 207-219 (the manual/approved plan map):

```ts
      return {
        framework: fwName,
        frameworkType: (fwMatch?.type || "ugc") as Plan["frameworkType"],
        needsCharacterImage: fwMatch ? fwMatch.needsCharacterImage : true,
        targetEmotion: String(p.targetEmotion || ""),
        hookAngle: String(p.hookAngle || ""),
        imagePrompt: String(p.imagePrompt || ""),
        videoPromptShot1: String(p.videoPromptShot1 || legacyPrompt),
        videoPromptShot2: String(p.videoPromptShot2 || ""),
        caption: String(p.caption || ""),
        coverTitle: String(p.coverTitle || "").toUpperCase(),
        coverSubtitle: String(p.coverSubtitle || "").toUpperCase(),
      };
```

Replace with:

```ts
      return {
        framework: fwName,
        frameworkType: (fwMatch?.type || "ugc") as Plan["frameworkType"],
        needsCharacterImage: fwMatch ? fwMatch.needsCharacterImage : true,
        targetEmotion: String(p.targetEmotion || ""),
        hookAngle: String(p.hookAngle || ""),
        imagePrompt: String(p.imagePrompt || ""),
        storyboardPrompt: String(p.storyboardPrompt || ""),
        videoPromptShot1: String(p.videoPromptShot1 || legacyPrompt),
        videoPromptShot2: String(p.videoPromptShot2 || ""),
        caption: String(p.caption || ""),
        coverTitle: String(p.coverTitle || "").toUpperCase(),
        coverSubtitle: String(p.coverSubtitle || "").toUpperCase(),
      };
```

- [ ] **Step 3: Parse `storyboardPrompt` in the LLM plan branch**

In the same file, find lines 1691-1703 (the LLM JSON map):

```ts
        return {
          framework: fwName,
          frameworkType: (fwMatch?.type || "ugc") as Plan["frameworkType"],
          needsCharacterImage: fwMatch ? fwMatch.needsCharacterImage : true,
          targetEmotion: String(p.targetEmotion || ""),
          hookAngle: String(p.hookAngle || ""),
          imagePrompt: String(p.imagePrompt || ""),
          videoPromptShot1: String(p.videoPromptShot1 || ""),
          videoPromptShot2: String(p.videoPromptShot2 || ""),
          caption: String(p.caption || ""),
          coverTitle: String(p.coverTitle || "").toUpperCase(),
          coverSubtitle: String(p.coverSubtitle || "").toUpperCase(),
        };
```

Replace with:

```ts
        return {
          framework: fwName,
          frameworkType: (fwMatch?.type || "ugc") as Plan["frameworkType"],
          needsCharacterImage: fwMatch ? fwMatch.needsCharacterImage : true,
          targetEmotion: String(p.targetEmotion || ""),
          hookAngle: String(p.hookAngle || ""),
          imagePrompt: String(p.imagePrompt || ""),
          storyboardPrompt: String(p.storyboardPrompt || ""),
          videoPromptShot1: String(p.videoPromptShot1 || ""),
          videoPromptShot2: String(p.videoPromptShot2 || ""),
          caption: String(p.caption || ""),
          coverTitle: String(p.coverTitle || "").toUpperCase(),
          coverSubtitle: String(p.coverSubtitle || "").toUpperCase(),
        };
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "auto-content/route" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/generate/auto-content/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(auto-content): add storyboardPrompt field to Plan type

Plumbing-only change — adds storyboardPrompt to the Plan TypeScript
type and the two JSON parse sites (manual/approved + LLM-generated).
Value defaults to empty string when missing; downstream code falls
back to buildStoryboardFallback() in Task 5.

System prompt teaches the LLM to emit this field in Task 3. Pipeline
consumption lands in Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 3: Add `<storyboard_prompt_rules>` to master plan system prompt

**Files:**
- Modify: `app/api/generate/auto-content/route.ts` around line 1233 (insert new block after `</image_prompt_rules>`)

- [ ] **Step 1: Locate the insertion point**

Open `app/api/generate/auto-content/route.ts`. Find the closing tag of `<image_prompt_rules>` (around line 1233):

```ts
- NO person in frame — product only
</image_prompt_rules>

<locked_elements>
```

- [ ] **Step 2: Insert new block immediately before `<locked_elements>`**

Replace:

```ts
- NO person in frame — product only
</image_prompt_rules>

<locked_elements>
```

With:

```ts
- NO person in frame — product only
</image_prompt_rules>

<storyboard_prompt_rules>
GeminiOmni mode ONLY (skip for Veo / Sora 2). EVERY video MUST also have
a storyboardPrompt field — a single FROZEN MOMENT describing the most
visually arresting frame of the 10-second scene. GPT Image 2 will
generate this frame, then GeminiOmni will animate from it.

STORYBOARD COMPOSITION RULES:
- Capture the SINGLE most arresting frozen moment (a pose, a gaze, a
  product-in-hand beat) — NOT the whole scene's narrative arc
- ${hijabMode ? "Character MUST wear LOOSE tudung labuh, fully covering hair / ears / neck" : "Character has visible hair, modest modern Malaysian outfit"}
- FOR UGC frameworks: BOTH character AND product visible TOGETHER in
  the frame (different from imagePrompt which says character-only)
- FOR PRODUCT frameworks: hero product shot with environment + lighting,
  no person
- FOR LIFESTYLE frameworks: scene + product naturally placed; character
  optional / incidental
- NO motion verbs ("turning", "walking", "reaching") — describe the
  pose / state as if photographed at 1/250th sec
- NO dialog quotes, NO timing markers, NO audio cues
- Setting + lighting + camera angle MUST be explicit
- 300-500 chars target (GPT Image 2 sweet spot — longer dilutes
  composition fidelity)
- ALWAYS end with this exact style suffix:
  ", photoreal cinematic 85mm lens, soft natural lighting, vertical 9:16 composition."

EXAMPLE (UGC framework with product):
"Malay woman in her 30s wearing loose dusty-rose hijab tudung labuh and
cream knit cardigan, seated at a sunlit wooden table in a cozy kitchen,
holding a Sambal X jar at chest height with both hands, gentle smile
directed slightly off-camera, soft afternoon golden light streaming
through a window behind her, warm muted background, photoreal cinematic
85mm lens, soft natural lighting, vertical 9:16 composition."

EXAMPLE (Product framework, no person):
"A Sambal X glass jar centered on a polished marble slab, gentle steam
rising from a small ceramic dipping bowl beside it, scattered fresh
chili and lime leaves in the foreground, soft side-light from camera
left casting a long subtle shadow, shallow depth of field, warm muted
backdrop, photoreal cinematic 85mm lens, soft natural lighting, vertical
9:16 composition."
</storyboard_prompt_rules>

<locked_elements>
```

- [ ] **Step 3: Update the JSON output schema instructions**

In the same file, search for where the LLM is instructed about the JSON output structure. It should be around the bottom of the system prompt, just before `</system_prompt>` or similar. Find the JSON schema example (search for `videoPromptShot1` near line 1500+):

```bash
cd /e/Project/HCKCREA && grep -n '"videoPromptShot1"' app/api/generate/auto-content/route.ts | head -5
```

For each occurrence in the system prompt example JSON (not in the parser code — only inside the prompt string), add a `storyboardPrompt` field next to `imagePrompt`. Use the Edit tool with surrounding context to disambiguate.

Example: if the prompt contains:

```json
{
  "framework": "...",
  "imagePrompt": "...",
  "videoPromptShot1": "...",
  ...
}
```

Add `"storyboardPrompt": "<300-500 char storyboard prompt — see <storyboard_prompt_rules>>",` between `imagePrompt` and `videoPromptShot1`.

If you find multiple JSON schema examples in the system prompt, update ALL of them for consistency.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "auto-content/route" | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/generate/auto-content/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(auto-content): add storyboard_prompt_rules to master plan prompt

New <storyboard_prompt_rules> block instructs the LLM to emit a
storyboardPrompt field per scene when GeminiOmni mode is active.
Rules cover: single frozen-moment composition, character+product
together for UGC, no motion verbs, 300-500 char target, locked
style suffix for visual consistency. Two worked examples included.

JSON schema examples in the system prompt also updated so the LLM
sees storyboardPrompt next to imagePrompt in the expected output
shape. Field defaults to empty string when LLM omits it (fallback
to buildStoryboardFallback lands in Task 5).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 4: Pre-flight cost for Gemini storyboard mode

**Files:**
- Modify: `app/api/generate/auto-content/route.ts:142-165` (credit pre-flight block)

- [ ] **Step 1: Extend pre-flight cost calculation**

Open `app/api/generate/auto-content/route.ts`. Find lines 142-165:

```ts
  // Pre-flight credit check — total = N × video rate (master plan is free).
  // Verify mode skips credit check until /approve fires the actual gens.
  //   Veo: flat rate per 8s or 16s clip
  //   Grok: per-second rate × chosen duration
  const veoRate = await priceFor(
    user.id,
    durationMode === "16" ? "video_16s" : "video_8s"
  );
  let videoRate = veoRate;
  if (providerChoice === "grok") {
    // Reuse the standalone Grok tab's rate (rate_grok per second).
    const { getGrokRate } = await import("@/lib/settings");
    const grokRate = await getGrokRate();
    videoRate = grokRate * grokDuration;
  }
  const totalCost = videoRate * quantity;
  if (planMode !== "verify") {
    if (!(await hasEnoughCredits(user.id, totalCost))) {
      return NextResponse.json(
        { error: `Kredit tak cukup. Perlu ~RM${totalCost.toFixed(2)}.` },
        { status: 402 }
      );
    }
  }
```

Replace with:

```ts
  // Pre-flight credit check — total = N × video rate (master plan is free).
  // Verify mode skips credit check until /approve fires the actual gens.
  //   Veo:    flat rate per 8s or 16s clip
  //   Grok:   per-second rate × chosen duration (Sora 2 internally)
  //   Gemini: flat per-10s-video rate + GPT Image 2 storyboard rate
  //           (storyboard is real money even though preview UI hides it)
  const veoRate = await priceFor(
    user.id,
    durationMode === "16" ? "video_16s" : "video_8s"
  );
  let videoRate = veoRate;
  let storyboardRate = 0;
  if (providerChoice === "grok") {
    // Reuse the standalone Grok tab's rate (rate_grok per second).
    const { getGrokRate } = await import("@/lib/settings");
    const grokRate = await getGrokRate();
    videoRate = grokRate * grokDuration;
  } else if (providerChoice === "gemini") {
    // GeminiOmni — flat per-10s-video rate. Plus GPT Image 2 storyboard
    // step that runs once per row (admin-set rate_gpt_image).
    const { getGeminiRate, getGptImageRate } = await import("@/lib/settings");
    videoRate = await getGeminiRate("10");
    storyboardRate = await getGptImageRate();
  }
  const perRowCost = videoRate + storyboardRate;
  const totalCost = perRowCost * quantity;
  if (planMode !== "verify") {
    if (!(await hasEnoughCredits(user.id, totalCost))) {
      return NextResponse.json(
        { error: `Kredit tak cukup. Perlu ~RM${totalCost.toFixed(2)}.` },
        { status: 402 }
      );
    }
  }
```

- [ ] **Step 2: Update body-parse to accept `provider: "gemini"`**

In the same file, find where `providerChoice` is parsed from the request body. Search for it:

```bash
cd /e/Project/HCKCREA && grep -n 'providerChoice' app/api/generate/auto-content/route.ts | head -10
```

Find the first occurrence (around line 50-90 where body parsing happens) — the declaration looks like:

```ts
  const providerChoice: "veo" | "grok" = body?.provider === "grok" ? "grok" : "veo";
```

Replace with:

```ts
  const providerChoice: "veo" | "grok" | "gemini" =
    body?.provider === "grok"
      ? "grok"
      : body?.provider === "gemini"
        ? "gemini"
        : "veo";
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "auto-content/route" | head -20
```

Expected: no errors. (Note: there may be type-narrowing errors in the per-row loop where existing code branches `providerChoice === "grok"`. Those are fixed in Task 5 when the gemini branch is added inside the loop. If TS complains, leave the errors — Task 5 resolves them.)

If TS complains about exhaustive checks on the `providerChoice` union in places we won't touch in this task, add a defensive default branch in those spots: `providerChoice === "gemini" ? <safe default> : ...`. Use judgment.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/generate/auto-content/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(auto-content): pre-flight cost incl. storyboard for gemini

Extends the providerChoice union with "gemini", body parser accepts
provider: "gemini", and pre-flight credit check adds the GPT Image 2
storyboard fee (rate_gpt_image) on top of the GeminiOmni video rate
(rate_gemini.per_video_10s). Total per row = storyboardRate + videoRate.

Cost preview UI still shows video-only per user direction (preview
hides storyboard fee). Real deduction is the full sum.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 5: Per-row Gemini storyboard branch

**Files:**
- Modify: `app/api/generate/auto-content/route.ts:1988-2030` (per-row loop)

- [ ] **Step 1: Add imports**

Open `app/api/generate/auto-content/route.ts`. Find the top-of-file imports. Add a new import line for the storyboard helpers. Search for the existing import from `@/lib/auto-content-frameworks` or similar to find where to put the new import:

```bash
cd /e/Project/HCKCREA && grep -n '^import' app/api/generate/auto-content/route.ts | head -15
```

Add this import next to the other `@/lib/*` imports:

```ts
import {
  buildStoryboardFallback,
  runStoryboardCascadeWithRetry,
  pollImageTaskUntilDone,
} from "@/lib/auto-content-storyboard";
```

- [ ] **Step 2: Add the storyboard branch to the per-row loop**

In the same file, find lines 1988-2030 (the `Promise.all(plans.map(async (item, idx) => {` block):

```ts
  await Promise.all(
    plans.map(async (item, idx) => {
      const refImages = imagesForVideo(idx);
      const refImage = refImages[0] || "";
      const useIngredient = refImages.length > 0;
      // providerChoice='grok' now routes to Sora 2 (model='sora2'). The
      // UI relabels the Grok button as "⚡ Sora 2" but keeps the internal
      // state key as "grok" to avoid a wide backend refactor — every
      // existing providerChoice='grok' branch stays in place; only the
      // MODEL STRING sent to the cascade changes from 'grok-imagine'
      // → 'sora2'. lib/p6.ts apipodVideoModel detects 'sora' keyword and
      // emits 'sora-2-vip' as the API model id.
      const model =
        providerChoice === "grok"
          ? "sora2"
          : useIngredient
            ? cfg.videoR2V
            : cfg.videoT2V;
      const seg1Prompt = veoSeg1PromptFor(item, lockedVoiceLine);
      const seg2Prompt = is16s
        ? veoSeg2PromptFor(item, lockedVoiceLine)
        : "";

      // Veo → video cascade. Sora 2 (previously labelled Grok in the
      // internal providerChoice state for backward compat) → sora2
      // cascade. Each pool has independent main+fallback config at
      // /admin/settings (sora2_main_slots / sora2_fallback_slots etc.)
      // and its own round-robin counter.
      const cascaded = await generateVideoWithCascade({
        primaryModel: model,
        userId: user.id,
        prompt: seg1Prompt,
        imageUrls: refImages,
        durationMode:
          providerChoice === "grok"
            ? String(grokDuration)
            : is16s
              ? "8"
              : durationMode,
        aspectRatio,
        imageMode: useIngredient ? "ingredient" : "text",
        asset: providerChoice === "grok" ? "sora2" : "video",
      });
```

Replace with:

```ts
  await Promise.all(
    plans.map(async (item, idx) => {
      const refImages = imagesForVideo(idx);
      const refImage = refImages[0] || "";
      const useIngredient = refImages.length > 0;

      // ── GeminiOmni 2-stage path ────────────────────────────────────
      // When the user picks GeminiOmni: first generate a key-frame
      // storyboard via GPT Image 2 (using the user's refs + the master
      // plan's storyboardPrompt), then animate that single storyboard
      // image through GeminiOmni. Storyboard URL is cached on metadata
      // so resubmit can skip the RM 0.30 redo.
      let geminiStoryboardUrl: string | null = null;
      let geminiStoryboardAttempts = 0;
      let geminiStoryboardError: string | null = null;
      let geminiStoryboardUsedPrompt = "";
      if (providerChoice === "gemini") {
        const sbPrompt =
          (item.storyboardPrompt && item.storyboardPrompt.trim()) ||
          buildStoryboardFallback(item);
        geminiStoryboardUsedPrompt = sbPrompt;
        const sbResult = await runStoryboardCascadeWithRetry({
          prompt: sbPrompt,
          aspectRatio,
          imageUrls: refImages,
        });
        geminiStoryboardAttempts = sbResult.attempts;
        if (sbResult.ok) {
          const polled = await pollImageTaskUntilDone({
            taskId: sbResult.taskId,
            slot: sbResult.slot,
          });
          if (polled.ok) {
            geminiStoryboardUrl = polled.outputUrl;
          } else {
            geminiStoryboardError = polled.error;
          }
        } else {
          geminiStoryboardError = sbResult.error;
        }

        // Storyboard failure → insert failed row and return (no video call).
        if (!geminiStoryboardUrl) {
          await admin.from("history").insert({
            user_id: user.id,
            project_id: projectId,
            type: "auto-content",
            tab: "auto",
            status: "failed",
            prompt: veoSeg1PromptFor(item, lockedVoiceLine),
            caption: item.caption || "",
            framework: item.framework || `Video ${idx + 1}`,
            reference_url: refImage || null,
            task_id: null,
            duration: 10,
            cost: 0,
            batch_id: batch?.id,
            error_message: geminiStoryboardError || "Storyboard generation failed",
            metadata: {
              idx,
              modelChoice: "gemini",
              providerChoice,
              storyboard_attempts: geminiStoryboardAttempts,
              storyboardPrompt: geminiStoryboardUsedPrompt,
              image_urls: refImages,
              framework: item.framework,
              framework_type: item.frameworkType,
              target_emotion: item.targetEmotion,
              hook_angle: item.hookAngle,
              image_prompt: item.imagePrompt,
              video_prompt_shot1: item.videoPromptShot1,
              video_prompt_shot2: item.videoPromptShot2,
              idea_style: ideaStyle || undefined,
              product_name: productName || null,
              tiktok_product_id: tiktokProductId || null,
              cover_title: item.coverTitle,
              cover_subtitle: item.coverSubtitle,
              imageMode: "ingredient",
            },
          });
          return; // Skip the video call for this row.
        }
      }
      // ── End GeminiOmni 2-stage path ────────────────────────────────

      // providerChoice='grok' now routes to Sora 2 (model='sora2'). The
      // UI relabels the Grok button as "⚡ Sora 2" but keeps the internal
      // state key as "grok" to avoid a wide backend refactor — every
      // existing providerChoice='grok' branch stays in place; only the
      // MODEL STRING sent to the cascade changes from 'grok-imagine'
      // → 'sora2'. lib/p6.ts apipodVideoModel detects 'sora' keyword and
      // emits 'sora-2-vip' as the API model id.
      // GeminiOmni uses model='google/gemini-omni' + asset='gemini' (the
      // dedicated Gemini cascade pool wired in Tasks 1-14).
      const model =
        providerChoice === "gemini"
          ? "google/gemini-omni"
          : providerChoice === "grok"
            ? "sora2"
            : useIngredient
              ? cfg.videoR2V
              : cfg.videoT2V;
      const seg1Prompt = veoSeg1PromptFor(item, lockedVoiceLine);
      const seg2Prompt = is16s
        ? veoSeg2PromptFor(item, lockedVoiceLine)
        : "";

      // For GeminiOmni: img_urls = [storyboardUrl] (single image, not
      // the user's raw refs). Other providers pass the raw refs through.
      const videoRefs =
        providerChoice === "gemini"
          ? [geminiStoryboardUrl!]
          : refImages;
      const videoImageMode: "ingredient" | "text" =
        providerChoice === "gemini"
          ? "ingredient" // Gemini's only mode for refs
          : useIngredient
            ? "ingredient"
            : "text";

      // Veo → video cascade. Sora 2 → sora2 cascade. GeminiOmni →
      // gemini cascade. Each pool has independent main+fallback config
      // at /admin/settings and its own round-robin counter.
      const cascaded = await generateVideoWithCascade({
        primaryModel: model,
        userId: user.id,
        prompt: seg1Prompt,
        imageUrls: videoRefs,
        durationMode:
          providerChoice === "gemini"
            ? "10"
            : providerChoice === "grok"
              ? String(grokDuration)
              : is16s
                ? "8"
                : durationMode,
        aspectRatio,
        imageMode: videoImageMode,
        asset:
          providerChoice === "gemini"
            ? "gemini"
            : providerChoice === "grok"
              ? "sora2"
              : "video",
      });
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "auto-content/route" | head -30
```

Expected: no errors. If errors remain, they'll most likely be about `geminiStoryboardUrl!` non-null assertion or about `videoRefs` being a never-type — both should be fine since we early-return on failure.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/generate/auto-content/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(auto-content): Gemini storyboard pipeline in per-row loop

When providerChoice === "gemini":
1. Build storyboard prompt (LLM's storyboardPrompt or mechanical
   fallback from videoPromptShot1)
2. Call runStoryboardCascadeWithRetry — 3 passes through the image
   cascade until one slot accepts
3. Poll the accepted image task until done (60s timeout)
4. If success: animate with GeminiOmni using img_urls=[storyboardUrl]
5. If storyboard fails: insert failed row, skip video call, charge 0

Veo / Sora 2 paths unchanged. Storyboard URL cached on metadata for
resubmit reuse (Task 8). Cost stamping per row lands in Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 6: Metadata + cost stamping for Gemini rows

**Files:**
- Modify: `app/api/generate/auto-content/route.ts:2032-2126` (history insert block)

- [ ] **Step 1: Extend the history insert with Gemini-specific fields**

Open `app/api/generate/auto-content/route.ts`. Find the `admin.from("history").insert({...})` block right after the `cascaded = await generateVideoWithCascade(...)` call (lines 2032-2126):

```ts
      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "auto-content",
          tab: "auto",
          status: cascaded.ok ? "pending" : "failed",
          prompt: seg1Prompt,
          caption: item.caption || "",
          framework: item.framework || `Video ${idx + 1}`,
          reference_url: refImage || null,
          task_id: cascaded.ok ? cascaded.taskId : null,
          // Grok: actual per-second duration. Veo: 8 or 16.
          duration:
            providerChoice === "grok"
              ? grokDuration
              : is16s
                ? 16
                : 8,
          cost: videoRate,
          batch_id: batch?.id,
          // 16s chain fields — onSegmentSettled reads these to fire seg-2.
          segment_index: is16s ? 1 : null,
          frame_anchor: is16s ? "last" : null,
          error_message: cascaded.ok ? null : cascaded.error,
          metadata: {
            idx,
            model: cascaded.ok ? cascaded.actualModel : model,
            provider: cascaded.ok ? cascaded.actualProvider : "p2",
            slot: cascaded.ok ? cascaded.actualSlot : undefined,
            ...(cascaded.ok && cascaded.keyIndex !== undefined
              ? { p6_key_index: cascaded.keyIndex }
              : {}),
            // Full attachment array — ALL refs the user picked, not
            // just the first. Auto-cron / retry / manual Resubmit
            // read this back via metadata.image_urls and re-fire the
            // cascade with the SAME image set. Previously this stamped
            // only [refImage] (the first slot), so a retry on a 3-ref
            // generation would silently drop refs 2 and 3.
            image_urls: refImages,
            fallback_used: cascaded.ok ? cascaded.fallbackUsed : false,
            tier_log: cascaded.tierLog,
            batch_id: batch?.id,
            framework: item.framework,
            framework_type: item.frameworkType,
            target_emotion: item.targetEmotion,
            hook_angle: item.hookAngle,
            image_prompt: item.imagePrompt,
            video_prompt_shot1: item.videoPromptShot1,
            video_prompt_shot2: item.videoPromptShot2,
            // Stamp the client-provided idea so the history card can
            // surface it as a label (rainbow badge alongside framework).
            // Empty when user used Normal Flow — the card-side check
            // hides the badge in that case.
            idea_style: ideaStyle || undefined,
            // Provider chip + tracking on the history card. Sora 2 rows
            // (providerChoice='grok' internally for backward compat)
            // stamp modelChoice='sora2' so settle.ts + auto-resubmit
            // route them back through the sora2 cascade pool.
            providerChoice,
            ...(providerChoice === "grok"
              ? {
                  modelChoice: "sora2",
                  grok_duration: grokDuration, // legacy field name
                  sora2_duration: grokDuration,
                }
              : {}),
            // Segment chain — duration_mode + seg2_prompt + voice_line
            // are what segment-chain.ts onSegmentSettled needs to fire
            // seg-2 automatically when seg-1 settles. ONLY stamped for
            // Veo 16s rows; Grok is single-shot so the chain is skipped.
            ...(is16s
              ? {
                  duration_mode: "16s",
                  seg2_prompt: seg2Prompt,
                  voice_line: lockedVoiceLine,
                  aspectRatio,
                  hijab: hijabMode,
                }
              : {}),
            // Fields the creative-hack-auto extension's auto-post step
            // reads: cover_title, cover_subtitle, caption (on the row
            // itself), product_name, tiktok_product_id. Saved here so
            // the extension can post directly from history without
            // round-tripping through any intermediate state.
            product_name: productName || null,
            tiktok_product_id: tiktokProductId || null,
            cover_title: item.coverTitle,
            cover_subtitle: item.coverSubtitle,
            imageMode: useIngredient ? "ingredient" : "text",
          },
        })
        .select()
        .single();
      if (hist) histories.push(hist);
    })
  );
```

Replace with:

```ts
      const { data: hist } = await admin
        .from("history")
        .insert({
          user_id: user.id,
          project_id: projectId,
          type: "auto-content",
          tab: "auto",
          status: cascaded.ok ? "pending" : "failed",
          prompt: seg1Prompt,
          caption: item.caption || "",
          framework: item.framework || `Video ${idx + 1}`,
          reference_url: refImage || null,
          task_id: cascaded.ok ? cascaded.taskId : null,
          // Grok: actual per-second duration. Veo: 8 or 16. Gemini: 10.
          duration:
            providerChoice === "gemini"
              ? 10
              : providerChoice === "grok"
                ? grokDuration
                : is16s
                  ? 16
                  : 8,
          // Gemini: storyboard cost + video cost (both real money).
          // Veo / Sora 2: video only.
          cost:
            providerChoice === "gemini"
              ? videoRate + storyboardRate
              : videoRate,
          batch_id: batch?.id,
          // 16s chain fields — onSegmentSettled reads these to fire seg-2.
          // Gemini is single-shot (no chain) so segment_index stays null.
          segment_index: is16s ? 1 : null,
          frame_anchor: is16s ? "last" : null,
          error_message: cascaded.ok ? null : cascaded.error,
          metadata: {
            idx,
            model: cascaded.ok ? cascaded.actualModel : model,
            provider: cascaded.ok ? cascaded.actualProvider : "p2",
            slot: cascaded.ok ? cascaded.actualSlot : undefined,
            ...(cascaded.ok && cascaded.keyIndex !== undefined
              ? { p6_key_index: cascaded.keyIndex }
              : {}),
            // Full attachment array — ALL refs the user picked, not
            // just the first. For Gemini rows this is the ORIGINAL user
            // refs (not the storyboard URL — that's stamped separately
            // below so resubmit can reuse it). Auto-cron / retry /
            // manual Resubmit read this back via metadata.image_urls.
            image_urls: refImages,
            fallback_used: cascaded.ok ? cascaded.fallbackUsed : false,
            tier_log: cascaded.tierLog,
            batch_id: batch?.id,
            framework: item.framework,
            framework_type: item.frameworkType,
            target_emotion: item.targetEmotion,
            hook_angle: item.hookAngle,
            image_prompt: item.imagePrompt,
            video_prompt_shot1: item.videoPromptShot1,
            video_prompt_shot2: item.videoPromptShot2,
            // Stamp the client-provided idea so the history card can
            // surface it as a label (rainbow badge alongside framework).
            // Empty when user used Normal Flow — the card-side check
            // hides the badge in that case.
            idea_style: ideaStyle || undefined,
            // Provider chip + tracking on the history card. Sora 2 rows
            // (providerChoice='grok' internally for backward compat)
            // stamp modelChoice='sora2' so settle.ts + auto-resubmit
            // route them back through the sora2 cascade pool.
            providerChoice,
            ...(providerChoice === "grok"
              ? {
                  modelChoice: "sora2",
                  grok_duration: grokDuration, // legacy field name
                  sora2_duration: grokDuration,
                }
              : {}),
            // GeminiOmni 2-stage metadata — storyboard fields so
            // settle.ts + retry route can reuse the cached storyboard
            // image instead of regenerating it on resubmit (saves
            // ~RM 0.30 per retry). modelChoice='gemini' routes the row
            // through the gemini cascade pool on auto-retry.
            ...(providerChoice === "gemini"
              ? {
                  modelChoice: "gemini",
                  storyboard_url: geminiStoryboardUrl,
                  storyboard_cost: storyboardRate,
                  storyboard_attempts: geminiStoryboardAttempts,
                  storyboardPrompt: geminiStoryboardUsedPrompt,
                  video_cost: videoRate,
                }
              : {}),
            // Segment chain — duration_mode + seg2_prompt + voice_line
            // are what segment-chain.ts onSegmentSettled needs to fire
            // seg-2 automatically when seg-1 settles. ONLY stamped for
            // Veo 16s rows; Grok + Gemini are single-shot.
            ...(is16s
              ? {
                  duration_mode: "16s",
                  seg2_prompt: seg2Prompt,
                  voice_line: lockedVoiceLine,
                  aspectRatio,
                  hijab: hijabMode,
                }
              : {}),
            // Fields the creative-hack-auto extension's auto-post step
            // reads: cover_title, cover_subtitle, caption (on the row
            // itself), product_name, tiktok_product_id. Saved here so
            // the extension can post directly from history without
            // round-tripping through any intermediate state.
            product_name: productName || null,
            tiktok_product_id: tiktokProductId || null,
            cover_title: item.coverTitle,
            cover_subtitle: item.coverSubtitle,
            imageMode:
              providerChoice === "gemini"
                ? "ingredient"
                : useIngredient
                  ? "ingredient"
                  : "text",
          },
        })
        .select()
        .single();
      if (hist) histories.push(hist);
    })
  );
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "auto-content/route" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/generate/auto-content/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(auto-content): metadata + cost stamping for Gemini rows

History insert now:
- Sets cost = storyboardRate + videoRate for Gemini rows (real RM
  charged includes the hidden storyboard fee)
- Sets duration = 10 for Gemini (matches the fixed pill)
- Stamps Gemini-specific metadata: storyboard_url, storyboard_cost,
  storyboard_attempts, storyboardPrompt, video_cost, modelChoice
- Forces imageMode='ingredient' for Gemini (the storyboard is the ref)

Veo / Sora 2 paths unchanged. Resubmit + auto-retry can now read
metadata.storyboard_url to skip the RM 0.30 redo (wired in Tasks
8 + 9).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 7: Add GeminiOmni chip to Auto Content tab UI

**Files:**
- Modify: `app/dashboard/tabs/auto-content.tsx` (multiple insertion points)

- [ ] **Step 1: Extend provider type**

Open `app/dashboard/tabs/auto-content.tsx`. Find line 99 (the `provider` state):

```ts
  const [provider, setProvider] = useState<"veo" | "grok">("veo");
```

Replace with:

```ts
  const [provider, setProvider] = useState<"veo" | "grok" | "gemini">("veo");
```

- [ ] **Step 2: Add Gemini rate state + fetch**

In the same file, find the `grokRate` state + useEffect block (around lines 107-119):

```ts
  const [grokRate, setGrokRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.rate === "number") setGrokRate(d.rate);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
```

Replace with:

```ts
  const [grokRate, setGrokRate] = useState<number | null>(null);
  // GeminiOmni flat per-10s-video rate. The Auto Content storyboard
  // mode also charges a hidden GPT Image 2 fee (~RM 0.30 per row) but
  // per user direction the preview UI only shows the video rate.
  const [geminiRate, setGeminiRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.rate === "number") setGrokRate(d.rate);
      })
      .catch(() => {});
    fetch("/api/gemini/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.rate === "number") setGeminiRate(d.rate);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
```

- [ ] **Step 3: Add the GeminiOmni chip to the provider picker**

Search for the existing provider picker in the file:

```bash
cd /e/Project/HCKCREA && grep -n 'setProvider' app/dashboard/tabs/auto-content.tsx | head -10
```

Locate the existing pair of buttons that calls `setProvider("veo")` and `setProvider("grok")`. The pattern is likely a 2-button row. Add a third button. Mirror the existing Veo / Sora 2 button styling. The button label is `🔷 GeminiOmni`, the active style uses the cyan/blue gradient from the Original Video tab (`linear-gradient(135deg, #3b82f6, #06b6d4)`).

Example shape (the actual existing JSX may differ — read what's there first and add the third button consistently):

Existing:
```tsx
            <button
              type="button"
              onClick={() => setProvider("veo")}
              ...
            >
              Veo
            </button>
            <button
              type="button"
              onClick={() => setProvider("grok")}
              ...
            >
              ⚡ Sora 2
            </button>
```

Add immediately after the Sora 2 button:

```tsx
            <button
              type="button"
              onClick={() => setProvider("gemini")}
              className="px-3 py-2.5 rounded-xl text-xs font-extrabold transition-all"
              style={
                provider === "gemini"
                  ? {
                      background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
                      color: "white",
                      boxShadow: "0 4px 12px rgba(6,182,212,0.25)",
                      border: "1px solid transparent",
                    }
                  : {
                      background: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-text-primary)",
                    }
              }
            >
              🔷 GeminiOmni
            </button>
```

If the parent flex/grid container has a fixed column count (e.g. `grid-cols-2`), update it to fit 3 columns: `grid-cols-3` or `grid-cols-2 sm:grid-cols-3`. Match the responsive pattern already used by the existing provider chips.

- [ ] **Step 4: Hide duration picker + show fixed pill when Gemini selected**

Search for where the Veo `durationMode` toggle (8s / 16s) and Sora 2 `grokDuration` slider render:

```bash
cd /e/Project/HCKCREA && grep -n 'setDuration\|setGrokDuration\|grokDuration' app/dashboard/tabs/auto-content.tsx | head -10
```

Wrap the duration UI block(s) so they only render when `provider !== "gemini"`. Add a new "Fixed 10s · 1080p" pill that shows only when `provider === "gemini"`:

```tsx
            {provider === "gemini" && (
              <div
                className="px-3 py-2 rounded-lg text-sm font-bold text-center"
                style={{
                  background: "rgba(6,182,212,0.08)",
                  border: "1px solid rgba(6,182,212,0.25)",
                  color: "#06b6d4",
                }}
              >
                Fixed 10s · 1080p
              </div>
            )}
```

Place this pill where the duration picker currently renders, conditional on provider.

- [ ] **Step 5: Cost preview includes Gemini branch**

Search for where cost preview text is constructed (look for `videoRate`, `grokRate`, or similar in JSX):

```bash
cd /e/Project/HCKCREA && grep -n 'grokRate\|videoRate\|toFixed(2)' app/dashboard/tabs/auto-content.tsx | head -10
```

Find the cost preview ternary or `if` chain. Add a Gemini branch that displays `geminiRate.toFixed(2)` (video-only — per user direction, storyboard fee hidden). Example shape:

If current preview reads something like:
```tsx
{provider === "grok" && grokRate != null ? (grokRate * grokDuration).toFixed(2) : veoRateFallback}
```

Update to:
```tsx
{provider === "gemini" && geminiRate != null
  ? geminiRate.toFixed(2)
  : provider === "grok" && grokRate != null
    ? (grokRate * grokDuration).toFixed(2)
    : veoRateFallback}
```

The exact JSX depends on what's there — apply the gemini branch consistently to any cost-display element.

- [ ] **Step 6: Submit body sends provider**

Search for where the form submits to `/api/generate/auto-content`:

```bash
cd /e/Project/HCKCREA && grep -n 'auto-content' app/dashboard/tabs/auto-content.tsx | head -10
```

Find the `fetch("/api/generate/auto-content", ...)` call. The submit body already includes `provider: provider` (the existing Veo / Grok dispatch reads it). No change needed unless the body explicitly maps the value — verify by reading.

If the body does map (e.g. `provider: provider === "grok" ? "grok" : "veo"`), update to pass `"gemini"` through:

```ts
provider: provider === "gemini" ? "gemini" : provider === "grok" ? "grok" : "veo",
```

If the body just passes `provider: provider`, no change.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "tabs/auto-content" | head -20
```

Expected: no errors.

- [ ] **Step 8: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/dashboard/tabs/auto-content.tsx && \
  git commit -m "$(cat <<'EOF'
feat(auto-content): GeminiOmni provider chip + cost preview

Adds a 3rd provider option (🔷 GeminiOmni) to the Auto Content tab
alongside Veo and Sora 2. When selected:
- Duration picker hidden; "Fixed 10s · 1080p" pill shown instead
- Cost preview reads /api/gemini/rate (video-only RM — storyboard
  fee hidden per user direction)
- Submit body sends provider: "gemini"; backend takes the 2-stage
  pipeline (storyboard → animate)

Cyan/blue gradient matches the Original Video tab's GeminiOmni chip
for visual consistency across surfaces.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 8: Resubmit reuses cached storyboard for Gemini rows

**Files:**
- Modify: `app/api/history/retry/route.ts` (per spec §3.5)

- [ ] **Step 1: Read the current retry handler around the gemini branch**

Open `app/api/history/retry/route.ts`. Find the gemini branch added in earlier Task 8 of the GeminiOmni primary rollout:

```bash
cd /e/Project/HCKCREA && grep -n 'gemini' app/api/history/retry/route.ts | head -10
```

You should see (from earlier work):
- Model picker branch: `meta.modelChoice === "gemini" → model = "google/gemini-omni"`
- Asset detection branch: `meta.modelChoice === "gemini" → asset = "gemini"`

- [ ] **Step 2: Add storyboard-reuse logic in the retry body assembly**

Find where the retry route assembles the `imageUrls` array for the video cascade call. Search for `imageUrls:` or `image_urls`:

```bash
cd /e/Project/HCKCREA && grep -n 'imageUrls\|image_urls' app/api/history/retry/route.ts | head -15
```

The plan currently passes `meta.image_urls` (the user's original refs). For Gemini-storyboard rows, we want to pass `[meta.storyboard_url]` instead so GeminiOmni uses the cached storyboard rather than re-rendering from raw refs.

Locate the line that assembles `refImages` or `imageUrls` from metadata. It will look something like:

```ts
  const refImages: string[] = Array.isArray(meta.image_urls)
    ? meta.image_urls
    : [];
```

Replace with:

```ts
  // GeminiOmni storyboard rows: reuse the cached storyboard URL (saved
  // RM 0.30 per resubmit). If storyboard_url is missing, fall back to
  // raw refs — settle/retry will then route the row through the
  // gemini cascade with raw refs (degrades to direct GeminiOmni without
  // a storyboard pre-render).
  const isGeminiStoryboard =
    meta.modelChoice === "gemini" && typeof meta.storyboard_url === "string" && meta.storyboard_url;
  const refImages: string[] = isGeminiStoryboard
    ? [meta.storyboard_url]
    : Array.isArray(meta.image_urls)
      ? meta.image_urls
      : [];
```

Note: the exact variable name in the route may differ. Adapt to whatever is there — but the principle is: if `meta.modelChoice === "gemini"` AND `meta.storyboard_url` is present, use `[meta.storyboard_url]` instead of `meta.image_urls`.

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
feat(retry): reuse cached storyboard URL on Gemini row resubmit

When a failed row has metadata.modelChoice='gemini' AND
metadata.storyboard_url is present, the manual Resubmit path now
passes [storyboard_url] to the gemini cascade instead of the raw
user refs — saves the RM 0.30 GPT Image 2 re-render.

Falls back to raw refs when storyboard_url is missing (storyboard
step itself failed originally), so the row still gets a video on
resubmit even without the storyboard pre-render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 9: Settle auto-retry reuses storyboard for Gemini rows

**Files:**
- Modify: `lib/settle.ts` (per spec §3.6)

- [ ] **Step 1: Find the gemini auto-retry branch in settle.ts**

Open `lib/settle.ts`. Search for the gemini branches added in the earlier Task 9:

```bash
cd /e/Project/HCKCREA && grep -n 'gemini' lib/settle.ts | head -10
```

- [ ] **Step 2: Patch the auto-retry refs assembly**

Find where `tryAutoRetry` builds the `imageUrls` array for the `generateVideoWithCascade` call. Search for `allImageUrls` or `image_urls`:

```bash
cd /e/Project/HCKCREA && grep -n 'allImageUrls\|image_urls' lib/settle.ts | head -10
```

The existing code (added before this plan) assembles `allImageUrls` from `meta.image_urls`. Locate the relevant block, which looks something like:

```ts
  const allImageUrls: string[] =
    Array.isArray(meta.image_urls) && meta.image_urls.length > 0
      ? meta.image_urls.filter((u: any) => typeof u === "string" && u.trim())
      : refImage
        ? [refImage]
        : [];
```

Replace with:

```ts
  // GeminiOmni storyboard rows: auto-retry should reuse the cached
  // storyboard image instead of regenerating from raw refs. Otherwise
  // the event-driven retry would re-introduce the drift the storyboard
  // step originally solved.
  const isGeminiStoryboard =
    meta.modelChoice === "gemini" &&
    typeof meta.storyboard_url === "string" &&
    meta.storyboard_url;
  const allImageUrls: string[] = isGeminiStoryboard
    ? [meta.storyboard_url]
    : Array.isArray(meta.image_urls) && meta.image_urls.length > 0
      ? meta.image_urls.filter((u: any) => typeof u === "string" && u.trim())
      : refImage
        ? [refImage]
        : [];
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "settle\.ts" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/settle.ts && \
  git commit -m "$(cat <<'EOF'
feat(settle): reuse cached storyboard URL for Gemini auto-retry

When tryAutoRetry fires a fresh cascade for a Gemini-storyboard row,
pass [meta.storyboard_url] instead of meta.image_urls so the retry
animates from the SAME storyboard the original fire used. Without
this, event-driven retry would re-pass the user's raw refs and
re-introduce the composition drift the storyboard solved.

Falls back to raw refs when storyboard_url is missing (legacy rows
or rows where storyboard step itself failed). Manual Resubmit
(Task 8) has the same branch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 10: User smoke test (surface steps)

**Files:** None modified — verification only.

- [ ] **Step 1: Wait for Vercel deploy after Task 9**

```bash
cd /e/Project/HCKCREA && gh run list --limit 1
```

Wait until the most recent run shows `completed` / `success`.

- [ ] **Step 2: Confirm pre-existing rates are set**

Open https://peninglab.com/admin/settings. Verify in the Rates card:
- **GPT Image 2** rate is non-zero (e.g. RM 0.30 for `per_image`)
- **GeminiOmni (Google) / 10s video** is set (e.g. RM 0.40 — set during Task 13 of the primary rollout)

If either is missing, set them and click Save Rates.

- [ ] **Step 3: Smoke test the storyboard pipeline**

Open https://peninglab.com/dashboard → Auto Content tab. Configure:
- 1 product (manual mode is fine — upload product image, add brief info)
- Avatar: female / hijab / 30s
- Framework: pick **Testimonial** (id 2) — a UGC framework that needs both character + product in the storyboard
- Quantity: **2** (small batch to verify per-row storyboard generation)
- Provider: click 🔷 **GeminiOmni** chip
- Verify the duration picker is replaced by the "Fixed 10s · 1080p" pill
- Verify cost preview shows roughly RM 0.40/video (storyboard fee hidden)
- CTA: shop mode is fine

Click Generate Auto Content. Confirm:
- Pre-flight passes (RM 0.70 per row × 2 = RM 1.40 is deducted from credits)
- Two history rows appear, both spinning with the Generating loader
- Within ~2 minutes each row flips to `done` with a playable 10s mp4

- [ ] **Step 4: Verify metadata on the rows**

Open the browser DevTools network tab → run the history fetch (or just inspect the rows via /admin/usage). Confirm:
- Both rows have `metadata.modelChoice === "gemini"`
- Both rows have `metadata.storyboard_url` set to a B2 / Crun URL pointing at a generated PNG
- Both rows have `metadata.storyboard_attempts >= 1`
- Both rows have `metadata.storyboard_prompt` populated (either LLM-authored or fallback-derived)
- `cost` column equals `metadata.storyboard_cost + metadata.video_cost`

- [ ] **Step 5: Smoke test Resubmit reuses storyboard**

In the history grid, find a completed Gemini row. Manually force a failure by:
- Going to /admin/settings → Cascade card
- Set `GEMINI MAIN` slot 0 = `none`, slot 1 = `none` (kill all main slots)
- Set `GEMINI FALLBACK` slot 0 = `none` (kill the fallback too)
- Save the cascade

Then fire ONE Gemini Auto Content video. Storyboard will succeed (uses the image cascade, not the gemini video cascade) but the animate step will fail. Once the row shows `failed`, restore the cascade (p2-a + p2-b in main, p5 in fallback) and save. Click Resubmit on the failed row. Confirm:
- Resubmit fires fast (~60s — only the video step runs, not the 20s storyboard)
- The new task uses `imageUrls: [metadata.storyboard_url]` — verify via /admin/errors → tier_log on the row, the request should reference the storyboard URL

- [ ] **Step 6: Verify storyboard failure path**

Force a storyboard failure by setting ALL image cascade slots (Image MAIN + Image FALLBACK) to `none` in /admin/settings → Cascade card. Save. Fire a Gemini Auto Content video. Confirm:
- The row inserts with `status='failed'` and `error_message` mentions "Storyboard cascade failed after 3 passes"
- `cost = 0` on the row (no charge for failed storyboard)
- No video call was attempted (`task_id IS NULL`)

Restore the image cascade slots after testing.

- [ ] **Step 7: Mark done**

If steps 3-6 all pass, the GeminiOmni Auto Content storyboard mode is fully shipped. No commit needed for this task.

If any step fails, file the failure with the exact symptom + browser console / Vercel log excerpt and stop — fix before declaring complete.

---

## Self-Review

**1. Spec coverage check**

| Spec section | Plan task |
|---|---|
| §1 Behavior summary (2-stage pipeline, fixed 10s/1080p, retry count, caching, cost) | Tasks 1, 4, 5, 6, 7 |
| §2 Architecture (per-row branch, storyboard cascade with retry, image polling, video cascade animate) | Tasks 1 (helpers) + 5 (per-row branch) |
| §3.1 lib/auto-content-storyboard.ts (NEW) | Task 1 |
| §3.2 master plan system prompt upgrade | Task 3 |
| §3.3 auto-content/route.ts (Plan type, system prompt, pre-flight, per-row branch, metadata) | Tasks 2 + 3 + 4 + 5 + 6 |
| §3.4 auto-content.tsx UI (chip + cost preview + fixed pill) | Task 7 |
| §3.5 retry/route.ts (reuse storyboard_url) | Task 8 |
| §3.6 settle.ts (reuse storyboard_url in auto-retry) | Task 9 |
| §3.7 history-grid (optional preview) | Out of scope per spec |
| §4 E2E requirements (cost, history, cascade, retry, fail paths) | Verified in Task 10 |
| §5 Manual admin setup (no new keys) | Verified in Task 10 step 2 |
| §6 Risks (latency, cost surprise, LLM omits, cascade exhaust) | Mitigations in Tasks 1, 4, 5 |

**2. Placeholder scan** — searched for "TBD", "TODO", "fill in", "implement later", "similar to Task". None present in the plan body.

**3. Type consistency check**
- `MAX_STORYBOARD_RETRIES`: defined Task 1, used Task 1 only. ✓
- `buildStoryboardFallback({videoPromptShot1, framework})`: signature Task 1, called Task 5 with `item` (which is `Plan` — has both fields). ✓
- `runStoryboardCascadeWithRetry({prompt, aspectRatio, imageUrls})`: signature Task 1, called Task 5 with matching args. ✓
- `pollImageTaskUntilDone({taskId, slot, maxWaitMs?, pollIntervalMs?})`: signature Task 1, called Task 5 without optional args (defaults: 60_000 / 3_000). ✓
- `StoryboardCascadeResult`: defined Task 1, consumed Task 5 via `.ok / .taskId / .slot / .attempts / .error`. ✓
- `providerChoice` union extended `"veo" | "grok"` → `"veo" | "grok" | "gemini"` in Task 4, used in Tasks 5, 6, 7. ✓
- `metadata.storyboard_url` written in Task 6, read in Tasks 8 + 9. ✓
- `metadata.storyboard_cost` + `metadata.video_cost` written in Task 6, used in Task 10 verification. ✓
- `metadata.modelChoice = "gemini"` written in Task 6, read in Tasks 8 + 9 to detect storyboard rows. ✓
- `getGptImageRate()` imported in Task 4, exists in `lib/settings.ts` (verified during research). ✓
- `geminiStoryboardUsedPrompt`: local var in Task 5, stamped on metadata in Task 6 as `storyboardPrompt`. ✓

All types, signatures, and metadata key names are internally consistent.
