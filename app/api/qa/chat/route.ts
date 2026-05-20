import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";
import { getQAKnowledge, type QATab } from "@/lib/qa-knowledge";
import {
  parseModelSetting,
  providerCreds,
  type ProviderSlot,
} from "@/lib/openrouter";

// POST /api/qa/chat
//
// Pure Q&A chat — replaces the legacy AI-agent tool-call endpoints with a
// scoped knowledge-only assistant. Each request includes:
//   - tab: which tab's knowledge base to use
//   - messages: conversation history [{role: "user"|"assistant", content, images?}]
// The latest user message may include base64-or-https image URLs that the
// model will read and reference in its reply.
//
// The model is fixed to Gemini 3.1 Flash Lite (model_qa setting → fallback
// to model_auto). No tool calls, no JSON schema enforcement — just plain
// text replies, scoped by the tab's system prompt in lib/qa-knowledge.ts.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const tab = String(body?.tab || "ugc") as QATab;
  const validTabs: QATab[] = ["ugc", "auto", "cinema", "seedance", "fairytale", "image", "sora2"];
  if (!validTabs.includes(tab)) {
    return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
  }
  const rawMessages = Array.isArray(body?.messages) ? body.messages : [];
  if (rawMessages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  // Sanitize incoming messages — clamp roles to user/assistant, trim
  // content, cap image count per message at 4 (Gemini limit + safety).
  const messages: ChatMessage[] = rawMessages
    .map((m: any) => {
      const role = m?.role === "assistant" ? "assistant" : "user";
      const content = String(m?.content || "").trim().slice(0, 6000);
      const images = Array.isArray(m?.images)
        ? m.images
            .filter((x: any) => typeof x === "string" && x.trim())
            .slice(0, 4)
        : [];
      return { role, content, images } as ChatMessage;
    })
    .filter((m: ChatMessage) => m.content || (m.images && m.images.length > 0));
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  // Model routing — model_qa cascade (main → fallback → model_auto
  // cascade). Same cascade infrastructure other model knobs use; lets
  // admin configure OpenRouter primary + Grsai fallback (or vice versa)
  // from /admin/settings → Model Routing.
  const s = await getSettings([
    "or_base", "or_key",
    "gr_base", "gr_key",
    "model_qa", "model_auto",
  ]);

  const layers: Array<{ main: ProviderSlot; fallback?: ProviderSlot }> = [];
  const primary = parseModelSetting(s.model_qa);
  if (primary) layers.push(primary);
  const auto = parseModelSetting(s.model_auto);
  if (auto) layers.push(auto);
  // Hard fallback if admin hasn't configured ANY model setting — use
  // a sensible default model on OpenRouter so Q&A stays functional.
  if (layers.length === 0) {
    layers.push({
      main: { provider: "openrouter", model: "google/gemini-flash-1.5-8b" },
    });
  }

  // Compose OpenAI-compat message array. System prompt first, then
  // conversation history with images attached to whatever message
  // they were sent with (typically the latest user turn).
  const systemPrompt = getQAKnowledge(tab);
  const apiMessages: any[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (m.images && m.images.length > 0) {
      const parts: any[] = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      for (const img of m.images) {
        parts.push({ type: "image_url", image_url: { url: img } });
      }
      apiMessages.push({ role: m.role, content: parts });
    } else {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  // Walk the cascade: main → fallback per layer. Returns the first
  // success; bubbles up the last error if every attempt fails.
  let lastError = "All providers exhausted (qa)";
  for (const layer of layers) {
    for (const slot of [layer.main, layer.fallback].filter(Boolean) as ProviderSlot[]) {
      const { base, key } = await providerCreds(slot.provider, s);
      if (!base || !key) {
        lastError = `${slot.provider} not configured`;
        continue;
      }
      try {
        const res = await fetch(`${base}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: slot.model,
            messages: apiMessages,
            temperature: 0.5,
            max_tokens: 1200,
            stream: false,
          }),
        });
        const text = await res.text().catch(() => "");
        let json: any = null;
        try { json = JSON.parse(text); } catch {}
        if (!res.ok || !json) {
          lastError = json?.error?.message || `${slot.provider} HTTP ${res.status}`;
          continue;
        }
        if (json?.error?.message || json?.error?.code) {
          lastError = String(json.error.message || `${slot.provider} error ${json.error.code}`);
          continue;
        }
        const reply = json?.choices?.[0]?.message?.content || "";
        if (!reply) {
          lastError = `${slot.provider} empty completion (${json?.choices?.[0]?.finish_reason || "?"})`;
          continue;
        }
        return NextResponse.json({ ok: true, reply, provider: slot.provider, model: slot.model });
      } catch (e: any) {
        lastError = e?.message || `${slot.provider} network error`;
      }
    }
  }
  return NextResponse.json({ error: lastError }, { status: 502 });
}
