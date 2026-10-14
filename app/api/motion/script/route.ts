import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { applyDraftEdits, type DraftWord } from "@/lib/motion-review";

// POST /api/motion/script { id, lines } — "📝 Skrip" box of a finished (or
// failed) Edit Video card: saves the client's corrected caption lines as the
// card's latest script. The video itself is not touched; Resubmit renders a
// new one from this script.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "motion"))) {
    return NextResponse.json({ error: "Motion tidak dibuka untuk akaun ini." }, { status: 403 });
  }
  const b = await req.json().catch(() => ({} as Record<string, unknown>));
  const id = String(b?.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const lines: Record<string, string> = {};
  if (b?.lines && typeof b.lines === "object") {
    for (const [k, s] of Object.entries(b.lines as Record<string, unknown>).slice(0, 2000)) {
      if (/^\d{1,4}$/.test(k) && typeof s === "string") lines[k] = s.slice(0, 400);
    }
  }

  const admin = createAdminClient();
  const [{ data: row }, { data: me }] = await Promise.all([
    admin.from("history").select("id, user_id, tab, status, metadata").eq("id", id).maybeSingle(),
    admin.from("profiles").select("is_admin").eq("id", user.id).maybeSingle(),
  ]);
  if (!row || (row.user_id !== user.id && !me?.is_admin)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const draft = meta.draft as { words?: DraftWord[] } | undefined;
  if (row.tab !== "motion" || meta.feature !== "motion-edit" || !Array.isArray(draft?.words)) {
    return NextResponse.json({ error: "Skrip untuk video ini tidak dijumpai." }, { status: 400 });
  }
  // a running job reads (and rewrites) this metadata — save only when it's settled
  if (row.status !== "done" && row.status !== "failed") {
    return NextResponse.json({ error: "Video ini masih diproses — cuba lagi bila siap." }, { status: 409 });
  }
  if (!Object.keys(lines).length) return NextResponse.json({ ok: true });

  const { words } = applyDraftEdits({ words: draft.words, plan: {} }, { lines });
  const { data: saved } = await admin
    .from("history")
    .update({ metadata: { ...meta, draft: { ...draft, words }, script_saved_at: new Date().toISOString() } })
    .eq("id", id)
    .eq("status", row.status)
    .select("id");
  if (!saved?.length) return NextResponse.json({ error: "Video ini sedang diproses." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
