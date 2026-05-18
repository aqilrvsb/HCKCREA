import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getP2Config, getSetting } from "@/lib/settings";
import { generateImageWithCascade } from "@/lib/image-cascade";

// POST /api/generate/fairytale/regenerate-hero
//
// Re-fires hero character image generation without re-running the LLM
// script step. Frontend hits this when the user clicks "Regenerate
// Character" on the storyboard. The original main_character_description
// + visual_style are passed back so the LLM-decided character traits
// stay consistent — only the rendering changes.
//
// Returns: { ok: true, hero_history_id: "..." } — frontend polls
// /api/history to detect status='done' + output_url filled, then swaps
// the hero image in the storyboard and updates the URL passed to
// subsequent scene-image fetches.

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const VISUAL_HINTS: Record<string, string> = {
  realistic:
    "Shot on ARRI Alexa with 40mm anamorphic lens at f/1.8, oval bokeh, subtle horizontal lens flare. Color graded with teal shadows and warm-orange highlights, lifted blacks. Hard side key light, soft bounce fill, crisp atmosphere.",
  "3d":
    "3D animated feature-film render in the warmth of a Pixar / DreamWorks production. Subsurface-scattering skin, large expressive eyes, plush fabric folds, hand-painted PBR textures. Three-point softbox lighting with warm rim light.",
  anime:
    "Hand-painted anime background in the feel of a Studio Ghibli (Hayao Miyazaki) film. Watercolor wash on textured paper, gouache cloud rendering, gentle cel-shaded characters, soft natural light, muted pastel palette.",
  fantasy:
    "Epic fantasy matte painting, oil-on-canvas brushwork, low-angle hero shot. Volumetric god-rays, painterly chiaroscuro, ember particles drifting through air. Desaturated palette with a single accent color.",
  watercolor:
    "Traditional watercolor illustration on cold-press paper. Visible paper grain, wet-on-wet bleeding edges, soft pigment pooling, white paper used as negative space. Limited 4-color palette.",
  noir:
    "Black-and-white film noir still, hard venetian-blind shadow patterns. Single tungsten key light from low angle, deep silver highlights, 1940s Kodak Tri-X grain.",
  vintage:
    "1970s Kodak Portra 400 film still, warm magenta cast, soft halation around highlights, fine organic grain, slightly faded blacks. 50mm prime lens at f/2.",
  minimalist:
    "High-fashion editorial photograph, Vogue / NYT Sunday Magazine composition. Beauty-dish key light with subtle clamshell fill, large negative space, neutral palette of cream / charcoal / dove-grey.",
};

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const mainCharacter = String(body?.main_character || "").trim().slice(0, 800);
  const visualStyleRaw = String(body?.visual_style || "realistic").toLowerCase();
  const visualStyle = visualStyleRaw in VISUAL_HINTS ? visualStyleRaw : "realistic";

  if (!mainCharacter) {
    return NextResponse.json(
      { error: "main_character required" },
      { status: 400 }
    );
  }

  const cfg = await getP2Config();
  const ftModelSetting = await getSetting<{ model: string }>("fairytale_image_model");
  const adminModel = ftModelSetting?.model || cfg.imageDefault || "nano-banana-pro";
  const modelKey = adminModel.toLowerCase().includes("nano-banana")
    ? adminModel
    : "nano-banana-pro";
  const primaryModelP2 =
    (cfg.imageModels as any)?.[modelKey] || `google/${modelKey}`;

  const heroPrompt =
    `${mainCharacter}\n\nClean reference portrait, neutral pose, plain backdrop, full body or 3/4 shot, sharp focus on character features, no other subjects in frame.\n\n${VISUAL_HINTS[visualStyle]}`;

  const heroCascade = await generateImageWithCascade({
    primaryProvider: "p4",
    primaryModel: modelKey,
    primaryModelP2,
    prompt: heroPrompt,
    aspectRatio: "9:16",
    fullCascade: true,
  });

  if (!heroCascade.ok || !heroCascade.taskId) {
    return NextResponse.json(
      { error: heroCascade.ok ? "no task_id returned" : heroCascade.error },
      { status: 502 }
    );
  }

  const admin = createAdminClient();
  const { data: heroHist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: session.user.id,
      type: "fairytale-hero",
      tab: "fairytale",
      status: "pending",
      prompt: heroPrompt,
      task_id: heroCascade.taskId,
      cost: 0,
      metadata: {
        provider: heroCascade.actualProvider,
        slot: heroCascade.actualSlot,
        model: heroCascade.actualModel,
        aspectRatio: "9:16",
        main_character: mainCharacter,
        visual_style: visualStyle,
        fallback_used: heroCascade.fallbackUsed,
        tier_log: heroCascade.tierLog,
        upload_status: "done",
        regenerated: true,
      },
    })
    .select("id")
    .single();

  if (insErr || !heroHist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    hero_history_id: heroHist.id,
  });
}
