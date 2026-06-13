"use client";

// Greetings tab — config for the TikTok Live extension (DB-backed so the
// extension can fetch it). Logic mirror of extension-aihost:
// rotate greetings sequentially, random delay min–max, follow→clap,
// purchase→bell, comments→avatar reply focused on the selected product.

import { useCallback, useEffect, useState } from "react";

type Cfg = {
  greetings: string;
  greetDelayMin: number;
  greetDelayMax: number;
  followGreeting: string;
  likeGreeting: string;
  commentDelayMin: number;
  commentDelayMax: number;
  selectedProduct: string;
  sfxAuto: boolean;
};

export default function LivehostGreetings() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [products, setProducts] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/livehost/greet-config")
      .then((r) => r.json())
      .then((d) => d.config && setCfg(d.config))
      .catch(() => {});
    // product names parsed from the client's Product Knowledge (lines with RM prices)
    try {
      const kb = localStorage.getItem("livehost_products") || "";
      const names = kb
        .split(/\n+/)
        .map((l) => (l.match(/^([^—\-:]{3,60})\s*[—\-:].*RM/i) || [])[1])
        .filter(Boolean)
        .map((s) => (s as string).trim());
      setProducts([...new Set(names)] as string[]);
    } catch {}
  }, []);

  const save = useCallback(async () => {
    if (!cfg) return;
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/livehost/greet-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: cfg }),
      });
      const d = await r.json();
      setMsg(d.ok ? "✓ Disimpan — extension akan guna config ini" : d.error || "Gagal simpan");
    } finally {
      setSaving(false);
    }
  }, [cfg]);

  if (!cfg) return <div className="panel single"><div className="hint">Loading…</div></div>;
  const up = (patch: Partial<Cfg>) => setCfg({ ...cfg, ...patch });
  const greetCount = cfg.greetings.split(/\n+/).filter((l) => l.trim()).length;

  return (
    <div className="panel single">
      <div className="label">👋 Greeting (JOIN) — {greetCount} ayat, berputar ikut giliran</div>
      <textarea rows={8} value={cfg.greetings} onChange={(e) => up({ greetings: e.target.value })}
        placeholder={"Satu ayat satu baris. Guna [username].\nSelamat datang [username]!"} />
      <div className="hint">Setiap greeting guna delay rawak antara Min–Max saat (macam extension lama).</div>
      <div className="row">
        <div style={{ flex: 1 }}>
          <div className="label">Delay Min (saat)</div>
          <input type="number" min={3} value={cfg.greetDelayMin}
            onChange={(e) => up({ greetDelayMin: parseInt(e.target.value) || 20 })} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="label">Delay Max (saat)</div>
          <input type="number" min={3} value={cfg.greetDelayMax}
            onChange={(e) => up({ greetDelayMax: parseInt(e.target.value) || 45 })} />
        </div>
      </div>

      <div className="label">💚 Greeting FOLLOW (👏 clap + suara)</div>
      <input value={cfg.followGreeting} onChange={(e) => up({ followGreeting: e.target.value })} />
      <div className="label">👍 Greeting LIKE</div>
      <input value={cfg.likeGreeting} onChange={(e) => up({ likeGreeting: e.target.value })} />

      <div className="label">💬 Komen — avatar jawab fokus produk dipilih</div>
      <select value={cfg.selectedProduct} onChange={(e) => up({ selectedProduct: e.target.value })}>
        <option value="">— Semua produk (ikut Product Knowledge) —</option>
        {products.map((p) => (<option key={p} value={p}>{p}</option>))}
      </select>
      <div className="row">
        <div style={{ flex: 1 }}>
          <div className="label">Reply Delay Min (saat)</div>
          <input type="number" min={1} value={cfg.commentDelayMin}
            onChange={(e) => up({ commentDelayMin: parseInt(e.target.value) || 5 })} />
        </div>
        <div style={{ flex: 1 }}>
          <div className="label">Reply Delay Max (saat)</div>
          <input type="number" min={1} value={cfg.commentDelayMax}
            onChange={(e) => up({ commentDelayMax: parseInt(e.target.value) || 15 })} />
        </div>
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={cfg.sfxAuto} onChange={(e) => up({ sfxAuto: e.target.checked })} style={{ width: "auto" }} />
        🔊 Auto sound: Purchase → 🔔 bell + suara · Feedback → suara + 👏 clap · Follow → 👏 clap
      </label>

      <button className="filebtn" onClick={save} disabled={saving} style={{ marginTop: 14 }}>
        {saving ? "Menyimpan…" : "💾 Simpan config"}
      </button>
      {msg && <div className="status-line">{msg}</div>}
      <div className="hint" style={{ marginTop: 10 }}>
        Config ini diguna oleh <b>PeningLab Livehost Extension</b> (Chrome) yang memantau
        TikTok LIVE anda — bila ada join/follow/komen, avatar akan bercakap secara automatik.
      </div>
    </div>
  );
}
