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

  // No dedicated endpoint → this client streams from the SHARED POOL: a free
  // 5090 serverless endpoint is assigned at Play (see /api/livehost/pool) and
  // released at Stop. As long as the pool has ≥1 endpoint, the client is ready.
  if (!data?.backend_url) {
    const { count } = await admin
      .from("livehost_pool")
      .select("id", { count: "exact", head: true })
      .neq("status", "disabled");
    if ((count || 0) > 0) {
      return NextResponse.json({ mode: "pool", backendUrl: "", hasGpu: true, provisionStatus: "pool" });
    }
    return NextResponse.json(
      { error: "Livehost belum dikonfigurasi — hubungi admin untuk aktifkan GPU anda." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    mode: "dedicated",
    backendUrl: data.backend_url.replace(/\/+$/, ""),
    hasGpu: !!data.vast_instance_id,
    provisionStatus: data.provision_status || "",
  });
}
