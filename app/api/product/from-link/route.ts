import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { productFromLink } from "@/lib/product-link";

// POST /api/product/from-link  { url }
//   → { ok, source, name, detail, images[≤3], price?, note? }
// TikTok Shop (beg kuning) or Shopee link → real product name, up to 3 photos
// (re-hosted to B2) and a Detail Product draft. See lib/product-link.ts.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").trim();
  if (!url || url.length > 2000 || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Paste link produk yang sah (https://…)" }, { status: 400 });
  }

  const r = await productFromLink(url, user.id);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422 });
  return NextResponse.json(r);
}
