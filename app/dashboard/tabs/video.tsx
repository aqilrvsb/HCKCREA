"use client";

import { useEffect, useRef, useState } from "react";
import { Video, Sparkles, Upload, Loader2, X } from "lucide-react";

type Status = "idle" | "submitting" | "polling" | "done" | "failed";

export default function VideoTab({ projectId }: { projectId?: string } = {}) {
  const [prompt, setPrompt] = useState("");
  const [duration] = useState<"8">("8"); // Veo 3.1 Fast supports 8s only
  const [aspect, setAspect] = useState("9:16");
  const [count, setCount] = useState(1);
  const [imageMode, setImageMode] = useState<"ingredient" | "frame" | "text">("ingredient");
  const [refUrl, setRefUrl] = useState<string>("");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pick up a prompt handed off from the UGC Prompt Builder
  useEffect(() => {
    try {
      const stash = localStorage.getItem("ugc_prompt_stash");
      if (stash && stash.trim()) {
        setPrompt(stash);
        localStorage.removeItem("ugc_prompt_stash");
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!historyId || (status !== "polling" && status !== "submitting")) return;
    let mounted = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/generate/status?id=${historyId}`, { cache: "no-store" });
        const d = await r.json();
        if (!mounted) return;
        const h = d?.history;
        if (h?.status === "done") {
          setOutputUrl(h.output_url);
          setStatus("done");
          window.dispatchEvent(new CustomEvent("history:refresh"));
          return;
        }
        if (h?.status === "failed") {
          setError(h.error_message || "Generation failed");
          setStatus("failed");
          return;
        }
      } catch {}
      if (mounted && (status === "polling" || status === "submitting")) {
        setTimeout(tick, 5000);
      }
    };
    setStatus("polling");
    tick();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId]);

  function onFile(f: File | null) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setRefUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function submit() {
    if (!prompt.trim()) return setError("Sila masukkan prompt.");
    if (imageMode !== "text" && !refUrl) return setError("Sila upload reference image.");
    setError(null);
    setStatus("submitting");
    setOutputUrl(null);

    // Submit `count` parallel video generation calls — each lands as its own history row
    try {
      const calls = Array.from({ length: count }).map(() =>
        fetch("/api/generate/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            image_urls: refUrl ? [refUrl] : [],
            duration,
            image_mode: imageMode,
            aspect_ratio: aspect,
            project_id: projectId,
          }),
        }).then((r) => r.json())
      );
      const results = await Promise.all(calls);
      const first = results.find((d) => d?.ok);
      if (!first) {
        const err = results.find((d) => d?.error)?.error || "Generation failed";
        setError(err);
        setStatus("failed");
        return;
      }
      setHistoryId(first.history_id);
      setCost(first.cost);
      window.dispatchEvent(new CustomEvent("history:refresh"));
    } catch (e: any) {
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  const busy = status === "submitting" || status === "polling";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center"
          style={{
            background: "rgba(255,87,34,0.1)",
            border: "1px solid rgba(255,87,34,0.3)",
          }}
        >
          <Video className="w-5 h-5" style={{ color: "var(--color-orange)" }} strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">Generate Video</h2>
          <p className="text-xs text-[var(--color-text-muted)]">8 saat per shot · UGC ready</p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-sm font-semibold mb-2">Prompt</label>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A young Malay woman holds skincare bottle, smiles directly to camera, says 'Eh korang, serius kena cuba ni'..."
            className="input resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Reference image</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
          {refUrl ? (
            <div className="relative inline-block">
              <img src={refUrl} alt="ref" className="rounded-2xl max-h-48 border border-[var(--color-border)]" />
              <button
                type="button"
                onClick={() => setRefUrl("")}
                className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white border border-[var(--color-border)] shadow flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full p-6 border-2 border-dashed border-[var(--color-border)] rounded-2xl hover:border-[var(--color-orange)] transition flex flex-col items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-orange)]"
            >
              <Upload className="w-6 h-6" />
              Upload character / product image
              <span className="text-xs">Optional — text-to-video also supported</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-2">Mode</label>
            <select className="input text-sm" value={imageMode} onChange={(e) => setImageMode(e.target.value as any)}>
              <option value="ingredient">r2v</option>
              <option value="frame">i2v</option>
              <option value="text">t2v</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Aspect</label>
            <select className="input text-sm" value={aspect} onChange={(e) => setAspect(e.target.value)}>
              <option value="9:16">9:16</option>
              <option value="16:9">16:9</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Qty</label>
            <select className="input text-sm" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="rounded-xl p-3 border text-xs"
          style={{
            background: "rgba(34,197,94,0.06)",
            borderColor: "rgba(34,197,94,0.2)",
            color: "#22c55e",
          }}
        >
          <strong>8 saat per shot</strong> · 1 video Veo 3.1 Fast — perfect untuk satu hook + dialog + CTA.
        </div>

        {error && (
          <div
            className="text-sm rounded-xl px-4 py-3"
            style={{
              color: "#fca5a5",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
          >
            {error}
          </div>
        )}

        {outputUrl && status === "done" && (
          <div
            className="rounded-2xl overflow-hidden border"
            style={{ borderColor: "rgba(200,245,62,0.4)" }}
          >
            <video src={outputUrl} controls className="w-full" />
            <div
              className="p-3 text-xs font-semibold flex items-center justify-between"
              style={{
                background: "rgba(200,245,62,0.1)",
                color: "var(--color-lime)",
              }}
            >
              <span>✓ Generated</span>
              <a href={outputUrl} target="_blank" rel="noreferrer" className="underline">
                Download
              </a>
            </div>
          </div>
        )}
      </div>

      <button onClick={submit} disabled={busy} className="btn-primary w-full mt-6 disabled:opacity-60">
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {status === "submitting" ? "Submitting…" : "Generating…"}
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Generate {count > 1 ? `${count} Videos` : "Video"}
          </>
        )}
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        {cost ? `Tolak RM${(cost * count).toFixed(2)} bila ${count} video siap` : "40 sen / 70 sen per 8s · Pro / Light"}
      </p>
    </div>
  );
}
