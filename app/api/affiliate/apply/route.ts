import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins } from "@/lib/whatsapp";

// POST /api/affiliate/apply
//
// Public — no auth required. Visitor on /affiliate fills out the form
// (name + email + whatsapp) and submits. We insert a row at
// status="pending" + ping the admin via WhatsApp so they can review at
// /admin/affiliate.
//
// One pending application per email is enforced at the DB level via
// a partial-unique index. If a duplicate is submitted we return a
// friendly error instead of leaking the DB constraint.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeWhatsapp(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 13) return null;
  if (digits.startsWith("60")) return "+" + digits;
  if (digits.startsWith("0")) return "+60" + digits.slice(1);
  return "+60" + digits;
}

function isValidEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || "");
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const fullName = String(body?.name || "").trim().slice(0, 120);
    const email = String(body?.email || "").trim().toLowerCase();
    const whatsappRaw = String(body?.whatsapp || "");

    if (!fullName) {
      return NextResponse.json({ error: "Name required" }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }
    const whatsapp = normalizeWhatsapp(whatsappRaw);
    if (!whatsapp) {
      return NextResponse.json(
        { error: "Invalid WhatsApp number" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: inserted, error: insErr } = await admin
      .from("affiliate_applications")
      .insert({
        full_name: fullName,
        email,
        whatsapp,
        status: "pending",
      })
      .select("id")
      .single();

    if (insErr) {
      // Postgres unique-violation code 23505 → partial-unique on
      // (email) where status='pending'. Surface a clean message.
      if ((insErr as any)?.code === "23505") {
        return NextResponse.json(
          {
            error:
              "You already have a pending application. Our admin will reach out within 24 hours.",
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "Failed to submit application", detail: insErr.message },
        { status: 500 }
      );
    }

    // Notify admin (best-effort — a failure here doesn't roll back the
    // application). Admin can also see the row in /admin/affiliate.
    try {
      await notifyAdmins(
        [
          "🎯 New Affiliate Application",
          "",
          `Name: ${fullName}`,
          `Email: ${email}`,
          `WhatsApp: ${whatsapp}`,
          "",
          "Review + approve at /admin/affiliate",
        ].join("\n")
      );
    } catch (e: any) {
      console.warn("[affiliate-apply] admin notify failed:", e?.message);
    }

    return NextResponse.json({
      ok: true,
      application_id: inserted?.id,
    });
  } catch (e: any) {
    console.error("affiliate apply error:", e?.message);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
