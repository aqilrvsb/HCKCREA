import Link from "next/link";
import { XCircle, Sparkles } from "lucide-react";

export default function PaymentFailedPage() {
  return (
    <div className="relative min-h-screen flex items-center justify-center px-6 py-12 overflow-hidden">
      <div className="bg-sky" />

      <div className="relative z-10 w-full max-w-lg">
        <Link
          href="/"
          className="flex items-center gap-2.5 justify-center mb-8"
        >
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>

        <div className="card text-center p-8 md:p-10">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-50 border border-red-100 flex items-center justify-center mb-5">
            <XCircle className="w-8 h-8 text-red-600" />
          </div>
          <h1 className="font-display font-extrabold text-3xl tracking-tight mb-3">
            Pembayaran tidak berjaya
          </h1>
          <p className="text-[var(--color-text-secondary)] mb-6">
            Tiada caj dikenakan. Anda boleh cuba lagi dengan bank atau e-wallet
            lain.
          </p>
          <Link href="/#checkout" className="btn-primary inline-flex">
            Cuba Semula
          </Link>
        </div>
      </div>
    </div>
  );
}
