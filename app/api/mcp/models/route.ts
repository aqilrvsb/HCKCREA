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

// GET /api/mcp/models — list every generation model with its rate +
// machine-readable constraints (duration, image_urls limits, supported
// modes/aspect-ratios/resolutions). AI agents should call this FIRST
// and validate generate_* inputs against the constraints object.

export const dynamic = "force-dynamic";

type DurationRule =
  | { fixed: number }
  | { enum: number[] }
  | { min: number; max: number; default: number };

type ModelConstraints = {
  duration?: DurationRule;
  image_urls?: { max: number };
  image_modes?: ("text" | "frame" | "ingredient")[];
  aspect_ratios?: string[];
  resolutions?: string[];
};

type ModelEntry = {
  name: string;
  type: "image" | "video";
  rate: number;
  unit: "per_image" | "per_second" | "per_video_8s" | "per_video_10s";
  constraints: ModelConstraints;
};

const IMAGE_ASPECTS = ["1:1", "9:16", "16:9", "2:3", "3:2"];
const VIDEO_ASPECTS = ["9:16", "16:9", "1:1"];
const VIDEO_MODES: ("text" | "frame" | "ingredient")[] = ["text", "frame", "ingredient"];

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
    {
      name: "nano-banana-pro", type: "image", rate: bananaPro, unit: "per_image",
      constraints: {
        image_urls: { max: 4 },
        aspect_ratios: IMAGE_ASPECTS,
      },
    },
    {
      name: "gpt-image-2", type: "image", rate: gptImage, unit: "per_image",
      constraints: {
        image_urls: { max: 4 },
        aspect_ratios: IMAGE_ASPECTS,
      },
    },
    {
      name: "veo", type: "video", rate: veo, unit: "per_video_8s",
      constraints: {
        duration: { fixed: 8 },
        image_urls: { max: 3 },
        image_modes: VIDEO_MODES,
        aspect_ratios: VIDEO_ASPECTS,
        resolutions: ["720p"],
      },
    },
    {
      name: "grok", type: "video", rate: grok, unit: "per_second",
      constraints: {
        duration: { min: 6, max: 30, default: 6 },
        image_urls: { max: 3 },
        image_modes: ["text", "frame"],
        aspect_ratios: VIDEO_ASPECTS,
        resolutions: ["720p", "480p"],
      },
    },
    {
      name: "sora2", type: "video", rate: sora2, unit: "per_second",
      constraints: {
        duration: { enum: [8, 12] },
        image_urls: { max: 1 },
        image_modes: ["text", "frame"],
        aspect_ratios: VIDEO_ASPECTS,
        resolutions: ["720p", "480p"],
      },
    },
    {
      name: "gemini", type: "video", rate: gemini, unit: "per_video_10s",
      constraints: {
        // APIPod splits Gemini Omni into i2v + t2v variants. Both fixed
        // at 10s / 720p, aspect enum locked to 16:9 | 9:16, image_urls
        // optional (presence chooses i2v vs t2v).
        duration: { fixed: 10 },
        image_urls: { max: 3 },
        image_modes: ["text", "ingredient"],
        aspect_ratios: ["16:9", "9:16"],
        resolutions: ["720p"],
      },
    },
    {
      name: "seedance", type: "video", rate: seedance, unit: "per_second",
      constraints: {
        duration: { min: 4, max: 15, default: 5 },
        image_urls: { max: 5 },
        image_modes: VIDEO_MODES,
        aspect_ratios: VIDEO_ASPECTS,
        resolutions: ["720p", "480p"],
      },
    },
  ];

  return NextResponse.json({ ok: true, models });
}
