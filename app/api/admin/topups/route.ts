import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// GET /api/admin/topups?status=pending — list manual Touch 'n Go top-up
// requests for admin review (screenshot + amount + who). Admin only.
export const dynamic = "force-dynamic";

async function adminGate() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function GET(req: Request) {
  if (!(await adminGate())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const status = new URL(req.url).searchParams.get("status") || "pending";

  const admin = createAdminClient();
  const { data: pays } = await admin
    .from("payments")
    .select("id, user_id, credits, amount, status, metadata, created_at, paid_at")
    .eq("type", "credit_topup")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (pays || []).filter((p: any) => (p.metadata?.method || "") === "tng");

  // Resolve emails for the listed users.
  const emailById = new Map<string, string>();
  const nameById = new Map<string, string>();
  const ids = Array.from(new Set(rows.map((r: any) => r.user_id).filter(Boolean)));
  if (ids.length) {
    const { data: profs } = await admin.from("profiles").select("id, full_name, whatsapp").in("id", ids);
    (profs || []).forEach((p: any) => nameById.set(p.id, p.full_name || ""));
    for (const id of ids) {
      try {
        const { data } = await admin.auth.admin.getUserById(id as string);
        if (data?.user?.email) emailById.set(id as string, data.user.email);
      } catch { /* ignore */ }
    }
  }

  return NextResponse.json({
    rows: rows.map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      email: emailById.get(r.user_id) || "—",
      name: nameById.get(r.user_id) || "",
      credits: Number(r.credits || 0),
      amount: Number(r.amount || 0),
      status: r.status,
      proof_url: String(r.metadata?.proof_url || ""),
      created_at: r.created_at,
      paid_at: r.paid_at,
    })),
  });
}
