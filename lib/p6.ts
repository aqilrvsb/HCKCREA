// APIPod (api.apipod.ai) — Google Veo + Grok video gateway.
//
// Multi-key architecture: each slot p6-a … p6-h has its own API key
// stored in app_settings.p6_key_<letter>. Admin picks any subset of
// the 8 slots in the cascade rotation. This is identical to the p2-a
// / p2-b pattern but extended to 8 keys to spread rate-limit load
// across more APIPod accounts during high-volume periods (e.g. when
// the underlying Google Veo 3.1 endpoint is rate-limiting any single
// account).
//
// Auth: Bearer header (per-key)
// Base: https://api.apipod.ai
// Endpoints:
//   POST /v1/videos/generations    — submit Veo / Grok
//   GET  /v1/videos/status/{id}    — poll task status
//
// APIPod scopes task_ids per account — settle.ts MUST poll with the
// same key that submitted. The cascade stamps the slot label (p6-a
// etc) on metadata.slot so settle can look up the right key.

import { getSettings } from "@/lib/settings";

const P6_BASE = "https://api.apipod.ai";

export type P6Slot = "p6-a" | "p6-b" | "p6-c" | "p6-d" | "p6-e" | "p6-f" | "p6-g" | "p6-h";
export const P6_SLOTS: P6Slot[] = ["p6-a", "p6-b", "p6-c", "p6-d", "p6-e", "p6-f", "p6-g", "p6-h"];

export type P6Provider = "p6";

export type P6CreateResult =
  | { ok: true; task_id: string; raw: any; provider: P6Provider }
  | { ok: false; error: string; raw?: any; provider: P6Provider };

export type P6StatusResult = {
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

// Map slot label → app_settings key name.
function slotToSettingKey(slot: P6Slot): string {
  return `p6_key_${slot.slice(3)}`; // p6-a → "p6_key_a"
}

// Look up the API key for a given p6-x slot. Returns "" if not set.
export async function getP6KeyForSlot(slot: P6Slot): Promise<string> {
  const k = slotToSettingKey(slot);
  const s = await getSettings([k]);
  return String((s as any)[k]?.key || "").trim();
}

// Read all 8 keys at once (for admin UI / debugging).
export async function getAllP6Keys(): Promise<Record<P6Slot, string>> {
  const settingKeys = P6_SLOTS.map(slotToSettingKey);
  const s = await getSettings(settingKeys);
  const out: any = {};
  for (const slot of P6_SLOTS) {
    out[slot] = String((s as any)[slotToSettingKey(slot)]?.key || "").trim();
  }
  return out as Record<P6Slot, string>;
}

// Sora 2 prompt transform.
//
// Veo's `Spoken dialog: '...'` inline format does NOT register as a
// dialogue cue for Sora 2 — Sora interprets it as descriptive prose
// and renders the video with NO audio (mouth moves, silent track).
// OpenAI's official Sora 2 guide (baked into qa-knowledge.ts under
// SORA2_KNOWLEDGE) specifies a labelled block format:
//
//   Dialogue:
//   - Woman: "Korang tau tak ni apa? ..."
//
//   Background Sound:
//   ambient room tone, soft fabric rustle
//
// Per user direction we ONLY swap the dialog block — every other lock
// (CLEAN FRAME, ANATOMY, AUDIO, HIJAB, MODESTY, Negative, etc.) stays
// in place because they don't break audio for Sora 2 in practice, and
// keeping them parallel to Veo lets the same scene description work
// across both engines without divergence.
//
// Detection: matches the Veo conventions emitted by buildVeoLocks and
// the auto-content/agent-* prompt builders:
//   - "Spoken dialog: '..."'  (single or double quotes)
//   - "Spoken dialog: \"...\"" (escaped)
//   - "Character says: '...'" (auto-content variant)
//   - "Spoken voiceover: '...'" (PRD framework voiceover variant)
// Speaker label is inferred from the prompt's persona hints (Malay man
// / Malay woman) — defaults to "Speaker" for ambiguous prompts.
function transformPromptForSora2(prompt: string): string {
  const isMale = /\b(malay\s+)?(man|male|boy|bapak|ayah|pak\s+cik)\b/i.test(prompt);
  const isFemale = /\b(malay\s+)?(woman|female|girl|wanita|nenek|mak\s+cik|kakak)\b/i.test(prompt);
  const speaker = isMale && !isFemale ? "Man" : isFemale ? "Woman" : "Speaker";

  // Capture the dialog text after one of the recognised cue phrases.
  // Stop at the closing quote — Veo conventions always wrap dialog in
  // a single pair of matching quotes on the same line.
  const dialogRegex =
    /(Spoken dialog|Spoken voiceover|Character says|She says|He says)\s*:\s*['"‘’“”]([^'"‘’“”]+)['"‘’“”]/i;

  const match = prompt.match(dialogRegex);
  if (!match) {
    // No dialog cue found — most likely a silent/atmospheric Sora 2
    // shot. Append just a Background Sound rhythm cue so the audio
    // track isn't dead silent (per OpenAI guide recommendation).
    return `${prompt}\n\nBackground Sound:\nambient room tone, soft fabric rustle`;
  }

  const dialogText = match[2].trim();
  const block = `Dialogue:\n- ${speaker}: "${dialogText}"\n\nBackground Sound:\nambient room tone, soft fabric rustle`;

  // Replace ONLY the matched dialog line — keep every other lock,
  // negative, and structural element exactly as the upstream prompt
  // builder emitted them.
  return prompt.replace(dialogRegex, block);
}

// Map cascade video model strings → APIPod's catalog names. Per
// APIPod docs the model IDs are mode-specific:
//   • Veo 3.1 Fast
//       - veo3-1-fast       : t2v OR start/end frame (max 2 image_urls)
//       - veo3-1-fast-ref   : reference mode (1-3 image_urls)
//   • Grok Imagine
//       - grok-imagine-t2v  : no image_urls
//       - grok-imagine-i2v  : 1-7 image_urls
//   • Seedance 2.0 Fast
//       - seedance-2.0-fast-t2v : text only
//       - seedance-2.0-fast-i2v : single start-frame image (frame)
//       - seedance-2.0-mini-r2v : 1-3 reference images (ingredient) — the
//         variant used by Storyboard→Video + Original Video (2026-07-17)
function apipodVideoModel(input: {
  model?: string;
  imageMode?: "frame" | "ingredient" | "text";
  imageUrls?: string[];
  refVideoUrl?: string;
}): string {
  const m = (input.model || "").toLowerCase();
  const refs = input.imageUrls?.length || 0;
  const mode = input.imageMode || (refs > 0 ? "ingredient" : "text");

  // Sora 2 (sora-2-vip) — single fixed model name, no t2v/i2v variant
  // split. APIPod's endpoint accepts image_url for first-frame or omits
  // it for pure text mode. Aspect ratio enforced at request body level.
  if (m.includes("sora")) {
    return "sora-2-vip";
  }

  // Grok Imagine 1.5 Preview — frame-only i2v. Replaces the legacy
  // grok-imagine-t2v / -i2v variants entirely (per user direction
  // 2026-06-08). Single image_url (string, NOT array) is MANDATORY per
  // APIPod spec. Aspect_ratio enum: 1:1 / 2:3 / 3:2 / 9:16 / 16:9.
  // Duration: 1-15 (default 10), resolution fixed at 720p. Any input
  // model string matching "grok" maps here so legacy callers stay wired.
  if (m.includes("grok")) {
    return "grok-imagine-1.5-preview";
  }

  if (m.includes("seedance")) {
    if (refs === 0 || mode === "text") return "seedance-2.0-fast-t2v";
    if (mode === "frame") return "seedance-2.0-fast-i2v";
    // Reference-to-video (ingredient) uses the MINI model per user direction
    // 2026-07-17. This is the variant Storyboard→Video and Original Video both
    // hit (both send ingredient-mode refs).
    return "seedance-2.0-mini-r2v";
  }

  // Gemini Omni — APIPod splits into:
  //   • gemini-omni-i2v : image_urls 1-2 (first frame required + optional
  //     last frame). Serves BOTH the tab's "frame" mode (true start-frame)
  //     and "ingredient" mode (refs ride the same endpoint).
  //   • gemini-omni-t2v : pure text prompt, no image_urls
  // Duration fixed at 10s, aspect 9:16 | 16:9.
  if (m.includes("gemini")) {
    // Video Reference → gemini-omni-extend (source video_url, no images).
    if (input.refVideoUrl) return "gemini-omni-extend";
    return refs > 0 && mode !== "text" ? "gemini-omni-i2v" : "gemini-omni-t2v";
  }

  // Veo: ingredient (character/style refs) → -ref; frame or text → base.
  if (refs > 0 && mode === "ingredient") return "veo3-1-fast-ref";
  return "veo3-1-fast";
}

// Map cascade image model strings → APIPod's catalog names. Per
// APIPod docs:
//   • gpt-image-2       → text-to-image
//   • gpt-image-2-edit  → image-to-image edit (requires image_urls)
//   • nano-banana-pro   → up to 8 reference images
//   • nano-banana-2     → up to 14 reference images
function apipodImageModel(model: string | undefined, hasImages: boolean): string {
  const m = (model || "").toLowerCase();
  if (m.includes("gpt-image")) {
    return hasImages ? "gpt-image-2-edit" : "gpt-image-2";
  }
  if (m === "nano-banana-pro" || m === "google/nano-banana-pro") return "nano-banana-pro";
  if (m === "nano-banana-2" || m === "google/nano-banana-2") return "nano-banana-2";
  return "nano-banana-pro";
}

async function p6Fetch(
  method: "POST" | "GET",
  path: string,
  apiKey: string,
  body?: any
): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(P6_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

// Submit a video task with the key configured for the given slot.
// Returns "p6_key_x not configured" if the slot's key is empty, which
// trips the cascade to the next slot.
export async function p6CreateVideo(input: {
  slot: P6Slot;
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageUrls?: string[];
  imageMode?: "frame" | "ingredient" | "text";
  durationMode?: string | number;
  // GeminiOmni "Video Reference" — a source/reference video URL. Routes to
  // APIPod's gemini-omni-extend (video_url required, no images).
  refVideoUrl?: string;
}): Promise<P6CreateResult> {
  const apiKey = await getP6KeyForSlot(input.slot);
  if (!apiKey) {
    return { ok: false, error: `${slotToSettingKey(input.slot)} not configured`, provider: "p6" };
  }
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const resolvedModel = apipodVideoModel({
    model: input.model,
    imageMode: input.imageMode,
    refVideoUrl: input.refVideoUrl,
    imageUrls: refs,
  });
  // Per-model prompt cap.
  // - Grok keeps 4000 chars (APIPod's documented Grok hard limit).
  // - Veo / Seedance use 4000 chars — empirically validated against the
  //   user's "best HD" outputs which run at ~4,500 chars and still
  //   produce crisp audio + clean framing. The earlier 3000 cap was
  //   conservative based on MindStudio's 2,000-char attention window
  //   spec, but the OPENING RAW UNEDITED FOOTAGE block + per-lock
  //   reinforcement push useful prompts to ~3,500-3,800 chars and
  //   Veo handles them fine. Cap stays at 4000 to leave headroom for
  //   the LSL (long Negative) list at the end.
  const promptCap = 4000;

  // Sora 2 audio fix: APIPod's sora-2-vip needs OpenAI's documented
  // Dialogue: block + Background Sound: block — NOT Veo's inline
  // `Spoken dialog: '...'` convention. Without the conversion, Sora 2
  // sees dialog as descriptive prose and renders silent video (mouth
  // moves, no audio). Conversion only runs for sora-2-vip; every other
  // model path receives the prompt unchanged.
  const promptForApi =
    resolvedModel === "sora-2-vip"
      ? transformPromptForSora2(input.prompt)
      : input.prompt;

  const body: any = {
    model: resolvedModel,
    prompt: promptForApi.slice(0, promptCap),
    aspect_ratio: input.aspectRatio || "9:16",
  };

  // Sora 2 uses image_url (singular, string) NOT image_urls (array).
  // Aspect_ratio enum restricted to 9:16 / 16:9 only — clamp if other.
  if (resolvedModel === "sora-2-vip") {
    if (body.aspect_ratio !== "9:16" && body.aspect_ratio !== "16:9") {
      body.aspect_ratio = "9:16";
    }
    if (refs.length > 0) {
      body.image_url = refs[0]; // single first-frame image
    }
    // Sora 2 duration enum — client UI exposes 8 / 12 only (4 removed
    // per user direction as too short for useful UGC). APIPod still
    // technically accepts 4 but we never send it.
    const reqDur = Number(input.durationMode);
    body.duration = reqDur === 12 ? 12 : 8;
  } else if (resolvedModel === "grok-imagine-1.5-preview") {
    // Grok Imagine 1.5 Preview — image_url is MANDATORY (singular string,
    // not array). Aspect_ratio enum: 1:1 / 2:3 / 3:2 / 9:16 / 16:9 — clamp
    // anything else to 16:9 (the APIPod default). Duration 1-15 default 10.
    // Resolution fixed at 720p.
    const allowedAspects = new Set(["1:1", "2:3", "3:2", "9:16", "16:9"]);
    if (!allowedAspects.has(String(body.aspect_ratio))) {
      body.aspect_ratio = "16:9";
    }
    if (refs.length === 0) {
      return {
        ok: false,
        error: "grok-imagine-1.5-preview requires a reference image",
        provider: "p6",
      };
    }
    body.image_url = refs[0]; // singular field per APIPod spec
    const reqDur = Number(input.durationMode);
    body.duration =
      Number.isFinite(reqDur) && reqDur >= 1 && reqDur <= 15
        ? Math.round(reqDur)
        : 10;
    body.resolution = "720p";
  } else if (resolvedModel === "gemini-omni-extend") {
    // GeminiOmni Video Reference — source/reference VIDEO + optional product
    // reference images (1-5) so the output replicates the reference video
    // but features the user's product. APIPod gemini-omni-extend:
    // video_url REQUIRED, image_urls optional (1-5), aspect 16:9|9:16,
    // resolution 720p|1080p, NO duration (output follows source, cap 10s).
    if (!input.refVideoUrl) {
      return { ok: false, error: "gemini-omni-extend requires a reference video", provider: "p6" };
    }
    body.video_url = input.refVideoUrl;
    if (refs.length > 0) body.image_urls = refs.slice(0, 5);
  } else if (refs.length > 0) {
    // Per-model image_urls cap per APIPod docs:
    //   • veo3-1-fast             → up to 2 (start + end frame)
    //   • veo3-1-fast-ref         → up to 3 (reference images)
    //   • seedance-2.0-fast-i2v   → 1-2  (start + end frame)
    //   • seedance-2.0-*-r2v      → 0-9  (reference images; fast or mini)
    //   • gemini-omni-i2v         → 1-2 (first frame + optional last frame,
    //     per the current APIPod Gemini Omni Image-to-Video doc)
    let cap = 2;
    if (resolvedModel === "seedance-2.0-fast-i2v") cap = 2;
    else if (resolvedModel.endsWith("-r2v")) cap = 9; // fast OR mini r2v
    else if (resolvedModel === "veo3-1-fast-ref") cap = 3;
    else if (resolvedModel === "veo3-1-fast") cap = 2;
    else if (resolvedModel === "gemini-omni-i2v") cap = 2;
    body.image_urls = refs.slice(0, cap);
  }

  // Per-model optional fields per APIPod docs:
  //   • seedance-* : duration 4-15 (required)
  //   • grok-imagine-1.5-preview : duration 1-15 (default 10), 720p only —
  //     handled fully in its own branch above (image_url mandatory).
  //   • veo3-1-fast / -ref : no duration / no resolution accepted — we
  //     do NOT pass either field. APIPod was empirically returning 6s
  //     files for Veo, but the duration:8/resolution:720p attempt was
  //     reverted per user direction (preempt potential APIPod rejection).
  //     Veo's effective length is governed by the DIALOG LENGTH LOCK
  //     in buildVeoLocks — keep the 20-24 word lock in place so the
  //     model self-pads to 8s through dialog pacing instead.
  if (resolvedModel.startsWith("seedance")) {
    const reqDur = Number(input.durationMode);
    body.duration =
      Number.isFinite(reqDur) && reqDur >= 4 && reqDur <= 15
        ? Math.round(reqDur)
        : 5;
  } else if (resolvedModel === "gemini-omni-extend") {
    // Video Reference / extend — NO duration field (output follows the
    // source, capped 10s). Resolution fixed 1080p per user direction;
    // aspect enum 16:9 | 9:16.
    body.resolution = "1080p";
    if (body.aspect_ratio !== "9:16" && body.aspect_ratio !== "16:9") {
      body.aspect_ratio = "9:16";
    }
  } else if (resolvedModel.startsWith("gemini-omni")) {
    // Gemini Omni i2v / t2v — APIPod docs: duration always 10, resolution
    // enum lowercase "720p" | "1080p". aspect_ratio enum 16:9 | 9:16 —
    // clamp if caller passed something else.
    body.duration = 10;
    body.resolution = "720p";
    if (body.aspect_ratio !== "9:16" && body.aspect_ratio !== "16:9") {
      body.aspect_ratio = "9:16";
    }
  }

  const { ok, status, data } = await p6Fetch("POST", "/v1/videos/generations", apiKey, body);
  if (!ok || (data?.code && data.code !== 200)) {
    const err =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `APIPod HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p6" };
  }
  const taskId = data?.data?.task_id || data?.task_id;
  if (!taskId) {
    return { ok: false, error: "APIPod returned no task_id", raw: data, provider: "p6" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p6" };
}

// Submit an image task with the key configured for the given slot.
// Same auth + status pattern as video, just different endpoint and
// model-name mapping.
export async function p6CreateImage(input: {
  slot: P6Slot;
  prompt: string;
  model?: string;
  aspectRatio?: string;
  imageUrls?: string[];
  quality?: "1K" | "2K" | "4K";
}): Promise<P6CreateResult> {
  const apiKey = await getP6KeyForSlot(input.slot);
  if (!apiKey) {
    return { ok: false, error: `${slotToSettingKey(input.slot)} not configured`, provider: "p6" };
  }
  const refs = (input.imageUrls || []).filter((u) => typeof u === "string" && u.trim());
  const resolvedModel = apipodImageModel(input.model, refs.length > 0);
  const body: any = {
    model: resolvedModel,
    prompt: input.prompt.slice(0, 4000),
    aspect_ratio: input.aspectRatio || "1:1",
    quality: input.quality || "2K",
  };

  // Per-model image_urls cap per APIPod docs:
  //   • gpt-image-2-edit  → at least 1 required
  //   • nano-banana-pro   → up to 8
  //   • nano-banana-2     → up to 14
  if (refs.length > 0) {
    const cap = resolvedModel === "nano-banana-2" ? 14 : 8;
    body.image_urls = refs.slice(0, cap);
  }

  const { ok, status, data } = await p6Fetch("POST", "/v1/images/generations", apiKey, body);
  if (!ok || (data?.code && data.code !== 200)) {
    const err =
      data?.error?.message ||
      data?.message ||
      data?.error ||
      `APIPod HTTP ${status}`;
    return { ok: false, error: String(err), raw: data, provider: "p6" };
  }
  const taskId = data?.data?.task_id || data?.task_id;
  if (!taskId) {
    return { ok: false, error: "APIPod returned no task_id", raw: data, provider: "p6" };
  }
  return { ok: true, task_id: String(taskId), raw: data, provider: "p6" };
}

// Poll task status with the key that submitted it. slot is the
// stamped metadata.slot from the history row. `assetKind` picks
// between /v1/videos/status/ (default) and /v1/images/status/.
export async function p6GetStatus(
  taskId: string,
  slot?: P6Slot,
  assetKind: "video" | "image" = "video"
): Promise<P6StatusResult> {
  const pollPath = assetKind === "image"
    ? `/v1/images/status/${encodeURIComponent(taskId)}`
    : `/v1/videos/status/${encodeURIComponent(taskId)}`;
  // If slot is known (from metadata), poll with that key directly.
  if (slot) {
    const apiKey = await getP6KeyForSlot(slot);
    if (apiKey) {
      return pollOnce(pollPath, apiKey);
    }
  }
  // Fallback for legacy rows: walk all configured keys until one
  // returns a meaningful response.
  const all = await getAllP6Keys();
  for (const s of P6_SLOTS) {
    const k = all[s];
    if (!k) continue;
    const r = await pollOnce(pollPath, k);
    if (r.status === "succeeded" || r.status === "failed" || r.status === "running") {
      return r;
    }
  }
  return { status: "pending" };
}

async function pollOnce(pollPath: string, apiKey: string): Promise<P6StatusResult> {
  const { ok, status, data } = await p6Fetch("GET", pollPath, apiKey);
  if (!ok) {
    return {
      status: "pending",
      error: data?.error?.message || `APIPod HTTP ${status}`,
      raw: data,
    };
  }
  const payload = data?.data || data;
  const taskStatus = String(payload?.status || "").toLowerCase();
  if (taskStatus === "completed") {
    const url =
      (Array.isArray(payload?.result) ? payload.result[0] : null) ||
      payload?.result?.url ||
      "";
    if (!url) {
      return { status: "failed", error: "APIPod completed but no result url", raw: data };
    }
    return { status: "succeeded", outputUrl: String(url), raw: data };
  }
  if (taskStatus === "failed" || taskStatus === "cancelled") {
    return {
      status: "failed",
      error: payload?.error || `APIPod task ${taskStatus}`,
      raw: data,
    };
  }
  return { status: taskStatus === "processing" ? "running" : "pending", raw: data };
}
