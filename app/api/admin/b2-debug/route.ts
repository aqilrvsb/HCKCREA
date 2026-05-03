import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { uploadFromUrl } from "@/lib/b2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fingerprint(s: string | undefined): string {
  if (!s) return "MISSING";
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`;
}

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const env = {
    B2_ENDPOINT: fingerprint(process.env.B2_ENDPOINT),
    B2_REGION: fingerprint(process.env.B2_REGION),
    B2_KEY_ID: fingerprint(process.env.B2_KEY_ID),
    B2_APP_KEY: fingerprint(process.env.B2_APP_KEY),
    B2_BUCKET_PRIVATE: fingerprint(process.env.B2_BUCKET_PRIVATE),
  };

  // 1x1 PNG — public URL.
  const tinyUrl = "https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png";

  try {
    const res = await uploadFromUrl({
      url: tinyUrl,
      key: `users/${user.id}/test/tiny-${Date.now()}.png`,
      contentType: "image/png",
    });
    return NextResponse.json({ ok: true, env, ...res });
  } catch (e: any) {
    return NextResponse.json({ ok: false, env, error: e?.message }, { status: 500 });
  }
}
