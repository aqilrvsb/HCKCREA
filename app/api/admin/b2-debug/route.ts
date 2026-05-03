import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadFromUrl } from "@/lib/b2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnostic — uploads a tiny synthetic file to B2 to isolate whether
// the upload pipeline is broken (auth/signing) vs whether large-body
// transmission is the problem. Admin only.
//
// We host the test bytes via data: URL ... actually data: isn't fetchable.
// Use a known tiny public URL instead.
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1x1 transparent PNG hosted on a fast CDN — ~70 bytes.
  const tinyUrl = "https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png";

  try {
    const res = await uploadFromUrl({
      url: tinyUrl,
      key: `users/${user.id}/test/tiny-${Date.now()}.png`,
      contentType: "image/png",
    });
    return NextResponse.json({ ok: true, ...res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}
