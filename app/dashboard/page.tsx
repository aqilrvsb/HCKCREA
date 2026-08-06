import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlanKey, isLivehost } from "@/lib/plans";
import { canManageUsers } from "@/lib/manage-users";
import { isPartnerManager } from "@/lib/partners";
import PartnerConsole from "./partner-console";
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
      .select("credits, full_name, plan, plan_expires_at, is_admin, settings")
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
  //
  // MANAGERS/PARTNERS (nl@gmail.com, hqnl@gmail.com — canManageUsers) are also
  // exempt: they're provisioned as management accounts, not self-subscribing
  // clients, so they must always reach their Manage Users / Partner console even
  // without an active plan of their own.
  const isAdmin = !!profile?.is_admin;
  const isManager = canManageUsers(user.email);
  if (!planActive && !isAdmin && !isManager) {
    return <ExpiredBilling name={name} plan={plan} planExpiresAt={planExpiresAt} />;
  }

  // PARTNER MANAGER (e.g. HQNL) — a management-only account. Bypass the client
  // generation dashboard entirely: no projects, no generation tabs, no Billing.
  // They land on Partner Settings and can also open Manage Users. Only partner
  // teams (not plain resellers like nl@gmail.com) get this restricted console.
  if (isPartnerManager(user.email)) {
    return <PartnerConsole name={name} email={user.email || ""} />;
  }

  // PER-CLIENT tab gate — a client's own profiles.settings.visible_tabs (set by
  // their partner/reseller in Manage Users) restricts which project-tabs they
  // see. Passed to the shell so the sidebar + body honor it. null/empty = no
  // restriction → all tabs (the default for a brand-new client).
  const ownTabs = (profile?.settings as any)?.visible_tabs;
  const partnerVisibleTabs: string[] | null =
    Array.isArray(ownTabs) && ownTabs.length > 0 ? ownTabs : null;

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
      partnerVisibleTabs={partnerVisibleTabs}
    />
  );
}
