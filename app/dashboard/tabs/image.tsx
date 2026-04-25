"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Sparkles, Upload, Loader2, X } from "lucide-react";

type Status = "idle" | "submitting" | "polling" | "done" | "failed";

export default function ImageTab() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [refUrl, setRefUrl] = useState<string>("");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Poll status when historyId set
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
      } catch (e: any) {
        // keep polling
      }
      if (mounted && (status === "polling" || status === "submitting")) {
        setTimeout(tick, 4000);
      }
    };
    setStatus("polling");
    tick();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId]);

  function pickFile() {
    fileInputRef.current?.click();
  }

  function onFile(f: File | null) {
    if (!f) return;
    setRefFile(f);
    const reader = new FileReader();
    reader.onload = () => setRefUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function submit() {
    if (!prompt.trim()) return setError("Sila masukkan prompt.");
    setError(null);
    setStatus("submitting");
    setOutputUrl(null);
    try {
      const r = await fetch("/api/generate/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          reference_url: refUrl || undefined,
          aspect_ratio: aspect,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) {
        setError(d?.error || "Generation failed");
        setStatus("failed");
        return;
      }
      setHistoryId(d.history_id);
      setCost(d.cost);
    } catch (e: any) {
      setError(e?.message || "Network error");
      setStatus("failed");
    }
  }

  const busy = status === "submitting" || status === "polling";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[var(--color-border)]">
        <div className="w-11 h-11 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center">
          <ImageIcon className="w-5 h-5 text-orange" strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl">Generate Image</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Avatar UGC realistik — Banana Pro + GPT Image 2
          </p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        <div>
          <label className="block text-sm font-semibold mb-2">Prompt</label>
          <textarea
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="A confident young Malay woman wearing a hijab, holding a skincare bottle, soft natural lighting, studio backdrop..."
            className="input resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Reference produk{" "}
            <span className="text-[var(--color-text-muted)] text-xs font-normal">
              (optional)
            </span>
          </label>
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
                onClick={() => { setRefUrl(""); setRefFile(null); }}
                className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white border border-[var(--color-border)] shadow flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={pickFile}
              className="w-full p-6 border-2 border-dashed border-[var(--color-border)] rounded-2xl hover:border-orange-300 hover:bg-orange-50/40 transition flex flex-col items-center gap-2 text-sm text-[var(--color-text-muted)]"
            >
              <Upload className="w-6 h-6" />
              Click to upload product image
              <span className="text-xs">PNG / JPG / max 8MB</span>
            </button>
          )}
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">Aspect</label>
          <select className="input" value={aspect} onChange={(e) => setAspect(e.target.value)}>
            <option value="9:16">9:16 (TikTok)</option>
            <option value="1:1">1:1 (Square)</option>
            <option value="16:9">16:9 (Wide)</option>
          </select>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {outputUrl && status === "done" && (
          <div className="rounded-2xl overflow-hidden border border-emerald-200">
            <img src={outputUrl} alt="generated" className="w-full" />
            <div className="p-3 bg-emerald-50 text-xs text-emerald-700 font-semibold flex items-center justify-between">
              <span>✓ Generated</span>
              <a href={outputUrl} target="_blank" rel="noreferrer" className="underline">
                Open
              </a>
            </div>
          </div>
        )}
      </div>

      <button
        onClick={submit}
        disabled={busy}
        className="btn-primary w-full mt-6 disabled:opacity-60"
      >
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {status === "submitting" ? "Submitting…" : "Generating…"}
          </>
        ) : (
          <>
            <Sparkles className="w-4 h-4" />
            Generate Image
          </>
        )}
      </button>
      <p className="text-center text-xs text-[var(--color-text-muted)] mt-2.5">
        {cost ? `Tolak RM${cost.toFixed(2)} bila siap` : "20 sen / 50 sen per generate (ikut plan)"}
      </p>
    </div>
  );
}
