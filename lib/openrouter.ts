// Multi-provider AI chat completions helper. Reads provider + model
// from app_settings so admin can rotate without redeploy. Supports
// cascade fallback per model key — main, then walk every fallback in
// order, then fall through to model_auto's cascade.
//
//   model_X setting shape (v3, current):
//     { main: { provider, model }, fallbacks: [{ provider, model }, ...] }
//
//   Legacy shapes (still accepted for back-compat):
//     { main, fallback: { provider, model } }   v2 — single fallback object
//     { model: "..." }                          v1 — treated as openrouter main
//     { model: "...", provider: "..." }         v1 — that provider's main
//
// Providers:
//   • openrouter (https://openrouter.ai/api/v1)
//   • grsai     (https://grsaiapi.com or https://grsai.dakka.com.cn)
// Both expose the OpenAI-compatible POST /v1/chat/completions endpoint.
// Add a new provider by extending callProvider() below.

import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export type Provider = "openrouter" | "grsai";

// Feature tag for chat_usage rows. Currently only the Custom Idea
// cascade gets logged — add more buckets here as the admin Usage Chat
// tab grows. Tag is stamped at the call site so the admin UI can
// filter by which surface triggered the call.
export type ChatUsageFeature =
  | "ugc_custom_idea"
  | "auto_with_idea"
  | "auto_only";

type CascadeAttempt = {
  provider: Provider;
  model: string;
  ok: boolean;
  error?: string;
  ms: number;
};

// Fire-and-forget chat_usage insert. Runs on the next tick so the
// caller's response isn't blocked on the DB write. Swallows any error
// so a logging failure can never break a Custom Idea generation.
function logChatUsage(opts: {
  feature: ChatUsageFeature;
  modelKey: string;
  userId?: string | null;
  cascadeTrace: CascadeAttempt[];
  succeeded: boolean;
  promptSnippet?: string;
}) {
  setTimeout(() => {
    void (async () => {
      try {
        const admin = createAdminClient();
        const last = opts.cascadeTrace[opts.cascadeTrace.length - 1];
        const totalLatency = opts.cascadeTrace.reduce((a, x) => a + (x.ms || 0), 0);
        await admin.from("chat_usage").insert({
          user_id: opts.userId || null,
          feature: opts.feature,
          model_key: opts.modelKey,
          cascade_trace: opts.cascadeTrace,
          final_provider: opts.succeeded ? last?.provider : null,
          final_model: opts.succeeded ? last?.model : null,
          succeeded: opts.succeeded,
          total_attempts: opts.cascadeTrace.length,
          total_latency_ms: totalLatency,
          prompt_snippet: opts.promptSnippet?.slice(0, 200) || null,
        });
      } catch {
        // Best-effort logging only — never throw out of the cascade.
      }
    })();
  }, 0);
}

export type ProviderSlot = {
  provider: Provider;
  model: string;
};

type ModelSettingValue = {
  // Current shape (v3) — variadic fallbacks array
  main?: ProviderSlot;
  fallbacks?: ProviderSlot[];
  // Older shape (v2) — single fallback object
  fallback?: ProviderSlot;
  // Oldest shape (v1) — bare model string
  model?: string;
  provider?: Provider;
};

export type ParsedModel = {
  main: ProviderSlot;
  fallbacks: ProviderSlot[];
};

// Normalise any historical model_X setting shape into { main, fallbacks[] }.
// Returns null when nothing usable is set so the caller can fall back
// to the next layer in the resolution chain (e.g. model_auto).
//
// Schema evolution:
//   v1 (oldest): { model: "...", provider?: "..." }
//   v2:          { main: {...}, fallback?: {...} }            (single fallback)
//   v3 (now):    { main: {...}, fallbacks: [{...}, {...}, ...] } (variadic)
// All three are accepted on read. Saves write the current schema (v3).
export function parseModelSetting(raw: any): ParsedModel | null {
  if (!raw) return null;
  const v = raw as ModelSettingValue;
  const toSlot = (s: any): ProviderSlot | null =>
    s && s.model
      ? {
          provider: (s.provider === "grsai" ? "grsai" : "openrouter") as Provider,
          model: String(s.model),
        }
      : null;

  // v3 / v2: main present
  if (v.main && v.main.model) {
    const main: ProviderSlot = {
      provider: (v.main.provider === "grsai" ? "grsai" : "openrouter") as Provider,
      model: String(v.main.model),
    };
    const fallbacks: ProviderSlot[] = [];
    if (Array.isArray(v.fallbacks)) {
      for (const f of v.fallbacks) {
        const s = toSlot(f);
        if (s) fallbacks.push(s);
      }
    }
    // v2 single fallback — keep it when v.fallbacks array is absent
    const legacyFb = toSlot(v.fallback);
    if (legacyFb && fallbacks.length === 0) fallbacks.push(legacyFb);
    return { main, fallbacks };
  }

  // v1 legacy bare model
  if (v.model) {
    return {
      main: {
        provider: (v.provider === "grsai" ? "grsai" : "openrouter") as Provider,
        model: String(v.model),
      },
      fallbacks: [],
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
    // Reuse the existing p4_key — p4 is already the Grsai image-gen
    // client (see lib/p4.ts) so admin doesn't need to manage two keys
    // for the same provider. Base URL must include the /v1 prefix —
    // Grsai's chat endpoint is https://grsaiapi.com/v1/chat/completions
    // (verified via the Usage Chat log: requests without /v1 returned
    // HTTP 404 across every model so the cascade always fell through
    // to OpenRouter). The .cn mirror exists but our Vercel egress is
    // geofenced out of China so we'd never use it.
    return {
      base: "https://grsaiapi.com/v1",
      key: String(cache.p4_key?.key || ""),
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
    // Editor tab's Generate Text ONLY. Deliberately its own slot so tuning
    // the Editor's copywriting model can't disturb Auto UGC / Auto Content,
    // which share model_custom_idea. Falls back to model_custom_idea when
    // admin hasn't set it.
    | "model_editor_text"
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
  /** Tag for the admin Usage Chat log. When set, every cascade attempt
   *  is captured and written to chat_usage so admin can see how often
   *  each fallback layer is being hit. */
  logFeature?: ChatUsageFeature;
  logUserId?: string | null;
}): Promise<{ ok: boolean; content?: string; finishReason?: string; error?: string }> {
  const requestedKey = opts.modelKey || "model_auto";
  // Fetch all 4 credential keys + the requested model key + model_auto
  // fallback in ONE round-trip. getSettings batches these via cache.
  const fetchKeys = ["or_base", "or_key", "p4_key", requestedKey];
  if (requestedKey !== "model_auto") fetchKeys.push("model_auto");
  // model_editor_text is an OPT-IN override. When admin hasn't set it the
  // Editor must behave exactly as before — i.e. fall through to
  // model_custom_idea, not straight to model_auto.
  if (requestedKey === "model_editor_text") fetchKeys.push("model_custom_idea");
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
  // layer parses to {main, fallbacks[]}. The first non-null layer drives
  // the cascade. Returns the first call that succeeds, otherwise the
  // last error message we saw.
  const layers: ParsedModel[] = [];
  const primary = parseModelSetting(s[requestedKey]);
  if (primary) layers.push(primary);
  // Editor slot unset (or set and every attempt failed) → fall through to the
  // shared copywriting slot before the universal model_auto.
  if (requestedKey === "model_editor_text") {
    const shared = parseModelSetting(s["model_custom_idea"]);
    if (shared) layers.push(shared);
  }
  if (requestedKey !== "model_auto") {
    const auto = parseModelSetting(s["model_auto"]);
    if (auto) layers.push(auto);
  }
  if (layers.length === 0) {
    return { ok: false, error: "No model configured (model_auto empty)" };
  }

  // Walk the layers in order, trying main → fallbacks[0] → fallbacks[1]
  // → ... on each layer. Stop at the first success. If every attempt
  // fails return the last error so the caller surfaces something concrete.
  let lastError = "All providers exhausted";
  const trace: CascadeAttempt[] = [];
  for (const layer of layers) {
    const chain: ProviderSlot[] = [layer.main, ...layer.fallbacks];
    for (const slot of chain) {
      const { base, key } = await providerCreds(slot.provider, s);
      const t0 = Date.now();
      const r = await callProvider({
        provider: slot.provider,
        model: slot.model,
        systemPrompt: opts.systemPrompt,
        userPrompt: opts.userPrompt,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        base, key,
      });
      trace.push({
        provider: slot.provider,
        model: slot.model,
        ok: r.ok,
        error: r.ok ? undefined : r.error,
        ms: Date.now() - t0,
      });
      if (r.ok) {
        if (opts.logFeature) {
          logChatUsage({
            feature: opts.logFeature,
            modelKey: requestedKey,
            userId: opts.logUserId,
            cascadeTrace: trace,
            succeeded: true,
            promptSnippet: opts.userPrompt,
          });
        }
        return r;
      }
      lastError = r.error || lastError;
    }
  }
  if (opts.logFeature) {
    logChatUsage({
      feature: opts.logFeature,
      modelKey: requestedKey,
      userId: opts.logUserId,
      cascadeTrace: trace,
      succeeded: false,
      promptSnippet: opts.userPrompt,
    });
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
  const fetchKeys = ["or_base", "or_key", "p4_key", requestedKey];
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

  const layers: ParsedModel[] = [];
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
    const chain: ProviderSlot[] = [layer.main, ...layer.fallbacks];
    for (const slot of chain) {
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
