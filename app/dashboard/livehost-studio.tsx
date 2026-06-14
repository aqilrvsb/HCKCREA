"use client";

// Livehost studio — ported from github.com/aqilrvsb/talking-head-live.
// One always-mounted component; the `view` prop switches which section is
// visible (live | scripts | products | usage) WITHOUT unmounting, so the
// WebRTC stream survives navigation. Backend URL comes from
// /api/livehost/config (admin-configured per client); GPU power goes through
// /api/livehost/gpu. All CSS is scoped under .lh-studio.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AttachmentPicker from "./sections/attachment-picker";
import { hydrateLivehostState, saveLivehostState, installLivehostStateFlush } from "@/lib/livehost-state";
import { LhSection, LhCard, LhCardHeader, LhLabel, LhButton, LhGrid, LH_FIELD_STYLE, ORANGE } from "./livehost-ui";

export type LiveView = "live" | "scripts" | "products" | "usage" | "template";

type IceConfig = { iceServers: RTCIceServer[]; iceTransportPolicy?: RTCIceTransportPolicy };
type Script = {
  id: string; title: string; text: string;
  // Per-script voice (set when authoring; travels into the rundown).
  voiceId: string; volume: number; speed: number; emotion: string;
  chars?: number;
  audioUrl?: string | null;   // signed URL of the saved (pre-generated) audio
  audioB64?: string | null;   // freshly generated audio held in memory until Save
  saved?: boolean;            // persisted to Supabase (livehost_scripts)
  generating?: boolean;       // Generate request in flight
};

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

// Advertise a high video bitrate ceiling on the offer so the sender (aiortc on
// the GPU box) is allowed to ramp the HD avatar up to ~6 Mbps when the network
// supports it. b=AS is inserted right after the m=video c= line.
function boostOfferBitrate(sdp: string, kbps = 6000): string {
  const lines = sdp.split(/\r\n|\n/);
  const out: string[] = [];
  let inVideo = false;
  for (const line of lines) {
    if (line.startsWith("m=")) inVideo = line.startsWith("m=video");
    out.push(line);
    if (inVideo && line.startsWith("c=")) {
      out.push(`b=AS:${kbps}`);
      out.push(`b=TIAS:${kbps * 1000}`);
    }
  }
  return out.join("\r\n");
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
  const [nameInput, setNameInput] = useState("");
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
    // Use the badge's OWN stage (live or template view) — not the fixed
    // live stageRef, which is zero-size when the Template view is showing.
    const stage = (e.currentTarget.closest(".stage") as HTMLElement | null)?.getBoundingClientRect();
    if (!stage || !stage.width) return;
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
  // Product Knowledge LIBRARY (pick ONE active in the rundown)
  const [products, setProducts] = useState<{ id: string; title: string; text: string }[]>([]);
  const [activeProductId, setActiveProductId] = useState("");
  // Greetings LIBRARY (pick ONE active in the rundown); full config per profile
  type GreetProfile = { id: string; title: string; greetings: string; greetDelayMin: number; greetDelayMax: number; followGreeting: string; likeGreeting: string; commentDelayMin: number; commentDelayMax: number; selectedProduct: string; sfxAuto: boolean };
  const [greetProfiles, setGreetProfiles] = useState<GreetProfile[]>([]);
  const [activeGreetId, setActiveGreetId] = useState("");
  const activeProduct = products.find((x) => x.id === activeProductId);
  const activeKb = activeProduct?.text || "";
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
    rates: { gpuRateHour: number; voiceRate1k: number; audioRateGen: number; currency: string };
    sessions: { id: string; startedAt: string; status: string; durationSec: number; voiceChars: number; gpuCost: number; voiceCost: number; totalCost: number }[];
    month: { streamSec: number; voiceChars: number; gpuCost: number; voiceCost: number; totalCost: number };
    audio: { generations: number; chars: number; cost: number };
    gpu: { streamSec: number; cost: number };
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
      }, 15000); // 15s heartbeat → crash/shutdown loses ≤15s of billing
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
            setError(""); // clear any stale "Server offline"
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
  // Template view = a second copy of the live-host SCREEN + avatar/template/
  // fit controls. Shares ALL state with the live view (so composing here =
  // what streams), but needs its own stage/video refs to avoid ref clashes
  // since both views are always mounted.
  const templateStageRef = useRef<HTMLDivElement | null>(null);
  const templateVideoRef = useRef<HTMLVideoElement | null>(null);

  const overlayUrl = customOverlay || (overlaySel ? `/overlays/${overlaySel}` : "");

  // Mirror the live stream onto the Template-view video so the screen there
  // matches the live host while streaming.
  useEffect(() => {
    const v = templateVideoRef.current;
    if (!v) return;
    if (active && remoteStreamRef.current) {
      v.srcObject = remoteStreamRef.current;
      v.play().catch(() => {});
    } else {
      v.srcObject = null;
    }
  }, [active]);

  useEffect(() => { scriptsRef.current = scripts; }, [scripts]);
  useEffect(() => { rundownRef.current = rundown; }, [rundown]);
  useEffect(() => { loopRef.current = scriptLoop; }, [scriptLoop]);

  const curScript = useMemo(() => {
    const id = rundown[playPos.s >= 0 ? playPos.s : 0];
    return scripts.find((s) => s.id === id) || null;
  }, [scripts, rundown, playPos.s]);
  const curLines = useMemo(() => {
    if (!curScript) return [];
    // A pre-generated clip plays as ONE unit → show the whole script as a single
    // teleprompter block so the word-sweep tallies across the entire text + audio.
    if (curScript.audioUrl) return [curScript.text];
    return splitSentences(curScript.text);
  }, [curScript]);

  const buildKbPrompt = useCallback((kb: string) => {
    const base =
      "You are a friendly, energetic Malaysian live-commerce host on TikTok Live. " +
      "A viewer sent a chat message. Reply in casual Bahasa Melayu, ONE or TWO short " +
      "spoken sentences, warm and persuasive, no emojis or symbols. " +
      "RECAP FIRST: the message format is 'Penonton bernama \"NAME\" komen: \"...\"'. " +
      "Always begin your reply by naming the viewer and briefly restating what they " +
      "said (e.g. 'Aqil tanya berapa harga ye…', 'Terima kasih Aqil sebab dah beli…', " +
      "'Best la tu Lisa…'), THEN answer. Never repeat the literal format text. " +
      "COMPLIANCE (TikTok policy): never claim to be a doctor, pharmacist, or any " +
      "professional; never promise medical cures, miracle or instant results; never " +
      "exaggerate product efficacy beyond the provided knowledge; quote only the " +
      "prices given. If asked for medical advice, suggest consulting a professional. " +
      "If the message starts with [FOKUS PRODUK: X], prioritise product X in your answer.";
    return kb.trim()
      ? `${base}\n\nAnswer using ONLY this product knowledge. If the answer is not in it, ` +
        `politely say you will check and remind them about the voucher.\n\nPRODUCT KNOWLEDGE:\n${kb.trim()}`
      : base;
  }, []);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const dc = dcRef.current;
      if (dc && dc.readyState === "open") dc.send(JSON.stringify({ kind: "kb", text: buildKbPrompt(activeKb) }));
    }, 800);
    return () => clearTimeout(t);
  }, [activeKb, active, buildKbPrompt]);

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

  // ---- Saved templates (composition history) ----
  // A saved template snapshots the WHOLE composition: which overlay (Canva
  // PNG), which avatar, and the avatar-fit + badge position. No per-object
  // editing — the design itself is made in Canva and imported as the overlay.
  type SavedTpl = {
    id: string; name: string; createdAt: number;
    overlaySel: string; customOverlay: string; overlayUrl: string;
    previewUrl: string; stockSel: string; avatarId: string;
    zoom: number; offsetX: number; offsetY: number;
    badgePos: { x: number; y: number };
  };
  const [savedTemplates, setSavedTemplates] = useState<SavedTpl[]>([]);
  const [savedPickerOpen, setSavedPickerOpen] = useState(false);
  // Flips true once the DB→localStorage hydrate + initial read finishes, so the
  // save effects never PUT (or clobber the cache) with pre-load empty state.
  const hydratedRef = useRef(false);
  // (savedTemplates load from localStorage inside the main hydrate effect below,
  // AFTER the DB pull — so they come from the DB on a fresh device.)
  const persistTemplates = useCallback((list: SavedTpl[]) => {
    setSavedTemplates(list);
    try { localStorage.setItem("livehost_saved_templates", JSON.stringify(list)); } catch {}
    saveLivehostState();
  }, []);
  const saveCurrentTemplate = useCallback(() => {
    const name = window.prompt("Nama template:", `Template ${savedTemplates.length + 1}`);
    if (!name) return;
    persistTemplates([
      ...savedTemplates,
      {
        id: "tpl" + Date.now().toString(36), name, createdAt: Date.now(),
        overlaySel, customOverlay, overlayUrl, previewUrl, stockSel, avatarId,
        zoom, offsetX, offsetY, badgePos,
      },
    ]);
  }, [savedTemplates, persistTemplates, overlaySel, customOverlay, overlayUrl, previewUrl, stockSel, avatarId, zoom, offsetX, offsetY, badgePos]);
  const loadTemplate = useCallback((t: SavedTpl) => {
    setOverlaySel(t.overlaySel); setCustomOverlay(t.customOverlay);
    setStockSel(t.stockSel); setAvatarId(t.avatarId); setPreviewUrl(t.previewUrl);
    setZoom(t.zoom); setOffsetX(t.offsetX); setOffsetY(t.offsetY);
    setBadgePos(t.badgePos || { x: 4, y: 10 });
  }, []);
  const deleteTemplate = useCallback((id: string) => {
    if (!window.confirm("Padam template ini?")) return;
    persistTemplates(savedTemplates.filter((t) => t.id !== id));
  }, [savedTemplates, persistTemplates]);

  // Flush pending DB saves when the tab is hidden / unloaded.
  useEffect(() => installLivehostStateFlush(), []);

  // Restore persisted state — DB FIRST (source of truth), then read the
  // now-synced localStorage cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateLivehostState();
      if (cancelled) return;
    let saved: any = {};
    try { saved = JSON.parse(localStorage.getItem("livehost_settings") || "{}"); } catch {}
    try {
      const rawT = localStorage.getItem("livehost_saved_templates");
      if (rawT) setSavedTemplates(JSON.parse(rawT));
    } catch {}
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
    // Saved scripts (per-script voice + pre-generated audio) live in Supabase now.
    fetch("/api/livehost/scripts").then((r) => r.json()).then((d) => {
      if (Array.isArray(d?.scripts)) {
        const list: Script[] = d.scripts.map((s: any) => ({
          id: s.id, title: s.title, text: s.text,
          voiceId: s.voiceId || VOICES[0].id, volume: s.volume ?? 1.5, speed: s.speed ?? 1.0, emotion: s.emotion || "fluent",
          chars: s.chars, audioUrl: s.audioUrl || null, saved: true,
        }));
        setScripts(list); scriptsRef.current = list;
      }
    }).catch(() => {});
    try {
      const lib = JSON.parse(localStorage.getItem("livehost_products_lib") || "[]");
      if (Array.isArray(lib) && lib.length) {
        setProducts(lib);
        setActiveProductId(localStorage.getItem("livehost_active_product") || lib[0].id);
      } else {
        // migrate the old single KB, if any
        const oldKb = localStorage.getItem("livehost_products");
        const seed = [{ id: "p1", title: "Produk 1", text: oldKb || "" }];
        setProducts(seed); setActiveProductId("p1");
      }
      const glib = JSON.parse(localStorage.getItem("livehost_greet_lib") || "[]");
      if (Array.isArray(glib) && glib.length) {
        setGreetProfiles(glib);
        setActiveGreetId(localStorage.getItem("livehost_active_greet") || glib[0].id);
      }
    } catch {}
    fetch("/overlays/manifest.json").then((r) => r.json()).then(setOverlays).catch(() => {});
    fetch("/avatars/manifest.json").then((r) => r.json()).then((list) => {
      setStock(list);
      if (saved.stockSel) {
        const item = (list as { id: string; file: string }[]).find((s) => s.id === saved.stockSel);
        if (item) { setStockSel(item.id); setAvatarId(item.id); setPreviewUrl(`/avatars/${item.file}`); }
      }
    }).catch(() => {});
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem("livehost_settings", JSON.stringify({ stockSel, overlaySel, voiceId, zoom, offsetX, offsetY, scriptLoop, rundown, volume, speed, badgePos, emotion }));
    } catch {}
    saveLivehostState();
  }, [stockSel, overlaySel, voiceId, zoom, offsetX, offsetY, scriptLoop, rundown, volume, speed, badgePos, emotion]);
  // (Scripts persist to Supabase via /api/livehost/scripts — no localStorage copy.)
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem("livehost_products_lib", JSON.stringify(products));
      localStorage.setItem("livehost_active_product", activeProductId);
    } catch {}
    saveLivehostState();
  }, [products, activeProductId]);
  useEffect(() => {
    if (!hydratedRef.current) return;
    try { localStorage.setItem("livehost_active_greet", activeGreetId); } catch {}
    saveLivehostState();
  }, [activeGreetId]);
  // Re-read the greeting library (edited in the Greetings tab) when returning
  // to the Live view, so the dropdown reflects the latest profiles.
  useEffect(() => {
    if (view !== "live") return;
    try {
      const glib = JSON.parse(localStorage.getItem("livehost_greet_lib") || "[]");
      if (Array.isArray(glib)) {
        setGreetProfiles(glib);
        const act = localStorage.getItem("livehost_active_greet") || (glib[0]?.id || "");
        setActiveGreetId((cur) => (glib.some((g: any) => g.id === cur) ? cur : act));
      }
    } catch {}
  }, [view]);

  // GPU LIFECYCLE: pre-warm on entering the Live view + keep alive (ping the
  // box /keepalive) while the Live view is open OR streaming, so the watchdog
  // never stops it under the host. Leaving the tab (and not streaming) lets the
  // 8-min watchdog stop it normally.
  useEffect(() => {
    const keep = view === "live" || active;
    if (!keep) return;
    // pre-warm: if backend isn't up, start the GPU in the background
    (async () => {
      try {
        const ping = await fetch(`${backendRef.current}/avatars`, { signal: AbortSignal.timeout(5000) });
        if (!ping.ok) throw new Error();
      } catch {
        fetch("/api/livehost/gpu", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        }).catch(() => {});
        setServerState("starting");
      }
    })();
    // Stream → keep alive forever. Tab open but NOT streaming → keep warm max
    // 15 min, then stop so the box watchdog sleeps it (protects margin).
    let warmPings = 0;
    const MAX_WARM = 15;
    const ping = () => {
      if (!activeRef.current) {
        if (++warmPings > MAX_WARM) return; // stop warming → box sleeps ~8 min later
      } else warmPings = 0;
      if (backendRef.current) fetch(`${backendRef.current}/keepalive`, { method: "POST" }).catch(() => {});
    };
    ping();
    const t = setInterval(ping, 60000);
    return () => clearInterval(t);
  }, [view, active]);

  // Sync the active greeting profile to the DB so the extension uses it.
  useEffect(() => {
    const g = greetProfiles.find((x) => x.id === activeGreetId);
    if (!g) return;
    const t = setTimeout(() => {
      const { id, title, ...config } = g;
      fetch("/api/livehost/greet-config", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ config }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [greetProfiles, activeGreetId]);

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
      // GPU asleep is normal — ▶ Start will wake it. Don't show a scary error.
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
      // Saved script with pre-generated audio → play the whole clip as ONE unit
      // (avatar lip-syncs to the exact audio you approved; no live TTS / billing).
      if (sc && sc.audioUrl && l === 0) {
        setScriptWaiting(false);
        posRef.current = { s: s + 1, l: 0 }; // next hop → next script
        const id = "L" + ++sayCounterRef.current;
        pendingSayRef.current.set(id, { s, l: 0 });
        const dc = dcRef.current;
        if (dc && dc.readyState === "open") dc.send(JSON.stringify({ kind: "sayaudio", url: sc.audioUrl, id }));
        return;
      }
      // Fallback: any script without saved audio → live TTS, line by line.
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
      // Start ONLY connects the stream — it does NOT manage GPU power. The GPU
      // is pre-warmed when the Livehost tab opens and never auto-stops, so it's
      // already up. We just wait for the backend to answer, then connect.
      let backendUp = false;
      for (let i = 0; i < 42 && !backendUp; i++) {
        try {
          const ping = await fetch(`${backendRef.current}/avatars`, { signal: AbortSignal.timeout(5000) });
          if (ping.ok) backendUp = true;
        } catch {}
        if (!backendUp) {
          setWakeMsg(`Menyambung ke avatar… ${i * 5}s ⏳`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      if (!backendUp) { setWakeMsg(""); throw new Error("Avatar tak sedia — cuba ▶ Start sekali lagi."); }
      loadAvatarsRef.current?.();
      setWakeMsg("");
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
        // Give the browser a small jitter buffer so playback is smooth even if
        // frames arrive slightly unevenly over the TURN relay (~150ms added
        // latency — fine for a one-way live broadcast, kills micro-stutter).
        try {
          const r: any = ev.receiver;
          if (r) {
            if ("playoutDelayHint" in r) r.playoutDelayHint = 0.3;
            if ("jitterBufferTarget" in r) r.jitterBufferTarget = 300;
          }
        } catch {}
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
          const ent = m.id ? pendingSayRef.current.get(m.id) : undefined;
          if (m.id) pendingSayRef.current.delete(m.id);
          // `barge` is set by the box for any comment/chat reply (studio OR
          // extension OR real TikTok DOM); `ent.chat` covers studio-originated
          // ones whose id we still hold. Either means a barge-in happened.
          const isChat = (!!ent && "chat" in ent) || m.barge === true;
          // A chat/comment answer barges in and DISCARDS all buffered script
          // audio. The old projected timeline is now void, so rebase to "now" —
          // otherwise the script resumes only after the discarded audio's
          // duration elapses (several seconds of dead air). With the rebase the
          // next line is requested immediately / prefetched so it flows on.
          const startAt = isChat ? now : Math.max(now, audioEndRef.current);
          audioEndRef.current = startAt + durMs;
          addVoiceChars(Number(m.chars) || 0);
          if (ent && !isChat && durMs > 0) {
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
      const vTr = pc.addTransceiver("video", { direction: "recvonly" });
      // Prefer H.264 over VP8: VP8 software-encoding a full-screen 1080p face
      // collapses to a few fps and bursts huge frames (packet loss → freezes).
      // H.264 (libx264 ultrafast / NVENC on the box) holds a smooth 25fps.
      try {
        const caps = (RTCRtpReceiver as any).getCapabilities?.("video");
        if (caps?.codecs && vTr.setCodecPreferences) {
          const h264 = caps.codecs.filter((c: any) => /h264/i.test(c.mimeType));
          const rest = caps.codecs.filter((c: any) => !/h264/i.test(c.mimeType));
          if (h264.length) vTr.setCodecPreferences([...h264, ...rest]);
        }
      } catch {}

      const offer = await pc.createOffer();
      if (offer.sdp) offer.sdp = boostOfferBitrate(offer.sdp);
      await pc.setLocalDescription(offer);
      await waitForIceGatheringComplete(pc);

      // Serverless workers are EPHEMERAL: after a cold start the renderer only
      // has the baked default avatars. Register the selected avatar on the worker
      // BEFORE /offer, otherwise process-audio-v3 returns 404 (unknown avatar_id)
      // and the avatar renders but can't speak. Retries while the renderer warms.
      if (avatarId && previewUrl) {
        setWakeMsg("Menyediakan avatar… ⏳");
        for (let a = 0; a < 8; a++) {
          try {
            const avs = await fetch(`${backendRef.current}/avatars`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
            if (Array.isArray(avs?.avatars) && avs.avatars.includes(avatarId)) break;
            const img = await fetch(previewUrl).then((r) => r.blob());
            // avatar_id in the PATH (not query) — the serverless ingress strips
            // query params on POST, which made every avatar register as "custom".
            const rr = await fetch(`${backendRef.current}/register-avatar/${encodeURIComponent(avatarId)}`, {
              method: "POST", body: img, headers: { "content-type": img.type || "image/png" },
            });
            if (rr.ok) break;
          } catch { /* renderer still warming — retry */ }
          await new Promise((r) => setTimeout(r, 8000));
        }
        setWakeMsg("");
      }

      const offerBody = JSON.stringify({
        engine: { type: "minimax", voice_id: voiceId, system_prompt: buildKbPrompt(activeKb), speed, emotion },
        sdp: pc.localDescription!.sdp,
        type: pc.localDescription!.type,
        avatar_id: avatarId,
        background_id: backgrounds.includes("plain_white") ? "plain_white" : (backgrounds[0] || "plain_white"),
      });
      // Robust offer: the renderer may still be warming the first few seconds
      // after a cold boot. Retry up to 6× (~90s) with a fresh SDP each time so
      // a slightly-slow renderer never surfaces an error to the client.
      let res: Response | null = null;
      for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
          setWakeMsg("Menyambung ke avatar… ⏳");
          await new Promise((r) => setTimeout(r, 15000));
        }
        try {
          res = await fetch(`${backendRef.current}/offer`, {
            method: "POST", headers: { "content-type": "application/json" }, body: offerBody,
          });
          if (res.ok) break;
        } catch { res = null; }
      }
      setWakeMsg("");
      if (!res || !res.ok) throw new Error("Avatar tak sedia lagi — tekan ▶ Start sekali lagi.");
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
  }, [avatarId, backgrounds, voiceId, stop, speakNext, startWordSweep, buildKbPrompt, activeKb, speed, emotion, volume, configErr, addVoiceChars, beginSession]);

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

  const addProduct = useCallback(() => {
    const id = "p" + Date.now().toString(36);
    setProducts((prev) => [...prev, { id, title: `Produk ${prev.length + 1}`, text: "" }]);
    setActiveProductId(id);
  }, []);
  const updateProduct = useCallback((id: string, patch: Partial<{ title: string; text: string }>) => {
    setProducts((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);
  const deleteProduct = useCallback((id: string) => {
    setProducts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const addScript = useCallback(() => {
    const id = "s" + Date.now().toString(36);
    setScripts((prev) => [
      { id, title: `Script ${prev.length + 1}`, text: "", voiceId: VOICES[0].id, volume: 3.0, speed: 1.0, emotion: "fluent", saved: false },
      ...prev,
    ]);
  }, []);
  const updateScript = useCallback((id: string, patch: Partial<Script>) => {
    // Changing content/voice invalidates the saved/generated audio.
    const dirties = ["text", "voiceId", "volume", "speed", "emotion"].some((k) => k in patch);
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, ...(dirties ? { saved: false, audioB64: null, audioUrl: null } : {}) } : s)));
  }, []);
  const deleteScript = useCallback((id: string) => {
    const sc = scriptsRef.current.find((s) => s.id === id);
    if (sc?.saved) fetch(`/api/livehost/scripts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setScripts((prev) => prev.filter((s) => s.id !== id));
    setRundown((prev) => prev.filter((x) => x !== id));
  }, []);

  // ---- Per-script audio: Generate (preview, billable) + Save (persist) + Play ----
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewPlayId, setPreviewPlayId] = useState<string | null>(null);
  const [previewFrac, setPreviewFrac] = useState(0); // 0–1 progress → teleprompter sweep

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
    setPreviewPlayId(null); setPreviewFrac(0);
  }, []);
  const playPreview = useCallback((id: string, src: string) => {
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
    const a = new Audio(src);
    previewAudioRef.current = a;
    setPreviewPlayId(id); setPreviewFrac(0);
    a.ontimeupdate = () => { if (a.duration) setPreviewFrac(Math.min(1, a.currentTime / a.duration)); };
    a.onended = () => { setPreviewPlayId(null); setPreviewFrac(1); previewAudioRef.current = null; };
    a.play().catch(() => setPreviewPlayId(null));
  }, []);

  const generateScript = useCallback(async (id: string) => {
    const sc = scriptsRef.current.find((s) => s.id === id);
    if (!sc || !sc.text.trim()) { alert("Tulis skrip dulu."); return; }
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, generating: true } : s)));
    try {
      const r = await fetch("/api/livehost/script-generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: sc.text, voice_id: sc.voiceId, volume: sc.volume, speed: sc.speed, emotion: sc.emotion, script_id: sc.saved ? sc.id : null }),
      });
      const d = await r.json();
      if (!r.ok || !d?.audio_b64) throw new Error(d?.error || "Generate gagal");
      setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, generating: false, audioB64: d.audio_b64, chars: d.chars, saved: false, audioUrl: null } : s)));
      playPreview(id, `data:audio/mpeg;base64,${d.audio_b64}`);
    } catch (e: any) {
      setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, generating: false } : s)));
      alert("Generate gagal: " + (e?.message || e));
    }
  }, [playPreview]);

  const saveScript = useCallback(async (id: string) => {
    const sc = scriptsRef.current.find((s) => s.id === id);
    if (!sc) return;
    if (!sc.audioB64) { alert("Generate audio dulu sebelum simpan."); return; }
    try {
      const r = await fetch("/api/livehost/scripts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: sc.title, text: sc.text, voice_id: sc.voiceId, volume: sc.volume, speed: sc.speed, emotion: sc.emotion, chars: sc.chars || sc.text.length, audio_b64: sc.audioB64 }),
      });
      const d = await r.json();
      if (!r.ok || !d?.id) throw new Error(d?.error || "Simpan gagal");
      // Swap the draft id for the persisted Supabase id; keep rundown refs in sync.
      setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, id: d.id, saved: true, audioUrl: d.audioUrl, audioB64: null } : s)));
      setRundown((prev) => prev.map((x) => (x === id ? d.id : x)));
    } catch (e: any) {
      alert("Simpan gagal: " + (e?.message || e));
    }
  }, []);

  const playSaved = useCallback((id: string) => {
    if (previewPlayId === id) { stopPreview(); return; }
    const sc = scriptsRef.current.find((s) => s.id === id);
    const src = sc?.audioUrl || (sc?.audioB64 ? `data:audio/mpeg;base64,${sc.audioB64}` : null);
    if (src) playPreview(id, src);
  }, [previewPlayId, stopPreview, playPreview]);

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

  // SFX (bell/clap) — played in the page so OBS tab/window capture picks it up.
  const simRotateRef = useRef(0);
  const playSfx = useCallback((name: "bell" | "clap") => {
    try {
      const a = new Audio(`/sfx/${name}.mp3`);
      a.volume = 1;
      a.play().catch(() => {});
    } catch {}
  }, []);

  // Make the avatar speak a greeting/reply. NO upfront interrupt — the GPU
  // engine keeps the script talking and barges in only when the reply audio is
  // ready (prepare-then-swap), so there is no silent gap.
  const speakNow = useCallback((kind: "say" | "ask", text: string) => {
    if (!text.trim()) return false;
    const id = "C" + ++sayCounterRef.current;
    pendingSayRef.current.set(id, { chat: true });
    return sendControl({ kind, text, id });
  }, [sendControl]);

  // Simulation — IDENTICAL logic to the extension:
  //   "Ali JOIN" / "Siti FOLLOW" / "Abu LIKE"  → greeting (rotate active profile)
  //   "Mira: berapa harga?" / plain text       → avatar reply (focus product)
  //   purchase keyword → 🔔 bell ; feedback keyword → 👏 clap after reply
  const PURCHASE_RE = /\b(done|dah\s*beli|sudah\s*beli|checkout|dah\s*order|ordered?|dah\s*bayar)\b/i;
  const FEEDBACK_RE = /\b(best|sedap|berkesan|terbaik|memang\s*bagus|puas\s*hati|recommended)\b/i;
  const sendChat = useCallback(() => {
    const t = chatText.trim(); if (!t) return;
    const g = greetProfiles.find((x) => x.id === activeGreetId);
    const clean = (u: string) => u.replace(/[*_~`]/g, "").trim().slice(0, 40);
    const name = clean(nameInput) || "Penonton";
    // komen field can be a plain comment OR a JOIN/FOLLOW/LIKE keyword
    const kw = t.match(/^(JOIN|FOLLOW|LIKE)$/i);
    if (kw && g) {
      const k = kw[1].toUpperCase();
      let line = "";
      if (k === "FOLLOW") { line = g.followGreeting; playSfx("clap"); }
      else if (k === "LIKE") line = g.likeGreeting;
      else {
        const lines = (g.greetings || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
        if (lines.length) { line = lines[simRotateRef.current % lines.length]; simRotateRef.current++; }
      }
      if (line) speakNow("say", line.replaceAll("[username]", name));
      setCaptionText(`👋 ${name} ${k}`);
    } else {
      const isPurchase = PURCHASE_RE.test(t);
      const isFeedback = !isPurchase && FEEDBACK_RE.test(t);
      if (isPurchase) playSfx("bell");
      const focus = g?.selectedProduct ? `[FOKUS PRODUK: ${g.selectedProduct}] ` : "";
      // Recap who commented: the avatar names the viewer, then answers.
      speakNow("ask", `${focus}Penonton bernama "${name}" komen: "${t}". Sebut nama dia dulu, kemudian jawab.`);
      if (isFeedback) setTimeout(() => playSfx("clap"), 4000);
      setCaptionText(`💬 ${name}: ${t}`);
    }
    setChatText("");
  }, [chatText, nameInput, greetProfiles, activeGreetId, speakNow, playSfx]);

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
              <div className="label">📦 Product Knowledge</div>
              <select value={activeProductId} onChange={(e) => setActiveProductId(e.target.value)}>
                {products.length === 0 && <option value="">— Tiada (tab Products) —</option>}
                {products.map((pp) => (<option key={pp.id} value={pp.id}>{pp.title}</option>))}
              </select>

              <div className="label" style={{ marginTop: 10 }}>👋 Greetings</div>
              <select value={activeGreetId} onChange={(e) => setActiveGreetId(e.target.value)}>
                {greetProfiles.length === 0 && <option value="">— Tiada (tab Greetings) —</option>}
                {greetProfiles.map((g) => (<option key={g.id} value={g.id}>{g.title}</option>))}
              </select>

              <div className="label" style={{ marginTop: 10 }}>📜 Scripts — play order</div>
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
                {/* Only SAVED scripts (with bundled audio) can go in the rundown. */}
                {scripts.filter((s) => s.saved && s.audioUrl).map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
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
              {/* Status / error line — GPU wake + connection feedback on Start */}
              <div className="rundown-status">
                {wakeMsg && <div className="status-line">{wakeMsg}</div>}
                {error && <div className="error">{error}</div>}
                {!wakeMsg && !error && active && <div className="status-line">● Live · GPU {serverState}</div>}
                {!wakeMsg && !error && !active && <div className="hint">GPU: {serverState} · tekan ▶ Start</div>}
                {scriptWaiting && <div className="status-line">⏸ Selesai — tunggu skrip lagi…</div>}
              </div>
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
            <div className="label">Model LiveHost</div>
            <button type="button" className="filebtn secondary" style={{ marginTop: 0 }}
              onClick={() => setSavedPickerOpen(true)}>
              📁 Pick from saved templates ({savedTemplates.length})
            </button>
            <div className="hint">Susun avatar + template di tab <b>Template</b>, simpan, kemudian pilih di sini untuk live.</div>

            <div className="hint" style={{ marginTop: 6 }}>🎙 Suara, volume, speed &amp; emosi kini <b>per-skrip</b> — set semasa cipta skrip di tab <b>Scripts</b>. Setiap skrip main dengan audio &amp; suaranya sendiri.</div>

            <div className="label">🎮 Simulation — avatar pauses &amp; answers</div>
            <div className="sim-row">
              <input className="sim-name" placeholder="Nama penonton (cth: Aqil)" value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }} disabled={!active} />
            </div>
            <div className="sim-row">
              <input placeholder='komen | JOIN / FOLLOW / LIKE' value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }} disabled={!active} />
              <button className="sim-send" onClick={sendChat} disabled={!active}>Send</button>
            </div>
            <div className="hint">Avatar akan sebut nama dulu, kemudian jawab komen. Sama macam komen TikTok sebenar:</div>
            <table className="sim-guide">
              <thead><tr><th>Nama</th><th>Komen</th><th>Apa jadi</th></tr></thead>
              <tbody>
                <tr><td>Ali</td><td>JOIN</td><td>Avatar greeting ("Selamat datang Ali!") → GREETED</td></tr>
                <tr><td>Siti</td><td>FOLLOW</td><td>👏 clap + greeting follow → FOLLOWS</td></tr>
                <tr><td>Abu</td><td>LIKE</td><td>Avatar greeting like → LIKES</td></tr>
                <tr><td>Mira</td><td>berapa harga?</td><td>"Mira tanya berapa harga…" → reply guna Product Knowledge → SEEN/REPLIED</td></tr>
                <tr><td>Aqil</td><td>dah beli powder</td><td>🔔 bell + "Terima kasih Aqil…" → BELI</td></tr>
                <tr><td>Lisa</td><td>best sangat!</td><td>Avatar recap + reply, kemudian 👏 clap (feedback)</td></tr>
              </tbody>
            </table>

          </div>
        </div>
      </div>

      {/* ============ TEMPLATE VIEW ============ */}
      {/* 100% copy of the live-host SCREEN + avatar / template / fit controls.
          Shares state with the live view, so composing here is exactly what
          streams in the Livehost tab. */}
      <div style={{ display: view === "template" ? undefined : "none", height: "100%", overflowY: "auto" }}>
        <div className="grid" style={{ gridTemplateColumns: "2.3fr 0.7fr" }}>
          <div className="panel video-panel" style={{ justifyContent: "center" }}>
            <div className="video-wrap">
              <div className="stage" ref={templateStageRef}
                onPointerDown={onStagePointerDown} onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp} onPointerCancel={onStagePointerUp}>
                <video ref={templateVideoRef} autoPlay playsInline style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})` }} />
                {!active && previewUrl && (
                  <img className="avatar-preview" src={previewUrl} alt="" draggable={false}
                    style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})` }} />
                )}
                {overlayUrl && <img className="overlay" src={overlayUrl} alt="" />}
                <div className="ai-badge" style={{ left: `${badgePos.x}%`, top: `${badgePos.y}%` }}
                  onPointerDown={onBadgePointerDown} onPointerMove={onBadgePointerMove}
                  onPointerUp={onBadgePointerUp} onPointerCancel={onBadgePointerUp}
                  title="Seret untuk ubah kedudukan label">
                  Saya AI Avatar
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
              <div className="label">Avatar — pick from Attachments (host default tersedia)</div>
              <button type="button" className="filebtn secondary" style={{ marginTop: 0 }} disabled={uploading}
                onClick={() => setAvatarPickerOpen(true)}>
                {uploading ? "Processing…" : "🖼 Pick avatar from Attachments"}
              </button>
              <div className="hint">⚠ Guna wajah AI / wajah sendiri sahaja (polisi TikTok).</div>
              {uploading && <div className="status-line">Processing image… detecting face…</div>}
              {!uploading && avatarId && <div className="status-line">✓ Avatar ready — press Start</div>}

              <div className="label">Live template (overlay) — pick from Attachments</div>
              <div style={{ display: "flex", gap: 8, marginTop: 0 }}>
                <button type="button" className="filebtn secondary" style={{ flex: 1, marginTop: 0 }}
                  onClick={() => setOverlayPickerOpen(true)}>
                  🖼 Attachment
                </button>
                <a href="https://canva.link/bharu9s46qqbzvv" target="_blank" rel="noreferrer"
                  className="filebtn secondary" style={{ flex: 1, marginTop: 0, textAlign: "center" }}>
                  📐 Canva
                </a>
              </div>
              <div className="hint">Edit di Canva → Download <b>PNG</b> (✅ Transparent) → upload <b>Attachment</b> → tekan <b>🖼 Attachment</b>.</div>

              <div className="label">Avatar fit — drag the avatar on screen to move it</div>
              <button type="button" className="filebtn secondary" onClick={() => { setOffsetX(0); setOffsetY(0); setZoom(1); }}>
                ↺ Reset position
              </button>
              <div className="range-row"><span>Zoom</span>
                <input type="range" min="0.5" max="2" step="0.02" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} />
              </div>

              <button type="button" className="filebtn" style={{ marginTop: 14 }} onClick={saveCurrentTemplate}>
                💾 Save current as template
              </button>
          </div>
        </div>

        {/* Saved templates — composition history grid */}
        <div className="panel single" style={{ margin: "14px 4px 4px" }}>
          <div className="label">📁 Saved templates ({savedTemplates.length})</div>
          {savedTemplates.length === 0 ? (
            <div className="hint">Belum ada template disimpan. Susun avatar + overlay (template Canva) + kedudukan, kemudian tekan 💾 <b>Save current as template</b>.</div>
          ) : (
            <div className="tpl-grid">
              {savedTemplates.map((t) => (
                <div key={t.id} className="tpl-saved-card">
                  <button type="button" className="tpl-preview" onClick={() => loadTemplate(t)} title="Klik untuk muat semula template ini">
                    {t.previewUrl && <img className="tpl-prev-avatar" src={t.previewUrl} alt=""
                      style={{ transform: `translate(${t.offsetX}%, ${t.offsetY}%) scale(${t.zoom})` }} />}
                    {t.overlayUrl && <img className="tpl-prev-overlay" src={t.overlayUrl} alt="" />}
                    {!t.previewUrl && !t.overlayUrl && <span className="hint">—</span>}
                  </button>
                  <div className="tpl-saved-meta">
                    <span title={t.name}>{t.name}</span>
                    <button type="button" className="tpl-del-btn" title="Padam" onClick={() => deleteTemplate(t.id)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============ SCRIPTS VIEW — author + voice + generate + save + history ============ */}
      <div style={{ display: view === "scripts" ? undefined : "none" }}>
        <LhSection>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-extrabold text-xl tracking-tight" style={{ color: "#1a1a1a" }}>Scripts</h2>
              <p className="text-xs mt-0.5" style={{ color: "#888" }}>Tulis skrip → pilih suara → Generate → Save → tambah ke Rundown.</p>
            </div>
            <LhButton onClick={addScript}>➕ New script</LhButton>
          </div>

          {scripts.length === 0 && (
            <LhCard><p className="text-sm" style={{ color: "#888" }}>Tulis skrip → pilih suara/volume/speed/emosi → <b>Generate</b> (dengar dulu) → <b>Save</b>. Skrip tersimpan boleh ditambah ke Rundown di tab Livehost.</p></LhCard>
          )}

          {scripts.map((s) => {
            const inRundown = rundown.includes(s.id);
            const words = s.text.split(/\s+/).filter(Boolean);
            const onCount = previewPlayId === s.id ? Math.round(previewFrac * words.length) : -1;
            const hasAudio = !!(s.audioUrl || s.audioB64);
            return (
              <LhCard key={s.id} borderColor={s.saved ? "#16a34a" : ORANGE}>
                <div className="flex items-center gap-2 mb-3">
                  <input style={{ ...LH_FIELD_STYLE, fontWeight: 800 }} value={s.title} onChange={(e) => updateScript(s.id, { title: e.target.value })} />
                  {s.saved && <span className="text-[11px] font-extrabold whitespace-nowrap" style={{ color: "#16a34a" }}>● saved</span>}
                  <LhButton variant="ghost" onClick={() => addToRundown(s.id)} disabled={!s.saved} style={{ padding: "9px 12px" }}>➕</LhButton>
                  <LhButton variant="ghost" onClick={() => deleteScript(s.id)} style={{ padding: "9px 12px", color: "#e23", background: "#fff0f0", border: "1px solid #f3c0c0" }}>🗑</LhButton>
                </div>
                <textarea style={{ ...LH_FIELD_STYLE, minHeight: 110, resize: "vertical" }} rows={5} placeholder="Tulis dialog skrip di sini…"
                  value={s.text} onChange={(e) => updateScript(s.id, { text: e.target.value })} />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                  <div><LhLabel>Suara</LhLabel>
                    <select style={LH_FIELD_STYLE} value={s.voiceId} onChange={(e) => updateScript(s.id, { voiceId: e.target.value })}>
                      {VOICES.map((v) => (<option key={v.id} value={v.id}>{v.label}</option>))}
                    </select>
                  </div>
                  <div><LhLabel>Emosi suara</LhLabel>
                    <select style={LH_FIELD_STYLE} value={s.emotion} onChange={(e) => updateScript(s.id, { emotion: e.target.value })}>
                      <option value="fluent">Fluent (natural)</option>
                      <option value="happy">Ceria (happy)</option>
                      <option value="neutral">Neutral</option>
                      <option value="surprised">Teruja (surprised)</option>
                      <option value="sad">Lembut (sad)</option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3" style={{ color: "#555", fontSize: 12 }}>
                  <span style={{ width: 120 }}>Volume {Math.round(s.volume * 100)}%</span>
                  <input type="range" min="0" max="3" step="0.05" value={s.volume} onChange={(e) => updateScript(s.id, { volume: parseFloat(e.target.value) })} style={{ flex: 1, accentColor: "#f59e0b" }} />
                </div>
                <div className="flex items-center gap-2 mt-2" style={{ color: "#555", fontSize: 12 }}>
                  <span style={{ width: 120 }}>Speed {s.speed.toFixed(2)}×</span>
                  <input type="range" min="0.7" max="1.5" step="0.05" value={s.speed} onChange={(e) => updateScript(s.id, { speed: parseFloat(e.target.value) })} style={{ flex: 1, accentColor: "#f59e0b" }} />
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  <LhButton onClick={() => generateScript(s.id)} disabled={s.generating || !s.text.trim()}>{s.generating ? "⏳ Generating…" : "🎙 Generate"}</LhButton>
                  <LhButton variant="ghost" onClick={() => playSaved(s.id)} disabled={!hasAudio}>{previewPlayId === s.id ? "■ Stop" : "▶ Play"}</LhButton>
                  <LhButton variant="ghost" onClick={() => saveScript(s.id)} disabled={!s.audioB64 || s.saved}>💾 {s.saved ? "Saved" : "Save"}</LhButton>
                </div>

                {previewPlayId === s.id && (
                  <div style={{ marginTop: 12, maxHeight: 140, overflowY: "auto", background: "#fafaf7", border: "1px solid #e8e0d8", borderRadius: 10, padding: 12, fontSize: 15, lineHeight: 1.6 }}>
                    {words.map((w, wi) => (<span key={wi} style={{ color: wi < onCount ? "#f59e0b" : "#1a1a1a", fontWeight: wi < onCount ? 800 : 500 }}>{w} </span>))}
                  </div>
                )}
                <p className="text-[11px] mt-2" style={{ color: "#888" }}>
                  {(s.chars ?? s.text.length)} aksara{inRundown ? " • dalam rundown" : ""}
                  {hasAudio ? " • 🔊 audio siap" : " • belum generate"}
                  {!s.saved && hasAudio ? " — tekan Save" : ""}
                </p>
              </LhCard>
            );
          })}
        </LhSection>
      </div>

      {/* ============ PRODUCTS VIEW (library) ============ */}
      <div style={{ display: view === "products" ? undefined : "none" }}>
        <LhSection>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-extrabold text-xl tracking-tight" style={{ color: "#1a1a1a" }}>Knowledge</h2>
              <p className="text-xs mt-0.5" style={{ color: "#888" }}>AI jawab chat guna HANYA knowledge yang aktif. Edit apply live.</p>
            </div>
            <LhButton onClick={addProduct}>➕ Knowledge baru</LhButton>
          </div>

          {activeProduct ? (
            <LhCard borderColor={ORANGE}>
              <LhCardHeader icon="📦" title="Knowledge" right={<span className="text-[11px] font-extrabold" style={{ color: "#16a34a" }}>● AKTIF</span>} />
              <LhLabel>Tajuk</LhLabel>
              <input style={LH_FIELD_STYLE} value={activeProduct.title} onChange={(e) => updateProduct(activeProduct.id, { title: e.target.value })} />
              <div style={{ marginTop: 14 }}><LhLabel>Knowledge — avatar guna untuk jawab</LhLabel></div>
              <textarea style={{ ...LH_FIELD_STYLE, minHeight: 230, resize: "vertical" }} rows={12}
                placeholder={"Compact Powder — RM19.90...\nFoundation — RM49.90...\nVoucher: RM25 checkout masa live."}
                value={activeProduct.text} onChange={(e) => updateProduct(activeProduct.id, { text: e.target.value })} />
              <p className="text-[11px] mt-2" style={{ color: "#888" }}>Knowledge ini sedang <b>aktif</b> — digunakan oleh avatar masa live. Disimpan automatik.</p>
            </LhCard>
          ) : (
            <LhCard><p className="text-sm" style={{ color: "#888" }}>Tiada knowledge lagi. Tekan ➕ Knowledge baru untuk mula.</p></LhCard>
          )}

          <LhCard>
            <LhCardHeader icon="📁" title={`Semua Knowledge (${products.length})`} />
            <LhGrid>
              {products.map((pp) => {
                const isActive = pp.id === activeProductId;
                return (
                  <div key={pp.id} onClick={() => setActiveProductId(pp.id)} title="Klik untuk edit / jadikan aktif"
                    style={{ position: "relative", cursor: "pointer", borderRadius: 14, padding: "12px 14px", minHeight: 92,
                      background: isActive ? "#fff7ed" : "#fafaf7", border: `1px solid ${isActive ? ORANGE : "#e8e0d8"}`,
                      ...(isActive ? { boxShadow: `0 0 0 1px ${ORANGE}` } : {}) }}>
                    <button type="button" title="Padam" onClick={(e) => { e.stopPropagation(); deleteProduct(pp.id); }}
                      style={{ position: "absolute", top: 8, right: 8, border: "1px solid #f3c0c0", background: "#fff0f0", color: "#e23", borderRadius: 8, padding: "3px 7px", fontSize: 11, cursor: "pointer" }}>🗑</button>
                    <div style={{ fontWeight: 800, fontSize: 13, paddingRight: 30, color: "#1a1a1a" }}>{pp.title || "Tanpa tajuk"}</div>
                    {isActive && <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: "#16a34a", marginTop: 2 }}>● aktif</div>}
                    <div style={{ fontSize: 11, color: "#888", marginTop: 4, lineHeight: 1.4, whiteSpace: "pre-wrap", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{pp.text || "Kosong…"}</div>
                  </div>
                );
              })}
            </LhGrid>
          </LhCard>
        </LhSection>
      </div>

      {/* ============ USAGE VIEW ============ */}
      <div style={{ display: view === "usage" ? undefined : "none" }}>
        <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-2 py-2">
          {/* Stats summary — radial-glow cards (match the main Usage tab).
              NOTE: inline-style grid (NOT className="grid") — the studio's
              own `.lh-studio .grid` rule would otherwise force 100vh height
              + 1.9fr/0.7fr columns and stretch these cards. */}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {[
              { label: "Jumlah kos", value: usageData ? `RM ${usageData.month.totalCost.toFixed(2)}` : "—", suffix: "bulan ini", glow: "rgba(139,92,246,0.12)", cls: "text-violet-500" },
              { label: "Audio", value: usageData ? String(usageData.audio.generations) : "—", suffix: "generate suara", glow: "rgba(59,130,246,0.12)", cls: "text-blue-500" },
              { label: "GPU live", value: usageData ? `${Math.floor(usageData.gpu.streamSec / 3600)}h ${Math.floor((usageData.gpu.streamSec % 3600) / 60)}m` : "—", suffix: "masa live", glow: "rgba(236,72,153,0.12)", cls: "text-pink-500" },
              { label: "Sesi", value: usageData ? String(usageData.sessions.length) : "—", suffix: "streaming", glow: "rgba(245,158,11,0.12)", cls: "text-amber-500" },
            ].map((s, i) => (
              <div key={i} className="card relative overflow-hidden">
                <div className="absolute" style={{ top: -30, right: -30, width: 100, height: 100, borderRadius: "50%", background: `radial-gradient(circle, ${s.glow}, transparent 70%)` }} />
                <div className="relative">
                  <div className="text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold mb-2">{s.label}</div>
                  <div className={`font-display font-extrabold text-3xl tracking-tight ${s.cls}`}>{s.value}</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-1">{s.suffix}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Rate breakdown — small print under the cards */}
          {usageData && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--color-text-muted)] px-1">
              <span>🎙 Audio: RM {usageData.audio.cost.toFixed(2)} · {usageData.audio.chars.toLocaleString()} aksara · RM {usageData.rates.audioRateGen.toFixed(2)}/generate</span>
              <span>🖥 GPU: RM {usageData.gpu.cost.toFixed(2)} · RM {usageData.rates.gpuRateHour.toFixed(2)}/jam</span>
            </div>
          )}

          {/* Sessions table card */}
          <div className="card p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold">Sesi streaming</span>
              <span className="ml-auto text-xs text-[var(--color-text-muted)]">50 terkini · direkod tepat ke saat</span>
            </div>
            <div className="hidden md:flex px-6 py-3 border-b border-[var(--color-border)] text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold" style={{ background: "rgba(200,245,62,0.04)" }}>
              <span className="flex-1">Tarikh / Masa</span>
              <span className="w-28">Durasi</span>
              <span className="w-28 text-right">Jumlah Kos</span>
              <span className="w-24 text-right">Status</span>
            </div>
            {(!usageData || usageData.sessions.length === 0) ? (
              <div className="px-6 py-16 text-center">
                <p className="text-[var(--color-text-secondary)] font-medium mb-1">{usageData ? "Belum ada sesi streaming." : "Loading…"}</p>
                <p className="text-sm text-[var(--color-text-muted)]">Setiap sesi live anda akan direkod di sini.</p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {usageData.sessions.map((s) => (
                  <li key={s.id} className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-1.5 md:gap-3 text-sm">
                    <span className="flex-1 font-mono text-xs text-[var(--color-text-secondary)]">{new Date(s.startedAt).toLocaleString("ms-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="w-28 font-mono text-xs text-[var(--color-text-primary)]">{Math.floor(s.durationSec / 3600)}:{String(Math.floor((s.durationSec % 3600) / 60)).padStart(2, "0")}:{String(s.durationSec % 60).padStart(2, "0")}</span>
                    <span className="w-28 md:text-right text-xs font-bold text-emerald-500">RM {s.totalCost.toFixed(2)}</span>
                    <span className="w-24 md:text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                        style={s.status === "active"
                          ? { background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }
                          : s.status === "crashed"
                            ? { background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }
                            : { background: "var(--color-bg-card)", color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}>
                        {s.status === "active" ? "● LIVE" : s.status === "crashed" ? "crashed" : "ended"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
        categories={["avatar"]}
        presets={stock.map((s) => ({ id: `stock:${s.id}`, name: s.label, public_url: `/avatars/${s.file}`, category: "avatar" as const }))}
        onPick={(a) => {
          // Default hosts are PRE-REGISTERED on the GPU (avatar_id = stock id),
          // so use pickStock directly; user uploads go through registration.
          if (a.id.startsWith("stock:")) pickStock(a.id.slice("stock:".length));
          else registerAvatarFromAttachment(a.public_url);
        }}
      />
      <AttachmentPicker
        open={overlayPickerOpen}
        onClose={() => setOverlayPickerOpen(false)}
        title="Pick template / background from Attachments"
        defaultCategory="product"
        categories={["product"]}
        productLabel="Template"
        presets={overlays.map((o) => ({ id: `ovl:${o.file}`, name: o.label, public_url: `/overlays/${o.file}`, category: "product" as const }))}
        onPick={(a) => {
          if (a.id.startsWith("ovl:")) { setOverlaySel(a.id.slice("ovl:".length)); setCustomOverlay(""); }
          else { setCustomOverlay(a.public_url); setOverlaySel(""); }
        }}
      />

      {/* Saved-templates picker (Livehost tab) — pick a full composition
          (avatar + template + position + zoom) saved from the Template tab. */}
      {savedPickerOpen && (
        <div onClick={() => setSavedPickerOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 780, maxHeight: "85vh", overflowY: "auto", background: "#0a0a0c", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="label" style={{ margin: 0 }}>📁 Pick from saved templates</div>
              <button className="restart-btn" onClick={() => setSavedPickerOpen(false)}>✕</button>
            </div>
            {savedTemplates.length === 0 ? (
              <div className="hint" style={{ marginTop: 12 }}>Belum ada template disimpan. Pergi tab <b>Template</b> untuk susun avatar + template, kemudian <b>💾 Save</b>.</div>
            ) : (
              <div className="tpl-grid">
                {savedTemplates.map((t) => (
                  <div key={t.id} className="tpl-saved-card">
                    <button type="button" className="tpl-preview" title="Pilih template ini"
                      onClick={() => { loadTemplate(t); setSavedPickerOpen(false); }}>
                      {t.previewUrl && <img className="tpl-prev-avatar" src={t.previewUrl} alt=""
                        style={{ transform: `translate(${t.offsetX}%, ${t.offsetY}%) scale(${t.zoom})` }} />}
                      {t.overlayUrl && <img className="tpl-prev-overlay" src={t.overlayUrl} alt="" />}
                      {!t.previewUrl && !t.overlayUrl && <span className="hint">—</span>}
                    </button>
                    <div className="tpl-saved-meta"><span title={t.name}>{t.name}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// All selectors scoped under .lh-studio so nothing leaks into PeningLab styles.
const STUDIO_CSS = `
.lh-studio{--bg:#0a0a0c;--panel:rgba(255,255,255,.028);--panel-2:rgba(255,255,255,.02);--border-s:rgba(255,255,255,.09);--text:#f3f4f8;--muted:#9aa0b0;--accent:#6366f1;--accent-2:#34d399;--cyan:#22d3ee;--amber:#fbbf24;--pink:#f472b6;--violet:#a78bfa;--danger:#fb5d76;--grad:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);color:var(--text);height:100%;background:var(--bg);border-radius:18px;}
.lh-studio *{box-sizing:border-box;}
.lh-studio .grid{display:grid;grid-template-columns:1.9fr 0.7fr;gap:12px;height:calc(100vh - 16px);min-height:540px;padding:4px;}
@media (max-width:1100px){.lh-studio .grid{grid-template-columns:1fr;height:auto;min-height:0;}}
.lh-studio .panel{background:var(--panel);border:1px solid var(--border-s);border-radius:18px;padding:16px;min-height:0;min-width:0;overflow-y:auto;display:flex;flex-direction:column;box-shadow:0 18px 44px -22px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.04);}
.lh-studio .panel.single{max-width:none;width:100%;}
.lh-studio .video-panel{padding:8px;flex-direction:row;gap:10px;overflow:hidden;background:rgba(255,255,255,.02);}
@media (max-width:1100px){.lh-studio .video-panel{flex-direction:column;}}
.lh-studio .video-wrap{position:relative;width:auto;flex:none;background:#000;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:flex-start;box-shadow:0 0 0 1px rgba(255,255,255,.08),0 18px 50px -22px rgba(0,0,0,.9);}
@media (max-width:1100px){.lh-studio .video-wrap{width:100%;justify-content:center;}.lh-studio .stage{height:auto;width:100%;max-width:340px;}}
.lh-studio .stage{position:relative;height:100%;aspect-ratio:9/16;max-width:100%;max-height:100%;margin:0;border-radius:12px;overflow:hidden;background:#ffffff;cursor:grab;touch-action:none;user-select:none;}
.lh-studio .stage:active{cursor:grabbing;}
.lh-studio .stage video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center center;}
.lh-studio .stage .overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;}
.lh-studio .stage .avatar-preview{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center center;}
.lh-studio .stage:fullscreen{height:100vh;width:auto;aspect-ratio:9/16;border-radius:0;}
.lh-studio .placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7596;font-size:14px;text-align:center;padding:24px;}
.lh-studio .captions{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);max-width:80%;background:rgba(0,0,0,.72);padding:8px 14px;border-radius:10px;font-size:18px;text-align:center;backdrop-filter:blur(4px);}
.lh-studio .queue-col{width:230px;flex:none;display:flex;flex-direction:column;min-width:0;min-height:0;}
.lh-studio .prompter-col{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}
.lh-studio .queue-col .label,.lh-studio .prompter-col .label{margin-top:0;}
.lh-studio .queue-col select{margin-top:8px;font-size:12px;}
.lh-studio .queue-list{flex:1;min-height:0;overflow-y:auto;background:rgba(0,0,0,.32);border:1px solid var(--border-s);border-radius:12px;padding:6px;}
.lh-studio .queue-item{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:7px 9px;border-radius:9px;font-size:12px;color:var(--text);transition:background .15s;}
.lh-studio .queue-item:hover{background:rgba(99,102,241,.1);}
.lh-studio .queue-item.now{background:var(--grad);color:#fff;font-weight:700;box-shadow:0 6px 16px -6px rgba(99,102,241,.7);}
.lh-studio .queue-item.done{color:#5b6480;}
.lh-studio .queue-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.lh-studio .queue-btns{display:flex;gap:2px;flex-shrink:0;}
.lh-studio .queue-btns button{padding:2px 5px;font-size:11px;background:rgba(255,255,255,.1);color:inherit;border-radius:5px;border:none;cursor:pointer;}
.lh-studio .queue-btns button:hover{background:rgba(255,255,255,.24);}
.lh-studio .loop-row{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:10px;}
.lh-studio .restart-btn{background:rgba(255,255,255,.05);border:1px solid var(--border-s);color:var(--text);border-radius:9px;padding:7px 9px;font-size:12px;cursor:pointer;transition:all .15s;}
.lh-studio .restart-btn:hover{border-color:var(--accent);background:rgba(99,102,241,.14);transform:translateY(-1px);}
.lh-studio .restart-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;}
.lh-studio .restart-btn.go{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border-color:transparent;font-weight:800;box-shadow:0 8px 18px -8px rgba(34,197,94,.7);}
.lh-studio .prompter{flex:1;min-height:0;overflow-y:auto;background:rgba(0,0,0,.32);border:1px solid var(--border-s);border-radius:12px;padding:10px 12px;margin-top:6px;}
.lh-studio .prompter-line{font-size:15px;line-height:1.5;padding:5px 9px;border-radius:8px;color:var(--muted);transition:background .2s,color .2s;}
.lh-studio .prompter-line.done{color:#5b6480;}
.lh-studio .prompter-line.now{color:#fff;background:linear-gradient(135deg,rgba(99,102,241,.28),rgba(139,92,246,.22));border:1px solid rgba(129,140,248,.6);font-weight:600;box-shadow:0 6px 20px -8px rgba(99,102,241,.6);}
.lh-studio .prompter-line.now .w{color:#cfd5e6;transition:color .12s;}
.lh-studio .prompter-line.now .w.on{color:var(--amber);font-weight:700;}
.lh-studio .ai-badge{position:absolute;z-index:4;background:#ffffff;color:#111;font-size:13px;font-weight:800;letter-spacing:.01em;padding:5px 12px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:move;touch-action:none;user-select:none;}
.lh-studio .unmute-btn{position:absolute;top:12px;left:50%;transform:translateX(-50%);background:var(--grad);color:#fff;border-radius:999px;padding:8px 16px;font-size:14px;font-weight:700;box-shadow:0 8px 22px -6px rgba(99,102,241,.8);z-index:5;border:none;cursor:pointer;}
.lh-studio .fs-btn{position:absolute;bottom:12px;right:12px;width:40px;height:40px;padding:0;border-radius:10px;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:20px;line-height:1;cursor:pointer;backdrop-filter:blur(4px);}
.lh-studio .fs-btn:hover{background:rgba(0,0,0,.85);}
.lh-studio .tpl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px;}
.lh-studio .tpl-saved-card{background:rgba(255,255,255,.03);border:1px solid var(--border-s);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;}
.lh-studio .tpl-preview{position:relative;aspect-ratio:9/16;width:100%;padding:0;border:0;background:#ffffff;display:flex;align-items:center;justify-content:center;cursor:pointer;overflow:hidden;}
.lh-studio .tpl-prev-avatar{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center center;}
.lh-studio .tpl-prev-overlay{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;}
.lh-studio .tpl-preview:hover{outline:2px solid var(--accent-2);outline-offset:-2px;}
.lh-studio .tpl-saved-meta{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:8px 10px;font-size:12px;font-weight:700;}
.lh-studio .tpl-saved-meta>span{flex:1;min-width:0;white-space:normal;word-break:break-word;line-height:1.3;}
.lh-studio .tpl-del-btn{flex-shrink:0;background:rgba(251,93,118,.14);border:1px solid var(--danger);color:#ff8298;border-radius:9px;padding:6px 9px;font-size:12px;cursor:pointer;transition:all .15s;}
.lh-studio .tpl-del-btn:hover{background:var(--danger);color:#fff;}
/* Library tabs (Knowledge / Greetings) — image-tab-style header + history grid */
.lh-studio .lib-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
.lh-studio .lib-title{font-size:20px;font-weight:800;letter-spacing:-.01em;margin:0;}
.lh-studio .lib-sub{font-size:12px;color:var(--muted);margin:2px 0 0;}
.lh-studio .lib-head .filebtn{width:auto;}
.lh-studio .lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:12px;}
.lh-studio .lib-card{position:relative;background:rgba(255,255,255,.03);border:1px solid var(--border-s);border-radius:14px;padding:13px 14px;cursor:pointer;transition:all .15s;min-height:96px;display:flex;flex-direction:column;gap:6px;}
.lh-studio .lib-card:hover{border-color:rgba(99,102,241,.5);transform:translateY(-1px);}
.lh-studio .lib-card.active{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 12px 30px -16px rgba(99,102,241,.85);background:rgba(99,102,241,.08);}
.lh-studio .lib-card-title{font-weight:800;font-size:14px;padding-right:34px;word-break:break-word;}
.lh-studio .lib-card-preview{font-size:11.5px;color:var(--muted);line-height:1.4;white-space:pre-wrap;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;}
.lh-studio .lib-badge{display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--accent-2);}
.lh-studio .lib-card .tpl-del-btn{position:absolute;top:10px;right:10px;padding:4px 7px;font-size:11px;}
.lh-studio .label{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:800;color:#a9b4d6;margin:10px 0 5px;display:flex;align-items:center;gap:6px;}
.lh-studio .label::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--grad);box-shadow:0 0 8px rgba(99,102,241,.8);flex:none;}
.lh-studio select,.lh-studio input,.lh-studio textarea{width:100%;background:rgba(0,0,0,.4);border:1px solid var(--border-s);color:var(--text);border-radius:10px;padding:8px 11px;font-size:13px;font-family:inherit;transition:border-color .15s,box-shadow .15s;}
.lh-studio select:focus,.lh-studio input:focus,.lh-studio textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(99,102,241,.25);}
.lh-studio textarea{resize:vertical;min-height:60px;}
.lh-studio button{cursor:pointer;font-family:inherit;}
.lh-studio .btn-primary{background:var(--grad);color:#fff;flex:1;border:none;border-radius:10px;padding:11px 16px;font-size:14px;font-weight:700;box-shadow:0 10px 24px -10px rgba(99,102,241,.8);transition:transform .15s,box-shadow .15s;}
.lh-studio .btn-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 14px 30px -10px rgba(99,102,241,.9);}
.lh-studio .btn-stop{background:rgba(251,93,118,.1);border:1px solid var(--danger);color:#ff8298;flex:1;border-radius:10px;padding:11px 16px;font-size:14px;font-weight:700;}
.lh-studio .btn-ghost{background:rgba(255,255,255,.05);border:1px solid var(--border-s);color:var(--text);border-radius:10px;padding:11px 16px;}
.lh-studio .btn-primary:disabled,.lh-studio .btn-stop:disabled{opacity:.5;cursor:not-allowed;transform:none;}
.lh-studio .filebtn{display:block;width:100%;background:var(--grad);color:#fff;border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;text-align:center;border:none;box-shadow:0 10px 24px -10px rgba(99,102,241,.7);}
.lh-studio .filebtn.secondary{background:rgba(255,255,255,.05);border:1px solid var(--border-s);color:#c7d0ec;font-weight:600;font-size:11.5px;margin-top:6px;box-shadow:none;}
.lh-studio .filebtn.secondary:hover{border-color:var(--accent);background:rgba(99,102,241,.12);}
.lh-studio .row{display:flex;gap:10px;margin-top:8px;}
.lh-studio .range-row{display:flex;align-items:center;gap:10px;margin-top:8px;}
.lh-studio .range-row span{font-size:11px;color:var(--muted);width:80px;flex-shrink:0;}
.lh-studio .range-row input[type="range"]{flex:1;width:auto;padding:0;accent-color:var(--accent);}
.lh-studio .range-row input[type="number"]{padding:6px 10px;font-size:13px;}
.lh-studio .checkbox{display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:var(--muted);}
.lh-studio .checkbox input{accent-color:var(--accent);}
.lh-studio .hint{font-size:11px;color:var(--muted);margin-top:4px;line-height:1.45;}
.lh-studio .error{color:#ff8298;font-size:13px;margin-top:8px;word-break:break-word;background:rgba(251,93,118,.1);border:1px solid rgba(251,93,118,.3);border-radius:8px;padding:8px 10px;}
.lh-studio .status-line{font-size:13px;color:var(--accent-2);margin-top:8px;font-weight:600;}
.lh-studio .script-card{background:rgba(0,0,0,.3);border:1px solid var(--border-s);border-radius:12px;padding:11px;margin-top:10px;transition:border-color .15s;}
.lh-studio .script-card:hover{border-color:rgba(99,102,241,.5);}
.lh-studio .script-card .script-head{display:flex;gap:6px;margin-bottom:8px;}
.lh-studio .script-card .script-head input{flex:1;font-weight:600;padding:7px 10px;}
.lh-studio .script-card .script-head button{padding:6px 10px;background:rgba(255,255,255,.08);color:var(--text);border-radius:8px;font-size:13px;border:none;}
.lh-studio .script-card .script-head button:hover{background:rgba(255,255,255,.2);}
.lh-studio .script-card textarea{font-size:13px;}
.lh-studio .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-top:12px;}
.lh-studio .usage-card{background:rgba(255,255,255,.028);border:1px solid var(--border-s);border-radius:14px;padding:13px;margin-top:6px;transition:transform .15s,border-color .15s,box-shadow .15s;}
.lh-studio .stat-tile{cursor:default;}
.lh-studio .stat-tile:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.22);box-shadow:0 14px 30px -16px rgba(0,0,0,.8);}
.lh-studio .usage-big{font-size:24px;font-weight:800;letter-spacing:-.02em;}
.lh-studio .usage-cost{margin-top:6px;font-size:15px;font-weight:700;color:var(--accent-2);}
.lh-studio .rundown-status{margin-top:8px;padding-top:8px;border-top:1px solid var(--border-s);max-height:90px;overflow-y:auto;}
.lh-studio .rundown-status .error{font-size:12px;}
.lh-studio .sim-row{display:flex;gap:8px;margin-top:6px;}
.lh-studio .sim-row input{flex:1;}
.lh-studio .sim-name{background:rgba(34,197,94,.06);border-color:rgba(34,197,94,.35)!important;}
.lh-studio .sim-send{width:84px;border:none;border-radius:10px;font-size:13px;font-weight:800;color:#fff;cursor:pointer;background:linear-gradient(135deg,#fb8c00,#ffa726);box-shadow:0 8px 18px -8px rgba(251,140,0,.7);}
.lh-studio .sim-send:disabled{opacity:.5;cursor:not-allowed;}
.lh-studio .sim-guide{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px;}
.lh-studio .sim-guide th{text-align:left;color:var(--muted);text-transform:uppercase;font-size:9px;letter-spacing:.4px;padding:4px 8px;background:rgba(99,102,241,.08);}
.lh-studio .sim-guide td{padding:6px 8px;border-top:1px solid var(--border-s);vertical-align:top;}
.lh-studio .sim-guide td:first-child{white-space:nowrap;color:var(--text);font-weight:600;}
.lh-studio .sessions-table{width:100%;border-collapse:collapse;font-size:12px;}
.lh-studio .sessions-table th{background:rgba(99,102,241,.1);color:#b9c2e4;text-transform:uppercase;font-size:10px;letter-spacing:.05em;padding:9px 10px;text-align:left;}
.lh-studio .sessions-table td{padding:9px 10px;border-top:1px solid var(--border-s);}
.lh-studio .sessions-table tbody tr:hover{background:rgba(99,102,241,.06);}
.lh-studio .sess-badge{padding:3px 9px;border-radius:999px;font-size:10px;font-weight:800;}
.lh-studio .sess-badge.active{background:rgba(52,211,153,.18);color:var(--accent-2);box-shadow:0 0 0 1px rgba(52,211,153,.3);}
.lh-studio .sess-badge.ended{background:rgba(255,255,255,.08);color:var(--muted);}
.lh-studio .sess-badge.crashed{background:rgba(251,93,118,.18);color:#ff8298;}
.lh-studio .panel > button{width:100%;margin-top:10px;border:none;}
`;
