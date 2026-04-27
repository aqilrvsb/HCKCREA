"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Wand2, X, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import {
  FRAMEWORKS,
  TYPE_COLORS,
  typeLabel,
  type Framework,
} from "@/lib/auto-content-frameworks";

// Auto Content — port of creative-hack-auto 12.8.3 auto-content-section.
// Three plan modes (AI Plan / Verify Plan / Manual Plan), 15 framework
// checkboxes capped at quantity, multi-product manual mode (1-5), and the
// full apiMasterPlan-style submit body.

type Status = "idle" | "planning" | "verifying" | "generating" | "failed";
type ProductMode = "affiliate" | "manual";
type CtaMode = "shop" | "custom" | "none";
type PlanMode = "aiplan" | "verify" | "manual";

const AMBER = "#f59e0b";
const AMBER_SOFT = "rgba(245, 158, 11, 0.18)";
const AMBER_FAINT = "rgba(245, 158, 11, 0.06)";
const GREEN = "#22c55e";

type ManualProduct = {
  info: string;          // textarea content
  imageData: string;     // data: URL or public URL
};

export default function AutoContentTab({ projectId }: { projectId?: string } = {}) {
  // Product source
  const [productMode, setProductMode] = useState<ProductMode>("affiliate");
  const [productUrls, setProductUrls] = useState("");
  const [unitCount, setUnitCount] = useState(1);
  const [manualProducts, setManualProducts] = useState<ManualProduct[]>([
    { info: "", imageData: "" },
  ]);

  // Avatar persona
  const [gender, setGender] = useState<"female" | "male">("female");
  const [hijab, setHijab] = useState<"yes" | "no">("yes");
  const [age, setAge] = useState<"20s" | "30s" | "40s" | "55+">("30s");

  // Settings
  const [duration, setDuration] = useState<"8" | "16">("8");
  const [aspect, setAspect] = useState("9:16");
  const [ctaMode, setCtaMode] = useState<CtaMode>("shop");
  const [customCta, setCustomCta] = useState("");
  const [quantity, setQuantity] = useState(5);

  // Plan mode
  const [planMode, setPlanMode] = useState<PlanMode>("aiplan");
  const [selectedFrameworks, setSelectedFrameworks] = useState<number[]>([]);
  const [manualPlanJson, setManualPlanJson] = useState("");

  // Submit state
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  // Verify Plan state — when status="verifying" we hold the plan + the
  // pre-flight params so the Approve button can fire without re-planning.
  const [pendingPlan, setPendingPlan] = useState<any[] | null>(null);
  const [pendingPayload, setPendingPayload] = useState<any | null>(null);

  // Modals
  const [infoFw, setInfoFw] = useState<Framework | null>(null);
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  // Ensure manualProducts array always matches unitCount
  useEffect(() => {
    setManualProducts((prev) => {
      const next = [...prev];
      while (next.length < unitCount) next.push({ info: "", imageData: "" });
      while (next.length > unitCount) next.pop();
      return next;
    });
  }, [unitCount]);

  // Cap selectedFrameworks at quantity (extension behaviour)
  useEffect(() => {
    setSelectedFrameworks((prev) =>
      prev.length > quantity ? prev.slice(0, quantity) : prev
    );
  }, [quantity]);

  function pushLog(line: string) {
    setLog((p) => [
      ...p,
      `${new Date().toLocaleTimeString("ms-MY", { hour: "numeric", minute: "numeric", second: "numeric" })} · ${line}`,
    ]);
  }

  function toggleFramework(id: number) {
    setSelectedFrameworks((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= quantity) {
        setError(`Max ${quantity} framework${quantity === 1 ? "" : "s"} for ${quantity} video${quantity === 1 ? "" : "s"}`);
        setTimeout(() => setError(null), 2500);
        return prev;
      }
      return [...prev, id];
    });
  }

  // Eager-upload: file pick → instant data: preview → background upload to
  // RunningHub. By submit time, imageData on each manual product holds the
  // public URL so ensurePublicUrl is a no-op for the hot path.
  function pickFileForManual(idx: number, f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setManualProducts((prev) =>
        prev.map((p, i) => (i === idx ? { ...p, imageData: String(reader.result || "") } : p))
      );
      (async () => {
        try {
          const fd = new FormData();
          fd.append("file", f, f.name || "upload.png");
          const r = await fetch("/api/upload/image", { method: "POST", body: fd });
          const d = await r.json();
          if (r.ok && d?.url) {
            setManualProducts((prev) =>
              prev.map((p, i) => (i === idx ? { ...p, imageData: d.url } : p))
            );
          }
        } catch {
          // Silent — submit's ensurePublicUrl handles retry
        }
      })();
    };
    reader.readAsDataURL(f);
  }

  function pickHistoryForManual(idx: number, url: string) {
    setManualProducts((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, imageData: url } : p))
    );
    setPickerSlot(null);
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
    setError(null);
    setLog([]);
    setPendingPlan(null);
    setPendingPayload(null);

    // Validate inputs
    let urls: string[] = [];
    let manualPayload: any[] | null = null;
    let firstProductUrl = "";
    let firstProductImage = "";

    if (productMode === "affiliate") {
      const rawUrls = productUrls
        .split(/[\n,]+/)
        .map((u) => u.trim())
        .filter((u) => u.startsWith("http"));
      if (rawUrls.length === 0) return setError("Paste at least 1 product URL.");
      urls = Array.from({ length: quantity }, (_, i) => rawUrls[i % rawUrls.length]);
      firstProductUrl = rawUrls[0];
    } else {
      const valid = manualProducts.slice(0, unitCount);
      for (let i = 0; i < unitCount; i++) {
        if (!valid[i]?.info?.trim()) return setError(`Fill in Product ${i + 1} info`);
        if (!valid[i]?.imageData) return setError(`Upload product image for Product ${i + 1}`);
      }
      manualPayload = valid;
      firstProductImage = valid[0].imageData;
    }

    if (planMode === "manual") {
      const txt = manualPlanJson.trim();
      if (!txt) return setError("Paste a Plan JSON first.");
      try {
        const parsed = JSON.parse(txt);
        if (!Array.isArray(parsed) || parsed.length === 0)
          throw new Error("Plan JSON must be a non-empty array");
      } catch (e: any) {
        return setError(`Invalid Plan JSON: ${e?.message || "parse error"}`);
      }
    } else {
      if (selectedFrameworks.length === 0)
        return setError("Select at least 1 framework.");
    }

    setStatus("planning");
    pushLog(`Mode: ${planMode === "manual" ? "Manual Plan (JSON)" : planMode === "verify" ? "Verify Plan" : "AI Plan"}`);
    pushLog(`Source: ${productMode === "affiliate" ? `${urls.length} URL slots from ${urls.length ? new Set(urls).size : 0} unique` : `${unitCount} manual product(s)`}`);

    try {
      // For manual mode, upload all manual product images
      if (manualPayload) {
        pushLog("Uploading manual product images…");
        manualPayload = await Promise.all(
          manualPayload.map(async (m) => ({
            ...m,
            imageData: m.imageData.startsWith("data:")
              ? await ensurePublicUrl(m.imageData)
              : m.imageData,
          }))
        );
        firstProductImage = manualPayload[0].imageData;
        pushLog("Images uploaded ✓");
      }

      const body: any = {
        product_mode: productMode,
        product_url: firstProductUrl,
        product_urls_all: productMode === "affiliate" ? urls : [],
        product_image_url: firstProductImage,
        manual_products: manualPayload,
        product_name: manualPayload?.[0]?.info?.split("\n")[0] || "",
        quantity,
        duration,
        aspect_ratio: aspect,
        avatar_gender: gender,
        avatar_hijab: hijab === "yes" ? "hijab" : "no-hijab",
        avatar_age: age,
        cta_mode: ctaMode,
        custom_cta: ctaMode === "custom" ? customCta : "",
        plan_mode: planMode,
        selected_frameworks: selectedFrameworks,
        preset_plan: planMode === "manual" ? JSON.parse(manualPlanJson) : null,
        project_id: projectId,
      };

      pushLog(planMode === "manual"
        ? "Skipping master plan (using your JSON)…"
        : "Master plan via deepseek vision…");

      const r = await fetch("/api/generate/auto-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        pushLog(`✗ ${d?.error || "Failed"}`);
        setError(d?.error || "Failed");
        setStatus("failed");
        return;
      }

      // Verify Plan mode: backend returned plan only — render approval list
      if (planMode === "verify" && d.mode === "verify") {
        pushLog(`Plan ready — review ${d.plan?.length || 0} videos and Approve to fire.`);
        setPendingPlan(d.plan || []);
        setPendingPayload(body);
        setStatus("verifying");
        return;
      }

      pushLog(`Plan accepted — ${d.quantity} video(s) submitted.`);
      pushLog(`Total cost RM${Number(d.total_cost || 0).toFixed(2)}.`);
      setStatus("idle");
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      pushLog(`✗ ${e?.message || "Network error"}`);
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  async function approveVerifyPlan() {
    if (!pendingPlan || !pendingPayload) return;
    setStatus("generating");
    pushLog("Plan approved — firing Veo generations…");
    try {
      const r = await fetch("/api/generate/auto-content/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pendingPayload,
          preset_plan: pendingPlan,
          plan_mode: "approved",
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        pushLog(`✗ ${d?.error || "Approve failed"}`);
        setError(d?.error || "Approve failed");
        setStatus("failed");
        return;
      }
      pushLog(`Submitted ${d.quantity} videos · RM${Number(d.total_cost || 0).toFixed(2)}.`);
      setPendingPlan(null);
      setPendingPayload(null);
      setStatus("idle");
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      pushLog(`✗ ${e?.message || "Network error"}`);
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  function rejectVerifyPlan() {
    setPendingPlan(null);
    setPendingPayload(null);
    setStatus("idle");
    pushLog("Plan rejected — start over.");
  }

  const busy = status === "planning" || status === "generating";
  const showFrameworks = planMode !== "manual";

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
        <div className="flex rounded-lg overflow-hidden mb-3" style={{ border: "1px solid #e8e0d8" }}>
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

        {productMode === "manual" && (
          <div className="flex items-center gap-2 mb-3">
            <Label>Products</Label>
            <Select
              value={String(unitCount)}
              onChange={(v) => setUnitCount(Number(v))}
              width={70}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <span className="text-[10px] text-gray-500 ml-2">
              Plans rotate {unitCount} product{unitCount === 1 ? "" : "s"} across {quantity}{" "}
              video{quantity === 1 ? "" : "s"}.
            </span>
          </div>
        )}

        {productMode === "affiliate" ? (
          <textarea
            rows={2}
            value={productUrls}
            onChange={(e) => setProductUrls(e.target.value)}
            placeholder="Paste product URL(s) — one per line for multiple products"
            className="w-full p-3 rounded-xl text-sm resize-y outline-none mb-4"
            style={{ background: "#fafaf7", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
          />
        ) : (
          <div className="space-y-2 mb-4">
            {manualProducts.map((p, i) => (
              <ManualProductCard
                key={i}
                idx={i}
                showLabel={unitCount > 1}
                product={p}
                onInfoChange={(info) =>
                  setManualProducts((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, info } : x))
                  )
                }
                onPickFile={(f) => pickFileForManual(i, f)}
                onPickHistory={() => setPickerSlot(i)}
                onClear={() =>
                  setManualProducts((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, imageData: "" } : x))
                  )
                }
              />
            ))}
          </div>
        )}

        {/* Avatar persona */}
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
        <div className="flex gap-2 mb-3">
          <DurationBtn active={duration === "8"} onClick={() => setDuration("8")}>
            8s (1 shot)
          </DurationBtn>
          <DurationBtn active={duration === "16"} onClick={() => setDuration("16")}>
            16s (2 shots)
          </DurationBtn>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Label>Size</Label>
          <Select value={aspect} onChange={(v) => setAspect(v)} width={100}>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </Select>
        </div>

        {/* Plan mode buttons */}
        <Label>Plan Mode</Label>
        <div className="flex gap-2 mb-3">
          <PlanModeBtn active={planMode === "aiplan"} onClick={() => setPlanMode("aiplan")}>
            AI Plan
          </PlanModeBtn>
          <PlanModeBtn active={planMode === "verify"} onClick={() => setPlanMode("verify")}>
            Verify Plan
          </PlanModeBtn>
          <PlanModeBtn active={planMode === "manual"} onClick={() => setPlanMode("manual")}>
            Manual Plan
          </PlanModeBtn>
        </div>

        {/* Frameworks (AI Plan + Verify Plan) */}
        {showFrameworks && (
          <>
            <Label>
              Frameworks{" "}
              <span className="text-gray-400 font-normal normal-case tracking-normal">
                (pick up to {quantity} angle{quantity === 1 ? "" : "s"})
              </span>
            </Label>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {FRAMEWORKS.map((fw) => {
                const checked = selectedFrameworks.includes(fw.id);
                const color = TYPE_COLORS[fw.type];
                return (
                  <label
                    key={fw.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] cursor-pointer transition-colors"
                    style={{
                      background: checked ? `${color}1a` : "#fafaf7",
                      border: `1px solid ${checked ? color : "#e8e0d8"}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleFramework(fw.id)}
                      className="w-3 h-3"
                    />
                    <span className="font-bold" style={{ color }}>
                      {fw.short}
                    </span>
                    <span className="text-[10px] text-gray-700">{fw.name}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setInfoFw(fw);
                      }}
                      className="ml-0.5 text-gray-400 hover:text-gray-700"
                      title="View strategy"
                    >
                      <Info className="w-3 h-3" />
                    </button>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {/* Manual Plan JSON */}
        {planMode === "manual" && (
          <>
            <Label>
              Plan JSON{" "}
              <span className="text-gray-400 font-normal normal-case tracking-normal">
                (array of {`{ framework, prompt, caption }`})
              </span>
            </Label>
            <textarea
              rows={6}
              value={manualPlanJson}
              onChange={(e) => setManualPlanJson(e.target.value)}
              placeholder={`[\n  { "framework": "Hook + Pain (PAS)", "prompt": "Medium shot, waist up. ...", "caption": "..." },\n  ...\n]`}
              className="w-full p-3 rounded-xl text-[11px] font-mono resize-y outline-none mb-4"
              style={{ background: "#f0f5ec", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
            />
          </>
        )}

        {/* CTA Mode */}
        <div
          className="rounded-xl p-3 mb-4"
          style={{ background: "#f0f5ec", border: "1px solid #d8e8d0" }}
        >
          <div className="text-[11px] font-extrabold uppercase tracking-wider mb-2">
            CTA Mode (last 2 seconds)
          </div>
          <div className="space-y-1.5">
            <CtaRadio
              active={ctaMode === "shop"}
              onClick={() => setCtaMode("shop")}
              label='🛒 SHOP CTA — "Tekan beg kuning" (30 variations rotate)'
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
              style={{ background: "#fafaf7", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
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
            disabled={busy || status === "verifying"}
            className="flex-1 h-11 rounded-xl font-extrabold text-sm text-white transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
            style={{
              background: `linear-gradient(135deg, ${AMBER} 0%, #fbbf24 100%)`,
              boxShadow: "0 4px 14px rgba(245,158,11,0.4)",
            }}
          >
            {status === "planning" ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Planning…
              </span>
            ) : status === "generating" ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating…
              </span>
            ) : status === "verifying" ? (
              "Awaiting your approval ↓"
            ) : (
              <>🎬 {planMode === "verify" ? "Plan + Review" : "Generate"}</>
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

      {/* Verify-Plan review */}
      {status === "verifying" && pendingPlan && (
        <Card borderColor={GREEN}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">✅</span>
              <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
                Review Plan ({pendingPlan.length} videos)
              </span>
            </div>
            <button
              onClick={rejectVerifyPlan}
              className="text-[10px] font-bold px-2 py-1 rounded"
              style={{
                background: "rgba(244,67,54,0.08)",
                border: "1px solid rgba(244,67,54,0.4)",
                color: "#c62828",
              }}
            >
              Reject
            </button>
          </div>
          <div className="space-y-2 mb-3 max-h-[480px] overflow-y-auto">
            {pendingPlan.map((p, i) => (
              <div
                key={i}
                className="rounded-lg p-3"
                style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="text-[10px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded"
                    style={{ background: "rgba(34,197,94,0.1)", color: GREEN }}
                  >
                    {i + 1} · {p.framework || "Plan"}
                  </span>
                  {p.caption && (
                    <span className="text-[10px] text-gray-500 truncate max-w-[60%]">
                      {p.caption}
                    </span>
                  )}
                </div>
                <pre className="text-[10px] font-mono whitespace-pre-wrap leading-relaxed text-gray-700">
                  {String(p.prompt || "").substring(0, 600)}
                  {String(p.prompt || "").length > 600 ? "…" : ""}
                </pre>
              </div>
            ))}
          </div>
          <button
            onClick={approveVerifyPlan}
            className="w-full py-3 rounded-xl font-extrabold text-sm text-white"
            style={{
              background: `linear-gradient(135deg, ${GREEN}, #4ade80)`,
              boxShadow: "0 4px 14px rgba(34,197,94,0.4)",
            }}
          >
            ✓ Approve & Generate {pendingPlan.length} Videos
          </button>
        </Card>
      )}

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

      {/* Framework info modal */}
      {infoFw && <FrameworkInfoModal fw={infoFw} onClose={() => setInfoFw(null)} />}

      {/* History picker for manual product */}
      {pickerSlot !== null && (
        <HistoryPicker
          onPick={(url) => pickHistoryForManual(pickerSlot, url)}
          onClose={() => setPickerSlot(null)}
        />
      )}
    </div>
  );
}

// ── ManualProductCard ────────────────────────────────────────────────
function ManualProductCard({
  idx,
  showLabel,
  product,
  onInfoChange,
  onPickFile,
  onPickHistory,
  onClear,
}: {
  idx: number;
  showLabel: boolean;
  product: ManualProduct;
  onInfoChange: (s: string) => void;
  onPickFile: (f: File | null) => void;
  onPickHistory: () => void;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div
      className="rounded-lg p-3"
      style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
    >
      {showLabel && (
        <div
          className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
          style={{ color: "#888" }}
        >
          Product {idx + 1}
        </div>
      )}
      <textarea
        rows={2}
        maxLength={500}
        value={product.info}
        onChange={(e) => onInfoChange(e.target.value)}
        placeholder={`Product ${idx + 1}: name, price, USP...`}
        className="w-full p-2 rounded text-xs resize-y outline-none mb-2"
        style={{ background: "#ffffff", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPickFile(e.target.files?.[0] || null)}
      />
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="relative w-[60px] h-[60px] rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{
            border: `2px dashed ${product.imageData ? "transparent" : AMBER_SOFT}`,
            background: product.imageData ? "#000" : AMBER_FAINT,
          }}
        >
          {product.imageData ? (
            <img src={product.imageData} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl">📦</span>
          )}
        </button>
        <div className="flex flex-col gap-1 justify-between">
          <SmallBtn onClick={() => fileRef.current?.click()} color={AMBER}>
            Upload
          </SmallBtn>
          <SmallBtn onClick={onPickHistory} color={AMBER}>
            History
          </SmallBtn>
          {product.imageData && (
            <SmallBtn onClick={onClear} danger>
              x
            </SmallBtn>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Framework info modal ────────────────────────────────────────────
function FrameworkInfoModal({
  fw,
  onClose,
}: {
  fw: Framework;
  onClose: () => void;
}) {
  const color = TYPE_COLORS[fw.type];
  const tlabel = typeLabel(fw.type);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-md w-full p-5"
        style={{ background: "#ffffff", border: `2px solid ${color}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-extrabold text-base">{fw.name}</h3>
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={{ color, background: `${color}20` }}
          >
            {tlabel}
          </span>
        </div>
        <p className="text-xs text-gray-600 mb-3">{fw.focus}</p>
        <div
          className="rounded p-3 mb-2"
          style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
        >
          <div className="text-[10px] font-bold mb-1" style={{ color }}>
            SHOT 1 (0-8s) — Hook
          </div>
          <div className="text-xs leading-relaxed">{fw.shot1}</div>
        </div>
        <div
          className="rounded p-3 mb-3"
          style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
        >
          <div className="text-[10px] font-bold mb-1" style={{ color }}>
            SHOT 2 (8-16s) — CTA
          </div>
          <div className="text-xs leading-relaxed">{fw.shot2}</div>
        </div>
        {fw.emotion !== "none" && (
          <div className="text-[10px] text-gray-500 mb-3">Emotion: {fw.emotion}</div>
        )}
        <button
          onClick={onClose}
          className="w-full py-2 rounded-lg text-xs font-extrabold text-white"
          style={{ background: `linear-gradient(135deg, ${GREEN}, #4ade80)` }}
        >
          Got it
        </button>
      </div>
    </div>
    </Portal>
  );
}

// ── Sub-components (Card, Label, Select, ToggleBtn, DurationBtn, CtaRadio,
//                   SmallBtn, HistoryPicker) ────────────────────────────
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

function PlanModeBtn({
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
      className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded text-[11px] font-bold text-left transition-all"
      style={
        active
          ? { background: "rgba(34,197,94,0.1)", color: "#1a1a1a" }
          : { color: "#666" }
      }
    >
      <span
        className="w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center"
        style={{ border: `2px solid ${active ? GREEN : "#ccc"}` }}
      >
        {active && (
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: GREEN }} />
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

function HistoryPicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<{ id: string; output_url: string }[]>([]);
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
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
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
            Pick Product Image
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
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
    </Portal>
  );
}
