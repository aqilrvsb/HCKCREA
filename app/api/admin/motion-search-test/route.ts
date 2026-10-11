import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchImages, searchWeb } from "@/lib/motion-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/admin/motion-search-test  { query?: string }
//
// Admin "Test" button on the Motion Search (Google) card. Runs the real
// searchImages + searchWeb (cache → provider cascade from
// app_settings.motion_search) and reports which provider answered, hit
// counts and per-provider errors. Never returns keys.
async function adminGate() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return null;
  return user;
}

export async function POST(req: Request) {
  const user = await adminGate();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const query =
    String(body?.query ?? "").replace(/\s+/g, " ").trim().slice(0, 120) ||
    "kopi pracampur arabica";

  const [images, web] = await Promise.all([searchImages(query), searchWeb(query)]);
  const img0 = images.hits[0];
  const web0 = web.hits[0];

  return NextResponse.json({
    ok: images.provider !== null && web.provider !== null,
    query,
    images: {
      provider: images.provider,
      count: images.hits.length,
      cached: images.cached,
      ...(img0
        ? {
            first: {
              url: img0.url,
              thumb: img0.thumb,
              width: img0.width,
              height: img0.height,
              domain: img0.domain,
            },
          }
        : {}),
    },
    web: {
      provider: web.provider,
      count: web.hits.length,
      cached: web.cached,
      ...(web0
        ? { first: { title: web0.title, url: web0.url, snippet: web0.snippet, domain: web0.domain } }
        : {}),
    },
    errors: [
      ...images.errors.map((e) => `images · ${e}`),
      ...web.errors.map((e) => `web · ${e}`),
    ],
  });
}
