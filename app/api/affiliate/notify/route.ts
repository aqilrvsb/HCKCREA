import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsApp } from "@/lib/whatsapp";

// POST /api/affiliate/notify   { email, date }  (date = YYYY-MM-DD, KL)
//
// Tells an affiliate, over WhatsApp, how many videos landed in their account on
// a given day. Counts are read server-side from history (never trusted from the
// client) so the number in the message is always what was actually transferred.
//
// Sends via the admin's active whacenter device — the same path as the
// topup / subscription alerts — but addressed to the AFFILIATE's number, which
// lives in profiles.settings.affiliate_contacts[].whatsapp.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const staffId = String(body?.staff_id || "").trim().toUpperCase();
  const date = String(body?.date || "").trim(); // YYYY-MM-DD
  if (!staffId) return NextResponse.json({ error: "staff_id diperlukan" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date perlu format YYYY-MM-DD" }, { status: 400 });
  }

  // Resolve the affiliate's WhatsApp from the owner's own contact list (by Staff ID).
  const { data: prof } = await sb.from("profiles").select("settings").eq("id", user.id).maybeSingle();
  const contacts = Array.isArray((prof?.settings as any)?.affiliate_contacts)
    ? ((prof!.settings as any).affiliate_contacts as Array<{ name?: string; staff_id?: string; whatsapp?: string }>)
    : [];
  const contact = contacts.find((c) => String(c.staff_id || "").toUpperCase() === staffId);
  if (!contact) return NextResponse.json({ error: "Affiliate tak dijumpai dalam Settings" }, { status: 404 });
  const phone = String(contact.whatsapp || "").trim();
  if (!phone) {
    return NextResponse.json(
      { error: "Affiliate ni tiada no WhatsApp — Import semula dari NL Affiliate Army" },
      { status: 422 }
    );
  }

  // Count what actually went to them on that date. affiliate_transfer_date is
  // the KL date stamped at transfer time.
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("history")
    .select("id, metadata")
    .eq("user_id", user.id)
    .eq("type", "video")
    .filter("metadata->>affiliate_transferred", "eq", "true")
    .filter("metadata->>affiliate_staff_id", "eq", staffId)
    .filter("metadata->>affiliate_transfer_date", "eq", date);

  const total = (rows || []).length;
  if (total === 0) {
    return NextResponse.json(
      { error: `Tiada video untuk ${staffId} pada ${date} — tak hantar notifikasi.` },
      { status: 409 }
    );
  }

  // DD-MM-YYYY reads more naturally in the message than the ISO date.
  const [y, m, d] = date.split("-");
  const pretty = `${d}-${m}-${y}`;
  const name = String(contact.name || staffId);

  const message = [
    "*Notification NLAffliate*",
    "",
    `Salam ${name},`,
    "",
    "*Video Sudah Dihantar ke Akaun Anda* ✅",
    "",
    `Tarikh      : ${pretty}`,
    `Total Video : ${total}`,
    "",
    "Sila semak tab *Pending Post* untuk mula posting.",
  ].join("\n");

  const ok = await sendWhatsApp(phone, message);
  if (!ok) {
    return NextResponse.json(
      { error: "WhatsApp gagal dihantar — semak no telefon / device admin aktif." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true, sent_to: phone, total, date });
}
