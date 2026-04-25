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

// Send WhatsApp to ALL profiles where is_admin = true and whatsapp is set.
// Used for new-customer alerts so admin's phone pings on every signup/topup.
export async function notifyAdmins(message: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("whatsapp")
    .eq("is_admin", true)
    .not("whatsapp", "is", null);
  let count = 0;
  for (const row of (data || []) as Array<{ whatsapp: string | null }>) {
    if (!row.whatsapp) continue;
    if (await sendWhatsApp(row.whatsapp, message)) count++;
  }
  return count;
}

export function buildAdminPaymentAlert(opts: {
  type: "subscription" | "topup";
  customerName: string;
  customerEmail: string;
  customerWhatsapp: string;
  plan?: string;
  credits?: number;
  amountMYR: number;
  paymentId: string;
}): string {
  const heading =
    opts.type === "subscription"
      ? "💰 *Closing PeningLab — Subscription*"
      : "💰 *Closing PeningLab — Top Up*";

  const lines = [
    heading,
    "",
    `Status   : Berjaya ✅`,
    `Sales    : RM${opts.amountMYR.toFixed(2)}`,
    `Name     : ${opts.customerName}`,
    `Email    : ${opts.customerEmail}`,
    `WhatsApp : ${opts.customerWhatsapp}`,
  ];
  if (opts.plan) lines.push(`Plan     : ${opts.plan.toUpperCase()}`);
  if (opts.credits) lines.push(`Credits  : +${opts.credits}`);
  lines.push(`Tarikh   : ${new Date().toLocaleString("ms-MY", { dateStyle: "short", timeStyle: "short" })}`);
  lines.push(`Ref      : ${opts.paymentId.slice(0, 8)}`);

  return lines.join("\n");
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
