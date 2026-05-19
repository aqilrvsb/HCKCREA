"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  Sparkles,
  Clock,
} from "lucide-react";

function SuccessInner() {
  const params = useSearchParams();
  const id = params.get("id");
  const [status, setStatus] = useState<"checking" | "paid" | "pending" | "failed">("checking");

  useEffect(() => {
    if (!id) {
      setStatus("pending");
      return;
    }
    let attempts = 0;
    let purchaseFired = false; // guard — fire Purchase event only ONCE per page session
    const tick = async () => {
      attempts++;
      try {
        // The webhook endpoint also serves as a manual status checker (GET ?id=)
        const r = await fetch(
          `/api/payments/check-by-payment-id?id=${encodeURIComponent(id)}`,
          { cache: "no-store" }
        );
        const data = await r.json();
        if (data?.status === "paid") {
          setStatus("paid");
          // Fire Facebook Pixel Purchase event the MOMENT we confirm
          // the payment landed. event_id = payment_id so it dedupes
          // with the server-side CAPI Purchase event fired from
          // /api/payments/webhook (Meta picks one, ignores duplicate).
          //
          // Browser amount/currency come from the check endpoint when
          // available — falls back to the canonical 75 MYR pro-plan
          // price so the event has SOME value even if the check API
          // is light on detail. The server-side CAPI call has the
          // authoritative amount from the payments table.
          if (!purchaseFired) {
            purchaseFired = true;
            try {
              const value = Number(data?.amount) > 0 ? Number(data.amount) : 75;
              const currency = String(data?.currency || "MYR");
              (window as any).fbq?.(
                "track",
                "Purchase",
                { value, currency, content_name: "Pro Plan" },
                { eventID: id }
              );
            } catch {
              // Pixel not loaded — non-critical. Server CAPI still
              // fires from the webhook so the conversion still lands
              // in Meta Events Manager.
            }
          }
          return;
        }
        if (data?.status === "failed") {
          setStatus("failed");
          return;
        }
        if (attempts < 12) setTimeout(tick, 5000);
        else setStatus("pending");
      } catch {
        if (attempts < 12) setTimeout(tick, 5000);
        else setStatus("pending");
      }
    };
    void tick();
  }, [id]);

  return (
    <div className="relative min-h-screen flex items-center justify-center px-6 py-12 overflow-hidden">
      <div className="bg-sky" />

      <div className="relative z-10 w-full max-w-lg">
        <Link
          href="/"
          className="flex items-center gap-2.5 justify-center mb-8"
        >
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-black" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        <div className="card text-center p-8 md:p-10">
          {status === "checking" && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-orange-50 border border-orange-100 flex items-center justify-center mb-5">
                <Loader2 className="w-8 h-8 text-orange animate-spin" />
              </div>
              <h1 className="font-display font-extrabold text-3xl tracking-tight mb-3">
                Checking payment…
              </h1>
              <p className="text-[var(--color-text-secondary)]">
                Sila tunggu sebentar, kami sedang verify dengan Chip.
              </p>
            </>
          )}

          {status === "paid" && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-5">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
              </div>
              <h1 className="font-display font-extrabold text-3xl tracking-tight mb-3">
                Pembayaran berjaya! 🎉
              </h1>
              <p className="text-[var(--color-text-secondary)] mb-6">
                Akaun anda telah diaktifkan. Login info akan dihantar di
                WhatsApp anda dalam 1 minit.
              </p>
              <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4 mb-6 text-left">
                <div className="flex items-start gap-2.5">
                  <MessageCircle className="w-4 h-4 text-emerald-600 mt-0.5" />
                  <div className="text-sm text-emerald-800">
                    <strong>Tunggu mesej WhatsApp</strong> — emel + password
                    sementara akan dihantar. Anda boleh tukar password lepas
                    login pertama.
                  </div>
                </div>
              </div>
              <Link href="/login" className="btn-primary inline-flex">
                Pergi ke Sign In
              </Link>
            </>
          )}

          {status === "pending" && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center mb-5">
                <Clock className="w-8 h-8 text-amber-600" />
              </div>
              <h1 className="font-display font-extrabold text-3xl tracking-tight mb-3">
                Pembayaran masih diproses
              </h1>
              <p className="text-[var(--color-text-secondary)] mb-6">
                Bank tengah confirm transaction. Ini selalunya 1–2 minit. Anda
                akan dapat WhatsApp lepas berjaya.
              </p>
              <Link href="/" className="btn-secondary inline-flex">
                Kembali ke Home
              </Link>
            </>
          )}

          {status === "failed" && (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-5">
                <Clock className="w-8 h-8 text-red-600" />
              </div>
              <h1 className="font-display font-extrabold text-3xl tracking-tight mb-3">
                Pembayaran tak berjaya
              </h1>
              <p className="text-[var(--color-text-secondary)] mb-6">
                Sila cuba semula. Tiada caj akan dikenakan untuk pembayaran
                yang tak berjaya.
              </p>
              <Link href="/#checkout" className="btn-primary inline-flex">
                Cuba Semula
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-orange" />
        </div>
      }
    >
      <SuccessInner />
    </Suspense>
  );
}
