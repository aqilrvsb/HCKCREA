import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/proxy-image-fetch?url=<encoded URL>
//
// Server-side image fetcher used by lib/upload-image.ts rehostFromUrl
// when the browser can't fetch the source URL directly (CORS block,
// or the host doesn't send Access-Control-Allow-Origin). Streams the
// remote image bytes back to the browser so the client can re-upload
// it through /api/upload/image.
//
// Auth-gated so this can't be abused as a generic open proxy.

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const ALLOWED_CT = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB hard cap to avoid memory blow-up

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const reqUrl = new URL(req.url);
  const target = reqUrl.searchParams.get("url");
  if (!target) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  // Only allow http(s) — refuse data:, file:, etc.
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return NextResponse.json({ error: "Only http(s) URLs allowed" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      // Some image hosts 403 when no Referer — leave default Node fetch
      // headers; if we hit issues we can spoof a Referer header per host.
      redirect: "follow",
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Source fetch failed: ${e?.message || "network error"}` },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Source returned HTTP ${upstream.status}` },
      { status: 502 }
    );
  }

  const ct = (upstream.headers.get("content-type") || "image/png").split(";")[0].trim();
  if (!ALLOWED_CT.includes(ct.toLowerCase())) {
    return NextResponse.json(
      { error: `Unsupported content-type: ${ct}` },
      { status: 415 }
    );
  }

  const ab = await upstream.arrayBuffer();
  if (ab.byteLength === 0) {
    return NextResponse.json({ error: "Source returned 0 bytes" }, { status: 502 });
  }
  if (ab.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Source image > 20MB" }, { status: 413 });
  }

  return new NextResponse(ab, {
    status: 200,
    headers: {
      "content-type": ct,
      "content-length": String(ab.byteLength),
      "cache-control": "no-store",
    },
  });
}
