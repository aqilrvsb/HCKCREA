"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X, Film } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Portal from "../sections/portal";
import { uploadImage, dataUrlToFile } from "@/lib/upload-image";
import { isVisibleAfterTtl, fetchSavedSet } from "@/lib/history-filter";

// Viral tab — TWO sub-features:
//   • Free Veo       — existing free-form prompt path (Veo i2v / t2v)
//   • Talking Object — guided wizard that generates {image_prompt, video_prompt}
//                      via OpenRouter, then chains nano-banana-pro → Veo i2v
// User picks the sub-feature with a radio at the top of the panel.

type Status = "idle" | "submitting" | "failed";
type ImageMode = "text" | "image";
type SubFeature = "free" | "talking-object";
type TalkingObjective = "benefit" | "complaint" | "cons";
type TalkingLanguage = "ms" | "en";
type TalkingMode = "t2v" | "i2v";
type DialogMode = "auto" | "custom";
type TargetMode = "auto" | "custom";
type Performance = "action" | "standing";

const PURPLE = "#7c4dff";
const PURPLE_SOFT = "rgba(124, 77, 255, 0.18)";
const PURPLE_FAINT = "rgba(124, 77, 255, 0.06)";

export default function CinemaTab({ projectId }: { projectId?: string } = {}) {
  // Sub-feature selector — Talking Object (default, AI wizard) and
  // Normal Video (free-form prompt with Grok/Veo model choice). Other
  // 3 placeholder buttons in the radio strip are disabled.
  const [subFeature, setSubFeature] = useState<SubFeature>("talking-object");

  // Model selector for Normal Video sub-feature: Grok (per-second) or
  // Veo (8s flat). Talking Object is locked to Veo internally.
  const [model, setModel] = useState<"grok" | "veo">("veo");
  const [imageMode, setImageMode] = useState<ImageMode>("text");
  const [refImage, setRefImage] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");

  // ── Talking Object form state ─────────────────────────────────────────
  const [toObject, setToObject] = useState("");
  const [toObjective, setToObjective] = useState<TalkingObjective>("benefit");
  const [toPurpose, setToPurpose] = useState("");
  const [toLanguage, setToLanguage] = useState<TalkingLanguage>("ms");
  const [toMode, setToMode] = useState<TalkingMode>("i2v");
  const [toDialogMode, setToDialogMode] = useState<DialogMode>("auto");
  const [toCustomDialog, setToCustomDialog] = useState("");
  const [toTargetMode, setToTargetMode] = useState<TargetMode>("auto");
  const [toCustomTarget, setToCustomTarget] = useState("");
  const [toPerformance, setToPerformance] = useState<Performance>("action");
  const [toStatus, setToStatus] = useState<Status>("idle");
  const [toError, setToError] = useState<string | null>(null);
  // ──────────────────────────────────────────────────────────────────────
  // Resolution is hardcoded to 720p — admin/product call. UI dropdown removed
  // intentionally; the value still flows through to the API body so the
  // backend stays unchanged.
  const resolution: "720p" = "720p";
  // Veo runs at fixed 8s. No slider.
  const effectiveDuration = 8;
  const [ratePerSec, setRatePerSec] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const refInputRef = useRef<HTMLInputElement | null>(null);

  // Pull admin-configurable rate once on mount so the cost preview stays in
  // sync with /admin → cinema_rate_per_sec without a redeploy.
  useEffect(() => {
    let cancel = false;
    fetch("/api/cinema/rate", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!cancel && typeof d?.rate === "number") setRatePerSec(d.rate);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);

  // Cost preview: Grok = duration × admin per-sec rate; Veo = 8 × per-sec rate
  // (Veo's actual cost is flat-per-call on the backend; this is just an
  // approximate hint here. Final cost is settled at backend after generation.)
  const cost = ratePerSec != null ? effectiveDuration * ratePerSec : null;

  // Eager-upload: file pick → instant data: preview → background upload to
  // RunningHub. By submit time, refImage holds the public URL.
  function readFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRefImage(String(reader.result || ""));
      (async () => {
        try {
          const { url } = await uploadImage(f);
          setRefImage(url);
        } catch {
          // Silent — submit's ensurePublicUrl handles retry
        }
      })();
    };
    reader.readAsDataURL(f);
  }

  async function ensurePublicUrl(v: string): Promise<string> {
    if (!v) return "";
    if (!v.startsWith("data:")) return v;
    const file = await dataUrlToFile(v, "ref.png");
    const { url } = await uploadImage(file);
    return url;
  }

  async function submit() {
    if (!prompt.trim()) return setError("Sila masukkan prompt.");
    if (imageMode === "image" && !refImage)
      return setError("Upload reference image dulu.");
    setError(null);
    setStatus("submitting");

    try {
      let pubUrl = "";
      if (imageMode === "image" && refImage) {
        pubUrl = await ensurePublicUrl(refImage);
      }
      const r = await fetch("/api/generate/cinema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          image_url: pubUrl,
          duration: effectiveDuration,
          resolution,
          aspect_ratio: aspect,
          image_mode: imageMode,
          model, // "grok" | "veo"
          project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setError(d?.error || "Generation failed");
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
  const toBusy = toStatus === "submitting";

  // ── Talking Object submit ─────────────────────────────────────────────
  async function submitTalkingObject() {
    if (!toObject.trim()) return setToError("Sila taip nama object dulu.");
    if (toDialogMode === "custom" && !toCustomDialog.trim())
      return setToError("Sila taip custom dialog atau tukar ke Auto Dialog.");
    if (toTargetMode === "custom" && !toCustomTarget.trim())
      return setToError("Sila taip custom target atau tukar ke Auto Target.");
    setToError(null);
    setToStatus("submitting");
    try {
      const r = await fetch("/api/generate/viral/talking-object", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          object: toObject.trim(),
          objective: toObjective,
          language: toLanguage,
          purpose: toPurpose.trim(),
          mode: toMode,
          custom_dialog:
            toDialogMode === "custom" ? toCustomDialog.trim() : "",
          custom_target:
            toTargetMode === "custom" ? toCustomTarget.trim() : "",
          performance: toPerformance,
          project_id: projectId,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setToError(d?.error || "Generation failed");
        setToStatus("failed");
        return;
      }
      window.dispatchEvent(new CustomEvent("history:refresh"));
      setToStatus("idle");
      // Reset only the object field — keep purpose + language + objective
      // so the user can crank out a series of ingredients without retyping
      // everything. (Common workflow: generate Biotin, then L-Cystine, etc.)
      setToObject("");
    } catch (e: any) {
      setToError(e?.message || "Network error");
      setToStatus("failed");
    }
  }

  const sectionBg: React.CSSProperties = {
    background:
      "radial-gradient(ellipse 1200px 800px at 50% 0%, #f7f3ff 0%, #fafaf7 40%, #f5f5f0 100%)",
    color: "#1a1a1a",
    boxShadow: "0 0 0 1px rgba(124, 77, 255, 0.08)",
  };

  return (
    <div className="rounded-3xl p-6 md:p-8 space-y-5" style={sectionBg}>
      {/* Free Veo Prompt option hidden by product decision — Viral tab is
          Talking Object AI only. Old Free-Veo JSX is preserved below
          inside an unreachable branch (subFeature is hardcoded to
          'talking-object'). To bring the radio back, undo this block
          and re-enable the SubFeatureCard grid. */}

      {/* Viral feature selector — 5 radio buttons. Talking Object (AI
          wizard) and Normal Video (free-form prompt) are functional;
          the other 3 are placeholders for upcoming features. Defaults
          to Talking Object. */}
      <Card>
        <div className="flex items-center gap-2.5 mb-3">
          <span className="text-lg">🎬</span>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
            Viral Feature
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <ViralFeatureBtn
            active={subFeature === "talking-object"}
            onClick={() => setSubFeature("talking-object")}
            emoji="🗣️"
            label="Talking Object"
          />
          <ViralFeatureBtn
            active={subFeature === "free"}
            onClick={() => setSubFeature("free")}
            emoji="🎞️"
            label="Normal Video"
          />
          <ViralFeatureBtn emoji="✨" label="Coming soon" disabled />
          <ViralFeatureBtn emoji="✨" label="Coming soon" disabled />
          <ViralFeatureBtn emoji="✨" label="Coming soon" disabled />
        </div>
      </Card>

      {subFeature === "talking-object" && (
        <>
          <Card>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="text-lg">🗣️</span>
              <span className="text-[13px] font-extrabold tracking-[0.02em]">
                Talking Object
              </span>
            </div>

            <Label>1. Object / Ingredient</Label>
            <input
              type="text"
              name="viral-object"
              autoComplete="off"
              data-lpignore="true"
              data-form-type="other"
              value={toObject}
              onChange={(e) => setToObject(e.target.value.slice(0, 80))}
              placeholder="e.g. Banana, Biotin, Smartphone, L-Cystine"
              className="w-full p-3 rounded-lg text-sm outline-none mb-4"
              style={{
                background: "#fafaf7",
                border: "1px solid #e8e0d8",
                color: "#1a1a1a",
              }}
            />

            <Label>2. Objective</Label>
            <div className="grid grid-cols-3 gap-2 mb-1">
              <ObjectiveBtn
                active={toObjective === "benefit"}
                onClick={() => setToObjective("benefit")}
                emoji="💪"
                label="Proud"
              />
              <ObjectiveBtn
                active={toObjective === "complaint"}
                onClick={() => setToObjective("complaint")}
                emoji="😤"
                label="Grumpy"
              />
              <ObjectiveBtn
                active={toObjective === "cons"}
                onClick={() => setToObjective("cons")}
                emoji="😈"
                label="Villain"
              />
            </div>
            <p className="text-[10px] text-gray-500 mb-4">
              {toObjective === "benefit"
                ? "Confident mentor — drives saves (educational)."
                : toObjective === "complaint"
                ? "First-person grumpy complaint about user — drives shares (humor)."
                : "Sneaky villain warning — drives shares (fear)."}
            </p>

            <Label>3. Purpose / Context (drives the scene)</Label>
            <input
              type="text"
              name="viral-purpose"
              autoComplete="off"
              data-lpignore="true"
              data-form-type="other"
              value={toPurpose}
              onChange={(e) => setToPurpose(e.target.value.slice(0, 200))}
              placeholder='e.g. "Hair growth (D-Bio Plus)", "Skin glow", "Energy boost"'
              className="w-full p-3 rounded-lg text-sm outline-none mb-1"
              style={{
                background: "#fafaf7",
                border: "1px solid #e8e0d8",
                color: "#1a1a1a",
              }}
            />
            <p className="text-[10px] text-gray-500 mb-4">
              Tip: Same purpose across multiple objects in the same project = same scene = looks like a coherent series.
            </p>

            <Label>4. Language</Label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              <ObjectiveBtn
                active={toLanguage === "ms"}
                onClick={() => setToLanguage("ms")}
                emoji="🇲🇾"
                label="Bahasa Melayu"
              />
              <ObjectiveBtn
                active={toLanguage === "en"}
                onClick={() => setToLanguage("en")}
                emoji="🇺🇸"
                label="English"
              />
            </div>

            <Label>5. Target / Scene</Label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <ObjectiveBtn
                active={toTargetMode === "auto"}
                onClick={() => setToTargetMode("auto")}
                emoji="🤖"
                label="Auto Target"
              />
              <ObjectiveBtn
                active={toTargetMode === "custom"}
                onClick={() => setToTargetMode("custom")}
                emoji="📍"
                label="Custom Target"
              />
            </div>
            {toTargetMode === "custom" ? (
              <>
                <input
                  type="text"
                  name="viral-custom-target"
                  autoComplete="off"
                  data-lpignore="true"
                  data-form-type="other"
                  value={toCustomTarget}
                  onChange={(e) =>
                    setToCustomTarget(e.target.value.slice(0, 200))
                  }
                  placeholder='e.g. "inside a blood vessel", "modern kitchen counter", "scalp with hair follicles"'
                  className="w-full p-3 rounded-lg text-sm outline-none mb-1"
                  style={{
                    background: "#fafaf7",
                    border: "1px solid #e8e0d8",
                    color: "#1a1a1a",
                  }}
                />
                <p className="text-[10px] text-gray-500 mb-4">
                  This becomes the literal background. AI extends with texture / lighting only.
                </p>
              </>
            ) : (
              <p className="text-[10px] text-gray-500 mb-4">
                AI picks the best background based on object + purpose.
              </p>
            )}

            <Label>6. Mode</Label>
            <div className="grid grid-cols-2 gap-2 mb-1">
              <ObjectiveBtn
                active={toMode === "i2v"}
                onClick={() => setToMode("i2v")}
                emoji="🖼️"
                label="Image → Video"
              />
              <ObjectiveBtn
                active={toMode === "t2v"}
                onClick={() => setToMode("t2v")}
                emoji="📝"
                label="Text → Video"
              />
            </div>
            <p className="text-[10px] text-gray-500 mb-4">
              {toMode === "i2v"
                ? "Generate banana-pro image first, then Veo uses it as start frame (pixel-identical character lock)."
                : "Skip image gen — Veo generates the video directly from prompt (faster, but character look varies)."}
            </p>

            <Label>7. Performance</Label>
            <div className="grid grid-cols-2 gap-2 mb-1">
              <ObjectiveBtn
                active={toPerformance === "action"}
                onClick={() => setToPerformance("action")}
                emoji="⚡"
                label="Action"
              />
              <ObjectiveBtn
                active={toPerformance === "standing"}
                onClick={() => setToPerformance("standing")}
                emoji="🎙️"
                label="Standing"
              />
            </div>
            <p className="text-[10px] text-gray-500 mb-4">
              {toPerformance === "action"
                ? "Character actively performs its function (combat free radicals, strengthen hair roots, etc.) — drives engagement."
                : "Clean talking-head — character stands calmly with subtle gestures. Use when scene already tells the story."}
            </p>

            <Label>8. Dialog</Label>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <ObjectiveBtn
                active={toDialogMode === "auto"}
                onClick={() => setToDialogMode("auto")}
                emoji="🤖"
                label="Auto Dialog"
              />
              <ObjectiveBtn
                active={toDialogMode === "custom"}
                onClick={() => setToDialogMode("custom")}
                emoji="✍️"
                label="Custom Dialog"
              />
            </div>
            {toDialogMode === "custom" ? (
              <>
                <textarea
                  rows={3}
                  name="viral-custom-dialog"
                  autoComplete="off"
                  data-lpignore="true"
                  data-form-type="other"
                  value={toCustomDialog}
                  onChange={(e) =>
                    setToCustomDialog(e.target.value.slice(0, 400))
                  }
                  placeholder={
                    toLanguage === "ms"
                      ? 'Contoh: "Korang tau tak, aku Biotin, aku kuatkan akar rambut korang!"'
                      : 'Example: "Bet you didn\'t know I keep your hair roots strong every day!"'
                  }
                  className="w-full p-3 rounded-lg text-sm outline-none mb-1 resize-y"
                  style={{
                    background: "#fafaf7",
                    border: "1px solid #e8e0d8",
                    color: "#1a1a1a",
                    lineHeight: 1.5,
                  }}
                />
                <p className="text-[10px] text-gray-500 mb-4 text-right">
                  <span
                    className={
                      toCustomDialog.length > 380 ? "text-red-500 font-bold" : ""
                    }
                  >
                    {toCustomDialog.length}/400
                  </span>
                </p>
              </>
            ) : (
              <p className="text-[10px] text-gray-500 mb-4">
                LLM auto-generates the dialog line from object + objective + language.
              </p>
            )}

            <button
              onClick={submitTalkingObject}
              disabled={toBusy || !toObject.trim()}
              className="w-full py-3.5 rounded-xl font-extrabold text-base text-white transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
              style={{
                background: `linear-gradient(135deg, ${PURPLE} 0%, #b388ff 100%)`,
                boxShadow:
                  "0 6px 20px rgba(124,77,255,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
              }}
            >
              {toBusy ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating prompts + image + video…
                </span>
              ) : (
                <>🗣️ Generate Talking Object Video</>
              )}
            </button>

            {toError && (
              <div
                className="mt-3 px-4 py-2.5 rounded-lg text-xs font-semibold"
                style={{
                  background: "rgba(244,67,54,0.08)",
                  border: "1px solid rgba(244,67,54,0.4)",
                  color: "#c62828",
                }}
              >
                {toError}
              </div>
            )}
          </Card>
        </>
      )}

      {subFeature === "free" && (
      <>
      <Card borderColor={PURPLE}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Film className="w-5 h-5" style={{ color: PURPLE }} strokeWidth={2.4} />
            <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
              Viral Generator
            </span>
          </div>
          <span
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded"
            style={{ background: PURPLE_FAINT, color: PURPLE, border: `1px solid ${PURPLE_SOFT}` }}
          >
            {model === "veo" ? "8s · Veo" : "Per-sec · Grok"}
          </span>
        </div>

        <Label>Model</Label>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <ObjectiveBtn
            active={model === "veo"}
            onClick={() => setModel("veo")}
            emoji="🎬"
            label="Veo (8s)"
          />
          <ObjectiveBtn
            active={model === "grok"}
            onClick={() => setModel("grok")}
            emoji="⚡"
            label="Grok (per-sec)"
          />
        </div>

        <Label>Image Mode</Label>
        <Select
          value={imageMode}
          onChange={(v) => setImageMode(v as ImageMode)}
        >
          <option value="text">Text to Video (no image needed)</option>
          <option value="image">Image to Video (animate from image)</option>
        </Select>
      </Card>

      <Card>
        <div className="flex items-center gap-2.5 mb-4">
          <span className="text-lg">🎞️</span>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]">
            Scene
          </span>
        </div>

        {imageMode === "text" && (
          <div
            className="p-3 rounded-lg mb-4 text-center text-xs font-semibold"
            style={{
              background: PURPLE_FAINT,
              border: `1px dashed ${PURPLE_SOFT}`,
              color: PURPLE,
            }}
          >
            📝 Text only — no image needed
          </div>
        )}

        {imageMode === "image" && (
          <div className="mb-4">
            <Label>Reference Image *</Label>
            <input
              ref={refInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => readFile(e.target.files?.[0] || null)}
            />
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => refInputRef.current?.click()}
                className="relative w-20 h-20 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center"
                style={{
                  border: `2px dashed ${refImage ? "transparent" : PURPLE}`,
                  background: refImage ? "#000" : PURPLE_FAINT,
                }}
              >
                {refImage ? (
                  <img src={refImage} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl opacity-75">🖼️</span>
                )}
              </button>
              <div className="flex flex-col gap-1 justify-between">
                <SmallBtn onClick={() => setPickerOpen(true)}>History</SmallBtn>
                <SmallBtn onClick={() => refInputRef.current?.click()}>Upload</SmallBtn>
                <SmallBtn onClick={() => setRefImage("")} danger>
                  x
                </SmallBtn>
              </div>
            </div>
          </div>
        )}

        <Label>Prompt</Label>
        <textarea
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.substring(0, 5000))}
          maxLength={5000}
          placeholder="A cinematic slow-motion shot of…"
          className="w-full p-3.5 rounded-xl text-sm resize-y outline-none"
          style={{
            background: "#fafaf7",
            border: "1px solid #e8e0d8",
            color: "#1a1a1a",
            lineHeight: 1.5,
          }}
        />
        <p className="text-[10px] text-gray-500 mt-2 text-right">
          <span className={prompt.length > 4900 ? "text-red-500 font-bold" : ""}>
            {prompt.length}/5000
          </span>
        </p>
      </Card>

      <Card>
        {/* Veo runs at fixed 8s — no duration slider. Cost preview
            shows the approximate flat price (8 × admin per-sec rate). */}
        <div
          className="mb-4 p-3 rounded-lg flex items-center justify-between text-xs font-semibold"
          style={{
            background: PURPLE_FAINT,
            border: `1px dashed ${PURPLE_SOFT}`,
            color: PURPLE,
          }}
        >
          <span>⏱️ Veo runs at fixed 8 seconds.</span>
          {cost != null && (
            <span className="font-mono uppercase tracking-wider">
              ~RM{cost.toFixed(2)}
            </span>
          )}
        </div>

        <div className="mb-4">
          <Label>Size</Label>
          <Select value={aspect} onChange={(v) => setAspect(v)}>
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
          </Select>
        </div>

        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-3.5 rounded-xl font-extrabold text-base text-white transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:transform-none"
          style={{
            background: `linear-gradient(135deg, ${PURPLE} 0%, #b388ff 100%)`,
            boxShadow:
              "0 6px 20px rgba(124,77,255,0.35), inset 0 1px 0 rgba(255,255,255,0.2)",
          }}
        >
          {busy ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting…
            </span>
          ) : (
            <>🎬 Generate Viral (Veo · 8s)</>
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

      {pickerOpen && (
        <HistoryPicker
          onPick={(url) => {
            setRefImage(url);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      </>
      )}

      {/* Cinema Agent panel is mounted at dashboard-shell level so it
          persists across tab switches — see DashboardShell. */}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────
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
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3.5 py-2.5 rounded-lg text-sm font-semibold outline-none"
      style={{
        background: "#fafaf7",
        border: "1px solid #e8e0d8",
        color: "#1a1a1a",
      }}
    >
      {children}
    </select>
  );
}

function SubFeatureCard({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg p-3 text-left transition-all"
      style={{
        background: active ? PURPLE_FAINT : "#fafaf7",
        border: `2px solid ${active ? PURPLE : "#e8e0d8"}`,
        color: active ? PURPLE : "#1a1a1a",
      }}
    >
      <div className="text-sm font-extrabold">{title}</div>
      <div className="text-[10px] mt-0.5 opacity-70">{sub}</div>
    </button>
  );
}

function ViralFeatureBtn({
  active,
  disabled,
  emoji,
  label,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  emoji: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="rounded-lg py-2.5 px-3 text-center transition-all"
      style={{
        background: active ? PURPLE_FAINT : "#fafaf7",
        border: `2px solid ${active ? PURPLE : "#e8e0d8"}`,
        color: active ? PURPLE : disabled ? "#aaa" : "#1a1a1a",
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <div className="text-lg leading-none">{emoji}</div>
      <div className="text-[10px] font-bold mt-1 leading-tight">{label}</div>
    </button>
  );
}

function ObjectiveBtn({
  active,
  onClick,
  emoji,
  label,
}: {
  active: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg py-2.5 px-3 text-center transition-all"
      style={{
        background: active ? PURPLE_FAINT : "#fafaf7",
        border: `2px solid ${active ? PURPLE : "#e8e0d8"}`,
        color: active ? PURPLE : "#1a1a1a",
      }}
    >
      <div className="text-base">{emoji}</div>
      <div className="text-[11px] font-bold mt-0.5">{label}</div>
    </button>
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
      className="px-2 py-1 rounded text-[10px] font-bold"
      style={
        danger
          ? {
              background: "rgba(244,67,54,0.08)",
              border: "1px solid rgba(244,67,54,0.4)",
              color: "#c62828",
            }
          : {
              background: PURPLE_FAINT,
              border: `1px solid ${PURPLE}`,
              color: PURPLE,
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
          border: `2px solid ${PURPLE}`,
          boxShadow: "0 20px 60px rgba(124,77,255,0.3)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "#e8e0d8" }}
        >
          <h2 className="font-display font-extrabold text-base" style={{ color: PURPLE }}>
            Pick Reference Image
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
              <Loader2
                className="w-5 h-5 animate-spin inline-block mr-2"
                style={{ color: PURPLE }}
              />
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
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = PURPLE)}
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
