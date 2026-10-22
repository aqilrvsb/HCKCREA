"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import {
  clipFlash, clipKey, clipSeed, faceTrack, polishOnTimeline, previewFaces, previewProps, previewTimeline,
  type PWord, type PolishKeyword, type PolishZoom, type SrcFaces,
} from "@/lib/clipper-preview";

// CLIPPER Studio — live preview of one clip with the client's settings, drawn by the render's own composition
// (public/clipper-preview: MotionEditPro over the clip's video). Every change of look shows at once; the render
// then reuses the same picks (seed) and keyword polish, so the clip comes out as previewed.

type PClip = { start: number; end: number; title: string; hook: string; flash?: { start: number; end: number } | null };
export type PreviewSettings = {
  frame: "face" | "fit" | "center" | "split"; captions: boolean; captionLook?: string; captionPos: "low" | "mid";
  hookOn: boolean; jumpcut: boolean; coldOpen: boolean; polish: boolean; wmText: string; wmImage: string;
};
type Data = {
  key: string; words: PWord[]; aligned: boolean; keywords: PolishKeyword[]; zooms: PolishZoom[]; polished: boolean;
  faces: SrcFaces | null; faced: boolean;
};
type PState = { t: number; dur: number; playing: boolean; muted: boolean; ready: boolean; waiting: boolean };
type Api = {
  load: (cfg: unknown) => Promise<void>; play: () => void; pause: () => void; seek: (t: number) => void; restart: () => void;
  mute: (m: boolean) => void; state: () => PState; on: (fn: (s: PState) => void) => () => void;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function ClipPreview({ jobId, mediaUrl, clips, auto, autoPicked, settings, theme }: {
  jobId: string; mediaUrl: string | null | undefined; clips: PClip[]; auto: number; autoPicked: boolean; settings: PreviewSettings;
  theme: { primary: string; gradient: string; faint: string; soft: string };
}) {
  // the clip shown: the first ticked one (else the top one); the arrows look at the others
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => { setPick(null); }, [auto, jobId]);
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
          faces: d.faces ?? null, faced: !!d.faced });
      } catch (e: any) {
        if (!off) setErr(e?.message || "Pratonton gagal");
      }
    }, 350);
    return () => { off = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mediaUrl]);
  useEffect(() => {
    if (!clip || !data || data.key !== key) return;
    const wantPolish = settings.polish && settings.captions && !data.polished;
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
            ...(wantPolish ? { keywords: d.keywords ?? [], zooms: d.zooms ?? [], polished: true } : {}),
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
  const sig = clip ? JSON.stringify([clip.start, clip.end, clip.hook, clip.flash?.start ?? null, clip.flash?.end ?? null, settings]) : "";
  const cfg = useMemo(() => {
    if (!clip || !mediaUrl || !data || data.key !== key) return null;
    const fl = clipFlash(clip, settings.coldOpen);
    const tl = previewTimeline(data.words, clip.end - clip.start, {
      flash: fl ? { start: fl.start - clip.start, end: fl.end - clip.start } : null, jumpcut: settings.jumpcut, aligned: data.aligned,
    });
    const pol = polishOnTimeline(tl, data.keywords, data.zooms);
    const props = previewProps({
      video: "clip://preview", tl, seed: clipSeed(jobId, clip.start, clip.end), hook: settings.hookOn ? clip.hook : null,
      captions: settings.captions, captionLook: settings.captionLook, captionPos: settings.captionPos, polish: settings.polish,
      keywords: pol.keywords, zooms: pol.zooms, faces: previewFaces(data.faces, tl, settings.frame),
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
            <Loader2 className="w-3 h-3 animate-spin" /> AI pilih kata kunci…
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
        Dilukis oleh enjin render sebenar — caption, hook, warna kata kunci &amp; zoom sama seperti klip akhir.
        {settings.frame === "split" ? " Susunan 2 orang dibuat tepat ikut muka semasa jana." : ""}{" "}Muzik &amp; SFX ditambah semasa jana.
      </p>
    </div>
  );
}
