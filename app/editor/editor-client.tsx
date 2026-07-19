"use client";

import { useEffect, useState } from "react";
import { Loader2, Scissors, Sparkles, Palette, X, RefreshCw, Eye } from "lucide-react";

type EdVideo = {
  id: string;
  output_url: string | null;
  thumbnail_url: string | null;
  duration: number | null;
  caption: string;
  cover_title: string;
  cover_subtitle: string;
  cover_thumbnail_url: string;
  product_name: string;
  tiktok_product_id: string;
};
type Product = { product_id: string; product_name: string; detail?: string };

function seedFromId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export default function EditorClient({ projectId, embedded }: { projectId?: string; embedded?: boolean }) {
  const listUrl = `/api/editor/list${projectId ? `?p=${encodeURIComponent(projectId)}` : ""}`;
  const [videos, setVideos] = useState<EdVideo[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [textChecked, setTextChecked] = useState<Set<string>>(new Set());
  const [coverChecked, setCoverChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyText, setBusyText] = useState(false);
  const [busyCover, setBusyCover] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);

  const addLog = (m: string) => setLog((l) => [m, ...l].slice(0, 50));

  async function refreshVideos() {
    try {
      const r = await fetch(listUrl, { cache: "no-store" });
      const d = await r.json();
      setVideos((d?.rows || []) as EdVideo[]);
    } catch { /* ignore */ }
  }
  async function load() {
    setLoading(true);
    try {
      const [v, p] = await Promise.all([
        fetch(listUrl, { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/auto-content/saved-products", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setVideos((v?.rows || []) as EdVideo[]);
      setProducts((p?.items || []) as Product[]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    setSet(n);
  };
  const allText = () => {
    const ids = videos.map((v) => v.id);
    const on = ids.length > 0 && ids.every((i) => textChecked.has(i));
    setTextChecked(on ? new Set() : new Set(ids));
  };
  const allCover = () => {
    const ids = videos.map((v) => v.id);
    const on = ids.length > 0 && ids.every((i) => coverChecked.has(i));
    setCoverChecked(on ? new Set() : new Set(ids));
  };

  async function removeVideo(id: string) {
    await fetch("/api/editor/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history_id: id, in_editor: false }),
    });
    setVideos((vs) => vs.filter((v) => v.id !== id));
  }

  async function generateText() {
    const product = products.find((p) => String(p.product_id) === productId);
    if (!product) { addLog("⚠ Pilih produk dulu."); return; }
    const ids = [...textChecked].filter((id) => videos.some((v) => v.id === id));
    if (!ids.length) { addLog("⚠ Tick 📝 pada video dulu."); return; }
    const productUrl = "https://www.tiktok.com/shop/my/pdp/product/" + product.product_id;
    setBusyText(true);
    addLog(`Generate Text "${product.product_name}" untuk ${ids.length} video…`);
    let ok = 0, idx = 0;
    const worker = async () => {
      while (idx < ids.length) {
        const id = ids[idx++];
        try {
          const r = await fetch("/api/ugc/generate-post-meta", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              history_id: id,
              product_url: productUrl,
              product_name: product.product_name,
              product_detail: product.detail || "",
              variant_seed: seedFromId(id),
            }),
          });
          const d = await r.json();
          if (r.ok && (d.caption || d.cover_title)) ok++;
          else addLog(`  ✗ ${id.slice(0, 6)}: ${d.error || "tak lengkap"}`);
        } catch (e: any) {
          addLog(`  ✗ ${id.slice(0, 6)}: ${e?.message || "error"}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker));
    await refreshVideos();
    addLog(`✓ Text siap — ${ok}/${ids.length} lengkap.`);
    setBusyText(false);
  }

  async function generateCover() {
    const ids = [...coverChecked].filter((id) => videos.some((v) => v.id === id));
    if (!ids.length) { addLog("⚠ Tick 🎨 pada video dulu."); return; }
    setBusyCover(true);
    addLog(`Generate Cover untuk ${ids.length} video…`);
    let ok = 0, skip = 0, idx = 0;
    const worker = async () => {
      while (idx < ids.length) {
        const id = ids[idx++];
        const v = videos.find((x) => x.id === id);
        const title = String(v?.cover_title || "").trim();
        const sub = String(v?.cover_subtitle || "").trim();
        if (!title || !sub) {
          skip++;
          addLog(`  ✗ ${id.slice(0, 6)}: cover title/subtitle kosong — Generate Text dulu`);
          continue;
        }
        try {
          const r = await fetch("/api/extension/generate-cover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ history_id: id, cover_title: title, cover_subtitle: sub }),
          });
          const d = await r.json();
          const url = d.cover_thumbnail_url || d.url || "";
          if (r.ok && url) ok++;
          else addLog(`  ✗ ${id.slice(0, 6)}: ${d.error || "cover gagal"}`);
        } catch (e: any) {
          addLog(`  ✗ ${id.slice(0, 6)}: ${e?.message || "error"}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
    await refreshVideos();
    addLog(`✓ Cover siap — ${ok}/${ids.length}${skip ? `, ${skip} skip` : ""}.`);
    setBusyCover(false);
  }

  const busy = busyText || busyCover;

  return (
    <div className={embedded ? "" : "min-h-screen p-5 md:p-8"} style={embedded ? { color: "var(--color-text-primary)" } : { background: "var(--color-bg)", color: "var(--color-text-primary)" }}>
      <div className={embedded ? "" : "max-w-5xl mx-auto"}>
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "rgba(139,92,246,0.14)", border: "1px solid rgba(139,92,246,0.35)" }}>
            <Scissors className="w-5 h-5" style={{ color: "#a78bfa" }} />
          </div>
          <div className="flex-1">
            <h1 className="font-display font-extrabold text-2xl tracking-tight">Editor</h1>
            <p className="text-sm text-[var(--color-text-secondary)]">Video yang anda pindah (⇄) dari tab video. Tick Text / Cover, kemudian jana beramai-ramai.</p>
          </div>
          <button onClick={() => void load()} className="p-2 rounded-lg" style={{ border: "1px solid var(--color-border)" }} title="Refresh">
            <RefreshCw className="w-4 h-4 text-[var(--color-text-muted)]" />
          </button>
        </div>

        {/* Controls */}
        <div className="rounded-2xl p-4 mb-5" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
          <label className="block text-[11px] uppercase tracking-wider font-bold text-[var(--color-text-muted)] mb-2">Produk (untuk Generate Text)</label>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="w-full mb-3 px-3 py-2 rounded-lg text-sm"
            style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          >
            <option value="">— Pilih produk —</option>
            {products.map((p) => (
              <option key={p.product_id} value={p.product_id}>{p.product_name || "Unnamed"}</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button onClick={allText} className="text-xs font-extrabold px-3 py-2 rounded-lg" style={{ background: "rgba(96,165,250,0.14)", color: "#60a5fa", border: "1px solid #60a5fa" }}>📝 All Text</button>
            <button onClick={allCover} className="text-xs font-extrabold px-3 py-2 rounded-lg" style={{ background: "rgba(245,158,11,0.14)", color: "#f59e0b", border: "1px solid #f59e0b" }}>🎨 All Cover</button>
            <div className="flex-1" />
            <button onClick={() => void generateText()} disabled={busy} className="text-xs font-extrabold px-4 py-2 rounded-lg text-white disabled:opacity-50 inline-flex items-center gap-1.5" style={{ background: "linear-gradient(135deg,#3b82f6,#60a5fa)" }}>
              {busyText ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Generate Text
            </button>
            <button onClick={() => void generateCover()} disabled={busy} className="text-xs font-extrabold px-4 py-2 rounded-lg disabled:opacity-50 inline-flex items-center gap-1.5" style={{ background: "linear-gradient(135deg,#f59e0b,#ea580c)", color: "#fff" }}>
              {busyCover ? <Loader2 className="w-4 h-4 animate-spin" /> : <Palette className="w-4 h-4" />} Generate Cover
            </button>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-2">Generate Text dulu (isi caption + cover title/subtitle), kemudian Generate Cover.</p>
        </div>

        {/* Video grid */}
        {loading ? (
          <div className="py-16 text-center text-sm text-[var(--color-text-muted)]"><Loader2 className="w-5 h-5 animate-spin inline-block mr-2" /> Loading…</div>
        ) : videos.length === 0 ? (
          <div className="py-16 text-center text-sm text-[var(--color-text-muted)]">Tiada video. Di dashboard, tekan ikon ⇄ (Pindah ke Editor) pada video yang anda mahu.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {videos.map((v) => {
              const textOn = textChecked.has(v.id);
              const coverOn = coverChecked.has(v.id);
              const hasCap = !!v.caption && /#\w/.test(v.caption);
              return (
                <div key={v.id} className="rounded-xl overflow-hidden relative" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
                  <div className="relative bg-black" style={{ aspectRatio: "9/16" }}>
                    {v.output_url ? (
                      <video src={v.output_url} className="w-full h-full object-cover" muted playsInline preload="metadata" poster={v.thumbnail_url || undefined} />
                    ) : v.thumbnail_url ? (
                      <img src={v.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl opacity-40">🎬</div>
                    )}
                    <button onClick={() => void removeVideo(v.id)} title="Buang dari Editor" className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md flex items-center justify-center text-white" style={{ background: "rgba(239,68,68,0.85)" }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                    {v.cover_thumbnail_url && (
                      <button onClick={() => setZoom(v.cover_thumbnail_url)} title="Lihat cover" className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white inline-flex items-center gap-0.5" style={{ background: "rgba(34,197,94,0.9)" }}>
                        🎨 <Eye className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="text-[11px] font-bold truncate">{v.product_name || v.cover_title || "Video"}</div>
                    <div className="text-[9px] text-[var(--color-text-muted)] mb-1.5">{hasCap ? "📝 ✓" : "📝 —"} · {v.cover_thumbnail_url ? "🎨 ✓" : "🎨 —"}</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => toggle(textChecked, setTextChecked, v.id)} className="flex-1 text-[10px] font-extrabold py-1 rounded-md border" style={textOn ? { background: "#60a5fa", color: "#0a0a0a", borderColor: "#60a5fa" } : { background: "transparent", color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }}>{textOn ? "✓ " : ""}📝</button>
                      <button onClick={() => toggle(coverChecked, setCoverChecked, v.id)} className="flex-1 text-[10px] font-extrabold py-1 rounded-md border" style={coverOn ? { background: "#f59e0b", color: "#0a0a0a", borderColor: "#f59e0b" } : { background: "transparent", color: "var(--color-text-secondary)", borderColor: "var(--color-border)" }}>{coverOn ? "✓ " : ""}🎨</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Log */}
        {log.length > 0 && (
          <div className="mt-6 rounded-2xl p-3 font-mono text-[11px] max-h-48 overflow-y-auto" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
      </div>

      {zoom && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,0.88)" }} onClick={() => setZoom(null)}>
          <img src={zoom} alt="cover" className="max-w-full max-h-full object-contain rounded-lg" />
        </div>
      )}
    </div>
  );
}
