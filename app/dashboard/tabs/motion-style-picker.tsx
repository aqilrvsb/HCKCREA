"use client";

// Motion · "Saya nak pilih sendiri" — the 40 styles as radio cards. The list, the previews and their CSS come from
// /api/motion/styles (the style library lives in a private bucket — lib/vgc-styles.ts); the preview markup is drawn by
// the library itself and sits inside `.vgc-scope`, where its scoped CSS applies.
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";

export type StyleCard = { id: string; name: string; group: string; desc: string; native: boolean; bestFor?: string; sample: string };
type Payload = { styles: StyleCard[]; css: string; fonts: string[] };

const THEME = { primary: "#a855f7", soft: "rgba(168,85,247,0.35)", gradient: "linear-gradient(135deg,#a855f7,#ec4899)" };
const FIRST = 6;

// one request per page load (the panel can open and close many times)
let loaded: Promise<Payload> | null = null;
const load = () =>
  (loaded ??= fetch("/api/motion/styles").then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(d?.styles)) throw new Error(d?.error || "Style tidak dapat dimuat.");
    return d as Payload;
  }).catch((e) => { loaded = null; throw e; }));

export default function MotionStylePicker({ value, onChange }: { value?: string; onChange: (id: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState("");

  const fetchStyles = () => {
    setError(null);
    load().then(setData, (e) => setError(e?.message || "Style tidak dapat dimuat."));
  };
  useEffect(fetchStyles, []);

  // the previews' CSS and fonts, once per page
  useEffect(() => {
    if (!data) return;
    if (!document.querySelector("style[data-vgc-styles]")) {
      const st = document.createElement("style");
      st.dataset.vgcStyles = "1";
      st.textContent = data.css;
      document.head.appendChild(st);
    }
    for (const href of data.fonts) {
      if (document.querySelector(`link[href="${CSS.escape(href)}"]`)) continue;
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      document.head.appendChild(l);
    }
  }, [data]);

  const shown = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (q) return data.styles.filter((s) => `${s.name} ${s.group} ${s.desc} ${s.bestFor ?? ""}`.toLowerCase().includes(q));
    if (all) return data.styles;
    const first = data.styles.slice(0, FIRST);
    const picked = data.styles.find((s) => s.id === value);
    return picked && !first.includes(picked) ? [picked, ...first.slice(0, FIRST - 1)] : first;
  }, [data, query, all, value]);
  const picked = data?.styles.find((s) => s.id === value);

  if (error) {
    return (
      <div className="rounded-xl p-3 text-[11px] text-red-400" style={{ border: "1px solid var(--color-border)" }}>
        {error} <button type="button" className="underline font-bold ml-1" style={{ color: THEME.primary }} onClick={fetchStyles}>Cuba lagi</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {Array.from({ length: FIRST }, (_, i) => (
          <div key={i} className="rounded-xl animate-pulse" style={{ aspectRatio: "16/14", background: "var(--color-bg)", border: "1px solid var(--color-border)" }} />
        ))}
        <span className="col-span-full text-[10px] text-[var(--color-text-muted)] inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Memuat 40 style…</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-bg)]" style={{ border: `1px solid ${THEME.soft}` }}>
        <Search className="w-3.5 h-3.5 shrink-0" style={{ color: THEME.primary }} />
        <input className="w-full bg-transparent outline-none text-sm text-[var(--color-text)]" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari style — cth. zoom, subtitle, scrapbook" aria-label="Cari style" />
      </label>
      <div role="radiogroup" aria-label="Style video" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {shown.map((s) => {
          const on = s.id === value;
          return (
            <button key={s.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(s.id)}
              className="relative text-left rounded-xl overflow-hidden flex flex-col transition-all min-w-0"
              style={{
                background: "var(--color-bg)",
                border: on ? `2px solid ${THEME.primary}` : "1px solid var(--color-border)",
                boxShadow: on ? `0 0 0 3px ${THEME.soft}` : undefined,
              }}>
              <span className="vgc-scope block pointer-events-none">
                <span className="style-card block" style={{ border: 0, borderRadius: 0, background: "transparent", cursor: "inherit" }}
                  dangerouslySetInnerHTML={{ __html: s.sample }} />
              </span>
              <span className="block p-2.5">
                <span className="block text-[12px] font-extrabold text-[var(--color-text-primary)] leading-tight">{s.name}</span>
                <span className="block text-[10.5px] text-[var(--color-text-secondary)] leading-snug mt-0.5 line-clamp-2">{s.desc}</span>
              </span>
              {on && (
                <span className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-white shadow" style={{ background: THEME.gradient }}>
                  <Check className="w-3.5 h-3.5" />
                </span>
              )}
            </button>
          );
        })}
        {shown.length === 0 && <p className="col-span-full text-[11px] text-[var(--color-text-muted)]">Tiada style untuk "{query}".</p>}
      </div>
      {!query && (
        <button type="button" onClick={() => setAll((v) => !v)} className="px-3 py-1.5 rounded-xl text-[11px] font-extrabold"
          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}>
          {all ? "Tunjuk 6 sahaja" : `Lihat semua ${data.styles.length} style`}
        </button>
      )}
      {picked ? (
        <p className="text-[11px] text-[var(--color-text-secondary)] leading-snug">
          <b className="text-[var(--color-text-primary)]">✓ {picked.name}</b>{picked.group ? ` · ${picked.group}` : ""} — {picked.bestFor || picked.desc}
        </p>
      ) : (
        <p className="text-[11px] font-bold" style={{ color: THEME.primary }}>Pilih satu style untuk video ini.</p>
      )}
    </div>
  );
}
