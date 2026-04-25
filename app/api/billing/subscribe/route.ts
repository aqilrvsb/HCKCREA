import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChipPurchase } from "@/lib/chip";

const PLAN_PRICES: Record<string, { price: number; credits: number; days: number; name: string }> = {
  starter: { price: 47, credits: 100, days: 30, name: "Starter" },
  growth: { price: 147, credits: 350, days: 30, name: "Growth" },
  empire: { price: 397, credits: 1000, days: 30, name: "Empire" },
};

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const plan = body?.plan as string;
    const cfg = PLAN_PRICES[plan];
    if (!cfg) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, whatsapp")
      .eq("id", user.id)
      .single();

    const fullName = profile?.full_name || user.email?.split("@")[0] || "User";

    // Create payment record
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        type: "subscription",
        plan,
        amount: cfg.price,
        currency: "MYR",
        status: "pending",
        metadata: { plan, credits: cfg.credits, days: cfg.days },
      })
      .select()
      .single();

    if (payErr || !payment) {
      console.error("Failed to create payment:", payErr);
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    const origin = req.headers.get("origin") || process.env.APP_ORIGIN || "https://peninglab.vercel.app";
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

    const purchase = await createChipPurchase({
      email: user.email!,
      fullName,
      productName: `PeningLab ${cfg.name} — ${cfg.credits} credits / ${cfg.days} days`,
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
