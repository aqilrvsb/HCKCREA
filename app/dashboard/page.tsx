import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import DashboardShell from "./dashboard-shell";

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
      .select("credits, full_name, plan, plan_expires_at")
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
    plan === "pro" &&
    !!planExpiresAt &&
    new Date(planExpiresAt) > new Date();

  return (
    <DashboardShell
      email={user.email || ""}
      name={name}
      credits={credits}
      planActive={planActive}
      planExpiresAt={planExpiresAt}
      isAffiliate={isAffiliate}
    />
  );
}
