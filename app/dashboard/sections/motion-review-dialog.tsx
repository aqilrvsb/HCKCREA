"use client";

// Motion Edit Video — step 2 of the 2-step flow. The script + captions are
// ready (History card in "review", yellow border): the client reads every
// line, fixes anything wrong, then "Jana Video" (/api/motion/render) cuts the
// video, lets the AI plan the edit on those words and renders it. (Drafts made
// before step 1 was slimmed down also show their hook / stickers / CTA.)

import { useMemo, useState } from "react";
import { Clapperboard, Loader2, ShieldAlert, X } from "lucide-react";
import Portal from "./portal";
import { captionLines, EDITABLE_OVERLAY, type DraftEdits, type DraftWord } from "@/lib/motion-review";

export type ReviewDraft = {
  words?: DraftWord[];
  plan?: {
    hook?: { text?: string; sub?: string } | null;
    rehook?: { text?: string } | null;
    cta?: { text?: string; sub?: string } | null;
    overlays?: { t?: string; text?: string; sub?: string }[];
  };
  flagged_speech?: string;
  flagged_words?: string[];
  /** false = captions off: the lines are the script the AI plans from */
  captions?: boolean;
};

const OVERLAY_LABEL: Record<string, string> = {
  headline: "Tajuk", tag: "Tag", stamp: "Cop", chip: "Chip", tape: "Pita", scribble: "Conteng", note: "Nota", check: "Senarai ✓",
  bigword: "Perkataan besar", callout: "Belon cakap", arrow: "Anak panah", point: "Tunjuk", circle: "Bulatan", underline: "Garis bawah",
  counter: "Nombor", price: "Harga", cta: "CTA",
};
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const inputCls = "w-full px-3 py-2 rounded-lg text-[12px] outline-none";
const inputStyle = { border: "1px solid var(--color-border)", background: "var(--color-bg)", color: "var(--color-text-primary)" } as const;
const changedStyle = { border: "1px solid #facc15", background: "rgba(250,204,21,0.08)", color: "var(--color-text-primary)" } as const;

export default function MotionReviewDialog({ id, draft, onClose, onDone }: {
  id: string;
  draft: ReviewDraft;
  onClose: () => void;
  onDone: () => void;
}) {
  const lines = useMemo(() => captionLines(draft.words ?? []), [draft.words]);
  const capsOn = draft.captions !== false;
  const plan = draft.plan ?? {};
  const overlays = (plan.overlays ?? []).map((o, k) => ({ o, k })).filter(({ o }) => EDITABLE_OVERLAY.has(String(o.t)) && o.text);
  const [lineEdits, setLineEdits] = useState<Record<string, string>>({});
  const [hook, setHook] = useState({ text: plan.hook?.text ?? "", sub: plan.hook?.sub ?? "" });
  const [rehook, setRehook] = useState(plan.rehook?.text ?? "");
  const [cta, setCta] = useState({ text: plan.cta?.text ?? "", sub: plan.cta?.sub ?? "" });
  const [ovEdits, setOvEdits] = useState<Record<string, { text?: string; sub?: string }>>({});
  const [busy, setBusy] = useState(false);
  const changed = Object.keys(lineEdits).filter((k) => lineEdits[k] !== lines[Number(k)]?.text).length;

  async function render() {
    if (busy) return;
    setBusy(true);
    try {
      const edits: DraftEdits = {
        lines: Object.fromEntries(Object.entries(lineEdits).filter(([k, v]) => v !== lines[Number(k)]?.text)),
        overlays: ovEdits,
        ...(plan.hook ? { hook } : {}),
        ...(plan.rehook ? { rehook } : {}),
        ...(plan.cta ? { cta } : {}),
      };
      const r = await fetch("/api/motion/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, edits }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) { alert(d?.error || `Gagal jana video (HTTP ${r.status})`); return; }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const label = "block text-[10px] uppercase tracking-widest font-bold text-[var(--color-text-secondary)] mb-1.5";
  return (
    <Portal>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-3" style={{ background: "rgba(0,0,0,0.75)" }} onClick={() => !busy && onClose()}>
        <div className="w-full max-w-xl rounded-2xl flex flex-col max-h-[92vh]" style={{ background: "var(--color-bg-card)", border: "2px solid #facc15" }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 px-5 pt-4 pb-2">
            <span className="text-[14px] font-extrabold text-[var(--color-text-primary)]">📝 {capsOn ? "Semak skrip & caption" : "Semak skrip"}</span>
            <button type="button" onClick={onClose} disabled={busy} className="ml-auto p-1 rounded-lg disabled:opacity-40" aria-label="Tutup">
              <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
            </button>
          </div>
          <p className="px-5 text-[11px] text-[var(--color-text-muted)] leading-snug mb-3">
            {capsOn
              ? "Betulkan apa-apa ejaan / ayat yang salah. Caption dalam video ikut tepat apa yang ada di sini — suara anda tidak diubah, cuma tulisan pada skrin."
              : "Betulkan apa-apa ejaan / ayat yang salah. Caption dimatikan — AI guna skrip ini untuk rancang hook & sticker video."}
            {!draft.plan && " Hook, sticker & B-roll dirancang AI selepas anda klik Jana Video."}
          </p>

          <div className="px-5 pb-3 overflow-y-auto space-y-4">
            {(draft.flagged_speech || (draft.flagged_words?.length ?? 0) > 0) && (
              <div className="rounded-xl p-3 text-[11px] leading-snug" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.45)" }}>
                <span className="flex items-center gap-1.5 font-extrabold text-amber-500 mb-1"><ShieldAlert className="w-3.5 h-3.5" /> Guideline TikTok — semak sebelum jana</span>
                {draft.flagged_speech && <span className="block text-[var(--color-text-secondary)]"><b>Ayat mungkin langgar:</b> &quot;{draft.flagged_speech.slice(0, 300)}&quot;</span>}
                {(draft.flagged_words?.length ?? 0) > 0 && <span className="block text-[var(--color-text-secondary)] mt-0.5"><b>Perkataan berisiko:</b> {draft.flagged_words!.slice(0, 15).join(", ")}</span>}
              </div>
            )}

            {plan.hook && (
              <div>
                <span className={label}>Hook (3 saat pertama)</span>
                <input className={inputCls} style={hook.text !== (plan.hook.text ?? "") ? changedStyle : inputStyle} value={hook.text} maxLength={60}
                  onChange={(e) => setHook((h) => ({ ...h, text: e.target.value }))} placeholder="Hook" />
                <input className={`${inputCls} mt-1.5`} style={hook.sub !== (plan.hook.sub ?? "") ? changedStyle : inputStyle} value={hook.sub} maxLength={60}
                  onChange={(e) => setHook((h) => ({ ...h, sub: e.target.value }))} placeholder="Sub-hook (optional)" />
              </div>
            )}

            <div>
              <span className={label}>{capsOn ? "Caption" : "Skrip"} — ayat yang anda tuturkan ({lines.length} baris{changed ? `, ${changed} diubah` : ""})</span>
              <div className="space-y-1.5">
                {lines.map((ln, k) => {
                  const v = lineEdits[String(k)] ?? ln.text;
                  return (
                    <div key={k} className="flex gap-2 items-start">
                      <span className="text-[10px] font-mono text-[var(--color-text-muted)] pt-2 w-9 flex-shrink-0">{mmss(ln.start)}</span>
                      <textarea rows={Math.max(1, Math.ceil(v.length / 52))} className={`${inputCls} resize-none leading-snug`}
                        style={v !== ln.text ? changedStyle : inputStyle} value={v}
                        onChange={(e) => setLineEdits((m) => ({ ...m, [String(k)]: e.target.value.replace(/\n/g, " ") }))} />
                    </div>
                  );
                })}
              </div>
            </div>

            {overlays.length > 0 && (
              <div>
                <span className={label}>Teks pada video (sticker)</span>
                <div className="space-y-1.5">
                  {overlays.map(({ o, k }) => {
                    const ed = ovEdits[String(k)] ?? {};
                    const text = ed.text ?? o.text ?? "";
                    return (
                      <div key={k} className="flex gap-2 items-center">
                        <span className="text-[10px] font-bold text-[var(--color-text-muted)] w-20 flex-shrink-0 truncate">{OVERLAY_LABEL[String(o.t)] ?? o.t}</span>
                        <input className={inputCls} style={text !== (o.text ?? "") ? changedStyle : inputStyle} value={text} maxLength={80}
                          onChange={(e) => setOvEdits((m) => ({ ...m, [String(k)]: { ...m[String(k)], text: e.target.value } }))} />
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Kosongkan teks untuk buang sticker itu.</p>
              </div>
            )}

            {(plan.rehook || plan.cta) && (
              <div className="grid sm:grid-cols-2 gap-3">
                {plan.rehook && (
                  <div>
                    <span className={label}>Re-hook (tengah video)</span>
                    <input className={inputCls} style={rehook !== (plan.rehook.text ?? "") ? changedStyle : inputStyle} value={rehook} maxLength={40} onChange={(e) => setRehook(e.target.value)} />
                  </div>
                )}
                {plan.cta && (
                  <div>
                    <span className={label}>CTA (hujung video)</span>
                    <input className={inputCls} style={cta.text !== (plan.cta.text ?? "") ? changedStyle : inputStyle} value={cta.text} maxLength={40}
                      onChange={(e) => setCta((c) => ({ ...c, text: e.target.value }))} />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 px-5 py-4 border-t" style={{ borderColor: "var(--color-border)" }}>
            <button type="button" onClick={onClose} disabled={busy} className="py-2.5 rounded-xl text-[12px] font-bold disabled:opacity-40"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
              Tutup (sambung nanti)
            </button>
            <button type="button" onClick={() => void render()} disabled={busy}
              className="py-2.5 rounded-xl text-[12px] font-extrabold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #22c55e, #4ade80)" }}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
              {busy ? "Menghantar…" : "🎬 Jana Video"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
