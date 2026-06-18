"use client";

// Livehost "Template Body" — Kling v3 motion-control. Pick an avatar
// (character image) + upload a motion .mp4; the avatar mirrors that motion.
// Self-contained: own history (tab="template-body") + status polling against
// /api/generate/template-body/status (isolated from the shared video settle).

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AttachmentPicker from "./sections/attachment-picker";
import { LhSection, LhCard, LhCardHeader, LhLabel, LhButton, LhGrid, LH_FIELD_STYLE, ORANGE } from "./livehost-ui";
import type { Attachment } from "./sections/attachments";

type Row = {
  id: string; status: string; output_url: string | null; reference_url: string | null;
  prompt: string | null; cost: number; error_message: string | null; metadata: any; created_at: string;
};

export default function LivehostTemplateBody() {
  const [charUrl, setCharUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [uploadingVid, setUploadingVid] = useState(false);
  // Prompt + orientation are fixed (hidden in the UI).
  const prompt =
    "Animate the character to follow the reference video's motion exactly, frame for frame. Preserve the character's exact appearance from the reference image — face, hair or head covering, skin tone, and full outfit — with maximum fidelity. Do not change the appearance, clothing, colors, or face. Keep the torso and shoulders stable and upright; only the hands and arms move as in the reference. Photorealistic, ultra-detailed, natural realistic hands, clean consistent studio lighting matching the reference image. Locked static camera — no zoom, no pan, no camera shake. Keep the character centered with consistent framing throughout.";
  const mode = "pro" as const; // quality fixed at 1080p (Pro)
  const keepSound = false; // audio off by default (toggle hidden)
  const orientation = "video" as const; // always follow reference video motion
  const [videoDur, setVideoDur] = useState(0);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [presets, setPresets] = useState<{ id: string; name: string; public_url: string; category: "avatar" }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const vidInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/avatars/manifest.json").then((r) => r.json()).then((list) => {
      setPresets((list as { id: string; file: string; label: string }[]).map((s) => ({
        id: `stock:${s.id}`, name: s.label, public_url: `/avatars/${s.file}`, category: "avatar" as const,
      })));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data } = await sb
      .from("history")
      .select("id,status,output_url,reference_url,prompt,cost,error_message,metadata,created_at")
      .eq("tab", "template-body")
      .order("created_at", { ascending: false })
      .limit(50);
    setRows((data as Row[]) || []);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  // Settle pending tasks via the shared status endpoint (same settle helper
  // as the server-side callback + cron poller).
  useEffect(() => {
    const pending = rows.filter((r) => r.status === "pending" && r.metadata?.upload_status === "done" && r.metadata?.kling);
    if (!pending.length) return;
    const t = setTimeout(() => {
      Promise.all(pending.map((p) => fetch(`/api/generate/status?id=${p.id}`, { cache: "no-store" }).catch(() => null))).then(() => load());
    }, 5000);
    return () => clearTimeout(t);
  }, [rows, load]);

  async function uploadVideo(file: File) {
    setUploadingVid(true); setErr(null);
    // Measure the .mp4 duration locally — Kling output follows the reference
    // length, and we bill per second.
    try {
      const dur = await new Promise<number>((resolve) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => { resolve(v.duration || 0); URL.revokeObjectURL(v.src); };
        v.onerror = () => resolve(0);
        v.src = URL.createObjectURL(file);
      });
      if (dur) setVideoDur(Math.round(dur));
    } catch {}
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/livehost/upload-video", { method: "POST", body: fd, credentials: "include" });
      const d = await r.json();
      if (!r.ok || !d?.url) throw new Error(d?.error || "Upload gagal");
      setVideoUrl(d.url);
    } catch (e: any) { setErr(e?.message || "Upload gagal"); } finally { setUploadingVid(false); }
  }

  async function generate() {
    if (!charUrl) return setErr("Pilih avatar dahulu.");
    if (!videoUrl) return setErr("Upload video gerakan (.mp4) dahulu.");
    setBusy(true); setErr(null);
    try {
      // Stock avatars are served as relative /avatars/* — make absolute so Crun can fetch.
      const absChar = charUrl.startsWith("/") ? `${window.location.origin}${charUrl}` : charUrl;
      const r = await fetch("/api/generate/template-body", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: absChar, video_url: videoUrl, prompt, mode, character_orientation: orientation, keep_original_sound: keepSound, duration: videoDur || 8 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Generate gagal");
      load();
    } catch (e: any) { setErr(e?.message || "Generate gagal"); } finally { setBusy(false); }
  }

  async function del(id: string) {
    if (!confirm("Padam item ini?")) return;
    await fetch(`/api/history/delete?id=${id}`, { method: "DELETE" }).catch(() => {});
    load();
  }

  const F = LH_FIELD_STYLE;
  const clearBtn = { flex: "0 0 auto", marginTop: 0, width: 44, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#ff9aa8" } as const;

  return (
    <LhSection>
      <div>
        <h2 className="font-extrabold text-xl tracking-tight" style={{ color: "#1a1a1a" }}>Template Body</h2>
        <p className="text-xs mt-0.5" style={{ color: "#888" }}>Kling motion — avatar anda meniru gerakan dari video rujukan.</p>
      </div>

      <LhCard borderColor={ORANGE}>
        <LhCardHeader icon="🕺" title="Avatar + Motion" />

        <LhLabel>Avatar (wajah / karakter)</LhLabel>
        {charUrl && (
          <img src={charUrl} alt="" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 12, border: "1px solid #e8e0d8", marginBottom: 8 }} />
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setAvatarPickerOpen(true)} style={{ ...F, flex: 1, cursor: "pointer", fontWeight: 700, background: "#fff" }}>🖼 Pick avatar from Attachments</button>
          {charUrl && <button type="button" title="Buang" onClick={() => setCharUrl("")} style={{ ...F, ...clearBtn }}>✕</button>}
        </div>

        <div style={{ marginTop: 14 }}><LhLabel>Video gerakan (.mp4)</LhLabel></div>
        {videoUrl && (
          <video src={videoUrl} controls style={{ width: "100%", maxHeight: 220, borderRadius: 12, border: "1px solid #e8e0d8", marginBottom: 8, background: "#000" }} />
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={uploadingVid} onClick={() => vidInputRef.current?.click()} style={{ ...F, flex: 1, cursor: "pointer", fontWeight: 700, background: "#fff" }}>
            {uploadingVid ? "⏳ Uploading…" : "⬆ Upload motion .mp4"}
          </button>
          {videoUrl && <button type="button" title="Buang" onClick={() => setVideoUrl("")} style={{ ...F, ...clearBtn }}>✕</button>}
        </div>
        <input ref={vidInputRef} type="file" accept=".mp4,video/mp4" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) uploadVideo(f); }} />

        <p className="text-[11px] mt-3" style={{ color: "#999" }}>
          Kualiti: <b style={{ color: "#555" }}>1080p (Pro)</b>{videoDur ? <> · Panjang video: <b style={{ color: "#555" }}>{videoDur}s</b></> : null}
        </p>

        <div className="mt-4">
          <LhButton onClick={generate} disabled={busy || !charUrl || !videoUrl}>{busy ? "⏳ Menjana…" : "🎬 Generate"}</LhButton>
        </div>
        {err && <p className="text-[12px] mt-2" style={{ color: "#e23" }}>{err}</p>}
      </LhCard>

      <LhCard>
        <LhCardHeader icon="📁" title={`History (${rows.length})`} />
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: "#888" }}>Belum ada. Generate sesuatu dahulu.</p>
        ) : (
          <LhGrid min={200}>
            {rows.map((r) => (
              <div key={r.id} style={{ position: "relative", borderRadius: 14, overflow: "hidden", border: "1px solid #e8e0d8", background: "#fafaf7" }}>
                <button type="button" title="Padam" onClick={() => del(r.id)}
                  style={{ position: "absolute", top: 6, right: 6, zIndex: 2, border: "1px solid #f3c0c0", background: "#fff0f0", color: "#e23", borderRadius: 8, padding: "2px 6px", fontSize: 11, cursor: "pointer" }}>🗑</button>
                <div style={{ aspectRatio: "9/16", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {r.status === "done" && r.output_url ? (
                    <video src={r.output_url + "#t=0.5"} preload="metadata" muted controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : r.status === "failed" ? (
                    <span style={{ color: "#f87171", fontSize: 11, padding: 10, textAlign: "center" }}>❌ {r.error_message || "Failed"}</span>
                  ) : r.reference_url ? (
                    <img src={r.reference_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.5 }} />
                  ) : null}
                  {r.status === "pending" && (
                    <span style={{ position: "absolute", color: "#fbbf24", fontSize: 12, fontWeight: 700 }}>⏳ Menjana…</span>
                  )}
                </div>
                <div style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                  <span style={{ fontWeight: 700, color: r.status === "done" ? "#16a34a" : r.status === "failed" ? "#e23" : "#b45309", textTransform: "uppercase" }}>{r.status}</span>
                  <span style={{ marginLeft: "auto", color: "#888" }}>RM{Number(r.cost).toFixed(2)}</span>
                  {r.status === "done" && r.output_url && (
                    <a href={r.output_url} target="_blank" rel="noreferrer" style={{ color: "#f59e0b", fontWeight: 800 }}>Open</a>
                  )}
                </div>
              </div>
            ))}
          </LhGrid>
        )}
      </LhCard>

      <AttachmentPicker
        open={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        title="Pick avatar from Attachments"
        defaultCategory="avatar"
        categories={["avatar"]}
        presets={presets}
        onPick={(a: Attachment) => setCharUrl(a.public_url)}
      />
    </LhSection>
  );
}
