import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import {
  getBananaProRate,
  getGptImageRate,
  getVeoRate,
  getGrokRate,
  getSeedanceRate,
  getGeminiRate,
  getSetting,
} from "@/lib/settings";

// GET /api/mcp/models — list every generation model the admin has
// configured a rate for. Includes per-model rate + unit so callers
// can compute cost ahead of generate.
//
// Read-only and cheap (cached settings).

export const dynamic = "force-dynamic";

type ModelEntry = {
  name: string;
  type: "image" | "video";
  rate: number;
  unit: "per_image" | "per_second" | "per_video_8s" | "per_video_10s";
};

export async function GET(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [bananaPro, gptImage, veo, grok, seedance, gemini, sora2] = await Promise.all([
    getBananaProRate(),
    getGptImageRate(),
    getVeoRate("8"),
    getGrokRate(),
    getSeedanceRate(),
    getGeminiRate("10"),
    (async () => {
      const cfg = await getSetting<{ rate: number }>("sora2_rate");
      return typeof cfg?.rate === "number" ? cfg.rate : (await getGrokRate()) * 2;
    })(),
  ]);

  const models: ModelEntry[] = [
    { name: "nano-banana-pro", type: "image", rate: bananaPro, unit: "per_image" },
    { name: "gpt-image-2",     type: "image", rate: gptImage,  unit: "per_image" },
    { name: "veo",             type: "video", rate: veo,       unit: "per_video_8s" },
    { name: "grok",            type: "video", rate: grok,      unit: "per_second" },
    { name: "sora2",           type: "video", rate: sora2,     unit: "per_second" },
    { name: "gemini",          type: "video", rate: gemini,    unit: "per_video_10s" },
    { name: "seedance",        type: "video", rate: seedance,  unit: "per_second" },
  ];

  return NextResponse.json({ ok: true, models });
}
