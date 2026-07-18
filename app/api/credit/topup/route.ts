import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChipPurchase } from "@/lib/chip";

// Standalone credit top-up (RM1 = 1 credit). Re-enabled alongside the
// 4-tier subscription plans so users who prefer to pay per credit
// without committing to a 30-day plan have a clear path. The dashboard
// sidebar nav exposes this via "Top Up Credit".

// Manual top-up now allows ANY whole-RM amount in this range (RM1 = 1 credit),
// not just the preset package tiles. Bounds keep CHIP happy and block typos.
const MIN_CREDITS = 1;
const MAX_CREDITS = 1000;

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const credits = Math.round(Number(body?.credits));
    if (!Number.isFinite(credits) || credits < MIN_CREDITS || credits > MAX_CREDITS) {
      return NextResponse.json(
        { error: `Amount must be between RM${MIN_CREDITS} and RM${MAX_CREDITS}` },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .single();

    const fullName = profile?.full_name || user.email?.split("@")[0] || "User";
    const amountMYR = credits; // RM1 = 1 credit

    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        type: "credit_topup",
        credits,
        amount: amountMYR,
        currency: "MYR",
        status: "pending",
        metadata: { credits },
      })
      .select()
      .single();

    if (payErr || !payment) {
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    const origin = req.headers.get("origin") || process.env.APP_ORIGIN || "https://peninglab.vercel.app";

    const purchase = await createChipPurchase({
      email: user.email!,
      fullName,
      productName: `PeningLab ${credits} Credits Top-Up`,
      amountMYR,
      reference: `TOPUP-${payment.id.substring(0, 8)}`,
      metadata: {
        type: "credit_topup",
        user_id: user.id,
        payment_id: payment.id,
        credits,
      },
      successRedirect: `${origin}/dashboard?topup=success`,
      failureRedirect: `${origin}/dashboard?topup=failed`,
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
    console.error("topup error:", e?.message);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
