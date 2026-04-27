import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChipPurchase } from "@/lib/chip";

// Single Pro Plan — defaults overridden at runtime by app_settings.plan_pro.
// `freeCredits` is 0 because subscription unlocks access, not a credit pile;
// users top up credits separately via /api/credit/topup.
const PLAN_DEFAULTS: Record<string, { price: number; days: number; freeCredits: number; label: string }> = {
  pro: { price: 75, days: 30, freeCredits: 0, label: "Pro Plan" },
};

async function loadPlan(plan: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", `plan_${plan}`)
    .maybeSingle();
  const v = (data?.value as any) || {};
  const d = PLAN_DEFAULTS[plan];
  if (!d) return null;
  return {
    price: Number(v.price ?? d.price),
    days: Number(v.days ?? d.days),
    freeCredits: Number(v.credits ?? d.freeCredits),
    label: String(v.label ?? d.label),
  };
}

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
    const plan = String(body?.plan || "").toLowerCase();
    const name = String(body?.name || "").trim();
    const whatsappRaw = String(body?.whatsapp || "");
    const email = String(body?.email || "").trim().toLowerCase();

    if (plan !== "pro") {
      return NextResponse.json(
        { error: "Only the Pro Plan is available" },
        { status: 400 }
      );
    }
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const whatsapp = normalizeWhatsapp(whatsappRaw);
    if (!whatsapp) return NextResponse.json({ error: "Invalid WhatsApp number" }, { status: 400 });
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const cfg = await loadPlan(plan);
    if (!cfg) return NextResponse.json({ error: "Plan config missing" }, { status: 500 });

    const admin = createAdminClient();

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
          free_credits: cfg.freeCredits,
          signup: { name, whatsapp, email },
        },
      })
      .select()
      .single();

    if (payErr || !payment) {
      console.error("checkout payment insert failed:", payErr);
      // Surface the underlying SQL error to the client so we can diagnose
      // schema / RLS / constraint issues without having to grep Vercel logs.
      // payErr fields from supabase-js: .message, .details, .hint, .code.
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
      productName: `PeningLab ${cfg.label} — ${cfg.days} days`,
      amountMYR: cfg.price,
      reference: `SU-${payment.id.substring(0, 8)}`,
      metadata: {
        type: "checkout_signup",
        payment_id: payment.id,
        plan,
        days: cfg.days,
        free_credits: cfg.freeCredits,
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
