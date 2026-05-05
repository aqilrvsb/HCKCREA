"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Wand2, X, Info, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { isVisibleAfterTtl, fetchSavedSet } from "@/lib/history-filter";
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
type CtaMode = "shop" | "custom" | "none";
type PlanMode = "aiplan" | "verify" | "manual";
type ProductMode = "affiliate" | "manual";

const AMBER = "#f59e0b";
const AMBER_SOFT = "rgba(245, 158, 11, 0.18)";
const AMBER_FAINT = "rgba(245, 158, 11, 0.06)";
// Highfield yellow — bright safety-vest yellow used for primary accents.
// Replaces the previous green so all action surfaces in Auto Content are
// in the same warm-yellow family as the rest of the tab.
const GREEN = "#facc15";

type ManualProduct = {
  info: string;          // textarea content
  imageData: string;     // public URL for display (TikTok CDN for affiliate, RH-uploaded for manual file, or data: URL pre-upload)
};

type RecentProduct = {
  product_id: string;
  raw_url: string;
  product_name: string;
  product_image_url: string;
  price: string | null;
  last_used_at: string;
};

export default function AutoContentTab({ projectId }: { projectId?: string } = {}) {
  // Product source — Affiliate (paste URL → scrape via Crawlbase →
  // auto-fills info + image) OR Manual (upload directly). Both end up
  // submitting product_mode "manual" downstream because the same
  // manual_products[] payload shape is used either way; the affiliate
  // path just pre-fills it.
  const [productMode, setProductMode] = useState<ProductMode>("affiliate");
  const [affiliateUrl, setAffiliateUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // TikTok product_id pulled from the affiliate scrape. Forwarded with
  // submit so each generated history row can stamp it on metadata,
  // enabling auto-post deep-linking later. Empty for manual mode.
  const [tiktokProductId, setTiktokProductId] = useState<string>("");

  // "Your recent products" dropdown — populated from /api/scrape/recent
  // on mount. Click → re-runs fetchAffiliate with the cached URL, which
  // hits the global tiktok_product_cache and returns instantly.
  // Recent products live in the database (user_product_history joined
  // to tiktok_product_cache). Loaded once on mount via /api/scrape/recent.
  // Surfaced via an explicit history icon next to the input — no
  // auto-popout on focus. User clicks the icon → dropdown opens →
  // pick a row → re-runs fetch (which hits the cache → instant).
  const [recentProducts, setRecentProducts] = useState<RecentProduct[]>([]);
  const [showRecent, setShowRecent] = useState(false);

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
  const [showManualPlanHelp, setShowManualPlanHelp] = useState(false);

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

  // Aborts the in-flight planning fetch when the user hits Stop.
  const abortRef = useRef<AbortController | null>(null);

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

  // Load recent products from the database. Called on mount AND whenever
  // the user clicks the 🕐 icon — so newly fetched extension products
  // appear without a page reload. cache: 'no-store' bypasses any browser
  // memory cache that might otherwise serve a stale copy.
  const loadRecentProducts = async () => {
    try {
      const r = await fetch("/api/scrape/recent", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      if (Array.isArray(d?.items)) setRecentProducts(d.items);
    } catch {
      // Non-fatal — dropdown keeps the previous list.
    }
  };

  useEffect(() => {
    loadRecentProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          const { url } = await uploadImage(f);
          setManualProducts((prev) =>
            prev.map((p, i) => (i === idx ? { ...p, imageData: url } : p))
          );
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

  // Affiliate URL → cache-or-scrape → prefill manual_products[0]. The
  // server-side flow is:
  //   1. Extract product_id from URL → look up tiktok_product_cache
  //   2. Cache hit → return cached row instantly (no TikHub call)
  //   3. Cache miss → TikHub scrape with up to 5 retries, then re-host
  //      the image on RunningHub and upsert into the cache
  //
  // Optional `url` arg lets the recent-products dropdown pass a URL
  // directly instead of relying on the input state (avoids a render
  // round-trip race when the user clicks a row and we want to fetch
  // immediately).
  async function fetchAffiliate(overrideUrl?: string) {
    const url = (overrideUrl ?? affiliateUrl).trim();
    if (!url) return;
    if (overrideUrl) setAffiliateUrl(overrideUrl);
    setShowRecent(false);

    // Guard against TikTok short-share links (vt.tiktok.com /
    // vm.tiktok.com). These don't expose a product_id in the URL —
    // they need a redirect resolve which TikHub sometimes can't do
    // reliably, leading to opaque "Could not resolve product ID"
    // errors for the user. Bail out early with a clear instruction
    // to paste the full PDP URL instead.
    if (/^https?:\/\/(vt|vm)\.tiktok\.com\//i.test(url)) {
      setScrapeMsg({
        ok: false,
        text:
          "Link pendek tak boleh fetch. Buka link ni dalam browser dulu, " +
          "tunggu redirect ke /pdp/... URL penuh, copy URL tu balik dan paste " +
          "kat sini.",
      });
      return;
    }

    setScraping(true);
    setScrapeMsg(null);
    try {
      const r = await fetch("/api/scrape/affiliate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setScrapeMsg({ ok: false, text: d?.error || "Scrape failed" });
        return;
      }
      // Compose a clean info textarea from the scraped fields. First
      // line is the product name (used downstream as productName); the
      // rest is description + meta.
      const lines = [d.product_name];
      if (d.price) lines.push(`Price: ${d.price}`);
      if (d.rating) lines.push(`Rating: ${d.rating}`);
      if (d.total_sold) lines.push(`Sold: ${d.total_sold}`);
      if (d.category) lines.push(`Category: ${d.category}`);
      if (d.description) lines.push("", d.description);
      const info = lines.filter((l) => l !== undefined).join("\n");

      setManualProducts((prev) => {
        const next = [...prev];
        // Always use the permanent TikTok CDN URL for display (no
        // expiry, no signed signature). On submit, /api/scrape/rehost
        // uploads it to RunningHub so AI generation gets a fresh
        // region-friendly URL — mirrors the manual flow where uploaded
        // files go through /api/upload/image on submit.
        next[0] = {
          info,
          imageData: d.product_image_url || "",
        };
        return next;
      });
      // Capture the TikTok product_id from the scrape result so we can
      // stamp it on every generated history row for auto-post later.
      // Manual mode resets this to empty.
      setTiktokProductId(d.product_id ? String(d.product_id) : "");
      setScrapeMsg({
        ok: true,
        text: `✓ Loaded "${d.product_name.substring(0, 60)}${d.product_name.length > 60 ? "…" : ""}" — edit below if needed.`,
      });
      // Refresh the recent list from the database so this product
      // appears at the top — server already wrote to
      // user_product_history during the affiliate scrape.
      try {
        const rr = await fetch("/api/scrape/recent");
        if (rr.ok) {
          const dd = await rr.json();
          if (Array.isArray(dd?.items)) setRecentProducts(dd.items);
        }
      } catch {
        // Non-fatal
      }
    } catch (e: any) {
      setScrapeMsg({ ok: false, text: e?.message || "Network error" });
    } finally {
      setScraping(false);
    }
  }

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const file = await dataUrlToFile(v, "ref.png");
    const { url } = await uploadImage(file);
    return url;
  }

  async function submit() {
    setError(null);
    setLog([]);
    setPendingPlan(null);
    setPendingPayload(null);

    // Validate inputs — manual mode only
    let manualPayload: any[] | null = null;
    let firstProductImage = "";

    {
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
    pushLog(`Source: ${unitCount} manual product(s)`);

    try {
      // Resolve every manual product image to an AI-generation-friendly
      // URL (a fresh RunningHub-hosted URL that Crun/GeminiGen can fetch).
      // Three input states:
      //   1. data: URL  → user uploaded a file → POST to /api/upload/image
      //   2. RH URL     → already hosted → use as-is (skip rehost)
      //   3. TikTok URL → permanent CDN but Crun's region may block →
      //                   POST to /api/scrape/rehost to get fresh RH URL
      pushLog("Resolving product images…");
      manualPayload = await Promise.all(
        manualPayload.map(async (m, idx) => {
          let url = m.imageData;
          if (!url) return m;
          if (url.startsWith("data:")) {
            // File upload — convert to public URL
            url = await ensurePublicUrl(url);
          } else if (
            !url.includes("rh-images-switch") &&
            !url.includes("running-hub")
          ) {
            // Looks like a TikTok CDN URL (or anything non-RH). Rehost on
            // demand so AI generation gets a region-friendly URL.
            try {
              const r = await fetch("/api/scrape/rehost", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
              });
              const d = await r.json();
              if (r.ok && d?.url) {
                url = d.url;
                pushLog(`Product ${idx + 1}: rehosted to RH ✓`);
              } else {
                pushLog(`Product ${idx + 1}: rehost failed, using original URL`);
              }
            } catch {
              pushLog(`Product ${idx + 1}: rehost network error, using original URL`);
            }
          }
          return { ...m, imageData: url };
        })
      );
      firstProductImage = manualPayload[0].imageData;
      pushLog("Images resolved ✓");

      const body: any = {
        product_mode: "manual",
        product_url: "",
        product_urls_all: [],
        product_image_url: firstProductImage,
        manual_products: manualPayload,
        product_name: manualPayload?.[0]?.info?.split("\n")[0] || "",
        // TikTok product_id from the affiliate scrape (empty for manual
        // mode). Persisted on each history row's metadata so the
        // existing creative-hack-auto extension's auto-post handler
        // can deep-link back to the original product page.
        tiktok_product_id: tiktokProductId || "",
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
        : "Generating master plan…");

      abortRef.current = new AbortController();
      const r = await fetch("/api/generate/auto-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
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
      // User-initiated cancel — keep UX quiet.
      if (e?.name === "AbortError") {
        pushLog("Stopped by user.");
        setStatus("idle");
        return;
      }
      pushLog(`✗ ${e?.message || "Network error"}`);
      setError(e?.message || "Network error");
      setStatus("failed");
    } finally {
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
  }

  async function approveVerifyPlan() {
    if (!pendingPlan || !pendingPayload) return;
    setStatus("generating");
    pushLog("Plan approved — firing Veo generations…");
    abortRef.current = new AbortController();
    try {
      const r = await fetch("/api/generate/auto-content/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pendingPayload,
          preset_plan: pendingPlan,
          plan_mode: "approved",
        }),
        signal: abortRef.current.signal,
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
      if (e?.name === "AbortError") {
        pushLog("Stopped by user.");
        setStatus("verifying");
        return;
      }
      pushLog(`✗ ${e?.message || "Network error"}`);
      setError(e?.message || "Network error");
      setStatus("failed");
    } finally {
      abortRef.current = null;
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

        {/* Affiliate / Manual toggle. Affiliate = paste URL, scrape via
            Crawlbase, auto-fill manual_products[0]. Manual = upload
            directly. The submit body is identical either way (both paths
            populate manual_products[]). */}
        <div className="flex rounded-lg overflow-hidden mb-3" style={{ border: "1px solid #e8e0d8" }}>
          <ToggleBtn
            active={productMode === "affiliate"}
            onClick={() => {
              setProductMode("affiliate");
              // Switching to Affiliate clears any manual product data so
              // the user starts with a clean slate. Affiliate flow re-
              // populates manual_products[0] when a product is picked.
              setManualProducts((prev) =>
                prev.map(() => ({ info: "", imageData: "" }))
              );
              setScrapeMsg(null);
            }}
          >
            🔗 Affiliate
          </ToggleBtn>
          <ToggleBtn
            active={productMode === "manual"}
            onClick={() => {
              setProductMode("manual");
              // Manual flow has no TikTok ID — clear so it doesn't
              // accidentally ride through with leftover data from a
              // previous Affiliate fetch. Also clear the affiliate URL +
              // any prefilled product card so user starts fresh.
              setTiktokProductId("");
              setAffiliateUrl("");
              setScrapeMsg(null);
              setShowRecent(false);
              setManualProducts((prev) =>
                prev.map(() => ({ info: "", imageData: "" }))
              );
            }}
            borderLeft
          >
            📦 Manual Product
          </ToggleBtn>
        </div>

        {productMode === "affiliate" && (
          <div className="space-y-2 mb-4">
            {/* Stack input + Fetch Product vertically on mobile so the URL
                field has full width. Side-by-side on sm+ stays as before. */}
            <div className="flex flex-col sm:flex-row gap-2 relative">
              <div className="flex-1 relative min-w-0">
                <input
                  type="url"
                  value={affiliateUrl}
                  readOnly
                  placeholder="Pick a product from the dropdown →"
                  title="Use the Chrome extension's Affiliate tab to fetch new products. They will appear in the dropdown."
                  className={`w-full p-3 ${affiliateUrl ? "pr-28" : "pr-20"} rounded-xl text-sm outline-none cursor-pointer`}
                  style={{ background: "#fafaf7", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
                  onClick={() => {
                    if (!showRecent) loadRecentProducts();
                    setShowRecent((s) => !s);
                  }}
                />
                {/* Clear button — only shows when a product is currently
                    loaded. Resets the URL + product card so the user can
                    pick a different product without manually clearing. */}
                {affiliateUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAffiliateUrl("");
                      setScrapeMsg(null);
                      setTiktokProductId("");
                      setShowRecent(false);
                      setManualProducts((prev) =>
                        prev.map(() => ({ info: "", imageData: "" }))
                      );
                    }}
                    title="Clear selection"
                    aria-label="Clear product selection"
                    className="absolute top-1/2 right-[88px] -translate-y-1/2 flex items-center justify-center rounded-lg hover:bg-red-50"
                    style={{
                      width: "32px",
                      height: "32px",
                      border: "1px solid #e8e0d8",
                      background: "#ffffff",
                      color: "#dc2626",
                      fontSize: "16px",
                      fontWeight: 700,
                    }}
                  >
                    ✕
                  </button>
                )}
                {/* History icon + count — always visible so users can
                    open the dropdown even when empty (shows the
                    fetch-via-extension hint inside). Count shows 0
                    initially, updates as products are saved. */}
                <button
                  type="button"
                  onClick={() => {
                    // Always refetch on click so the dropdown reflects
                    // products that were just fetched in the extension —
                    // no stale "0 saved" state if user just added one.
                    loadRecentProducts();
                    setShowRecent((s) => !s);
                  }}
                  title={
                    recentProducts.length === 0
                      ? "No saved products yet — use the Chrome extension's Affiliate tab. Click to refresh."
                      : `${recentProducts.length} saved product${recentProducts.length === 1 ? "" : "s"} — click to pick / refresh`
                  }
                  aria-label="Open saved products dropdown"
                  className="absolute top-1/2 right-2 -translate-y-1/2 flex items-center justify-center gap-1 rounded-lg hover:bg-yellow-100"
                  style={{
                    height: "32px",
                    padding: "0 8px",
                    border: "1px solid #e8e0d8",
                    background: showRecent ? "#fff8d6" : "#ffffff",
                    color: "#1a1a1a",
                    fontSize: "14px",
                    fontWeight: 700,
                  }}
                >
                  <span style={{ fontSize: "15px" }}>🕐</span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "#1a1a1a",
                      background: "#facc15",
                      borderRadius: "999px",
                      padding: "1px 6px",
                      minWidth: "18px",
                      textAlign: "center",
                      lineHeight: "1.4",
                    }}
                  >
                    {recentProducts.length}
                  </span>
                </button>
                {showRecent && (
                  <div
                    className="absolute left-0 right-0 top-full mt-1 z-30 max-h-72 overflow-y-auto rounded-xl shadow-lg"
                    style={{
                      background: "#ffffff",
                      border: "1px solid #e8e0d8",
                    }}
                  >
                    <div
                      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: "#8a7a6a", borderBottom: "1px solid #f0e8de" }}
                    >
                      Your saved products ({recentProducts.length})
                    </div>
                    {recentProducts.length === 0 && (
                      <div className="px-3 py-4 text-[11px] leading-relaxed" style={{ color: "#5b21b6", background: "rgba(124,58,237,0.04)" }}>
                        💡 Belum ada produk saved. Buka <strong>Chrome extension → 🔗 Affiliate tab</strong>, paste TikTok/Shopee link, click <strong>Fetch Product</strong>. Produk akan muncul di sini.
                      </div>
                    )}
                    {recentProducts.map((p) => (
                      <div
                        key={p.product_id}
                        className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-yellow-50"
                        style={{ borderBottom: "1px solid #f7f0e6" }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setShowRecent(false);
                            fetchAffiliate(p.raw_url);
                          }}
                          className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
                        >
                        {p.product_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.product_image_url}
                            alt=""
                            className="w-9 h-9 rounded-md object-cover flex-shrink-0"
                            style={{ background: "#f0e8de" }}
                            referrerPolicy="no-referrer"
                            crossOrigin="anonymous"
                            onError={(e) => {
                              const img = e.currentTarget;
                              img.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-md flex-shrink-0" style={{ background: "#f0e8de" }} />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate" style={{ color: "#1a1a1a" }}>
                            {p.product_name}
                          </div>
                          {p.price && (
                            <div className="text-[10px] mt-0.5" style={{ color: "#8a7a6a" }}>
                              {p.price}
                            </div>
                          )}
                        </div>
                        </button>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            // Optimistically remove from local list
                            const pid = p.product_id;
                            setRecentProducts((prev) =>
                              prev.filter((x) => x.product_id !== pid)
                            );
                            try {
                              await fetch("/api/scrape/delete", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ productId: pid }),
                              });
                            } catch {
                              // Best-effort — local list already updated
                            }
                          }}
                          title="Remove from list"
                          aria-label="Delete saved product"
                          className="flex items-center justify-center rounded-md hover:bg-red-100 flex-shrink-0"
                          style={{
                            width: "28px",
                            height: "28px",
                            color: "#dc2626",
                            fontSize: "16px",
                            fontWeight: 700,
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Fetch button hidden — products are now scraped via the
                  Chrome extension's Affiliate tab and appear in the
                  dropdown above. URL input is readonly here. */}
            </div>
            {scrapeMsg && (
              <div
                className="text-xs px-3 py-2 rounded-lg"
                style={
                  scrapeMsg.ok
                    ? {
                        background: "rgba(250,204,21,0.12)",
                        border: "1px solid rgba(250,204,21,0.5)",
                        color: "#15803d",
                      }
                    : {
                        background: "rgba(244,67,54,0.08)",
                        border: "1px solid rgba(244,67,54,0.4)",
                        color: "#c62828",
                      }
                }
              >
                {scrapeMsg.text}
              </div>
            )}
            <div className="text-[10px] text-gray-500">
              Untuk Fetch Buka Extension Auto Post Tab Affliate
            </div>
          </div>
        )}

        {/* Manual product slots. In affiliate mode the slot is hidden
            until a successful scrape populates it — keeps the UI clean
            and signals "paste link first" to the user. Once the scrape
            fills slot 0, the card appears so they can edit / replace
            the auto-filled fields before firing. */}
        {(productMode === "manual" ||
          manualProducts[0]?.imageData ||
          manualProducts[0]?.info?.trim()) && (
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
          {/* Style (hijab) only applies to female personas. When user
              flips to male, hide the column and force hijab=no so it
              never rides through to the avatar prompt as a stray flag.
              Grid collapses 3→2 cols so the remaining fields fill the
              row evenly. */}
          <div className={`grid gap-3 grid-cols-2 ${gender === "male" ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
            <div>
              <Label>Gender</Label>
              <Select
                value={gender}
                onChange={(v) => {
                  const next = v as "female" | "male";
                  setGender(next);
                  if (next === "male") setHijab("no");
                }}
              >
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </div>
            {gender === "female" && (
              <div>
                <Label>Style</Label>
                <Select value={hijab} onChange={(v) => setHijab(v as any)}>
                  <option value="yes">Hijab</option>
                  <option value="no">No Hijab</option>
                </Select>
              </div>
            )}
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

        {/* Duration — locked to 8s for now. The 16s (2 shots) option
            is hidden per product decision: users should extend an 8s
            clip via the dedicated Extend flow rather than batch-
            generating two seg-1's upfront. The state default of "8"
            is preserved so the rest of the pipeline (cost, locks,
            placeholder rows) keeps working unchanged. */}
        <div className="flex gap-2 mb-3">
          <DurationBtn active={true} onClick={() => setDuration("8")}>
            8s (1 shot)
          </DurationBtn>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <Label>Size</Label>
          <Select value={aspect} onChange={(v) => setAspect(v)} width={100}>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </Select>
        </div>

        {/* Plan mode buttons — Verify Plan removed per design;
            AI Plan and Manual Plan only. */}
        <Label>Plan Mode</Label>
        <div className="flex gap-2 mb-3">
          <PlanModeBtn active={planMode === "aiplan"} onClick={() => setPlanMode("aiplan")}>
            AI Plan
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
            <div className="flex items-center justify-between">
              <Label>
                Plan JSON{" "}
                <span className="text-gray-400 font-normal normal-case tracking-normal">
                  (array of plan objects)
                </span>
              </Label>
              <button
                type="button"
                onClick={() => setShowManualPlanHelp(true)}
                className="text-[11px] font-bold inline-flex items-center gap-1 px-2.5 py-1 rounded-lg mb-1.5 transition"
                style={{
                  background: "#fef3c7",
                  color: "#92400e",
                  border: "1px solid #fde68a",
                }}
              >
                <span style={{ fontSize: 13 }}>ⓘ</span> How to format?
              </button>
            </div>
            <textarea
              rows={6}
              value={manualPlanJson}
              onChange={(e) => setManualPlanJson(e.target.value)}
              placeholder={`[\n  {\n    "videoPromptShot1": "Close-up of a person spraying the product...",\n    "caption": "PASTI WANGI",\n    "needsCharacterImage": true,\n    "coverTitle": "BAU KETIAK?",\n    "coverSubtitle": "SOLUSI SIHAT GILA!"\n  }\n]`}
              className="w-full p-3 rounded-xl text-[11px] font-mono resize-y outline-none mb-4"
              style={{ background: "#f0f5ec", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
            />
          </>
        )}

        {/* Manual Plan Help modal — two examples (full from AI export
            shape vs minimal hand-written) with copy buttons. */}
        {showManualPlanHelp && (
          <ManualPlanHelpModal
            onClose={() => setShowManualPlanHelp(false)}
            onUseExample={(json) => {
              setManualPlanJson(json);
              setShowManualPlanHelp(false);
            }}
          />
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
          {busy && (
            <button
              type="button"
              onClick={stop}
              title="Stop"
              className="h-11 w-11 rounded-xl flex items-center justify-center transition-all hover:-translate-y-0.5"
              style={{
                background: "rgba(244,67,54,0.08)",
                border: "1px solid rgba(244,67,54,0.4)",
                color: "#c62828",
              }}
            >
              <Square className="w-4 h-4" fill="#c62828" strokeWidth={0} />
            </button>
          )}
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
                    style={{ background: "rgba(250,204,21,0.15)", color: GREEN }}
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
            className="w-full py-3 rounded-xl font-extrabold text-sm"
            style={{
              background: `linear-gradient(135deg, ${GREEN}, #fde047)`,
              boxShadow: "0 4px 14px rgba(250,204,21,0.5)",
              color: "#1a1a1a",
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
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageData}
              alt=""
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
            />
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

  // Reusable section block — colored heading + content. Used to visually
  // separate the 6 strategy parts so the modal doesn't read like a wall.
  const Section = ({ icon, title, body, accent }: {
    icon: string;
    title: string;
    body: string;
    accent?: string;
  }) => (
    <div
      className="rounded-lg p-3 mb-2"
      style={{
        background: "#fafaf7",
        border: `1px solid ${accent || "#e8e0d8"}`,
      }}
    >
      <div
        className="text-[10px] font-extrabold uppercase tracking-wider mb-1.5 flex items-center gap-1.5"
        style={{ color: accent || color }}
      >
        <span>{icon}</span>
        <span>{title}</span>
      </div>
      <div className="text-xs leading-relaxed text-gray-800">{body}</div>
    </div>
  );

  return (
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-stretch md:items-center justify-center md:p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="md:rounded-2xl max-w-lg w-full md:max-h-[90vh] flex flex-col"
        style={{ background: "#ffffff", border: `2px solid ${color}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — sticky */}
        <div
          className="flex items-center justify-between gap-2 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: "1px solid #e8e0d8" }}
        >
          <div className="flex-1 min-w-0">
            <h3 className="font-display font-extrabold text-base truncate">{fw.name}</h3>
            <p className="text-[11px] text-gray-600 truncate">{fw.focus}</p>
          </div>
          <span
            className="text-[10px] font-bold px-2 py-1 rounded flex-shrink-0"
            style={{ color, background: `${color}20` }}
          >
            {tlabel}
          </span>
          {fw.strictUsp && (
            <span
              className="text-[10px] font-extrabold px-2 py-1 rounded flex-shrink-0"
              style={{ color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca" }}
              title="Strict mode — AI cannot drift from product info"
            >
              🔒 STRICT
            </span>
          )}
          {fw.handPov && (
            <span
              className="text-[10px] font-extrabold px-2 py-1 rounded flex-shrink-0"
              style={{ color: "#7c3aed", background: "#f5f3ff", border: "1px solid #ddd6fe" }}
              title="Hand-POV — hand visible holding product, no face/body, rotating authentic backgrounds"
            >
              ✋ HAND POV
            </span>
          )}
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Strict warning callout — highlight no-drift behavior */}
          {fw.strictUsp && (
            <div
              className="rounded-lg p-3 mb-3 text-xs leading-relaxed"
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#7f1d1d",
              }}
            >
              <div className="font-extrabold mb-1">🔒 Strict USP Mode</div>
              AI tak boleh invent benefits / numbers / ingredients / personal stories
              yang takde dalam product info korang. Setiap dialog & caption WAJIB tied
              to actual USP yang korang provide. Best untuk client yang bagi clear
              product details.
            </div>
          )}

          {/* Hand POV callout — explain the unique visual style */}
          {fw.handPov && (
            <div
              className="rounded-lg p-3 mb-3 text-xs leading-relaxed"
              style={{
                background: "#f5f3ff",
                border: "1px solid #ddd6fe",
                color: "#5b21b6",
              }}
            >
              <div className="font-extrabold mb-1">✋ Hand POV Mode</div>
              Tangan sahaja yang nampak (no face, no body) pegang produk dengan
              gentle shake animation. Background rotate antara <strong>luxury cars</strong>
              {" "}(Lambo / Mercedes / Ferrari) / <strong>everyday cars</strong> (Honda /
              Perodua) / <strong>aesthetic indoor</strong> (cozy curtain+plant) /
              {" "}<strong>retail aisles</strong> (Watsons / Aeon) / <strong>cozy lifestyle</strong>
              {" "}(coffee shop / vanity table). Hand gender ikut avatar pilihan korang
              (male/female).
            </div>
          )}

          <Section
            icon="🎯"
            title="Purpose — Apa framework ni buat"
            body={fw.strategy.purpose}
          />
          <Section
            icon="✅"
            title="Best For — Bila pakai"
            body={fw.strategy.bestFor}
            accent="#16a34a"
          />
          <Section
            icon="❌"
            title="Avoid When — Bila JANGAN pakai"
            body={fw.strategy.avoidWhen}
            accent="#dc2626"
          />
          <Section
            icon="🧠"
            title="Psychology — Kenapa berkesan"
            body={fw.strategy.psychology}
            accent="#9333ea"
          />
          <Section
            icon="💬"
            title="Dialog Shape — Struktur ayat"
            body={fw.strategy.dialogShape}
            accent="#0891b2"
          />
          <Section
            icon="📝"
            title="Example — Contoh dialog"
            body={fw.strategy.example}
            accent="#ea580c"
          />

          {/* Original shot directions kept at bottom for reference */}
          <div className="mt-4 pt-3" style={{ borderTop: "1px solid #e8e0d8" }}>
            <div className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400 mb-2">
              Shot directions (technical)
            </div>
            <div
              className="rounded p-3 mb-2"
              style={{ background: "#f9fafb", border: "1px solid #e8e0d8" }}
            >
              <div className="text-[10px] font-bold mb-1" style={{ color }}>
                SHOT 1 (0-8s) — Hook
              </div>
              <div className="text-xs leading-relaxed text-gray-700">{fw.shot1}</div>
            </div>
            <div
              className="rounded p-3"
              style={{ background: "#f9fafb", border: "1px solid #e8e0d8" }}
            >
              <div className="text-[10px] font-bold mb-1" style={{ color }}>
                SHOT 2 (8-16s) — CTA
              </div>
              <div className="text-xs leading-relaxed text-gray-700">{fw.shot2}</div>
            </div>
            {fw.emotion !== "none" && (
              <div className="text-[10px] text-gray-500 mt-2">
                Emotion arc: <span className="font-bold">{fw.emotion}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer — sticky CTA */}
        <div
          className="px-5 py-3 flex-shrink-0"
          style={{ borderTop: "1px solid #e8e0d8" }}
        >
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-xs font-extrabold"
            style={{
              background: `linear-gradient(135deg, ${GREEN}, #fde047)`,
              color: "#1a1a1a",
            }}
          >
            Faham — tutup
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ── Sub-components (Card, Label, Select, ToggleBtn, DurationBtn, CtaRadio,
//                   SmallBtn, HistoryPicker) ────────────────────────────

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
              color: "#1a1a1a",
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
              background: `linear-gradient(135deg, ${GREEN}, #fde047)`,
              color: "#1a1a1a",
              boxShadow: "0 4px 14px rgba(250,204,21,0.4)",
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
              background: `linear-gradient(135deg, ${GREEN}, #fde047)`,
              color: "#1a1a1a",
              boxShadow: "0 4px 14px rgba(250,204,21,0.4)",
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
          ? { background: "rgba(250,204,21,0.15)", color: "#1a1a1a" }
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
        .select("id, output_url, created_at")
        .eq("type", "image")
        .eq("status", "done")
        .not("output_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      const rows = (data as any[]) || [];
      const saved = await fetchSavedSet(rows.map((r: any) => r.id));
      setItems(rows.filter((r: any) => isVisibleAfterTtl(r.created_at, saved.has(r.id))) as any);
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

// ──────────────────────────────────────────────────────────────────────────
// ManualPlanHelpModal — explains the 2 valid shapes for Manual JSON
// ──────────────────────────────────────────────────────────────────────────
//
// Method 1 — full AI-export shape (what comes out of Saved Prompts when
//   the AI ran the master plan; copy-paste this directly to recreate).
// Method 2 — minimal hand-written shape (only videoPromptShot1 is
//   required; everything else is optional and falls through to defaults).
//
// imagePrompt is intentionally omitted from both — Auto Content always
// runs in noImageMode=true, the uploaded product image IS the r2v
// reference. Including imagePrompt would be misleading.

const MANUAL_PLAN_FULL_EXAMPLE = `[
  {
    "videoPromptShot1": "Close-up of a person spraying product on underarm, smiling at camera in surprise. Bright daylight, modern bathroom. Female Malay voice: 'Tak sangka boleh hilang dalam 3 saat!'",
    "videoPromptShot2": "",
    "caption": "PASTI WANGI sepanjang hari! 💪 Cuba sendiri #DeoFreshMY #BauKetiak #ViralMY #FYPMalaysia #MestiCuba",
    "frameworkName": "Product Hero (AIDA)",
    "frameworkType": "ugc",
    "needsCharacterImage": true,
    "hookAngle": "Shock Result / Numbers",
    "targetEmotion": "Trust & Curiosity",
    "coverTitle": "BAU KETIAK?",
    "coverSubtitle": "SOLUSI SIHAT GILA!"
  }
]`;

const MANUAL_PLAN_MIN_EXAMPLE = `[
  {
    "videoPromptShot1": "Close-up of a person spraying the product on their underarm, then smiling at the camera in surprise. Bright daylight, modern bathroom. Female Malay voice: 'Tak sangka boleh hilang dalam 3 saat!'",
    "caption": "PASTI WANGI",
    "needsCharacterImage": true,
    "coverTitle": "BAU KETIAK?",
    "coverSubtitle": "SOLUSI SIHAT GILA!"
  }
]`;

function ManualPlanHelpModal(props: { onClose: () => void; onUseExample: (json: string) => void }) {
  const [tab, setTab] = useState<"full" | "min">("min");
  const example = tab === "full" ? MANUAL_PLAN_FULL_EXAMPLE : MANUAL_PLAN_MIN_EXAMPLE;
  const copy = () => {
    navigator.clipboard.writeText(example);
  };
  return (
    <Portal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
        onClick={props.onClose}
      >
        <div
          className="rounded-2xl max-w-2xl w-full max-h-[88vh] flex flex-col bg-white"
          onClick={(e) => e.stopPropagation()}
          style={{ border: "2px solid #fcd34d" }}
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: "#fef3c7" }}>
            <div>
              <h3 className="font-display font-extrabold text-base" style={{ color: "#92400e" }}>
                Manual Plan JSON — How to format
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Two valid shapes. Pick the one that fits your workflow.
              </p>
            </div>
            <button
              onClick={props.onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-500 text-lg"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="flex gap-1 p-1.5 mx-4 mt-3 rounded-xl bg-gray-100">
            <button
              type="button"
              onClick={() => setTab("min")}
              className="flex-1 py-2 rounded-lg text-xs font-bold transition"
              style={
                tab === "min"
                  ? { background: "white", color: "#1a1a1a", boxShadow: "0 2px 6px rgba(0,0,0,0.06)" }
                  : { background: "transparent", color: "#6b7280" }
              }
            >
              ✨ Method 1 — Minimal (recommended)
            </button>
            <button
              type="button"
              onClick={() => setTab("full")}
              className="flex-1 py-2 rounded-lg text-xs font-bold transition"
              style={
                tab === "full"
                  ? { background: "white", color: "#1a1a1a", boxShadow: "0 2px 6px rgba(0,0,0,0.06)" }
                  : { background: "transparent", color: "#6b7280" }
              }
            >
              📋 Method 2 — Full export shape
            </button>
          </div>

          <div className="p-4 flex-1 overflow-y-auto">
            {tab === "min" ? (
              <div className="text-xs text-gray-700 space-y-2 mb-3">
                <p className="font-bold text-gray-800">When to use:</p>
                <p>You're writing the prompt yourself. Only <code className="bg-amber-50 text-amber-800 px-1 rounded">videoPromptShot1</code> is required — everything else is optional.</p>
                <ul className="list-disc list-inside space-y-1 text-gray-600 ml-2">
                  <li>Skip <code className="bg-gray-100 px-1 rounded">videoPromptShot2</code> for an 8-second video</li>
                  <li>Skip <code className="bg-gray-100 px-1 rounded">imagePrompt</code> entirely — Auto Content always uses your uploaded product image as the r2v reference</li>
                  <li><code className="bg-gray-100 px-1 rounded">caption</code> auto-fills from coverTitle if too short</li>
                </ul>
              </div>
            ) : (
              <div className="text-xs text-gray-700 space-y-2 mb-3">
                <p className="font-bold text-gray-800">When to use:</p>
                <p>You're recreating a plan from a previous AI generation. This is the exact shape that lands in Saved Prompts when AI plan mode runs.</p>
                <ul className="list-disc list-inside space-y-1 text-gray-600 ml-2">
                  <li>Includes <code className="bg-gray-100 px-1 rounded">frameworkName</code>, <code className="bg-gray-100 px-1 rounded">hookAngle</code>, <code className="bg-gray-100 px-1 rounded">targetEmotion</code> for organisation</li>
                  <li>Empty <code className="bg-gray-100 px-1 rounded">videoPromptShot2</code> = 8s video; filled = 16s extended video</li>
                  <li>Compatible with creative-hack-auto extension paste-back</li>
                </ul>
              </div>
            )}

            <pre
              className="rounded-lg p-3 text-[10px] font-mono leading-relaxed whitespace-pre-wrap overflow-auto"
              style={{
                background: "#1a1a1a",
                color: "#a7f3d0",
                maxHeight: "40vh",
              }}
            >
              {example}
            </pre>
          </div>

          <div className="px-4 py-3 border-t flex items-center justify-end gap-2" style={{ borderColor: "#fef3c7", background: "#fffbeb" }}>
            <button
              type="button"
              onClick={props.onClose}
              className="px-4 py-2 rounded-lg text-xs font-bold"
              style={{ background: "white", border: "1px solid #fde68a", color: "#92400e" }}
            >
              Close
            </button>
            <button
              type="button"
              onClick={copy}
              className="px-4 py-2 rounded-lg text-xs font-bold"
              style={{ background: "white", border: "1px solid #fde68a", color: "#92400e" }}
            >
              📋 Copy JSON
            </button>
            <button
              type="button"
              onClick={() => props.onUseExample(example)}
              className="px-4 py-2 rounded-lg text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" }}
            >
              ✨ Use this example
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
