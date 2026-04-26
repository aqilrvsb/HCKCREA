// Helper to build the per-task callback_url Crun.ai POSTs to when a video
// finishes. Includes a secret query param so the receiver can reject any
// random caller hitting the public webhook endpoint.

export function buildP2CallbackUrl(): string | undefined {
  const origin = (process.env.APP_ORIGIN || "").replace(/\/$/, "");
  const secret = process.env.CALLBACK_SECRET;
  if (!origin || !secret) return undefined;
  return `${origin}/api/callback/p2?secret=${encodeURIComponent(secret)}`;
}
