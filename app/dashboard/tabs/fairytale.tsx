"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  Sparkles,
  Upload,
  Volume2,
  Video as VideoIcon,
  Type,
  Image as ImageIcon,
  RotateCw,
  X,
  Wand2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { isVisibleAfterTtl, fetchSavedSet } from "@/lib/history-filter";

// Fairytale tab — 3-step wizard for AI-generated storytelling videos.
// Step 1: prompt + style/tone/language/aspect
// Step 2: pick visual style (6 cards)
// Step 3: AI auto-writes 10 scenes + auto-generates images. User tweaks
//         narration, voice, animation, text style, then renders final mp4
//         via Modal Ken Burns + MiniMax TTS pipeline.
//
// Pattern A async — Vercel inserts placeholder rows + fires Modal, which
// writes back to Supabase directly. Frontend polls scene rows for image
// completion + final mp4 row for render completion.

const PURPLE = "#a855f7";
const PURPLE_SOFT = "rgba(168, 85, 247, 0.10)";

// ─── Step 1 options ─────────────────────────────────────────────
type Style = "storytelling" | "sharing" | "selling";
type Tone = "formal" | "happy" | "sad" | "scary" | "bold";
type Language = "ms" | "en";
type Aspect = "9:16" | "1:1" | "16:9";

const STYLES: { id: Style; label: string; icon: string }[] = [
  { id: "storytelling", label: "Storytelling", icon: "💬" },
  { id: "sharing",      label: "Sharing",      icon: "📊" },
  { id: "selling",      label: "Selling",      icon: "💼" },
];
const TONES: { id: Tone; label: string; icon: string }[] = [
  { id: "formal", label: "Formal", icon: "🎩" },
  { id: "happy",  label: "Happy",  icon: "😊" },
  { id: "sad",    label: "Sad",    icon: "😢" },
  { id: "scary",  label: "Scary",  icon: "😱" },
  { id: "bold",   label: "Bold",   icon: "⚡" },
];
const LANGUAGES: { id: Language; label: string; tag: string }[] = [
  { id: "ms", label: "Bahasa Melayu", tag: "MY" },
  { id: "en", label: "English",       tag: "GB" },
];
const ASPECTS: { id: Aspect; label: string }[] = [
  { id: "9:16",  label: "9:16 Portrait" },
  { id: "1:1",   label: "1:1 Square" },
  { id: "16:9",  label: "16:9 Landscape" },
];

// Per-scene duration options (seconds). Drives the AI script-writer's
// target word count AND the merged mp4's per-scene length. Audio is
// padded with silence if narration is shorter, trimmed if longer.
const SECONDS_PER_SLIDE: { id: number; label: string }[] = [
  { id: 5,  label: "5s per slide" },
  { id: 8,  label: "8s per slide" },
  { id: 10, label: "10s per slide" },
  { id: 12, label: "12s per slide" },
  { id: 15, label: "15s per slide" },
];

// Total scene count. The AI splits the user prompt into N narrative beats.
const SLIDE_COUNTS: { id: number; label: string }[] = [
  { id: 5,  label: "5 slides" },
  { id: 8,  label: "8 slides" },
  { id: 10, label: "10 slides" },
  { id: 12, label: "12 slides" },
  { id: 15, label: "15 slides" },
];

function fmtMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// ─── Step 2 visuals ─────────────────────────────────────────────
// Visual style catalog — each entry is a distinctive aesthetic that works
// well for short-form storytelling video. Hints are deliberately detailed
// so the AI image model locks consistent style across all 10 scenes.
//
// "realistic" → "cinematic" (rename) is kept under the same id "realistic"
// so existing draft state and DB rows don't break.
type VisualStyle =
  | "realistic"   // Cinematic film still
  | "3d"          // 3D Pixar/Disney
  | "anime"       // Anime Ghibli
  | "fantasy"     // Fantasy concept art
  | "watercolor"  // Watercolor storybook
  | "noir"        // Cinematic noir
  | "vintage"     // Vintage 35mm film
  | "minimalist"; // Editorial minimal

// Sample images live in /public/storytelling-styles/ — generated once
// via the project's own AI pipeline (banana-pro, same model that ships
// to users) so each swatch is an honest representation of what the
// style produces. ~25-37 KB each, served from Vercel CDN. Gradient is
// kept as a fallback paint while the image decodes.
const VISUAL_STYLES: { id: VisualStyle; label: string; gradient: string; sample: string }[] = [
  { id: "realistic",  label: "Cinematic",
    sample: "/storytelling-styles/realistic.jpg",
    gradient: "linear-gradient(135deg, #1e3a8a 0%, #0ea5e9 50%, #f59e0b 100%)" },
  { id: "3d",         label: "3D Pixar",
    sample: "/storytelling-styles/3d.jpg",
    gradient: "linear-gradient(135deg, #f97316 0%, #fbbf24 50%, #fde68a 100%)" },
  { id: "anime",      label: "Anime Ghibli",
    sample: "/storytelling-styles/anime.jpg",
    gradient: "linear-gradient(135deg, #38bdf8 0%, #fef3c7 50%, #f472b6 100%)" },
  { id: "fantasy",    label: "Fantasy Epic",
    sample: "/storytelling-styles/fantasy.jpg",
    gradient: "linear-gradient(135deg, #1e1b4b 0%, #7c3aed 50%, #ec4899 100%)" },
  { id: "watercolor", label: "Watercolor",
    sample: "/storytelling-styles/watercolor.jpg",
    gradient: "linear-gradient(135deg, #fda4af 0%, #fef3c7 50%, #a7f3d0 100%)" },
  { id: "noir",       label: "Cinematic Noir",
    sample: "/storytelling-styles/noir.jpg",
    gradient: "linear-gradient(135deg, #09090b 0%, #52525b 50%, #fca5a5 100%)" },
  { id: "vintage",    label: "Vintage Film",
    sample: "/storytelling-styles/vintage.jpg",
    gradient: "linear-gradient(135deg, #78350f 0%, #f59e0b 60%, #fef3c7 100%)" },
  { id: "minimalist", label: "Editorial",
    sample: "/storytelling-styles/minimalist.jpg",
    gradient: "linear-gradient(135deg, #fafafa 0%, #d4d4d8 50%, #71717a 100%)" },
];

// ─── Step 3 config ─────────────────────────────────────────────
type ConfigTab = "voice" | "animation" | "font";

const TRANSITIONS = ["fade", "slide-left", "wipe-left", "circle-open", "dissolve", "radial"];
const SCENE_ANIMS = ["none", "zoom-pan", "pan-right", "pan-down", "slide-reveal-left", "fade-in", "scale-pulse", "color-shift"];
const TEXT_ANIMS = ["none", "word-by-word", "highlight", "karaoke"];
const TEXT_PLACEMENTS = ["top", "middle", "bottom"];
const FONT_TYPES = [
  "Lato", "Times New Roman", "Modern Sans", "Classic Serif",
  "Bold Display", "Grobold", "Montserrat", "Roboto", "Carter One"
];
const TEXT_SIZES: { id: string; label: string; px: number }[] = [
  { id: "S", label: "16px", px: 16 },
  { id: "M", label: "28px", px: 28 },
  { id: "L", label: "36px", px: 36 },
  { id: "XL", label: "48px", px: 48 },
];
const TEXT_COLORS = ["#000000", "#ffffff", "#a855f7", "#ef4444", "#f97316", "#fde047"];

// MiniMax voice catalog — the IDs MUST exist in MiniMax's library or
// t2a_v2 returns "voice id not exist". Each voice is locked to one
// language; when the user changes language in Step 1, the voice picker
// shows only the matching set and the default flips to the first entry
// of that language.
//
// `name` + `description` + `tags` drive the card UI in Step 1. Sample
// audio is generated on-demand via /api/fairytale/voice-sample and
// cached on B2 by voice_id, so repeat plays are free for everyone.
type VoiceLang = "ms" | "en";
type VoiceEntry = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  lang: VoiceLang;
  gender: "male" | "female";
  // Legacy single-line label kept for the cost summary chip in Step 2
  label: string;
};
const VOICES: VoiceEntry[] = [
  // Bahasa Melayu — Jamal first so voicesForLang("ms")[0] picks him as
  // the default selection on Step 1 mount.
  {
    id: "moss_audio_60caaba6-4799-11f1-bb39-7aa70590506b",
    name: "Jamal",
    description:
      "Custom-cloned Malay male voice — warm authoritative delivery with native phrasing. Great for serious storytelling, branded explainer, news-style narration in Bahasa.",
    tags: ["Malay", "Male", "Cloned", "Warm"],
    lang: "ms",
    gender: "male",
    label: "Jamal — Cloned, warm male",
  },
  {
    id: "Malay_male_1_v1",
    name: "Seasoned Man",
    description:
      "Deep, firm and resonant with steady articulation — authoritative like a news anchor. Conveys confidence and reliability. Great for explainer videos, brand films, business announcements.",
    tags: ["Malay", "Male", "Deep", "Polished"],
    lang: "ms",
    gender: "male",
    label: "Seasoned Man — Male, deep & polished",
  },
  {
    id: "Malay_female_2_v1",
    name: "Passionate Lady",
    description:
      "Bright, rich and expressive with a natural laid-back delivery. Candid influencer vibe, builds attraction quickly. Perfect for social media, podcast clips, candid vlog narration.",
    tags: ["Malay", "Female", "Bright", "Expressive"],
    lang: "ms",
    gender: "female",
    label: "Passionate Lady — Female, expressive",
  },
  // English
  {
    id: "English_Resonant_Man",
    name: "Deep Storyteller",
    description:
      "Rich, resonant male voice with steady grounded pacing. Natural warmth and authority — highly engaging for long-form listening and immersive storytelling.",
    tags: ["English", "Male", "Magnetic", "Smooth"],
    lang: "en",
    gender: "male",
    label: "Deep Storyteller — Male, magnetic",
  },
  {
    id: "English_expressive_narrator",
    name: "Expressive Narrator",
    description:
      "Husky, gritty and rough-edged with energetic articulation that feels unruly and fearless. Great for adventure storytelling, audio drama, RPG-style narration with bold confidence.",
    tags: ["English", "Versatile", "British", "Crisp"],
    lang: "en",
    gender: "male",
    label: "Expressive Narrator — Versatile",
  },
  {
    id: "English_captivating_female1",
    name: "Radiant Girl",
    description:
      "Bright, energetic and polished with an upbeat, naturally flowing tone — optimistic and sincere. Ideal for social vlogs, educational narration, friendly explainers with positive momentum.",
    tags: ["English", "Female", "Bright", "Energetic"],
    lang: "en",
    gender: "female",
    label: "Radiant Girl — Female, bright",
  },
  {
    id: "English_magnetic_voiced_man",
    name: "Magnetic Man",
    description:
      "Warm, gentle and soothing with slow unhurried pacing — reflective and calm. Ideal for emotional brand films, relaxation content, literary narration with quiet comfort.",
    tags: ["English", "Male", "Warm", "Gentle"],
    lang: "en",
    gender: "male",
    label: "Magnetic Man — Male, charismatic",
  },
  {
    id: "English_compelling_lady1",
    name: "Compelling Lady",
    description:
      "Bright and clear with expressive rhythmic intonation — feels like a natural storyteller. Great for fiction narration, character-driven stories, kids' tales with curiosity and detail.",
    tags: ["English", "Female", "Articulate", "British"],
    lang: "en",
    gender: "female",
    label: "Compelling Lady — Female, warm",
  },
];

function voicesForLang(lang: VoiceLang) {
  return VOICES.filter((v) => v.lang === lang);
}

// ─── Scene state ───────────────────────────────────────────────
type Scene = {
  idx: number;
  narration: string;
  imagePrompt: string;
  imageUrl: string;             // empty until image generation completes
  imageHistoryId: string | null; // row id we poll for completion
  imageStatus: "queued" | "generating" | "done" | "failed";
  // User-supplied image override (set from the Preview modal). When
  // either is present, we SKIP the AI image gen for this scene and
  // use the user's image instead.
  //   userImageUrl     — already-public URL (a pick from From History)
  //   userImageFile    — local File the user picked; uploaded at merge
  //                      time via uploadImage() to get a public URL
  //   userImagePreview — data: URL for instant thumbnail in the modal
  userImageUrl?: string;
  userImageFile?: File;
  userImagePreview?: string;
};

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

// ──────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ──────────────────────────────────────────────────────────────────────────

export default function FairytaleTab({ projectId }: { projectId?: string } = {}) {
  // Wizard now has 2 steps (was 3). Step 1 = combined prompt + visual +
  // pacing form. Step 2 = the old Step 3 (Review & Generate). The Visual
  // style picker that used to be its own step is folded into Step 1
  // below the aspect-ratio row.
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("storytelling");
  const [tone, setTone] = useState<Tone>("formal");
  const [language, setLanguage] = useState<Language>("ms");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);
  // Slide-pacing controls (added per user request — show estimated total
  // duration before generation so they can plan word count + cost).
  const [secondsPerSlide, setSecondsPerSlide] = useState<number>(5);
  const [sceneCount, setSceneCount] = useState<number>(10);
  // Live pricing from admin settings — drives the cost estimate badge in
  // Step 1. Defaults match getStorytellingPricing() so the badge shows a
  // reasonable number even before the fetch lands.
  const [pricing, setPricing] = useState<{ per_image: number; per_audio_sec: number }>({
    per_image: 0.07,
    per_audio_sec: 0.02,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/fairytale/pricing", { cache: "no-store" });
        const d = await r.json();
        if (!cancelled && r.ok && typeof d?.per_image === "number") {
          setPricing({
            per_image: d.per_image,
            per_audio_sec: d.per_audio_sec,
          });
        }
        // Also seed voice speed from admin override. Falls back to the
        // 1.2 default already in state if the server returned nothing
        // sensible. Safe to call unconditionally since setVoiceSpeed
        // is hoisted by the time this async callback resolves.
        if (!cancelled && r.ok && typeof d?.voice_speed === "number") {
          const s = Math.max(0.5, Math.min(2.0, d.voice_speed));
          setVoiceSpeed(s);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Step 2 state
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("realistic");

  // Preview modal — text-only review of auto-gen'd scenes (dialog +
  // image description). Opening it triggers script gen if not yet
  // started. User can edit dialog + supply per-scene images here
  // before committing to the full image generation in Step 2.
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // Step 3 state — scenes + config
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [scriptProgress, setScriptProgress] = useState<number>(0);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  // Default to Voice tab — quickest knob users want to access (turn
  // narration on/off). Voice picker itself lives in Step 1.
  const [configTab, setConfigTab] = useState<ConfigTab>("voice");
  const [previewIdx, setPreviewIdx] = useState(0);
  const [renderStatus, setRenderStatus] = useState<"idle" | "submitting" | "rendering" | "done" | "failed">("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [groupId] = useState(() => Math.random().toString(36).slice(2));

  // Voice config — defaults to the first voice for the current language.
  // Speed defaults to 1.2x (matches AI Call's tuned default — slightly
  // faster than natural so scrolly viewers stay engaged). Admin can
  // override via /admin/settings → Storytelling card; the override
  // arrives via /api/fairytale/pricing on mount.
  const [enableVoice, setEnableVoice] = useState(true);
  const [voiceId, setVoiceId] = useState(voicesForLang("ms")[0].id);
  const [voiceSpeed, setVoiceSpeed] = useState(1.2);

  // CTA — three modes:
  //   • none — story rides to its natural emotional close, no CTA
  //   • engagement — AI ends with a topic-relevant question that
  //     bait viewers to comment ("apa pendapat korang?")
  //   • follow — AI appends a fixed user-typed follow CTA verbatim
  // Default = engagement: comment-bait endings drive higher reach
  // on TikTok/IG short-form than passive endings.
  type CtaMode = "none" | "engagement" | "follow";
  const [ctaMode, setCtaMode] = useState<CtaMode>("engagement");
  const [ctaText, setCtaText] = useState(
    "Kalau Berminat Dengan Content Begini, Jemput Follow"
  );

  // When the user switches language in Step 1, the previously-selected
  // voice id likely doesn't exist in the new language pack — auto-reset
  // to the first voice of the new language so MiniMax doesn't reject the
  // TTS call with "voice id not exist".
  useEffect(() => {
    const valid = voicesForLang(language as VoiceLang);
    if (!valid.find((v) => v.id === voiceId)) {
      setVoiceId(valid[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // TTS cache — pre-generated narration audio per scene. Filled once when
  // script gen completes; reused by live preview (real audio) AND by the
  // merge step (Modal skips TTS regeneration if scene has audio_url).
  const [audioCache, setAudioCache] = useState<Record<number, string>>({});
  const [audioCacheStatus, setAudioCacheStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [previewMuted, setPreviewMuted] = useState(false);

  // Animation config
  const [transition, setTransition] = useState("fade");
  const [sceneAnimation, setSceneAnimation] = useState("zoom-pan");

  // Font config — defaults tuned for readable yellow-on-image with no
  // background block: 16px (S) + yellow (#fde047) + textBackground off.
  const [enableText, setEnableText] = useState(true);
  const [textAnimation, setTextAnimation] = useState("karaoke");
  const [textPlacement, setTextPlacement] = useState("middle");
  const [fontType, setFontType] = useState("Grobold");
  const [textSize, setTextSize] = useState("S");
  const [textColor, setTextColor] = useState("#fde047");
  const [uppercase, setUppercase] = useState(true);
  const [textBackground, setTextBackground] = useState(false);

  // Step 3 → start AI script generation when entering
  async function generateScript() {
    setScriptLoading(true);
    setScriptError(null);
    setScriptProgress(0);
    try {
      const r = await fetch("/api/generate/fairytale/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          style,
          tone,
          language,
          visual_style: visualStyle,
          scene_count: sceneCount,
          // Target narration duration per scene — helps the LLM size each
          // beat to match the slide it'll be paired with.
          scene_duration_sec: secondsPerSlide,
          // CTA flow — three modes:
          //   none = natural story close, no CTA
          //   engagement = AI ends with topic-relevant comment-bait question
          //   follow = AI appends the user-typed follow CTA verbatim
          cta_mode: ctaMode,
          cta_text: ctaText.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || `HTTP ${r.status}`);

      const initial: Scene[] = (d.scenes || []).map((s: any, i: number) => ({
        idx: i,
        narration: s.narration || "",
        imagePrompt: s.image_prompt || "",
        imageUrl: "",
        imageHistoryId: null,
        imageStatus: "queued" as const,
      }));
      setScenes(initial);
      setScriptProgress(100);
      // Kick off image generation for each scene
      void fireSceneImages(initial);
    } catch (e: any) {
      setScriptError(e?.message || "Script generation failed");
    } finally {
      setScriptLoading(false);
    }
  }

  async function fireSceneImages(initialScenes: Scene[]) {
    // Fire all scene image generations in parallel — backend inserts a row
    // per scene with type='fairytale-scene' and group_id matching this batch.
    // Skip scenes the user has already supplied an image for (via the
    // Preview modal's Upload / From-History buttons). Those scenes are
    // marked 'done' immediately with the user's URL — Modal merge picks
    // them up from scene.imageUrl unchanged.
    const toGenerate = initialScenes.filter(
      (s) => !s.userImageUrl && !s.userImageFile
    );

    const updates = await Promise.all(
      toGenerate.map(async (s) => {
        try {
          const r = await fetch("/api/generate/fairytale/scene-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: s.imagePrompt,
              aspect_ratio: aspect,
              project_id: projectId,
              scene_idx: s.idx,
              group_id: groupId,
            }),
          });
          const d = await r.json();
          if (r.ok && d?.history_id) {
            return { idx: s.idx, history_id: d.history_id as string };
          }
        } catch {}
        return null;
      })
    );

    setScenes((prev) =>
      prev.map((s) => {
        // User-supplied scenes — skip the gen path entirely. If they
        // gave us a public URL (history pick), use it now; if they
        // gave us a File, the data: preview shows for now and we'll
        // upload + swap to a public URL at submit time.
        if (s.userImageUrl || s.userImageFile) {
          return {
            ...s,
            imageUrl: s.userImageUrl || s.userImagePreview || "",
            imageStatus: "done" as const,
          };
        }
        const u = updates.find((x) => x && x.idx === s.idx);
        return u
          ? { ...s, imageHistoryId: u.history_id, imageStatus: "generating" as const }
          : { ...s, imageStatus: "failed" as const };
      })
    );
  }

  // ─── TTS preview cache ────────────────────────────────────
  // When all scene narrations are present (after script gen), pre-generate
  // MP3 audio for each scene via MiniMax → upload to B2. The live preview
  // plays these; the merge step reuses them so Modal doesn't re-do TTS.
  async function fetchAudioCache() {
    if (audioCacheStatus === "loading") return;
    const sceneList = scenes
      .filter((s) => s.narration?.trim())
      .map((s) => ({ idx: s.idx, narration: s.narration }));
    if (sceneList.length === 0) return;
    setAudioCacheStatus("loading");
    try {
      const r = await fetch("/api/fairytale/tts-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history_id: groupId,
          voice_id: voiceId,
          speed: voiceSpeed,
          language,
          scenes: sceneList,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      const map: Record<number, string> = {};
      for (const row of d.results || []) {
        if (row.audio_url) map[row.idx] = row.audio_url;
      }
      setAudioCache(map);
      setAudioCacheStatus(d.failed_count > 0 ? "failed" : "ready");
    } catch {
      setAudioCacheStatus("failed");
    }
  }

  // Auto-fetch TTS cache once scene narrations are ready (and re-fetch if
  // voice settings change — voiceId or voiceSpeed). Triggers on Step 2
  // (the Review & Generate step) entry; the Preview modal in Step 1 is
  // text-only by user request, so no TTS there.
  useEffect(() => {
    if (step !== 2) return;
    if (!enableVoice) return;
    if (scenes.length === 0) return;
    if (scenes.some((s) => !s.narration?.trim())) return;
    if (audioCacheStatus === "loading") return;
    void fetchAudioCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, enableVoice, voiceId, voiceSpeed, scenes.map((s) => s.narration).join("|")]);

  // Poll scene image rows every 4s until all done or failed.
  // Triggers on Step 2 entry (was Step 3 in the 3-step wizard).
  useEffect(() => {
    if (step !== 2) return;
    const pendingIds = scenes
      .filter((s) => s.imageStatus === "generating" && s.imageHistoryId)
      .map((s) => s.imageHistoryId as string);
    if (pendingIds.length === 0) return;

    const sb = createClient();
    let cancelled = false;
    const tick = async () => {
      const { data } = await sb
        .from("history")
        .select("id, status, output_url")
        .in("id", pendingIds);
      if (cancelled || !data) return;
      setScenes((prev) =>
        prev.map((s) => {
          if (!s.imageHistoryId) return s;
          const row = data.find((r: any) => r.id === s.imageHistoryId);
          if (!row) return s;
          if (row.status === "done" && row.output_url) {
            return { ...s, imageUrl: row.output_url as string, imageStatus: "done" as const };
          }
          if (row.status === "failed") {
            return { ...s, imageStatus: "failed" as const };
          }
          return s;
        })
      );
    };
    void tick();
    const id = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [step, scenes.map((s) => `${s.idx}:${s.imageStatus}`).join("|")]);

  // ─── Step nav ──────────────────────────────────────────────
  // 2-step wizard: Step 1 = combined prompt + visual + pacing form,
  // Step 2 = Review & Generate (was Step 3). Visual style picker is
  // rendered inline in Step 1 below the aspect/pacing rows.
  function goNext() {
    if (step === 1) {
      if (!prompt.trim()) return;
      setStep(2);
      // Kick off AI script gen + scene image gen on entry. Same trigger
      // point as before, just one step earlier in the wizard.
      if (scenes.length === 0 && !scriptLoading) {
        void generateScript();
      }
    }
  }
  function goBack() {
    if (step === 2) setStep(1);
  }

  // ─── Submit final render ───────────────────────────────────
  async function submitRender() {
    setRenderError(null);
    setRenderStatus("submitting");
    try {
      // Upload any deferred user-supplied files (from the Preview modal)
      // BEFORE we check validity. Each File becomes a public URL that
      // takes the place of the AI-gen'd scene image.
      const filesToUpload = scenes.filter((s) => s.userImageFile && !s.userImageUrl);
      if (filesToUpload.length > 0) {
        await Promise.all(filesToUpload.map(async (s) => {
          try {
            const { url } = await uploadImage(s.userImageFile!);
            setScenes((prev) =>
              prev.map((p) =>
                p.idx === s.idx
                  ? { ...p, userImageUrl: url, imageUrl: url, imageStatus: "done" as const }
                  : p
              )
            );
            // Mutate the local closure too so the validity check below
            // sees the freshly-set imageUrl without waiting for React's
            // setState round-trip.
            s.userImageUrl = url;
            s.imageUrl = url;
          } catch (e: any) {
            console.error(`[storytelling] scene ${s.idx} upload failed:`, e?.message);
          }
        }));
      }

      const valid = scenes.filter((s) => s.imageUrl && s.narration.trim());
      if (valid.length === 0) {
        setRenderError("Tunggu sehingga semua scene selesai diproses.");
        setRenderStatus("idle");
        return;
      }
      const r = await fetch("/api/generate/fairytale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          voice_id: voiceId,
          voice_speed: voiceSpeed,
          enable_voice: enableVoice,
          animation: sceneAnimation,
          transition,
          placement: textPlacement,
          font_size: TEXT_SIZES.find((s) => s.id === textSize)?.px ?? 36,
          font_family: fontType,
          font_color: textColor,
          subtitle_bg: textBackground ? "box" : "none",
          subtitle_animation: textAnimation,
          uppercase,
          enable_text: enableText,
          aspect_ratio: aspect,
          // Per-scene visual length in seconds. Modal's ffmpeg pads short
          // narrations with silence and clamps long ones to this duration.
          scene_duration_sec: secondsPerSlide,
          // Wizard's selected language drives MiniMax language_boost on
          // any fallback TTS Modal generates if it lacks a cached audio_url.
          language,
          scenes: valid.map((s) => ({
            image_url: s.imageUrl,
            narration: uppercase ? s.narration.toUpperCase() : s.narration,
            // Reuse the pre-generated TTS so Modal skips MiniMax round-trip.
            // If empty/missing Modal falls back to generating fresh.
            audio_url: audioCache[s.idx] || undefined,
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || `HTTP ${r.status}`);
      setRenderStatus("done");
      // Bump the history grid 3 times so the user sees the placeholder
      // immediately, the row appearing once Modal accepts, and the final
      // mp4 swap-in when render completes (~30-60s later).
      window.dispatchEvent(new CustomEvent("history:refresh"));
      setTimeout(() => window.dispatchEvent(new CustomEvent("history:refresh")), 5000);
      setTimeout(() => window.dispatchEvent(new CustomEvent("history:refresh")), 60_000);
    } catch (e: any) {
      setRenderError(e?.message || "Render failed");
      setRenderStatus("failed");
    }
  }

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="rounded-3xl p-6 md:p-10 bg-white" style={{ minHeight: "60vh" }}>
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="font-display font-extrabold text-2xl text-[#1a1a1a]">Storytelling</h2>
        <p className="text-xs text-gray-500 mt-1">
          AI-narrated storytelling videos in Bahasa Melayu
        </p>
      </div>

      {/* Progress steps */}
      <StepIndicator step={step} />

      {step === 1 && (
        <Step1
          prompt={prompt} setPrompt={setPrompt}
          style={style} setStyle={setStyle}
          tone={tone} setTone={setTone}
          language={language} setLanguage={setLanguage}
          aspect={aspect} setAspect={setAspect}
          visualStyle={visualStyle} setVisualStyle={setVisualStyle}
          secondsPerSlide={secondsPerSlide} setSecondsPerSlide={setSecondsPerSlide}
          sceneCount={sceneCount} setSceneCount={setSceneCount}
          voiceId={voiceId} setVoiceId={setVoiceId}
          voiceSpeed={voiceSpeed}
          ctaMode={ctaMode} setCtaMode={setCtaMode}
          ctaText={ctaText} setCtaText={setCtaText}
          pricing={pricing}
          styleDropdownOpen={styleDropdownOpen} setStyleDropdownOpen={setStyleDropdownOpen}
          onPreview={() => {
            setPreviewModalOpen(true);
            // Lazy-trigger script gen on first Preview open
            if (scenes.length === 0 && !scriptLoading) void generateScript();
          }}
        />
      )}

      {previewModalOpen && (
        <PreviewModal
          scenes={scenes}
          setScenes={setScenes}
          scriptLoading={scriptLoading}
          scriptError={scriptError}
          onRetryScript={generateScript}
          onClose={() => setPreviewModalOpen(false)}
          onContinue={() => {
            setPreviewModalOpen(false);
            goNext();
          }}
          secondsPerSlide={secondsPerSlide}
        />
      )}

      {step === 2 && (
        <Step3
          scenes={scenes} setScenes={setScenes}
          scriptLoading={scriptLoading} scriptError={scriptError}
          configTab={configTab} setConfigTab={setConfigTab}
          language={language}
          enableVoice={enableVoice} setEnableVoice={setEnableVoice}
          voiceId={voiceId} setVoiceId={setVoiceId}
          voiceSpeed={voiceSpeed} setVoiceSpeed={setVoiceSpeed}
          transition={transition} setTransition={setTransition}
          sceneAnimation={sceneAnimation} setSceneAnimation={setSceneAnimation}
          enableText={enableText} setEnableText={setEnableText}
          textAnimation={textAnimation} setTextAnimation={setTextAnimation}
          textPlacement={textPlacement} setTextPlacement={setTextPlacement}
          fontType={fontType} setFontType={setFontType}
          textSize={textSize} setTextSize={setTextSize}
          textColor={textColor} setTextColor={setTextColor}
          uppercase={uppercase} setUppercase={setUppercase}
          textBackground={textBackground} setTextBackground={setTextBackground}
          previewIdx={previewIdx} setPreviewIdx={setPreviewIdx}
          audioCache={audioCache}
          audioCacheStatus={audioCacheStatus}
          previewMuted={previewMuted}
          setPreviewMuted={setPreviewMuted}
          renderStatus={renderStatus} renderError={renderError}
          onBack={goBack}
          onSubmit={submitRender}
          onRetryScript={generateScript}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Step Indicator
// ──────────────────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 }) {
  const items = [
    { n: 1, title: "Prompt & Settings", subtitle: "Define your video" },
    { n: 2, title: "Review & Generate", subtitle: "Final confirmation" },
  ];
  return (
    <div className="flex items-center justify-center gap-2 md:gap-6 mb-10 max-w-3xl mx-auto">
      {items.map((it, i) => {
        const active = step === it.n;
        const done = step > it.n;
        return (
          <div key={it.n} className="flex items-center gap-2 md:gap-6 flex-1">
            <div className="flex flex-col items-center text-center min-w-0">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all"
                style={{
                  background: done || active ? PURPLE : "#f3f4f6",
                  color: done || active ? "white" : "#9ca3af",
                }}
              >
                {done ? <Check className="w-4 h-4" /> : it.n}
              </div>
              <div className="mt-2 text-[11px] font-bold text-gray-800 whitespace-nowrap">
                {it.title}
              </div>
              <div className="text-[10px] text-gray-500 whitespace-nowrap">
                {it.subtitle}
              </div>
            </div>
            {i < items.length - 1 && (
              <div className="flex-1 h-0.5 mt-[-22px]" style={{ background: done ? PURPLE : "#e5e7eb" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// VoicePickerList — rich card list rendered inside Step 1.
// ──────────────────────────────────────────────────────────────────────────
//
// Each row is a clickable card with avatar, name, description, tag chips,
// a play button (samples from /api/fairytale/voice-sample, B2-cached so
// repeat plays don't hit MiniMax), and a "Use" pill that flips the
// selection. Plays are mutually exclusive — starting one stops any other.

function VoicePickerList(props: {
  language: VoiceLang;
  voiceId: string;
  setVoiceId: (id: string) => void;
  // voiceSpeed is fed to the sample API so MiniMax synthesizes at the
  // correct speed natively. No client-side playbackRate manipulation
  // needed — the cached MP3 already IS the right speed.
  voiceSpeed: number;
}) {
  const list = voicesForLang(props.language);
  // sampleCache: voice_id -> signed URL. Persists for the wizard session
  // so repeat plays of the same voice don't even hit our backend.
  const [sampleCache, setSampleCache] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop any playing sample when the language changes — the dropdown
  // remounts, but the audio element doesn't get torn down on its own.
  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    setPlayingId(null);
    setLoadingId(null);
    setErrorId(null);
  }, [props.language]);

  async function fetchSample(voiceId: string): Promise<string | null> {
    if (sampleCache[voiceId]) return sampleCache[voiceId];
    try {
      const r = await fetch("/api/fairytale/voice-sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice_id: voiceId, language: props.language }),
      });
      const d = await r.json();
      if (!r.ok || !d?.url) return null;
      setSampleCache((prev) => ({ ...prev, [voiceId]: d.url }));
      return d.url as string;
    } catch {
      return null;
    }
  }

  async function togglePlay(voiceId: string) {
    const el = audioRef.current;
    if (!el) return;
    // Toggle off if already playing this voice
    if (playingId === voiceId && !el.paused) {
      el.pause();
      setPlayingId(null);
      return;
    }
    // Stop any other voice that's playing
    if (!el.paused) el.pause();
    setErrorId(null);
    setLoadingId(voiceId);
    const url = await fetchSample(voiceId);
    setLoadingId(null);
    if (!url) {
      setErrorId(voiceId);
      return;
    }
    el.src = url;
    el.playbackRate = 1.0; // file is already synthesized at admin speed
    setPlayingId(voiceId);
    el.play().catch(() => setErrorId(voiceId));
  }

  // If admin speed changes, drop the in-memory URL cache so the next
  // play fetches a freshly-synthesized sample at the new speed.
  useEffect(() => {
    setSampleCache({});
  }, [props.voiceSpeed]);

  return (
    <div className="flex flex-col gap-1.5 max-h-[360px] overflow-y-auto pr-1">
      <audio
        ref={audioRef}
        onEnded={() => setPlayingId(null)}
        onPause={() => setPlayingId((p) => (p && audioRef.current?.paused ? null : p))}
        preload="none"
      />
      {list.map((v) => {
        const active = props.voiceId === v.id;
        const isLoading = loadingId === v.id;
        const isPlaying = playingId === v.id;
        const isError = errorId === v.id;
        return (
          <div
            key={v.id}
            onClick={() => props.setVoiceId(v.id)}
            className="group flex items-center justify-between rounded-xl p-3 cursor-pointer transition-all"
            style={{
              background: active ? "#faf5ff" : "white",
              border: active ? "2px solid #a855f7" : "1px solid #e5e7eb",
            }}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Avatar — gradient circle with initial; no external CDN. */}
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-extrabold text-lg"
                style={{
                  background: v.gender === "female"
                    ? "linear-gradient(135deg, #f472b6 0%, #c084fc 100%)"
                    : "linear-gradient(135deg, #60a5fa 0%, #818cf8 100%)",
                }}
              >
                {v.name[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-gray-800 truncate">
                  {v.name}
                </div>
                <div className="text-[11px] text-gray-500 line-clamp-2 leading-snug mt-0.5">
                  {v.description}
                </div>
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {v.tags.slice(0, 4).map((t, i) => (
                    <span
                      key={i}
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                      style={{
                        background: "#f3f4f6",
                        color: "#6b7280",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void togglePlay(v.id);
                }}
                title={isPlaying ? "Stop" : "Play sample"}
                className="w-9 h-9 rounded-full flex items-center justify-center transition"
                style={{
                  background: isPlaying ? "#a855f7" : "#1f2937",
                  color: "white",
                }}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isError ? (
                  <X className="w-4 h-4" />
                ) : isPlaying ? (
                  <span style={{ fontSize: 14, lineHeight: 1 }}>■</span>
                ) : (
                  <span style={{ fontSize: 14, lineHeight: 1, marginLeft: 2 }}>▶</span>
                )}
              </button>
              <span
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-full"
                style={{
                  background: active ? "#a855f7" : "#f3f4f6",
                  color: active ? "white" : "#6b7280",
                }}
              >
                {active ? "✓ Use" : "Use"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// STEP 1 — Prompt + Settings
// ──────────────────────────────────────────────────────────────────────────

function Step1(props: {
  prompt: string; setPrompt: (v: string) => void;
  style: Style; setStyle: (v: Style) => void;
  tone: Tone; setTone: (v: Tone) => void;
  language: Language; setLanguage: (v: Language) => void;
  aspect: Aspect; setAspect: (v: Aspect) => void;
  visualStyle: VisualStyle; setVisualStyle: (v: VisualStyle) => void;
  secondsPerSlide: number; setSecondsPerSlide: (v: number) => void;
  sceneCount: number; setSceneCount: (v: number) => void;
  voiceId: string; setVoiceId: (v: string) => void;
  voiceSpeed: number;
  ctaMode: "none" | "engagement" | "follow"; setCtaMode: (v: "none" | "engagement" | "follow") => void;
  ctaText: string; setCtaText: (v: string) => void;
  pricing: { per_image: number; per_audio_sec: number };
  styleDropdownOpen: boolean; setStyleDropdownOpen: (v: boolean) => void;
  // No onNext prop — Step 1 forces the user through the Preview modal,
  // which owns the transition to Step 2. Cleaner funnel.
  onPreview: () => void;
}) {
  const ctaWordCount = props.ctaText
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const styleObj = STYLES.find((s) => s.id === props.style)!;
  const toneObj = TONES.find((t) => t.id === props.tone)!;
  const langObj = LANGUAGES.find((l) => l.id === props.language)!;
  const aspectObj = ASPECTS.find((a) => a.id === props.aspect)!;
  const secObj = SECONDS_PER_SLIDE.find((s) => s.id === props.secondsPerSlide) || SECONDS_PER_SLIDE[2];
  const countObj = SLIDE_COUNTS.find((s) => s.id === props.sceneCount) || SLIDE_COUNTS[2];
  // Rough estimate — actual duration depends on TTS length per scene + the
  // ~0.5s xfade transition Modal adds between scenes. We show the simple
  // (sec * count) so the user can plan; the merged mp4 lands within ~5s.
  const estTotalSec = props.secondsPerSlide * props.sceneCount;
  // Cost = per_image × scene_count + per_audio_sec × scene_dur × scene_count.
  // Matches the formula the server uses to deduct so the displayed number
  // is exactly what the user will be charged.
  const estCost =
    props.pricing.per_image * props.sceneCount +
    props.pricing.per_audio_sec * props.secondsPerSlide * props.sceneCount;

  return (
    <div className="max-w-3xl mx-auto">
      <label className="block text-sm font-bold mb-2">
        What kind of video you want to create?
        <span className="float-right text-xs text-gray-400 font-normal">
          {props.prompt.length} / 1000
        </span>
      </label>
      <textarea
        rows={6}
        value={props.prompt}
        onChange={(e) => props.setPrompt(e.target.value.slice(0, 1000))}
        placeholder="Describe the video you want to make today"
        className="w-full p-4 rounded-xl text-sm resize-y outline-none transition focus:border-purple-400"
        style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a" }}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
        {/* Style + Tone combined dropdown */}
        <div className="relative">
          <button
            onClick={() => props.setStyleDropdownOpen(!props.styleDropdownOpen)}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-between"
            style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a" }}
          >
            <span>
              {styleObj.icon} {styleObj.label} <span className="mx-1 text-gray-300">|</span> {toneObj.icon} {toneObj.label}
            </span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>
          {props.styleDropdownOpen && (
            <div
              className="absolute left-0 top-full mt-1 w-full md:w-[400px] z-30 rounded-xl p-4 grid grid-cols-2 gap-4"
              style={{ background: "white", border: "1px solid #e5e7eb", boxShadow: "0 10px 30px rgba(0,0,0,0.08)", color: "#1a1a1a" }}
            >
              <div>
                <div className="text-xs font-bold mb-2">Select Style</div>
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { props.setStyle(s.id); }}
                    className="w-full text-left flex items-center gap-2 py-1.5 text-xs"
                  >
                    <span className="w-3 h-3 rounded-full" style={{
                      border: "2px solid #1a1a1a",
                      background: props.style === s.id ? "#1a1a1a" : "transparent",
                    }} />
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
              <div>
                <div className="text-xs font-bold mb-2">Select Tone</div>
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { props.setTone(t.id); }}
                    className="w-full text-left flex items-center gap-2 py-1.5 text-xs"
                  >
                    <span className="w-3 h-3 rounded-full" style={{
                      border: "2px solid #1a1a1a",
                      background: props.tone === t.id ? "#1a1a1a" : "transparent",
                    }} />
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Language */}
        <SelectBtn
          value={`${langObj.tag}  ${langObj.label}`}
          options={LANGUAGES.map((l) => ({ id: l.id, label: `${l.tag}  ${l.label}` }))}
          onChange={(id) => props.setLanguage(id as Language)}
          activeId={props.language}
        />

        {/* Aspect */}
        <SelectBtn
          value={aspectObj.label}
          options={ASPECTS.map((a) => ({ id: a.id, label: a.label }))}
          onChange={(id) => props.setAspect(id as Aspect)}
          activeId={props.aspect}
        />
      </div>

      {/* Visual style picker — moved here from the old standalone Step 2.
          Compact 3×2 grid of square swatches with the style label.
          User clicks one to set visualStyle which drives the AI image
          prompt prefix during generation. */}
      <div className="mt-5">
        <div className="text-xs font-bold mb-2 text-gray-700">Visual Style</div>
        <div className="grid grid-cols-4 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {VISUAL_STYLES.map((v) => {
            const active = v.id === props.visualStyle;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => props.setVisualStyle(v.id)}
                className="relative aspect-square rounded-xl overflow-hidden text-left transition-transform hover:scale-[1.02]"
                style={{
                  background: v.gradient,
                  border: active ? "3px solid #8b5cf6" : "1px solid #e5e7eb",
                  boxShadow: active ? "0 4px 14px rgba(139,92,246,0.3)" : "none",
                }}
              >
                <img
                  src={v.sample}
                  alt={v.label}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background: "linear-gradient(180deg, transparent 45%, rgba(0,0,0,0.7) 100%)",
                  }}
                />
                <div className="absolute bottom-1.5 left-2 text-[11px] font-extrabold text-white drop-shadow-lg">
                  {v.label}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Voice picker — moved here from Step 2 so the user picks the voice
          BEFORE the script + audio cache get generated. Each card has a
          play button that previews ~6 seconds of fixed sample text;
          samples are cached on B2 by voice_id so repeat plays are free. */}
      <div className="mt-5">
        <div className="text-xs font-bold mb-2 text-gray-700">Voice</div>
        <VoicePickerList
          language={props.language}
          voiceId={props.voiceId}
          setVoiceId={props.setVoiceId}
          voiceSpeed={props.voiceSpeed}
        />
      </div>

      {/* Call-to-Action — three modes:
          • None        → AI lands the story at its natural emotional close
          • Engagement  → AI ends with a topic-relevant comment-bait question
          • Follow      → AI appends the user-typed follow CTA verbatim
          Default is Engagement because comment-bait endings drive the
          highest reach on TikTok / IG short-form. */}
      <div
        className="mt-5 rounded-2xl p-4"
        style={{
          background: "linear-gradient(135deg, #eff6ff 0%, #faf5ff 100%)",
          border: "1px solid #bfdbfe",
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🎯</span>
          <div>
            <div className="text-sm font-bold text-gray-800">
              Call-to-Action (final slide)
            </div>
            <div className="text-[11px] text-gray-600">
              How should the AI close the last slide?
            </div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {([
            { id: "none",       icon: "🌊", label: "None",       sub: "Natural close" },
            { id: "engagement", icon: "💬", label: "Engagement", sub: "Bait comments" },
            { id: "follow",     icon: "👥", label: "Follow",     sub: "Custom text" },
          ] as const).map((m) => {
            const active = props.ctaMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => props.setCtaMode(m.id)}
                className="relative rounded-xl p-3 text-left transition-all"
                style={{
                  background: active ? "#3b82f6" : "white",
                  border: active ? "2px solid #3b82f6" : "1px solid #e5e7eb",
                  color: active ? "white" : "#1f2937",
                  boxShadow: active ? "0 4px 12px rgba(59,130,246,0.3)" : "none",
                }}
              >
                <div className="text-lg mb-0.5">{m.icon}</div>
                <div className="text-[12px] font-bold">{m.label}</div>
                <div
                  className="text-[10px] mt-0.5"
                  style={{ color: active ? "rgba(255,255,255,0.85)" : "#6b7280" }}
                >
                  {m.sub}
                </div>
                {active && (
                  <div
                    className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                    style={{ background: "white", color: "#3b82f6", fontSize: 10, fontWeight: 800 }}
                  >
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {props.ctaMode === "follow" && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">
                Your follow CTA (max 12 words)
              </span>
              <span
                className="text-[10px] font-mono"
                style={{ color: ctaWordCount > 12 ? "#dc2626" : "#6b7280" }}
              >
                {ctaWordCount} / 12
              </span>
            </div>
            <input
              value={props.ctaText}
              onChange={(e) => {
                const next = e.target.value;
                const words = next.trim().split(/\s+/).filter(Boolean);
                if (words.length <= 12) props.setCtaText(next);
                else props.setCtaText(words.slice(0, 12).join(" "));
              }}
              placeholder="Kalau Berminat Dengan Content Begini, Jemput Follow"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{
                background: "white",
                border: "1px solid #bfdbfe",
                color: "#1a1a1a",
              }}
            />
          </div>
        )}
        {props.ctaMode === "engagement" && (
          <div
            className="mt-3 px-3 py-2 rounded-lg text-[11px]"
            style={{ background: "white", border: "1px solid #bfdbfe", color: "#475569" }}
          >
            AI will end the last slide with a topic-relevant question that
            invites viewers to comment with their answer or experience.
          </div>
        )}
      </div>

      {/* Slide pacing — seconds per slide + slide count + estimated total */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
        <SelectBtn
          value={secObj.label}
          options={SECONDS_PER_SLIDE.map((s) => ({ id: String(s.id), label: s.label }))}
          onChange={(id) => props.setSecondsPerSlide(Number(id))}
          activeId={String(props.secondsPerSlide)}
        />
        <SelectBtn
          value={countObj.label}
          options={SLIDE_COUNTS.map((s) => ({ id: String(s.id), label: s.label }))}
          onChange={(id) => props.setSceneCount(Number(id))}
          activeId={String(props.sceneCount)}
        />
      </div>
      <div
        className="mt-3 px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between"
        style={{ background: "#faf5ff", border: "1px solid #e9d5ff", color: "#6d28d9" }}
      >
        <span>Estimated video duration</span>
        <span className="font-mono">
          {props.secondsPerSlide}s × {props.sceneCount} = <strong>{fmtMmSs(estTotalSec)}</strong>
        </span>
      </div>
      <div
        className="mt-2 px-4 py-3 rounded-xl text-xs font-semibold"
        style={{ background: "#fff7ed", border: "1px solid #fed7aa", color: "#c2410c" }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span>Estimated cost (deducted on Generate)</span>
          <span className="font-mono text-sm">
            <strong>RM {estCost.toFixed(2)}</strong>
          </span>
        </div>
        <div className="flex flex-col gap-0.5 text-[11px] font-mono opacity-90">
          <div className="flex items-center justify-between">
            <span>
              <span className="opacity-70">RM {props.pricing.per_image.toFixed(2)} × </span>
              {props.sceneCount} images
            </span>
            <span>RM {(props.pricing.per_image * props.sceneCount).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>
              <span className="opacity-70">RM {props.pricing.per_audio_sec.toFixed(2)} × </span>
              {props.secondsPerSlide * props.sceneCount} seconds audio
              <span className="opacity-70"> ({props.secondsPerSlide}s × {props.sceneCount})</span>
            </span>
            <span>
              RM {(props.pricing.per_audio_sec * props.secondsPerSlide * props.sceneCount).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-8">
        {/* Preview is the ONLY exit from Step 1 now — user must preview
            their scenes before continuing. The Next button lives inside
            the modal so they actually look at what they're committing
            to. Cleaner funnel: prompt → preview → confirm → generate. */}
        <button
          onClick={props.onPreview}
          disabled={!props.prompt.trim()}
          className="px-7 py-3 rounded-xl font-bold text-sm text-white inline-flex items-center gap-2 disabled:opacity-40"
          style={{
            background: "linear-gradient(135deg, #c084fc 0%, #818cf8 100%)",
            boxShadow: "0 6px 16px rgba(168,85,247,0.35)",
          }}
        >
          <Wand2 className="w-4 h-4" /> Preview & Continue
        </button>
      </div>
    </div>
  );
}

function SelectBtn({
  value, options, onChange, activeId,
}: {
  value: string;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
  activeId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-between"
        style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a" }}
      >
        <span>{value}</span>
        <ChevronDown className="w-4 h-4 text-gray-400" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-full z-30 rounded-xl py-1"
          style={{ background: "white", border: "1px solid #e5e7eb", boxShadow: "0 10px 30px rgba(0,0,0,0.08)", color: "#1a1a1a" }}
        >
          {options.map((o) => (
            <button
              key={o.id}
              onClick={() => { onChange(o.id); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50"
            >
              {o.label}
              {activeId === o.id && <Check className="w-4 h-4 text-purple-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// STEP 2 — Visual Style
// ──────────────────────────────────────────────────────────────────────────

function Step2({
  visualStyle, setVisualStyle, onBack, onNext,
}: {
  visualStyle: VisualStyle;
  setVisualStyle: (v: VisualStyle) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center text-sm font-bold mb-5">Select Visual Style</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {VISUAL_STYLES.map((v) => {
          const active = visualStyle === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setVisualStyle(v.id)}
              className="relative aspect-video rounded-2xl overflow-hidden text-left transition-all hover:scale-[1.02]"
              style={{
                background: v.gradient,
                outline: active ? `3px solid ${PURPLE}` : "none",
                outlineOffset: active ? 2 : 0,
              }}
            >
              <img
                src={v.sample}
                alt={v.label}
                loading="lazy"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div
                className="absolute inset-0"
                style={{ background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.7) 100%)" }}
              />
              <div className="absolute bottom-3 left-4 text-white font-extrabold text-base drop-shadow-lg">
                {v.label}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-between mt-8">
        <button
          onClick={onBack}
          className="px-6 py-2.5 rounded-xl font-bold text-sm inline-flex items-center gap-2"
          style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a" }}
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2.5 rounded-xl font-bold text-sm text-white inline-flex items-center gap-2"
          style={{
            background: "linear-gradient(135deg, #c084fc 0%, #818cf8 100%)",
            boxShadow: "0 4px 12px rgba(168,85,247,0.3)",
          }}
        >
          Next <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// STEP 3 — Review & Generate (the big one)
// ──────────────────────────────────────────────────────────────────────────

function Step3(props: any) {
  const {
    scenes, setScenes,
    scriptLoading, scriptError,
    configTab, setConfigTab,
    language,
    enableVoice, setEnableVoice,
    voiceId, setVoiceId,
    voiceSpeed, setVoiceSpeed,
    transition, setTransition,
    sceneAnimation, setSceneAnimation,
    enableText, setEnableText,
    textAnimation, setTextAnimation,
    textPlacement, setTextPlacement,
    fontType, setFontType,
    textSize, setTextSize,
    textColor, setTextColor,
    uppercase, setUppercase,
    textBackground, setTextBackground,
    previewIdx, setPreviewIdx,
    audioCache, audioCacheStatus,
    previewMuted, setPreviewMuted,
    renderStatus, renderError,
    onBack, onSubmit, onRetryScript,
  } = props;

  const allDone = scenes.length > 0 && scenes.every((s: Scene) => s.imageStatus === "done");
  const inProgress = scenes.length > 0 && scenes.some((s: Scene) => s.imageStatus === "generating" || s.imageStatus === "queued");

  // Loading overlay during script generation — matches the reference layout:
  // big title, subtitle, real progress bar with "X/N scenes" counter and
  // percentage, then a separate light-grey card with doc icon + "Writing
  // scene N…" + "Crafting compelling narration".
  if (scriptLoading) {
    return (
      <ScriptLoadingModal totalScenes={10} />
    );
  }

  if (scriptError) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid #fecaca" }}>
          <div className="font-bold text-sm text-red-600 mb-2">Script generation failed</div>
          <p className="text-xs text-gray-600 mb-4">{scriptError}</p>
          <button
            onClick={onRetryScript}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white"
            style={{ background: PURPLE }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 max-w-6xl mx-auto">
      {/* LEFT COLUMN — config + scenes */}
      <div className="space-y-4">
        {/* Video Configuration */}
        <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #e5e7eb" }}>
          <div className="font-bold text-sm mb-3" style={{ color: "#1a1a1a" }}>Video Configuration</div>
          {/* Tabs — Voice tab restored: it controls whether narration
              audio is generated at all. The voice picker itself lives
              in Step 1 (so user picks BEFORE TTS cache fires); this
              tab is just the master enable/disable. */}
          <div className="flex gap-1 p-1 rounded-xl bg-gray-100 mb-4">
            {(["voice", "animation", "font"] as ConfigTab[]).map((t) => {
              const active = configTab === t;
              return (
                <button
                  key={t}
                  onClick={() => setConfigTab(t)}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5"
                  style={
                    active
                      ? { background: "white", boxShadow: "0 2px 6px rgba(0,0,0,0.05)", color: "#1a1a1a" }
                      : { background: "transparent", color: "#6b7280" }
                  }
                >
                  {t === "voice" && <Volume2 className="w-3.5 h-3.5" />}
                  {t === "animation" && <VideoIcon className="w-3.5 h-3.5" />}
                  {t === "font" && <Type className="w-3.5 h-3.5" />}
                  {t === "voice" ? "Voice" : t === "animation" ? "Animation" : "Font"}
                </button>
              );
            })}
          </div>

          {configTab === "voice" && (
            <div className="space-y-3">
              <Toggle
                label="Enable Voice"
                premium
                sub="Add AI narration to each scene (voice + speed configured in Step 1)"
                value={enableVoice}
                onChange={setEnableVoice}
              />
              {!enableVoice && (
                <div
                  className="rounded-lg p-3 text-[11px]"
                  style={{ background: "#fef3c7", border: "1px solid #fde68a", color: "#92400e" }}
                >
                  Voice is OFF — the final video will have NO narration, just
                  Ken Burns motion + scene transitions over your images.
                </div>
              )}
            </div>
          )}
          {configTab === "animation" && (
            <AnimationConfig
              transition={transition} setTransition={setTransition}
              sceneAnimation={sceneAnimation} setSceneAnimation={setSceneAnimation}
            />
          )}
          {configTab === "font" && (
            <FontConfig
              enableText={enableText} setEnableText={setEnableText}
              textAnimation={textAnimation} setTextAnimation={setTextAnimation}
              textPlacement={textPlacement} setTextPlacement={setTextPlacement}
              fontType={fontType} setFontType={setFontType}
              textSize={textSize} setTextSize={setTextSize}
              textColor={textColor} setTextColor={setTextColor}
              uppercase={uppercase} setUppercase={setUppercase}
              textBackground={textBackground} setTextBackground={setTextBackground}
            />
          )}
        </div>

        {/* Video Scenes */}
        <div className="rounded-2xl p-5" style={{ background: "white", border: "1px solid #e5e7eb" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="font-bold text-sm">Video Scene</div>
            <div className="flex items-center gap-2">
              {inProgress && (
                <div className="text-xs text-gray-500 inline-flex items-center gap-1.5">
                  <RotateCw className="w-3 h-3 animate-spin" /> Generating…
                </div>
              )}
              {/* Batch "Regenerate All" was removed — per-scene Regenerate
                  buttons inside each SceneRow handle this now (and only
                  charge for the scenes that get re-fired). */}
            </div>
          </div>

          <div className="space-y-3">
            {scenes.map((s: Scene, idx: number) => (
              <SceneRow
                key={s.idx}
                scene={s}
                onChange={(narration) => setScenes((prev: Scene[]) =>
                  prev.map((x) => x.idx === s.idx ? { ...x, narration } : x)
                )}
                onPreviewMe={() => setPreviewIdx(idx)}
                isActive={previewIdx === idx}
              />
            ))}
          </div>
        </div>

        {/* Bottom nav */}
        <div className="flex justify-between gap-3 pt-2">
          <button
            onClick={onBack}
            className="px-6 py-2.5 rounded-xl font-bold text-sm inline-flex items-center gap-2"
            style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a" }}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button
            onClick={onSubmit}
            disabled={!allDone || renderStatus === "submitting"}
            className="flex-1 max-w-sm px-6 py-2.5 rounded-xl font-bold text-sm text-white inline-flex items-center justify-center gap-2 disabled:opacity-50"
            style={{
              background: "linear-gradient(135deg, #c084fc 0%, #818cf8 100%)",
              boxShadow: "0 4px 12px rgba(168,85,247,0.3)",
            }}
          >
            {renderStatus === "submitting" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Merging scenes…</>
            ) : renderStatus === "done" ? (
              <><Check className="w-4 h-4" /> Merged — see Storytelling history below</>
            ) : (
              <><Sparkles className="w-4 h-4" /> Merge All Scenes → 1 Video</>
            )}
          </button>
        </div>
        {renderError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {renderError}
          </div>
        )}
        {!allDone && scenes.length > 0 && (
          <p className="text-[11px] text-gray-500 text-center">
            Merge button unlocks once all scene images finish loading.
          </p>
        )}
        {allDone && renderStatus === "idle" && (
          <p className="text-[11px] text-gray-500 text-center">
            All {scenes.length} scenes ready. Click Merge to combine them into one MP4 (audio + karaoke text + Ken Burns motion). Render takes ~{Math.ceil(scenes.length * 6)}s.
          </p>
        )}
      </div>

      {/* RIGHT COLUMN — sticky preview */}
      <div className="lg:sticky lg:top-4 lg:self-start space-y-3">
        <div className="rounded-2xl p-4" style={{ background: "white", border: "1px solid #e5e7eb" }}>
          <div className="text-xs font-bold mb-2">Preview ⓘ</div>
          <PreviewPanel
            scenes={scenes}
            sceneCount={scenes.length}
            previewIdx={previewIdx}
            setPreviewIdx={setPreviewIdx}
            voiceEnabled={enableVoice}
            voiceSpeed={voiceSpeed}
            audioCache={audioCache}
            audioCacheStatus={audioCacheStatus}
            previewMuted={previewMuted}
            setPreviewMuted={setPreviewMuted}
            transition={transition}
            sceneAnimation={sceneAnimation}
            textAnimation={textAnimation}
            textPlacement={textPlacement}
            fontType={fontType}
            textSize={textSize}
            textColor={textColor}
            uppercase={uppercase}
            textBackground={textBackground}
            enableText={enableText}
          />
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// STEP 3 sub-components
// ──────────────────────────────────────────────────────────────────────────

function SceneRow({
  scene, onChange, onPreviewMe, isActive,
}: {
  scene: Scene;
  onChange: (v: string) => void;
  onPreviewMe: () => void;
  isActive: boolean;
}) {
  const wc = wordCount(scene.narration);
  return (
    <div
      onClick={onPreviewMe}
      className="rounded-xl p-3 grid grid-cols-[110px_1fr] gap-3 cursor-pointer transition-all"
      style={{
        background: isActive ? PURPLE_SOFT : "#fafafa",
        border: isActive ? `1px solid ${PURPLE}` : "1px solid #e5e7eb",
      }}
    >
      <div
        className="aspect-[9/16] rounded-lg overflow-hidden flex items-center justify-center"
        style={{ background: "#f3f4f6" }}
      >
        {scene.imageStatus === "done" && scene.imageUrl ? (
          <img src={scene.imageUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : scene.imageStatus === "failed" ? (
          <div className="text-center text-[10px] text-red-500 px-2">
            <X className="w-4 h-4 mx-auto mb-1" />
            Failed
          </div>
        ) : (
          <div className="flex flex-col items-center text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mb-1" />
            <span className="text-[9px]">Generating…</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
            style={{ background: PURPLE, color: "white" }}
          >
            Scene {scene.idx + 1}
          </span>
          <span className="text-[10px] text-gray-500 font-mono">{wc}/30 words</span>
        </div>
        <textarea
          value={scene.narration}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="w-full px-2.5 py-1.5 rounded-md text-xs resize-none outline-none flex-1"
          style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a", lineHeight: 1.4 }}
        />
        <div className="flex gap-1.5">
          <button className="px-2 py-1 rounded text-[10px] font-bold inline-flex items-center gap-1" style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
            <Upload className="w-2.5 h-2.5" /> Upload
          </button>
          <button className="px-2 py-1 rounded text-[10px] font-bold inline-flex items-center gap-1" style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
            <RotateCw className="w-2.5 h-2.5" /> Regenerate
          </button>
          <button className="px-2 py-1 rounded text-[10px] font-bold inline-flex items-center gap-1" style={{ background: "white", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
            <VideoIcon className="w-2.5 h-2.5" /> Motion
          </button>
        </div>
      </div>
    </div>
  );
}

function VoiceConfig({
  enableVoice, setEnableVoice, voiceId, setVoiceId, voiceSpeed, setVoiceSpeed,
  language,
}: {
  enableVoice: boolean; setEnableVoice: (v: boolean) => void;
  voiceId: string; setVoiceId: (v: string) => void;
  voiceSpeed: number; setVoiceSpeed: (v: number) => void;
  language: VoiceLang;
}) {
  // Voice Speed slider removed — locked to 1.0x ("normal") for now so the
  // narration always reads at the AI's intended pacing. The slider used to
  // be wired through to the MiniMax `speed` param but the user prefers a
  // single normal-speed default for v1.
  const options = voicesForLang(language);
  return (
    <div className="space-y-3">
      <Toggle label="Enable Voice" premium sub="Add AI narration to each scene" value={enableVoice} onChange={setEnableVoice} />
      {enableVoice && (
        <Field label="Voice">
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="w-full p-2.5 rounded-lg text-xs outline-none" style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
            {options.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </Field>
      )}
    </div>
  );
}

function AnimationConfig({
  transition, setTransition, sceneAnimation, setSceneAnimation,
}: {
  transition: string; setTransition: (v: string) => void;
  sceneAnimation: string; setSceneAnimation: (v: string) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Scene Transition ⓘ">
        <select value={transition} onChange={(e) => setTransition(e.target.value)} className="w-full p-2.5 rounded-lg text-xs outline-none" style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
          {TRANSITIONS.map((t) => <option key={t} value={t}>{t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
        </select>
      </Field>
      <Field label="Scene Animation ⓘ">
        <select value={sceneAnimation} onChange={(e) => setSceneAnimation(e.target.value)} className="w-full p-2.5 rounded-lg text-xs outline-none" style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
          {SCENE_ANIMS.map((a) => <option key={a} value={a}>{a.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
        </select>
      </Field>
    </div>
  );
}

function FontConfig(props: any) {
  return (
    <div className="space-y-3">
      <Toggle label="Enable Text" sub="Include text overlay on video" value={props.enableText} onChange={props.setEnableText} />
      {props.enableText && (
        <>
          <Field label="Text Animation">
            <select value={props.textAnimation} onChange={(e) => props.setTextAnimation(e.target.value)} className="w-full p-2.5 rounded-lg text-xs outline-none" style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
              {TEXT_ANIMS.map((a) => <option key={a} value={a}>{a.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</option>)}
            </select>
          </Field>
          <Field label="Text Placement">
            <select value={props.textPlacement} onChange={(e) => props.setTextPlacement(e.target.value)} className="w-full p-2.5 rounded-lg text-xs outline-none" style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
              {TEXT_PLACEMENTS.map((p) => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
          </Field>
          <Field label="Font Type">
            <select value={props.fontType} onChange={(e) => props.setFontType(e.target.value)} className="w-full p-2.5 rounded-lg text-xs outline-none" style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
              {FONT_TYPES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Text Size">
            <div className="grid grid-cols-4 gap-1.5">
              {TEXT_SIZES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => props.setTextSize(s.id)}
                  className="py-2 rounded-lg flex flex-col items-center"
                  style={{
                    background: props.textSize === s.id ? "#fafafa" : "white",
                    border: props.textSize === s.id ? `1.5px solid #1a1a1a` : "1px solid #e5e7eb",
                  }}
                >
                  <span className="font-bold text-sm">{s.id}</span>
                  <span className="text-[9px] text-gray-500">{s.label}</span>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Text Color">
            <div className="flex gap-2">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => props.setTextColor(c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    border: c === "#ffffff" ? "1px solid #e5e7eb" : "none",
                    outline: props.textColor === c ? `2px solid ${PURPLE}` : "none",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </Field>
          <Toggle label="Uppercase all text" value={props.uppercase} onChange={props.setUppercase} />
          <Toggle label="Text Background" value={props.textBackground} onChange={props.setTextBackground} />
        </>
      )}
    </div>
  );
}

// Map ffmpeg/Modal animation names → CSS animation names declared below
const SCENE_CSS_ANIM: Record<string, string> = {
  "zoom-in":            "ftKenBurnsZoomIn",
  "zoom-out":           "ftKenBurnsZoomOut",
  "pan-right":          "ftKenBurnsPanRight",
  "pan-left":           "ftKenBurnsPanLeft",
  "pan-down":           "ftKenBurnsPanDown",
  "zoom-pan":           "ftKenBurnsZoomPan",
  "slide-reveal-left":  "ftSlideRevealLeft",
  "fade-in":            "ftFadeInZoom",
  "scale-pulse":        "ftScalePulse",
  "color-shift":        "ftColorShift",
  "none":               "",
};

const TRANSITION_CSS: Record<string, string> = {
  "fade":         "ftFade",
  "slide-left":   "ftSlideLeft",
  "wipe-left":    "ftWipeLeft",
  "circle-open":  "ftCircleOpen",
  "dissolve":     "ftDissolve",
  "radial":       "ftRadial",
};

// Each scene is rendered for ~10 seconds (matches Modal render). Use 10s
// in the live preview so the karaoke pacing + auto-cycle match what the
// final mp4 will play.
const SCENE_DURATION_MS = 10_000;

// Animated loading card shown while the AI is generating the 10-scene
// script. Fakes a smooth progress bar that reaches ~95% over 14s and
// holds there until the actual API call completes (then component
// unmounts because scriptLoading flips to false). Cycles the
// "Writing scene N…" label in step with the progress.
function ScriptLoadingModal({ totalScenes = 10 }: { totalScenes?: number }) {
  const [pct, setPct] = useState(0);
  const [sceneNum, setSceneNum] = useState(1);
  useEffect(() => {
    const start = Date.now();
    const total_ms = 14_000;
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      // Ease-out curve so progress moves quickly at first then slows
      const linear = Math.min(1, elapsed / total_ms);
      const eased = 1 - Math.pow(1 - linear, 2);
      const next = Math.min(95, Math.round(eased * 100));
      setPct(next);
      const scene = Math.min(totalScenes, Math.max(1, Math.ceil((next / 95) * totalScenes)));
      setSceneNum(scene);
    }, 200);
    return () => clearInterval(id);
  }, [totalScenes]);

  return (
    <div className="max-w-md mx-auto py-12">
      <div
        className="rounded-2xl p-6"
        style={{
          background: "white",
          boxShadow: "0 12px 40px rgba(0,0,0,0.10)",
          border: "1px solid #e5e7eb",
        }}
      >
        <div className="flex items-start gap-3 mb-1">
          <Loader2 className="w-5 h-5 text-gray-700 animate-spin mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-display font-extrabold text-base text-[#1a1a1a]">
              Creating Video Script
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              AI is writing engaging captions for each scene in your video
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold text-gray-700">Progress</span>
            <span className="text-[11px] text-gray-500 font-mono">
              {sceneNum}/{totalScenes} scenes
            </span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "#f3f4f6" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: "#1a1a1a",
                transition: "width 0.2s linear",
              }}
            />
          </div>
          <div className="text-[10px] text-gray-400 text-right mt-1 font-mono">{pct}%</div>
        </div>

        <div
          className="mt-4 flex items-center gap-3 rounded-xl p-3"
          style={{ background: "#f8fafc", border: "1px solid #e5e7eb" }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "#e5e7eb" }}
          >
            <Type className="w-4 h-4 text-gray-700" />
          </div>
          <div>
            <div className="text-xs font-bold text-[#1a1a1a]">Writing scene {sceneNum}…</div>
            <div className="text-[10px] text-gray-500 mt-0.5">Crafting compelling narration</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewPanel(props: any) {
  const { scenes, sceneCount, previewIdx, voiceEnabled, transition, sceneAnimation,
    textAnimation, textPlacement, fontType, textSize, textColor, uppercase, textBackground, enableText,
    audioCache, audioCacheStatus, previewMuted, setPreviewMuted, voiceSpeed } = props;
  const sizePx = TEXT_SIZES.find((s: any) => s.id === textSize)?.px ?? 36;

  // The actual <audio> element we control — one per panel, src swaps as
  // previewIdx changes. We use the audio's natural duration to time the
  // auto-cycle (instead of a fixed 10s) so subtitles + Ken Burns animation
  // line up with the real narration length.
  //
  // Speed handling: the cached MP3 is always at 1.0x natural speed. We
  // apply user-selected speed via element.playbackRate so we don't waste
  // a TTS regen call when they change the slider. Effective duration =
  // naturalDuration / playbackRate.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioDurationMs, setAudioDurationMs] = useState<number>(SCENE_DURATION_MS);
  const playbackRate = Math.max(0.5, Math.min(2.0, Number(voiceSpeed) || 1.0));
  const effectiveAudioMs = Math.round(audioDurationMs / playbackRate);

  const sceneAudioUrl: string | undefined =
    voiceEnabled && audioCache ? audioCache[previewIdx] : undefined;

  // When previewIdx changes, swap audio src + autoplay (if not muted).
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (!sceneAudioUrl) {
      el.pause();
      el.removeAttribute("src");
      return;
    }
    el.src = sceneAudioUrl;
    el.muted = !!previewMuted;
    el.playbackRate = playbackRate;
    // Browsers block autoplay until user gesture; ignore promise rejection.
    el.play().catch(() => {});
  }, [sceneAudioUrl, previewIdx, previewMuted, playbackRate]);

  // Re-apply playbackRate live if the slider moves while audio is playing.
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = playbackRate;
  }, [playbackRate]);

  function handleAudioMeta() {
    const el = audioRef.current;
    if (!el || !isFinite(el.duration) || el.duration <= 0) return;
    setAudioDurationMs(Math.round(el.duration * 1000));
  }

  // Auto-advance: prefer audio.ended event when audio is loaded, else fall
  // back to a setInterval at SCENE_DURATION_MS (silent fallback for when
  // voice is disabled or the cache isn't ready yet).
  //
  // GATING: don't start the auto-cycle until Scene 1's image is actually
  // ready. Otherwise the preview spins through empty placeholders and the
  // user can't tell anything is happening. Once the cycle starts, we ALSO
  // skip any scene that doesn't have an imageUrl yet — so the preview
  // never lands on a black/spinner slide. If no other ready scene exists,
  // the cycle pauses on the current one and resumes when a new image
  // lands (effect re-runs on scenes change).
  const scene1Ready = !!scenes?.[0]?.imageUrl;
  // Find the next ready scene after `from`, wrapping. Returns -1 if no
  // other scene has an image (caller should NOT advance in that case).
  const findNextReadyIdx = (from: number) => {
    if (!scenes || scenes.length <= 1) return -1;
    for (let step = 1; step <= scenes.length; step++) {
      const cand = (from + step) % scenes.length;
      if (scenes[cand]?.imageUrl) return cand;
    }
    return -1;
  };
  useEffect(() => {
    if (!scenes || sceneCount <= 1) return;
    if (!scene1Ready) return;
    const advance = () => {
      props.setPreviewIdx((p: number) => {
        const next = findNextReadyIdx(p);
        return next === -1 ? p : next;
      });
    };
    if (sceneAudioUrl && audioRef.current) {
      const el = audioRef.current;
      // CATCH-UP: if audio already ENDED before this effect attached
      // (happens when a new image lands AFTER audio finished — effect
      // re-runs due to imageUrl-deps change but the `ended` event won't
      // fire again), advance immediately so we don't get stuck.
      if (
        el.paused &&
        el.duration > 0 &&
        Math.abs(el.currentTime - el.duration) < 0.25
      ) {
        // queue a microtask so we don't run setState during render
        Promise.resolve().then(advance);
      }
      el.addEventListener("ended", advance);
      // Watchdog: even if `ended` doesn't fire (autoplay blocked, audio
      // never played), tick every SCENE_DURATION_MS to advance through
      // the slideshow. Without this the preview gets stuck on slide 1.
      const watchdog = setInterval(advance, SCENE_DURATION_MS);
      return () => {
        el.removeEventListener("ended", advance);
        clearInterval(watchdog);
      };
    }
    const id = setInterval(advance, SCENE_DURATION_MS);
    return () => clearInterval(id);
    // scenes is in deps so when a new image lands the effect re-runs
    // and the next-ready lookup picks it up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneCount, sceneAudioUrl, scene1Ready, scenes.map((s: any) => s.imageUrl).join("|")]);

  const scene = scenes?.[previewIdx] || null;

  const fullText = scene?.narration ? (uppercase ? scene.narration.toUpperCase() : scene.narration) : "Preview text";
  const words = useMemo(() => fullText.split(/\s+/).filter(Boolean), [fullText]);
  // Subtitle pacing tracks the audio's effective length (after playbackRate)
  // so karaoke / highlight stays in sync as the user changes speed.
  const sceneDurationMs = sceneAudioUrl ? effectiveAudioMs : SCENE_DURATION_MS;

  // Karaoke / progressive reveal — paced to audio so subtitle never runs
  // ahead of the voice. Strategy:
  //   1) Wait for the audio's `playing` event (more reliable than `play`
  //      — fires when actual sample data starts coming out of the
  //      speakers, not when .play() is *requested*).
  //   2) If the event hasn't fired within 1.2s (autoplay blocked, slow
  //      buffer, browser deferred decode), START ANYWAY using the
  //      scene-duration timer. Better to have subtitles slightly out of
  //      sync than to leave them stuck on the cursor "|" forever.
  //   3) On voice-disabled / no audio cache, just start immediately.
  const [revealedCount, setRevealedCount] = useState(words.length);
  useEffect(() => {
    if (!enableText) return;
    if (textAnimation === "none" || textAnimation === "highlight") {
      setRevealedCount(words.length);
      return;
    }
    setRevealedCount(0);
    if (words.length === 0) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    let fallbackId: ReturnType<typeof setTimeout> | null = null;
    let started = false;
    const startReveal = () => {
      if (started) return;
      started = true;
      if (fallbackId) { clearTimeout(fallbackId); fallbackId = null; }
      const perWord = sceneDurationMs / Math.max(1, words.length);
      let i = 0;
      intervalId = setInterval(() => {
        i += 1;
        setRevealedCount(i);
        if (i >= words.length && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }, perWord);
    };

    const el = audioRef.current;
    if (sceneAudioUrl && el) {
      // If audio is already producing sound, start now.
      if (!el.paused && el.currentTime > 0 && el.readyState >= 3) {
        startReveal();
      } else {
        const onPlaying = () => startReveal();
        el.addEventListener("playing", onPlaying, { once: true });
        // Fallback: if `playing` doesn't fire within 1.2s, start anyway
        // so the subtitle isn't held hostage by autoplay-blocked audio.
        fallbackId = setTimeout(startReveal, 1200);
        return () => {
          el.removeEventListener("playing", onPlaying);
          if (fallbackId) clearTimeout(fallbackId);
          if (intervalId) clearInterval(intervalId);
        };
      }
    } else {
      startReveal();
    }
    return () => {
      if (fallbackId) clearTimeout(fallbackId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [textAnimation, fullText, sceneDurationMs, enableText, words.length, scene?.idx, sceneAudioUrl]);

  // Highlight cursor for the "highlight" mode — one word at a time pulses
  const [highlightIdx, setHighlightIdx] = useState(0);
  useEffect(() => {
    if (textAnimation !== "highlight" || words.length === 0) return;
    setHighlightIdx(0);
    const perWord = sceneDurationMs / words.length;
    const id = setInterval(() => {
      setHighlightIdx((p) => (p + 1) % words.length);
    }, perWord);
    return () => clearInterval(id);
  }, [textAnimation, fullText, sceneDurationMs, words.length, scene?.idx]);

  // Cycle scene animation every render-cycle so the user sees it loop. We
  // bump a "cycle" key whenever sceneAnimation/scene changes so the CSS
  // animation restarts from frame 0 — that's how live preview demos feel
  // responsive when the user picks Pan Right vs Zoom In.
  const [animCycle, setAnimCycle] = useState(0);
  useEffect(() => {
    setAnimCycle((c) => c + 1);
    const id = setInterval(() => setAnimCycle((c) => c + 1), sceneDurationMs + 400);
    return () => clearInterval(id);
  }, [sceneAnimation, scene?.idx, sceneDurationMs]);

  const cssAnim = SCENE_CSS_ANIM[sceneAnimation] || "";
  const fontStack =
    fontType.includes("Serif") || fontType.includes("Times") ? "Georgia, 'Times New Roman', serif" :
    fontType.includes("Mono") ? "ui-monospace, SFMono-Regular, monospace" :
    fontType.includes("Carter") ? "Georgia, serif" :
    fontType === "Lato" || fontType === "Roboto" || fontType.includes("Modern") || fontType.includes("Montserrat") ? "system-ui, sans-serif" :
    "system-ui, sans-serif";

  const placementTop =
    textPlacement === "top" ? "10%" :
    textPlacement === "middle" ? "45%" :
    "75%";

  return (
    <div>
      <style>{previewKeyframes}</style>
      <div
        className="rounded-xl overflow-hidden relative mx-auto"
        style={{
          background: "#1a1a1a",
          // Cap the preview frame so it never pushes the chips below the
          // viewport. We aim for the largest 9:16 box that fits in:
          //   max-height = viewport - top sticky offset - chip block.
          // calc(100vh - 280px) leaves room for header + step indicator
          // + chips + bottom nav. Width derives from height to maintain
          // 9:16 (height * 9/16). Min width 220 so it doesn't collapse
          // on short viewports.
          aspectRatio: "9 / 16",
          maxHeight: "calc(100vh - 280px)",
          width: "min(100%, calc((100vh - 280px) * 9 / 16))",
          minHeight: 360,
        }}
      >
        {scene?.imageUrl ? (
          <div
            key={`img-${scene.idx}-${animCycle}`}
            className="absolute inset-0"
            style={{
              background: `url(${scene.imageUrl}) center/cover no-repeat`,
              animation: cssAnim
                ? `${cssAnim} ${sceneDurationMs}ms ease-in-out forwards`
                : "none",
              transformOrigin: "center center",
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-500 text-xs">
            {scene ? "Generating…" : "No scene"}
          </div>
        )}

        {/* Crossfade scrim that flashes whenever the scene changes — communicates "transition between scenes" */}
        <div
          key={`trans-${scene?.idx}-${transition}`}
          className="absolute inset-0 pointer-events-none"
          style={{
            animation: `${TRANSITION_CSS[transition] || "ftFade"} 700ms ease-in-out forwards`,
            background: "black",
            opacity: 0,
          }}
        />

        {/* Caption overlay — animates per textAnimation mode */}
        {enableText && scene && (
          <div
            className="absolute left-0 right-0 px-3 text-center"
            style={{
              top: placementTop,
              transition: "top 200ms ease",
            }}
          >
            <span
              style={{
                display: "inline-block",
                color: textColor,
                fontSize: Math.min(sizePx / 1.6, 28),
                fontFamily: fontStack,
                fontWeight: 800,
                background: textBackground ? "rgba(0,0,0,0.55)" : "transparent",
                padding: textBackground ? "3px 10px" : 0,
                borderRadius: textBackground ? 4 : 0,
                textShadow: !textBackground ? "1.5px 1.5px 3px rgba(0,0,0,0.85)" : "none",
                lineHeight: 1.25,
                maxWidth: "92%",
                wordWrap: "break-word",
                transition: "color 150ms ease, font-size 150ms ease",
              }}
            >
              {textAnimation === "karaoke" || textAnimation === "word-by-word" ? (
                <>
                  {words.slice(0, revealedCount).join(" ")}
                  {revealedCount < words.length && (
                    <span
                      key={`cursor-${revealedCount}`}
                      style={{
                        marginLeft: 4,
                        animation: "ftBlink 600ms steps(1) infinite",
                      }}
                    >|</span>
                  )}
                </>
              ) : textAnimation === "highlight" ? (
                <>
                  {words.map((w: string, i: number) => (
                    <span
                      key={i}
                      style={{
                        background: i === highlightIdx ? `${textColor}33` : "transparent",
                        color: i === highlightIdx ? textColor : "white",
                        padding: "0 2px",
                        borderRadius: 3,
                        transition: "background 100ms ease, color 100ms ease",
                      }}
                    >
                      {w}{i < words.length - 1 ? " " : ""}
                    </span>
                  ))}
                </>
              ) : (
                fullText
              )}
            </span>
          </div>
        )}

        {/* Voice badge — click to mute/unmute the live narration */}
        {voiceEnabled && (
          <button
            onClick={() => setPreviewMuted?.(!previewMuted)}
            title={
              audioCacheStatus === "loading" ? "Generating narration audio…"
              : audioCacheStatus === "failed" ? "Audio unavailable"
              : previewMuted ? "Click to unmute" : "Click to mute"
            }
            className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] text-white inline-flex items-center gap-1 hover:scale-105 transition-transform"
            style={{ background: "rgba(0,0,0,0.55)" }}
          >
            <span
              style={{
                animation: audioCacheStatus === "ready" && !previewMuted
                  ? "ftPulse 1s ease-in-out infinite"
                  : undefined,
                opacity: audioCacheStatus === "ready" ? 1 : 0.6,
              }}
            >
              {previewMuted ? "🔇" : "🔊"}
            </span>
            {audioCacheStatus === "loading"
              ? "Loading…"
              : audioCacheStatus === "failed"
                ? "Audio off"
                : previewMuted
                  ? "Muted"
                  : "Audio"}
          </button>
        )}
        {/* Hidden audio element — drives auto-cycle timing when ready. */}
        <audio
          ref={audioRef}
          onLoadedMetadata={handleAudioMeta}
          preload="metadata"
          style={{ display: "none" }}
        />

        {/* Prev / Next scene arrows — let user step through scenes in preview */}
        {sceneCount > 1 && (
          <>
            <button
              onClick={() => props.setPreviewIdx(Math.max(0, previewIdx - 1))}
              disabled={previewIdx === 0}
              aria-label="Previous scene"
              className="absolute top-1/2 -translate-y-1/2 left-2 w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-30 transition-opacity"
              style={{ background: "rgba(0,0,0,0.55)", color: "white" }}
            >‹</button>
            <button
              onClick={() => props.setPreviewIdx(Math.min(sceneCount - 1, previewIdx + 1))}
              disabled={previewIdx >= sceneCount - 1}
              aria-label="Next scene"
              className="absolute top-1/2 -translate-y-1/2 right-2 w-7 h-7 rounded-full flex items-center justify-center disabled:opacity-30 transition-opacity"
              style={{ background: "rgba(0,0,0,0.55)", color: "white" }}
            >›</button>
          </>
        )}

        <div
          className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-[10px] text-white"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          {Math.min(previewIdx + 1, sceneCount)} / {sceneCount}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
        <Chip>Voice: {voiceEnabled ? "On" : "Disabled"}</Chip>
        <Chip>Transition: {transition.replace(/-/g, " ")}</Chip>
        <Chip>Animation: {sceneAnimation.replace(/-/g, " ")}</Chip>
        <Chip>Text Animation: {textAnimation.replace(/-/g, " ")}</Chip>
        <Chip>Font: {fontType}</Chip>
        <Chip>Size: {sizePx}px</Chip>
        <Chip>Placement: {textPlacement}</Chip>
        <Chip>
          <span className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle" style={{ background: textColor }} />
          Color
        </Chip>
      </div>
    </div>
  );
}

// Keyframes used by the live preview. Injected via a single <style> tag
// inside the preview so a tab without preview doesn't leak the rules.
// Names are prefixed `ft` to avoid colliding with anything else.
const previewKeyframes = `
@keyframes ftKenBurnsZoomIn {
  from { transform: scale(1.0); }
  to   { transform: scale(1.18); }
}
@keyframes ftKenBurnsZoomOut {
  from { transform: scale(1.18); }
  to   { transform: scale(1.0); }
}
@keyframes ftKenBurnsPanRight {
  from { transform: scale(1.15) translateX(-3%); }
  to   { transform: scale(1.15) translateX(3%); }
}
@keyframes ftKenBurnsPanLeft {
  from { transform: scale(1.15) translateX(3%); }
  to   { transform: scale(1.15) translateX(-3%); }
}
@keyframes ftKenBurnsPanDown {
  from { transform: scale(1.15) translateY(-3%); }
  to   { transform: scale(1.15) translateY(3%); }
}
@keyframes ftKenBurnsZoomPan {
  from { transform: scale(1.0) translateX(-2%); }
  to   { transform: scale(1.18) translateX(2%); }
}
@keyframes ftSlideRevealLeft {
  from { transform: translateX(8%) scale(1.05); opacity: 0.5; }
  to   { transform: translateX(0) scale(1.05); opacity: 1; }
}
@keyframes ftFadeInZoom {
  from { transform: scale(1.05); opacity: 0; }
  to   { transform: scale(1.10); opacity: 1; }
}
@keyframes ftScalePulse {
  0%   { transform: scale(1.05); }
  50%  { transform: scale(1.15); }
  100% { transform: scale(1.05); }
}
@keyframes ftColorShift {
  0%   { filter: hue-rotate(0deg) saturate(1); }
  50%  { filter: hue-rotate(20deg) saturate(1.3); }
  100% { filter: hue-rotate(0deg) saturate(1); }
}
@keyframes ftFade {
  0%   { opacity: 0.85; }
  40%  { opacity: 0.0; }
  100% { opacity: 0.0; }
}
@keyframes ftSlideLeft {
  0%   { transform: translateX(0); opacity: 0.85; }
  60%  { transform: translateX(-100%); opacity: 0; }
  100% { transform: translateX(-100%); opacity: 0; }
}
@keyframes ftWipeLeft {
  0%   { clip-path: inset(0 0 0 0); opacity: 0.6; }
  60%  { clip-path: inset(0 100% 0 0); opacity: 0; }
  100% { clip-path: inset(0 100% 0 0); opacity: 0; }
}
@keyframes ftCircleOpen {
  0%   { clip-path: circle(70% at 50% 50%); opacity: 0.8; }
  60%  { clip-path: circle(0% at 50% 50%); opacity: 0; }
  100% { clip-path: circle(0% at 50% 50%); opacity: 0; }
}
@keyframes ftDissolve {
  0%   { opacity: 0.9; backdrop-filter: blur(4px); }
  60%  { opacity: 0; backdrop-filter: blur(0px); }
  100% { opacity: 0; }
}
@keyframes ftRadial {
  0%   { background: radial-gradient(circle at 50% 50%, transparent 0%, black 100%); opacity: 0.85; }
  60%  { background: radial-gradient(circle at 50% 50%, transparent 80%, black 100%); opacity: 0; }
  100% { opacity: 0; }
}
@keyframes ftBlink {
  50% { opacity: 0; }
}
@keyframes ftPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}
`;

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-md text-gray-700" style={{ background: "#f3f4f6" }}>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold mb-1.5" style={{ color: "#1a1a1a" }}>{label}</div>
      {children}
    </div>
  );
}

function Toggle({
  label, sub, value, onChange, premium,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  premium?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div>
        <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: "#1a1a1a" }}>
          {label}
          {premium && (
            <span title="Premium feature" style={{ fontSize: 14 }}>👑</span>
          )}
        </div>
        {sub && <div className="text-[10px] mt-0.5" style={{ color: "#6b7280" }}>{sub}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className="w-9 h-5 rounded-full p-0.5 flex transition-colors flex-shrink-0"
        style={{ background: value ? "#1a1a1a" : "#d1d5db" }}
      >
        <span
          className="w-4 h-4 rounded-full bg-white transition-transform"
          style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
        />
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// PREVIEW MODAL — text-only review of auto-generated scenes. Lets the user
// edit each scene's narration AND optionally supply their own image (via
// Upload or From History). Image uploads are deferred until the final
// submitRender() so the modal stays snappy and we don't waste bandwidth
// on choices the user might change.
// ──────────────────────────────────────────────────────────────────────────

function PreviewModal(props: {
  scenes: Scene[];
  setScenes: (s: Scene[] | ((prev: Scene[]) => Scene[])) => void;
  scriptLoading: boolean;
  scriptError: string | null;
  onRetryScript: () => void;
  onClose: () => void;
  // Forward to Step 2 — wired so the user MUST preview before they can
  // proceed to Generate. Step 1 doesn't expose its own Next button
  // anymore; this modal owns the funnel transition.
  onContinue: () => void;
  secondsPerSlide: number;
}) {
  const [historyPickerForIdx, setHistoryPickerForIdx] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [props.onClose]);

  function setNarration(idx: number, value: string) {
    props.setScenes((prev) =>
      prev.map((s) => (s.idx === idx ? { ...s, narration: value } : s))
    );
  }

  function setImagePrompt(idx: number, value: string) {
    props.setScenes((prev) =>
      prev.map((s) => (s.idx === idx ? { ...s, imagePrompt: value } : s))
    );
  }

  function attachUploadedFile(idx: number, file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      props.setScenes((prev) =>
        prev.map((s) =>
          s.idx === idx
            ? {
                ...s,
                userImageFile: file,
                userImagePreview: dataUrl,
                // Drop any previous history-pick URL so this new file wins
                userImageUrl: undefined,
              }
            : s
        )
      );
    };
    reader.readAsDataURL(file);
  }

  function attachHistoryPick(idx: number, url: string) {
    props.setScenes((prev) =>
      prev.map((s) =>
        s.idx === idx
          ? {
              ...s,
              userImageUrl: url,
              userImagePreview: url,
              userImageFile: undefined,
            }
          : s
      )
    );
    setHistoryPickerForIdx(null);
  }

  function clearUserImage(idx: number) {
    props.setScenes((prev) =>
      prev.map((s) =>
        s.idx === idx
          ? { ...s, userImageFile: undefined, userImageUrl: undefined, userImagePreview: undefined }
          : s
      )
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={props.onClose}
    >
      <div
        className="rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col"
        style={{
          background: "white",
          border: "2px solid #c084fc",
          boxShadow: "0 20px 60px rgba(139,92,246,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#e9d5ff" }}>
          <div>
            <h2 className="font-display font-extrabold text-lg" style={{ color: "#7c3aed" }}>
              Preview Scenes
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Edit dialogs · supply your own images per scene · close to keep changes
            </p>
          </div>
          <button
            onClick={props.onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-100"
          >
            <X className="w-4 h-4 text-gray-700" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {props.scriptLoading && (
            <div className="text-center py-12 text-gray-500 text-sm">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" style={{ color: "#a855f7" }} />
              Writing your scenes…
            </div>
          )}
          {props.scriptError && (
            <div className="rounded-xl p-4 text-sm" style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c" }}>
              <div className="font-bold mb-1">Script generation failed</div>
              <p>{props.scriptError}</p>
              <button
                onClick={props.onRetryScript}
                className="mt-2 px-3 py-1.5 rounded-lg text-xs font-bold text-white"
                style={{ background: "#a855f7" }}
              >
                Try again
              </button>
            </div>
          )}
          {!props.scriptLoading && !props.scriptError && props.scenes.length === 0 && (
            <div className="text-center py-12 text-gray-500 text-sm">
              No scenes yet — click Try again or close + Preview again.
            </div>
          )}
          {props.scenes.map((s) => {
            const userOverride = !!(s.userImageUrl || s.userImagePreview);
            return (
              <div
                key={s.idx}
                className="rounded-xl p-4"
                style={{ background: "#fafaf7", border: "1px solid #e5e7eb" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider"
                    style={{ background: "#a855f7", color: "white" }}
                  >
                    Scene {s.idx + 1}
                  </span>
                  <span
                    className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                    style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fde68a" }}
                  >
                    {props.secondsPerSlide}s
                  </span>
                  <span className="text-[10px] font-mono text-gray-400 ml-auto">
                    {wordCount(s.narration)} words
                  </span>
                </div>

                {/* Image — placeholder/preview FIRST so users see the visual
                    plan before reading the dialog. Description prompt is
                    editable too — users can rewrite what the AI will draw. */}
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                  {userOverride ? "Your Image (will be used as-is)" : "Image Description (AI will generate)"}
                </label>
                {userOverride ? (
                  <div
                    className="flex items-center gap-3 p-2.5 rounded-lg mb-3"
                    style={{ background: "white", border: "1px solid #d1d5db" }}
                  >
                    <img
                      src={s.userImagePreview || s.userImageUrl}
                      alt=""
                      className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                      style={{ border: "1px solid #d1d5db" }}
                      referrerPolicy="no-referrer"
                    />
                    <div className="text-[11px] text-gray-600 min-w-0">
                      {s.userImageFile
                        ? `${s.userImageFile.name} · uploads at Generate time`
                        : "Picked from history"}
                    </div>
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    value={s.imagePrompt}
                    onChange={(e) => setImagePrompt(s.idx, e.target.value)}
                    placeholder="Describe what the image should show…"
                    className="w-full p-2.5 rounded-lg text-[12px] leading-relaxed outline-none mb-3 italic"
                    style={{ background: "white", border: "1px dashed #d1d5db", color: "#374151" }}
                  />
                )}

                {/* Per-scene image controls */}
                <div className="flex items-center gap-2 mb-3">
                  <label
                    className="cursor-pointer px-3 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5"
                    style={{ background: "#fff7ed", color: "#c2410c", border: "1px solid #fed7aa" }}
                  >
                    <Upload className="w-3 h-3" /> Upload
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) attachUploadedFile(s.idx, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    onClick={() => setHistoryPickerForIdx(s.idx)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5"
                    style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}
                  >
                    <ImageIcon className="w-3 h-3" /> From History
                  </button>
                  {userOverride && (
                    <button
                      onClick={() => clearUserImage(s.idx)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1.5 ml-auto"
                      style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}
                    >
                      <X className="w-3 h-3" /> Clear
                    </button>
                  )}
                </div>

                {/* Dialog (narration) — shown after the image so the user
                    sees the visual plan first, then writes the line that
                    plays over it. Duration badge above already conveys
                    the per-slide length the audio must fit. */}
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                  Dialog · {props.secondsPerSlide}s narration
                </label>
                <textarea
                  rows={2}
                  value={s.narration}
                  onChange={(e) => setNarration(s.idx, e.target.value)}
                  className="w-full p-2.5 rounded-lg text-sm outline-none"
                  style={{ background: "white", border: "1px solid #d8e8d0", color: "#1a1a1a" }}
                />
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between gap-3" style={{ borderColor: "#e9d5ff", background: "#faf5ff" }}>
          <span className="text-[11px] text-gray-600">
            {props.scenes.filter((s) => s.userImageUrl || s.userImageFile).length} of {props.scenes.length} scenes have a user image
          </span>
          <div className="flex items-center gap-2">
            {/* Cancel — keep the dialog edits but stay in Step 1. */}
            <button
              onClick={props.onClose}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: "white", border: "1px solid #d8b4fe", color: "#7c3aed" }}
            >
              Close
            </button>
            {/* Continue — closes the modal AND advances to Step 2.
                Disabled until script generation finishes; you can't
                proceed to Generate without scenes. */}
            <button
              onClick={props.onContinue}
              disabled={props.scriptLoading || props.scenes.length === 0}
              className="px-5 py-2 rounded-lg text-sm font-bold text-white inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{
                background: "linear-gradient(135deg, #c084fc 0%, #818cf8 100%)",
                boxShadow: "0 4px 12px rgba(168,85,247,0.3)",
              }}
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {historyPickerForIdx !== null && (
        <PreviewHistoryPicker
          onPick={(url) => attachHistoryPick(historyPickerForIdx, url)}
          onClose={() => setHistoryPickerForIdx(null)}
        />
      )}
    </div>
  );
}

// Slimmed-down history picker for the Preview modal — same filter rule
// as the main grid (hide expired-unsaved). Uses the From-History
// selection to populate a scene's user image. We could share with the
// 5 tab pickers later but inlining keeps the diff small.
function PreviewHistoryPicker(props: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<{ id: string; output_url: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  useEffect(() => {
    void (async () => {
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
    })();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={props.onClose}
    >
      <div
        className="rounded-2xl max-w-3xl w-full max-h-[80vh] flex flex-col bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-bold text-sm">Pick image from history</h3>
          <button
            onClick={props.onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="py-12 text-center text-sm text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin inline mr-2" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">
              No images in history yet.
            </div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => props.onPick(it.output_url)}
                  className="aspect-square rounded-lg overflow-hidden bg-gray-100 hover:ring-2 hover:ring-purple-400"
                >
                  <img
                    src={it.output_url}
                    alt=""
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
