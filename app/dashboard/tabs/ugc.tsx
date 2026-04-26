"use client";

import { useState } from "react";
import { Sparkles, Copy, Save, Upload, ArrowRight } from "lucide-react";

// UGC Prompt Builder — V2 (light theme, natural-language output).
// 5-block builder: Shot Type / Subject / Action / Dialog (0-2 / 2-6 / 6-8) /
// Tone+Voice+Style. "Build Prompt" assembles into a single Veo 3.1-ready
// paragraph; "Use in Video" dispatches the same prompt into the Video tab
// via a custom event.

const TEAL = "#25f4ee";
const TEAL_SOFT = "rgba(37, 244, 238, 0.18)";
const TEAL_FAINT = "rgba(37, 244, 238, 0.06)";
const ORANGE = "#ff5722";
const GREEN = "#22c55e";
const RED = "#f44336";

const SHOT_PRESETS = [
  { label: "Medium", val: "Medium shot, waist up" },
  { label: "Close-up", val: "Medium close-up, head and shoulders" },
  { label: "Wide", val: "Wide shot, full body standing" },
  { label: "Selfie", val: "Selfie-style handheld, slight camera shake, arm's length" },
  { label: "Low Angle", val: "Low-angle shot looking up, powerful and imposing" },
  { label: "Over Shoulder", val: "Over-the-shoulder shot, intimate perspective" },
  { label: "Product ECU", val: "Extreme close-up on product and hands" },
  { label: "Arc/Circle", val: "Arc shot, camera slowly circles around subject" },
];

const ACTION_PRESETS = [
  { label: "Hold + Smile", val: "She holds the product in her right hand facing the camera, smiles naturally, and speaks directly to camera with gentle hand gestures." },
  { label: "Demo", val: "She demonstrates the product, showing it from different angles while speaking to camera." },
  { label: "Unbox", val: "She opens the product and shows the contents to camera while speaking excitedly." },
  { label: "Use", val: "She applies the product while speaking to camera, showing real usage." },
];

const CTA_PRESETS = [
  { label: "Order sekarang", val: "Order sekarang, stok terhad!" },
  { label: "Tekan bawah", val: "Tekan butang kat bawah kalau nak order!" },
  { label: "COD", val: "Cepat kak, barang sampai baru bayar!" },
  { label: "Jom cuba", val: "Jom cuba, takkan rugi!" },
  { label: "Link bawah", val: "Link kat bawah, grab sekarang!" },
];

const STYLE_PRESETS = [
  { label: "Cinematic", val: "Soft natural lighting, shallow depth of field, cinematic film look, audio dialogue only, clean vertical frame." },
  { label: "UGC Raw", val: "Bright natural daylight, iPhone quality, casual UGC feel, handheld slight shake, audio dialogue only, clean frame." },
  { label: "Golden Hour", val: "Warm golden hour lighting, dreamy bokeh background, soft warm tones, audio dialogue only, clean vertical frame." },
  { label: "Moody", val: "Moody low-key lighting, dramatic shadows, high contrast, intimate atmosphere, audio dialogue only, clean frame." },
  { label: "Studio", val: "Clean studio lighting, white background, professional product focus, sharp details, audio dialogue only." },
];

const VOICES = [
  { label: "Perempuan 20an", val: "young Malay woman voice in her 20s, cheerful and trendy" },
  { label: "Makcik", val: "middle-aged Malay woman voice, warm motherly tone, 40s" },
  { label: "Nenek", val: "elderly Malay grandmother voice, gentle and wise, 60s" },
  { label: "Lelaki 20an", val: "young Malay man voice in his 20s, confident and casual" },
  { label: "Pakcik", val: "middle-aged Malay man voice, authoritative and friendly, 40s" },
  { label: "Atuk", val: "elderly Malay grandfather voice, calm and wise, 60s" },
  { label: "Kanak Perempuan", val: "young Malay girl voice, cute and innocent, 8 years old" },
  { label: "Kanak Lelaki", val: "young Malay boy voice, playful and energetic, 8 years old" },
];

const TONES = ["santai", "excited", "confident", "friendly", "urgent", "storytelling"];

// Always-appended "lock" paragraph keeping Veo on-brief.
const LOCK_BLOCK =
  "The character speaks directly to camera with clear voice. NO background music, NO instrumental, NO sound effects. All audio is spoken dialog only. NO subtitles or text overlays, NO on-screen dialogue text. Reduce contrast, natural skintone, soft highlights, low contrast, soft colors, natural tone, film look, soft light. Clean vertical video frame with no interface overlay, no icons, no overlay elements.";

// Stitch all the inputs into a natural-language Veo 3.1 prompt. No bracketed
// section tags — just flowing sentences, the way the user wants it.
function buildPrompt(args: {
  shot: string;
  subject: string;
  action: string;
  hook: string;
  middle: string;
  cta: string;
  tone: string;
  voice: string;
  style: string;
}): string {
  const sceneLine = [args.shot, args.subject].filter(Boolean).join(", ");
  const head = [sceneLine, args.action].filter(Boolean).join(". ");
  const dialogLines = [
    args.hook ? `0–2s: "${args.hook}"` : "",
    args.middle ? `2–6s: "${args.middle}"` : "",
    args.cta ? `6–8s: "${args.cta}"` : "",
  ].filter(Boolean);
  const dialogBlock = dialogLines.length
    ? "Spoken dialog:\n" + dialogLines.join("\n")
    : "";
  const tvs = [
    args.tone ? `Tone: ${args.tone}` : "",
    args.voice ? `Voice: ${args.voice}` : "",
    args.style ? `Style: ${args.style}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return [head, dialogBlock, tvs, LOCK_BLOCK]
    .filter(Boolean)
    .join("\n\n");
}

export default function UgcTab() {
  const [shot, setShot] = useState(SHOT_PRESETS[0].val);
  const [subject, setSubject] = useState(
    "same person from reference image, same appearance, holding the same product"
  );
  const [action, setAction] = useState(ACTION_PRESETS[0].val);
  const [hook, setHook] = useState("");
  const [middle, setMiddle] = useState("");
  const [cta, setCta] = useState("");
  const [tone, setTone] = useState("santai");
  const [voice, setVoice] = useState(VOICES[0].val);
  const [style, setStyle] = useState(STYLE_PRESETS[0].val);
  const [output, setOutput] = useState("");
  const [copied, setCopied] = useState(false);

  function build() {
    setOutput(buildPrompt({ shot, subject, action, hook, middle, cta, tone, voice, style }));
    setCopied(false);
  }

  async function copy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function useInVideo() {
    const final =
      output || buildPrompt({ shot, subject, action, hook, middle, cta, tone, voice, style });
    if (!output) setOutput(final);
    window.dispatchEvent(new CustomEvent("ugc:hand-off", { detail: final }));
  }

  function saveTemplate() {
    const data = { shot, subject, action, hook, middle, cta, tone, voice, style };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ugc-template-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function loadTemplate(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(String(ev.target?.result || "{}"));
        if (d.shot) setShot(d.shot);
        if (d.subject) setSubject(d.subject);
        if (d.action) setAction(d.action);
        if (d.hook !== undefined) setHook(d.hook);
        if (d.middle !== undefined) setMiddle(d.middle);
        if (d.cta !== undefined) setCta(d.cta);
        if (d.tone) setTone(d.tone);
        if (d.voice) setVoice(d.voice);
        if (d.style) setStyle(d.style);
      } catch {}
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  return (
    <div className="space-y-4" style={{ color: "#1a1a1a" }}>
      {/* 1. Scene Setup */}
      <Card borderColor={TEAL}>
        <CardHeader icon="🎬" title="Scene Setup" badge="5-Part Veo Formula" badgeColor={TEAL} />

        <Label>Shot Type</Label>
        <PresetRow
          presets={SHOT_PRESETS}
          active={shot}
          onPick={setShot}
          activeColor={TEAL}
          inactiveColor="#1a1a1a"
        />
        <Field
          value={shot}
          onChange={setShot}
          rows={1}
        />

        <Label className="mt-4">Subject (from reference image)</Label>
        <Field value={subject} onChange={setSubject} rows={1} />
        <p className="text-[10px] text-gray-500 mt-1">
          Veo follows your reference image for character + product
        </p>

        <Label className="mt-4">Action</Label>
        <PresetRow
          presets={ACTION_PRESETS}
          active={action}
          onPick={setAction}
          activeColor={ORANGE}
          inactiveColor="#1a1a1a"
        />
        <Field value={action} onChange={setAction} rows={2} />
      </Card>

      {/* 2. Dialog Script */}
      <Card borderColor={TEAL}>
        <CardHeader icon="💬" title="Dialog Script" badge="8 seconds" badgeColor={TEAL} />

        <Label color={GREEN}>0-2s: Beginning</Label>
        <Field
          value={hook}
          onChange={setHook}
          placeholder='e.g. "Ini rahsia cik somi balik awal!"'
          rows={1}
        />

        <Label color={ORANGE} className="mt-3">
          2-6s: Middle
        </Label>
        <Field
          value={middle}
          onChange={setMiddle}
          placeholder='e.g. "Ramai kawan complain cik somi dia selalu balik lewat..."'
          rows={2}
        />

        <Label color={RED} className="mt-3">
          6-8s: Closing
        </Label>
        <Field
          value={cta}
          onChange={setCta}
          placeholder='e.g. "Order yang ni, baru puas hati!"'
          rows={1}
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {CTA_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setCta(p.val)}
              className="text-[10px] font-bold px-2.5 py-1 rounded-md transition-colors"
              style={{
                background: "#fafaf7",
                color: "#1a1a1a",
                border: "1px solid #e8e0d8",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Card>

      {/* 3. Tone, Voice & Style */}
      <Card borderColor={TEAL}>
        <CardHeader icon="🎙️" title="Tone, Voice & Style" />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tone</Label>
            <Select value={tone} onChange={setTone}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Voice</Label>
            <Select value={voice} onChange={setVoice}>
              {VOICES.map((v) => (
                <option key={v.label} value={v.val}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Label className="mt-4">Style</Label>
        <PresetRow
          presets={STYLE_PRESETS}
          active={style}
          onPick={setStyle}
          activeColor={TEAL}
          inactiveColor="#1a1a1a"
        />
        <Field value={style} onChange={setStyle} rows={2} />
      </Card>

      {/* 4. Build + Output */}
      <Card borderColor={TEAL}>
        <button
          type="button"
          onClick={build}
          className="w-full py-3 rounded-xl font-extrabold text-base flex items-center justify-center gap-2 transition-transform hover:scale-[1.01]"
          style={{
            background: "linear-gradient(135deg, #d4f7d4, #a7e9a7)",
            color: "#1a4f1a",
            border: `1px solid ${GREEN}`,
          }}
        >
          ✍️ Build Prompt
        </button>

        <textarea
          rows={12}
          readOnly
          value={output}
          placeholder="Built prompt will appear here..."
          className="w-full mt-3 p-3 rounded-xl text-xs font-mono resize-y outline-none"
          style={{
            background: "#f0f5ec",
            border: "1px solid #d8e8d0",
            color: "#1a1a1a",
            lineHeight: 1.5,
          }}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <ToolBtn onClick={copy} color={GREEN}>
            <Copy className="w-3.5 h-3.5" />
            {copied ? "Copied!" : "Copy"}
          </ToolBtn>
          <ToolBtn onClick={useInVideo} color="#1a1a1a" plain>
            <ArrowRight className="w-3.5 h-3.5" />
            Use in Video
          </ToolBtn>
          <ToolBtn onClick={saveTemplate} color={ORANGE}>
            <Save className="w-3.5 h-3.5" />
            Save
          </ToolBtn>
          <label
            className="cursor-pointer flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
            style={{
              background: "#fafaf7",
              color: "#888",
              border: "1px solid #e8e0d8",
            }}
          >
            <Upload className="w-3.5 h-3.5" />
            Load
            <input type="file" accept=".json" onChange={loadTemplate} className="hidden" />
          </label>
        </div>
      </Card>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────
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
        border: `1px solid ${borderColor ? `${borderColor}40` : "#e8e0d8"}`,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 4px 16px -4px rgba(0,0,0,0.04)",
      }}
    >
      {children}
    </div>
  );
}

function CardHeader({
  icon,
  title,
  badge,
  badgeColor,
}: {
  icon: string;
  title: string;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="text-lg">{icon}</span>
      <span
        className="text-[13px] font-extrabold uppercase tracking-[0.06em]"
        style={{ color: "#1a1a1a" }}
      >
        {title}
      </span>
      {badge && (
        <span
          className="ml-auto text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full"
          style={{
            background: `${badgeColor || TEAL}10`,
            color: badgeColor || TEAL,
            border: `1px solid ${badgeColor || TEAL}50`,
          }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function Label({
  children,
  className,
  color,
}: {
  children: React.ReactNode;
  className?: string;
  color?: string;
}) {
  return (
    <div
      className={`text-[10px] font-extrabold uppercase tracking-[0.1em] mb-2 ${className || ""}`}
      style={{ color: color || "#888" }}
    >
      {children}
    </div>
  );
}

function Field({
  value,
  onChange,
  rows,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  if (rows && rows > 1) {
    return (
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full p-3 rounded-lg text-sm resize-y outline-none"
        style={{
          background: "#f0f5ec",
          border: "1px solid #d8e8d0",
          color: "#1a1a1a",
        }}
      />
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full p-3 rounded-lg text-sm outline-none"
      style={{
        background: "#f0f5ec",
        border: "1px solid #d8e8d0",
        color: "#1a1a1a",
      }}
    />
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
      className="w-full px-3 py-2.5 rounded-lg text-sm font-semibold outline-none"
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

function PresetRow({
  presets,
  active,
  onPick,
  activeColor,
  inactiveColor,
}: {
  presets: { label: string; val: string }[];
  active: string;
  onPick: (v: string) => void;
  activeColor: string;
  inactiveColor: string;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 mb-2">
      {presets.map((p) => {
        const isActive = active === p.val;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => onPick(p.val)}
            className="text-[11px] font-extrabold px-2 py-1.5 rounded-md transition-all text-center"
            style={{
              background: "transparent",
              color: isActive ? activeColor : inactiveColor,
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}

function ToolBtn({
  onClick,
  color,
  plain,
  children,
}: {
  onClick: () => void;
  color: string;
  plain?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-extrabold"
      style={
        plain
          ? {
              background: "#ffffff",
              color: "#1a1a1a",
              border: "1px solid #e8e0d8",
            }
          : {
              background: `${color}10`,
              color,
              border: `1px solid ${color}40`,
            }
      }
    >
      {children}
    </button>
  );
}
