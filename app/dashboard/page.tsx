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

  // Read live credits + name from the profile row (admin client because RLS
  // hits .single() before the trigger has populated everything).
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("credits, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const credits = Number(profile?.credits ?? 0);
  const name =
    profile?.full_name ||
    (user.user_metadata?.full_name as string) ||
    user.email?.split("@")[0] ||
    "User";

  return (
    <DashboardShell
      email={user.email || ""}
      name={name}
      credits={credits}
    />
  );
}
