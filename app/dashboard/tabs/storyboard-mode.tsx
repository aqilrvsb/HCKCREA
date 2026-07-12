"use client";

// Storyboard mode (Images tab) — same Load Data → MAIN → SUB flow as the
// livechat, plus a quantity selector. Generate fires N 9:16 storyboard GRID
// images (gpt-image-2) that land in the Images history grid below.

import { useEffect, useState } from "react";
import { Loader2, Package, ImageIcon, Sparkles } from "lucide-react";

type SavedProduct = {
  id: string;
  kind: "affiliate" | "manual";
  product_id: string | null;
  product_name: string;
  detail: string | null;
  attachments: string[];
};

const THEME = "#f5b100";
const MAIN_OPTIONS = [
  { value: "ugc" as const, label: "UGC", desc: "Realistik · TikTok/Reels" },
  { value: "pc" as const, label: "Product Commercial", desc: "Premium · sinematik" },
];
const SUBS: Record<"ugc" | "pc", string[]> = {
  ugc: ["UGC Review", "Unboxing", "Unboxing ASMR", "Unboxing Try-On", "Virtual Try-On", "Before/After", "Tutorial", "UGC Addiction", "Giant Figure", "Testimoni Selfie", "Talking Head", "Secret Tips/Hack", "Lifestyle", "Masalah→Solusi"],
  pc: ["TV Spot", "Cinematic", "Crush Test", "Hyper Motion", "Mystery Box", "Reboxing", "Pro Virtual Try-On", "Product Studio", "Pix Story", "Stop Motion", "Motion Graphics", "Wild Card"],
};

export default function StoryboardMode({ projectId }: { projectId?: string }) {
  const [affiliate, setAffiliate] = useState<SavedProduct[]>([]);
  const [manual, setManual] = useState<SavedProduct[]>([]);
  const [showLoad, setShowLoad] = useState<"affiliate" | "manual" | null>(null);
  const [product, setProduct] = useState<SavedProduct | null>(null);
  const [main, setMain] = useState<"ugc" | "pc" | null>(null);
  // Multi-select, CROSS-MAIN. 1 sub → quantity mode (1–10 of the same sub).
  // 2+ subs → connected campaign storyline (one storyboard per sub, in order);
  // subs may come from BOTH categories — main is just a filter for the list.
  const [subs, setSubs] = useState<{ main: "ugc" | "pc"; sub: string }[]>([]);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [a, m] = await Promise.all([
          fetch("/api/auto-content/saved-products?kind=affiliate", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
          fetch("/api/auto-content/saved-products?kind=manual", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        ]);
        if (Array.isArray(a?.items)) setAffiliate(a.items);
        if (Array.isArray(m?.items)) setManual(m.items);
      } catch {}
    })();
  }, []);

  const savedList = showLoad === "affiliate" ? affiliate : showLoad === "manual" ? manual : [];

  function pickProduct(p: SavedProduct) {
    setProduct(p);
    setShowLoad(null);
    setMain(null);
    setSubs([]);
  }

  function toggleSub(s: string) {
    if (!main) return;
    setSubs((prev) => (prev.some((x) => x.sub === s) ? prev.filter((x) => x.sub !== s) : [...prev, { main, sub: s }]));
  }

  async function generate() {
    if (!product || !main || subs.length === 0) {
      setErr("Lengkapkan: produk → kategori → sub-style dulu.");
      return;
    }
    setErr(null);
    setMsg(null);
    setBusy(true);
    try {
      const r = await fetch("/api/generate/storyboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId || null,
          main,
          subs,
          quantity: subs.length === 1 ? qty : undefined,
          product: { name: product.product_name, detail: product.detail || "", image_urls: (product.attachments || []).filter(Boolean).slice(0, 3) },
        }),
      });
      const text = await r.text();
      let d: any = {};
      try { d = JSON.parse(text); } catch { d = { error: text.replace(/<[^>]+>/g, " ").slice(0, 140) }; }
      if (!r.ok || !d?.ok) throw new Error(d?.error || `Gagal (HTTP ${r.status})`);
      setMsg(`${d.count} storyboard tengah dijana 🎨 — akan muncul di bawah bila siap.`);
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      setErr(e?.message || "Ralat rangkaian");
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = { border: "1px solid var(--color-border)", background: "var(--color-bg-card)" };

  return (
    <div className="space-y-4">
      {/* 1. Product */}
      <div className="rounded-2xl p-4" style={box}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: THEME }}>1 · Produk</span>
          <button onClick={() => setShowLoad((s) => (s ? null : "affiliate"))} className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-lg" style={{ background: THEME, color: "#1a1a1a" }}>
            <Package className="w-4 h-4" /> Load Data
          </button>
        </div>
        {product ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {product.attachments?.[0] ? <img src={product.attachments[0]} className="w-10 h-10 rounded object-cover" alt="" /> : <span className="w-10 h-10 rounded flex items-center justify-center" style={{ background: "var(--color-bg)" }}><ImageIcon className="w-4 h-4" /></span>}
              <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">{product.product_name}</span>
            </div>
            {/* Product attachments (used as gpt-image-2 visual reference) */}
            {(product.attachments || []).filter(Boolean).length > 1 && (
              <div className="flex gap-1.5 flex-wrap">
                {(product.attachments || []).filter(Boolean).slice(0, 3).map((u, i) => (
                  <img key={i} src={u} className="w-12 h-12 rounded object-cover" style={{ border: "1px solid var(--color-border)" }} alt="" />
                ))}
              </div>
            )}
            {/* Product description (fed to the prompt planner) */}
            {product.detail && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider mb-1 text-[var(--color-text-muted)]">Description produk</div>
                <div className="text-[12px] leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto rounded-lg p-2.5 text-[var(--color-text-secondary)]" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                  {product.detail}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[12px] text-[var(--color-text-muted)]">Pilih produk (Beg Kuning / Tiada Link).</div>
        )}
        {showLoad && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg p-2" style={{ background: "var(--color-bg)" }}>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setShowLoad("affiliate")} className="text-[12px] font-bold px-3 py-1 rounded-full" style={{ background: showLoad === "affiliate" ? THEME : "var(--color-bg-card)", color: showLoad === "affiliate" ? "#1a1a1a" : "var(--color-text-secondary)" }}>Beg Kuning ({affiliate.length})</button>
              <button onClick={() => setShowLoad("manual")} className="text-[12px] font-bold px-3 py-1 rounded-full" style={{ background: showLoad === "manual" ? THEME : "var(--color-bg-card)", color: showLoad === "manual" ? "#1a1a1a" : "var(--color-text-secondary)" }}>Tiada Link ({manual.length})</button>
            </div>
            {savedList.length === 0 ? <div className="text-[12px] text-[var(--color-text-muted)] py-1">Tiada produk tersimpan.</div> : (
              <div className="grid grid-cols-1 gap-1.5">
                {savedList.map((p) => (
                  <button key={p.id} onClick={() => pickProduct(p)} className="flex items-center gap-2 text-left px-2 py-1.5 rounded-lg" style={box}>
                    {p.attachments?.[0] ? <img src={p.attachments[0]} className="w-8 h-8 rounded object-cover" alt="" /> : <span className="w-8 h-8 rounded" style={{ background: "var(--color-bg)" }} />}
                    <span className="text-[13px] font-semibold truncate text-[var(--color-text-primary)]">{p.product_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. MAIN */}
      {product && (
        <div className="rounded-2xl p-4" style={box}>
          <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: THEME }}>2 · Kategori</div>
          <div className="grid grid-cols-2 gap-2">
            {MAIN_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setMain(o.value)} className="text-left px-3 py-2.5 rounded-lg" style={{ border: `1px solid ${main === o.value ? THEME : "var(--color-border)"}`, background: main === o.value ? `${THEME}18` : "var(--color-bg)" }}>
                <span className="block text-[13px] font-bold text-[var(--color-text-primary)]">{o.label}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">{o.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. SUB — multi-select */}
      {product && main && (
        <div className="rounded-2xl p-4" style={box}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: THEME }}>3 · Sub-style</span>
            <span className="text-[10px] text-[var(--color-text-muted)]">
              {subs.length >= 2 ? `${subs.length} sub · campaign (boleh silang kategori)` : "pilih 1 (kuantiti) atau 2+ (campaign)"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {SUBS[main].map((s) => {
              const on = subs.some((x) => x.sub === s);
              const order = subs.findIndex((x) => x.sub === s) + 1;
              return (
                <button key={s} onClick={() => toggleSub(s)} className="text-[12px] font-semibold px-2.5 py-2 rounded-lg text-left flex items-center gap-1.5" style={{ border: `1px solid ${on ? THEME : "var(--color-border)"}`, background: on ? `${THEME}18` : "var(--color-bg)", color: "var(--color-text-primary)" }}>
                  {subs.length >= 2 && on && <span className="text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center" style={{ background: THEME, color: "#1a1a1a" }}>{order}</span>}
                  {s}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Quantity (single sub) OR campaign note (multi) + Generate */}
      {product && main && subs.length > 0 && (
        <div className="rounded-2xl p-4 space-y-3" style={box}>
          {subs.length === 1 ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: THEME }}>Kuantiti</span>
              <div className="flex gap-1.5 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} onClick={() => setQty(n)} className="w-8 h-8 rounded-lg text-[12px] font-bold" style={{ border: `1px solid ${qty === n ? THEME : "var(--color-border)"}`, background: qty === n ? THEME : "var(--color-bg)", color: qty === n ? "#1a1a1a" : "var(--color-text-primary)" }}>{n}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: `${THEME}14`, color: "var(--color-text-secondary)", border: `1px solid ${THEME}44` }}>
              🎬 <b>Campaign bersambung</b> — {subs.length} storyboard, cerita berterusan ({subs.map((x, i) => `${i + 1}·${x.sub}`).join(" → ")}), yang akhir jadi <b>closing/CTA</b>.
            </div>
          )}
          <button onClick={generate} disabled={busy} className="w-full py-3 rounded-xl text-[14px] font-bold flex items-center justify-center gap-2" style={{ background: THEME, color: "#1a1a1a", opacity: busy ? 0.6 : 1 }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy ? "Menjana…" : subs.length === 1 ? `Jana ${qty} Storyboard` : `Jana Campaign (${subs.length} storyboard)`}
          </button>
        </div>
      )}

      {msg && <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#3a2a0a", color: "#fcd34d", border: "1px solid #78591c" }}>{msg}</div>}
      {err && <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#3a0a0a", color: "#fca5a5", border: "1px solid #7f1d1d" }}>⚠️ {err}</div>}
    </div>
  );
}
