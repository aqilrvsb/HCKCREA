"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Wand2,
  ImageIcon,
  Video,
  Layers,
  History,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AutoContentTab from "../tabs/auto-content";
import ImageTab from "../tabs/image";
import VideoTab from "../tabs/video";
import CloneTab from "../tabs/clone";

type TabKey = "auto" | "image" | "video" | "clone";

const TABS: { key: TabKey; label: string; icon: any; tab: string }[] = [
  { key: "auto", label: "Auto Content", icon: Wand2, tab: "auto" },
  { key: "image", label: "Image", icon: ImageIcon, tab: "image" },
  { key: "video", label: "Video", icon: Video, tab: "video" },
  { key: "clone", label: "Clone", icon: Layers, tab: "clone" },
];

type HistoryItem = {
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

export default function StudioSection() {
  const [tab, setTab] = useState<TabKey>("auto");
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const active = TABS.find((t) => t.key === tab)!;

  useEffect(() => {
    void load();
    const onRefresh = () => load();
    window.addEventListener("history:refresh", onRefresh);
    const interval = setInterval(load, 8000); // background poll for pending items
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
        .limit(50);
      setItems((data as HistoryItem[]) || []);
    } finally {
      setLoading(false);
    }
  }

  // Auto-poll any pending rows so deduction kicks in + URL appears
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

  const counts = useMemo(() => {
    return {
      total: items.length,
      pending: items.filter((i) => i.status === "pending").length,
    };
  }, [items]);

  return (
    <div>
      <div className="flex flex-wrap gap-2 p-1.5 bg-white border border-[var(--color-border)] rounded-2xl shadow-sm w-fit mb-5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition ${
                isActive
                  ? "bg-orange-50 text-orange"
                  : "text-[var(--color-text-secondary)] hover:bg-gray-50"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={2.2} />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-2 gap-5 min-h-[600px]">
        {/* LEFT — Workspace */}
        <section className="card flex flex-col">
          {tab === "auto" && <AutoContentTab />}
          {tab === "image" && <ImageTab />}
          {tab === "video" && <VideoTab />}
          {tab === "clone" && <CloneTab />}
        </section>

        {/* RIGHT — History */}
        <section className="card flex flex-col">
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[var(--color-text-muted)]" />
              <h2 className="font-display font-bold text-xl">
                History — {active.label}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {counts.pending > 0 && (
                <span className="text-xs text-amber-700 font-bold flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {counts.pending} pending
                </span>
              )}
              <span className="text-xs text-[var(--color-text-muted)] font-mono">
                {counts.total} items
              </span>
              <button
                onClick={load}
                className="p-1.5 rounded-lg hover:bg-gray-100"
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
              <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mb-4">
                <History className="w-7 h-7 text-gray-300" />
              </div>
              <p className="text-[var(--color-text-secondary)] font-medium mb-1">
                {loading ? "Loading…" : "Belum ada history."}
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Generate sesuatu dahulu, output akan muncul di sini.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto -mx-4 px-4 max-h-[700px]">
              <div className="grid grid-cols-2 gap-3">
                {items.map((it) => (
                  <HistoryCard key={it.id} item={it} />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function HistoryCard({ item }: { item: HistoryItem }) {
  const isVideo = item.type === "video" || item.type === "auto-content" || item.type === "clone";
  const isImage = item.type === "image";

  return (
    <div className="rounded-xl border border-[var(--color-border)] overflow-hidden bg-white">
      <div className="aspect-[9/16] bg-gray-50 relative">
        {item.status === "pending" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-amber-700 text-xs font-semibold gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Generating…</span>
          </div>
        )}
        {item.status === "failed" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-600 text-xs font-semibold gap-2 px-3 text-center">
            <XCircle className="w-5 h-5" />
            <span className="line-clamp-2">{item.error_message || "Failed"}</span>
          </div>
        )}
        {item.status === "done" && item.output_url && (
          <>
            {isImage && (
              <img
                src={item.output_url}
                alt=""
                className="w-full h-full object-cover"
              />
            )}
            {isVideo && (
              <video
                src={item.output_url + "#t=0.5"}
                preload="metadata"
                muted
                className="w-full h-full object-cover"
                onClick={(e) => {
                  const v = e.currentTarget;
                  if (v.paused) v.play(); else v.pause();
                }}
              />
            )}
          </>
        )}
      </div>
      <div className="p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          {item.status === "done" && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
          {item.status === "pending" && <Loader2 className="w-3 h-3 animate-spin text-amber-500" />}
          {item.status === "failed" && <XCircle className="w-3 h-3 text-red-500" />}
          <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold">
            {item.framework || item.type}
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
            RM{Number(item.cost).toFixed(2)}
          </span>
        </div>
        {item.caption && (
          <p className="text-[10px] text-[var(--color-text-secondary)] line-clamp-2 mb-1">
            {item.caption}
          </p>
        )}
        {item.output_url && (
          <a
            href={item.output_url}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-orange font-bold underline"
          >
            Open
          </a>
        )}
      </div>
    </div>
  );
}
