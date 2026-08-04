import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import PrintControls from "./print-controls";

// Admin-only, printable INVOICE for a single payment (subscription or top-up).
// Rendered OUTSIDE /admin so there's no sidebar around it — a clean A4 page the
// admin can view + "Save as PDF" and send to the client. Gated here (not by the
// admin layout) via an is_admin check.

export const dynamic = "force-dynamic";

// Seller — AITHI CLOUD TECH SOLUTION (SSM Registration of Businesses Act 1956).
const SELLER = {
  name: "AITHI CLOUD TECH SOLUTION",
  regNo: "202403060180 (AS0475698-P)",
  address: "LOT 34 TAMAN SEDC KAMPUNG RAJA, BESUT,\n22200 KAMPUNG RAJA, TERENGGANU",
  brand: "PeningLab",
  web: "peninglab.com",
};

function fmtMoney(n: number) {
  return `RM ${Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("ms-MY", { timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Auth + admin gate (this route isn't under the admin layout).
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
  if (!me?.is_admin) redirect("/dashboard");

  const { data: payment } = await admin
    .from("payments")
    .select("id, user_id, type, plan, credits, amount, status, paid_at, created_at, metadata")
    .eq("id", id)
    .maybeSingle();
  if (!payment) redirect("/admin/transactions");

  // Buyer details — profile + auth email (best-effort).
  let buyerName = "", buyerPhone = "", buyerEmail = "";
  if (payment.user_id) {
    const { data: prof } = await admin.from("profiles").select("full_name, whatsapp").eq("id", payment.user_id).maybeSingle();
    buyerName = prof?.full_name || "";
    buyerPhone = prof?.whatsapp || "";
    try {
      const { data: au } = await admin.auth.admin.getUserById(payment.user_id);
      buyerEmail = au?.user?.email || "";
    } catch { /* email optional */ }
  }
  // Fall back to signup metadata for pre-profile payments.
  buyerName = buyerName || payment.metadata?.full_name || payment.metadata?.name || "Pelanggan";
  buyerPhone = buyerPhone || payment.metadata?.whatsapp || "";
  buyerEmail = buyerEmail || payment.metadata?.email || "";

  const isSub = payment.type === "subscription" || !!payment.plan;
  const credits = Number(payment.credits ?? payment.metadata?.credits ?? 0);
  const days = Number(payment.metadata?.days || 0);
  const description = isSub
    ? `Langganan ${String(payment.plan || "").toUpperCase() || "PLAN"}${days ? ` — ${days} hari` : ""}${credits ? ` (termasuk ${credits} kredit)` : ""}`
    : `Top-Up Kredit — +${credits} kredit`;
  const method = payment.metadata?.method === "tng" ? "Touch 'n Go eWallet" : "FPX / Kad (CHIP)";
  const paidAt = payment.paid_at || payment.created_at;
  const amount = Number(payment.amount || 0);
  const invNo = `INV-${new Date(payment.created_at).toISOString().slice(0, 10).replace(/-/g, "")}-${payment.id.slice(0, 6).toUpperCase()}`;

  const statusColor =
    payment.status === "paid" ? { bg: "#dcfce7", fg: "#15803d", br: "#86efac" }
    : payment.status === "pending" ? { bg: "#fef3c7", fg: "#b45309", br: "#fcd34d" }
    : payment.status === "refunded" ? { bg: "#e0e7ff", fg: "#4338ca", br: "#a5b4fc" }
    : { bg: "#fee2e2", fg: "#b91c1c", br: "#fca5a5" };

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: "24px 12px", color: "#111827" }}>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .invoice-sheet { box-shadow: none !important; margin: 0 !important; }
        }
        .invoice-sheet { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
        .inv-table th, .inv-table td { padding: 10px 12px; }
      `}</style>

      <div className="invoice-sheet" style={{
        maxWidth: 800, margin: "0 auto", background: "#fff", borderRadius: 12,
        boxShadow: "0 10px 40px rgba(0,0,0,0.10)", padding: "40px 44px",
      }}>
        {/* Header — seller + INVOICE meta */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ minWidth: 240 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#fde047,#facc15)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>✦</span>
              <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>{SELLER.brand}</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{SELLER.name}</div>
            <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 2 }}>No. Pendaftaran: {SELLER.regNo}</div>
            <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 2, whiteSpace: "pre-line" }}>{SELLER.address}</div>
            <div style={{ fontSize: 11.5, color: "#6b7280", marginTop: 2 }}>{SELLER.web}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 1, color: "#111827" }}>INVOIS</div>
            <div style={{ fontSize: 12.5, color: "#374151", marginTop: 6 }}><b>No.:</b> {invNo}</div>
            <div style={{ fontSize: 12.5, color: "#374151", marginTop: 2 }}><b>Tarikh:</b> {fmtDate(payment.created_at)}</div>
            <div style={{ marginTop: 8 }}>
              <span style={{ display: "inline-block", padding: "4px 12px", borderRadius: 999, fontWeight: 800, fontSize: 12, background: statusColor.bg, color: statusColor.fg, border: `1px solid ${statusColor.br}` }}>
                {payment.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: "#e5e7eb", margin: "24px 0" }} />

        {/* Bill to + payment info */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ minWidth: 240 }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, color: "#9ca3af", marginBottom: 6 }}>Bil Kepada</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{buyerName}</div>
            {buyerEmail && <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 2 }}>{buyerEmail}</div>}
            {buyerPhone && <div style={{ fontSize: 12.5, color: "#6b7280", marginTop: 2 }}>{buyerPhone}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, color: "#9ca3af", marginBottom: 6 }}>Butiran Bayaran</div>
            <div style={{ fontSize: 12.5, color: "#374151" }}><b>Kaedah:</b> {method}</div>
            <div style={{ fontSize: 12.5, color: "#374151", marginTop: 2 }}><b>Tarikh bayar:</b> {fmtDate(paidAt)}</div>
            <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>Ruj: {payment.id}</div>
          </div>
        </div>

        {/* Line items */}
        <table className="inv-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 24, fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f9fafb", textAlign: "left", color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
              <th style={{ borderBottom: "1px solid #e5e7eb" }}>Penerangan</th>
              <th style={{ borderBottom: "1px solid #e5e7eb", textAlign: "center", width: 60 }}>Kuantiti</th>
              <th style={{ borderBottom: "1px solid #e5e7eb", textAlign: "right", width: 130 }}>Jumlah</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ borderBottom: "1px solid #f3f4f6", fontWeight: 600 }}>{description}</td>
              <td style={{ borderBottom: "1px solid #f3f4f6", textAlign: "center" }}>1</td>
              <td style={{ borderBottom: "1px solid #f3f4f6", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(amount)}</td>
            </tr>
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
          <div style={{ width: 260 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", padding: "4px 0" }}>
              <span>Subtotal</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(amount)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#6b7280", padding: "4px 0" }}>
              <span>Cukai (SST)</span><span>RM 0.00</span>
            </div>
            <div style={{ height: 1, background: "#e5e7eb", margin: "8px 0" }} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, fontWeight: 800, padding: "2px 0" }}>
              <span>JUMLAH</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(amount)}</span>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: "#e5e7eb", margin: "28px 0 16px" }} />

        {/* Footer */}
        <div style={{ fontSize: 11.5, color: "#6b7280", lineHeight: 1.6 }}>
          <div style={{ fontWeight: 700, color: "#374151" }}>Terima kasih atas pembayaran anda.</div>
          <div>Invois ini dijana secara automatik oleh {SELLER.brand} ({SELLER.name}).</div>
          <div>Sebarang pertanyaan, sila hubungi kami di {SELLER.web}.</div>
        </div>
      </div>

      <PrintControls />
    </div>
  );
}
