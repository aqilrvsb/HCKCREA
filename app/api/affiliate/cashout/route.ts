import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/affiliate/cashout
//
// User submits a cashout request. Validation:
//   - amount >= RM 50 (hard minimum)
//   - amount <= available_balance, where:
//       available_balance = wallet_balance - sum(pending/approved cashouts)
//     (hold-until-paid model — wallet_balance is NOT decremented at
//     submit time; admin's "Mark Paid" action in /admin/cashout does
//     the deduction)
//   - bank fields all present
//
// Status starts as "pending". Admin transitions via /admin/cashout.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_CASHOUT_RM = 50;

export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  const user = session?.user;
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const amount = Number(body?.amount);
  const bankName = String(body?.bank_name || "").trim().slice(0, 80);
  const bankAccountName = String(body?.bank_account_name || "").trim().slice(0, 120);
  const bankAccountNumber = String(body?.bank_account_number || "")
    .replace(/\s+/g, "")
    .slice(0, 40);

  if (!Number.isFinite(amount) || amount < MIN_CASHOUT_RM) {
    return NextResponse.json(
      { error: `Minimum cashout is RM ${MIN_CASHOUT_RM}` },
      { status: 400 }
    );
  }
  if (!bankName || !bankAccountName || !bankAccountNumber) {
    return NextResponse.json(
      { error: "Bank name, account name, and account number are all required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Fetch the user's wallet + outstanding (non-paid, non-rejected)
  // cashouts in one round-trip each.
  const { data: profile } = await admin
    .from("profiles")
    .select("wallet_balance")
    .eq("id", user.id)
    .single();
  const walletBalance = Number(profile?.wallet_balance || 0);

  const { data: outstanding } = await admin
    .from("cashout_requests")
    .select("amount")
    .eq("user_id", user.id)
    .in("status", ["pending", "approved"]);
  const reserved =
    (outstanding || []).reduce((sum, r) => sum + Number(r.amount || 0), 0) || 0;
  const available = Number((walletBalance - reserved).toFixed(2));

  if (amount > available) {
    return NextResponse.json(
      {
        error: `Insufficient available balance. You have RM ${available.toFixed(2)} available (RM ${reserved.toFixed(2)} already reserved in pending/approved cashouts).`,
        available,
        reserved,
        wallet_balance: walletBalance,
      },
      { status: 400 }
    );
  }

  const { data: inserted, error: insErr } = await admin
    .from("cashout_requests")
    .insert({
      user_id: user.id,
      amount: Number(amount.toFixed(2)),
      bank_name: bankName,
      bank_account_name: bankAccountName,
      bank_account_number: bankAccountNumber,
      status: "pending",
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    return NextResponse.json(
      { error: "Failed to submit cashout request", detail: insErr?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    cashout_id: inserted.id,
    amount,
    new_available: Number((available - amount).toFixed(2)),
  });
}
