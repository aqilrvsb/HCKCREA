"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Save, KeyRound, Cpu, Package, MessageCircle } from "lucide-react";

type Setting = { key: string; value: any; description: string | null; category: string };

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

  useEffect(() => {
    void load();
    void loadAdminDevice();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/settings", { cache: "no-store" });
      const d = await r.json();
      setRows(d?.rows || []);
    } finally {
      setLoading(false);
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
