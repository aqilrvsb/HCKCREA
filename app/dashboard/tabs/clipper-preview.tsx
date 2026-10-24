"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, RotateCcw, Upload, Volume2, VolumeX } from "lucide-react";
import {
  captionFixMap, clipFlash, clipKey, clipSeed, faceTrack, fixedText, polishOnTimeline, previewFaces, previewProps, previewTimeline,
  type PWord, type PolishHeadline, type PolishKeyword, type PolishShot, type PolishZoom, type SrcFaces,
} from "@/lib/clipper-preview";
import { uploadOwn } from "@/lib/upload-own";

// CLIPPER Studio — live preview of one clip with the client's settings, drawn by the render's own composition
// (public/clipper-preview: MotionEditPro over the clip's video). Every change of look shows at once; the render
// then reuses the same picks (seed) and keyword polish, so the clip comes out as previewed.

/** the client's caption corrections of one clip, made on its preview words (key = the clip's start-end) */
export type CapFix = { key: string; words: string[]; fix: Record<number, string> };
/** the client's own overlay per headline layout (index in the clip's headlines): corrected words and / or their own
 *  B-roll, made for this clip (key = start-end) */
/** `ai`: the url is an AI re-pick ("🔄 Cari gambar lain") for this search, not the client's upload */
export type OverlayItem = { url?: string; video?: boolean; lead?: string; big?: string; box?: string; ai?: string };
export type BrollFix = { key: string; items: Record<number, OverlayItem> };
type PClip = { start: number; end: number; title: string; hook: string; flash?: { start: number; end: number } | null; capFix?: CapFix | null; brollFix?: BrollFix | null };
export type PreviewSettings = {
  frame: "face" | "fit" | "center" | "split"; captions: boolean; captionLook?: string; captionPos: "low" | "mid";
  hookOn: boolean; jumpcut: boolean; coldOpen: boolean; polish: boolean; wmText: string; wmImage: string;
  /** the closing CTA: the yellow basket, the LIVE, or none */
  cta: "none" | "bag" | "live";
};
type Data = {
  key: string; words: PWord[]; aligned: boolean; keywords: PolishKeyword[]; zooms: PolishZoom[]; polished: boolean;
  /** the required headline layouts (with their B-roll found) */
  headlines: PolishHeadline[];
  /** pinned pictures of the ingredients the speaker names */
  shots: PolishShot[];
  faces: SrcFaces | null; faced: boolean;
};
type PState = { t: number; dur: number; playing: boolean; muted: boolean; ready: boolean; waiting: boolean };
type Api = {
  load: (cfg: unknown) => Promise<void>; play: () => void; pause: () => void; seek: (t: number) => void; restart: () => void;
  mute: (m: boolean) => void; state: () => PState; on: (fn: (s: PState) => void) => () => void;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function ClipPreview({ jobId, mediaUrl, clips, auto, autoPicked, focus, settings, theme }: {
  jobId: string; mediaUrl: string | null | undefined; clips: PClip[]; auto: number; autoPicked: boolean;
  /** a clip the client is working on (its caption editor is open): shown here */
  focus?: number | null; settings: PreviewSettings;
  theme: { primary: string; gradient: string; faint: string; soft: string };
}) {
  // the clip shown: the first ticked one (else the top one); the arrows look at the others
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => { setPick(null); }, [auto, jobId]);
  useEffect(() => { if (typeof focus === "number") setPick(focus); }, [focus]);
  const idx = Math.min(clips.length - 1, Math.max(0, pick ?? auto));
  const clip = clips[idx];
  const key = clip ? `${jobId}|${clipKey(clip.start, clip.end)}` : "";

  // the clip's words (fast), then its keyword polish (one AI call, kept for the render)
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [polishing, setPolishing] = useState(false);
  const busy = useRef<string | null>(null);
  useEffect(() => {
    if (!clip || !mediaUrl) return;
    let off = false;
    setErr(null);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/clipper/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId, start: clip.start, end: clip.end, title: clip.title, polish: false }),
        });
        const d = await r.json();
        if (off) return;
        if (!r.ok || !d?.ok) throw new Error(d?.error || "Pratonton gagal");
        setData({ key, words: d.words, aligned: !!d.aligned, keywords: d.keywords ?? [], zooms: d.zooms ?? [], polished: !!d.polished,
          headlines: d.headlines ?? [], shots: d.shots ?? [], faces: d.faces ?? null, faced: !!d.faced });
      } catch (e: any) {
        if (!off) setErr(e?.message || "Pratonton gagal");
      }
    }, 350);
    return () => { off = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mediaUrl]);
  useEffect(() => {
    if (!clip || !data || data.key !== key) return;
    // the polish call also writes the required headlines: made for every clip, whatever the keyword setting
    const wantPolish = !data.polished;
    const wantFaces = !data.faced;
    const tag = `${key}|${wantPolish}|${wantFaces}`;
    if ((!wantPolish && !wantFaces) || busy.current === tag) return;
    busy.current = tag;
    setPolishing(wantPolish);
    (async () => {
      try {
        const r = await fetch("/api/clipper/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId, start: clip.start, end: clip.end, title: clip.title, polish: wantPolish, faces: wantFaces }),
        });
        const d = await r.json();
        if (r.ok && d?.ok) {
          setData((cur) => (cur && cur.key === key ? {
            ...cur,
            // the polish comes with the AI's caption corrections: the words as the render will show them (same count)
            ...(wantPolish ? { keywords: d.keywords ?? [], zooms: d.zooms ?? [], headlines: d.headlines ?? [], shots: d.shots ?? [], polished: true,
              ...(Array.isArray(d.words) && d.words.length === cur.words.length ? { words: d.words } : {}) } : {}),
            ...(wantFaces ? { faces: d.faces ?? null, faced: true } : {}),
          } : cur));
        }
      } catch { /* the preview stays without colours / faces */ } finally {
        if (busy.current === tag) busy.current = null;
        setPolishing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, key, settings.polish, settings.captions]);

  // what the preview page draws — rebuilt only when a value it uses changes (the parent re-creates the objects)
  const sig = clip ? JSON.stringify([clip.start, clip.end, clip.hook, clip.flash?.start ?? null, clip.flash?.end ?? null, clip.capFix ?? null, clip.brollFix ?? null, settings]) : "";
  const cfg = useMemo(() => {
    if (!clip || !mediaUrl || !data || data.key !== key) return null;
    const fl = clipFlash(clip, settings.coldOpen);
    const tl = previewTimeline(data.words, clip.end - clip.start, {
      flash: fl ? { start: fl.start - clip.start, end: fl.end - clip.start } : null, jumpcut: settings.jumpcut, aligned: data.aligned,
    });
    // the client's caption corrections (same words they were made on): each word keeps its timing, "" drops it
    const cf = clip.capFix && clip.capFix.key === clipKey(clip.start, clip.end) && clip.capFix.words.length === data.words.length ? clip.capFix.fix : null;
    if (cf) tl.words = tl.words.map((w) => (w.si in cf ? { ...w, w: cf[w.si] } : w)).filter((w) => w.w.trim());
    // the client's own overlay: corrected words and / or their B-roll in place of the AI's
    const bf = clip.brollFix && clip.brollFix.key === clipKey(clip.start, clip.end) ? clip.brollFix.items : null;
    const heads = bf ? data.headlines.map((h, i) => {
      const o = bf[i];
      if (!o) return h;
      return {
        ...h,
        ...(o.lead !== undefined ? { lead: o.lead } : {}), ...(o.big ? { big: o.big.toUpperCase() } : {}), ...(o.box !== undefined ? { box: o.box } : {}),
        ...(o.url && h.kind !== "over" ? { media: o.video ? "video" as const : "photo" as const, candidates: [o.url], credit: undefined } : {}),
      };
    }) : data.headlines;
    const pol = polishOnTimeline(tl, data.keywords, data.zooms, heads, data.shots);
    const props = previewProps({
      video: "clip://preview", tl, seed: clipSeed(jobId, clip.start, clip.end), hook: settings.hookOn ? clip.hook : null,
      captions: settings.captions, captionLook: settings.captionLook, captionPos: settings.captionPos, polish: settings.polish,
      keywords: pol.keywords, zooms: pol.zooms, faces: previewFaces(data.faces, tl, settings.frame), headlines: pol.headlines, shots: pol.shots,
      cta: settings.cta === "none" ? null : settings.cta,
    });
    const wmText = settings.wmText.replace(/[^\w@.\- ]/g, "").trim().slice(0, 40);
    return {
      props, src: mediaUrl, frame: settings.frame, segs: tl.segs, dur: tl.dur, flashAt: tl.flashAt, clipStart: clip.start,
      track: faceTrack(data.faces, settings.frame),
      watermark: settings.wmImage ? { image: settings.wmImage } : wmText ? { text: wmText } : null, autoplay: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, mediaUrl, data, key, jobId]);

  // the preview page (same origin): load → its API
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [api, setApi] = useState<Api | null>(null);
  const [st, setSt] = useState<PState | null>(null);
  const onFrameLoad = () => {
    const w = frameRef.current?.contentWindow as (Window & { __clipPreview?: Api }) | null;
    if (!w) return;
    const got = () => { if (w.__clipPreview) setApi(w.__clipPreview); };
    if (w.__clipPreview) got();
    else w.addEventListener("clip-preview-ready", got, { once: true });
  };
  useEffect(() => {
    if (!api) return;
    let last = 0;
    return api.on((s) => {
      const now = performance.now();
      if (s.playing && now - last < 120) return; // ~8 updates a second is plenty for the bar
      last = now;
      setSt(s);
    });
  }, [api]);
  useEffect(() => {
    if (!api || !cfg) return;
    const t = setTimeout(() => { void api.load(cfg); }, 120);
    return () => clearTimeout(t);
  }, [api, cfg]);

  if (!clip) return null;
  const n = clips.length;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-extrabold text-[var(--color-text-primary)]">👁 Pratonton langsung</span>
        {n > 1 && (
          <span className="ml-auto flex items-center gap-1">
            <button type="button" aria-label="Klip sebelum" className="p-1 rounded-md" style={{ border: "1px solid var(--color-border)" }}
              onClick={() => setPick((p) => (Math.min(n - 1, Math.max(0, p ?? auto)) - 1 + n) % n)}><ChevronLeft className="w-3.5 h-3.5" /></button>
            <button type="button" aria-label="Klip seterusnya" className="p-1 rounded-md" style={{ border: "1px solid var(--color-border)" }}
              onClick={() => setPick((p) => (Math.min(n - 1, Math.max(0, p ?? auto)) + 1) % n)}><ChevronRight className="w-3.5 h-3.5" /></button>
          </span>
        )}
      </div>
      <div className="text-[11px] font-bold text-[var(--color-text-secondary)] leading-snug line-clamp-2" title={clip.title}>
        #{idx + 1} · {clip.title}
        <span className="font-normal text-[var(--color-text-muted)]">{pick === null ? (autoPicked ? " · klip pertama yang ditanda" : " · tanda klip untuk tukar") : ""}</span>
      </div>

      <div className="relative rounded-xl overflow-hidden bg-black mx-auto" style={{ aspectRatio: "9 / 16", width: "100%", maxWidth: 300 }}>
        {mediaUrl ? (
          <iframe ref={frameRef} src="/clipper-preview/index.html" title="Pratonton klip" onLoad={onFrameLoad}
            allow="autoplay" className="absolute inset-0 w-full h-full border-0" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[11px] text-white/70">
            Pratonton perlukan salinan video — masih disediakan. Cuba sebentar lagi.
          </div>
        )}
        {mediaUrl && (!cfg || !st?.ready || (st.playing && st.waiting)) && !err && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-6 h-6 animate-spin text-white/80" />
          </div>
        )}
        {err && <div className="absolute inset-x-0 bottom-0 p-2 text-[10px] text-white bg-red-600/80">{err}</div>}
        {polishing && (
          <div className="absolute left-2 top-2 px-2 py-1 rounded-md text-[10px] font-bold text-white bg-black/60 inline-flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> AI susun headline &amp; kata kunci…
          </div>
        )}
      </div>

      {api && st && (
        <div className="space-y-1.5 mx-auto" style={{ maxWidth: 300 }}>
          <div className="h-1.5 rounded-full cursor-pointer" style={{ background: "var(--color-border)" }}
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); api.seek(((e.clientX - r.left) / r.width) * (st.dur || 0)); }}>
            <div className="h-full rounded-full" style={{ width: `${st.dur ? Math.min(100, (st.t / st.dur) * 100) : 0}%`, background: theme.gradient }} />
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => (st.playing ? api.pause() : api.play())} aria-label={st.playing ? "Jeda" : "Main"}
              className="px-2.5 py-1 rounded-lg text-white inline-flex items-center gap-1 text-[11px] font-extrabold" style={{ background: theme.gradient }}>
              {st.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}{st.playing ? "Jeda" : "Main"}
            </button>
            <button type="button" onClick={() => api.restart()} aria-label="Dari awal" className="p-1.5 rounded-lg" style={{ border: "1px solid var(--color-border)" }}>
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => api.mute(!st.muted)} aria-label={st.muted ? "Buka bunyi" : "Senyap"} className="p-1.5 rounded-lg" style={{ border: "1px solid var(--color-border)" }}>
              {st.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <span className="ml-auto text-[10px] tabular-nums text-[var(--color-text-muted)]">{fmt(st.t)} / {fmt(st.dur)}</span>
          </div>
        </div>
      )}
      <p className="text-[10px] leading-snug text-[var(--color-text-muted)] mx-auto" style={{ maxWidth: 300 }}>
        Dilukis oleh enjin render sebenar — caption, hook, headline, split-screen, warna kata kunci &amp; zoom sama seperti klip akhir.
        {settings.frame === "split" ? " Susunan 2 orang dibuat tepat ikut muka semasa jana." : ""}{" "}Muzik &amp; SFX ditambah semasa jana.
      </p>
    </div>
  );
}

// ── the clip's captions, editable before the render ──
export function ClipCaptionEditor({ jobId, clip, onChange, onClose, theme }: {
  jobId: string; clip: PClip; onChange: (cf: CapFix | null) => void; onClose: () => void;
  theme: { primary: string; gradient: string; faint: string; soft: string };
}) {
  const key = clipKey(clip.start, clip.end);
  const [words, setWords] = useState<string[] | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    let off = false;
    setWords(null);
    setErr(null);
    (async () => {
      try {
        const r = await fetch("/api/clipper/preview", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId, start: clip.start, end: clip.end, polish: false, faces: false }),
        });
        const d = await r.json();
        if (off) return;
        if (!r.ok || !d?.ok) throw new Error(d?.error || "Caption tak dapat dibaca");
        const ws = (d.words as PWord[]).map((w) => w.w);
        setWords(ws);
        const cf = clip.capFix && clip.capFix.key === key && clip.capFix.words.length === ws.length ? clip.capFix.fix : null;
        setText(fixedText(ws, cf));
      } catch (e: any) {
        if (!off) setErr(e?.message || "Caption tak dapat dibaca");
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, key]);
  const fix = useMemo(() => (words ? captionFixMap(words, text) : {}), [words, text]);
  const n = Object.keys(fix).length;
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoN, setAutoN] = useState<number | null>(null);
  // ✨ the AI corrects misheard / misspelt words for this video's topic; the client's own corrections stay
  async function autoFix() {
    if (!words || autoBusy) return;
    setAutoBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/motion/caption-fix", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words, job_id: jobId, start: clip.start, end: clip.end }),
      });
      const d = await r.json();
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Auto betulkan gagal");
      const merged: Record<number, string> = {};
      let k = 0;
      for (const [i, w] of d.fixes as [number, string][]) if (!(i in fix) && w !== words[i]) { merged[i] = w; k++; }
      setText(fixedText(words, { ...merged, ...fix }));
      setAutoN(k);
    } catch (e: any) {
      setErr(e?.message || "Auto betulkan gagal");
    } finally {
      setAutoBusy(false);
    }
  }
  // every change reaches the preview (and the render) a moment after typing stops
  useEffect(() => {
    if (!words) return;
    setSaved(false);
    const t = setTimeout(() => { onChange(n ? { key, words, fix } : null); setSaved(true); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix]);
  return (
    <div className="rounded-lg p-3 space-y-2" style={{ border: `1px solid ${theme.soft}`, background: theme.faint }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-extrabold text-[var(--color-text-primary)]">✏️ Caption klip — betulkan sebelum jana</span>
        {words && (
          <span className="text-[10px] font-bold" style={{ color: n ? theme.primary : "var(--color-text-muted)" }}>
            {n ? `${n} perkataan dibetulkan` : "tiada perubahan"}{saved ? "" : " · …"}
          </span>
        )}
      </div>
      {err ? (
        <p className="text-[11px] text-red-500">{err}</p>
      ) : words ? (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(10, Math.max(3, Math.ceil(text.length / 90)))}
          spellCheck={false} aria-label="Caption klip"
          className="w-full rounded-lg px-3 py-2 text-[13px] leading-relaxed outline-none"
          style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Membaca caption…</div>
      )}
      <p className="text-[10px] leading-snug text-[var(--color-text-muted)]">
        Betulkan ejaan / perkataan yang salah dengar, buang perkataan, atau tambah. Masa setiap perkataan kekal — pratonton terus
        tunjuk caption baru, dan klip akhir guna caption ini.
      </p>
      <div className="flex gap-1.5 flex-wrap items-center">
        {words && (
          <button type="button" onClick={() => void autoFix()} disabled={autoBusy} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1 disabled:opacity-60"
            style={{ border: `1px solid ${theme.primary}`, color: theme.primary }} title="AI betulkan perkataan yang salah dengar / salah eja ikut isi video">
            {autoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "✨"} Auto betulkan (AI)
          </button>
        )}
        {autoN !== null && !autoBusy && <span className="text-[10px] text-[var(--color-text-muted)]">{autoN ? `AI betulkan ${autoN} perkataan` : "AI tiada pembetulan"}</span>}
        {words && n > 0 && (
          <button type="button" onClick={() => setText(fixedText(words, null))} className="px-2.5 py-1 rounded-lg text-[11px] font-bold"
            style={{ border: "1px solid var(--color-border)" }}>Kembali ke asal</button>
        )}
        <button type="button" onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold text-white" style={{ background: theme.gradient }}>Siap</button>
      </div>
    </div>
  );
}

// ── the clip's B-roll: the AI's pick per split / corner layout, or the client's own upload ──
function Thumb({ url, video }: { url?: string; video?: boolean }) {
  const box = "w-[72px] h-[72px] rounded-lg overflow-hidden bg-black shrink-0";
  if (!url) return <div className={`${box} flex items-center justify-center text-[9px] text-white/70 text-center px-1`} style={{ background: "linear-gradient(135deg,#2a1840,#0d0d14)" }}>latar warna</div>;
  return video
    ? <video className={`${box} object-cover`} src={`${url}#t=1`} muted playsInline preload="metadata" />
    // eslint-disable-next-line @next/next/no-img-element
    : <img className={`${box} object-cover`} src={url} alt="" />;
}

export function ClipBrollEditor({ jobId, clip, onChange, onClose, theme }: {
  jobId: string; clip: PClip; onChange: (bf: BrollFix | null) => void; onClose: () => void;
  theme: { primary: string; gradient: string; faint: string; soft: string };
}) {
  const key = clipKey(clip.start, clip.end);
  const [heads, setHeads] = useState<PolishHeadline[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pct, setPct] = useState<Record<number, number>>({});
  useEffect(() => {
    let off = false;
    setHeads(null);
    setErr(null);
    (async () => {
      // the clip's layouts (the AI picks them once per clip — up to ~40 s the first time)
      for (let n = 0; n < 30 && !off; n++) {
        try {
          const r = await fetch("/api/clipper/preview", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ job_id: jobId, start: clip.start, end: clip.end, title: clip.title, polish: true, faces: false }),
          });
          const d = await r.json();
          if (off) return;
          if (!r.ok || !d?.ok) throw new Error(d?.error || "B-roll tak dapat dibaca");
          if (d.polished) { setHeads(d.headlines ?? []); return; }
        } catch (e: any) {
          if (!off) setErr(e?.message || "B-roll tak dapat dibaca");
          return;
        }
        await new Promise((res) => setTimeout(res, 3000));
      }
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, key]);
  const fix = clip.brollFix && clip.brollFix.key === key ? clip.brollFix.items : {};
  const setItem = (i: number, v: OverlayItem | null) => {
    const items = { ...fix };
    if (v && Object.keys(v).length) items[i] = v; else delete items[i];
    onChange(Object.keys(items).length ? { key, items } : null);
  };
  const patch = (i: number, p: OverlayItem) => {
    const cur: OverlayItem = { ...(fix[i] ?? {}), ...p };
    for (const k of Object.keys(cur) as (keyof OverlayItem)[]) if (cur[k] === undefined) delete cur[k];
    setItem(i, cur);
  };
  async function pick(i: number, f: File | null) {
    if (!f) return;
    setErr(null);
    setPct((p) => ({ ...p, [i]: 0 }));
    try {
      patch(i, { ...(await uploadOwn(f, (n) => setPct((p) => ({ ...p, [i]: n })))), ai: undefined });
    } catch (e: any) {
      setErr(e?.message || "Upload gagal");
    } finally {
      setPct((p) => { const q = { ...p }; delete q[i]; return q; });
    }
  }
  // 🔄 another picture from the AI, no upload: what the client typed to show, else the row's new words (when they
  // changed them), else the next one for the same search — every picture already shown here is left out
  const [want, setWant] = useState<Record<number, string>>({});
  const [finding, setFinding] = useState<Record<number, boolean>>({});
  const [note, setNote] = useState<Record<number, string>>({});
  const shown = useRef<Record<string, string[]>>({});
  async function repick(i: number, h: PolishHeadline) {
    if (finding[i]) return;
    const own = fix[i];
    const seenKey = `${key}|${i}`;
    const seen = Array.from(new Set([...(shown.current[seenKey] ?? []), ...(h.candidates?.[0] ? [h.candidates[0]] : []), ...(own?.url ? [own.url] : [])]));
    const textChanged = !!own && (own.lead !== undefined || !!own.big || own.box !== undefined);
    const text = [own?.lead ?? h.lead, own?.big ?? h.big, own?.box ?? h.box].filter(Boolean).join(" ");
    setFinding((f) => ({ ...f, [i]: true }));
    setNote((n) => ({ ...n, [i]: "" }));
    try {
      const r = await fetch("/api/motion/broll-pick", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: h.kind, want: (want[i] ?? "").trim(), text, ...(textChanged ? {} : { query: h.query ?? "" }),
          exclude: seen, job_id: jobId, start: clip.start, end: clip.end,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) throw new Error(d?.error || "Carian gambar gagal");
      if (d.none) { setNote((n) => ({ ...n, [i]: "AI tak jumpa gambar lain yang sesuai — taip apa nak tunjuk, atau upload sendiri." })); return; }
      shown.current[seenKey] = [...seen, d.url];
      patch(i, { url: d.url, video: !!d.video, ai: d.query || "AI" });
    } catch (e: any) {
      setNote((n) => ({ ...n, [i]: e?.message || "Carian gambar gagal" }));
    } finally {
      setFinding((f) => ({ ...f, [i]: false }));
    }
  }
  const rows = (heads ?? []).map((h, i) => ({ h, i }));
  return (
    <div className="rounded-lg p-3 space-y-2" style={{ border: `1px solid ${theme.soft}`, background: theme.faint }}>
      <div className="text-[11px] font-extrabold text-[var(--color-text-primary)]">🎬 Overlay klip — betulkan teks &amp; tukar B-roll sebelum jana</div>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      {!heads && !err && (
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)]"><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI sedang susun headline &amp; pilih B-roll…</div>
      )}

      {rows.map(({ h, i }) => {
        const own = fix[i];
        const ai = h.candidates?.[0];
        const up = pct[i];
        const media = h.kind !== "over";
        const field = (k: "lead" | "big" | "box", label: string, max: number) => (
          <input key={`${i}${k}${own?.[k] ?? h[k] ?? ""}`} defaultValue={own?.[k] ?? h[k] ?? ""} maxLength={max} aria-label={label} placeholder={label}
            onBlur={(e) => { const v = e.target.value.replace(/\s+/g, " ").trim(); const ai0 = (h[k] ?? "").trim(); patch(i, { [k]: v === ai0 ? undefined : k === "big" ? v.toUpperCase() : v }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={`w-full rounded-md px-2 py-1 text-[12px] outline-none ${k === "big" ? "font-extrabold uppercase" : k === "lead" ? "italic" : "font-mono"}`}
            style={{ background: "var(--color-surface, var(--color-bg))", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
        );
        return (
          <div key={i} className="flex items-start gap-3 rounded-lg p-2" style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}>
            {media ? <Thumb url={own?.url ?? ai} video={own?.url ? own.video : h.media !== "photo"} />
              : <div className="w-[72px] h-[72px] rounded-lg shrink-0 flex items-center justify-center text-[9px] text-white/80 text-center px-1" style={{ background: theme.gradient }}>atas orang</div>}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="text-[11px] font-extrabold text-[var(--color-text-primary)]">
                {h.kind === "split" ? "Split-screen" : h.kind === "pip" ? "Sudut — orang kecil bawah kanan" : "Headline atas orang"}
                {media && <span className="font-normal text-[10px] text-[var(--color-text-muted)]"> · {own?.url ? (own.ai ? `pilihan AI baru "${own.ai}"` : "✓ B-roll anda") : ai ? `pilihan AI${h.query ? ` "${h.query}"` : ""}` : "tiada gambar sesuai — latar warna"}</span>}
              </div>
              <div className="grid gap-1">
                {field("lead", "Ayat pembuka (italic)", 34)}
                {field("big", "PERKATAAN BESAR", 18)}
                {field("box", "Ayat dalam kotak", 34)}
              </div>
              {media && <div className="flex flex-wrap items-center gap-1.5">
                <input value={want[i] ?? ""} maxLength={60} placeholder="Cari: apa nak tunjuk (pilihan)" aria-label="Apa gambar nak tunjuk"
                  onChange={(e) => setWant((w) => ({ ...w, [i]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") void repick(i, h); }}
                  className="flex-1 min-w-[150px] rounded-md px-2 py-1 text-[11px] outline-none"
                  style={{ background: "var(--color-surface, var(--color-bg))", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
                <button type="button" onClick={() => void repick(i, h)} disabled={!!finding[i] || up !== undefined}
                  title="AI cari gambar / video lain untuk panel ini — ikut apa yang anda taip, atau ikut ayat baru jika anda ubah tulisan"
                  className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold inline-flex items-center gap-1 disabled:opacity-60"
                  style={{ border: `1px solid ${theme.primary}`, color: theme.primary }}>
                  {finding[i] ? <><Loader2 className="w-3 h-3 animate-spin" /> AI mencari…</> : "🔄 Cari gambar lain (AI)"}
                </button>
              </div>}
              {media && note[i] && <p className="text-[10px] text-[var(--color-text-muted)]">{note[i]}</p>}
              {media && <div className="flex flex-wrap gap-1.5">
                <label className="relative px-2.5 py-1 rounded-lg text-[11px] font-extrabold text-white cursor-pointer inline-flex items-center gap-1" style={{ background: theme.gradient }}>
                  {up !== undefined ? <><Loader2 className="w-3 h-3 animate-spin" /> {up}%</> : <><Upload className="w-3 h-3" /> {own?.url ? "Tukar B-roll" : "Upload B-roll sendiri"}</>}
                  <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" className="absolute inset-0 opacity-0 cursor-pointer"
                    disabled={up !== undefined} onChange={(e) => { void pick(i, e.target.files?.[0] ?? null); e.target.value = ""; }} />
                </label>
                {own?.url && (
                  <button type="button" onClick={() => patch(i, { url: undefined, video: undefined, ai: undefined })} className="px-2.5 py-1 rounded-lg text-[11px] font-bold" style={{ border: "1px solid var(--color-border)" }}>
                    {own.ai ? "Guna pilihan AI asal" : "Guna pilihan AI"}
                  </button>
                )}
              </div>}
              {own && (own.lead !== undefined || own.big || own.box !== undefined) && (
                <button type="button" onClick={() => patch(i, { lead: undefined, big: undefined, box: undefined })} className="text-[10px] underline text-[var(--color-text-muted)]">
                  Kembalikan teks AI
                </button>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-[10px] leading-snug text-[var(--color-text-muted)]">
        Betulkan perkataan yang AI salah faham. Nak gambar lain tanpa upload: tekan 🔄 (taip apa nak tunjuk, atau ubah tulisan dulu — AI cari ikut ayat baru). Atau upload gambar / video pendek anda (video: ~5 saat pertama dipakai). Pratonton terus tunjuk perubahan, dan klip akhir guna yang sama.
      </p>
      <button type="button" onClick={onClose} className="px-2.5 py-1 rounded-lg text-[11px] font-extrabold text-white" style={{ background: theme.gradient }}>Siap</button>
    </div>
  );
}
