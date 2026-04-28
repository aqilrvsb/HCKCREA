import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scrapeAffiliateUrl } from "@/lib/scraper";
import { getRunningHubConfig } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 90; // Crawlbase responses can be 10-15s
export const dynamic = "force-dynamic";

// POST /api/scrape/affiliate { url }
//
// Pulls product details from a TikTok Shop / Shopee / Lazada / generic
// affiliate URL via Crawlbase, then re-uploads the scraped product image
// to RunningHub so the auto-content pipeline gets a public URL Crun /
// GeminiGen can fetch from. Returns a normalised payload that the Auto
// Content tab consumes to pre-fill manual_products[0].
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const url = String(body?.url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const scraped = await scrapeAffiliateUrl(url);
  if (!scraped.ok) {
    return NextResponse.json(
      {
        error: scraped.error || "Scrape returned no product data",
        source: scraped.source,
      },
      { status: 502 }
    );
  }

  // Re-host the scraped product image on RunningHub so Crun.ai / GeminiGen
  // can fetch it reliably (the original CDN URLs from TikTok / Shopee
  // sometimes block hot-link requests from Crun's region).
  let hostedImageUrl = scraped.product_image_url;
  if (hostedImageUrl) {
    try {
      const rhCfg = await getRunningHubConfig();
      if (rhCfg.key && rhCfg.uploadUrl) {
        const imgRes = await fetch(hostedImageUrl, {
          signal: AbortSignal.timeout(20_000),
        });
        if (imgRes.ok) {
          const blob = await imgRes.blob();
          const fd = new FormData();
          fd.append("file", blob, "scraped.jpg");
          const upRes = await fetch(rhCfg.uploadUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${rhCfg.key}` },
            body: fd,
          });
          const upJson: any = await upRes.json().catch(() => null);
          const rhUrl =
            upJson?.data?.download_url ||
            upJson?.data?.url ||
            upJson?.data?.fileUrl ||
            null;
          if (upRes.ok && rhUrl) hostedImageUrl = rhUrl;
        }
      }
    } catch {
      // Best-effort — fall back to the original CDN URL if RunningHub
      // upload fails. Auto Content will still try to use it.
    }
  }

  return NextResponse.json({
    ok: true,
    source: scraped.source,
    product_name: scraped.product_name,
    product_image_url: hostedImageUrl,
    description: scraped.description,
    price: scraped.price || null,
    rating: scraped.rating || null,
    total_sold: scraped.total_sold || null,
    category: scraped.category || null,
  });
}
