"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, Plus, Upload, Image as ImageIcon, Volume2, Trash2, Sparkles } from "lucide-react";

// Fairytale tab — image-driven storytelling video generator.
// Per scene: image (uploaded OR picked from history) + Bahasa Melayu narration.
// Final render = Modal Ken Burns + MiniMax TTS narration → 1-min mp4.
//
// Pattern A (placeholder + Modal writes Supabase) — Vercel never waits.
// Tab is fully isolated: zero touches to existing tab files.

const ORANGE = "#facc15";
const ORANGE_SOFT = "rgba(250, 204, 21, 0.18)";
const PURPLE = "#a855f7";

// MiniMax t2a_v2 system voice IDs. MiniMax has no native Malay voices —
// these English / Mandarin storytelling voices speak BM with a slight
// foreign accent when paired with language_boost: "Malay" (set server-side
// in modal_fairytale.py + /api/tts/minimax). Real IDs verified from
// https://platform.minimax.io/docs/faq/system-voice-id (May 2026).
const VOICES = [
  { id: "English_CaptivatingStoryteller", label: "Storyteller — Engaging narrator (gender-neutral)" },
  { id: "English_Graceful_Lady",          label: "Aisyah — Female, elegant, refined" },
  { id: "English_Soft-spokenGirl",        label: "Nadia — Female, soft, intimate (bedtime stories)" },
  { id: "English_radiant_girl",           label: "Bella — Female, youthful, bright" },
  { id: "English_Gentle-voiced_man",      label: "Hakim — Male, soft, soothing" },
  { id: "English_WiseScholar",            label: "Pak Cik — Male, authoritative (myths/legends)" },
  { id: "English_expressive_narrator",    label: "Faizal — Male, mature, dramatic" },
];

const ANIMATIONS = [
  { id: "zoom-in",   label: "Zoom In" },
  { id: "zoom-out",  label: "Zoom Out" },
  { id: "pan-left",  label: "Pan Left" },
  { id: "pan-right", label: "Pan Right" },
];

const PLACEMENTS = [
  { id: "top",          label: "Top" },
  { id: "top-third",    label: "Upper Third" },
  { id: "middle",       label: "Middle" },
  { id: "bottom-third", label: "Lower Third" },
  { id: "bottom",       label: "Bottom" },
];

const FONT_FAMILIES = [
  { id: "bold-display", label: "Bold Display" },
  { id: "sans-bold",    label: "Sans Bold" },
  { id: "sans",         label: "Sans Regular" },
  { id: "serif",        label: "Serif" },
  { id: "mono",         label: "Monospace" },
  { id: "handwriting",  label: "Handwriting" },
  { id: "roboto",       label: "Roboto" },
];

const FONT_COLORS = [
  { id: "white",  hex: "#ffffff" },
  { id: "yellow", hex: "#fde047" },
  { id: "orange", hex: "#fb923c" },
  { id: "red",    hex: "#ef4444" },
  { id: "pink",   hex: "#f9a8d4" },
  { id: "cyan",   hex: "#67e8f9" },
  { id: "black",  hex: "#000000" },
];

const SUBTITLE_BG = [
  { id: "box",             label: "Solid Box" },
  { id: "outline",         label: "Outline" },
  { id: "shadow",          label: "Drop Shadow" },
  { id: "outline+shadow",  label: "Outline + Shadow" },
  { id: "none",            label: "None" },
];

const SUBTITLE_ANIMATIONS = [
  { id: "static",   label: "Static (full text)" },
  { id: "karaoke",  label: "Karaoke (word-by-word)" },
  { id: "fade",     label: "Fade In/Out" },
];

const TEXT_ALIGNS = [
  { id: "left",   label: "Left" },
  { id: "center", label: "Center" },
  { id: "right",  label: "Right" },
];

type Scene = {
  uid: string;        // local stable key
  imageUrl: string;   // public URL (uploaded or from history)
  narration: string;
};

const newScene = (): Scene => ({
  uid: Math.random().toString(36).slice(2),
  imageUrl: "",
  narration: "",
});

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export default function FairytaleTab({ projectId }: { projectId?: string } = {}) {
  const [scenes, setScenes] = useState<Scene[]>(() => [newScene(), newScene(), newScene()]);
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [animation, setAnimation] = useState("zoom-in");
  const [placement, setPlacement] = useState("bottom");
  const [fontSize, setFontSize] = useState(56);
  // Subtitle styling — all dynamic per-render
  const [fontFamily, setFontFamily] = useState("bold-display");
  const [fontColor, setFontColor] = useState("white");
  const [subtitleBg, setSubtitleBg] = useState("box");
  const [subtitleAnimation, setSubtitleAnimation] = useState("static");
  const [textAlign, setTextAlign] = useState("center");
  const [yOffsetPct, setYOffsetPct] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [previewing, setPreviewing] = useState<string | null>(null); // scene.uid
  const [historyPickerFor, setHistoryPickerFor] = useState<string | null>(null); // scene.uid

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function patchScene(uid: string, p: Partial<Scene>) {
    setScenes((prev) => prev.map((s) => (s.uid === uid ? { ...s, ...p } : s)));
  }
  function deleteScene(uid: string) {
    setScenes((prev) => (prev.length <= 1 ? prev : prev.filter((s) => s.uid !== uid)));
  }
  function addScene() {
    if (scenes.length >= 15) return;
    setScenes((prev) => [...prev, newScene()]);
  }

  async function uploadImage(uid: string, f: File | null) {
    if (!f) return;
    // Show local preview immediately, then swap to RH URL once uploaded.
    const reader = new FileReader();
    reader.onload = () => patchScene(uid, { imageUrl: String(reader.result || "") });
    reader.readAsDataURL(f);
    try {
      const fd = new FormData();
      fd.append("file", f, f.name || "upload.png");
      const r = await fetch("/api/upload/image", { method: "POST", body: fd });
      const d = await r.json();
      if (r.ok && d?.url) patchScene(uid, { imageUrl: d.url });
    } catch {
      // Keep data: URL — backend will fail to download data: URLs, so user
      // would need to retry. Surfacing here is overkill for v1.
    }
  }

  async function previewVoice(scene: Scene) {
    if (!scene.narration.trim()) {
      setError("Tulis narration dulu sebelum preview voice.");
      return;
    }
    setError(null);
    setPreviewing(scene.uid);
    try {
      const r = await fetch("/api/tts/minimax", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: scene.narration,
          voice_id: voiceId,
          speed: voiceSpeed,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "TTS failed");
      const audio = new Audio(`data:${d.mime};base64,${d.audio_b64}`);
      await audio.play();
    } catch (e: any) {
      setError(e?.message || "Preview gagal");
    } finally {
      setPreviewing(null);
    }
  }

  async function generateStory() {
    setError(null);
    setOkMsg(null);
    const valid = scenes.filter(
      (s) => s.imageUrl && s.imageUrl.length > 0 && s.narration.trim().length > 0
    );
    if (valid.length === 0) {
      setError("Setiap scene perlu image + narration. Add at least one complete scene.");
      return;
    }
    if (valid.length < scenes.length) {
      setError(`${scenes.length - valid.length} scene belum lengkap — tambah image + narration atau buang.`);
      return;
    }
    // Reject data: URLs — Modal can't download them.
    if (valid.some((s) => s.imageUrl.startsWith("data:"))) {
      setError("Sila tunggu image upload selesai sebelum generate.");
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch("/api/generate/fairytale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          voice_id: voiceId,
          voice_speed: voiceSpeed,
          animation,
          placement,
          font_size: fontSize,
          font_family: fontFamily,
          font_color: fontColor,
          subtitle_bg: subtitleBg,
          subtitle_animation: subtitleAnimation,
          text_align: textAlign,
          y_offset_pct: yOffsetPct,
          scenes: valid.map((s) => ({
            image_url: s.imageUrl,
            narration: s.narration,
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Generate failed");
      window.dispatchEvent(new CustomEvent("history:refresh"));
      setOkMsg(`Story dihantar untuk render — ${d.scene_count} scene. Tunggu ~1-2 minit.`);
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  const sectionBg: React.CSSProperties = {
    background:
      "radial-gradient(ellipse 1200px 800px at 50% 0%, #fff7f2 0%, #fafaf7 40%, #f5f5f0 100%)",
    color: "#1a1a1a",
    boxShadow: "0 0 0 1px rgba(250, 204, 21, 0.12)",
  };

  return (
    <div className="rounded-3xl p-6 md:p-8 space-y-5" style={sectionBg}>
      {/* COMING SOON BANNER */}
      <div
        className="rounded-2xl p-4 flex items-start gap-3"
        style={{
          background: "linear-gradient(135deg, rgba(168, 85, 247, 0.10) 0%, rgba(250, 204, 21, 0.10) 100%)",
          border: "1px solid rgba(168, 85, 247, 0.3)",
        }}
      >
        <div className="text-2xl">🚧</div>
        <div className="flex-1">
          <div className="font-display font-extrabold text-sm" style={{ color: "#7c3aed" }}>
            Coming Soon — Beta Testing
          </div>
          <p className="text-xs text-gray-700 mt-1 leading-relaxed">
            Storytelling video generator masih dalam ujian. UI siap, backend pipeline (MiniMax TTS + Modal Ken Burns render) sedang dikonfigurasi.
            Cuba je — kalau Generate gagal, anda akan dapat error message yang jelas.
          </p>
        </div>
      </div>

      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4" style={{ color: PURPLE }} />
            <span
              className="font-mono text-[10px] uppercase tracking-[0.2em] font-bold"
              style={{ color: PURPLE }}
            >
              Fairytale Studio
            </span>
          </div>
          <h2 className="font-display font-extrabold text-2xl text-[#1a1a1a]">
            Storytelling Video Builder
          </h2>
          <p className="text-xs text-gray-600 mt-1">
            Add scene-by-scene. Setiap scene = 1 image + 1 narration BM. AI render Ken Burns motion + MiniMax voice.
          </p>
        </div>
        <div
          className="text-[10px] font-bold px-3 py-1.5 rounded-full"
          style={{ background: ORANGE_SOFT, color: "#7c5400" }}
        >
          {scenes.length}/15 scenes · ~RM {(scenes.length * 0.05).toFixed(2)}
        </div>
      </div>

      {/* TWO-COLUMN GRID — scenes left, settings right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* LEFT — scene cards */}
        <div className="lg:col-span-2 space-y-4">
          {scenes.map((scene, idx) => (
            <SceneCard
              key={scene.uid}
              idx={idx}
              scene={scene}
              fileRef={(el) => (fileRefs.current[scene.uid] = el)}
              onPick={() => fileRefs.current[scene.uid]?.click()}
              onUpload={(f) => uploadImage(scene.uid, f)}
              onPickHistory={() => setHistoryPickerFor(scene.uid)}
              onChangeNarration={(v) => patchScene(scene.uid, { narration: v })}
              onClearImage={() => patchScene(scene.uid, { imageUrl: "" })}
              onDelete={() => deleteScene(scene.uid)}
              onPreviewVoice={() => previewVoice(scene)}
              previewing={previewing === scene.uid}
              canDelete={scenes.length > 1}
            />
          ))}

          {scenes.length < 15 && (
            <button
              onClick={addScene}
              className="w-full py-4 rounded-2xl text-sm font-extrabold transition-all hover:-translate-y-0.5 flex items-center justify-center gap-2"
              style={{
                background: "white",
                border: `2px dashed ${PURPLE}`,
                color: PURPLE,
              }}
            >
              <Plus className="w-4 h-4" /> Tambah Scene
            </button>
          )}
        </div>

        {/* RIGHT — global settings + generate button */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div
            className="rounded-2xl p-5 space-y-4"
            style={{
              background: "white",
              border: "1px solid #e8e0d8",
              boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
            }}
          >
            <div className="font-display font-extrabold text-sm">Story Settings</div>

            <Field label="Voice (MiniMax · Bahasa Melayu)">
              <select
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                className="w-full p-2.5 rounded-lg text-xs outline-none"
                style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
              >
                {VOICES.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </select>
            </Field>

            <Field label={`Voice Speed: ${voiceSpeed.toFixed(2)}x`}>
              <input
                type="range" min={0.5} max={2.0} step={0.05}
                value={voiceSpeed}
                onChange={(e) => setVoiceSpeed(Number(e.target.value))}
                className="w-full"
              />
            </Field>

            <Field label="Animation (applied to all scenes)">
              <select
                value={animation}
                onChange={(e) => setAnimation(e.target.value)}
                className="w-full p-2.5 rounded-lg text-xs outline-none"
                style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
              >
                {ANIMATIONS.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Caption Placement">
              <select
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
                className="w-full p-2.5 rounded-lg text-xs outline-none"
                style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
              >
                {PLACEMENTS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </Field>

            <Field label={`Font Size: ${fontSize}px`}>
              <input
                type="range" min={28} max={96} step={2}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full"
              />
            </Field>

            {/* SUBTITLE STYLE — dedicated subsection */}
            <div className="pt-3 border-t" style={{ borderColor: "#e8e0d8" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: PURPLE }}>
                ✨ Subtitle Style
              </div>

              <div className="space-y-3">
                <Field label="Subtitle Animation">
                  <select
                    value={subtitleAnimation}
                    onChange={(e) => setSubtitleAnimation(e.target.value)}
                    className="w-full p-2.5 rounded-lg text-xs outline-none"
                    style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
                  >
                    {SUBTITLE_ANIMATIONS.map((a) => (
                      <option key={a.id} value={a.id}>{a.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Font Family">
                  <select
                    value={fontFamily}
                    onChange={(e) => setFontFamily(e.target.value)}
                    className="w-full p-2.5 rounded-lg text-xs outline-none"
                    style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
                  >
                    {FONT_FAMILIES.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Font Color">
                  <div className="flex gap-1.5 flex-wrap">
                    {FONT_COLORS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setFontColor(c.id)}
                        title={c.id}
                        className="w-7 h-7 rounded-lg transition-transform hover:scale-110"
                        style={{
                          background: c.hex,
                          border: fontColor === c.id ? "2px solid #1a1a1a" : "1px solid #e8e0d8",
                          boxShadow: fontColor === c.id ? "0 0 0 2px rgba(168,85,247,0.4)" : undefined,
                        }}
                      />
                    ))}
                  </div>
                </Field>

                <Field label="Background Style">
                  <select
                    value={subtitleBg}
                    onChange={(e) => setSubtitleBg(e.target.value)}
                    className="w-full p-2.5 rounded-lg text-xs outline-none"
                    style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
                  >
                    {SUBTITLE_BG.map((b) => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Text Align">
                  <div className="flex gap-1">
                    {TEXT_ALIGNS.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => setTextAlign(a.id)}
                        className="flex-1 py-2 rounded-md text-[10px] font-bold transition-all"
                        style={
                          textAlign === a.id
                            ? { background: PURPLE, color: "white" }
                            : { background: "#fafaf7", border: "1px solid #e8e0d8", color: "#666" }
                        }
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label={`Y Position Offset: ${yOffsetPct > 0 ? "+" : ""}${yOffsetPct}%`}>
                  <input
                    type="range" min={-30} max={30} step={1}
                    value={yOffsetPct}
                    onChange={(e) => setYOffsetPct(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="text-[9px] text-gray-500 mt-0.5">
                    Fine-tune up/down from the chosen Placement (negative = up, positive = down)
                  </div>
                </Field>

                {/* LIVE PREVIEW SWATCH */}
                <div
                  className="rounded-lg p-3 text-center"
                  style={{
                    background: "linear-gradient(135deg, #1a1a1a 0%, #333 100%)",
                    minHeight: 60,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: textAlign === "left" ? "flex-start" : textAlign === "right" ? "flex-end" : "center",
                    paddingLeft: 12,
                    paddingRight: 12,
                  }}
                >
                  <span
                    style={{
                      color: FONT_COLORS.find((c) => c.id === fontColor)?.hex || "#fff",
                      fontSize: Math.min(fontSize / 2.5, 22),
                      fontFamily:
                        fontFamily === "serif" ? "Georgia, serif" :
                        fontFamily === "mono" ? "monospace" :
                        fontFamily === "handwriting" ? "cursive" :
                        "system-ui, sans-serif",
                      fontWeight: fontFamily.includes("bold") || fontFamily === "bold-display" ? 800 : 400,
                      background: subtitleBg === "box" ? "rgba(0,0,0,0.55)" : "transparent",
                      padding: subtitleBg === "box" ? "4px 10px" : 0,
                      borderRadius: subtitleBg === "box" ? 4 : 0,
                      textShadow:
                        subtitleBg === "outline" || subtitleBg === "outline+shadow"
                          ? "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000"
                          : subtitleBg === "shadow"
                          ? "2px 2px 4px rgba(0,0,0,0.7)"
                          : "none",
                    }}
                  >
                    Preview teks subtitle
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={generateStory}
              disabled={submitting}
              className="w-full mt-2 py-3 rounded-xl font-extrabold text-base text-black transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
              style={{
                background: "linear-gradient(135deg, #facc15 0%, #fde047 100%)",
                boxShadow: "0 6px 20px rgba(250, 204, 21, 0.35)",
              }}
            >
              {submitting ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting…
                </span>
              ) : (
                <>🎬 Generate Story Video</>
              )}
            </button>

            {error && (
              <div
                className="px-3 py-2 rounded-lg text-[11px] font-semibold"
                style={{
                  background: "rgba(244,67,54,0.08)",
                  border: "1px solid rgba(244,67,54,0.3)",
                  color: "#c62828",
                }}
              >
                {error}
              </div>
            )}
            {okMsg && (
              <div
                className="px-3 py-2 rounded-lg text-[11px] font-semibold"
                style={{
                  background: "rgba(76,175,80,0.08)",
                  border: "1px solid rgba(76,175,80,0.3)",
                  color: "#2e7d32",
                }}
              >
                {okMsg}
              </div>
            )}
          </div>

          <div
            className="rounded-2xl p-4 text-[11px] leading-relaxed"
            style={{
              background: "rgba(168, 85, 247, 0.06)",
              border: "1px solid rgba(168, 85, 247, 0.2)",
              color: "#5b21b6",
            }}
          >
            💡 <strong>Tip:</strong> 1 scene ≈ 5-8 saat ikut panjang narration.
            Target 15-30 perkataan setiap scene untuk pacing terbaik.
          </div>
        </div>
      </div>

      {/* HISTORY PICKER MODAL */}
      {historyPickerFor && (
        <HistoryImagePicker
          onPick={(url) => {
            patchScene(historyPickerFor, { imageUrl: url });
            setHistoryPickerFor(null);
          }}
          onClose={() => setHistoryPickerFor(null)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────────────────────

function SceneCard({
  idx,
  scene,
  fileRef,
  onPick,
  onUpload,
  onPickHistory,
  onChangeNarration,
  onClearImage,
  onDelete,
  onPreviewVoice,
  previewing,
  canDelete,
}: {
  idx: number;
  scene: Scene;
  fileRef: (el: HTMLInputElement | null) => void;
  onPick: () => void;
  onUpload: (f: File | null) => void;
  onPickHistory: () => void;
  onChangeNarration: (v: string) => void;
  onClearImage: () => void;
  onDelete: () => void;
  onPreviewVoice: () => void;
  previewing: boolean;
  canDelete: boolean;
}) {
  const wc = wordCount(scene.narration);
  const wcColor = wc < 5 ? "#999" : wc > 40 ? "#c62828" : "#2e7d32";

  return (
    <div
      className="rounded-2xl p-4 grid grid-cols-[140px_1fr] gap-4 items-stretch"
      style={{
        background: "white",
        border: "1px solid #e8e0d8",
        boxShadow: "0 4px 14px rgba(0,0,0,0.04)",
      }}
    >
      {/* LEFT — image preview / picker */}
      <div className="flex flex-col gap-2">
        <div
          onClick={scene.imageUrl ? undefined : onPick}
          className="relative aspect-[9/16] rounded-xl overflow-hidden flex items-center justify-center cursor-pointer"
          style={{
            background: scene.imageUrl ? "#000" : "#fafaf7",
            border: scene.imageUrl ? "1px solid #e8e0d8" : "2px dashed #d8d0c8",
          }}
        >
          {scene.imageUrl ? (
            <>
              <img
                src={scene.imageUrl}
                alt={`Scene ${idx + 1}`}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <button
                onClick={(e) => { e.stopPropagation(); onClearImage(); }}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                style={{ background: "rgba(0,0,0,0.6)" }}
                aria-label="Clear image"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <div className="text-center px-2">
              <ImageIcon className="w-6 h-6 mx-auto mb-1 text-gray-400" />
              <div className="text-[10px] text-gray-500">Tap to upload</div>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onUpload(e.target.files?.[0] || null)}
        />
      </div>

      {/* RIGHT — scene controls */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div
            className="font-mono text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded"
            style={{ background: ORANGE_SOFT, color: "#7c5400" }}
          >
            Scene {idx + 1}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold" style={{ color: wcColor }}>
              {wc}/30 words
            </span>
            {canDelete && (
              <button
                onClick={onDelete}
                className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-red-50"
                style={{ color: "#c62828" }}
                aria-label="Delete scene"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        <textarea
          rows={3}
          value={scene.narration}
          onChange={(e) => onChangeNarration(e.target.value)}
          placeholder="Tulis narration BM untuk scene ni... (15-30 perkataan)"
          className="w-full p-2.5 rounded-lg text-xs resize-none outline-none flex-1"
          style={{
            background: "#fafaf7",
            border: "1px solid #e8e0d8",
            color: "#1a1a1a",
            lineHeight: 1.4,
            minHeight: 78,
          }}
          maxLength={400}
        />

        <div className="flex gap-1.5 flex-wrap">
          <SceneBtn icon={<Upload className="w-3 h-3" />} onClick={onPick}>
            Upload
          </SceneBtn>
          <SceneBtn icon={<ImageIcon className="w-3 h-3" />} onClick={onPickHistory}>
            History
          </SceneBtn>
          <SceneBtn
            icon={previewing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Volume2 className="w-3 h-3" />}
            onClick={onPreviewVoice}
            color={PURPLE}
          >
            {previewing ? "Loading…" : "Preview Voice"}
          </SceneBtn>
        </div>
      </div>
    </div>
  );
}

function SceneBtn({
  icon, children, onClick, color = "#1a1a1a",
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-colors"
      style={{
        background: "#fafaf7",
        border: "1px solid #e8e0d8",
        color,
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// History picker modal — fetches recent images via /api/history
// (read-only, doesn't touch any other tab's picker code)
// ──────────────────────────────────────────────────────────────────────────

function HistoryImagePicker({
  onPick,
  onClose,
}: {
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<{ id: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/history?type=image&limit=40", { cache: "no-store" });
        const d = await r.json();
        const rows = Array.isArray(d?.items) ? d.items : Array.isArray(d?.history) ? d.history : [];
        setItems(
          rows
            .filter((x: any) => x?.output_url)
            .map((x: any) => ({ id: x.id, url: x.output_url }))
        );
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden"
        style={{ background: "#fafaf7", border: "1px solid #e8e0d8" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#e8e0d8" }}>
          <h3 className="font-display font-extrabold text-base">Pick from History</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "white", border: "1px solid #e8e0d8" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="text-center text-sm text-gray-500 py-12">
              Belum ada image dalam history. Generate dari Image tab dulu.
            </p>
          )}
          {!loading && items.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => onPick(it.url)}
                  className="aspect-[9/16] rounded-lg overflow-hidden hover:ring-2 hover:ring-orange-400 transition"
                  style={{ background: "#000" }}
                >
                  <img
                    src={it.url}
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
