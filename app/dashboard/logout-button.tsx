"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

export default function LogoutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (compact) {
    return (
      <button
        onClick={handleLogout}
        className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/70 border border-[var(--color-border)] text-xs font-medium hover:border-red-300 hover:text-red-600 transition"
      >
        <LogOut className="w-3.5 h-3.5" />
        Sign out
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[var(--color-border)] hover:border-red-300 hover:text-red-600 transition text-sm font-medium shadow-sm"
    >
      <LogOut className="w-4 h-4" />
      Sign out
    </button>
  );
}
