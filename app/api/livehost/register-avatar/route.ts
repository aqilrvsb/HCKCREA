import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Register a Livehost avatar with the client's GPU backend FROM an
// attachment URL. Done server-side because attachment images live on B2
// (no CORS headers), so the browser can't fetch the bytes to forward the
// binary itself. The GPU backend's /register-avatar takes the raw image
// body — we fetch it here and pipe it through.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").trim();
  if (!url) return NextResponse.json({ error: "Missing image url" }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("live_client_config")
    .select("backend_url")
    .eq("user_id", user.id)
    .maybeSingle();
  const backend = (data?.backend_url || "").replace(/\/+$/, "");
  if (!backend) {
    return NextResponse.json(
      { error: "Livehost belum dikonfigurasi — hubungi admin." },
      { status: 404 }
    );
  }

  // Fetch the attachment image server-side (no CORS limitation here).
  let imgBuf: Buffer;
  let contentType = "image/png";
  try {
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error(`fetch image HTTP ${imgRes.status}`);
    contentType = imgRes.headers.get("content-type") || "image/png";
    imgBuf = Buffer.from(await imgRes.arrayBuffer());
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not fetch image: ${e?.message || e}` },
      { status: 502 }
    );
  }

  const avatarId = "u" + Date.now().toString(36);
  try {
    const r = await fetch(`${backend}/register-avatar?avatar_id=${avatarId}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(imgBuf),
    });
    const d = await r.json().catch(() => ({} as any));
    if (!r.ok || d.error || d.detail) {
      const msg = String(d.detail || d.error || `HTTP ${r.status}`);
      const friendly = /no face/i.test(msg)
        ? "No face detected — use a clearer, front-facing photo."
        : msg;
      return NextResponse.json({ error: friendly }, { status: 502 });
    }
    return NextResponse.json({ ok: true, avatar_id: d.avatar_id || avatarId });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Register failed: ${e?.message || e}` },
      { status: 502 }
    );
  }
}
