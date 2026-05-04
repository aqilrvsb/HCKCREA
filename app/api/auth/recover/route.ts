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

// Compare two whatsapp numbers loosely — strips +, leading 0, leading 60
// so "+60136712256" / "60136712256" / "0136712256" / "136712256" all
// match. Handles legacy stored formats from before normalizeWhatsapp existed.
function whatsappMatches(a: string, b: string): boolean {
  const strip = (s: string) => {
    const d = (s || "").replace(/\D/g, "");
    if (d.startsWith("60")) return d.slice(2);
    if (d.startsWith("0")) return d.slice(1);
    return d;
  };
  const aa = strip(a);
  const bb = strip(b);
  return !!aa && aa === bb;
}

function generatePassword(len: number): string {
  // Curated set: no 0/O/o, 1/l/I — those get OCR-confused on a phone screen.
  // Force at least one uppercase, one lowercase, one digit, one symbol so the
  // password passes Supabase Auth password-strength policies even if the
  // project enables "require special character".
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
  // Shuffle so the guaranteed chars aren't always at the start
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
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

    if (!profile?.whatsapp || !whatsappMatches(profile.whatsapp, whatsapp)) {
      return generic; // silent failure for security (don't reveal account existence)
    }

    // Generate new temp password and update
    const tempPassword = generatePassword(12);
    const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
      password: tempPassword,
    });
    if (updErr) {
      console.error("recover: password update failed:", updErr.message);
      return NextResponse.json(
        {
          error:
            "Tak boleh reset password sekarang — sila hubungi support. (Server: " +
            updErr.message.slice(0, 100) +
            ")",
        },
        { status: 500 }
      );
    }

    // Send via WhatsApp — use the stored profile number (canonical format)
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
    const sent = await sendWhatsApp(profile.whatsapp, msg);

    // Surface a service-level failure (WhatsApp Center down, no admin_device,
    // etc.) so the user knows to contact support instead of waiting forever.
    // Email/whatsapp mismatch still falls through to the generic message
    // above for security — only this branch tells the truth.
    if (!sent) {
      return NextResponse.json(
        {
          error:
            "WhatsApp gateway sedang down — sila cuba lagi dalam beberapa minit atau hubungi support.",
        },
        { status: 502 }
      );
    }

    return generic;
  } catch (e: any) {
    console.error("recover error:", e?.message);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}
