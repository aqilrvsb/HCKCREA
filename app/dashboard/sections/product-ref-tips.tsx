"use client";

import { useState } from "react";
import { Lightbulb, X, CheckCircle2 } from "lucide-react";
import Portal from "./portal";

// Reusable "TEKAN SINI BACA RULE" pill + tips modal. Shows in the
// Product Reference section on UGC tab + Auto Content tab so clients
// know HOW to attach product images for best results.
//
// Tips are hardcoded (not admin-editable) — they're operational
// guidance, not marketing copy. Edit this file when tips evolve.

type Tip = {
  question: string;
  answer: string;
  example?: string;
};

const TIPS: Tip[] = [
  {
    question: "Nak sizing botol sebenar?",
    answer:
      "Upload gambar TANGAN PEGANG PRODUK (tanpa muka). AI akan baca proporsi tangan vs produk → output video saiz produk akan tepat dengan saiz sebenar dalam tangan.",
    example: "Contoh: tangan pegang botol 100ml, AI tau botol tu kira-kira 12-15cm tinggi.",
  },
  {
    question: "Nak gambar produk sebijik sama (label, warna, packaging persis sama)?",
    answer:
      "Upload gambar NAKED PRODUK — crop gambar product je (tiada tangan, tiada background tambahan). Upload 2 variasi (front + 3/4 angle) supaya AI faham bentuk 3D produk.",
    example: "Contoh: 1 gambar front view bersih + 1 gambar 3/4 angle. AI gabung jadi reference 3D.",
  },
  {
    question: "Berapa banyak gambar produk patut upload?",
    answer:
      "1 gambar = pantas tapi mungkin angle terhad. 2-3 gambar = AI nampak produk dari beberapa angle → output lagi consistent. Maksimum 3 ref (atau 2 kalau ada avatar reference juga).",
  },
  {
    question: "Gambar dari supplier ada watermark / text — boleh tak?",
    answer:
      "Avoid kalau boleh. AI akan TIRU watermark/text tu dalam video output. Better: crop watermark out, atau ambil gambar sendiri tanpa watermark.",
  },
  {
    question: "Latar belakang gambar produk patut macam mana?",
    answer:
      "Latar putih / neutral / minimal = TERBAIK. Latar berserabut (banyak object lain) = AI confuse, kadang-kadang background bocor masuk video.",
  },
  {
    question: "Boleh upload screenshot dari Shopee / TikTok Shop?",
    answer:
      "Boleh, tapi pastikan TIDAK ADA harga/diskaun overlay (\"50% OFF\", \"RM 19.90\" etc.) — AI akan render text tu dalam video. Crop sebelum upload.",
  },
];

export default function ProductRefTips() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all hover:scale-105 cursor-pointer"
        style={{
          background:
            "linear-gradient(90deg, rgba(250,204,21,0.18), rgba(244,114,182,0.18))",
          border: "1px solid rgba(250,204,21,0.5)",
          color: "#b45309",
          boxShadow: "0 2px 6px rgba(250,204,21,0.2)",
        }}
        title="Baca tips untuk upload gambar produk dengan betul"
      >
        <Lightbulb className="w-3 h-3" />
        💡 TEKAN SINI BACA RULE
      </button>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl"
              style={{
                background: "white",
                boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className="px-6 py-4 flex items-center justify-between sticky top-0 z-10"
                style={{
                  background:
                    "linear-gradient(90deg, #facc15, #f59e0b, #ec4899)",
                  color: "white",
                }}
              >
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-5 h-5" />
                  <div>
                    <div className="font-extrabold text-base">
                      Rules untuk Upload Gambar Produk
                    </div>
                    <div className="text-[11px] opacity-90">
                      Ikut tips ni supaya output video / image sebijik macam
                      gambar produk asal
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="w-9 h-9 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Tips list */}
              <div className="p-6 space-y-4">
                {TIPS.map((tip, i) => (
                  <div
                    key={i}
                    className="rounded-xl p-4"
                    style={{
                      background: "#fafaf7",
                      border: "1px solid #f0ead8",
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white font-bold text-xs"
                        style={{
                          background:
                            "linear-gradient(135deg, #facc15, #f59e0b)",
                        }}
                      >
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-gray-900 mb-1.5">
                          {tip.question}
                        </div>
                        <div className="flex items-start gap-2 mb-1">
                          <CheckCircle2
                            className="w-4 h-4 mt-0.5 flex-shrink-0"
                            style={{ color: "#16a34a" }}
                          />
                          <div className="text-xs text-gray-700 leading-relaxed">
                            {tip.answer}
                          </div>
                        </div>
                        {tip.example && (
                          <div
                            className="text-[11px] italic mt-1.5 pl-6"
                            style={{ color: "#9ca3af" }}
                          >
                            {tip.example}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div
                className="px-6 py-3 border-t flex justify-end"
                style={{ borderColor: "#e5e7eb", background: "#fafaf7" }}
              >
                <button
                  onClick={() => setOpen(false)}
                  className="px-5 py-2 rounded-xl font-bold text-xs text-white transition-transform hover:scale-105"
                  style={{
                    background:
                      "linear-gradient(135deg, #facc15, #f59e0b, #ec4899)",
                  }}
                >
                  Faham, Tutup
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
