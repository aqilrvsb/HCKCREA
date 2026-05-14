"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Search, Globe } from "lucide-react";
import Portal from "./portal";

// ScrapePicker — Google Images scrape → multi-pick modal. Optional
// companion to AttachmentPicker: lets the user auto-fetch 5 product
// image candidates from Google instead of (or in addition to) picking
// from their personal Attachments library.
//
// The modal opens with an editable search input pre-filled with whatever
// product name the caller best guesses (affiliate scrape title, first
// line of manual product info, prompt fragment, …). User can edit the
// query before hitting Search.
//
// `maxPick` is calculated by the caller as (3 − currentSlotCount) so the
// per-product slot cap is respected. If maxPick <= 0, the modal still
// opens (so the user can see why nothing's pickable) and the Use button
// stays disabled.
export default function ScrapePicker({
  open,
  onClose,
  onPickMulti,
  maxPick = 3,
  initialQuery = "",
  title = "Scrape Product Images",
}: {
  open: boolean;
  onClose: () => void;
  onPickMulti: (urls: string[]) => void;
  maxPick?: number;
  initialQuery?: string;
  title?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdxs, setSelectedIdxs] = useState<number[]>([]);
  const [brokenIdxs, setBrokenIdxs] = useState<Set<number>>(new Set());

  // Reset selection + previous results whenever the modal reopens so a
  // stale query / picks from a previous session never bleed into the
  // current product card.
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setResults([]);
      setError(null);
      setSelectedIdxs([]);
      setBrokenIdxs(new Set());
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function runSearch() {
    const q = query.trim();
    if (!q) {
      setError("Type a product name first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResults([]);
    setSelectedIdxs([]);
    setBrokenIdxs(new Set());
    try {
      const r = await fetch("/api/scrape/product-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        setError(data?.error || `Scrape failed (${r.status})`);
      } else {
        setResults(Array.isArray(data.images) ? data.images : []);
        if (!data.images?.length) {
          setError("No usable images found. Try a different query.");
        }
      }
    } catch (e: any) {
      setError(`Network: ${e?.message || "fetch failed"}`);
    } finally {
      setLoading(false);
    }
  }

  function toggle(i: number) {
    if (brokenIdxs.has(i)) return;
    setSelectedIdxs((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      if (prev.length >= maxPick) return prev;
      return [...prev, i];
    });
  }

  function commit() {
    const urls = selectedIdxs
      .map((i) => results[i])
      .filter((u): u is string => !!u);
    if (!urls.length) return;
    onPickMulti(urls);
    onClose();
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[140] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      >
        <div
          className="relative bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" style={{ color: "#eab308" }} />
              <div className="text-sm font-bold text-gray-900">{title}</div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                {selectedIdxs.length}/{Math.max(maxPick, 0)} picked
              </span>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-700"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search bar */}
          <div className="p-4 border-b">
            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !loading && runSearch()}
                placeholder="Product name to search on Google Images…"
                className="flex-1 px-3 py-2 rounded border border-gray-300 text-sm outline-none focus:border-yellow-500"
                autoFocus
              />
              <button
                type="button"
                onClick={runSearch}
                disabled={loading || !query.trim()}
                className="px-4 py-2 rounded text-sm font-bold text-white disabled:opacity-50 flex items-center gap-1.5"
                style={{ background: "#eab308" }}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Search
              </button>
            </div>
            <div className="text-[11px] text-gray-500 mt-2">
              Tip: paste the exact product name from your listing. White-bg
              hero shots give the best Veo identity match.
            </div>
            {error && (
              <div
                className="mt-2 text-[12px] px-2 py-1.5 rounded"
                style={{
                  background: "rgba(244,67,54,0.08)",
                  border: "1px solid rgba(244,67,54,0.3)",
                  color: "#b91c1c",
                }}
              >
                {error}
              </div>
            )}
            {maxPick <= 0 && (
              <div
                className="mt-2 text-[12px] px-2 py-1.5 rounded"
                style={{
                  background: "rgba(234,179,8,0.08)",
                  border: "1px solid rgba(234,179,8,0.3)",
                  color: "#854d0e",
                }}
              >
                Slots already full — clear a slot first to scrape replacements.
              </div>
            )}
          </div>

          {/* Results grid */}
          <div className="flex-1 overflow-auto p-4">
            {loading && (
              <div className="flex items-center justify-center py-12 text-gray-400 text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching Google Images…
              </div>
            )}
            {!loading && results.length === 0 && !error && (
              <div className="text-center py-12 text-gray-400 text-sm">
                Type a query and hit Search to fetch up to 5 candidates.
              </div>
            )}
            {!loading && results.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {results.map((url, i) => {
                  const order = selectedIdxs.indexOf(i);
                  const picked = order >= 0;
                  const broken = brokenIdxs.has(i);
                  return (
                    <button
                      key={url + i}
                      type="button"
                      onClick={() => toggle(i)}
                      disabled={broken}
                      className="relative aspect-square rounded-lg overflow-hidden flex items-center justify-center text-left disabled:opacity-40"
                      style={{
                        border: picked
                          ? "3px solid #eab308"
                          : "2px solid #e5e7eb",
                        background: "#fafafa",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt=""
                        className="w-full h-full object-contain bg-white"
                        referrerPolicy="no-referrer"
                        onError={() =>
                          setBrokenIdxs((prev) => {
                            const n = new Set(prev);
                            n.add(i);
                            return n;
                          })
                        }
                      />
                      {picked && (
                        <span
                          className="absolute top-1 left-1 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center"
                          style={{ background: "#eab308" }}
                        >
                          {order + 1}
                        </span>
                      )}
                      {broken && (
                        <span className="absolute inset-0 flex items-center justify-center bg-gray-100 text-[10px] text-gray-500 font-mono">
                          (image blocked)
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 p-4 border-t bg-gray-50">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded text-sm font-semibold text-gray-700 hover:bg-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={commit}
              disabled={selectedIdxs.length === 0}
              className="px-4 py-2 rounded text-sm font-bold text-white disabled:opacity-40"
              style={{ background: "#eab308" }}
            >
              Use {selectedIdxs.length || ""} image
              {selectedIdxs.length === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
