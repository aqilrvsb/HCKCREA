"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-white border border-[var(--color-border)] hover:border-violet-300 transition text-sm font-medium shadow-sm"
    >
      <LogOut className="w-4 h-4" />
      Sign out
    </button>
  );
}
