// Per-tab AI agent orchestrator — OpenAI-compatible tool-use loop using
// DeepSeek V4 Pro via OpenRouter (configured in app_settings).
//
// Each tab (image / ugc / cinema) defines its own:
//   • system prompt (knowledge baked in)
//   • tool registry (only relevant tools)
//   • initial state shape (e.g. UGC keeps current_product_ref, voice, persona)
//
// The orchestrator handles:
//   • Conversation persistence per (user, project, tab)
//   • Vision routing — user-uploaded images get described by gemini-2.5-flash
//     before DeepSeek plans tools (DeepSeek is text-only)
//   • Tool-call loop with hard caps (max_turns, max_tools_per_turn)
//   • Audit logging of every tool call into agent_actions
//   • Confirmation gating — tools can return {requires_confirmation: true}
//     to bounce back to the user without firing
//
// Auto Content tab is INTENTIONALLY excluded — it stays the framework baseline
// so we can A/B compare against the agents.

import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type Tab = "image" | "ugc" | "cinema";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type Message = {
  role: ChatRole;
  content: string | null;
  // OpenAI-compatible tool-call shape (DeepSeek matches this on OpenRouter)
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  // Internal — image attached to a user turn (data: URL or public URL)
  attached_image_url?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  // JSON Schema for function arguments
  parameters: Record<string, any>;
  // Server-side handler. `state` is mutable — handler can update it for the
  // next turn (e.g. set current_product_ref). Returns either a fired result
  // OR a confirmation request that bounces back to the user UI.
  handler: (
    args: any,
    ctx: ToolContext
  ) => Promise<ToolResult>;
};

export type ToolContext = {
  userId: string;
  projectId: string | null;
  tab: Tab;
  conversationId: string;
  state: Record<string, any>; // mutable scratchpad
  attachedImageDescription?: string; // gemini-flash output for the user's most-recent image
};

export type ToolResult =
  | {
      ok: true;
      kind: "fired";
      // What to show the agent in its next turn (gets fed back as a tool message)
      summary: string;
      // What to show the user (frontend renders this as a special message bubble)
      ui?: {
        type: "generation_started";
        history_ids: string[];
        cost: number;
      };
      cost?: number;
      historyIds?: string[];
    }
  | {
      ok: true;
      kind: "info";
      summary: string;
    }
  | {
      ok: true;
      kind: "requires_confirmation";
      summary: string;
      // Frontend renders the confirmation dialog with these editable params
      ui: {
        type: "confirm_generation";
        bucket: "ugc" | "cinema" | "image";
        params: Record<string, any>;
        estimated_cost: number;
      };
    }
  | { ok: false; error: string };

// ──────────────────────────────────────────────────────────────────────────
// OpenRouter chat-completions caller (tool-aware)
// ──────────────────────────────────────────────────────────────────────────

type OrChatToolCallOpts = {
  modelKey: "model_agent_text" | "model_agent_vision";
  systemPrompt: string;
  messages: Message[];
  tools?: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
  temperature?: number;
  maxTokens?: number;
  // Pre-resolved OpenRouter config — hoisted out of the agent loop so we only
  // call getSettings once per runAgentTurn instead of once per iteration.
  orConfig?: { base: string; key: string; model: string };
};

async function orChatWithTools(opts: OrChatToolCallOpts): Promise<{
  ok: boolean;
  message?: Message;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
}> {
  let base: string | undefined;
  let key: string | undefined;
  let model: string | undefined;

  if (opts.orConfig) {
    // Fast path: config was hoisted by runAgentTurn — no DB round-trip needed.
    ({ base, key, model } = opts.orConfig);
  } else {
    // Fallback path (e.g. if called outside runAgentTurn).
    const s = await getSettings(["or_base", "or_key", opts.modelKey]);
    base = s.or_base?.url;
    key = s.or_key?.key;
    model = s[opts.modelKey]?.model;
  }

  if (!base || !key || !model) {
    return { ok: false, error: "OpenRouter not configured" };
  }

  // Map our Message shape to OpenAI-compatible payload
  const payloadMessages = [
    { role: "system" as const, content: opts.systemPrompt },
    ...opts.messages.map((m) => {
      const base: any = { role: m.role };
      if (m.role === "tool") {
        base.tool_call_id = m.tool_call_id;
        base.content = m.content || "";
      } else if (m.role === "assistant" && m.tool_calls) {
        base.content = m.content || "";
        base.tool_calls = m.tool_calls;
      } else {
        base.content = m.content || "";
      }
      return base;
    }),
  ];

  const body: any = {
    model,
    messages: payloadMessages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 2000,
    stream: false,
    // Cap reasoning budget for thinking models (Kimi K2.6, GPT-5,
    // claude-sonnet-thinking, etc.). Without this they burn ALL tokens on
    // internal chain-of-thought and return empty content/tool_calls. Effort
    // 'low' keeps thinking under ~500 tokens — plenty for tool-call planning,
    // none wasted. OpenRouter routes this to the model's native reasoning
    // controls, and ignores it for non-reasoning models (V3.2, Gemini Flash).
    reasoning: { effort: "low" },
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    // 'auto' lets the agent reply with text when no tool is needed (e.g.
    // clarifying questions, status replies). The reasoning budget cap above
    // prevents the model from spiraling.
    body.tool_choice = "auto";
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok || !json) {
    // OpenRouter's error envelope:
    //   { error: { message, code, metadata: { raw, provider_name } } }
    // The top-level `message` is usually generic ("Provider returned
    // error"); the real upstream failure lives in metadata.raw +
    // metadata.provider_name. Surface all three so the user sees WHICH
    // provider failed and WHY instead of a useless wrapper string.
    const err = json?.error;
    const provider = err?.metadata?.provider_name;
    const raw = err?.metadata?.raw;
    const baseMsg =
      err?.message || `HTTP ${res.status}: ${text.substring(0, 200)}`;
    let composed = baseMsg;
    if (provider) composed = `${provider}: ${composed}`;
    if (raw && typeof raw === "string" && !composed.includes(raw)) {
      composed = `${composed} — ${raw.substring(0, 300)}`;
    }
    return { ok: false, error: composed };
  }

  const choice = json?.choices?.[0]?.message;
  if (!choice) return { ok: false, error: "No choice in response" };

  // Reasoning models (Kimi K2.6, GPT-5, etc.) put their thinking in
  // `reasoning` or `reasoning_details`. If `content` is empty but we have
  // reasoning text, surface it as fallback so the user sees something
  // meaningful instead of silent failure.
  let extractedContent = choice.content;
  if (!extractedContent && typeof choice.reasoning === "string") {
    extractedContent = choice.reasoning;
  } else if (!extractedContent && Array.isArray(choice.reasoning_details)) {
    const reasoningText = choice.reasoning_details
      .map((rd: any) => rd?.text || rd?.content || "")
      .filter(Boolean)
      .join("\n\n");
    if (reasoningText) extractedContent = reasoningText;
  }

  const m: Message = {
    role: "assistant",
    content: extractedContent || null,
  };
  if (Array.isArray(choice.tool_calls) && choice.tool_calls.length > 0) {
    m.tool_calls = choice.tool_calls.map((tc: any) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.function?.name || "",
        arguments: tc.function?.arguments || "{}",
      },
    }));
  }

  return {
    ok: true,
    message: m,
    tokensIn: json?.usage?.prompt_tokens || 0,
    tokensOut: json?.usage?.completion_tokens || 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Vision pass — describe a user-attached image so the text-only DeepSeek can
// reason about it. Uses the tab's vision model (gemini-2.5-flash by default).
// ──────────────────────────────────────────────────────────────────────────

export async function describeImageForAgent(
  imageUrl: string
): Promise<{ ok: boolean; description?: string; error?: string }> {
  if (!imageUrl) return { ok: false, error: "No image" };

  const s = await getSettings(["or_base", "or_key", "model_agent_vision"]);
  const base = s.or_base?.url;
  const key = s.or_key?.key;
  const model = s.model_agent_vision?.model;
  if (!base || !key || !model)
    return { ok: false, error: "Vision model not configured" };

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You describe images for a downstream prompt-planning agent. Output ONE concise paragraph (<=120 words) covering: what's in the image, packaging/text visible (verbatim), colors, style, and any notable features. No commentary. No questions. Just the description.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image for prompt planning:" },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      temperature: 0.2,
      // Bump for reasoning models that may consume tokens on internal thought
      // before emitting the description. Non-reasoning models stop early so
      // no cost penalty.
      max_tokens: 1500,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) {
    return { ok: false, error: `Vision HTTP ${res.status}` };
  }
  const desc = json?.choices?.[0]?.message?.content?.trim();
  if (!desc) return { ok: false, error: "Empty vision response" };
  return { ok: true, description: desc };
}

// ──────────────────────────────────────────────────────────────────────────
// Conversation persistence
// ──────────────────────────────────────────────────────────────────────────

export async function loadConversation(
  userId: string,
  projectId: string | null,
  tab: Tab
): Promise<{
  id: string;
  messages: Message[];
  state: Record<string, any>;
  total_messages: number;
}> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("agent_conversations")
    .select("id, messages, state, total_messages")
    .eq("user_id", userId)
    .eq("tab", tab)
    .eq("project_id", projectId || null)
    .maybeSingle();

  if (existing) {
    return {
      id: existing.id,
      messages: (existing.messages as Message[]) || [],
      state: (existing.state as Record<string, any>) || {},
      total_messages: existing.total_messages || 0,
    };
  }

  // Create
  const { data: created } = await admin
    .from("agent_conversations")
    .insert({
      user_id: userId,
      project_id: projectId,
      tab,
      messages: [],
      state: {},
    })
    .select()
    .single();
  return {
    id: created!.id,
    messages: [],
    state: {},
    total_messages: 0,
  };
}

export async function persistConversation(
  conversationId: string,
  messages: Message[],
  state: Record<string, any>,
  tokensIn: number,
  tokensOut: number,
  totalMessages: number
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("agent_conversations")
    .update({
      messages,
      state,
      total_tokens_in: tokensIn,
      total_tokens_out: tokensOut,
      total_messages: totalMessages,
    })
    .eq("id", conversationId);
}

export async function clearConversation(
  userId: string,
  projectId: string | null,
  tab: Tab
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("agent_conversations")
    .update({
      messages: [],
      state: {},
      total_messages: 0,
    })
    .eq("user_id", userId)
    .eq("tab", tab)
    .eq("project_id", projectId || null);
}

// ──────────────────────────────────────────────────────────────────────────
// Audit log
// ──────────────────────────────────────────────────────────────────────────

export async function logAgentAction(
  conversationId: string,
  userId: string,
  tab: Tab,
  toolName: string,
  params: any,
  outcome: "fired" | "failed" | "cancelled" | "requires_confirmation",
  opts: { historyIds?: string[]; cost?: number; errorMessage?: string } = {}
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("agent_actions").insert({
      conversation_id: conversationId,
      user_id: userId,
      tab,
      tool_name: toolName,
      params,
      outcome,
      history_ids: opts.historyIds || null,
      cost: opts.cost || 0,
      error_message: opts.errorMessage || null,
    });
  } catch {
    // Audit failures must never break the main path.
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Main loop — called by /api/agent/[tab]/chat
//
// Responsibilities:
//   1. Append user turn to history
//   2. If user attached image → vision pass → store description in state
//   3. Loop: ask LLM with tool definitions → if tool calls, run handlers,
//      append tool messages, ask again. Stop when LLM replies with text only,
//      OR when any tool returns kind:"requires_confirmation" (bounce to UI),
//      OR when max_tools_per_turn hit.
//   4. Persist conversation + state
//   5. Return final assistant message + any UI payloads
// ──────────────────────────────────────────────────────────────────────────

type LoopOpts = {
  userId: string;
  projectId: string | null;
  tab: Tab;
  systemPrompt: string;
  tools: ToolDefinition[];
  // The user's new message (text + optional attached image URL)
  userText: string;
  attachedImageUrl?: string;
  // "general" → run vision pass + describe to the agent (default).
  // "product" → skip vision; pass straight to the next i2v/r2v generation
  //   as the reference image. Useful when user attaches a product photo
  //   they want the video model to render verbatim (and vision-describing
  //   it adds no value, just latency + token cost).
  attachedImageRole?: "general" | "product";
  // USP / description text the user typed alongside a product reference.
  // Persisted into conversation.state.last_product_usp so the agent can
  // recall it across turns AND injected verbatim into the final Veo /
  // Grok prompt at fire time as a PRODUCT INFO LOCK block — gives us a
  // hard guarantee the description reaches the upstream model regardless
  // of what the LLM did or didn't fold into its tool-call args.
  attachedProductUsp?: string;
  // Per-turn merges into conversation.state. Used today for the Image
  // agent's model dropdown (image_model_override = "nano-banana-pro" |
  // "gpt-image-2") so the generate_image tool handler can force the
  // user's pick without the LLM having to fetch the decision-tree skill.
  stateOverrides?: Record<string, any>;
};

export type LoopResult = {
  ok: boolean;
  reply?: string;
  uiPayloads?: Array<NonNullable<Extract<ToolResult, { kind: "fired" | "requires_confirmation" }>["ui"]>>;
  conversationId?: string;
  error?: string;
};

export async function runAgentTurn(opts: LoopOpts): Promise<LoopResult> {
  // Fetch ALL settings needed for this turn in ONE query — agent config AND
  // OpenRouter config. This prevents getSettings from being called on every
  // iteration of the tool-use loop below.
  const settings = await getSettings([
    "agent_max_turns",
    "agent_max_tools_per_turn",
    "agent_daily_message_cap",
    "or_base",
    "or_key",
    "model_agent_text",
    "model_agent_vision",
  ]);
  const maxTurns = Number(settings.agent_max_turns?.value || 30);
  // Cap of 5 used to be too tight: UGC fetches 5 skills (scene, persona,
  // hook, framework, voice) just to BUILD the prompt, leaving zero budget
  // for the generate_* call in the same turn. The agent would then ask the
  // user to type SUBMIT again. Bumped to 12 so a SUBMIT can do 5+ skill
  // fetches plus the generate in one turn comfortably.
  const maxToolsPerTurn = Number(settings.agent_max_tools_per_turn?.value || 12);

  // Pre-resolved OpenRouter config — passed into orChatWithTools so it never
  // calls getSettings inside the loop.
  const orConfigText = {
    base: settings.or_base?.url as string,
    key: settings.or_key?.key as string,
    model: settings.model_agent_text?.model as string,
  };
  // model_agent_vision is fetched above so describeImageForAgent's getSettings
  // call hits the in-memory cache (free). orConfigVision kept as a local for
  // readability; unused directly because describeImageForAgent is exported and
  // must remain self-contained.
  void settings.model_agent_vision; // warm the cache; no separate variable needed

  // 1. Load conversation
  const conv = await loadConversation(opts.userId, opts.projectId, opts.tab);

  // Hard cap: refuse if conversation already exceeds maxTurns
  if (conv.total_messages >= maxTurns) {
    return {
      ok: false,
      error: `Conversation reached ${maxTurns} turns. Tap the Clear button to start fresh.`,
    };
  }

  const messages: Message[] = [...conv.messages];
  const state: Record<string, any> = {
    ...conv.state,
    ...(opts.stateOverrides || {}),
  };

  // 2. Vision pass if image attached AND role is "general". For "product"
  //    role, skip vision entirely — the image just rides through to the
  //    next generation as the i2v/r2v reference.
  let attachedImageDescription: string | undefined;
  if (opts.attachedImageUrl) {
    if (opts.attachedImageRole === "product") {
      state.last_attached_image_url = opts.attachedImageUrl;
      state.last_attached_image_role = "product";
      // Persist the typed USP/description so confirmAndFire* can fold it
      // into the final Veo / Grok prompt verbatim. trim() so an empty
      // string clears the previous turn's value.
      const trimmedUsp = String(opts.attachedProductUsp || "").trim();
      if (trimmedUsp) state.last_product_usp = trimmedUsp;
    } else {
      const v = await describeImageForAgent(opts.attachedImageUrl);
      if (v.ok && v.description) {
        attachedImageDescription = v.description;
        state.last_attached_image_url = opts.attachedImageUrl;
        state.last_attached_image_description = v.description;
        state.last_attached_image_role = "general";
      }
    }
  }

  // Compose the user message — image description (general) or a short
  // product-reference note (product). DeepSeek V4 Pro is text-only so the
  // visible note is what it reasons about; the URL is in state for tools.
  const userContent =
    opts.attachedImageRole === "product" && opts.attachedImageUrl
      ? `${opts.userText}\n\n[Product reference image attached — pass straight to the i2v/r2v generation as the reference. Skipped vision analysis per user choice.]`
      : attachedImageDescription
        ? `${opts.userText}\n\n[Attached image — description from vision model: ${attachedImageDescription}]`
        : opts.userText;

  messages.push({
    role: "user",
    content: userContent,
    attached_image_url: opts.attachedImageUrl,
  });

  // 3. Build tool registry for the LLM
  const toolDefs = opts.tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const handlerByName = new Map<string, ToolDefinition["handler"]>();
  opts.tools.forEach((t) => handlerByName.set(t.name, t.handler));

  // 4. Tool-use loop
  const uiPayloads: any[] = [];
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let toolCallCount = 0;
  let finalReply = "";

  for (let iter = 0; iter < maxToolsPerTurn + 1; iter++) {
    const llm = await orChatWithTools({
      modelKey: "model_agent_text",
      systemPrompt: opts.systemPrompt,
      messages,
      tools: toolDefs,
      temperature: 0.7,
      // 4000 covers reasoning models (Kimi K2.6 etc.) that consume tokens on
      // internal chain-of-thought before producing visible output. Cheaper
      // models (V3.2) won't use this much, so no waste — they stop early.
      maxTokens: 4000,
      orConfig: orConfigText,
    });

    if (!llm.ok || !llm.message) {
      return {
        ok: false,
        error: llm.error || "Agent LLM call failed",
      };
    }

    totalTokensIn += llm.tokensIn || 0;
    totalTokensOut += llm.tokensOut || 0;
    messages.push(llm.message);

    // No tool calls → final reply
    if (!llm.message.tool_calls || llm.message.tool_calls.length === 0) {
      finalReply = llm.message.content || "";
      break;
    }

    // Execute every tool call in this turn
    let confirmationBounce = false;
    for (const tc of llm.message.tool_calls) {
      toolCallCount += 1;
      if (toolCallCount > maxToolsPerTurn) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: tool-call cap hit (${maxToolsPerTurn} per turn). Reply to user instead.`,
        });
        continue;
      }

      const handler = handlerByName.get(tc.function.name);
      if (!handler) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: unknown tool "${tc.function.name}"`,
        });
        continue;
      }

      let parsedArgs: any = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || "{}");
      } catch (e: any) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: failed to parse arguments — ${e?.message}`,
        });
        continue;
      }

      const ctx: ToolContext = {
        userId: opts.userId,
        projectId: opts.projectId,
        tab: opts.tab,
        conversationId: conv.id,
        state,
        attachedImageDescription,
      };

      let result: ToolResult;
      try {
        result = await handler(parsedArgs, ctx);
      } catch (e: any) {
        result = { ok: false, error: e?.message || "Tool handler crashed" };
      }

      // Audit log
      await logAgentAction(
        conv.id,
        opts.userId,
        opts.tab,
        tc.function.name,
        parsedArgs,
        result.ok
          ? result.kind === "fired"
            ? "fired"
            : result.kind === "requires_confirmation"
              ? "requires_confirmation"
              : "fired"
          : "failed",
        {
          historyIds: result.ok && result.kind === "fired" ? result.historyIds : undefined,
          cost: result.ok && result.kind === "fired" ? result.cost : undefined,
          errorMessage: !result.ok ? result.error : undefined,
        }
      );

      if (!result.ok) {
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Error: ${result.error}`,
        });
        continue;
      }

      // Confirmation bounce — short-circuit the loop, return to UI
      if (result.kind === "requires_confirmation") {
        uiPayloads.push(result.ui);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result.summary,
        });
        confirmationBounce = true;
        finalReply = result.summary;
        break;
      }

      // Fired or info — feed result back to LLM
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result.summary,
      });
      if (result.kind === "fired" && result.ui) {
        uiPayloads.push(result.ui);
      }
    }

    if (confirmationBounce) break;
    // Loop continues: LLM will see tool results and decide next action
  }

  // 5. Persist + return
  // Load existing token counters once (two separate awaits was 2 DB round-trips).
  const prev = await loadTokensSafe(conv.id);
  await persistConversation(
    conv.id,
    messages,
    state,
    prev.in + totalTokensIn,
    prev.out + totalTokensOut,
    conv.total_messages + 1 // count one user turn
  );

  return {
    ok: true,
    reply: finalReply || "(no reply)",
    uiPayloads,
    conversationId: conv.id,
  };
}

async function loadTokensSafe(conversationId: string) {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("agent_conversations")
      .select("total_tokens_in, total_tokens_out")
      .eq("id", conversationId)
      .maybeSingle();
    return {
      in: data?.total_tokens_in || 0,
      out: data?.total_tokens_out || 0,
    };
  } catch {
    return { in: 0, out: 0 };
  }
}
