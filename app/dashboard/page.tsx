import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "./dashboard-shell";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <DashboardShell
      email={user.email || ""}
      name={(user.user_metadata?.full_name as string) || user.email?.split("@")[0] || "User"}
      credits={10}
    />
  );
}
