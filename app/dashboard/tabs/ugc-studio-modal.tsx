"use client";

// UGC Studio — a click-driven UGC product-image builder. Opens as a modal
// from the Images tab (does NOT alter the existing image generator). The
// user picks options (no prompt-writing) + attaches a product photo; we
// assemble a structured prompt and fire the SAME /api/generate/image
// pipeline (nano-banana-pro + product reference). Tuned for Malaysian
// TikTok sellers — including a Tutup Aurat (modest) priority toggle, a
// per-section "Custom" free-text override, and a quantity batch generator.

import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Sparkles, ImagePlus, Info } from "lucide-react";
import Portal from "../sections/portal";
import AttachmentPicker from "../sections/attachment-picker";

type Opt = { val: string; label: string };
const CUSTOM = "custom";

// Malay explanations shown when the ℹ icon next to a section is tapped.
const TIPS: Record<string, string> = {
  product: "Gambar produk sebenar anda. AI akan pastikan label/pakej dalam gambar UGC sama macam gambar ni (warna, tulisan, bentuk).",
  stylefit: "Fit pakaian model: Longgar (selesa, flowy), Biasa (sederhana — tak ketat tak melampau), atau Fashion (bergaya). Tutup aurat pula ikut tetapan Hijab di bawah.",
  gender: "Jantina model dalam gambar — perempuan atau lelaki.",
  age: "Lingkungan umur model (remaja hingga 50+).",
  ethnic: "Bangsa / etnik wajah model. Semua dijana dengan rupa Malaysia yang natural.",
  hijab: "Ada hijab = AUTO tutup aurat penuh (rambut, tangan, kaki, badan ditutup). Tiada hijab = tak tutup aurat.",
  face: "Bentuk muka model — oval, bulat, square, hati, panjang atau diamond.",
  skin: "Tona kulit model — cerah, sawo matang, atau gelap manis.",
  expression: "Riak/emosi wajah model — senyum, teruja, wow, neutral atau fokus.",
  outfit: "Jenis pakaian — casual, muslimah, baju kurung, office, sporty, loungewear atau glam.",
  shot: "Saiz shot kamera — fokus produk, close-up muka, separuh badan atau penuh badan.",
  angle: "Sudut kamera — aras mata, atas, bawah, flat-lay (atas ke bawah) atau selfie POV (paling natural untuk UGC).",
  pose: "Apa model buat dengan produk — tunjuk label, pegang dekat muka, tunjuk, guna, unboxing, atau cakap depan kamera (sesuai jadi start frame video).",
  prodpos: "Di mana produk diletak — dalam tangan, dekat muka, atas meja, sebelah model, atau dipakai.",
  bg: "Lokasi / latar belakang gambar — bilik, kafe, dapur, studio, jalan, dll. Pilih 🟩 Green Screen kalau nak tukar background nanti / jadikan start frame video.",
  posisi: "Posisi badan model — berdiri, duduk, gaya podcast, bersandar di sofa, atas katil, atau selfie depan cermin. (Lain dari Pose — Pose tu apa buat dengan produk.)",
  makeup: "Tahap solekan — Natural (harian), Glam (penuh), atau Tiada (muka bersih).",
  contrast: "Kontras gambar — Soft (lembut), Normal, atau High (tajam).",
  color: "Tema warna keseluruhan — Warm (rumah Malaysia), Neutral, Pastel, Earthy atau Cool.",
  light: "Jenis pencahayaan — ring-light (gaya UGC), cahaya siang, golden hour, studio, terang lembut, atau moody.",
  auth: "Look akhir gambar: UGC phone (nampak macam guna telefon, real & natural) atau Komersial (bersih, gaya studio).",
  orient: "Saiz/orientasi gambar — 9:16 (TikTok/Reels), 1:1 (square), 4:5 (feed).",
  qty: "Berapa banyak gambar nak generate sekali gus. Setiap satu dicaj seperti 1 imej.",
};

const GENDER: Opt[] = [
  { val: "female", label: "👩 Perempuan" },
  { val: "male", label: "👨 Lelaki" },
];
const AGE: Opt[] = [
  { val: "teen", label: "Remaja" },
  { val: "20s", label: "20-an" },
  { val: "30s", label: "30-an" },
  { val: "40s", label: "40-an" },
  { val: "50plus", label: "50+" },
];
const ETHNIC: Opt[] = [
  { val: "melayu", label: "Melayu" },
  { val: "cina", label: "Cina" },
  { val: "india", label: "India" },
  { val: "asian", label: "Asia" },
];
const FACE: Opt[] = [
  { val: "oval", label: "Oval" },
  { val: "round", label: "Bulat" },
  { val: "square", label: "Sembung (square)" },
  { val: "heart", label: "Hati" },
  { val: "oblong", label: "Panjang" },
  { val: "diamond", label: "Diamond" },
];
const SKIN: Opt[] = [
  { val: "fair", label: "Cerah" },
  { val: "tan", label: "Sawo matang" },
  { val: "deep", label: "Gelap manis" },
];
// Clothing FIT / style (3 levels). Aurat coverage is NOT decided here —
// it's driven by the hijab toggle (hijab ON = auto tutup aurat).
const STYLEFIT: Opt[] = [
  { val: "longgar", label: "🧥 Longgar" },
  { val: "biasa", label: "👕 Biasa (sederhana)" },
  { val: "fashion", label: "✨ Fashion / Style" },
];
const EXPRESSION: Opt[] = [
  { val: "smile", label: "😊 Senyum" },
  { val: "excited", label: "🤩 Teruja" },
  { val: "wow", label: "😮 Wow" },
  { val: "neutral", label: "😐 Neutral" },
  { val: "focus", label: "🧐 Fokus" },
];
const OUTFIT: Opt[] = [
  { val: "casual", label: "Casual" },
  { val: "muslimah", label: "Muslimah" },
  { val: "bajukurung", label: "Baju Kurung" },
  { val: "office", label: "Office" },
  { val: "sporty", label: "Sporty" },
  { val: "home", label: "Loungewear" },
  { val: "glam", label: "Glam" },
];
const SHOT: Opt[] = [
  { val: "detail", label: "Product Detail" },
  { val: "closeup", label: "Close-up" },
  { val: "half", label: "Separuh badan" },
  { val: "full", label: "Penuh badan" },
];
const ANGLE: Opt[] = [
  { val: "eye", label: "Aras mata" },
  { val: "high", label: "Atas" },
  { val: "low", label: "Bawah" },
  { val: "flatlay", label: "Flat-lay" },
  { val: "selfie", label: "Selfie POV" },
];
const POSE: Opt[] = [
  { val: "show-label", label: "Tunjuk label" },
  { val: "hold-face", label: "Pegang dekat muka" },
  { val: "point", label: "Tunjuk produk" },
  { val: "using", label: "Guna produk" },
  { val: "unboxing", label: "Unboxing" },
  { val: "talking", label: "Cakap depan kamera" },
];
const PRODPOS: Opt[] = [
  { val: "in-hand", label: "Dalam tangan" },
  { val: "near-face", label: "Dekat muka" },
  { val: "on-table", label: "Atas meja" },
  { val: "beside", label: "Sebelah" },
  { val: "worn", label: "Dipakai" },
];
const BG: Opt[] = [
  { val: "bedroom", label: "Bilik tidur" },
  { val: "vanity", label: "Vanity / bilik air" },
  { val: "kitchen", label: "Dapur" },
  { val: "cafe", label: "Kafe" },
  { val: "office", label: "Pejabat" },
  { val: "street", label: "Luar / jalan" },
  { val: "studio-white", label: "Studio putih" },
  { val: "retail", label: "Kedai" },
  { val: "gym", label: "Gym" },
  { val: "car", label: "Kereta" },
  { val: "greenscreen", label: "🟩 Green Screen" },
];
// Posisi / posture (badan) — beza dgn Pose/Aksi (apa buat dgn produk).
const POSISI: Opt[] = [
  { val: "berdiri", label: "🧍 Berdiri" },
  { val: "duduk", label: "🪑 Duduk" },
  { val: "podcast", label: "🎙️ Duduk podcast" },
  { val: "sofa", label: "🛋️ Bersandar / sofa" },
  { val: "katil", label: "🛏️ Atas katil" },
  { val: "cermin", label: "🤳 Selfie cermin" },
];
const MAKEUP: Opt[] = [
  { val: "natural", label: "Natural" },
  { val: "glam", label: "Glam" },
  { val: "none", label: "Tiada" },
];
const CONTRAST: Opt[] = [
  { val: "soft", label: "Soft" },
  { val: "normal", label: "Normal" },
  { val: "high", label: "High" },
];
const COLOR: Opt[] = [
  { val: "warm", label: "Warm (rumah MY)" },
  { val: "neutral", label: "Neutral" },
  { val: "pastel", label: "Pastel" },
  { val: "earthy", label: "Earthy" },
  { val: "cool", label: "Cool" },
];
const LIGHT: Opt[] = [
  { val: "ringlight", label: "Ring-light (UGC)" },
  { val: "daylight", label: "Cahaya siang" },
  { val: "golden", label: "Golden hour" },
  { val: "studio", label: "Studio" },
  { val: "airy", label: "Terang lembut" },
  { val: "moody", label: "Moody" },
];
const AUTH: Opt[] = [
  { val: "ugc", label: "📱 UGC phone (real)" },
  { val: "commercial", label: "🎬 Komersial bersih" },
];
const ORIENT: Opt[] = [
  { val: "9:16", label: "9:16" },
  { val: "1:1", label: "1:1" },
  { val: "4:5", label: "4:5" },
];
const QTY: Opt[] = [
  { val: "1", label: "1" },
  { val: "2", label: "2" },
  { val: "3", label: "3" },
  { val: "4", label: "4" },
  { val: "6", label: "6" },
];

// ── Prompt fragment maps (English — nano-banana-pro responds best to EN) ──
const ETHNIC_EN: Record<string, string> = {
  melayu: "Malay", cina: "Chinese", india: "Indian", asian: "Southeast Asian",
};
const AGE_EN: Record<string, string> = {
  teen: "teenage", "20s": "young adult in their 20s", "30s": "adult in their 30s",
  "40s": "adult in their 40s", "50plus": "mature adult in their 50s",
};
const FACE_EN: Record<string, string> = {
  oval: "an oval face shape", round: "a round face shape with soft full cheeks",
  square: "a square face shape with a defined jawline", heart: "a heart-shaped face with a wider forehead and tapered chin",
  oblong: "an elongated oblong face shape", diamond: "a diamond face shape with high prominent cheekbones",
};
const SKIN_EN: Record<string, string> = {
  fair: "fair light skin", tan: "warm tan sawo-matang skin", deep: "deep warm brown skin",
};
const FIT_EN: Record<string, string> = {
  longgar: "loose, flowy, non-form-fitting clothing",
  biasa: "a moderate regular fit — neither too loose nor too tight, modest and natural, not revealing",
  fashion: "a stylish, trendy, fashionable outfit",
};
const EXPR_EN: Record<string, string> = {
  smile: "warm natural smile", excited: "excited delighted expression",
  wow: "surprised wow expression", neutral: "calm neutral expression",
  focus: "focused attentive expression",
};
const OUTFIT_EN: Record<string, string> = {
  casual: "casual everyday outfit", muslimah: "modest muslimah outfit",
  bajukurung: "traditional Malay baju kurung", office: "smart office wear",
  sporty: "sporty activewear", home: "comfortable loungewear", glam: "glamorous outfit",
};
const SHOT_EN: Record<string, string> = {
  detail: "extreme close-up focusing on the product detail",
  closeup: "close-up portrait shot", half: "half-body shot", full: "full-body shot",
};
const ANGLE_EN: Record<string, string> = {
  eye: "eye-level angle", high: "high angle looking down", low: "low angle looking up",
  flatlay: "overhead flat-lay angle", selfie: "first-person selfie-arm POV angle",
};
const POSE_EN: Record<string, string> = {
  "show-label": "holding the product with the label turned clearly toward the camera",
  "hold-face": "holding the product up near their face",
  point: "pointing at the product",
  using: "naturally using/applying the product",
  unboxing: "unboxing the product",
  talking: "looking at and talking to the camera while presenting the product",
};
const PRODPOS_EN: Record<string, string> = {
  "in-hand": "held in hand", "near-face": "held near the face",
  "on-table": "placed on a table in front", beside: "placed beside the subject",
  worn: "worn on the body",
};
const BG_EN: Record<string, string> = {
  bedroom: "cozy bedroom", vanity: "bright bathroom vanity", kitchen: "clean modern kitchen",
  cafe: "casual cafe", office: "modern office", street: "outdoor city street",
  "studio-white": "seamless white studio backdrop", retail: "retail store",
  gym: "fitness gym", car: "inside a car",
  greenscreen: "a solid chroma-key GREEN SCREEN background (#00FF00), evenly lit, no objects or shadows behind the subject",
};
const LIGHT_EN: Record<string, string> = {
  ringlight: "soft ring-light", daylight: "natural daylight", golden: "warm golden-hour light",
  studio: "professional studio softbox light", airy: "bright airy soft light", moody: "moody low-key light",
};
const POSISI_EN: Record<string, string> = {
  berdiri: "standing", duduk: "sitting", podcast: "sitting at a desk in a podcast-style setup",
  sofa: "leaning back / lounging on a sofa", katil: "sitting on a bed", cermin: "taking a mirror selfie",
};
const MAKEUP_EN: Record<string, string> = {
  natural: "natural everyday makeup", glam: "polished glam makeup", none: "no makeup, bare natural skin",
};
const CONTRAST_EN: Record<string, string> = {
  soft: "soft gentle contrast", normal: "balanced natural contrast", high: "punchy high contrast",
};
const COLOR_EN: Record<string, string> = {
  warm: "warm cozy Malaysian indoor colour tones", neutral: "clean neutral colour palette",
  pastel: "soft pastel colour palette", earthy: "earthy natural colour tones", cool: "cool calm colour palette",
};

function pillStyle(active: boolean, accent: string): React.CSSProperties {
  return active
    ? { background: accent, color: "#fff", border: `1px solid ${accent}`, boxShadow: `0 2px 8px ${accent}55` }
    : { background: "rgba(255,255,255,0.04)", color: "#cbd5e1", border: "1px solid rgba(255,255,255,0.12)" };
}

// Module-level so the custom text input keeps focus while typing (an
// inline-defined component would remount on every keystroke).
function Group({
  label, opts, value, onChange, gkey, customs, setCustom, accent, allowCustom = true, tip, onInfo,
}: {
  label: string;
  opts: Opt[];
  value: string;
  onChange: (v: string) => void;
  gkey: string;
  customs: Record<string, string>;
  setCustom: (k: string, v: string) => void;
  accent: string;
  allowCustom?: boolean;
  tip?: string;
  onInfo?: (title: string, text: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
        {tip && onInfo && (
          <button
            type="button"
            onClick={() => onInfo(label, tip)}
            className="text-gray-500 hover:text-white transition"
            title="Apa ni?"
          >
            <Info className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {opts.map((o) => (
          <button
            key={o.val}
            type="button"
            onClick={() => onChange(o.val)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition"
            style={pillStyle(value === o.val, accent)}
          >
            {o.label}
          </button>
        ))}
        {allowCustom && (
          <button
            type="button"
            onClick={() => onChange(CUSTOM)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition"
            style={pillStyle(value === CUSTOM, accent)}
          >
            ✏️ Custom
          </button>
        )}
      </div>
      {allowCustom && value === CUSTOM && (
        <input
          value={customs[gkey] || ""}
          onChange={(e) => setCustom(gkey, e.target.value)}
          placeholder="Tulis sendiri…"
          className="mt-1.5 w-full text-[11px] rounded-lg px-2.5 py-1.5 outline-none"
          style={{ background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}
        />
      )}
    </div>
  );
}

export default function UgcStudioModal({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId?: string;
  onClose: () => void;
}) {
  const ACCENT = "#f97316";
  const [product, setProduct] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gender, setGender] = useState("female");
  const [age, setAge] = useState("20s");
  const [ethnic, setEthnic] = useState("melayu");
  const [face, setFace] = useState("oval");
  const [skin, setSkin] = useState("fair");
  const [hijab, setHijab] = useState(true);
  const [styleFit, setStyleFit] = useState("longgar"); // clothing fit; aurat = hijab toggle
  const [expression, setExpression] = useState("smile");
  const [outfit, setOutfit] = useState("muslimah");
  const [shot, setShot] = useState("half");
  const [angle, setAngle] = useState("selfie");
  const [pose, setPose] = useState("show-label");
  const [prodpos, setProdpos] = useState("in-hand");
  const [bg, setBg] = useState("bedroom");
  const [light, setLight] = useState("ringlight");
  const [auth, setAuth] = useState("ugc");
  const [orient, setOrient] = useState("9:16");
  const [qty, setQty] = useState("1");
  const [posisi, setPosisi] = useState("duduk");
  const [makeup, setMakeup] = useState("natural");
  const [contrast, setContrast] = useState("soft");
  const [color, setColor] = useState("warm");
  const [advanced, setAdvanced] = useState(false); // Lanjutan collapsed by default
  // Per-section free-text overrides, keyed by section. Empty unless the
  // user picks the ✏️ Custom pill for that section.
  const [customs, setCustoms] = useState<Record<string, string>>({});
  const setCustom = (k: string, v: string) => setCustoms((p) => ({ ...p, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  // ℹ info popup (Malay explanation per section).
  const [info, setInfo] = useState<{ title: string; text: string } | null>(null);
  const onInfo = (title: string, text: string) => setInfo({ title, text });

  // Reset the whole form to defaults every time the modal opens, so each
  // session starts clean (no leftover product / selections from last time).
  useEffect(() => {
    if (!open) return;
    setProduct("");
    setPickerOpen(false);
    setGender("female");
    setAge("20s");
    setEthnic("melayu");
    setFace("oval");
    setSkin("fair");
    setHijab(true);
    setStyleFit("longgar");
    setExpression("smile");
    setOutfit("muslimah");
    setShot("half");
    setAngle("selfie");
    setPose("show-label");
    setProdpos("in-hand");
    setBg("bedroom");
    setLight("ringlight");
    setAuth("ugc");
    setOrient("9:16");
    setQty("1");
    setPosisi("duduk");
    setMakeup("natural");
    setContrast("soft");
    setColor("warm");
    setAdvanced(false);
    setCustoms({});
    setBusy(false);
    setProgress("");
    setError(null);
  }, [open]);

  const isFemale = gender === "female";
  // Resolve a section to its prompt fragment — custom free text wins.
  const cv = (key: string, map: Record<string, string>, val: string) =>
    val === CUSTOM ? (customs[key] || "").trim() : map[val] || "";

  const prompt = useMemo(() => {
    const person = `a ${cv("ethnic", ETHNIC_EN, ethnic)} ${cv("age", AGE_EN, age)} ${isFemale ? "woman" : "man"} with authentic Malaysian Southeast-Asian features, ${cv("face", FACE_EN, face)}, ${cv("skin", SKIN_EN, skin)}`;
    // Aurat coverage is driven by the hijab toggle (female): hijab ON =>
    // hair covered + body fully covered (tutup aurat); hijab OFF => no
    // coverage constraint.
    const hijabClause = isFemale && hijab ? ", wearing a neat hijab/tudung that fully covers the hair" : "";
    const auratClause =
      isFemale && hijab
        ? " The outfit fully covers the aurat — arms, wrists, legs and whole body covered; no skin exposure beyond the face and hands."
        : "";
    const fitClause = styleFit === CUSTOM ? (customs.stylefit || "").trim() : FIT_EN[styleFit];
    const authClause =
      auth === CUSTOM
        ? (customs.auth || "").trim()
        : auth === "ugc"
          ? "Shot on a smartphone, authentic user-generated-content look with natural realistic imperfections"
          : "Clean professional commercial product photography, studio quality";
    return [
      `UGC-style product photo. ${person}${hijabClause}, with a ${cv("expression", EXPR_EN, expression)}, ${cv("makeup", MAKEUP_EN, makeup)}, wearing ${cv("outfit", OUTFIT_EN, outfit)}, ${fitClause}.${auratClause}`,
      `The person is ${cv("posisi", POSISI_EN, posisi)}, ${cv("pose", POSE_EN, pose)}.`,
      `${cv("shot", SHOT_EN, shot)}, ${cv("angle", ANGLE_EN, angle)}.`,
      `The product is ${cv("prodpos", PRODPOS_EN, prodpos)}, with its label/packaging clearly facing the camera, sharp and legible, matching the attached reference product image EXACTLY (same label, typography, colour, shape).`,
      `Scene: ${cv("bg", BG_EN, bg)} with ${cv("light", LIGHT_EN, light)}, ${cv("contrast", CONTRAST_EN, contrast)}, ${cv("color", COLOR_EN, color)}.`,
      `${authClause}. Photorealistic, natural visible skin texture, ${orient} vertical composition, no text overlay, no watermark, no logo.`,
    ].join(" ");
  }, [ethnic, age, isFemale, face, skin, hijab, styleFit, expression, makeup, outfit, posisi, shot, angle, pose, prodpos, bg, light, contrast, color, auth, orient, customs]);

  async function generate() {
    if (!product) {
      setError("Sila pilih gambar produk dahulu.");
      return;
    }
    setError(null);
    setBusy(true);
    const n = Math.max(1, Math.min(6, Number(qty) || 1));
    let ok = 0;
    for (let i = 0; i < n; i++) {
      setProgress(`${i + 1}/${n}`);
      try {
        // Nudge each variation so a batch doesn't return identical frames.
        const p = n > 1 ? `${prompt} Variation ${i + 1}, slightly different pose and framing.` : prompt;
        const r = await fetch("/api/generate/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // NOTE: no hardcoded model/provider — the route resolves the
          // model dynamically from the admin's image_default and routes
          // through the admin-configured image cascade (p2/p4/p6 with
          // fallback). So UGC Studio always follows live admin settings.
          body: JSON.stringify({
            prompt: p,
            reference_url: product,
            reference_urls: [product],
            aspect_ratio: orient,
            project_id: projectId,
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d?.ok) {
          ok += 1;
          window.dispatchEvent(new CustomEvent("history:refresh"));
        }
      } catch {
        /* keep going — partial batch still useful */
      }
    }
    setBusy(false);
    setProgress("");
    if (ok > 0) {
      onClose();
    } else {
      setError("Gagal generate. Cuba lagi.");
    }
  }

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[#161616] border border-white/10 shadow-2xl">
          {/* Header */}
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-white/10 bg-[#161616]">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" style={{ color: ACCENT }} />
              <div>
                <h2 className="text-base font-bold text-white">UGC Studio</h2>
                <p className="text-[10px] text-gray-500">Pilih je — tak payah tulis prompt. Setiap section ada ✏️ Custom. Lampir produk, generate.</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Product attachment */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Gambar Produk *</span>
                <button type="button" onClick={() => onInfo("Gambar Produk", TIPS.product)} className="text-gray-500 hover:text-white transition" title="Apa ni?">
                  <Info className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="w-16 h-16 rounded-lg border border-dashed border-white/20 flex items-center justify-center overflow-hidden flex-shrink-0"
                  style={{ background: "rgba(255,255,255,0.03)" }}
                >
                  {product ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImagePlus className="w-5 h-5 text-gray-600" />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="px-3 py-2 rounded-lg text-[11px] font-bold"
                  style={{ background: `${ACCENT}22`, color: ACCENT, border: `1px solid ${ACCENT}55` }}
                >
                  {product ? "Tukar produk" : "Pilih dari Attachments"}
                </button>
                {product && (
                  <button type="button" onClick={() => setProduct("")} className="text-[11px] text-gray-500 hover:text-white">
                    Buang
                  </button>
                )}
              </div>
            </div>

            {/* ───────── ASAS (sentiasa nampak) ───────── */}
            <div className="grid grid-cols-2 gap-4">
              <Group label="Jantina" opts={GENDER} value={gender} onChange={setGender} gkey="gender" customs={customs} setCustom={setCustom} accent={ACCENT} allowCustom={false} tip={TIPS.gender} onInfo={onInfo} />
              <Group label="Umur" opts={AGE} value={age} onChange={setAge} gkey="age" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.age} onInfo={onInfo} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Group label="Bangsa" opts={ETHNIC} value={ethnic} onChange={setEthnic} gkey="ethnic" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.ethnic} onInfo={onInfo} />
              {isFemale ? (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Hijab</span>
                    <button type="button" onClick={() => onInfo("Hijab", TIPS.hijab)} className="text-gray-500 hover:text-white transition" title="Apa ni?">
                      <Info className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setHijab(true)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition" style={pillStyle(hijab, ACCENT)}>🧕 Ada (tutup aurat)</button>
                    <button type="button" onClick={() => setHijab(false)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition" style={pillStyle(!hijab, ACCENT)}>Tiada</button>
                  </div>
                </div>
              ) : (
                <div />
              )}
            </div>
            <Group label="Gaya Pakaian" opts={STYLEFIT} value={styleFit} onChange={setStyleFit} gkey="stylefit" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.stylefit} onInfo={onInfo} />
            <Group label="Pakaian" opts={OUTFIT} value={outfit} onChange={setOutfit} gkey="outfit" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.outfit} onInfo={onInfo} />
            <Group label="Ekspresi" opts={EXPRESSION} value={expression} onChange={setExpression} gkey="expression" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.expression} onInfo={onInfo} />
            <Group label="Posisi" opts={POSISI} value={posisi} onChange={setPosisi} gkey="posisi" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.posisi} onInfo={onInfo} />
            <Group label="Pose / Aksi" opts={POSE} value={pose} onChange={setPose} gkey="pose" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.pose} onInfo={onInfo} />
            <Group label="Latar Belakang" opts={BG} value={bg} onChange={setBg} gkey="bg" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.bg} onInfo={onInfo} />

            {/* ───────── LANJUTAN (collapse — buka kalau nak halus) ───────── */}
            <button
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-bold transition"
              style={{ background: "rgba(255,255,255,0.04)", color: "#cbd5e1", border: "1px solid rgba(255,255,255,0.12)" }}
            >
              <span>⚙️ Tetapan Lanjutan {advanced ? "(sembunyi)" : "(pilihan)"}</span>
              <span>{advanced ? "▲" : "▼"}</span>
            </button>
            {advanced && (
              <div className="space-y-4 pl-1 border-l-2" style={{ borderColor: `${ACCENT}40` }}>
                <div className="grid grid-cols-2 gap-4">
                  <Group label="Bentuk Muka" opts={FACE} value={face} onChange={setFace} gkey="face" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.face} onInfo={onInfo} />
                  <Group label="Tona Kulit" opts={SKIN} value={skin} onChange={setSkin} gkey="skin" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.skin} onInfo={onInfo} />
                </div>
                <Group label="Makeup" opts={MAKEUP} value={makeup} onChange={setMakeup} gkey="makeup" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.makeup} onInfo={onInfo} />
                <div className="grid grid-cols-2 gap-4">
                  <Group label="Jenis Shot" opts={SHOT} value={shot} onChange={setShot} gkey="shot" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.shot} onInfo={onInfo} />
                  <Group label="Angle Kamera" opts={ANGLE} value={angle} onChange={setAngle} gkey="angle" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.angle} onInfo={onInfo} />
                </div>
                <Group label="Kedudukan Produk" opts={PRODPOS} value={prodpos} onChange={setProdpos} gkey="prodpos" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.prodpos} onInfo={onInfo} />
                <div className="grid grid-cols-2 gap-4">
                  <Group label="Pencahayaan" opts={LIGHT} value={light} onChange={setLight} gkey="light" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.light} onInfo={onInfo} />
                  <Group label="Contrast" opts={CONTRAST} value={contrast} onChange={setContrast} gkey="contrast" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.contrast} onInfo={onInfo} />
                </div>
                <Group label="Tema Warna" opts={COLOR} value={color} onChange={setColor} gkey="color" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.color} onInfo={onInfo} />
                <div className="grid grid-cols-2 gap-4">
                  <Group label="Gaya" opts={AUTH} value={auth} onChange={setAuth} gkey="auth" customs={customs} setCustom={setCustom} accent={ACCENT} tip={TIPS.auth} onInfo={onInfo} />
                  <Group label="Orientasi" opts={ORIENT} value={orient} onChange={setOrient} gkey="orient" customs={customs} setCustom={setCustom} accent={ACCENT} allowCustom={false} tip={TIPS.orient} onInfo={onInfo} />
                </div>
              </div>
            )}

            {/* Quantity — batch generate N variations */}
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Kuantiti (generate sekaligus)</span>
                <button type="button" onClick={() => onInfo("Kuantiti", TIPS.qty)} className="text-gray-500 hover:text-white transition" title="Apa ni?">
                  <Info className="w-3 h-3" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QTY.map((o) => (
                  <button
                    key={o.val}
                    type="button"
                    onClick={() => setQty(o.val)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition"
                    style={pillStyle(qty === o.val, ACCENT)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-gray-500 mt-1">Setiap satu dicaj seperti 1 imej.</div>
            </div>

            {/* Prompt preview */}
            <details className="rounded-lg border border-white/10 p-2">
              <summary className="text-[10px] font-bold uppercase tracking-wider text-gray-500 cursor-pointer">Prompt yang dijana (auto)</summary>
              <div className="text-[10px] text-gray-400 mt-2 leading-relaxed">{prompt}</div>
            </details>

            {error && (
              <div className="text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 flex items-center justify-end gap-2 p-4 border-t border-white/10 bg-[#161616]">
            <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/10 disabled:opacity-50">Tutup</button>
            <button
              onClick={generate}
              disabled={busy || !product}
              className="px-5 py-2 rounded-lg text-sm font-bold text-white inline-flex items-center gap-2 disabled:opacity-50"
              style={{ background: ACCENT }}
              title={!product ? "Pilih gambar produk dahulu" : "Generate UGC"}
            >
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Menjana… {progress}</> : <><Sparkles className="w-4 h-4" /> Generate UGC{Number(qty) > 1 ? ` ×${qty}` : ""}</>}
            </button>
          </div>
        </div>
      </div>

      <AttachmentPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(a) => {
          setProduct(a.public_url);
          setPickerOpen(false);
        }}
        defaultCategory="product"
      />

      {/* ℹ Info popup — Malay explanation for the tapped section. */}
      {info && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setInfo(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[#1c1c1c] border border-white/15 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4" style={{ color: ACCENT }} />
                <h3 className="text-sm font-bold text-white">{info.title}</h3>
              </div>
              <button onClick={() => setInfo(null)} className="p-1 rounded hover:bg-white/10 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[12px] text-gray-300 leading-relaxed">{info.text}</p>
            <button
              onClick={() => setInfo(null)}
              className="mt-4 w-full py-2 rounded-lg text-[12px] font-bold text-white"
              style={{ background: ACCENT }}
            >
              Faham
            </button>
          </div>
        </div>
      )}
    </Portal>
  );
}
