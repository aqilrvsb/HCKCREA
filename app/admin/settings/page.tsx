"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Save,
  KeyRound,
  Cpu,
  Package,
  MessageCircle,
  Image as ImageIcon,
  Video,
  Film,
} from "lucide-react";

type Setting = { key: string; value: any; description: string | null; category: string };
type Provider = "p1" | "p2";
type AssetKind = "image" | "video" | "cinema";

const CATEGORY_INFO: Record<string, { label: string; icon: any; color: string }> = {
  provider: { label: "Provider Keys & URLs", icon: KeyRound, color: "text-orange" },
  model:    { label: "AI Models",            icon: Cpu,      color: "text-blue-600" },
  plan:     { label: "Plans",                icon: Package,  color: "text-emerald-600" },
  pricing:  { label: "Pricing",              icon: Package,  color: "text-violet-600" },
  general:  { label: "General",              icon: Cpu,      color: "text-gray-600" },
};

export default function AdminSettings() {
  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [waInstance, setWaInstance] = useState("");
  const [waLabel, setWaLabel] = useState("Default");
  const [savingWa, setSavingWa] = useState(false);

  // Active provider per asset class — surfaced as plain dropdowns in
  // the top card so admin doesn't have to edit JSON to flip backends.
  const [providers, setProviders] = useState<Record<AssetKind, Provider>>({
    image: "p2",
    video: "p2",
    cinema: "p2",
  });
  const [savingProvider, setSavingProvider] = useState<AssetKind | null>(null);

  useEffect(() => {
    void load();
    void loadAdminDevice();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/settings", { cache: "no-store" });
      const d = await r.json();
      const list: Setting[] = d?.rows || [];
      setRows(list);
      // Derive the currently-active provider per asset from the
      // gen_provider_<asset> rows so the top dropdowns reflect reality.
      const next = { image: "p2" as Provider, video: "p2" as Provider, cinema: "p2" as Provider };
      for (const row of list) {
        if (row.key === "gen_provider_image") next.image = row.value?.provider === "p1" ? "p1" : "p2";
        if (row.key === "gen_provider_video") next.video = row.value?.provider === "p1" ? "p1" : "p2";
        if (row.key === "gen_provider_cinema") next.cinema = row.value?.provider === "p1" ? "p1" : "p2";
      }
      setProviders(next);
    } finally {
      setLoading(false);
    }
  }

  async function saveProvider(asset: AssetKind, next: Provider) {
    setSavingProvider(asset);
    try {
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `gen_provider_${asset}`,
          value: { provider: next },
        }),
      });
      setProviders((p) => ({ ...p, [asset]: next }));
      // Refetch so the bottom JSON editors stay in sync with the new value.
      void load();
    } finally {
      setSavingProvider(null);
    }
  }

  async function loadAdminDevice() {
    const r = await fetch("/api/admin/whatsapp-device", { cache: "no-store" });
    const d = await r.json();
    if (d?.device) {
      setWaInstance(d.device.instance || "");
      setWaLabel(d.device.label || "Default");
    }
  }

  async function save(key: string) {
    const raw = edits[key];
    if (raw === undefined) return;
    setSavingKey(key);
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        alert("Invalid JSON for " + key);
        return;
      }
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: parsed }),
      });
      await load();
      setEdits((e) => {
        const c = { ...e };
        delete c[key];
        return c;
      });
    } finally {
      setSavingKey(null);
    }
  }

  async function saveWa() {
    setSavingWa(true);
    try {
      await fetch("/api/admin/whatsapp-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instance: waInstance.trim(), label: waLabel.trim() }),
      });
      await loadAdminDevice();
      alert("WhatsApp device saved.");
    } finally {
      setSavingWa(false);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, Setting[]>();
    for (const r of rows) {
      const cat = r.category || "general";
      if (!m.has(cat)) m.set(cat, []);
      m.get(cat)!.push(r);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display font-extrabold text-3xl tracking-tight">
          App Settings
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Edit values directly. Changes apply immediately on next request.
        </p>
      </div>

      {/* AI Generation Providers — three dropdowns, one per asset class.
          Admin flips here to rotate Crun.ai (p2) ↔ GeminiGen.AI (p1)
          without touching raw JSON. The dropdown state is derived from
          the gen_provider_<asset> rows on load and posts back to the
          same setting key on change. */}
      <div className="card p-6 mb-6 border-2 border-orange-100 bg-orange-50/40">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="w-5 h-5 text-orange" />
          <h2 className="font-display font-bold text-lg">AI Generation Providers</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Pick which backend handles each asset class. Changes apply on the
          next generation; in-flight rows continue against whichever provider
          they were originally fired on.
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          {([
            { key: "image" as AssetKind, label: "Image",  Icon: ImageIcon, hint: "Banana Pro / Imagen / GPT Image 2" },
            { key: "video" as AssetKind, label: "Video (Veo)", Icon: Video,    hint: "Veo 3.1 / 3.1 Fast / Veo 2" },
            { key: "cinema" as AssetKind, label: "Cinema (Grok)", Icon: Film, hint: "Grok 3 / grok-imagine" },
          ]).map(({ key, label, Icon, hint }) => {
            const current = providers[key];
            const isSaving = savingProvider === key;
            return (
              <div
                key={key}
                className="rounded-xl p-4"
                style={{ background: "white", border: "1px solid var(--color-border)" }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="w-4 h-4 text-orange" />
                  <span className="font-bold text-sm">{label}</span>
                  {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto text-orange" />}
                </div>
                <div className="text-[11px] text-[var(--color-text-muted)] mb-2.5">
                  {hint}
                </div>
                <select
                  value={current}
                  disabled={isSaving}
                  onChange={(e) => saveProvider(key, e.target.value as Provider)}
                  className="input text-sm font-bold"
                >
                  <option value="p2">P2 — Crun.ai</option>
                  <option value="p1">P1 — GeminiGen.AI</option>
                </select>
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-[11px] text-[var(--color-text-muted)] flex items-start gap-1.5">
          <span>ⓘ</span>
          <span>
            P1 / P2 endpoint URLs + API keys live in the Provider Keys & URLs
            section below (<code>p1_base</code>, <code>p1_key</code>, <code>p2_base</code>, <code>p2_key</code>).
            GPT Image 2 is hidden in the Image agent when image is on P1.
          </span>
        </div>
      </div>

      {/* WhatsApp device — special case (separate table) */}
      <div className="card p-6 mb-6 border-2 border-emerald-100 bg-emerald-50/40">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle className="w-5 h-5 text-emerald-600" />
          <h2 className="font-display font-bold text-lg">WhatsApp Center Device</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Instance UUID dari Whacenter (whacenter.com). Outbound WhatsApp messages
          (login info, password reset) gunakan device ini.
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          <input
            value={waInstance}
            onChange={(e) => setWaInstance(e.target.value)}
            placeholder="Device instance UUID"
            className="input md:col-span-2 font-mono text-xs"
          />
          <input
            value={waLabel}
            onChange={(e) => setWaLabel(e.target.value)}
            placeholder="Label"
            className="input"
          />
        </div>
        <button
          onClick={saveWa}
          disabled={savingWa || !waInstance.trim()}
          className="btn-primary mt-3 disabled:opacity-50"
        >
          {savingWa ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save device
        </button>
      </div>

      {loading ? (
        <div className="card p-12 text-center">
          <Loader2 className="w-5 h-5 animate-spin inline text-orange" />
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([cat, items]) => {
            const info = CATEGORY_INFO[cat] || CATEGORY_INFO.general;
            const Icon = info.icon;
            return (
              <div key={cat} className="card p-6">
                <div className="flex items-center gap-2 mb-5 pb-4 border-b border-[var(--color-border)]">
                  <Icon className={`w-5 h-5 ${info.color}`} />
                  <h2 className="font-display font-bold text-lg">{info.label}</h2>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold ml-2">
                    {items.length} keys
                  </span>
                </div>
                <div className="space-y-4">
                  {items.map((s) => {
                    const editing = edits[s.key];
                    const display =
                      editing !== undefined
                        ? editing
                        : JSON.stringify(s.value, null, 2);
                    const isLong = display.length > 80;
                    return (
                      <div key={s.key}>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <code className="font-mono text-xs font-bold text-[var(--color-text-primary)]">
                            {s.key}
                          </code>
                          {s.description && (
                            <span className="text-xs text-[var(--color-text-muted)] truncate ml-3">
                              {s.description}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {isLong ? (
                            <textarea
                              rows={Math.min(8, Math.max(2, Math.ceil(display.length / 80)))}
                              value={display}
                              onChange={(e) =>
                                setEdits({ ...edits, [s.key]: e.target.value })
                              }
                              className="input flex-1 font-mono text-xs resize-y"
                            />
                          ) : (
                            <input
                              value={display}
                              onChange={(e) =>
                                setEdits({ ...edits, [s.key]: e.target.value })
                              }
                              className="input flex-1 font-mono text-xs"
                            />
                          )}
                          <button
                            disabled={editing === undefined || savingKey === s.key}
                            onClick={() => save(s.key)}
                            className="btn-primary text-xs px-4 disabled:opacity-30"
                          >
                            {savingKey === s.key ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Save className="w-3.5 h-3.5" />
                            )}
                            Save
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
