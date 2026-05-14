"use client";

import { useEffect, useState } from "react";
import { X, Globe } from "lucide-react";
import Portal from "./portal";

// ScrapePicker — pure DISPLAY modal for Google Images scrape results.
// Caller fires the scrape itself, then opens this modal once `images`
// is populated. No search input here — that flow is gone per design:
// "click Scrape → auto-fire → count badge → click badge to pick".
//
// `maxPick` is calculated by the caller as (3 − currentSlotCount) so the
// per-product slot cap is respected.
export default function ScrapePicker({
  open,
  onClose,
  onPickMulti,
  maxPick = 3,
  images,
  query,
  title = "Pick Scraped Images",
}: {
  open: boolean;
  onClose: () => void;
  onPickMulti: (urls: string[]) => void;
  maxPick?: number;
  // Pre-fetched candidates — caller does the scrape, this modal just
  // renders them. Must be set before opening or the grid stays empty.
  images: string[];
  // Display-only — shows what query produced these candidates so the
  // user can confirm "yes that's the right product".
  query?: string;
  title?: string;
}) {
  const [selectedIdxs, setSelectedIdxs] = useState<number[]>([]);
  const [brokenIdxs, setBrokenIdxs] = useState<Set<number>>(new Set());

  // Reset selection whenever the modal reopens or the underlying image
  // set changes so a stale pick never bleeds into the wrong product.
  useEffect(() => {
    if (open) {
      setSelectedIdxs([]);
      setBrokenIdxs(new Set());
    }
  }, [open, images]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

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
      .map((i) => images[i])
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
            <div className="flex items-center gap-2 min-w-0">
              <Globe className="w-4 h-4 flex-shrink-0" style={{ color: "#eab308" }} />
              <div className="text-sm font-bold text-gray-900 flex-shrink-0">{title}</div>
              {query && (
                <div className="text-[11px] text-gray-500 truncate">
                  for <span className="font-mono">"{query}"</span>
                </div>
              )}
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 flex-shrink-0">
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

          {/* Slots-full hint */}
          {maxPick <= 0 && (
            <div className="px-4 pt-3">
              <div
                className="text-[12px] px-2 py-1.5 rounded"
                style={{
                  background: "rgba(234,179,8,0.08)",
                  border: "1px solid rgba(234,179,8,0.3)",
                  color: "#854d0e",
                }}
              >
                Slots already full — clear a slot first to scrape replacements.
              </div>
            </div>
          )}

          {/* Results grid */}
          <div className="flex-1 overflow-auto p-4">
            {images.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-sm">
                No usable images found. Try a different product name.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {images.map((url, i) => {
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
