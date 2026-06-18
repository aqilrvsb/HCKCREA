import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyExtToken } from "@/lib/livehost-ext-auth";

// Greetings/interaction config — edited in the Livehost "Greetings" tab
// (cookie auth) and consumed by the Chrome extension (ext token).
// Logic contract (mirrors the proven extension-aihost):
//  - greetings: N lines, rotated SEQUENTIALLY; each greet scheduled after a
//    random delay in [greetDelayMin, greetDelayMax] seconds
//  - follow -> clap + followGreeting; like -> likeGreeting; join -> rotation
//  - purchase -> bell then voice; feedback -> voice then clap
//  - comments -> avatar 'ask' (replies grounded in Product Knowledge, focused
//    on selectedProduct), spaced by random [commentDelayMin, commentDelayMax]

const DEFAULTS = {
  greetings:
    "Selamat datang [username]! Boleh komen kalau ada soalan tau\nHai [username]! Welcome, boleh tanya apa-apa je\nWelcome [username]! Jangan lupa tekan beg kuning tau\nHai [username], selamat datang! Boleh komen2 ye\nWelcome [username]! Kalau nak tahu harga, boleh tanya je\nHai [username]! Terima kasih sebab join, stay tau",
  greetDelayMin: 20,
  greetDelayMax: 45,
  followGreeting: "Terima kasih [username] sebab follow TikTok kami!",
  likeGreeting: "Terima kasih [username] sebab like!",
  commentDelayMin: 5,
  commentDelayMax: 15,
  pinMin: 30, // re-pin product every random(pinMin,pinMax) seconds
  pinMax: 90,
  selectedProduct: "",
  sfxAuto: true, // purchase -> bell+voice, feedback -> voice+clap, follow -> clap
};

async function ownerId(req: Request): Promise<string | null> {
  // extension path: ?token= or Authorization
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || req.headers.get("x-ext-token") || "";
  if (token) return verifyExtToken(token);
  // dashboard path: cookie session
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  return user?.id || null;
}

export async function GET(req: Request) {
  const userId = await ownerId(req);
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const admin = createAdminClient();
  const { data } = await admin
    .from("live_client_config")
    .select("greet_config")
    .eq("user_id", userId)
    .maybeSingle();
  return NextResponse.json({ config: { ...DEFAULTS, ...(data?.greet_config || {}) } });
}

export async function POST(req: Request) {
  const userId = await ownerId(req);
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const c = body.config || {};
  const clean = {
    greetings: String(c.greetings ?? DEFAULTS.greetings).slice(0, 5000),
    greetDelayMin: Math.max(3, Math.min(600, Number(c.greetDelayMin) || DEFAULTS.greetDelayMin)),
    greetDelayMax: Math.max(3, Math.min(900, Number(c.greetDelayMax) || DEFAULTS.greetDelayMax)),
    followGreeting: String(c.followGreeting ?? DEFAULTS.followGreeting).slice(0, 500),
    likeGreeting: String(c.likeGreeting ?? DEFAULTS.likeGreeting).slice(0, 500),
    commentDelayMin: Math.max(1, Math.min(300, Number(c.commentDelayMin) || DEFAULTS.commentDelayMin)),
    commentDelayMax: Math.max(1, Math.min(600, Number(c.commentDelayMax) || DEFAULTS.commentDelayMax)),
    pinMin: Math.max(5, Math.min(3600, Number(c.pinMin) || DEFAULTS.pinMin)),
    pinMax: Math.max(5, Math.min(3600, Number(c.pinMax) || DEFAULTS.pinMax)),
    selectedProduct: String(c.selectedProduct ?? "").slice(0, 200),
    sfxAuto: c.sfxAuto !== false,
  };
  const admin = createAdminClient();
  const { error } = await admin
    .from("live_client_config")
    .upsert({ user_id: userId, greet_config: clean, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, config: clean });
}
