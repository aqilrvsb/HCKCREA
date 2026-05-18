"use client";

import { useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  X,
  Send,
  Trash2,
  Loader2,
  Image as ImageIcon,
  Bot,
} from "lucide-react";
import Portal from "./portal";

// Universal Q&A help chat — replaces the legacy AI-agent (tool-calling)
// panel with a pure knowledge assistant scoped to each tab. The
// assistant answers questions only; it does NOT generate variants,
// fire tools, or take any in-app action. Knowledge per tab is loaded
// server-side from lib/qa-knowledge.ts.
//
// Image input — users can PASTE images directly into the textarea.
// Pasted images get encoded to data URLs, attached to the next user
// message, and sent to Gemini 3.1 Flash Lite which reads them and
// replies with text (e.g. "your product looks like a 50ml serum
// bottle; here's how to describe it in a UGC prompt…").
//
// Chat history lives in component state — refreshes lose it. That's
// fine for a help chat: questions are usually one-off. If we want
// persisted threads later, add localStorage keyed by (user, tab).

export type QATab = "ugc" | "auto" | "cinema" | "seedance" | "fairytale" | "image";

const TAB_THEME: Record<
  QATab,
  { label: string; color: string; gradient: string; emoji: string }
> = {
  ugc: {
    label: "UGC Help",
    color: "#22c55e",
    gradient: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
    emoji: "🎬",
  },
  auto: {
    label: "Auto Content Help",
    color: "#0ea5e9",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
    emoji: "⚡",
  },
  cinema: {
    label: "Cinema Help",
    color: "#7c4dff",
    gradient: "linear-gradient(135deg, #7c4dff 0%, #5b34d6 100%)",
    emoji: "🎥",
  },
  seedance: {
    label: "Seedance Help",
    color: "#ec4899",
    gradient: "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
    emoji: "💃",
  },
  fairytale: {
    label: "Storytelling Help",
    color: "#8b5cf6",
    gradient: "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
    emoji: "📖",
  },
  image: {
    label: "Image Help",
    color: "#facc15",
    gradient: "linear-gradient(135deg, #facc15 0%, #eab308 100%)",
    emoji: "🖼️",
  },
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[]; // data: URLs (base64) for pasted images
};

export default function QAChatPanel({ tab }: { tab: QATab }) {
  const theme = TAB_THEME[tab] || TAB_THEME.ugc;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom on new message.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, sending]);

  // Reset chat when switching tabs — knowledge changed, conversation
  // context no longer applies.
  useEffect(() => {
    setMessages([]);
    setInput("");
    setPendingImages([]);
    setError(null);
  }, [tab]);

  // Paste handler — extract image blobs from clipboard, convert to
  // data URLs, attach to pendingImages. Text paste falls through to
  // default textarea behavior.
  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItems = items.filter((it) => it.type.startsWith("image/"));
    if (imageItems.length === 0) return; // text paste — let default happen
    e.preventDefault();
    for (const it of imageItems) {
      const blob = it.getAsFile();
      if (!blob) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result || "");
        if (url) setPendingImages((prev) => [...prev, url].slice(0, 4));
      };
      reader.readAsDataURL(blob);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text && pendingImages.length === 0) return;
    if (sending) return;

    setError(null);
    const userMsg: ChatMessage = {
      role: "user",
      content: text || "(image attached)",
      images: pendingImages.length > 0 ? [...pendingImages] : undefined,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setPendingImages([]);
    setSending(true);

    try {
      const r = await fetch("/api/qa/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tab,
          messages: nextMessages,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        throw new Error(d?.error || `HTTP ${r.status}`);
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: String(d.reply || "") },
      ]);
    } catch (e: any) {
      setError(e?.message || "Chat request failed");
    } finally {
      setSending(false);
      // Re-focus the textarea so the user can keep typing
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }

  function clear() {
    if (!confirm("Clear this conversation?")) return;
    setMessages([]);
    setError(null);
  }

  return (
    <>
      {/* Floating Q&A button — bottom-right. Continuously pulsing ring +
          subtle scale blink so it stays visible to users. Stops pulsing
          when the chat is OPEN (no need to attract attention once user
          is engaged). Inline <style> defines two keyframe animations:
          qa-ring-pulse expands a ring outward and fades it (mimics a
          notification badge), qa-button-blink does a soft 2-beat scale
          shimmer on the button itself. */}
      <style jsx>{`
        @keyframes qa-ring-pulse {
          0% {
            transform: scale(1);
            opacity: 0.7;
          }
          80% {
            transform: scale(1.7);
            opacity: 0;
          }
          100% {
            transform: scale(1.7);
            opacity: 0;
          }
        }
        @keyframes qa-button-blink {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 8px 24px ${theme.color}40;
          }
          25% {
            transform: scale(1.06);
            box-shadow: 0 10px 32px ${theme.color}80;
          }
          50% {
            transform: scale(1);
            box-shadow: 0 8px 24px ${theme.color}40;
          }
          75% {
            transform: scale(1.06);
            box-shadow: 0 10px 32px ${theme.color}80;
          }
        }
        .qa-fab-wrap {
          position: fixed;
          bottom: 24px;
          right: 24px;
          width: 56px;
          height: 56px;
          z-index: 50;
        }
        .qa-fab-ring {
          position: absolute;
          inset: 0;
          border-radius: 9999px;
          background: ${theme.color};
          pointer-events: none;
        }
        .qa-fab-ring-1 {
          animation: qa-ring-pulse 1.6s ease-out infinite;
        }
        .qa-fab-ring-2 {
          animation: qa-ring-pulse 1.6s ease-out infinite;
          animation-delay: 0.8s;
        }
        .qa-fab-btn {
          position: relative;
          width: 56px;
          height: 56px;
          border-radius: 9999px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          background: ${theme.gradient};
          box-shadow: 0 8px 24px ${theme.color}40;
          transition: transform 0.18s ease;
          cursor: pointer;
          border: none;
        }
        .qa-fab-btn:hover {
          transform: scale(1.08);
        }
        .qa-fab-blink {
          animation: qa-button-blink 2.4s ease-in-out infinite;
        }
      `}</style>
      <div className="qa-fab-wrap">
        {!open && (
          <>
            <span className="qa-fab-ring qa-fab-ring-1" />
            <span className="qa-fab-ring qa-fab-ring-2" />
          </>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          className={`qa-fab-btn ${!open ? "qa-fab-blink" : ""}`}
          aria-label={open ? "Close Q&A chat" : "Open Q&A chat"}
          title={`${theme.label} — paste a screenshot and ask anything`}
        >
          {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        </button>
      </div>

      {open && (
        <Portal>
          <div
            className="fixed bottom-24 right-6 w-[380px] max-w-[calc(100vw-24px)] flex flex-col rounded-2xl overflow-hidden"
            style={{
              height: "min(560px, calc(100vh - 140px))",
              background: "white",
              border: "1px solid #e5e7eb",
              boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
              zIndex: 50,
            }}
          >
            {/* Header */}
            <div
              className="px-4 py-3 flex items-center justify-between text-white"
              style={{ background: theme.gradient }}
            >
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                <div>
                  <div className="font-bold text-sm">{theme.label}</div>
                  <div className="text-[10px] opacity-90">
                    Q&A · paste screenshots OK
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={clear}
                    className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                    title="Clear conversation"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-white/20 transition-colors"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages scroll area */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
              style={{ background: "#fafaf7" }}
            >
              {messages.length === 0 && !sending && (
                <div className="text-center py-8 text-xs text-gray-500 leading-relaxed">
                  <div className="text-3xl mb-2">{theme.emoji}</div>
                  <div className="font-bold mb-1">{theme.label}</div>
                  <div>Ask anything about this tab.</div>
                  <div className="mt-1 opacity-70">
                    You can paste screenshots — I'll read them.
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className="max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed"
                    style={{
                      background: m.role === "user" ? theme.color : "white",
                      color: m.role === "user" ? "white" : "#1a1a1a",
                      border:
                        m.role === "assistant" ? "1px solid #e5e7eb" : "none",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.images && m.images.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {m.images.map((img, idx) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={idx}
                            src={img}
                            alt={`pasted-${idx}`}
                            className="rounded-lg max-w-[120px] max-h-[120px] object-cover"
                          />
                        ))}
                      </div>
                    )}
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div
                    className="rounded-2xl px-3 py-2 text-xs inline-flex items-center gap-2"
                    style={{
                      background: "white",
                      color: "#1a1a1a",
                      border: "1px solid #e5e7eb",
                    }}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Thinking…
                  </div>
                </div>
              )}
              {error && (
                <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            {/* Pending image previews — shown above input when user
                has pasted images but not yet sent. */}
            {pendingImages.length > 0 && (
              <div
                className="px-4 py-2 border-t flex gap-2 overflow-x-auto"
                style={{ borderColor: "#e5e7eb", background: "white" }}
              >
                {pendingImages.map((img, idx) => (
                  <div key={idx} className="relative flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img}
                      alt={`pending-${idx}`}
                      className="w-12 h-12 rounded-lg object-cover"
                    />
                    <button
                      onClick={() =>
                        setPendingImages((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center"
                      title="Remove image"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input */}
            <div
              className="px-4 py-3 border-t"
              style={{ borderColor: "#e5e7eb", background: "white" }}
            >
              <div className="flex gap-2 items-end">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, 2000))}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={2}
                  placeholder="Ask anything — paste screenshots too"
                  className="flex-1 px-3 py-2 rounded-xl text-xs resize-none outline-none focus:border-orange-400"
                  style={{
                    background: "#fafaf7",
                    border: "1px solid #e5e7eb",
                    color: "#1a1a1a",
                    lineHeight: 1.4,
                  }}
                  disabled={sending}
                />
                <button
                  onClick={() => void send()}
                  disabled={sending || (!input.trim() && pendingImages.length === 0)}
                  className="p-2.5 rounded-xl text-white transition-all"
                  style={{
                    background: theme.gradient,
                    opacity:
                      sending || (!input.trim() && pendingImages.length === 0)
                        ? 0.4
                        : 1,
                    cursor:
                      sending || (!input.trim() && pendingImages.length === 0)
                        ? "not-allowed"
                        : "pointer",
                  }}
                  title="Send (Enter)"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </button>
              </div>
              <div className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-1">
                <ImageIcon className="w-3 h-3" />
                <span>Paste images to ask about them · Enter to send</span>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
