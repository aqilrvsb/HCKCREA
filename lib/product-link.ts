// Paste a product link → real name + up to 3 product photos + Detail Product.
// Used by the StoryBoard product form ("⚡ Tarik Info").
//
//   TikTok Shop (beg kuning) — TikHub web/fetch_product_detail_v3 (MY region).
//     TikTok changed the payload in late 2026: product_info now carries
//     title / images / desc_blocks / price directly (the old product_model
//     shape is still read as a fallback).
//   Shopee — Shopee blocks scrapers (Crawlbase only gets the empty shell), so:
//     name   ← the URL slug (Shopee puts the full listing title in the link)
//     photos ← Google Images via Serper (Motion Search key), only hits whose
//              page link is the SAME Shopee item id
//     text   ← Google web snippets for that item
//
// Detail Product is written by the model_product_ocr vision model from the
// photos + whatever text the source gave (facts only, Malay). Photos are
// re-hosted to B2 so they never expire / hotlink-fail later.

import { randomUUID } from "node:crypto";
import { getTikHubConfig } from "@/lib/settings";
import { followShareLinkToProductId } from "@/lib/scraper";
import { getMotionSearchProviders } from "@/lib/motion-search";
import { orChatVision } from "@/lib/openrouter";
import { rehostToContent } from "@/lib/b2";

export type LinkProduct =
  | {
      ok: true;
      source: "tiktok" | "shopee";
      name: string;
      detail: string;
      images: string[];
      price?: string;
      note?: string;
    }
  | { ok: false; error: string };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export function linkKind(url: string): "tiktok" | "shopee" | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (/(^|\.)shopee\.[a-z.]+$/.test(host) || host === "shp.ee" || host.endsWith(".shp.ee")) return "shopee";
  return null;
}

// ─── TikTok Shop ──────────────────────────────────────────────────────────

function tiktokProductId(url: string): string | null {
  const m =
    url.match(/(?:product|pdp(?:\/[^/?]+)*)\/(\d{13,20})(?:[/?#]|$)/i) ||
    url.match(/\/(\d{13,20})(?:[/?#]|$)/);
  return m ? m[1] : null;
}

function joinDescBlocks(blocks: any): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b: any) => (b?.type === "text" ? String(b?.text || "").trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function fromTikTok(url: string): Promise<{ name: string; images: string[]; text: string; price?: string } | { error: string }> {
  let productId = tiktokProductId(url);
  if (!productId) productId = await followShareLinkToProductId(url);
  if (!productId) return { error: "Tak jumpa ID produk dalam link TikTok ni. Guna link produk / beg kuning." };

  const cfg = await getTikHubConfig();
  if (!cfg.token) return { error: "TikHub token belum di-set (admin)." };
  const endpoint = `${cfg.base}/api/v1/tiktok/shop/web/fetch_product_detail_v3?product_id=${encodeURIComponent(productId)}&region=MY`;

  let lastErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(45_000),
      });
      const j: any = await res.json().catch(() => null);
      if (!res.ok || (j?.code && Number(j.code) !== 200)) {
        lastErr = `TikHub HTTP ${res.status}${j?.message ? `: ${String(j.message).slice(0, 120)}` : ""}`;
      } else {
        const comps: any[] = j?.data?.product_data?.page_config?.components_map || [];
        const pi = comps.find((c) => c?.component_name === "product_info")?.component_data?.product_info || {};
        const pm = pi.product_model || {}; // pre-late-2026 shape
        const name = String(pi.title || pm.name || "").trim();
        const imgs: any[] = Array.isArray(pi.images) && pi.images.length ? pi.images : Array.isArray(pm.images) ? pm.images : [];
        const images = imgs
          .map((im: any) => String(im?.url_list?.[0] || im?.url_list?.[1] || ""))
          .filter((u) => /^https?:\/\//.test(u))
          .slice(0, 3);
        const text = joinDescBlocks(pi.desc_blocks) || String(pm.description || "");
        const price = String(pi.price?.real_price || "").trim() || undefined;
        if (name) return { name, images, text, price };
        lastErr = "TikHub balas tanpa data produk (produk mungkin dah tiada / region).";
      }
    } catch (e: any) {
      lastErr = `TikHub: ${e?.message || "network"}`;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return { error: lastErr || "TikHub gagal" };
}

// ─── Shopee (via Google / Serper) ─────────────────────────────────────────

async function resolveShopeeUrl(url: string): Promise<string> {
  if (/-i\.\d+\.\d+|\/product\/\d+\/\d+/.test(url)) return url;
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
    let final = res.url || url;
    // Bot/login wall keeps the real target in ?next=
    const next = new URL(final).searchParams.get("next");
    if (next) final = decodeURIComponent(next);
    return final;
  } catch {
    return url;
  }
}

async function serper(kind: "images" | "search", q: string): Promise<any> {
  const providers = await getMotionSearchProviders();
  const key = providers.find((p) => p.provider === "serper" && p.key)?.key;
  if (!key) throw new Error("Serper key (Motion Search) belum di-set");
  const res = await fetch(`https://google.serper.dev/${kind}`, {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    // num 10 max — the Serper plan rejects num 20 ("Query pattern not allowed").
    body: JSON.stringify({ q, gl: "my", hl: "en", num: 10 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  return res.json();
}

async function fromShopee(rawUrl: string): Promise<{ name: string; images: string[]; text: string; note?: string } | { error: string }> {
  const url = await resolveShopeeUrl(rawUrl);
  let path = "";
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return { error: "Link Shopee tak sah." };
  }
  const m = path.match(/-i\.(\d+)\.(\d+)/) || path.match(/\/product\/(\d+)\/(\d+)/);
  if (!m) return { error: "Tak jumpa ID produk dalam link Shopee ni. Buka produk di Shopee → Share → Copy link." };
  const [, shopId, itemId] = m;
  const sameItem = (link: unknown) => String(link || "").includes(itemId);

  // Name from the slug: /<Title-With-Dashes>-i.<shop>.<item>
  const slug = path.split("/").pop() || "";
  let name = /-i\.\d+\.\d+$/.test(slug) ? slug.replace(/-i\.\d+\.\d+$/, "").replace(/-+/g, " ").replace(/\s+/g, " ").trim() : "";

  // Search the link's own Shopee country site (shopee.com.my / .sg / …).
  let site = "shopee.com.my";
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (/^shopee\./.test(h)) site = h;
  } catch {}

  try {
    // Web search first — gives the listing title (when the link had no slug) + snippets.
    // Slug-less links (/product/<shop>/<item>): Google finds the listing by item id.
    let organic: any[] = [];
    for (const q of name ? [`${name} site:${site}`] : [`site:${site} ${itemId}`, `${site}/product/${shopId}/${itemId}`]) {
      const web = await serper("search", q);
      organic = Array.isArray(web?.organic) ? web.organic : [];
      if (organic.some((o) => sameItem(o?.link))) break;
    }
    const hit = organic.find((o) => sameItem(o?.link));
    if (!name && hit?.title) name = String(hit.title).replace(/\s*[|-]\s*Shopee.*$/i, "").trim();
    if (!name) return { error: "Tak dapat nama produk dari link Shopee ni — isi nama manual." };
    const text = organic.filter((o) => sameItem(o?.link)).map((o) => String(o?.snippet || "")).filter(Boolean).join("\n");

    const img = await serper("images", `${name} site:${site}`);
    const hits: any[] = Array.isArray(img?.images) ? img.images : [];
    const own = hits.filter((h) => sameItem(h?.link) && h?.imageUrl);
    const shop = hits.filter((h) => String(h?.link || "").includes(`i.${shopId}.`) && h?.imageUrl && !sameItem(h?.link));
    const picked = [...own, ...shop].slice(0, 3).map((h) => String(h.imageUrl));
    const note =
      own.length === 0
        ? "Gambar exact listing tak jumpa di Google — semak/ganti gambar."
        : own.length < picked.length
          ? "Sebahagian gambar dari kedai yang sama — semak dulu."
          : undefined;
    return { name, images: picked, text, note };
  } catch (e: any) {
    return { error: `Carian Google gagal: ${e?.message || e}` };
  }
}

// ─── Detail Product writer ────────────────────────────────────────────────

const DETAIL_SYSTEM = `Kau tulis "Detail Product" ringkas untuk content creator TikTok Malaysia.
Guna HANYA fakta dari teks sumber dan apa yang jelas kelihatan pada gambar produk (label, saiz, bahan, jenama).
JANGAN reka harga, claim, sijil atau bahan yang tiada dalam sumber.
Format: 3–7 baris pendek dalam Bahasa Melayu, setiap baris bermula "- ". Masukkan (jika ada): harga, saiz/isi, kegunaan, kelebihan/USP, bahan utama, untuk siapa.
Balas teks detail sahaja — tiada tajuk, tiada markdown lain.`;

async function writeDetail(name: string, text: string, price: string | undefined, images: string[]): Promise<string> {
  const source = [`Nama produk: ${name}`, price ? `Harga: ${price}` : "", text ? `Teks dari listing:\n${text.slice(0, 4000)}` : ""]
    .filter(Boolean)
    .join("\n\n");
  const r = await orChatVision({
    modelKey: "model_product_ocr",
    systemPrompt: DETAIL_SYSTEM,
    textPrompt: source,
    images: images.slice(0, 3),
    temperature: 0.2,
    maxTokens: 500,
    timeoutMs: 60_000,
  }).catch(() => ({ ok: false as const, content: "" }));
  const out = String((r as any)?.content || "").trim();
  if (r.ok && out) return out.slice(0, 3000);
  // AI down → raw facts so the form is never empty.
  return [price ? `- Harga: ${price}` : "", text.slice(0, 1500)].filter(Boolean).join("\n").trim();
}

// ─── Entry ────────────────────────────────────────────────────────────────

export async function productFromLink(rawUrl: string, userId: string): Promise<LinkProduct> {
  const url = String(rawUrl || "").trim();
  const kind = linkKind(url);
  if (!kind) return { ok: false, error: "Paste link produk TikTok Shop (beg kuning) atau Shopee." };

  const got = kind === "tiktok" ? await fromTikTok(url) : await fromShopee(url);
  if ("error" in got) return { ok: false, error: got.error };
  if (got.images.length === 0 && !got.text) {
    return { ok: false, error: "Produk jumpa tapi tiada gambar/detail — upload gambar manual." };
  }

  // Re-host to B2 (TikTok CDN links carry expiring signatures; Shopee CDN can
  // hotlink-block). rehostToContent falls back to the source URL on failure.
  const batch = `product-${randomUUID()}`;
  const images = await Promise.all(
    got.images.map((u, i) =>
      rehostToContent({ url: u, userId, historyId: `${batch}-${i + 1}`, type: "image", fallbackExt: "jpg" }).catch(() => u)
    )
  );

  const price = "price" in got ? got.price : undefined;
  const detail = await writeDetail(got.name, got.text, price, images);
  return {
    ok: true,
    source: kind,
    name: got.name.slice(0, 120),
    detail,
    images,
    price,
    note: "note" in got ? got.note : undefined,
  };
}
