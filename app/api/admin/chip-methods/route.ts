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

  // Chip's /payment_methods/ endpoint silently filters out every method
  // that has ANY amount-based rule when `amount` is not provided —
  // that's why an unparametrised call returns an empty array even on
  // a healthy brand with active FPX payments. Probing at three real
  // price points covers every published min/max threshold:
  //   - RM 1     (lowest): catches FPX min (RM 1) + anything always-on
  //   - RM 75    (Pro)   : the most common real purchase amount
  //   - RM 500   (large) : surfaces methods with low max (e.g. some
  //                        e-Wallets cap individual transactions)
  // The union of all three responses is the true picture of what's
  // active on the brand.
  const PROBES = [
    { label: "RM 1 (smallest)", amount: 100 },
    { label: "RM 75 (Pro Plan)", amount: 7500 },
    { label: "RM 500 (large)", amount: 50_000 },
  ];

  const probes: any[] = [];
  const union = new Set<string>();
  for (const p of PROBES) {
    const url =
      `https://gate.chip-in.asia/api/v1/payment_methods/` +
      `?brand_id=${encodeURIComponent(brand)}` +
      `&currency=MYR` +
      `&country=MY` +
      `&language=en` +
      `&amount=${p.amount}`;
    try {
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });
      const text = await r.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {}
      const methods: string[] = json?.available_payment_methods || [];
      methods.forEach((m) => union.add(m));
      probes.push({
        label: p.label,
        amount_sen: p.amount,
        http: r.status,
        methods,
        names: json?.names || {},
        ...(r.ok ? {} : { raw: json || text.slice(0, 400) }),
      });
    } catch (e: any) {
      probes.push({
        label: p.label,
        amount_sen: p.amount,
        error: e?.message || "network error",
      });
    }
  }

  return NextResponse.json({
    ok: true,
    brand_id: brand,
    currency: "MYR",
    all_enabled_methods: Array.from(union).sort(),
    has_card:
      union.has("card") ||
      union.has("visa") ||
      union.has("mastercard") ||
      union.has("american_express"),
    has_fpx: union.has("fpx") || union.has("fpx_b2b1"),
    has_duitnow_qr: union.has("duitnow_qr"),
    has_ewallet:
      union.has("e_wallet") ||
      union.has("razer") ||
      union.has("grabpay") ||
      union.has("tng") ||
      union.has("shopeepay") ||
      union.has("boost"),
    probes,
  });
}
