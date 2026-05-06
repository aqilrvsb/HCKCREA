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
  Puzzle,
} from "lucide-react";

type Setting = { key: string; value: any; description: string | null; category: string };
type Provider = "p1" | "p2";
type AssetKind = "image" | "video" | "cinema" | "seedance";

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
    seedance: "p2",
  });
  const [savingProvider, setSavingProvider] = useState<AssetKind | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Extension settings — surfaced as a dedicated card (matches the
  // image 3 reference). Stored under app_settings keys
  // `extension_version` and `extension_download_url`.
  const [extVersion, setExtVersion] = useState("");
  const [extDownloadUrl, setExtDownloadUrl] = useState("");
  const [savingExt, setSavingExt] = useState(false);
  const [extMsg, setExtMsg] = useState<string | null>(null);

  // Per-model pricing — one editable knob per model (rate_<model>).
  // Loaded from app_settings on mount; saved on Apply.
  const [rateBananaPro, setRateBananaPro] = useState("");
  const [rateGptImage, setRateGptImage] = useState("");
  const [rateVeo8, setRateVeo8] = useState("");
  const [rateVeo16, setRateVeo16] = useState("");
  const [rateGrok, setRateGrok] = useState("");
  const [rateSeedance, setRateSeedance] = useState("");
  const [savingRates, setSavingRates] = useState(false);
  const [ratesMsg, setRatesMsg] = useState<string | null>(null);

  // Storytelling (fairytale) generator pricing + model. Reads/writes:
  //   fairytale_image_model:  { model: "z-image" | "nano-banana-pro" | ... }
  //   storytelling_pricing:   { per_image: 0.07, per_audio_sec: 0.02 }
  // Total per render: per_image × scene_count + per_audio_sec × scene_dur × scene_count.
  // Wizard reads this to show an estimated cost; route deducts the same.
  const [storytellingModel, setStorytellingModel] = useState("");
  // Storytelling-only image provider: p2 (Crun), p3 (Mountsea), or p1
  // (GeminiGen — pass-through fallback). Stored in app_settings as
  // storytelling_provider = { provider: "p2" | "p3" | "p1" }.
  const [storytellingProvider, setStorytellingProvider] = useState<"p1" | "p2" | "p3">("p2");
  const [storytellingPerImage, setStorytellingPerImage] = useState("");
  const [storytellingPerAudioSec, setStorytellingPerAudioSec] = useState("");
  // MiniMax narration playback speed — clamped 0.5–2.0. 1.2 default
  // matches the AI Call project's tuned value. See
  // app_settings.storytelling_voice_speed.
  const [storytellingVoiceSpeed, setStorytellingVoiceSpeed] = useState("");
  const [savingStorytelling, setSavingStorytelling] = useState(false);
  const [storytellingMsg, setStorytellingMsg] = useState<string | null>(null);

  // Viral (Talking Object) image provider + model. Reads/writes:
  //   viral_provider     = { provider: "p1" | "p2" | "p3" }
  //   viral_image_model  = { model: "nano-banana-pro" | ... }
  // Independent from global image_default so admin can route Viral to a
  // different backend without affecting Image / Storytelling tabs.
  const [viralProvider, setViralProvider] = useState<"p1" | "p2" | "p3">("p2");
  const [viralImageModel, setViralImageModel] = useState("");
  const [savingViral, setSavingViral] = useState(false);
  const [viralMsg, setViralMsg] = useState<string | null>(null);

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
      const next = {
        image: "p2" as Provider,
        video: "p2" as Provider,
        cinema: "p2" as Provider,
        seedance: "p2" as Provider,
      };
      for (const row of list) {
        if (row.key === "gen_provider_image") next.image = row.value?.provider === "p1" ? "p1" : "p2";
        if (row.key === "gen_provider_video") next.video = row.value?.provider === "p1" ? "p1" : "p2";
        if (row.key === "gen_provider_cinema") next.cinema = row.value?.provider === "p1" ? "p1" : "p2";
        if (row.key === "gen_provider_seedance") next.seedance = row.value?.provider === "p1" ? "p1" : "p2";
      }
      setProviders(next);
      // Hydrate the extension card from app_settings.
      for (const row of list) {
        if (row.key === "extension_version") {
          setExtVersion(String(row.value?.value || row.value?.version || ""));
        }
        if (row.key === "extension_download_url") {
          setExtDownloadUrl(String(row.value?.url || ""));
        }
      }
      // Hydrate the per-model pricing card.
      const fmt = (n: any) =>
        Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "";
      for (const row of list) {
        if (row.key === "rate_banana_pro") setRateBananaPro(fmt(row.value?.per_image));
        if (row.key === "rate_gpt_image") setRateGptImage(fmt(row.value?.per_image));
        if (row.key === "rate_veo") {
          setRateVeo8(fmt(row.value?.per_video_8s));
          setRateVeo16(fmt(row.value?.per_video_16s));
        }
        if (row.key === "rate_grok") setRateGrok(fmt(row.value?.per_second));
        if (row.key === "rate_seedance") setRateSeedance(fmt(row.value?.per_second));
        if (row.key === "fairytale_image_model") {
          setStorytellingModel(String(row.value?.model || ""));
        }
        if (row.key === "storytelling_pricing") {
          setStorytellingPerImage(fmt(row.value?.per_image));
          setStorytellingPerAudioSec(fmt(row.value?.per_audio_sec));
        }
        if (row.key === "storytelling_voice_speed") {
          const s = Number(row.value?.speed ?? row.value?.value);
          setStorytellingVoiceSpeed(Number.isFinite(s) ? s.toFixed(2) : "");
        }
        if (row.key === "storytelling_provider") {
          const p = row.value?.provider;
          if (p === "p1" || p === "p2" || p === "p3") setStorytellingProvider(p);
        }
        if (row.key === "viral_provider") {
          const p = row.value?.provider;
          if (p === "p1" || p === "p2" || p === "p3") setViralProvider(p);
        }
        if (row.key === "viral_image_model") {
          setViralImageModel(String(row.value?.model || ""));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveModelRates() {
    setSavingRates(true);
    setRatesMsg(null);
    try {
      const num = (s: string, fb: number) => {
        const n = Number(s);
        return Number.isFinite(n) && n >= 0 ? n : fb;
      };
      await Promise.all([
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "rate_banana_pro",
            value: { per_image: num(rateBananaPro, 0.15) },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "rate_gpt_image",
            value: { per_image: num(rateGptImage, 0.30) },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "rate_veo",
            value: {
              per_video_8s: num(rateVeo8, 0.40),
              per_video_16s: num(rateVeo16, 0.80),
            },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "rate_grok",
            value: { per_second: num(rateGrok, 0.10) },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "rate_seedance",
            value: { per_second: num(rateSeedance, 0.40) },
          }),
        }),
      ]);
      setRatesMsg("✓ Rates saved. New generations will use these immediately.");
      void load();
      setTimeout(() => setRatesMsg(null), 5000);
    } finally {
      setSavingRates(false);
    }
  }

  async function saveStorytellingSettings() {
    setSavingStorytelling(true);
    setStorytellingMsg(null);
    try {
      const trimmedModel = storytellingModel.trim();
      const num = (s: string, fb: number) => {
        const n = Number(s);
        return Number.isFinite(n) && n >= 0 ? n : fb;
      };
      const perImage = num(storytellingPerImage, 0.07);
      const perAudioSec = num(storytellingPerAudioSec, 0.02);
      // Clamp speed to the playable range. Empty input falls back to 1.2
      // (the documented default — matches AI Call's tuned value).
      const rawSpeed = Number(storytellingVoiceSpeed);
      const voiceSpeed = Number.isFinite(rawSpeed)
        ? Math.max(0.5, Math.min(2.0, rawSpeed))
        : 1.2;
      const responses = await Promise.all([
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "fairytale_image_model",
            value: { model: trimmedModel },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "storytelling_pricing",
            value: { per_image: perImage, per_audio_sec: perAudioSec },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "storytelling_voice_speed",
            value: { speed: voiceSpeed },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "storytelling_provider",
            value: { provider: storytellingProvider },
          }),
        }),
      ]);
      const failed = responses.find((r) => !r.ok);
      if (failed) {
        const err = await failed.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${failed.status}`);
      }
      setStorytellingMsg("✓ Saved. New Storytelling renders use these immediately.");
      void load();
      setTimeout(() => setStorytellingMsg(null), 5000);
    } catch (e: any) {
      setStorytellingMsg(`✗ Save failed: ${e?.message || "unknown error"}`);
    } finally {
      setSavingStorytelling(false);
    }
  }

  async function saveViralSettings() {
    setSavingViral(true);
    setViralMsg(null);
    try {
      const responses = await Promise.all([
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "viral_provider",
            value: { provider: viralProvider },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "viral_image_model",
            value: { model: viralImageModel.trim() },
          }),
        }),
      ]);
      const failed = responses.find((r) => !r.ok);
      if (failed) {
        const err = await failed.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${failed.status}`);
      }
      setViralMsg("✓ Saved. New Talking Object generations use these immediately.");
      void load();
      setTimeout(() => setViralMsg(null), 5000);
    } catch (e: any) {
      setViralMsg(`✗ Save failed: ${e?.message || "unknown error"}`);
    } finally {
      setSavingViral(false);
    }
  }

  async function saveExtensionSettings() {
    setSavingExt(true);
    setExtMsg(null);
    try {
      await Promise.all([
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "extension_version",
            value: { value: extVersion.trim() },
          }),
        }),
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "extension_download_url",
            value: { url: extDownloadUrl.trim() },
          }),
        }),
      ]);
      setExtMsg("✓ Saved. Extension will read the new values on its next /api/extension/verify call.");
      void load();
      setTimeout(() => setExtMsg(null), 5000);
    } finally {
      setSavingExt(false);
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

  // Wipe every client's video_provider override so they all fall back to
  // the admin's gen_provider_video setting. Used when admin wants to
  // force a platform-wide video provider switch.
  async function syncVideoProviderToAll() {
    const target = providers.video === "p1" ? "P1" : "P2";
    if (
      !confirm(
        `Apply "${target}" to ALL clients?\n\n` +
          `This clears every client's per-user video provider override. ` +
          `Their next video generation will use ${target}. ` +
          `In-flight gens are unaffected.`
      )
    ) {
      return;
    }
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await fetch("/api/admin/sync-video-provider", { method: "POST" });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setSyncMsg(`✗ ${d?.error || "Sync failed"}`);
        return;
      }
      setSyncMsg(`✓ Cleared ${d.cleared} override${d.cleared === 1 ? "" : "s"}. All clients now on ${target}.`);
    } finally {
      setSyncing(false);
      // Auto-clear the message after a few seconds.
      setTimeout(() => setSyncMsg(null), 4500);
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

  // Keys hidden from the raw category cards because they're either
  // dead/orphan or already exposed via a friendlier dedicated UI above.
  // - price_video_16s: legacy orphan, no code reads it.
  // - rate_*: covered by the Model Pricing card.
  // - seedance_rate / cinema_rate_per_sec: legacy fallbacks for the new
  //   rate_seedance / rate_grok keys; admin shouldn't need to touch them
  //   directly anymore.
  const HIDDEN_KEYS = new Set<string>([
    "price_video_16s",
    "rate_banana_pro",
    "rate_gpt_image",
    "rate_veo",
    "rate_grok",
    "rate_seedance",
    "seedance_rate",
    "cinema_rate_per_sec",
    // Both pricing keys below are noise in the admin UI — credit_topup_price
    // is an unused orphan (only seeded in 0001_init, no code reads it),
    // and credit_costs is consumed only as a fallback for auto_plan /
    // clone_plan reasons in priceFor() with sensible defaults; admin
    // shouldn't need to touch the JSON directly.
    "credit_topup_price",
    "credit_costs",
    // Already exposed via the dedicated "Chrome Extension" card above —
    // editing them as raw JSON in the General section is duplication.
    "extension_version",
    "extension_download_url",
    // All four gen_provider_<asset> rows are controlled by the
    // "AI Generation Providers" card at the top of the page; showing
    // them again as raw JSON in the provider section is duplication.
    "gen_provider_image",
    "gen_provider_video",
    "gen_provider_cinema",
    "gen_provider_seedance",
    // Already exposed via the dedicated "Viral — Talking Object" card.
    "viral_provider",
    "viral_image_model",
  ]);

  const grouped = useMemo(() => {
    const m = new Map<string, Setting[]>();
    for (const r of rows) {
      if (HIDDEN_KEYS.has(r.key)) continue;
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
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {([
            { key: "image" as AssetKind,    label: "Image",            Icon: ImageIcon, hint: "Banana Pro / Imagen / GPT Image 2" },
            { key: "video" as AssetKind,    label: "Video (Veo)",      Icon: Video,     hint: "Veo 3.1 / 3.1 Fast / Veo 2" },
            { key: "cinema" as AssetKind,   label: "Story (Grok)",     Icon: Film,      hint: "Grok 3 / grok-imagine" },
            { key: "seedance" as AssetKind, label: "Cinema (Seedance)", Icon: Film,     hint: "Seedance 2.0 Fast (Bytedance)" },
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
                  <option value="p2">P2</option>
                  <option value="p1">P1</option>
                </select>

                {/* Video only — "Apply to all" wipes every client's
                    profiles.video_provider override so they all fall back
                    to whatever's selected above on their next gen. Image +
                    Cinema have no per-user override, so no button needed. */}
                {key === "video" && (
                  <button
                    type="button"
                    onClick={syncVideoProviderToAll}
                    disabled={syncing}
                    title="Force every client to use this provider — clears all per-user overrides"
                    className="mt-2 w-full text-xs font-bold py-2 rounded-lg transition-all disabled:opacity-50"
                    style={{
                      background: "rgba(245,158,11,0.12)",
                      border: "1px solid rgba(245,158,11,0.4)",
                      color: "#d97706",
                    }}
                  >
                    {syncing ? (
                      <span className="inline-flex items-center justify-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Applying…
                      </span>
                    ) : (
                      "✓ Apply to all clients"
                    )}
                  </button>
                )}
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

      {/* Per-model pricing — one editable knob per generation model so
          admin can tune costs without editing JSON. Values persist as
          app_settings rows (rate_<model>); priceFor() reads them with
          plan-tier fallback so unset fields keep working as before. */}
      <div className="card p-6 mb-6 border-2 border-violet-100 bg-violet-50/40">
        <div className="flex items-center gap-2 mb-1">
          <Package className="w-5 h-5 text-violet-600" />
          <h2 className="font-display font-bold text-lg">Model Pricing</h2>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">
          Per-model rates for image and video generation. RM (Malaysian Ringgit). Changes apply to new generations immediately.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" /> Banana Pro <span className="text-[10px] font-normal text-[var(--color-text-muted)]">/ image</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateBananaPro}
                onChange={(e) => setRateBananaPro(e.target.value)}
                className="input !pl-10"
                placeholder="0.15"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" /> GPT Image <span className="text-[10px] font-normal text-[var(--color-text-muted)]">/ image</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateGptImage}
                onChange={(e) => setRateGptImage(e.target.value)}
                className="input !pl-10"
                placeholder="0.30"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5" /> Veo 8s <span className="text-[10px] font-normal text-[var(--color-text-muted)]">/ video</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateVeo8}
                onChange={(e) => setRateVeo8(e.target.value)}
                className="input !pl-10"
                placeholder="0.40"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <Video className="w-3.5 h-3.5" /> Veo 16s <span className="text-[10px] font-normal text-[var(--color-text-muted)]">/ video</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateVeo16}
                onChange={(e) => setRateVeo16(e.target.value)}
                className="input !pl-10"
                placeholder="0.80"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" /> Grok <span className="text-[10px] font-normal text-[var(--color-text-muted)]">(Story) / second</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateGrok}
                onChange={(e) => setRateGrok(e.target.value)}
                className="input !pl-10"
                placeholder="0.10"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" /> Seedance <span className="text-[10px] font-normal text-[var(--color-text-muted)]">(Cinema) / second</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateSeedance}
                onChange={(e) => setRateSeedance(e.target.value)}
                className="input !pl-10"
                placeholder="0.40"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            type="button"
            onClick={() => void saveModelRates()}
            disabled={savingRates}
            className="px-5 py-2 rounded-lg bg-violet-600 text-white font-bold text-sm hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2"
          >
            {savingRates && <Loader2 className="w-4 h-4 animate-spin" />}
            <Save className="w-4 h-4" /> Save Rates
          </button>
          {ratesMsg && (
            <span className="text-xs text-emerald-700 font-semibold">{ratesMsg}</span>
          )}
        </div>
      </div>

      {/* Storytelling (fairytale) image generator — dedicated card so admin
          can pick which Crun.ai model is used to render the 10 scene images
          + override the per-image rate. Falls back to global image_default
          + rate_<model> when both are blank. */}
      <div className="card p-6 mb-6 border-2 border-purple-100 bg-purple-50/40">
        <div className="flex items-center gap-2 mb-1">
          <ImageIcon className="w-5 h-5 text-purple-600" />
          <h2 className="font-display font-bold text-lg">Storytelling — Scene Images</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Pick the upstream provider + image model the Storytelling wizard
          uses for each scene, plus your per-image cost override. Leave
          model blank to fall back to the global image default; leave
          rate at 0 to use the model's standard rate (rate_&lt;model&gt;).
        </p>

        {/* Provider toggle — applies to Storytelling ONLY (the rest of the
            platform stays on whatever the per-asset gen_provider_*
            setting says). p3 (Mountsea) is locked to nano-banana-fast
            on the route side regardless of the Image Model dropdown
            below — the model dropdown is meaningful only for p1/p2. */}
        <div className="mb-4">
          <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
            Image Provider
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: "p1", label: "P1 — GeminiGen", sub: "Google direct" },
              { id: "p2", label: "P2 — Crun.ai", sub: "Multi-model" },
              { id: "p3", label: "P3 — Mountsea", sub: "nano-banana-fast" },
            ] as const).map((p) => {
              const active = storytellingProvider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setStorytellingProvider(p.id)}
                  className="rounded-xl px-3 py-2 text-left transition"
                  style={
                    active
                      ? {
                          background: "#7c3aed",
                          color: "white",
                          border: "2px solid #7c3aed",
                          boxShadow: "0 4px 10px rgba(124,58,237,0.3)",
                        }
                      : {
                          background: "white",
                          color: "#1f2937",
                          border: "1px solid #e5e7eb",
                        }
                  }
                >
                  <div className="text-xs font-bold">{p.label}</div>
                  <div
                    className="text-[10px] mt-0.5"
                    style={{ color: active ? "rgba(255,255,255,0.85)" : "#6b7280" }}
                  >
                    {p.sub}
                  </div>
                </button>
              );
            })}
          </div>
          {storytellingProvider === "p3" && (
            <p className="text-[11px] text-purple-700 mt-2">
              ⚡ Mountsea path uses <strong>nano-banana-fast</strong> only.
              Auto-retries up to 3× on transient failures. Image Model
              dropdown below is ignored when P3 is selected.
            </p>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Image Model
            </label>
            <select
              value={storytellingModel}
              onChange={(e) => setStorytellingModel(e.target.value)}
              className="input"
              style={{ color: "white" }}
            >
              {/* Inline option styles so text stays readable on the
                  browser's native dropdown panel regardless of theme. */}
              <option value=""                style={{ color: "#1a1a1a", background: "white" }}>— use global default —</option>
              <option value="z-image"         style={{ color: "#1a1a1a", background: "white" }}>z-image (Alibaba — fastest, cheapest)</option>
              <option value="nano-banana-v2"  style={{ color: "#1a1a1a", background: "white" }}>nano-banana (Google — balanced)</option>
              <option value="nano-banana-pro" style={{ color: "#1a1a1a", background: "white" }}>nano-banana-pro (Google — best quality)</option>
              <option value="gpt-image-2"     style={{ color: "#1a1a1a", background: "white" }}>gpt-image-2 (OpenAI — most expensive)</option>
            </select>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Currently active: <strong>{storytellingModel || "global default (likely nano-banana-pro)"}</strong>
            </p>
          </div>
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Per-image rate
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={storytellingPerImage}
                onChange={(e) => setStorytellingPerImage(e.target.value)}
                className="input !pl-10"
                placeholder="0.07"
              />
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Charged per scene image (slide_count × this rate).
            </p>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-4 mb-3 mt-3">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Per-second audio rate
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.001"
                value={storytellingPerAudioSec}
                onChange={(e) => setStorytellingPerAudioSec(e.target.value)}
                className="input !pl-10"
                placeholder="0.02"
              />
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Charged per second of MiniMax narration
              (sec/slide × slide_count × this rate).
            </p>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)] flex items-end pb-1">
            <div>
              <div className="font-bold text-[var(--color-text-primary)] mb-1">Example</div>
              <div className="font-mono">10 slides × 5s each, 0.07 + 0.02:</div>
              <div className="font-mono opacity-80">
                (0.07 × 10) + (0.02 × 5 × 10) = <strong>RM 1.70</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Narration playback speed — admin-tunable. AI Call uses 1.2x;
            slow-listeners may prefer 1.0; fast-scrollers might want 1.3.
            Applied client-side in live preview AND server-side in Modal
            ffmpeg merge — TTS itself always synthesizes at 1.0x natural
            speed so the cached MP3 stays reusable across speed changes. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-xs font-bold text-[var(--color-text-secondary)] mb-1.5">
              Narration playback speed
            </label>
            <div className="relative">
              <input
                type="number"
                min="0.5"
                max="2.0"
                step="0.05"
                value={storytellingVoiceSpeed}
                onChange={(e) => setStorytellingVoiceSpeed(e.target.value)}
                className="input !pr-8"
                placeholder="1.2"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">
                x
              </span>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Range 0.5–2.0. Default 1.2x (matches AI Call). 1.0 = natural.
              Applies to live preview + final video; TTS is always
              cached at natural speed so changes are zero-cost.
            </p>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)] flex items-end pb-1">
            <div>
              <div className="font-bold text-[var(--color-text-primary)] mb-1">Tip</div>
              <div>1.0 = natural pace (slower, breathing room)</div>
              <div>1.2 = energetic (recommended for short-form)</div>
              <div>1.5 = rushed (use sparingly for hooks)</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button
            type="button"
            onClick={() => void saveStorytellingSettings()}
            disabled={savingStorytelling}
            className="px-5 py-2 rounded-lg bg-purple-600 text-white font-bold text-sm hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2"
          >
            {savingStorytelling && <Loader2 className="w-4 h-4 animate-spin" />}
            <Save className="w-4 h-4" /> Save Storytelling Settings
          </button>
          {storytellingMsg && (
            <span className="text-xs text-emerald-700 font-semibold">{storytellingMsg}</span>
          )}
        </div>
      </div>

      {/* Viral (Talking Object) — dedicated card so admin can pick the
          backend provider + image model the Talking Object pipeline uses
          for the start-frame banana-pro image. Independent from global
          image_default so Viral can run on a different model than the
          Image / Storytelling tabs. */}
      <div className="card p-6 mb-6 border-2 border-pink-100 bg-pink-50/40">
        <div className="flex items-center gap-2 mb-1">
          <Film className="w-5 h-5 text-pink-600" />
          <h2 className="font-display font-bold text-lg">Viral — Talking Object</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Pick the upstream provider + image model the Talking Object
          pipeline uses for the start-frame image. Leave model blank to
          fall back to the global image default.
        </p>

        {/* Provider toggle — applies to Viral / Talking Object ONLY. p3
            (Mountsea) is locked to nano-banana-fast on the route side
            regardless of the Image Model dropdown below. */}
        <div className="mb-4">
          <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
            Image Provider
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: "p1", label: "P1 — GeminiGen", sub: "Google direct" },
              { id: "p2", label: "P2 — Crun.ai", sub: "Multi-model" },
              { id: "p3", label: "P3 — Mountsea", sub: "nano-banana-fast" },
            ] as const).map((p) => {
              const active = viralProvider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setViralProvider(p.id)}
                  className="rounded-xl px-3 py-2 text-left transition"
                  style={
                    active
                      ? {
                          background: "#db2777",
                          color: "white",
                          border: "2px solid #db2777",
                          boxShadow: "0 4px 10px rgba(219,39,119,0.3)",
                        }
                      : {
                          background: "white",
                          color: "#1f2937",
                          border: "1px solid #e5e7eb",
                        }
                  }
                >
                  <div className="text-xs font-bold">{p.label}</div>
                  <div
                    className="text-[10px] mt-0.5"
                    style={{ color: active ? "rgba(255,255,255,0.85)" : "#6b7280" }}
                  >
                    {p.sub}
                  </div>
                </button>
              );
            })}
          </div>
          {viralProvider === "p3" && (
            <p className="text-[11px] text-pink-700 mt-2">
              ⚡ Mountsea supports <strong>nano-banana-pro</strong>,{" "}
              <strong>nano-banana-2</strong>, and{" "}
              <strong>nano-banana-fast</strong>. If a P2-only model
              (z-image / nano-banana-v2 / gpt-image-2) is selected, the
              route auto-falls back to nano-banana-fast.
            </p>
          )}
        </div>

        <div className="mb-3">
          <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
            Image Model
          </label>
          <select
            value={viralImageModel}
            onChange={(e) => setViralImageModel(e.target.value)}
            className="input"
            style={{ color: "white" }}
          >
            <option value=""                  style={{ color: "#1a1a1a", background: "white" }}>— use global default —</option>
            {/* Cross-provider models */}
            <option value="nano-banana-pro"   style={{ color: "#1a1a1a", background: "white" }}>nano-banana-pro (Google — best quality, P2 + P3)</option>
            {/* P3 / Mountsea exclusive (nano-banana-2 = no "v") */}
            <option value="nano-banana-2"     style={{ color: "#1a1a1a", background: "white" }}>nano-banana-2 (Mountsea — P3 only)</option>
            <option value="nano-banana-fast"  style={{ color: "#1a1a1a", background: "white" }}>nano-banana-fast (Mountsea — P3 only, cheap+fast)</option>
            {/* P2 / Crun exclusive */}
            <option value="z-image"           style={{ color: "#1a1a1a", background: "white" }}>z-image (Alibaba — P2 only, fastest+cheapest)</option>
            <option value="nano-banana-v2"    style={{ color: "#1a1a1a", background: "white" }}>nano-banana-v2 (Google via Crun — P2 only, balanced)</option>
            <option value="gpt-image-2"       style={{ color: "#1a1a1a", background: "white" }}>gpt-image-2 (OpenAI — P2 only, most expensive)</option>
          </select>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
            Currently active: <strong>{viralImageModel || "global default (likely nano-banana-pro)"}</strong>
          </p>
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button
            type="button"
            onClick={() => void saveViralSettings()}
            disabled={savingViral}
            className="px-5 py-2 rounded-lg bg-pink-600 text-white font-bold text-sm hover:bg-pink-700 disabled:opacity-50 flex items-center gap-2"
          >
            {savingViral && <Loader2 className="w-4 h-4 animate-spin" />}
            <Save className="w-4 h-4" /> Save Viral Settings
          </button>
          {viralMsg && (
            <span className="text-xs text-emerald-700 font-semibold">{viralMsg}</span>
          )}
        </div>
      </div>

      {/* Chrome Extension settings — dedicated card so admin can rotate
          the version + download URL the extension reads. The extension
          calls /api/extension/verify on launch; if its bundled version
          doesn't match this, it tells the user to update. */}
      <div className="card p-6 mb-6 border-2 border-blue-100 bg-blue-50/40">
        <div className="flex items-center gap-2 mb-1">
          <Puzzle className="w-5 h-5 text-blue-600" />
          <h2 className="font-display font-bold text-lg">Chrome Extension</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Bump the version when you ship a new build. Clients with an
          older bundled version will see an update prompt on their next
          extension load.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Extension Version
            </label>
            <input
              value={extVersion}
              onChange={(e) => setExtVersion(e.target.value)}
              placeholder="3.0.0"
              className="input"
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Semver string shown to users in Profile and SOP modal.
            </p>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Chrome Extension Download URL
            </label>
            <input
              value={extDownloadUrl}
              onChange={(e) => setExtDownloadUrl(e.target.value)}
              placeholder="https://drive.google.com/..."
              className="input"
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Google Drive or direct download link clients install from.
            </p>
          </div>
        </div>

        <button
          onClick={saveExtensionSettings}
          disabled={savingExt || !extVersion.trim()}
          className="btn-primary disabled:opacity-50"
        >
          {savingExt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save extension settings
        </button>
        {extMsg && (
          <div className="text-xs mt-2 text-emerald-700">{extMsg}</div>
        )}
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
