import crypto from "crypto";
import { getSetting } from "@/lib/settings";

// Extension auth: long-lived signed token (userId + expiry, HMAC with the
// livehost_box_secret). The Chrome extension logs in once with email+password
// (verified against Supabase auth) and stores this token.

export async function mintExtToken(userId: string, days = 90): Promise<string> {
  const secret = await getSetting<string>("livehost_box_secret");
  if (!secret) throw new Error("livehost_box_secret not set");
  const exp = Date.now() + days * 24 * 3600 * 1000;
  const payload = Buffer.from(`${userId}.${exp}`).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export async function verifyExtToken(token: string): Promise<string | null> {
  try {
    const secret = await getSetting<string>("livehost_box_secret");
    if (!secret || !token) return null;
    const [payload, sig] = token.split(".");
    const expect = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    if (sig !== expect) return null;
    const [userId, expStr] = Buffer.from(payload, "base64url").toString().split(".");
    if (Date.now() > Number(expStr)) return null;
    return userId;
  } catch {
    return null;
  }
}
