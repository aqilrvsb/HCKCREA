import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProjectLimit } from "@/lib/settings";

// GET /api/projects — list user's projects + the (admin-set) per-user cap
export async function GET() {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [projectsRes, limit] = await Promise.all([
    sb
      .from("projects")
      .select("id, name, created_at, updated_at")
      .order("created_at", { ascending: false }),
    getProjectLimit(),
  ]);
  if (projectsRes.error)
    return NextResponse.json({ error: projectsRes.error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    projects: projectsRes.data || [],
    limit,
  });
}

// POST /api/projects — create. Body: { name }. Honors admin-set project_limit.
export async function POST(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim().substring(0, 60) || "New project";

  const limit = await getProjectLimit();
  const { count } = await sb
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= limit) {
    return NextResponse.json(
      { error: `Limit reached (${limit} projects). Delete one to create another.` },
      { status: 400 }
    );
  }

  const { data, error } = await sb
    .from("projects")
    .insert({ user_id: user.id, name })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, project: data, limit });
}
