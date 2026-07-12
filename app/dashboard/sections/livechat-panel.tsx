"use client";

// Pening Lab Live — the native livechat for the Original Video tab.
// Talks to the cinema agent route (/api/agent/cinema/chat), which runs the
// Pening Lab GPT brain (system prompt + Expert Playbook) with 4 tools. This
// panel renders the flow: Load Data product picker → MAIN/SUB chat →
// storyboard grid (approve/revise) → Omni video (inline player + download).

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Package, ImageIcon } from "lucide-react";

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
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [affiliate, setAffiliate] = useState<SavedProduct[]>([]);
  const [manual, setManual] = useState<SavedProduct[]>([]);
  const [showLoad, setShowLoad] = useState<"affiliate" | "manual" | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Load conversation, balance, saved products ──────────────────────────
  useEffect(() => {
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
    return () => {
      cancel = true;
    };
  }, [projectId]);

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
  useEffect(() => {
    refreshBalance();
    loadSaved();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // ── Send a turn ─────────────────────────────────────────────────────────
  async function send(text: string, product?: SavedProduct) {
    if (loading) return;
    const bubble = product
      ? `📦 Guna produk: ${product.product_name}${text ? ` — ${text}` : ""}`
      : text;
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
            ? {
                product: {
                  name: product.product_name,
                  detail: product.detail || "",
                  image_urls: (product.attachments || []).filter(Boolean).slice(0, 3),
                },
              }
            : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMessages((p) => [...p, { id: mid(), role: "assistant", text: `⚠️ ${d?.error || "Ralat"}` }]);
      } else {
        setMessages((p) => [
          ...p,
          { id: mid(), role: "assistant", text: d.reply || "(tiada balasan)", ui: d.ui_payloads || [] },
        ]);
        refreshBalance();
      }
    } catch (e: any) {
      setMessages((p) => [...p, { id: mid(), role: "assistant", text: `⚠️ ${e?.message || "Ralat rangkaian"}` }]);
    } finally {
      setLoading(false);
    }
  }

  function pickProduct(p: SavedProduct) {
    setShowLoad(null);
    send("", p);
  }

  const savedList = showLoad === "affiliate" ? affiliate : showLoad === "manual" ? manual : [];

  return (
    <div className="flex flex-col rounded-2xl overflow-hidden" style={{ border: "1px solid var(--color-border,#e8e0d8)", background: "var(--color-bg,#fff)", height: 620 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--color-border,#e8e0d8)", background: "var(--color-surface,#faf8f5)" }}>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold" style={{ color: "var(--color-text,#1a1a1a)" }}>Pening Lab Live 🎬</span>
          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: "#efe7dd", color: "#8a6d3b" }}>Original Video</span>
        </div>
        <div className="flex items-center gap-2">
          {balance !== null && (
            <span className="text-[12px] font-bold px-2.5 py-1 rounded-full" style={{ background: balance < 5 ? "#fde8e8" : "#e7f5ec", color: balance < 5 ? "#b91c1c" : "#166534" }}>
              RM {balance.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ background: "var(--color-bg,#fff)" }}>
        {messages.length === 0 && (
          <div className="text-center text-[13px] mt-8" style={{ color: "var(--color-text-muted,#8a8a8a)" }}>
            Tekan <b>Load Data</b> untuk pilih produk (Beg Kuning / Tiada Link), atau taip terus untuk mula.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} onQuick={(t) => send(t)} disabled={loading} />
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--color-text-muted,#8a8a8a)" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Pening Lab tengah fikir…
          </div>
        )}
      </div>

      {/* Load Data dropdown */}
      {showLoad && (
        <div className="px-4 py-3 max-h-56 overflow-y-auto" style={{ borderTop: "1px solid var(--color-border,#e8e0d8)", background: "var(--color-surface,#faf8f5)" }}>
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setShowLoad("affiliate")} className="text-[12px] font-bold px-3 py-1 rounded-full" style={{ background: showLoad === "affiliate" ? "#f5c518" : "#eee", color: "#1a1a1a" }}>Beg Kuning ({affiliate.length})</button>
            <button onClick={() => setShowLoad("manual")} className="text-[12px] font-bold px-3 py-1 rounded-full" style={{ background: showLoad === "manual" ? "#f5c518" : "#eee", color: "#1a1a1a" }}>Tiada Link ({manual.length})</button>
            <button onClick={() => setShowLoad(null)} className="ml-auto text-[12px]" style={{ color: "#8a8a8a" }}>✕ Tutup</button>
          </div>
          {savedList.length === 0 ? (
            <div className="text-[12px] py-2" style={{ color: "#8a8a8a" }}>Tiada produk tersimpan.</div>
          ) : (
            <div className="grid grid-cols-1 gap-1.5">
              {savedList.map((p) => (
                <button key={p.id} onClick={() => pickProduct(p)} className="flex items-center gap-2 text-left px-2.5 py-2 rounded-lg" style={{ background: "#fff", border: "1px solid #e8e0d8" }}>
                  {p.attachments?.[0] ? (
                    <img src={p.attachments[0]} alt="" className="w-9 h-9 rounded object-cover" />
                  ) : (
                    <span className="w-9 h-9 rounded flex items-center justify-center" style={{ background: "#f0eae2" }}><ImageIcon className="w-4 h-4" /></span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold truncate" style={{ color: "#1a1a1a" }}>{p.product_name}</span>
                    {p.detail && <span className="block text-[11px] truncate" style={{ color: "#8a8a8a" }}>{p.detail}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <div className="flex items-center gap-2 px-3 py-3" style={{ borderTop: "1px solid var(--color-border,#e8e0d8)", background: "var(--color-surface,#faf8f5)" }}>
        <button
          onClick={() => setShowLoad((s) => (s ? null : "affiliate"))}
          className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-lg whitespace-nowrap"
          style={{ background: "#f5c518", color: "#1a1a1a" }}
        >
          <Package className="w-4 h-4" /> Load Data
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Taip mesej… (cth: UGC Unboxing, 10s)"
          disabled={loading}
          className="flex-1 px-3 py-2 rounded-lg text-[13px] outline-none"
          style={{ border: "1px solid #e8e0d8", background: "#fff", color: "#1a1a1a" }}
        />
        <button onClick={() => send(input)} disabled={loading || !input.trim()} className="p-2 rounded-lg" style={{ background: "#1a1a1a", opacity: loading || !input.trim() ? 0.4 : 1 }}>
          <Send className="w-4 h-4" style={{ color: "#fff" }} />
        </button>
      </div>
    </div>
  );
}

function MessageBubble({ m, onQuick, disabled }: { m: Msg; onQuick: (t: string) => void; disabled: boolean }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] space-y-2">
        <div
          className="px-3.5 py-2.5 rounded-2xl text-[13px] whitespace-pre-wrap leading-relaxed"
          style={{
            background: isUser ? "#1a1a1a" : "#f4f0ea",
            color: isUser ? "#fff" : "#1a1a1a",
            borderTopRightRadius: isUser ? 4 : 16,
            borderTopLeftRadius: isUser ? 16 : 4,
          }}
        >
          {m.text}
        </div>
        {(m.ui || []).map((p, i) => (
          <MediaPayload key={i} p={p} onQuick={onQuick} disabled={disabled} />
        ))}
      </div>
    </div>
  );
}

function MediaPayload({ p, onQuick, disabled }: { p: UiPayload; onQuick: (t: string) => void; disabled: boolean }) {
  if (p.type === "storyboard_ready") {
    return (
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #e8e0d8" }}>
        <img src={(p as any).image_url} alt="storyboard" className="w-full block" />
        <div className="flex flex-wrap gap-1.5 p-2" style={{ background: "#faf8f5" }}>
          <button disabled={disabled} onClick={() => onQuick("✅ OK, storyboard ni cantik")} className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#e7f5ec", color: "#166534" }}>✅ OK</button>
          <button disabled={disabled} onClick={() => onQuick("🔁 Bagi sub style lain")} className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#eef2ff", color: "#3730a3" }}>🔁 Sub lain</button>
          <button disabled={disabled} onClick={() => onQuick("🎬 Submit video sekarang")} className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#f5c518", color: "#1a1a1a" }}>🎬 Submit video</button>
        </div>
      </div>
    );
  }
  if (p.type === "video_ready") {
    return (
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #e8e0d8" }}>
        <video src={(p as any).output_url} controls playsInline className="w-full block" style={{ maxHeight: 460, background: "#000" }} />
        <div className="flex gap-2 p-2" style={{ background: "#faf8f5" }}>
          <a href={(p as any).output_url} target="_blank" rel="noreferrer" className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#eef2ff", color: "#3730a3" }}>▶ Tonton</a>
          {(p as any).download_url && (
            <a href={(p as any).download_url} className="text-[12px] font-bold px-3 py-1.5 rounded-full" style={{ background: "#e7f5ec", color: "#166534" }}>📥 Download</a>
          )}
        </div>
      </div>
    );
  }
  if (p.type === "generation_started") {
    return (
      <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa" }}>
        🎬 Video tengah render… (RM {Number((p as any).cost || 0).toFixed(2)}) — akan muncul bila siap.
      </div>
    );
  }
  return null;
}
