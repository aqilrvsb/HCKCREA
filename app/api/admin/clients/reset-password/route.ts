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
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: meAdmin } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!meAdmin?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.user_id || "");
  if (!userId) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const admin = createAdminClient();
  const newPwd = generatePassword(12);
  await admin.auth.admin.updateUserById(userId, { password: newPwd });

  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email || "";
  const { data: profile } = await admin
    .from("profiles")
    .select("full_name, whatsapp, plan, plan_expires_at")
    .eq("id", userId)
    .single();

  let sent = false;
  if (profile?.whatsapp && email) {
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
    sent = await sendWhatsApp(profile.whatsapp, msg);
  }

  return NextResponse.json({ ok: true, sent });
}
