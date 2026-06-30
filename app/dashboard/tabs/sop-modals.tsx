"use client";

// SOP (panduan langkah-demi-langkah) modals for the Original Video tab.
//   • SopStoryboardModal — guide: ChatGPT storyboard → Omni reference.
//   • SopUgcFrameModal    — guide: Grok + a DYNAMIC fill-in UGC prompt
//     builder (client edits product / handle / dialog / tone → copy).
// Pure UI + clipboard. No backend.

import { useEffect, useMemo, useState } from "react";
import { X, Copy, Check, ClipboardList, Clapperboard } from "lucide-react";
import Portal from "../sections/portal";

function CopyBox({ text, accent }: { text: string; accent: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: `${accent}40` }}>
      <div className="flex items-center justify-between px-2.5 py-1.5" style={{ background: `${accent}14` }}>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: accent }}>Prompt</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded"
          style={{ background: accent, color: "#1a1a1a" }}
        >
          {copied ? <><Check className="w-3 h-3" /> Disalin</> : <><Copy className="w-3 h-3" /> Salin</>}
        </button>
      </div>
      <pre className="text-[11px] whitespace-pre-wrap leading-relaxed p-2.5 text-gray-200" style={{ background: "rgba(255,255,255,0.03)" }}>{text}</pre>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 text-[10px] font-bold text-white flex items-center justify-center mt-0.5">{n}</div>
      <div className="text-[12px] text-gray-300 leading-relaxed flex-1">{children}</div>
    </div>
  );
}

function Shell({
  title, icon, accent, onClose, children,
}: { title: string; icon: React.ReactNode; accent: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-[#161616] border border-white/10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-white/10 bg-[#161616]">
            <div className="flex items-center gap-2" style={{ color: accent }}>
              {icon}
              <h2 className="text-base font-bold text-white">{title}</h2>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-gray-400"><X className="w-5 h-5" /></button>
          </div>
          <div className="p-4 space-y-3.5">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ── SOP Storyboard ───────────────────────────────────────────────────────
const STORYBOARD_PROMPT_CHATGPT = "Buatkan storyboard untuk video iklan produk ni. Format 9:16 menegak. Pecahkan kepada babak demi babak (shot), setiap babak nyatakan: durasi, jenis shot (close-up / product shot / dll), apa yang nampak, produk, dan teks/benefit. Pastikan nama produk, warna, label dan packaging TEPAT macam dalam gambar.";
const STORYBOARD_PROMPT_OMNI = "Ikut storyboard ni dengan TEPAT. Jangan ubah apa-apa — kekalkan setiap babak, produk, teks, warna, susunan dan gaya persis macam dalam storyboard. Semua percakapan dan teks mesti dalam Bahasa Melayu sepenuhnya — JANGAN guna bahasa Indonesia.";

export function SopStoryboardModal({
  open, onClose, exampleImageUrl,
}: { open: boolean; onClose: () => void; exampleImageUrl?: string }) {
  const accent = "#3b82f6";
  if (!open) return null;
  return (
    <Shell title="SOP — Storyboard (Omni)" icon={<ClipboardList className="w-5 h-5" />} accent={accent} onClose={onClose}>
      <div className="text-[11px] text-gray-400 leading-relaxed">
        Cara buat video ikut storyboard guna ChatGPT + GeminiOmni. Ikut step ni satu-satu:
      </div>
      <Step n={1}>Buka <b className="text-white">ChatGPT</b>.</Step>
      <Step n={2}>Buka satu <b className="text-white">chat baru</b>.</Step>
      <Step n={3}>Masukkan <b className="text-white">SEMUA gambar berkaitan produk</b> yang nak buat video (gambar produk, color shades, benefit, dll). Contoh susunan gambar + hasil storyboard macam di bawah 👇</Step>
      {exampleImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={exampleImageUrl} alt="Contoh storyboard" className="w-full rounded-lg border border-white/10" />
      ) : (
        <div className="rounded-lg border border-dashed border-white/15 p-3 text-[10px] text-gray-500 text-center">
          (Contoh storyboard — admin boleh letak gambar contoh di sini)
        </div>
      )}
      <Step n={4}>Taip prompt ni kat ChatGPT:</Step>
      <CopyBox text={STORYBOARD_PROMPT_CHATGPT} accent={accent} />
      <Step n={5}><b className="text-white">Semak storyboard betul-betul.</b> Perincikan tulisan, nama produk, warna & label supaya 100% tepat. Kalau tak tepat, <span className="text-red-300">video takkan jadi</span>.</Step>
      <Step n={6}>Balik PeningLab → pilih <b className="text-white">GeminiOmni</b> → mode <b className="text-white">References</b>.</Step>
      <Step n={7}>Masukkan <b className="text-white">gambar storyboard</b> tadi sebagai reference.</Step>
      <Step n={8}>Guna prompt ni (salin):</Step>
      <CopyBox text={STORYBOARD_PROMPT_OMNI} accent={accent} />
    </Shell>
  );
}

// ── SOP UGC Frame ────────────────────────────────────────────────────────
const DEFAULTS = {
  setting: "a cozy bedroom with traditional Malaysian decor",
  actor: "@FaraaMeldoria",
  productHandle: "@meldoriaprd1",
  hook: "akak-akak kena ada Gel Herba Meldoria ni dalam bilik!",
  value: "Gel ni la akak kena guna bila cik somi ajak tuu. Boleh tambah sedap. hehe",
  cta: "Tekan butang kat bawah kalau nak order!",
  tone: "santai",
};

export function SopUgcFrameModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const accent = "#f97316";
  const [setting, setSetting] = useState(DEFAULTS.setting);
  const [actor, setActor] = useState(DEFAULTS.actor);
  const [productHandle, setProductHandle] = useState(DEFAULTS.productHandle);
  const [hook, setHook] = useState(DEFAULTS.hook);
  const [value, setValue] = useState(DEFAULTS.value);
  const [cta, setCta] = useState(DEFAULTS.cta);
  const [tone, setTone] = useState(DEFAULTS.tone);

  useEffect(() => {
    if (!open) return;
    setSetting(DEFAULTS.setting); setActor(DEFAULTS.actor); setProductHandle(DEFAULTS.productHandle);
    setHook(DEFAULTS.hook); setValue(DEFAULTS.value); setCta(DEFAULTS.cta); setTone(DEFAULTS.tone);
  }, [open]);

  const prompt = useMemo(() => `Visual description:
Vertical 9:16, 8 seconds. Medium close-up shot in ${setting.trim()}. A Malay woman ${actor.trim()}, holding the ${productHandle.trim()} facing the camera. The product must retain all its original details, design, colors, labels, and packaging exactly as shown in the reference image. She smiles genuinely, subtly gestures with the product, and maintains eye contact while speaking. Natural lighting, realistic home environment.

Spoken dialog (exact script):
0–3s (Hook):
"${hook.trim()}"

3–6s (Value / Problem–Solution):
"${value.trim()}"

6–8s (CTA):
"${cta.trim()}"

Tone:
${tone.trim()}

Voice: maintain the same voice from @part1

NO subtitles or new add text overlays, NO on-screen dialogue text, All dialogue is AUDIO ONLY, reduce contrast, natural skintone, soft highlights, no oversharpen, low contrast, soft colors, natural tone, film look, soft light

Clean vertical video frame with no interface overlay. No social media UI, no TikTok interface, no buttons, no icons, no overlay interface elements.`, [setting, actor, productHandle, hook, value, cta, tone]);

  if (!open) return null;

  const Field = ({ label, val, set, ph, area }: { label: string; val: string; set: (v: string) => void; ph?: string; area?: boolean }) => (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{label}</div>
      {area ? (
        <textarea value={val} onChange={(e) => set(e.target.value)} rows={2} placeholder={ph}
          className="w-full text-[11px] rounded-lg px-2.5 py-1.5 outline-none resize-y" style={{ background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }} />
      ) : (
        <input value={val} onChange={(e) => set(e.target.value)} placeholder={ph}
          className="w-full text-[11px] rounded-lg px-2.5 py-1.5 outline-none" style={{ background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }} />
      )}
    </div>
  );

  return (
    <Shell title="SOP — UGC Frame (Grok)" icon={<Clapperboard className="w-5 h-5" />} accent={accent} onClose={onClose}>
      <div className="text-[11px] text-gray-400 leading-relaxed">
        Buat video UGC bercakap dari gambar (start frame). Sebab gambar UGC awak dah dijana ikut kriteria sendiri, isi je ruang bawah ni — prompt siap auto.
      </div>
      <Step n={1}>Pilih provider <b className="text-white">Grok 1.5</b>.</Step>
      <Step n={2}>Mode <b className="text-white">Start frame</b> → upload gambar UGC awak.</Step>
      <Step n={3}>Isi butiran bawah, lepas tu <b className="text-white">salin</b> prompt yang dijana:</Step>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Latar / Setting" val={setting} set={setSetting} />
        <Field label="Tone" val={tone} set={setTone} ph="santai / serius / ceria" />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Handle Pelakon" val={actor} set={setActor} ph="@namapelakon" />
        <Field label="Handle Produk" val={productHandle} set={setProductHandle} ph="@namaproduk" />
      </div>
      <Field label="Hook (0–3s)" val={hook} set={setHook} area />
      <Field label="Value (3–6s)" val={value} set={setValue} area />
      <Field label="CTA (6–8s)" val={cta} set={setCta} area />

      <div className="text-[10px] text-gray-400 leading-relaxed bg-white/5 rounded-lg px-2.5 py-2 border border-white/10">
        👇 Ini <b className="text-white">contoh penuh</b> (dah diisi dengan contoh produk Meldoria) supaya awak nampak macam mana prompt sebenar. Tukar je ruang atas → prompt ni update sendiri. Lepas tu tekan <b style={{ color: accent }}>Salin</b>.
      </div>
      <CopyBox text={prompt} accent={accent} />
    </Shell>
  );
}
