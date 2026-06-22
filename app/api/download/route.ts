import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/download?url=<b2 url>&name=<filename>
// Same-origin download proxy. Streams the file back with
// Content-Disposition: attachment so the browser SAVES it instead of opening
// it inline. This is the only reliable way to download cross-origin (B2)
// media on iOS Safari, whose native <video> controls have no download button
// and which ignores the <a download> attribute for cross-origin URLs.
//
// Auth-gated + host-allowlisted so it can't be abused as an open proxy.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_HOST_SUFFIX = [".backblazeb2.com"];

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const target = u.searchParams.get("url");
  const name = (u.searchParams.get("name") || "download")
    .replace(/[^a-z0-9_.\-]/gi, "_")
    .slice(0, 80) || "download";
  if (!target) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  let parsed: URL;
  try { parsed = new URL(target); } catch { return NextResponse.json({ error: "Invalid url" }, { status: 400 }); }
  if (parsed.protocol !== "https:" || !ALLOWED_HOST_SUFFIX.some((h) => parsed.hostname.endsWith(h))) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
  }

  const res = await fetch(target, { cache: "no-store" });
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: `Fetch failed HTTP ${res.status}` }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("content-type") || "application/octet-stream");
  headers.set("Content-Disposition", `attachment; filename="${name}"`);
  const len = res.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set("Cache-Control", "private, no-store");
  return new Response(res.body, { headers });
}
