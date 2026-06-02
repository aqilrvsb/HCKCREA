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
