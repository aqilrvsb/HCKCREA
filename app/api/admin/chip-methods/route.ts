import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/admin/chip-methods
//
// Probes Chip's /payment_methods/ endpoint server-side using the
// configured CHIP_API_KEY + CHIP_BRAND_ID env vars. Returns the
// full available_payment_methods array so admin can verify which
// methods (fpx, card, duitnow_qr, e_wallet…) are enabled on the
// merchant brand WITHOUT having to copy-paste a curl command.
//
// Admin-only — never expose this on the client side, the response
// reveals which payment integrations the brand has.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: meAdmin } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!meAdmin?.is_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = process.env.CHIP_API_KEY;
  const brand = process.env.CHIP_BRAND_ID;
  if (!key || !brand) {
    return NextResponse.json(
      {
        error: "Chip env vars missing on Vercel",
        chip_api_key: !!key,
        chip_brand_id: !!brand,
      },
      { status: 500 }
    );
  }

  try {
    const r = await fetch(
      `https://gate.chip-in.asia/api/v1/payment_methods/?brand_id=${encodeURIComponent(brand)}&currency=MYR`,
      {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Pass through raw text if Chip returned non-JSON
    }
    if (!r.ok) {
      return NextResponse.json(
        {
          error: `Chip HTTP ${r.status}`,
          body: json || text.slice(0, 800),
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      brand_id: brand,
      currency: "MYR",
      available_payment_methods: json?.available_payment_methods || [],
      by_country: json?.by_country || null,
      raw: json,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Network error" },
      { status: 502 }
    );
  }
}
