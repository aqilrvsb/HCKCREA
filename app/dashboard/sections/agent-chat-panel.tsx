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
  // USP / description text the user types alongside a product reference.
  // Forwarded to the chat API as `product_usp` so the agent has plain-text
  // context (price, claims, key features) on top of the photo. Only used
  // when attachedImageRole === "product".
  const [attachedProductUsp, setAttachedProductUsp] = useState<string>("");
  // Controls the product-reference modal (image upload + USP textarea).
  // Only mounted on UGC + Cinema agents.
  const [productModalOpen, setProductModalOpen] = useState(false);
  // IMAGE agent only — user's explicit model pick from the dropdown next
  // to the attach icons. Sent in the chat POST so the agent skips the
  // banana-vs-gpt-2 decision-tree fetch and uses the chosen model.
  const [imageModel, setImageModel] = useState<"nano-banana-pro" | "gpt-image-2">(
    "nano-banana-pro"
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
          // Drop intermediate tool-call iterations the agent loop persisted
          // (assistant turns with tool_calls but no user-visible text). Those
          // would otherwise render as empty bot bubbles. We require either
          // non-trivial text content, an attached image, or at least one
          // visible UI payload (confirm_generation / generation_started).
          .filter((m: any) => {
            const text = typeof m.content === "string" ? m.content.trim() : "";
            const hasText = text.length > 0;
            const hasImage = !!m.attached_image_url;
            const hasPayload =
              Array.isArray(m.ui_payloads) && m.ui_payloads.length > 0;
            return hasText || hasImage || hasPayload;
          })
          .map((m: any) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : "",
            attached_image_url: m.attached_image_url,
            ui_payloads: Array.isArray(m.ui_payloads) ? m.ui_payloads : undefined,
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
    const sentImageModel = tab === "image" ? imageModel : undefined;
    const sentProductUsp = sentRole === "product" ? attachedProductUsp.trim() : "";
    setAttachedProductUsp("");

    try {
      const r = await fetch(`/api/agent/${tab}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          message: text,
          image_url: sentImage || undefined,
          image_role: sentImage ? sentRole : undefined,
          product_usp: sentProductUsp || undefined,
          image_model: sentImageModel,
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
      {/* Floating launcher (bottom-right). Stacks an AI AGENT badge on top
          of the launcher button so the user immediately knows what the
          floating chat circle is. */}
      {!open && (
        <Portal>
          <div className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-1.5">
            <span
              className="text-[9px] font-mono font-extrabold uppercase tracking-[0.18em] px-2 py-1 rounded-md"
              style={{
                background: `${theme.color}1a`,
                color: theme.color,
                border: `1px solid ${theme.color}55`,
                boxShadow: `0 4px 12px ${theme.color}26`,
              }}
            >
              AI Agent
            </span>
            <button
              onClick={() => setOpen(true)}
              className="w-14 h-14 rounded-full flex items-center justify-center text-white transition-transform hover:scale-110"
              style={{
                background: theme.gradient,
                boxShadow: `0 8px 24px ${theme.color}66`,
              }}
              title={theme.label}
            >
              <MessageCircle className="w-6 h-6" strokeWidth={2.4} />
            </button>
          </div>
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
                    ? attachedProductUsp
                      ? attachedProductUsp
                      : "Direct to video — no vision analysis"
                    : "Image will be analyzed by the agent"}
                </div>
              </div>
              <button
                onClick={() => {
                  setAttachedImage("");
                  setAttachedImagePreview("");
                  setAttachedProductUsp("");
                }}
                className="w-7 h-7 rounded flex items-center justify-center"
                style={{ color: "var(--color-text-muted)" }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Workflow hint — sits above the input so the user always sees
              the canonical four-step path the agent expects. */}
          <div
            className="px-3 pt-3"
            style={{ borderTop: "1px solid var(--color-border)" }}
          >
            <div
              className="rounded-lg px-2.5 py-1.5 flex items-center justify-center gap-1.5 text-[9px] font-mono font-extrabold uppercase tracking-[0.12em] flex-wrap"
              style={{
                background: `${theme.color}10`,
                border: `1px solid ${theme.color}33`,
                color: theme.color,
              }}
            >
              <span>Discuss</span>
              <span style={{ opacity: 0.5 }}>→</span>
              <span>Puas Hati</span>
              <span style={{ opacity: 0.5 }}>→</span>
              <span>Reply Submit</span>
              <span style={{ opacity: 0.5 }}>→</span>
              <span>Approve</span>
            </div>
          </div>

          {/* Input */}
          <div className="p-3">
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
              {/* Package icon — product reference. Opens a modal with
                  image upload + USP description so the agent gets both
                  the photo (passed to Veo/Grok as i2v/r2v ref) AND a
                  plain-text USP block to anchor the prompt on. */}
              {(tab === "ugc" || tab === "cinema") && (
                <button
                  onClick={() => setProductModalOpen(true)}
                  disabled={busy}
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 disabled:opacity-50"
                  style={{
                    background: `${theme.color}18`,
                    color: theme.color,
                    border: `1px solid ${theme.color}33`,
                  }}
                  title="Attach product reference (image + USP)"
                >
                  <Package className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Model dropdown — IMAGE agent only. Lets the user lock
                  Banana Pro vs GPT Image 2 instead of leaving the LLM
                  to decide via the banana-vs-gpt-2 skill. Sent in the
                  chat POST as image_model; the chat route stores it on
                  conversation state so the generate_image handler
                  honours it. */}
              {tab === "image" && (
                <select
                  value={imageModel}
                  onChange={(e) =>
                    setImageModel(
                      e.target.value as "nano-banana-pro" | "gpt-image-2"
                    )
                  }
                  disabled={busy}
                  className="h-8 px-2 rounded-lg text-[10px] font-bold flex-shrink-0 disabled:opacity-50 outline-none cursor-pointer"
                  style={{
                    background: "var(--color-bg)",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                  title="Image model"
                >
                  <option value="nano-banana-pro">Banana Pro</option>
                  <option value="gpt-image-2">GPT Image 2</option>
                </select>
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

      {/* Product reference modal — UGC + Cinema only. The agent gets BOTH
          the photo (passed straight to Veo/Grok as i2v/r2v ref) AND the USP
          textarea (forwarded as product_usp so the LLM has plain-text
          context about price, claims, key features, target audience). */}
      {productModalOpen && (
        <ProductReferenceModal
          theme={theme}
          onClose={() => setProductModalOpen(false)}
          onAttach={(dataUrl, usp) => {
            setAttachedImage(dataUrl);
            setAttachedImagePreview(dataUrl);
            setAttachedImageRole("product");
            setAttachedProductUsp(usp);
            setProductModalOpen(false);
          }}
        />
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// ProductReferenceModal — image upload + USP textarea, surfaced when the
// user clicks the Package icon in the UGC / Cinema agent chat. Stays
// presentational; the parent owns the attached state.
// ──────────────────────────────────────────────────────────────────────────
function ProductReferenceModal({
  theme,
  onClose,
  onAttach,
}: {
  theme: { color: string; gradient: string };
  onClose: () => void;
  onAttach: (dataUrl: string, usp: string) => void;
}) {
  const [dataUrl, setDataUrl] = useState("");
  const [usp, setUsp] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  function handleFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDataUrl(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Portal>
      <div
        className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        onClick={onClose}
      >
        <div
          className="rounded-2xl max-w-md w-full p-5"
          style={{
            background: "var(--color-bg)",
            border: `2px solid ${theme.color}`,
            boxShadow: `0 20px 60px ${theme.color}33`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4" style={{ color: theme.color }} />
              <h3
                className="font-display font-extrabold text-base"
                style={{ color: theme.color }}
              >
                Product Reference
              </h3>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded flex items-center justify-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            Upload product image + tulis USP / description. AI agent akan respect image 100% (label, warna, packaging) dan guna USP untuk context.
          </p>

          {/* Image uploader */}
          <div
            className="text-[10px] font-extrabold uppercase tracking-[0.1em] mb-1.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            Product Image
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg overflow-hidden flex items-center justify-center mb-3"
            style={{
              height: dataUrl ? 180 : 100,
              border: `2px dashed ${dataUrl ? "transparent" : `${theme.color}55`}`,
              background: dataUrl ? "#000" : `${theme.color}0d`,
            }}
          >
            {dataUrl ? (
              <img src={dataUrl} alt="" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center px-4">
                <Package
                  className="w-6 h-6 mx-auto mb-1"
                  style={{ color: theme.color }}
                />
                <div
                  className="text-xs font-bold"
                  style={{ color: theme.color }}
                >
                  Click to upload product image
                </div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                  PNG / JPG — packaging or hero shot
                </div>
              </div>
            )}
          </button>

          {/* USP textarea */}
          <div
            className="text-[10px] font-extrabold uppercase tracking-[0.1em] mb-1.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            USP / Description
          </div>
          <textarea
            value={usp}
            onChange={(e) => setUsp(e.target.value)}
            rows={5}
            maxLength={1500}
            placeholder={`What is this product? Key USP, price, claims, audience…\n\nExample:\nSambal Nyet Berapi — RM12.90\n• 100% halal, no MSG\n• Pedas extreme (level 5/5)\n• Best with rice / noodles\n• Target: spice lovers 20-40s`}
            className="w-full rounded-lg p-3 text-xs font-mono leading-relaxed resize-y outline-none mb-3"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <div className="text-[10px] text-[var(--color-text-muted)] mb-4 text-right">
            {usp.length} / 1500
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 h-10 rounded-lg text-xs font-bold"
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => onAttach(dataUrl, usp.trim())}
              disabled={!dataUrl}
              className="flex-1 h-10 rounded-lg text-xs font-extrabold text-white disabled:opacity-40"
              style={{ background: theme.gradient }}
            >
              Attach to chat
            </button>
          </div>
        </div>
      </div>
    </Portal>
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

  // Skip render if there's nothing visible. Agent loop iterations with
  // tool calls (no text content, no payload, no image) would otherwise
  // render as a lonely bot avatar with an empty bubble.
  const text = (message.content || "").trim();
  const hasPayload = (message.ui_payloads?.length ?? 0) > 0;
  const hasImage = !!message.attached_image_url;
  if (!text && !hasPayload && !hasImage) {
    return null;
  }

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
