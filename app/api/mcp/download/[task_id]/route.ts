import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMcpDownloadToken } from "@/lib/mcp-auth";

// GET /api/mcp/download/<task_id>?t=<token>
//
// Shareable "force download" link for a finished MCP video. Streams the
// video back with Content-Disposition: attachment so it SAVES instead of
// playing inline — the only reliable way to download B2 media on iOS Safari.
//
// Auth: a per-task HMAC token (NOT the account API key), so the link is safe
// to hand to a client without leaking the key. Host-allowlisted so it can't
// be abused as an open proxy. The plain `output_url` is the stream/play link;
// this endpoint is the download link.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_HOST_SUFFIX = [".backblazeb2.com"];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ task_id: string }> }
) {
  const { task_id } = await params;
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!task_id || !verifyMcpDownloadToken(task_id, t)) {
    return NextResponse.json({ error: "Invalid or missing token" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("history")
    .select("id, output_url, status")
    .eq("id", task_id)
    .maybeSingle();

  if (!row || row.status !== "done" || !row.output_url) {
    return NextResponse.json({ error: "Video not ready" }, { status: 404 });
  }

  let parsed: URL;
  try {
    parsed = new URL(row.output_url);
  } catch {
    return NextResponse.json({ error: "Bad output URL" }, { status: 500 });
  }
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_HOST_SUFFIX.some((h) => parsed.hostname.endsWith(h))
  ) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 400 });
  }

  const res = await fetch(row.output_url, { cache: "no-store" });
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: `Fetch failed HTTP ${res.status}` }, { status: 502 });
  }

  const headers = new Headers();
  headers.set("Content-Type", res.headers.get("content-type") || "video/mp4");
  headers.set("Content-Disposition", `attachment; filename="peninglab-${task_id}.mp4"`);
  const len = res.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  headers.set("Cache-Control", "private, no-store");
  return new Response(res.body, { headers });
}
