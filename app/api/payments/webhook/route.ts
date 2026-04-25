import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchChipPurchase, mapChipStatus } from "@/lib/chip";
import {
  sendWhatsApp,
  buildLoginMessage,
  notifyAdmins,
  buildAdminPaymentAlert,
} from "@/lib/whatsapp";

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
      // Reset password so they can log in with the new temp creds
      await admin.auth.admin.updateUserById(userId, { password: tempPassword });
    } else {
      console.error("auth create failed (no existing match):", createErr);
      return;
    }
  } else {
    userId = created.user?.id || null;
  }

  if (!userId) return;

  // Ensure profile row + set plan + extend expiry
  const now = new Date();
  const expiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // upsert profile
  await admin.from("profiles").upsert(
    {
      id: userId,
      full_name: name,
      whatsapp,
      plan,
      plan_expires_at: expiry.toISOString(),
      // Add free credits on top of whatever they had (likely 0 for new signup)
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
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
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
