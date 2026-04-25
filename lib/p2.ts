// Crun.ai (P2) job creation + task status polling helper.
// All keys/URLs read from app_settings via lib/settings.ts so admin can rotate
// without redeploying.

import { getP2Config } from "@/lib/settings";

export type P2CreateResp = {
  ok: boolean;
  task_id?: string;
  error?: string;
  raw?: any;
};

export async function p2CreateTask(input: {
  model: string;
  prompt?: string;
  imageUrl?: string;
  imageUrls?: string[];
  durationMode?: "8" | "16";
  aspectRatio?: string;
  imageMode?: "frame" | "ingredient" | "text";
  extra?: Record<string, any>;
}): Promise<P2CreateResp> {
  const cfg = await getP2Config();
  if (!cfg.base || !cfg.key) return { ok: false, error: "P2 not configured" };

  const fd = new FormData();
  fd.append("model", input.model);
  if (input.prompt) fd.append("prompt", input.prompt.substring(0, 2000));
  if (input.aspectRatio) fd.append("aspect_ratio", input.aspectRatio);
  if (input.imageMode) fd.append("image_mode", input.imageMode);
  if (input.durationMode) fd.append("duration", input.durationMode);
  if (input.imageUrl) fd.append("image_url", input.imageUrl);
  if (input.imageUrls && input.imageUrls.length) {
    input.imageUrls.forEach((u, i) => fd.append(`image_url_${i}`, u));
  }
  if (input.extra) {
    for (const [k, v] of Object.entries(input.extra)) {
      fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
    }
  }

  const res = await fetch(cfg.base + cfg.createPath, {
    method: "POST",
    headers: { "x-api-key": cfg.key },
    body: fd,
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    return { ok: false, error: json?.message || text.substring(0, 300) || `HTTP ${res.status}`, raw: json };
  }
  const taskId = json?.data?.task_id || json?.task_id || null;
  if (!taskId) return { ok: false, error: "No task_id returned", raw: json };
  return { ok: true, task_id: String(taskId), raw: json };
}

export type P2StatusResp = {
  ok: boolean;
  status: "pending" | "running" | "succeeded" | "failed";
  outputUrl?: string;
  error?: string;
  raw?: any;
};

export async function p2GetStatus(taskId: string): Promise<P2StatusResp> {
  const cfg = await getP2Config();
  if (!cfg.base || !cfg.key) return { ok: false, status: "failed", error: "P2 not configured" };

  const res = await fetch(
    `${cfg.base}${cfg.statusPath}?task_id=${encodeURIComponent(taskId)}`,
    { headers: { "x-api-key": cfg.key }, cache: "no-store" }
  );
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) {
    return { ok: false, status: "failed", error: `HTTP ${res.status}`, raw: json };
  }

  const raw = (json?.data?.status || json?.status || "").toLowerCase();
  let status: P2StatusResp["status"] = "pending";
  if (["success", "succeeded", "completed", "done"].includes(raw)) status = "succeeded";
  else if (["failed", "fail", "error", "cancelled", "canceled"].includes(raw)) status = "failed";
  else if (["running", "processing", "in_progress"].includes(raw)) status = "running";

  const result = json?.data?.result || json?.result || {};
  const outputUrl =
    result?.video_url ||
    result?.image_url ||
    result?.url ||
    (Array.isArray(result?.urls) ? result.urls[0] : null) ||
    null;

  return { ok: true, status, outputUrl: outputUrl || undefined, raw: json };
}
