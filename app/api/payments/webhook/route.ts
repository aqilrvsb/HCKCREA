import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchChipPurchase, mapChipStatus } from "@/lib/chip";

// Chip success_callback hits this with purchase data. We re-verify against
// Chip's API rather than trusting the webhook body, then update payment +
// either credit balance or plan_expires_at depending on payment.type.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const purchaseId: string | undefined = body?.id;
    if (!purchaseId) {
      return NextResponse.json({ error: "Missing purchase id" }, { status: 400 });
    }
    return await processPurchase(purchaseId);
  } catch (e: any) {
    console.error("webhook error:", e?.message);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Also support manual GET status check (used by the "Check status" buttons)
export async function GET(req: Request) {
  const url = new URL(req.url);
  const purchaseId = url.searchParams.get("id");
  if (!purchaseId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  return await processPurchase(purchaseId);
}

async function processPurchase(purchaseId: string) {
  const admin = createAdminClient();

  const chip = await fetchChipPurchase(purchaseId);
  const newStatus = mapChipStatus(chip.status);

  // Find our payment
  const { data: payment } = await admin
    .from("payments")
    .select("*")
    .eq("chip_purchase_id", purchaseId)
    .maybeSingle();

  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  // Idempotent — already paid? short circuit
  if (payment.status === "paid" && newStatus === "paid") {
    return NextResponse.json({ ok: true, status: "paid", message: "Already processed" });
  }

  await admin
    .from("payments")
    .update({
      status: newStatus,
      paid_at: newStatus === "paid" ? new Date().toISOString() : null,
      chip_transaction_id: chip.transaction_data?.id || chip.transaction?.id || null,
      metadata: {
        ...(payment.metadata || {}),
        chip_status: chip.status,
        last_checked_at: new Date().toISOString(),
      },
    })
    .eq("id", payment.id);

  // Apply the side-effect once when transitioning to paid
  if (newStatus === "paid" && payment.status !== "paid") {
    if (payment.type === "credit_topup") {
      await applyCreditTopup(admin, payment);
    } else if (payment.type === "subscription") {
      await applySubscription(admin, payment);
    }
  }

  return NextResponse.json({ ok: true, status: newStatus });
}

async function applyCreditTopup(admin: any, payment: any) {
  const userId = payment.user_id;
  const credits = Number(payment.credits || payment.metadata?.credits || 0);
  if (!credits) return;

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
    metadata: { payment_id: payment.id, chip_purchase_id: payment.chip_purchase_id },
  });
}

async function applySubscription(admin: any, payment: any) {
  const userId = payment.user_id;
  const plan = payment.plan as string;
  const credits = Number(payment.metadata?.credits || 0);
  const days = Number(payment.metadata?.days || 30);

  // Read current expiry — extend from later of (now, current expiry)
  const { data: profile } = await admin
    .from("profiles")
    .select("plan_expires_at, credits")
    .eq("id", userId)
    .single();

  const now = new Date();
  const currentExpiry = profile?.plan_expires_at
    ? new Date(profile.plan_expires_at)
    : null;
  const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  const currentCredits = Number(profile?.credits || 0);
  const nextCredits = currentCredits + credits;

  await admin
    .from("profiles")
    .update({
      plan,
      plan_expires_at: newExpiry.toISOString(),
      credits: nextCredits,
    })
    .eq("id", userId);

  if (credits > 0) {
    await admin.from("credit_transactions").insert({
      user_id: userId,
      amount: credits,
      balance_after: nextCredits,
      reason: `plan_${plan}`,
      metadata: { payment_id: payment.id, plan, days },
    });
  }
}
