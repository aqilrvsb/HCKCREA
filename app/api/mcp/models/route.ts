import { NextResponse } from "next/server";
import { validateMcpKey } from "@/lib/mcp-auth";
import { getBananaProRate, getGptImageRate, getGrokRate, getGeminiRate } from "@/lib/settings";

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
  unit: "per_image" | "per_second" | "per_video";
  constraints: ModelConstraints;
};

const IMAGE_ASPECTS = ["1:1", "9:16", "16:9", "2:3", "3:2"];
const VIDEO_ASPECTS = ["9:16", "16:9"];
const VIDEO_MODES: ("text" | "frame" | "ingredient")[] = ["text", "frame", "ingredient"];

export async function GET(req: Request) {
  const auth = await validateMcpKey(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const [bananaPro, gptImage, grok, gemini] = await Promise.all([
    getBananaProRate(),
    getGptImageRate(),
    getGrokRate(),
    getGeminiRate("10"),
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
      // Grsai-only; cascade pins P4 first, other slots fall back to gpt-image-2.
      name: "gpt-image-2.5", type: "image", rate: gptImage, unit: "per_image",
      constraints: {
        image_urls: { max: 4 },
        aspect_ratios: IMAGE_ASPECTS,
      },
    },
    {
      // Grsai-only (newest GPT Image); cascade pins P4 first, other slots fall back to gpt-image-2.
      name: "gpt-image-2.6", type: "image", rate: gptImage, unit: "per_image",
      constraints: {
        image_urls: { max: 4 },
        aspect_ratios: IMAGE_ASPECTS,
      },
    },
    {
      // Grsai-only (Gemini Nano Banana 2.1); cascade pins P4 first, other slots fall back to nano-banana-2.
      name: "nano-banana-2.1", type: "image", rate: bananaPro, unit: "per_image",
      constraints: {
        image_urls: { max: 4 },
        aspect_ratios: IMAGE_ASPECTS,
      },
    },
    {
      // Gemini Omni 1.2 Flash via ToAPIs (p10). Flat price per video, always
      // 15 s / 720p. frame = first (+ optional last) frame; ingredient ≤5 refs.
      name: "gemini", type: "video", rate: gemini, unit: "per_video",
      constraints: {
        duration: { fixed: 15 },
        image_urls: { max: 5 },
        image_modes: VIDEO_MODES,
        aspect_ratios: VIDEO_ASPECTS,
        resolutions: ["720p"],
      },
    },
    {
      // Grok Video 1.5 via ToAPIs (p10). Priced per second, 1–15 s, 720p.
      // frame = first frame (1 image); ingredient = reference images (≤7).
      name: "grok", type: "video", rate: grok, unit: "per_second",
      constraints: {
        duration: { min: 1, max: 15, default: 10 },
        image_urls: { max: 7 },
        image_modes: VIDEO_MODES,
        aspect_ratios: VIDEO_ASPECTS,
        resolutions: ["720p"],
      },
    },
  ];

  return NextResponse.json({ ok: true, models });
}
