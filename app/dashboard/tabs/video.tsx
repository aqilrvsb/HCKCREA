"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import UgcTab from "./ugc";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { isVisibleAfterTtl, fetchSavedSet } from "@/lib/history-filter";
import AttachmentPicker from "../sections/attachment-picker";

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
  // Default to Product Reference (ingredient) — most common UGC flow.
  const [imageMode, setImageMode] = useState<ImageMode>("ingredient");
  const [startFrame, setStartFrame] = useState("");
  const [endFrame, setEndFrame] = useState("");
  // In ingredient mode we now support TWO optional reference images:
  // avatarImage (the character) and refImage (the product). User can
  // upload either, both, or neither — Crun.ai will reference them as
  // "first" and "second" in the order they're sent.
  const [avatarImage, setAvatarImage] = useState("");
  const [refImage, setRefImage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [count, setCount] = useState(1);
  const duration: "8" = "8"; // Veo 3.1 Fast — 8s only
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const [pickerSlot, setPickerSlot] = useState<RefSlot | null>(null);
  // Attachment picker replaces local-file uploads on this tab.
  const [attachmentSlot, setAttachmentSlot] = useState<RefSlot | null>(null);
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
    else if (slot === "ref") setRefImage(url);
    else if (slot === "avatar") setAvatarImage(url);
    setPickerSlot(null);
  }

  function pickFromAttachment(slot: RefSlot, url: string) {
    if (slot === "start") setStartFrame(url);
    else if (slot === "end") setEndFrame(url);
    else if (slot === "ref") setRefImage(url);
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
    if (!prompt.trim()) return setError("Sila masukkan scene prompt.");
    if (imageMode === "frame" && !startFrame)
      return setError("Upload Start Frame dulu.");
    setError(null);
    setStatus("submitting");

    try {
      // Upload local previews to RunningHub before hitting generate.
      const [startPub, endPub, avatarPub, refPub] = await Promise.all([
        ensurePublicUrl(startFrame),
        ensurePublicUrl(endFrame),
        ensurePublicUrl(avatarImage),
        ensurePublicUrl(refImage),
      ]);

      // Order matters — Crun references images as "first" / "second" in the
      // exact order we send. Avatar always first when present so the prompt
      // preamble lines up.
      const imageUrls =
        imageMode === "frame"
          ? [startPub, endPub].filter(Boolean)
          : imageMode === "ingredient"
            ? [avatarPub, refPub].filter(Boolean)
            : [];

      // If user is in ingredient mode but didn't upload either ref,
      // auto-fall-back to text-to-video so the API uses the t2v model
      // instead of erroring on a missing image.
      const effectiveMode: ImageMode =
        imageMode === "ingredient" && imageUrls.length === 0
          ? "text"
          : imageMode;

      // Auto-prepend a reference-image preamble for the AI Agent UGC flow
      // so users don't have to remember the exact wording. Only adds when
      // the user hasn't already written one ("reference image" not in
      // their prompt) — protects power users with custom phrasing. Skipped
      // entirely when no image is uploaded (text-to-video path).
      let finalPrompt = prompt.trim();
      if (effectiveMode === "ingredient" && !/reference image/i.test(finalPrompt)) {
        const lines: string[] = [];
        if (avatarPub && refPub) {
          lines.push("Use the first reference image as the main character (same face, same outfit, same lighting style).");
          lines.push("Use the second reference image as the product (same label, same shape, same colors, no modification).");
        } else if (avatarPub) {
          lines.push("Use the reference image as the main character (same face, same outfit, same lighting style).");
        } else if (refPub) {
          lines.push("Use the reference image as the product (same label, same shape, same colors, no modification).");
        }
        if (lines.length) finalPrompt = lines.join("\n") + "\n\n" + finalPrompt;
      }

      const calls = Array.from({ length: count }).map(() =>
        fetch("/api/generate/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: finalPrompt,
            image_urls: imageUrls,
            duration,
            image_mode: effectiveMode,
            aspect_ratio: aspect,
            project_id: projectId,
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
      {/* VIDEO GENERATOR — Duration + Image Mode */}
      <Card borderColor={ORANGE}>
        <CardHeader icon="🎬" title="Video Generator" />

        <Label>Duration</Label>
        <button
          type="button"
          className="w-full h-11 rounded-lg text-xs font-extrabold text-black mb-4"
          style={{
            background:
              "linear-gradient(135deg, #facc15 0%, #fde047 100%)",
            boxShadow: "0 4px 14px rgba(250,204,21,0.3)",
          }}
        >
          8s (1 shot)
        </button>

        <Label>Image Mode</Label>
        <Select
          value={imageMode}
          onChange={(v) => setImageMode(v as ImageMode)}
        >
          <option value="ingredient">
            Product Reference (AI creates scene)
          </option>
          <option value="frame">First Frame (animate from image)</option>
          <option value="text">Text to Video (no image needed)</option>
        </Select>
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
            {/* Product reference (optional) — second image, becomes the
                product the avatar holds in the generated video. */}
            <div>
              <FrameZoneRow
                label="Product Reference"
                color={ORANGE}
                url={refImage}
                icon="📦"
                onPick={() => setAttachmentSlot("ref")}
                onClear={() => setRefImage("")}
                onHistory={() => setPickerSlot("ref")}
              />
            </div>
            <p className="md:col-span-2 text-[11px] text-gray-500 -mt-1">
              Both optional. Upload nothing → text-to-video. Upload one → auto-prepended as
              the character or product. Upload both → "first" = avatar, "second" = product.
            </p>
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

      {pickerSlot && (
        <HistoryPicker
          onPick={(url) => pickFromHistory(pickerSlot, url)}
          onClose={() => setPickerSlot(null)}
        />
      )}

      <AttachmentPicker
        open={!!attachmentSlot}
        onClose={() => setAttachmentSlot(null)}
        onPick={(a) => attachmentSlot && pickFromAttachment(attachmentSlot, a.public_url)}
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
          <SmallBtn onClick={onHistory}>History</SmallBtn>
          <SmallBtn onClick={onPick}>Attachments</SmallBtn>
          <SmallBtn onClick={onClear} danger>
            x
          </SmallBtn>
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
