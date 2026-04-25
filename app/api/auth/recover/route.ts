import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsApp, buildLoginMessage } from "@/lib/whatsapp";

function normalizeWhatsapp(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 13) return null;
  if (digits.startsWith("60")) return "+" + digits;
  if (digits.startsWith("0")) return "+60" + digits.slice(1);
  return "+60" + digits;
}

function generatePassword(len: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const whatsapp = normalizeWhatsapp(String(body?.whatsapp || ""));

    if (!email || !whatsapp) {
      return NextResponse.json(
        { error: "Email dan WhatsApp diperlukan." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    // Find user by email
    const { data: list } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    const user = list?.users?.find(
      (u: any) => (u.email || "").toLowerCase() === email
    );

    // Generic response to avoid revealing whether email exists
    const generic = NextResponse.json({
      ok: true,
      message:
        "Jika email + WhatsApp anda padan, kami akan hantar login info di WhatsApp anda.",
    });

    if (!user) return generic;

    // Verify whatsapp matches our records
    const { data: profile } = await admin
      .from("profiles")
      .select("whatsapp, full_name, plan, plan_expires_at")
      .eq("id", user.id)
      .single();

    if (!profile?.whatsapp || profile.whatsapp !== whatsapp) {
      return generic; // silent failure — same response
    }

    // Generate new temp password and update
    const tempPassword = generatePassword(12);
    await admin.auth.admin.updateUserById(user.id, { password: tempPassword });

    // Send via WhatsApp
    const origin =
      req.headers.get("origin") ||
      process.env.APP_ORIGIN ||
      "https://peninglab.vercel.app";

    const expiry = profile.plan_expires_at
      ? new Date(profile.plan_expires_at)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const msg = buildLoginMessage({
      name: profile.full_name || "User",
      email,
      password: tempPassword,
      plan: (profile.plan || "free").toUpperCase() + " Plan",
      expiresAt: expiry,
      loginUrl: `${origin}/login`,
    });
    await sendWhatsApp(whatsapp, msg);

    return generic;
  } catch (e: any) {
    console.error("recover error:", e?.message);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
