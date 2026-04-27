"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  X,
  Send,
  Paperclip,
  Package,
  Trash2,
  Sparkles,
  Loader2,
  Image as ImageIcon,
  CheckCircle2,
  Bot,
} from "lucide-react";
import Portal from "./portal";

// Universal chat panel for the per-tab AI agents (UGC / Cinema / Image).
// Floats as a bottom-right button; clicking opens a side drawer scoped to
// (current user, current project, current tab). Persists via /api/agent/chat.
//
// Auto Content tab does NOT get this panel — it stays as the rigid framework
// baseline so we can A/B compare against the agents.

export type AgentTab = "ugc" | "cinema" | "image";

const TAB_THEME: Record<
  AgentTab,
  { label: string; color: string; gradient: string; emoji: string }
> = {
  ugc: {
    label: "UGC Agent",
    color: "#22c55e",
    gradient: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
    emoji: "🎬",
  },
  cinema: {
    label: "Cinema Agent",
    color: "#7c4dff",
    gradient: "linear-gradient(135deg, #7c4dff 0%, #5b34d6 100%)",
    emoji: "🎥",
  },
  image: {
    label: "Image Agent",
    color: "#ff6a1a",
    gradient: "linear-gradient(135deg, #ff6a1a 0%, #ff4d00 100%)",
    emoji: "🖼️",
  },
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  attached_image_url?: string;
  ui_payloads?: any[];
  // Local-only UI state for inline confirmation cards. Set when the user
  // clicks Approve/Reject on a confirm_generation payload. Not persisted
  // — on reload the bubble reverts to "pending" but the actual generation
  // (if approved + fired) is already in the history grid.
  approval_state?: "pending" | "firing" | "fired" | "rejected";
  approval_history_ids?: string[];
  approval_error?: string;
  ts?: number;
};

export default function AgentChatPanel({
  tab,
  projectId,
}: {
  tab: AgentTab;
  projectId: string | null;
  // Legacy prop kept for compatibility with existing call sites — they
  // pass it but the panel no longer uses it. Approval is inline now.
  onConfirmGeneration?: (payload: any) => void;
}) {
  const theme = TAB_THEME[tab];

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [attachedImage, setAttachedImage] = useState<string>("");
  const [attachedImagePreview, setAttachedImagePreview] = useState<string>("");
  // "general" → vision-describe to the agent (default for image agent + when
  //   user attaches via paperclip).
  // "product" → skip vision, pass straight as i2v/r2v reference (only on
  //   UGC + Cinema; user attaches via the package icon).
  const [attachedImageRole, setAttachedImageRole] = useState<"general" | "product">(
    "general"
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Load conversation when panel opens or project/tab changes
  useEffect(() => {
    if (!open) return;
    void loadConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, tab]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  async function loadConversation() {
    setLoadingHistory(true);
    try {
      const url = `/api/agent/${tab}/chat?project_id=${projectId || ""}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (j?.conversation_id) setConversationId(j.conversation_id);
      if (j?.ok && Array.isArray(j.messages)) {
        const ui: ChatMessage[] = j.messages
          .filter((m: any) => m.role === "user" || m.role === "assistant")
          .filter((m: any) => m.content || m.attached_image_url)
          .map((m: any) => ({
            role: m.role,
            content: m.content || "",
            attached_image_url: m.attached_image_url,
          }));
        setMessages(ui);
      } else {
        setMessages([]);
      }
    } finally {
      setLoadingHistory(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text && !attachedImage) return;
    if (busy) return;

    setBusy(true);
    const userMsg: ChatMessage = {
      role: "user",
      content: text,
      attached_image_url: attachedImagePreview || undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    const sentImage = attachedImage;
    setAttachedImage("");
    setAttachedImagePreview("");

    const sentRole = attachedImageRole;
    setAttachedImageRole("general"); // reset for next attach

    try {
      const r = await fetch(`/api/agent/${tab}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          message: text,
          image_url: sentImage || undefined,
          image_role: sentImage ? sentRole : undefined,
        }),
      });
      const j = await r.json();

      if (!r.ok || !j?.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `⚠️ ${j?.error || `HTTP ${r.status}`}`,
          },
        ]);
        return;
      }

      if (j?.conversation_id) setConversationId(j.conversation_id);

      // Confirmation requests render INLINE inside the assistant bubble (see
      // ChatBubble below). No modal popup. Approve/Reject buttons fire when
      // the user clicks them, calling /api/agent/{tab}/confirm directly.
      const hasConfirm = (j.ui_payloads || []).some(
        (p: any) => p?.type === "confirm_generation"
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: j.reply || "(no reply)",
          ui_payloads: j.ui_payloads || [],
          approval_state: hasConfirm ? "pending" : undefined,
        },
      ]);

      // If a generation was fired (e.g. legacy auto-fire path), refresh
      const fired = (j.ui_payloads || []).find(
        (p: any) => p?.type === "generation_started"
      );
      if (fired) {
        window.dispatchEvent(new CustomEvent("history:refresh"));
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ ${e?.message || "Network error"}` },
      ]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function handleClear() {
    if (!confirm("Clear this conversation? The agent forgets everything.")) return;
    await fetch(`/api/agent/${tab}/chat?project_id=${projectId || ""}`, {
      method: "DELETE",
    });
    setMessages([]);
  }

  // Approve a pending confirm_generation card. Posts the payload to the
  // tab's confirm endpoint and updates the bubble state so the user sees
  // the result inline. On success, the conversation auto-clears 2.5s
  // later — fresh slate for the next session, per user request.
  async function handleApprove(messageIdx: number, payload: any) {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === messageIdx ? { ...m, approval_state: "firing" } : m
      )
    );
    try {
      const body =
        tab === "ugc"
          ? {
              project_id: projectId,
              conversation_id: conversationId,
              product_image_url: payload.params?.product_image_url || "",
              product_description: payload.params?.product_description || "",
              duration: payload.params?.duration || "8",
              aspect_ratio: payload.params?.aspect_ratio || "9:16",
              variants: payload.params?.variants || [],
            }
          : tab === "cinema"
            ? {
                project_id: projectId,
                conversation_id: conversationId,
                prompt: payload.params?.prompt || "",
                image_url: payload.params?.image_url || "",
                image_mode: payload.params?.image_mode || "text",
                aspect_ratio: payload.params?.aspect_ratio || "9:16",
                duration: Number(payload.params?.duration || 8),
                mood_skill_id: payload.params?.mood_skill_id,
                director_skill_id: payload.params?.director_skill_id,
                camera_skill_id: payload.params?.camera_skill_id,
              }
            : {
                // image
                project_id: projectId,
                conversation_id: conversationId,
                prompt: payload.params?.prompt || "",
                model: payload.params?.model || "nano-banana-pro",
                reference_urls: payload.params?.reference_urls || [],
                aspect_ratio: payload.params?.aspect_ratio || "1:1",
                count: payload.params?.count || 1,
                photographer_skill_id: payload.params?.photographer_skill_id,
                brand_skill_id: payload.params?.brand_skill_id,
                composite_skill_id: payload.params?.composite_skill_id,
              };
      const r = await fetch(`/api/agent/${tab}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setMessages((prev) =>
          prev.map((m, i) =>
            i === messageIdx
              ? {
                  ...m,
                  approval_state: "pending",
                  approval_error: j?.error || `HTTP ${r.status}`,
                }
              : m
          )
        );
        return;
      }
      setMessages((prev) =>
        prev.map((m, i) =>
          i === messageIdx
            ? {
                ...m,
                approval_state: "fired",
                approval_history_ids: j.history_ids || (j.history_id ? [j.history_id] : []),
              }
            : m
        )
      );
      window.dispatchEvent(new CustomEvent("history:refresh"));

      // Auto-clear conversation after a short pause so user sees the success.
      // Fresh slate keeps each generation session focused, per user request.
      setTimeout(async () => {
        try {
          await fetch(`/api/agent/${tab}/chat?project_id=${projectId || ""}`, {
            method: "DELETE",
          });
        } catch {}
        setMessages([]);
      }, 2500);
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === messageIdx
            ? {
                ...m,
                approval_state: "pending",
                approval_error: e?.message || "Network error",
              }
            : m
        )
      );
    }
  }

  function handleReject(messageIdx: number) {
    setMessages((prev) =>
      prev.map((m, i) =>
        i === messageIdx ? { ...m, approval_state: "rejected" } : m
      )
    );
  }

  function handleFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      setAttachedImage(url); // data: URL — server will host via /api/upload/image
      setAttachedImagePreview(url);
    };
    reader.readAsDataURL(file);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <>
      {/* Floating launcher button (bottom-right of viewport, only inside main area) */}
      {!open && (
        <Portal>
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center text-white transition-transform hover:scale-110"
          style={{
            background: theme.gradient,
            boxShadow: `0 8px 24px ${theme.color}66`,
          }}
          title={theme.label}
        >
          <MessageCircle className="w-6 h-6" strokeWidth={2.4} />
        </button>
        </Portal>
      )}

      {/* Slide-out panel */}
      {open && (
        <Portal>
        <div
          className="fixed top-0 right-0 bottom-0 lg:left-auto z-40 w-full lg:w-[420px] flex flex-col"
          style={{
            background: "var(--color-bg)",
            borderLeft: "1px solid var(--color-border)",
            boxShadow: "-8px 0 30px rgba(0,0,0,0.4)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-2 px-4 py-3 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm"
              style={{ background: theme.gradient }}
            >
              <Bot className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display font-extrabold text-sm tracking-tight text-[var(--color-text-primary)]">
                {theme.label}
              </div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
                {tab === "ugc" && "Veo specialist · MCSLA · 14 scenes"}
                {tab === "cinema" && "Grok specialist · descriptive · style anchors"}
                {tab === "image" && "Banana Pro / GPT-2 specialist"}
              </div>
            </div>
            <button
              onClick={handleClear}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-muted)",
              }}
              title="Clear conversation"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-secondary)",
              }}
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
          >
            {loadingHistory ? (
              <div className="text-center text-xs text-[var(--color-text-muted)] py-8">
                Loading conversation…
              </div>
            ) : messages.length === 0 ? (
              <EmptyState tab={tab} />
            ) : (
              messages.map((m, i) => (
                <ChatBubble
                  key={i}
                  message={m}
                  theme={theme}
                  onApprove={(payload) => handleApprove(i, payload)}
                  onReject={() => handleReject(i)}
                />
              ))
            )}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] px-3">
                <Loader2 className="w-3 h-3 animate-spin" />
                Thinking…
              </div>
            )}
          </div>

          {/* Image preview if attached */}
          {attachedImagePreview && (
            <div
              className="px-3 py-2 border-t flex items-center gap-2"
              style={{
                background: "var(--color-bg-card)",
                borderColor: "var(--color-border)",
              }}
            >
              <img
                src={attachedImagePreview}
                alt=""
                className="w-12 h-12 object-cover rounded"
              />
              <div className="flex-1 min-w-0">
                <div
                  className="text-[10px] font-mono uppercase tracking-wider"
                  style={{
                    color:
                      attachedImageRole === "product"
                        ? theme.color
                        : "var(--color-text-muted)",
                  }}
                >
                  {attachedImageRole === "product" ? "Product reference" : "Attached"}
                </div>
                <div className="text-xs text-[var(--color-text-primary)] truncate">
                  {attachedImageRole === "product"
                    ? "Direct to video — no vision analysis"
                    : "Image will be analyzed by the agent"}
                </div>
              </div>
              <button
                onClick={() => {
                  setAttachedImage("");
                  setAttachedImagePreview("");
                }}
                className="w-7 h-7 rounded flex items-center justify-center"
                style={{ color: "var(--color-text-muted)" }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Input */}
          <div
            className="p-3 border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div
              className="rounded-xl flex items-end gap-2 p-2"
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              {/* Paperclip — general image. Runs vision describe so the
                  agent can reason about what's in the picture (good for
                  Image agent + when user attaches a moodboard / brand
                  doc / mid-conversation reference). */}
              <button
                onClick={() => {
                  setAttachedImageRole("general");
                  fileInputRef.current?.click();
                }}
                disabled={busy}
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                style={{
                  background: "var(--color-bg)",
                  color: "var(--color-text-secondary)",
                }}
                title="Attach image (vision-described)"
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
              {/* Package icon — product reference. Skips vision, passes
                  straight to Veo (UGC) or Grok (Cinema) as the i2v/r2v
                  reference. Only meaningful on UGC + Cinema agents. */}
              {(tab === "ugc" || tab === "cinema") && (
                <button
                  onClick={() => {
                    setAttachedImageRole("product");
                    fileInputRef.current?.click();
                  }}
                  disabled={busy}
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                  style={{
                    background: `${theme.color}18`,
                    color: theme.color,
                    border: `1px solid ${theme.color}33`,
                  }}
                  title="Attach product reference (no vision — direct to video)"
                >
                  <Package className="w-3.5 h-3.5" />
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => handleFile(e.target.files?.[0] || null)}
              />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder={
                  tab === "ugc"
                    ? "e.g. Make 3 UGC for hijab shampoo using PAS framework"
                    : tab === "cinema"
                      ? "e.g. Cinematic drone shot of a rainy Kuala Lumpur"
                      : "e.g. Edit this image — replace background with sunlit kitchen"
                }
                disabled={busy}
                className="flex-1 bg-transparent outline-none text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] resize-none max-h-36 leading-relaxed py-1.5"
              />
              <button
                onClick={handleSend}
                disabled={busy || (!input.trim() && !attachedImage)}
                className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-white disabled:opacity-40"
                style={{ background: theme.gradient }}
              >
                {busy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mt-1.5 px-1">
              Free chat · only generations cost credits · Enter to send
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  );
}

function ChatBubble({
  message,
  theme,
  onApprove,
  onReject,
}: {
  message: ChatMessage;
  theme: { color: string; gradient: string; emoji: string };
  onApprove?: (payload: any) => void;
  onReject?: () => void;
}) {
  const isUser = message.role === "user";
  const confirmPayload = message.ui_payloads?.find(
    (p: any) => p?.type === "confirm_generation"
  );

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} gap-2`}>
      {!isUser && (
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-white text-xs"
          style={{ background: theme.gradient }}
        >
          <Bot className="w-3.5 h-3.5" />
        </div>
      )}
      <div
        className="max-w-[80%] rounded-2xl px-3 py-2 text-xs leading-relaxed"
        style={
          isUser
            ? {
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }
            : {
                background: `${theme.color}11`,
                border: `1px solid ${theme.color}33`,
                color: "var(--color-text-primary)",
              }
        }
      >
        {message.attached_image_url && (
          <img
            src={message.attached_image_url}
            alt=""
            className="w-full max-h-40 object-cover rounded mb-1.5"
          />
        )}
        <div className="whitespace-pre-wrap">{message.content}</div>

        {/* Inline confirmation card — replaces the modal popup. State drives
            which buttons / status are shown. */}
        {confirmPayload && (
          <InlineConfirmCard
            payload={confirmPayload}
            state={message.approval_state || "pending"}
            historyIds={message.approval_history_ids}
            error={message.approval_error}
            theme={theme}
            onApprove={() => onApprove?.(confirmPayload)}
            onReject={() => onReject?.()}
          />
        )}

        {/* Legacy generation_started payload (e.g. fired without confirm) */}
        {message.ui_payloads?.map((p: any, i: number) =>
          p?.type === "generation_started" ? (
            <div
              key={i}
              className="mt-2 rounded-lg p-2.5"
              style={{
                background: "rgba(34,197,94,0.12)",
                border: "1px solid rgba(34,197,94,0.3)",
              }}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-green-500">
                <CheckCircle2 className="w-3 h-3" />
                Generation started
              </div>
              <div className="text-[10px] mt-1 text-[var(--color-text-secondary)]">
                {p.history_ids?.length || 0} item{(p.history_ids?.length || 0) > 1 ? "s" : ""}
                {" · "}RM {Number(p.cost || 0).toFixed(2)}
              </div>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}

function InlineConfirmCard({
  payload,
  state,
  historyIds,
  error,
  theme,
  onApprove,
  onReject,
}: {
  payload: any;
  state: "pending" | "firing" | "fired" | "rejected";
  historyIds?: string[];
  error?: string;
  theme: { color: string; gradient: string };
  onApprove: () => void;
  onReject: () => void;
}) {
  const cost = Number(payload.estimated_cost || 0).toFixed(2);
  const bucket = payload.bucket as "image" | "ugc" | "cinema";
  const params = payload.params || {};
  // Build a one-line summary depending on bucket
  let summary = "";
  if (bucket === "image") {
    summary = `${params.count || 1} image${(params.count || 1) > 1 ? "s" : ""} · ${params.model || "nano-banana-pro"}`;
  } else if (bucket === "ugc") {
    const variantCount = Array.isArray(params.variants) ? params.variants.length : 0;
    summary = `${variantCount} UGC video${variantCount > 1 ? "s" : ""} · ${params.duration || 8}s · ${params.aspect_ratio || "9:16"}`;
  } else if (bucket === "cinema") {
    summary = `Cinema clip · ${params.duration || 8}s · ${params.image_mode === "image" ? "image-to-video" : "text-to-video"}`;
  }

  if (state === "fired") {
    return (
      <div
        className="mt-2 rounded-lg p-2.5"
        style={{
          background: "rgba(34,197,94,0.12)",
          border: "1px solid rgba(34,197,94,0.3)",
        }}
      >
        <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-green-500">
          <CheckCircle2 className="w-3 h-3" />
          Generation started
        </div>
        <div className="text-[10px] mt-1 text-[var(--color-text-secondary)]">
          {historyIds?.length || 1} item{(historyIds?.length || 1) > 1 ? "s" : ""} · RM {cost}
        </div>
      </div>
    );
  }

  if (state === "rejected") {
    return (
      <div
        className="mt-2 rounded-lg p-2.5"
        style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.25)",
        }}
      >
        <div className="text-[10px] font-bold uppercase tracking-wider text-red-400">
          Cancelled
        </div>
        <div className="text-[10px] mt-1 text-[var(--color-text-muted)]">
          Beritahu apa nak ubah, tulis SUBMIT bila dah ok.
        </div>
      </div>
    );
  }

  // pending or firing
  return (
    <div
      className="mt-2 rounded-lg p-3"
      style={{
        background: `${theme.color}10`,
        border: `1px solid ${theme.color}40`,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <Sparkles className="w-3 h-3" style={{ color: theme.color }} />
        <span
          className="text-[10px] font-extrabold uppercase tracking-wider"
          style={{ color: theme.color }}
        >
          Confirm to generate
        </span>
      </div>
      <div className="text-[11px] font-semibold text-[var(--color-text-primary)] mb-1">
        {summary}
      </div>
      <div className="text-[10px] text-[var(--color-text-secondary)] mb-2.5">
        Estimated cost: <span className="font-bold">RM {cost}</span>
      </div>
      {error && (
        <div className="text-[10px] text-red-400 mb-2">⚠️ {error}</div>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={onReject}
          disabled={state === "firing"}
          className="flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
          style={{
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-secondary)",
          }}
        >
          Reject
        </button>
        <button
          onClick={onApprove}
          disabled={state === "firing"}
          className="flex-1 py-1.5 rounded text-[10px] font-extrabold uppercase tracking-wider text-white disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          style={{
            background: theme.gradient,
            boxShadow: `0 2px 6px ${theme.color}66`,
          }}
        >
          {state === "firing" ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              Firing…
            </>
          ) : (
            <>Approve</>
          )}
        </button>
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: AgentTab }) {
  const theme = TAB_THEME[tab];
  const examples =
    tab === "ugc"
      ? [
          "Make 3 UGC for hijab shampoo, PAS framework",
          "Confessional UGC, female 20s, Algenib voice",
          "Kitchen scene, Malay woman, holding moong dal",
        ]
      : tab === "cinema"
        ? [
            "Cinematic drone over Kuala Lumpur at golden hour",
            "Hyper motion crash zoom on coffee splash",
            "Wong Kar-wai pasar malam blue hour",
          ]
        : [
            "Generate product hero with sunlit window background",
            "Edit this image, change background to clean kitchen",
            "Banana Pro, 9:16, mockup of moong dal on shelf",
          ];

  return (
    <div className="text-center py-6 px-4">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl"
        style={{ background: theme.gradient }}
      >
        {theme.emoji}
      </div>
      <div className="text-sm font-display font-extrabold text-[var(--color-text-primary)] mb-1">
        {theme.label}
      </div>
      <div className="text-[10px] text-[var(--color-text-muted)] mb-4 leading-relaxed">
        {tab === "ugc" &&
          "I plan UGC videos with MCSLA structure, 14 scene templates, voice control, and Malay-localized hooks. Tell me what you want — I'll show you a confirmation dialog before firing."}
        {tab === "cinema" &&
          "I plan cinematic Grok shots — hyper motion, drone, atmospheric, product b-roll. Descriptive paragraphs, style anchors. Show before fire."}
        {tab === "image" &&
          "I plan still images via Banana Pro or GPT-Image-2. Reference image, aspect ratio, edit vs generate. Show before fire."}
      </div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
        Try
      </div>
      <div className="space-y-1.5 text-left">
        {examples.map((ex, i) => (
          <div
            key={i}
            className="text-[11px] rounded-lg px-3 py-2"
            style={{
              background: "var(--color-bg-card)",
              border: "1px dashed var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            "{ex}"
          </div>
        ))}
      </div>
    </div>
  );
}
