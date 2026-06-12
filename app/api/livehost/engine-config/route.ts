import { NextResponse } from "next/server";
import { getSetting, getSettings } from "@/lib/settings";
import { parseModelSetting, providerCreds, type Provider } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

// SERVER-TO-SERVER ONLY: each client GPU box fetches its chat-LLM cascade here
// at session start (header x-box-secret = app_settings.livehost_box_secret).
// Returns resolved {base, key, model} slots so provider API keys live in
// PeningLab settings and never touch any browser. Admin edits the cascade in
// /admin/livehost (same main/fallback pattern as the Clone model setting).

export async function GET(req: Request) {
  const secret = await getSetting<string>("livehost_box_secret");
  const given = req.headers.get("x-box-secret") || "";
  if (!secret || given !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const raw = await getSetting<any>("livehost_llm");
  const parsed = parseModelSetting(raw) || {
    main: { provider: "openrouter" as Provider, model: "openai/gpt-4.1" },
    fallbacks: [],
  };

  const cache = await getSettings(["or_base", "or_key", "p4_key"]);
  const slots: { base: string; key: string; model: string; provider: string }[] = [];
  for (const slot of [parsed.main, ...parsed.fallbacks]) {
    const creds = await providerCreds(slot.provider, cache);
    if (creds.base && creds.key) {
      slots.push({ base: creds.base, key: creds.key, model: slot.model, provider: slot.provider });
    }
  }
  return NextResponse.json({ slots });
}
