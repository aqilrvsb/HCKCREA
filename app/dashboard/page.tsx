import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Sparkles, Wand2, Layers, Wallet } from "lucide-react";
import LogoutButton from "./logout-button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const credits = 10; // TODO: read from profiles table

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="bg-sky" />

      <nav className="relative z-10 mx-auto max-w-7xl px-6 py-6 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-400 via-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display font-extrabold text-2xl tracking-tight">
            PeningLab
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[var(--color-border)] shadow-sm">
            <Wallet className="w-4 h-4 text-violet-600" />
            <span className="text-sm font-semibold">{credits} kredit</span>
          </div>
          <LogoutButton />
        </div>
      </nav>

      <main className="relative z-10 mx-auto max-w-7xl px-6 py-12">
        <div className="mb-10">
          <p className="text-sm text-[var(--color-text-muted)] mb-2">
            Welcome back,
          </p>
          <h1 className="font-display font-extrabold text-4xl md:text-5xl tracking-tight">
            {user.email?.split("@")[0]}
          </h1>
        </div>

        <div className="grid md:grid-cols-2 gap-5 mb-6">
          <Link href="/dashboard/auto-content" className="card group cursor-pointer">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-violet-50 border border-violet-100 flex items-center justify-center flex-shrink-0">
                <Wand2 className="w-7 h-7 text-violet-600" strokeWidth={2} />
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-violet-600 mb-1">
                  Most Popular
                </div>
                <h3 className="font-display font-bold text-2xl">Auto Content</h3>
              </div>
            </div>
            <p className="text-[var(--color-text-secondary)] mb-4">
              Letak link produk TikTok Shop. Dapat 10 video UGC siap dengan caption.
            </p>
            <div className="text-sm text-violet-600 font-semibold flex items-center gap-1 group-hover:gap-2 transition-all">
              Mula generate →
            </div>
          </Link>

          <Link href="/dashboard/clone" className="card group cursor-pointer">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                <Layers className="w-7 h-7 text-blue-600" strokeWidth={2} />
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-blue-600 mb-1">
                  Clone
                </div>
                <h3 className="font-display font-bold text-2xl">Clone Mode</h3>
              </div>
            </div>
            <p className="text-[var(--color-text-secondary)] mb-4">
              Upload video viral. AI tiru shot demi shot dengan produk anda.
            </p>
            <div className="text-sm text-blue-600 font-semibold flex items-center gap-1 group-hover:gap-2 transition-all">
              Mula clone →
            </div>
          </Link>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600">
              Coming next
            </span>
          </div>
          <h3 className="font-display font-bold text-xl mb-2">
            History, Settings, Top up — masih dalam build
          </h3>
          <p className="text-[var(--color-text-secondary)] text-sm">
            Kami sedang port full feature dari extension. Auto Content + Clone mode siap dahulu.
          </p>
        </div>
      </main>
    </div>
  );
}
