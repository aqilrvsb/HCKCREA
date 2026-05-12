import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchChipPurchase, mapChipStatus } from "@/lib/chip";
import { getReferralCommissionRate } from "@/lib/settings";
import {
  sendWhatsApp,
  buildLoginMessage,
  notifyAdmins,
  buildAdminPaymentAlert,
} from "@/lib/whatsapp";

// Resolve a referrer's user.id from a referral_code, validating
// (a) it exists, (b) it's not the same user (self-ref guard), and
// (c) the code matches the strict format. Returns null on any failure.
async function resolveReferrer(
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
async function grantReferralCommission(
  admin: any,
  args: {
    referrerId: string;
    referredUserId: string;
    paymentId: string;
    paymentAmount: number;
  }
): Promise<void> {
  // Idempotency: don't double-credit if webhook fires twice for the
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

  // Increment wallet_balance. Read-then-write is not atomic but the
  // webhook is the only writer that mutates wallet_balance (cashout
  // payments deduct via a different code path), and Chip serializes
  // its callbacks so concurrent writes here are rare in practice.
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
    } else if (payment.type === "checkout_signup") {
      await applyCheckoutSignup(admin, payment);
    }
  }

  return NextResponse.json({ ok: true, status: newStatus });
}

// Auto-register user + activate plan after a successful sign-up payment.
// Idempotent: re-running on an already-processed payment is a no-op (the
// short-circuit check above handles that).
async function applyCheckoutSignup(admin: any, payment: any) {
  const meta = payment.metadata || {};
  const signup = meta.signup || {};
  const email = String(signup.email || "").toLowerCase();
  const name = String(signup.name || "");
  const whatsapp = String(signup.whatsapp || "");
  const plan = String(payment.plan || meta.plan || "light");
  const days = Number(meta.days || 30);
  const freeCredits = Number(meta.free_credits || 0);

  if (!email) return;

  // Generate a temporary password — to be sent via WhatsApp
  const tempPassword = generatePassword(12);

  // Create user (idempotent — if exists, fetch existing)
  let userId: string | null = null;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: name, whatsapp },
  });

  if (createErr) {
    // Likely "User already registered" — look up existing
    const { data: existingList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = existingList?.users?.find((u: any) => (u.email || "").toLowerCase() === email);
    if (existing) {
      userId = existing.id;
      // Reset password so they can log in with the new temp creds. Hard-fail
      // if Supabase rejects the new password (e.g. fails the project's auth
      // password-strength policy) — otherwise we'd send a WhatsApp with a
      // password that was never actually saved, blocking login.
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password: tempPassword,
      });
      if (updErr) {
        console.error(
          `[checkout_signup] password update failed for ${email}:`,
          updErr.message
        );
        return;
      }
    } else {
      console.error("auth create failed (no existing match):", createErr);
      return;
    }
  } else {
    userId = created.user?.id || null;
  }

  if (!userId) return;

  // Resolve referrer from the cookie that was carried through checkout.
  // Self-ref guard is inside resolveReferrer.
  const referredByCode = String(meta.referred_by_code || "") || null;
  const referrerId = await resolveReferrer(admin, referredByCode, userId);

  // Ensure profile row + set plan + extend expiry + stamp referral_code
  // (first 8 chars of user.id, uppercase — matches the convention used
  // for backfilled rows in migration 0030_affiliate.sql).
  const now = new Date();
  const expiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const referralCode = userId.replace(/-/g, "").substring(0, 8).toUpperCase();

  // upsert profile
  await admin.from("profiles").upsert(
    {
      id: userId,
      full_name: name,
      whatsapp,
      plan,
      plan_expires_at: expiry.toISOString(),
      referral_code: referralCode,
      referred_by: referrerId ? referredByCode : null,
    },
    { onConflict: "id" }
  );

  // Add free credits if the plan grants any (currently 0 for both plans)
  if (freeCredits > 0) {
    const { data: profile } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();
    const next = Number(profile?.credits || 0) + freeCredits;
    await admin.from("profiles").update({ credits: next }).eq("id", userId);
    await admin.from("credit_transactions").insert({
      user_id: userId,
      amount: freeCredits,
      balance_after: next,
      reason: `signup_${plan}`,
      metadata: { payment_id: payment.id, plan },
    });
  }

  // Affiliate commission — first-purchase referral. Skipped silently
  // when the cookie was absent / invalid / self-ref.
  if (referrerId) {
    try {
      await grantReferralCommission(admin, {
        referrerId,
        referredUserId: userId,
        paymentId: payment.id,
        paymentAmount: Number(payment.amount || 0),
      });
    } catch (e: any) {
      console.error("[affiliate] checkout_signup commission failed:", e?.message);
    }
  }

  // Link the payment to the freshly created user
  await admin
    .from("payments")
    .update({
      user_id: userId,
      metadata: {
        ...meta,
        signup_completed_at: new Date().toISOString(),
        // NOTE: we store the temp password so admin can resend via WhatsApp
        // until the WhatsApp Business API is wired. This is sensitive — only
        // service-role can read this row; payments_select_own RLS prevents
        // the user from reading their own metadata via anon key.
        temp_password: tempPassword,
      },
    })
    .eq("id", payment.id);

  // Send login info to customer via WhatsApp Center
  try {
    const origin = process.env.APP_ORIGIN || "https://peninglab.vercel.app";
    const msg = buildLoginMessage({
      name,
      email,
      password: tempPassword,
      plan: plan.toUpperCase() + " Plan",
      expiresAt: expiry,
      loginUrl: `${origin}/login`,
    });
    const sent = await sendWhatsApp(whatsapp, msg);
    await admin
      .from("payments")
      .update({
        metadata: {
          ...meta,
          whatsapp_sent: sent,
          whatsapp_sent_at: sent ? new Date().toISOString() : null,
        },
      })
      .eq("id", payment.id);
    if (!sent) {
      console.warn(
        `[checkout_signup] WhatsApp send failed for ${whatsapp} — admin can resend from /admin`
      );
    }
  } catch (e: any) {
    console.error("[checkout_signup] WhatsApp send threw:", e?.message);
  }

  // Notify admin(s) of the new sale
  try {
    await notifyAdmins(
      buildAdminPaymentAlert({
        type: "subscription",
        customerName: name,
        customerEmail: email,
        customerWhatsapp: whatsapp,
        plan,
        amountMYR: Number(payment.amount || 0),
        paymentId: payment.id,
      })
    );
  } catch (e: any) {
    console.warn("[checkout_signup] admin notify failed:", e?.message);
  }
}

function generatePassword(len: number): string {
  // Curated set: no 0/O/o, 1/l/I to avoid OCR confusion on a phone screen.
  // Force at least one of each char class so the password passes Supabase
  // Auth's "require special character" / strong-password policy if the
  // project enables it.
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digit = "23456789";
  const sym = "!@#$";
  const all = upper + lower + digit + sym;
  const out: string[] = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digit[Math.floor(Math.random() * digit.length)],
    sym[Math.floor(Math.random() * sym.length)],
  ];
  for (let i = out.length; i < len; i++) {
    out.push(all[Math.floor(Math.random() * all.length)]);
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

async function applyCreditTopup(admin: any, payment: any) {
  const userId = payment.user_id;
  const credits = Number(payment.credits || payment.metadata?.credits || 0);
  if (!credits) return;

  const { data: profile } = await admin
    .from("profiles")
    .select("credits, full_name, whatsapp")
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

  // Notify admin
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(userId);
    await notifyAdmins(
      buildAdminPaymentAlert({
        type: "topup",
        customerName: profile?.full_name || "User",
        customerEmail: authUser?.user?.email || "",
        customerWhatsapp: profile?.whatsapp || "",
        credits,
        amountMYR: Number(payment.amount || 0),
        paymentId: payment.id,
      })
    );
  } catch (e: any) {
    console.warn("[topup] admin notify failed:", e?.message);
  }
}

async function applySubscription(admin: any, payment: any) {
  const userId = payment.user_id;
  const plan = payment.plan as string;
  const credits = Number(payment.metadata?.credits || 0);
  const days = Number(payment.metadata?.days || 30);

  const { data: profile } = await admin
    .from("profiles")
    .select("plan_expires_at, credits, full_name, whatsapp")
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

  // Affiliate commission — renewal. payment.metadata.referred_by_code was
  // stamped by /api/billing/subscribe at the moment the subscription
  // was created, snapshotting the user's referred_by at that time.
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
