import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChipPurchase } from "@/lib/chip";

// Single Pro Plan subscribe flow. Reads price/days/credits from
// app_settings.plan_pro so admin can tune in /admin without a redeploy.
// The legacy starter/growth/empire keys are gone — billing.tsx renders
// only Pro Plan and submits plan="pro".
const PRO_DEFAULTS = { price: 75, days: 30, credits: 0, label: "Pro Plan" };

async function loadProPlan(admin: ReturnType<typeof createAdminClient>) {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "plan_pro")
    .maybeSingle();
  const v = (data?.value as any) || {};
  return {
    price: Number(v.price ?? PRO_DEFAULTS.price),
    days: Number(v.days ?? PRO_DEFAULTS.days),
    credits: Number(v.credits ?? PRO_DEFAULTS.credits),
    label: String(v.label ?? PRO_DEFAULTS.label),
  };
}

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const plan = String(body?.plan || "pro").toLowerCase();
    if (plan !== "pro") {
      return NextResponse.json(
        { error: "Only the Pro Plan is available" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const cfg = await loadProPlan(admin);

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, whatsapp")
      .eq("id", user.id)
      .single();

    const fullName = profile?.full_name || user.email?.split("@")[0] || "User";

    // Create payment record in pending state. Webhook will flip to paid +
    // call applySubscription which extends plan_expires_at by `days`.
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        type: "subscription",
        plan: "pro",
        amount: cfg.price,
        currency: "MYR",
        status: "pending",
        metadata: { plan: "pro", credits: cfg.credits, days: cfg.days, label: cfg.label },
      })
      .select()
      .single();

    if (payErr || !payment) {
      console.error("Failed to create payment:", payErr);
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    const origin =
      req.headers.get("origin") ||
      process.env.APP_ORIGIN ||
      "https://peninglab.vercel.app";

    const purchase = await createChipPurchase({
      email: user.email!,
      fullName,
      productName: `PeningLab ${cfg.label} — ${cfg.days} days`,
      amountMYR: cfg.price,
      reference: `SUB-${payment.id.substring(0, 8)}`,
      metadata: {
        type: "subscription",
        user_id: user.id,
        payment_id: payment.id,
        plan: "pro",
        credits: cfg.credits,
        days: cfg.days,
      },
      successRedirect: `${origin}/dashboard?payment=success`,
      failureRedirect: `${origin}/dashboard?payment=failed`,
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
    console.error("subscribe error:", e?.message);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
