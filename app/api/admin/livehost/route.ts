import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";

// Admin: list Livehost clients + set each one's streaming config
// (backend_url = their GPU tunnel URL, vast_instance_id = their GPU).

async function requireAdmin() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const admin = createAdminClient();
  // all profiles on the livehost plan + their config (if any)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, full_name, plan, plan_expires_at")
    .eq("plan", "livehost");
  const ids = (profiles || []).map((p) => p.id);
  const { data: cfgs } = ids.length
    ? await admin.from("live_client_config").select("*").in("user_id", ids)
    : { data: [] as any[] };
  const byId = new Map((cfgs || []).map((c) => [c.user_id, c]));
  // emails live in auth.users — fetch and map
  const { data: usersPage } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const emailById = new Map((usersPage?.users || []).map((u) => [u.id, u.email || ""]));
  const rates = await getSettings(["livehost_gpu_rate_hour", "livehost_voice_rate_1k", "livehost_llm"]);
  const llmRaw = rates["livehost_llm"] || {};
  return NextResponse.json({
    llm: {
      main: llmRaw.main || { provider: "grsai", model: "gemini-3.1-flash-lite" },
      fallback: (Array.isArray(llmRaw.fallbacks) && llmRaw.fallbacks[0]) || llmRaw.fallback || { provider: "openrouter", model: "openai/gpt-4.1" },
    },
    rates: {
      gpuRateHour: rates["livehost_gpu_rate_hour"] || "6.00",
      voiceRate1k: rates["livehost_voice_rate_1k"] || "0.30",
    },
    clients: (profiles || []).map((p) => ({
      id: p.id,
      email: emailById.get(p.id) || "",
      name: p.full_name || "",
      plan: p.plan,
      plan_expires_at: p.plan_expires_at,
      backend_url: byId.get(p.id)?.backend_url || "",
      vast_instance_id: byId.get(p.id)?.vast_instance_id || "",
      notes: byId.get(p.id)?.notes || "",
      provision_status: byId.get(p.id)?.provision_status || "",
    })).sort((a, b) => a.email.localeCompare(b.email)),
  });
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const { userId, backendUrl, vastInstanceId, notes, rates, llm, action } = body || {};

  // Manual provisioning trigger (same path the payment webhook uses).
  if (action === "provision" && userId) {
    const { provisionLivehost } = await import("@/lib/livehost-provision");
    const res = await provisionLivehost(userId);
    return NextResponse.json(res);
  }
  if (action === "check" && userId) {
    const { checkProvisionReady } = await import("@/lib/livehost-provision");
    return NextResponse.json({ status: await checkProvisionReady(userId) });
  }

  // AI Livehost chat-model cascade (main + fallback), same shape as Clone model.
  if (llm) {
    const admin = createAdminClient();
    const norm = (s: any) => ({
      provider: s?.provider === "grsai" ? "grsai" : "openrouter",
      model: String(s?.model || "").trim(),
    });
    const value = { main: norm(llm.main), fallbacks: llm.fallback?.model ? [norm(llm.fallback)] : [] };
    if (!value.main.model) return NextResponse.json({ error: "main model required" }, { status: 400 });
    await admin.from("app_settings").upsert({
      key: "livehost_llm",
      value,
      category: "livehost",
      updated_at: new Date().toISOString(),
    });
    invalidateSettingsCache(["livehost_llm"]);
    return NextResponse.json({ ok: true });
  }

  // Global client-facing rates update (RM/GPU-hour + RM/1k voice chars).
  if (rates) {
    const admin = createAdminClient();
    const updates: [string, string][] = [];
    if (rates.gpuRateHour != null) updates.push(["livehost_gpu_rate_hour", String(rates.gpuRateHour)]);
    if (rates.voiceRate1k != null) updates.push(["livehost_voice_rate_1k", String(rates.voiceRate1k)]);
    for (const [key, value] of updates) {
      await admin.from("app_settings").upsert({
        key,
        value: JSON.stringify(value),
        category: "livehost",
        updated_at: new Date().toISOString(),
      });
    }
    invalidateSettingsCache(updates.map(([k]) => k));
    return NextResponse.json({ ok: true });
  }

  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  const admin = createAdminClient();
  const { error } = await admin.from("live_client_config").upsert({
    user_id: userId,
    backend_url: String(backendUrl || "").trim().replace(/\/+$/, ""),
    vast_instance_id: String(vastInstanceId || "").trim(),
    notes: String(notes || ""),
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
