"use client";

import { useEffect, useMemo, useState } from "react";
import {
  History,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Plus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type HistoryItem = {
  id: string;
  type: string;
  tab: string;
  status: string;
  prompt: string | null;
  output_url: string | null;
  thumbnail_url: string | null;
  reference_url: string | null;
  duration: number | null;
  framework: string | null;
  caption: string | null;
  cost: number;
  task_id: string | null;
  error_message: string | null;
  created_at: string;
};

// Reusable "history below the form" grid. Loads + auto-polls rows for one tab.
// Used by Image, Video, Clone, Auto Content sections.
export default function HistoryGrid({
  tab,
  title,
}: {
  tab: "image" | "video" | "clone" | "auto";
  title: string;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void load();
    const onRefresh = () => load();
    window.addEventListener("history:refresh", onRefresh);
    const interval = setInterval(load, 8000);
    return () => {
      window.removeEventListener("history:refresh", onRefresh);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function load() {
    setLoading(true);
    try {
      const sb = createClient();
      const { data } = await sb
        .from("history")
        .select("*")
        .eq("tab", tab)
        .order("created_at", { ascending: false })
        .limit(60);
      setItems((data as HistoryItem[]) || []);
    } finally {
      setLoading(false);
    }
  }

  // Server-side settle for pending rows
  useEffect(() => {
    const pending = items.filter((i) => i.status === "pending" && i.task_id);
    if (!pending.length) return;
    const t = setTimeout(() => {
      Promise.all(
        pending.map((p) =>
          fetch(`/api/generate/status?id=${p.id}`, { cache: "no-store" }).catch(() => null)
        )
      ).then(() => load());
    }, 5000);
    return () => clearTimeout(t);
  }, [items]);

  const counts = useMemo(
    () => ({
      total: items.length,
      pending: items.filter((i) => i.status === "pending").length,
    }),
    [items]
  );

  return (
    <section className="card">
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-[var(--color-text-muted)]" />
          <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">
            History — {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {counts.pending > 0 && (
            <span className="text-xs font-bold flex items-center gap-1" style={{ color: "var(--color-orange)" }}>
              <Loader2 className="w-3 h-3 animate-spin" />
              {counts.pending} pending
            </span>
          )}
          <span className="text-xs text-[var(--color-text-muted)] font-mono">
            {counts.total} items
          </span>
          <button
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-white/5"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-16">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <History className="w-7 h-7 text-[var(--color-text-muted)]" />
          </div>
          <p className="text-[var(--color-text-secondary)] font-medium mb-1">
            {loading ? "Loading…" : "Belum ada history."}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Generate satu, ia akan muncul di sini.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {items.map((it) => (
            <HistoryCard key={it.id} item={it} />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryCard({ item }: { item: HistoryItem }) {
  const [extending, setExtending] = useState(false);
  const [checking, setChecking] = useState(false);
  const isVideo = item.type === "video" || item.type === "auto-content" || item.type === "clone";
  const isImage = item.type === "image";
  const canExtend = isVideo && item.status === "done" && item.output_url;

  async function extend() {
    setExtending(true);
    try {
      const r = await fetch("/api/generate/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_id: item.id }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        alert(d?.error || "Extend failed");
      } else {
        window.dispatchEvent(new CustomEvent("history:refresh"));
      }
    } finally {
      setExtending(false);
    }
  }

  async function checkNow() {
    setChecking(true);
    try {
      await fetch(`/api/generate/status?id=${item.id}`, { cache: "no-store" });
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden border"
      style={{
        background: "var(--color-bg-card)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="aspect-[9/16] bg-black relative">
        {item.status === "pending" && (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-400 text-xs font-bold gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Generating…</span>
            </div>
            <button
              onClick={checkNow}
              disabled={checking}
              title="Check status now"
              className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-50 transition"
              style={{
                background: "rgba(20,20,20,0.85)",
                border: "1px solid var(--color-border)",
                backdropFilter: "blur(8px)",
                color: "var(--color-text-primary)",
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
            </button>
          </>
        )}
        {item.status === "failed" && (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 text-xs font-bold gap-2 px-3 text-center">
              <XCircle className="w-5 h-5" />
              <span className="line-clamp-2">{item.error_message || "Failed"}</span>
            </div>
            <button
              onClick={checkNow}
              disabled={checking}
              title="Re-check"
              className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-50 transition"
              style={{
                background: "rgba(20,20,20,0.85)",
                border: "1px solid rgba(239,68,68,0.4)",
                backdropFilter: "blur(8px)",
                color: "#fca5a5",
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? "animate-spin" : ""}`} />
            </button>
          </>
        )}
        {item.status === "done" && item.output_url && (
          <>
            {isImage && (
              <img src={item.output_url} alt="" className="w-full h-full object-cover" />
            )}
            {isVideo && (
              <video
                src={item.output_url + "#t=0.5"}
                preload="metadata"
                muted
                playsInline
                className="w-full h-full object-cover"
                onClick={(e) => {
                  const v = e.currentTarget;
                  if (v.paused) v.play();
                  else v.pause();
                }}
              />
            )}
          </>
        )}
      </div>

      <div className="p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          {item.status === "done" && <CheckCircle2 className="w-3 h-3" style={{ color: "var(--color-lime)" }} />}
          {item.status === "pending" && <Loader2 className="w-3 h-3 animate-spin text-amber-400" />}
          {item.status === "failed" && <XCircle className="w-3 h-3 text-red-400" />}
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold">
            {item.framework || item.type}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] ml-auto font-mono">
            RM{Number(item.cost).toFixed(2)}
          </span>
        </div>
        {item.caption && (
          <p className="text-[10px] text-[var(--color-text-secondary)] line-clamp-2 mb-1.5">
            {item.caption}
          </p>
        )}
        {canExtend && (
          <button
            onClick={extend}
            disabled={extending}
            className="w-full mt-1.5 py-1.5 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 disabled:opacity-50 transition-colors"
            style={{
              background: "rgba(255,87,34,0.1)",
              color: "var(--color-orange)",
              border: "1px solid rgba(255,87,34,0.3)",
            }}
          >
            {extending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Plus className="w-3 h-3" />
            )}
            Extend +8s
          </button>
        )}
      </div>
    </div>
  );
}
