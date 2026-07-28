import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applySubscription } from "@/lib/apply-subscription";

// POST /api/admin/topups/approve  { payment_id, action: "approve" | "reject" }
//
// Admin decision on a manual Touch 'n Go request — handles BOTH kinds:
//   • credit_topup  → APPROVE credits the wallet (profiles.credits += amount)
//     and logs a credit_transactions row (mirrors applyCreditTopup in the
//     Chip webhook).
//   • subscription  → APPROVE grants the plan + a fresh expiry + plan credits
//     via the shared applySubscription() (same logic the Chip webhook used).
// REJECT just marks the payment failed.
//
// Double-apply safe: the status flip pending → paid is done FIRST with an
// atomic guard (.eq("status","pending")). Only the request that wins the flip
// proceeds to grant, so a double-click / concurrent admin can never grant
// twice.
export const dynamic = "force-dynamic";

async function adminGate() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function POST(req: Request) {
  const adminUser = await adminGate();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const paymentId = String(body?.payment_id || "").trim();
  const action = body?.action === "reject" ? "reject" : "approve";
  if (!paymentId) return NextResponse.json({ error: "payment_id required" }, { status: 400 });

  const admin = createAdminClient();

  if (action === "reject") {
    const { data: rejected } = await admin
      .from("payments")
      .update({ status: "failed" })
      .eq("id", paymentId)
      .in("type", ["credit_topup", "subscription"])
      .eq("status", "pending")
      .select("id");
    if (!rejected?.length) {
      return NextResponse.json({ error: "Already processed or not found" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, action: "reject" });
  }

  // ── APPROVE ──
  // Atomic claim: pending → paid. Only the winner grants (wallet OR plan).
  const { data: claimed } = await admin
    .from("payments")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", paymentId)
    .in("type", ["credit_topup", "subscription"])
    .eq("status", "pending")
    .select("id, user_id, type, plan, credits, amount, metadata");
  if (!claimed?.length) {
    return NextResponse.json({ error: "Already processed or not found" }, { status: 409 });
  }
  const payment = claimed[0] as any;
  const userId = payment.user_id as string;

  // ── Subscription approval → grant plan + expiry + credits (shared logic). ──
  if (payment.type === "subscription") {
    if (!userId || !payment.plan) {
      return NextResponse.json({ ok: true, action: "approve", note: "no plan to apply" });
    }
    await applySubscription(admin, payment);
    return NextResponse.json({ ok: true, action: "approve", kind: "subscription", plan: payment.plan });
  }

  // ── Credit top-up approval → credit the wallet. ──
  const credits = Number(payment.credits || payment.metadata?.credits || 0);
  if (!userId || !credits) {
    return NextResponse.json({ ok: true, action: "approve", note: "no credits to add" });
  }

  // Credit the wallet (mirrors applyCreditTopup in the CHIP webhook).
  const { data: profile } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  const current = Number(profile?.credits || 0);
  const next = current + credits;

  await admin.from("profiles").update({ credits: next }).eq("id", userId);
  await admin.from("credit_transactions").insert({
    user_id: userId,
    amount: credits,
    balance_after: next,
    reason: `topup_${credits}`,
    metadata: { payment_id: payment.id, method: "tng", approved_by: adminUser.id },
  });

  return NextResponse.json({ ok: true, action: "approve", credited: credits, balance_after: next });
}
