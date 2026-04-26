"use client";

import { useState } from "react";
import { Film, Mic, Sparkles, Copy, Save, Upload, ArrowRight } from "lucide-react";

// UGC Prompt Builder — V2 Master JSON System (port from creative-hack-auto)
// Five blocks the user fills: Shot Type / Subject / Action / Dialog (0-2 / 2-6 / 6-8) / Tone+Voice / Style
// "Build Prompt" assembles into a polished Veo 3.1-ready string.
// "Use in Video" stashes to localStorage so the Video tab picks it up.

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
    const dialog = [
      hook ? `0-2s: "${hook}"` : "",
      middle ? `2-6s: "${middle}"` : "",
      cta ? `6-8s: "${cta}"` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = [
      `[SHOT TYPE]`,
      shot,
      ``,
      `[SUBJECT]`,
      subject,
      ``,
      `[ACTION]`,
      action,
      ``,
      `[DIALOG SCRIPT — Bahasa Melayu]`,
      dialog || "(no dialog)",
      ``,
      `[TONE]`,
      tone,
      ``,
      `[VOICE]`,
      voice,
      ``,
      `[STYLE]`,
      style,
    ].join("\n");

    setOutput(prompt);
    setCopied(false);
  }

  async function copy() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function useInVideo() {
    // Build the prompt if not already built, then push it directly into the
    // Video Generator below us via a custom event. Same-page handoff — no
    // tab switching needed because UGC is rendered above VideoTab.
    let final = output;
    if (!final) {
      // Synthesize the same string build() would create (build() is async via
      // setState so we can't read output immediately). Inline minimal version:
      const dialog = [
        hook ? `0-2s: "${hook}"` : "",
        middle ? `2-6s: "${middle}"` : "",
        cta ? `6-8s: "${cta}"` : "",
      ].filter(Boolean).join("\n");
      final = [
        "[SHOT TYPE]", shot, "",
        "[SUBJECT]", subject, "",
        "[ACTION]", action, "",
        "[DIALOG]", dialog || "(no dialog)", "",
        `[TONE] ${tone}`,
        `[VOICE] ${voice}`,
        "",
        "[STYLE]", style,
      ].join("\n");
      setOutput(final);
    }
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-[var(--color-border)]">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center"
          style={{
            background: "rgba(37,244,238,0.1)",
            border: "1px solid rgba(37,244,238,0.3)",
          }}
        >
          <Sparkles className="w-5 h-5" style={{ color: "#25f4ee" }} strokeWidth={2.4} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">
            UGC Prompt Builder
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            5-Part Veo 3.1 Formula — Shot, Subject, Action, Dialog, Style
          </p>
        </div>
      </div>

      {/* 1. Scene Setup */}
      <Card title="Scene Setup" icon={<Film className="w-4 h-4" />}>
        <Label>Shot Type</Label>
        <PresetRow presets={SHOT_PRESETS} active={shot} onPick={setShot} />
        <input
          className="input mt-2"
          value={shot}
          onChange={(e) => setShot(e.target.value)}
        />

        <Label className="mt-4">Subject (from reference image)</Label>
        <input
          className="input"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
          Veo 3.1 follows the reference image for character + product
        </p>

        <Label className="mt-4">Action</Label>
        <PresetRow presets={ACTION_PRESETS} active={action} onPick={setAction} />
        <textarea
          className="input mt-2"
          rows={2}
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
      </Card>

      {/* 2. Dialog Script */}
      <Card title="Dialog Script" icon={<Mic className="w-4 h-4" />} badge="8 seconds">
        <div className="space-y-3">
          <div>
            <Label color="#22d3ee">0-2s · Beginning (Hook)</Label>
            <input
              className="input"
              placeholder='e.g. "Ini rahsia cik somi balik awal!"'
              value={hook}
              onChange={(e) => setHook(e.target.value)}
            />
          </div>
          <div>
            <Label color="#fb923c">2-6s · Middle (Value)</Label>
            <textarea
              className="input"
              rows={2}
              placeholder='e.g. "Ramai kawan complain cik somi dia selalu balik lewat..."'
              value={middle}
              onChange={(e) => setMiddle(e.target.value)}
            />
          </div>
          <div>
            <Label color="#f87171">6-8s · Closing (CTA)</Label>
            <input
              className="input"
              placeholder='e.g. "Order yang ni, baru puas hati!"'
              value={cta}
              onChange={(e) => setCta(e.target.value)}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {CTA_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setCta(p.val)}
                  className="text-[10px] font-bold px-2 py-1 rounded-md transition-colors"
                  style={{
                    background: "rgba(255,87,34,0.1)",
                    color: "var(--color-orange)",
                    border: "1px solid rgba(255,87,34,0.3)",
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* 3. Tone + Voice + Style */}
      <Card title="Tone, Voice & Style" icon={<Mic className="w-4 h-4" />}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Tone</Label>
            <select className="input" value={tone} onChange={(e) => setTone(e.target.value)}>
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Voice</Label>
            <select className="input" value={voice} onChange={(e) => setVoice(e.target.value)}>
              {VOICES.map((v) => (
                <option key={v.label} value={v.val}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Label className="mt-4">Style</Label>
        <PresetRow presets={STYLE_PRESETS} active={style} onPick={setStyle} />
        <textarea
          className="input mt-2"
          rows={2}
          value={style}
          onChange={(e) => setStyle(e.target.value)}
        />
      </Card>

      {/* Build + Output */}
      <div
        className="rounded-2xl p-5 border"
        style={{
          background:
            "linear-gradient(135deg, rgba(37,244,238,0.06) 0%, rgba(37,244,238,0.02) 100%)",
          borderColor: "rgba(37,244,238,0.3)",
        }}
      >
        <button
          onClick={build}
          className="w-full py-3 rounded-xl font-extrabold text-base flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]"
          style={{
            background: "linear-gradient(135deg, #25f4ee 0%, #00bcd4 100%)",
            color: "#000",
            boxShadow: "0 6px 20px rgba(37,244,238,0.3)",
          }}
        >
          <Sparkles className="w-4 h-4" />
          Build Prompt
        </button>

        <textarea
          className="input mt-3 font-mono text-xs"
          rows={14}
          readOnly
          value={output}
          placeholder="Built prompt will appear here…"
          style={{
            background: "#0a0a0a",
            color: "#25f4ee",
            borderColor: "rgba(37,244,238,0.4)",
          }}
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <ToolBtn onClick={copy} color="#25f4ee">
            <Copy className="w-3.5 h-3.5" />
            {copied ? "Copied!" : "Copy"}
          </ToolBtn>
          <ToolBtn onClick={useInVideo} color="#22c55e">
            <ArrowRight className="w-3.5 h-3.5" />
            Use in Video
          </ToolBtn>
          <ToolBtn onClick={saveTemplate} color="#f59e0b">
            <Save className="w-3.5 h-3.5" />
            Save
          </ToolBtn>
          <label
            className="cursor-pointer flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors"
            style={{
              background: "rgba(136,136,136,0.1)",
              color: "#a8a8a8",
              border: "1px solid rgba(136,136,136,0.3)",
            }}
          >
            <Upload className="w-3.5 h-3.5" />
            Load
            <input type="file" accept=".json" onChange={loadTemplate} className="hidden" />
          </label>
        </div>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  badge,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-4 border"
      style={{
        background: "var(--color-bg-card)",
        borderColor: "rgba(37,244,238,0.2)",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div style={{ color: "#25f4ee" }}>{icon}</div>
        <h3 className="font-display font-bold text-sm text-[var(--color-text-primary)]">
          {title}
        </h3>
        {badge && (
          <span
            className="ml-auto text-[10px] font-mono uppercase tracking-wider font-bold px-2 py-0.5 rounded"
            style={{ color: "#25f4ee", background: "rgba(37,244,238,0.1)" }}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
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
      className={`text-[10px] font-mono uppercase tracking-widest font-bold mb-1.5 ${className || ""}`}
      style={{ color: color || "var(--color-text-muted)" }}
    >
      {children}
    </div>
  );
}

function PresetRow({
  presets,
  active,
  onPick,
}: {
  presets: { label: string; val: string }[];
  active: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map((p) => {
        const isActive = active === p.val;
        return (
          <button
            key={p.label}
            onClick={() => onPick(p.val)}
            className="text-[10px] font-bold px-2.5 py-1.5 rounded-md transition-all"
            style={
              isActive
                ? {
                    background: "rgba(37,244,238,0.15)",
                    color: "#25f4ee",
                    border: "1px solid rgba(37,244,238,0.4)",
                  }
                : {
                    background: "transparent",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                  }
            }
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
  children,
}: {
  onClick: () => void;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors hover:opacity-80"
      style={{
        background: `${color}1a`,
        color,
        border: `1px solid ${color}55`,
      }}
    >
      {children}
    </button>
  );
}
