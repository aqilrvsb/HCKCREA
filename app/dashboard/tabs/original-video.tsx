"use client";

import { useEffect, useState } from "react";
import { Loader2, X, Film, ClipboardList, Clapperboard } from "lucide-react";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { compressVideoIfNeeded } from "@/lib/compress-video";
import AttachmentPicker from "../sections/attachment-picker";
import { SORA2_DISABLED } from "@/lib/feature-flags";
import { SopStoryboardModal, SopUgcFrameModal } from "./sop-modals";

// Read a response body as JSON, but tolerate a non-JSON error body (a Vercel
// function crash/timeout returns a plain-text "An error occurred…" page which
// would otherwise blow up JSON.parse with a cryptic "Unexpected token 'A'").
// Surfaces a trimmed, human-readable hint instead.
async function readJsonSafe(r: Response): Promise<any> {
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    const hint = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    return { __nonjson: true, error: hint || `Server error (HTTP ${r.status})` };
  }
}

// Original Video tab — 3-provider raw video generator.
//
// Replaces the hidden "Normal Video" (was inside Viral) and exposes
// three providers in one place: Veo 3.1 Fast / Grok Imagine / Sora 2.
// Power-user tab — prompt is sent 100% verbatim to the provider, no
// auto-injected locks, no Dialogue:-block transforms, no ref-image
// preambles. Whatever the user types in the textarea is what reaches
// the model.
//
// Per-provider constraints:
//   • Veo 3.1     → 3 image modes (text / start-frame i2v / multi-ref r2v)
//                   fixed 8s duration, cinema_rate × 8 cost
//   • Grok        → 2 image modes (text / start-frame i2v)
//                   8-30s duration slider, cinema_rate × duration cost
//   • Sora 2      → 2 image modes (text / start-frame i2v)
//                   8 or 12s duration, sora2_rate × duration cost
//
// Backend: posts to /api/generate/cinema with model="veo"|"grok"|"sora2".
// Cascade dispatches via asset='video' | 'grok' | 'sora2' so each
// provider pulls from its own admin-configured slot pool.

type Status = "idle" | "submitting" | "failed";
type Provider = "veo" | "grok" | "sora2" | "gemini" | "seedance";
// "video" = GeminiOmni Video Reference (upload a source video, no images).
type ImageMode = "text" | "frame" | "ingredient" | "video";

// Max slots state array can hold. Seedance ingredient mode caps at 5;
// other providers cap at 3 (per-provider cap enforced by getRefCap at
// render time + submit-time slice in cinema route). Extra state slots
// stay empty for non-Seedance providers — harmless.
const REF_SLOTS = 5;

// Per-provider theme — picker chips use these as the active gradient.
const PROVIDER_THEME: Record<
  Provider,
  { primary: string; soft: string; faint: string; gradient: string; emoji: string }
> = {
  veo: {
    primary: "#facc15",
    soft: "rgba(250,204,21,0.25)",
    faint: "rgba(250,204,21,0.08)",
    gradient: "linear-gradient(135deg, #facc15, #f59e0b)",
    emoji: "🎬",
  },
  grok: {
    primary: "#f97316",
    soft: "rgba(249,115,22,0.25)",
    faint: "rgba(249,115,22,0.08)",
    gradient: "linear-gradient(135deg, #fb923c, #f97316)",
    emoji: "⚡",
  },
  sora2: {
    // Light red per user direction (was green, then briefly blue).
    // Red-400 → Red-500 gradient — distinct from Veo's gold and Grok's
    // orange so the 3 provider chips read as 3 visibly different
    // colors at a glance.
    primary: "#f87171",
    soft: "rgba(248,113,113,0.25)",
    faint: "rgba(248,113,113,0.08)",
    gradient: "linear-gradient(135deg, #f87171, #ef4444)",
    emoji: "✨",
  },
  gemini: {
    // GeminiOmni — blue/cyan gradient (#3b82f6 → #06b6d4). Distinct
    // from Veo's gold, Grok's orange, Sora 2's red so the 4-chip row
    // reads as four visibly different providers at a glance.
    primary: "#06b6d4",
    soft: "rgba(6,182,212,0.25)",
    faint: "rgba(6,182,212,0.08)",
    gradient: "linear-gradient(135deg, #3b82f6, #06b6d4)",
    emoji: "🔷",
  },
  seedance: {
    // Seedance 2.0 Fast (Bytedance Doubao) — pink/magenta gradient
    // matching the SEEDANCE badge in /admin/usage (#ec4899). Routes
    // through its own cascade pool (asset='seedance', split out of
    // 'cinema' 2026-07-15) via the p6 / p1 / p2 adapters.
    primary: "#ec4899",
    soft: "rgba(236,72,153,0.25)",
    faint: "rgba(236,72,153,0.08)",
    gradient: "linear-gradient(135deg, #f472b6, #ec4899)",
    emoji: "🌸",
  },
};

// Per-provider image-mode availability. Per user direction every
// provider should expose its full set of meaningful modes so the user
// always picks explicitly:
//   • Veo  → all 3 modes (multi-ref r2v, text-to-video, start-frame i2v)
//   • Grok → frame ONLY (1.5 Preview requires a single image — no t2v,
//            no multi-ref per APIPod spec 2026-06-08)
//   • Sora 2 → text + start-frame (single first frame, API-mandated)
//
// Mode ORDER per user direction 2026-06-08: References (ingredient) first
// because it's the recommended path for production-quality affiliate
// content; Text only in the middle; Start frame LAST. Grok stays
// frame-only.
const PROVIDER_MODES: Record<Provider, ImageMode[]> = {
  veo: ["ingredient", "text", "frame"],
  grok: ["frame"],
  sora2: ["text", "frame"],
  // GeminiOmni: ingredient + frame. APIPod's gemini-omni-i2v is a true
  // first-frame endpoint (image_urls 1-2 = first frame + optional last
  // frame, fixed 10s) — frame mode added per user direction 2026-07-06.
  // Crun (p2) path passes the same image_urls through unchanged.
  // "video" (Video Reference) hidden per user direction 2026-07-15.
  gemini: ["ingredient", "frame"],
  // Seedance 2.0 Fast — Reference to Video (r2v). Same reference flow as
  // GeminiOmni's ingredient mode, with 3 attachments + a seconds slider.
  seedance: ["ingredient"],
};

// Per-(provider, mode) slot count. text=0 by definition; frame is 1
// (Sora 2) or 2 (Veo start+end frame); ingredient is 3 (Veo + Grok
// multi-ref). API caps in /api/generate/cinema mirror these.
function getRefCap(provider: Provider, mode: ImageMode): number {
  if (mode === "text") return 0;
  // Video Reference — the source video (motion/scene) + up to 3 product
  // reference images so the output replicates the video using the user's
  // product. Both providers accept up to 5; capped at 3 here for UX.
  if (mode === "video") return 3;
  // frame: Veo + Seedance + GeminiOmni accept start+end (2 images);
  // Sora 2 + Grok 1.5 accept a single first frame.
  if (mode === "frame")
    return provider === "veo" || provider === "seedance" || provider === "gemini" ? 2 : 1;
  // ingredient — Seedance 2.0 r2v accepts up to 9 refs natively; capped at
  // 3 per user direction 2026-07-15 (same reference flow as GeminiOmni).
  if (provider === "seedance") return 3;
  // GeminiOmni (gemini-omni-i2v) rejects >2 frame images — cap at 2 so the
  // UI can't submit a request the provider will reject ("supports at most
  // 2 frame images"). Fixed 2026-06-30.
  if (provider === "gemini") return 2;
  return 3;
}

// Mode picker button labels. Per user direction, both multi-ref
// (ingredient) and single-image (frame) modes use the "References"
// nomenclature when the provider treats refs as a generic input list.
// Veo keeps the "Start frame" label for its frame mode because its
// frame mode is semantically distinct (i2v start+end frame, not r2v).
function modeLabel(provider: Provider, mode: ImageMode): string {
  if (mode === "text") return "📝 Text only";
  if (mode === "frame") return "🖼️ Start frame";
  if (mode === "video") return "🎬 Video Reference";
  // ingredient (multi-ref) → "References" for all providers. The
  // "(Recommend)" tag steers new users to the highest-quality path
  // (multi-ref produces the most consistent affiliate output).
  return "🧩 References (Recommend)";
}

// Bahasa Melayu inline help text shown UNDER each mode button so new
// users understand the trade-off before picking. Per user direction
// 2026-06-08: short Malay one-liners, not English.
function modeDescription(mode: ImageMode): string {
  if (mode === "text") return "Tak perlu letak gambar, prompt je keluar video";
  if (mode === "frame") return "Image yang di-upload dijadikan first frame dalam video";
  if (mode === "video") return "Video jadi rujukan gerak/scene + gambar produk anda → replicate video guna produk anda";
  return "Guna gambar sebagai rujukan untuk hasilkan video cantik";
}

export default function OriginalVideoTab({
  projectId,
}: { projectId?: string } = {}) {
  const [provider, setProvider] = useState<Provider>("gemini");
  const [imageMode, setImageMode] = useState<ImageMode>("text");
  // Up to 3 ref slots. Per-provider cap applied at submit time so the
  // user doesn't lose picks when switching providers.
  const [refSlots, setRefSlots] = useState<string[]>(Array(REF_SLOTS).fill(""));
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  // Veo = fixed 8s. Grok = slider 8-30. Sora 2 = 8 or 12.
  const [duration, setDuration] = useState<number>(8);
  // Per-provider rates:
  //   • Veo    → /api/veo/rate (flat per-video price, rate_veo setting)
  //   • Grok   → /api/grok/rate (per-second rate × duration)
  //   • Sora 2 → /api/sora2/rate (per-second rate × duration)
  const [veoFlatRate, setVeoFlatRate] = useState<number | null>(null);
  const [grokRatePerSec, setGrokRatePerSec] = useState<number | null>(null);
  const [sora2RatePerSec, setSora2RatePerSec] = useState<number | null>(null);
  // GeminiOmni — flat per-10s-video rate (like Veo, not per-second).
  const [geminiFlatRate, setGeminiFlatRate] = useState<number | null>(null);
  // Seedance 2.0 Fast — per-second rate (rate_seedance.per_second admin
  // setting). Cost = rate × duration like Grok / Sora 2.
  const [seedanceRatePerSec, setSeedanceRatePerSec] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  // GeminiOmni Video Reference — uploaded source video URL + upload state.
  const [videoRef, setVideoRef] = useState<string>("");
  const [videoRefName, setVideoRefName] = useState<string>("");
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoStatus, setVideoStatus] = useState<string>("");

  async function uploadVideoRef(file: File) {
    setError(null);
    setVideoUploading(true);
    setVideoStatus("");
    try {
      // The upload passes through Vercel's serverless request-body cap (~4.5MB)
      // on /api/upload/video, so anything over ~4MB must be shrunk in the
      // browser first (downscale + drop audio). The reference is only a motion
      // guide so fidelity loss is irrelevant. (This also clears APIPod's 8MB cap.)
      let toUpload = file;
      if (file.size > 4 * 1024 * 1024) {
        setVideoStatus("Memampat video…");
        const res = await compressVideoIfNeeded(file);
        toUpload = res.file;
        if (toUpload.size > 4.4 * 1024 * 1024) {
          throw new Error(
            `Video masih terlalu besar selepas dimampat (${(toUpload.size / 1024 / 1024).toFixed(1)}MB). Cuba video yang lebih pendek.`
          );
        }
      }
      setVideoStatus("Uploading video…");
      const fd = new FormData();
      fd.append("file", toUpload, toUpload.name || "ref.mp4");
      const r = await fetch("/api/upload/video", { method: "POST", body: fd });
      const d = await readJsonSafe(r);
      if (!r.ok || !d?.url) throw new Error(d?.error || `Upload video gagal (HTTP ${r.status})`);
      setVideoRef(d.url);
      setVideoRefName(file.name || "video");
    } catch (e: any) {
      setError(e?.message || "Upload video gagal");
    } finally {
      setVideoUploading(false);
      setVideoStatus("");
    }
  }

  // Video Reference GUIDED mode fields — the free prompt is replaced by a
  // hardcoded template built from these. Only the dialog is manual.
  const [vrProductName, setVrProductName] = useState("");
  const [vrProductDetail, setVrProductDetail] = useState("");
  const [vrDialog, setVrDialog] = useState("");
  // Multi-segment: 1/2/3 output segments (~10/20/30s), each with its own
  // source window (start→end seconds) + dialog. seg[0].dialog mirrors
  // vrDialog for the single-segment path.
  const [vrSegCount, setVrSegCount] = useState<1 | 2 | 3>(1);
  const [vrSegs, setVrSegs] = useState<Array<{ start: string; end: string; dialog: string }>>([
    { start: "0", end: "10", dialog: "" },
    { start: "10", end: "20", dialog: "" },
    { start: "20", end: "30", dialog: "" },
  ]);
  const [vrGender, setVrGender] = useState<"female" | "male">("female");
  const [vrHijab, setVrHijab] = useState<"yes" | "no">("yes");
  const [vrAge, setVrAge] = useState<"20s" | "30s" | "40s" | "55+">("30s");
  // Uploaded avatar face (1 image) — the presenter. Optional.
  const [avatarRef, setAvatarRef] = useState<string>("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  async function uploadAvatarRef(file: File) {
    setError(null);
    setAvatarUploading(true);
    try {
      const { url } = await uploadImage(file);
      setAvatarRef(url);
    } catch (e: any) {
      setError(e?.message || "Upload avatar gagal");
    } finally {
      setAvatarUploading(false);
    }
  }

  // AI dialog generator (Bahasa Melayu, no Indon slang) from the product
  // detail — one line per segment, ~10s each. Fills vrDialog (single) or
  // every segment's dialog (multi).
  const [vrDialogGen, setVrDialogGen] = useState(false);
  async function generateVrDialog() {
    if (!vrProductName.trim() && !vrProductDetail.trim()) {
      setError("Isi Product Name / Detail Product dulu untuk jana dialog.");
      return;
    }
    setError(null);
    setVrDialogGen(true);
    try {
      const r = await fetch("/api/generate/video-ref-dialog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: vrProductName.trim(),
          product_detail: vrProductDetail.trim(),
          seg_count: vrSegCount,
        }),
      });
      const d = await readJsonSafe(r);
      if (!r.ok || !d?.ok || !Array.isArray(d.dialogs)) {
        throw new Error(d?.error || `Jana dialog gagal (HTTP ${r.status})`);
      }
      if (vrSegCount === 1) {
        setVrDialog(d.dialogs[0] || "");
      } else {
        setVrSegs((prev) =>
          prev.map((s, i) => (i < vrSegCount ? { ...s, dialog: d.dialogs[i] || s.dialog } : s))
        );
      }
    } catch (e: any) {
      setError(e?.message || "Jana dialog gagal");
    } finally {
      setVrDialogGen(false);
    }
  }

  // ── Saved-product picker (same store as Auto Content) — Beg Kuning
  //    (affiliate, has link) + Tiada Link (manual). Load / apply / save.
  type VrSaved = {
    id: string;
    kind: "affiliate" | "manual";
    product_id: string | null;
    product_name: string;
    detail: string | null;
    attachments: string[];
  };
  const [vrBegKuning, setVrBegKuning] = useState("");
  const [vrSavedAffiliate, setVrSavedAffiliate] = useState<VrSaved[]>([]);
  const [vrSavedManual, setVrSavedManual] = useState<VrSaved[]>([]);
  const [vrShowSaved, setVrShowSaved] = useState<"affiliate" | "manual" | null>(null);
  const [vrSaving, setVrSaving] = useState(false);
  const [vrSaveMsg, setVrSaveMsg] = useState<string | null>(null);

  async function loadVrSaved() {
    try {
      const [a, m] = await Promise.all([
        fetch("/api/auto-content/saved-products?kind=affiliate", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({})),
        fetch("/api/auto-content/saved-products?kind=manual", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => ({})),
      ]);
      if (Array.isArray(a?.items)) setVrSavedAffiliate(a.items);
      if (Array.isArray(m?.items)) setVrSavedManual(m.items);
    } catch {}
  }
  useEffect(() => {
    loadVrSaved();
  }, []);

  // Apply a saved product → fill Name + Detail + Link + attachment slots.
  function applyVrSaved(sp: VrSaved) {
    setVrProductName(sp.product_name);
    setVrProductDetail(sp.detail || "");
    setVrBegKuning(
      sp.product_id ? `https://www.tiktok.com/shop/my/pdp/product/${sp.product_id}` : ""
    );
    const urls = (sp.attachments || []).filter(Boolean).slice(0, 3);
    setRefSlots(() => {
      const next = Array(REF_SLOTS).fill("");
      urls.forEach((u, i) => {
        next[i] = u;
      });
      return next;
    });
    setVrShowSaved(null);
  }

  // Save the current product as a preset. Link present → Beg Kuning,
  // empty → Tiada Link (the server decides + dedupes by name).
  async function saveVrProduct() {
    const imgs = refSlots.filter(Boolean).slice(0, 3);
    if (imgs.length < 3) {
      setVrSaveMsg("Upload 3 attachment (Product Reference) dulu.");
      return;
    }
    if (!vrProductName.trim() || !vrProductDetail.trim()) {
      setVrSaveMsg("Isi Product Name + Detail Product dulu.");
      return;
    }
    setVrSaving(true);
    setVrSaveMsg(null);
    try {
      const r = await fetch("/api/auto-content/save-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: vrProductName.trim(),
          detail: vrProductDetail.trim(),
          beg_kuning_url: vrBegKuning.trim(),
          attachments: imgs,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Save failed");
      setVrSaveMsg(
        d.kind === "affiliate" ? "✓ Saved → Beg Kuning Product" : "✓ Saved → Tiada Link Product"
      );
      loadVrSaved();
      setTimeout(() => setVrSaveMsg(null), 4000);
    } catch (e: any) {
      setVrSaveMsg(e?.message || "Save failed");
    } finally {
      setVrSaving(false);
    }
  }

  // Build the hardcoded Video Reference prompt. The source video is
  // replicated EXACTLY; the ONLY things changed are the presenter (avatar)
  // and the product (product-reference images). Everything else — motion,
  // camera, scene, timing — stays identical.
  function buildVideoRefPrompt(dialog: string): string {
    const who = `a ${vrAge} ${vrGender === "female" ? "woman" : "man"}${
      vrGender === "female" && vrHijab === "yes" ? " wearing a modest hijab" : ""
    }`;
    const parts: string[] = [];
    // Framed as an ORIGINAL creation with a FICTIONAL presenter that merely
    // follows the source's choreography/timing — NOT a reproduction of the
    // real person in the source clip. This lowers provider content-review
    // flags ("identifiable real person / protected IP") which fire on the
    // input video before the prompt matters. It won't rescue a clearly
    // front-facing identifiable face, but it clears borderline clips.
    parts.push(
      `Create a NEW, ORIGINAL vertical short-form video featuring a FICTIONAL Malaysian content creator. Use the attached source video ONLY as a choreography and timing reference — match its camera movement, framing, pacing, timing, scene layout, lighting, mood and the SEQUENCE of actions, gestures and poses. Do NOT reproduce, copy, clone or preserve the identity, face, likeness or voice of any real person shown in the source video — the presenter is an entirely new invented character.`
    );
    parts.push(`Build the video around two elements:`);
    if (avatarRef) {
      parts.push(
        `(1) PRESENTER: a fictional ${who} — use the person in the FIRST reference image as the character design. Keep that face, skin tone and look consistent for the whole clip; the character performs the same choreography and lip movements as the reference timing.`
      );
    } else {
      parts.push(
        `(1) PRESENTER: a fictional ${who}, a natural Malaysian content creator (invented character, not anyone real) performing the same choreography and beats as the reference timing.`
      );
    }
    parts.push(
      `(2) PRODUCT: the presenter holds and shows the product in the ${
        avatarRef ? "OTHER" : ""
      } reference image(s)${
        vrProductName ? ` (${vrProductName})` : ""
      }, matching the source's timing for when the product is shown. Keep the product's exact shape, label, text, colour and packaging.`
    );
    if (vrProductDetail.trim()) parts.push(`Product context (for accuracy): ${vrProductDetail.trim()}.`);
    parts.push(
      `Match the source's location style, on-screen text/graphics rhythm, transitions and energy — but as a fresh original scene, not a copy of the original footage.`
    );
    if (dialog.trim()) {
      parts.push(
        `The presenter speaks naturally in Malaysian Bahasa Melayu, lip-synced, one voice only, no subtitles, NO Indonesian slang: "${dialog.trim()}".`
      );
    }
    parts.push(`Vertical 9:16, in the SAME visual style, look and energy as the source video.`);
    return parts.join(" ");
  }

  useEffect(() => {
    let cancel = false;
    // Veo flat rate (rate_veo.per_video_8s setting — admin-driven).
    fetch("/api/veo/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setVeoFlatRate(d.rate);
      })
      .catch(() => {});
    // Grok per-second rate (shares cinema rate setting).
    fetch("/api/grok/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setGrokRatePerSec(d.rate);
      })
      .catch(() => {});
    // Sora 2 per-second rate (sora2_rate setting, falls back to cinema × 2).
    fetch("/api/sora2/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setSora2RatePerSec(d.rate);
      })
      .catch(() => {});
    // GeminiOmni flat per-video rate (rate_gemini.per_video_10s).
    fetch("/api/gemini/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setGeminiFlatRate(d.rate);
      })
      .catch(() => {});
    // Seedance 2.0 Fast per-second rate (rate_seedance.per_second).
    // The endpoint returns { per_second: <number> } (different shape
    // than the other rate endpoints which return { rate }).
    fetch("/api/seedance/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const rps = Number(d?.per_second);
        if (!cancel && Number.isFinite(rps) && rps > 0) {
          setSeedanceRatePerSec(rps);
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  // Clamp image mode + duration when provider changes. Switching to a
  // provider that doesn't support the current mode falls back to "text"
  // so the user always lands in a valid state.
  useEffect(() => {
    if (!PROVIDER_MODES[provider].includes(imageMode)) {
      // Reset to the provider's FIRST VALID mode — NOT a hardcoded "text".
      // Grok only allows ["frame"], so the old "text" reset left Grok on an
      // invalid text-to-video mode (Grok 1.5 has no t2v) which the provider
      // then rejected with "requires a reference image". Fixed 2026-06-30.
      setImageMode(PROVIDER_MODES[provider][0]);
    }
    if (provider === "veo" && duration !== 8) setDuration(8);
    if (provider === "sora2" && duration !== 8 && duration !== 12) {
      setDuration(8);
    }
    // Grok Imagine 1.5 Preview — slider 1-15s, default 10 (was 8-30 in
    // legacy Grok; updated 2026-06-08 to match APIPod 1.5 Preview spec).
    if (provider === "grok" && (duration < 1 || duration > 15)) {
      setDuration(10);
    }
    // GeminiOmni — fixed 10s.
    if (provider === "gemini" && duration !== 10) setDuration(10);
    // Seedance 2.0 Fast — slider 4-15s, default 5 when switching in.
    if (provider === "seedance" && (duration < 4 || duration > 15)) {
      setDuration(5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  const theme = PROVIDER_THEME[provider];
  const availableModes = PROVIDER_MODES[provider];
  // SOP guide modals (storyboard / UGC frame).
  const [sopStoryboard, setSopStoryboard] = useState(false);
  const [sopUgc, setSopUgc] = useState(false);
  const refCap = getRefCap(provider, imageMode);
  const filledRefs = refSlots.filter((u) => !!u);

  // Live cost preview. Veo + Grok use cinema rate × duration; Sora 2
  // uses its own rate. Null when admin hasn't configured the rate yet.
  // Per-provider cost preview — mirrors the backend pricing branch in
  // /api/generate/cinema so what user sees on the button = what they
  // pay on settlement.
  //   • Veo    → flat veoFlatRate (regardless of duration since Veo is fixed 8s)
  //   • Grok   → grokRatePerSec × duration (per-second)
  //   • Sora 2 → sora2RatePerSec × duration (per-second)
  let estCost: string | null = null;
  if (provider === "veo" && veoFlatRate != null) {
    estCost = veoFlatRate.toFixed(2);
  } else if (provider === "grok" && grokRatePerSec != null) {
    estCost = (grokRatePerSec * duration).toFixed(2);
  } else if (provider === "sora2" && sora2RatePerSec != null) {
    estCost = (sora2RatePerSec * duration).toFixed(2);
  } else if (provider === "gemini" && geminiFlatRate != null) {
    // Gemini is flat per-video (10s fixed) — don't multiply by duration.
    estCost = geminiFlatRate.toFixed(2);
  } else if (provider === "seedance" && seedanceRatePerSec != null) {
    // Seedance per-second × duration (4-15s range).
    estCost = (seedanceRatePerSec * duration).toFixed(2);
  }

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const file = await dataUrlToFile(v, "ref.png");
    const { url } = await uploadImage(file);
    return url;
  }

  async function submit() {
    // Video Reference = GUIDED mode: no free prompt, prompt is hardcoded
    // from Product + Avatar + Dialog. Every other mode uses the prompt box.
    const isVideoMode = imageMode === "video";
    if (isVideoMode) {
      if (videoUploading || avatarUploading)
        return setError("Tunggu upload siap dulu.");
      if (!videoRef) return setError("Upload / paste video rujukan dulu.");
      if (!vrDialog.trim()) return setError("Isi Dialog dulu.");
    } else {
      if (!prompt.trim()) return setError("Sila masukkan prompt.");
      if (imageMode !== "text" && filledRefs.length === 0) {
        return setError("Pick at least one reference image.");
      }
    }
    setError(null);
    setStatus("submitting");
    try {
      // Video mode: image_urls = [avatar (if any), ...product images] so the
      // hardcoded prompt can reference "first image = presenter". Other
      // modes: just the picked refs. Text mode: none.
      const sourceUrls = isVideoMode
        ? [avatarRef, ...filledRefs.slice(0, refCap)].filter(Boolean)
        : imageMode === "text"
          ? []
          : filledRefs.slice(0, refCap);
      const pubUrls = await Promise.all(sourceUrls.map((u) => ensurePublicUrl(u)));

      const r = await fetch("/api/generate/cinema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: isVideoMode ? buildVideoRefPrompt(vrDialog) : prompt.trim(),
          image_url: pubUrls[0] || "",
          image_urls: pubUrls,
          // GeminiOmni Video Reference — source video URL.
          video_url: isVideoMode ? videoRef : "",
          duration,
          // Gemini forces 1080p server-side; we still send the right
          // value here so the optimistic UI cost preview matches what
          // /api/generate/cinema will actually compute.
          resolution: provider === "gemini" ? "1080p" : "720p",
          aspect_ratio: aspect,
          // Cinema route uses "text" / "frame" / "ingredient" directly.
          image_mode: imageMode,
          model: provider, // "veo" | "grok" | "sora2" | "gemini" | "seedance"
          // Tag so history grid can route this row into the Original
          // Video tab (separate from legacy Cinema / Grok rows).
          feature: "original-video",
          project_id: projectId,
        }),
      });
      const d = await readJsonSafe(r);
      if (!r.ok || !d?.ok) {
        setError(d?.error || `Generation failed (HTTP ${r.status})`);
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

  return (
    <div className="space-y-5">
      <div
        className="rounded-2xl p-5 border"
        style={{
          background: `linear-gradient(135deg, ${theme.faint}, transparent)`,
          borderColor: theme.soft,
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <Film className="w-5 h-5" style={{ color: theme.primary }} strokeWidth={2.4} />
          <h2 className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">
            Original Video
          </h2>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Power-user raw video generator. Pick a provider — prompt sent
          100% verbatim, no auto-locks or templates. Cascade fallback +
          history + deduct-on-success all work like other tabs.
        </p>

        {/* SOP guides — step-by-step panduan (storyboard + UGC frame). */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            onClick={() => setSopStoryboard(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition hover:scale-105"
            style={{ background: "rgba(59,130,246,0.15)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.4)" }}
          >
            <ClipboardList className="w-3.5 h-3.5" /> SOP Storyboard
          </button>
          <button
            type="button"
            onClick={() => setSopUgc(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition hover:scale-105"
            style={{ background: "rgba(249,115,22,0.15)", color: "#fdba74", border: "1px solid rgba(249,115,22,0.4)" }}
          >
            <Clapperboard className="w-3.5 h-3.5" /> SOP UGC Frame
          </button>
        </div>

        {/* Provider picker — 3 chips, each themed */}
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Provider
        </label>
        {/* Grok chip stays hidden per admin direction. Sora 2 also
            hidden whenever SORA2_DISABLED is true (APIPod-side outage
            kill-switch — see lib/feature-flags.ts). Grid auto-collapses
            from 4 → 3 cols when Sora 2 is hidden so chips stay
            balanced. */}
        <div
          className={`grid grid-cols-2 ${
            SORA2_DISABLED ? "sm:grid-cols-3" : "sm:grid-cols-4"
          } gap-2 mb-4`}
        >
          {/* Seedance 2.0 shown here per user direction 2026-07-15 (Reference
              to Video — same reference flow as GeminiOmni + a seconds slider).
              Grok = Grok Imagine 1.5 Preview (image-to-video, 1-15s, 720p). */}
          {(["veo", "sora2", "gemini", "grok", "seedance"] as const)
            // Veo 3.1 hidden from Original Video per user direction 2026-06-30.
            .filter((p) => p !== "veo" && !(SORA2_DISABLED && p === "sora2"))
            .map((p) => {
            const active = provider === p;
            const t = PROVIDER_THEME[p];
            return (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className="px-3 py-2.5 rounded-xl text-xs font-extrabold transition-all"
                style={
                  active
                    ? {
                        background: t.gradient,
                        color: p === "veo" ? "#1a1a1a" : "white",
                        boxShadow: `0 4px 12px ${t.soft}`,
                        border: "1px solid transparent",
                      }
                    : {
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-primary)",
                      }
                }
              >
                {t.emoji}{" "}
                {p === "veo"
                  ? "Veo 3.1"
                  : p === "sora2"
                    ? "Sora 2"
                    : p === "gemini"
                      ? "GeminiOmni"
                      : p === "seedance"
                        ? "Seedance 2.0"
                        : "Grok 1.5"}
              </button>
            );
          })}
        </div>

        {/* Image mode — conditional per provider */}
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Image mode
        </label>
        <div
          className="grid gap-2 mb-4"
          style={{
            gridTemplateColumns: `repeat(${availableModes.length}, minmax(0, 1fr))`,
          }}
        >
          {availableModes.map((m) => {
            const active = imageMode === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setImageMode(m)}
                className="px-3 py-2.5 rounded-lg text-xs font-bold transition-all text-left"
                style={
                  active
                    ? {
                        background: theme.gradient,
                        color: provider === "veo" ? "#1a1a1a" : "white",
                        boxShadow: `0 4px 12px ${theme.soft}`,
                      }
                    : {
                        background: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-primary)",
                      }
                }
              >
                <div className="text-center text-xs font-extrabold leading-tight mb-1">
                  {modeLabel(provider, m)}
                </div>
                <div
                  className="text-center text-[10px] font-normal leading-snug"
                  style={{ opacity: active ? 0.85 : 0.65 }}
                >
                  {modeDescription(m)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Per-(provider, mode) slot layouts. Mirrors UGC tab's
            FrameZoneRow / MultiRefRow structure but inlined here to
            keep the file self-contained. Slot semantics:
              • Veo + frame      → Start Frame * + End Frame (2 labeled zones)
              • Veo + ingredient → Multi-ref Product Reference (up to 3)
              • Grok + ingredient → Multi-ref Product Reference (up to 3)
              • Sora 2 + frame   → single Start Frame zone
              • any provider + text → no slots */}

        {/* === Veo + Seedance Start + End Frame layout ===
            Both providers support i2v with start+end frame (Veo
            cfg.videoI2V / Seedance seedance-2.0-fast-i2v). Identical
            2-slot UI — slot 0 = start (required), slot 1 = end (optional). */}
        {(provider === "veo" || provider === "seedance") &&
          imageMode === "frame" && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <FrameZone
                label="Start Frame"
                required
                theme={theme}
                url={refSlots[0] || ""}
                onPick={() => setPickingSlot(0)}
                onClear={() =>
                  setRefSlots(refSlots.map((u, j) => (j === 0 ? "" : u)))
                }
              />
              <FrameZone
                label="End Frame"
                theme={theme}
                url={refSlots[1] || ""}
                onPick={() => setPickingSlot(1)}
                onClear={() =>
                  setRefSlots(refSlots.map((u, j) => (j === 1 ? "" : u)))
                }
              />
            </div>
          )}

        {/* === Sora 2 + Grok 1.5 single Start Frame zone ===
            Both providers accept a single first-frame reference (Sora 2
            per OpenAI spec; Grok 1.5 Preview per APIPod spec — image_url
            is mandatory). Same FrameZone, different per-provider hint. */}
        {(provider === "sora2" || provider === "grok") &&
          imageMode === "frame" && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <FrameZone
              label="Start Frame"
              required
              theme={theme}
              url={refSlots[0] || ""}
              onPick={() => setPickingSlot(0)}
              onClear={() =>
                setRefSlots(refSlots.map((u, j) => (j === 0 ? "" : u)))
              }
            />
            <div className="text-[10px] text-[var(--color-text-muted)] self-center">
              {provider === "sora2"
                ? "⚠️ Sora 2 needs 720×1280 (9:16) or 1280×720 (16:9). Real portrait photos often fail — use AI-gen images."
                : "Grok 1.5 animates this image — describe the motion / camera move in the prompt. Single image required."}
            </div>
          </div>
        )}

        {/* === Multi-ref References (Veo + Grok) === */}
        {imageMode === "ingredient" && (
          <div className="mb-4">
            <div
              className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
              style={{ color: theme.primary }}
            >
              References ({filledRefs.length}/{refCap})
            </div>
            <div className="flex items-stretch gap-2">
              <div className="flex gap-1.5 flex-wrap">
                {Array.from({ length: refCap }).map((_, i) => {
                  const url = refSlots[i] || "";
                  // Slot 1 is mandatory, slots 2+ optional per user
                  // direction. Mandatory slot uses a solid (not dashed)
                  // border so the "must fill this one" affordance is
                  // visible at a glance even when empty.
                  const isRequired = i === 0;
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setPickingSlot(i)}
                        className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                        style={{
                          border: url
                            ? `2px solid ${theme.primary}`
                            : isRequired
                              ? `2px solid ${theme.soft}`
                              : `2px dashed ${theme.soft}`,
                          background: url ? "#000" : "var(--color-bg)",
                        }}
                      >
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={url}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span
                            className="text-xs font-semibold"
                            style={{ color: theme.primary }}
                          >
                            {i + 1}
                          </span>
                        )}
                        {url && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              setRefSlots(
                                refSlots.map((u, j) => (j === i ? "" : u))
                              );
                            }}
                            className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/70 text-white text-[10px] flex items-center justify-center cursor-pointer"
                          >
                            ×
                          </span>
                        )}
                      </button>
                      <span
                        className="text-[9px] font-mono uppercase tracking-wider"
                        style={{
                          color: isRequired
                            ? "#ef4444"
                            : "var(--color-text-muted)",
                        }}
                      >
                        {isRequired ? "REQUIRED" : "OPTIONAL"}
                      </span>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setPickingSlot(filledRefs.length)}
                disabled={filledRefs.length >= refCap}
                className="px-3 py-1 rounded text-[11px] font-bold whitespace-nowrap disabled:opacity-40 self-start"
                style={{
                  background: theme.faint,
                  border: `1px solid ${theme.primary}`,
                  color: theme.primary,
                }}
              >
                Reference
              </button>
            </div>
          </div>
        )}

        {/* === GeminiOmni Video Reference (video-only, no images) ===
            Upload a source/reference video. Both providers support it:
            P2 (Crun) video_list, P6 (APIPod) gemini-omni-extend. */}
        {imageMode === "video" && (
          <div className="mb-4 space-y-4">
            {/* PRODUCT — full card: saved-product loaders (Beg Kuning /
                Tiada Link) + Name + Detail + Link + Save. Attachments are
                the "Product Reference" slots below. */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div
                  className="text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: theme.primary }}
                >
                  Product
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setVrShowSaved((v) => (v === "affiliate" ? null : "affiliate"))
                    }
                    className="px-2 py-1 rounded-full text-[10px] font-bold inline-flex items-center gap-1"
                    style={{
                      background: vrShowSaved === "affiliate" ? theme.gradient : theme.faint,
                      border: `1px solid ${theme.soft}`,
                      color: vrShowSaved === "affiliate" ? "#1a1a1a" : theme.primary,
                    }}
                  >
                    🔗 Beg Kuning
                    <span
                      className="px-1.5 rounded-full text-[9px]"
                      style={{ background: theme.primary, color: "#1a1a1a" }}
                    >
                      {vrSavedAffiliate.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVrShowSaved((v) => (v === "manual" ? null : "manual"))}
                    className="px-2 py-1 rounded-full text-[10px] font-bold inline-flex items-center gap-1"
                    style={{
                      background: vrShowSaved === "manual" ? theme.gradient : theme.faint,
                      border: `1px solid ${theme.soft}`,
                      color: vrShowSaved === "manual" ? "#1a1a1a" : theme.primary,
                    }}
                  >
                    📦 Tiada Link
                    <span
                      className="px-1.5 rounded-full text-[9px]"
                      style={{ background: theme.primary, color: "#1a1a1a" }}
                    >
                      {vrSavedManual.length}
                    </span>
                  </button>
                </div>
              </div>

              {/* Saved-product dropdown list — click one to load its data. */}
              {vrShowSaved && (
                <div
                  className="rounded-lg mb-2 max-h-40 overflow-y-auto"
                  style={{ border: `1px solid ${theme.soft}`, background: theme.faint }}
                >
                  {(vrShowSaved === "affiliate" ? vrSavedAffiliate : vrSavedManual).length === 0 ? (
                    <div className="px-3 py-3 text-[11px] text-[var(--color-text-muted)] text-center">
                      Belum ada produk disimpan. Isi + Save Info Product untuk simpan.
                    </div>
                  ) : (
                    (vrShowSaved === "affiliate" ? vrSavedAffiliate : vrSavedManual).map((sp) => (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => applyVrSaved(sp)}
                        className="block w-full text-left px-3 py-2 text-[12px] hover:bg-white/5"
                        style={{ borderBottom: `1px solid ${theme.soft}`, color: "var(--color-text)" }}
                      >
                        <div className="font-bold truncate">{sp.product_name}</div>
                        {sp.detail && (
                          <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                            {sp.detail}
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}

              <input
                value={vrProductName}
                onChange={(e) => setVrProductName(e.target.value)}
                placeholder="Product name (cth: LUQFA Lotion 100ml)"
                className="w-full px-3 py-2 rounded-lg text-sm mb-2 bg-[var(--color-bg)] outline-none"
                style={{ border: `1px solid ${theme.soft}`, color: "var(--color-text)" }}
              />
              <textarea
                value={vrProductDetail}
                onChange={(e) => setVrProductDetail(e.target.value)}
                rows={2}
                placeholder="Detail produk (harga, USP, benefits…)"
                className="w-full px-3 py-2 rounded-lg text-sm mb-2 bg-[var(--color-bg)] outline-none resize-y"
                style={{ border: `1px solid ${theme.soft}`, color: "var(--color-text)" }}
              />
              <input
                value={vrBegKuning}
                onChange={(e) => setVrBegKuning(e.target.value)}
                placeholder="Link Beg Kuning (optional) — https://www.tiktok.com/…"
                className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-bg)] outline-none"
                style={{ border: `1px solid ${theme.soft}`, color: "var(--color-text)" }}
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => void saveVrProduct()}
                  disabled={vrSaving}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-60"
                  style={{ background: theme.faint, border: `1px solid ${theme.primary}`, color: theme.primary }}
                >
                  {vrSaving ? "⏳ Saving…" : "💾 Save Info Product"}
                </button>
                {vrSaveMsg && (
                  <span className="text-[10px]" style={{ color: theme.primary }}>
                    {vrSaveMsg}
                  </span>
                )}
              </div>
            </div>

            {/* AVATAR — presenter. Gender/Style/Age feed the prompt; an
                optional uploaded face pins the presenter. No Kekal/Dynamic. */}
            <div>
              <div
                className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: theme.primary }}
              >
                Avatar (Presenter)
              </div>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <select
                  value={vrGender}
                  onChange={(e) => {
                    const g = e.target.value as "female" | "male";
                    setVrGender(g);
                    if (g === "male") setVrHijab("no");
                  }}
                  className="px-2 py-2 rounded-lg text-sm bg-[var(--color-bg)]"
                  style={{ border: `1px solid ${theme.soft}`, color: "var(--color-text)" }}
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
                <select
                  value={vrHijab}
                  onChange={(e) => setVrHijab(e.target.value as "yes" | "no")}
                  disabled={vrGender === "male"}
                  className="px-2 py-2 rounded-lg text-sm bg-[var(--color-bg)] disabled:opacity-50"
                  style={{ border: `1px solid ${theme.soft}`, color: "var(--color-text)" }}
                >
                  <option value="yes">Hijab</option>
                  <option value="no">No Hijab</option>
                </select>
                <select
                  value={vrAge}
                  onChange={(e) => setVrAge(e.target.value as "20s" | "30s" | "40s" | "55+")}
                  className="px-2 py-2 rounded-lg text-sm bg-[var(--color-bg)]"
                  style={{ border: `1px solid ${theme.soft}`, color: "var(--color-text)" }}
                >
                  <option value="20s">20s</option>
                  <option value="30s">30s</option>
                  <option value="40s">40s</option>
                  <option value="55+">55+</option>
                </select>
              </div>
              {avatarRef ? (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={avatarRef}
                    alt=""
                    className="w-14 h-14 rounded-lg object-cover"
                    style={{ border: `2px solid ${theme.primary}` }}
                  />
                  <button
                    type="button"
                    onClick={() => setAvatarRef("")}
                    className="text-[11px] font-bold"
                    style={{ color: theme.primary }}
                  >
                    ✕ Buang avatar
                  </button>
                </div>
              ) : (
                <label
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-[11px] font-bold"
                  style={{ border: `1px dashed ${theme.soft}`, background: theme.faint, color: theme.primary }}
                >
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={avatarUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void uploadAvatarRef(f);
                    }}
                  />
                  {avatarUploading ? "⏳ Uploading…" : "+ Upload muka avatar (optional)"}
                </label>
              )}
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                Upload 1 gambar muka → presenter guna muka ni. Kosong = model reka ikut Gender/Style/Age.
              </p>
            </div>

            {/* Product reference images (optional) — the product to feature
                in the replicated video. Sits ABOVE the video source. */}
            <div>
              <div
                className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
                style={{ color: theme.primary }}
              >
                Product Reference ({filledRefs.length}/{refCap}) — optional
              </div>
              <div className="flex items-stretch gap-2">
                <div className="flex gap-1.5 flex-wrap">
                  {Array.from({ length: refCap }).map((_, i) => {
                    const url = refSlots[i] || "";
                    return (
                      <div key={i} className="flex flex-col items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => setPickingSlot(i)}
                          className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                          style={{
                            border: url
                              ? `2px solid ${theme.primary}`
                              : `2px dashed ${theme.soft}`,
                            background: url ? "#000" : "var(--color-bg)",
                          }}
                        >
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs font-semibold" style={{ color: theme.primary }}>
                              {i + 1}
                            </span>
                          )}
                          {url && (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setRefSlots(refSlots.map((u, j) => (j === i ? "" : u)));
                              }}
                              className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/70 text-white text-[10px] flex items-center justify-center cursor-pointer"
                            >
                              ×
                            </span>
                          )}
                        </button>
                        <span
                          className="text-[9px] font-mono uppercase tracking-wider"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          PRODUK
                        </span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setPickingSlot(filledRefs.length)}
                  disabled={filledRefs.length >= refCap}
                  className="px-3 py-1 rounded text-[11px] font-bold whitespace-nowrap disabled:opacity-40 self-start"
                  style={{
                    background: theme.faint,
                    border: `1px solid ${theme.primary}`,
                    color: theme.primary,
                  }}
                >
                  Attachments
                </button>
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                Optional — letak gambar produk anda, video akan keluar guna produk anda.
              </p>
            </div>

            <div
              className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
              style={{ color: theme.primary }}
            >
              Video Reference {videoRef ? "(1/1)" : "(0/1)"}
            </div>
            {videoRef ? (
              <div
                className="rounded-lg overflow-hidden relative"
                style={{ border: `2px solid ${theme.primary}`, background: "#000" }}
              >
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  src={videoRef}
                  controls
                  className="w-full max-h-56 object-contain bg-black"
                />
                <div
                  className="flex items-center justify-between px-2 py-1 text-[10px]"
                  style={{ background: theme.faint, color: theme.primary }}
                >
                  <span className="truncate">🎬 {videoRefName || "video"}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setVideoRef("");
                      setVideoRefName("");
                    }}
                    className="font-bold ml-2"
                  >
                    ✕ Buang
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Upload a video file… */}
                <label
                  className="flex flex-col items-center justify-center gap-1 rounded-lg cursor-pointer py-6 px-4 text-center"
                  style={{ border: `2px dashed ${theme.soft}`, background: theme.faint }}
                >
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    className="hidden"
                    disabled={videoUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void uploadVideoRef(f);
                    }}
                  />
                  {videoUploading ? (
                    <span className="flex items-center gap-2 text-[12px] font-bold" style={{ color: theme.primary }}>
                      <Loader2 className="w-4 h-4 animate-spin" /> {videoStatus || "Uploading video…"}
                    </span>
                  ) : (
                    <>
                      <span className="text-[13px] font-bold" style={{ color: theme.primary }}>
                        + Upload video rujukan
                      </span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">
                        MP4 / WEBM / MOV · besar auto-mampat &lt;4MB
                      </span>
                    </>
                  )}
                </label>
                {/* URL-link source removed: the browser can only auto-compress
                    an UPLOADED file, not a remote URL, so an oversized link had
                    no recovery path (blocked at the 8MB cap). Upload only. */}
              </>
            )}

            {/* DIALOG — the only manual input. Baked into the hardcoded
                prompt. Single 10s video (P6 gemini-omni-extend caps at 10s;
                no windowing / multi-segment). */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div
                  className="text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: theme.primary }}
                >
                  Dialog (Bahasa Melayu)
                </div>
                <button
                  type="button"
                  onClick={() => void generateVrDialog()}
                  disabled={vrDialogGen}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1.5 disabled:opacity-60"
                  style={{ background: theme.gradient, color: "#1a1a1a" }}
                >
                  {vrDialogGen ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" /> Menjana…
                    </>
                  ) : (
                    <>🪄 Jana Dialog (AI)</>
                  )}
                </button>
              </div>
              <textarea
                value={vrDialog}
                onChange={(e) => setVrDialog(e.target.value)}
                rows={3}
                placeholder="Apa presenter cakap… cth: 'Korang kena try ni, memang berbaloi!'"
                className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-bg)] outline-none resize-y"
                style={{ border: `1px solid ${theme.soft}`, color: "var(--color-text)" }}
              />
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                Prompt dibina automatik dari Product + Avatar + Dialog. Output ~10 saat (ikut video sumber).
              </p>
            </div>
          </div>
        )}

        {/* Prompt — hidden in Video Reference (guided) mode; the prompt is
            auto-built from Product + Avatar + Dialog there. */}
        {imageMode !== "video" && (
          <>
        <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
          Prompt (sent verbatim — no auto-locks)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={5000}
          rows={5}
          placeholder="Describe the video — characters, action, mood, camera style, dialogue if any…"
          className="w-full px-3 py-2 rounded-lg text-sm mb-4"
          style={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        />
          </>
        )}

        {/* Aspect + Duration */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Aspect ratio
            </label>
            <select
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="9:16">9:16 (Vertical)</option>
              <option value="16:9">16:9 (Horizontal)</option>
              {provider === "veo" || provider === "grok" ? (
                <>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="2:3">2:3</option>
                  <option value="3:2">3:2</option>
                </>
              ) : null}
              {provider === "seedance" ? (
                <>
                  <option value="1:1">1:1 (Square)</option>
                  <option value="3:4">3:4</option>
                  <option value="4:3">4:3</option>
                  <option value="21:9">21:9 (Ultrawide)</option>
                </>
              ) : null}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-[var(--color-text-secondary)] font-bold mb-2">
              Duration{provider === "veo" ? "" : ` (${duration}s)`}
            </label>
            {provider === "veo" && (
              <div
                className="px-3 py-2 rounded-lg text-sm font-bold text-center"
                style={{
                  background: theme.faint,
                  border: `1px solid ${theme.soft}`,
                  color: theme.primary,
                }}
              >
                Fixed 8s
              </div>
            )}
            {provider === "grok" && (
              <input
                type="range"
                min={1}
                max={15}
                step={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: theme.primary }}
              />
            )}
            {provider === "sora2" && (
              <div className="grid grid-cols-2 gap-2">
                {([8, 12] as const).map((d) => {
                  const active = duration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      className="px-2 py-2 rounded-lg text-xs font-extrabold transition-all"
                      style={
                        active
                          ? {
                              background: theme.gradient,
                              color: "white",
                              boxShadow: `0 4px 12px ${theme.soft}`,
                            }
                          : {
                              background: "var(--color-bg)",
                              border: "1px solid var(--color-border)",
                              color: "var(--color-text-primary)",
                            }
                      }
                    >
                      {d}s
                    </button>
                  );
                })}
              </div>
            )}
            {provider === "gemini" && (
              <div
                className="px-3 py-2 rounded-lg text-sm font-bold text-center"
                style={{
                  background: theme.faint,
                  border: `1px solid ${theme.soft}`,
                  color: theme.primary,
                }}
              >
                Fixed 10s
              </div>
            )}
            {provider === "seedance" && (
              <input
                type="range"
                min={4}
                max={15}
                step={1}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: theme.primary }}
              />
            )}
          </div>
        </div>

        {/* Submit */}
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full py-3 rounded-xl font-extrabold text-sm transition-all disabled:opacity-60"
          style={{
            background: theme.gradient,
            color: provider === "veo" ? "#1a1a1a" : "white",
            boxShadow: `0 6px 18px ${theme.soft}`,
          }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Generating…
            </span>
          ) : (
            `${theme.emoji} Generate ${provider === "veo" ? "Veo" : provider === "grok" ? "Grok" : provider === "sora2" ? "Sora 2" : provider === "gemini" ? "GeminiOmni" : "Seedance"} Video${estCost ? ` · ~RM${estCost}` : ""}`
          )}
        </button>

        {error && (
          <div
            className="mt-3 px-3 py-2 rounded-lg text-xs"
            style={{
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.35)",
              color: "rgb(239,68,68)",
            }}
          >
            {error}
          </div>
        )}
      </div>

      {pickingSlot !== null && (
        <Portal>
          <AttachmentPicker
            open={true}
            onClose={() => setPickingSlot(null)}
            onPick={(a) => {
              setRefSlots(
                refSlots.map((u, j) => (j === pickingSlot ? a.public_url : u))
              );
              setPickingSlot(null);
            }}
          />
        </Portal>
      )}

      {/* SOP guide modals */}
      <SopStoryboardModal open={sopStoryboard} onClose={() => setSopStoryboard(false)} exampleImageUrl="/sop-storyboard.jpg" />
      <SopUgcFrameModal open={sopUgc} onClose={() => setSopUgc(false)} />
    </div>
  );
}

// Single labeled image picker zone — used by Veo Start/End Frame mode
// and Sora 2 single first-frame mode. Mirrors UGC tab's FrameZoneRow
// shape: label above, 64×64 slot, side "Reference" picker button,
// inline × clear when filled. `required` shows an asterisk + solid
// border accent to signal mandatory.
function FrameZone({
  label,
  required,
  theme,
  url,
  onPick,
  onClear,
}: {
  label: string;
  required?: boolean;
  theme: { primary: string; soft: string; faint: string };
  url: string;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div>
      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-1.5 flex items-baseline gap-1.5"
        style={{ color: theme.primary }}
      >
        <span>{label}</span>
        {required ? (
          <span style={{ color: "#ef4444" }}>*</span>
        ) : (
          <span
            className="font-normal normal-case tracking-normal"
            style={{ color: "var(--color-text-muted)" }}
          >
            (optional)
          </span>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={onPick}
          className="relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{
            border: url
              ? `2px solid ${theme.primary}`
              : required
                ? `2px solid ${theme.soft}`
                : `2px dashed ${theme.soft}`,
            background: url ? "#000" : "var(--color-bg)",
          }}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-lg" style={{ color: theme.primary }}>
              {required ? "🖼️" : "+"}
            </span>
          )}
          {url && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/70 text-white text-[10px] flex items-center justify-center cursor-pointer"
            >
              ×
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={onPick}
          className="px-3 py-1 rounded text-[11px] font-bold whitespace-nowrap self-start"
          style={{
            background: theme.faint,
            border: `1px solid ${theme.primary}`,
            color: theme.primary,
          }}
        >
          Reference
        </button>
      </div>
    </div>
  );
}
