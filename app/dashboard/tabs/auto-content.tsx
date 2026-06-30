"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Wand2, X, Info, Square } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { isVisibleAfterTtl, fetchSavedSet } from "@/lib/history-filter";
import AttachmentPicker from "../sections/attachment-picker";
import ProductRefTips from "../sections/product-ref-tips";
import ScrapePicker from "../sections/scrape-picker";
import { SORA2_DISABLED } from "@/lib/feature-flags";
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
  info: string;          // textarea content (backend field). For manual mode it
                         // is kept in sync as `name + "\n" + detail`.
  name?: string;         // manual mode: Product Name (line 1 of info)
  detail?: string;       // manual mode: Detail Product (rest of info)
  imageData: string;     // primary slot (also used by affiliate auto-fill)
  imageUrls: string[];   // multi-pick slots 1-3. imageData mirrors imageUrls[0].
};

// Merge the manual Product Name + Detail Product into the single `info` field
// the backend consumes: name on the first line, detail below.
function mergeManualInfo(name?: string, detail?: string): string {
  return [String(name || "").trim(), String(detail || "").trim()].filter(Boolean).join("\n");
}

type RecentProduct = {
  product_id: string;
  raw_url: string;
  product_name: string;
  product_image_url: string;
  hosted_image_url: string | null;
  description: string | null;
  price: string | null;
  rating: string | null;
  total_sold: string | null;
  category: string | null;
  last_used_at: string;
};

export default function AutoContentTab({ projectId }: { projectId?: string } = {}) {
  // Product source — Affiliate (paste URL → scrape via Crawlbase →
  // auto-fills info + image) OR Manual (upload directly). Both end up
  // submitting product_mode "manual" downstream because the same
  // manual_products[] payload shape is used either way; the affiliate
  // path just pre-fills it.
  // Merged single "Product" panel — default to the manual form look; the
  // mode flips to "affiliate" only when the user picks an affiliate link
  // from the 🔗 dropdown (so Save still records the TikTok product_id).
  const [productMode, setProductMode] = useState<ProductMode>("manual");
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
    { info: "", imageData: "", imageUrls: [] },
  ]);

  // Avatar persona
  const [gender, setGender] = useState<"female" | "male">("female");
  const [hijab, setHijab] = useState<"yes" | "no">("yes");
  const [age, setAge] = useState<"20s" | "30s" | "40s" | "55+">("30s");

  // Settings
  // Provider — Veo 3.1 (default) or Grok. Veo keeps the 8/16 duration
  // semantics; Grok exposes a 6-30s per-second slider instead. Both
  // share the master plan; only the dialog word-count target differs.
  // Provider state — "grok" key is preserved internally to avoid a wide
  // backend refactor (auto-content route has many providerChoice="grok"
  // branches). UI relabels it as "⚡ Sora 2" per user direction (Grok
  // server unstable, Sora 2 is the replacement). When the user picks
  // "Sora 2", we still set state to "grok" but the backend body sends
  // model: "sora2" instead of "grok" so it routes through APIPod's
  // sora-2-vip endpoint (via lib/p6.ts apipodVideoModel detection).
  const [provider, setProvider] = useState<"veo" | "grok" | "gemini">("veo");
  const [duration, setDuration] = useState<"8" | "16">("8");
  // Sora 2 duration (4 / 8 / 12 only per APIPod spec). Default 4 (shortest
  // / cheapest). Internal state name kept as grokDuration for backward
  // compat with backend providerChoice='grok' branches.
  const [grokDuration, setGrokDuration] = useState<number>(4);
  // Live rate_sora2 for cost preview. /api/sora2/rate falls back to
  // cinema_rate × 2 when no dedicated sora2_rate is configured.
  const [grokRate, setGrokRate] = useState<number | null>(null);
  // GeminiOmni flat per-10s-video rate. The Auto Content storyboard
  // mode also charges a hidden GPT Image 2 fee (~RM 0.30 per row) but
  // per user direction the preview UI only shows the video rate.
  const [geminiRate, setGeminiRate] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.rate === "number") setGrokRate(d.rate);
      })
      .catch(() => {});
    fetch("/api/gemini/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (alive && typeof d?.rate === "number") setGeminiRate(d.rate);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [aspect, setAspect] = useState("9:16");
  const [ctaMode, setCtaMode] = useState<CtaMode>("shop");
  const [customCta, setCustomCta] = useState("");
  const [quantity, setQuantity] = useState(5);

  // Plan mode
  const [planMode, setPlanMode] = useState<PlanMode>("aiplan");
  const [selectedFrameworks, setSelectedFrameworks] = useState<number[]>([]);
  const [manualPlanJson, setManualPlanJson] = useState("");
  const [showManualPlanHelp, setShowManualPlanHelp] = useState(false);

  // Plan style — "normal" runs the standard master plan (framework-only
  // driven). "custom" exposes a textarea where the client types a
  // specific visual idea (e.g. "preview baju depan cermin"); the master
  // plan then makes that idea the core scene of every video in the
  // batch. Default is normal so power users don't have to toggle
  // anything for the usual flow.
  const [planStyle, setPlanStyle] = useState<"normal" | "custom">("normal");
  const [ideaStyle, setIdeaStyle] = useState("");

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
  // Attachment picker — opened by the manual-product Upload button.
  const [attachmentSlot, setAttachmentSlot] = useState<number | null>(null);
  // Saved-product presets — save name/detail/3-attachments once, reload on
  // reselect so clients never redo work. See /api/auto-content/*.
  type SavedProduct = { id: string; kind: "affiliate" | "manual"; product_id: string | null; product_name: string; detail: string | null; attachments: string[] };
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [savedManual, setSavedManual] = useState<SavedProduct[]>([]);
  // 📦 saved-manual dropdown open state (merged Product panel).
  const [showSavedManual, setShowSavedManual] = useState(false);
  // Per-product scrape state. Click "Scrape" → loading=true → fetch
  // fires → either `images: string[]` or `error: string` lands here.
  // The count badge that replaces the Scrape button reads from this map.
  type ScrapeRow = {
    loading: boolean;
    images: string[] | null;
    query: string | null;
    error: string | null;
  };
  const [scrapeByIdx, setScrapeByIdx] = useState<Record<number, ScrapeRow>>({});
  // Which product's scrape modal is open (count-badge → click to open).
  const [scrapePickerIdx, setScrapePickerIdx] = useState<number | null>(null);

  // Aborts the in-flight planning fetch when the user hits Stop.
  const abortRef = useRef<AbortController | null>(null);

  // Ensure manualProducts array always matches unitCount
  useEffect(() => {
    setManualProducts((prev) => {
      const next = [...prev];
      while (next.length < unitCount) next.push({ info: "", imageData: "", imageUrls: [] });
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
    loadSavedManual();
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

  function pickAttachmentForManual(idx: number, urls: string[]) {
    setManualProducts((prev) =>
      prev.map((p, i) =>
        i === idx
          ? { ...p, imageData: urls[0] || "", imageUrls: urls }
          : p
      )
    );
    setAttachmentSlot(null);
  }

  // Fire the Google Images scrape for product `idx` and stash the result.
  // The Scrape button switches to a spinner while loading, then to a
  // "🖼️ N images" count badge that opens the picker on click. The
  // picker writes to the user's Attachments library (NOT directly to
  // product slots) — Scrape and Generate are separate flows now.
  async function fireScrape(idx: number) {
    const product = manualProducts[idx];
    const raw = (product?.info || "").split("\n")[0].trim();
    if (!raw) return;
    setScrapeByIdx((s) => ({
      ...s,
      [idx]: { loading: true, images: null, query: null, error: null },
    }));
    try {
      const r = await fetch("/api/scrape/product-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: raw }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${r.status}`);
      }
      const images: string[] = Array.isArray(data.images) ? data.images : [];
      setScrapeByIdx((s) => ({
        ...s,
        [idx]: { loading: false, images, query: data.query || raw, error: null },
      }));
      // Auto-open the picker so the user can multi-select + save.
      if (images.length > 0) setScrapePickerIdx(idx);
    } catch (e: any) {
      setScrapeByIdx((s) => ({
        ...s,
        [idx]: {
          loading: false,
          images: null,
          query: raw,
          error: e?.message || "scrape failed",
        },
      }));
    }
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
  // Apply a product the user picked from the saved-dropdown DIRECTLY
  // from in-memory data — no /api/scrape/affiliate roundtrip. The
  // dropdown already has every field the form needs (description,
  // price, rating, total_sold, category) from the enriched
  // /api/scrape/recent payload. We just bump last_used_at in the
  // background so cross-session ordering stays correct.
  function applyRecentProduct(p: RecentProduct) {
    setAffiliateUrl(p.raw_url);
    setShowRecent(false);
    setProductMode("affiliate"); // picked an affiliate link → affiliate mode
    setScrapeMsg(null);

    const lines: string[] = [p.product_name];
    if (p.price) lines.push(`Price: ${p.price}`);
    if (p.rating) lines.push(`Rating: ${p.rating}`);
    if (p.total_sold) lines.push(`Sold: ${p.total_sold}`);
    if (p.category) lines.push(`Category: ${p.category}`);
    if (p.description) lines.push("", p.description);
    const info = lines.filter((l) => l !== undefined).join("\n");

    setManualProducts((prev) => {
      const next = [...prev];
      next[0] = {
        info,
        imageData: p.product_image_url || "",
        imageUrls: p.product_image_url ? [p.product_image_url] : [],
      };
      return next;
    });
    setTiktokProductId(p.product_id);
    loadAffiliateSaved(p.product_id); // auto-load the saved 3 attachments, if any
    setScrapeMsg({
      ok: true,
      text: `✓ Loaded "${p.product_name.substring(0, 60)}${
        p.product_name.length > 60 ? "…" : ""
      }" — edit below if needed.`,
    });

    // Optimistic local reorder so the picked product floats to the top
    // without a /api/scrape/recent refetch.
    const nowIso = new Date().toISOString();
    setRecentProducts((prev) => {
      const without = prev.filter((x) => x.product_id !== p.product_id);
      return [{ ...p, last_used_at: nowIso }, ...without];
    });

    // Fire-and-forget bump to persist last_used_at server-side so the
    // ordering survives a refresh / next session.
    void fetch("/api/scrape/touch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: p.product_id }),
    }).catch(() => {});
  }

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
          imageUrls: d.product_image_url ? [d.product_image_url] : [],
        };
        return next;
      });
      // Capture the TikTok product_id from the scrape result so we can
      // stamp it on every generated history row for auto-post later.
      // Manual mode resets this to empty.
      setTiktokProductId(d.product_id ? String(d.product_id) : "");
      if (d.product_id) loadAffiliateSaved(String(d.product_id));
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

  // ── Saved-product presets ──────────────────────────────────────────────
  // Load saved attachments for an affiliate product (by product_id) → apply to
  // the first card so the client doesn't re-pick images.
  async function loadAffiliateSaved(productId: string) {
    if (!productId) return;
    try {
      const r = await fetch(`/api/auto-content/saved-products?product_id=${encodeURIComponent(productId)}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      const urls: string[] = (d?.item?.attachments || []).filter(Boolean).slice(0, 3);
      if (urls.length) {
        setManualProducts((prev) => prev.map((x, j) => (j === 0 ? { ...x, imageUrls: urls, imageData: urls[0] || x.imageData } : x)));
      }
    } catch {}
  }

  // Load the user's saved MANUAL products into the dropdown.
  async function loadSavedManual() {
    try {
      const r = await fetch("/api/auto-content/saved-products?kind=manual", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (Array.isArray(d?.items)) setSavedManual(d.items as SavedProduct[]);
    } catch {}
  }

  // Apply a saved manual product → fill Product Name + Detail + attachments.
  function applyManualSaved(sp: SavedProduct) {
    setProductMode("manual"); // picked a saved manual product → manual mode
    setTiktokProductId("");
    setShowSavedManual(false);
    const urls = (sp.attachments || []).filter(Boolean).slice(0, 3);
    setManualProducts((prev) => prev.map((x, j) => (j === 0 ? {
      ...x,
      name: sp.product_name,
      detail: sp.detail || "",
      info: mergeManualInfo(sp.product_name, sp.detail || ""),
      imageUrls: urls,
      imageData: urls[0] || "",
    } : x)));
  }

  // Save the current product card as a reusable preset (name + detail + 3 imgs).
  async function saveProduct(i: number) {
    const p = manualProducts[i];
    if (!p) return;
    const isAffiliate = productMode === "affiliate";
    const imgs = (p.imageUrls || []).filter(Boolean);
    if (imgs.length < 3) { setSavedMsg("Upload 3 attachments first."); return; }
    if (isAffiliate && !tiktokProductId) { setSavedMsg("Pick the affiliate product first."); return; }
    const productName = isAffiliate
      ? ((p.name || (p.info || "").split("\n")[0] || "Product").trim())
      : (p.name || "").trim();
    if (!isAffiliate && (!productName || !(p.detail || "").trim())) {
      setSavedMsg("Fill Product Name + Detail first."); return;
    }
    setSavingIdx(i); setSavedMsg(null);
    try {
      const r = await fetch("/api/auto-content/save-product", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: isAffiliate ? "affiliate" : "manual",
          product_id: isAffiliate ? tiktokProductId : undefined,
          product_name: productName,
          detail: isAffiliate ? (p.info || null) : (p.detail || null),
          attachments: imgs.slice(0, 3),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Save failed");
      setSavedMsg("✓ Saved");
      if (!isAffiliate) loadSavedManual();
      setTimeout(() => setSavedMsg(null), 4000);
    } catch (e: any) {
      setSavedMsg(e?.message || "Save failed");
    } finally {
      setSavingIdx(null);
    }
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
          // Source of truth is imageUrls (multi-pick). imageData is a
          // legacy mirror that we keep populated for older code paths.
          const srcUrls: string[] =
            m.imageUrls && m.imageUrls.length
              ? m.imageUrls
              : m.imageData
                ? [m.imageData]
                : [];
          if (srcUrls.length === 0) return m;
          const resolved = await Promise.all(
            srcUrls.map(async (url: string) => {
              if (url.startsWith("data:")) {
                return await ensurePublicUrl(url);
              }
              if (
                url.includes("rh-images-switch") ||
                url.includes("running-hub") ||
                url.includes("peninglab-storage") ||
                url.includes("peninglab-content")
              ) {
                // Already public + region-friendly — no rehost needed.
                return url;
              }
              try {
                const r = await fetch("/api/scrape/rehost", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url }),
                });
                const d = await r.json();
                if (r.ok && d?.url) {
                  pushLog(`Product ${idx + 1}: rehosted to RH ✓`);
                  return d.url as string;
                }
                pushLog(`Product ${idx + 1}: rehost failed, using original URL`);
              } catch {
                pushLog(`Product ${idx + 1}: rehost network error, using original URL`);
              }
              return url;
            })
          );
          return { ...m, imageData: resolved[0] || "", imageUrls: resolved };
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
        provider,
        grok_duration: grokDuration,
        aspect_ratio: aspect,
        avatar_gender: gender,
        avatar_hijab: hijab === "yes" ? "hijab" : "no-hijab",
        avatar_age: age,
        cta_mode: ctaMode,
        custom_cta: ctaMode === "custom" ? customCta : "",
        plan_mode: planMode,
        selected_frameworks: selectedFrameworks,
        preset_plan: planMode === "manual" ? JSON.parse(manualPlanJson) : null,
        // Plan style — when Normal Flow is selected we ALWAYS send
        // empty string regardless of whether the textarea has stale
        // content from a previous Custom Idea session. When Custom
        // Idea is selected we send the trimmed textarea. Backend
        // treats empty as "no idea, proceed normally".
        idea_style: planStyle === "custom" ? ideaStyle.trim() : "",
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

        {/* IMPORTANT RULE — prominent attachment-quality guidance.
            Surfaced at the top of Auto Content so users see it BEFORE
            picking a product. Bad attachments are the #1 cause of poor
            AI video output (wrong product size, distracting clutter). */}
        <div
          className="rounded-2xl p-5 mb-5"
          style={{
            background: "linear-gradient(135deg, #fee2e2 0%, #fef3c7 100%)",
            border: "2px solid #dc2626",
            boxShadow: "0 4px 16px rgba(220, 38, 38, 0.15)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">⚠️</span>
            <h3 className="text-xl md:text-2xl font-extrabold uppercase tracking-tight" style={{ color: "#991b1b" }}>
              Important Rule — Tip Untuk Video Konsisten
            </h3>
          </div>
          <p className="text-sm font-bold mb-3" style={{ color: "#7f1d1d" }}>
            3 Attachment yang WAJIB ikut format ni:
          </p>
          <ol className="space-y-2.5 text-sm" style={{ color: "#1a1a1a" }}>
            <li className="flex gap-2">
              <span className="font-extrabold flex-shrink-0" style={{ color: "#dc2626" }}>1)</span>
              <span>
                <strong>Gambar Pertama:</strong> Mestilah tangan pegang product <strong>tanpa tunjuk muka</strong> — supaya AI boleh baca <strong>exactly size product</strong>.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-extrabold flex-shrink-0" style={{ color: "#dc2626" }}>2-3)</span>
              <span>
                <strong>Gambar Kedua &amp; Ketiga:</strong> Gambar product yang <strong>RAW</strong> — tiada tambahan harga, pakej, atau sebarang object lain kat tepi. <strong>Naked product sahaja.</strong>
              </span>
            </li>
          </ol>

          {/* Example reference images for the 3-attachment rule. */}
          <div className="mt-4">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider mb-2"
              style={{ background: "#dc2626", color: "#fff" }}>
              ⓘ Contoh sahaja
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { src: "/ac-rule-1.png", cap: "1) Tangan pegang — tanpa muka" },
                { src: "/ac-rule-2.webp", cap: "2) Product RAW (naked)" },
                { src: "/ac-rule-3.webp", cap: "3) Product RAW (naked)" },
              ].map((im) => (
                <div key={im.src} className="rounded-lg overflow-hidden" style={{ background: "#fff", border: "1px solid rgba(220,38,38,0.35)" }}>
                  {/* object-contain = papar gambar PENUH (tak potong). */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.src} alt={im.cap} className="w-full h-44 object-contain bg-white" />
                  <div className="px-1.5 py-1 text-[9px] font-bold leading-tight" style={{ color: "#7f1d1d" }}>{im.cap}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Affiliate / Manual toggle. Affiliate = paste URL, scrape via
            Crawlbase, auto-fill manual_products[0]. Manual = upload
            directly. The submit body is identical either way (both paths
            populate manual_products[]). */}
        {/* Merged Product panel — one form (manual look). Two icon buttons
            auto-fill it: 🔗 from an affiliate link dropdown, 📦 from saved
            manual products (with their saved attachments). */}
        <div className="flex items-center justify-between mb-2">
          <label className="block text-[11px] font-extrabold uppercase tracking-wider" style={{ color: "#9a3412" }}>
            Product
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                loadRecentProducts();
                setShowRecent((s) => !s);
                setShowSavedManual(false);
              }}
              title="Pilih dari link affiliate (fetch guna extension)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
              style={{ border: "1px solid #e8e0d8", background: showRecent ? "#fff8d6" : "#ffffff", color: "#1a1a1a" }}
            >
              🔗 Affiliate
              <span style={{ fontSize: "10px", background: "#facc15", borderRadius: 999, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{recentProducts.length}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                loadSavedManual();
                setShowSavedManual((s) => !s);
                setShowRecent(false);
              }}
              title="Pilih dari produk manual yang dah Save Attachment"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold"
              style={{ border: "1px solid #e8e0d8", background: showSavedManual ? "#fff8d6" : "#ffffff", color: "#1a1a1a" }}
            >
              📦 Saved Data
              <span style={{ fontSize: "10px", background: "#facc15", borderRadius: 999, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{savedManual.length}</span>
            </button>
          </div>
        </div>

        {/* 📦 Saved manual products dropdown — pick to reload Name + Detail
            + the 3 saved attachments instantly. */}
        {showSavedManual && (
          <div className="mb-3 rounded-xl overflow-hidden" style={{ border: "1px solid #e8e0d8", background: "#ffffff" }}>
            <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#8a7a6a", borderBottom: "1px solid #f0e8de" }}>
              Produk disimpan ({savedManual.length})
            </div>
            {savedManual.length === 0 && (
              <div className="px-3 py-4 text-[11px] leading-relaxed" style={{ color: "#8a7a6a" }}>
                Belum ada produk disimpan. Isi form bawah → tekan <strong>Save Attachment</strong> untuk simpan.
              </div>
            )}
            {savedManual.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => applyManualSaved(s)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-yellow-50"
                style={{ borderBottom: "1px solid #f7f0e6" }}
              >
                {s.attachments?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.attachments[0]} alt="" className="w-9 h-9 rounded-md object-cover flex-shrink-0" style={{ background: "#f0e8de" }} />
                ) : (
                  <div className="w-9 h-9 rounded-md flex-shrink-0" style={{ background: "#f0e8de" }} />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate" style={{ color: "#1a1a1a" }}>{s.product_name}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "#8a7a6a" }}>{(s.attachments || []).length} attachment</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {showRecent && (
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
                        prev.map(() => ({ info: "", imageData: "", imageUrls: [] }))
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
                          onClick={() => applyRecentProduct(p)}
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
        {savedMsg && (
          <div className="mb-2 text-[11px] font-bold" style={{ color: savedMsg.startsWith("✓") ? "#16a34a" : "#dc2626" }}>
            {savedMsg}
          </div>
        )}

        {/* Product form — always visible (manual look). Auto-filled by the
            🔗 affiliate dropdown or 📦 saved-data dropdown above, or typed
            manually. */}
        {true && (
          <div className="space-y-2 mb-4">
            {manualProducts.map((p, i) => (
              <ManualProductCard
                key={i}
                idx={i}
                showLabel={unitCount > 1}
                product={p}
                mode={productMode}
                onInfoChange={(info) =>
                  setManualProducts((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, info } : x))
                  )
                }
                onNameChange={(name) =>
                  setManualProducts((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, name, info: mergeManualInfo(name, x.detail) } : x))
                  )
                }
                onDetailChange={(detail) =>
                  setManualProducts((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, detail, info: mergeManualInfo(x.name, detail) } : x))
                  )
                }
                onPickAttachment={() => setAttachmentSlot(i)}
                onSave={() => saveProduct(i)}
                saving={savingIdx === i}
                onRemoveSlot={(slotIdx) =>
                  setManualProducts((prev) =>
                    prev.map((x, j) => {
                      if (j !== i) return x;
                      const nextUrls = (x.imageUrls || []).filter(
                        (_, k) => k !== slotIdx
                      );
                      return {
                        ...x,
                        imageUrls: nextUrls,
                        // Keep imageData (legacy) in sync with the new first
                        // slot so anything still reading the old field also
                        // reflects the removal.
                        imageData: nextUrls[0] || "",
                      };
                    })
                  )
                }
                onClear={() =>
                  setManualProducts((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, imageData: "", imageUrls: [] } : x
                    )
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

        {/* Provider picker — Veo (default 8s talking-head UGC) vs Sora 2
            (cinematic-style with 8/12s slider). State var still called
            'grok' for backward compat with the providerChoice='grok'
            branches in /api/generate/auto-content (the route maps grok
            slot → model:'sora2' so it routes through APIPod sora-2-vip). */}
        <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
          Provider
        </label>
        {SORA2_DISABLED ? (
          // V1 is Veo-only — show Veo 3.1 + the fixed 8s on ONE half-half row.
          <div className="flex gap-2 mb-3">
            <DurationBtn active={provider === "veo"} onClick={() => setProvider("veo")}>
              🎬 Veo 3.1
            </DurationBtn>
            <DurationBtn active={duration === "8"} onClick={() => setDuration("8")}>
              8s (1 shot)
            </DurationBtn>
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-3">
              <DurationBtn active={provider === "veo"} onClick={() => setProvider("veo")}>
                🎬 Veo 3.1
              </DurationBtn>
              <DurationBtn active={provider === "grok"} onClick={() => setProvider("grok")}>
                ⚡ Sora 2
              </DurationBtn>
              {/* GeminiOmni chip hidden per admin direction — backend still
                  wired (providerChoice='gemini'). Re-enable by removing the
                  `false &&` guard. */}
              {false && (
                <button
                  type="button"
                  onClick={() => setProvider("gemini")}
                  className="flex-1 h-9 rounded-lg text-xs font-extrabold transition-all"
                  style={
                    provider === "gemini"
                      ? {
                          background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
                          color: "white",
                          boxShadow: "0 4px 14px rgba(6,182,212,0.4)",
                        }
                      : {
                          background: "#fafaf7",
                          border: "1px solid #e8e0d8",
                          color: "#888",
                        }
                  }
                >
                  🔷 GeminiOmni
                </button>
              )}
            </div>
            {provider === "veo" && (
              <div className="flex gap-2 mb-3">
                <DurationBtn active={duration === "8"} onClick={() => setDuration("8")}>
                  8s (1 shot)
                </DurationBtn>
              </div>
            )}
          </>
        )}

        {provider === "grok" && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold">
                Duration: {grokDuration}s
              </label>
              {grokRate != null && (
                <span className="text-xs font-bold" style={{ color: "var(--color-orange)" }}>
                  ~RM{((grokRate ?? 0) * grokDuration).toFixed(2)} / video
                </span>
              )}
            </div>
            {/* Sora 2 supports only 8 / 12s in our UI (4s was removed
                per user direction — too short for useful UGC). Button
                group prevents picking invalid durations. grokDuration
                state name preserved for backward compat with backend
                wiring (providerChoice='grok' branch ships model:'sora2'). */}
            <div className="flex gap-2 mb-1">
              {([8, 12] as const).map((d) => {
                const active = grokDuration === d;
                return (
                  <DurationBtn
                    key={d}
                    active={active}
                    onClick={() => setGrokDuration(d)}
                  >
                    {d}s
                  </DurationBtn>
                );
              })}
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Sora 2 (OpenAI) · 8 / 12s · 9:16 or 16:9 only · native
              dialog + ambient audio · higher per-clip cost than Veo.
            </p>
          </div>
        )}

        {/* GeminiOmni — fixed 10s · 1080p (no duration picker). The
            storyboard pipeline always runs at this single setting; the
            pill replaces the picker so the user knows there's nothing
            to choose. Cyan/blue tint mirrors the chip + Original Video
            tab's Gemini surface. */}
        {provider === "gemini" && (
          <div className="mb-3">
            <div
              className="px-3 py-2 rounded-lg text-sm font-bold text-center"
              style={{
                background: "rgba(6,182,212,0.08)",
                border: "1px solid rgba(6,182,212,0.25)",
                color: "#06b6d4",
              }}
            >
              Fixed 10s · 1080p
              {geminiRate != null && (
                <span className="ml-2 text-xs font-bold" style={{ color: "#06b6d4" }}>
                  · ~RM{geminiRate.toFixed(2)} / video
                </span>
              )}
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              GeminiOmni (Google) · 10s · 1080p · storyboard pipeline
              (GPT Image 2 → animate) · single fixed-cost run per row.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4">
          <Label>Size</Label>
          <Select value={aspect} onChange={(v) => setAspect(v)} width={100}>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </Select>
        </div>

        {/* Plan-mode selector hidden — AI Plan is the only path now. The
            Manual Plan JSON UI is preserved below in case we re-enable
            this entry, but the user can no longer reach it from the UI. */}

        {/* Plan Style radio — Normal Flow vs Custom Idea. Normal Flow
            uses framework-only master plan (standard behaviour). Custom
            Idea shows a textarea where the client types the visual
            concept (e.g. "preview baju depan cermin") and the master
            plan makes that the core scene of every video. Default is
            Normal so the usual flow doesn't require a toggle. */}
        {showFrameworks && (
          <>
            <Label>Plan Style</Label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setPlanStyle("normal")}
                className="flex-1 px-3 py-2 rounded-md text-[12px] font-bold transition-colors"
                style={{
                  background: planStyle === "normal" ? "#fef3c7" : "#fafaf7",
                  border: `1px solid ${planStyle === "normal" ? "#f59e0b" : "#e8e0d8"}`,
                  color: planStyle === "normal" ? "#92400e" : "#666",
                }}
              >
                {planStyle === "normal" ? "● " : "○ "}Normal Flow
                <div className="text-[10px] font-normal mt-0.5 opacity-80">
                  AI plan biasa — framework drive scene
                </div>
              </button>
              {/* Rainbow gradient draws the eye to the Custom Idea
                  option so clients notice the new feature. Animated
                  via CSS keyframes (injected once below). When
                  selected, the gradient saturates + a glow appears.
                  When idle, the gradient still pulses softly so it
                  reads as "new / premium" without being noisy. */}
              <button
                type="button"
                onClick={() => setPlanStyle("custom")}
                className="flex-1 relative overflow-hidden px-3 py-2 rounded-md text-[12px] font-bold transition-all"
                style={{
                  background:
                    planStyle === "custom"
                      ? "linear-gradient(120deg, #fef3c7, #fce7f3, #ede9fe, #dbeafe, #ccfbf1, #fef3c7)"
                      : "linear-gradient(120deg, #fff5f7, #f5f3ff, #eff6ff, #ecfeff, #f0fdf4, #fff5f7)",
                  backgroundSize: "300% 100%",
                  animation: planStyle === "custom"
                    ? "ac-rainbow 4s linear infinite"
                    : "ac-rainbow 8s linear infinite",
                  border: `1px solid ${planStyle === "custom" ? "#f59e0b" : "rgba(168,85,247,0.35)"}`,
                  color: planStyle === "custom" ? "#92400e" : "#6b21a8",
                  boxShadow:
                    planStyle === "custom"
                      ? "0 0 0 3px rgba(245,158,11,0.18), 0 2px 8px rgba(168,85,247,0.18)"
                      : "0 2px 8px rgba(168,85,247,0.12)",
                }}
              >
                {/* ✨ NEW badge — top-right corner, only when idle so
                    the user notices the feature exists. Disappears
                    once they engage. */}
                {planStyle !== "custom" && (
                  <span
                    className="absolute top-0.5 right-1 text-[8px] font-bold tracking-wider px-1 py-0.5 rounded"
                    style={{
                      background: "linear-gradient(90deg, #ec4899, #a855f7, #3b82f6)",
                      color: "#fff",
                      boxShadow: "0 1px 3px rgba(168,85,247,0.4)",
                    }}
                  >
                    ✨ NEW
                  </span>
                )}
                <span className="relative z-10">
                  {planStyle === "custom" ? "● " : "○ "}Custom Idea
                </span>
                <div className="relative z-10 text-[10px] font-normal mt-0.5 opacity-80">
                  Client kasi idea — AI buat variants
                </div>
              </button>
            </div>
            {/* Keyframes for the soft rainbow flow on Custom Idea
                button. Scoped via the unique animation name so it
                won't collide with any other animation on the page. */}
            <style>{`
              @keyframes ac-rainbow {
                0%   { background-position: 0% 50%; }
                50%  { background-position: 100% 50%; }
                100% { background-position: 0% 50%; }
              }
            `}</style>

            {planStyle === "custom" && (
              <>
                <Label>
                  Idea Style{" "}
                  <span className="text-gray-400 font-normal normal-case tracking-normal">
                    (describe the visual idea — every video will be built around this)
                  </span>
                </Label>
                <textarea
                  value={ideaStyle}
                  onChange={(e) => setIdeaStyle(e.target.value)}
                  placeholder={`Contoh: "preview baju depan cermin, lighting natural pagi"\nContoh: "unboxing atas meja kayu, slow reveal label"\nContoh: "duduk atas sofa, sambil minum kopi, casual"\n\nFramework still control dialog + on-screen type. Idea control scene + action.`}
                  rows={3}
                  className="w-full mb-4 px-3 py-2 text-[12px] rounded-md outline-none resize-y"
                  style={{
                    background: "#fafaf7",
                    border: "1px solid #e8e0d8",
                    color: "#2a2a2a",
                    minHeight: "70px",
                    maxHeight: "180px",
                  }}
                />
              </>
            )}
          </>
        )}

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
              {FRAMEWORKS
                // Per user: minimal framework choices — only UGC, PRD,
                // and the special POV variant. LIFE (lifestyle) entries
                // are kept in the codebase so old history rows still
                // resolve their framework name, but hidden from the
                // picker so new batches can't select them.
                .filter((fw) => fw.type !== "lifestyle")
                .map((fw) => {
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

      {/* Attachment library picker — replaces the old local-file upload.
          Picked URL is already a public S3 URL on peninglab-storage, so
          submit() skips the RunningHub round-trip entirely. */}
      <AttachmentPicker
        open={attachmentSlot !== null}
        onClose={() => setAttachmentSlot(null)}
        onPickMulti={(arr) => {
          if (attachmentSlot !== null) {
            pickAttachmentForManual(
              attachmentSlot,
              arr.map((a) => a.public_url)
            );
          }
        }}
        maxPick={3}
        defaultCategory="product"
      />
      {/* Google Images scrape picker — opens after first fire and on
          subsequent count-badge clicks. Picks get saved to the user's
          Attachments library (category=product). They then pick from
          Attachments to fill product slots as usual. */}
      <ScrapePicker
        open={scrapePickerIdx !== null}
        onClose={() => setScrapePickerIdx(null)}
        images={
          scrapePickerIdx !== null
            ? scrapeByIdx[scrapePickerIdx]?.images || []
            : []
        }
        query={
          scrapePickerIdx !== null
            ? scrapeByIdx[scrapePickerIdx]?.query || ""
            : ""
        }
        productName={
          scrapePickerIdx !== null
            ? scrapeByIdx[scrapePickerIdx]?.query || ""
            : ""
        }
      />
    </div>
  );
}

// ── ManualProductCard ────────────────────────────────────────────────
function ManualProductCard({
  idx,
  showLabel,
  product,
  mode,
  onInfoChange,
  onNameChange,
  onDetailChange,
  onPickAttachment,
  onSave,
  saving,
  onRemoveSlot,
  onClear,
}: {
  idx: number;
  showLabel: boolean;
  product: ManualProduct;
  mode: "affiliate" | "manual";
  onInfoChange: (s: string) => void;
  onNameChange: (s: string) => void;
  onDetailChange: (s: string) => void;
  onPickAttachment: () => void;
  // Save this product card as a reusable preset.
  onSave: () => void;
  saving: boolean;
  // Clear ONE image slot (slot index i within this product's imageUrls)
  // without touching the text. Lets the user replace a bad image while
  // keeping product_id + description.
  onRemoveSlot: (i: number) => void;
  onClear: () => void;
}) {
  const imgCount = product.imageUrls?.length || 0;
  // Save rules: affiliate needs 3 attachments; manual needs Name + Detail + 3.
  const canSave =
    imgCount >= 3 &&
    (mode === "affiliate" ||
      (!!(product.name || "").trim() && !!(product.detail || "").trim()));
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
      {mode === "manual" ? (
        <>
          <label className="block text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#888" }}>
            Product Name
          </label>
          <input
            type="text"
            maxLength={120}
            value={product.name || ""}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="e.g. LUQFA Lotion 100ml"
            className="w-full p-2 rounded text-xs outline-none mb-2"
            style={{ background: "#ffffff", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
          />
          <label className="block text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: "#888" }}>
            Detail Product
          </label>
          <textarea
            rows={3}
            maxLength={1000}
            value={product.detail || ""}
            onChange={(e) => onDetailChange(e.target.value)}
            placeholder="Price, USP, ingredients, benefits…"
            className="w-full p-2 rounded text-xs resize-y outline-none mb-2"
            style={{ background: "#ffffff", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
          />
        </>
      ) : (
        <textarea
          rows={2}
          maxLength={500}
          value={product.info}
          onChange={(e) => onInfoChange(e.target.value)}
          placeholder={`Product ${idx + 1}: name, price, USP...`}
          className="w-full p-2 rounded text-xs resize-y outline-none mb-2"
          style={{ background: "#ffffff", border: "1px solid #e8e0d8", color: "#1a1a1a" }}
        />
      )}
      {idx === 0 && (
        <div className="mb-2">
          <ProductRefTips />
        </div>
      )}
      <div className="flex items-stretch gap-2">
        {/* Three slots: empty placeholders if not picked. Clicking any
            opens the multi-pick AttachmentPicker. 1 picked → triplicated
            server-side; 2-3 picked → sent as distinct refs to Veo. */}
        <div className="flex gap-1.5">
          {[0, 1, 2].map((i) => {
            const url = product.imageUrls?.[i] || "";
            return (
              <div
                key={i}
                className="relative w-[52px] h-[52px] rounded-lg overflow-hidden flex-shrink-0"
                style={{
                  border: `2px dashed ${url ? "transparent" : AMBER_SOFT}`,
                  background: url ? "#000" : AMBER_FAINT,
                }}
              >
                {/* Whole-slot click target. Use a button (not a div with
                    onClick) so keyboard/tab navigation still works. We
                    wrap in a div above only to host the × badge without
                    nesting buttons. */}
                <button
                  type="button"
                  onClick={onPickAttachment}
                  className="w-full h-full flex items-center justify-center"
                  aria-label={url ? "Replace this image" : `Add image ${i + 1}`}
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <span className="text-[10px] font-bold" style={{ color: AMBER }}>
                      {i + 1}
                    </span>
                  )}
                </button>
                {/* Per-slot × badge — clears only this image, keeps info
                    + product_id + the other slots untouched. Lets the
                    user replace a blurry affiliate-scraped image without
                    losing the scraped metadata. */}
                {url && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveSlot(i);
                    }}
                    className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/70 text-white text-[10px] flex items-center justify-center hover:bg-red-500"
                    aria-label="Clear this image"
                    title="Clear this image (keeps product info)"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-1 justify-between">
          <SmallBtn onClick={onPickAttachment} color={AMBER}>
            Attachments
          </SmallBtn>
          {/* Save Data — store this product's name/detail/3 attachments so the
              client never re-picks. Enabled only when the save rules are met
              (affiliate: 3 imgs · manual: name + detail + 3 imgs). */}
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            title={
              canSave
                ? "Save this product so you can reload it later"
                : mode === "manual"
                  ? "Fill Product Name + Detail + 3 attachments to save"
                  : "Upload 3 attachments to save"
            }
            className="px-2 py-1 rounded text-[10px] font-bold disabled:opacity-40 whitespace-nowrap"
            style={{
              background: "rgba(34,197,94,0.10)",
              border: "1px solid #16a34a",
              color: "#15803d",
            }}
          >
            {saving ? "⏳ Saving…" : "💾 Save Attachment"}
          </button>
          {(product.imageUrls?.length || product.imageData) && (
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
