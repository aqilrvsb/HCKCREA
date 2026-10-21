import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isTabAllowedForUser } from "@/lib/partner-tab-gate";
import { vgcVault } from "@/lib/vgc-styles";

// GET /api/motion/styles — the 40 styles for Motion's "Saya nak pilih sendiri" (lib/vgc-styles.ts): each card's
// name, line and preview (drawn by the vault's own code) + the scoped CSS / fonts the previews need. The brief each
// style gives the AI stays on the server (the director reads it when the video is planned).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isTabAllowedForUser(user.id, "motion"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const v = await vgcVault();
    return NextResponse.json(
      {
        styles: v.styles.map(({ id, name, group, desc, native, bestFor, sample }) => ({ id, name, group, desc, native, bestFor, sample })),
        css: v.css,
        fonts: v.fonts,
      },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (e) {
    return NextResponse.json({ error: `Style tidak dapat dimuat: ${String((e as Error)?.message || e).slice(0, 120)}` }, { status: 503 });
  }
}
