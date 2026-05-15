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
  const [storytellingProvider, setStorytellingProvider] = useState<"p1" | "p2" | "p3" | "p4" | "p5">("p4");
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
  const [viralProvider, setViralProvider] = useState<"p1" | "p2" | "p3" | "p4" | "p5">("p4");
  const [viralImageModel, setViralImageModel] = useState("");
  const [savingViral, setSavingViral] = useState(false);
  const [viralMsg, setViralMsg] = useState<string | null>(null);

  // Affiliate commission rate (percent). Read by webhook on every paid
  // subscription. Saved to app_settings.referral_commission_rate.
  const [referralRate, setReferralRate] = useState("");
  const [savingReferral, setSavingReferral] = useState(false);
  const [referralMsg, setReferralMsg] = useState<string | null>(null);

  // Free credits granted to a NEWLY-approved affiliate signup. Read by
  // /api/admin/affiliate on approval. Saved to app_settings.affiliate_signup_credits.
  // Defaults to 10 when unset (matches the pre-config hardcoded behaviour).
  const [affiliateCredits, setAffiliateCredits] = useState("");
  const [savingAffiliateCredits, setSavingAffiliateCredits] = useState(false);
  const [affiliateCreditsMsg, setAffiliateCreditsMsg] = useState<string | null>(null);

  // Cascade slot rotation (admin-configurable provider chain).
  //   video_cascade_slots = { slots: [main, second, third] }
  //   image_cascade_slots = { slots: [main, second, third] }
  // Each slot can be: p1 / p2-a / p2-b / p4 (image only) / p5.
  // Round-robin starting slot is computed atomically by Postgres seq;
  // walk hits all 3 + retries starting slot once (4 attempts total).
  type SlotV = "p1" | "p2-a" | "p2-b" | "p5" | "none";
  type SlotI = "p1" | "p2-a" | "p2-b" | "p4" | "p5" | "none";
  const [videoSlots, setVideoSlots] = useState<[SlotV, SlotV, SlotV]>(["p2-a", "p2-b", "p5"]);
  const [imageSlots, setImageSlots] = useState<[SlotI, SlotI, SlotI]>(["p4", "p5", "p2-a"]);
  const [savingSlots, setSavingSlots] = useState<"video" | "image" | null>(null);
  const [slotsMsg, setSlotsMsg] = useState<string | null>(null);

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
          if (p === "p1" || p === "p2" || p === "p3" || p === "p4") setStorytellingProvider(p);
        }
        if (row.key === "viral_provider") {
          const p = row.value?.provider;
          if (p === "p1" || p === "p2" || p === "p3" || p === "p4") setViralProvider(p);
        }
        if (row.key === "viral_image_model") {
          setViralImageModel(String(row.value?.model || ""));
        }
        if (row.key === "referral_commission_rate") {
          const r = Number(row.value?.rate);
          setReferralRate(Number.isFinite(r) ? String(r) : "");
        }
        if (row.key === "affiliate_signup_credits") {
          const n = Number(row.value?.credits);
          setAffiliateCredits(Number.isFinite(n) ? String(n) : "");
        }
        if (row.key === "video_cascade_slots") {
          const s = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const allowed = ["p1", "p2-a", "p2-b", "p5", "none"];
          const norm = (v: any, fb: SlotV): SlotV =>
            allowed.includes(String(v)) ? (String(v) as SlotV) : fb;
          setVideoSlots([
            norm(s[0], "p2-a"),
            norm(s[1], "p2-b"),
            norm(s[2], "p5"),
          ]);
        }
        if (row.key === "image_cascade_slots") {
          const s = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const allowed = ["p1", "p2-a", "p2-b", "p4", "p5", "none"];
          const norm = (v: any, fb: SlotI): SlotI =>
            allowed.includes(String(v)) ? (String(v) as SlotI) : fb;
          setImageSlots([
            norm(s[0], "p4"),
            norm(s[1], "p5"),
            norm(s[2], "p2-a"),
          ]);
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

  async function saveCascadeSlots(asset: "video" | "image") {
    setSavingSlots(asset);
    setSlotsMsg(null);
    try {
      const key = asset === "video" ? "video_cascade_slots" : "image_cascade_slots";
      const slots = asset === "video" ? videoSlots : imageSlots;
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: { slots } }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${r.status}`);
      }
      setSlotsMsg(`✓ ${asset} slots saved: ${slots.join(" → ")} → (back to ${slots[0]}). Takes effect on next task (60s cache).`);
      setTimeout(() => setSlotsMsg(null), 6000);
    } catch (e: any) {
      setSlotsMsg(`✗ Save failed: ${e?.message || "unknown error"}`);
    } finally {
      setSavingSlots(null);
    }
  }

  async function saveAffiliateCredits() {
    setSavingAffiliateCredits(true);
    setAffiliateCreditsMsg(null);
    try {
      const n = Number(affiliateCredits);
      const clamped = Number.isFinite(n) ? Math.max(0, Math.min(10000, Math.round(n))) : 10;
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "affiliate_signup_credits",
          value: { credits: clamped },
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${r.status}`);
      }
      setAffiliateCreditsMsg(`✓ Saved. New affiliates approved from now on will receive ${clamped} credits.`);
      void load();
      setTimeout(() => setAffiliateCreditsMsg(null), 5000);
    } catch (e: any) {
      setAffiliateCreditsMsg(`✗ Save failed: ${e?.message || "unknown error"}`);
    } finally {
      setSavingAffiliateCredits(false);
    }
  }

  async function saveReferralRate() {
    setSavingReferral(true);
    setReferralMsg(null);
    try {
      const n = Number(referralRate);
      const clamped = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 20;
      const r = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "referral_commission_rate",
          value: { rate: clamped },
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${r.status}`);
      }
      setReferralMsg(`✓ Saved. Future payments will pay ${clamped}% commission.`);
      void load();
      setTimeout(() => setReferralMsg(null), 5000);
    } catch (e: any) {
      setReferralMsg(`✗ Save failed: ${e?.message || "unknown error"}`);
    } finally {
      setSavingReferral(false);
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
    // Already exposed via the dedicated "Affiliate Commission" card.
    "referral_commission_rate",
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

      {/* Cascade Slot Rotation — admin picks 3 providers per asset class.
          Each task picks a starting slot via round-robin (atomic
          Postgres seq), walks all 3 slots cyclically, then retries the
          starting slot once (4 attempts total). Load spreads across
          slots system-wide. */}
      <div className="card p-6 mb-6 border-2 border-violet-200 bg-violet-50/40">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="w-5 h-5 text-violet-600" />
          <h2 className="font-display font-bold text-lg">Cascade Slot Rotation</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Round-robin starting slot per task; fallback walks all 3 slots + retries the start once.
          Load spreads across slots system-wide. Takes effect on next task (60s cache).
        </p>

        {/* Video slots */}
        <div className="mb-5">
          <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
            Video Cascade — 3 Slots
          </label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {(["Main", "Second", "Third"] as const).map((label, i) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Slot {i + 1} ({label})
                </div>
                <select
                  value={videoSlots[i]}
                  onChange={(e) => {
                    const next = [...videoSlots] as [SlotV, SlotV, SlotV];
                    next[i] = e.target.value as SlotV;
                    setVideoSlots(next);
                  }}
                  className="input w-full"
                  style={{ color: "white" }}
                >
                  <option value="p1">P1 — GeminiGen</option>
                  <option value="p2-a">P2 — Crun (key A)</option>
                  <option value="p2-b">P2 — Crun (key B)</option>
                  <option value="p5">P5 — APIMart</option>
                  <option value="none">— None (skip) —</option>
                </select>
              </div>
            ))}
          </div>
          <button
            onClick={() => void saveCascadeSlots("video")}
            disabled={savingSlots === "video"}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {savingSlots === "video" ? (
              <Loader2 className="w-3 h-3 animate-spin inline" />
            ) : (
              <Save className="w-3 h-3 inline" />
            )}{" "}
            Save Video Slots
          </button>
        </div>

        {/* Image slots */}
        <div className="mb-3">
          <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
            Image Cascade — 3 Slots
          </label>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {(["Main", "Second", "Third"] as const).map((label, i) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Slot {i + 1} ({label})
                </div>
                <select
                  value={imageSlots[i]}
                  onChange={(e) => {
                    const next = [...imageSlots] as [SlotI, SlotI, SlotI];
                    next[i] = e.target.value as SlotI;
                    setImageSlots(next);
                  }}
                  className="input w-full"
                  style={{ color: "white" }}
                >
                  <option value="p1">P1 — GeminiGen</option>
                  <option value="p2-a">P2 — Crun (key A)</option>
                  <option value="p2-b">P2 — Crun (key B)</option>
                  <option value="p4">P4 — Grsai</option>
                  <option value="p5">P5 — APIMart</option>
                  <option value="none">— None (skip) —</option>
                </select>
              </div>
            ))}
          </div>
          <button
            onClick={() => void saveCascadeSlots("image")}
            disabled={savingSlots === "image"}
            className="btn-primary text-xs disabled:opacity-50"
          >
            {savingSlots === "image" ? (
              <Loader2 className="w-3 h-3 animate-spin inline" />
            ) : (
              <Save className="w-3 h-3 inline" />
            )}{" "}
            Save Image Slots
          </button>
        </div>

        {slotsMsg && (
          <div
            className="text-xs mt-2"
            style={{ color: slotsMsg.startsWith("✓") ? "#16a34a" : "#dc2626" }}
          >
            {slotsMsg}
          </div>
        )}
      </div>

      {/* Cinema (Seedance) — locked to P1. No cascade fallback, single
          provider per user direction. Image / Video / Story routing
          is handled by Cascade Slot Rotation above. */}
      <div className="card p-6 mb-6 border-2 border-orange-100 bg-orange-50/40">
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="w-5 h-5 text-orange" />
          <h2 className="font-display font-bold text-lg">Cinema — Seedance</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Seedance 2.0 Fast is locked to <strong>P1 (GeminiGen)</strong> with no fallback.
          Image, Video (Veo), and Story (Grok) routing is handled by the
          Cascade Slot Rotation card at the top.
        </p>
        <div
          className="rounded-xl p-4 inline-flex items-center gap-3"
          style={{ background: "white", border: "1px solid var(--color-border)" }}
        >
          <Film className="w-4 h-4 text-orange" />
          <div>
            <div className="font-bold text-sm">Cinema (Seedance 2.0 Fast)</div>
            <div className="text-[11px] text-[var(--color-text-muted)]">
              Routes directly to P1 — no cascade
            </div>
          </div>
          <div
            className="ml-4 px-3 py-1 rounded-lg text-sm font-bold"
            style={{ background: "rgba(245,158,11,0.15)", color: "#d97706" }}
          >
            P1
          </div>
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
          Pick the image model the Storytelling wizard uses for each scene
          + per-image cost override. Provider is decided by the Cascade
          Slot Rotation at the top of this page.
        </p>

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
          Pick the image model the Talking Object pipeline uses for the
          start-frame image. Provider is decided by the Cascade Slot
          Rotation at the top of this page.
        </p>

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

      {/* Affiliate commission rate — % of every paid subscription that
          gets paid out to the referrer. Read by the payment webhook
          handlers. Applies only to type=subscription / checkout_signup;
          credit pack topups do NOT earn commission. */}
      <div className="card p-6 mb-6 border-2 border-rose-100 bg-rose-50/40">
        <div className="flex items-center gap-2 mb-1">
          <Package className="w-5 h-5 text-rose-600" />
          <h2 className="font-display font-bold text-lg">Affiliate Commission</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Percentage of every subscription payment paid out to the referrer.
          Applies to first purchase + every renewal. Topups don't earn commission.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Commission rate
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={referralRate}
                onChange={(e) => setReferralRate(e.target.value)}
                className="input !pr-8"
                placeholder="20"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">
                %
              </span>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Default 20%. Clamped 0–100. Change applies to the NEXT paid
              subscription — in-flight payments use whatever rate was
              active when they were created.
            </p>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)] flex items-end pb-1">
            <div>
              <div className="font-bold text-[var(--color-text-primary)] mb-1">Example</div>
              <div className="font-mono">User pays RM 75 subscription:</div>
              <div className="font-mono opacity-80">
                referrer earns RM {((Number(referralRate) || 20) * 0.75).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            type="button"
            onClick={() => void saveReferralRate()}
            disabled={savingReferral}
            className="px-5 py-2 rounded-lg bg-rose-600 text-white font-bold text-sm hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2"
          >
            {savingReferral && <Loader2 className="w-4 h-4 animate-spin" />}
            <Save className="w-4 h-4" /> Save Commission Rate
          </button>
          {referralMsg && (
            <span className="text-xs text-emerald-700 font-semibold">{referralMsg}</span>
          )}
        </div>
      </div>

      {/* Affiliate Signup Credits — how many free credits to grant when
          an affiliate application is approved. Read by
          /api/admin/affiliate at approval time. Default 10. */}
      <div className="card p-6 mb-6 border-2 border-amber-100 bg-amber-50/40">
        <div className="flex items-center gap-2 mb-1">
          <Package className="w-5 h-5 text-amber-600" />
          <h2 className="font-display font-bold text-lg">Affiliate Signup Bonus</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Free credits granted to each NEWLY-approved affiliate. They land
          on Pro Plan for 30 days and start with this credit balance. Set
          to 0 to disable the bonus.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              Credits on approval
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                max="10000"
                step="1"
                value={affiliateCredits}
                onChange={(e) => setAffiliateCredits(e.target.value)}
                className="input !pr-16"
                placeholder="10"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">
                credits
              </span>
            </div>
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              Default 10. Clamped 0–10000. Only NEW approvals from now on
              are affected — already-approved affiliates keep whatever
              balance they have.
            </p>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)] flex items-end pb-1">
            <div>
              <div className="font-bold text-[var(--color-text-primary)] mb-1">Worth</div>
              <div className="font-mono">
                1 credit = RM 1 of generations
              </div>
              <div className="font-mono opacity-80">
                {Number(affiliateCredits) || 10} credits ≈ RM {Number(affiliateCredits) || 10} of value
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-5">
          <button
            type="button"
            onClick={() => void saveAffiliateCredits()}
            disabled={savingAffiliateCredits}
            className="px-5 py-2 rounded-lg bg-amber-600 text-white font-bold text-sm hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
          >
            {savingAffiliateCredits && <Loader2 className="w-4 h-4 animate-spin" />}
            <Save className="w-4 h-4" /> Save Signup Bonus
          </button>
          {affiliateCreditsMsg && (
            <span className="text-xs text-emerald-700 font-semibold">{affiliateCreditsMsg}</span>
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
