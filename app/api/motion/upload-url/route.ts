import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { MOTION_EDIT_MAX_MB, signMotionUpload } from "@/lib/motion";

// POST /api/motion/upload-url { name, size } → { upload_url }
// A signed, one-hour link the browser POSTs the client's video to. The file
// goes browser → Modal → B2, never through Vercel (4.5MB body cap).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "motion"))) {
    return NextResponse.json({ error: "Tab ini tidak tersedia untuk akaun anda." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as any));
  const size = Number(b?.size) || 0;
  // kind "image" = the seller's product photos (Edit Video) — same browser →
  // Modal → B2 path as the video, so it doesn't depend on any third party.
  // kind "vgc" = Custom Style material (image, footage or voice-over).
  const kind = b?.kind === "image" ? "image" : b?.kind === "vgc" ? "vgc" : "video";
  if (kind === "image" && size > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "Gambar terlalu besar (maks 12MB)." }, { status: 413 });
  }
  if (kind !== "image" && size > MOTION_EDIT_MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `Video terlalu besar (maks ${MOTION_EDIT_MAX_MB}MB).` }, { status: 413 });
  }
  const signed = await signMotionUpload(user.id, String(b?.name || (kind === "image" ? "photo.jpg" : "video.mp4")), kind);
  if (!signed) return NextResponse.json({ error: "Motion renderer not configured" }, { status: 500 });
  return NextResponse.json({ ok: true, upload_url: signed.uploadUrl });
}
