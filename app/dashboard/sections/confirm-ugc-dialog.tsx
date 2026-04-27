"use client";

import { useEffect, useState } from "react";
import {
  X,
  Loader2,
  Sparkles,
  Mic,
  User,
  Edit3,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

// Confirmation dialog shown by the UGC Agent before firing generations.
// User can edit any variant's persona / hook / structure / CTA / voice /
// gender / prompt before hitting Generate. Hitting Cancel does nothing —
// no credits charged.

type Variant = {
  scene: string;
  persona: string;
  hook: string;
  structure: string;
  cta: string;
  voice: string;
  gender: string;
  hijab?: string;
  age?: string;
  prompt: string;
  caption?: string;
};

type ConfirmPayload = {
  type: "confirm_generation";
  bucket: "ugc";
  params: {
    product_image_url: string;
    product_description: string;
    duration: string;
    aspect_ratio: string;
    variants: Variant[];
  };
  estimated_cost: number;
};

const VOICE_OPTIONS = [
  { id: "achernar", label: "Achernar (♀ soft high)" },
  { id: "callirrhoe", label: "Callirrhoe (♀ neutral)" },
  { id: "enceladus", label: "Enceladus (♀ mature warm)" },
  { id: "iapetus", label: "Iapetus (♀ Gen Z upbeat)" },
  { id: "achird", label: "Achird (♂ friendly mid)" },
  { id: "algenib", label: "Algenib (♂ gravelly low)" },
  { id: "charon", label: "Charon (♂ deep authoritative)" },
  { id: "gacrux", label: "Gacrux (♂ excited hype)" },
];

const PERSONA_OPTIONS = [
  { id: "casual-bestie", label: "Casual Bestie" },
  { id: "polished-pro", label: "Polished Pro" },
  { id: "comedic", label: "Comedic" },
  { id: "inspirational", label: "Inspirational" },
  { id: "confessional", label: "Confessional" },
  { id: "educational", label: "Educational" },
];

const HOOK_OPTIONS = [
  { id: "question", label: "Question" },
  { id: "bold-claim", label: "Bold Claim" },
  { id: "fear", label: "Fear/Loss" },
  { id: "curiosity", label: "Curiosity Gap" },
  { id: "social-proof", label: "Social Proof" },
  { id: "pattern-interrupt", label: "Pattern Interrupt" },
  { id: "promise", label: "Promise" },
];

const STRUCTURE_OPTIONS = [
  { id: "pas", label: "PAS" },
  { id: "aida", label: "AIDA" },
  { id: "bab", label: "Before-After-Bridge" },
  { id: "hero", label: "Hero's Journey" },
  { id: "star-story-solution", label: "Star-Story-Solution" },
];

const CTA_OPTIONS = [
  { id: "urgency", label: "Urgency" },
  { id: "scarcity", label: "Scarcity" },
  { id: "social-proof", label: "Social Proof" },
  { id: "bonus", label: "Bonus" },
  { id: "free-trial", label: "Free Trial" },
  { id: "pain-removal", label: "Pain Removal" },
  { id: "status", label: "Status" },
  { id: "direct", label: "Direct" },
];

export default function ConfirmUgcDialog({
  payload,
  conversationId,
  projectId,
  onClose,
  onFired,
}: {
  payload: ConfirmPayload;
  conversationId: string | null;
  projectId: string | null;
  onClose: () => void;
  onFired: (historyIds: string[], totalCost: number) => void;
}) {
  const [variants, setVariants] = useState<Variant[]>(
    payload.params.variants.map((v) => ({ ...v }))
  );
  const [productImageUrl, setProductImageUrl] = useState(
    payload.params.product_image_url
  );
  const [duration, setDuration] = useState(payload.params.duration || "8");
  const [aspectRatio, setAspectRatio] = useState(
    payload.params.aspect_ratio || "9:16"
  );
  const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const ratePerVideo = payload.estimated_cost / variants.length;
  const totalCost = ratePerVideo * variants.length;

  function patchVariant(idx: number, patch: Partial<Variant>) {
    setVariants((prev) =>
      prev.map((v, i) => (i === idx ? { ...v, ...patch } : v))
    );
  }

  function removeVariant(idx: number) {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  }

  function toggleExpand(idx: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  async function fire() {
    setSubmitting(true);
    setErrorMessage("");
    try {
      const r = await fetch("/api/agent/ugc/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          conversation_id: conversationId,
          product_image_url: productImageUrl,
          product_description: payload.params.product_description,
          duration,
          aspect_ratio: aspectRatio,
          variants,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        setErrorMessage(j?.error || `HTTP ${r.status}`);
        return;
      }
      onFired(j.history_ids || [], j.total_cost || 0);
    } catch (e: any) {
      setErrorMessage(e?.message || "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 lg:left-[280px] z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden"
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
              style={{
                background:
                  "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
              }}
            >
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display font-extrabold text-base text-[var(--color-text-primary)]">
                Confirm UGC Generation
              </h2>
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-text-muted)]">
                {variants.length} variant{variants.length > 1 ? "s" : ""} · review and edit before firing
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top bar: shared params */}
        <div
          className="px-5 py-3 border-b grid grid-cols-2 lg:grid-cols-4 gap-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <Label>Product reference</Label>
            {productImageUrl ? (
              <div className="flex items-center gap-2">
                <img
                  src={productImageUrl}
                  alt=""
                  className="w-10 h-10 object-cover rounded"
                />
                <button
                  onClick={() => setProductImageUrl("")}
                  className="text-[10px] text-red-400"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="text-[10px] text-[var(--color-text-muted)]">
                None — t2v mode
              </div>
            )}
          </div>
          <div>
            <Label>Duration</Label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg text-xs font-semibold outline-none"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="8">8 seconds</option>
            </select>
          </div>
          <div>
            <Label>Aspect</Label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg text-xs font-semibold outline-none"
              style={{
                background: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="9:16">9:16 vertical</option>
              <option value="1:1">1:1 square</option>
              <option value="16:9">16:9 wide</option>
            </select>
          </div>
          <div>
            <Label>Total cost</Label>
            <div className="text-sm font-display font-extrabold text-[var(--color-text-primary)]">
              RM {totalCost.toFixed(2)}
            </div>
            <div className="text-[10px] text-[var(--color-text-muted)]">
              {variants.length} × RM {ratePerVideo.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Variants list */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
          {variants.map((v, i) => {
            const isExpanded = expanded.has(i);
            return (
              <div
                key={i}
                className="rounded-xl"
                style={{
                  background: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {/* Header strip */}
                <div className="flex items-center gap-2 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider font-extrabold text-[var(--color-text-secondary)] w-6">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-[var(--color-text-primary)] truncate">
                      {labelOf(PERSONA_OPTIONS, v.persona)} · {labelOf(HOOK_OPTIONS, v.hook)} · {labelOf(STRUCTURE_OPTIONS, v.structure)}
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                      {v.scene} · {v.gender} · {labelOf(VOICE_OPTIONS, v.voice)} · {labelOf(CTA_OPTIONS, v.cta)} CTA
                    </div>
                  </div>
                  <button
                    onClick={() => toggleExpand(i)}
                    className="w-7 h-7 rounded flex items-center justify-center"
                    style={{
                      color: "var(--color-text-secondary)",
                    }}
                    title={isExpanded ? "Collapse" : "Edit"}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <Edit3 className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {variants.length > 1 && (
                    <button
                      onClick={() => removeVariant(i)}
                      className="w-7 h-7 rounded flex items-center justify-center text-red-400"
                      title="Remove variant"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Edit zone */}
                {isExpanded && (
                  <div
                    className="px-3 pb-3 pt-1 space-y-2 border-t"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <div className="grid grid-cols-2 gap-2 pt-3">
                      <Field label="Persona">
                        <Select
                          value={v.persona}
                          onChange={(val) => patchVariant(i, { persona: val })}
                          options={PERSONA_OPTIONS}
                        />
                      </Field>
                      <Field label="Hook">
                        <Select
                          value={v.hook}
                          onChange={(val) => patchVariant(i, { hook: val })}
                          options={HOOK_OPTIONS}
                        />
                      </Field>
                      <Field label="Structure">
                        <Select
                          value={v.structure}
                          onChange={(val) => patchVariant(i, { structure: val })}
                          options={STRUCTURE_OPTIONS}
                        />
                      </Field>
                      <Field label="CTA">
                        <Select
                          value={v.cta}
                          onChange={(val) => patchVariant(i, { cta: val })}
                          options={CTA_OPTIONS}
                        />
                      </Field>
                      <Field label="Voice">
                        <Select
                          value={v.voice}
                          onChange={(val) => patchVariant(i, { voice: val })}
                          options={VOICE_OPTIONS}
                        />
                      </Field>
                      <Field label="Gender">
                        <Select
                          value={v.gender}
                          onChange={(val) => patchVariant(i, { gender: val })}
                          options={[
                            { id: "female", label: "Female" },
                            { id: "male", label: "Male" },
                          ]}
                        />
                      </Field>
                      <Field label="Hijab">
                        <Select
                          value={v.hijab || "no"}
                          onChange={(val) => patchVariant(i, { hijab: val })}
                          options={[
                            { id: "no", label: "No hijab" },
                            { id: "yes", label: "Hijab" },
                          ]}
                        />
                      </Field>
                      <Field label="Age">
                        <Select
                          value={v.age || "20s"}
                          onChange={(val) => patchVariant(i, { age: val })}
                          options={[
                            { id: "20s", label: "20s" },
                            { id: "30s", label: "30s" },
                            { id: "40s", label: "40s" },
                          ]}
                        />
                      </Field>
                    </div>
                    <Field label="Prompt (the agent built this — edit if you want)">
                      <textarea
                        rows={6}
                        value={v.prompt}
                        onChange={(e) =>
                          patchVariant(i, { prompt: e.target.value })
                        }
                        className="w-full p-2 rounded-lg text-[11px] font-mono leading-relaxed resize-y outline-none"
                        style={{
                          background: "var(--color-bg-card)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-text-primary)",
                        }}
                      />
                    </Field>
                    {v.caption !== undefined && (
                      <Field label="Caption">
                        <input
                          value={v.caption}
                          onChange={(e) =>
                            patchVariant(i, { caption: e.target.value })
                          }
                          className="w-full px-2 py-1.5 rounded-lg text-xs outline-none"
                          style={{
                            background: "var(--color-bg-card)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-text-primary)",
                          }}
                        />
                      </Field>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {errorMessage && (
          <div
            className="px-5 py-2 text-xs"
            style={{
              background: "rgba(239,68,68,0.1)",
              borderTop: "1px solid rgba(239,68,68,0.3)",
              color: "#ef4444",
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Footer */}
        <div
          className="px-5 py-4 border-t flex items-center justify-end gap-2"
          style={{
            borderColor: "var(--color-border)",
            background: "var(--color-bg)",
          }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={fire}
            disabled={submitting || variants.length === 0}
            className="px-5 py-2 rounded-lg text-xs font-extrabold uppercase tracking-wider text-white disabled:opacity-50 inline-flex items-center gap-2"
            style={{
              background:
                "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
              boxShadow: "0 4px 14px rgba(34,197,94,0.3)",
            }}
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Firing…
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Generate {variants.length} · RM {totalCost.toFixed(2)}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-mono uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (val: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 rounded-lg text-xs font-semibold outline-none"
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-primary)",
      }}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function labelOf(
  options: { id: string; label: string }[],
  id: string
): string {
  return options.find((o) => o.id === id)?.label || id;
}
