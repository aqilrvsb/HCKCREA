"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import UgcTab from "./ugc";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { isVisibleAfterTtl, fetchSavedSet } from "@/lib/history-filter";
import AttachmentPicker from "../sections/attachment-picker";
import ScrapePicker from "../sections/scrape-picker";
import ProductRefTips from "../sections/product-ref-tips";

// Video tab — 1:1 port of creative-hack-auto's video-mode-section.
// Three image modes (frame / ingredient / text), with a Scene card that
// adapts to the mode (Start+End frames, single ref, or text-only).
// Light cream canvas + orange accents (replaces extension's green).

type Status = "idle" | "submitting" | "failed";
type ImageMode = "frame" | "ingredient" | "text";
// "avatar" + "ref" (= product) are the two new ingredient-mode slots.
// "ref" alone stays for backwards compat with rows that still use a
// single product-only image.
type RefSlot = "start" | "end" | "ref" | "avatar";

const ORANGE = "#facc15";
const ORANGE_SOFT = "rgba(255, 87, 34, 0.18)";
const ORANGE_FAINT = "rgba(255, 87, 34, 0.06)";

export default function VideoTab({ projectId }: { projectId?: string } = {}) {
  // Provider picker — Veo 3.1 (default talking-head UGC) or Sora 2
  // (cinematic with native synced audio). Each provider constrains the
  // downstream pickers:
  //   - Veo:    3 image modes, fixed 8s duration, multi-ref allowed
  //   - Sora 2: text/frame mode only, 8s or 12s duration, single ref
  const [provider, setProvider] = useState<"veo" | "sora2">("veo");
  // Sora 2 supports 8 or 12s natively. APIPod also accepts 4s but our
  // UI dropped it (too short for useful UGC). State is independent from
  // Veo's fixed 8s so switching providers doesn't reset the other.
  const [soraDuration, setSoraDuration] = useState<8 | 12>(8);
  // Default to Product Reference (ingredient) — most common UGC flow.
  const [imageMode, setImageMode] = useState<ImageMode>("ingredient");
  const [startFrame, setStartFrame] = useState("");
  const [endFrame, setEndFrame] = useState("");
  // In ingredient mode we now support TWO optional reference images:
  // avatarImage (the character) and refImage (the product). User can
  // upload either, both, or neither — Crun.ai will reference them as
  // "first" and "second" in the order they're sent.
  const [avatarImage, setAvatarImage] = useState("");
  // Product references — up to 3 attachments. UGC Veo r2v takes up to
  // 3 ref images; we send fewer when fewer picked, OR triplicate when
  // exactly 1 is picked (mirrors the auto-product r2v flow).
  // With avatar set: character is image #1, products fill 2-3 (max 2 products).
  // Without avatar: products fill all 3 slots (max 3 products).
  const [refImages, setRefImages] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  // Idea mode now uses TWO fields:
  //   ideaScene — the scene/visual concept ("saya masak tenggiri masam")
  //   ideaUsp   — optional product USP ("ada extra calcium, anti-inflammatory")
  // Backend combines both + picks a random UGC framework from
  // lib/auto-content-frameworks.ts (filtered to type='ugc') and asks
  // Gemini 3.1 Flash Lite to write the scene + 20-24 Malay-word dialog
  // following that framework's dialog shape + emotion arc.
  const [ideaScene, setIdeaScene] = useState("");
  const [ideaUsp, setIdeaUsp] = useState("");
  // Input mode toggle — "prompt" is the legacy free-form path (user types
  // full scene + dialog), "idea" is the new shortcut: 2 short fields +
  // rotated UGC framework + Gemini expansion. Dialog stays hard-locked
  // at 20-24 Malay words for 8s via the canonical DIALOG LENGTH LOCK.
  const [inputMode, setInputMode] = useState<"prompt" | "idea">("prompt");
  const [aspect, setAspect] = useState("9:16");
  const [count, setCount] = useState(1);
  const duration: "8" = "8"; // Veo 3.1 Fast — 8s only
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  // Live Sora 2 per-second rate. Drives the dynamic cost preview shown
  // on the Generate button when provider === "sora2". Endpoint falls
  // back to cinema_rate × 2 when admin hasn't configured sora2_rate.
  const [soraRatePerSec, setSoraRatePerSec] = useState<number | null>(null);
  useEffect(() => {
    let cancel = false;
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setSoraRatePerSec(d.rate);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  // When user switches to Sora 2, clamp imageMode to text/frame only.
  // Sora 2 doesn't support multi-ref ingredient mode (single first frame
  // only per APIPod spec). Without this clamp, Veo's "ingredient"
  // default would silently fail to pass refs through to Sora 2.
  useEffect(() => {
    if (provider === "sora2" && imageMode === "ingredient") {
      setImageMode("frame");
    }
  }, [provider, imageMode]);

  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  // Attachment picker replaces local-file uploads on this tab.
  const [attachmentSlot, setAttachmentSlot] = useState<RefSlot | null>(null);
  // Google Images scrape state for the product reference slot. Fires
  // automatically when the Scrape button is clicked; results land here
  // and the count badge opens the picker on a second click.
  const [scrapeRow, setScrapeRow] = useState<{
    loading: boolean;
    images: string[] | null;
    query: string | null;
    error: string | null;
  } | null>(null);
  const [scrapePickerOpen, setScrapePickerOpen] = useState(false);

  // Fire the scrape against the first 200 chars of the user's prompt.
  // Server-side cleanup strips marketing description after " - " /  " | "
  // separators. Picks land in the user's Attachments library, NOT in
  // the ref slots directly — the user picks from Attachments afterwards.
  async function fireUgcScrape() {
    const raw = (prompt || "").slice(0, 200).trim();
    if (!raw) {
      setScrapeRow({ loading: false, images: null, query: null, error: "Type a prompt first" });
      return;
    }
    setScrapeRow({ loading: true, images: null, query: null, error: null });
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
      setScrapeRow({
        loading: false,
        images,
        query: data.query || raw,
        error: null,
      });
      if (images.length > 0) setScrapePickerOpen(true);
    } catch (e: any) {
      setScrapeRow({
        loading: false,
        images: null,
        query: raw,
        error: e?.message || "scrape failed",
      });
    }
  }
  const [showUgcModal, setShowUgcModal] = useState(false);

  // Pick up a prompt handed off from the UGC Prompt Builder rendered above
  // us on the Video page (same-page handoff via custom event). Also reads
  // any leftover localStorage stash for backwards compat.
  useEffect(() => {
    try {
      const stash = localStorage.getItem("ugc_prompt_stash");
      if (stash && stash.trim()) {
        setPrompt(stash);
        localStorage.removeItem("ugc_prompt_stash");
      }
    } catch {}
    const onHandoff = (e: any) => {
      const text = typeof e?.detail === "string" ? e.detail : "";
      if (text.trim()) setPrompt(text);
      setShowUgcModal(false);
    };
    window.addEventListener("ugc:hand-off", onHandoff);
    return () => window.removeEventListener("ugc:hand-off", onHandoff);
  }, []);

  function pickFromHistory(slot: RefSlot, url: string) {
    if (slot === "start") setStartFrame(url);
    else if (slot === "end") setEndFrame(url);
    else if (slot === "ref") setRefImages([url]);
    else if (slot === "avatar") setAvatarImage(url);
    setPickerSlot(null);
  }

  function pickFromAttachment(slot: RefSlot, url: string) {
    if (slot === "start") setStartFrame(url);
    else if (slot === "end") setEndFrame(url);
    else if (slot === "ref") setRefImages([url]);
    else if (slot === "avatar") setAvatarImage(url);
    setAttachmentSlot(null);
  }

  // Upload-on-demand: data: URL -> public RH URL. Pass-through if already public.
  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const file = await dataUrlToFile(v, "upload.png");
    const { url } = await uploadImage(file);
    return url;
  }

  async function submit() {
    // Mode-aware required-input validation. Prompt mode needs the full
    // textarea; Idea mode needs at least Scene Idea (USP is optional).
    if (inputMode === "idea") {
      if (!ideaScene.trim()) {
        return setError("Sila masukkan Scene Idea (USP optional).");
      }
    } else if (!prompt.trim()) {
      return setError("Sila masukkan scene prompt.");
    }
    if (imageMode === "frame" && !startFrame)
      return setError("Upload Start Frame dulu.");
    setError(null);
    setStatus("submitting");

    try {
      // ensurePublicUrl is a no-op for already-public Attachment URLs.
      const [startPub, endPub, avatarPub] = await Promise.all([
        ensurePublicUrl(startFrame),
        ensurePublicUrl(endFrame),
        ensurePublicUrl(avatarImage),
      ]);
      const productPubs = await Promise.all(refImages.map((u) => ensurePublicUrl(u)));
      // Triplication REMOVED — every Veo model variant (veo3-1-fast,
      // veo3-1-fast-ref, etc.) accepts 1+ distinct refs natively. Sending
      // the same image 3× just bloated the payload, and APIPod's CUE
      // validator was rejecting duplicate image_urls as "invalid value"
      // even when the error message pointed at the prompt field.
      // Now: 1 picked → 1 sent, 2-3 picked → 2-3 sent (as-is). Matches
      // Auto Content's behaviour which has always sent distinct refs only.
      const productSend = productPubs;

      // Order matters: avatar is image #1 when present, then up to 2
      // products. Without avatar: up to 3 products.
      let imageUrls: string[];
      if (imageMode === "frame") {
        imageUrls = [startPub, endPub].filter(Boolean);
      } else if (imageMode === "ingredient") {
        if (avatarPub) {
          imageUrls = [avatarPub, ...productSend.slice(0, 2)];
        } else {
          imageUrls = productSend.slice(0, 3);
        }
      } else {
        imageUrls = [];
      }

      // If user is in ingredient mode but didn't upload either ref,
      // auto-fall-back to text-to-video so the API uses the t2v model
      // instead of erroring on a missing image.
      const effectiveMode: ImageMode =
        imageMode === "ingredient" && imageUrls.length === 0
          ? "text"
          : imageMode;

      const refPub = productPubs[0] || "";

      // Auto-prepend a reference-image preamble for the AI Agent UGC flow
      // so users don't have to remember the exact wording. Only adds when
      // the user hasn't already written one ("reference image" not in
      // their prompt) — protects power users with custom phrasing. Skipped
      // entirely when no image is uploaded (text-to-video path).
      //
      // PHRASING: descriptive, not instructive. APIPod's CUE validator
      // for veo3-1-fast-ref rejects prompts that meta-instruct the model
      // ("Use the reference image as X") because reference handling is
      // controlled at the API level (image_urls + generation_type=reference).
      // The validator wants the prompt to DESCRIBE the desired output
      // ("same person from reference image, holding same product"), not
      // tell the model how to consume its input. This matches the phrasing
      // Auto Content's Gemini-generated prompts use, which pass validation.
      let finalPrompt = prompt.trim();
      if (effectiveMode === "ingredient" && !/reference image/i.test(finalPrompt)) {
        const lines: string[] = [];
        if (avatarPub && refPub) {
          lines.push("Same person from the first reference image (same face, same outfit, same lighting), holding the same product from the second reference image (same label, same shape, same colors, no modification).");
        } else if (avatarPub) {
          lines.push("Same person from reference image (same face, same outfit, same lighting style).");
        } else if (refPub) {
          lines.push("Same product from reference image (same label, same shape, same colors, no modification).");
        }
        if (lines.length) finalPrompt = lines.join("\n") + "\n\n" + finalPrompt;
      }

      // Sora 2 only accepts a single first-frame image — drop extra
      // refs at the frontend so the backend never has to guess which
      // ref to keep. Veo path is unchanged (sends all picked refs).
      const apiImageUrls =
        provider === "sora2" ? imageUrls.slice(0, 1) : imageUrls;

      const calls = Array.from({ length: count }).map(() =>
        fetch("/api/generate/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // In Idea mode, prompt is unused — backend reads idea_scene +
            // idea_usp instead. In Prompt mode, prompt is the verbatim
            // user-typed Veo prompt (with frontend's ref-image preamble
            // already prepended).
            prompt: inputMode === "idea" ? "" : finalPrompt,
            image_urls: apiImageUrls,
            // Sora 2 uses soraDuration (8|12), Veo is fixed at 8.
            duration: provider === "sora2" ? String(soraDuration) : duration,
            image_mode: effectiveMode,
            aspect_ratio: aspect,
            project_id: projectId,
            mode: inputMode,
            // Provider switch — backend uses this to pick cascade asset,
            // rate, and prompt-format transform. Defaults to "veo" when
            // omitted so old clients keep working unchanged.
            provider,
            ...(inputMode === "idea"
              ? {
                  idea_scene: ideaScene.trim(),
                  idea_usp: ideaUsp.trim(),
                }
              : {}),
          }),
        }).then((r) => r.json())
      );
      const results = await Promise.all(calls);
      const first = results.find((d) => d?.ok);
      if (!first) {
        setError(
          results.find((d) => d?.error)?.error || "Generation failed"
        );
        setStatus("failed");
        return;
      }
      window.dispatchEvent(new CustomEvent("history:refresh"));
      setStatus("idle");
    } catch (e: any) {
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  const busy = status === "submitting";

  const sectionBg: React.CSSProperties = {
    background:
      "radial-gradient(ellipse 1200px 800px at 50% 0%, #fff7f2 0%, #fafaf7 40%, #f5f5f0 100%)",
    color: "#1a1a1a",
    boxShadow: "0 0 0 1px rgba(255, 87, 34, 0.08)",
  };

  return (
    <div className="rounded-3xl p-6 md:p-8 space-y-5" style={sectionBg}>
      {/* VIDEO GENERATOR — Provider + Image Mode + Duration */}
      <Card borderColor={ORANGE}>
        <CardHeader icon="🎬" title="Video Generator" />

        {/* Provider picker — Veo 3.1 (default talking-head UGC) vs Sora 2
            (cinematic with native synced audio). Wired all the way
            through: changes the cascade asset, cost rate, available
            image modes, and duration options. */}
        <Label>Provider</Label>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            type="button"
            onClick={() => setProvider("veo")}
            className="px-3 py-3 rounded-xl text-sm font-extrabold transition-all"
            style={
              provider === "veo"
                ? {
                    background: "linear-gradient(135deg, #facc15, #f59e0b)",
                    color: "#1a1a1a",
                    boxShadow: "0 4px 12px rgba(250,204,21,0.35)",
                    border: "1px solid transparent",
                  }
                : {
                    background: "white",
                    color: "#1a1a1a",
                    border: "1px solid #e8e0d8",
                  }
            }
          >
            🎬 Veo 3.1 · 8s
          </button>
          <button
            type="button"
            onClick={() => setProvider("sora2")}
            className="px-3 py-3 rounded-xl text-sm font-extrabold transition-all"
            style={
              provider === "sora2"
                ? {
                    background: "linear-gradient(135deg, #4ade80, #16a34a)",
                    color: "white",
                    boxShadow: "0 4px 12px rgba(74,222,128,0.35)",
                    border: "1px solid transparent",
                  }
                : {
                    background: "white",
                    color: "#1a1a1a",
                    border: "1px solid #e8e0d8",
                  }
            }
          >
            ⚡ Sora 2 · 8 / 12s
          </button>
        </div>

        <Label>Image Mode</Label>
        <Select
          value={imageMode}
          onChange={(v) => setImageMode(v as ImageMode)}
        >
          {/* Sora 2 doesn't support multi-ref ingredient mode (single
              first frame only). The "ingredient" option is hidden when
              Sora 2 is selected; useEffect clamps state to "frame" if
              user switches mid-flow. */}
          {provider === "veo" && (
            <option value="ingredient">
              Product Reference (AI creates scene)
            </option>
          )}
          <option value="frame">
            {provider === "sora2"
              ? "First Frame (single image)"
              : "First Frame (animate from image)"}
          </option>
          <option value="text">Text to Video (no image needed)</option>
        </Select>

        {/* Duration picker — Sora 2 only. Veo is fixed at 8s so no
            picker shown for it. */}
        {provider === "sora2" && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <Label>Duration</Label>
              {soraRatePerSec != null && (
                <span
                  className="text-xs font-bold"
                  style={{ color: "#16a34a" }}
                >
                  ~RM{((soraRatePerSec ?? 0) * soraDuration).toFixed(2)} / video
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {([8, 12] as const).map((d) => {
                const active = soraDuration === d;
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setSoraDuration(d)}
                    className="px-3 py-2.5 rounded-xl text-sm font-extrabold transition-all"
                    style={
                      active
                        ? {
                            background:
                              "linear-gradient(135deg, #4ade80, #16a34a)",
                            color: "white",
                            boxShadow: "0 4px 12px rgba(74,222,128,0.35)",
                            border: "1px solid transparent",
                          }
                        : {
                            background: "white",
                            color: "#1a1a1a",
                            border: "1px solid #e8e0d8",
                          }
                    }
                  >
                    {d}s
                  </button>
                );
              })}
            </div>
            <p
              className="text-[10px] mt-1.5"
              style={{ color: "#6b6357" }}
            >
              Sora 2 supports 8s or 12s only. Dialog format auto-converts to
              Sora 2 spec (Dialogue: block). Avoid medical claim
              vocabulary — Sora 2's safety filter silences audio on
              clinical efficacy phrasing.
            </p>
          </div>
        )}
      </Card>

      {/* SCENE — adapts to image mode */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">🎞️</span>
            <span
              className="text-[13px] font-extrabold uppercase tracking-[0.06em]"
              style={{ color: "#1a1a1a" }}
            >
              Scene
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowUgcModal(true)}
            title="UGC Prompt Builder — 5-block Veo formula"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-extrabold uppercase tracking-wider transition-transform hover:-translate-y-0.5"
            style={{
              background: "linear-gradient(135deg, #25f4ee, #00bfa5)",
              color: "white",
              boxShadow: "0 4px 12px rgba(37,244,238,0.3)",
            }}
          >
            <Sparkles className="w-3.5 h-3.5" strokeWidth={2.6} />
            Prompt Builder
          </button>
        </div>

        {imageMode === "text" && (
          <div
            className="p-3 rounded-lg mb-3 text-center text-xs font-semibold"
            style={{
              background: ORANGE_FAINT,
              border: `1px dashed ${ORANGE_SOFT}`,
              color: ORANGE,
            }}
          >
            📝 Text only — no image needed
          </div>
        )}

        {imageMode === "ingredient" && (
          <div className="mb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Avatar reference (optional) — Crun treats this as the
                first reference image, so the auto-prepended preamble
                tells Veo to use it as the main character. */}
            <div>
              <FrameZoneRow
                label="Avatar Reference"
                color={ORANGE}
                url={avatarImage}
                icon="👤"
                onPick={() => setAttachmentSlot("avatar")}
                onClear={() => setAvatarImage("")}
                onHistory={() => setPickerSlot("avatar")}
              />
            </div>
            {/* Product reference — multi-pick up to (avatar ? 2 : 3).
                If exactly 1 picked, it's triplicated server-side. */}
            <div>
              <MultiRefRow
                label={`Product Reference (${refImages.length}/${avatarImage ? 2 : 3})`}
                color={ORANGE}
                urls={refImages}
                max={avatarImage ? 2 : 3}
                onPick={() => setAttachmentSlot("ref")}
                scrape={scrapeRow}
                onScrape={fireUgcScrape}
                onOpenScrapePicker={() => setScrapePickerOpen(true)}
                onRemove={(i) =>
                  setRefImages((prev) => prev.filter((_, idx) => idx !== i))
                }
              />
            </div>
            <div className="md:col-span-2 -mt-1 flex items-center gap-2 flex-wrap">
              <p className="text-[11px] text-gray-500">
                Both optional. Pick {avatarImage ? "up to 2 products" : "up to 3 products"}; each picked image is sent as a distinct reference to Veo.
              </p>
              <ProductRefTips />
            </div>
          </div>
        )}

        {imageMode === "frame" && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <FrameZoneRow
                label="Start Frame *"
                color={ORANGE}
                url={startFrame}
                icon="🖼️"
                required
                onPick={() => setAttachmentSlot("start")}
                onClear={() => setStartFrame("")}
                onHistory={() => setPickerSlot("start")}
              />
            </div>
            <div>
              <FrameZoneRow
                label="End Frame"
                color="#888"
                url={endFrame}
                icon="🏁"
                onPick={() => setAttachmentSlot("end")}
                onClear={() => setEndFrame("")}
                onHistory={() => setPickerSlot("end")}
              />
            </div>
          </div>
        )}

        {/* Mode toggle — "Prompt" = legacy full-text textarea; "Idea" =
            type a short one-liner, backend expands into a full Veo prompt
            via Gemini 3.1 Flash Lite (silent — single Generate click).
            Same expansion model Auto Content uses, minus the framework
            layer (UGC doesn't have frameworks). Dialog stays at the
            canonical 20-24 Malay words for 8s via DIALOG LENGTH LOCK. */}
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setInputMode("prompt")}
            className="flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all border"
            style={{
              background: inputMode === "prompt" ? "#1a1a1a" : "white",
              color: inputMode === "prompt" ? "white" : "#1a1a1a",
              borderColor: inputMode === "prompt" ? "#1a1a1a" : "#e8e0d8",
            }}
          >
            ✍️ Prompt
          </button>
          <button
            type="button"
            onClick={() => setInputMode("idea")}
            className="flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all border"
            style={{
              background: inputMode === "idea"
                ? "linear-gradient(90deg, #ec4899, #a855f7, #38bdf8)"
                : "white",
              color: inputMode === "idea" ? "white" : "#1a1a1a",
              borderColor: inputMode === "idea" ? "#a855f7" : "#e8e0d8",
            }}
          >
            💡 Idea (AI expand)
          </button>
        </div>

        {inputMode === "idea" ? (
          <div className="space-y-3">
            {/* Scene Idea (required) */}
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1.5">
                Scene Idea <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={ideaScene}
                onChange={(e) => setIdeaScene(e.target.value.substring(0, 400))}
                maxLength={400}
                placeholder="What's happening in the scene? e.g. 'saya masak tenggiri masam dan makan dengan nasi panas'"
                className="w-full p-3.5 rounded-xl text-sm resize-y outline-none focus:border-orange-400"
                style={{
                  background: "#fafaf7",
                  border: "1px solid #e8e0d8",
                  color: "#1a1a1a",
                  lineHeight: 1.5,
                }}
              />
              <div className="text-[10px] text-gray-400 mt-1 text-right">
                <span className={ideaScene.length > 380 ? "text-red-500 font-bold" : ""}>
                  {ideaScene.length}/400
                </span>
              </div>
            </div>

            {/* USP Produk (optional) */}
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 font-bold mb-1.5">
                USP Produk{" "}
                <span className="font-normal lowercase tracking-normal text-gray-400">
                  (optional — what's unique about the product?)
                </span>
              </label>
              <textarea
                rows={2}
                value={ideaUsp}
                onChange={(e) => setIdeaUsp(e.target.value.substring(0, 300))}
                maxLength={300}
                placeholder="Key benefits or selling points, e.g. 'ada extra calcium · anti-inflammatory · halal certified'"
                className="w-full p-3.5 rounded-xl text-sm resize-y outline-none focus:border-orange-400"
                style={{
                  background: "#fafaf7",
                  border: "1px solid #e8e0d8",
                  color: "#1a1a1a",
                  lineHeight: 1.5,
                }}
              />
              <div className="text-[10px] text-gray-400 mt-1 text-right">
                <span className={ideaUsp.length > 280 ? "text-red-500 font-bold" : ""}>
                  {ideaUsp.length}/300
                </span>
              </div>
            </div>

            <p className="text-[10px] text-gray-500 leading-relaxed">
              <span className="font-bold text-purple-600">AI expansion:</span>{" "}
              AI combines your scene idea + USP and writes the full
              prompt using a randomly-rotated UGC framework. Scene owns
              the visual; framework owns the dialog shape (20-24 Malay
              words). Reference images (if attached) are respected.
            </p>
          </div>
        ) : (
          <textarea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.substring(0, 1500))}
            maxLength={1500}
            placeholder="Scene description + spoken dialog 0-8s..."
            className="w-full p-3.5 rounded-xl text-sm resize-y outline-none focus:border-orange-400"
            style={{
              background: "#fafaf7",
              border: "1px solid #e8e0d8",
              color: "#1a1a1a",
              lineHeight: 1.5,
            }}
          />
        )}
        {inputMode === "idea" ? null : (
          <p className="text-[10px] text-gray-500 mt-2 leading-relaxed">
            Each shot = 8s · Sweet spot{" "}
            <span className="font-bold text-orange-600">18–22 words</span> of
            spoken dialog (split: 0-2s hook ≤6 words · 2-6s middle ≤14 words ·
            6-8s CTA ≤6 words) ·{" "}
            <span
              className={
                prompt.trim().split(/\s+/).filter(Boolean).length > 26
                  ? "text-red-500 font-bold"
                  : "text-gray-700 font-semibold"
              }
            >
              {prompt.trim().split(/\s+/).filter(Boolean).length} words
            </span>{" "}
            ·{" "}
            <span className={prompt.length > 1425 ? "text-red-500 font-bold" : ""}>
              {prompt.length}/1500
            </span>
          </p>
        )}
      </Card>

      {/* SIZE + GENERATE */}
      <Card>
        <div className="flex items-end gap-4 mb-4">
          <div>
            <Label>Size</Label>
            <Select value={aspect} onChange={(v) => setAspect(v)} width={100}>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </Select>
          </div>
        </div>

        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-3.5 rounded-xl font-extrabold text-base text-black transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
          style={{
            background:
              "linear-gradient(135deg, #facc15 0%, #fde047 100%)",
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
            <>🎬 Generate UGC</>
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

      <AttachmentPicker
        open={!!attachmentSlot}
        onClose={() => setAttachmentSlot(null)}
        defaultCategory={attachmentSlot === "avatar" ? "avatar" : "product"}
        // The ref slot is multi-pick (max depends on avatar presence).
        // Other slots stay single-pick (start frame / end frame / avatar).
        {...(attachmentSlot === "ref"
          ? {
              onPickMulti: (arr) => {
                setRefImages(arr.map((a) => a.public_url));
                setAttachmentSlot(null);
              },
              maxPick: avatarImage ? 2 : 3,
            }
          : {
              onPick: (a) =>
                attachmentSlot && pickFromAttachment(attachmentSlot, a.public_url),
            })}
      />

      {/* Google Images scrape picker — auto-opens after first fire,
          re-opens on count-badge click. Picks are saved to the user's
          Attachments library; they then open the Attachments picker
          to fill the product ref slots as usual. */}
      <ScrapePicker
        open={scrapePickerOpen}
        onClose={() => setScrapePickerOpen(false)}
        images={scrapeRow?.images || []}
        query={scrapeRow?.query || ""}
        productName={scrapeRow?.query || ""}
      />

      {showUgcModal && <UgcModal onClose={() => setShowUgcModal(false)} />}

      {/* UGC Agent panel is mounted at dashboard-shell level so it
          persists across tab switches — see DashboardShell. */}
    </div>
  );
}

// ── UGC Prompt Builder Modal ───────────────────────────────────────────────
// Wraps the existing UgcTab in a centered modal. UgcTab dispatches
// `ugc:hand-off` on Use-in-Video; the parent VideoTab listens and closes the
// modal when that fires (see useEffect above).
function UgcModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <Portal>
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden"
        style={{
          background: "#fafaf7",
          border: "2px solid #25f4ee",
          boxShadow: "0 20px 60px rgba(37,244,238,0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: "#d8e8d0", background: "#ffffff" }}
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5" style={{ color: "#25f4ee" }} strokeWidth={2.4} />
            <h2 className="font-display font-extrabold text-lg" style={{ color: "#1a1a1a" }}>
              UGC Prompt Builder
              <span className="ml-2 text-xs font-normal text-gray-500">
                5-Part Veo 3.1 Formula
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 transition"
            style={{ color: "#666" }}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <UgcTab />
        </div>
      </div>
    </div>
    </Portal>
  );
}

// ── FrameZoneRow ────────────────────────────────────────────────────────────
// 80×80 thumbnail zone + vertically stacked History/Upload/x action buttons,
// matches the extension's video-shot frame zones.
function FrameZoneRow({
  label,
  color,
  url,
  icon,
  uploading,
  required,
  onPick,
  onClear,
  onHistory,
}: {
  label: string;
  color: string;
  url: string;
  icon: string;
  uploading?: boolean;
  required?: boolean;
  onPick: () => void;
  onClear: () => void;
  onHistory: () => void;
}) {
  return (
    <div>
      <div
        className="text-[10px] font-extrabold uppercase tracking-[0.06em] mb-2"
        style={{ color }}
      >
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={onPick}
          className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center transition-all"
          style={{
            border: `${required ? 2 : 1}px dashed ${url ? "transparent" : color}`,
            background: url ? "#000" : ORANGE_FAINT,
          }}
          aria-label={url ? "Replace image" : "Upload image"}
        >
          {url ? (
            <img src={url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-2xl opacity-75">{icon}</span>
          )}
          {uploading && (
            <div
              className="absolute inset-0 flex items-center justify-center text-white"
              style={{ background: "rgba(0,0,0,0.55)" }}
            >
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          )}
        </button>
        <div className="flex flex-col gap-1 justify-between">
          <SmallBtn onClick={onPick}>Attachments</SmallBtn>
          <SmallBtn onClick={onClear} danger>
            x
          </SmallBtn>
        </div>
      </div>
    </div>
  );
}

// Multi-pick row — up to `max` thumbnails in a horizontal strip. Click
// any empty slot OR the Attachments button to open the picker; click an
// existing thumb's × badge to remove it. Used by the UGC product
// reference where Veo r2v takes 2-3 distinct images for the same shot.
function MultiRefRow({
  label,
  color,
  urls,
  max,
  onPick,
  scrape,
  onScrape,
  onOpenScrapePicker,
  onRemove,
}: {
  label: string;
  color: string;
  urls: string[];
  max: number;
  onPick: () => void;
  // Optional — when both onScrape + onOpenScrapePicker are supplied, the
  // row renders a three-state Scrape button (idle → loading → count).
  scrape?: {
    loading: boolean;
    images: string[] | null;
    query: string | null;
    error: string | null;
  } | null;
  onScrape?: () => void;
  onOpenScrapePicker?: () => void;
  onRemove: (i: number) => void;
}) {
  const slotsFull = urls.length >= max;
  const hasResults = !!scrape?.images && scrape.images.length > 0;
  const slots = Array.from({ length: max }).map((_, i) => urls[i] || "");
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wider mb-1.5" style={{ color }}>
        {label}
      </div>
      <div className="flex items-stretch gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {slots.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={onPick}
              className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
              style={{
                border: url ? `2px solid ${color}` : `2px dashed ${color}55`,
                background: url ? "#000" : "#fafaf7",
              }}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-semibold" style={{ color }}>
                  {i + 1}
                </span>
              )}
              {url && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(i);
                  }}
                  className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/70 text-white text-[10px] flex items-center justify-center cursor-pointer"
                >
                  ×
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <SmallBtn onClick={onPick}>Attachments</SmallBtn>
          {onScrape && (
            <>
              <button
                type="button"
                onClick={
                  hasResults && !scrape?.loading && onOpenScrapePicker
                    ? onOpenScrapePicker
                    : onScrape
                }
                disabled={(slotsFull || !!scrape?.loading) && !hasResults}
                title={
                  scrape?.loading
                    ? "Scraping…"
                    : slotsFull
                      ? "Slots full — clear one to scrape"
                      : hasResults
                        ? `Re-open ${scrape!.images!.length} scraped images`
                        : "Auto-scrape Google Images"
                }
                className="px-2 py-1 rounded text-[10px] font-bold disabled:opacity-40 whitespace-nowrap"
                style={{
                  background: "rgba(234,179,8,0.08)",
                  border: "1px solid #eab308",
                  color: "#a16207",
                }}
              >
                {scrape?.loading
                  ? "⏳ Scraping…"
                  : hasResults
                    ? `🖼️ ${scrape!.images!.length} images`
                    : "🔍 Scrape · 10¢"}
              </button>
              {scrape?.error && (
                <div
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                  style={{
                    background: "rgba(244,67,54,0.08)",
                    border: "1px solid rgba(244,67,54,0.3)",
                    color: "#b91c1c",
                  }}
                  title={scrape.error}
                >
                  ✗ {scrape.error.slice(0, 22)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SmallBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded text-[10px] font-bold transition-colors hover:opacity-80"
      style={
        danger
          ? {
              background: "rgba(244,67,54,0.08)",
              border: "1px solid rgba(244,67,54,0.4)",
              color: "#c62828",
            }
          : {
              background: ORANGE_FAINT,
              border: `1px solid ${ORANGE}`,
              color: ORANGE,
            }
      }
    >
      {children}
    </button>
  );
}

// ── History Picker ──────────────────────────────────────────────────────────
// Filters for done images — used for Start/End frames and Image Reference.
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
          style={{ borderColor: "#e8e0d8" }}
        >
          <h2 className="font-display font-extrabold text-lg" style={{ color: ORANGE }}>
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
                  style={{ borderColor: "#e8e0d8", background: "#fafaf7" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.borderColor = ORANGE)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.borderColor = "#e8e0d8")
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

// ── Sub-components (mirror image.tsx) ────────────────────────────────────────

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

function CardHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="text-lg">{icon}</span>
      <span
        className="text-[13px] font-extrabold uppercase tracking-[0.06em]"
        style={{ color: "#1a1a1a" }}
      >
        {title}
      </span>
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
      className="px-3.5 py-2.5 rounded-lg text-sm font-semibold outline-none focus:border-orange-400"
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
