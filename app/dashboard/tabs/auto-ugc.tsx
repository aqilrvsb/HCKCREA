"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Wand2, X, Info, Upload, Sparkles } from "lucide-react";
import { uploadImage } from "@/lib/upload-image";
import AttachmentPicker from "../sections/attachment-picker";
import {
  splitDuration,
  splitLabel,
  sellerWordTarget,
  AUTO_UGC_MIN_SEC,
  AUTO_UGC_MAX_SEC,
} from "@/lib/auto-ugc-segments";

// ── Theme (matches Auto Content amber) ───────────────────────────────
const AMBER = "#eab308";
const AMBER_SOFT = "rgba(234,179,8,0.12)";
const AMBER_FAINT = "rgba(234,179,8,0.06)";

type AvatarMode = "create" | "existing";
type CtaMode = "shop" | "custom" | "none";
type Status = "idle" | "generating" | "failed";

// Higgsfield-style UGC scene concepts. The client picks any that fit; the
// script/scene LLM spreads them across videos + segments (same avatar &
// outfit within one video, different scene per segment).
// ref: https://higgsfield.ai/marketing-studio/product
const SCENE_IDEAS: { id: string; label: string; hint: string }[] = [
  { id: "ugc", label: "UGC", hint: "Video sosial media realistik" },
  { id: "giant-figure", label: "Giant Figure", hint: "Produk gergasi, scroll-stopping" },
  { id: "unbox-tryon", label: "Unboxing Try-On", hint: "Unbox + cuba dalam satu take" },
  { id: "unbox-asmr", label: "Unboxing ASMR", hint: "Unboxing ASMR memuaskan" },
  { id: "tryon-sneakers", label: "Virtual Try-On", hint: "Cuba produk secara maya" },
  { id: "addiction", label: "UGC Addiction", hint: "Obsesi produk tak boleh lepas" },
  { id: "before-after", label: "Before & After", hint: "Tunjuk transformasi / hasil" },
  { id: "tutorial", label: "Tutorial", hint: "Langkah demi langkah" },
  { id: "unboxing", label: "Unboxing", hint: "Unboxing berkualiti tinggi" },
];

export default function AutoUgcTab({ projectId }: { projectId?: string } = {}) {
  // ── Product ──────────────────────────────────────────────────────
  const [productName, setProductName] = useState("");
  const [productDetail, setProductDetail] = useState("");
  const [productUrls, setProductUrls] = useState<string[]>([]);
  const [uploadingProduct, setUploadingProduct] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);

  // ── Avatar ───────────────────────────────────────────────────────
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("create");
  // create-mode criteria
  const [gender, setGender] = useState<"female" | "male">("female");
  const [hijab, setHijab] = useState<"yes" | "no">("yes");
  const [age, setAge] = useState<"20s" | "30s" | "40s" | "55+">("30s");
  // existing-mode uploaded avatar photo
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // ── Scene / idea ─────────────────────────────────────────────────
  const [sceneIds, setSceneIds] = useState<string[]>(["ugc"]);
  const [customIdea, setCustomIdea] = useState("");

  // ── Duration / batch / format ────────────────────────────────────
  const [duration, setDuration] = useState<number>(15);
  const [quantity, setQuantity] = useState<number>(3);
  const [aspect, setAspect] = useState<"9:16" | "16:9">("9:16");
  const [ctaMode, setCtaMode] = useState<CtaMode>("shop");
  const [customCta, setCustomCta] = useState("");

  // ── Submit / status ──────────────────────────────────────────────
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showPlanner, setShowPlanner] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const busy = status === "generating";
  const segs = useMemo(() => splitDuration(duration), [duration]);

  // ── Upload helpers ───────────────────────────────────────────────
  async function pickProductFile(files: FileList | null) {
    if (!files?.length) return;
    setUploadingProduct(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 3 - productUrls.length)) {
        const r = await uploadImage(f);
        if (r?.url) urls.push(r.url);
      }
      if (urls.length) setProductUrls((prev) => [...prev, ...urls].slice(0, 3));
    } catch {
      setError("Gagal muat naik gambar produk. Cuba lagi.");
    } finally {
      setUploadingProduct(false);
    }
  }

  async function pickAvatarFile(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setUploadingAvatar(true);
    try {
      const r = await uploadImage(f);
      if (r?.url) setAvatarUrl(r.url);
    } catch {
      setError("Gagal muat naik gambar avatar. Cuba lagi.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  function toggleScene(id: string) {
    setSceneIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // ── Validation ───────────────────────────────────────────────────
  const canSubmit =
    !busy &&
    productUrls.length > 0 &&
    (avatarMode === "create" || !!avatarUrl) &&
    (sceneIds.length > 0 || customIdea.trim().length > 0);

  // ── Submit ───────────────────────────────────────────────────────
  async function submit() {
    if (!canSubmit) return;
    setStatus("generating");
    setError(null);
    setLog([
      `Menyediakan ${quantity} video · ${splitLabel(duration)}`,
      avatarMode === "create"
        ? `Avatar: jana baru (${gender}, ${hijab === "yes" ? "bertudung" : "tiada tudung"}, ${age})`
        : "Avatar: guna avatar dimuat naik (konsisten semua video)",
    ]);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const body = {
      product_name: productName.trim(),
      product_detail: productDetail.trim(),
      product_image_urls: productUrls,
      avatar_mode: avatarMode,
      avatar_url: avatarMode === "existing" ? avatarUrl : "",
      avatar_gender: gender,
      avatar_hijab: hijab === "yes" ? "hijab" : "no-hijab",
      avatar_age: age,
      scene_ideas: sceneIds,
      custom_idea: customIdea.trim(),
      duration_sec: duration,
      quantity,
      aspect_ratio: aspect,
      cta_mode: ctaMode,
      custom_cta: ctaMode === "custom" ? customCta.trim() : "",
      project_id: projectId,
    };

    try {
      const r = await fetch("/api/generate/auto-ugc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        setStatus("failed");
        setError(d?.error || `Gagal (HTTP ${r.status}).`);
        return;
      }
      setLog((l) => [
        ...l,
        `Berjaya dihantar: ${d.quantity ?? quantity} video (${d.segments_total ?? "?"} segmen).`,
        `Anggaran kos: RM${Number(d.total_cost ?? 0).toFixed(2)}.`,
      ]);
      setStatus("idle");
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setStatus("failed");
      setError(e?.message || "Ralat rangkaian.");
    }
  }

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3"
        style={{ background: AMBER_SOFT, border: `1px solid ${AMBER}33` }}
      >
        <Sparkles className="w-5 h-5" style={{ color: AMBER }} />
        <div>
          <div className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">
            Auto UGC <span className="text-xs font-mono opacity-60">· Grok Imagine 1.5</span>
          </div>
          <div className="text-xs text-[var(--color-text-secondary)]">
            Avatar konsisten · start-frame Banana Pro 2 · dialog bersambung merentas
            segmen. Video panjang (16–30s) auto-pecah kepada Seg 1 + Seg 2.
          </div>
        </div>
      </div>

      {/* Product */}
      <Card>
        <Label
          n="1"
          title="Produk"
          hint="Nama + detail (harga/USP/bahan/benefit) supaya AI tulis dialog rujuk fakta sebenar. Gambar produk jadi asas start-frame Banana Pro 2."
        />
        <div className="space-y-2 mb-3">
          <input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            placeholder="Nama produk — cth: LUQFA Lotion 100ml"
            className="w-full rounded-lg px-3 py-2 text-sm bg-transparent"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          />
          <textarea
            value={productDetail}
            onChange={(e) => setProductDetail(e.target.value)}
            rows={3}
            placeholder="Detail produk — harga, USP, bahan, benefit… (AI guna ni untuk dialog + hook)"
            className="w-full rounded-lg px-3 py-2 text-sm bg-transparent"
            style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          {productUrls.map((u, i) => (
            <div key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u}
                alt={`produk ${i + 1}`}
                className="w-20 h-20 rounded-lg object-cover"
                style={{ border: `1px solid ${AMBER}55` }}
              />
              <button
                onClick={() => setProductUrls((p) => p.filter((x) => x !== u))}
                className="absolute -top-2 -right-2 rounded-full p-0.5 bg-black/70 text-white"
                aria-label="buang"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {productUrls.length < 3 && (
            <>
              <label
                className="w-20 h-20 rounded-lg flex flex-col items-center justify-center cursor-pointer text-[10px] gap-1"
                style={{ border: `1px dashed ${AMBER}77`, color: AMBER }}
              >
                {uploadingProduct ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Upload
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => pickProductFile(e.target.files)}
                />
              </label>
              <button
                onClick={() => setShowProductPicker(true)}
                className="w-20 h-20 rounded-lg flex flex-col items-center justify-center text-[10px] gap-1"
                style={{ border: `1px dashed ${AMBER}77`, color: AMBER }}
              >
                <Wand2 className="w-4 h-4" />
                Library
              </button>
            </>
          )}
        </div>
      </Card>

      {/* Avatar */}
      <Card>
        <Label
          n="2"
          title="Avatar"
          hint="Avatar kekal SAMA (muka & baju) untuk semua segmen dalam satu video. Antara video (kuantiti) — avatar sama, baju boleh beza."
        />
        <div className="flex gap-2 mb-3">
          <Seg active={avatarMode === "create"} onClick={() => setAvatarMode("create")}>
            ✨ Jana avatar
          </Seg>
          <Seg active={avatarMode === "existing"} onClick={() => setAvatarMode("existing")}>
            📤 Avatar sedia ada
          </Seg>
        </div>

        {avatarMode === "create" ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Jantina">
              <Pills
                value={gender}
                onChange={(v) => setGender(v as any)}
                opts={[
                  ["female", "Perempuan"],
                  ["male", "Lelaki"],
                ]}
              />
            </Field>
            <Field label="Tudung">
              <Pills
                value={hijab}
                onChange={(v) => setHijab(v as any)}
                opts={[
                  ["yes", "Bertudung"],
                  ["no", "Tiada"],
                ]}
              />
            </Field>
            <Field label="Umur">
              <Pills
                value={age}
                onChange={(v) => setAge(v as any)}
                opts={[
                  ["20s", "20-an"],
                  ["30s", "30-an"],
                  ["40s", "40-an"],
                  ["55+", "55+"],
                ]}
              />
            </Field>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarUrl}
                  alt="avatar"
                  className="w-24 h-24 rounded-lg object-cover"
                  style={{ border: `1px solid ${AMBER}55` }}
                />
                <button
                  onClick={() => setAvatarUrl("")}
                  className="absolute -top-2 -right-2 rounded-full p-0.5 bg-black/70 text-white"
                  aria-label="buang"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <label
                  className="w-24 h-24 rounded-lg flex flex-col items-center justify-center cursor-pointer text-[10px] gap-1"
                  style={{ border: `1px dashed ${AMBER}77`, color: AMBER }}
                >
                  {uploadingAvatar ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Upload avatar
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => pickAvatarFile(e.target.files)}
                  />
                </label>
                <button
                  onClick={() => setShowAvatarPicker(true)}
                  className="text-xs underline"
                  style={{ color: AMBER }}
                >
                  atau pilih dari Library
                </button>
              </>
            )}
          </div>
        )}
      </Card>

      {/* Scene ideas */}
      <Card>
        <Label
          n="3"
          title="Idea / Scene"
          hint="Pilih konsep UGC (boleh lebih satu). AI akan beri setiap segmen scene berbeza — avatar & baju kekal sama dalam satu video."
        />
        <div className="flex flex-wrap gap-2 mb-3">
          {SCENE_IDEAS.map((s) => {
            const on = sceneIds.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggleScene(s.id)}
                title={s.hint}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={
                  on
                    ? { background: AMBER, color: "#000" }
                    : {
                        background: "var(--color-bg-card)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-text-secondary)",
                      }
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <textarea
          value={customIdea}
          onChange={(e) => setCustomIdea(e.target.value)}
          rows={2}
          placeholder="(Pilihan) Idea khusus anda — cth: 'testimoni sebelum tidur, fokus kulit glow'. Jika diisi, AI utamakan idea ni."
          className="w-full rounded-lg px-3 py-2 text-sm bg-transparent"
          style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
        />
      </Card>

      {/* Duration + batch + format */}
      <Card>
        <Label n="4" title="Durasi & Kuantiti" hint="Grok Imagine 1.5 maksimum 15s/klip — video 16–30s auto-pecah kepada 2 segmen seimbang." />
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[var(--color-text-secondary)]">
                Durasi setiap video
              </span>
              <span className="text-sm font-bold" style={{ color: AMBER }}>
                {duration}s → {splitLabel(duration)}
              </span>
            </div>
            <input
              type="range"
              min={AUTO_UGC_MIN_SEC}
              max={AUTO_UGC_MAX_SEC}
              step={1}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full"
              style={{ accentColor: AMBER }}
            />
            <div
              className="mt-2 rounded-lg px-3 py-2 text-[11px]"
              style={{ background: AMBER_FAINT, color: "var(--color-text-secondary)" }}
            >
              {segs.map((s, i) => {
                const w = sellerWordTarget(s);
                return (
                  <span key={i} className="mr-3">
                    <b style={{ color: AMBER }}>Seg {i + 1}</b>: {s}s · ~{w.min}–{w.max} patah
                  </span>
                );
              })}
              <button
                onClick={() => setShowPlanner((v) => !v)}
                className="underline ml-1"
                style={{ color: AMBER }}
              >
                {showPlanner ? "sembunyi jadual" : "jadual perkataan"}
              </button>
              {showPlanner && <WordPlanner />}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Kuantiti video">
              <select
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full rounded-lg px-2 py-1.5 text-sm bg-transparent"
                style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n} className="bg-neutral-900">
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format">
              <Pills
                value={aspect}
                onChange={(v) => setAspect(v as any)}
                opts={[
                  ["9:16", "9:16"],
                  ["16:9", "16:9"],
                ]}
              />
            </Field>
            <Field label="CTA">
              <Pills
                value={ctaMode}
                onChange={(v) => setCtaMode(v as any)}
                opts={[
                  ["shop", "Shop"],
                  ["custom", "Custom"],
                  ["none", "Tiada"],
                ]}
              />
            </Field>
          </div>
          {ctaMode === "custom" && (
            <input
              value={customCta}
              onChange={(e) => setCustomCta(e.target.value)}
              placeholder="CTA khusus — cth: 'Klik link kat bio!'"
              className="w-full rounded-lg px-3 py-2 text-sm bg-transparent"
              style={{ border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
            />
          )}
        </div>
      </Card>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all"
          style={{
            background: canSubmit
              ? "linear-gradient(135deg, #facc15 0%, #eab308 100%)"
              : "var(--color-bg-card)",
            color: canSubmit ? "#000" : "var(--color-text-muted)",
            opacity: canSubmit ? 1 : 0.6,
            boxShadow: canSubmit ? "0 4px 14px rgba(250,204,21,0.3)" : "none",
          }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          {busy ? "Menghantar…" : `Jana ${quantity} video`}
        </button>
        {!canSubmit && !busy && (
          <span className="text-xs text-[var(--color-text-muted)]">
            {productUrls.length === 0
              ? "Muat naik gambar produk dulu."
              : avatarMode === "existing" && !avatarUrl
                ? "Muat naik avatar dulu."
                : "Pilih sekurang-kurangnya satu idea/scene."}
          </span>
        )}
      </div>

      {error && (
        <div
          className="rounded-lg px-3 py-2 text-sm"
          style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}
        >
          {error}
        </div>
      )}
      {log.length > 0 && (
        <div className="rounded-lg px-3 py-2 text-xs font-mono space-y-0.5" style={{ background: AMBER_FAINT, color: "var(--color-text-secondary)" }}>
          {log.map((l, i) => (
            <div key={i}>› {l}</div>
          ))}
        </div>
      )}

      {/* Pickers */}
      <AttachmentPicker
        open={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        maxPick={3 - productUrls.length}
        defaultCategory="product"
        onPickMulti={(atts) => {
          const urls = atts.map((a) => a.public_url).filter(Boolean);
          setProductUrls((prev) => [...prev, ...urls].slice(0, 3));
          setShowProductPicker(false);
        }}
      />
      <AttachmentPicker
        open={showAvatarPicker}
        onClose={() => setShowAvatarPicker(false)}
        defaultCategory="avatar"
        onPick={(a) => {
          if (a?.public_url) setAvatarUrl(a.public_url);
          setShowAvatarPicker(false);
        }}
      />
    </div>
  );
}

// ── Small UI helpers ─────────────────────────────────────────────────
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
    >
      {children}
    </div>
  );
}

function Label({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span
          className="font-mono text-[10px] font-bold rounded px-1.5 py-0.5"
          style={{ background: AMBER_SOFT, color: AMBER }}
        >
          {n}
        </span>
        <span className="font-bold text-sm text-[var(--color-text-primary)]">{title}</span>
      </div>
      {hint && <div className="text-[11px] text-[var(--color-text-muted)] mt-1">{hint}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-[var(--color-text-secondary)] mb-1">{label}</div>
      {children}
    </div>
  );
}

function Seg({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-lg text-sm font-bold transition-all"
      style={
        active
          ? { background: AMBER, color: "#000" }
          : { background: "var(--color-bg-card)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }
      }
    >
      {children}
    </button>
  );
}

function Pills({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map(([v, label]) => {
        const on = value === v;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            className="px-2.5 py-1 rounded-md text-xs font-semibold transition-all"
            style={
              on
                ? { background: AMBER, color: "#000" }
                : { background: "transparent", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// Seller/TikTok word-count reference (matches the on-screen planner image).
function WordPlanner() {
  const rows: [string, string, string, string][] = [
    ["8s", "16–18", "18–20", "20–24"],
    ["9s", "18–20", "20–22", "22–26"],
    ["10s", "20–22", "22–24", "24–28"],
    ["11s", "22–24", "24–26", "26–30"],
    ["12s", "24–26", "26–28", "28–32"],
    ["13s", "26–28", "28–30", "30–34"],
    ["14s", "28–30", "30–32", "32–36"],
    ["15s", "30–32", "32–35", "35–40"],
  ];
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="text-[10px] w-full">
        <thead>
          <tr style={{ color: AMBER }}>
            <th className="text-left pr-3">Durasi</th>
            <th className="text-left pr-3">Santai</th>
            <th className="text-left pr-3">Normal</th>
            <th className="text-left pr-3 font-bold">Seller / TikTok</th>
          </tr>
        </thead>
        <tbody className="text-[var(--color-text-secondary)]">
          {rows.map((r) => (
            <tr key={r[0]}>
              <td className="pr-3">{r[0]}</td>
              <td className="pr-3">{r[1]}</td>
              <td className="pr-3">{r[2]}</td>
              <td className="pr-3 font-bold" style={{ color: "var(--color-text-primary)" }}>{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
