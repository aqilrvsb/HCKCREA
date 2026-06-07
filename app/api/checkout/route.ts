import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChipPurchase } from "@/lib/chip";
import { isPlanKey, loadPlan } from "@/lib/plans";

// 4-tier signup checkout flow. Accepts any of starter/standard/pro/premium
// from the landing-page checkout form. The browser pre-pays + auto-creates
// the account; the webhook hands login credentials over via WhatsApp.

function normalizeWhatsapp(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 13) return null;
  if (digits.startsWith("60")) return "+" + digits;
  if (digits.startsWith("0")) return "+60" + digits.slice(1);
  return "+60" + digits;
}

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || "");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const planRaw = String(body?.plan || "").toLowerCase();
    const name = String(body?.name || "").trim();
    const whatsappRaw = String(body?.whatsapp || "");
    const email = String(body?.email || "").trim().toLowerCase();
    // UTM payload from the checkout form (read from peninglab_utm cookie
    // set by FBPixel when the visitor landed via an ad link). Stamped
    // into payment.metadata.utm so /admin/ads can attribute purchases
    // back to the originating ad source/campaign/placement.
    const utm = (body?.utm && typeof body.utm === "object") ? body.utm : null;

    if (!isPlanKey(planRaw)) {
      return NextResponse.json(
        { error: "Invalid plan. Expected one of: starter, standard, pro, premium" },
        { status: 400 }
      );
    }
    const plan = planRaw;

    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const whatsapp = normalizeWhatsapp(whatsappRaw);
    if (!whatsapp) return NextResponse.json({ error: "Invalid WhatsApp number" }, { status: 400 });
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const admin = createAdminClient();
    const cfg = await loadPlan(admin, plan);

    // Affiliate cookie — set by middleware when visitor lands with ?ref=
    // Carried into payment metadata so the webhook can resolve the
    // referrer + grant commission once Chip confirms payment.
    const refCookie = (await cookies()).get("peninglab_ref")?.value || null;
    const referredByCode =
      refCookie && /^[A-Z0-9]{4,16}$/.test(refCookie) ? refCookie : null;

    // Pre-create payment row WITHOUT a user_id — auto-register happens on
    // success. We stash the signup payload in metadata for the webhook.
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        user_id: null as any, // placeholder — set after signup
        type: "checkout_signup",
        plan,
        amount: cfg.price,
        currency: "MYR",
        status: "pending",
        metadata: {
          plan,
          plan_label: cfg.label,
          days: cfg.days,
          // Existing applyCheckoutSignup() reads metadata.free_credits to
          // populate profiles.credits at signup time. Map cfg.credits → it
          // so 4-tier signups grant the right credit allotment.
          free_credits: cfg.credits,
          credits: cfg.credits,
          signup: { name, whatsapp, email },
          referred_by_code: referredByCode,
          utm: utm && utm.source
            ? {
                source: String(utm.source).slice(0, 64),
                medium: utm.medium ? String(utm.medium).slice(0, 64) : null,
                campaign: utm.campaign ? String(utm.campaign).slice(0, 128) : null,
                content: utm.content ? String(utm.content).slice(0, 128) : null,
                term: utm.term ? String(utm.term).slice(0, 128) : null,
              }
            : null,
        },
      })
      .select()
      .single();

    if (payErr || !payment) {
      console.error("checkout payment insert failed:", payErr);
      return NextResponse.json(
        {
          error: "Failed to create payment record",
          detail: payErr?.message || null,
          code: (payErr as any)?.code || null,
          hint: (payErr as any)?.hint || null,
        },
        { status: 500 }
      );
    }

    const origin =
      req.headers.get("origin") ||
      process.env.APP_ORIGIN ||
      "https://peninglab.vercel.app";

    const purchase = await createChipPurchase({
      email,
      fullName: name,
      productName: `PeningLab ${cfg.label} Plan — ${cfg.days} days`,
      amountMYR: cfg.price,
      reference: `SU-${payment.id.substring(0, 8)}`,
      metadata: {
        type: "checkout_signup",
        payment_id: payment.id,
        plan,
        days: cfg.days,
        free_credits: cfg.credits,
        credits: cfg.credits,
        name,
        whatsapp,
        email,
      },
      successRedirect: `${origin}/payment/success?id=${payment.id}`,
      failureRedirect: `${origin}/payment/failed?id=${payment.id}`,
      webhookUrl: `${origin}/api/payments/webhook`,
    });

    await admin
      .from("payments")
      .update({
        chip_purchase_id: purchase.id,
        chip_checkout_url: purchase.checkout_url,
      })
      .eq("id", payment.id);

    return NextResponse.json({
      ok: true,
      payment_id: payment.id,
      checkout_url: purchase.checkout_url,
    });
  } catch (e: any) {
    console.error("checkout error:", e?.message);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
