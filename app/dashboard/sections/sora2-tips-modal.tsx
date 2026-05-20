"use client";

import { Info, X } from "lucide-react";

// Sora 2 tips modal — knowledge distilled from OpenAI's official Sora 2
// prompting guide (March 2026 release). Same content lives in
// lib/qa-knowledge.ts SORA2_KNOWLEDGE for the Q&A chat, surfaced here
// so users hit it BEFORE they write a broken prompt rather than after.
//
// Used by:
//   - app/dashboard/tabs/sora2.tsx (standalone Sora 2 tab)
//   - app/dashboard/tabs/video.tsx (UGC tab when provider=sora2)
//
// Theme constants are inlined (not imported) so the component is
// portable across tabs that use different accent palettes.
const PURPLE = "#4ade80"; // light green (Sora 2 brand accent)
const PURPLE_SOFT = "rgba(74, 222, 128, 0.25)";
const PURPLE_FAINT = "rgba(74, 222, 128, 0.08)";

export default function Sora2TipsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-bg-card)] rounded-2xl border max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        style={{ borderColor: PURPLE_SOFT }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sticky top-0 px-6 py-4 flex items-center justify-between border-b"
          style={{
            borderColor: PURPLE_SOFT,
            background: `linear-gradient(135deg, ${PURPLE_FAINT}, transparent)`,
          }}
        >
          <div className="flex items-center gap-2">
            <Info className="w-5 h-5" style={{ color: PURPLE }} strokeWidth={2.4} />
            <h3 className="font-display font-extrabold text-lg text-[var(--color-text-primary)]">
              Sora 2 Tips
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-[var(--color-text-muted)]" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 text-sm text-[var(--color-text-secondary)]">
          {/* DIALOG FORMAT — the #1 thing that catches users out */}
          <section>
            <h4
              className="font-display font-bold text-base mb-2 flex items-center gap-2"
              style={{ color: PURPLE }}
            >
              🎙️ Kalau nak character bercakap (Dialog format)
            </h4>
            <p className="mb-2">
              Sora 2 <strong>tak terima</strong> format Veo (
              <code>Spoken dialog: &apos;...&apos;</code>). Kalau guna format Veo,
              video akan jadi <strong>mute</strong> (mulut bergerak tapi tiada bunyi).
              Gunakan format ni:
            </p>
            <pre
              className="text-[11px] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap"
              style={{
                background: "rgba(0,0,0,0.4)",
                border: `1px solid ${PURPLE_SOFT}`,
                color: "var(--color-text-primary)",
              }}
            >{`Dialogue:
- Woman: "Ini produk terbaik untuk hilangkan sakit saraf belakang kaki."

Background Sound:
ambient room tone, soft fabric rustle`}</pre>
            <p className="mt-2 text-xs">
              <strong>Label speaker</strong> (Woman / Man / Detective / etc) +
              <strong> quoted line</strong>. Tambah <code>Background Sound:</code>{" "}
              walaupun scene senyap — Sora 2 perlu rhythm cue, kalau tak audio
              jadi dead silence.
            </p>
          </section>

          {/* AUDIO MODERATION — the #2 thing that catches users out */}
          <section>
            <h4
              className="font-display font-bold text-base mb-2 flex items-center gap-2"
              style={{ color: "#ef4444" }}
            >
              🚨 Kenapa video aku takde audio? (Medical claim filter)
            </h4>
            <p className="mb-2">
              Sora 2 ada <strong>safety filter</strong> yang akan{" "}
              <strong>silent audio</strong> (video pass, suara hilang) kalau
              dialog mengandungi <strong>medical efficacy claims</strong>.
              Pattern dah confirmed dengan 4 video — pasti reproduce.
            </p>

            <div className="grid md:grid-cols-2 gap-3 mt-3 mb-3">
              {/* BAD column */}
              <div
                className="p-3 rounded-lg border text-xs"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  borderColor: "rgba(239,68,68,0.3)",
                }}
              >
                <div className="font-bold mb-2" style={{ color: "#ef4444" }}>
                  ❌ JANGAN guna (audio akan hilang)
                </div>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    <code>berkesan</code>, <code>menyembuhkan</code>,{" "}
                    <code>merawat</code>, <code>mengubati</code>
                  </li>
                  <li>
                    <code>melegakan saraf</code>, <code>membaiki sendi</code>,{" "}
                    <code>menguatkan otot</code>
                  </li>
                  <li>
                    <code>terhimpit</code>, <code>kronik</code>, <code>akut</code>
                  </li>
                  <li>
                    <code>seksa</code>, <code>siksa</code> + body part
                  </li>
                  <li>
                    <code>produk terbaik untuk [condition]</code>
                  </li>
                  <li>
                    <code>guna setiap hari</code> (dosage advice)
                  </li>
                  <li>
                    <code>hilangkan [pain/condition]</code>
                  </li>
                </ul>
              </div>

              {/* GOOD column */}
              <div
                className="p-3 rounded-lg border text-xs"
                style={{
                  background: PURPLE_FAINT,
                  borderColor: PURPLE_SOFT,
                }}
              >
                <div className="font-bold mb-2" style={{ color: PURPLE }}>
                  ✅ GUNA ni (audio pass)
                </div>
                <ul className="list-disc pl-4 space-y-1">
                  <li>
                    <code>Aku dulu...</code>, <code>Sebelum ni aku...</code>{" "}
                    (first-person)
                  </li>
                  <li>
                    <code>terus rasa lega / selesa / segar / lighter</code>{" "}
                    (feelings)
                  </li>
                  <li>
                    <code>boleh jalan jauh</code>, <code>boleh tidur lena</code>{" "}
                    (lifestyle outcome)
                  </li>
                  <li>
                    <code>sapu je</code>, <code>minum je</code>,{" "}
                    <code>spray je</code> (action)
                  </li>
                  <li>
                    <code>memang lain rasa dia</code> (subjective comparison)
                  </li>
                  <li>
                    <code>try sekali</code>, <code>grab sekarang</code> (soft CTA)
                  </li>
                </ul>
              </div>
            </div>

            <div className="text-xs space-y-2 mt-3">
              <div>
                <strong className="text-red-400">❌ BAD example:</strong>
                <div
                  className="font-mono text-[11px] mt-1 p-2 rounded"
                  style={{ background: "rgba(239,68,68,0.06)" }}
                >
                  &quot;Habaflex memang <strong>berkesan, melegakan saraf belakang kaki yang terhimpit</strong>.&quot;
                </div>
              </div>
              <div>
                <strong style={{ color: PURPLE }}>✅ GOOD rewrite:</strong>
                <div
                  className="font-mono text-[11px] mt-1 p-2 rounded"
                  style={{ background: PURPLE_FAINT }}
                >
                  &quot;<strong>Aku dulu sakit belakang kaki teruk, sampai tak boleh tidur.</strong> Lepas guna Habaflex sebulan, <strong>terus rasa selesa</strong>!&quot;
                </div>
              </div>
            </div>

            <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
              <strong>Rule of thumb:</strong> Cerita pengalaman peribadi
              (testimonial), bukan claim ubat. Kalau dialog macam advertorial
              FDA-style (&quot;X cures Y, take daily&quot;), Sora 2 akan silent.
              Kalau macam orang biasa berkongsi pengalaman (&quot;Aku try ni, rasa
              lain&quot;), Sora 2 akan generate audio normal.
            </p>
          </section>

          {/* IMAGE INPUT GOTCHAS */}
          <section>
            <h4 className="font-display font-bold text-base mb-2" style={{ color: PURPLE }}>
              🖼️ First-frame image (kalau attach)
            </h4>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>
                Saiz <strong>MESTI</strong> 1280×720 (16:9) atau 720×1280 (9:16). Saiz lain
                akan ditolak oleh API.
              </li>
              <li>
                <strong>Elak gambar muka orang sebenar</strong> — Sora 2 sengaja avoid
                real-identity reproduction. Selalu fail atau output pelik. Guna gambar
                AI-generated (dari tab Image) lebih baik.
              </li>
              <li>SINGLE first frame only — bukan multi-ref macam Grok / Seedance.</li>
            </ul>
          </section>

          {/* DURATION + STRUCTURE */}
          <section>
            <h4 className="font-display font-bold text-base mb-2" style={{ color: PURPLE }}>
              ⏱️ Duration + Dialog timing
            </h4>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>
                <strong>8s clip</strong> — max 1-2 short exchanges. Dialog panjang =
                audio cut mid-word.
              </li>
              <li>
                <strong>12s clip</strong> — max 3-4 short beats. Tetap kena ringkas.
              </li>
              <li>
                Sora 2 lebih reliable untuk <strong>shorter clips</strong>. Kalau nak
                cerita panjang, generate 2 × 8s clips dan stitch dalam editor.
              </li>
            </ul>
          </section>

          {/* CINEMATOGRAPHY HINTS */}
          <section>
            <h4 className="font-display font-bold text-base mb-2" style={{ color: PURPLE }}>
              🎬 Cinematography (optional tapi powerful)
            </h4>
            <p className="text-xs mb-2">
              Tambah block <code>Cinematography:</code> kalau nak control camera +
              mood. Set <strong>STYLE awal</strong> supaya carry through ke shot lain:
            </p>
            <pre
              className="text-[11px] p-3 rounded-lg overflow-x-auto whitespace-pre-wrap"
              style={{
                background: "rgba(0,0,0,0.4)",
                border: `1px solid ${PURPLE_SOFT}`,
                color: "var(--color-text-primary)",
              }}
            >{`Cinematography:
Camera shot: medium close-up, slight angle from behind
Mood: cinematic and tense

Actions:
- She unscrews the cap with slow deliberate motion.
- A drop of liquid catches the overhead light.
- She brings the bottle to her nose.`}</pre>
          </section>

          {/* MOTION RULE */}
          <section>
            <h4 className="font-display font-bold text-base mb-2" style={{ color: PURPLE }}>
              🎯 Motion rule (paling penting)
            </h4>
            <p className="text-xs">
              <strong>ONE clear camera move + ONE clear subject action per shot.</strong>
              {" "}Lebih dari satu = chaos. Pecahkan action kepada beats:{" "}
              <em>&quot;Actor takes four steps to the window, pauses, pulls the curtain in the final second&quot;</em>{" "}
              — bukan <em>&quot;Actor walks across the room&quot;</em>.
            </p>
          </section>

          {/* COMMON ISSUES */}
          <section>
            <h4 className="font-display font-bold text-base mb-2" style={{ color: PURPLE }}>
              ❌ Common issues
            </h4>
            <ul className="list-disc pl-5 space-y-1 text-xs">
              <li>
                <strong>Video mute</strong> → dialog format salah. Guna{" "}
                <code>Dialogue:</code> block (atas).
              </li>
              <li>
                <strong>Muka tak sama dengan reference</strong> → Sora 2 tak reliable
                untuk real portraits. Use AI-gen images.
              </li>
              <li>
                <strong>Audio cut mid-word</strong> → dialog terlalu panjang untuk
                durasi. Pendekkan.
              </li>
              <li>
                <strong>Camera chaos</strong> → describe more than 1 camera move. Limit
                kepada satu.
              </li>
            </ul>
          </section>

          {/* ITERATION */}
          <section>
            <h4 className="font-display font-bold text-base mb-2" style={{ color: PURPLE }}>
              🔄 Iteration
            </h4>
            <p className="text-xs">
              Same prompt run 2× = output berbeza (by design). Cuba 2-3 kali, pilih
              yang terbaik. Kalau dekat tapi tak perfect, ubah <strong>ONE thing
              at a time</strong> (&quot;same shot, switch to 85mm&quot; / &quot;same lighting, new
              palette: teal sand rust&quot;).
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
