import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins } from "@/lib/whatsapp";

// Standalone credit top-up (RM1 = 1 credit) — MANUAL Touch 'n Go flow.
//
// CHIP/FPX was removed (slow + takes a cut). Now: the client transfers to the
// admin's Touch 'n Go account, uploads the transfer screenshot, and submits.
// This creates a credit_topup payment with status='pending'. The credits are
// added to the wallet ONLY when an admin approves the screenshot on
// /admin/topups (see /api/admin/topups/approve).

const MIN_CREDITS = 1;
const MAX_CREDITS = 1000;

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const credits = Math.round(Number(body?.credits));
    if (!Number.isFinite(credits) || credits < MIN_CREDITS || credits > MAX_CREDITS) {
      return NextResponse.json(
        { error: `Amount kena antara RM${MIN_CREDITS} dan RM${MAX_CREDITS}` },
        { status: 400 }
      );
    }
    // Proof screenshot is mandatory — nothing to approve without it.
    const proofUrl = String(body?.proof_url || "").trim();
    if (!proofUrl || !/^https?:\/\//i.test(proofUrl)) {
      return NextResponse.json(
        { error: "Sila upload screenshot transfer dulu sebelum submit." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        type: "credit_topup",
        credits,
        amount: credits, // RM1 = 1 credit
        currency: "MYR",
        status: "pending", // stays pending until an admin approves the proof
        metadata: { credits, method: "tng", proof_url: proofUrl },
      })
      .select("id")
      .single();

    if (payErr || !payment) {
      return NextResponse.json({ error: "Gagal cipta permohonan top-up" }, { status: 500 });
    }

    // Alert admins on WhatsApp so they verify the screenshot + approve. Best-
    // effort — a notify failure must never block the client's submit.
    try {
      const { data: prof } = await admin
        .from("profiles")
        .select("full_name, whatsapp")
        .eq("id", user.id)
        .maybeSingle();
      const now = new Date().toLocaleString("ms-MY", {
        timeZone: "Asia/Kuala_Lumpur",
        dateStyle: "short",
        timeStyle: "short",
      });
      await notifyAdmins(
        [
          "⏳ *PeningLab — Top Up Pending Approval*",
          "",
          "Client dah transfer Touch 'n Go & upload resit. Sila verify & approve.",
          "",
          `Amount   : RM${credits.toFixed(2)}`,
          `Credits  : +${credits}`,
          `Name     : ${prof?.full_name || user.email?.split("@")[0] || "User"}`,
          `Email    : ${user.email || "-"}`,
          `WhatsApp : ${prof?.whatsapp || "-"}`,
          `Tarikh   : ${now} MYT`,
          "",
          "Approve di: Admin → Transactions → Credit Top Up",
        ].join("\n")
      );
    } catch (e: any) {
      console.warn("[topup] admin notify failed:", e?.message);
    }

    return NextResponse.json({ ok: true, payment_id: payment.id });
  } catch (e: any) {
    console.error("topup error:", e?.message);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
