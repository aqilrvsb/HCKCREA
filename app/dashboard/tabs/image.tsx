"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { isVisibleAfterTtl, fetchSavedSet } from "@/lib/history-filter";
import {
  AVATAR_PROMPTS,
  AVATAR_LABELS,
  PRODUCT_PROMPTS as EXT_PRODUCT_PROMPTS,
  PRODUCT_LABELS,
  SOFT_SELL_PROMPT,
  HARD_SELL_PROMPT,
  VIRT_EXAMPLE_PROMPT,
} from "@/lib/extension-prompts";

// Image tab — 1:1 port of creative-hack-auto's image-mode-section.
// Light/white cards on cream canvas, orange accents (was green).
// Keeps the colorful preset chips from the extension verbatim.

type Status = "idle" | "submitting" | "polling" | "done" | "failed";
type Mode = "create" | "virtualize";
type PromptCat = "avatar" | "product" | "sales";
type ImageModel = "nano-banana-pro" | "gpt-image-2";

const MODEL_OPTIONS: { key: ImageModel; label: string }[] = [
  { key: "nano-banana-pro", label: "Banana Pro" },
  { key: "gpt-image-2", label: "GPT Image 2" },
];

const ORANGE = "#facc15";
const ORANGE_SOFT = "rgba(255, 87, 34, 0.18)";
const ORANGE_FAINT = "rgba(255, 87, 34, 0.06)";

// Avatar prompt presets — one chip per persona, color-coded like the extension
// Build chip lists from extension's exact prompts (idx-based)
const AVATAR_FEMALE = AVATAR_LABELS
  .filter((a) => !a.male && a.idx <= 5)
  .map((a) => ({ label: a.label, color: a.color, val: AVATAR_PROMPTS[a.idx] }));
const AVATAR_MALE = AVATAR_LABELS
  .filter((a) => a.idx >= 6)
  .map((a) => ({ label: a.label, color: a.color, val: AVATAR_PROMPTS[a.idx] }));

const PRODUCT_PROMPTS = PRODUCT_LABELS.map((p) => ({
  label: p.label,
  color: p.color,
  val: EXT_PRODUCT_PROMPTS[p.idx],
}));

const SALES_PROMPTS = [
  { label: "Soft Sales", color: "#4caf50", val: SOFT_SELL_PROMPT },
  { label: "Hard Sell", color: "#f44336", val: HARD_SELL_PROMPT },
];

type RefSlot = "char" | "product" | "poster" | "virtProduct";

export default function ImageTab({ projectId }: { projectId?: string } = {}) {
  const [model, setModel] = useState<ImageModel>("nano-banana-pro");
  const [mode, setMode] = useState<Mode>("create");
  const [prompt, setPrompt] = useState("");
  const [charUrl, setCharUrl] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [virtProductUrl, setVirtProductUrl] = useState("");
  const [promptCat, setPromptCat] = useState<PromptCat>("avatar");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);

  // History picker modal state — which slot is being filled
  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);

  const charInputRef = useRef<HTMLInputElement | null>(null);
  const productInputRef = useRef<HTMLInputElement | null>(null);
  const posterInputRef = useRef<HTMLInputElement | null>(null);
  const virtProductInputRef = useRef<HTMLInputElement | null>(null);

  function pickFromHistory(slot: RefSlot, url: string) {
    if (slot === "char") setCharUrl(url);
    else if (slot === "product") setProductUrl(url);
    else if (slot === "poster") setPosterUrl(url);
    else if (slot === "virtProduct") setVirtProductUrl(url);
    setPickerSlot(null);
  }

  // No client poll — webhook + manual refresh icon on the history card
  // settle pending rows. We just dispatch history:refresh after submit so
  // the placeholder appears immediately.

  // Eager-upload: file pick → instant data: preview → background upload to
  // RunningHub. By the time the user clicks Generate, the state already
  // holds the public RH URL (so submit's ensurePublicUrl is a no-op and the
  // generate POST fires immediately). If the upload fails, the data: URL
  // stays in state and ensurePublicUrl will retry at submit time.
  function readFile(f: File | null, set: (s: string) => void) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      set(dataUrl);
      // Kick off background upload — fire-and-forget, swap state when ready
      (async () => {
        try {
          const { url } = await uploadImage(f);
          set(url);
        } catch {
          // Silent — keep data: URL; submit's ensurePublicUrl handles retry
        }
      })();
    };
    reader.readAsDataURL(f);
  }

  // Upload-on-demand: turns a data: URL into a public RunningHub URL.
  // Pass-through if already public.
  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const file = await dataUrlToFile(v, "upload.png");
    const { url } = await uploadImage(file);
    return url;
  }

  async function submit() {
    if (!prompt.trim()) return setError("Sila masukkan prompt.");
    setError(null);
    setStatus("submitting");
    setOutputUrl(null);

    try {
      // Upload any locally-previewed images to RunningHub now (before we
      // hit the generate endpoint). Pass-through for already-public URLs.
      const [charPub, productPub, posterPub, virtProductPub] = await Promise.all([
        ensurePublicUrl(charUrl),
        ensurePublicUrl(productUrl),
        ensurePublicUrl(posterUrl),
        ensurePublicUrl(virtProductUrl),
      ]);

      const refs =
        mode === "virtualize"
          ? [posterPub, virtProductPub].filter(Boolean)
          : [charPub, productPub].filter(Boolean);

      const r = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt: prompt.trim(),
          reference_url: refs[0] || undefined,
          reference_urls: refs.length > 1 ? refs : undefined,
          aspect_ratio: "9:16",
          project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!d?.ok) {
        setError(d?.error || "Generation failed");
        setStatus("failed");
        return;
      }
      setHistoryId(d.history_id);
      setCost(d.cost);
      window.dispatchEvent(new CustomEvent("history:refresh"));
      // Placeholder is now in history — fire-and-forget. Reset the button so
      // the user can immediately fire the next generation.
      setStatus("idle");
    } catch (e: any) {
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  const busy = status === "submitting" || status === "polling";

  // Light cream canvas with very subtle radial — overrides the dark parent
  const sectionBg: React.CSSProperties = {
    background:
      "radial-gradient(ellipse 1200px 800px at 50% 0%, #fff7f2 0%, #fafaf7 40%, #f5f5f0 100%)",
    color: "#1a1a1a",
    boxShadow: "0 0 0 1px rgba(255, 87, 34, 0.08)",
  };

  return (
    <div className="rounded-3xl p-6 md:p-8 space-y-5" style={sectionBg}>
      {/* IMAGE GENERATOR — Model + Mode selectors */}
      <Card borderColor={ORANGE}>
        <CardHeader icon="🖼️" title="Image Generator" />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Model</Label>
            <Select value={model} onChange={(v) => setModel(v as ImageModel)}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Mode</Label>
            <Select value={mode} onChange={(v) => setMode(v as Mode)}>
              <option value="create">Create Image</option>
              <option value="virtualize">Virtualize (Poster/Ad)</option>
            </Select>
          </div>
        </div>
      </Card>

      {/* CREATE MODE — Character + Product references (both optional).
          Matches AI Agent UGC's avatar/product slot pattern. Generation
          falls back to text-to-image when both are empty. */}
      {mode === "create" && (
        <>
          <Card>
            <CardHeader
              icon="👤"
              title="Avatar Reference (Optional)"
              right={<HistoryBtn onClick={() => setPickerSlot("char")}>From History</HistoryBtn>}
            />
            <RefZone
              url={charUrl}
              icon="📸"
              title="Click or drop character face image"
              subtitle="Face / person — used for all variations"
              onPick={() => charInputRef.current?.click()}
              onClear={() => setCharUrl("")}
            />
            <input
              ref={charInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => readFile(e.target.files?.[0] || null, setCharUrl)}
            />
          </Card>

          <Card>
            <CardHeader
              icon="📦"
              title="Product Reference (Optional)"
              right={<HistoryBtn onClick={() => setPickerSlot("product")}>From History</HistoryBtn>}
            />
            <RefZone
              url={productUrl}
              icon="📦"
              title="Click or drop product photo"
              subtitle="Keeps packaging, labels, colors accurate"
              onPick={() => productInputRef.current?.click()}
              onClear={() => setProductUrl("")}
            />
            <input
              ref={productInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => readFile(e.target.files?.[0] || null, setProductUrl)}
            />
          </Card>

          <p className="text-[11px] text-gray-500 text-center -mt-2">
            Both optional. Upload nothing → text-to-image. Upload one → reference.
            Upload both → both used as references.
          </p>
        </>
      )}

      {/* VIRTUALIZE MODE — Poster + Product side-by-side */}
      {mode === "virtualize" && (
        <Card borderColor="#e91e63">
          <CardHeader
            icon="🎨"
            title="Virtualize"
            right={<Badge color="#e91e63">Upload existing poster/ad + product</Badge>}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-bold" style={{ color: "#e91e63" }}>
                  Poster / Ad Image
                </div>
                <HistoryBtn onClick={() => setPickerSlot("poster")}>
                  From History
                </HistoryBtn>
              </div>
              <RefZone
                url={posterUrl}
                icon="🖼️"
                title=""
                subtitle="Upload existing poster or ad design"
                small
                onPick={() => posterInputRef.current?.click()}
                onClear={() => setPosterUrl("")}
              />
              <input
                ref={posterInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => readFile(e.target.files?.[0] || null, setPosterUrl)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-bold" style={{ color: ORANGE }}>
                  Product Photo
                </div>
                <HistoryBtn onClick={() => setPickerSlot("virtProduct")}>
                  From History
                </HistoryBtn>
              </div>
              <RefZone
                url={virtProductUrl}
                icon="📦"
                title=""
                subtitle="Upload real product photo"
                small
                onPick={() => virtProductInputRef.current?.click()}
                onClear={() => setVirtProductUrl("")}
              />
              <input
                ref={virtProductInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => readFile(e.target.files?.[0] || null, setVirtProductUrl)}
              />
            </div>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            AI will recreate the poster design with your actual product. Keep exact product details, labels, and packaging.
          </p>
          <button
            onClick={() => setPrompt(VIRT_EXAMPLE_PROMPT)}
            className="mt-2 w-full py-1.5 rounded-md text-xs font-bold transition"
            style={{
              background: "rgba(233,30,99,0.08)",
              border: "1px solid #e91e63",
              color: "#e91e63",
            }}
          >
            View Example Prompt
          </button>
        </Card>
      )}

      {/* PROMPT & SETTINGS */}
      <Card>
        <CardHeader icon="✏️" title="Prompt & Settings" />
        <Label>Prompt</Label>

        {/* Prompt category tabs (Avatar/Product/Sales) */}
        <div
          className="flex rounded-xl overflow-hidden mb-4"
          style={{ border: "1px solid #e8e0d8", padding: 4, gap: 4, background: "#fafaf7" }}
        >
          {(
            [
              { k: "avatar", icon: "👤", label: "Avatar" },
              { k: "product", icon: "📦", label: "Product" },
              { k: "sales", icon: "💰", label: "Sales" },
            ] as { k: PromptCat; icon: string; label: string }[]
          ).map((t) => {
            const active = promptCat === t.k;
            return (
              <button
                key={t.k}
                onClick={() => setPromptCat(t.k)}
                className="flex-1 py-2.5 text-[12px] font-extrabold rounded-lg transition-all"
                style={
                  active
                    ? {
                        background: ORANGE,
                        color: "#000",
                        boxShadow: "0 4px 12px rgba(250, 204, 21, 0.3)",
                      }
                    : { background: "transparent", color: "#666" }
                }
              >
                {t.icon} {t.label}
              </button>
            );
          })}
        </div>

        {/* Avatar presets */}
        {promptCat === "avatar" && (
          <div className="space-y-3 mb-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                👩 Female
              </div>
              <div className="flex flex-wrap gap-1.5">
                {AVATAR_FEMALE.map((p) => (
                  <PresetChip key={p.label} {...p} onClick={() => setPrompt(p.val)} />
                ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
                👨 Male
              </div>
              <div className="flex flex-wrap gap-1.5">
                {AVATAR_MALE.map((p) => (
                  <PresetChip key={p.label} {...p} onClick={() => setPrompt(p.val)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Product presets */}
        {promptCat === "product" && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {PRODUCT_PROMPTS.map((p) => (
              <PresetChip key={p.label} {...p} onClick={() => setPrompt(p.val)} />
            ))}
          </div>
        )}

        {/* Sales presets */}
        {promptCat === "sales" && (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {SALES_PROMPTS.map((p) => (
              <button
                key={p.label}
                onClick={() => setPrompt(p.val)}
                className="py-3 rounded-lg text-sm font-extrabold transition-all hover:-translate-y-0.5"
                style={{
                  background: `${p.color}12`,
                  border: `1.5px solid ${p.color}`,
                  color: p.color,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        <textarea
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe your scene — or click a preset above for ready-made prompts"
          className="w-full p-3.5 rounded-xl text-sm resize-y outline-none transition-colors focus:border-orange-400"
          style={{
            background: "#fafaf7",
            border: "1px solid #e8e0d8",
            color: "#1a1a1a",
            lineHeight: 1.5,
          }}
        />

        <button
          onClick={submit}
          disabled={busy}
          className="w-full mt-5 py-3.5 rounded-xl font-extrabold text-base text-black transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
          style={{
            background: `linear-gradient(135deg, #facc15 0%, #fde047 100%)`,
            boxShadow:
              "0 6px 20px rgba(250, 204, 21, 0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting…
            </span>
          ) : (
            <>🖼️ Generate Image</>
          )}
        </button>

        {error && (
          <div
            className="mt-3 px-4 py-2.5 rounded-lg text-xs font-semibold"
            style={{
              background: "rgba(244,67,54,0.08)",
              border: "1px solid rgba(244,67,54,0.4)",
              color: "#c62828",
            }}
          >
            {error}
          </div>
        )}

      </Card>

      {/* From History picker modal */}
      {pickerSlot && (
        <HistoryPicker
          onPick={(url) => pickFromHistory(pickerSlot, url)}
          onClose={() => setPickerSlot(null)}
        />
      )}

      {/* Image Agent panel is mounted at dashboard-shell level so it
          persists across tab switches — see DashboardShell. */}
    </div>
  );
}

// ── History Picker Modal ─────────────────────────────────────────────────────

function HistoryPicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<
    { id: string; output_url: string; prompt: string | null; created_at: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const sb = createClient();
      const { data } = await sb
        .from("history")
        .select("id, output_url, prompt, created_at")
        .eq("type", "image")
        .eq("status", "done")
        .not("output_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      const rows = (data as any[]) || [];
      // Hide rows whose 14-day TTL is up AND that weren't saved to
      // Storage — same rule the main HistoryGrid applies, so a row
      // gone from the grid is also gone from the picker.
      const saved = await fetchSavedSet(rows.map((r: any) => r.id));
      const visible = rows.filter((r: any) => isVisibleAfterTtl(r.created_at, saved.has(r.id)));
      setItems(visible as any);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        style={{
          background: "#ffffff",
          border: `2px solid ${ORANGE}`,
          boxShadow: "0 20px 60px rgba(255, 87, 34, 0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#d8e8d0" }}
        >
          <h2
            className="font-display font-extrabold text-lg"
            style={{ color: ORANGE }}
          >
            Pick Image from History
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loading ? (
            <div className="py-16 text-center text-gray-500 text-sm">
              <Loader2
                className="w-5 h-5 animate-spin inline-block mr-2"
                style={{ color: ORANGE }}
              />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-4xl mb-2">📭</div>
              <p className="text-sm font-semibold text-gray-700 mb-1">
                Belum ada image dalam history
              </p>
              <p className="text-xs text-gray-500">
                Generate satu image dulu, lepas tu boleh pick dari sini.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => onPick(it.output_url)}
                  className="rounded-lg overflow-hidden border-2 transition-all hover:-translate-y-0.5 text-left"
                  style={{ borderColor: "#d8e8d0", background: "#fafaf7" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = ORANGE)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = "#d8e8d0")
                  }
                >
                  <div className="aspect-square bg-gray-100">
                    <img
                      src={it.output_url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {it.prompt && (
                    <div
                      className="px-2 py-1.5 text-[10px] truncate"
                      style={{ color: ORANGE }}
                    >
                      {it.prompt.substring(0, 40)}
                      {it.prompt.length > 40 ? "…" : ""}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Card({
  children,
  borderColor,
}: {
  children: React.ReactNode;
  borderColor?: string;
}) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "#ffffff",
        border: `1px solid ${borderColor || "#e8e0d8"}`,
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.03), 0 4px 16px -4px rgba(0,0,0,0.04)",
        ...(borderColor
          ? { borderTopWidth: 3, borderTopColor: borderColor }
          : {}),
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  icon,
  title,
  right,
}: {
  icon: string;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="text-lg">{icon}</span>
      <span
        className="text-[13px] font-extrabold uppercase tracking-[0.06em]"
        style={{ color: "#1a1a1a" }}
      >
        {title}
      </span>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-extrabold uppercase tracking-[0.1em] mb-2"
      style={{ color: "#888" }}
    >
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  children,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  width?: number;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3.5 py-2.5 rounded-lg text-sm font-semibold outline-none transition-colors focus:border-orange-400"
      style={{
        width: width ? `${width}px` : "100%",
        background: "#fafaf7",
        border: "1px solid #e8e0d8",
        color: "#1a1a1a",
      }}
    >
      {children}
    </select>
  );
}

function RefZone({
  url,
  icon,
  title,
  subtitle,
  small,
  uploading,
  onPick,
  onClear,
}: {
  url: string;
  icon: string;
  title: string;
  subtitle: string;
  small?: boolean;
  uploading?: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  if (url) {
    return (
      <div
        className="rounded-xl overflow-hidden relative"
        style={{
          border: `2px solid ${ORANGE}`,
          boxShadow: "0 4px 12px rgba(255, 87, 34, 0.15)",
        }}
      >
        <img src={url} alt="" className="w-full max-h-56 object-cover" />
        {uploading && (
          <div
            className="absolute inset-0 flex items-center justify-center text-white"
            style={{
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(2px)",
            }}
          >
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-md text-xs font-bold">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Uploading…
            </div>
          </div>
        )}
        <button
          onClick={onClear}
          className="absolute top-2 right-2 w-7 h-7 rounded-full text-white text-xs hover:bg-red-500 transition shadow-md"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
        >
          ✕
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onPick}
      className={`w-full ${small ? "p-4" : "p-7 md:p-8"} rounded-xl text-center cursor-pointer transition-all hover:-translate-y-0.5`}
      style={{
        border: `2px dashed ${ORANGE_SOFT}`,
        background: ORANGE_FAINT,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = ORANGE;
        e.currentTarget.style.background = "rgba(255, 87, 34, 0.08)";
        e.currentTarget.style.boxShadow = "0 0 24px rgba(255, 87, 34, 0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = ORANGE_SOFT;
        e.currentTarget.style.background = ORANGE_FAINT;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div
        className={`${small ? "text-2xl" : "text-4xl md:text-5xl"} mb-2 opacity-75`}
      >
        {icon}
      </div>
      {title && (
        <div className="text-sm font-semibold text-gray-700 mb-1">{title}</div>
      )}
      <div className="text-[11px] text-gray-500">{subtitle}</div>
    </button>
  );
}

function HistoryBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] px-2.5 py-1 rounded-md transition-colors hover:opacity-80"
      style={{
        background: ORANGE_FAINT,
        border: `1px solid ${ORANGE}`,
        color: ORANGE,
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="text-[8px] px-2 py-0.5 rounded-full font-semibold"
      style={{
        background: `${color}14`,
        color,
        border: `1px solid ${color}40`,
      }}
    >
      {children}
    </span>
  );
}

function PresetChip({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all flex-1 min-w-[80px] hover:-translate-y-0.5"
      style={{
        background: `${color}12`,
        border: `1px solid ${color}`,
        color,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `${color}1f`;
        e.currentTarget.style.boxShadow = `0 4px 12px ${color}25`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = `${color}12`;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {label}
    </button>
  );
}
