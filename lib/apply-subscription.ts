// Shared subscription-grant logic. Used by BOTH:
//   • the Chip/FPX webhook (app/api/payments/webhook) — legacy online path
//   • the manual Touch 'n Go approval (app/api/admin/topups/approve) — the
//     current path: client transfers TnG + uploads proof, admin approves.
//
// Extracted verbatim from the webhook so there is ONE source of truth for how
// a plan purchase grants plan + expiry + credits + livehost config + affiliate
// commission. Keeping this in one place avoids the billing-logic drift that
// caused past double-charge / miscredit bugs.

import { getReferralCommissionRate } from "@/lib/settings";
import { notifyAdmins, buildAdminPaymentAlert } from "@/lib/whatsapp";

// Resolve a referrer's user.id from a referral_code, validating
// (a) it exists, (b) it's not the same user (self-ref guard), and
// (c) the code matches the strict format. Returns null on any failure.
export async function resolveReferrer(
  admin: any,
  referredByCode: string | null | undefined,
  referredUserId: string
): Promise<string | null> {
  if (!referredByCode) return null;
  if (!/^[A-Z0-9]{4,16}$/.test(referredByCode)) return null;
  const { data: ref } = await admin
    .from("profiles")
    .select("id, referral_code")
    .eq("referral_code", referredByCode)
    .maybeSingle();
  if (!ref) return null;
  // Self-ref guard — a user can't refer themselves.
  if (ref.id === referredUserId) return null;
  return ref.id as string;
}

// Grants a subscription commission to the referrer. Idempotent against
// payment_id — if a commission row already exists for this payment we
// skip. Wallet balance is incremented atomically (best-effort).
export async function grantReferralCommission(
  admin: any,
  args: {
    referrerId: string;
    referredUserId: string;
    paymentId: string;
    paymentAmount: number;
  }
): Promise<void> {
  // Idempotency: don't double-credit if the grant fires twice for the
  // same payment.
  const { data: existing } = await admin
    .from("referral_commissions")
    .select("id")
    .eq("payment_id", args.paymentId)
    .maybeSingle();
  if (existing) return;

  const rate = await getReferralCommissionRate(); // percent, e.g. 20
  const amount = Number(((args.paymentAmount * rate) / 100).toFixed(2));
  if (amount <= 0) return;

  // Insert commission row
  const { error: insertErr } = await admin
    .from("referral_commissions")
    .insert({
      referrer_id: args.referrerId,
      referred_user_id: args.referredUserId,
      payment_id: args.paymentId,
      payment_amount: args.paymentAmount,
      commission_rate: rate,
      commission_amount: amount,
      commission_type: "subscription",
    });
  if (insertErr) {
    console.error("[affiliate] commission insert failed:", insertErr.message);
    return;
  }

  // Increment wallet_balance. Read-then-write is not atomic but writes here
  // are serialized in practice (webhook / admin approval, not concurrent).
  const { data: refProfile } = await admin
    .from("profiles")
    .select("wallet_balance")
    .eq("id", args.referrerId)
    .maybeSingle();
  const currentBalance = Number(refProfile?.wallet_balance || 0);
  await admin
    .from("profiles")
    .update({ wallet_balance: currentBalance + amount })
    .eq("id", args.referrerId);
}

// Applies a PAID subscription to the user's profile: sets plan + a fresh
// expiry, ADDS the plan's credits (recovering any negative balance), keeps
// Livehost GPU appointment, ledgers the credit grant, and pays the referrer.
// Safe to call once per payment (the caller flips status pending → paid with
// an atomic guard first, so this runs exactly once).
export async function applySubscription(admin: any, payment: any) {
  const userId = payment.user_id;
  const plan = payment.plan as string;
  const credits = Number(payment.metadata?.credits || 0);
  const days = Number(payment.metadata?.days || 30);

  const { data: profile } = await admin
    .from("profiles")
    .select("plan_expires_at, credits, full_name, whatsapp")
    .eq("id", userId)
    .single();

  // 4-tier policy: every purchase resets the cycle to a fresh N days from now.
  // Users knowingly forfeit remaining days when buying again. Credits still ADD
  // to the existing balance (see nextCredits below) — so a negative balance is
  // recovered on the next purchase.
  const now = new Date();
  const newExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

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

  // LIVEHOST renewal: keep the client auto-appointed (gpu_allowed) so their
  // dedicated GPU on/off keeps working. Created on Turn ON / deleted on OFF.
  if (plan === "livehost") {
    const { data: existingCfg } = await admin
      .from("live_client_config").select("user_id").eq("user_id", userId).maybeSingle();
    if (existingCfg) {
      await admin.from("live_client_config").update({ gpu_allowed: true, updated_at: now.toISOString() }).eq("user_id", userId);
    } else {
      await admin.from("live_client_config").insert({ user_id: userId, gpu_allowed: true, backend_url: "", updated_at: now.toISOString() });
    }
  }

  if (credits > 0) {
    await admin.from("credit_transactions").insert({
      user_id: userId,
      amount: credits,
      balance_after: nextCredits,
      reason: `plan_${plan}`,
      metadata: { payment_id: payment.id, plan, days },
    });
  }

  // Affiliate commission — renewal. payment.metadata.referred_by_code was
  // stamped by /api/billing/subscribe at the moment the subscription was
  // created, snapshotting the user's referred_by at that time.
  const referredByCode = String(payment.metadata?.referred_by_code || "") || null;
  const referrerId = await resolveReferrer(admin, referredByCode, userId);
  if (referrerId) {
    try {
      await grantReferralCommission(admin, {
        referrerId,
        referredUserId: userId,
        paymentId: payment.id,
        paymentAmount: Number(payment.amount || 0),
      });
    } catch (e: any) {
      console.error("[affiliate] subscription commission failed:", e?.message);
    }
  }

  // Admin alert
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    await notifyAdmins(
      buildAdminPaymentAlert({
        type: "subscription",
        customerName: profile?.full_name || "User",
        customerEmail: authUser?.user?.email || "",
        customerWhatsapp: profile?.whatsapp || "",
        plan,
        amountMYR: Number(payment.amount || 0),
        paymentId: payment.id,
      })
    );
  } catch (e: any) {
    console.warn("[subscription] admin notify failed:", e?.message);
  }
}
