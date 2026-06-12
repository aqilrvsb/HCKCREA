import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// The logged-in Livehost client's streaming config (set by admin).
// Only the backend URL reaches the browser — never any keys.
export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("live_client_config")
    .select("backend_url, vast_instance_id, provision_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data?.backend_url) {
    return NextResponse.json(
      { error: "Livehost belum dikonfigurasi — hubungi admin untuk aktifkan GPU anda." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    backendUrl: data.backend_url.replace(/\/+$/, ""),
    hasGpu: !!data.vast_instance_id,
    provisionStatus: data.provision_status || "",
  });
}
