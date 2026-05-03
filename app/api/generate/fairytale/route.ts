import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

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
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Scene = { image_url?: string; narration?: string };

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

  const voiceId = String(body?.voice_id || "English_CaptivatingStoryteller");
  const voiceSpeed = Math.max(0.5, Math.min(2.0, Number(body?.voice_speed) || 1.0));
  const animation = String(body?.animation || "zoom-in");
  const placement = String(body?.placement || "bottom");
  const fontSize = Math.max(28, Math.min(96, Number(body?.font_size) || 56));
  // Subtitle styling — all dynamic per render. Validated against safe enums
  // so a malicious client can't inject arbitrary ffmpeg expressions.
  const ALLOWED_FONTS = ["bold-display","sans","sans-bold","serif","mono","handwriting","roboto"];
  const ALLOWED_COLORS = ["white","yellow","orange","red","pink","cyan","black"];
  const ALLOWED_BG = ["box","outline","shadow","outline+shadow","none"];
  const ALLOWED_SUB_ANIM = ["static","karaoke","fade"];
  const ALLOWED_ALIGN = ["left","center","right"];
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

  const modalEndpoint = process.env.MODAL_FAIRYTALE_ENDPOINT;
  if (!modalEndpoint) {
    return NextResponse.json(
      { error: "MODAL_FAIRYTALE_ENDPOINT not configured on Vercel" },
      { status: 500 }
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
      cost: 0,
      duration: scenes.length * 5, // rough estimate; actual depends on TTS length
      metadata: {
        scene_count: scenes.length,
        voice_id: voiceId,
        animation,
        placement,
        upload_status: "queued",
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
          animation,
          placement,
          font_size: fontSize,
          font_family: fontFamily,
          font_color: fontColor,
          subtitle_bg: subtitleBg,
          subtitle_animation: subtitleAnimation,
          text_align: textAlign,
          y_offset_pct: yOffsetPct,
          scenes,
        }),
      });

      // Modal writes the row itself on success. We only patch on outright HTTP
      // failure (non-2xx) so the placeholder doesn't hang forever.
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
