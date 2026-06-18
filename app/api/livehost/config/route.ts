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
    .select("backend_url, gpu_allowed, gpu_endpoint_id, gpu_on")
    .eq("user_id", user.id)
    .maybeSingle();

  // 1 GPU = 1 client. The client is "configured" the moment admin appoints/assigns
  // a GPU (gpu_allowed or an assigned endpoint). The actual worker URL is resolved
  // at Play via /api/livehost/pool (returns the assigned endpoint when gpu_on).
  if (data?.gpu_allowed || data?.gpu_endpoint_id) {
    return NextResponse.json({
      mode: "dedicated",
      backendUrl: (data.backend_url || "").replace(/\/+$/, ""),
      hasGpu: true,
      gpuOn: !!data.gpu_on,
    });
  }

  return NextResponse.json(
    { error: "Livehost belum dikonfigurasi — hubungi admin untuk aktifkan GPU anda." },
    { status: 404 },
  );
}
