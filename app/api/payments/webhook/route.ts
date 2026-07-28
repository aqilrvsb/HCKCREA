import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchChipPurchase, mapChipStatus } from "@/lib/chip";
import {
  sendWhatsApp,
  buildLoginMessage,
  notifyAdmins,
  buildAdminPaymentAlert,
} from "@/lib/whatsapp";
import { sendPurchase } from "@/lib/fb-capi";
import {
  resolveReferrer,
  grantReferralCommission,
  applySubscription,
} from "@/lib/apply-subscription";

// resolveReferrer, grantReferralCommission, applySubscription now live in
// lib/apply-subscription.ts so the manual Touch 'n Go approval path shares the
// exact same grant logic (imported above).

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

  // Already paid? short circuit on the read-side. The atomic CAS
  // below is the real guard against concurrent retries.
  if (payment.status === "paid" && newStatus === "paid") {
    return NextResponse.json({ ok: true, status: "paid", message: "Already processed" });
  }

  // ATOMIC CAS: only update the row if status hasn't already flipped
  // to paid. Chip retries the webhook multiple times for the same
  // purchase (network blips, slow ack), so 5 concurrent calls could
  // all read status='pending' here. Without the .neq guard, all 5
  // would transition the row + run side-effects + spam admin
  // notifications. With it, only the first call to claim the row
  // gets a non-empty `claimed` array — the rest see 0 rows updated
  // and skip side-effects.
  const { data: claimed } = await admin
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
    .eq("id", payment.id)
    .neq("status", newStatus)
    .select("id");

  const transitioned = !!(claimed && claimed.length > 0);

  // Apply the side-effect ONLY when this call won the CAS race.
  // Otherwise another concurrent webhook call already did the work.
  if (newStatus === "paid" && transitioned) {
    if (payment.type === "credit_topup") {
      await applyCreditTopup(admin, payment);
    } else if (payment.type === "subscription") {
      await applySubscription(admin, payment);
    } else if (payment.type === "checkout_signup") {
      await applyCheckoutSignup(admin, payment);
    }

    // Fire server-side Facebook CAPI Purchase event for ad attribution.
    // Same event_id as the browser fbq Purchase fired from /payment/success
    // so Meta dedupes (browser+server count as ONE conversion). Fire-and-
    // forget — CAPI failures must NOT block the payment flow.
    void fireCapiPurchase(admin, payment).catch((e) =>
      console.warn("[capi] purchase failed:", e?.message)
    );
  }

  return NextResponse.json({
    ok: true,
    status: newStatus,
    side_effects: transitioned ? "fired" : "skipped-race",
  });
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

  // LIVEHOST: AUTO-APPOINT the client to a GPU on payment (1 GPU = 1 client).
  // gpu_allowed=true lets them turn their dedicated GPU on/off at the Usage tab.
  // The GPU itself is CREATED on Turn ON (minNum:1, no timeout) and DELETED on
  // Turn OFF ($0) — see lib/livehost-pool.ts setClientGpu. Fully automatic.
  if (plan === "livehost") {
    const { data: existingCfg } = await admin
      .from("live_client_config").select("user_id").eq("user_id", userId).maybeSingle();
    if (existingCfg) {
      await admin.from("live_client_config").update({ gpu_allowed: true, updated_at: now.toISOString() }).eq("user_id", userId);
    } else {
      await admin.from("live_client_config").insert({ user_id: userId, gpu_allowed: true, backend_url: "", updated_at: now.toISOString() });
    }
  }

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
    // WhatsApp group is a paid-tier perk — only Pro and Premium get the
    // invite (mirrors the sidebar gating in app/dashboard/sidebar.tsx).
    // Starter/Standard register without a group link; groupKind omitted
    // so buildLoginMessage skips the group block entirely.
    const groupKind =
      plan === "premium"
        ? "premium"
        : plan === "pro"
          ? "pro"
          : plan === "livehost"
            ? "livehost"
            : undefined;
    const msg = buildLoginMessage({
      name,
      email,
      password: tempPassword,
      plan: plan.toUpperCase() + " Plan",
      expiresAt: expiry,
      loginUrl: `${origin}/login`,
      groupKind,
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

  // Notify admin(s) of the new sale. Look up the referrer's email
  // when this signup was through an affiliate link so the alert
  // shows who gets the commission.
  let referrerEmail: string | null = null;
  if (referrerId) {
    try {
      const { data: ref } = await admin.auth.admin.getUserById(referrerId);
      referrerEmail = ref?.user?.email || null;
    } catch (e: any) {
      console.warn("[checkout_signup] referrer email lookup failed:", e?.message);
    }
  }
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
        referrerEmail,
      })
    );
  } catch (e: any) {
    console.warn("[checkout_signup] admin notify failed:", e?.message);
  }
}

// Send the Purchase event to Meta's Conversions API. user_data is
// pulled from the freshest source for each payment type:
//   - checkout_signup → metadata.signup (email/whatsapp typed at checkout)
//   - subscription / credit_topup → auth.users + profiles for the user_id
// external_id is always the payments.user_id (or null for unlinked signups).
async function fireCapiPurchase(admin: any, payment: any): Promise<void> {
  const value = Number(payment.amount || 0);
  if (value <= 0) return; // can't attribute revenue with no value

  const meta = payment.metadata || {};
  let email: string | null = null;
  let phone: string | null = null;
  let externalId: string | null = payment.user_id || null;

  if (payment.type === "checkout_signup") {
    const signup = meta.signup || {};
    email = String(signup.email || "").toLowerCase() || null;
    phone = String(signup.whatsapp || "") || null;
  } else if (payment.user_id) {
    // Look up the auth email + profile WhatsApp so server-side hashed
    // PII matches what the user submits on next login (Meta uses these
    // to attribute the ad click to a person).
    try {
      const [authRes, profRes] = await Promise.all([
        admin.auth.admin.getUserById(payment.user_id),
        admin.from("profiles").select("whatsapp").eq("id", payment.user_id).maybeSingle(),
      ]);
      email = authRes?.data?.user?.email?.toLowerCase() || null;
      phone = profRes?.data?.whatsapp || null;
    } catch {
      // PII lookup is best-effort — Meta accepts CAPI events with
      // external_id alone, just with weaker match quality.
    }
  }

  const contentName =
    payment.type === "credit_topup"
      ? `Credit Top-up (${payment.credits || meta.credits || 0})`
      : payment.type === "subscription"
        ? `${String(payment.plan || "").toUpperCase()} Plan`
        : "Pro Plan";

  await sendPurchase({
    orderId: payment.id, // == browser fbq eventID → Meta dedupes
    value,
    currency: payment.currency || "MYR",
    contentName,
    userData: {
      email,
      phone,
      external_id: externalId,
    },
    eventSourceUrl: "https://peninglab.com/payment/success",
  });
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

