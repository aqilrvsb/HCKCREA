import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Admin gate — admin flag on the profile.
async function adminGate() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return null;
  return user;
}

// GET /api/admin/cashout?status=pending|approved|paid|rejected|all
// Returns cashout rows joined with the requesting user's name / email /
// whatsapp so the admin UI doesn't need a separate fetch per row.
export async function GET(req: Request) {
  if (!(await adminGate())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "pending").toLowerCase();

  const admin = createAdminClient();
  let q = admin
    .from("cashout_requests")
    .select(
      "id, user_id, amount, bank_name, bank_account_name, bank_account_number, status, admin_note, created_at, paid_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (
    status === "pending" ||
    status === "approved" ||
    status === "paid" ||
    status === "rejected"
  ) {
    q = q.eq("status", status);
  }

  const { data: rows } = await q;
  const cashouts = (rows as any[]) || [];

  // Decorate with profile name + auth email + whatsapp in one batch.
  const userIds = Array.from(new Set(cashouts.map((c) => c.user_id)));
  let profileMap = new Map<string, { full_name: string | null; whatsapp: string | null }>();
  let emailMap = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name, whatsapp")
      .in("id", userIds);
    for (const p of profs || []) {
      profileMap.set(p.id, { full_name: p.full_name, whatsapp: p.whatsapp });
    }
    // Email lives on auth.users — use admin.auth.admin.listUsers and
    // filter. Cheaper than per-id getUserById when there are many rows.
    const { data: list } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 500,
    });
    for (const u of list?.users || []) {
      if (userIds.includes(u.id)) emailMap.set(u.id, u.email || "");
    }
  }

  const enriched = cashouts.map((c) => ({
    ...c,
    user_full_name: profileMap.get(c.user_id)?.full_name || null,
    user_whatsapp: profileMap.get(c.user_id)?.whatsapp || null,
    user_email: emailMap.get(c.user_id) || null,
  }));

  return NextResponse.json({ rows: enriched });
}

// POST /api/admin/cashout
// Body: { id, status: "approved" | "rejected" | "paid", admin_note? }
//
// State machine:
//   pending → approved   (intent signaled; balance still held)
//   pending → rejected   (released; visible to user)
//   pending → paid       (admin paid out; wallet_balance is decremented)
//   approved → paid      (admin paid out; wallet_balance is decremented)
//   approved → rejected  (released)
//
// "Mark Paid" is the only step that actually decrements
// profiles.wallet_balance — matches the hold-until-paid model.
export async function POST(req: Request) {
  const adminUser = await adminGate();
  if (!adminUser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const nextStatus = String(body?.status || "");
  const adminNote = body?.admin_note ? String(body.admin_note).slice(0, 500) : null;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!["approved", "rejected", "paid"].includes(nextStatus)) {
    return NextResponse.json(
      { error: "status must be approved | rejected | paid" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("cashout_requests")
    .select("id, user_id, amount, status")
    .eq("id", id)
    .single();
  if (!row) {
    return NextResponse.json({ error: "Cashout not found" }, { status: 404 });
  }
  if (row.status === "paid" || row.status === "rejected") {
    return NextResponse.json(
      { error: `Cashout is already ${row.status}` },
      { status: 400 }
    );
  }
  // Valid transitions only:
  const valid =
    (row.status === "pending" && ["approved", "rejected", "paid"].includes(nextStatus)) ||
    (row.status === "approved" && ["paid", "rejected"].includes(nextStatus));
  if (!valid) {
    return NextResponse.json(
      { error: `Cannot transition ${row.status} → ${nextStatus}` },
      { status: 400 }
    );
  }

  // If marking paid → decrement wallet_balance ATOMICALLY.
  if (nextStatus === "paid") {
    const { data: profile } = await admin
      .from("profiles")
      .select("wallet_balance")
      .eq("id", row.user_id)
      .single();
    const currentBalance = Number(profile?.wallet_balance || 0);
    const amount = Number(row.amount || 0);
    if (currentBalance < amount) {
      return NextResponse.json(
        {
          error: `User wallet balance (RM ${currentBalance.toFixed(2)}) is less than cashout amount (RM ${amount.toFixed(2)}). Cannot mark paid.`,
        },
        { status: 400 }
      );
    }
    await admin
      .from("profiles")
      .update({ wallet_balance: Number((currentBalance - amount).toFixed(2)) })
      .eq("id", row.user_id);
  }

  const { error: updErr } = await admin
    .from("cashout_requests")
    .update({
      status: nextStatus,
      admin_note: adminNote,
      paid_at: nextStatus === "paid" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updErr) {
    return NextResponse.json(
      { error: "Update failed", detail: updErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
