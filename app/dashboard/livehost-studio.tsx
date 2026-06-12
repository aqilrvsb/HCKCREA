"use client";

// Livehost studio — ported from github.com/aqilrvsb/talking-head-live.
// One always-mounted component; the `view` prop switches which section is
// visible (live | scripts | products | usage) WITHOUT unmounting, so the
// WebRTC stream survives navigation. Backend URL comes from
// /api/livehost/config (admin-configured per client); GPU power goes through
// /api/livehost/gpu. All CSS is scoped under .lh-studio.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AttachmentPicker from "./sections/attachment-picker";

export type LiveView = "live" | "scripts" | "products" | "usage";

type IceConfig = { iceServers: RTCIceServer[]; iceTransportPolicy?: RTCIceTransportPolicy };
type Script = { id: string; title: string; text: string };

const VOICES = [
  { label: "Mira", id: "moss_audio_cf82d8cb-4799-11f1-aea0-d66da573c477" },
  { label: "Jamal", id: "moss_audio_60caaba6-4799-11f1-bb39-7aa70590506b" },
  { label: "Afifah", id: "moss_audio_b4d54c5a-225f-11f1-bf6e-065823da7bf2" },
  { label: "Aqil", id: "Malay_male_1_v1" },
  { label: "Nana", id: "Malay_female_1_v1" },
  { label: "Mila", id: "Malay_female_2_v1" },
];

// Mirror of the GPU backend's _split_sentences: sentences merged into
// ~12–15 word chunks (cap 20 words / 400 chars) for natural TTS pacing.
function splitSentences(text: string): string[] {
  const MAX = 400;
  const lines: string[] = [];
  for (const blockRaw of text.split(/[\r\n]+/)) {
    const block = blockRaw.trim();
    if (!block) continue;
    for (const pieceRaw of block.split(/(?<=[.!?。！？…])\s+/)) {
      const piece = pieceRaw.trim();
      if (!piece) continue;
      if (piece.length <= MAX) { lines.push(piece); continue; }
      let cur = "";
      for (const word of piece.split(/\s+/)) {
        if (cur.length + word.length + 1 > MAX) { if (cur) lines.push(cur); cur = word; }
        else cur = (cur ? cur + " " : "") + word;
      }
      if (cur) lines.push(cur);
    }
  }
  const merged: string[] = [];
  let cur = "";
  for (const ln of lines) {
    const cand = cur ? `${cur} ${ln}` : ln;
    if (cur && (cand.split(/\s+/).length > 20 || cand.length > MAX)) { merged.push(cur); cur = ln; }
    else cur = cand;
    if (cur.split(/\s+/).length >= 12) { merged.push(cur); cur = ""; }
  }
  if (cur) merged.push(cur);
  return merged;
}

function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 4000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener("icegatheringstatechange", check); resolve(); };
    const check = () => { if (pc.iceGatheringState === "complete") done(); };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

export default function LivehostStudio({ view }: { view: LiveView }) {
  // Backend URL — per-client, admin-configured.
  const [backend, setBackend] = useState("");
  const [configErr, setConfigErr] = useState("");
  const backendRef = useRef("");
  useEffect(() => {
    fetch("/api/livehost/config")
      .then((r) => r.json())
      .then((d) => {
        if (d.backendUrl) {
          setBackend(d.backendUrl); backendRef.current = d.backendUrl;
          if (d.provisionStatus && d.provisionStatus !== "ready") {
            setConfigErr(`⚙ GPU anda sedang disediakan secara automatik (~30 minit): ${d.provisionStatus}. Refresh sebentar lagi.`);
          }
        }
        else setConfigErr(d.error || "Livehost belum dikonfigurasi.");
      })
      .catch(() => setConfigErr("Could not load Livehost config."));
  }, []);

  const [avatars, setAvatars] = useState<string[]>([]);
  const [backgrounds, setBackgrounds] = useState<string[]>([]);
  const [avatarId, setAvatarId] = useState("");
  const [voiceId, setVoiceId] = useState(VOICES[0].id);
  const [chatText, setChatText] = useState("");
  const [captions, setCaptions] = useState(false);
  const [captionText, setCaptionText] = useState("");
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const activeRef = useRef(false);
  const connectingRef = useRef(false);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { connectingRef.current = connecting; }, [connecting]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [overlays, setOverlays] = useState<{ file: string; label: string }[]>([]);
  const [overlaySel, setOverlaySel] = useState("");
  const [customOverlay, setCustomOverlay] = useState("");
  // Attachment picker — avatar + overlay/template now come from the user's
  // PeningLab Attachments library instead of a local file upload.
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [overlayPickerOpen, setOverlayPickerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offsetY, setOffsetY] = useState(0);
  const [offsetX, setOffsetX] = useState(0);
  const [previewUrl, setPreviewUrl] = useState("");
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; active: boolean }>({ startX: 0, startY: 0, baseX: 0, baseY: 0, active: false });
  // Draggable AI-disclosure badge (TikTok AI-content policy) — position in % of stage.
  const [badgePos, setBadgePos] = useState<{ x: number; y: number }>({ x: 4, y: 10 });
  const badgeDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; active: boolean }>({ startX: 0, startY: 0, baseX: 0, baseY: 0, active: false });

  const onBadgePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    badgeDragRef.current = { startX: e.clientX, startY: e.clientY, baseX: badgePos.x, baseY: badgePos.y, active: true };
  }, [badgePos]);
  const onBadgePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = badgeDragRef.current;
    if (!d.active) return;
    e.stopPropagation();
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    setBadgePos({
      x: Math.max(0, Math.min(80, d.baseX + ((e.clientX - d.startX) / stage.width) * 100)),
      y: Math.max(0, Math.min(94, d.baseY + ((e.clientY - d.startY) / stage.height) * 100)),
    });
  }, []);
  const onBadgePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    badgeDragRef.current.active = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, []);
  const [stock, setStock] = useState<{ id: string; file: string; label: string }[]>([]);
  const [stockSel, setStockSel] = useState("");
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [productKb, setProductKb] = useState("");
  const [volume, setVolume] = useState(1.5);
  const [speed, setSpeed] = useState(1.0);
  const [emotion, setEmotion] = useState("fluent"); // MiniMax: fluent (natural flow) | happy | neutral | surprised | sad
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  // Server-side session metering — the billing source of truth.
  // start → /api/livehost/session start; heartbeat every 30s with cumulative
  // voice chars; stop → exact end second. Crashes are closed server-side
  // from the stale heartbeat, so no second is ever lost.
  const sessionIdRef = useRef<string | null>(null);
  const sessionCharsRef = useRef(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  type UsageData = {
    rates: { gpuRateHour: number; voiceRate1k: number; currency: string };
    sessions: { id: string; startedAt: string; status: string; durationSec: number; voiceChars: number; gpuCost: number; voiceCost: number; totalCost: number }[];
    month: { streamSec: number; voiceChars: number; gpuCost: number; voiceCost: number; totalCost: number };
  };
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const addVoiceChars = useCallback((n: number) => {
    if (n > 0) sessionCharsRef.current += n;
  }, []);

  const sessionPost = useCallback((payload: object) => {
    return fetch("/api/livehost/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json()).catch(() => null);
  }, []);

  const beginSession = useCallback(async () => {
    sessionCharsRef.current = 0;
    const d = await sessionPost({ action: "start" });
    if (d?.sessionId) {
      sessionIdRef.current = d.sessionId;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (sessionIdRef.current) {
          sessionPost({ action: "heartbeat", sessionId: sessionIdRef.current, voiceChars: sessionCharsRef.current });
        }
      }, 30000);
    }
  }, [sessionPost]);

  const endSession = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    if (!id) return;
    const payload = JSON.stringify({ action: "stop", sessionId: id, voiceChars: sessionCharsRef.current });
    // sendBeacon survives tab close; fall back to fetch
    try {
      if (!navigator.sendBeacon("/api/livehost/session", new Blob([payload], { type: "application/json" }))) {
        fetch("/api/livehost/session", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
      }
    } catch {
      fetch("/api/livehost/session", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    }
  }, []);

  // Best-effort stop on tab close (crash fallback = stale heartbeat).
  useEffect(() => {
    const h = () => endSession();
    window.addEventListener("pagehide", h);
    return () => window.removeEventListener("pagehide", h);
  }, [endSession]);
  const [gpuUsage, setGpuUsage] = useState<{ runtime_hours: number; dph_usd: number; cost_usd: number; state?: string } | null>(null);
  const [gpuUsageErr, setGpuUsageErr] = useState("");
  const [serverState, setServerState] = useState<string>("…");
  const [serverBusy, setServerBusy] = useState(false);
  const [wakeMsg, setWakeMsg] = useState("");

  const gpuAction = useCallback(async (action: "status" | "start" | "stop") => {
    if (action === "stop" && !window.confirm("Shutdown the GPU server? The live stream will end.")) return;
    if (action !== "status") setServerBusy(true);
    try {
      const r = await fetch("/api/livehost/gpu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      setServerState(d.note ? `${d.state} — ${d.note}` : (d.state || d.error || "unknown"));
    } catch (e: any) {
      setServerState(String(e?.message || e));
    } finally {
      if (action !== "status") setTimeout(() => setServerBusy(false), 4000);
    }
  }, []);

  // GPU power buttons: On = start + wait until the backend answers; Off = stop.
  const loadAvatarsRef = useRef<(() => void) | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const gpuOn = useCallback(async () => {
    setServerBusy(true);
    setWakeMsg("GPU sedang dihidupkan… ⏳");
    try {
      await fetch("/api/livehost/gpu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      }).catch(() => {});
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        try {
          const ping = await fetch(`${backendRef.current}/avatars`, { signal: AbortSignal.timeout(5000) });
          if (ping.ok) {
            setWakeMsg("✓ GPU ON — tekan ▶ Start untuk mula streaming");
            setServerState("running");
            loadAvatarsRef.current?.();
            return;
          }
        } catch {}
        setWakeMsg(`GPU sedang dihidupkan… ${(i + 1) * 10}s ⏳`);
      }
      setWakeMsg("GPU tidak respons — cuba sekali lagi.");
    } finally {
      setServerBusy(false);
    }
  }, []);

  const gpuOff = useCallback(async () => {
    if (!window.confirm("Matikan GPU? Stream akan berhenti.")) return;
    setServerBusy(true);
    stopRef.current?.();
    await fetch("/api/livehost/gpu", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    }).catch(() => {});
    setServerState("stopped");
    setWakeMsg("");
    setServerBusy(false);
  }, []);

  // Script library + rundown
  const [scripts, setScripts] = useState<Script[]>([]);
  const [rundown, setRundown] = useState<string[]>([]);
  const [rundownAdd, setRundownAdd] = useState("");
  const [playPos, setPlayPos] = useState<{ s: number; l: number }>({ s: -1, l: -1 });
  const [scriptPlaying, setScriptPlaying] = useState(false);
  const [scriptPaused, setScriptPaused] = useState(false);
  const [scriptWaiting, setScriptWaiting] = useState(false);
  const [scriptLoop, setScriptLoop] = useState(false);
  const scriptsRef = useRef<Script[]>([]);
  const rundownRef = useRef<string[]>([]);
  const posRef = useRef<{ s: number; l: number }>({ s: 0, l: 0 });
  const playingRef = useRef(false);
  const loopRef = useRef(false);
  const sayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [wordFrac, setWordFrac] = useState(0);
  const wordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const LEAD_MS = 5000;
  const audioEndRef = useRef(0);
  const sayCounterRef = useRef(0);
  const pendingSayRef = useRef<Map<string, { s: number; l: number } | { chat: true }>>(new Map());
  const highlightTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const overlayUrl = customOverlay || (overlaySel ? `/overlays/${overlaySel}` : "");

  useEffect(() => { scriptsRef.current = scripts; }, [scripts]);
  useEffect(() => { rundownRef.current = rundown; }, [rundown]);
  useEffect(() => { loopRef.current = scriptLoop; }, [scriptLoop]);

  const curScript = useMemo(() => {
    const id = rundown[playPos.s >= 0 ? playPos.s : 0];
    return scripts.find((s) => s.id === id) || null;
  }, [scripts, rundown, playPos.s]);
  const curLines = useMemo(() => (curScript ? splitSentences(curScript.text) : []), [curScript]);

  const buildKbPrompt = useCallback((kb: string) => {
    const base =
      "You are a friendly, energetic Malaysian live-commerce host on TikTok Live. " +
      "A viewer sent a chat message. Reply in casual Bahasa Melayu, ONE or TWO short " +
      "spoken sentences, warm and persuasive, no emojis or symbols. " +
      "COMPLIANCE (TikTok policy): never claim to be a doctor, pharmacist, or any " +
      "professional; never promise medical cures, miracle or instant results; never " +
      "exaggerate product efficacy beyond the provided knowledge; quote only the " +
      "prices given. If asked for medical advice, suggest consulting a professional.";
    return kb.trim()
      ? `${base}\n\nAnswer using ONLY this product knowledge. If the answer is not in it, ` +
        `politely say you will check and remind them about the voucher.\n\nPRODUCT KNOWLEDGE:\n${kb.trim()}`
      : base;
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") dc.send(JSON.stringify({ kind: "kb", text: buildKbPrompt(productKb) }));
    }, 800);
    return () => clearTimeout(t);
  }, [productKb, active, buildKbPrompt]);

  const onStagePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(".fs-btn")) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: offsetX, baseY: offsetY, active: true };
  }, [offsetX, offsetY]);

  const onStagePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const r = e.currentTarget.getBoundingClientRect();
    setOffsetX(Math.max(-80, Math.min(80, d.baseX + ((e.clientX - d.startX) / r.width) * 100)));
    setOffsetY(Math.max(-80, Math.min(80, d.baseY + ((e.clientY - d.startY) / r.height) * 100)));
  }, []);

  const onStagePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  // Restore persisted settings.
  useEffect(() => {
    let saved: any = {};
    try { saved = JSON.parse(localStorage.getItem("livehost_settings") || "{}"); } catch {}
    if (saved.overlaySel) setOverlaySel(saved.overlaySel);
    if (saved.voiceId) setVoiceId(saved.voiceId);
    if (typeof saved.zoom === "number") setZoom(saved.zoom);
    if (typeof saved.offsetX === "number") setOffsetX(saved.offsetX);
    if (typeof saved.offsetY === "number") setOffsetY(saved.offsetY);
    if (typeof saved.scriptLoop === "boolean") { setScriptLoop(saved.scriptLoop); loopRef.current = saved.scriptLoop; }
    if (typeof saved.volume === "number") setVolume(saved.volume);
    if (typeof saved.speed === "number") setSpeed(saved.speed);
    if (saved.badgePos && typeof saved.badgePos.x === "number") setBadgePos(saved.badgePos);
    if (typeof saved.emotion === "string") setEmotion(saved.emotion);
    if (Array.isArray(saved.rundown)) { setRundown(saved.rundown); rundownRef.current = saved.rundown; }
    try {
      const lib = JSON.parse(localStorage.getItem("livehost_scripts") || "[]");
      if (Array.isArray(lib)) { setScripts(lib); scriptsRef.current = lib; }
    } catch {}
    try {
      const kb = localStorage.getItem("livehost_products");
      if (kb) setProductKb(kb);
    } catch {}
    fetch("/overlays/manifest.json").then((r) => r.json()).then(setOverlays).catch(() => {});
    fetch("/avatars/manifest.json").then((r) => r.json()).then((list) => {
      setStock(list);
      if (saved.stockSel) {
        const item = (list as { id: string; file: string }[]).find((s) => s.id === saved.stockSel);
        if (item) { setStockSel(item.id); setAvatarId(item.id); setPreviewUrl(`/avatars/${item.file}`); }
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("livehost_settings", JSON.stringify({ stockSel, overlaySel, voiceId, zoom, offsetX, offsetY, scriptLoop, rundown, volume, speed, badgePos, emotion }));
    } catch {}
  }, [stockSel, overlaySel, voiceId, zoom, offsetX, offsetY, scriptLoop, rundown, volume, speed, badgePos, emotion]);
  useEffect(() => {
    try { localStorage.setItem("livehost_scripts", JSON.stringify(scripts)); } catch {}
  }, [scripts]);
  useEffect(() => {
    try { localStorage.setItem("livehost_products", productKb); } catch {}
  }, [productKb]);

  // Light GPU state poll (all views) so the On/Off buttons reflect reality.
  useEffect(() => {
    gpuAction("status");
    const t = setInterval(() => gpuAction("status"), 60000);
    return () => clearInterval(t);
  }, [gpuAction]);

  // Refresh usage (server sessions + rates) + GPU state when the Usage view is open.
  useEffect(() => {
    if (view !== "usage") return;
    let stop = false;
    const load = () => {
      fetch("/api/livehost/session")
        .then((r) => r.json())
        .then((d) => { if (!stop && d.rates) setUsageData(d); })
        .catch(() => {});
      if (backendRef.current) {
        fetch(`${backendRef.current}/gpu-usage`)
          .then((r) => r.json())
          .then((d) => { if (!stop) { d.error ? setGpuUsageErr(d.error) : (setGpuUsage(d), setGpuUsageErr("")); } })
          .catch((e) => { if (!stop) setGpuUsageErr(String(e?.message || e)); });
      }
    };
    load();
    gpuAction("status");
    const t = setInterval(() => { load(); gpuAction("status"); }, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [view, backend, gpuAction]);

  const pickStock = useCallback((id: string) => {
    setStockSel(id);
    if (!id) return;
    const item = stock.find((s) => s.id === id);
    if (item) {
      setAvatarId(item.id);
      setPreviewUrl(`/avatars/${item.file}`);
    }
  }, [stock]);

  const loadAvatars = useCallback(async () => {
    if (!backendRef.current) return [];
    try {
      const r = await fetch(`${backendRef.current}/avatars`);
      const data = await r.json();
      const av: string[] = data.avatars || [];
      setAvatars(av);
      setBackgrounds(data.backgrounds || []);
      return av;
    } catch (e: any) {
      setError("Server offline — tekan ⏻ On GPU (sedia dalam ~1 minit).");
      return [];
    }
  }, []);

  useEffect(() => { if (backend) loadAvatars(); }, [backend, loadAvatars]);
  useEffect(() => { loadAvatarsRef.current = loadAvatars; }, [loadAvatars]);

  // Register an avatar from an Attachments library image. The image lives
  // on B2 (no CORS) so a server route fetches it + forwards the binary to
  // the GPU backend's /register-avatar.
  const registerAvatarFromAttachment = useCallback(async (url: string) => {
    setUploading(true); setError("");
    setStockSel("");
    setPreviewUrl(url);
    try {
      const r = await fetch("/api/livehost/register-avatar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      await loadAvatars();
      setAvatarId(d.avatar_id as string);
    } catch (e: any) {
      setError(`Avatar register failed: ${e?.message || e}`);
    } finally {
      setUploading(false);
    }
  }, [loadAvatars]);

  // --- Rundown playback driver (pipelined, gapless) -------------------------
  const speakNext = useCallback(() => {
    if (!playingRef.current) return;
    const lib = scriptsRef.current;
    const rd = rundownRef.current;
    let { s, l } = posRef.current;
    let hops = 0;
    while (hops <= rd.length + 1) {
      if (s >= rd.length) {
        if (loopRef.current && rd.length > 0 && hops <= rd.length) { s = 0; l = 0; hops++; continue; }
        setScriptWaiting(true);
        return;
      }
      const sc = lib.find((x) => x.id === rd[s]);
      const lines = sc ? splitSentences(sc.text) : [];
      if (l >= lines.length) { s++; l = 0; hops++; continue; }
      setScriptWaiting(false);
      posRef.current = { s, l: l + 1 };
      const id = "L" + ++sayCounterRef.current;
      pendingSayRef.current.set(id, { s, l });
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") dc.send(JSON.stringify({ kind: "say", text: lines[l], id }));
      return;
    }
    setScriptWaiting(true);
  }, []);

  const startWordSweep = useCallback((durMs: number, elapsedMs = 0) => {
    if (wordTimerRef.current) clearInterval(wordTimerRef.current);
    setWordFrac(durMs > 0 ? Math.min(1, elapsedMs / durMs) : 0);
    if (durMs <= 200) return;
    const t0 = performance.now() - elapsedMs;
    wordTimerRef.current = setInterval(() => {
      const f = (performance.now() - t0) / durMs;
      setWordFrac(Math.min(1, f));
      if (f >= 1 && wordTimerRef.current) { clearInterval(wordTimerRef.current); wordTimerRef.current = null; }
    }, 100);
  }, []);

  const stop = useCallback(() => {
    endSession(); // server records the exact end second
    playingRef.current = false;
    setScriptPlaying(false);
    setScriptPaused(false);
    setScriptWaiting(false);
    if (sayTimerRef.current) { clearTimeout(sayTimerRef.current); sayTimerRef.current = null; }
    if (wordTimerRef.current) { clearInterval(wordTimerRef.current); wordTimerRef.current = null; }
    highlightTimersRef.current.forEach((t) => clearTimeout(t));
    highlightTimersRef.current = [];
    pendingSayRef.current.clear();
    audioEndRef.current = 0;
    setWordFrac(0);
    setPlayPos({ s: -1, l: -1 });
    posRef.current = { s: 0, l: 0 };
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null; dcRef.current = null; remoteStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false); setConnecting(false);
  }, [endSession]);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  const start = useCallback(async () => {
    setError("");
    if (!backendRef.current) { setError(configErr || "Config belum dimuatkan."); return; }
    if (!avatarId) { setError("Pick or upload a face first."); return; }
    setConnecting(true);
    try {
      // Start = stream process only. GPU power is the On GPU / Off GPU buttons.
      let backendUp = false;
      try {
        const ping = await fetch(`${backendRef.current}/avatars`, { signal: AbortSignal.timeout(6000) });
        backendUp = ping.ok;
      } catch {}
      if (!backendUp) {
        throw new Error("GPU belum hidup — tekan '⏻ On GPU' dahulu (sedia dalam ~1 minit).");
      }
      const iceRes = await fetch(`${backendRef.current}/ice-servers`);
      if (!iceRes.ok) throw new Error(`ice-servers ${iceRes.status}`);
      const cfg: IceConfig = await iceRes.json();

      const pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceTransportPolicy: cfg.iceTransportPolicy || "all" });
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        if (pc.connectionState === "connected") {
          setActive(true); setConnecting(false);
          beginSession();
        } else if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
          if (activeRef.current || connectingRef.current) {
            setError("Sambungan terputus — tekan ▶ Start semula.");
            stopRef.current?.();
          }
        }
      };

      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      pc.ontrack = (ev) => {
        remote.addTrack(ev.track);
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = remote;
        v.play().catch(() => {});
        if (ev.track.kind === "audio") {
          v.muted = true;
          try {
            const ctx = audioCtxRef.current || new AudioContext();
            audioCtxRef.current = ctx;
            const src = ctx.createMediaStreamSource(new MediaStream([ev.track]));
            const gain = ctx.createGain();
            gain.gain.value = volume;
            gainRef.current = gain;
            src.connect(gain).connect(ctx.destination);
            ctx.resume().then(() => setSoundBlocked(ctx.state !== "running")).catch(() => setSoundBlocked(true));
          } catch { setSoundBlocked(true); }
        }
      };

      const dc = pc.createDataChannel("control");
      dcRef.current = dc;
      dc.onopen = () => {
        const hasLines = rundownRef.current.some((id) => {
          const sc = scriptsRef.current.find((x) => x.id === id);
          return sc && splitSentences(sc.text).length > 0;
        });
        if (hasLines) {
          playingRef.current = true;
          setScriptPlaying(true);
          posRef.current = { s: 0, l: 0 };
          audioEndRef.current = 0;
          pendingSayRef.current.clear();
          speakNext();
          speakNext();
        }
      };
      dc.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (!m || m.kind !== "say_done") return;
          const durMs = (Number(m.duration) || 0) * 1000;
          const now = performance.now();
          const startAt = Math.max(now, audioEndRef.current);
          audioEndRef.current = startAt + durMs;
          const ent = m.id ? pendingSayRef.current.get(m.id) : undefined;
          if (m.id) pendingSayRef.current.delete(m.id);
          addVoiceChars(Number(m.chars) || 0);
          if (ent && !("chat" in ent) && durMs > 0) {
            const ht = setTimeout(() => {
              if (!playingRef.current) return;
              setPlayPos({ s: ent.s, l: ent.l });
              startWordSweep(durMs);
            }, Math.max(0, startAt - now));
            highlightTimersRef.current.push(ht);
          }
          if (playingRef.current) {
            if (sayTimerRef.current) clearTimeout(sayTimerRef.current);
            sayTimerRef.current = setTimeout(() => speakNext(), Math.max(0, audioEndRef.current - now - LEAD_MS));
          }
        } catch {}
      };

      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.addTransceiver("video", { direction: "recvonly" });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      const offerBody = JSON.stringify({
        engine: { type: "minimax", voice_id: voiceId, system_prompt: buildKbPrompt(productKb), speed, emotion },
        sdp: pc.localDescription!.sdp,
        type: pc.localDescription!.type,
        avatar_id: avatarId,
        background_id: backgrounds.includes("plain_white") ? "plain_white" : (backgrounds[0] || "plain_white"),
      });
      let res = await fetch(`${backendRef.current}/offer`, {
        method: "POST", headers: { "content-type": "application/json" }, body: offerBody,
      });
      if (!res.ok) {
        // renderer may still be warming after a cold boot — one retry
        await new Promise((r) => setTimeout(r, 15000));
        res = await fetch(`${backendRef.current}/offer`, {
          method: "POST", headers: { "content-type": "application/json" }, body: offerBody,
        });
      }
      if (!res.ok) throw new Error(`offer ${res.status}: ${await res.text()}`);
      await pc.setRemoteDescription(await res.json());
      // active flips in onconnectionstatechange when ICE truly connects;
      // guard: if not connected within 25s, fail cleanly so Start can retry.
      setTimeout(() => {
        if (pcRef.current === pc && pc.connectionState !== "connected") {
          setError("Sambungan lambat/gagal — tekan ▶ Start semula.");
          stopRef.current?.();
        }
      }, 25000);
    } catch (e: any) {
      setError(e?.message || String(e));
      stop();
    }
  }, [avatarId, backgrounds, voiceId, stop, speakNext, startWordSweep, buildKbPrompt, productKb, speed, emotion, volume, configErr, addVoiceChars, beginSession]);

  const sendControl = useCallback((payload: object): boolean => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") { dc.send(JSON.stringify(payload)); return true; }
    setError("Not connected — press Start first.");
    return false;
  }, []);

  const pauseRundown = useCallback(() => {
    if (sayTimerRef.current) { clearTimeout(sayTimerRef.current); sayTimerRef.current = null; }
    if (wordTimerRef.current) { clearInterval(wordTimerRef.current); wordTimerRef.current = null; }
    highlightTimersRef.current.forEach((t) => clearTimeout(t));
    highlightTimersRef.current = [];
    pendingSayRef.current.clear();
    playingRef.current = false;
    setScriptPaused(true);
    setWordFrac(0);
    sendControl({ kind: "interrupt" });
    if (playPos.s >= 0 && playPos.l >= 0) posRef.current = { s: playPos.s, l: playPos.l };
  }, [sendControl, playPos]);

  const resumeRundown = useCallback(() => {
    setScriptPaused(false);
    playingRef.current = true;
    setScriptPlaying(true);
    audioEndRef.current = performance.now();
    speakNext();
    speakNext();
  }, [speakNext]);

  const restartRundown = useCallback(() => {
    if (!active) return;
    if (sayTimerRef.current) { clearTimeout(sayTimerRef.current); sayTimerRef.current = null; }
    if (wordTimerRef.current) { clearInterval(wordTimerRef.current); wordTimerRef.current = null; }
    highlightTimersRef.current.forEach((t) => clearTimeout(t));
    highlightTimersRef.current = [];
    pendingSayRef.current.clear();
    setWordFrac(0);
    sendControl({ kind: "interrupt" });
    audioEndRef.current = performance.now();
    playingRef.current = true;
    setScriptPlaying(true);
    setScriptPaused(false);
    setScriptWaiting(false);
    posRef.current = { s: 0, l: 0 };
    setPlayPos({ s: -1, l: -1 });
    speakNext();
    speakNext();
  }, [active, sendControl, speakNext]);

  const addScript = useCallback(() => {
    const id = "s" + Date.now().toString(36);
    setScripts((prev) => [...prev, { id, title: `Script ${prev.length + 1}`, text: "" }]);
  }, []);
  const updateScript = useCallback((id: string, patch: Partial<Script>) => {
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);
  const deleteScript = useCallback((id: string) => {
    setScripts((prev) => prev.filter((s) => s.id !== id));
    setRundown((prev) => prev.filter((x) => x !== id));
  }, []);

  const addToRundown = useCallback((id: string) => {
    if (!id) return;
    setRundown((prev) => [...prev, id]);
    setRundownAdd("");
    if (playingRef.current && scriptWaiting) setTimeout(() => speakNext(), 50);
  }, [scriptWaiting, speakNext]);
  const removeFromRundown = useCallback((idx: number) => {
    if (scriptPlaying && playPos.s >= 0 && idx <= playPos.s) return;
    setRundown((prev) => prev.filter((_, i) => i !== idx));
  }, [scriptPlaying, playPos.s]);
  const moveInRundown = useCallback((idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (scriptPlaying && playPos.s >= 0 && (idx <= playPos.s || j <= playPos.s)) return;
    setRundown((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const u = [...prev];
      [u[idx], u[j]] = [u[j], u[idx]];
      return u;
    });
  }, [scriptPlaying, playPos.s]);

  const sendChat = useCallback(() => {
    const text = chatText.trim(); if (!text) return;
    if (sayTimerRef.current) { clearTimeout(sayTimerRef.current); sayTimerRef.current = null; }
    audioEndRef.current = performance.now();
    sendControl({ kind: "interrupt" });
    const id = "C" + ++sayCounterRef.current;
    pendingSayRef.current.set(id, { chat: true });
    if (sendControl({ kind: "ask", text, id })) { setCaptionText(`💬 ${text}`); setChatText(""); }
  }, [chatText, sendControl]);

  const enableSound = useCallback(() => {
    audioCtxRef.current?.resume().then(() => setSoundBlocked(false)).catch(() => {});
    videoRef.current?.play().catch(() => {});
  }, []);

  useEffect(() => { if (gainRef.current) gainRef.current.gain.value = volume; }, [volume]);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") dc.send(JSON.stringify({ kind: "cfg", text: JSON.stringify({ speed, emotion }) }));
    }, 400);
    return () => clearTimeout(t);
  }, [speed, emotion, active]);

  useEffect(() => {
    if (playPos.l >= 0) lineRefs.current[playPos.l]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [playPos]);

  useEffect(() => () => stop(), [stop]);

  const captionLine = playPos.l >= 0 ? curLines[playPos.l] : captionText;

  return (
    <div className="lh-studio">
      <style dangerouslySetInnerHTML={{ __html: STUDIO_CSS }} />

      {configErr && <div className="error" style={{ margin: "8px 0" }}>{configErr}</div>}

      {/* ============ LIVE VIEW ============ */}
      <div style={{ display: view === "live" ? undefined : "none", height: "100%" }}>
        <div className="grid">
          <div className="panel video-panel">
            <div className="video-wrap">
              <div className="stage" ref={stageRef}
                onPointerDown={onStagePointerDown} onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp} onPointerCancel={onStagePointerUp}>
                <video ref={videoRef} autoPlay playsInline style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})` }} />
                {!active && previewUrl && (
                  <img className="avatar-preview" src={previewUrl} alt="" draggable={false}
                    style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})` }} />
                )}
                {overlayUrl && <img className="overlay" src={overlayUrl} alt="" />}
                {!active && !previewUrl && <div className="placeholder">Pick a host — it will preview here.</div>}
                {active && captions && captionLine && <div className="captions">{captionLine}</div>}
                {/* TikTok AI-content policy: AI-generated content must be
                    labeled on screen — part of the captured frame. Draggable. */}
                <div className="ai-badge" style={{ left: `${badgePos.x}%`, top: `${badgePos.y}%` }}
                  onPointerDown={onBadgePointerDown} onPointerMove={onBadgePointerMove}
                  onPointerUp={onBadgePointerUp} onPointerCancel={onBadgePointerUp}
                  title="Seret untuk ubah kedudukan label">
                  Saya AI Avatar
                </div>
                {active && soundBlocked && (
                  <button className="unmute-btn" onClick={enableSound}>🔇 Tap to enable sound</button>
                )}
                <button className="fs-btn" onClick={toggleFullscreen} title="Fullscreen">⛶</button>
              </div>
            </div>

            <div className="queue-col">
              <div className="label">Rundown — play order</div>
              <div className="queue-list">
                {rundown.map((id, i) => {
                  const sc = scripts.find((x) => x.id === id);
                  const playing = scriptPlaying && playPos.s === i;
                  const done = scriptPlaying && playPos.s >= 0 && i < playPos.s;
                  return (
                    <div key={`${id}-${i}`} className={`queue-item ${playing ? "now" : done ? "done" : ""}`}>
                      <span className="queue-title">{i + 1}. {sc ? sc.title : "(deleted)"}</span>
                      <span className="queue-btns">
                        <button onClick={() => moveInRundown(i, -1)}>↑</button>
                        <button onClick={() => moveInRundown(i, 1)}>↓</button>
                        <button onClick={() => removeFromRundown(i)}>✕</button>
                      </span>
                    </div>
                  );
                })}
                {rundown.length === 0 && <div className="hint">Add scripts (Scripts tab) — they play in this order.</div>}
              </div>
              <select value={rundownAdd} onChange={(e) => addToRundown(e.target.value)}>
                <option value="">➕ Add script to rundown…</option>
                {scripts.map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
              </select>
              <div className="loop-row">
                <button className="restart-btn go" onClick={start} disabled={active || connecting}
                  title="Start streaming (GPU mesti ON dulu)">
                  {connecting ? "…" : "▶ Start"}
                </button>
                <button className="restart-btn" onClick={stop} disabled={!active && !connecting} title="Stop streaming">■ Stop</button>
                <button className="restart-btn" onClick={scriptPaused ? resumeRundown : pauseRundown}
                  disabled={!active || (!scriptPlaying && !scriptPaused)} title="Pause / Resume">
                  {scriptPaused ? "▶" : "⏸"}
                </button>
                <button className="restart-btn" onClick={restartRundown} disabled={!active} title="Restart script">⟳</button>
                <label className="checkbox" style={{ marginTop: 0 }} title="Loop rundown">
                  <input type="checkbox" checked={scriptLoop} onChange={(e) => setScriptLoop(e.target.checked)} style={{ width: "auto" }} />
                  🔁
                </label>
              </div>
              {scriptWaiting && <div className="status-line">⏸ Finished — waiting for more scripts…</div>}
            </div>

            <div className="prompter-col">
              <div className="label">
                Teleprompter{curScript ? ` — ${curScript.title}` : ""}{playPos.l >= 0 ? ` (${playPos.l + 1}/${curLines.length})` : ""}
              </div>
              <div className="prompter">
                {curLines.map((ln, i) => {
                  const isNow = playPos.l === i;
                  const words = isNow ? ln.split(/\s+/) : null;
                  const onCount = words ? Math.round(wordFrac * words.length) : 0;
                  return (
                    <div key={i} ref={(el) => { lineRefs.current[i] = el; }}
                      className={`prompter-line ${isNow ? "now" : playPos.l > i ? "done" : ""}`}>
                      {words
                        ? words.map((w, wi) => (
                            <span key={wi} className={wi < onCount ? "w on" : "w"}>{w} </span>
                          ))
                        : ln}
                    </div>
                  );
                })}
                {curLines.length === 0 && <div className="hint">The current script&apos;s lines appear here and highlight as she speaks.</div>}
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="label">Avatar — pick a host or upload your own</div>
            <select value={stockSel} onChange={(e) => pickStock(e.target.value)}>
              <option value="">— Choose a Malaysian host —</option>
              {stock.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
            </select>
            <button type="button" className="filebtn secondary" disabled={uploading}
              onClick={() => setAvatarPickerOpen(true)}>
              {uploading ? "Processing…" : "🖼 Pick avatar from Attachments"}
            </button>
            <div className="hint">⚠ Guna wajah AI atau wajah anda sendiri sahaja — jangan guna wajah orang lain / selebriti tanpa kebenaran (polisi TikTok).</div>
            {uploading && <div className="status-line">Processing image… detecting face…</div>}
            {!uploading && avatarId && <div className="status-line">✓ Avatar ready — press Start</div>}

            <div className="label">Live template (overlay)</div>
            <select value={customOverlay ? "__custom" : overlaySel} onChange={(e) => { setCustomOverlay(""); setOverlaySel(e.target.value === "__custom" ? "" : e.target.value); }}>
              <option value="">None</option>
              {overlays.map((o) => (<option key={o.file} value={o.file}>{o.label}</option>))}
              {customOverlay && <option value="__custom">Custom (uploaded)</option>}
            </select>
            <button type="button" className="filebtn secondary"
              onClick={() => setOverlayPickerOpen(true)}>
              🖼 Pick template from Attachments
            </button>

            <div className="label">Avatar fit — drag the avatar on screen to move it</div>
            <button type="button" className="filebtn secondary" onClick={() => { setOffsetX(0); setOffsetY(0); setZoom(1); }}>
              ↺ Reset position
            </button>
            <div className="range-row"><span>Zoom</span>
              <input type="range" min="0.5" max="2" step="0.02" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} />
            </div>
            <div className="range-row"><span>Left / Right</span>
              <input type="range" min="-40" max="40" step="1" value={offsetX} onChange={(e) => setOffsetX(parseFloat(e.target.value))} />
            </div>
            <div className="range-row"><span>Up / Down</span>
              <input type="range" min="-40" max="40" step="1" value={offsetY} onChange={(e) => setOffsetY(parseFloat(e.target.value))} />
            </div>

            <div className="label">Voice</div>
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              {VOICES.map((v) => (<option key={v.id} value={v.id}>{v.label}</option>))}
            </select>
            <div className="range-row"><span>Volume {Math.round(volume * 100)}%</span>
              <input type="range" min="0" max="3" step="0.05" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} />
            </div>
            <div className="range-row"><span>Speed {speed.toFixed(2)}×</span>
              <input type="range" min="0.7" max="1.5" step="0.05" value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} />
            </div>
            <div className="range-row"><span>Emosi suara</span>
              <select value={emotion} onChange={(e) => setEmotion(e.target.value)} style={{ flex: 1 }}>
                <option value="fluent">Fluent (natural)</option>
                <option value="happy">Ceria (happy)</option>
                <option value="neutral">Neutral</option>
                <option value="surprised">Teruja (surprised)</option>
                <option value="sad">Lembut (sad)</option>
              </select>
            </div>

            <div className="label">GPU power</div>
            <div className="row" style={{ marginTop: 4 }}>
              <button className="btn-primary" onClick={gpuOn} disabled={serverBusy || serverState === "running"}>
                ⏻ On GPU
              </button>
              <button className="btn-stop" onClick={gpuOff} disabled={serverBusy || serverState === "stopped"}>
                ⏹ Off GPU
              </button>
            </div>
            <div className="hint">Status: <b>{serverState}</b> — auto-off selepas 8 minit tiada aktiviti.</div>
            <div className="hint">📋 Bila Go LIVE di TikTok, AKTIFKAN toggle &quot;AI-generated content&quot; (polisi wajib TikTok Shop).</div>
            <label className="checkbox">
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} style={{ width: "auto" }} />
              Captions
            </label>

            <div className="label">Customer chat — avatar pauses &amp; answers</div>
            <textarea placeholder="Act as a viewer: ask a question…" value={chatText} onChange={(e) => setChatText(e.target.value)} />
            <button className="btn-primary" onClick={sendChat} disabled={!active}>Send chat</button>

            {wakeMsg && <div className="status-line">{wakeMsg}</div>}
            {error && <div className="error">{error}</div>}
            {active && <div className="status-line">● Live</div>}
          </div>
        </div>
      </div>

      {/* ============ SCRIPTS VIEW ============ */}
      <div style={{ display: view === "scripts" ? undefined : "none" }}>
        <div className="panel single">
          <button className="filebtn" onClick={addScript}>➕ New script</button>
          {scripts.length === 0 && <div className="hint">Create scripts here (opening, product 1, closing…), then add them to the Rundown in the Livehost tab.</div>}
          {scripts.map((s) => {
            const inRundown = rundown.includes(s.id);
            return (
              <div key={s.id} className="script-card">
                <div className="script-head">
                  <input value={s.title} onChange={(e) => updateScript(s.id, { title: e.target.value })} />
                  <button onClick={() => addToRundown(s.id)} title="Add to rundown">➕</button>
                  <button onClick={() => deleteScript(s.id)} title="Delete script">🗑</button>
                </div>
                <textarea rows={6} placeholder="Paste the dialog for this script…"
                  value={s.text} onChange={(e) => updateScript(s.id, { text: e.target.value })} />
                <div className="hint">{splitSentences(s.text).length} chunks{inRundown ? " • in rundown" : ""} — edits apply live to parts not yet spoken</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ============ PRODUCTS VIEW ============ */}
      <div style={{ display: view === "products" ? undefined : "none" }}>
        <div className="panel single">
          <div className="label">Product knowledge — used to answer customer chat</div>
          <textarea rows={18} placeholder={"Paste everything about your products:\n\nCompact Powder — RM19.90. Untuk muka berminyak...\nFoundation — RM49.90...\n\nVoucher: RM25 TikTok Live untuk checkout masa live.\nFAQ: COD ada? Ya..."}
            value={productKb} onChange={(e) => setProductKb(e.target.value)} />
          <div className="hint">
            When a viewer chats, the AI answers in casual Bahasa Melayu using ONLY this knowledge.
            Edits apply <b>live</b> — no restart needed. Saved automatically.
          </div>
        </div>
      </div>

      {/* ============ USAGE VIEW ============ */}
      <div style={{ display: view === "usage" ? undefined : "none" }}>
        <div className="panel single">
          <div className="label">💰 Bulan ini — kos streaming anda</div>
          <div className="usage-card">
            {usageData ? (
              <>
                <div className="usage-big">RM {usageData.month.totalCost.toFixed(2)}</div>
                <div className="hint">
                  {Math.floor(usageData.month.streamSec / 3600)}h {Math.floor((usageData.month.streamSec % 3600) / 60)}m streaming
                  (RM {usageData.month.gpuCost.toFixed(2)}) + {usageData.month.voiceChars.toLocaleString()} voice chars
                  (RM {usageData.month.voiceCost.toFixed(2)})
                </div>
                <div className="hint">
                  Kadar: RM {usageData.rates.gpuRateHour}/jam GPU • RM {usageData.rates.voiceRate1k}/1k aksara suara
                </div>
              </>
            ) : (
              <div className="hint">Loading usage…</div>
            )}
          </div>

          <div className="label">📜 Sesi streaming (50 terkini — direkod tepat ke saat)</div>
          <div className="usage-card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="sessions-table">
              <thead>
                <tr><th>Tarikh / Masa</th><th>Durasi</th><th>GPU</th><th>Suara</th><th>Jumlah</th><th>Status</th></tr>
              </thead>
              <tbody>
                {(usageData?.sessions || []).map((s) => (
                  <tr key={s.id}>
                    <td>{new Date(s.startedAt).toLocaleString("ms-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
                    <td>{Math.floor(s.durationSec / 3600)}:{String(Math.floor((s.durationSec % 3600) / 60)).padStart(2, "0")}:{String(s.durationSec % 60).padStart(2, "0")}</td>
                    <td>RM {s.gpuCost.toFixed(2)}</td>
                    <td>RM {s.voiceCost.toFixed(2)}</td>
                    <td><b>RM {s.totalCost.toFixed(2)}</b></td>
                    <td>
                      <span className={`sess-badge ${s.status}`}>
                        {s.status === "active" ? "● LIVE" : s.status === "crashed" ? "crashed" : "ended"}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!usageData || usageData.sessions.length === 0) && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--muted)" }}>Belum ada sesi streaming.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Attachment pickers — avatar + overlay/template now come from the
          PeningLab Attachments library (Portal-rendered, app-styled). */}
      <AttachmentPicker
        open={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        title="Pick avatar from Attachments"
        defaultCategory="avatar"
        onPick={(a) => registerAvatarFromAttachment(a.public_url)}
      />
      <AttachmentPicker
        open={overlayPickerOpen}
        onClose={() => setOverlayPickerOpen(false)}
        title="Pick template / background from Attachments"
        defaultCategory="all"
        onPick={(a) => { setCustomOverlay(a.public_url); setOverlaySel(""); }}
      />
    </div>
  );
}

// All selectors scoped under .lh-studio so nothing leaks into PeningLab styles.
const STUDIO_CSS = `
.lh-studio{--bg:#0b0f1a;--panel:#121829;--panel-2:#0e1320;--border:#1f2740;--text:#e6e9f2;--muted:#8b93a7;--accent:#5b6cff;--accent-2:#3ddc97;--danger:#ff5470;color:var(--text);height:100%;}
.lh-studio *{box-sizing:border-box;}
.lh-studio .grid{display:grid;grid-template-columns:1.9fr 0.7fr;gap:10px;height:calc(100vh - 16px);min-height:540px;}
@media (max-width:1100px){.lh-studio .grid{grid-template-columns:1fr;height:auto;}}
.lh-studio .panel{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;min-height:0;min-width:0;overflow-y:auto;display:flex;flex-direction:column;}
.lh-studio .panel.single{max-width:860px;}
.lh-studio .video-panel{padding:8px;flex-direction:row;gap:10px;overflow:hidden;}
.lh-studio .video-wrap{position:relative;width:auto;flex:none;background:#05070d;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:flex-start;}
.lh-studio .stage{position:relative;height:100%;aspect-ratio:9/16;max-width:100%;max-height:100%;margin:0;border-radius:10px;overflow:hidden;background:#ffffff;cursor:grab;touch-action:none;user-select:none;}
.lh-studio .stage:active{cursor:grabbing;}
.lh-studio .stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center center;}
.lh-studio .stage .overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;}
.lh-studio .stage .avatar-preview{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center center;}
.lh-studio .stage:fullscreen{height:100vh;width:auto;aspect-ratio:9/16;border-radius:0;}
.lh-studio .placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:14px;text-align:center;padding:24px;}
.lh-studio .captions{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);max-width:80%;background:rgba(0,0,0,.7);padding:8px 14px;border-radius:8px;font-size:18px;text-align:center;}
.lh-studio .queue-col{width:220px;flex:none;display:flex;flex-direction:column;min-width:0;min-height:0;}
.lh-studio .prompter-col{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}
.lh-studio .queue-col .label,.lh-studio .prompter-col .label{margin-top:0;}
.lh-studio .queue-col select{margin-top:8px;font-size:12px;}
.lh-studio .queue-list{flex:1;min-height:0;overflow-y:auto;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:6px;}
.lh-studio .queue-item{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:6px 8px;border-radius:6px;font-size:12px;color:var(--text);}
.lh-studio .queue-item.now{background:var(--accent);color:#fff;font-weight:600;}
.lh-studio .queue-item.done{color:#5b6480;}
.lh-studio .queue-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.lh-studio .queue-btns{display:flex;gap:2px;flex-shrink:0;}
.lh-studio .queue-btns button{padding:2px 5px;font-size:11px;background:rgba(255,255,255,.08);color:inherit;border-radius:4px;border:none;cursor:pointer;}
.lh-studio .queue-btns button:hover{background:rgba(255,255,255,.2);}
.lh-studio .loop-row{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:10px;}
.lh-studio .restart-btn{background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px 8px;font-size:12px;cursor:pointer;}
.lh-studio .restart-btn:hover{border-color:var(--accent);}
.lh-studio .restart-btn:disabled{opacity:.5;cursor:not-allowed;}
.lh-studio .restart-btn.go{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:700;}
.lh-studio .prompter{flex:1;min-height:0;overflow-y:auto;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-top:6px;}
.lh-studio .prompter-line{font-size:15px;line-height:1.5;padding:4px 8px;border-radius:6px;color:var(--muted);transition:background .2s,color .2s;}
.lh-studio .prompter-line.done{color:#5b6480;}
.lh-studio .prompter-line.now{color:#fff;background:rgba(91,108,255,.18);border:1px solid var(--accent);font-weight:600;}
.lh-studio .prompter-line.now .w{color:#cfd5e6;transition:color .12s;}
.lh-studio .prompter-line.now .w.on{color:#ffd84d;font-weight:700;}
.lh-studio .ai-badge{position:absolute;z-index:4;background:#ffffff;color:#111;font-size:13px;font-weight:800;letter-spacing:.01em;padding:5px 12px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:move;touch-action:none;user-select:none;}
.lh-studio .unmute-btn{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;border-radius:999px;padding:8px 16px;font-size:14px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.4);z-index:5;border:none;cursor:pointer;}
.lh-studio .fs-btn{position:absolute;bottom:12px;right:12px;width:40px;height:40px;padding:0;border-radius:8px;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;cursor:pointer;}
.lh-studio .fs-btn:hover{background:rgba(0,0,0,.85);}
.lh-studio .label{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px;}
.lh-studio select,.lh-studio input,.lh-studio textarea{width:100%;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit;}
.lh-studio textarea{resize:vertical;min-height:60px;}
.lh-studio button{cursor:pointer;font-family:inherit;}
.lh-studio .btn-primary{background:var(--accent);color:#fff;flex:1;border:none;border-radius:8px;padding:11px 16px;font-size:14px;font-weight:600;}
.lh-studio .btn-stop{background:transparent;border:1px solid var(--danger);color:var(--danger);flex:1;border-radius:8px;padding:11px 16px;font-size:14px;font-weight:600;}
.lh-studio .btn-ghost{background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:11px 16px;}
.lh-studio .btn-primary:disabled,.lh-studio .btn-stop:disabled{opacity:.5;cursor:not-allowed;}
.lh-studio .filebtn{display:block;width:100%;background:var(--accent);color:#fff;border-radius:8px;padding:11px 16px;font-size:14px;font-weight:600;cursor:pointer;text-align:center;border:none;}
.lh-studio .filebtn.secondary{background:var(--panel-2);border:1px solid var(--border);color:var(--text);font-weight:500;font-size:12px;margin-top:8px;}
.lh-studio .row{display:flex;gap:10px;margin-top:12px;}
.lh-studio .range-row{display:flex;align-items:center;gap:10px;margin-top:6px;}
.lh-studio .range-row span{font-size:11px;color:var(--muted);width:80px;flex-shrink:0;}
.lh-studio .range-row input[type="range"]{flex:1;width:auto;padding:0;}
.lh-studio .range-row input[type="number"]{padding:6px 10px;font-size:13px;}
.lh-studio .checkbox{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:var(--muted);}
.lh-studio .hint{font-size:12px;color:var(--muted);margin-top:6px;}
.lh-studio .error{color:var(--danger);font-size:13px;margin-top:8px;word-break:break-word;}
.lh-studio .status-line{font-size:13px;color:var(--accent-2);margin-top:8px;}
.lh-studio .script-card{background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:10px;}
.lh-studio .script-card .script-head{display:flex;gap:6px;margin-bottom:8px;}
.lh-studio .script-card .script-head input{flex:1;font-weight:600;padding:7px 10px;}
.lh-studio .script-card .script-head button{padding:6px 10px;background:rgba(255,255,255,.08);color:var(--text);border-radius:6px;font-size:13px;border:none;}
.lh-studio .script-card .script-head button:hover{background:rgba(255,255,255,.2);}
.lh-studio .script-card textarea{font-size:13px;}
.lh-studio .usage-card{background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:6px;}
.lh-studio .usage-big{font-size:22px;font-weight:700;}
.lh-studio .usage-cost{margin-top:6px;font-size:15px;font-weight:600;color:var(--accent-2);}
.lh-studio .sessions-table{width:100%;border-collapse:collapse;font-size:12px;}
.lh-studio .sessions-table th{background:rgba(255,255,255,.04);color:var(--muted);text-transform:uppercase;font-size:10px;letter-spacing:.05em;padding:8px 10px;text-align:left;}
.lh-studio .sessions-table td{padding:8px 10px;border-top:1px solid var(--border);}
.lh-studio .sess-badge{padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700;}
.lh-studio .sess-badge.active{background:rgba(61,220,151,.15);color:var(--accent-2);}
.lh-studio .sess-badge.ended{background:rgba(255,255,255,.08);color:var(--muted);}
.lh-studio .sess-badge.crashed{background:rgba(255,84,112,.15);color:var(--danger);}
.lh-studio .panel > button{width:100%;margin-top:10px;border:none;}
`;
