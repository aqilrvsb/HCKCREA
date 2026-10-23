"use client";

// Motion Edit Video — step 2 of the 2-step flow. The script + captions are
// ready (History card in "review", yellow border): the client reads every
// line, fixes anything wrong, then "Jana Video" (/api/motion/render) cuts the
// video, lets the AI plan the edit on those words and renders it. (Drafts made
// before step 1 was slimmed down also show their hook / stickers / CTA.)
// mode "script" — the 📝 Skrip box of a finished video: read / fix the latest
// script and save it (/api/motion/script). The video isn't changed; Resubmit
// renders a new one from this script.

import { useMemo, useState } from "react";
import { Clapperboard, Loader2, Save, ShieldAlert, Upload, X } from "lucide-react";
import { uploadOwn } from "@/lib/upload-own";
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

export default function MotionReviewDialog({ id, draft, mode = "review", onClose, onDone }: {
  id: string;
  draft: ReviewDraft;
  mode?: "review" | "script";
  onClose: () => void;
  onDone: () => void;
}) {
  const lines = useMemo(() => captionLines(draft.words ?? []), [draft.words]);
  const capsOn = draft.captions !== false;
  const scriptMode = mode === "script";
  // the script box edits the words only (Resubmit plans the rest afresh)
  const plan: NonNullable<ReviewDraft["plan"]> = scriptMode ? {} : draft.plan ?? {};
  const overlays = (plan.overlays ?? []).map((o, k) => ({ o, k })).filter(({ o }) => EDITABLE_OVERLAY.has(String(o.t)) && o.text);
  const [lineEdits, setLineEdits] = useState<Record<string, string>>({});
  const [hook, setHook] = useState({ text: plan.hook?.text ?? "", sub: plan.hook?.sub ?? "" });
  const [rehook, setRehook] = useState(plan.rehook?.text ?? "");
  const [cta, setCta] = useState({ text: plan.cta?.text ?? "", sub: plan.cta?.sub ?? "" });
  const [ovEdits, setOvEdits] = useState<Record<string, { text?: string; sub?: string }>>({});
  // the required headline overlays this video gets (by its length): empty = the AI writes / picks it
  const dur = (draft.words ?? []).reduce((m, w) => Math.max(m, Number((w as { e?: number; t?: number }).e ?? (w as { t?: number }).t ?? 0)), 0);
  const slots: ("over" | "split" | "pip")[] = dur < 7 ? ["over"] : dur < 20 ? ["over", "split"] : dur < 45 ? ["over", "split", "pip"] : ["over", "split", "pip", "split"];
  const [heads, setHeads] = useState<Record<number, { lead?: string; big?: string; box?: string; url?: string; video?: boolean }>>({});
  const [upPct, setUpPct] = useState<Record<number, number>>({});
  const [upErr, setUpErr] = useState<string | null>(null);
  async function pickBroll(i: number, f: File | null) {
    if (!f) return;
    setUpErr(null);
    setUpPct((p) => ({ ...p, [i]: 0 }));
    try {
      const got = await uploadOwn(f, (n) => setUpPct((p) => ({ ...p, [i]: n })), "motion");
      setHeads((h) => ({ ...h, [i]: { ...h[i], url: got.url, video: got.video } }));
    } catch (e: any) {
      setUpErr(e?.message || "Upload gagal");
    } finally {
      setUpPct((p) => { const q = { ...p }; delete q[i]; return q; });
    }
  }
  const [busy, setBusy] = useState(false);
  const changed = Object.keys(lineEdits).filter((k) => lineEdits[k] !== lines[Number(k)]?.text).length;
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoN, setAutoN] = useState<number | null>(null);
  // ✨ the AI corrects misheard / misspelt words for this video's product + brief; lines the client edited stay theirs
  async function autoFix() {
    if (autoBusy || !draft.words?.length) return;
    setAutoBusy(true);
    try {
      const ws = draft.words.map((w) => String(w.w));
      const r = await fetch("/api/motion/caption-fix", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, words: ws }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) { alert(d?.error || "Auto betulkan gagal"); return; }
      const fx = new Map<number, string>((d.fixes as [number, string][]).map(([i, w]) => [Number(i), String(w)]));
      let k = 0;
      const next: Record<string, string> = { ...lineEdits };
      lines.forEach((ln, li) => {
        if (lineEdits[String(li)] !== undefined && lineEdits[String(li)] !== ln.text) return; // the client's own edit stays
        const t = ws.slice(ln.from, ln.to).map((w, j) => { const f = fx.get(ln.from + j); if (f && f !== w) { k++; return f; } return w; }).join(" ");
        if (t !== ln.text) next[String(li)] = t;
      });
      setLineEdits(next);
      setAutoN(k);
    } finally {
      setAutoBusy(false);
    }
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const changedLines = Object.fromEntries(Object.entries(lineEdits).filter(([k, v]) => v !== lines[Number(k)]?.text));
      const r = await fetch("/api/motion/script", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, lines: changedLines }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) { alert(d?.error || `Gagal simpan skrip (HTTP ${r.status})`); return; }
      onDone();
    } finally {
      setBusy(false);
    }
  }

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
        headlines: Object.entries(heads).map(([k, v]) => ({ i: Number(k), ...v })).filter((h) => h.lead || h.big || h.box || h.url),
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
        <div className="w-full max-w-xl rounded-2xl flex flex-col max-h-[92vh]" style={{ background: "var(--color-bg-card)", border: scriptMode ? "1px solid var(--color-border)" : "2px solid #facc15" }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 px-5 pt-4 pb-2">
            <span className="text-[14px] font-extrabold text-[var(--color-text-primary)]">📝 {scriptMode ? "Skrip video" : capsOn ? "Semak skrip & caption" : "Semak skrip"}</span>
            <button type="button" onClick={onClose} disabled={busy} className="ml-auto p-1 rounded-lg disabled:opacity-40" aria-label="Tutup">
              <X className="w-4 h-4 text-[var(--color-text-secondary)]" />
            </button>
          </div>
          <p className="px-5 text-[11px] text-[var(--color-text-muted)] leading-snug mb-3">
            {scriptMode
              ? "Skrip terkini video ini. Edit & simpan — video ini TIDAK berubah. Tekan Resubmit untuk jana video baru ikut skrip ini."
              : <>
                {capsOn
                  ? "Betulkan apa-apa ejaan / ayat yang salah. Caption dalam video ikut tepat apa yang ada di sini — suara anda tidak diubah, cuma tulisan pada skrin."
                  : "Betulkan apa-apa ejaan / ayat yang salah. Caption dimatikan — AI guna skrip ini untuk rancang hook & sticker video."}
                {!draft.plan && " Hook, sticker & B-roll dirancang AI selepas anda klik Jana Video."}
              </>}
          </p>

          <div className="px-5 pb-3 overflow-y-auto space-y-4">
            {!scriptMode && (draft.flagged_speech || (draft.flagged_words?.length ?? 0) > 0) && (
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
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className={label} style={{ marginBottom: 0 }}>{capsOn ? "Caption" : "Skrip"} — ayat yang anda tuturkan ({lines.length} baris{changed ? `, ${changed} diubah` : ""})</span>
                {!scriptMode && (
                  <button type="button" onClick={() => void autoFix()} disabled={autoBusy} className="ml-auto px-2.5 py-1 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1 disabled:opacity-60"
                    style={{ border: "1px solid #facc15", color: "#eab308" }} title="AI betulkan perkataan yang salah dengar / salah eja ikut produk & isi video">
                    {autoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "✨"} Auto betulkan (AI)
                  </button>
                )}
                {autoN !== null && !autoBusy && <span className="text-[10px] text-[var(--color-text-muted)]">{autoN ? `AI betulkan ${autoN} perkataan` : "AI tiada pembetulan"}</span>}
              </div>
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

            {!scriptMode && (
              <div>
                <span className={label}>🎬 Overlay — headline &amp; split-screen ({slots.length})</span>
                <p className="text-[10px] text-[var(--color-text-muted)] mb-1.5 leading-snug">
                  Kosongkan = <b>Auto</b> (AI tulis ikut isi video). Isi sendiri untuk teks yang tepat; AI letak pada ayat yang sesuai. Untuk split / sudut, boleh upload gambar / video B-roll sendiri.
                </p>
                {upErr && <p className="text-[11px] text-red-500 mb-1">{upErr}</p>}
                <div className="space-y-2">
                  {slots.map((kind, i) => {
                    const h = heads[i] ?? {};
                    const set = (k: "lead" | "big" | "box", v: string) => setHeads((m) => ({ ...m, [i]: { ...m[i], [k]: v } }));
                    const up = upPct[i];
                    return (
                      <div key={i} className="rounded-lg p-2 space-y-1" style={{ border: "1px solid var(--color-border)" }}>
                        <div className="text-[11px] font-extrabold text-[var(--color-text-primary)]">
                          {i + 1}. {kind === "over" ? "Headline atas orang" : kind === "split" ? "Split-screen (B-roll + orang)" : "Sudut — orang kecil bawah kanan"}
                        </div>
                        <input className={inputCls} style={h.lead ? changedStyle : inputStyle} value={h.lead ?? ""} maxLength={34} placeholder="Ayat pembuka (italic) — Auto" onChange={(e) => set("lead", e.target.value)} />
                        <input className={`${inputCls} font-extrabold uppercase`} style={h.big ? changedStyle : inputStyle} value={h.big ?? ""} maxLength={18} placeholder="PERKATAAN BESAR — AUTO" onChange={(e) => set("big", e.target.value)} />
                        <input className={inputCls} style={h.box ? changedStyle : inputStyle} value={h.box ?? ""} maxLength={34} placeholder="Ayat dalam kotak — Auto" onChange={(e) => set("box", e.target.value)} />
                        {kind !== "over" && (
                          <div className="flex items-center gap-2 flex-wrap">
                            <label className="relative px-2.5 py-1 rounded-lg text-[11px] font-extrabold text-white cursor-pointer inline-flex items-center gap-1" style={{ background: "linear-gradient(135deg, #22c55e, #4ade80)" }}>
                              {up !== undefined ? <><Loader2 className="w-3 h-3 animate-spin" /> {up}%</> : <><Upload className="w-3 h-3" /> {h.url ? "Tukar B-roll" : "Upload B-roll sendiri"}</>}
                              <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" className="absolute inset-0 opacity-0 cursor-pointer"
                                disabled={up !== undefined} onChange={(e) => { void pickBroll(i, e.target.files?.[0] ?? null); e.target.value = ""; }} />
                            </label>
                            <span className="text-[10px] text-[var(--color-text-muted)]">{h.url ? `✓ ${h.video ? "Video" : "Gambar"} anda` : "Auto — AI cari B-roll ikut isi video"}</span>
                            {h.url && <button type="button" className="text-[10px] underline text-[var(--color-text-muted)]" onClick={() => setHeads((m) => ({ ...m, [i]: { ...m[i], url: undefined, video: undefined } }))}>Guna Auto</button>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
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
              {scriptMode ? "Tutup" : "Tutup (sambung nanti)"}
            </button>
            {scriptMode ? (
              <button type="button" onClick={() => void save()} disabled={busy || !changed}
                className="py-2.5 rounded-xl text-[12px] font-extrabold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #3b82f6, #60a5fa)" }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {busy ? "Menyimpan…" : "Simpan skrip"}
              </button>
            ) : (
              <button type="button" onClick={() => void render()} disabled={busy}
                className="py-2.5 rounded-xl text-[12px] font-extrabold text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #22c55e, #4ade80)" }}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />}
                {busy ? "Menghantar…" : "🎬 Jana Video"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
