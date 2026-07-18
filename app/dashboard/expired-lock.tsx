"use client";

import { createClient } from "@/lib/supabase/client";
import { LockKeyhole, LogOut } from "lucide-react";

// Full-screen lock shown when a client has NO active plan (expired / never
// subscribed). Per admin direction: no app access until an admin re-activates
// them. Session is NOT killed — they just can't get past this screen.
export default function ExpiredLock({
  name,
  planExpiresAt,
}: {
  name: string;
  planExpiresAt: string | null;
}) {
  async function logout() {
    try {
      const sb = createClient();
      await sb.auth.signOut();
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }

  const expiredOn = planExpiresAt
    ? new Date(planExpiresAt).toLocaleDateString("ms-MY", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--color-bg)" }}
    >
      <div
        className="max-w-md w-full rounded-3xl p-8 text-center"
        style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}
      >
        <div
          className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)" }}
        >
          <LockKeyhole className="w-8 h-8 text-red-500" />
        </div>
        <h1 className="font-display font-extrabold text-2xl mb-2 text-[var(--color-text-primary)]">
          Plan anda telah tamat
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mb-1">
          Hi {name}, akaun anda tiada plan aktif{expiredOn ? ` (tamat ${expiredOn})` : ""}.
        </p>
        <p className="text-sm text-[var(--color-text-secondary)] mb-6">
          Sila hubungi admin untuk aktifkan semula akses anda.
        </p>
        <button
          onClick={logout}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition hover:brightness-110"
          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
        >
          <LogOut className="w-4 h-4" /> Log keluar
        </button>
      </div>
    </div>
  );
}
