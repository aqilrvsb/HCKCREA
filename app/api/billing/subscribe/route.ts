import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChipPurchase } from "@/lib/chip";
import { isPlanKey, loadPlan } from "@/lib/plans";

// 4-tier subscribe flow. Reads price/days/credits/label from
// app_settings.plan_<key> via loadPlan() so admin can tune any tier
// in /admin/settings without a redeploy.

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const planRaw = String(body?.plan || "").toLowerCase();
    if (!isPlanKey(planRaw)) {
      return NextResponse.json(
        { error: "Invalid plan. Expected one of: starter, standard, pro, premium" },
        { status: 400 }
      );
    }
    const plan = planRaw;

    const admin = createAdminClient();
    const cfg = await loadPlan(admin, plan);

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, whatsapp")
      .eq("id", user.id)
      .single();

    const fullName = profile?.full_name || user.email?.split("@")[0] || "User";

    // Look up the user's referred_by so the webhook can grant a renewal
    // commission to the original referrer. Stored at signup time;
    // unchanged on renewal.
    const { data: refProfile } = await admin
      .from("profiles")
      .select("referred_by")
      .eq("id", user.id)
      .maybeSingle();
    const referredByCode = refProfile?.referred_by || null;

    // Create payment record in pending state. Webhook will flip to paid +
    // call applySubscription which sets plan_expires_at = now + days.
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        type: "subscription",
        plan,
        amount: cfg.price,
        currency: "MYR",
        status: "pending",
        metadata: {
          plan,
          credits: cfg.credits,
          days: cfg.days,
          label: cfg.label,
          referred_by_code: referredByCode,
        },
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
      productName: `PeningLab ${cfg.label} Plan — ${cfg.days} days`,
      amountMYR: cfg.price,
      reference: `SUB-${payment.id.substring(0, 8)}`,
      metadata: {
        type: "subscription",
        user_id: user.id,
        payment_id: payment.id,
        plan,
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
