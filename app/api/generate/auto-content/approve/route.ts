import { NextResponse } from "next/server";

// POST /api/generate/auto-content/approve — called after the user reviews
// a Verify Plan and clicks Approve. We forward the body (with the user-
// approved preset_plan) to the main /api/generate/auto-content route with
// plan_mode forced to "approved" so the upstream handler skips the planner
// and goes straight to Veo r2v fan-out.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Force the mode regardless of what the client sent.
  body.plan_mode = "approved";

  // Build absolute URL to the same origin so we don't need to redo auth.
  const url = new URL(req.url);
  const target = `${url.protocol}//${url.host}/api/generate/auto-content`;

  // Forward the auth cookie so the downstream route sees the user.
  const cookie = req.headers.get("cookie") || "";

  const r = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return NextResponse.json(data, { status: r.status });
}
