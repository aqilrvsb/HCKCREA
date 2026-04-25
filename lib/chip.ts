// Chip Payment Gateway helpers (gate.chip-in.asia)
// Server-side only — never import in client components.

const CHIP_BASE_URL = "https://gate.chip-in.asia/api/v1";

function chipKey() {
  const k = process.env.CHIP_API_KEY;
  if (!k) throw new Error("CHIP_API_KEY env var not set");
  return k;
}
function chipBrand() {
  const b = process.env.CHIP_BRAND_ID;
  if (!b) throw new Error("CHIP_BRAND_ID env var not set");
  return b;
}

export type ChipPurchaseResp = {
  id: string;
  status: string;
  checkout_url?: string;
  transaction_data?: { id?: string };
  transaction?: { id?: string };
  purchase?: { metadata?: Record<string, any> };
};

export async function createChipPurchase(input: {
  email: string;
  fullName: string;
  productName: string;
  amountMYR: number; // e.g. 47.00
  reference: string;
  metadata: Record<string, any>;
  successRedirect: string;
  failureRedirect: string;
  webhookUrl: string;
}): Promise<ChipPurchaseResp> {
  const body = {
    brand_id: chipBrand(),
    client: { email: input.email, full_name: input.fullName },
    purchase: {
      currency: "MYR",
      products: [
        {
          name: input.productName,
          price: Math.round(input.amountMYR * 100), // sen
          quantity: 1,
        },
      ],
      metadata: input.metadata,
    },
    success_redirect: input.successRedirect,
    failure_redirect: input.failureRedirect,
    success_callback: input.webhookUrl,
    reference: input.reference,
    send_receipt: true,
  };

  const res = await fetch(`${CHIP_BASE_URL}/purchases/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chipKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Chip create purchase failed (${res.status}): ${txt.substring(0, 300)}`);
  }
  return res.json();
}

export async function fetchChipPurchase(purchaseId: string): Promise<ChipPurchaseResp> {
  const res = await fetch(`${CHIP_BASE_URL}/purchases/${purchaseId}/`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${chipKey()}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Chip fetch purchase failed (${res.status}): ${txt.substring(0, 300)}`);
  }
  return res.json();
}

// Map Chip's many statuses → our 4-state model
export function mapChipStatus(chipStatus: string): "pending" | "paid" | "failed" | "refunded" {
  if (chipStatus === "paid") return "paid";
  if (["error", "cancelled", "expired", "charged_back", "overdue"].includes(chipStatus)) return "failed";
  if (["refunded", "pending_refund"].includes(chipStatus)) return "refunded";
  return "pending";
}
