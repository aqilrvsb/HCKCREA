import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlanKey, isLivehost } from "@/lib/plans";
import DashboardShell from "./dashboard-shell";
import LivehostDashboard from "./livehost-dashboard";
import ExpiredBilling from "./expired-billing";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Read live credits + name + plan/expiry from the profile row (admin client
  // because RLS hits .single() before the trigger has populated everything).
  const admin = createAdminClient();
  const [{ data: profile }, { data: affiliateApp }] = await Promise.all([
    admin
      .from("profiles")
      .select("credits, full_name, plan, plan_expires_at, is_admin")
      .eq("id", user.id)
      .maybeSingle(),
    // An "approved" affiliate row keyed by this user — used to swap the
    // sidebar's WhatsApp join link to the affiliate-only group.
    admin
      .from("affiliate_applications")
      .select("id")
      .eq("approved_user_id", user.id)
      .eq("status", "approved")
      .limit(1)
      .maybeSingle(),
  ]);
  const isAffiliate = !!affiliateApp?.id;

  const credits = Number(profile?.credits ?? 0);
  const name =
    profile?.full_name ||
    (user.user_metadata?.full_name as string) ||
    user.email?.split("@")[0] ||
    "User";

  const plan = (profile?.plan as string) || "free";
  const planExpiresAt = (profile?.plan_expires_at as string) || null;
  const planActive =
    isPlanKey(plan) &&
    !!planExpiresAt &&
    new Date(planExpiresAt) > new Date();

  // ACCESS GATE — per admin direction, a client with NO active plan (expired
  // or never subscribed) can log in but reaches ONLY the Billing surface so they
  // can self-renew (Pro/Premium) — no projects / generation tabs (per user
  // direction 2026-07-28). Admins are exempt. Session stays alive.
  const isAdmin = !!profile?.is_admin;
  if (!planActive && !isAdmin) {
    return <ExpiredBilling name={name} plan={plan} planExpiresAt={planExpiresAt} />;
  }

  // Livehost is a SEPARATE package — render its own (blank) dashboard
  // instead of the generation studio. Billing inside it shows only the
  // Livehost package (see app/dashboard/sections/billing.tsx branch).
  if (isLivehost(plan)) {
    return (
      <LivehostDashboard
        name={name}
        email={user.email || ""}
        planExpiresAt={planExpiresAt}
        credits={credits}
      />
    );
  }

  return (
    <DashboardShell
      email={user.email || ""}
      name={name}
      credits={credits}
      plan={plan}
      planActive={planActive}
      planExpiresAt={planExpiresAt}
      isAffiliate={isAffiliate}
    />
  );
}
