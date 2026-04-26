"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Image tab — 1:1 port of creative-hack-auto's image-mode-section.
// Light/white cards on cream canvas, orange accents (was green).
// Keeps the colorful preset chips from the extension verbatim.

type Status = "idle" | "submitting" | "polling" | "done" | "failed";
type Mode = "create" | "virtualize";
type PromptCat = "avatar" | "product" | "sales";

const ORANGE = "#ff5722";
const ORANGE_SOFT = "rgba(255, 87, 34, 0.18)";
const ORANGE_FAINT = "rgba(255, 87, 34, 0.06)";

// Avatar prompt presets — one chip per persona, color-coded like the extension
const AVATAR_FEMALE = [
  { label: "Kebaya 20s", color: "#e91e63", val: "Photoreal portrait of a young attractive Malay woman in her 20s wearing a traditional kebaya, soft natural lighting, holding the product elegantly, warm Malaysian aesthetic, vertical 9:16 composition" },
  { label: "Casual 20s", color: "#e91e63", val: "Photoreal portrait of a young Malay woman in her 20s with shoulder-length wavy hair, casual cream blouse, holding the product naturally, soft daylight, authentic UGC vibe, vertical 9:16" },
  { label: "Makcik", color: "#9c27b0", val: "Photoreal portrait of a warm middle-aged Malay woman in her 40s wearing a maroon hijab, motherly smile, holding the product, kitchen background in soft bokeh, vertical 9:16" },
  { label: "Kitchen", color: "#9c27b0", val: "Photoreal portrait of a Malay woman in her 30s in a casual home outfit, standing in a sunlit kitchen, holding the product near a wok, warm tungsten lighting, vertical 9:16" },
  { label: "Nenek", color: "#ff9800", val: "Photoreal portrait of an elderly gentle Malay grandmother in her 60s wearing a soft pastel hijab, warm wise smile, holding the product, soft window daylight, vertical 9:16" },
  { label: "Nenek Garden", color: "#ff9800", val: "Photoreal portrait of an elderly Malay grandmother holding the product in a sunlit garden setting, plants and greenery in soft bokeh, golden hour, peaceful vibe, vertical 9:16" },
];

const AVATAR_MALE = [
  { label: "Baju Melayu 20s", color: "#2196f3", val: "Photoreal portrait of a young Malay man in his 20s wearing a baju melayu, neat appearance, holding the product, warm cultural aesthetic, soft daylight, vertical 9:16" },
  { label: "Casual 20s", color: "#2196f3", val: "Photoreal portrait of a young Malay man in his 20s wearing a casual dark tee, confident genuine smile, holding the product, soft daylight, authentic UGC, vertical 9:16" },
  { label: "Abang Pro", color: "#009688", val: "Photoreal portrait of a Malay man in his 30s in a smart-casual shirt, professional confident demeanor, holding the product, office or studio backdrop, vertical 9:16" },
  { label: "Pakcik", color: "#795548", val: "Photoreal portrait of a friendly middle-aged Malay man in his 40s, casual short sleeve, warm welcoming smile, holding the product, soft daylight, vertical 9:16" },
];

const PRODUCT_PROMPTS = [
  { label: "Smoke Rock", color: "#00bcd4", val: "Cinematic product shot of the product on a dark volcanic rock surface with wisps of smoke around it, dramatic side lighting, hyperreal commercial photography, 1:1 composition" },
  { label: "Floating Wood", color: "#795548", val: "Cinematic product shot of the product floating above a polished wood surface with soft shadow beneath, warm spotlight, premium product photography, 1:1 composition" },
  { label: "Burst Spice", color: "#ff9800", val: "Hyperreal product shot of the product surrounded by bursting spice particles mid-air, vibrant orange-red palette, dynamic energy, commercial photography, 1:1" },
  { label: "Moss Garden", color: "#4caf50", val: "Cinematic product shot of the product nestled in lush green moss with dewdrops, soft natural light, organic premium feel, 1:1 composition" },
  { label: "Water Drop", color: "#2196f3", val: "Hyperreal product shot of the product with a giant crystal-clear water splash erupting around it, frozen mid-action, cinematic backlighting, 1:1" },
  { label: "Stone Leaf", color: "#9c27b0", val: "Cinematic product shot of the product placed on smooth stone slab with a single fresh leaf beside it, minimalist zen aesthetic, soft daylight, 1:1" },
  { label: "Mist Powder", color: "#009688", val: "Hyperreal product shot of the product with fine powder mist drifting around it, dreamy atmospheric look, side lighting, premium feel, 1:1" },
];

const SALES_PROMPTS = [
  { label: "Soft Sales", color: "#4caf50", val: "Authentic UGC-style image of a relatable everyday Malay person holding the product naturally, warm friendly expression, soft natural lighting, makes the viewer feel 'this is a real person who actually uses this' — gentle storytelling vibe, vertical 9:16" },
  { label: "Hard Sell", color: "#f44336", val: "Bold high-impact image of the product with dramatic lighting, '50% OFF' or urgency feel, vibrant red and orange color palette, eye-catching commercial poster aesthetic, vertical 9:16, optimized for thumb-stop on TikTok feed" },
];

type RefSlot = "char" | "product" | "poster" | "virtProduct";

export default function ImageTab() {
  const [mode, setMode] = useState<Mode>("create");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(1);
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

  // Poll status
  useEffect(() => {
    if (!historyId || (status !== "polling" && status !== "submitting")) return;
    let mounted = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/generate/status?id=${historyId}`, { cache: "no-store" });
        const d = await r.json();
        if (!mounted) return;
        const h = d?.history;
        if (h?.status === "done") {
          setOutputUrl(h.output_url);
          setStatus("done");
          window.dispatchEvent(new CustomEvent("history:refresh"));
          return;
        }
        if (h?.status === "failed") {
          setError(h.error_message || "Generation failed");
          setStatus("failed");
          return;
        }
      } catch {}
      if (mounted && (status === "polling" || status === "submitting")) {
        setTimeout(tick, 4000);
      }
    };
    setStatus("polling");
    tick();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId]);

  function readFile(f: File | null, set: (s: string) => void) {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => set(String(r.result || ""));
    r.readAsDataURL(f);
  }

  async function submit() {
    if (!prompt.trim()) return setError("Sila masukkan prompt.");
    setError(null);
    setStatus("submitting");
    setOutputUrl(null);

    const refs =
      mode === "virtualize"
        ? [posterUrl, virtProductUrl].filter(Boolean)
        : [charUrl, productUrl].filter(Boolean);

    try {
      const calls = Array.from({ length: count }).map(() =>
        fetch("/api/generate/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            reference_url: refs[0] || undefined,
            reference_urls: refs.length > 1 ? refs : undefined,
            aspect_ratio: "9:16",
          }),
        }).then((r) => r.json())
      );
      const results = await Promise.all(calls);
      const first = results.find((d) => d?.ok);
      if (!first) {
        setError(results.find((d) => d?.error)?.error || "Generation failed");
        setStatus("failed");
        return;
      }
      setHistoryId(first.history_id);
      setCost(first.cost);
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  const busy = status === "submitting" || status === "polling";

  // Light theme — overrides the dark parent card
  const sectionBg: React.CSSProperties = { background: "#fafaf7", color: "#1a1a1a" };

  return (
    <div className="rounded-2xl p-4 space-y-3" style={sectionBg}>
      {/* IMAGE GENERATOR — Mode selector */}
      <Card borderColor={ORANGE}>
        <CardHeader icon="🖼️" title="Image Generator" />
        <Label>Mode</Label>
        <Select value={mode} onChange={(v) => setMode(v as Mode)}>
          <option value="create">Create Image</option>
          <option value="virtualize">Virtualize (Poster/Ad)</option>
        </Select>
      </Card>

      {/* CREATE MODE — Character + Product references */}
      {mode === "create" && (
        <>
          <Card>
            <CardHeader
              icon="🧑"
              title="Character Reference"
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
              title="Product Reference"
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
            onClick={() => setPrompt("Recreate the uploaded poster with the new product, keeping the exact original layout, typography, and design — only swap the product visual to match the second uploaded image. Preserve all text, colors, and composition.")}
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
          className="flex rounded-lg overflow-hidden mb-2"
          style={{ border: "1px solid #d8e8d0" }}
        >
          {(
            [
              { k: "avatar", icon: "👤", label: "Avatar" },
              { k: "product", icon: "📦", label: "Product" },
              { k: "sales", icon: "💰", label: "Sales" },
            ] as { k: PromptCat; icon: string; label: string }[]
          ).map((t, i) => {
            const active = promptCat === t.k;
            return (
              <button
                key={t.k}
                onClick={() => setPromptCat(t.k)}
                className="flex-1 py-1.5 text-[10px] font-extrabold transition-colors"
                style={{
                  background: active ? ORANGE : "#f5f5f0",
                  color: active ? "white" : "#666",
                  borderLeft: i === 0 ? "none" : "1px solid #d8e8d0",
                }}
              >
                {t.icon} {t.label}
              </button>
            );
          })}
        </div>

        {/* Avatar presets */}
        {promptCat === "avatar" && (
          <>
            <div className="text-[8px] text-gray-500 mb-1">👩 Female</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {AVATAR_FEMALE.map((p) => (
                <PresetChip key={p.label} {...p} onClick={() => setPrompt(p.val)} />
              ))}
            </div>
            <div className="text-[8px] text-gray-500 mb-1">👨 Male</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {AVATAR_MALE.map((p) => (
                <PresetChip key={p.label} {...p} onClick={() => setPrompt(p.val)} />
              ))}
            </div>
          </>
        )}

        {/* Product presets */}
        {promptCat === "product" && (
          <div className="flex flex-wrap gap-1 mb-2">
            {PRODUCT_PROMPTS.map((p) => (
              <PresetChip key={p.label} {...p} onClick={() => setPrompt(p.val)} />
            ))}
          </div>
        )}

        {/* Sales presets — Soft Sales (green→keep green) + Hard Sell (red) */}
        {promptCat === "sales" && (
          <div className="flex gap-1 mb-2">
            {SALES_PROMPTS.map((p) => (
              <button
                key={p.label}
                onClick={() => setPrompt(p.val)}
                className="flex-1 py-1.5 rounded-md text-[10px] font-bold transition-colors"
                style={{
                  background: `${p.color}14`,
                  border: `1px solid ${p.color}`,
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
          placeholder="Describe your scene — or click Soft Sales / Hard Sell above for ready-made prompts"
          className="w-full p-2 rounded-md text-xs resize-y outline-none"
          style={{
            background: "#f8fbf5",
            border: "1px solid #d8e8d0",
            color: "#1a1a1a",
          }}
        />

        <div className="mt-3">
          <Label>Count</Label>
          <Select value={String(count)} onChange={(v) => setCount(Number(v))} width={100}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </div>

        <button
          onClick={submit}
          disabled={busy}
          className="w-full mt-3 py-3 rounded-md font-extrabold text-[13px] text-white transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
          style={{
            background: `linear-gradient(135deg, #ff5722, #ff7043)`,
            boxShadow: "0 2px 8px rgba(255, 87, 34, 0.25)",
          }}
        >
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status === "submitting" ? "Submitting…" : "Generating…"}
            </span>
          ) : (
            <>🖼️ Generate Image</>
          )}
        </button>

        {error && (
          <div
            className="mt-2 px-3 py-2 rounded-md text-xs"
            style={{
              background: "rgba(244,67,54,0.08)",
              border: "1px solid rgba(244,67,54,0.4)",
              color: "#c62828",
            }}
          >
            {error}
          </div>
        )}

        <p className="text-center text-[10px] text-gray-500 mt-2">
          {cost ? `Tolak RM${(cost * count).toFixed(2)} bila ${count} image siap` : "20 sen / 50 sen per generate (ikut plan)"}
        </p>
      </Card>

      {/* From History picker modal */}
      {pickerSlot && (
        <HistoryPicker
          onPick={(url) => pickFromHistory(pickerSlot, url)}
          onClose={() => setPickerSlot(null)}
        />
      )}
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
      setItems((data as any) || []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
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

        <div className="flex-1 overflow-y-auto p-4">
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
      className="rounded-xl p-3.5"
      style={{
        background: "#ffffff",
        border: `1px solid ${borderColor || "#d8e8d0"}`,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        ...(borderColor ? { borderTopWidth: 2, borderTopColor: borderColor } : {}),
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
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-base">{icon}</span>
      <span className="text-[12px] font-extrabold uppercase tracking-wider" style={{ color: "#1a3a1a" }}>
        {title}
      </span>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "#666" }}>
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
      className="px-2 py-2 rounded-md text-xs outline-none"
      style={{
        width: width ? `${width}px` : "100%",
        background: "#f8fbf5",
        border: "1px solid #d8e8d0",
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
  onPick,
  onClear,
}: {
  url: string;
  icon: string;
  title: string;
  subtitle: string;
  small?: boolean;
  onPick: () => void;
  onClear: () => void;
}) {
  if (url) {
    return (
      <div
        className="rounded-lg overflow-hidden relative"
        style={{
          border: `2px solid ${ORANGE}`,
        }}
      >
        <img src={url} alt="" className="w-full max-h-48 object-cover" />
        <button
          onClick={onClear}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full text-white text-xs hover:bg-red-500 transition"
          style={{ background: "rgba(0,0,0,0.7)" }}
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
      className={`w-full ${small ? "p-2.5" : "p-5"} rounded-lg text-center cursor-pointer transition-all hover:-translate-y-0.5`}
      style={{
        border: `2px dashed ${ORANGE_SOFT}`,
        background: ORANGE_FAINT,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = ORANGE;
        e.currentTarget.style.background = "rgba(255, 87, 34, 0.1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = ORANGE_SOFT;
        e.currentTarget.style.background = ORANGE_FAINT;
      }}
    >
      <div className={`${small ? "text-base" : "text-3xl"} mb-1 opacity-70`}>{icon}</div>
      {title && <div className="text-[11px] text-gray-700">{title}</div>}
      <div className="text-[8px] text-gray-500 mt-0.5">{subtitle}</div>
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
      className="px-2 py-1 rounded-md text-[8px] font-bold transition-colors flex-1 min-w-[55px] hover:opacity-80"
      style={{
        background: `${color}14`,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {label}
    </button>
  );
}
