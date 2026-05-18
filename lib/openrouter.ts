// OpenRouter chat completions helper. Reads base + key + model from
// app_settings so admin can rotate without redeploy.

import { getSettings } from "@/lib/settings";

export async function orChat(opts: {
  modelKey?: "model_auto" | "model_clone" | "model_vision" | "model_retry" | "model_product_ocr";
  /** Bypass app_settings entirely and use this exact model id.
   *  Callers with a specific model in mind (e.g. Storytelling script
   *  gen using its own storytelling_script_model setting) pass this
   *  to avoid wiring a new modelKey enum value for every dedicated
   *  caller. */
  modelOverride?: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ ok: boolean; content?: string; finishReason?: string; error?: string }> {
  const s = await getSettings([
    "or_base",
    "or_key",
    opts.modelKey || "model_auto",
  ]);
  const base = s.or_base?.url;
  const key = s.or_key?.key;
  const model = opts.modelOverride || s[opts.modelKey || "model_auto"]?.model;
  if (!base || !key || !model) {
    return { ok: false, error: "OpenRouter not configured" };
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 4000,
      stream: false,
    }),
  });

  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch {}

  if (!res.ok || !json) {
    return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
  }

  // OpenRouter sometimes returns HTTP 200 with `error: { message: ... }`
  // at the top of the body when an upstream provider (Qwen, etc.) fails
  // mid-stream. In that case choices is empty/missing and we'd treat it
  // as success with empty content downstream. Detect + surface as a
  // real error so the caller's retry logic kicks in.
  if (json?.error?.message || json?.error?.code) {
    return {
      ok: false,
      error: String(json.error.message || `Provider error code ${json.error.code}`),
    };
  }
  const content = json?.choices?.[0]?.message?.content || "";
  if (!content) {
    return {
      ok: false,
      error: `Empty completion (finish_reason=${json?.choices?.[0]?.finish_reason || "unknown"})`,
    };
  }

  return {
    ok: true,
    content,
    finishReason: json?.choices?.[0]?.finish_reason,
  };
}

// Multimodal vision call. Pass an array of image URLs (data: URLs OR public
// URLs both work). OpenRouter follows OpenAI's image_url content-block shape.
// Used by Clone (frame analysis) and Product OCR.
//
// `modelOverride` bypasses app_settings entirely — use this when the
// caller has a specific model in mind (e.g. scrape-rank pins Gemini
// Flash Lite regardless of what's set in admin).
export async function orChatVision(opts: {
  modelKey?: "model_clone" | "model_vision" | "model_product_ocr" | "model_auto";
  modelOverride?: string;
  systemPrompt: string;
  textPrompt: string;
  images: string[]; // data: URLs or https URLs
  temperature?: number;
  maxTokens?: number;
}): Promise<{ ok: boolean; content?: string; finishReason?: string; error?: string }> {
  const s = await getSettings([
    "or_base",
    "or_key",
    opts.modelKey || "model_clone",
  ]);
  const base = s.or_base?.url;
  const key = s.or_key?.key;
  const model = opts.modelOverride || s[opts.modelKey || "model_clone"]?.model;
  if (!base || !key || !model) {
    return { ok: false, error: "OpenRouter not configured" };
  }

  const content: any[] = [{ type: "text", text: opts.textPrompt }];
  for (const img of opts.images) {
    if (img) content.push({ type: "image_url", image_url: { url: img } });
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content },
      ],
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 4000,
      stream: false,
    }),
  });

  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}

  if (!res.ok || !json) {
    return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
  }

  // Same 200-with-error-in-body handling as orChat above. OpenRouter
  // wraps upstream provider failures this way even on HTTP 200.
  if (json?.error?.message || json?.error?.code) {
    return {
      ok: false,
      error: String(json.error.message || `Provider error code ${json.error.code}`),
    };
  }
  const visionContent = json?.choices?.[0]?.message?.content || "";
  if (!visionContent) {
    return {
      ok: false,
      error: `Empty completion (finish_reason=${json?.choices?.[0]?.finish_reason || "unknown"})`,
    };
  }

  return {
    ok: true,
    content: visionContent,
    finishReason: json?.choices?.[0]?.finish_reason,
  };
}
