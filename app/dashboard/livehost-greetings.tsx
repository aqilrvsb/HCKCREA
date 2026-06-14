"use client";

// Greetings tab — a LIBRARY of greeting profiles. Pick the active one in the
// Rundown (Livehost tab). Stored in localStorage (livehost_greet_lib +
// livehost_active_greet); the active profile is synced to the DB greet-config
// so the Chrome extension uses it. Logic mirror of extension-aihost:
// rotate greetings sequentially, random delay min–max, follow→clap,
// purchase→bell, comments→avatar reply focused on the selected product.

import { useCallback, useEffect, useRef, useState } from "react";

type Profile = {
  id: string;
  title: string;
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

const DEFAULT_FIELDS = {
  greetings:
    "Selamat datang [username]! Boleh komen kalau ada soalan tau\nHai [username]! Welcome, boleh tanya apa-apa je\nWelcome [username]! Jangan lupa tekan beg kuning tau\nHai [username], selamat datang! Boleh komen2 ye\nWelcome [username]! Kalau nak tahu harga, boleh tanya je\nHai [username]! Terima kasih sebab join, stay tau",
  greetDelayMin: 20,
  greetDelayMax: 45,
  followGreeting: "Terima kasih [username] sebab follow TikTok kami!",
  likeGreeting: "Terima kasih [username] sebab like!",
  commentDelayMin: 5,
  commentDelayMax: 15,
  selectedProduct: "",
  sfxAuto: true,
};

function loadLib(): Profile[] {
  try {
    const lib = JSON.parse(localStorage.getItem("livehost_greet_lib") || "[]");
    if (Array.isArray(lib) && lib.length) return lib;
  } catch {}
  return [{ id: "g1", title: "Greeting 1", ...DEFAULT_FIELDS }];
}

export default function LivehostGreetings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState("");
  const [msg, setMsg] = useState("");
  const products = useRef<string[]>([]);

  useEffect(() => {
    const lib = loadLib();
    setProfiles(lib);
    setActiveId(localStorage.getItem("livehost_active_greet") || lib[0].id);
    try {
      const plib = JSON.parse(localStorage.getItem("livehost_products_lib") || "[]");
      products.current = (plib as { title: string }[]).map((p) => p.title);
    } catch {}
  }, []);

  // persist + sync active profile to the DB (for the extension)
  useEffect(() => {
    if (!profiles.length) return;
    try {
      localStorage.setItem("livehost_greet_lib", JSON.stringify(profiles));
      localStorage.setItem("livehost_active_greet", activeId);
    } catch {}
    const g = profiles.find((p) => p.id === activeId);
    if (!g) return;
    const t = setTimeout(() => {
      const { id, title, ...config } = g;
      fetch("/api/livehost/greet-config", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ config }),
      }).then(() => setMsg("✓ Disimpan — extension guna profil aktif ini")).catch(() => {});
    }, 700);
    return () => clearTimeout(t);
  }, [profiles, activeId]);

  const cur = profiles.find((p) => p.id === activeId);
  const up = useCallback((patch: Partial<Profile>) => {
    setProfiles((prev) => prev.map((p) => (p.id === activeId ? { ...p, ...patch } : p)));
  }, [activeId]);
  const addProfile = () => {
    const id = "g" + Date.now().toString(36);
    setProfiles((prev) => [...prev, { id, title: `Greeting ${prev.length + 1}`, ...DEFAULT_FIELDS }]);
    setActiveId(id);
  };
  const delProfile = (id: string) => {
    setProfiles((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length && id === activeId) setActiveId(next[0].id);
      return next.length ? next : [{ id: "g1", title: "Greeting 1", ...DEFAULT_FIELDS }];
    });
  };

  if (!cur) return <div className="panel single"><div className="hint">Loading…</div></div>;
  const greetCount = cur.greetings.split(/\n+/).filter((l) => l.trim()).length;

  return (
    <>
      <div className="lib-head">
        <div>
          <h2 className="lib-title">Greetings</h2>
          <p className="lib-sub">Profil greeting avatar — pilih satu yang aktif untuk live.</p>
        </div>
        <button className="filebtn" onClick={addProfile}>➕ Profil baru</button>
      </div>

      <div className="panel single">
      <div className="label">Nama profil</div>
      <input value={cur.title} onChange={(e) => up({ title: e.target.value })} />

      <div className="label" style={{ marginTop: 12 }}>Greeting (JOIN) — {greetCount} ayat, berputar ikut giliran</div>
      <textarea rows={7} value={cur.greetings} onChange={(e) => up({ greetings: e.target.value })}
        placeholder={"Satu ayat satu baris. Guna [username]."} />
      <div className="row">
        <div style={{ flex: 1 }}><div className="label">Delay Min (saat)</div>
          <input type="number" min={3} value={cur.greetDelayMin} onChange={(e) => up({ greetDelayMin: parseInt(e.target.value) || 20 })} /></div>
        <div style={{ flex: 1 }}><div className="label">Delay Max (saat)</div>
          <input type="number" min={3} value={cur.greetDelayMax} onChange={(e) => up({ greetDelayMax: parseInt(e.target.value) || 45 })} /></div>
      </div>

      <div className="label" style={{ marginTop: 12 }}>💚 Greeting FOLLOW (👏 clap)</div>
      <input value={cur.followGreeting} onChange={(e) => up({ followGreeting: e.target.value })} />
      <div className="label">👍 Greeting LIKE</div>
      <input value={cur.likeGreeting} onChange={(e) => up({ likeGreeting: e.target.value })} />

      <div className="label" style={{ marginTop: 12 }}>💬 Komen — avatar jawab fokus produk</div>
      <select value={cur.selectedProduct} onChange={(e) => up({ selectedProduct: e.target.value })}>
        <option value="">— Semua produk —</option>
        {products.current.map((p) => (<option key={p} value={p}>{p}</option>))}
      </select>
      <div className="row">
        <div style={{ flex: 1 }}><div className="label">Reply Delay Min (saat)</div>
          <input type="number" min={1} value={cur.commentDelayMin} onChange={(e) => up({ commentDelayMin: parseInt(e.target.value) || 5 })} /></div>
        <div style={{ flex: 1 }}><div className="label">Reply Delay Max (saat)</div>
          <input type="number" min={1} value={cur.commentDelayMax} onChange={(e) => up({ commentDelayMax: parseInt(e.target.value) || 15 })} /></div>
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={cur.sfxAuto} onChange={(e) => up({ sfxAuto: e.target.checked })} style={{ width: "auto" }} />
        🔊 Auto: Purchase → 🔔 bell + suara · Feedback → suara + 👏 clap · Follow → 👏 clap
      </label>
      </div>

      <div className="label" style={{ marginTop: 6 }}>📁 Semua profil ({profiles.length})</div>
      <div className="lib-grid">
        {profiles.map((p) => (
          <div key={p.id} className={`lib-card${p.id === activeId ? " active" : ""}`}
            onClick={() => setActiveId(p.id)} title="Klik untuk edit / jadikan aktif">
            <button type="button" className="tpl-del-btn" title="Padam" onClick={(e) => { e.stopPropagation(); delProfile(p.id); }}>🗑</button>
            <div className="lib-card-title">{p.title || "Tanpa nama"}</div>
            {p.id === activeId && <span className="lib-badge">● aktif</span>}
            <div className="lib-card-preview">{p.greetings}</div>
          </div>
        ))}
      </div>
    </>
  );
}
