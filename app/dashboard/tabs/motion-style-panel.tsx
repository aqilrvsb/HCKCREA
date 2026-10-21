"use client";

// Motion · Custom Style — the client picks one of the 40 styles (motion-style-picker.tsx): the master director
// (Sonnet 5.5) plans the edit in that style on the Default engine (HyperFrames). Below it, optional locks (lib/motion-manual.ts):
// Every option starts at "✨ AI pilih" (the AI decides, exactly as in AI Auto); whatever the client picks becomes a
// rule the AI must follow. The options are the renderer's own (fonts, colour grades, caption looks, end cards).
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { MOTION_EDIT_PRESETS } from "@/lib/motion-prompts";
import MotionStylePicker from "./motion-style-picker";
import {
  LOCK_CAPTION_LOOKS, LOCK_CTAS, LOCK_ELEMENTS, LOCK_END_CARDS, LOCK_FONTS, LOCK_GRADES, LOCK_MOODS, LOCK_SCENES,
  type LockElement, type MotionLocks,
} from "@/lib/motion-manual";

const THEME = { primary: "#a855f7", soft: "rgba(168,85,247,0.35)", faint: "rgba(168,85,247,0.08)", gradient: "linear-gradient(135deg,#a855f7,#ec4899)" };
const sub = "block text-[10px] font-bold text-[var(--color-text-muted)] mb-1";
const inputCls = "w-full px-3 py-2 rounded-lg text-sm bg-[var(--color-bg)] outline-none";
const inputStyle = { border: `1px solid ${THEME.soft}`, color: "var(--color-text)" } as const;
const FONT_HREF = "https://fonts.googleapis.com/css2?family=Anton&family=Archivo+Black&family=Bebas+Neue&family=Inter:wght@800;900&family=Montserrat:wght@800;900&family=Poppins:wght@800;900&family=Playfair+Display:wght@800&family=JetBrains+Mono:wght@800&family=Permanent+Marker&family=Press+Start+2P&family=Bangers&family=Fredoka:wght@700&display=swap";

const on = { background: THEME.gradient, color: "white", boxShadow: `0 4px 12px ${THEME.soft}`, border: "1px solid transparent" };
const off = { background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" };

function Pick({ active, onClick, children, title, style }: { active: boolean; onClick: () => void; children: React.ReactNode; title?: string; style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold transition-all inline-flex items-center gap-1.5"
      style={{ ...(active ? on : off), ...style }}>
      {children}
    </button>
  );
}
const Ai = ({ active, onClick }: { active: boolean; onClick: () => void }) => <Pick active={active} onClick={onClick}>✨ AI pilih</Pick>;

function Section({ icon, title, hint, children }: { icon: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-3 space-y-2.5" style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xs font-extrabold text-[var(--color-text-primary)]">{icon} {title}</span>
        {hint && <span className="text-[10px] text-[var(--color-text-muted)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export type StylePanelProps = {
  locks: MotionLocks;
  setLocks: (l: MotionLocks) => void;
  note: string;
  setNote: (v: string) => void;
  accent: string;
  setAccent: (v: string) => void;
  captions: boolean;
  setCaptions: (v: boolean) => void;
  sfx: boolean;
  setSfx: (v: boolean) => void;
};

export default function MotionStylePanel({ locks, setLocks, note, setNote, accent, setAccent, captions, setCaptions, sfx, setSfx }: StylePanelProps) {
  const set = (patch: Partial<MotionLocks>) => setLocks({ ...locks, ...patch });
  const [ctaOwn, setCtaOwn] = useState(!!locks.cta && !LOCK_CTAS.includes(locks.cta as (typeof LOCK_CTAS)[number]));
  const setEl = (id: LockElement, v: boolean | undefined) => {
    const el = { ...(locks.elements ?? {}) };
    if (v === undefined) delete el[id]; else el[id] = v;
    set({ elements: Object.keys(el).length ? el : undefined });
  };
  const picked = Object.entries(locks).filter(([k, v]) => v !== undefined && k !== "styleId" && k !== "styleName" && !(k === "elements" && !Object.keys(v as object).length)).length + (accent ? 1 : 0);
  // the optional locks start folded; open when some are set
  const [own, setOwn] = useState(picked > 0);

  // the font / caption-look previews draw in the real faces
  useEffect(() => {
    if (document.querySelector(`link[data-motion-fonts]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONT_HREF;
    l.dataset.motionFonts = "1";
    document.head.appendChild(l);
  }, []);

  return (
    <div className="space-y-3">
      <div className="rounded-xl p-3" style={{ background: THEME.faint, border: `1px solid ${THEME.soft}` }}>
        <span className="text-xs font-extrabold text-[var(--color-text-primary)]">🎨 Pilih style — master director edit video anda ikut style ini</span>
        <p className="text-[11px] text-[var(--color-text-secondary)] mt-1 leading-snug">
          Pilih satu daripada 40 style. AI (Sonnet 5.5) baca arahan penuh style itu, kemudian rancang hook, skrin grafik, warna, font, caption, kamera &amp; bunyi
          ikut style tersebut — dengan enjin HyperFrames yang sama seperti AI Auto.
        </p>
      </div>

      <MotionStylePicker value={locks.styleId} onChange={(id) => set({ styleId: id, styleName: undefined })} />

      <div>
        <span className={sub}>Arahan tambahan (optional)</span>
        <textarea className={`${inputCls} resize-y`} style={inputStyle} rows={2} maxLength={900} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="cth. Tekankan promo hari ini, sebut cara simpan produk." />
      </div>

      <button type="button" onClick={() => setOwn((v) => !v)} className="w-full flex items-center gap-2 text-[11px] font-extrabold px-1" style={{ color: THEME.primary }}>
        <ChevronDown className="w-4 h-4 transition-transform" style={{ transform: own ? "rotate(180deg)" : "none" }} />
        Kunci sendiri (optional) — sudut jualan, hook &amp; CTA, warna, caption, bunyi, elemen
        {picked > 0 && <span className="text-[var(--color-text-muted)] font-bold">· {picked} dikunci</span>}
      </button>
      {own && (
      <>
      <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug px-1">
        Kosongkan (<b>✨ AI pilih</b>) — AI ikut style. Apa yang anda kunci di sini jadi peraturan, walaupun berbeza dengan style.
        {picked > 0 && <> · <button type="button" className="underline font-bold" style={{ color: THEME.primary }}
          onClick={() => { setLocks({ styleId: locks.styleId }); setAccent(""); setCtaOwn(false); }}>Reset semua ke AI</button></>}
      </p>

      <Section icon="🎯" title="Sudut jualan" hint="Cara cerita video anda">
        <div className="flex flex-wrap gap-1.5">
          <Ai active={!locks.angle} onClick={() => set({ angle: undefined })} />
          {MOTION_EDIT_PRESETS.map((p) => (
            <Pick key={p.id} active={locks.angle?.label === p.label} title={p.prompt}
              onClick={() => set({ angle: locks.angle?.label === p.label ? undefined : { label: p.label, brief: p.prompt } })}>{p.label}</Pick>
          ))}
        </div>
      </Section>

      <Section icon="🪝" title="Hook & CTA">
        <div>
          <span className={sub}>Hook (3 saat pertama)</span>
          <input className={inputCls} style={inputStyle} maxLength={40} value={locks.hook ?? ""} onChange={(e) => set({ hook: e.target.value || undefined })}
            placeholder="Kosongkan — AI tulis hook dari apa yang anda cakap" />
        </div>
        <div>
          <span className={sub}>CTA (hujung video)</span>
          <div className="flex flex-wrap gap-1.5">
            <Ai active={!locks.cta && !ctaOwn} onClick={() => { setCtaOwn(false); set({ cta: undefined }); }} />
            {LOCK_CTAS.map((c) => <Pick key={c} active={!ctaOwn && locks.cta === c} onClick={() => { setCtaOwn(false); set({ cta: c }); }}>{c}</Pick>)}
            <Pick active={ctaOwn} onClick={() => { setCtaOwn(true); set({ cta: undefined }); }}>✍️ Tulis sendiri</Pick>
          </div>
          {ctaOwn && (
            <input className={`${inputCls} mt-1.5`} style={inputStyle} maxLength={30} value={locks.cta ?? ""} autoFocus
              onChange={(e) => set({ cta: e.target.value || undefined })} placeholder="cth. Order sebelum stok habis" />
          )}
        </div>
        <div>
          <span className={sub}>Kad penutup</span>
          <div className="flex flex-wrap gap-1.5">
            <Ai active={!locks.endCard} onClick={() => set({ endCard: undefined })} />
            {LOCK_END_CARDS.map((c) => <Pick key={c.id} active={locks.endCard === c.id} title={c.desc} onClick={() => set({ endCard: c.id })}>{c.label}</Pick>)}
          </div>
        </div>
      </Section>

      <Section icon="🎨" title="Rupa">
        <div>
          <span className={sub}>Font tajuk (hook & kad penutup)</span>
          <div className="flex flex-wrap gap-1.5">
            <Ai active={!locks.font} onClick={() => set({ font: undefined })} />
            {LOCK_FONTS.map((f) => (
              <Pick key={f.id} active={locks.font === f.id} onClick={() => set({ font: f.id })}
                style={{ fontFamily: f.css, fontWeight: f.weight, fontSize: 13, textTransform: f.upper ? "uppercase" : "none", letterSpacing: 0 }}>{f.label}</Pick>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <div>
            <span className={sub}>Warna tema</span>
            <div className="flex flex-wrap gap-1.5">
              <Ai active={!accent} onClick={() => setAccent("")} />
              <label className="relative inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-extrabold cursor-pointer"
                style={accent ? { ...on } : off}>
                <span className="w-4 h-4 rounded-full border border-white/40" style={{ background: accent || "conic-gradient(#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7,#ef4444)" }} />
                {accent ? accent.toUpperCase() : "Pilih warna"}
                <input type="color" value={accent || "#a855f7"} onChange={(e) => setAccent(e.target.value)} aria-label="Pilih warna tema"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </label>
            </div>
          </div>
          <div>
            <span className={sub}>Gred warna video</span>
            <div className="flex flex-wrap gap-1.5">
              <Ai active={!locks.grade} onClick={() => set({ grade: undefined })} />
              {LOCK_GRADES.map((g) => (
                <Pick key={g.id} active={locks.grade === g.id} onClick={() => set({ grade: g.id })}>
                  <span className="w-3.5 h-3.5 rounded-full border border-white/40" style={{ background: g.swatch }} />{g.label}
                </Pick>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section icon="💬" title="Caption">
        <div className="flex flex-wrap items-center gap-1.5">
          <Pick active={captions} onClick={() => setCaptions(true)}>Ada caption</Pick>
          <Pick active={!captions} onClick={() => setCaptions(false)}>Tiada caption</Pick>
        </div>
        {captions && (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-1.5">
              <button type="button" onClick={() => set({ captionLook: undefined })} className="rounded-xl p-1.5 text-center transition-all" style={!locks.captionLook ? on : off}>
                <span className="block h-9 rounded-lg flex items-center justify-center text-[11px] font-extrabold" style={{ background: "rgba(0,0,0,0.25)" }}>✨</span>
                <span className="block text-[10px] font-extrabold mt-1">AI pilih</span>
              </button>
              {LOCK_CAPTION_LOOKS.map((c) => {
                const a = locks.captionLook === c.id;
                const p = c.p as { font: string; w: number; up: boolean; c: string; hl: string; stroke?: string; bg?: string; round?: boolean; line?: string; box?: string; glow?: string };
                const word = (t: string, hl: boolean) => (
                  <span style={{
                    color: hl ? p.hl : p.c, fontFamily: p.font, fontWeight: p.w, textTransform: p.up ? "uppercase" : "none",
                    WebkitTextStroke: p.stroke ? `0.6px ${p.stroke}` : undefined, textShadow: p.glow ? `0 0 6px ${p.glow}` : p.bg ? "none" : "0 1px 2px rgba(0,0,0,0.6)",
                    background: hl && p.box ? p.box : undefined, padding: hl && p.box ? "0 2px" : undefined, borderRadius: 2,
                    borderBottom: hl && p.line ? `2px solid ${p.line}` : undefined,
                  }}>{t}</span>
                );
                return (
                  <button key={c.id} type="button" onClick={() => set({ captionLook: c.id })} title={c.desc} className="rounded-xl p-1.5 text-center transition-all" style={a ? on : off}>
                    <span className="block h-9 rounded-lg flex items-center justify-center gap-1 text-[12px] leading-none overflow-hidden"
                      style={{ background: "linear-gradient(160deg,#3a3340,#1c1a20)" }}>
                      <span className="inline-flex gap-1 items-center" style={p.bg ? { background: p.bg, padding: "3px 5px", borderRadius: p.round ? 999 : 3 } : undefined}>
                        {word("Cuba", false)}{word("ni", true)}
                      </span>
                    </span>
                    <span className="block text-[10px] font-extrabold mt-1">{c.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={sub} style={{ marginBottom: 0 }}>Kedudukan</span>
              <Ai active={!locks.captionPos} onClick={() => set({ captionPos: undefined })} />
              <Pick active={locks.captionPos === "low"} onClick={() => set({ captionPos: "low" })}>Bawah</Pick>
              <Pick active={locks.captionPos === "mid"} onClick={() => set({ captionPos: "mid" })}>Tengah</Pick>
            </div>
          </>
        )}
      </Section>

        <>
          <Section icon="🎬" title="Rentak">
            <div>
              <span className={sub}>Skrin grafik (scene explainer)</span>
              <div className="flex flex-wrap gap-1.5">
                <Ai active={!locks.scenes} onClick={() => set({ scenes: undefined })} />
                {LOCK_SCENES.map((s) => <Pick key={s.id} active={locks.scenes === s.id} title={s.desc} onClick={() => set({ scenes: s.id })}>{s.label}</Pick>)}
              </div>
              {locks.scenes && <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{LOCK_SCENES.find((s) => s.id === locks.scenes)?.desc}</p>}
            </div>
            <div>
              <span className={sub}>Kesan (flash, confetti, gegar)</span>
              <div className="flex flex-wrap gap-1.5">
                <Ai active={!locks.fx} onClick={() => set({ fx: undefined })} />
                <Pick active={locks.fx === "full"} onClick={() => set({ fx: "full" })}>Penuh</Pick>
                <Pick active={locks.fx === "light"} onClick={() => set({ fx: "light" })}>Ringan</Pick>
              </div>
            </div>
          </Section>

          <Section icon="🔊" title="Bunyi">
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <div>
                <span className={sub}>Muzik latar</span>
                <div className="flex flex-wrap gap-1.5">
                  <Ai active={locks.music === undefined} onClick={() => set({ music: undefined })} />
                  <Pick active={locks.music === true} onClick={() => set({ music: true })}>Ada</Pick>
                  <Pick active={locks.music === false} onClick={() => set({ music: false, mood: undefined })}>Tiada</Pick>
                </div>
              </div>
              {locks.music !== false && (
                <div>
                  <span className={sub}>Mood muzik</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Ai active={!locks.mood} onClick={() => set({ mood: undefined })} />
                    {LOCK_MOODS.map((m) => <Pick key={m.id} active={locks.mood === m.id} onClick={() => set({ mood: m.id })}>{m.label}</Pick>)}
                  </div>
                </div>
              )}
              <div>
                <span className={sub}>Sound effect</span>
                <div className="flex flex-wrap gap-1.5">
                  <Pick active={sfx} onClick={() => setSfx(true)}>Ada</Pick>
                  <Pick active={!sfx} onClick={() => setSfx(false)}>Tiada</Pick>
                </div>
              </div>
            </div>
          </Section>

          <Section icon="✨" title="Elemen istimewa" hint="AI pilih = AI guna bila sesuai">
            <div className="space-y-1.5">
              {LOCK_ELEMENTS.map((e) => {
                const v = locks.elements?.[e.id];
                return (
                  <div key={e.id} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-extrabold text-[var(--color-text-primary)] min-w-[150px]" title={e.desc}>{e.label}</span>
                    <Ai active={v === undefined} onClick={() => setEl(e.id, undefined)} />
                    <Pick active={v === true} onClick={() => setEl(e.id, true)}>Mahu</Pick>
                    <Pick active={v === false} onClick={() => setEl(e.id, false)}>Tak mahu</Pick>
                    <span className="text-[10px] text-[var(--color-text-muted)] hidden sm:inline">{e.desc}</span>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      </>
      )}
    </div>
  );
}
