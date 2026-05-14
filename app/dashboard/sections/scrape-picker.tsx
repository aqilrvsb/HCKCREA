"use client";

import { useEffect, useState } from "react";
import { X, Globe, Loader2, CheckCircle2 } from "lucide-react";
import Portal from "./portal";

// ScrapePicker — display + save modal for Google Images scrape results.
// Flow:
//   1. Caller fires the scrape and passes results into `images` + opens modal.
//   2. User multi-picks up to 5 candidates from the grid.
//   3. "Save to Attachments" — modal POSTs each picked URL to
//      /api/attachments/import-from-urls which rehosts on B2 + creates
//      Attachment rows in the user's library.
//   4. User then opens the normal Attachments picker (from any tab) and
//      sees the new scraped ones with category=product.
//
// We never write directly to product slots — keeps Scrape and Generate
// as separate workflows so users build their asset library deliberately.

const MAX_PICK = 5;

export default function ScrapePicker({
  open,
  onClose,
  images,
  query,
  productName,
  title = "Pick Scraped Images",
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  images: string[];
  // Cleaned query (e.g. "LUQFA Lotion 100ml") shown in the header so
  // user can confirm "yes that's the right product".
  query?: string;
  // Stamped as the Attachment row's `name` so the library shows useful
  // labels instead of "Scraped 2026-05-14".
  productName?: string;
  title?: string;
  // Fired after a successful save so the parent can show a toast or
  // refresh anything that lists attachments. Optional.
  onSaved?: (imported: number) => void;
}) {
  const [selectedIdxs, setSelectedIdxs] = useState<number[]>([]);
  const [brokenIdxs, setBrokenIdxs] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<
    { imported: number; skipped: number } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedIdxs([]);
      setBrokenIdxs(new Set());
      setSaving(false);
      setSaveResult(null);
      setError(null);
    }
  }, [open, images]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  if (!open) return null;

  function toggle(i: number) {
    if (brokenIdxs.has(i) || saving) return;
    setSelectedIdxs((prev) => {
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      if (prev.length >= MAX_PICK) return prev;
      return [...prev, i];
    });
  }

  async function save() {
    if (saving) return;
    const urls = selectedIdxs
      .map((i) => images[i])
      .filter((u): u is string => !!u);
    if (!urls.length) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/attachments/import-from-urls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          urls,
          name: productName || query || "",
          category: "product",
        }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${r.status}`);
      }
      setSaveResult({ imported: data.imported || 0, skipped: data.skipped || 0 });
      onSaved?.(data.imported || 0);
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[140] flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
        onClick={() => !saving && onClose()}
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
                {selectedIdxs.length}/{MAX_PICK} picked
              </span>
            </div>
            <button
              onClick={() => !saving && onClose()}
              className="text-gray-400 hover:text-gray-700"
              aria-label="Close"
              disabled={saving}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Success / error banner */}
          {saveResult && (
            <div className="px-4 pt-3">
              <div
                className="text-[12px] px-2 py-1.5 rounded flex items-center gap-2"
                style={{
                  background: "rgba(34,197,94,0.08)",
                  border: "1px solid rgba(34,197,94,0.3)",
                  color: "#166534",
                }}
              >
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>
                  Saved {saveResult.imported} to Attachments
                  {saveResult.skipped > 0 && ` (${saveResult.skipped} skipped — broken URL or wrong type)`}
                  . Open the Attachments picker to use them.
                </span>
              </div>
            </div>
          )}
          {error && (
            <div className="px-4 pt-3">
              <div
                className="text-[12px] px-2 py-1.5 rounded"
                style={{
                  background: "rgba(244,67,54,0.08)",
                  border: "1px solid rgba(244,67,54,0.3)",
                  color: "#b91c1c",
                }}
              >
                ✗ {error}
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
                      disabled={broken || saving}
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
              disabled={saving}
              className="px-4 py-2 rounded text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-40"
            >
              {saveResult ? "Close" : "Cancel"}
            </button>
            <button
              onClick={save}
              disabled={selectedIdxs.length === 0 || saving || !!saveResult}
              className="px-4 py-2 rounded text-sm font-bold text-white disabled:opacity-40 flex items-center gap-1.5"
              style={{ background: "#eab308" }}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  Save {selectedIdxs.length || ""} to Attachments
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
