// OpenRouter chat completions helper. Reads base + key + model from
// app_settings so admin can rotate without redeploy.

import { getSettings } from "@/lib/settings";

export async function orChat(opts: {
  modelKey?: "model_auto" | "model_clone" | "model_vision" | "model_retry" | "model_product_ocr";
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
  const model = s[opts.modelKey || "model_auto"]?.model;
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

  return {
    ok: true,
    content: json?.choices?.[0]?.message?.content || "",
    finishReason: json?.choices?.[0]?.finish_reason,
  };
}
