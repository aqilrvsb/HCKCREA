"use client";

// UGC Studio — a click-driven UGC product-image builder. Opens as a modal
// from the Images tab (does NOT alter the existing image generator). The
// user picks options (no prompt-writing) + attaches a product photo; we
// assemble a structured prompt and fire the SAME /api/generate/image
// pipeline (nano-banana-pro + product reference). Tuned for Malaysian
// TikTok sellers — including a Tutup Aurat (modest) priority toggle.

import { useMemo, useState } from "react";
import { Loader2, X, Sparkles, ImagePlus } from "lucide-react";
import Portal from "../sections/portal";
import AttachmentPicker from "../sections/attachment-picker";

type Opt = { val: string; label: string };

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
// Bentuk muka — the 6 standard portrait face shapes.
const FACE: Opt[] = [
  { val: "oval", label: "Oval" },
  { val: "round", label: "Bulat" },
  { val: "square", label: "Sembung (square)" },
  { val: "heart", label: "Hati" },
  { val: "oblong", label: "Panjang" },
  { val: "diamond", label: "Diamond" },
];
// Tona kulit — Malaysian-relevant range (cerah → sawo matang → gelap).
const SKIN: Opt[] = [
  { val: "fair", label: "Cerah" },
  { val: "tan", label: "Sawo matang" },
  { val: "deep", label: "Gelap manis" },
];
// PRIORITY — modesty. "Modest" = aurat covered + loose clothing.
const MODESTY: Opt[] = [
  { val: "modest", label: "🧕 Tutup Aurat (longgar)" },
  { val: "stylish", label: "✨ Stylish / Biasa" },
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
};
const LIGHT_EN: Record<string, string> = {
  ringlight: "soft ring-light", daylight: "natural daylight", golden: "warm golden-hour light",
  studio: "professional studio softbox light", airy: "bright airy soft light", moody: "moody low-key light",
};

function pill(active: boolean, accent: string): React.CSSProperties {
  return active
    ? { background: accent, color: "#fff", border: `1px solid ${accent}`, boxShadow: `0 2px 8px ${accent}55` }
    : { background: "rgba(255,255,255,0.04)", color: "#cbd5e1", border: "1px solid rgba(255,255,255,0.12)" };
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
  const [skin, setSkin] = useState("tan");
  const [hijab, setHijab] = useState(true);
  const [modesty, setModesty] = useState("modest"); // PRIORITY default = Tutup Aurat
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFemale = gender === "female";

  const prompt = useMemo(() => {
    const person = `a ${ETHNIC_EN[ethnic]} ${AGE_EN[age]} ${isFemale ? "woman" : "man"} with authentic Malaysian Southeast-Asian features, ${FACE_EN[face]}, ${SKIN_EN[skin]}`;
    const hijabClause = isFemale && hijab ? ", wearing a neat hijab/tudung that fully covers the hair" : "";
    const modestyClause =
      modesty === "modest"
        ? ", dressed modestly in loose, non-form-fitting clothing that fully covers the aurat (arms, legs and body covered), nothing tight or revealing"
        : ", in a stylish trendy outfit";
    const authClause =
      auth === "ugc"
        ? "Shot on a smartphone, authentic user-generated-content look with natural realistic imperfections"
        : "Clean professional commercial product photography, studio quality";
    return [
      `UGC-style product photo. ${person}${hijabClause}, with a ${EXPR_EN[expression]}, wearing ${OUTFIT_EN[outfit]}${modestyClause}.`,
      `${SHOT_EN[shot]}, ${ANGLE_EN[angle]}.`,
      `The person is ${POSE_EN[pose]}.`,
      `The product is ${PRODPOS_EN[prodpos]}, with its label/packaging clearly facing the camera, sharp and legible, matching the attached reference product image EXACTLY (same label, typography, colour, shape).`,
      `Scene: ${BG_EN[bg]} with ${LIGHT_EN[light]}.`,
      `${authClause}. Photorealistic, natural skin texture, ${orient} vertical composition, no text overlay, no watermark, no logo.`,
    ].join(" ");
  }, [ethnic, age, isFemale, face, skin, hijab, modesty, expression, outfit, shot, angle, pose, prodpos, bg, light, auth, orient]);

  async function generate() {
    if (!product) {
      setError("Sila pilih gambar produk dahulu.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "nano-banana-pro",
          prompt,
          reference_url: product,
          reference_urls: [product],
          aspect_ratio: orient,
          project_id: projectId,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        setError(d?.error || `Gagal (HTTP ${r.status})`);
        setBusy(false);
        return;
      }
      window.dispatchEvent(new CustomEvent("history:refresh"));
      setBusy(false);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Network error");
      setBusy(false);
    }
  }

  if (!open) return null;

  const Group = ({ label, opts, value, onChange }: { label: string; opts: Opt[]; value: string; onChange: (v: string) => void }) => (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {opts.map((o) => (
          <button
            key={o.val}
            type="button"
            onClick={() => onChange(o.val)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition"
            style={pill(value === o.val, ACCENT)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

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
                <p className="text-[10px] text-gray-500">Pilih je — tak payah tulis prompt. Lampirkan produk, generate UGC.</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Product attachment */}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Gambar Produk *</div>
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

            {/* PRIORITY — modesty */}
            <Group label="Tutup Aurat?" opts={MODESTY} value={modesty} onChange={setModesty} />

            <div className="grid grid-cols-2 gap-4">
              <Group label="Jantina" opts={GENDER} value={gender} onChange={setGender} />
              <Group label="Umur" opts={AGE} value={age} onChange={setAge} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Group label="Bangsa" opts={ETHNIC} value={ethnic} onChange={setEthnic} />
              {isFemale ? (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Hijab</div>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setHijab(true)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition" style={pill(hijab, ACCENT)}>🧕 Ada</button>
                    <button type="button" onClick={() => setHijab(false)} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition" style={pill(!hijab, ACCENT)}>Tiada</button>
                  </div>
                </div>
              ) : (
                <div />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Group label="Bentuk Muka" opts={FACE} value={face} onChange={setFace} />
              <Group label="Tona Kulit" opts={SKIN} value={skin} onChange={setSkin} />
            </div>
            <Group label="Ekspresi" opts={EXPRESSION} value={expression} onChange={setExpression} />
            <Group label="Pakaian" opts={OUTFIT} value={outfit} onChange={setOutfit} />
            <div className="grid grid-cols-2 gap-4">
              <Group label="Jenis Shot" opts={SHOT} value={shot} onChange={setShot} />
              <Group label="Angle Kamera" opts={ANGLE} value={angle} onChange={setAngle} />
            </div>
            <Group label="Pose / Aksi" opts={POSE} value={pose} onChange={setPose} />
            <Group label="Kedudukan Produk" opts={PRODPOS} value={prodpos} onChange={setProdpos} />
            <Group label="Latar Belakang" opts={BG} value={bg} onChange={setBg} />
            <Group label="Pencahayaan" opts={LIGHT} value={light} onChange={setLight} />
            <div className="grid grid-cols-2 gap-4">
              <Group label="Gaya" opts={AUTH} value={auth} onChange={setAuth} />
              <Group label="Orientasi" opts={ORIENT} value={orient} onChange={setOrient} />
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
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Menjana…</> : <><Sparkles className="w-4 h-4" /> Generate UGC</>}
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
    </Portal>
  );
}
