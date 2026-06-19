import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/proxy-video?url=<encoded URL>
//
// Same-origin streaming proxy for body-gesture clips. The clips live on
// Backblaze B2 (and older ones on Supabase/fal), which DON'T send
// Access-Control-Allow-Origin. The Livehost studio draws the body onto a
// <canvas> and calls getImageData() to chroma-key it — that taints/blocks a
// cross-origin <video crossorigin="anonymous">, so the canvas comes out blank
// and the body never shows. Routing the <video> through this same-origin proxy
// removes the CORS taint so getImageData works. Forwards Range so the <video>
// still seeks/streams. Auth-gated + host-allowlisted so it can't be abused as
// an open proxy.

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// only our known content hosts (no open proxy)
const ALLOWED_HOST = /(^|\.)(backblazeb2\.com|supabase\.co|fal\.media|fal\.run)$/i;

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = new URL(req.url).searchParams.get("url");
  if (!target) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(target); } catch { return NextResponse.json({ error: "Invalid url" }, { status: 400 }); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return NextResponse.json({ error: "Only http(s) URLs allowed" }, { status: 400 });
  }
  if (!ALLOWED_HOST.test(parsed.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  const range = req.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(target, { headers: range ? { Range: range } : {}, redirect: "follow" });
  } catch (e: any) {
    return NextResponse.json({ error: `Source fetch failed: ${e?.message || "network error"}` }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json({ error: `Source returned HTTP ${upstream.status}` }, { status: 502 });
  }

  const headers: Record<string, string> = {
    "content-type": (upstream.headers.get("content-type") || "video/mp4").split(";")[0].trim(),
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=3600",
  };
  const cr = upstream.headers.get("content-range"); if (cr) headers["content-range"] = cr;
  const cl = upstream.headers.get("content-length"); if (cl) headers["content-length"] = cl;

  // stream the bytes through (no full-buffer in memory)
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
