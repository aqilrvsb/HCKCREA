"use client";

// Greetings tab — a LIBRARY of greeting profiles. Pick the active one in the
// Rundown (Livehost tab). Stored in localStorage (livehost_greet_lib +
// livehost_active_greet); the active profile is synced to the DB greet-config
// so the Chrome extension uses it. Logic mirror of extension-aihost:
// rotate greetings sequentially, random delay min–max, follow→clap,
// purchase→bell, comments→avatar reply focused on the selected product.

import { useCallback, useEffect, useRef, useState } from "react";
import { hydrateLivehostState, saveLivehostState } from "@/lib/livehost-state";
import { confirmDelete } from "@/lib/confirm";
import { LhSection, LhCard, LhCardHeader, LhLabel, LhButton, LhGrid, LhModal, LH_FIELD_STYLE, ORANGE } from "./livehost-ui";

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
  greetDelayMin: 4,
  greetDelayMax: 12,
  followGreeting: "Terima kasih [username] sebab follow TikTok kami!",
  likeGreeting: "Terima kasih [username] sebab like!",
  commentDelayMin: 5,
  commentDelayMax: 15,
  selectedProduct: "",
  sfxAuto: false, // clap/bell OFF by default (avoids SFX-before-reply timing)
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
  const [activeId, setActiveId] = useState(""); // the live-active profile
  const [gDraft, setGDraft] = useState<Profile | null>(null); // open in the modal (draft)
  const [msg, setMsg] = useState("");
  const products = useRef<string[]>([]);

  const hydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const applyLocal = () => {
      const lib = loadLib();
      setProfiles(lib);
      setActiveId(localStorage.getItem("livehost_active_greet") || lib[0].id);
      try {
        const plib = JSON.parse(localStorage.getItem("livehost_products_lib") || "[]");
        products.current = (plib as { title: string }[]).map((p) => p.title);
      } catch {}
    };
    // Instant render from the cache; reconcile with the DB in the background.
    applyLocal();
    hydrateLivehostState().then(() => {
      if (cancelled) return;
      applyLocal();
      hydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, []);

  // persist + sync active profile to the DB (for the extension)
  useEffect(() => {
    if (!profiles.length) return;
    try {
      localStorage.setItem("livehost_greet_lib", JSON.stringify(profiles));
      localStorage.setItem("livehost_active_greet", activeId);
    } catch {}
    if (hydratedRef.current) saveLivehostState();
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

  // `cur` / `up` edit a DRAFT — only committed to the list on Save, so a
  // cancelled "new" never leaves a junk profile.
  const cur = gDraft;
  const up = useCallback((patch: Partial<Profile>) => {
    setGDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);
  const saveDraft = () => {
    const d = gDraft;
    if (!d) return;
    setProfiles((prev) => (prev.some((p) => p.id === d.id) ? prev.map((p) => (p.id === d.id ? d : p)) : [...prev, d]));
    setActiveId(d.id);
    setGDraft(null);
  };
  const delProfile = async (id: string) => {
    if (!(await confirmDelete("Padam profil greeting ini?"))) return;
    setProfiles((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length && id === activeId) setActiveId(next[0].id);
      return next.length ? next : [{ id: "g1", title: "Greeting 1", ...DEFAULT_FIELDS }];
    });
  };

  const F = LH_FIELD_STYLE;
  const twoCol: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 };
  const greetCount = cur ? cur.greetings.split(/\n+/).filter((l) => l.trim()).length : 0;

  return (
    <LhSection>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-extrabold text-xl tracking-tight" style={{ color: "#1a1a1a" }}>Greetings</h2>
          <p className="text-xs mt-0.5" style={{ color: "#888" }}>Profil greeting avatar — pilih satu yang aktif untuk live.</p>
        </div>
        <LhButton onClick={() => setGDraft({ id: "g" + Date.now().toString(36), title: `Greeting ${profiles.length + 1}`, ...DEFAULT_FIELDS })}>➕ Profil baru</LhButton>
      </div>

      {/* History */}
      <LhCard>
        <LhCardHeader icon="📁" title={`Semua Profil (${profiles.length})`} />
        {profiles.length === 0 ? (
          <p className="text-sm" style={{ color: "#888" }}>Tiada profil lagi. Tekan ➕ Profil baru untuk mula.</p>
        ) : (
          <LhGrid min={200}>
            {profiles.map((p) => {
              const isActive = p.id === activeId;
              return (
                <div key={p.id} onClick={() => setGDraft({ ...p })} title="Klik untuk edit"
                  style={{ position: "relative", cursor: "pointer", borderRadius: 14, padding: "12px 14px", minHeight: 92,
                    background: isActive ? "#fff7ed" : "#fafaf7", border: `1px solid ${isActive ? ORANGE : "#e8e0d8"}`,
                    ...(isActive ? { boxShadow: `0 0 0 1px ${ORANGE}` } : {}) }}>
                  <button type="button" title="Padam" onClick={(e) => { e.stopPropagation(); delProfile(p.id); }}
                    style={{ position: "absolute", top: 8, right: 8, border: "1px solid #f3c0c0", background: "#fff0f0", color: "#e23", borderRadius: 8, padding: "3px 7px", fontSize: 11, cursor: "pointer" }}>🗑</button>
                  <div style={{ fontWeight: 800, fontSize: 13, paddingRight: 30, color: "#1a1a1a" }}>{p.title || "Tanpa nama"}</div>
                  {isActive && <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: "#16a34a", marginTop: 2 }}>● aktif</div>}
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.greetings}</div>
                </div>
              );
            })}
          </LhGrid>
        )}
      </LhCard>

      {/* Editor modal */}
      <LhModal open={!!cur} onClose={() => setGDraft(null)} title="Greeting Profile" maxWidth={680}>
        {cur && (
          <>
            <LhLabel>Nama profil</LhLabel>
            <input style={F} value={cur.title} onChange={(e) => up({ title: e.target.value })} />

            <div style={{ marginTop: 14 }}><LhLabel>Greeting (JOIN) — {greetCount} ayat, berputar ikut giliran</LhLabel></div>
            <textarea style={{ ...F, minHeight: 130, resize: "vertical" }} rows={7} value={cur.greetings}
              onChange={(e) => up({ greetings: e.target.value })} placeholder={"Satu ayat satu baris. Guna [username]."} />
            <div style={twoCol}>
              <div><LhLabel>Delay Min (saat)</LhLabel><input style={F} type="number" min={3} value={cur.greetDelayMin} onChange={(e) => up({ greetDelayMin: parseInt(e.target.value) || 20 })} /></div>
              <div><LhLabel>Delay Max (saat)</LhLabel><input style={F} type="number" min={3} value={cur.greetDelayMax} onChange={(e) => up({ greetDelayMax: parseInt(e.target.value) || 45 })} /></div>
            </div>

            <div style={{ marginTop: 18 }}><LhLabel>💚 Greeting FOLLOW (👏 clap)</LhLabel></div>
            <input style={F} value={cur.followGreeting} onChange={(e) => up({ followGreeting: e.target.value })} />
            <div style={{ marginTop: 14 }}><LhLabel>👍 Greeting LIKE</LhLabel></div>
            <input style={F} value={cur.likeGreeting} onChange={(e) => up({ likeGreeting: e.target.value })} />

            {/* Komen reply applies to ALL products (avatar answers using the full
                Knowledge base) — product picker hidden intentionally. */}
            <div style={{ marginTop: 18 }}><LhLabel>💬 Komen — reply delay</LhLabel></div>
            <div style={twoCol}>
              <div><LhLabel>Reply Delay Min (saat)</LhLabel><input style={F} type="number" min={1} value={cur.commentDelayMin} onChange={(e) => up({ commentDelayMin: parseInt(e.target.value) || 5 })} /></div>
              <div><LhLabel>Reply Delay Max (saat)</LhLabel><input style={F} type="number" min={1} value={cur.commentDelayMax} onChange={(e) => up({ commentDelayMax: parseInt(e.target.value) || 15 })} /></div>
            </div>

            <label className="flex items-center gap-2 mt-4 text-xs" style={{ color: "#555" }}>
              <input type="checkbox" checked={cur.sfxAuto} onChange={(e) => up({ sfxAuto: e.target.checked })} style={{ width: "auto", accentColor: "#f59e0b" }} />
              🔊 Auto: Purchase → 🔔 bell + suara · Feedback → suara + 👏 clap · Follow → 👏 clap
            </label>

            <div className="flex items-center justify-end mt-5">
              <LhButton onClick={saveDraft} style={{ background: "#16a34a", color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(22,163,74,.3)" }}>💾 Save</LhButton>
            </div>
            {msg && <p className="text-[11px] mt-2" style={{ color: "#16a34a" }}>{msg}</p>}
          </>
        )}
      </LhModal>
    </LhSection>
  );
}
