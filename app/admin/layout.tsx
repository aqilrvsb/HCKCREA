import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  Sparkles,
  CreditCard,
  Users,
  Activity,
  Settings,
  ArrowLeft,
  Banknote,
} from "lucide-react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Use maybeSingle() so a missing profile row doesn't throw a 500
  let { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, full_name")
    .eq("id", user.id)
    .maybeSingle();

  // Self-heal: if the profiles row is missing (e.g. user was created via
  // Supabase Dashboard before the handle_new_user trigger existed), insert
  // a default row now via the admin client. They land in /dashboard until
  // is_admin is flipped manually.
  if (!profile) {
    const admin = createAdminClient();
    await admin.from("profiles").upsert(
      {
        id: user.id,
        full_name:
          (user.user_metadata?.full_name as string) ||
          user.email?.split("@")[0] ||
          null,
        whatsapp: (user.user_metadata?.whatsapp as string) || null,
      },
      { onConflict: "id" }
    );
    const { data: refreshed } = await supabase
      .from("profiles")
      .select("is_admin, full_name")
      .eq("id", user.id)
      .maybeSingle();
    profile = refreshed;
  }

  if (!profile?.is_admin) redirect("/dashboard");

  const NAV = [
    { href: "/admin/transactions", label: "Transactions", icon: CreditCard },
    { href: "/admin/cashout", label: "Cashout", icon: Banknote },
    { href: "/admin/clients", label: "Clients", icon: Users },
    { href: "/admin/usage", label: "Usage", icon: Activity },
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />

      <div className="relative z-10 flex min-h-screen">
        <aside
          className="hidden lg:flex flex-col w-[280px] flex-shrink-0 border-r"
          style={{
            background: "var(--color-bg)",
            borderColor: "var(--color-border)",
          }}
        >
          <Link
            href="/dashboard"
            className="flex items-center gap-3 px-7 py-7 border-b"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, #fde047 0%, #facc15 100%)",
                boxShadow: "0 8px 24px rgba(250, 204, 21, 0.35)",
              }}
            >
              <Sparkles className="w-5 h-5 text-black" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display font-extrabold text-2xl tracking-tight leading-none text-[var(--color-text-primary)]">
                PeningLab
              </div>
              <div
                className="font-mono text-[10px] uppercase tracking-widest mt-1.5 font-bold"
                style={{ color: "var(--color-orange)" }}
              >
                Admin Console
              </div>
            </div>
          </Link>

          <nav className="px-3 pt-6 space-y-1.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="admin-nav-item group flex items-center gap-4 px-5 py-4 rounded-xl font-bold text-base transition-all hover:translate-x-0.5"
                  style={{ color: "var(--color-orange)" }}
                >
                  <Icon className="w-5 h-5" strokeWidth={2.4} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          <div
            className="px-5 py-4 border-t"
            style={{ borderColor: "var(--color-border)" }}
          >
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all hover:translate-x-0.5"
              style={{
                background: "rgba(255, 87, 34, 0.1)",
                border: "1px solid rgba(255, 87, 34, 0.3)",
                color: "var(--color-orange)",
              }}
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Studio
            </Link>
          </div>
        </aside>

        <main className="flex-1 min-w-0 px-5 lg:px-10 py-6 lg:py-10 overflow-x-hidden lg:overflow-x-visible">
          {/* Mobile nav */}
          <div className="lg:hidden flex gap-2 overflow-x-auto scrollbar-hide mb-5">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
                  style={{
                    background: "var(--color-bg-card)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-orange)",
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
