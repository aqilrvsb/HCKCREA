"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Wand2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Auto Content — 1:1 port of creative-hack-auto's auto-content-section.
// Pipeline: Affiliate URL OR Manual product → master plan via OpenRouter
// → N parallel Veo r2v generations. Process log streams the stages so the
// client can see deepseek's planning + each video kicking off.

type Status = "idle" | "planning" | "generating" | "failed";
type ProductMode = "affiliate" | "manual";
type CtaMode = "shop" | "custom" | "none";

const AMBER = "#f59e0b";
const AMBER_SOFT = "rgba(245, 158, 11, 0.18)";
const AMBER_FAINT = "rgba(245, 158, 11, 0.06)";
const GREEN = "#22c55e";

export default function AutoContentTab({ projectId }: { projectId?: string } = {}) {
  const [productMode, setProductMode] = useState<ProductMode>("affiliate");
  const [productUrls, setProductUrls] = useState(""); // newline-separated
  const [productName, setProductName] = useState("");
  const [productImage, setProductImage] = useState(""); // data: or public URL
  const [gender, setGender] = useState<"female" | "male">("female");
  const [hijab, setHijab] = useState<"yes" | "no">("yes");
  const [age, setAge] = useState<"20s" | "30s" | "40s" | "55+">("30s");
  const [duration, setDuration] = useState<"8" | "16">("8");
  const [aspect, setAspect] = useState("9:16");
  const [ctaMode, setCtaMode] = useState<CtaMode>("shop");
  const [customCta, setCustomCta] = useState("");
  const [quantity, setQuantity] = useState(5);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showHistoryPicker, setShowHistoryPicker] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function pushLog(line: string) {
    setLog((prev) => [
      ...prev,
      `${new Date().toLocaleTimeString("ms-MY", { hour: "numeric", minute: "numeric", second: "numeric" })} · ${line}`,
    ]);
  }

  function onFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setProductImage(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const blob = await (await fetch(v)).blob();
    const fd = new FormData();
    fd.append("file", blob, "ref.png");
    const r = await fetch("/api/upload/image", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok || !d?.url) throw new Error(d?.error || "Upload failed");
    return d.url;
  }

  async function submit() {
    const firstUrl = productUrls.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)[0] || "";
    if (productMode === "affiliate" && !firstUrl) {
      return setError("Paste at least one product URL.");
    }
    if (productMode === "manual" && !productName.trim() && !productImage) {
      return setError("Enter product details or upload an image.");
    }
    setError(null);
    setStatus("planning");
    setLog([]);

    try {
      pushLog(productMode === "affiliate" ? "Affiliate mode" : "Manual product mode");

      let imagePub = "";
      if (productImage) {
        pushLog("Uploading product image…");
        imagePub = await ensurePublicUrl(productImage);
        pushLog("Product image uploaded ✓");
      }

      // Map UI controls → API body
      const avatarGender = gender;
      const avatarHijab = hijab === "yes" ? "hijab" : "no-hijab";
      const avatarAge = age;

      pushLog(`Master plan via deepseek (${quantity} × ${duration}s)…`);

      const r = await fetch("/api/generate/auto-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_url: productMode === "affiliate" ? firstUrl : "",
          product_image_url: imagePub,
          product_name: productName,
          quantity,
          duration,
          aspect_ratio: aspect,
          avatar_gender: avatarGender,
          avatar_hijab: avatarHijab,
          avatar_age: avatarAge,
          cta_mode: ctaMode,
          custom_cta: ctaMode === "custom" ? customCta : "",
          project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        pushLog(`✗ ${d?.error || "Failed"}`);
        setError(d?.error || "Failed to start batch");
        setStatus("failed");
        return;
      }
      pushLog(`Plan received — ${d.quantity} video(s).`);
      pushLog(`Submitting ${d.quantity} Veo generation(s)…`);
      pushLog(`Done. Total cost RM${Number(d.total_cost || 0).toFixed(2)}.`);
      setStatus("idle");
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      pushLog(`✗ ${e?.message || "Network error"}`);
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  const busy = status === "planning" || status === "generating";

  const sectionBg: React.CSSProperties = {
    background:
      "radial-gradient(ellipse 1200px 800px at 50% 0%, #fef9ef 0%, #fafaf7 40%, #f5f5f0 100%)",
    color: "#1a1a1a",
    boxShadow: "0 0 0 1px rgba(245, 158, 11, 0.08)",
  };

  return (
    <div className="rounded-3xl p-6 md:p-8 space-y-5" style={sectionBg}>
      <Card borderColor={AMBER}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Wand2 className="w-5 h-5" style={{ color: AMBER }} strokeWidth={2.4} />
            <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
              Auto Content
            </span>
          </div>
          <span
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded"
            style={{ background: AMBER_FAINT, color: AMBER, border: `1px solid ${AMBER_SOFT}` }}
          >
            AI → Image → Video → Merge
          </span>
        </div>

        {/* Affiliate / Manual toggle */}
        <div className="flex rounded-lg overflow-hidden mb-4" style={{ border: "1px solid #e8e0d8" }}>
          <ToggleBtn
            active={productMode === "affiliate"}
            onClick={() => setProductMode("affiliate")}
          >
            🔗 Affiliate
          </ToggleBtn>
          <ToggleBtn
            active={productMode === "manual"}
            onClick={() => setProductMode("manual")}
            borderLeft
          >
            📦 Manual Product
          </ToggleBtn>
        </div>

        {productMode === "affiliate" ? (
          <textarea
            rows={2}
            value={productUrls}
            onChange={(e) => setProductUrls(e.target.value)}
            placeholder="Paste product URL(s) — one per line for multiple products"
            className="w-full p-3 rounded-xl text-sm resize-y outline-none mb-4"
            style={{
              background: "#fafaf7",
              border: "1px solid #e8e0d8",
              color: "#1a1a1a",
            }}
          />
        ) : (
          <div className="space-y-3 mb-4">
            <textarea
              rows={2}
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Product 1: name, price, USP..."
              className="w-full p-3 rounded-xl text-sm resize-y outline-none"
              style={{
                background: "#fafaf7",
                border: "1px solid #e8e0d8",
                color: "#1a1a1a",
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-[60px] h-[60px] rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                style={{
                  border: `2px dashed ${productImage ? "transparent" : AMBER_SOFT}`,
                  background: productImage ? "#000" : AMBER_FAINT,
                }}
              >
                {productImage ? (
                  <img src={productImage} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl">📦</span>
                )}
              </button>
              <div className="flex flex-col gap-1 justify-between">
                <SmallBtn onClick={() => fileInputRef.current?.click()} color={AMBER}>
                  Upload
                </SmallBtn>
                <SmallBtn onClick={() => setShowHistoryPicker(true)} color={AMBER}>
                  History
                </SmallBtn>
                {productImage && (
                  <SmallBtn onClick={() => setProductImage("")} danger>
                    x
                  </SmallBtn>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Avatar — Gender / Style / Age */}
        <div
          className="rounded-xl p-3 mb-4"
          style={{ background: AMBER_FAINT, border: `1px solid ${AMBER_SOFT}` }}
        >
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Gender</Label>
              <Select value={gender} onChange={(v) => setGender(v as any)}>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </div>
            <div>
              <Label>Style</Label>
              <Select value={hijab} onChange={(v) => setHijab(v as any)}>
                <option value="yes">Hijab</option>
                <option value="no">No Hijab</option>
              </Select>
            </div>
            <div>
              <Label>Age</Label>
              <Select value={age} onChange={(v) => setAge(v as any)}>
                <option value="20s">20s</option>
                <option value="30s">30s</option>
                <option value="40s">40s (Makcik)</option>
                <option value="55+">55+ (Nenek)</option>
              </Select>
            </div>
          </div>
        </div>

        {/* Duration buttons */}
        <div className="flex gap-2 mb-4">
          <DurationBtn active={duration === "8"} onClick={() => setDuration("8")}>
            8s (1 shot)
          </DurationBtn>
          <DurationBtn active={duration === "16"} onClick={() => setDuration("16")}>
            16s (2 shots)
          </DurationBtn>
        </div>

        {/* Size */}
        <div className="flex items-center gap-2 mb-4">
          <Label>Size</Label>
          <Select value={aspect} onChange={(v) => setAspect(v)} width={100}>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </Select>
        </div>

        {/* CTA Mode */}
        <div
          className="rounded-xl p-3 mb-4"
          style={{ background: "#f0f5ec", border: "1px solid #d8e8d0" }}
        >
          <div className="text-[11px] font-extrabold uppercase tracking-wider mb-2" style={{ color: "#1a1a1a" }}>
            CTA Mode (last 2 seconds)
          </div>
          <div className="space-y-1.5">
            <CtaRadio
              active={ctaMode === "shop"}
              onClick={() => setCtaMode("shop")}
              label='🛒 SHOP CTA — "Tekan beg kuning" (30 variations)'
            />
            <CtaRadio
              active={ctaMode === "custom"}
              onClick={() => setCtaMode("custom")}
              label="✏️ CUSTOM CTA — your own text"
            />
            <CtaRadio
              active={ctaMode === "none"}
              onClick={() => setCtaMode("none")}
              label="🚫 NO CTA — full 8s for content only"
            />
          </div>
          {ctaMode === "custom" && (
            <input
              type="text"
              value={customCta}
              onChange={(e) => setCustomCta(e.target.value)}
              placeholder="e.g. WhatsApp kami sekarang!"
              className="w-full p-2 rounded-lg text-xs outline-none mt-2"
              style={{
                background: "#fafaf7",
                border: "1px solid #d8e8d0",
                color: "#1a1a1a",
              }}
            />
          )}
        </div>

        {/* Quantity + Generate */}
        <div className="flex items-end gap-2">
          <div>
            <Label>Quantity</Label>
            <Select
              value={String(quantity)}
              onChange={(v) => setQuantity(Number(v))}
              width={120}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 h-11 rounded-xl font-extrabold text-sm text-white transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
            style={{
              background: `linear-gradient(135deg, ${AMBER} 0%, #fbbf24 100%)`,
              boxShadow: "0 4px 14px rgba(245,158,11,0.4)",
            }}
          >
            {busy ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {status === "planning" ? "Planning…" : "Generating…"}
              </span>
            ) : (
              <>🎬 Generate</>
            )}
          </button>
        </div>

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

      {/* Process Log */}
      <Card>
        <div className="flex items-center gap-2.5 mb-3">
          <span className="text-lg">📋</span>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
            Process Log
          </span>
        </div>
        <div
          className="rounded-lg p-3 max-h-48 overflow-y-auto text-[11px] font-mono leading-relaxed"
          style={{ background: "#f0f5ec", border: "1px solid #d8e8d0" }}
        >
          {log.length === 0 ? (
            <span style={{ color: "#999" }}>Process log will appear here...</span>
          ) : (
            log.map((line, i) => (
              <div key={i} style={{ color: "#1a1a1a" }}>
                {line}
              </div>
            ))
          )}
        </div>
      </Card>

      {showHistoryPicker && (
        <HistoryPicker
          onPick={(url) => {
            setProductImage(url);
            setShowHistoryPicker(false);
          }}
          onClose={() => setShowHistoryPicker(false)}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────
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
      className="px-3 py-2 rounded-lg text-sm font-semibold outline-none"
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

function ToggleBtn({
  active,
  onClick,
  borderLeft,
  children,
}: {
  active: boolean;
  onClick: () => void;
  borderLeft?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 px-3 py-2 text-xs font-extrabold transition-all"
      style={
        active
          ? {
              background: GREEN,
              color: "white",
              borderLeft: borderLeft ? "1px solid #e8e0d8" : "none",
            }
          : {
              background: "#fafaf7",
              color: "#888",
              borderLeft: borderLeft ? "1px solid #e8e0d8" : "none",
            }
      }
    >
      {children}
    </button>
  );
}

function DurationBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 h-9 rounded-lg text-xs font-extrabold transition-all"
      style={
        active
          ? {
              background: `linear-gradient(135deg, ${GREEN}, #4ade80)`,
              color: "white",
              boxShadow: "0 4px 14px rgba(34,197,94,0.3)",
            }
          : {
              background: "#fafaf7",
              border: "1px solid #e8e0d8",
              color: "#888",
            }
      }
    >
      {children}
    </button>
  );
}

function CtaRadio({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-[11px] font-bold transition-all text-left"
      style={
        active
          ? { background: "rgba(34,197,94,0.1)", color: "#1a1a1a" }
          : { color: "#666" }
      }
    >
      <span
        className="w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{
          border: `2px solid ${active ? GREEN : "#ccc"}`,
        }}
      >
        {active && (
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: GREEN }}
          />
        )}
      </span>
      {label}
    </button>
  );
}

function SmallBtn({
  children,
  onClick,
  danger,
  color,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  color?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded text-[10px] font-bold"
      style={
        danger
          ? {
              background: "rgba(244,67,54,0.08)",
              border: "1px solid rgba(244,67,54,0.4)",
              color: "#c62828",
            }
          : {
              background: `${color || AMBER}10`,
              border: `1px solid ${color || AMBER}`,
              color: color || AMBER,
            }
      }
    >
      {children}
    </button>
  );
}

// ── History Picker ──────────────────────────────────────────────────────
function HistoryPicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<
    { id: string; output_url: string }[]
  >([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    try {
      const sb = createClient();
      const { data } = await sb
        .from("history")
        .select("id, output_url")
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
        className="rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        style={{
          background: "#ffffff",
          border: `2px solid ${AMBER}`,
          boxShadow: "0 20px 60px rgba(245,158,11,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#e8e0d8" }}
        >
          <h2 className="font-display font-extrabold text-base" style={{ color: AMBER }}>
            Pick Product Image from History
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" style={{ color: AMBER }} />
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              Belum ada image dalam history.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => onPick(it.output_url)}
                  className="aspect-square rounded-lg overflow-hidden border-2 transition-all hover:-translate-y-0.5"
                  style={{ borderColor: "#e8e0d8", background: "#fafaf7" }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = AMBER)}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#e8e0d8")}
                >
                  <img src={it.output_url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
