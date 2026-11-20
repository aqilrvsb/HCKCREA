"use client";

// Dialog word-count planner ("Cadangan saya") — recommended dialog length by
// clip duration + speaking pace; each cell inserts a ready example of that
// length (pain → solution → CTA). Shared by Dialog UGC and Original Video.
// `tone` picks colours for a light card (Dialog UGC) or the dark theme
// (Original Video).

// Example dialog library — clickable from the word-count planner table.
// Each duration × pace (santai / normal / seller) inserts a ready example
// so the client sees the right LENGTH + hook structure (pain → solution →
// CTA). Client edits the content to their own product after inserting.
export type DialogPace = "santai" | "normal" | "seller";
// Word counts calibrated to fall INSIDE each cell's range in the planner
// table (e.g. 8s Santai = 16-18 → 17 words; 15s Seller = 35-40 → 37 words).
export const DIALOG_EXAMPLES: Record<string, Record<DialogPace, string>> = {
  "8s": {
    // 17 words (16-18)
    santai: "Penat sangat sekarang?\nCuba Beauty sebelum tidur malam ni.\nBangun esok rasa lebih segar.\nTekan butang bawah.",
    // 19 words (18-20)
    normal: "Tidur cukup tapi masih rasa letih?\nBeauty bantu support hormon waktu tidur.\nTekan butang kuning di bawah sekarang juga.",
    // 23 words (20-24)
    seller: "Suami makin kurang mesra kebelakangan ni?\nHormon yang makin drop boleh jadi puncanya.\nRamai dah mula ambil Beauty sebelum tidur.\nTekan butang bawah.",
  },
  "9s": {
    // 19 words (18-20)
    santai: "Bangun pagi masih rasa lesu?\nBeauty bantu support badan waktu tidur malam.\nBangun esok rasa lebih ringan.\nCuba sekarang.",
    // 21 words (20-22)
    normal: "Masih letih walaupun dah tidur awal?\nHormon mungkin dah tak seimbang.\nBeauty bantu support badan sepanjang waktu tidur.\nTekan butang bawah.",
    // 24 words (22-26)
    seller: "Suami dah makin kurang tegur kebelakangan ni?\nHormon yang makin drop boleh jadi puncanya.\nCuba Beauty malam ni sebelum tidur.\nTekan butang bawah sekarang.",
  },
  "10s": {
    // 21 words (20-22)
    santai: "Setiap pagi badan rasa berat?\nBeauty bantu support badan sepanjang waktu tidur.\nBangun esok rasa lebih segar dan ringan.\nTekan bawah.",
    // 23 words (22-24)
    normal: "Penat walaupun rehat dah cukup?\nHormon tak sempat repair masa tidur.\nBeauty bantu support badan sepanjang malam.\nCuba ambil Beauty malam ni sekarang.",
    // 26 words (24-28)
    seller: "Suami makin kurang perhatian kebelakangan ni?\nBila hormon drop, tenaga dan mood pun hilang.\nBeauty bantu support hormon waktu tidur.\nTekan butang kuning di bawah sekarang.",
  },
  "11s": {
    // 23 words (22-24)
    santai: "Badan cepat rasa penat sekarang?\nBeauty bantu support hormon sepanjang waktu tidur.\nBangun esok rasa lebih segar setiap pagi.\nTekan butang kuning bawah.",
    // 25 words (24-26)
    normal: "Asyik bangun letih walaupun dah tidur lama?\nHormon mungkin dah tak balance lagi.\nBeauty bantu support badan sepanjang waktu tidur.\nCuba ambil malam ni sekarang.",
    // 28 words (26-30)
    seller: "Suami makin jauh sejak kebelakangan ni?\nJangan salahkan diri sendiri dulu.\nHormon yang makin drop selalu jadi punca.\nBeauty bantu support waktu tidur.\nTekan butang kuning bawah sekarang.",
  },
  "12s": {
    // 25 words (24-26)
    santai: "Bangun pagi masih rasa tak bertenaga?\nBeauty bantu support hormon sepanjang malam.\nBadan rasa lebih ringan dan segar setiap pagi.\nTekan butang bawah sekarang juga.",
    // 27 words (26-28)
    normal: "Selalu rasa penat walaupun dah tidur cukup?\nBila hormon tak balance, badan susah nak recharge.\nBeauty bantu support badan sepanjang waktu tidur.\nCuba malam ni sekarang juga.",
    // 30 words (28-32)
    seller: "Suami makin kurang mesra kebelakangan ni?\nHormon yang makin drop boleh jejaskan tenaga dan mood.\nBeauty bantu support hormon sepanjang waktu tidur.\nBangun esok lebih segar.\nTekan butang kuning bawah.",
  },
  "13s": {
    // 27 words (26-28)
    santai: "Dulu bangun terus rasa bertenaga.\nSekarang badan cepat rasa letih dan lesu.\nBeauty bantu support hormon sepanjang waktu tidur.\nBangun esok lebih segar.\nTekan butang kuning bawah.",
    // 28 words (28-30)
    normal: "Pernah tertanya kenapa badan cepat rasa letih?\nHormon makin berubah bila umur dah meningkat.\nBeauty bantu support hormon dan badan sepanjang waktu tidur.\nCuba malam ni sekarang juga.",
    // 32 words (30-34)
    seller: "Suami dah makin kurang beri perhatian kebelakangan ni?\nHormon yang makin drop boleh kurangkan tenaga dan mood awak.\nBeauty bantu support hormon sepanjang waktu tidur.\nTekan butang kuning di bawah sekarang juga.",
  },
  "14s": {
    // 29 words (28-30)
    santai: "Setiap pagi rasa macam tak cukup rehat lagi?\nBeauty bantu support hormon sepanjang waktu tidur.\nBangun esok rasa lebih ringan dan bertenaga setiap hari.\nTekan butang bawah sekarang juga.",
    // 31 words (30-32)
    normal: "Penat walaupun dah tidur lama setiap malam?\nBila hormon tak seimbang, badan jadi susah nak pulih.\nBeauty bantu support hormon sepanjang malam waktu tidur.\nCuba ambil Beauty malam ni sekarang juga.",
    // 32 words (32-36)
    seller: "Suami dah mula makin kurang mesra kebelakangan ni?\nJangan tunggu sampai hubungan jadi makin renggang.\nBeauty bantu support hormon waktu tidur supaya badan kembali bertenaga.\nTekan butang kuning di bawah sekarang juga.",
  },
  "15s": {
    // 30 words (30-32)
    santai: "Bangun pagi masih rasa lesu dan tak bermaya?\nBeauty bantu support hormon sepanjang waktu tidur malam.\nBangun esok dengan tenaga yang lebih baik setiap hari.\nCuba ambil Beauty sekarang juga.",
    // 33 words (32-35)
    normal: "Tidur cukup tapi badan tetap rasa penat setiap hari?\nBila hormon tak balance, badan jadi sukar nak recharge.\nBeauty bantu support hormon sepanjang malam waktu tidur.\nTekan butang kuning di bawah hari ni.",
    // 37 words (35-40)
    seller: "Suami dah makin kurang mesra sejak akhir-akhir ni?\nJangan tunggu sampai hubungan jadi makin jauh dan renggang.\nBeauty bantu support hormon sepanjang tidur supaya bangun lebih bertenaga dan yakin semula.\nTekan butang kuning di bawah sekarang juga.",
  },
};

const ROWS: string[][] = [
  ["8s", "16-18", "18-20", "20-24"],
  ["9s", "18-20", "20-22", "22-26"],
  ["10s", "20-22", "22-24", "24-28"],
  ["11s", "22-24", "24-26", "26-30"],
  ["12s", "24-26", "26-28", "28-32"],
  ["13s", "26-28", "28-30", "30-34"],
  ["14s", "28-30", "30-32", "32-36"],
  ["15s", "30-32", "32-35", "35-40"],
];
const PACES: DialogPace[] = ["santai", "normal", "seller"];

export default function DialogWordGuide({
  onPick,
  tone = "light",
}: {
  onPick: (example: string) => void;
  tone?: "light" | "dark";
}) {
  const c =
    tone === "dark"
      ? { title: "#fbbf24", hint: "var(--color-text-muted)", headBg: "rgba(251,191,36,0.10)", head: "#fbbf24", border: "rgba(251,191,36,0.25)", first: "var(--color-text-primary)", cell: "#fcd34d", hover: "hover:bg-amber-400/15" }
      : { title: "#ea580c", hint: "#6b7280", headBg: "#fff7ed", head: "#9a3412", border: "#f0e6da", first: "#1a1a1a", cell: "#9a3412", hover: "hover:bg-orange-100" };
  const line = "1px solid " + c.border;
  return (
    <div className="mb-3">
      <div className="text-[11px] font-extrabold mb-1.5" style={{ color: c.title }}>
        Cadangan saya:{" "}
        <span className="font-normal" style={{ color: c.hint }}>👇 klik mana-mana kotak untuk masukkan contoh dialog (ikut durasi + gaya)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr style={{ background: c.headBg }}>
              {["Durasi", "Santai", "Normal", "Seller / TikTok"].map((h) => (
                <th key={h} className="px-2 py-1 font-extrabold" style={{ color: c.head, border: line }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r[0]}>
                {r.map((cell, i) => {
                  if (i === 0) {
                    return (
                      <td key={i} className="px-2 py-1 font-bold" style={{ color: c.first, border: line }}>
                        {cell}
                      </td>
                    );
                  }
                  const example = DIALOG_EXAMPLES[r[0]]?.[PACES[i - 1]] || "";
                  return (
                    <td key={i} className="p-0" style={{ border: line }}>
                      <button
                        type="button"
                        onClick={() => example && onPick(example)}
                        title="Klik untuk masukkan contoh dialog ikut durasi + gaya ni"
                        className={"w-full h-full px-2 py-1 text-center transition-colors cursor-pointer " + c.hover}
                        style={{ color: c.cell, fontWeight: 600 }}
                      >
                        {cell}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
