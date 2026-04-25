import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  Sparkles,
  CreditCard,
  Users,
  Activity,
  Settings,
  ArrowLeft,
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, full_name, is_active")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) redirect("/dashboard");

  const NAV = [
    { href: "/admin/transactions", label: "Transactions", icon: CreditCard },
    { href: "/admin/clients", label: "Clients", icon: Users },
    { href: "/admin/usage", label: "Usage", icon: Activity },
    { href: "/admin/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />

      <div className="relative z-10 flex min-h-screen">
        <aside className="hidden lg:flex flex-col w-[260px] flex-shrink-0 border-r border-white/40 bg-white/55 backdrop-blur-2xl">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 px-7 py-6 border-b border-white/40"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/40">
              <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="font-display font-extrabold text-xl tracking-tight leading-none">
                PeningLab
              </div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-orange mt-1 font-bold">
                Admin Console
              </div>
            </div>
          </Link>

          <nav className="px-3 pt-5 space-y-1.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm text-[var(--color-text-secondary)] hover:bg-white/70 hover:text-orange transition"
                >
                  <Icon className="w-4 h-4" strokeWidth={2.2} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          <div className="px-5 py-4 border-t border-white/40">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/70 border border-[var(--color-border)] text-sm font-medium hover:border-orange-200"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Studio
            </Link>
          </div>
        </aside>

        <main className="flex-1 min-w-0 px-5 lg:px-10 py-6 lg:py-10">
          {/* Mobile nav */}
          <div className="lg:hidden flex gap-2 overflow-x-auto mb-5">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-[var(--color-border)] text-xs font-semibold"
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
