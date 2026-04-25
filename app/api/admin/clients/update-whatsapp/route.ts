import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizeWhatsapp(raw: string): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 13) return null;
  if (digits.startsWith("60")) return "+" + digits;
  if (digits.startsWith("0")) return "+60" + digits.slice(1);
  return "+60" + digits;
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: meAdmin } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!meAdmin?.is_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const userId = String(body?.user_id || "");
  const wa = normalizeWhatsapp(String(body?.whatsapp || ""));
  if (!userId || !wa) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const admin = createAdminClient();
  await admin.from("profiles").update({ whatsapp: wa }).eq("id", userId);

  return NextResponse.json({ ok: true, whatsapp: wa });
}
