import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsApp, buildLoginMessage, notifyAdmins } from "@/lib/whatsapp";
import { getSetting } from "@/lib/settings";

// Admin-only API for managing affiliate sign-up applications.
//
//   GET    /api/admin/affiliate?status=pending  → list applications
//   POST   /api/admin/affiliate                  → approve or reject one
//
// On approve, the row triggers user creation:
//   - Supabase auth user with the application's email + temp password
//   - profiles row: plan="pro", plan_expires_at=now+30d, credits=10,
//     referral_code=first 8 hex chars of user.id (upper)
//   - Login details (email + temp password) sent to the applicant
//     via WhatsApp Center using the same template as paid signups.

async function adminGate() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return null;
  return user;
}

function generatePassword(len: number): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const out: string[] = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
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

// ─── GET — list applications, optional status filter ─────────────────
export async function GET(req: Request) {
  if (!(await adminGate())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "pending").toLowerCase();

  const admin = createAdminClient();
  let q = admin
    .from("affiliate_applications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (
    status === "pending" ||
    status === "approved" ||
    status === "rejected"
  ) {
    q = q.eq("status", status);
  }

  const { data } = await q;
  return NextResponse.json({ rows: data || [] });
}

// ─── POST — approve or reject ────────────────────────────────────────
export async function POST(req: Request) {
  const adminUser = await adminGate();
  if (!adminUser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const action = String(body?.action || "");
  const adminNote = body?.admin_note ? String(body.admin_note).slice(0, 500) : null;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be approve | reject" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: app } = await admin
    .from("affiliate_applications")
    .select("*")
    .eq("id", id)
    .single();
  if (!app) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }
  if (app.status !== "pending") {
    return NextResponse.json(
      { error: `Application is already ${app.status}` },
      { status: 400 }
    );
  }

  // ── REJECT ───────────────────────────────────────────────────────
  if (action === "reject") {
    const { error: updErr } = await admin
      .from("affiliate_applications")
      .update({
        status: "rejected",
        admin_note: adminNote,
        approved_by: adminUser.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updErr) {
      return NextResponse.json(
        { error: "Update failed", detail: updErr.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, action: "rejected" });
  }

  // ── APPROVE — create user + send WhatsApp ────────────────────────
  const tempPassword = generatePassword(12);
  const email = (app.email as string).toLowerCase();
  const fullName = app.full_name as string;
  const whatsapp = app.whatsapp as string;

  // Try create; on conflict (already-registered) reuse the existing user
  let userId: string | null = null;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, whatsapp },
  });

  if (createErr) {
    // Likely "User already registered" — look up + reset password.
    const { data: existingList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 500,
    });
    const existing = existingList?.users?.find(
      (u: any) => (u.email || "").toLowerCase() === email
    );
    if (existing) {
      userId = existing.id;
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password: tempPassword,
      });
      if (updErr) {
        return NextResponse.json(
          {
            error: "Password update failed for existing user",
            detail: updErr.message,
          },
          { status: 500 }
        );
      }
    } else {
      console.error("auth create failed (no existing match):", createErr);
      return NextResponse.json(
        { error: "Failed to create user", detail: createErr.message },
        { status: 500 }
      );
    }
  } else {
    userId = created.user?.id || null;
  }

  if (!userId) {
    return NextResponse.json({ error: "Failed to resolve user id" }, { status: 500 });
  }

  // Setup the profile — 30-day Pro plan, N credits, fresh referral_code.
  // N is configurable via the `affiliate_signup_credits` admin setting
  // (key in app_settings → { credits: <number> }). Defaults to 10 if the
  // setting is missing or invalid, matching the pre-config behaviour.
  const now = new Date();
  const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const referralCode = userId.replace(/-/g, "").substring(0, 8).toUpperCase();
  const signupCreditsSetting = await getSetting<{ credits: number }>(
    "affiliate_signup_credits"
  );
  const signupCredits = (() => {
    const n = Number(signupCreditsSetting?.credits);
    return Number.isFinite(n) && n >= 0 ? n : 10;
  })();

  await admin.from("profiles").upsert(
    {
      id: userId,
      full_name: fullName,
      whatsapp,
      plan: "pro",
      plan_expires_at: expiry.toISOString(),
      credits: signupCredits,
      referral_code: referralCode,
    },
    { onConflict: "id" }
  );

  // Log the credit grant as a transaction so it shows up in usage
  // reports and the user's credit history. Skipped when admin set
  // credits to 0 (zero-amount transactions clutter the ledger).
  if (signupCredits > 0) {
    await admin.from("credit_transactions").insert({
      user_id: userId,
      amount: signupCredits,
      balance_after: signupCredits,
      reason: "affiliate_signup_bonus",
      metadata: { application_id: app.id, approved_by: adminUser.id },
    });
  }

  // Flip the application row to approved.
  const { error: appUpdErr } = await admin
    .from("affiliate_applications")
    .update({
      status: "approved",
      approved_user_id: userId,
      approved_by: adminUser.id,
      approved_at: now.toISOString(),
      admin_note: adminNote,
      updated_at: now.toISOString(),
    })
    .eq("id", id);
  if (appUpdErr) {
    console.error("[affiliate-approve] app row update failed:", appUpdErr.message);
  }

  // Send the WhatsApp login message. Best-effort; admin can resend
  // manually if delivery fails.
  let waSent = false;
  try {
    const origin = process.env.APP_ORIGIN || "https://peninglab.vercel.app";
    const msg = buildLoginMessage({
      name: fullName,
      email,
      password: tempPassword,
      plan: "AFFILIATE Pro",
      expiresAt: expiry,
      loginUrl: `${origin}/login`,
      // Approved affiliates get the affiliate-only community group.
      groupKind: "affiliate",
    });
    waSent = await sendWhatsApp(whatsapp, msg);
    if (!waSent) {
      console.warn(
        `[affiliate-approve] WhatsApp send failed for ${whatsapp} — admin can resend.`
      );
    }
  } catch (e: any) {
    console.error("[affiliate-approve] WhatsApp send threw:", e?.message);
  }

  // Heads-up to admins.
  try {
    await notifyAdmins(
      [
        "✅ Affiliate Approved",
        "",
        `Name: ${fullName}`,
        `Email: ${email}`,
        `WhatsApp: ${whatsapp}`,
        `Referral code: ${referralCode}`,
        `Plan: Pro · 30 days · 10 credits`,
        `WA login sent: ${waSent ? "yes" : "FAILED — please resend"}`,
      ].join("\n")
    );
  } catch (e: any) {
    console.warn("[affiliate-approve] admin notify failed:", e?.message);
  }

  return NextResponse.json({
    ok: true,
    action: "approved",
    user_id: userId,
    referral_code: referralCode,
    whatsapp_sent: waSent,
    // Return the temp password so the admin UI can offer a manual copy
    // fallback if the WhatsApp send failed. NOT logged — service-role
    // only path; UI shows it inline once and then it's gone.
    temp_password: waSent ? null : tempPassword,
  });
}
