# 4-Tier Subscription Pricing — Design Spec

**Date:** 2026-06-02
**Status:** Approved, ready for implementation plan
**Replaces:** Single Pro plan (RM75/mo) + standalone credit topup

## Goal

Replace the current 1-plan-plus-topup billing model with a 4-tier monthly subscription system. Each tier costs a fixed RM amount per 30 days and grants a fixed RM credit allotment. The Topup tab is hidden — credits can only be acquired via subscription.

## Decision summary

| Question | Decision |
|---|---|
| Stacking rule | **Replace expiry to now+30** + add credits (no day-stacking) |
| Feature access | **All tiers identical** — only price + credits differ |
| Plan names | **Starter / Standard / Pro / Premium** |
| Pricing UI location | **Both** — dashboard Billing tab + landing page (shared component) |
| Price tunability | **Admin-tunable via `/admin/settings`** (matches existing pattern) |
| Existing pro users | **Grandfathered** — keep their `plan="pro"` + `plan_expires_at` until expiry, then rebuy |
| Existing topup credits | **Preserved** — `profiles.credits` balance stays spendable forever |
| Auto-renew | Out of scope (V2 feature) |
| Mid-cycle proration | Out of scope — user knowingly forfeits remaining days |
| Per-tier feature gating | Out of scope — all 4 tiers unlock identical access |

## Pricing matrix

| Plan | DB key | Price (RM) | Credits granted (RM) | Days | Badge |
|---|---|---|---|---|---|
| Starter | `starter` | 35 | 10 | 30 | — |
| Standard | `standard` | 50 | 25 | 30 | — |
| Pro | `pro` | 100 | 50 | 30 | **BEST SELLER** |
| Premium | `premium` | 200 | 100 | 30 | — |

**Credit-to-price ratio:** Starter 28.6% (mostly access), other three 50% (mostly credits). Pro is the optimal value-per-RM and gets the Best Seller treatment.

## Current state (what exists today)

- `app_settings.plan_pro` row stores `{price: 75, days: 30, credits: 0, label: "Pro Plan"}` — admin-tunable.
- `profiles.plan` column stores plan key (`"free"` / `"light"` / `"pro"`).
- `profiles.plan_expires_at` stores the renewal date.
- `/api/billing/subscribe` POST creates a `payments` row + Chip purchase, redirects to checkout.
- `/api/payments/webhook` calls `applySubscription()` on payment success which currently STACKS days onto `plan_expires_at`.
- `/api/credit/topup` POST creates a topup payment + Chip purchase; webhook calls `applyCreditTopup()` which adds credits.
- Dashboard Billing tab shows a single Pro card with subscribe CTA.
- Dashboard Credit tab shows 5 topup packages (10/20/30/50/100 credits, 1:1 RM:credit).
- Landing page hero references the single Pro plan.
- Plan access gating is loose: most features check `hasEnoughCredits` rather than plan; dashboard tabs guard via `planActive = plan === "pro" && plan_expires_at > now`.

## Architecture — Approach 1 (Minimal-Touch)

Reuse every existing pattern (`app_settings`-backed pricing, Chip checkout, webhook → `applySubscription` path, atomic CAS). Add 3 sibling `app_settings` rows, change one math line in the webhook, replace the dashboard Billing card with a 4-card grid component, reuse the grid on the landing page, hide the Credit tab from the sidebar nav.

### Section A — Database changes

**Migration `0042_4tier_plans.sql`:**

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

### Section B — Backend changes

**`lib/plans.ts` (NEW):** central plan registry — single source of truth for the 4 valid plan keys, default values, and validation.

```ts
export const PLAN_KEYS = ["starter", "standard", "pro", "premium"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const PLAN_DEFAULTS: Record<PlanKey, {
  price: number; days: number; credits: number; label: string;
}> = {
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
  admin: AdminClient, key: PlanKey
): Promise<{ price: number; days: number; credits: number; label: string }> {
  const { data } = await admin.from("app_settings")
    .select("value").eq("key", `plan_${key}`).maybeSingle();
  const v = (data?.value as any) || {};
  const d = PLAN_DEFAULTS[key];
  return {
    price:   Number(v.price   ?? d.price),
    days:    Number(v.days    ?? d.days),
    credits: Number(v.credits ?? d.credits),
    label:   String(v.label   ?? d.label),
  };
}
```

**`/api/billing/subscribe` route changes:**
- Replace inline `loadProPlan()` with `loadPlan(admin, planKey)` from `lib/plans.ts`.
- Replace `if (plan !== "pro")` validation with `if (!isPlanKey(plan))` → 400.
- Pass `planKey` everywhere `"pro"` was hardcoded.
- Chip product name becomes `` `PeningLab ${cfg.label} Plan — ${cfg.days} days` ``.

**`applySubscription()` in `/api/payments/webhook` — math change:**

```diff
- const currentExpiry = profile?.plan_expires_at ? new Date(profile.plan_expires_at) : null;
- const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
- const newExpiry = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
+ const newExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
```

The replace-rather-than-stack behavior matches the design decision. Credits still add: `nextCredits = currentCredits + credits`.

**`/api/credit/topup` route — deprecated:**

```ts
export async function POST() {
  return NextResponse.json(
    { error: "Credit topup is no longer available. Subscribe to a plan at /dashboard/billing to receive credits." },
    { status: 410 }
  );
}
```

Existing topup balances in `profiles.credits` stay spendable — only NEW topups are blocked.

### Section C — Frontend changes

**Shared component `components/pricing-tiers-grid.tsx` (NEW):**

```ts
type Props = {
  mode: "dashboard" | "marketing";
  currentPlan?: string | null;
  currentExpiry?: string | null;
  loading?: PlanKey | null;
  onSelect: (key: PlanKey) => void;
};
```

- Renders 4 cards in a responsive grid (1 col mobile → 2 col tablet → 4 col desktop).
- Pro card gets a BEST SELLER ribbon (amber accent + thicker border + slight scale-up).
- Each card displays: tier name, price (RM X/30 days), credits granted (+ RM Y credits), "Access all features" line, primary CTA button.
- Active plan (`currentPlan === key && currentExpiry > now`) shows a "Current Plan" badge instead of the Subscribe button, with a smaller "Renew" CTA below.
- `mode="marketing"`: Subscribe button routes to `/login?next=/dashboard/billing` if not authenticated.
- `mode="dashboard"`: Subscribe button calls `onSelect(key)` (parent makes the API call).

**Dashboard `app/dashboard/sections/billing.tsx`:**
- Keep the top status panel: current plan badge + "Expires in N days" countdown + Renew CTA.
- Replace the single Pro card section with `<PricingTiersGrid mode="dashboard" ... />`.
- `onSelect` posts to `/api/billing/subscribe` with the chosen `planKey`, redirects to `data.checkout_url`.
- Payment history list at the bottom stays as-is (so users can see past topups + subscriptions).

**Landing page `app/page.tsx`:**
- Locate the existing pricing hero section, replace with `<PricingTiersGrid mode="marketing" ... />`.
- Subscribe CTAs route to `/login?next=/dashboard/billing&plan=<key>` so post-login lands them on the right tier.

**Sidebar `app/dashboard/sidebar.tsx`:**
- Remove the "Credit" nav entry.
- `CreditSection` component stays in repo (not deleted) so the route works if any deep link exists, but no nav surfaces it.

**Dashboard plan badge** (in `app/dashboard/page.tsx` where `planActive` is computed):
- Currently:
  ```ts
  const planActive = plan === "pro" && !!planExpiresAt && new Date(planExpiresAt) > new Date();
  ```
- Update to:
  ```ts
  import { isPlanKey } from "@/lib/plans";
  const planActive = isPlanKey(plan) && !!planExpiresAt && new Date(planExpiresAt) > new Date();
  ```
- Plan label shown to user uses `PLAN_DEFAULTS[plan].label` (capitalised) so the badge reads "Starter" / "Standard" / "Pro" / "Premium" instead of the raw key.

### Section D — Migration & out of scope

**User-visible migration:**
- Existing pro subscribers: see no immediate change. Plan badge keeps showing "Pro". Their RM75 → RM100 transition happens silently on renewal (they'll click Renew and pay the new RM100 price + receive RM50 credits for the first time).
- Free / light users: see the new 4-card grid on dashboard Billing, can subscribe to any tier.
- Existing topup credits in `profiles.credits` are NEVER wiped.

**Out of scope (intentional YAGNI):**
- Auto-renew via saved Chip card (V2).
- Annual billing discount tier.
- Mid-cycle proration / refunds.
- Per-tier feature gating (all tiers unlock identical access).
- Pre-subscription expiry warning ("you have 12 days left — buying now resets that").
- Discount codes / promo codes.
- A/B testing UI for pricing.
- New `/pricing` standalone route (shared component reused in 2 places suffices).

## Data flow — subscribe purchase

```
User clicks Subscribe (Pro tier) in dashboard Billing
  ↓
POST /api/billing/subscribe { plan: "pro" }
  ↓
Route validates plan key (PLAN_KEYS whitelist)
  ↓
Route calls loadPlan(admin, "pro") → { price: 100, days: 30, credits: 50, label: "Pro" }
  ↓
Route inserts payments row (status=pending, type=subscription, plan="pro",
  amount=100, metadata={ plan, credits, days, label })
  ↓
Route creates Chip purchase (RM 100)
  ↓
Response: { checkout_url } — client redirects user to Chip
  ↓
User pays on Chip → Chip POSTs webhook
  ↓
/api/payments/webhook fetches Chip purchase, atomic CAS to "paid"
  ↓
applySubscription(payment) reads metadata:
  - newExpiry = now + 30 days  (REPLACE, not stack)
  - nextCredits = currentCredits + 50
  - update profiles SET plan="pro", plan_expires_at=newExpiry, credits=nextCredits
  - insert credit_transactions row for the 50 RM grant
  - notify admin via WhatsApp
  - fire CAPI Purchase event
  ↓
User redirected back to /dashboard?payment=success
  ↓
Dashboard refreshes: badge shows "Pro · expires in 30 days", balance shows new total
```

## Error handling

- **Unknown plan key in POST** → 400 `{ error: "Invalid plan" }`.
- **Chip purchase creation fails** → 500, payment row stays pending (admin sees it in /admin/transactions).
- **Webhook fires twice (Chip retry)** → CAS pattern in existing webhook (`neq("status", newStatus)`) catches it; second call is a no-op.
- **User pays but webhook never arrives** → admin can manually re-fire via /admin/transactions Check Status button (existing).
- **User on expired plan tries to call /api/billing/subscribe** → works fine, just buys a fresh 30 days.
- **User clicks Subscribe twice quickly** → first call creates payment, second creates a SECOND payment. Both go through. We're not preventing this — it's the same edge case as today and is rare. Optional future: 5s debounce.

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/0042_4tier_plans.sql` | NEW — seed 3 sibling plan settings, update plan_pro |
| `lib/plans.ts` | NEW — PLAN_KEYS, PLAN_DEFAULTS, isPlanKey, loadPlan |
| `app/api/billing/subscribe/route.ts` | MODIFY — accept 4 plan keys, use loadPlan() |
| `app/api/payments/webhook/route.ts` | MODIFY — replace-expiry math in applySubscription() |
| `app/api/credit/topup/route.ts` | MODIFY — return 410 Gone |
| `components/pricing-tiers-grid.tsx` | NEW — shared 4-card grid component |
| `app/dashboard/sections/billing.tsx` | MODIFY — swap single Pro card for grid |
| `app/page.tsx` | MODIFY — landing pricing section uses grid |
| `app/dashboard/sidebar.tsx` | MODIFY — remove Credit nav entry |
| `app/dashboard/page.tsx` | MODIFY — broaden planActive check via isPlanKey() |

## Testing approach

No automated test suite in this repo. Manual smoke tests after deploy:

1. **Migration applies cleanly:** `select key, value from app_settings where key like 'plan_%'` returns 4 rows.
2. **Subscribe each tier:**
   - Use a non-pro test user → click each tier in dashboard Billing → confirm Chip checkout page shows the right RM amount.
   - Complete a payment via Chip sandbox → confirm webhook fires → confirm `profiles.plan = <key>`, `plan_expires_at = now+30d`, `credits` increased by the tier amount.
3. **Replace-expiry:** existing pro user with 12 days remaining buys Premium → confirm `plan_expires_at = now+30d` (NOT now+42d).
4. **Topup deprecated:** POST /api/credit/topup → returns 410.
5. **Landing page:** anonymous visitor sees 4-card grid; clicking Subscribe routes to /login.
6. **Sidebar:** Credit nav entry gone; existing topup history still visible inside Billing → Payment history.
7. **Plan gating:** user on Starter can access all dashboard tabs (same as Pro user). User with expired plan_expires_at is blocked from tabs (existing behavior).

## Open questions

None — all decisions confirmed via brainstorming questions.

## References

- Existing single-Pro subscribe flow: `app/api/billing/subscribe/route.ts`
- Existing webhook + applySubscription: `app/api/payments/webhook/route.ts`
- Existing Pro plan settings: `app_settings.plan_pro` row
- Existing dashboard Billing UI: `app/dashboard/sections/billing.tsx`
- Existing topup UI: `app/dashboard/sections/credit.tsx`
- Chip payment helper: `lib/chip.ts`
