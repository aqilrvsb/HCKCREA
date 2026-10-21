// Motion · Custom Style · Edit Footage Sendiri — script first, like Default.
//
// Step 1 is Default's own script step (a "motion-edit" card: cut silences, Whisper, caption spelling fix → "Semak
// skrip"). When the client approves the script ("Jana Video"), this starts the Custom Style build: Claude Code
// (Sonnet 5.5) on HyperFrames in the VGC workspace (mode "vgc-edit" of modal_vgc.py — the VGC skill + rules, the cut
// footage at ./bahan/footage.mp4 and the approved words at ./bahan/captions.json), from the client's own VGC prompt
// plus PeningLab's master director playbook. 100% Motion Ad stays one step (/api/vgc/start).
import { customDirectorPlaybook } from "@/lib/motion-director";
import { MOTION_EDIT_MAX_SEC, vgcStart, type EditInput } from "@/lib/motion";

type DraftLike = { words?: { w?: unknown; t?: unknown; e?: unknown }[]; segs?: unknown; kept?: unknown };

/** The client's Custom Style choices kept on the card between the two steps. */
export type CustomEditInput = { prompt: string; title: string; stepId: string; materials: { url: string; name: string }[] };

export async function startCustomEdit(o: { id: string; userId: string; input: EditInput; draft: DraftLike; step: string; ws: string }) {
  const c = o.input.custom;
  if (!c?.prompt) return { ok: false as const, error: "Prompt Custom Style tiada pada kad ini." };
  const words = (o.draft.words || []).map((w) => ({ w: String(w.w ?? ""), t: Number(w.t) || 0, ...(w.e === undefined ? {} : { e: Number(w.e) || 0 }) }));
  const script = words.map((w) => w.w).join(" ").replace(/\s+/g, " ").trim();
  const bahan = c.materials.length
    ? `\n\nBAHAN LAIN YANG DIBERI (sudah ada dalam ./bahan/):\n${c.materials.map((m, i) => `- ${m.name || `bahan-${i + 1}`}`).join("\n")}`
    : "";
  const prompt = `${c.prompt}

FOOTAGE (sudah disediakan oleh PeningLab): ./bahan/footage.mp4 — footage klien yang sudah dipotong senyap; suaranya 100 % suara asal
penutur (sudah dibersihkan). Masa setiap perkataan: ./bahan/captions.json. Jangan potong semula atau tambah suara AI.
SKRIP YANG KLIEN LULUSKAN (perkataan sebenar dalam footage — ejaan ini yang betul untuk caption & teks):
${script.slice(0, 6000)}${bahan}${customDirectorPlaybook("footage")}`;
  return vgcStart({
    mode: "vgc-edit",
    history_id: o.id,
    user_id: o.userId,
    ws_id: o.ws,
    prompt,
    brief: prompt,
    video_url: o.input.videoUrl,
    segs: Array.isArray(o.draft.segs) ? o.draft.segs : null,
    words,
    max_sec: MOTION_EDIT_MAX_SEC,
    materials: c.materials,
    expect_video: true,
    step: o.step,
  });
}
