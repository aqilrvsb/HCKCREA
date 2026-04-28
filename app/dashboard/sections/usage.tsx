"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ImageIcon,
  Video,
  Wand2,
  Layers,
  Send,
  Filter as FilterIcon,
  Calendar,
  TrendingDown,
  X,
  Copy,
  Check,
  Image as ImageIcon2,
  Video as VideoIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "./portal";

type Filter = "all" | "image" | "video" | "auto" | "clone" | "post";

type HistoryJoin = {
  id?: string;
  type?: string | null;
  tab?: string | null;
  prompt?: string | null;
  output_url?: string | null;
  thumbnail_url?: string | null;
  duration?: number | null;
  metadata?: any; // includes .provider ("p1" | "p2") so we can surface it
};

type Tx = {
  id: string;
  amount: number; // negative for deductions
  balance_after: number;
  reason: string;
  created_at: string;
  metadata?: any;
  history?: HistoryJoin | null; // joined via history_id FK
};

const FILTER_TABS: {
  key: Filter;
  label: string;
  icon: any;
  match?: (m: string) => boolean;
}[] = [
  { key: "all", label: "All", icon: Activity },
  { key: "image", label: "Image", icon: ImageIcon, match: (m) => m.startsWith("image") },
  { key: "video", label: "Video", icon: Video, match: (m) => m.startsWith("video") || m === "cinema" },
  { key: "auto", label: "Auto", icon: Wand2, match: (m) => m.startsWith("auto") },
  { key: "clone", label: "Clone", icon: Layers, match: (m) => m.startsWith("clone") },
  { key: "post", label: "Post", icon: Send, match: (m) => m.startsWith("post") },
];

// Map raw reason → human label for the table
const REASON_LABELS: Record<string, string> = {
  image_generate: "Image generated",
  video_8s: "Video 8s generated",
  video_16s: "Video 16s generated",
  cinema: "Cinema video generated",
  auto_plan: "Auto Content plan",
  clone_plan: "Clone plan",
};

const ACCENT: Record<string, string> = {
  violet: "text-violet-600",
  blue: "text-blue-600",
  pink: "text-pink-600",
  amber: "text-amber-600",
};

export default function UsageSection({ email: _email }: { email: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [promptModal, setPromptModal] = useState<Tx | null>(null);
  const [previewModal, setPreviewModal] = useState<Tx | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const sb = createClient();
      // Nested select via PostgREST FK — credit_transactions.history_id →
      // history.id. Both rows are RLS-scoped to the same user_id so the
      // anon client can read them.
      const { data } = await sb
        .from("credit_transactions")
        .select(
          "id, amount, balance_after, reason, created_at, metadata, history:history_id(id, type, tab, prompt, output_url, thumbnail_url, duration, metadata)"
        )
        .order("created_at", { ascending: false })
        .limit(200);
      setTxs((data as any) || []);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (filter === "all") return txs;
    const matcher = FILTER_TABS.find((t) => t.key === filter)?.match;
    return matcher ? txs.filter((t) => matcher(t.reason)) : txs;
  }, [txs, filter]);

  const stats = useMemo(() => {
    let totalSpend = 0;
    let images = 0;
    let videos = 0;
    let autoPlans = 0;
    for (const t of txs) {
      if (t.amount < 0) totalSpend += -t.amount;
      if (t.reason === "image_generate") images++;
      if (t.reason === "video_8s" || t.reason === "video_16s" || t.reason === "cinema") videos++;
      if (t.reason === "auto_plan") autoPlans++;
    }
    return [
      { label: "Total spend", value: totalSpend.toFixed(2), suffix: "credits", accent: "violet" },
      { label: "Images", value: String(images), suffix: "generated", accent: "blue" },
      { label: "Videos", value: String(videos), suffix: "generated", accent: "pink" },
      { label: "Auto plans", value: String(autoPlans), suffix: "batches", accent: "amber" },
    ];
  }, [txs]);

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <div key={i} className="card relative overflow-hidden">
            <div
              className="absolute"
              style={{
                top: -30,
                right: -30,
                width: 100,
                height: 100,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${
                  s.accent === "violet"
                    ? "rgba(139,92,246,0.12)"
                    : s.accent === "blue"
                      ? "rgba(59,130,246,0.12)"
                      : s.accent === "pink"
                        ? "rgba(236,72,153,0.12)"
                        : "rgba(245,158,11,0.12)"
                }, transparent 70%)`,
              }}
            />
            <div className="relative">
              <div className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">
                {s.label}
              </div>
              <div className={`font-display font-extrabold text-3xl tracking-tight ${ACCENT[s.accent]}`}>
                {s.value}
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1">{s.suffix}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)] flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <FilterIcon className="w-4 h-4 text-[var(--color-text-muted)]" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
              Filter
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTER_TABS.map((f) => {
              const Icon = f.icon;
              const isActive = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={
                    isActive
                      ? {
                          background: "var(--color-lime)",
                          color: "#0a0a0a",
                          boxShadow: "0 2px 8px rgba(200,245,62,0.3)",
                        }
                      : {
                          background: "var(--color-bg-card)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-text-secondary)",
                        }
                  }
                >
                  <Icon className="w-3 h-3" />
                  {f.label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <Calendar className="w-3.5 h-3.5" />
            <span>All time</span>
          </div>
        </div>

        {/* Table header */}
        <div
          className="hidden md:flex px-6 py-3 border-b border-[var(--color-border)] text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold"
          style={{ background: "rgba(200,245,62,0.04)" }}
        >
          <span className="w-44">Action</span>
          <span className="flex-1">Prompt</span>
          <span className="w-20 text-center">Preview</span>
          <span className="w-32">Date</span>
          <span className="w-20 text-right">Credit</span>
          <span className="w-20 text-right">Balance</span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <div
              className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
              style={{
                background: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <TrendingDown className="w-7 h-7 text-[var(--color-text-muted)]" />
            </div>
            <p className="text-[var(--color-text-secondary)] font-medium mb-1">
              {loading ? "Loading…" : "Belum ada usage history."}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">
              Setiap kali generate image / video, deduction akan dicatat di sini.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {filtered.map((t) => {
              const isPositive = t.amount > 0;
              const label = REASON_LABELS[t.reason] || t.reason;
              const h = t.history;
              const isVid =
                h?.type === "video" ||
                h?.type === "auto-content" ||
                h?.type === "clone" ||
                h?.tab === "cinema";
              const promptShort = (h?.prompt || "").trim().substring(0, 60);
              // Which backend fulfilled this generation. Stamped at create
              // time on history.metadata.provider — "p1" (GeminiGen) or
              // "p2" (Crun.ai). Older rows without the stamp are p2.
              const provider: "p1" | "p2" =
                h?.metadata?.provider === "p1" ? "p1" : "p2";
              return (
                <li
                  key={t.id}
                  className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-2 md:gap-3 text-sm"
                >
                  <span className="w-44 font-semibold text-[var(--color-text-primary)] truncate flex items-center gap-1.5">
                    {label}
                    {!isPositive && (
                      <span
                        className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={
                          provider === "p1"
                            ? {
                                background: "rgba(99,102,241,0.12)",
                                color: "#6366f1",
                                border: "1px solid rgba(99,102,241,0.3)",
                              }
                            : {
                                background: "rgba(245,158,11,0.12)",
                                color: "#d97706",
                                border: "1px solid rgba(245,158,11,0.3)",
                              }
                        }
                        title={provider === "p1" ? "Engine P1" : "Engine P2"}
                      >
                        {provider}
                      </span>
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    {promptShort ? (
                      <button
                        onClick={() => setPromptModal(t)}
                        className="text-left text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-orange)] line-clamp-1 transition-colors w-full"
                        title="Click to view full prompt"
                      >
                        {promptShort}
                        {h?.prompt && h.prompt.length > 60 ? "…" : ""}
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)]">—</span>
                    )}
                  </span>
                  <span className="w-20 text-center">
                    {h?.output_url ? (
                      <button
                        onClick={() => setPreviewModal(t)}
                        title={isVid ? "Play video" : "Open image"}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-transform hover:scale-105"
                        style={{
                          background: "rgba(34,197,94,0.1)",
                          border: "1px solid rgba(34,197,94,0.3)",
                          color: "#22c55e",
                        }}
                      >
                        {isVid ? (
                          <VideoIcon className="w-3 h-3" strokeWidth={2.4} />
                        ) : (
                          <ImageIcon2 className="w-3 h-3" strokeWidth={2.4} />
                        )}
                        {isVid ? "Video" : "Image"}
                      </button>
                    ) : (
                      <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
                    )}
                  </span>
                  <span className="w-32 text-xs font-mono text-[var(--color-text-muted)]">
                    {new Date(t.created_at).toLocaleString("ms-MY", {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                      hour: "numeric",
                      minute: "numeric",
                    })}
                  </span>
                  <span
                    className={`w-20 text-right text-xs font-bold ${
                      isPositive ? "text-emerald-500" : "text-red-500"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {t.amount.toFixed(2)}
                  </span>
                  <span className="w-20 text-right text-xs font-mono">
                    {Number(t.balance_after).toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {promptModal && (
        <ClientPromptModal
          tx={promptModal}
          onClose={() => setPromptModal(null)}
        />
      )}
      {previewModal && (
        <ClientPreviewModal
          tx={previewModal}
          onClose={() => setPreviewModal(null)}
        />
      )}
    </div>
  );
}

function ClientPromptModal({
  tx,
  onClose,
}: {
  tx: Tx;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  async function copy() {
    if (!tx.history?.prompt) return;
    await navigator.clipboard.writeText(tx.history.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-orange)",
          boxShadow: "0 20px 60px rgba(255,87,34,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="font-display font-extrabold text-lg"
            style={{ color: "var(--color-orange)" }}
          >
            Full Prompt
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5"
          >
            <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <pre
            className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap rounded-lg p-4"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            {tx.history?.prompt || "(no prompt stored)"}
          </pre>
        </div>
        <div
          className="px-5 pb-5 pt-3 border-t flex"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={copy}
            className="flex-1 py-2.5 rounded-lg font-extrabold text-sm text-white transition-transform hover:-translate-y-0.5 inline-flex items-center justify-center gap-2"
            style={{
              background:
                "linear-gradient(90deg, var(--color-orange) 0%, #ff6a1a 100%)",
              boxShadow: "0 4px 14px rgba(255,87,34,0.3)",
            }}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied" : "Copy Prompt"}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

function ClientPreviewModal({
  tx,
  onClose,
}: {
  tx: Tx;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  const h = tx.history;
  const isVid =
    h?.type === "video" ||
    h?.type === "auto-content" ||
    h?.type === "clone" ||
    h?.tab === "cinema";
  return (
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.92)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
      <div
        className="max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {h?.output_url ? (
          isVid ? (
            <video
              src={h.output_url}
              controls
              autoPlay
              playsInline
              className="max-w-[90vw] max-h-[90vh] rounded-2xl"
            />
          ) : (
            <img
              src={h.output_url}
              alt=""
              className="max-w-[90vw] max-h-[90vh] rounded-2xl object-contain"
            />
          )
        ) : (
          <div className="text-white text-sm">No preview available</div>
        )}
      </div>
    </div>
    </Portal>
  );
}
