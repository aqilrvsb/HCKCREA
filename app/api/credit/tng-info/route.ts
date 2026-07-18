import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSettings } from "@/lib/settings";

// GET /api/credit/tng-info — the admin-configured Touch 'n Go destination
// (account number + holder name + QR image) shown to a client on the top-up
// screen so they know where to transfer. Signed-in users only.
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const s = await getSettings(["tng_account", "tng_qr_url"]);
  const acct = (s as any)["tng_account"] || {};
  const qr = (s as any)["tng_qr_url"] || {};
  return NextResponse.json({
    number: String(acct.number || ""),
    name: String(acct.name || ""),
    qr_url: String(qr.url || ""),
    configured: Boolean(acct.number || qr.url),
  });
}
