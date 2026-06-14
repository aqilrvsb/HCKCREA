"use client";

// Durable persistence for the Livehost dashboard's client state. The DB
// (live_client_config.dashboard_state via /api/livehost/state) is the source
// of truth; localStorage is only a fast write-through cache. This survives
// cache clears and follows the user across devices/browsers.
//
// Each entry is stored under its original localStorage key as a raw string,
// so the existing components keep reading/writing localStorage exactly as
// before — we just sync that cache to the DB.

export const LIVEHOST_STATE_KEYS = [
  "livehost_saved_templates",
  "livehost_settings",
  "livehost_products_lib",
  "livehost_active_product",
  "livehost_products", // legacy single-KB key (migrate it up too)
  "livehost_greet_lib",
  "livehost_active_greet",
];

function buildBlob(): Record<string, string> {
  const blob: Record<string, string> = {};
  for (const k of LIVEHOST_STATE_KEYS) {
    const v = localStorage.getItem(k);
    if (v != null) blob[k] = v;
  }
  return blob;
}

// Pull the user's state from the DB into the localStorage cache BEFORE the
// components read it. DB wins; if the DB has no record yet (first run / fresh
// device with only local data), push whatever is local up so it becomes
// durable. Always await this before reading localStorage on mount.
export async function hydrateLivehostState(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const r = await fetch("/api/livehost/state", { credentials: "include" });
    if (!r.ok) return;
    const j = await r.json();
    const state = (j && j.state) || {};
    const dbKeys = LIVEHOST_STATE_KEYS.filter((k) => typeof state[k] === "string");
    if (dbKeys.length > 0) {
      // DB is authoritative — overwrite the local cache with it.
      for (const k of dbKeys) localStorage.setItem(k, state[k] as string);
    } else {
      // No DB record yet — migrate the current local cache up immediately.
      flushLivehostState();
    }
  } catch {}
}

let timer: ReturnType<typeof setTimeout> | null = null;

// Debounced write-through to the DB. Call after any localStorage update.
export function saveLivehostState(delay = 600): void {
  if (typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushLivehostState, delay);
}

// Immediate PUT (also used on page hide so pending edits aren't lost).
export function flushLivehostState(): void {
  if (typeof window === "undefined") return;
  if (timer) { clearTimeout(timer); timer = null; }
  try {
    fetch("/api/livehost/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: buildBlob() }),
      credentials: "include",
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

// Flush on tab hide / unload so a quick refresh after an edit doesn't lose the
// (still-debounced) change. Returns a cleanup fn.
export function installLivehostStateFlush(): () => void {
  if (typeof window === "undefined") return () => {};
  const onHide = () => { if (document.visibilityState === "hidden") flushLivehostState(); };
  window.addEventListener("pagehide", flushLivehostState);
  document.addEventListener("visibilitychange", onHide);
  return () => {
    window.removeEventListener("pagehide", flushLivehostState);
    document.removeEventListener("visibilitychange", onHide);
  };
}
