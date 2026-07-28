import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlanKey, loadPlan } from "@/lib/plans";
import { notifyAdmins } from "@/lib/whatsapp";

// 4-tier subscribe flow — MANUAL Touch 'n Go (no Chip/FPX).
//
// CHIP/FPX was removed for plans (slow + takes a cut), mirroring the credit
// top-up flow. Now: the client transfers the plan price to the admin's Touch
// 'n Go account, uploads the transfer screenshot, and submits. This creates a
// `subscription` payment with status='pending'. The plan + expiry + credits are
// granted ONLY when an admin approves the screenshot on /admin/transactions
// (see /api/admin/topups/approve → applySubscription). Price/days/credits/label
// come from app_settings.plan_<key> via loadPlan() so admin can tune any tier.

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

    // Proof screenshot is mandatory — nothing to approve without it.
    const proofUrl = String(body?.proof_url || "").trim();
    if (!proofUrl || !/^https?:\/\//i.test(proofUrl)) {
      return NextResponse.json(
        { error: "Sila upload screenshot transfer dulu sebelum submit." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const cfg = await loadPlan(admin, plan);

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, whatsapp")
      .eq("id", user.id)
      .single();

    // Look up the user's referred_by so the approval can grant a renewal
    // commission to the original referrer. Snapshotted here at submit time.
    const { data: refProfile } = await admin
      .from("profiles")
      .select("referred_by")
      .eq("id", user.id)
      .maybeSingle();
    const referredByCode = refProfile?.referred_by || null;

    // Create the payment in pending state. Admin approval flips it to paid and
    // calls applySubscription (plan + expiry = now + days, credits ADD).
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
          method: "tng",
          proof_url: proofUrl,
        },
      })
      .select("id")
      .single();

    if (payErr || !payment) {
      console.error("Failed to create subscription payment:", payErr);
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    // Alert admins on WhatsApp so they verify the screenshot + approve. Best-
    // effort — a notify failure must never block the client's submit.
    try {
      const now = new Date().toLocaleString("ms-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        dateStyle: "short",
        timeStyle: "short",
      });
      await notifyAdmins(
        [
          "⏳ *PeningLab — Langganan Pending Approval*",
          "",
          "Client dah transfer Touch 'n Go untuk plan & upload resit. Sila verify & approve.",
          "",
          `Plan     : ${cfg.label} (${cfg.days} hari)`,
          `Amount   : RM${Number(cfg.price).toFixed(2)}`,
          `Credits  : +${cfg.credits}`,
          `Name     : ${profile?.full_name || user.email?.split("@")[0] || "User"}`,
          `Email    : ${user.email || "-"}`,
          `WhatsApp : ${profile?.whatsapp || "-"}`,
          `Tarikh   : ${now} MYT`,
          "",
          "Approve di: Admin → Transactions → Langganan",
        ].join("\n")
      );
    } catch (e: any) {
      console.warn("[subscribe] admin notify failed:", e?.message);
    }

    return NextResponse.json({ ok: true, payment_id: payment.id });
  } catch (e: any) {
    console.error("subscribe error:", e?.message);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
