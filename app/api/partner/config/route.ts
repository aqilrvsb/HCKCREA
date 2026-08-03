import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  partnerGroupForManager,
  partnerSettingsKey,
  PARTNER_TAB_KEYS,
  PARTNER_RATE_MODELS,
  type PartnerConfig,
} from "@/lib/partners";
import { invalidateSettingsCache } from "@/lib/settings";

// GET  /api/partner/config — the caller's (partner manager's) config blob.
// POST /api/partner/config — save visible_tabs and/or rates. Gated to a partner
// MANAGER (e.g. hqnl@gmail.com); other accounts get 403. Rates are floored at
// the admin base rate here AND at resolution time (priceFor) — defence in depth.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function callerPartnerGroup(): Promise<string | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  return partnerGroupForManager(user.email);
}

export async function GET() {
  const group = await callerPartnerGroup();
  if (!group) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", partnerSettingsKey(group))
    .maybeSingle();
  const cfg = (data?.value || {}) as PartnerConfig;
  // baseRates = the admin floor per model, so the UI can show + enforce it.
  const { adminBaseRates } = await import("@/lib/partner-rates");
  const baseRates = await adminBaseRates();
  return NextResponse.json({
    ok: true,
    group,
    config: cfg,
    tabKeys: PARTNER_TAB_KEYS,
    rateModels: PARTNER_RATE_MODELS,
    baseRates,
  });
}

export async function POST(req: Request) {
  const group = await callerPartnerGroup();
  if (!group) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const admin = createAdminClient();
  const key = partnerSettingsKey(group);

  // Merge onto the existing config so a tabs-only save never clobbers rates
  // (and vice-versa).
  const { data: cur } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const next: PartnerConfig = { ...((cur?.value as PartnerConfig) || {}) };

  // ── visible_tabs ────────────────────────────────────────────────────────
  if (Array.isArray(body?.visible_tabs)) {
    const picked = body.visible_tabs
      .filter((k: any) => typeof k === "string" && PARTNER_TAB_KEYS.includes(k));
    if (picked.length === 0) {
      // Refuse to lock a client out of every project tab.
      return NextResponse.json({ error: "Pilih sekurang-kurangnya 1 tab untuk client." }, { status: 400 });
    }
    // Store in canonical tab order, de-duped.
    next.visible_tabs = PARTNER_TAB_KEYS.filter((k) => picked.includes(k));
  }

  // ── rates (Phase 3) ─────────────────────────────────────────────────────
  // Clamp each rate to >= the admin BASE rate so a partner can only mark up.
  if (body?.rates && typeof body.rates === "object") {
    const { adminBaseRates } = await import("@/lib/partner-rates");
    const base = await adminBaseRates();
    const rates: Record<string, number> = { ...(next.rates || {}) };
    for (const model of PARTNER_RATE_MODELS) {
      const raw = body.rates[model];
      if (raw === null || raw === "" || typeof raw === "undefined") {
        // Explicit clear → fall back to base (delete the override).
        delete rates[model];
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) continue;
      const floor = Number(base[model] || 0);
      rates[model] = floor > 0 ? Math.max(n, floor) : n; // never below admin base
    }
    next.rates = rates;
  }

  const { error } = await admin
    .from("app_settings")
    .upsert(
      { key, value: next, description: `Partner config for ${group}`, category: "partner" },
      { onConflict: "key" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  invalidateSettingsCache();
  return NextResponse.json({ ok: true, config: next });
}
