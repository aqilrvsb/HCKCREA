import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintExtToken } from "@/lib/livehost-ext-auth";
import { getSettings } from "@/lib/settings";

// Chrome-extension login: email+password verified against Supabase auth
// (password grant via the anon key), then a long-lived signed ext token is
// returned. Only livehost-plan users may log in.

export async function POST(req: Request) {
  const { email, password, extension_version } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "email + password required" }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json().catch(() => ({}));
  const userId = d?.user?.id;
  if (!r.ok || !userId) {
    return NextResponse.json({ error: "Email atau password salah" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, plan_expires_at, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (profile?.plan !== "livehost") {
    return NextResponse.json({ error: "Akaun ini bukan pakej Livehost" }, { status: 403 });
  }
  if (profile.plan_expires_at && new Date(profile.plan_expires_at) < new Date()) {
    return NextResponse.json({ error: "Langganan Livehost telah tamat" }, { status: 403 });
  }
  const token = await mintExtToken(userId);
  const ver = await getSettings(["livehost_ext_version", "livehost_ext_download_url"]);
  const requiredVersion = String(ver["livehost_ext_version"] || "").trim();
  const downloadUrl = String(ver["livehost_ext_download_url"] || "").trim();
  const clientVersion = String(extension_version || "").trim();
  const version_ok = !requiredVersion || !clientVersion || clientVersion === requiredVersion;
  return NextResponse.json({
    token,
    name: profile.full_name || email,
    version_ok,
    required_version: requiredVersion,
    download_url: downloadUrl,
  });
}
