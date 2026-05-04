import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { priceAndCheck } from "@/lib/deduct";
import { getStorytellingPricing } from "@/lib/settings";

// POST /api/generate/fairytale — placeholder-first, Pattern A (Vercel never waits).
//
// Flow:
//   1. Auth (cookie-local getSession, ~5ms)
//   2. Insert placeholder history row with status='pending'
//   3. Return immediately with history_id
//   4. after() fires Modal endpoint (fire-and-forget). Modal renders the
//      story (~30-60s) and writes status='done' + output_url DIRECTLY to
//      Supabase via service-role key — Vercel never sees the result.
//   5. Frontend polls /api/history every 3s OR uses Supabase Realtime
//      to flip the placeholder card to the rendered video.
//
// Cost per story: ~$0.045 (Modal $0.003 + MiniMax TTS $0.04 + storage $0.0001)

export const runtime = "nodejs";
// Modal can take 60-120s to render 10 scenes (each ~10s). Vercel after()
// must outlive the Modal fetch or the row gets marked HTTP 422 on timeout.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Scene = {
  image_url?: string;
  narration?: string;
  audio_url?: string;
  animation?: string;
  transition?: string;
};

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const projectId = body?.project_id ? String(body.project_id) : null;
  const scenesIn: Scene[] = Array.isArray(body?.scenes) ? body.scenes : [];
  const scenes = scenesIn
    .filter((s) => s && s.image_url && s.narration)
    .map((s) => ({
      image_url: String(s.image_url || ""),
      narration: String(s.narration || "").trim().slice(0, 600),
      // Optional pre-generated TTS — if present Modal downloads instead
      // of regenerating via MiniMax (saves cost + ~5s render time).
      audio_url: s.audio_url ? String(s.audio_url) : undefined,
      // Per-scene Ken Burns + transition override. Modal falls back to
      // payload-level `animation` / `transition` when these are absent.
      animation: s.animation ? String(s.animation) : undefined,
      transition: s.transition ? String(s.transition) : undefined,
    }));

  if (!scenes.length) {
    return NextResponse.json(
      { error: "At least one scene with image + narration required" },
      { status: 400 }
    );
  }
  if (scenes.length > 15) {
    return NextResponse.json(
      { error: "Maximum 15 scenes per story" },
      { status: 400 }
    );
  }

  const voiceId = String(body?.voice_id || "Malay_female_1_v1");
  const voiceSpeed = Math.max(0.5, Math.min(2.0, Number(body?.voice_speed) || 1.0));
  const animation = String(body?.animation || "zoom-in");
  const placement = String(body?.placement || "bottom");
  const fontSize = Math.max(28, Math.min(96, Number(body?.font_size) || 56));
  // Subtitle styling — all dynamic per render. Validated against safe enums
  // so a malicious client can't inject arbitrary ffmpeg expressions.
  const ALLOWED_FONTS = [
    "bold-display","sans","sans-bold","serif","mono","roboto",
    // Wizard-friendly aliases (UI shows these labels)
    "Lato","Times New Roman","Modern Sans","Classic Serif","Bold Display",
    "Grobold","Montserrat","Roboto","Carter One",
  ];
  const ALLOWED_COLORS = ["white","yellow","orange","red","pink","cyan","black"];
  const ALLOWED_BG = ["box","outline","shadow","outline+shadow","none"];
  const ALLOWED_SUB_ANIM = ["static","karaoke","fade","none","word-by-word","highlight"];
  const ALLOWED_ALIGN = ["left","center","right"];
  const ALLOWED_TRANSITIONS = ["fade","slide-left","wipe-left","circle-open","dissolve","radial"];
  const fontFamily = ALLOWED_FONTS.includes(String(body?.font_family || ""))
    ? String(body.font_family) : "bold-display";
  const fontColor = ALLOWED_COLORS.includes(String(body?.font_color || ""))
    ? String(body.font_color) : "white";
  const subtitleBg = ALLOWED_BG.includes(String(body?.subtitle_bg || ""))
    ? String(body.subtitle_bg) : "box";
  const subtitleAnimation = ALLOWED_SUB_ANIM.includes(String(body?.subtitle_animation || ""))
    ? String(body.subtitle_animation) : "static";
  const textAlign = ALLOWED_ALIGN.includes(String(body?.text_align || ""))
    ? String(body.text_align) : "center";
  const yOffsetPct = Math.max(-30, Math.min(30, Number(body?.y_offset_pct) || 0));
  // Wizard params (optional — Modal can ignore unknown ones)
  const transition = ALLOWED_TRANSITIONS.includes(String(body?.transition || ""))
    ? String(body.transition) : "fade";
  const enableVoice = body?.enable_voice !== false;
  const enableText = body?.enable_text !== false;
  const uppercase = !!body?.uppercase;
  // Per-scene visual length in seconds. Modal pads short narrations with
  // silence and clamps long ones to this duration. Range 3-20s; defaults
  // to the legacy 10s for backwards compatibility.
  const sceneDurationSec = Math.max(
    3,
    Math.min(20, Number(body?.scene_duration_sec) || 10)
  );
  // Drives MiniMax language_boost on the fallback TTS path inside Modal
  // (when the wizard didn't pre-cache audio for a scene).
  const language: "ms" | "en" = body?.language === "en" ? "en" : "ms";

  // Background music + per-track volumes. Modal mixes the music UNDER
  // the narration via ffmpeg amix at these exact weights so the final
  // MP4 sounds the same as the live preview the user heard in Step 2.
  // Music is OPTIONAL — null skips the amix step entirely (narration-
  // only output).
  const rawMusicUrl = body?.background_music_url;
  const backgroundMusicUrl =
    typeof rawMusicUrl === "string" && rawMusicUrl.trim().startsWith("http")
      ? rawMusicUrl.trim()
      : null;
  const voiceVolume = Math.max(0, Math.min(1, Number(body?.voice_volume ?? 1.0)));
  const musicVolume = Math.max(0, Math.min(1, Number(body?.music_volume ?? 0.25)));

  const modalEndpoint = process.env.MODAL_FAIRYTALE_ENDPOINT;
  if (!modalEndpoint) {
    return NextResponse.json(
      { error: "MODAL_FAIRYTALE_ENDPOINT not configured on Vercel" },
      { status: 500 }
    );
  }

  // Compute storytelling cost from admin-set rates. Same formula the
  // wizard shows in the cost-preview badge:
  //   per_image × scene_count + per_audio_sec × scene_dur × scene_count
  const pricing = await getStorytellingPricing();
  const totalCost = Number(
    (
      pricing.per_image * scenes.length +
      pricing.per_audio_sec * sceneDurationSec * scenes.length
    ).toFixed(4)
  );

  // Block here if user can't afford the render — saves a Modal call we'd
  // have to refund anyway.
  const funds = await priceAndCheck(user.id, "storytelling", totalCost);
  if (!funds.hasFunds) {
    return NextResponse.json(
      {
        error:
          `Insufficient credit. Need RM ${totalCost.toFixed(2)}, ` +
          `you have RM ${funds.credits.toFixed(2)}. Top up to continue.`,
      },
      { status: 402 }
    );
  }

  const admin = createAdminClient();

  // Insert placeholder NOW. Modal will flip status='done' + fill output_url
  // when render completes.
  const { data: hist, error: insErr } = await admin
    .from("history")
    .insert({
      user_id: user.id,
      project_id: projectId,
      type: "fairytale",
      tab: "fairytale",
      status: "pending",
      prompt: `Fairytale story · ${scenes.length} scenes`,
      task_id: `modal:${Date.now()}`,
      cost: totalCost,
      duration: scenes.length * sceneDurationSec,
      metadata: {
        scene_count: scenes.length,
        scene_duration_sec: sceneDurationSec,
        voice_id: voiceId,
        animation,
        placement,
        upload_status: "queued",
        pricing: {
          per_image: pricing.per_image,
          per_audio_sec: pricing.per_audio_sec,
        },
      },
    })
    .select("id")
    .single();

  if (insErr || !hist) {
    return NextResponse.json(
      { error: "DB insert failed", detail: insErr?.message },
      { status: 500 }
    );
  }

  const historyId = hist.id;

  // NOTE: we do NOT deduct credits here. Modal handles the deduction on
  // successful render via Supabase service-role RPC, so failures cost the
  // user nothing. row.cost stays = totalCost as a "what we'll charge if
  // this succeeds" placeholder (Modal reads it back).

  // Fire Modal in the background — Vercel returns NOW, doesn't wait for the
  // 30-60s render. Modal updates the row directly via service-role key.
  after(async () => {
    try {
      const r = await fetch(modalEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history_id: historyId,
          user_id: user.id,
          voice_id: voiceId,
          voice_speed: voiceSpeed,
          enable_voice: enableVoice,
          animation,
          transition,
          placement,
          font_size: fontSize,
          font_family: fontFamily,
          font_color: fontColor,
          subtitle_bg: subtitleBg,
          subtitle_animation: subtitleAnimation,
          text_align: textAlign,
          y_offset_pct: yOffsetPct,
          uppercase,
          enable_text: enableText,
          scene_duration_sec: sceneDurationSec,
          language,
          background_music_url: backgroundMusicUrl,
          voice_volume: voiceVolume,
          music_volume: musicVolume,
          // Modal does the deduct on success using this exact amount.
          // Vercel never deducts — failures cost the user nothing.
          cost: totalCost,
          scenes,
        }),
      });

      // Modal writes the row itself on success. We only patch on outright HTTP
      // failure (non-2xx) so the placeholder doesn't hang forever. No refund
      // needed — we never deducted in the first place; Modal does the deduct
      // ONLY when render succeeds.
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        await admin
          .from("history")
          .update({
            status: "failed",
            error_message: `Modal HTTP ${r.status}: ${txt.slice(0, 200)}`,
            metadata: {
              scene_count: scenes.length,
              voice_id: voiceId,
              upload_status: "failed",
            },
          })
          .eq("id", historyId);
      }
    } catch (e: any) {
      await admin
        .from("history")
        .update({
          status: "failed",
          error_message: e?.message || "Modal trigger failed",
          metadata: {
            scene_count: scenes.length,
            upload_status: "failed",
          },
        })
        .eq("id", historyId);
    }
  });

  return NextResponse.json({
    ok: true,
    history_id: historyId,
    scene_count: scenes.length,
  });
}
