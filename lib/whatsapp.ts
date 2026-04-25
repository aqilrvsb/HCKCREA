// WhatsApp Center (whacenter.com) sender — uses the admin's device instance
// to send messages to user phones. Server-side only.

import { createAdminClient } from "@/lib/supabase/admin";

const WHACENTER_API_URL = "https://api.whacenter.com";

function toMalayDigits(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("60") && digits.length >= 11 && digits.length <= 13) return digits;
  if (digits.startsWith("0") && digits.length >= 10 && digits.length <= 12) return "6" + digits;
  return null;
}

export async function sendWhatsApp(toPhone: string, message: string): Promise<boolean> {
  const number = toMalayDigits(toPhone);
  if (!number) {
    console.warn("[WA] invalid Malaysia phone:", toPhone);
    return false;
  }

  const admin = createAdminClient();
  const { data: device } = await admin
    .from("admin_device")
    .select("instance")
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (!device?.instance) {
    console.warn("[WA] no active admin_device — skipping send");
    return false;
  }

  const form = new URLSearchParams();
  form.append("device_id", device.instance);
  form.append("number", number);
  form.append("message", message);

  try {
    const res = await fetch(`${WHACENTER_API_URL}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn("[WA] send failed:", res.status, txt.substring(0, 200));
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn("[WA] network error:", e?.message);
    return false;
  }
}

export function buildLoginMessage(opts: {
  name: string;
  email: string;
  password: string;
  plan: string;
  expiresAt: Date;
  loginUrl: string;
}): string {
  return [
    "*Selamat datang ke PeningLab!* 🎉",
    "",
    `Salam ${opts.name},`,
    "",
    "Pembayaran anda berjaya — akaun anda sudah aktif.",
    "",
    "*Login info anda:*",
    `Email   : ${opts.email}`,
    `Password: ${opts.password}`,
    "",
    `Plan    : ${opts.plan}`,
    `Sah hingga: ${opts.expiresAt.toLocaleDateString("ms-MY", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`,
    "",
    `Login di: ${opts.loginUrl}`,
    "",
    "Sila tukar password lepas login pertama (Settings → Password).",
    "",
    "Sebarang masalah? Reply WhatsApp ini.",
  ].join("\n");
}
