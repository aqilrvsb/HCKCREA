import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/admin/clients/update
// Admin-only. Single endpoint to mutate any combination of:
//   - plan ("free" | "pro")
//   - plan_expires_at (ISO string OR a "+N days" extension token "+30d")
//   - whatsapp (string)
//   - credits_delta (number, +/-, logged as a credit_transaction)
//   - credits_set (number, replaces balance directly — for corrections)
//   - password (string, resets via auth admin API)
//
// Body: { user_id: string, plan?, plan_expires_at?, whatsapp?,
//         credits_delta?, credits_set?, password? }
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const targetId = String(body?.user_id || "");
  if (!targetId)
    return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

  const admin = createAdminClient();

  // Pull current row first so credits ops have a base
  const { data: current } = await admin
    .from("profiles")
    .select("credits, plan, plan_expires_at, whatsapp")
    .eq("id", targetId)
    .single();
  if (!current)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const updates: Record<string, any> = {};
  const changes: string[] = [];

  if (typeof body?.plan === "string" && body.plan.trim()) {
    updates.plan = body.plan.trim();
    changes.push(`plan=${updates.plan}`);
  }

  if (body?.plan_expires_at !== undefined && body.plan_expires_at !== null) {
    const raw = String(body.plan_expires_at);
    if (raw === "") {
      updates.plan_expires_at = null;
      changes.push("expires=cleared");
    } else if (raw.startsWith("+") && raw.endsWith("d")) {
      // "+30d" → extend from current expiry (or now if expired)
      const days = Number(raw.slice(1, -1));
      if (Number.isFinite(days) && days > 0) {
        const now = new Date();
        const baseRaw = current.plan_expires_at
          ? new Date(current.plan_expires_at)
          : null;
        const base = baseRaw && baseRaw > now ? baseRaw : now;
        const next = new Date(base.getTime() + days * 86400000);
        updates.plan_expires_at = next.toISOString();
        changes.push(`expires=+${days}d`);
      }
    } else {
      // Treat as ISO/date string
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        updates.plan_expires_at = d.toISOString();
        changes.push(`expires=${d.toISOString().slice(0, 10)}`);
      }
    }
  }

  if (typeof body?.whatsapp === "string") {
    updates.whatsapp = body.whatsapp.trim() || null;
    changes.push("whatsapp");
  }

  // Credits — two modes: delta (additive) or set (replaces)
  let creditsTransaction: {
    user_id: string;
    amount: number;
    balance_after: number;
    reason: string;
    metadata: any;
  } | null = null;

  const cur = Number(current.credits || 0);
  if (typeof body?.credits_set === "number") {
    updates.credits = Math.max(0, body.credits_set);
    creditsTransaction = {
      user_id: targetId,
      amount: updates.credits - cur,
      balance_after: updates.credits,
      reason: "admin_adjust_set",
      metadata: { admin: user.id, before: cur, after: updates.credits },
    };
    changes.push(`credits=${updates.credits}`);
  } else if (typeof body?.credits_delta === "number" && body.credits_delta !== 0) {
    const next = Math.max(0, cur + body.credits_delta);
    updates.credits = next;
    creditsTransaction = {
      user_id: targetId,
      amount: body.credits_delta,
      balance_after: next,
      reason: body.credits_delta > 0 ? "admin_topup" : "admin_deduct",
      metadata: { admin: user.id, before: cur, after: next },
    };
    changes.push(`credits${body.credits_delta > 0 ? "+" : ""}${body.credits_delta}`);
  }

  // Apply profile updates
  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from("profiles").update(updates).eq("id", targetId);
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log credit transaction (if any)
  if (creditsTransaction) {
    await admin.from("credit_transactions").insert(creditsTransaction);
  }

  // Password reset
  if (typeof body?.password === "string" && body.password.length >= 6) {
    const { error: pwErr } = await admin.auth.admin.updateUserById(targetId, {
      password: body.password,
    });
    if (pwErr)
      return NextResponse.json(
        { error: `Password update failed: ${pwErr.message}` },
        { status: 500 }
      );
    changes.push("password");
  }

  return NextResponse.json({ ok: true, changes });
}
