import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EditorClient from "./editor-client";

export const dynamic = "force-dynamic";

// /editor — dedicated page (opened in a new browser tab from the dashboard's
// Editor nav tab). Collects videos the user "transferred" (⇄) from any video
// tab except Auto Content, and bulk-generates caption Text + Cover for them.
export default async function EditorPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  return <EditorClient />;
}
