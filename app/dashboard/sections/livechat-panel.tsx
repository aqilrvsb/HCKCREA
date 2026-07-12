"use client";

// Pening Lab Live — floating livechat for the Original Video tab.
// Bottom-right launcher → right-side drawer (same shell as the AI Agent chat).
// Talks to /api/agent/cinema/chat, which runs the Pening Lab GPT brain with 4
// tools. Flow: Load Data product picker → MAIN/SUB chat → storyboard grid
// (approve/revise) → Omni video (inline player + download).

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Package, MessageCircle, X, Trash2, Bot, ImageIcon } from "lucide-react";
import Portal from "./portal";

const THEME = { color: "#f5b100", gradient: "linear-gradient(135deg,#f5c518,#f59e0b)" };

type SavedProduct = {
  id: string;
  kind: "affiliate" | "manual";
  product_id: string | null;
  product_name: string;
  detail: string | null;
  attachments: string[];
};

type UiPayload =
  | { type: "storyboard_ready"; history_id: string; image_url: string }
  | { type: "video_ready"; history_id: string; output_url: string; download_url?: string }
  | { type: "generation_started"; history_ids: string[]; cost: number }
  | { type: string; [k: string]: any };

type Msg = { id: string; role: "user" | "assistant"; text: string; ui?: UiPayload[] };

let _mid = 0;
const mid = () => `m${Date.now()}_${_mid++}`;

export default function LivechatPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [affiliate, setAffiliate] = useState<SavedProduct[]>([]);
  const [manual, setManual] = useState<SavedProduct[]>([]);
  const [showLoad, setShowLoad] = useState<"affiliate" | "manual" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/agent/cinema/chat?project_id=${projectId}`, { cache: "no-store" });
        const d = await r.json();
        if (!cancel && Array.isArray(d?.messages)) {
          const msgs: Msg[] = [];
          for (const m of d.messages) {
            if ((m.role === "user" || m.role === "assistant") && m.content) {
              msgs.push({ id: mid(), role: m.role, text: m.content });
            }
          }
          setMessages(msgs);
        }
      } catch {}
    })();
    return () => { cancel = true; };
  }, [open, projectId]);

  async function refreshBalance() {
    try {
      const d = await fetch("/api/me/credits", { cache: "no-store" }).then((r) => r.json());
      if (typeof d?.credits === "number") setBalance(d.credits);
    } catch {}
  }
  async function loadSaved() {
    try {
      const [a, m] = await Promise.all([
        fetch("/api/auto-content/saved-products?kind=affiliate", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/auto-content/saved-products?kind=manual", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      if (Array.isArray(a?.items)) setAffiliate(a.items);
      if (Array.isArray(m?.items)) setManual(m.items);
    } catch {}
  }
  useEffect(() => { if (open) { refreshBalance(); loadSaved(); } }, [open]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);

  async function send(text: string, product?: SavedProduct) {
    if (loading) return;
    const bubble = product ? `📦 Guna produk: ${product.product_name}${text ? ` — ${text}` : ""}` : text;
    if (!bubble.trim()) return;
    setMessages((p) => [...p, { id: mid(), role: "user", text: bubble }]);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/agent/cinema/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          message: text,
          ...(product
            ? { product: { name: product.product_name, detail: product.detail || "", image_urls: (product.attachments || []).filter(Boolean).slice(0, 3) } }
            : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMessages((p) => [...p, { id: mid(), role: "assistant", text: `⚠️ ${d?.error || `Ralat (HTTP ${r.status})`}` }]);
      else {
        setMessages((p) => [...p, { id: mid(), role: "assistant", text: d.reply || "(tiada balasan)", ui: d.ui_payloads || [] }]);
        refreshBalance();
      }
    } catch (e: any) {
      setMessages((p) => [...p, { id: mid(), role: "assistant", text: `⚠️ ${e?.message || "Ralat rangkaian"}` }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleClear() {
    if (!confirm("Kosongkan chat ni? Pening Lab akan lupa semuanya.")) return;
    try {
      await fetch(`/api/agent/cinema/chat?project_id=${projectId}`, { method: "DELETE" });
    } catch {}
    setMessages([]);
  }

  function pickProduct(p: SavedProduct) { setShowLoad(null); send("", p); }
  const savedList = showLoad === "affiliate" ? affiliate : showLoad === "manual" ? manual : [];

  return (
    <>
      {!open && (
        <Portal>
          <div className="fixed bottom-6 right-6 z-40 flex flex-col items-center gap-1.5">
            <span className="text-[9px] font-mono font-extrabold uppercase tracking-[0.18em] px-2 py-1 rounded-md"
              style={{ background: `${THEME.color}1a`, color: THEME.color, border: `1px solid ${THEME.color}55`, boxShadow: `0 4px 12px ${THEME.color}26` }}>
              Live Chat
            </span>
            <button onClick={() => setOpen(true)} title="Pening Lab Live"
              className="w-14 h-14 rounded-full flex items-center justify-center text-white transition-transform hover:scale-110"
              style={{ background: THEME.gradient, boxShadow: `0 8px 24px ${THEME.color}66` }}>
              <MessageCircle className="w-6 h-6" strokeWidth={2.4} />
            </button>
          </div>
        </Portal>
      )}

      {open && (
        <Portal>
          <div className="fixed top-0 right-0 bottom-0 lg:left-auto z-40 w-full lg:w-[440px] flex flex-col"
            style={{ background: "var(--color-bg)", borderLeft: "1px solid var(--color-border)", boxShadow: "-8px 0 30px rgba(0,0,0,0.4)" }}>
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white" style={{ background: THEME.gradient }}>
                <Bot className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-extrabold text-sm tracking-tight text-[var(--color-text-primary)]">Pening Lab Live 🎬</div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)]">Original Video · storyboard → Omni</div>
              </div>
              {balance !== null && (
                <span className="text-[11px] font-bold px-2 py-1 rounded-full" style={{ background: balance < 5 ? "#7f1d1d" : `${THEME.color}22`, color: balance < 5 ? "#fca5a5" : THEME.color }}>
                  RM {balance.toFixed(2)}
                </span>
              )}
              <button onClick={handleClear} title="Clear" className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-muted)" }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setOpen(false)} title="Close" className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="text-center text-[13px] mt-8 text-[var(--color-text-muted)]">
                  Tekan <b style={{ color: THEME.color }}>Load Data</b> untuk pilih produk (Beg Kuning / Tiada Link), atau taip terus untuk mula.
                </div>
              )}
              {messages.map((m) => <MessageBubble key={m.id} m={m} onQuick={(t) => send(t)} disabled={loading} />)}
              {loading && (
                <div className="flex items-center gap-2 text-[13px] text-[var(--color-text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" /> Pening Lab tengah fikir…
                </div>
              )}
            </div>

            {/* Load Data dropdown */}
            {showLoad && (
              <div className="px-4 py-3 max-h-56 overflow-y-auto border-t" style={{ borderColor: "var(--color-border)", background: "var(--color-bg-card)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <button onClick={() => setShowLoad("affiliate")} className="text-[12px] font-bold px-3 py-1 rounded-full" style={{ background: showLoad === "affiliate" ? THEME.color : "var(--color-bg)", color: showLoad === "affiliate" ? "#1a1a1a" : "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>Beg Kuning ({affiliate.length})</button>
                  <button onClick={() => setShowLoad("manual")} className="text-[12px] font-bold px-3 py-1 rounded-full" style={{ background: showLoad === "manual" ? THEME.color : "var(--color-bg)", color: showLoad === "manual" ? "#1a1a1a" : "var(--color-text-secondary)", border: "1px solid var(--color-border)" }}>Tiada Link ({manual.length})</button>
                  <button onClick={() => setShowLoad(null)} className="ml-auto text-[12px] text-[var(--color-text-muted)]">✕ Tutup</button>
                </div>
                {savedList.length === 0 ? (
                  <div className="text-[12px] py-2 text-[var(--color-text-muted)]">Tiada produk tersimpan.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-1.5">
                    {savedList.map((p) => (
                      <button key={p.id} onClick={() => pickProduct(p)} className="flex items-center gap-2 text-left px-2.5 py-2 rounded-lg" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                        {p.attachments?.[0] ? (
                          <img src={p.attachments[0]} alt="" className="w-9 h-9 rounded object-cover" />
                        ) : (
                          <span className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "var(--color-bg-card)" }}><ImageIcon className="w-4 h-4 text-[var(--color-text-muted)]" /></span>
                        )}
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px] font-semibold truncate text-[var(--color-text-primary)]">{p.product_name}</span>
                          {p.detail && <span className="block text-[11px] truncate text-[var(--color-text-muted)]">{p.detail}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Composer */}
            <div className="flex items-center gap-2 px-3 py-3 border-t" style={{ borderColor: "var(--color-border)" }}>
              <button onClick={() => setShowLoad((s) => (s ? null : "affiliate"))} className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-lg whitespace-nowrap" style={{ background: THEME.color, color: "#1a1a1a" }}>
                <Package className="w-4 h-4" /> Load Data
              </button>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Taip mesej… (cth: UGC Unboxing, 10s)"
                disabled={loading}
                className="flex-1 px-3 py-2 rounded-lg text-[13px] outline-none text-[var(--color-text-primary)]"
                style={{ border: "1px solid var(--color-border)", background: "var(--color-bg-card)" }}
              />
              <button onClick={() => send(input)} disabled={loading || !input.trim()} className="p-2 rounded-lg" style={{ background: THEME.gradient, opacity: loading || !input.trim() ? 0.4 : 1 }}>
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}

function MessageBubble({ m, onQuick, disabled }: { m: Msg; onQuick: (t: string) => void; disabled: boolean }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[88%] space-y-2">
        <div className="px-3.5 py-2.5 rounded-2xl text-[13px] whitespace-pre-wrap leading-relaxed"
          style={{
            background: isUser ? THEME.color : "var(--color-bg-card)",
            color: isUser ? "#1a1a1a" : "var(--color-text-primary)",
            border: isUser ? "none" : "1px solid var(--color-border)",
            borderTopRightRadius: isUser ? 4 : 16,
            borderTopLeftRadius: isUser ? 16 : 4,
          }}>
          {m.text}
        </div>
        {(m.ui || []).map((p, i) => <MediaPayload key={i} p={p} onQuick={onQuick} disabled={disabled} />)}
      </div>
    </div>
  );
}

function MediaPayload({ p, onQuick, disabled }: { p: UiPayload; onQuick: (t: string) => void; disabled: boolean }) {
  if (p.type === "storyboard_ready") {
    return (
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
        <img src={(p as any).image_url} alt="storyboard" className="w-full block" />
        <div className="flex flex-wrap gap-1.5 p-2" style={{ background: "var(--color-bg-card)" }}>
          <button disabled={disabled} onClick={() => onQuick("✅ OK, storyboard ni cantik")} className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#14532d", color: "#86efac" }}>✅ OK</button>
          <button disabled={disabled} onClick={() => onQuick("🔁 Bagi sub style lain")} className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#1e1b4b", color: "#a5b4fc" }}>🔁 Sub lain</button>
          <button disabled={disabled} onClick={() => onQuick("🎬 Submit video sekarang")} className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: THEME.color, color: "#1a1a1a" }}>🎬 Submit video</button>
        </div>
      </div>
    );
  }
  if (p.type === "video_ready") {
    return (
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
        <video src={(p as any).output_url} controls playsInline className="w-full block" style={{ maxHeight: 460, background: "#000" }} />
        <div className="flex gap-2 p-2" style={{ background: "var(--color-bg-card)" }}>
          <a href={(p as any).output_url} target="_blank" rel="noreferrer" className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#1e1b4b", color: "#a5b4fc" }}>▶ Tonton</a>
          {(p as any).download_url && <a href={(p as any).download_url} className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#14532d", color: "#86efac" }}>📥 Download</a>}
        </div>
      </div>
    );
  }
  if (p.type === "generation_started") {
    return (
      <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#3a2a0a", color: "#fcd34d", border: "1px solid #78591c" }}>
        🎬 Video tengah render… (RM {Number((p as any).cost || 0).toFixed(2)}) — akan muncul bila siap.
      </div>
    );
  }
  return null;
}
