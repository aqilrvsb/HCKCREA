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
type VisualStyle = "realistic" | "3d" | "fantasy" | "minimalist" | "nature" | "anime";

const VISUAL_STYLES: { id: VisualStyle; label: string; gradient: string; sample?: string }[] = [
  { id: "realistic",  label: "Realistic",  gradient: "linear-gradient(135deg, #8b5e3c 0%, #d4a574 100%)",
    sample: "https://tempfile.aiquickdraw.com/images/1777806206916-2a5942wnvl3.png" },
  { id: "3d",         label: "3D",         gradient: "linear-gradient(135deg, #f97316 0%, #fbbf24 100%)",
    sample: "https://tempfile.aiquickdraw.com/images/1777806197874-h4qzfh5x9wg.png" },
  { id: "fantasy",    label: "Fantasy",    gradient: "linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)",
    sample: "https://tempfile.aiquickdraw.com/workers/nano/image_1777806223290_9xkbpu.png" },
  { id: "minimalist", label: "Minimalist", gradient: "linear-gradient(135deg, #d4d4d8 0%, #fafafa 100%)",
    sample: "https://tempfile.aiquickdraw.com/images/1777806187348-0410od3jrwht.png" },
  { id: "nature",     label: "Nature",     gradient: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
    sample: "https://tempfile.aiquickdraw.com/images/1777806217679-40suvb4a1b3.png" },
  { id: "anime",      label: "Anime",      gradient: "linear-gradient(135deg, #06b6d4 0%, #f472b6 100%)",
    sample: "https://tempfile.aiquickdraw.com/images/1777806209200-havbrshlbwb.png" },
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

// MiniMax Bahasa Melayu voice IDs — only these 3 are valid for the
// language_boost: "Malay" voice pack. Anything else returns
// "MiniMax: voice id not exist" from t2a_v2. Labels mirror MiniMax's
// own voice descriptions so users pick the right tone for their story.
const VOICES = [
  { id: "Malay_female_1_v1", label: "Easygoing Neighbor — Bright, Warm (Narrator)" },
  { id: "Malay_female_2_v1", label: "Passionate Lady — Bright, Expressive" },
  { id: "Malay_male_1_v1",   label: "Seasoned Man — Deep, Firm, Polished" },
];

// ─── Scene state ───────────────────────────────────────────────
type Scene = {
  idx: number;
  narration: string;
  imagePrompt: string;
  imageUrl: string;             // empty until image generation completes
  imageHistoryId: string | null; // row id we poll for completion
  imageStatus: "queued" | "generating" | "done" | "failed";
};

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

// ──────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ──────────────────────────────────────────────────────────────────────────

export default function FairytaleTab({ projectId }: { projectId?: string } = {}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1 state
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<Style>("storytelling");
  const [tone, setTone] = useState<Tone>("formal");
  const [language, setLanguage] = useState<Language>("ms");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [styleDropdownOpen, setStyleDropdownOpen] = useState(false);
  // Slide-pacing controls (added per user request — show estimated total
  // duration before generation so they can plan word count + cost).
  const [secondsPerSlide, setSecondsPerSlide] = useState<number>(10);
  const [sceneCount, setSceneCount] = useState<number>(10);

  // Step 2 state
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("realistic");

  // Step 3 state — scenes + config
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [scriptProgress, setScriptProgress] = useState<number>(0);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState<ConfigTab>("voice");
  const [previewIdx, setPreviewIdx] = useState(0);
  const [renderStatus, setRenderStatus] = useState<"idle" | "submitting" | "rendering" | "done" | "failed">("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [groupId] = useState(() => Math.random().toString(36).slice(2));

  // Voice config
  const [enableVoice, setEnableVoice] = useState(true);
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);

  // TTS cache — pre-generated narration audio per scene. Filled once when
  // script gen completes; reused by live preview (real audio) AND by the
  // merge step (Modal skips TTS regeneration if scene has audio_url).
  const [audioCache, setAudioCache] = useState<Record<number, string>>({});
  const [audioCacheStatus, setAudioCacheStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [previewMuted, setPreviewMuted] = useState(false);

  // Animation config
  const [transition, setTransition] = useState("fade");
  const [sceneAnimation, setSceneAnimation] = useState("zoom-pan");

  // Font config
  const [enableText, setEnableText] = useState(true);
  const [textAnimation, setTextAnimation] = useState("karaoke");
  const [textPlacement, setTextPlacement] = useState("middle");
  const [fontType, setFontType] = useState("Grobold");
  const [textSize, setTextSize] = useState("L");
  const [textColor, setTextColor] = useState("#f97316");
  const [uppercase, setUppercase] = useState(true);
  const [textBackground, setTextBackground] = useState(true);

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
    const updates = await Promise.all(
      initialScenes.map(async (s) => {
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
  // voice settings change — voiceId or voiceSpeed).
  useEffect(() => {
    if (step !== 3) return;
    if (!enableVoice) return;
    if (scenes.length === 0) return;
    if (scenes.some((s) => !s.narration?.trim())) return;
    if (audioCacheStatus === "loading") return;
    void fetchAudioCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, enableVoice, voiceId, voiceSpeed, scenes.map((s) => s.narration).join("|")]);

  // Poll scene image rows every 4s until all done or failed
  useEffect(() => {
    if (step !== 3) return;
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
  function goNext() {
    if (step === 1) {
      if (!prompt.trim()) return;
      setStep(2);
    } else if (step === 2) {
      setStep(3);
      // Trigger AI script generation upon entering step 3 if not already done
      if (scenes.length === 0 && !scriptLoading) {
        void generateScript();
      }
    }
  }
  function goBack() {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }

  // ─── Submit final render ───────────────────────────────────
  async function submitRender() {
    setRenderError(null);
    const valid = scenes.filter((s) => s.imageUrl && s.narration.trim());
    if (valid.length === 0) {
      setRenderError("Tunggu sehingga semua scene selesai diproses.");
      return;
    }
    setRenderStatus("submitting");
    try {
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
        <h2 className="font-display font-extrabold text-2xl text-[#1a1a1a]">Fairytale</h2>
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
          secondsPerSlide={secondsPerSlide} setSecondsPerSlide={setSecondsPerSlide}
          sceneCount={sceneCount} setSceneCount={setSceneCount}
          styleDropdownOpen={styleDropdownOpen} setStyleDropdownOpen={setStyleDropdownOpen}
          onNext={goNext}
        />
      )}

      {step === 2 && (
        <Step2
          visualStyle={visualStyle}
          setVisualStyle={setVisualStyle}
          onBack={goBack}
          onNext={goNext}
        />
      )}

      {step === 3 && (
        <Step3
          scenes={scenes} setScenes={setScenes}
          scriptLoading={scriptLoading} scriptError={scriptError}
          configTab={configTab} setConfigTab={setConfigTab}
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

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const items = [
    { n: 1, title: "Prompt & Settings", subtitle: "Define your video" },
    { n: 2, title: "Select Visual",     subtitle: "Choose visual style" },
    { n: 3, title: "Review & Generate", subtitle: "Final confirmation" },
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
// STEP 1 — Prompt + Settings
// ──────────────────────────────────────────────────────────────────────────

function Step1(props: {
  prompt: string; setPrompt: (v: string) => void;
  style: Style; setStyle: (v: Style) => void;
  tone: Tone; setTone: (v: Tone) => void;
  language: Language; setLanguage: (v: Language) => void;
  aspect: Aspect; setAspect: (v: Aspect) => void;
  secondsPerSlide: number; setSecondsPerSlide: (v: number) => void;
  sceneCount: number; setSceneCount: (v: number) => void;
  styleDropdownOpen: boolean; setStyleDropdownOpen: (v: boolean) => void;
  onNext: () => void;
}) {
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

      {/* Slide pacing — seconds per slide + slide count + estimated total */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
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

      <div className="flex justify-end mt-8">
        <button
          onClick={props.onNext}
          disabled={!props.prompt.trim()}
          className="px-6 py-2.5 rounded-xl font-bold text-sm text-white inline-flex items-center gap-2 disabled:opacity-40"
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
                background: v.sample ? "#000" : v.gradient,
                outline: active ? `3px solid ${PURPLE}` : "none",
                outlineOffset: active ? 2 : 0,
              }}
            >
              {v.sample && (
                <img
                  src={v.sample}
                  alt={v.label}
                  className="absolute inset-0 w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              )}
              <div
                className="absolute inset-0"
                style={{ background: "linear-gradient(180deg, transparent 50%, rgba(0,0,0,0.6) 100%)" }}
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
          {/* Tabs */}
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
            <VoiceConfig
              enableVoice={enableVoice} setEnableVoice={setEnableVoice}
              voiceId={voiceId} setVoiceId={setVoiceId}
              voiceSpeed={voiceSpeed} setVoiceSpeed={setVoiceSpeed}
            />
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
              <button
                onClick={props.onRetryScript}
                disabled={inProgress}
                className="text-[11px] font-bold px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
                style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#1a1a1a" }}
              >
                <RotateCw className="w-3 h-3" /> Regenerate All Scenes
              </button>
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
              <><Check className="w-4 h-4" /> Merged — see Fairytale history below</>
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
}: {
  enableVoice: boolean; setEnableVoice: (v: boolean) => void;
  voiceId: string; setVoiceId: (v: string) => void;
  voiceSpeed: number; setVoiceSpeed: (v: number) => void;
}) {
  // Voice Speed slider removed — locked to 1.0x ("normal") for now so the
  // narration always reads at the AI's intended pacing. The slider used to
  // be wired through to the MiniMax `speed` param but the user prefers a
  // single normal-speed default for v1.
  return (
    <div className="space-y-3">
      <Toggle label="Enable Voice" premium sub="Add AI narration to each scene" value={enableVoice} onChange={setEnableVoice} />
      {enableVoice && (
        <Field label="Voice">
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="w-full p-2.5 rounded-lg text-xs outline-none" style={{ background: "#fafafa", border: "1px solid #e5e7eb", color: "#1a1a1a" }}>
            {VOICES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
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
  useEffect(() => {
    if (!scenes || sceneCount <= 1) return;
    if (sceneAudioUrl && audioRef.current) {
      const el = audioRef.current;
      const onEnded = () =>
        props.setPreviewIdx((p: number) => (p + 1) % sceneCount);
      el.addEventListener("ended", onEnded);
      return () => el.removeEventListener("ended", onEnded);
    }
    const id = setInterval(() => {
      props.setPreviewIdx((p: number) => (p + 1) % sceneCount);
    }, SCENE_DURATION_MS);
    return () => clearInterval(id);
  }, [sceneCount, sceneAudioUrl]);

  const scene = scenes?.[previewIdx] || null;

  const fullText = scene?.narration ? (uppercase ? scene.narration.toUpperCase() : scene.narration) : "Preview text";
  const words = useMemo(() => fullText.split(/\s+/).filter(Boolean), [fullText]);
  // Subtitle pacing tracks the audio's effective length (after playbackRate)
  // so karaoke / highlight stays in sync as the user changes speed.
  const sceneDurationMs = sceneAudioUrl ? effectiveAudioMs : SCENE_DURATION_MS;

  // Karaoke / progressive reveal — bumps every (sceneDuration / wordCount) ms
  const [revealedCount, setRevealedCount] = useState(words.length);
  useEffect(() => {
    if (!enableText) return;
    if (textAnimation === "none" || textAnimation === "highlight") {
      setRevealedCount(words.length);
      return;
    }
    setRevealedCount(0);
    if (words.length === 0) return;
    const perWord = sceneDurationMs / words.length;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setRevealedCount(i);
      if (i >= words.length) clearInterval(id);
    }, perWord);
    return () => clearInterval(id);
    // Re-run on EVERY relevant change so user sees effect live
  }, [textAnimation, fullText, sceneDurationMs, enableText, words.length, scene?.idx]);

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
