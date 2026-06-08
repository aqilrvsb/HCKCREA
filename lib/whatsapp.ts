// WhatsApp Center (whacenter.com) sender — uses the admin's device instance
// to send messages to user phones. Server-side only.

import { createAdminClient } from "@/lib/supabase/admin";

const WHACENTER_API_URL = "https://api.whacenter.com";

// WhatsApp group invite URLs. Keep all literals here so the message
// builder can pick the right one by KIND and call sites can NEVER
// accidentally pass the wrong link — they choose the audience, not
// the URL.
//
// Three audiences (per user direction 2026-06-08):
//   - Affiliate: affiliate-only community (any plan with affiliate role)
//   - PRO tier:  paying customers on the Pro plan (RM 120)
//   - PREMIUM tier: paying customers on Premium plan (RM 200) — VIP
//                   tier with One-on-One Zoom access; separate group
//                   from Pro for a more curated community.
export const WHATSAPP_GROUP_AFFILIATE = "https://chat.whatsapp.com/CRp8ctg8Y40IBrtlPbuCQ2";
export const WHATSAPP_GROUP_PRO = "https://chat.whatsapp.com/BPORSI7khdIEOGZzWYBwbS";
export const WHATSAPP_GROUP_PREMIUM = "https://chat.whatsapp.com/D0rL4xE5qspKIoEDpCaiFd";

export type WhatsappGroupKind = "pro" | "premium" | "affiliate";

export function whatsappGroupUrl(kind: WhatsappGroupKind): string {
  if (kind === "affiliate") return WHATSAPP_GROUP_AFFILIATE;
  if (kind === "premium") return WHATSAPP_GROUP_PREMIUM;
  return WHATSAPP_GROUP_PRO;
}

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
  /** Email of the affiliate referrer, if any. When set, replaces the
   *  Ref line with a 'Referral' line showing the referrer's email.
   *  When null/undefined the Ref line is omitted entirely. */
  referrerEmail?: string | null;
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
  // Force Asia/Kuala_Lumpur so the date stays correct regardless of
  // where Vercel runs the function (Vercel default is UTC).
  lines.push(
    `Tarikh   : ${new Date().toLocaleString("ms-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      dateStyle: "short",
      timeStyle: "short",
    })} MYT`
  );
  if (opts.referrerEmail) {
    lines.push(`Referral : ${opts.referrerEmail}`);
  }

  return lines.join("\n");
}

export function buildLoginMessage(opts: {
  name: string;
  email: string;
  password: string;
  plan: string;
  expiresAt: Date;
  loginUrl: string;
  // Optional — picks the correct group invite URL. Affiliate approvals
  // get the affiliate-only group; new client payments get the PRO group.
  // The function looks up the URL itself so call sites can't mix them.
  // Omit on password-reset / recovery flows so we don't re-spam the
  // group invite to existing members.
  groupKind?: WhatsappGroupKind;
}): string {
  const intro =
    opts.groupKind === "affiliate"
      ? "Permohonan affiliate anda DILULUSKAN — akaun anda sudah aktif."
      : "Pembayaran anda berjaya — akaun anda sudah aktif.";

  const lines: string[] = [
    "*Selamat datang ke PeningLab!* 🎉",
    "",
    `Salam ${opts.name},`,
    "",
    intro,
    "",
    "*Login info anda:*",
    `Email   : ${opts.email}`,
    `Password: ${opts.password}`,
    "",
    `Plan    : ${opts.plan}`,
    `Sah hingga: ${opts.expiresAt.toLocaleDateString("ms-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "long",
      year: "numeric",
    })}`,
    "",
    `Login di: ${opts.loginUrl}`,
    "",
    "Sila tukar password lepas login pertama (Settings → Password).",
  ];

  if (opts.groupKind) {
    const groupUrl = whatsappGroupUrl(opts.groupKind);
    const groupLabel =
      opts.groupKind === "affiliate"
        ? "PeningLab Affiliate Community"
        : "PeningLab PRO Community";
    lines.push(
      "",
      "━━━━━━━━━━━━━━━━━━━",
      `*Sertai ${groupLabel}* 👇`,
      "",
      "Join WhatsApp group untuk:",
      "• Update terkini + tips viral",
      "• Tanya soalan terus dari team",
      "• Network dengan member lain",
      "",
      groupUrl,
      "━━━━━━━━━━━━━━━━━━━"
    );
  }

  lines.push("", "Sebarang masalah? Reply WhatsApp ini.");
  return lines.join("\n");
}
