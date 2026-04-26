"use client";

import { useEffect, useRef, useState } from "react";
import { ImageIcon, Sparkles, Upload, Loader2, X, User, Package, Megaphone } from "lucide-react";

type Status = "idle" | "submitting" | "polling" | "done" | "failed";
type PromptCat = "avatar" | "product" | "sales";

// Quick-fill prompt presets — ported from creative-hack-auto's image panel
const AVATAR_PROMPTS = [
  { label: "Kebaya 20s", val: "Photoreal portrait of a young attractive Malay woman in her 20s wearing a traditional kebaya, soft natural lighting, holding the product elegantly, warm Malaysian aesthetic, vertical 9:16 composition" },
  { label: "Casual 20s", val: "Photoreal portrait of a young Malay woman in her 20s with shoulder-length wavy hair, casual cream blouse, holding the product naturally, soft daylight, authentic UGC vibe, vertical 9:16" },
  { label: "Makcik", val: "Photoreal portrait of a warm middle-aged Malay woman in her 40s wearing a maroon hijab, motherly smile, holding the product, kitchen background in soft bokeh, vertical 9:16" },
  { label: "Kitchen", val: "Photoreal portrait of a Malay woman in her 30s in a casual home outfit, standing in a sunlit kitchen, holding the product near a wok, warm tungsten lighting, vertical 9:16" },
  { label: "Nenek", val: "Photoreal portrait of an elderly gentle Malay grandmother in her 60s wearing a soft pastel hijab, warm wise smile, holding the product, soft window daylight, vertical 9:16" },
  { label: "Garden", val: "Photoreal portrait of a Malay woman holding the product in a sunlit garden setting, plants and greenery in soft bokeh, golden hour, peaceful vibe, vertical 9:16" },
  { label: "Baju Melayu 20s", val: "Photoreal portrait of a young Malay man in his 20s wearing a baju melayu, neat appearance, holding the product, warm cultural aesthetic, soft daylight, vertical 9:16" },
  { label: "Casual 20s M", val: "Photoreal portrait of a young Malay man in his 20s wearing a casual dark tee, confident genuine smile, holding the product, soft daylight, authentic UGC, vertical 9:16" },
  { label: "Abang Pro", val: "Photoreal portrait of a Malay man in his 30s in a smart-casual shirt, professional confident demeanor, holding the product, office or studio backdrop, vertical 9:16" },
  { label: "Pakcik", val: "Photoreal portrait of a friendly middle-aged Malay man in his 40s, casual short sleeve, warm welcoming smile, holding the product, soft daylight, vertical 9:16" },
];

const PRODUCT_PROMPTS = [
  { label: "Smoke Rock", val: "Cinematic product shot of the product on a dark volcanic rock surface with wisps of smoke around it, dramatic side lighting, hyperreal commercial photography, 1:1 composition" },
  { label: "Floating Wood", val: "Cinematic product shot of the product floating above a polished wood surface with soft shadow beneath, warm spotlight, premium product photography, 1:1 composition" },
  { label: "Burst Spice", val: "Hyperreal product shot of the product surrounded by bursting spice particles mid-air, vibrant orange-red palette, dynamic energy, commercial photography, 1:1" },
  { label: "Moss Garden", val: "Cinematic product shot of the product nestled in lush green moss with dewdrops, soft natural light, organic premium feel, 1:1 composition" },
  { label: "Water Drop", val: "Hyperreal product shot of the product with a giant crystal-clear water splash erupting around it, frozen mid-action, cinematic backlighting, 1:1" },
  { label: "Stone Leaf", val: "Cinematic product shot of the product placed on smooth stone slab with a single fresh leaf beside it, minimalist zen aesthetic, soft daylight, 1:1" },
  { label: "Mist Powder", val: "Hyperreal product shot of the product with fine powder mist drifting around it, dreamy atmospheric look, side lighting, premium feel, 1:1" },
];

const SALES_PROMPTS = [
  { label: "Soft Sales", val: "Authentic UGC-style image of a relatable everyday Malay person holding the product naturally, warm friendly expression, soft natural lighting, makes the viewer feel 'this is a real person who actually uses this' — gentle storytelling vibe, vertical 9:16" },
  { label: "Hard Sell", val: "Bold high-impact image of the product with dramatic lighting, '50% OFF' or urgency feel, vibrant red and orange color palette, eye-catching commercial poster aesthetic, vertical 9:16, optimized for thumb-stop on TikTok feed" },
];

export default function ImageTab() {
  const [prompt, setPrompt] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [count, setCount] = useState(1);
  const [refUrl, setRefUrl] = useState<string>(""); // character reference
  const [productRefUrl, setProductRefUrl] = useState<string>(""); // product reference
  const [refFile, setRefFile] = useState<File | null>(null);
  const [productRefFile, setProductRefFile] = useState<File | null>(null);
  const [promptCat, setPromptCat] = useState<PromptCat>("avatar");
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const productFileInputRef = useRef<HTMLInputElement | null>(null);

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

  function onCharFile(f: File | null) {
    if (!f) return;
    setRefFile(f);
    const reader = new FileReader();
    reader.onload = () => setRefUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  function onProductFile(f: File | null) {
    if (!f) return;
    setProductRefFile(f);
    const reader = new FileReader();
    reader.onload = () => setProductRefUrl(String(reader.result || ""));
    reader.readAsDataURL(f);
  }

  async function submit() {
    if (!prompt.trim()) return setError("Sila masukkan prompt.");
    setError(null);
    setStatus("submitting");
    setOutputUrl(null);

    // Submit `count` parallel generation requests
    const refs = [refUrl, productRefUrl].filter(Boolean);
    try {
      const calls = Array.from({ length: count }).map(() =>
        fetch("/api/generate/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: prompt.trim(),
            reference_url: refs[0] || undefined,
            reference_urls: refs.length > 1 ? refs : undefined,
            aspect_ratio: aspect,
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
          <ImageIcon className="w-5 h-5" style={{ color: "var(--color-orange)" }} strokeWidth={2.2} />
        </div>
        <div>
          <h2 className="font-display font-bold text-xl text-[var(--color-text-primary)]">Generate Image</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Avatar UGC realistik · 1-4 images per generate
          </p>
        </div>
      </div>

      <div className="space-y-5 flex-1">
        {/* Two reference uploads side-by-side — character + product */}
        <div className="grid grid-cols-2 gap-3">
          <RefUploader
            label="Character"
            sublabel="Face / person"
            icon={<User className="w-4 h-4" />}
            url={refUrl}
            inputRef={fileInputRef}
            onPick={() => fileInputRef.current?.click()}
            onClear={() => { setRefUrl(""); setRefFile(null); }}
            onFile={onCharFile}
          />
          <RefUploader
            label="Product"
            sublabel="Packaging / label"
            icon={<Package className="w-4 h-4" />}
            url={productRefUrl}
            inputRef={productFileInputRef}
            onPick={() => productFileInputRef.current?.click()}
            onClear={() => { setProductRefUrl(""); setProductRefFile(null); }}
            onFile={onProductFile}
          />
        </div>

        {/* Prompt category tabs */}
        <div>
          <div className="flex gap-1 p-1 rounded-xl mb-2" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border)" }}>
            {([
              { k: "avatar", label: "Avatar", icon: User },
              { k: "product", label: "Product", icon: Package },
              { k: "sales", label: "Sales", icon: Megaphone },
            ] as { k: PromptCat; label: string; icon: any }[]).map((t) => {
              const Icon = t.icon;
              const active = promptCat === t.k;
              return (
                <button
                  key={t.k}
                  onClick={() => setPromptCat(t.k)}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-bold transition-all"
                  style={
                    active
                      ? {
                          background: "var(--color-orange)",
                          color: "white",
                          boxShadow: "0 2px 8px rgba(255,87,34,0.3)",
                        }
                      : { color: "var(--color-text-secondary)" }
                  }
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Preset chip row — content per category */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(promptCat === "avatar" ? AVATAR_PROMPTS : promptCat === "product" ? PRODUCT_PROMPTS : SALES_PROMPTS).map((p) => (
              <button
                key={p.label}
                onClick={() => setPrompt(p.val)}
                className="text-[10px] font-bold px-2.5 py-1.5 rounded-md transition-colors hover:opacity-80"
                style={{
                  background: "rgba(255,87,34,0.08)",
                  color: "var(--color-orange)",
                  border: "1px solid rgba(255,87,34,0.25)",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <textarea
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your scene — or click a preset above for ready-made prompts"
            className="input resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold mb-2">Aspect</label>
            <select className="input" value={aspect} onChange={(e) => setAspect(e.target.value)}>
              <option value="9:16">9:16 (TikTok)</option>
              <option value="1:1">1:1 (Square)</option>
              <option value="16:9">16:9 (Wide)</option>
              <option value="2:3">2:3 (Poster)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold mb-2">Count</label>
            <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>{n} image{n > 1 ? "s" : ""}</option>
              ))}
            </select>
          </div>
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
            <img src={outputUrl} alt="generated" className="w-full" />
            <div
              className="p-3 text-xs font-semibold flex items-center justify-between"
              style={{
                background: "rgba(200,245,62,0.1)",
                color: "var(--color-lime)",
              }}
            >
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
        {cost ? `Tolak RM${(cost * count).toFixed(2)} bila ${count} image siap` : "20 sen / 50 sen per generate (ikut plan)"}
      </p>
    </div>
  );
}

function RefUploader({
  label,
  sublabel,
  icon,
  url,
  inputRef,
  onPick,
  onClear,
  onFile,
}: {
  label: string;
  sublabel: string;
  icon: React.ReactNode;
  url: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onClear: () => void;
  onFile: (f: File | null) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-sm font-semibold">
        {icon}
        {label}
        <span className="text-[var(--color-text-muted)] text-xs font-normal">— {sublabel}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      {url ? (
        <div className="relative">
          <img
            src={url}
            alt={label}
            className="rounded-xl w-full aspect-square object-cover border"
            style={{ borderColor: "var(--color-border)" }}
          />
          <button
            type="button"
            onClick={onClear}
            className="absolute -top-2 -right-2 w-7 h-7 rounded-full shadow flex items-center justify-center"
            style={{
              background: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onPick}
          className="w-full aspect-square border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-1.5 transition-colors text-xs text-[var(--color-text-muted)] hover:border-[var(--color-orange)] hover:text-[var(--color-orange)]"
          style={{ borderColor: "var(--color-border)" }}
        >
          <Upload className="w-5 h-5" />
          <span className="font-bold">Upload</span>
          <span className="text-[10px] opacity-70">PNG / JPG</span>
        </button>
      )}
    </div>
  );
}
