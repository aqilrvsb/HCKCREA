"use client";

// Storyboard mode (Images tab) — same Load Data → MAIN → SUB flow as the
// livechat, plus a quantity selector. Generate fires N 9:16 storyboard GRID
// images (gpt-image-2) that land in the Images history grid below.

import { useEffect, useState } from "react";
import { Loader2, Sparkles, UserRound } from "lucide-react";
import { uploadImage } from "@/lib/upload-image";

type SavedProduct = {
  id: string;
  kind: "affiliate" | "manual";
  product_id: string | null;
  product_name: string;
  detail: string | null;
  attachments: string[];
  // "extension" → pulled from the extension's Beg Kuning list (has a link but
  // was never saved in-app), so it ships with 1 image instead of 3.
  source?: string;
};

const THEME = "#f5b100";
const MAIN_OPTIONS = [
  { value: "ugc" as const, label: "UGC", desc: "Realistik · TikTok/Reels" },
  { value: "pc" as const, label: "Product Commercial", desc: "Premium · sinematik" },
  { value: "custom" as const, label: "Custom Idea", desc: "Tulis idea sendiri" },
];
// SUB-STYLE PAGES. Page 1 = the PROVEN set (unchanged, verbatim). Pages 2 & 3 =
// extra variety sets — every style distinct from page 1 and from each other,
// each backed by a full execution card in app_settings.storyboard_subcards_p2/_p3.
// The route loads the matching page spec by the `page` field we send below.
const SUBS_PAGES: Record<1 | 2 | 3, Record<"ugc" | "pc", string[]>> = {
  1: {
    ugc: ["UGC Review", "Unboxing", "Unboxing ASMR", "Unboxing Try-On", "Virtual Try-On", "Before/After", "Tutorial", "UGC Addiction", "Giant Figure", "Testimoni Selfie", "Talking Head", "Secret Tips/Hack", "Lifestyle", "Masalah→Solusi"],
    pc: ["TV Spot", "Cinematic", "Crush Test", "Hyper Motion", "Mystery Box", "Reboxing", "Pro Virtual Try-On", "Product Studio", "Pix Story", "Stop Motion", "Motion Graphics", "Wild Card"],
  },
  2: {
    ugc: ["Countdown Clock", "Macro Tap ASMR", "Mirror Selfie", "WhatsApp Chat", "Walk-and-Talk", "Palm-Wipe Swap", "Tier-List Drag", "Caught Startle", "Voice-Memo Waveform", "Camera-Roll Dump", "Drive-Home Monologue", "Empty-Chair Address", "Screenshot React", "Then-Now Split"],
    pc: ["Liquid Gold Pour", "Ink Bloom", "Ferrofluid Spikes", "Frozen Splash Crown", "Glass-Block Shatter", "Bullet-Time Orbit", "Zero-G Float", "Macro-to-Cosmos", "Origami Fold", "Cross-Section Slice", "Infinite Recursion", "Liquid Typography"],
  },
  3: {
    ugc: ["Top-Down Restock", "Overhead Journal", "Notes-App Manifesto", "Ring-Light Off", "Held-Object Trigger", "Receipt Rip", "Basket Avalanche", "Trolley Cam", "Mystery Blind-Pull", "Empties Tower", "Barcode Beep", "Palm-Squeeze Test", "Bag-Weight Hang", "Ceiling-Fan Strobe"],
    pc: ["Botanical Bloom", "Chrome-Liquid Morph", "Product Colossus", "Escher Architecture", "Thermal False-Colour", "Particle Assembly", "Molten Wax Reveal", "Silk Wind Wrap", "Colored Gel Duel", "Prism Spectrum", "Volumetric Godrays", "Tilt-Shift Miniature"],
  },
};
const SUB_PAGES: Array<1 | 2 | 3> = [1, 2, 3];

export default function StoryboardMode({ projectId }: { projectId?: string }) {
  const [affiliate, setAffiliate] = useState<SavedProduct[]>([]);
  const [manual, setManual] = useState<SavedProduct[]>([]);
  const [showLoad, setShowLoad] = useState<"affiliate" | "manual" | null>(null);
  // Editable product form (exact same shape as Auto UGC's PRODUCT card):
  // Name + Detail + Link Beg Kuning (optional) + 3 attachments + Save.
  const [pName, setPName] = useState("");
  const [pDetail, setPDetail] = useState("");
  const [pLink, setPLink] = useState("");
  const [pImgs, setPImgs] = useState<string[]>([]);
  const [slotUploading, setSlotUploading] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [main, setMain] = useState<"ugc" | "pc" | "custom" | null>(null);
  // Multi-select, CROSS-MAIN. 1 sub → quantity mode (1–10 of the same sub).
  // 2+ subs → connected campaign storyline (one storyboard per sub, in order);
  // subs may come from BOTH categories — main is just a filter for the list.
  const [subs, setSubs] = useState<{ main: "ugc" | "pc"; sub: string }[]>([]);
  // Sub-style PAGE (1 proven / 2 / 3 extra variety). Switching pages clears the
  // selection — a campaign's subs must all belong to ONE page's spec.
  const [subPage, setSubPage] = useState<1 | 2 | 3>(1);
  // Custom Idea (3rd category) — client's own concept.
  const [customIdea, setCustomIdea] = useState("");
  const [qty, setQty] = useState(1);
  // No CTA — single/quantity storyboards skip any call-to-action frame.
  const [noCta, setNoCta] = useState(false);
  // No subtitle — when ticked, storyboard images are 100% text-free (hard).
  const [noSubtitle, setNoSubtitle] = useState(false);
  // Kekal Avatar — fixed presenter face across every human frame.
  const [keepAvatar, setKeepAvatar] = useState(false);
  const [avatarUrls, setAvatarUrls] = useState<string[]>([]);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function reloadLists() {
    try {
      const [a, m] = await Promise.all([
        fetch("/api/auto-content/saved-products?kind=affiliate", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
        fetch("/api/auto-content/saved-products?kind=manual", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      ]);
      if (Array.isArray(a?.items)) setAffiliate(a.items);
      if (Array.isArray(m?.items)) setManual(m.items);
    } catch {}
  }

  useEffect(() => { void reloadLists(); }, []);

  const savedList = showLoad === "affiliate" ? affiliate : showLoad === "manual" ? manual : [];
  // Product is "ready" once it has a name + at least one attachment — this
  // gates the category / avatar / generate steps below (like Load Data did).
  const productReady = pName.trim().length > 0 && pImgs.filter(Boolean).length > 0;

  // Load a saved preset → fill the whole form. Reconstruct the Beg Kuning link
  // from the saved product_id (TikTok Shop), same as Auto UGC.
  function pickProduct(p: SavedProduct) {
    setPName(p.product_name);
    setPDetail(p.detail || "");
    setPLink(p.product_id ? `https://www.tiktok.com/shop/my/pdp/product/${p.product_id}` : "");
    setPImgs((p.attachments || []).filter(Boolean).slice(0, 3));
    setShowLoad(null);
    setSavedMsg(null);
    setMain(null);
    setSubs([]);
    setCustomIdea("");
  }

  async function uploadSlot(i: number, file: File) {
    setErr(null);
    setSlotUploading(i);
    try {
      const { url } = await uploadImage(file);
      setPImgs((prev) => {
        const a = [...prev];
        while (a.length <= i) a.push("");
        a[i] = url;
        return a;
      });
    } catch (e: any) {
      setErr(e?.message || "Upload attachment gagal");
    } finally {
      setSlotUploading(null);
    }
  }

  function removeSlot(i: number) {
    setPImgs((prev) => {
      const a = [...prev];
      if (i < a.length) a[i] = "";
      return a;
    });
  }

  // Save the current form as a reusable preset. Beg Kuning link present →
  // Beg Kuning Product; empty → Tiada Link Product. Needs name+detail+3 imgs.
  async function saveProduct() {
    const imgs = pImgs.filter(Boolean);
    if (imgs.length < 3) { setSavedMsg("Upload 3 attachment dulu."); return; }
    if (!pName.trim() || !pDetail.trim()) { setSavedMsg("Isi Product Name + Detail Product dulu."); return; }
    setSaving(true);
    setSavedMsg(null);
    try {
      const r = await fetch("/api/auto-content/save-product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_name: pName.trim(), detail: pDetail.trim(), beg_kuning_url: pLink.trim(), attachments: imgs.slice(0, 3) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Save gagal");
      setSavedMsg(d.kind === "affiliate" ? "✓ Saved → Beg Kuning Product" : "✓ Saved → Tiada Link Product");
      void reloadLists();
      setTimeout(() => setSavedMsg(null), 4000);
    } catch (e: any) {
      setSavedMsg(e?.message || "Save gagal");
    } finally {
      setSaving(false);
    }
  }

  function toggleSub(s: string) {
    if (!main || main === "custom") return;
    const m = main;
    setSubs((prev) => (prev.some((x) => x.sub === s) ? prev.filter((x) => x.sub !== s) : [...prev, { main: m, sub: s }]));
  }
  const isCustom = main === "custom";
  function moveSub(i: number, dir: -1 | 1) {
    setSubs((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const arr = [...prev];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }

  async function uploadAvatar(file: File) {
    setErr(null);
    setAvatarUploading(true);
    try {
      const { url } = await uploadImage(file);
      setAvatarUrls((prev) => [...prev, url].slice(0, 2));
    } catch (e: any) {
      setErr(e?.message || "Upload avatar gagal");
    } finally {
      setAvatarUploading(false);
    }
  }

  async function generate() {
    if (!productReady || !main) {
      setErr("Lengkapkan: produk (nama + attachment) → kategori dulu.");
      return;
    }
    if (isCustom && !customIdea.trim()) {
      setErr("Tulis idea anda dulu untuk Custom Idea.");
      return;
    }
    if (!isCustom && subs.length === 0) {
      setErr("Pilih sub-style dulu.");
      return;
    }
    if (keepAvatar && avatarUrls.length === 0) {
      setErr("Kekal Avatar ditick — upload gambar avatar dulu.");
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
          main: isCustom ? "custom" : main,
          subs: isCustom ? [] : subs,
          // Which sub-style page the picked subs belong to (1 proven / 2 / 3).
          // Custom Idea ignores it. Absent/1 → proven spec.
          page: isCustom ? undefined : subPage,
          custom_idea: isCustom ? customIdea.trim() : undefined,
          // Custom Idea + non-campaign both use quantity (1–10).
          quantity: isCustom || subs.length === 1 ? qty : undefined,
          // No-CTA only applies to single/quantity + custom (campaign handles
          // its own CTA on the closing segment).
          no_cta: (isCustom || subs.length === 1) && noCta ? true : undefined,
          // No-subtitle applies to every mode.
          no_subtitle: noSubtitle ? true : undefined,
          // Sent so the API can reject "Kekal Avatar ticked but no face
          // uploaded" instead of silently generating with no presenter lock.
          keep_avatar: keepAvatar,
          avatar_urls: keepAvatar ? avatarUrls : undefined,
          product: { name: pName.trim(), detail: pDetail.trim(), image_urls: pImgs.filter(Boolean).slice(0, 3) },
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
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: THEME }}>1 · Produk</span>
          {/* Load a saved preset — Beg Kuning (with link) / Tiada Link buckets. */}
          <div className="flex gap-2">
            <button onClick={() => setShowLoad((s) => (s === "affiliate" ? null : "affiliate"))} title="Produk yang ada Link Beg Kuning" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold" style={{ border: "1px solid var(--color-border)", background: showLoad === "affiliate" ? THEME : "var(--color-bg)", color: showLoad === "affiliate" ? "#1a1a1a" : "var(--color-text-secondary)" }}>
              🔗 Beg Kuning Product
              <span style={{ fontSize: 10, background: "#facc15", color: "#1a1a1a", borderRadius: 999, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{affiliate.length}</span>
            </button>
            <button onClick={() => setShowLoad((s) => (s === "manual" ? null : "manual"))} title="Produk tanpa Link Beg Kuning" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold" style={{ border: "1px solid var(--color-border)", background: showLoad === "manual" ? THEME : "var(--color-bg)", color: showLoad === "manual" ? "#1a1a1a" : "var(--color-text-secondary)" }}>
              📦 Tiada Link Product
              <span style={{ fontSize: 10, background: "#facc15", color: "#1a1a1a", borderRadius: 999, padding: "1px 6px", minWidth: 16, textAlign: "center" }}>{manual.length}</span>
            </button>
          </div>
        </div>

        {/* Saved-preset dropdown — pick to reload Name + Detail + attachments (+ link). */}
        {showLoad && (
          <div className="mb-3 max-h-48 overflow-y-auto rounded-xl p-2" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
            {savedList.length === 0 ? (
              <div className="px-1 py-2 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
                Belum ada. Isi form bawah{showLoad === "affiliate" ? " + Link Beg Kuning" : ""} → tekan <strong>Save Info Product</strong>.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-1.5">
                {savedList.map((p) => (
                  <button key={p.id} onClick={() => pickProduct(p)} className="flex items-center gap-2.5 text-left px-2 py-1.5 rounded-lg" style={box}>
                    {p.attachments?.[0] ? <img src={p.attachments[0]} className="w-9 h-9 rounded-md object-cover flex-shrink-0" alt="" /> : <span className="w-9 h-9 rounded-md flex-shrink-0" style={{ background: "var(--color-bg-card)" }} />}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold truncate text-[var(--color-text-primary)]">{p.product_name}</div>
                      <div className="text-[10px] mt-0.5 text-[var(--color-text-muted)]">
                        {(p.attachments || []).filter(Boolean).length} attachment{p.source === "extension" ? " · 🧩 dari extension" : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Editable product form (same as Auto UGC). Fields feed the storyboard
            planner; Save persists it as a reusable preset. */}
        <label className="block text-[9px] font-bold uppercase tracking-wider mb-1 text-[var(--color-text-muted)]">Product Name</label>
        <input type="text" maxLength={120} value={pName} onChange={(e) => setPName(e.target.value)} placeholder="e.g. LUQFA Lotion 100ml" className="w-full p-2 rounded text-xs outline-none mb-2 text-[var(--color-text-primary)]" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }} />
        <label className="block text-[9px] font-bold uppercase tracking-wider mb-1 text-[var(--color-text-muted)]">Detail Product</label>
        <textarea rows={3} maxLength={1000} value={pDetail} onChange={(e) => setPDetail(e.target.value)} placeholder="Price, USP, ingredients, benefits…" className="w-full p-2 rounded text-xs resize-y outline-none mb-2 text-[var(--color-text-primary)]" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }} />
        <label className="block text-[9px] font-bold uppercase tracking-wider mb-1 text-[var(--color-text-muted)]">Link Beg Kuning <span style={{ color: "var(--color-text-muted)" }}>(optional)</span></label>
        <input type="url" value={pLink} onChange={(e) => setPLink(e.target.value)} placeholder="https://www.tiktok.com/... (kosongkan = Tiada Link Product)" className="w-full p-2 rounded text-xs outline-none mb-2 text-[var(--color-text-primary)]" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }} />

        {/* 3 attachment slots + Save Info Product */}
        <div className="flex items-stretch gap-2 mt-1">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => {
              const url = pImgs[i] || "";
              return (
                <div key={i} className="relative w-[52px] h-[52px] rounded-lg overflow-hidden flex-shrink-0" style={{ border: `2px dashed ${url ? "transparent" : `${THEME}88`}`, background: url ? "#000" : "var(--color-bg)" }}>
                  <label className="w-full h-full flex items-center justify-center cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" disabled={slotUploading === i} onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) void uploadSlot(i, f); }} />
                    {slotUploading === i ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: THEME }} /> : url ? <img src={url} className="w-full h-full object-cover" alt="" /> : <span className="text-[11px] font-bold" style={{ color: THEME }}>{i + 1}</span>}
                  </label>
                  {url && (
                    <button type="button" onClick={() => removeSlot(i)} className="absolute top-0 right-0 w-4 h-4 rounded-bl bg-black/70 text-white text-[10px] flex items-center justify-center" title="Buang gambar ni">×</button>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={saveProduct} disabled={saving} className="flex-1 min-h-[52px] px-3 rounded-lg text-sm font-extrabold disabled:opacity-40 whitespace-nowrap" style={{ background: "rgba(34,197,94,0.12)", border: "1px solid #16a34a", color: "#15803d" }}>
            {saving ? "⏳ Saving…" : "💾 Save Info Product"}
          </button>
        </div>
        {savedMsg && (
          <div className="text-[11px] mt-1.5 font-semibold" style={{ color: savedMsg.startsWith("✓") ? "#16a34a" : "#dc2626" }}>{savedMsg}</div>
        )}
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">Upload 3 attachment produk (dijadikan rujukan visual gpt-image-2). Isi Link Beg Kuning → simpan sebagai Beg Kuning Product; kosongkan → Tiada Link Product.</p>
        {/* Make the reference budget visible BEFORE generating. Products loaded
            from the extension arrive with only 1 photo, and 1 angle is a much
            weaker identity lock than 3 — the client should see that and can
            add more rather than wonder why the packaging drifted. */}
        {pImgs.filter(Boolean).length > 0 && pImgs.filter(Boolean).length < 3 && (
          <p className="text-[10px] mt-1" style={{ color: "#f59e0b" }}>
            ⚠️ {pImgs.filter(Boolean).length} gambar produk sahaja. Lagi banyak angle = produk lagi tepat (warna/tudung/bentuk/tulisan). Tambah sampai 3 kalau ada.
          </p>
        )}
      </div>

      {/* Kekal Avatar — fixed presenter face */}
      {productReady && (
        <div className="rounded-2xl p-4" style={box}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={keepAvatar} onChange={(e) => setKeepAvatar(e.target.checked)} style={{ accentColor: THEME, width: 16, height: 16 }} />
            <span className="text-[13px] font-bold text-[var(--color-text-primary)] flex items-center gap-1.5"><UserRound className="w-4 h-4" /> Kekal Avatar</span>
            <span className="text-[10px] text-[var(--color-text-muted)]">muka presenter sama tiap frame</span>
          </label>
          {keepAvatar && (
            <div className="mt-3">
              <div className="flex items-center gap-2 flex-wrap">
                {avatarUrls.map((u, i) => (
                  <div key={i} className="relative">
                    <img src={u} className="w-14 h-14 rounded-lg object-cover" style={{ border: `1px solid ${THEME}` }} alt="avatar" />
                    <button onClick={() => setAvatarUrls((prev) => prev.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ background: "#7f1d1d", color: "#fff" }}>✕</button>
                  </div>
                ))}
                {avatarUrls.length < 2 && (
                  <label className="w-14 h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold cursor-pointer" style={{ border: `1px dashed ${THEME}88`, color: THEME }}>
                    <input type="file" accept="image/*" className="hidden" disabled={avatarUploading} onChange={(e) => { const f = e.target.files?.[0]; e.currentTarget.value = ""; if (f) void uploadAvatar(f); }} />
                    {avatarUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><UserRound className="w-4 h-4" /><span>+ Muka</span></>}
                  </label>
                )}
              </div>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">Upload 1–2 gambar muka SAMA (angle berbeza = lebih konsisten). Frame tanpa orang (produk sahaja) takkan tunjuk avatar.</p>
            </div>
          )}
        </div>
      )}

      {/* 2. MAIN */}
      {productReady && (
        <div className="rounded-2xl p-4" style={box}>
          <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: THEME }}>2 · Kategori</div>
          <div className="grid grid-cols-3 gap-2">
            {MAIN_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => setMain(o.value)} className="text-left px-3 py-2.5 rounded-lg" style={{ border: `1px solid ${main === o.value ? THEME : "var(--color-border)"}`, background: main === o.value ? `${THEME}18` : "var(--color-bg)" }}>
                <span className="block text-[13px] font-bold text-[var(--color-text-primary)]">{o.label}</span>
                <span className="block text-[11px] text-[var(--color-text-muted)]">{o.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 3. Custom Idea textarea (when Custom Idea category picked) */}
      {productReady && isCustom && (
        <div className="rounded-2xl p-4" style={box}>
          <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: THEME }}>3 · Idea Anda</div>
          <textarea
            value={customIdea}
            onChange={(e) => setCustomIdea(e.target.value)}
            placeholder="Tulis idea storyboard anda… cth: 'Preview botol AuraWhite depan cermin vanity, morning routine, tunjuk before/after glow'"
            rows={4}
            className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-none text-[var(--color-text-primary)]"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-bg)" }}
          />
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5">AI akan bina storyboard ikut idea ni. Kuantiti &gt; 1 → variasi berbeza (tak sama antara satu sama lain & minggu lepas).</p>
        </div>
      )}

      {/* 3. SUB — multi-select (ugc/pc only) */}
      {productReady && main && !isCustom && (
        <div className="rounded-2xl p-4" style={box}>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: THEME }}>3 · Sub-style</span>
            {/* Page 1 = proven set · Pages 2-3 = extra variety (all distinct). */}
            <div className="flex items-center gap-1">
              {SUB_PAGES.map((p) => (
                <button
                  key={p}
                  onClick={() => { if (p !== subPage) { setSubPage(p); setSubs([]); } }}
                  title={p === 1 ? "Set asal (proven)" : `Set variasi ${p} — sub-style lain`}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-md"
                  style={{ border: `1px solid ${subPage === p ? THEME : "var(--color-border)"}`, background: subPage === p ? `${THEME}22` : "var(--color-bg)", color: subPage === p ? THEME : "var(--color-text-muted)" }}
                >
                  Page {p}{p === 1 ? " ✓" : ""}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-[var(--color-text-muted)] w-full sm:w-auto">
              {subs.length >= 2 ? `${subs.length} sub · campaign (boleh silang kategori)` : "pilih 1 (kuantiti) atau 2+ (campaign)"}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {SUBS_PAGES[subPage][main].map((s) => {
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
      {productReady && main && (subs.length > 0 || isCustom) && (
        <div className="rounded-2xl p-4 space-y-3" style={box}>
          {isCustom || subs.length === 1 ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: THEME }}>Kuantiti</span>
              <div className="flex gap-1.5 flex-wrap">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button key={n} onClick={() => setQty(n)} className="w-8 h-8 rounded-lg text-[12px] font-bold" style={{ border: `1px solid ${qty === n ? THEME : "var(--color-border)"}`, background: qty === n ? THEME : "var(--color-bg)", color: qty === n ? "#1a1a1a" : "var(--color-text-primary)" }}>{n}</button>
                ))}
              </div>
              {/* No CTA — skip any call-to-action frame in the storyboard. */}
              <label className="flex items-center gap-1.5 cursor-pointer select-none ml-auto text-[12px] font-bold px-2.5 py-1.5 rounded-lg" style={{ border: `1px solid ${noCta ? THEME : "var(--color-border)"}`, background: noCta ? `${THEME}18` : "var(--color-bg)", color: "var(--color-text-primary)" }}>
                <input type="checkbox" checked={noCta} onChange={(e) => setNoCta(e.target.checked)} className="accent-[#f5b100]" />
                No CTA
              </label>
            </div>
          ) : (
            <div className="rounded-lg p-3" style={{ background: `${THEME}14`, border: `1px solid ${THEME}44` }}>
              <div className="text-[11px] font-bold mb-2" style={{ color: THEME }}>🎬 Campaign bersambung — susun turutan (atas = Video 1, bawah = penutup + CTA)</div>
              <div className="space-y-1.5">
                {subs.map((x, i) => (
                  <div key={x.sub} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
                    <span className="text-[11px] font-bold rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0" style={{ background: THEME, color: "#1a1a1a" }}>{i + 1}</span>
                    <span className="flex-1 text-[12px] font-semibold text-[var(--color-text-primary)] truncate">{x.sub} <span className="text-[10px] text-[var(--color-text-muted)]">· {x.main === "ugc" ? "UGC" : "PC"}{i === subs.length - 1 ? " · CTA" : ""}</span></span>
                    <button onClick={() => moveSub(i, -1)} disabled={i === 0} className="w-6 h-6 rounded text-[13px] disabled:opacity-30" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>↑</button>
                    <button onClick={() => moveSub(i, 1)} disabled={i === subs.length - 1} className="w-6 h-6 rounded text-[13px] disabled:opacity-30" style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>↓</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* No subtitle — applies to every mode (single + campaign). */}
          <label className="flex items-center gap-2 cursor-pointer select-none text-[12px] font-bold px-3 py-2 rounded-lg" style={{ border: `1px solid ${noSubtitle ? THEME : "var(--color-border)"}`, background: noSubtitle ? `${THEME}18` : "var(--color-bg)", color: "var(--color-text-primary)" }}>
            <input type="checkbox" checked={noSubtitle} onChange={(e) => setNoSubtitle(e.target.checked)} className="accent-[#f5b100]" />
            No subtitle
            <span className="text-[10px] font-normal text-[var(--color-text-muted)]">— storyboard 100% tiada text (hard rule)</span>
          </label>
          <button onClick={generate} disabled={busy} className="w-full py-3 rounded-xl text-[14px] font-bold flex items-center justify-center gap-2" style={{ background: THEME, color: "#1a1a1a", opacity: busy ? 0.6 : 1 }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {busy ? "Menjana…" : isCustom || subs.length === 1 ? `Jana ${qty} Storyboard` : `Jana Campaign (${subs.length} storyboard)`}
          </button>
        </div>
      )}

      {msg && <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#3a2a0a", color: "#fcd34d", border: "1px solid #78591c" }}>{msg}</div>}
      {err && <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "#3a0a0a", color: "#fca5a5", border: "1px solid #7f1d1d" }}>⚠️ {err}</div>}
    </div>
  );
}
