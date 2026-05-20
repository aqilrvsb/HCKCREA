// Multi-provider AI chat completions helper. Reads provider + model
// from app_settings so admin can rotate without redeploy. Supports
// cascade fallback per model key:
//
//   model_X setting shape (new):
//     { main: { provider, model }, fallback?: { provider, model } }
//
//   Legacy shape (still accepted for back-compat):
//     { model: "..." }                    → treated as openrouter main
//     { model: "...", provider: "..." }   → treated as that provider's main
//
// Providers:
//   • openrouter (https://openrouter.ai/api/v1)
//   • grsai     (https://grsaiapi.com or https://grsai.dakka.com.cn)
// Both expose the OpenAI-compatible POST /v1/chat/completions endpoint.
// Add a new provider by extending callProvider() below.

import { getSettings } from "@/lib/settings";

export type Provider = "openrouter" | "grsai";

export type ProviderSlot = {
  provider: Provider;
  model: string;
};

type ModelSettingValue = {
  // New shape
  main?: ProviderSlot;
  fallback?: ProviderSlot;
  // Legacy shape (back-compat)
  model?: string;
  provider?: Provider;
};

// Parse any historical model_X setting shape into a normalised
// { main, fallback? } tuple. Returns null when nothing usable is set
// so the caller can fall back to the next layer in the resolution chain.
export function parseModelSetting(raw: any): { main: ProviderSlot; fallback?: ProviderSlot } | null {
  if (!raw) return null;
  const v = raw as ModelSettingValue;
  // New shape — { main: { provider, model }, fallback?: {...} }
  if (v.main && v.main.model) {
    return {
      main: {
        provider: (v.main.provider || "openrouter") as Provider,
        model: String(v.main.model),
      },
      fallback:
        v.fallback && v.fallback.model
          ? {
              provider: (v.fallback.provider || "openrouter") as Provider,
              model: String(v.fallback.model),
            }
          : undefined,
    };
  }
  // Legacy shape — { model: "...", provider?: "..." }
  if (v.model) {
    return {
      main: {
        provider: (v.provider || "openrouter") as Provider,
        model: String(v.model),
      },
    };
  }
  return null;
}

// Fire a single provider call. Same OpenAI-compatible body across
// providers — only base URL + auth header changes. Returns { ok,
// content, error } so the cascade can decide whether to fall through.
async function callProvider(opts: {
  provider: Provider;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  // Vision-mode: when passed, replaces the user message with a
  // multimodal content array (text + image_url parts). Both providers
  // use OpenAI's image_url content-block shape.
  images?: string[];
  textPrompt?: string;
  base: string;
  key: string;
}): Promise<{ ok: boolean; content?: string; finishReason?: string; error?: string }> {
  if (!opts.base || !opts.key || !opts.model) {
    return { ok: false, error: `${opts.provider} not configured` };
  }
  const messages: any[] = [{ role: "system", content: opts.systemPrompt }];
  if (opts.images && opts.images.length > 0) {
    const content: any[] = [{ type: "text", text: opts.textPrompt ?? opts.userPrompt }];
    for (const img of opts.images) {
      if (img) content.push({ type: "image_url", image_url: { url: img } });
    }
    messages.push({ role: "user", content });
  } else {
    messages.push({ role: "user", content: opts.userPrompt });
  }

  let res: Response;
  try {
    res = await fetch(`${opts.base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        temperature: opts.temperature ?? 0.8,
        max_tokens: opts.maxTokens ?? 4000,
        stream: false,
      }),
    });
  } catch (e: any) {
    return { ok: false, error: `${opts.provider} network error: ${e?.message || "fetch failed"}` };
  }
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok || !json) {
    return { ok: false, error: json?.error?.message || `${opts.provider} HTTP ${res.status}` };
  }
  // OpenRouter (and Grsai) sometimes return HTTP 200 with an error
  // object in the body when an upstream provider fails mid-stream.
  if (json?.error?.message || json?.error?.code) {
    return {
      ok: false,
      error: String(json.error.message || `${opts.provider} provider error code ${json.error.code}`),
    };
  }
  const c = json?.choices?.[0]?.message?.content || "";
  if (!c) {
    return {
      ok: false,
      error: `${opts.provider} empty completion (finish_reason=${json?.choices?.[0]?.finish_reason || "unknown"})`,
    };
  }
  return { ok: true, content: c, finishReason: json?.choices?.[0]?.finish_reason };
}

// Look up the {base, key} pair for a given provider. Returns empty
// strings when the provider isn't configured so callProvider's gate
// can surface a clean "not configured" error.
export async function providerCreds(
  provider: Provider,
  cache: Record<string, any>
): Promise<{ base: string; key: string }> {
  if (provider === "openrouter") {
    return {
      base: String(cache.or_base?.url || ""),
      key: String(cache.or_key?.key || ""),
    };
  }
  if (provider === "grsai") {
    return {
      base: String(cache.gr_base?.url || "https://grsaiapi.com"),
      key: String(cache.gr_key?.key || ""),
    };
  }
  return { base: "", key: "" };
}

export async function orChat(opts: {
  // Per-feature model keys. Admin can configure each one independently
  // in /admin/settings, OR leave them empty to fall back to model_auto.
  // The five user-facing buckets:
  //   model_qa          → Q&A chat panel on every tab
  //   model_custom_idea → UGC Custom Idea expansion + Auto Content master plan
  //   model_viral       → Viral Talking Object scene + prompt builder
  //   model_clone       → Clone tab text generation
  //   storytelling_script_model → Storytelling 12-scene JSON (uses modelOverride, not modelKey)
  // Plus internal keys that don't need admin UI:
  //   model_auto        → universal fallback when a specific key is empty
  //   model_product_ocr → product label OCR (vision)
  //   model_vision      → generic vision tasks
  //   model_retry       → failed-prompt retry path
  modelKey?:
    | "model_auto"
    | "model_clone"
    | "model_vision"
    | "model_retry"
    | "model_product_ocr"
    | "model_qa"
    | "model_custom_idea"
    | "model_viral";
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
  const requestedKey = opts.modelKey || "model_auto";
  // Fetch all 4 credential keys + the requested model key + model_auto
  // fallback in ONE round-trip. getSettings batches these via cache.
  const fetchKeys = ["or_base", "or_key", "gr_base", "gr_key", requestedKey];
  if (requestedKey !== "model_auto") fetchKeys.push("model_auto");
  const s = await getSettings(fetchKeys);

  // modelOverride bypasses cascade entirely (legacy callers).
  if (opts.modelOverride) {
    const { base, key } = await providerCreds("openrouter", s);
    return callProvider({
      provider: "openrouter",
      model: opts.modelOverride,
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.userPrompt,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      base, key,
    });
  }

  // Resolution chain: per-feature setting → model_auto fallback. Each
  // layer parses to {main, fallback?}. The first non-null layer drives
  // the cascade. Returns the first call that succeeds, otherwise the
  // last error message we saw.
  const layers: Array<{ main: ProviderSlot; fallback?: ProviderSlot }> = [];
  const primary = parseModelSetting(s[requestedKey]);
  if (primary) layers.push(primary);
  if (requestedKey !== "model_auto") {
    const auto = parseModelSetting(s["model_auto"]);
    if (auto) layers.push(auto);
  }
  if (layers.length === 0) {
    return { ok: false, error: "No model configured (model_auto empty)" };
  }

  // Walk the layers in order, trying main then fallback on each.
  // Stop at the first success. If every attempt fails return the
  // last error so the caller surfaces something concrete.
  let lastError = "All providers exhausted";
  for (const layer of layers) {
    for (const slot of [layer.main, layer.fallback].filter(Boolean) as ProviderSlot[]) {
      const { base, key } = await providerCreds(slot.provider, s);
      const r = await callProvider({
        provider: slot.provider,
        model: slot.model,
        systemPrompt: opts.systemPrompt,
        userPrompt: opts.userPrompt,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        base, key,
      });
      if (r.ok) return r;
      lastError = r.error || lastError;
    }
  }
  return { ok: false, error: lastError };
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
  const requestedKey = opts.modelKey || "model_clone";
  const fetchKeys = ["or_base", "or_key", "gr_base", "gr_key", requestedKey];
  if (requestedKey !== "model_auto") fetchKeys.push("model_auto");
  const s = await getSettings(fetchKeys);

  if (opts.modelOverride) {
    const { base, key } = await providerCreds("openrouter", s);
    return callProvider({
      provider: "openrouter",
      model: opts.modelOverride,
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.textPrompt,
      images: opts.images,
      textPrompt: opts.textPrompt,
      temperature: opts.temperature ?? 0.5,
      maxTokens: opts.maxTokens ?? 4000,
      base, key,
    });
  }

  const layers: Array<{ main: ProviderSlot; fallback?: ProviderSlot }> = [];
  const primary = parseModelSetting(s[requestedKey]);
  if (primary) layers.push(primary);
  if (requestedKey !== "model_auto") {
    const auto = parseModelSetting(s["model_auto"]);
    if (auto) layers.push(auto);
  }
  if (layers.length === 0) {
    return { ok: false, error: "No vision model configured" };
  }

  let lastError = "All providers exhausted (vision)";
  for (const layer of layers) {
    for (const slot of [layer.main, layer.fallback].filter(Boolean) as ProviderSlot[]) {
      const { base, key } = await providerCreds(slot.provider, s);
      const r = await callProvider({
        provider: slot.provider,
        model: slot.model,
        systemPrompt: opts.systemPrompt,
        userPrompt: opts.textPrompt,
        images: opts.images,
        textPrompt: opts.textPrompt,
        temperature: opts.temperature ?? 0.5,
        maxTokens: opts.maxTokens ?? 4000,
        base, key,
      });
      if (r.ok) return r;
      lastError = r.error || lastError;
    }
  }
  return { ok: false, error: lastError };
}
