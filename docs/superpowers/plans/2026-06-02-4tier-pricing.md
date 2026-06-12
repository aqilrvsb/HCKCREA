# 4-Tier Subscription Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single Pro plan + standalone Topup with 4 monthly tiers (Starter RM35/RM10, Standard RM50/RM25, Pro RM100/RM50 BEST SELLER, Premium RM200/RM100). Hide the Topup tab. Change `applySubscription` from day-stacking to expiry-replace. Reuse a shared `PricingTiersGrid` component in the dashboard Billing section AND the landing page.

**Architecture:** Minimal-touch. Add 3 sibling `app_settings.plan_*` rows + update existing `plan_pro` (migration). Introduce a typed plan registry in `lib/plans.ts` (DRY for routes + UI). Rewire `/api/billing/subscribe` to validate against the registry. Flip one line in `applySubscription`. Replace billing UI with a shared grid component. Hide Credit nav entry.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Auth), Chip (Malaysian payment gateway). No test runner — verify via `npx tsc --noEmit -p .` and manual smoke after deploy.

**Spec:** `docs/superpowers/specs/2026-06-02-4tier-pricing-design.md`

---

## File Structure

| File | Responsibility | Change kind |
|---|---|---|
| `supabase/migrations/0042_4tier_plans.sql` | Seed 3 new `plan_*` settings rows + update `plan_pro` | **Create** |
| `lib/plans.ts` | Plan key whitelist + defaults + `isPlanKey()` + `loadPlan()` | **Create** |
| `components/pricing-tiers-grid.tsx` | Shared 4-card grid (`mode: "dashboard"\|"marketing"`) | **Create** |
| `app/api/billing/subscribe/route.ts` | Accept 4 plan keys, validate, use `loadPlan()` | Modify |
| `app/api/payments/webhook/route.ts` | `applySubscription`: replace expiry, not stack | Modify |
| `app/api/credit/topup/route.ts` | Return 410 Gone | Modify |
| `app/dashboard/sections/billing.tsx` | Use `PricingTiersGrid` (dashboard mode) | Modify |
| `app/page.tsx` | Use `PricingTiersGrid` (marketing mode) in pricing section | Modify |
| `app/dashboard/sidebar.tsx` | Remove Credit nav entry + sidebar "+ Top Up" button | Modify |
| `app/dashboard/page.tsx` | Broaden `planActive` via `isPlanKey()` | Modify |

Each HCKCREA task = one commit + one push.

**Constraints (from project memory + spec):**
- Always push after committing in HCKCREA repo.
- No version bumps (HCKCREA, not the extension).
- No `Date.toISOString()` for user-facing strings (Malaysia UTC+8); fine for internal metadata timestamps.
- No test runner — verify via `npx tsc --noEmit -p .` + manual smoke after deploy.
- Existing Pro users at `admin@gmail.com` must keep working (grandfather): `plan="pro"` + `plan_expires_at` stay valid.
- Migration applied via Supabase MCP (`mcp__supabase__apply_migration`) before any code commits.

---

## Task 1: Migration — seed 3 plan settings + bump plan_pro

**Files:**
- Create: `supabase/migrations/0042_4tier_plans.sql`
- Apply via Supabase MCP (project_id `zoxgcqlqovkvlrmpcikt`)

The Pro row already exists at RM75/0cr. We update it to RM100/50cr (new Pro tier) and add Starter, Standard, Premium as sibling rows. `on conflict do nothing` makes it idempotent.

- [ ] **Step 1: Create the migration file**

Create `E:\Project\HCKCREA\supabase\migrations\0042_4tier_plans.sql`:

```sql
-- 0042 — 4-tier subscription pricing.
--
-- Replaces single Pro plan + standalone Topup with 4 monthly tiers.
-- Each tier costs a fixed RM amount per 30 days and grants a fixed
-- RM credit allotment. Existing Pro users grandfathered — their
-- profiles.plan + plan_expires_at stay valid until expiry.
--
-- Admin can still tune any price/credits via /admin/settings without
-- a redeploy (matches existing plan_pro pattern).

-- Update existing Pro plan to new Pro tier pricing.
update public.app_settings
  set value = '{"price":100,"days":30,"credits":50,"label":"Pro"}'::jsonb,
      description = 'Pro plan — RM100/30 days + RM50 credits. Best seller tier.'
  where key = 'plan_pro';

-- Add 3 sibling tier rows.
insert into public.app_settings (key, value, description, category)
values
  ('plan_starter', '{"price":35,"days":30,"credits":10,"label":"Starter"}'::jsonb,
    'Starter plan — RM35/30 days + RM10 credits. Entry-level access tier.',
    'plan'),
  ('plan_standard', '{"price":50,"days":30,"credits":25,"label":"Standard"}'::jsonb,
    'Standard plan — RM50/30 days + RM25 credits.',
    'plan'),
  ('plan_premium', '{"price":200,"days":30,"credits":100,"label":"Premium"}'::jsonb,
    'Premium plan — RM200/30 days + RM100 credits. Highest tier.',
    'plan')
on conflict (key) do nothing;
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `mcp__supabase__apply_migration` with:
- `project_id`: `zoxgcqlqovkvlrmpcikt`
- `name`: `4tier_plans`
- `query`: the full migration SQL above (without the SQL comment header — paste only from `update public.app_settings` downward, OR include the comments — both work).

Expected response: `{"success":true}`.

- [ ] **Step 3: Verify the rows exist**

Call `mcp__supabase__execute_sql` with:
- `project_id`: `zoxgcqlqovkvlrmpcikt`
- `query`:

```sql
select key, value, description from public.app_settings where key like 'plan_%' order by key;
```

Expected: 4 rows (`plan_premium`, `plan_pro`, `plan_standard`, `plan_starter`). Confirm `plan_pro.value->>'price' = '100'` (not the old 75) and `plan_pro.value->>'credits' = '50'`.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add supabase/migrations/0042_4tier_plans.sql && \
  git commit -m "$(cat <<'EOF'
feat(billing): 4-tier subscription pricing migration

Adds plan_starter, plan_standard, plan_premium app_settings rows and
upgrades existing plan_pro from RM75/0cr to RM100/50cr. Existing Pro
users grandfather: their profiles.plan="pro" + plan_expires_at stay
valid; on renewal they pay the new RM100 and receive RM50 credits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 2: `lib/plans.ts` — plan registry

**Files:**
- Create: `lib/plans.ts`

Single source of truth for the 4 valid plan keys, default values, and runtime validation. Used by `/api/billing/subscribe`, `/api/payments/webhook` (indirectly through plan key validation), the dashboard Billing UI, the landing page, and `app/dashboard/page.tsx`.

- [ ] **Step 1: Create the file**

Create `E:\Project\HCKCREA\lib\plans.ts`:

```ts
// Plan registry — single source of truth for the 4 subscription tiers.
//
// PLAN_DEFAULTS values match what migration 0042 seeded into
// app_settings.plan_*. loadPlan() reads the live values from
// app_settings so admin can tune prices via /admin/settings without
// a redeploy, with PLAN_DEFAULTS as the fallback if a setting row
// is missing or malformed.

import type { SupabaseClient } from "@supabase/supabase-js";

export const PLAN_KEYS = ["starter", "standard", "pro", "premium"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export type PlanConfig = {
  price: number;   // RM per cycle
  days: number;    // cycle length
  credits: number; // RM credits granted on purchase
  label: string;   // user-facing capitalised name
};

export const PLAN_DEFAULTS: Record<PlanKey, PlanConfig> = {
  starter:  { price: 35,  days: 30, credits: 10,  label: "Starter" },
  standard: { price: 50,  days: 30, credits: 25,  label: "Standard" },
  pro:      { price: 100, days: 30, credits: 50,  label: "Pro" },
  premium:  { price: 200, days: 30, credits: 100, label: "Premium" },
};

export const BEST_SELLER: PlanKey = "pro";

export function isPlanKey(s: unknown): s is PlanKey {
  return typeof s === "string" && (PLAN_KEYS as readonly string[]).includes(s);
}

export async function loadPlan(
  admin: SupabaseClient,
  key: PlanKey
): Promise<PlanConfig> {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", `plan_${key}`)
    .maybeSingle();
  const v = (data?.value as Partial<PlanConfig> | null) || {};
  const d = PLAN_DEFAULTS[key];
  return {
    price:   Number(v.price   ?? d.price),
    days:    Number(v.days    ?? d.days),
    credits: Number(v.credits ?? d.credits),
    label:   String(v.label   ?? d.label),
  };
}
```

- [ ] **Step 2: TypeScript check**

Run:

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "lib/plans" | head -5
```

Expected: no errors mentioning `lib/plans.ts`. Pre-existing lucide-react warnings elsewhere are fine.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add lib/plans.ts && \
  git commit -m "$(cat <<'EOF'
feat(billing): plan registry — PLAN_KEYS, PLAN_DEFAULTS, isPlanKey, loadPlan

Single source of truth for the 4 subscription tiers. Routes and UI
both import from here. loadPlan() reads live values from app_settings
(admin-tunable via /admin/settings) and falls back to PLAN_DEFAULTS
if a row is missing — defensive against a partial deploy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 3: `/api/billing/subscribe` — accept 4 plan keys

**Files:**
- Modify: `app/api/billing/subscribe/route.ts`

Replace the hard-coded `pro` validation + inline `loadProPlan()` with `isPlanKey()` + `loadPlan()` from the new registry. Chip product name now reflects the chosen tier.

- [ ] **Step 1: Rewrite the route file**

Replace the entire contents of `E:\Project\HCKCREA\app\api\billing\subscribe\route.ts` with:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createChipPurchase } from "@/lib/chip";
import { isPlanKey, loadPlan } from "@/lib/plans";

// 4-tier subscribe flow. Reads price/days/credits/label from
// app_settings.plan_<key> via loadPlan() so admin can tune any tier
// in /admin/settings without a redeploy.

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const planRaw = String(body?.plan || "").toLowerCase();
    if (!isPlanKey(planRaw)) {
      return NextResponse.json(
        { error: "Invalid plan. Expected one of: starter, standard, pro, premium" },
        { status: 400 }
      );
    }
    const plan = planRaw;

    const admin = createAdminClient();
    const cfg = await loadPlan(admin, plan);

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name, whatsapp")
      .eq("id", user.id)
      .single();

    const fullName = profile?.full_name || user.email?.split("@")[0] || "User";

    // Look up the user's referred_by so the webhook can grant a renewal
    // commission to the original referrer. Stored at signup time;
    // unchanged on renewal.
    const { data: refProfile } = await admin
      .from("profiles")
      .select("referred_by")
      .eq("id", user.id)
      .maybeSingle();
    const referredByCode = refProfile?.referred_by || null;

    // Create payment record in pending state. Webhook will flip to paid +
    // call applySubscription which sets plan_expires_at = now + days.
    const { data: payment, error: payErr } = await admin
      .from("payments")
      .insert({
        user_id: user.id,
        type: "subscription",
        plan,
        amount: cfg.price,
        currency: "MYR",
        status: "pending",
        metadata: {
          plan,
          credits: cfg.credits,
          days: cfg.days,
          label: cfg.label,
          referred_by_code: referredByCode,
        },
      })
      .select()
      .single();

    if (payErr || !payment) {
      console.error("Failed to create payment:", payErr);
      return NextResponse.json({ error: "Failed to create payment" }, { status: 500 });
    }

    const origin =
      req.headers.get("origin") ||
      process.env.APP_ORIGIN ||
      "https://peninglab.vercel.app";

    const purchase = await createChipPurchase({
      email: user.email!,
      fullName,
      productName: `PeningLab ${cfg.label} Plan — ${cfg.days} days`,
      amountMYR: cfg.price,
      reference: `SUB-${payment.id.substring(0, 8)}`,
      metadata: {
        type: "subscription",
        user_id: user.id,
        payment_id: payment.id,
        plan,
        credits: cfg.credits,
        days: cfg.days,
      },
      successRedirect: `${origin}/dashboard?payment=success`,
      failureRedirect: `${origin}/dashboard?payment=failed`,
      webhookUrl: `${origin}/api/payments/webhook`,
    });

    await admin
      .from("payments")
      .update({
        chip_purchase_id: purchase.id,
        chip_checkout_url: purchase.checkout_url,
      })
      .eq("id", payment.id);

    return NextResponse.json({
      ok: true,
      payment_id: payment.id,
      checkout_url: purchase.checkout_url,
    });
  } catch (e: any) {
    console.error("subscribe error:", e?.message);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "billing/subscribe" | head -5
```

Expected: no errors mentioning `app/api/billing/subscribe/route.ts`.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/billing/subscribe/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(billing/subscribe): accept 4 plan keys via plan registry

Replaces hard-coded "pro" validation + inline loadProPlan() with
isPlanKey() + loadPlan() from lib/plans.ts. Chip product name now
includes the tier label, e.g. "PeningLab Standard Plan — 30 days".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 4: `applySubscription` — replace expiry, don't stack

**Files:**
- Modify: `app/api/payments/webhook/route.ts` (function `applySubscription` only)

One line change. Buying a plan while one is still active sets `plan_expires_at = now + 30 days` (replace) instead of `currentExpiry + 30 days` (stack). Credits still add to the existing balance.

- [ ] **Step 1: Locate the function**

```bash
cd /e/Project/HCKCREA && grep -n "async function applySubscription" app/api/payments/webhook/route.ts
```

Expected: prints a line like `514:async function applySubscription(admin: any, payment: any) {`.

- [ ] **Step 2: Replace the expiry math block**

Inside `applySubscription`, replace this exact block:

```ts
  const now = new Date();
  const currentExpiry = profile?.plan_expires_at
    ? new Date(profile.plan_expires_at)
    : null;
  const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
```

With:

```ts
  // 4-tier policy: every purchase resets the cycle to a fresh 30 days
  // from now. Users knowingly forfeit remaining days when buying again.
  // Credits still ADD to the existing balance (see nextCredits below).
  const now = new Date();
  const newExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
```

- [ ] **Step 3: TypeScript check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "payments/webhook" | head -5
```

Expected: no errors mentioning `app/api/payments/webhook/route.ts`.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/payments/webhook/route.ts && \
  git commit -m "$(cat <<'EOF'
fix(webhook/applySubscription): replace expiry instead of stacking

4-tier policy: every successful subscription payment sets
plan_expires_at = now + days (typically 30). Previously the function
stacked days onto an already-future expiry. Credits still add to the
existing balance — only the expiry math changed.

Existing grandfathered Pro users behave the same as before until they
renew; on renewal they get a fresh 30 days from purchase date.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 5: `/api/credit/topup` — return 410 Gone

**Files:**
- Modify: `app/api/credit/topup/route.ts`

Topup is retired with the 4-tier rollout. Existing `profiles.credits` balances stay spendable forever — only new topup PURCHASES are blocked. Return 410 with a pointer to /dashboard/billing so the message is actionable.

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `E:\Project\HCKCREA\app\api\credit\topup\route.ts` with:

```ts
import { NextResponse } from "next/server";

// Credit topup is deprecated as of the 4-tier subscription rollout
// (spec: 2026-06-02-4tier-pricing-design). New credit acquisition
// happens only via subscription tiers at /dashboard/billing. Existing
// profiles.credits balances stay spendable forever — this route just
// blocks NEW topup checkouts.

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Credit top-up is no longer available. Subscribe to a plan at /dashboard/billing to receive credits.",
      replacement: "/dashboard/billing",
    },
    { status: 410 }
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "credit/topup" | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/api/credit/topup/route.ts && \
  git commit -m "$(cat <<'EOF'
feat(credit/topup): return 410 Gone — deprecated by 4-tier subscriptions

New credit acquisition happens only via subscription tiers at
/dashboard/billing. Existing profiles.credits balances stay spendable
forever; this route just blocks NEW topup checkouts. Response carries
a "replacement" hint so clients can route users to billing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 6: `components/pricing-tiers-grid.tsx` — shared 4-card grid

**Files:**
- Create: `components/pricing-tiers-grid.tsx`

Self-contained client component. Renders 4 tier cards in a responsive grid. Pro card has the BEST SELLER ribbon. Two render modes:
- `mode="dashboard"`: in-app authenticated context. Subscribe button calls `onSelect(key)`. Active plan shows "Current Plan" badge + smaller "Renew" CTA.
- `mode="marketing"`: anonymous landing page. Subscribe button is a Link that routes to `/login?next=/dashboard/billing&plan=<key>`.

- [ ] **Step 1: Create the file**

Create `E:\Project\HCKCREA\components\pricing-tiers-grid.tsx`:

```tsx
"use client";

import Link from "next/link";
import { CheckCircle2, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import {
  PLAN_KEYS,
  PLAN_DEFAULTS,
  BEST_SELLER,
  type PlanKey,
  type PlanConfig,
} from "@/lib/plans";

// 4-card pricing grid. Used in dashboard Billing tab AND landing page.
// The 4 plan configs come from PLAN_DEFAULTS so the marketing surface
// always renders SOMETHING even if app_settings is unreachable; the
// dashboard subscribe path re-fetches the live config server-side
// (via loadPlan in /api/billing/subscribe) before charging.

type Mode = "dashboard" | "marketing";

type Props = {
  mode: Mode;
  /** Current plan key from profiles.plan. Used to mark a card as active. */
  currentPlan?: string | null;
  /** ISO timestamp string of profiles.plan_expires_at. Used to detect
   *  if the current plan is still active. */
  currentExpiry?: string | null;
  /** When set, the matching card shows a spinner + disabled state. */
  loading?: PlanKey | null;
  /** Dashboard mode only: parent handles the API call. */
  onSelect?: (key: PlanKey) => void;
};

// Marketing quote rates — used to derive the per-plan
// "boleh generate" numbers shown on each card. These match the
// public-facing rates ("Image 20 sen, video 40 sen"). If admin tunes
// real generate rates in app_settings, those still flow through the
// cascade — these constants are purely for marketing math.
const QUOTE_RATE_IMAGE_MYR = 0.20;
const QUOTE_RATE_VIDEO_MYR = 0.40;

const FEATURE_LINES = [
  "Image AI — 20 sen / generate",
  "Video AI — 40 sen / 8s",
  "Unlimited generate (within credit balance)",
  "Auto Content, Clone Video, Story Telling",
  "MCP API access (peninglab-mcp npm)",
  "Group VIP support",
];

function tierAccent(key: PlanKey): {
  border: string;
  badgeBg: string;
  badgeText: string;
  cta: string;
  highlight: boolean;
} {
  const highlight = key === BEST_SELLER;
  if (highlight) {
    return {
      border: "rgba(250, 204, 21, 0.55)",
      badgeBg: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
      badgeText: "#000",
      cta: "linear-gradient(90deg, #facc15 0%, #eab308 100%)",
      highlight,
    };
  }
  return {
    border: "rgba(255,87,34,0.25)",
    badgeBg: "rgba(255,87,34,0.10)",
    badgeText: "var(--color-orange)",
    cta: "linear-gradient(90deg, #f97316 0%, #ea580c 100%)",
    highlight,
  };
}

export default function PricingTiersGrid({
  mode,
  currentPlan,
  currentExpiry,
  loading,
  onSelect,
}: Props) {
  const now = Date.now();
  const expiryMs = currentExpiry ? new Date(currentExpiry).getTime() : 0;
  const planActiveNow = !!currentPlan && expiryMs > now;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
      {PLAN_KEYS.map((key) => {
        const cfg: PlanConfig = PLAN_DEFAULTS[key];
        const accent = tierAccent(key);
        const isCurrent = planActiveNow && currentPlan === key;
        const isLoading = loading === key;
        const quoteVideos = Math.floor(cfg.credits / QUOTE_RATE_VIDEO_MYR);
        const quoteImages = Math.floor(cfg.credits / QUOTE_RATE_IMAGE_MYR);

        return (
          <div
            key={key}
            className={`relative rounded-3xl p-6 flex flex-col gap-4 transition ${
              accent.highlight ? "scale-100 lg:scale-[1.03]" : ""
            }`}
            style={{
              background: "var(--color-bg-elev)",
              border: `2px solid ${accent.border}`,
              boxShadow: accent.highlight
                ? "0 12px 32px rgba(250,204,21,0.18)"
                : "0 4px 16px rgba(0,0,0,0.05)",
            }}
          >
            {accent.highlight && (
              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest whitespace-nowrap"
                style={{
                  background: accent.badgeBg,
                  color: accent.badgeText,
                  boxShadow: "0 4px 12px rgba(250,204,21,0.35)",
                }}
              >
                ★ Best Seller
              </div>
            )}

            <div>
              <div
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3"
                style={{ background: accent.badgeBg, color: accent.badgeText }}
              >
                <Sparkles className="w-3 h-3" />
                {cfg.label}
              </div>
              <div className="flex items-baseline gap-1">
                <span className="font-display font-extrabold text-4xl tracking-tight">
                  RM{cfg.price}
                </span>
                <span className="text-sm text-[var(--color-text-muted)]">
                  /{cfg.days} hari
                </span>
              </div>
              <div className="mt-1 text-sm font-semibold" style={{ color: accent.badgeText }}>
                + RM{cfg.credits} credits
              </div>
            </div>

            {/* "Boleh generate" math callout — converts the credit
                allotment into video / image counts using the public
                marketing rates. Big visible numbers drive conversion. */}
            <div
              className="p-3 rounded-xl"
              style={{
                background: accent.badgeBg,
                border: `1px solid ${accent.border}`,
              }}
            >
              <div
                className="text-[10px] uppercase tracking-wider font-bold mb-1.5"
                style={{ color: accent.badgeText }}
              >
                Boleh generate
              </div>
              <div className="flex items-baseline gap-1.5">
                <span
                  className="font-display font-extrabold text-lg leading-none"
                  style={{ color: accent.badgeText }}
                >
                  ~{quoteVideos}
                </span>
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  video AI
                </span>
                <span className="text-[var(--color-text-muted)] mx-1">·</span>
                <span
                  className="font-display font-extrabold text-lg leading-none"
                  style={{ color: accent.badgeText }}
                >
                  ~{quoteImages}
                </span>
                <span className="text-[11px] text-[var(--color-text-secondary)]">
                  image AI
                </span>
              </div>
            </div>

            <div className="flex-1 space-y-2">
              {FEATURE_LINES.map((line) => (
                <div key={line} className="flex items-start gap-2 text-[12px]">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span className="text-[var(--color-text-secondary)]">{line}</span>
                </div>
              ))}
            </div>

            {isCurrent ? (
              <div className="flex flex-col gap-2">
                <div
                  className="text-center py-2 rounded-xl text-xs font-bold uppercase tracking-wider"
                  style={{
                    background: "rgba(16,185,129,0.10)",
                    color: "#10b981",
                    border: "1px solid rgba(16,185,129,0.25)",
                  }}
                >
                  Current Plan
                </div>
                {mode === "dashboard" && onSelect && (
                  <button
                    onClick={() => onSelect(key)}
                    disabled={!!loading}
                    className="w-full py-2.5 rounded-xl text-xs font-extrabold transition-transform hover:-translate-y-0.5 disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
                    style={{ background: accent.cta, color: "#000" }}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Redirecting…
                      </>
                    ) : (
                      <>Renew now</>
                    )}
                  </button>
                )}
              </div>
            ) : mode === "dashboard" && onSelect ? (
              <button
                onClick={() => onSelect(key)}
                disabled={!!loading}
                className="w-full py-3 rounded-xl text-sm font-extrabold transition-transform hover:-translate-y-0.5 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                style={{ background: accent.cta, color: "#000" }}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  <>
                    Subscribe
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            ) : (
              <Link
                href={`/login?next=${encodeURIComponent(
                  `/dashboard/billing?plan=${key}`
                )}`}
                className="w-full py-3 rounded-xl text-sm font-extrabold transition-transform hover:-translate-y-0.5 inline-flex items-center justify-center gap-2"
                style={{ background: accent.cta, color: "#000" }}
              >
                Subscribe
                <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "components/pricing-tiers-grid" | head -5
```

Expected: no errors mentioning `components/pricing-tiers-grid.tsx`. Pre-existing `lucide-react` warnings repo-wide are fine.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add components/pricing-tiers-grid.tsx && \
  git commit -m "$(cat <<'EOF'
feat(components): PricingTiersGrid shared 4-card grid

Self-contained client component used by both /dashboard Billing tab
and the landing-page pricing section. Renders 4 tiers from
PLAN_DEFAULTS with the Pro card highlighted (BEST SELLER ribbon).

Each card shows a "Boleh generate ~N video AI · ~M image AI" callout
derived from the tier's credit allotment (using 20 sen / 40 sen quote
rates) so customers see the value upfront — Starter 25 videos / 50
images, Premium 250 videos / 500 images.

Two modes:
- "dashboard": Subscribe button calls onSelect(key); active plan
  shows a "Current Plan" badge + smaller Renew CTA.
- "marketing": Subscribe is a Link to /login?next=/dashboard/billing
  ?plan=<key> so post-login lands on the right tier.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 7: Dashboard Billing — use `PricingTiersGrid`

**Files:**
- Modify: `app/dashboard/sections/billing.tsx`

Replace the `PRO_PLAN` constant + `ProPlanCard` single-tier render with `<PricingTiersGrid mode="dashboard" ... />`. Keep `ActivePlanHero` + `NoPlanHero` + payment history list. The plan label is now derived from the user's actual plan key (not hard-coded "Pro Plan").

- [ ] **Step 1: Replace the file**

Replace the entire contents of `E:\Project\HCKCREA\app\dashboard\sections\billing.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  ArrowRight,
  Calendar,
  ShieldCheck,
  Loader2,
  Receipt,
  CheckCircle2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import CheckStatusButton from "./check-status-button";
import PricingTiersGrid from "@/components/pricing-tiers-grid";
import { PLAN_DEFAULTS, isPlanKey, type PlanKey } from "@/lib/plans";

type Payment = {
  id: string;
  type: string;
  plan?: string;
  credits?: number;
  amount: number;
  status: "pending" | "paid" | "failed" | "refunded";
  chip_purchase_id?: string;
  chip_checkout_url?: string;
  created_at: string;
};

export default function BillingSection() {
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const [renewalRaw, setRenewalRaw] = useState<string | null>(null);
  const [renewalDate, setRenewalDate] = useState<string>("—");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState<PlanKey | null>(null);

  useEffect(() => {
    void loadProfile();
    void loadPayments();
  }, []);

  async function loadProfile() {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    const { data } = await sb
      .from("profiles")
      .select("plan, plan_expires_at")
      .eq("id", user.id)
      .single();
    if (data) {
      setCurrentPlan(data.plan || "free");
      if (data.plan_expires_at) {
        setRenewalRaw(data.plan_expires_at);
        setRenewalDate(
          new Date(data.plan_expires_at).toLocaleDateString("ms-MY", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        );
      } else {
        setRenewalRaw(null);
        setRenewalDate("—");
      }
    }
  }

  async function loadPayments() {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return;
    const { data } = await sb
      .from("payments")
      .select(
        "id,type,plan,credits,amount,status,chip_purchase_id,chip_checkout_url,created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setPayments((data as Payment[]) || []);
  }

  async function handleSelect(plan: PlanKey) {
    setLoading(plan);
    try {
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        alert(data?.error || "Failed to start subscription");
        setLoading(null);
      }
    } catch (e: any) {
      alert(e?.message || "Network error");
      setLoading(null);
    }
  }

  const planActive =
    isPlanKey(currentPlan) &&
    !!renewalRaw &&
    new Date(renewalRaw) > new Date();
  const planLabel = isPlanKey(currentPlan)
    ? PLAN_DEFAULTS[currentPlan].label
    : "Free";

  return (
    <div className="space-y-8">
      {/* Status hero — current plan summary OR no-plan CTA */}
      {planActive ? (
        <ActivePlanHero name={planLabel} renewalDate={renewalDate} />
      ) : (
        <NoPlanHero
          expired={!!renewalRaw && new Date(renewalRaw) < new Date()}
          renewalDate={renewalDate}
        />
      )}

      {/* Pricing grid — 4 tiers */}
      <div>
        <h3 className="font-display font-extrabold text-2xl tracking-tight mb-5">
          Choose your plan
        </h3>
        <PricingTiersGrid
          mode="dashboard"
          currentPlan={currentPlan}
          currentExpiry={renewalRaw}
          loading={loading}
          onSelect={handleSelect}
        />
      </div>

      {/* Payment history */}
      <div>
        <h3 className="font-display font-extrabold text-2xl tracking-tight mb-5 flex items-center gap-2">
          <Receipt className="w-5 h-5 text-[var(--color-text-muted)]" />
          Payment history
        </h3>
        <div className="card p-0 overflow-hidden">
          <div
            className="hidden md:flex px-6 py-4 border-b border-[var(--color-border)] items-center text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]"
            style={{ background: "rgba(255,87,34,0.04)" }}
          >
            <span className="w-32">Date</span>
            <span className="flex-1">Description</span>
            <span className="w-24">Amount</span>
            <span className="w-44 text-right">Status</span>
          </div>
          {payments.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-[var(--color-text-secondary)] font-medium">
                Tiada payment history lagi.
              </p>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Subscribe pertama kali, transaction akan muncul di sini.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-3"
                >
                  <span className="w-32 text-sm text-[var(--color-text-secondary)] font-mono">
                    {new Date(p.created_at).toLocaleDateString("ms-MY", {
                      day: "numeric",
                      month: "short",
                      year: "2-digit",
                    })}
                  </span>
                  <span className="flex-1 text-sm font-semibold">
                    {p.type === "subscription"
                      ? `${
                          isPlanKey(p.plan ?? "")
                            ? PLAN_DEFAULTS[p.plan as PlanKey].label
                            : (p.plan || "Plan").toUpperCase()
                        } Plan`
                      : `Top up ${p.credits ?? 0} credits`}
                  </span>
                  <span className="w-24 text-sm font-bold">
                    RM{Number(p.amount).toFixed(2)}
                  </span>
                  <div className="md:w-44 md:flex md:justify-end">
                    {p.chip_purchase_id ? (
                      <CheckStatusButton
                        chipPurchaseId={p.chip_purchase_id}
                        initialStatus={p.status}
                        onUpdate={() => {
                          void loadPayments();
                          void loadProfile();
                        }}
                      />
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)] italic">
                        no purchase id
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Hero variants ─────────────────────────────────────────────────────────
function ActivePlanHero({
  name,
  renewalDate,
}: {
  name: string;
  renewalDate: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-8 md:p-10"
      style={{
        background:
          "linear-gradient(135deg, #1a0a05 0%, #2d1208 50%, #4d1f0a 100%)",
      }}
    >
      <div
        className="absolute"
        style={{
          top: -100,
          right: -100,
          width: 400,
          height: 400,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255, 87, 34, 0.4), transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div className="relative grid md:grid-cols-2 gap-8 items-center">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-5 rounded-full bg-white/15 border border-white/20 backdrop-blur-md text-xs font-bold uppercase tracking-wider text-white">
            <Sparkles className="w-3 h-3" />
            Current Plan
          </div>
          <h2 className="font-display font-extrabold text-5xl md:text-6xl tracking-tight text-white mb-3">
            {name}
          </h2>
          <p className="text-white/80 text-lg">
            Active subscription · Renews {renewalDate}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-5 bg-white/10 border border-white/15 backdrop-blur-md">
            <div className="text-xs uppercase tracking-wider text-white/60 font-bold mb-1.5">
              Renewal
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-white/80" />
              <span className="text-white font-semibold text-sm">
                {renewalDate}
              </span>
            </div>
          </div>
          <div className="rounded-2xl p-5 bg-white/10 border border-white/15 backdrop-blur-md">
            <div className="text-xs uppercase tracking-wider text-white/60 font-bold mb-1.5">
              Status
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-white font-semibold text-sm">Active</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoPlanHero({
  expired,
  renewalDate,
}: {
  expired: boolean;
  renewalDate: string;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl p-8 md:p-10"
      style={{
        background:
          "linear-gradient(135deg, #1a1a1a 0%, #1d1310 50%, #2d1810 100%)",
      }}
    >
      <div
        className="absolute"
        style={{
          top: -120,
          right: -120,
          width: 400,
          height: 400,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255, 87, 34, 0.18), transparent 70%)",
          filter: "blur(60px)",
        }}
      />
      <div className="relative">
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-5 rounded-full bg-white/8 border border-white/15 text-xs font-bold uppercase tracking-wider text-white/80">
          {expired ? "Expired" : "No active plan"}
        </div>
        <h2 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight text-white mb-3">
          {expired ? "Subscription expired" : "Pick a plan to start"}
        </h2>
        <p className="text-white/70 text-base max-w-xl">
          {expired
            ? `Subscription habis tempoh pada ${renewalDate}. Subscribe semula bawah untuk continue generating.`
            : "Akses penuh — Image AI, Video AI, Auto Content, Clone, Story Telling. Pilih plan ikut bajet bawah."}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "sections/billing" | head -5
```

Expected: no errors mentioning `app/dashboard/sections/billing.tsx`.

- [ ] **Step 3: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/dashboard/sections/billing.tsx && \
  git commit -m "$(cat <<'EOF'
feat(dashboard/billing): swap single Pro card for PricingTiersGrid

The Billing tab now renders the 4-tier grid (Starter/Standard/Pro
BEST SELLER/Premium) via the shared PricingTiersGrid component.
Active plan hero + payment history list stay; the single-tier
PRO_PLAN constant + ProPlanCard component are deleted. Plan labels
in the payment history now derive from PLAN_DEFAULTS[plan].label
instead of hard-coded "Pro Plan".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 8: Landing page — use `PricingTiersGrid` in marketing mode

**Files:**
- Modify: `app/page.tsx` (replace the pricing section's single Pro card with the shared grid; keep the surrounding headline/countdown/explainer)

The pricing section spans roughly lines 1110–1310 (`<section id="pricing">`). Inside it, replace the single-card block — the `<div className="max-w-2xl mx-auto relative pt-6">` (line ~1131) and its entire contents through its closing `</div></div>` — with `<PricingTiersGrid mode="marketing" />`. Keep the `<Countdown />` and the rate-deduction explainer below it.

- [ ] **Step 1: Add the import**

Open `E:\Project\HCKCREA\app\page.tsx` and find the existing imports near the top. Add this import (alongside the other `@/components/...` or relative imports — group near top of file):

```tsx
import PricingTiersGrid from "@/components/pricing-tiers-grid";
```

- [ ] **Step 2: Replace the single-tier block**

Locate the block that begins (around line 1131):

```tsx
        {/* Single exclusive Pro plan */}
        <div className="max-w-2xl mx-auto relative pt-6">
```

and ends with the closing `</div>` of the outer `<div className="max-w-2xl mx-auto relative pt-6">` (around line 1243, just before `{/* Rate-deduction explainer */}`).

Replace that entire block with:

```tsx
        {/* 4-tier pricing grid */}
        <div className="mt-2">
          <PricingTiersGrid mode="marketing" />
        </div>
```

The countdown above and the rate-deduction explainer below stay in place.

- [ ] **Step 3: Update the headline copy if needed**

The current headline says "Pilih plan, mula scale UGC" and subtitle "Subscription bulanan + top up kredit." The mention of top-up is now misleading. Update the subtitle (around line 1121-1124) from:

```tsx
          <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Subscription bulanan + top up kredit. Setiap generate auto-deduct
            ikut rate plan anda.
          </p>
```

To:

```tsx
          <p className="mt-5 text-lg text-[var(--color-text-secondary)] max-w-2xl mx-auto">
            Pilih tier ikut bajet — setiap plan datang dengan kredit RM
            terus boleh generate. Setiap generate auto-deduct ikut rate.
          </p>
```

- [ ] **Step 4: Update the rate-deduction explainer**

The step explainer mentions "Top up kredit" as step 2. Update it to reflect the new flow. Find the block starting `{/* Rate-deduction explainer */}` and replace the inner three step cells. Locate:

```tsx
            <div className="flex items-start gap-3">
              <div className="step-pill flex-shrink-0">2</div>
              <div>
                <div className="font-display font-bold text-base mb-1">
                  Top up kredit
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  RM1 = 1 kredit. Top up bila perlu. Kredit tak hangus.
                </p>
              </div>
            </div>
```

Replace with:

```tsx
            <div className="flex items-start gap-3">
              <div className="step-pill flex-shrink-0">2</div>
              <div>
                <div className="font-display font-bold text-base mb-1">
                  Dapat kredit RM serta-merta
                </div>
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Setiap plan datang dengan RM credits sekali. Tak perlu top
                  up berasingan.
                </p>
              </div>
            </div>
```

Also update step 1 (which mentions "Bayar RM75"). Find:

```tsx
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Bayar RM75 — unlock semua features + dapat rate generate
                  paling rendah.
                </p>
```

Replace with:

```tsx
                <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                  Pilih tier (Starter / Standard / Pro / Premium) ikut bajet —
                  semua tier unlock features yang sama.
                </p>
```

Also update the example footer of the explainer. Find:

```tsx
            — RM75 plan + top up RM30 ={" "}
            <span className="font-bold text-[var(--color-text-primary)]">
              ~150 image
            </span>{" "}
            atau{" "}
            <span className="font-bold text-[var(--color-text-primary)]">
              75 video 8s
            </span>
            .
```

Replace with:

```tsx
            — Plan Pro RM100 + RM50 credits ={" "}
            <span className="font-bold text-[var(--color-text-primary)]">
              250 image
            </span>{" "}
            atau{" "}
            <span className="font-bold text-[var(--color-text-primary)]">
              125 video 8s
            </span>
            .
```

- [ ] **Step 5: TypeScript check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "app/page" | head -10
```

Expected: no errors mentioning `app/page.tsx`. Pre-existing repo-wide warnings are fine.

- [ ] **Step 6: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/page.tsx && \
  git commit -m "$(cat <<'EOF'
feat(landing): 4-tier PricingTiersGrid in pricing section

Replaces the single-Pro card with the shared PricingTiersGrid in
marketing mode. Headline subtitle + step explainer + example footer
updated to reflect the new "every plan ships with RM credits, no
separate topup" flow.

Anonymous Subscribe CTAs route via
/login?next=/dashboard/billing?plan=<key> so post-login lands the
user on the right tier.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 9: Sidebar — remove Credit nav entry + "+ Top Up" button

**Files:**
- Modify: `app/dashboard/sidebar.tsx`

The Credit row in the Account nav and the "+ Top Up" button on the credit-balance card both point at `{ kind: "credit" }`. Remove both. The `kind: "credit"` view union arm stays (harmless if `CreditSection` deep links still work) — but no UI surfaces it. Re-point the credit-balance card's primary action to Billing.

- [ ] **Step 1: Remove the Credit nav entry**

Inside the Account section's array of nav items, find:

```tsx
            { kind: "credit" as const, label: "Top Up Credit", Icon: Wallet },
```

Delete that line. (Leave the surrounding `Attachments`, `Billing`, `Affiliate`, `Usage` entries intact.)

- [ ] **Step 2: Re-point the "+ Top Up" button to Billing**

Find the credit-balance card around line 700–728. The button:

```tsx
          <button
            onClick={() => onViewChange({ kind: "credit" })}
            className="mt-2 w-full py-2 rounded-lg text-xs font-extrabold transition-transform hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(90deg, var(--color-orange) 0%, #facc15 100%)",
              color: "#000",
              boxShadow: "0 4px 14px rgba(250,204,21,0.3)",
            }}
          >
            + Top Up
          </button>
```

Replace with:

```tsx
          <button
            onClick={() => onViewChange({ kind: "billing" })}
            className="mt-2 w-full py-2 rounded-lg text-xs font-extrabold transition-transform hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(90deg, var(--color-orange) 0%, #facc15 100%)",
              color: "#000",
              boxShadow: "0 4px 14px rgba(250,204,21,0.3)",
            }}
          >
            Subscribe
          </button>
```

- [ ] **Step 3: TypeScript check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "dashboard/sidebar" | head -5
```

Expected: no errors mentioning `app/dashboard/sidebar.tsx`.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/dashboard/sidebar.tsx && \
  git commit -m "$(cat <<'EOF'
feat(dashboard/sidebar): remove Credit nav entry + retarget Top Up button

Topup is deprecated by 4-tier subscriptions (every plan ships with
RM credits, no standalone topup). Removes the "Top Up Credit" Account
nav row and retargets the credit-balance card's primary action from
{kind:"credit"} to {kind:"billing"} with copy "Subscribe".

The SidebarView "credit" union arm stays — CreditSection component
is still in the repo and routable, just not surfaced in nav.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 10: Dashboard `planActive` — broaden via `isPlanKey()`

**Files:**
- Modify: `app/dashboard/page.tsx`

The current check `plan === "pro"` only treats Pro as active. The 4-tier system needs all valid plan keys to gate access. Use `isPlanKey()` from the registry so adding/removing tiers automatically updates this check.

- [ ] **Step 1: Add the import**

Open `E:\Project\HCKCREA\app\dashboard\page.tsx`. At the top, add this import (group with the other `@/lib/...` imports):

```ts
import { isPlanKey } from "@/lib/plans";
```

- [ ] **Step 2: Replace the `planActive` expression**

Find this line (around line 46–49):

```ts
  const planActive =
    plan === "pro" &&
    !!planExpiresAt &&
    new Date(planExpiresAt) > new Date();
```

Replace with:

```ts
  const planActive =
    isPlanKey(plan) &&
    !!planExpiresAt &&
    new Date(planExpiresAt) > new Date();
```

- [ ] **Step 3: TypeScript check**

```bash
cd /e/Project/HCKCREA && npx tsc --noEmit -p . 2>&1 | grep -E "app/dashboard/page" | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit + push**

```bash
cd /e/Project/HCKCREA && \
  git add app/dashboard/page.tsx && \
  git commit -m "$(cat <<'EOF'
feat(dashboard): planActive accepts all 4 tier keys via isPlanKey

Previously hard-coded plan === "pro". Now any current plan key in
PLAN_KEYS counts as active (plus the unchanged expiry check).
Existing Pro users still active; Starter/Standard/Premium users will
correctly unlock the dashboard once they subscribe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)" && \
  git push
```

---

## Task 11: Manual production smoke test

**Files:** None modified.

Tasks 1–10 deploy to Vercel automatically on push. After the last push, give Vercel ~90 seconds, then verify end-to-end. This task is a checklist surfaced to the user — the agent should print the checklist and stop, NOT click through browser flows autonomously.

- [ ] **Step 1: Wait for Vercel to finish deploying the last commit (Task 10)**

Vercel deploys are visible at https://vercel.com/<user>/peninglab. Wait until the deployment for the Task 10 commit shows "Ready" (typically 60–120 s).

- [ ] **Step 2: Verify migration applied + 4 plan rows live**

Call `mcp__supabase__execute_sql` with:

```sql
select key, value->>'price' as price, value->>'credits' as credits, value->>'label' as label
from public.app_settings
where key like 'plan_%'
order by (value->>'price')::numeric;
```

Expected output (4 rows, in price order):
- `plan_starter` price=35 credits=10 label=Starter
- `plan_standard` price=50 credits=25 label=Standard
- `plan_pro` price=100 credits=50 label=Pro
- `plan_premium` price=200 credits=100 label=Premium

- [ ] **Step 3: Verify the topup deprecation**

```bash
curl -sS -X POST https://peninglab.com/api/credit/topup \
  -H "Content-Type: application/json" \
  -d '{"credits":10}'
```

Expected: HTTP 410, body `{"error":"Credit top-up is no longer available...","replacement":"/dashboard/billing"}`.

- [ ] **Step 4: Click-through smoke test (browser, manual)**

Surface the following checklist to the user. They run it themselves since signup/login/payment is interactive:

```
1. Open https://peninglab.com/ in a fresh incognito window.
   - Scroll to the pricing section (#pricing).
   - Confirm you see 4 cards: Starter (RM35) / Standard (RM50) /
     Pro (RM100 ★ BEST SELLER) / Premium (RM200).
   - Confirm Pro card has a BEST SELLER ribbon + amber glow + slight
     scale-up on desktop.
   - Click Subscribe on the Starter card.
   - You should land on /login?next=/dashboard/billing?plan=starter.

2. Log in as admin@gmail.com (your existing Pro account).
   - You should land at /dashboard.
   - Sidebar Account section: confirm "Top Up Credit" entry is GONE.
   - Credit balance card (top-right of sidebar): confirm the button now
     reads "Subscribe" (not "+ Top Up") and routes to Billing.

3. Click sidebar → Billing.
   - You should see the ActivePlanHero (your existing Pro is still active).
   - Below it: 4-card grid. The Pro card should show a "Current Plan"
     green badge + a smaller "Renew now" button.
   - Other 3 cards have normal Subscribe buttons.

4. Click Subscribe on the Standard card (RM50).
   - You're redirected to Chip checkout for RM50.
   - The product line should read "PeningLab Standard Plan — 30 days".
   - Cancel / close the Chip page.

5. (Optional, if you want to test the full flow with a real payment)
   - Click Subscribe again, complete the RM50 Chip payment.
   - On success redirect, dashboard should refresh:
     - profiles.plan = "standard"
     - profiles.plan_expires_at = now + 30 days  (REPLACED, not stacked)
     - profiles.credits = previous balance + RM25
     - Active plan hero now reads "Standard"
     - Standard card shows "Current Plan" badge; Pro and others show
       Subscribe again.

6. Verify the payment history list shows the new "Standard Plan" row
   with status "paid".
```

- [ ] **Step 5: Mark plan complete**

When all checks pass, the 4-tier rollout is live. No commit needed for this task.

---

## Self-Review

**1. Spec coverage**

| Spec section | Plan task |
|---|---|
| §Decision summary | Tasks 1–10 (each decision implemented) |
| §Pricing matrix | Task 1 (migration seeds the 4 rows with these exact values) |
| §Section A — DB migration | Task 1 |
| §Section B — `/api/billing/subscribe` | Task 3 |
| §Section B — `applySubscription` replace expiry | Task 4 |
| §Section B — `/api/credit/topup` 410 | Task 5 |
| §Section C — `components/pricing-tiers-grid.tsx` | Task 6 |
| §Section C — dashboard billing.tsx | Task 7 |
| §Section C — landing app/page.tsx | Task 8 |
| §Section C — sidebar.tsx (Credit nav removal) | Task 9 |
| §Section C — `planActive` via isPlanKey | Task 10 |
| §Out of scope (no auto-renew, no proration, etc.) | Honored — none of those features show up in any task |
| §Manual smoke test | Task 11 |

All spec sections have a matching task. No gaps.

**2. Placeholder scan**

Searched for "TBD", "TODO", "implement later", "Add appropriate error handling", "Similar to Task". None present. Every code block is the full code an engineer pastes.

**3. Type consistency**

- `PLAN_KEYS`, `PlanKey`, `PLAN_DEFAULTS`, `BEST_SELLER`, `isPlanKey`, `loadPlan`, `PlanConfig` — all defined in Task 2 (`lib/plans.ts`) and consumed by Tasks 3, 6, 7, 10 with matching signatures.
- `PricingTiersGrid` component props (`mode`, `currentPlan`, `currentExpiry`, `loading`, `onSelect`) — defined in Task 6, consumed in Tasks 7 (dashboard) and 8 (landing) with the right shape.
- Migration column names (`key`, `value`, `description`, `category`) match the existing `app_settings` schema as used by `app_settings.plan_pro` in the original codebase.

All type and signature references are consistent across tasks.
