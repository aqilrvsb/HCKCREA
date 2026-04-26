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
        className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-colors hover:opacity-80"
        style={{
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.3)",
          color: "#fca5a5",
        }}
      >
        <LogOut className="w-3.5 h-3.5" />
        Sign out
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-bold transition-colors hover:opacity-80"
      style={{
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.3)",
        color: "#fca5a5",
      }}
    >
      <LogOut className="w-4 h-4" />
      Sign out
    </button>
  );
}
