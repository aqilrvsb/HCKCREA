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
  Facebook,
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
  const [rateSora2, setRateSora2] = useState("");
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
  // Independent LLM for Storytelling script generation. Separate from
  // model_auto (which powers Auto Content's master plan) because the
  // Storytelling JSON output is 6-10K tokens — needs a stronger model
  // than Auto Content's 1-2-scene plans. Empty string falls back to
  // model_auto for backward compatibility. Stored as
  // app_settings.storytelling_script_model = { model: "openrouter-id" }.
  const [storytellingScriptModel, setStorytellingScriptModel] = useState("");
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
  type SlotV =
    | "p1" | "p2-a" | "p2-b" | "p5"
    | "p6-a" | "p6-b" | "p6-c" | "p6-d" | "p6-e" | "p6-f" | "p6-g" | "p6-h"
    | "none";
  type SlotI =
    | "p1" | "p2-a" | "p2-b" | "p4" | "p5"
    | "p6-a" | "p6-b" | "p6-c" | "p6-d" | "p6-e" | "p6-f" | "p6-g" | "p6-h"
    | "none";
  // Legacy 3-slot state (kept for backwards compat with old setting keys
  // — no longer used by the cascade since main+fallback rewrite).

  // ────── New main+fallback architecture (dynamic count) ──────
  const [videoMainCount, setVideoMainCount] = useState(10);
  const [videoFallbackCount, setVideoFallbackCount] = useState(10);
  const [videoMainSlots, setVideoMainSlots] = useState<SlotV[]>([]);
  const [videoFallbackSlots, setVideoFallbackSlots] = useState<SlotV[]>([]);
  const [imageMainCount, setImageMainCount] = useState(10);
  const [imageFallbackCount, setImageFallbackCount] = useState(10);
  const [imageMainSlots, setImageMainSlots] = useState<SlotI[]>([]);
  const [imageFallbackSlots, setImageFallbackSlots] = useState<SlotI[]>([]);
  // Grok + Cinema cascades — same pool of providers as video (Grok and
  // Seedance both go through video-shaped slots).
  const [grokMainCount, setGrokMainCount] = useState(10);
  const [grokFallbackCount, setGrokFallbackCount] = useState(10);
  const [grokMainSlots, setGrokMainSlots] = useState<SlotV[]>([]);
  const [grokFallbackSlots, setGrokFallbackSlots] = useState<SlotV[]>([]);
  const [cinemaMainCount, setCinemaMainCount] = useState(10);
  const [cinemaFallbackCount, setCinemaFallbackCount] = useState(10);
  const [cinemaMainSlots, setCinemaMainSlots] = useState<SlotV[]>([]);
  const [cinemaFallbackSlots, setCinemaFallbackSlots] = useState<SlotV[]>([]);
  // Sora 2 cascade — APIPod-only (only p6 slots make sense) but uses
  // the same SlotV allowed list so admin can theoretically pick other
  // providers (those will fail at submit time, kept as forward-compat).
  const [sora2MainCount, setSora2MainCount] = useState(10);
  const [sora2FallbackCount, setSora2FallbackCount] = useState(10);
  const [sora2MainSlots, setSora2MainSlots] = useState<SlotV[]>([]);
  const [sora2FallbackSlots, setSora2FallbackSlots] = useState<SlotV[]>([]);
  const [savingMfSlots, setSavingMfSlots] = useState<"video" | "image" | "grok" | "cinema" | "sora2" | null>(null);
  const [mfSlotsMsg, setMfSlotsMsg] = useState<string | null>(null);

  // Facebook Conversions API config (single app_settings.fb_capi row).
  // pixel_id is also served publicly via /api/fb-pixel/config to bootstrap
  // the browser snippet — access_token stays server-only.
  const [fbPixelId, setFbPixelId] = useState("");
  const [fbAccessToken, setFbAccessToken] = useState("");
  const [fbTestEventCode, setFbTestEventCode] = useState("");
  const [fbCapiEnabled, setFbCapiEnabled] = useState(true);
  const [savingFbCapi, setSavingFbCapi] = useState(false);
  const [fbCapiMsg, setFbCapiMsg] = useState<string | null>(null);

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
        if (row.key === "sora2_rate") setRateSora2(fmt(row.value?.rate));
        if (row.key === "rate_seedance") setRateSeedance(fmt(row.value?.per_second));
        if (row.key === "fairytale_image_model") {
          setStorytellingModel(String(row.value?.model || ""));
        }
        if (row.key === "storytelling_script_model") {
          setStorytellingScriptModel(String(row.value?.model || ""));
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
        if (row.key === "fb_capi") {
          setFbPixelId(String(row.value?.pixel_id || ""));
          setFbAccessToken(String(row.value?.access_token || ""));
          setFbTestEventCode(String(row.value?.test_event_code || ""));
          setFbCapiEnabled(row.value?.enabled !== false);
        }
        // Main+fallback architecture
        const allowedV: string[] = [
          "p1", "p2-a", "p2-b", "p5",
          "p6-a", "p6-b", "p6-c", "p6-d", "p6-e", "p6-f", "p6-g", "p6-h",
          "none",
        ];
        const allowedI: string[] = [
          "p1", "p2-a", "p2-b", "p4", "p5",
          "p6-a", "p6-b", "p6-c", "p6-d", "p6-e", "p6-f", "p6-g", "p6-h",
          "none",
        ];
        const fitArr = <T,>(arr: any[], n: number, allowed: string[]): T[] => {
          const out: T[] = [];
          for (let i = 0; i < n; i++) {
            const v = String(arr?.[i] || "none");
            out.push((allowed.includes(v) ? v : "none") as T);
          }
          return out;
        };
        if (row.key === "video_main_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setVideoMainCount(Math.floor(n));
        }
        if (row.key === "video_fallback_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setVideoFallbackCount(Math.floor(n));
        }
        if (row.key === "image_main_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setImageMainCount(Math.floor(n));
        }
        if (row.key === "image_fallback_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setImageFallbackCount(Math.floor(n));
        }
        if (row.key === "video_main_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "video_main_count")?.value?.count) || 10;
          setVideoMainSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
        if (row.key === "video_fallback_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "video_fallback_count")?.value?.count) || 10;
          setVideoFallbackSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
        if (row.key === "image_main_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "image_main_count")?.value?.count) || 10;
          setImageMainSlots(fitArr<SlotI>(arr, cnt, allowedI));
        }
        if (row.key === "image_fallback_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "image_fallback_count")?.value?.count) || 10;
          setImageFallbackSlots(fitArr<SlotI>(arr, cnt, allowedI));
        }
        // Grok cascade
        if (row.key === "grok_main_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setGrokMainCount(Math.floor(n));
        }
        if (row.key === "grok_fallback_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setGrokFallbackCount(Math.floor(n));
        }
        if (row.key === "grok_main_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "grok_main_count")?.value?.count) || 10;
          setGrokMainSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
        if (row.key === "grok_fallback_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "grok_fallback_count")?.value?.count) || 10;
          setGrokFallbackSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
        // Cinema (Seedance) cascade
        if (row.key === "cinema_main_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setCinemaMainCount(Math.floor(n));
        }
        if (row.key === "cinema_fallback_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setCinemaFallbackCount(Math.floor(n));
        }
        if (row.key === "cinema_main_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "cinema_main_count")?.value?.count) || 10;
          setCinemaMainSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
        if (row.key === "cinema_fallback_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "cinema_fallback_count")?.value?.count) || 10;
          setCinemaFallbackSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
        // Sora 2 cascade
        if (row.key === "sora2_main_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setSora2MainCount(Math.floor(n));
        }
        if (row.key === "sora2_fallback_count") {
          const n = Number(row.value?.count);
          if (Number.isFinite(n) && n >= 1) setSora2FallbackCount(Math.floor(n));
        }
        if (row.key === "sora2_main_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "sora2_main_count")?.value?.count) || 10;
          setSora2MainSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
        if (row.key === "sora2_fallback_slots") {
          const arr = Array.isArray(row.value?.slots) ? row.value.slots : [];
          const cnt = (list.find((r) => r.key === "sora2_fallback_count")?.value?.count) || 10;
          setSora2FallbackSlots(fitArr<SlotV>(arr, cnt, allowedV));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function saveMainFallback(asset: "video" | "image" | "grok" | "cinema" | "sora2") {
    setSavingMfSlots(asset);
    setMfSlotsMsg(null);
    try {
      const mainCount =
        asset === "video" ? videoMainCount
        : asset === "image" ? imageMainCount
        : asset === "grok" ? grokMainCount
        : asset === "sora2" ? sora2MainCount
        : cinemaMainCount;
      const fbCount =
        asset === "video" ? videoFallbackCount
        : asset === "image" ? imageFallbackCount
        : asset === "grok" ? grokFallbackCount
        : asset === "sora2" ? sora2FallbackCount
        : cinemaFallbackCount;
      const main =
        asset === "video" ? videoMainSlots
        : asset === "image" ? imageMainSlots
        : asset === "grok" ? grokMainSlots
        : asset === "sora2" ? sora2MainSlots
        : cinemaMainSlots;
      const fb =
        asset === "video" ? videoFallbackSlots
        : asset === "image" ? imageFallbackSlots
        : asset === "grok" ? grokFallbackSlots
        : asset === "sora2" ? sora2FallbackSlots
        : cinemaFallbackSlots;
      const calls = [
        { key: `${asset}_main_count`, value: { count: mainCount } },
        { key: `${asset}_fallback_count`, value: { count: fbCount } },
        { key: `${asset}_main_slots`, value: { slots: main.slice(0, mainCount) } },
        { key: `${asset}_fallback_slots`, value: { slots: fb.slice(0, fbCount) } },
      ];
      for (const c of calls) {
        const r = await fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err?.error || `HTTP ${r.status} on ${c.key}`);
        }
      }
      setMfSlotsMsg(`✓ ${asset} main+fallback saved. Takes effect on next task (60s cache).`);
      setTimeout(() => setMfSlotsMsg(null), 6000);
    } catch (e: any) {
      setMfSlotsMsg(`✗ Save failed: ${e?.message || "unknown"}`);
    } finally {
      setSavingMfSlots(null);
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
            key: "sora2_rate",
            value: { rate: num(rateSora2, 0.20) },
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
        fetch("/api/admin/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: "storytelling_script_model",
            value: { model: storytellingScriptModel.trim() },
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

  // Saves the fb_capi setting blob. Sent as a single JSON object so the
  // generic /api/admin/settings handler can upsert it like any other key.
  async function saveFbCapi() {
    setSavingFbCapi(true);
    setFbCapiMsg(null);
    try {
      const value: Record<string, any> = {
        enabled: fbCapiEnabled,
      };
      if (fbPixelId.trim()) value.pixel_id = fbPixelId.trim();
      if (fbAccessToken.trim()) value.access_token = fbAccessToken.trim();
      if (fbTestEventCode.trim()) value.test_event_code = fbTestEventCode.trim();
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "fb_capi", value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error || `HTTP ${res.status}`);
      }
      setFbCapiMsg("Saved. Ads conversion tracking active.");
      await load();
    } catch (e: any) {
      setFbCapiMsg(`Save failed: ${e?.message || "unknown"}`);
    } finally {
      setSavingFbCapi(false);
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
    // Sora 2 rate — exposed via the dedicated "Model Pricing" card above.
    "sora2_rate",
    // FB CAPI — exposed via the dedicated "Facebook Conversions API"
    // card above. Hiding the raw JSON because the access_token field is
    // a secret and shouldn't be visible in plain text in the generic list.
    "fb_capi",
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

      {/* Main + Fallback Cascade (new architecture).
          Each asset has TWO independent lists with dynamic length:
            - Main slots: round-robin source, walked cyclically
            - Fallback slots: tried in order after all mains fail
          'none' entries are skipped entirely.
          Admin can grow / shrink each list with + / - buttons. */}
      {(() => {
        const assets: Array<{
          asset: "video" | "image" | "grok" | "cinema" | "sora2";
          color: string;
          options: { value: string; label: string }[];
          mainCount: number;
          setMainCount: (n: number) => void;
          fbCount: number;
          setFbCount: (n: number) => void;
          mainSlots: string[];
          setMainSlots: (s: string[]) => void;
          fbSlots: string[];
          setFbSlots: (s: string[]) => void;
        }> = [
          {
            asset: "video",
            color: "#a855f7",
            options: [
              { value: "p1", label: "P1 — GeminiGen" },
              { value: "p2-a", label: "P2 — Crun (key A)" },
              { value: "p2-b", label: "P2 — Crun (key B)" },
              { value: "p5", label: "P5 — APIMart" },
              { value: "p6-a", label: "P6 — APIPod (A)" },
              { value: "p6-b", label: "P6 — APIPod (B)" },
              { value: "p6-c", label: "P6 — APIPod (C)" },
              { value: "p6-d", label: "P6 — APIPod (D)" },
              { value: "p6-e", label: "P6 — APIPod (E)" },
              { value: "p6-f", label: "P6 — APIPod (F)" },
              { value: "p6-g", label: "P6 — APIPod (G)" },
              { value: "p6-h", label: "P6 — APIPod (H)" },
              { value: "none", label: "— None —" },
            ],
            mainCount: videoMainCount,
            setMainCount: setVideoMainCount,
            fbCount: videoFallbackCount,
            setFbCount: setVideoFallbackCount,
            mainSlots: videoMainSlots,
            setMainSlots: (s) => setVideoMainSlots(s as SlotV[]),
            fbSlots: videoFallbackSlots,
            setFbSlots: (s) => setVideoFallbackSlots(s as SlotV[]),
          },
          {
            asset: "image",
            color: "#ec4899",
            options: [
              { value: "p1", label: "P1 — GeminiGen" },
              { value: "p2-a", label: "P2 — Crun (key A)" },
              { value: "p2-b", label: "P2 — Crun (key B)" },
              { value: "p4", label: "P4 — Grsai" },
              { value: "p5", label: "P5 — APIMart" },
              { value: "p6-a", label: "P6 — APIPod (A)" },
              { value: "p6-b", label: "P6 — APIPod (B)" },
              { value: "p6-c", label: "P6 — APIPod (C)" },
              { value: "p6-d", label: "P6 — APIPod (D)" },
              { value: "p6-e", label: "P6 — APIPod (E)" },
              { value: "p6-f", label: "P6 — APIPod (F)" },
              { value: "p6-g", label: "P6 — APIPod (G)" },
              { value: "p6-h", label: "P6 — APIPod (H)" },
              { value: "none", label: "— None —" },
            ],
            mainCount: imageMainCount,
            setMainCount: setImageMainCount,
            fbCount: imageFallbackCount,
            setFbCount: setImageFallbackCount,
            mainSlots: imageMainSlots,
            setMainSlots: (s) => setImageMainSlots(s as SlotI[]),
            fbSlots: imageFallbackSlots,
            setFbSlots: (s) => setImageFallbackSlots(s as SlotI[]),
          },
          {
            asset: "grok",
            color: "#fb923c",
            options: [
              { value: "p1", label: "P1 — GeminiGen" },
              { value: "p2-a", label: "P2 — Crun (key A)" },
              { value: "p2-b", label: "P2 — Crun (key B)" },
              { value: "p5", label: "P5 — APIMart" },
              { value: "p6-a", label: "P6 — APIPod (A)" },
              { value: "p6-b", label: "P6 — APIPod (B)" },
              { value: "p6-c", label: "P6 — APIPod (C)" },
              { value: "p6-d", label: "P6 — APIPod (D)" },
              { value: "p6-e", label: "P6 — APIPod (E)" },
              { value: "p6-f", label: "P6 — APIPod (F)" },
              { value: "p6-g", label: "P6 — APIPod (G)" },
              { value: "p6-h", label: "P6 — APIPod (H)" },
              { value: "none", label: "— None —" },
            ],
            mainCount: grokMainCount,
            setMainCount: setGrokMainCount,
            fbCount: grokFallbackCount,
            setFbCount: setGrokFallbackCount,
            mainSlots: grokMainSlots,
            setMainSlots: (s) => setGrokMainSlots(s as SlotV[]),
            fbSlots: grokFallbackSlots,
            setFbSlots: (s) => setGrokFallbackSlots(s as SlotV[]),
          },
          {
            asset: "cinema",
            color: "#22d3ee",
            options: [
              { value: "p1", label: "P1 — GeminiGen" },
              { value: "p2-a", label: "P2 — Crun (key A)" },
              { value: "p2-b", label: "P2 — Crun (key B)" },
              { value: "p5", label: "P5 — APIMart" },
              { value: "p6-a", label: "P6 — APIPod (A)" },
              { value: "p6-b", label: "P6 — APIPod (B)" },
              { value: "p6-c", label: "P6 — APIPod (C)" },
              { value: "p6-d", label: "P6 — APIPod (D)" },
              { value: "p6-e", label: "P6 — APIPod (E)" },
              { value: "p6-f", label: "P6 — APIPod (F)" },
              { value: "p6-g", label: "P6 — APIPod (G)" },
              { value: "p6-h", label: "P6 — APIPod (H)" },
              { value: "none", label: "— None —" },
            ],
            mainCount: cinemaMainCount,
            setMainCount: setCinemaMainCount,
            fbCount: cinemaFallbackCount,
            setFbCount: setCinemaFallbackCount,
            mainSlots: cinemaMainSlots,
            setMainSlots: (s) => setCinemaMainSlots(s as SlotV[]),
            fbSlots: cinemaFallbackSlots,
            setFbSlots: (s) => setCinemaFallbackSlots(s as SlotV[]),
          },
          {
            // Sora 2 (OpenAI) cascade — APIPod-only model. We expose the
            // full p6-a..h pool plus non-p6 options for forward compat
            // (if APIMart/Crun add Sora 2 later, admin can switch
            // without a code change), but realistically only p6 keys
            // will actually accept sora-2-vip today.
            asset: "sora2",
            color: "#4ade80", // light green — matches Sora 2 tab theme
            options: [
              { value: "p1", label: "P1 — GeminiGen" },
              { value: "p2-a", label: "P2 — Crun (key A)" },
              { value: "p2-b", label: "P2 — Crun (key B)" },
              { value: "p5", label: "P5 — APIMart" },
              { value: "p6-a", label: "P6 — APIPod (A)" },
              { value: "p6-b", label: "P6 — APIPod (B)" },
              { value: "p6-c", label: "P6 — APIPod (C)" },
              { value: "p6-d", label: "P6 — APIPod (D)" },
              { value: "p6-e", label: "P6 — APIPod (E)" },
              { value: "p6-f", label: "P6 — APIPod (F)" },
              { value: "p6-g", label: "P6 — APIPod (G)" },
              { value: "p6-h", label: "P6 — APIPod (H)" },
              { value: "none", label: "— None —" },
            ],
            mainCount: sora2MainCount,
            setMainCount: setSora2MainCount,
            fbCount: sora2FallbackCount,
            setFbCount: setSora2FallbackCount,
            mainSlots: sora2MainSlots,
            setMainSlots: (s) => setSora2MainSlots(s as SlotV[]),
            fbSlots: sora2FallbackSlots,
            setFbSlots: (s) => setSora2FallbackSlots(s as SlotV[]),
          },
        ];
        return (
          <div className="card p-6 mb-6 border-2 border-emerald-200 bg-emerald-50/40">
            <div className="flex items-center gap-2 mb-1">
              <Cpu className="w-5 h-5 text-emerald-600" />
              <h2 className="font-display font-bold text-lg">Cascade — Main + Fallback</h2>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              Each task starts at a round-robin position in MAIN. If it fails,
              walks remaining mains, then all fallbacks in order. 'None' rows
              are skipped. + / − adjusts each list independently.
            </p>
            {assets.map((a) => (
              <div key={a.asset} className="mb-5 pb-5 border-b border-[var(--color-border)] last:border-0">
                <div className="text-xs font-mono uppercase tracking-widest font-bold mb-3" style={{ color: a.color }}>
                  {a.asset.toUpperCase()} CASCADE
                </div>

                {/* Main slots */}
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider opacity-70">
                      Main ({a.mainCount} slots) — round-robin source
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const n = Math.max(1, a.mainCount - 1);
                        a.setMainCount(n);
                        a.setMainSlots(a.mainSlots.slice(0, n));
                      }}
                      className="text-[10px] px-1.5 rounded font-bold"
                      style={{ background: "#e5e7eb", color: "#374151" }}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const n = Math.min(50, a.mainCount + 1);
                        a.setMainCount(n);
                        a.setMainSlots([...a.mainSlots, "none"]);
                      }}
                      className="text-[10px] px-1.5 rounded font-bold"
                      style={{ background: "#e5e7eb", color: "#374151" }}
                    >
                      +
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {Array.from({ length: a.mainCount }).map((_, i) => (
                      <select
                        key={`${a.asset}-main-${i}`}
                        value={a.mainSlots[i] || "none"}
                        onChange={(e) => {
                          const next = [...a.mainSlots];
                          next[i] = e.target.value;
                          a.setMainSlots(next);
                        }}
                        className="input text-[11px]"
                        style={{ color: "white" }}
                      >
                        {a.options.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ))}
                  </div>
                </div>

                {/* Fallback slots */}
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider opacity-70">
                      Fallback ({a.fbCount} slots) — tried after all mains fail
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const n = Math.max(1, a.fbCount - 1);
                        a.setFbCount(n);
                        a.setFbSlots(a.fbSlots.slice(0, n));
                      }}
                      className="text-[10px] px-1.5 rounded font-bold"
                      style={{ background: "#e5e7eb", color: "#374151" }}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const n = Math.min(50, a.fbCount + 1);
                        a.setFbCount(n);
                        a.setFbSlots([...a.fbSlots, "none"]);
                      }}
                      className="text-[10px] px-1.5 rounded font-bold"
                      style={{ background: "#e5e7eb", color: "#374151" }}
                    >
                      +
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {Array.from({ length: a.fbCount }).map((_, i) => (
                      <select
                        key={`${a.asset}-fb-${i}`}
                        value={a.fbSlots[i] || "none"}
                        onChange={(e) => {
                          const next = [...a.fbSlots];
                          next[i] = e.target.value;
                          a.setFbSlots(next);
                        }}
                        className="input text-[11px]"
                        style={{ color: "white" }}
                      >
                        {a.options.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => void saveMainFallback(a.asset)}
                  disabled={savingMfSlots === a.asset}
                  className="btn-primary text-xs disabled:opacity-50"
                >
                  {savingMfSlots === a.asset ? (
                    <Loader2 className="w-3 h-3 animate-spin inline" />
                  ) : (
                    <Save className="w-3 h-3 inline" />
                  )}{" "}
                  Save {a.asset} cascade
                </button>
              </div>
            ))}
            {mfSlotsMsg && (
              <div className="text-xs mt-2" style={{ color: mfSlotsMsg.startsWith("✓") ? "#16a34a" : "#dc2626" }}>
                {mfSlotsMsg}
              </div>
            )}
          </div>
        );
      })()}

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
          {/* Sora 2 (OpenAI via APIPod) — per-second rate. Used by:
              standalone Sora 2 tab + Auto Content when Sora 2 picker
              selected. Defaults to 0.20/sec (~2x Grok rate per APIPod
              docs: "more stable but higher unit price"). */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-1.5 flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5" /> Sora 2 <span className="text-[10px] font-normal text-[var(--color-text-muted)]">(OpenAI) / second</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--color-text-muted)]">RM</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rateSora2}
                onChange={(e) => setRateSora2(e.target.value)}
                className="input !pl-10"
                placeholder="0.20"
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
        {/* AI script model — INDEPENDENT from Auto Content's model_auto.
            Storytelling script gen demands a strong JSON producer (12
            scenes × ~800 chars each = 6-10K output tokens, strict
            schema), so admin sets a dedicated model here. Empty falls
            back to model_auto for backward compat. Free-text input so
            admin can paste any OpenRouter model id without waiting
            for a code change to add it to a dropdown. */}
        <div className="grid grid-cols-1 gap-4 mb-3 mt-3">
          <div>
            <label className="block text-xs font-mono uppercase tracking-widest text-[var(--color-text-muted)] font-bold mb-2">
              AI Script Model (independent from Auto Content)
            </label>
            <input
              type="text"
              value={storytellingScriptModel}
              onChange={(e) => setStorytellingScriptModel(e.target.value)}
              placeholder="e.g. google/gemini-3.1-pro, anthropic/claude-haiku-4-5, openai/gpt-5.4"
              className="input"
              style={{ color: "white" }}
            />
            <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
              {storytellingScriptModel.trim()
                ? <>Currently active: <strong>{storytellingScriptModel.trim()}</strong></>
                : <>Empty = falls back to <strong>model_auto</strong> (shared with Auto Content). Set this when Storytelling script gen fails with &quot;invalid JSON&quot; — Flash-Lite-tier models often truncate the 6–10K token JSON. Use a stronger model (gemini-3.1-pro / claude-haiku-4-5 / gpt-5.4) here without making Auto Content more expensive.</>
              }
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

      {/* Facebook Conversions API (CAPI) — for Sales-objective FB Ads */}
      <div className="card p-6 mb-6 border-2 border-sky-100 bg-sky-50/40">
        <div className="flex items-center gap-2 mb-4">
          <Facebook className="w-5 h-5 text-sky-600" />
          <h2 className="font-display font-bold text-lg">Facebook Conversions API</h2>
        </div>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Server-side + browser Pixel tracking untuk Sales-objective FB Ads.
          Browser Pixel auto-load di landing page (bukan /dashboard / /admin).
          Server CAPI fire dari payment webhook — Meta dedupes browser +
          server events guna event_id sama.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-[var(--color-text-secondary)] mb-1 block">
              Pixel ID
            </label>
            <input
              value={fbPixelId}
              onChange={(e) => setFbPixelId(e.target.value)}
              placeholder="1511282347248812"
              className="input font-mono text-xs w-full"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-[var(--color-text-secondary)] mb-1 block">
              Test Event Code{" "}
              <span className="text-[var(--color-text-muted)] font-normal">
                (kosong untuk production)
              </span>
            </label>
            <input
              value={fbTestEventCode}
              onChange={(e) => setFbTestEventCode(e.target.value)}
              placeholder="TEST12345"
              className="input font-mono text-xs w-full"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-bold text-[var(--color-text-secondary)] mb-1 block">
              Access Token{" "}
              <span className="text-red-600 font-normal">(server-only, jangan share)</span>
            </label>
            <input
              type="password"
              value={fbAccessToken}
              onChange={(e) => setFbAccessToken(e.target.value)}
              placeholder="EAAxxxx..."
              className="input font-mono text-xs w-full"
            />
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={fbCapiEnabled}
            onChange={(e) => setFbCapiEnabled(e.target.checked)}
            className="w-4 h-4 accent-sky-500"
          />
          <span>Enabled (uncheck untuk pause tracking sementara)</span>
        </label>
        <button
          onClick={saveFbCapi}
          disabled={savingFbCapi}
          className="btn-primary mt-3 disabled:opacity-50"
        >
          {savingFbCapi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Facebook config
        </button>
        {fbCapiMsg && (
          <div className="text-xs mt-2 text-sky-700">{fbCapiMsg}</div>
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
