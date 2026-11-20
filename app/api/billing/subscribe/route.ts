import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChipPurchase } from "@/lib/chip";
import { isPlanKey, loadPlan } from "@/lib/plans";

// Plan subscribe / resubscribe — CHIP checkout (FPX / DuitNow QR).
//
// Re-activated 2026-11-20 (replaces the manual Touch 'n Go + screenshot flow).
// Reads price/days/credits/label from app_settings.plan_<key> via loadPlan().
// Creates a pending `subscription` payment + CHIP purchase and returns the
// checkout_url. CHIP's success_callback hits /api/payments/webhook, which
// re-verifies and calls applySubscription (plan + expiry + credits + renewal
// commission). Older manual TnG rows are still approvable in Admin.

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
      .select("full_name, referred_by")
      .eq("id", user.id)
      .maybeSingle();

    const fullName = profile?.full_name || user.email?.split("@")[0] || "User";
    // Snapshot referred_by so the webhook can grant a renewal commission to
    // the original referrer (unchanged on renewal).
    const referredByCode = profile?.referred_by || null;

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
          method: "chip",
        },
      })
      .select("id")
      .single();

    if (payErr || !payment) {
      console.error("Failed to create subscription payment:", payErr);
      return NextResponse.json({ error: "Gagal cipta payment" }, { status: 500 });
    }

    const origin = req.headers.get("origin") || process.env.APP_ORIGIN || "https://peninglab.com";

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
