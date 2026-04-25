import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsApp, buildLoginMessage } from "@/lib/whatsapp";

function generatePassword(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function POST(req: Request) {
  // Admin gate
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: meAdmin } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!meAdmin?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const paymentId = String(body?.payment_id || "");
  if (!paymentId) return NextResponse.json({ error: "Missing payment_id" }, { status: 400 });

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Need user_id (set after signup)
  let userId = payment.user_id;
  if (!userId) {
    const meta = payment.metadata || {};
    const email = (meta.signup?.email || "").toLowerCase();
    if (!email) return NextResponse.json({ error: "No user attached" }, { status: 400 });
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const u = list?.users?.find((x: any) => (x.email || "").toLowerCase() === email);
    if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 });
    userId = u.id;
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, whatsapp, plan, plan_expires_at")
    .eq("id", userId)
    .single();
  if (!profile?.whatsapp) {
    return NextResponse.json({ error: "User has no WhatsApp" }, { status: 400 });
  }

  // Generate fresh password and update
  const newPwd = generatePassword(12);
  await admin.auth.admin.updateUserById(userId, { password: newPwd });

  // Get user email
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email || (payment.metadata?.signup?.email ?? "");

  const origin = req.headers.get("origin") || process.env.APP_ORIGIN || "https://peninglab.vercel.app";
  const expiry = profile.plan_expires_at ? new Date(profile.plan_expires_at) : new Date(Date.now() + 30 * 86400000);

  const msg = buildLoginMessage({
    name: profile.full_name || "User",
    email,
    password: newPwd,
    plan: (profile.plan || "free").toUpperCase() + " Plan",
    expiresAt: expiry,
    loginUrl: `${origin}/login`,
  });

  const sent = await sendWhatsApp(profile.whatsapp, msg);

  await admin
    .from("payments")
    .update({
      metadata: {
        ...(payment.metadata || {}),
        whatsapp_sent: sent,
        whatsapp_sent_at: sent ? new Date().toISOString() : null,
        whatsapp_resent_by: user.id,
        whatsapp_resent_at: new Date().toISOString(),
      },
    })
    .eq("id", payment.id);

  return NextResponse.json({ ok: true, sent });
}
