import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchChipPurchase, mapChipStatus } from "@/lib/chip";

// GET /api/payments/check-by-payment-id?id=<our payment uuid>
// Re-verifies status with Chip by looking up the chip_purchase_id stored
// against this payment row. Used by the /payment/success page poller.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("id");
  if (!paymentId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: payment } = await admin
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  // amount + currency are echoed back so the browser Pixel Purchase
  // event on /payment/success can fire with the real transacted value
  // instead of falling back to the canonical 75 MYR placeholder.
  const amount = Number(payment.amount || 0);
  const currency = String(payment.currency || "MYR");

  if (payment.status === "paid" || payment.status === "failed") {
    return NextResponse.json({ ok: true, status: payment.status, amount, currency });
  }
  if (!payment.chip_purchase_id) {
    return NextResponse.json({ ok: true, status: "pending", amount, currency });
  }

  // Trigger the same processing the webhook does
  try {
    const chip = await fetchChipPurchase(payment.chip_purchase_id);
    const newStatus = mapChipStatus(chip.status);

    if (newStatus !== payment.status) {
      // Hand off to the webhook GET to apply side effects + persist
      const origin = url.origin;
      const passthroughRes = await fetch(
        `${origin}/api/payments/webhook?id=${encodeURIComponent(payment.chip_purchase_id)}`,
        { cache: "no-store" }
      );
      const data = await passthroughRes.json().catch(() => ({}));
      return NextResponse.json({
        ok: true,
        status: data?.status || newStatus,
        amount,
        currency,
      });
    }
    return NextResponse.json({ ok: true, status: newStatus, amount, currency });
  } catch (e: any) {
    return NextResponse.json({
      ok: true,
      status: "pending",
      note: e?.message,
      amount,
      currency,
    });
  }
}
