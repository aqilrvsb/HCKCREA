import { createClient } from "@/lib/supabase/client";

export type HistoryFetcherArgs = {
  tab: "image" | "video" | "cinema" | "seedance" | "clone" | "auto" | "fairytale";
  projectId: string | undefined;
  storytellingSubTab: "videos" | "images";
  limit: number;
  offset: number;
};

export async function fetchHistoryRows(args: HistoryFetcherArgs) {
  const sb = createClient();
  let q = sb
    .from("history")
    .select("*")
    .eq("tab", args.tab)
    .order("created_at", { ascending: false })
    .range(args.offset, args.offset + args.limit - 1);
  if (args.projectId) q = q.eq("project_id", args.projectId);
  if (args.tab === "fairytale") {
    q = q.eq(
      "type",
      args.storytellingSubTab === "images" ? "fairytale-scene" : "fairytale"
    );
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchStorageStatus(historyIds: string[]) {
  if (historyIds.length === 0) return {};
  const r = await fetch("/api/storage/status", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history_ids: historyIds }),
  });
  if (!r.ok) throw new Error(`storage/status HTTP ${r.status}`);
  const d = await r.json();
  return (d?.statuses || {}) as Record<
    string,
    { saved: boolean; storage_id?: string; url?: string }
  >;
}

export async function fetchStorageList() {
  const r = await fetch("/api/storage/list", {
    credentials: "include",
    cache: "no-store",
  });
  const d = await r.json();
  if (!r.ok || !d?.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return {
    items: (d.items || []) as any[],
    used_mb: Number(d.used_mb || 0),
    quota_mb: Number(d.quota_mb || 1024),
  };
}
