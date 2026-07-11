"use client";

// Livehost studio — ported from github.com/aqilrvsb/talking-head-live.
// One always-mounted component; the `view` prop switches which section is
// visible (live | scripts | products | usage) WITHOUT unmounting, so the
// WebRTC stream survives navigation. Backend URL comes from
// /api/livehost/config (admin-configured per client); GPU power goes through
// /api/livehost/gpu. All CSS is scoped under .lh-studio.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AttachmentPicker from "./sections/attachment-picker";
import LivehostGpu from "./sections/livehost-gpu";
import { hydrateLivehostState, saveLivehostState, installLivehostStateFlush } from "@/lib/livehost-state";
import { confirmDelete } from "@/lib/confirm";
import { LhSection, LhCard, LhCardHeader, LhLabel, LhButton, LhGrid, LhModal, LH_FIELD_STYLE, ORANGE } from "./livehost-ui";

export type LiveView = "live" | "scripts" | "products" | "usage" | "template";

// mm:ss for the audio seek bar.
function fmtAudioTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

type IceConfig = { iceServers: RTCIceServer[]; iceTransportPolicy?: RTCIceTransportPolicy };
type Script = {
  id: string; title: string; text: string;
  // Per-script voice (set when authoring; travels into the rundown).
  voiceId: string; volume: number; speed: number; emotion: string;
  chars?: number;
  // Chunked playback: an ordered list of small audio pieces, played gaplessly.
  audioUrls?: string[];       // signed URLs of the pieces (saved OR freshly generated)
  audioPaths?: string[];      // storage paths of freshly generated draft pieces, until Save
  saved?: boolean;            // persisted to Supabase (livehost_scripts)
  generating?: boolean;       // Generate request in flight
  saving?: boolean;           // Save request in flight
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
// Mirror of the server's /script-generate chunkText (CHUNK_CHARS=250): split into
// the SAME ≤250-char pieces the saved audio was generated as, so the teleprompter
// line index lines up 1:1 with the audio piece index (karaoke follows correctly).
function chunkPieces(text: string): string[] {
  const MAX = 250;
  const sentences = text.match(/[^.!?…]+[.!?…]+(\s|$)|[^.!?…]+$/g) || [text];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > MAX) {
      if (cur) { out.push(cur); cur = ""; }
      let w = "";
      for (const word of s.split(/\s+/)) {
        if ((w + " " + word).trim().length > MAX) { if (w) out.push(w); w = word; }
        else w = (w ? w + " " : "") + word;
      }
      if (w) cur = w;
    } else if ((cur + s).length > MAX) {
      if (cur) out.push(cur);
      cur = s;
    } else {
      cur += s;
    }
  }
  if (cur.trim()) out.push(cur);
  return (out.length ? out : [text]).map((p) => p.trim());
}

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
  // Pool mode: this client has no dedicated endpoint — a free 5090 serverless
  // endpoint is assigned from the shared pool at Play and released at Stop.
  const poolModeRef = useRef(false);
  const [poolMode, setPoolMode] = useState(false);
  useEffect(() => {
    fetch("/api/livehost/config")
      .then((r) => r.json())
      .then((d) => {
        if (d.mode === "pool") {
          poolModeRef.current = true; setPoolMode(true); // backendRef stays empty until Play assigns one
          return;
        }
        if (d.backendUrl) {
          setBackend(d.backendUrl); backendRef.current = d.backendUrl;
          if (d.provisionStatus && d.provisionStatus !== "ready" && d.provisionStatus !== "pool") {
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
  // GPU warm state (pool): warm-on-open assigns a slot + boots the worker so ▶ Start
  // is instant. "idle" → "warming" (spinner, Start disabled) → "ready" (Start enabled).
  const [gpuWarm, setGpuWarm] = useState<"idle" | "warming" | "ready">("idle");
  const gpuWarmRef = useRef<"idle" | "warming" | "ready">("idle");
  useEffect(() => { gpuWarmRef.current = gpuWarm; }, [gpuWarm]);
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // EDGE-TRIGGER guard for warm-on-open: warm the GPU ONCE per Livehost-tab
  // entry. After the 15-min cutoff turns the GPU off, it must NOT auto-re-warm
  // while the user is still on the page — only a fresh tab entry (leaving and
  // clicking Livehost again) re-triggers it. Reset when the view leaves "live".
  const warmEntryRef = useRef(false);
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
  const [avatarClipBottom, setAvatarClipBottom] = useState(0); // % cropped off the BOTTOM of the avatar (hide its static body so the gesture body shows)
  const [avatarFeather, setAvatarFeather] = useState(8);       // % soft-fade of that bottom crop so the seam blends
  const [previewUrl, setPreviewUrl] = useState("");
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; active: boolean }>({ startX: 0, startY: 0, baseX: 0, baseY: 0, active: false });
  // ── BODY LAYER (Livehost) — a chroma-keyed gesture clip (Kling, generated on a
  // green/blue screen) composited UNDER the AVTR-1 head: it covers the avatar's
  // static body with a gesturing one, the live talking head shows above. Picked
  // manually at Livehost. clipTop hides the Kling head (so AVTR-1's shows); the
  // green/blue is keyed out in a canvas (auto-detect or from the stored bgColor).
  const [bodyUrl, setBodyUrl] = useState("");
  const [bodyKey, setBodyKey] = useState<"auto" | "green" | "blue">("auto");
  const [bodyZoom, setBodyZoom] = useState(1);
  const [bodyWidth, setBodyWidth] = useState(1); // extra HORIZONTAL stretch (Kling clips can come out too narrow)
  const [bodyOffsetX, setBodyOffsetX] = useState(0);
  const [bodyOffsetY, setBodyOffsetY] = useState(0);
  const [bodyClipTop, setBodyClipTop] = useState(22); // % cropped off the top (hides Kling head)
  const [bodyFeather, setBodyFeather] = useState(10); // % soft-fade BELOW the crop so the head↔body seam blends (no hard line)
  const [bodyPickerOpen, setBodyPickerOpen] = useState(false);
  const [bodyClips, setBodyClips] = useState<{ id: string; url: string; bgColor: string; poster: string }[]>([]);
  // Which layer the Template-tab drag/zoom controls act on (radio: avatar | body).
  const [editLayer, setEditLayer] = useState<"avatar" | "body">("avatar");
  const bodyVideoRef = useRef<HTMLVideoElement | null>(null);
  const bodyCanvasRef = useRef<HTMLCanvasElement | null>(null);      // live-stage body
  const bodyCanvasTplRef = useRef<HTMLCanvasElement | null>(null);   // template-stage body (both views are always mounted)
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
  type GreetProfile = { id: string; title: string; greetings: string; greetDelayMin: number; greetDelayMax: number; followGreeting: string; likeGreeting: string; commentDelayMin: number; commentDelayMax: number; pinMin: number; pinMax: number; selectedProduct: string; sfxAuto: boolean };
  const [greetProfiles, setGreetProfiles] = useState<GreetProfile[]>([]);
  const [activeGreetId, setActiveGreetId] = useState("");
  // Live-event brain (greeting/comment driving) reads config from refs so the
  // window-message listener always sees the latest profile.
  const greetProfilesRef = useRef<GreetProfile[]>([]);
  const activeGreetIdRef = useRef("");
  useEffect(() => { greetProfilesRef.current = greetProfiles; }, [greetProfiles]);
  useEffect(() => { activeGreetIdRef.current = activeGreetId; }, [activeGreetId]);
  // Greeting/comment queues + timers + JOIN dedup (ported from the extension; the
  // studio is now the brain). greetedJoins = usernames already greeted on JOIN.
  const greetQueueRef = useRef<{ username: string; kind: "join" | "follow" | "like" }[]>([]);
  const commentQueueRef = useRef<{ username: string; text: string }[]>([]);
  const greetIdxRef = useRef(0);
  const greetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const greetedJoinsRef = useRef<Set<string>>(new Set());
  const chatActiveRef = useRef(false); // a greeting/comment is speaking → pause teleprompter
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
  const sessionCharsRef = useRef(0);        // script voice chars (Cost Live / NON Live)
  const sessionCommentCharsRef = useRef(0); // AI comment/chat-reply voice chars (Cost Comment)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  type UsageData = {
    rates: { gpuRateHour: number; voiceRate1k: number; audioRateGen: number; warmWindowSec?: number; currency: string };
    balance?: { credits: number; spent: number; available: number; minBalance: number; low: boolean };
    ledger: { at: string; type: string; typeLabel: string; durationSec: number; chars: number; cost: number; balanceAfter: number }[];
    costs?: {
      audioScript: { generations: number; chars: number; cost: number };
      live: { sessions: number; streamSec: number; voiceChars: number; gpuCost: number; voiceCost: number; cost: number };
      nonLive: { sessions: number; streamSec: number; voiceChars: number; gpuCost: number; voiceCost: number; idleSec: number; idleCost: number; cost: number };
      comment: { chars: number; cost: number };
      avatar: { generations: number; cost: number };
      templateBody?: { generations: number; cost: number };
      total: number;
    };
    month: { streamSec: number; voiceChars: number; gpuCost: number; voiceCost: number; totalCost: number };
    audio: { generations: number; chars: number; cost: number };
    gpu: { streamSec: number; cost: number };
  };
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const addVoiceChars = useCallback((n: number, isComment = false) => {
    if (n > 0) { if (isComment) sessionCommentCharsRef.current += n; else sessionCharsRef.current += n; }
  }, []);

  const sessionPost = useCallback((payload: object) => {
    return fetch("/api/livehost/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then((r) => r.json()).catch(() => null);
  }, []);

  // Credit-balance guard: available = credits − livehost cost. `low` = at/below the
  // admin RM5 threshold. Used to block ▶ Start and to auto-stop the worker mid-live.
  const fetchBalance = useCallback(async (): Promise<{ credits: number; available: number; minBalance: number; low: boolean } | null> => {
    try {
      const r = await fetch("/api/livehost/session");
      const d = await r.json();
      return d?.balance || null;
    } catch { return null; }
  }, []);

  const beginSession = useCallback(async () => {
    sessionCharsRef.current = 0;
    sessionCommentCharsRef.current = 0;
    // tag the session: "live" = a timed live (duration set); "testing" = ad-hoc play
    const d = await sessionPost({ action: "start", sessionType: loopRef.current ? "live" : "testing" });
    if (d?.sessionId) {
      sessionIdRef.current = d.sessionId;
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (sessionIdRef.current) {
          sessionPost({ action: "heartbeat", sessionId: sessionIdRef.current, voiceChars: sessionCharsRef.current, commentChars: sessionCommentCharsRef.current });
        }
      }, 15000); // 15s heartbeat → crash/shutdown loses ≤15s of billing
    }
  }, [sessionPost]);

  const endSession = useCallback(() => {
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    // NOTE: we deliberately do NOT release the pool slot here. Ending a stream
    // (Stop) or closing the tab/browser must NOT free the GPU — the slot stays
    // leased + warm for the 15-min idle window so the host can come back and
    // stream again. The slot is freed only by the 15-min watchdog (tab open) or
    // by server-side staleness (last_seen > 15 min, via the idle cron / assign).
    const id = sessionIdRef.current;
    sessionIdRef.current = null;
    if (!id) return;
    const payload = JSON.stringify({ action: "stop", sessionId: id, voiceChars: sessionCharsRef.current, commentChars: sessionCommentCharsRef.current });
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
  // Grace timer for transient WebRTC "disconnected" (network blip) so we don't
  // kill a live stream on a momentary hiccup that ICE would recover on its own.
  const disconnectGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AUTO-RECONNECT (24/7): on a real drop, instead of giving up we re-run the
  // connection in "resume" mode (same worker URL → re-offer; resumes the script
  // at the current posRef, no re-bill, no script restart). Retries with backoff
  // up to a cap; only then surfaces "terputus". The anti-freeze loop masks the
  // gap so viewers keep seeing motion while it reconnects.
  const startRef = useRef<(() => void) | null>(null);
  const tryReconnectRef = useRef<(() => void) | null>(null);
  const resumeRef = useRef(false);          // next start() should resume (not reset)
  const reconnectingRef = useRef(false);    // a reconnect is in flight
  const reconnectAttemptsRef = useRef(0);
  const sessionBegunRef = useRef(false);    // beginSession() only once per live

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
  // Drag-and-drop reorder of the rundown: ref = the row being dragged (no
  // re-render needed); state = the row currently hovered over (for highlight).
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [playPos, setPlayPos] = useState<{ s: number; l: number }>({ s: -1, l: -1 });
  const playPosRef = useRef<{ s: number; l: number }>({ s: -1, l: -1 }); // live mirror for pause/resume
  const [scriptPlaying, setScriptPlaying] = useState(false);
  const [scriptPaused, setScriptPaused] = useState(false);
  const [scriptWaiting, setScriptWaiting] = useState(false);
  const [scriptLoop, setScriptLoop] = useState(true); // default ON — loop all scripts; uncheck = play once
  // LIVE DURATION: hours+minutes the live should run. >0 → loop the rundown and
  // auto-stop exactly when the time is up; 0:00 → run as usual (manual/loop checkbox).
  const [liveDurH, setLiveDurH] = useState(0);
  const [liveDurM, setLiveDurM] = useState(0);
  const [liveTimer, setLiveTimer] = useState(""); // formatted H:MM:SS shown above teleprompter
  const liveEndAtRef = useRef(0);     // perf.now() deadline (0 = no fixed duration → count up)
  const liveStartAtRef = useRef(0);   // perf.now() when the live started (for count-up)
  const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // The Template tab is a STATIC design surface (arrange avatar + background +
  // label) — it must NEVER mirror the live stream. Mirroring caused two bugs:
  // (1) the avatar lip-synced on the Template tab while live (it should be a
  // still), and (2) it played the audio a SECOND time (offset by the jitter
  // buffer) → echo, since the real audio already plays via the Web Audio graph.
  // Keep the template video element permanently empty; the static avatar image
  // below is what's shown there.
  useEffect(() => {
    const v = templateVideoRef.current;
    if (v) v.srcObject = null;
  }, [active]);

  useEffect(() => { scriptsRef.current = scripts; }, [scripts]);
  useEffect(() => { rundownRef.current = rundown; }, [rundown]);
  useEffect(() => { loopRef.current = scriptLoop; }, [scriptLoop]);
  useEffect(() => { playPosRef.current = playPos; }, [playPos]);
  const liveDurMsRef = useRef(0);
  useEffect(() => { liveDurMsRef.current = (liveDurH * 3600 + liveDurM * 60) * 1000; }, [liveDurH, liveDurM]);

  const curScript = useMemo(() => {
    const id = rundown[playPos.s >= 0 ? playPos.s : 0];
    return scripts.find((s) => s.id === id) || null;
  }, [scripts, rundown, playPos.s]);
  const curLines = useMemo(() => {
    if (!curScript) return [];
    // Saved audio plays PIECE BY PIECE (one ≤250-char piece per say). Show the
    // teleprompter as those SAME pieces so each highlights as its audio plays
    // (playPos.l = piece index). Live-TTS fallback uses per-sentence lines.
    if (curScript.audioUrls?.length) return chunkPieces(curScript.text);
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
    // Drag the ACTIVE layer (radio in Template: avatar or body). In Livehost
    // editLayer stays "avatar" so dragging still moves the avatar as before.
    const layer = editLayer;
    const bx = layer === "body" ? bodyOffsetX : offsetX;
    const by = layer === "body" ? bodyOffsetY : offsetY;
    (dragRef.current as any) = { startX: e.clientX, startY: e.clientY, baseX: bx, baseY: by, active: true, layer };
  }, [offsetX, offsetY, bodyOffsetX, bodyOffsetY, editLayer]);

  const onStagePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current as any;
    if (!d.active) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = Math.max(-90, Math.min(90, d.baseX + ((e.clientX - d.startX) / r.width) * 100));
    const ny = Math.max(-90, Math.min(90, d.baseY + ((e.clientY - d.startY) / r.height) * 100));
    if (d.layer === "body") { setBodyOffsetX(nx); setBodyOffsetY(ny); } else { setOffsetX(nx); setOffsetY(ny); }
  }, []);

  const onStagePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const loadBodyClips = useCallback(async () => {
    try {
      const r = await fetch("/api/livehost/body-clips");
      const d = await r.json().catch(() => ({}));
      if (Array.isArray(d.clips)) setBodyClips(d.clips);
    } catch {}
  }, []);

  // Chroma-key the body video each frame (punch the green/blue screen → alpha 0
  // + light despill) on an offscreen, then blit to BOTH the live-stage and
  // template-stage body canvases (both views are always mounted). The source
  // <video> lives at the component root (NOT inside a display:none view) so it
  // keeps decoding regardless of which tab is showing. 540px wide = cheap for 2D.
  useEffect(() => {
    if (!bodyUrl) return;
    const v = bodyVideoRef.current;
    if (!v) return;
    const work = document.createElement("canvas");
    const wctx = work.getContext("2d", { willReadFrequently: true });
    if (!wctx) return;
    let raf = 0;
    let mode: "green" | "blue" = bodyKey === "blue" ? "blue" : "green";
    let detected = bodyKey !== "auto";
    const draw = () => {
      // FULL frame rate (no throttle) — keep the body at 50fps to match the
      // avatar. Render at 440px (not 540) so the per-pixel chroma-key loop is
      // ~33% cheaper → keeps CPU free for the WebRTC stream so the LIPSYNC
      // doesn't stutter, while staying sharp at the stage display size.
      raf = requestAnimationFrame(draw);
      if (v.readyState < 2 || !v.videoWidth) return;
      const W = 440, H = Math.round((W * v.videoHeight) / v.videoWidth);
      if (work.width !== W || work.height !== H) { work.width = W; work.height = H; }
      wctx.drawImage(v, 0, 0, W, H);
      let img: ImageData;
      try { img = wctx.getImageData(0, 0, W, H); } catch { return; }
      const d = img.data;
      if (!detected) {
        const r0 = d[0], g0 = d[1], b0 = d[2];
        mode = (b0 > g0 && b0 > r0) ? "blue" : "green";
        detected = true;
      }
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (mode === "green") {
          if (g > 90 && g > r * 1.25 && g > b * 1.25) d[i + 3] = 0;
          else if (g > r && g > b) d[i + 1] = Math.max(r, b);
        } else {
          if (b > 90 && b > r * 1.25 && b > g * 1.25) d[i + 3] = 0;
          else if (b > r && b > g) d[i + 2] = Math.max(r, g);
        }
      }
      wctx.putImageData(img, 0, 0);
      const c = bodyCanvasRef.current;
      if (c) {
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        const cc = c.getContext("2d");
        if (cc) { cc.clearRect(0, 0, W, H); cc.drawImage(work, 0, 0); }
      }
    };
    raf = requestAnimationFrame(draw);
    v.play().catch(() => {});
    return () => cancelAnimationFrame(raf);
  }, [bodyUrl, bodyKey]);

  // Drag/zoom act on the AVATAR in the Template tab, and on the BODY in the
  // Livehost tab (where you align the body to the already-streaming avatar — so
  // there's no still-image-vs-live-video drift). Body is picked/edited in Livehost.
  useEffect(() => { setEditLayer(view === "live" && bodyUrl ? "body" : "avatar"); }, [view, bodyUrl]);



  // ---- Saved templates (composition history) ----
  // A saved template snapshots the WHOLE composition: which overlay (Canva
  // PNG), which avatar, and the avatar-fit + badge position. No per-object
  // editing — the design itself is made in Canva and imported as the overlay.
  type SavedTpl = {
    id: string; name: string; createdAt: number;
    overlaySel: string; customOverlay: string; overlayUrl: string;
    previewUrl: string; stockSel: string; avatarId: string;
    zoom: number; offsetX: number; offsetY: number;
    avatarClipBottom?: number; avatarFeather?: number;
    badgePos: { x: number; y: number };
    // Body (gesture) layer — bundled so picking a template at Livehost auto-loads it.
    bodyUrl?: string; bodyKey?: "auto" | "green" | "blue";
    bodyZoom?: number; bodyOffsetX?: number; bodyOffsetY?: number; bodyClipTop?: number;
  };
  const [savedTemplates, setSavedTemplates] = useState<SavedTpl[]>([]);
  const [savedPickerOpen, setSavedPickerOpen] = useState(false);
  // Editor modals. Knowledge uses a DRAFT (id=null → new) so a cancelled
  // "new" never leaves a junk row — it only commits to the list on Save.
  const [kbDraft, setKbDraft] = useState<{ id: string | null; title: string; text: string } | null>(null);
  const [scriptEditId, setScriptEditId] = useState<string | null>(null);
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
    // Need an avatar IMAGE + a template overlay. We gate on previewUrl (the
    // picked avatar image), NOT avatarId — Default (own) avatars only get a
    // registered avatarId once the GPU is warm at live-start, but the template
    // is just a composition snapshot and the image is enough to save it.
    if (!previewUrl || !overlayUrl) {
      alert("Pilih AVATAR dan TEMPLATE dahulu sebelum simpan.");
      return;
    }
    const name = window.prompt("Nama template:", `Template ${savedTemplates.length + 1}`);
    if (!name) return;
    persistTemplates([
      ...savedTemplates,
      {
        id: "tpl" + Date.now().toString(36), name, createdAt: Date.now(),
        overlaySel, customOverlay, overlayUrl, previewUrl, stockSel, avatarId,
        zoom, offsetX, offsetY, avatarClipBottom, avatarFeather, badgePos,
      },
    ]);
  }, [savedTemplates, persistTemplates, overlaySel, customOverlay, overlayUrl, previewUrl, stockSel, avatarId, zoom, offsetX, offsetY, avatarClipBottom, avatarFeather, badgePos]);
  const loadTemplate = useCallback((t: SavedTpl) => {
    setOverlaySel(t.overlaySel); setCustomOverlay(t.customOverlay);
    setStockSel(t.stockSel); setAvatarId(t.avatarId); setPreviewUrl(t.previewUrl);
    setZoom(t.zoom); setOffsetX(t.offsetX); setOffsetY(t.offsetY);
    setAvatarClipBottom(t.avatarClipBottom || 0); setAvatarFeather(t.avatarFeather ?? 8);
    setBadgePos(t.badgePos || { x: 4, y: 10 });
    // Body is NOT part of the template — it's imported + aligned at Livehost.
  }, []);
  const deleteTemplate = useCallback(async (id: string) => {
    if (!(await confirmDelete("Padam template ini?"))) return;
    persistTemplates(savedTemplates.filter((t) => t.id !== id));
  }, [savedTemplates, persistTemplates]);

  // Flush pending DB saves when the tab is hidden / unloaded.
  useEffect(() => installLivehostStateFlush(), []);

  // Restore persisted state. Render from the LOCAL CACHE instantly (no waiting
  // on the network), fire the DB/manifest fetches in PARALLEL, then reconcile
  // with the DB hydrate in the background. Previously everything waited on a
  // single `await hydrateLivehostState()`, so one slow request blanked the tab.
  useEffect(() => {
    let cancelled = false;

    // Read the localStorage cache → state. Idempotent; re-run after hydrate.
    const applyLocalCache = () => {
      let saved: any = {};
      try { saved = JSON.parse(localStorage.getItem("livehost_settings") || "{}"); } catch {}
      try { const rawT = localStorage.getItem("livehost_saved_templates"); if (rawT) setSavedTemplates(JSON.parse(rawT)); } catch {}
      // NOTE: the visual COMPOSITION (avatar, overlay, body + their transforms) is
      // intentionally NOT restored on load — the stage starts CLEAR and the host
      // picks a saved template to load everything. Only general settings persist.
      if (saved.voiceId) setVoiceId(saved.voiceId);
      if (typeof saved.scriptLoop === "boolean") { setScriptLoop(saved.scriptLoop); loopRef.current = saved.scriptLoop; }
      if (typeof saved.liveDurH === "number") setLiveDurH(saved.liveDurH);
      if (typeof saved.liveDurM === "number") setLiveDurM(saved.liveDurM);
      if (typeof saved.volume === "number") setVolume(saved.volume);
      if (typeof saved.speed === "number") setSpeed(saved.speed);
      if (saved.badgePos && typeof saved.badgePos.x === "number") setBadgePos(saved.badgePos);
      if (typeof saved.emotion === "string") setEmotion(saved.emotion);
      // (body layer NOT restored — composition starts clear; load a template)
      if (Array.isArray(saved.rundown)) { setRundown(saved.rundown); rundownRef.current = saved.rundown; }
      try {
        const lib = JSON.parse(localStorage.getItem("livehost_products_lib") || "[]");
        if (Array.isArray(lib) && lib.length) {
          setProducts(lib);
          setActiveProductId(localStorage.getItem("livehost_active_product") || lib[0].id);
        } else {
          const oldKb = localStorage.getItem("livehost_products");
          setProducts([{ id: "p1", title: "Produk 1", text: oldKb || "" }]); setActiveProductId("p1");
        }
        const glib = JSON.parse(localStorage.getItem("livehost_greet_lib") || "[]");
        if (Array.isArray(glib) && glib.length) {
          setGreetProfiles(glib);
          setActiveGreetId(localStorage.getItem("livehost_active_greet") || glib[0].id);
        }
      } catch {}
    };

    // 1) Instant render from the cache.
    applyLocalCache();

    // 2) Independent fetches — fire NOW, in parallel (not gated by hydrate).
    fetch("/api/livehost/scripts").then((r) => r.json()).then((d) => {
      if (cancelled || !Array.isArray(d?.scripts)) return;
      const list: Script[] = d.scripts.map((s: any) => ({
        id: s.id, title: s.title, text: s.text,
        voiceId: s.voiceId || VOICES[0].id, volume: s.volume ?? 1.5, speed: s.speed ?? 1.0, emotion: s.emotion || "fluent",
        chars: s.chars, audioUrls: s.audioUrls || [], saved: true,
      }));
      setScripts(list); scriptsRef.current = list;
    }).catch(() => {});
    fetch("/overlays/manifest.json").then((r) => r.json()).then((l) => { if (!cancelled) setOverlays(l); }).catch(() => {});
    fetch("/avatars/manifest.json").then((r) => r.json()).then((list) => {
      if (cancelled) return;
      setStock(list);
      // (no stock-avatar auto-restore — the stage starts CLEAR; pick a template)
    }).catch(() => {});

    // 3) Background: pull DB → cache, then re-apply (DB wins on a fresh device).
    hydrateLivehostState().then(() => {
      if (cancelled) return;
      applyLocalCache();
      hydratedRef.current = true;
    });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem("livehost_settings", JSON.stringify({ stockSel, overlaySel, customOverlay, avatarId, previewUrl, voiceId, zoom, offsetX, offsetY, avatarClipBottom, avatarFeather, scriptLoop, rundown, volume, speed, badgePos, emotion, liveDurH, liveDurM, bodyUrl, bodyKey, bodyZoom, bodyOffsetX, bodyOffsetY, bodyClipTop, bodyFeather }));
    } catch {}
    saveLivehostState();
  }, [stockSel, overlaySel, customOverlay, avatarId, previewUrl, voiceId, zoom, offsetX, offsetY, avatarClipBottom, avatarFeather, scriptLoop, rundown, volume, speed, badgePos, emotion, liveDurH, liveDurM, bodyUrl, bodyKey, bodyZoom, bodyOffsetX, bodyOffsetY, bodyClipTop, bodyFeather]);
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

  // GPU LIFECYCLE — Novita's freeTimeout (15 min) is the ONE watchdog. A serverless
  // worker auto-shuts after 15 min with no request; the browser just sends a
  // /keepalive heartbeat to say "keep it on":
  //   • while streaming   → heartbeat every 30s → worker stays up (resets the 15-min timer)
  //   • streaming stops   → heartbeat stops → Novita's 15-min freeTimeout drops it to $0
  //   • open tab / refresh → one warm-on-open kick wakes it; it then stays up ~15 min
  // Quick-restart stays instant for ~15 min after Stop (worker still up). ONE timer,
  // not two — no separate browser timer stacked on top of Novita's.
  useEffect(() => {
    const ping = () => {
      if (!activeRef.current) return; // only heartbeat WHILE streaming; idle = Novita's job
      // Hit a REAL route the worker actually processes (GET /avatars) — a no-cors
      // POST to /keepalive did NOT reset Novita's freeTimeout (worker dropped
      // mid-stream at ~16.7min). A processed GET counts as activity → resets the
      // freeTimeout → the single worker (maxNum:1) stays up for the whole live.
      if (backendRef.current) fetch(`${backendRef.current}/avatars`, { signal: AbortSignal.timeout(8000) }).catch(() => {});
    };
    ping();
    const t = setInterval(ping, 30000); // < freeTimeout so the worker never idles out mid-live
    return () => clearInterval(t);
  }, []);

  // (No warm-on-open. GPU on/off is controlled ONLY at the Usage tab — opening
  // the Livehost studio must NOT turn the GPU on. The worker is warmed by the
  // Usage "Hidupkan GPU" flow; the studio just connects when you press Start.)

  // (No balance watchdog / no auto-stop. The live NEVER auto-stops — GPU stays
  // alive for long hours until the host manually Turn OFF at the Usage/Admin tab.)

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
  // Pool clients have no dedicated instance to poll — it's serverless + auto.
  useEffect(() => {
    if (poolMode) { setServerState("serverless · auto"); return; }
    gpuAction("status");
    const t = setInterval(() => gpuAction("status"), 15000);
    return () => clearInterval(t);
  }, [gpuAction, poolMode]);

  // Refresh usage (server sessions + rates) + GPU state when the Usage view is open.
  useEffect(() => {
    if (view !== "usage") return;
    let stop = false;
    const load = () => {
      // Usage cost comes from the server (sessions + audio meter) — do NOT ping
      // the worker here, or just opening the Usage tab would wake it ($$$).
      fetch("/api/livehost/session")
        .then((r) => r.json())
        .then((d) => { if (!stop && d.rates) setUsageData(d); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [view]);

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
    // POOL model: there is NO fixed backend at pick-time (the worker is assigned
    // on warm / Start). So just SELECT the avatar here with a fresh client-side
    // id; start() registers it to the ASSIGNED pool worker (it fetches this B2
    // image — peninglab-storage sends CORS — and POSTs it to /register-avatar).
    // The old /api/livehost/register-avatar route used live_client_config.backend_url
    // (legacy per-client backend), which is empty in the pool model → 404'd, so a
    // custom avatar never got an id → "pick a face first" on Start.
    setError("");
    setStockSel("");
    setPreviewUrl(url);
    setAvatarId("u" + Date.now().toString(36));
  }, []);

  // Last voice_id pushed to the live-TTS engine via cfg (so we only resend on
  // change). Reset on stop so a new stream re-syncs from the first script.
  const lastCfgVoiceRef = useRef("");
  // --- Rundown playback driver (pipelined, gapless) -------------------------
  const speakNext = useCallback(() => {
    if (!playingRef.current) return;
    // A greeting/comment (live TTS) is barging in — hold the script here; the
    // chat's say_done will resume from the NEXT piece (avatar finishes the
    // current sentence, handles the greeting/comment, then continues the script).
    if (chatActiveRef.current) return;
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
      // SCRIPT = pre-generated SAVED AUDIO, played PIECE BY PIECE (one piece per
      // hop). Sending one piece at a time (instead of the whole list) leaves a
      // clean boundary AFTER EACH SENTENCE where a live-TTS greeting/comment can
      // slot in — avatar finishes the sentence, handles it, resumes the script.
      const pieces = sc?.audioUrls || [];
      if (pieces.length) {
        if (l >= pieces.length) { s++; l = 0; hops++; continue; }
        setScriptWaiting(false);
        // VOICE SYNC: keep the live-TTS engine (greeting/comment replies) on the
        // SAME voice as the script that's playing now — otherwise a comment reply
        // comes out in a different voice than the host's script. Sent once per
        // script-voice change (cheap), before this piece plays.
        if (sc && sc.voiceId && sc.voiceId !== lastCfgVoiceRef.current) {
          lastCfgVoiceRef.current = sc.voiceId;
          const dcv = dcRef.current;
          if (dcv && dcv.readyState === "open") dcv.send(JSON.stringify({ kind: "cfg", text: JSON.stringify({ voice_id: sc.voiceId, vol: sc.volume, speed: sc.speed, emotion: sc.emotion }) }));
        }
        posRef.current = { s, l: l + 1 };
        const id = "L" + ++sayCounterRef.current;
        pendingSayRef.current.set(id, { s, l });
        const dc = dcRef.current;
        if (dc && dc.readyState === "open") dc.send(JSON.stringify({ kind: "sayaudio", urls: [pieces[l]], id }));
        return;
      }
      // Fallback: scripts without saved audio → live TTS, line by line.
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

  // LIVE TIMER: ticks the H:MM:SS shown above the teleprompter. If a fixed
  // duration was set (liveEndAtRef>0) it COUNTS DOWN and auto-stops the stream at
  // zero; otherwise it COUNTS UP (elapsed) and never auto-stops.
  const startLiveTimer = useCallback(() => {
    if (liveTimerRef.current) clearInterval(liveTimerRef.current);
    const fmt = (ms: number) => {
      const t = Math.max(0, Math.round(ms / 1000));
      const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    };
    const tick = () => {
      if (liveEndAtRef.current > 0) {
        const rem = liveEndAtRef.current - performance.now();
        setLiveTimer(fmt(rem));
        if (rem <= 0) {
          setLiveTimer("0:00:00");
          if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
          stopRef.current?.(); // duration reached → end the live cleanly
        }
      } else {
        setLiveTimer(fmt(performance.now() - liveStartAtRef.current));
      }
    };
    tick();
    liveTimerRef.current = setInterval(tick, 1000);
  }, []);

  const stop = useCallback(() => {
    endSession(); // server records the exact end second (also frees the pool slot)
    // POOL: release our serverless endpoint back to the pool + clear the URL so
    // the next Play re-assigns a fresh free slot.
    // STOP ends the live stream but does NOT kill the GPU. The slot stays
    // assigned + warm (gpuWarm "ready") so the host can Play again instantly.
    // The GPU is freed ONLY by the 15-min idle watchdog (or server-side staleness
    // if the tab/browser closes) — never by Stop, tab-switch, or close.
    // (We keep backendRef + gpuWarm="ready" untouched here on purpose.)
    if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null; }
    liveEndAtRef.current = 0; setLiveTimer("");
    // Reset the live-event brain (greeting/comment queues + timers + dedup).
    if (greetTimerRef.current) { clearTimeout(greetTimerRef.current); greetTimerRef.current = null; }
    if (commentTimerRef.current) { clearTimeout(commentTimerRef.current); commentTimerRef.current = null; }
    greetQueueRef.current = []; commentQueueRef.current = []; greetedJoinsRef.current.clear();
    greetIdxRef.current = 0; chatActiveRef.current = false;
    lastCfgVoiceRef.current = ""; // re-sync engine voice on next stream
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
    // Cancel any in-flight auto-reconnect so STOP really stops.
    if (disconnectGraceRef.current) { clearTimeout(disconnectGraceRef.current); disconnectGraceRef.current = null; }
    resumeRef.current = false; reconnectingRef.current = false;
    reconnectAttemptsRef.current = 0; sessionBegunRef.current = false;
    setWakeMsg("");
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null; dcRef.current = null; remoteStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false); setConnecting(false);
  }, [endSession]);
  useEffect(() => { stopRef.current = stop; }, [stop]);

  // AUTO-RECONNECT controller: re-run start() in resume mode on a drop. Capped
  // with backoff; gives up (real "terputus") only after many failed attempts.
  const tryReconnect = useCallback(() => {
    if (!activeRef.current && !connectingRef.current) return; // user stopped → don't
    if (reconnectingRef.current) return;                      // already reconnecting
    if (reconnectAttemptsRef.current >= 15) {
      reconnectingRef.current = false;
      setError("Sambungan terputus — tekan ▶ Start semula.");
      stopRef.current?.();
      return;
    }
    reconnectingRef.current = true;
    reconnectAttemptsRef.current += 1;
    setWakeMsg(`Menyambung semula… (cubaan ${reconnectAttemptsRef.current})`);
    if (disconnectGraceRef.current) { clearTimeout(disconnectGraceRef.current); disconnectGraceRef.current = null; }
    try { pcRef.current?.close(); } catch {}
    resumeRef.current = true;
    startRef.current?.(); // re-run start() in resume mode (keeps script position)
  }, []);
  useEffect(() => { tryReconnectRef.current = tryReconnect; }, [tryReconnect]);

  // Warm the GPU: assign a pool slot (if none) + boot the worker until /avatars
  // answers. Used by WARM-ON-OPEN and by ▶ Start. Sets gpuWarm; true when ready.
  const warmGpu = useCallback(async (): Promise<boolean> => {
    if (gpuWarmRef.current === "ready" && backendRef.current) return true;
    if (gpuWarmRef.current === "warming") return false;
    setGpuWarm("warming");
    if (poolModeRef.current && !backendRef.current) {
      try {
        const pr = await fetch("/api/livehost/pool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "assign" }) });
        const pd = await pr.json().catch(() => ({}));
        if (!pr.ok || !pd.url) {
          setGpuWarm("idle");
          setError(pd.error === "all_busy" ? "Semua host sibuk sekarang — cuba sebentar lagi." : (pd.error || "Tiada GPU tersedia."));
          return false;
        }
        backendRef.current = pd.url; setBackend(pd.url);
      } catch { setGpuWarm("idle"); setError("Tiada GPU tersedia — cuba sekali lagi."); return false; }
    }
    if (!backendRef.current) { setGpuWarm("idle"); setError(configErr || "GPU belum dikonfigurasi."); return false; }
    // Boot: poll /avatars until the worker answers. A fresh cold start (image
    // pull + renderer + RIFE model load) can take several minutes, so wait up to
    // 12 min (each poll keeps the worker alive) — prevents a premature "GPU
    // lambat" on first boot. Stays under the 16.7-min freeTimeout.
    const deadline = Date.now() + 12 * 60 * 1000;
    for (let i = 0; Date.now() < deadline; i++) {
      try {
        const ping = await fetch(`${backendRef.current}/avatars`, { signal: AbortSignal.timeout(5000) });
        if (ping.ok) { setGpuWarm("ready"); setWakeMsg(""); loadAvatarsRef.current?.(); return true; }
      } catch {}
      const s = i * 5;
      setWakeMsg(`⏳ Menghidupkan GPU… boot kali pertama ~7-8 minit (${s}s) — Button Play muncul automatik bila siap`);
      await new Promise((r) => setTimeout(r, 5000));
    }
    setGpuWarm("idle"); setWakeMsg("");
    setError("GPU lambat respons — buka semula tab Livehost.");
    return false;
  }, [configErr]);

  const start = useCallback(async () => {
    setError("");
    // Avatar id: stock + pick-registered avatars already have one. A Default
    // (own) avatar arranged while the GPU was cold (e.g. in the Template tab)
    // has only previewUrl — mint an id now; it gets registered on the warm
    // worker just before /offer below.
    let aid = avatarId;
    if (!aid && previewUrl) { aid = "u" + Date.now().toString(36); setAvatarId(aid); }
    if (!aid) { setError("Pick or upload a face first."); return; }
    // RESUME mode = this call is an auto-reconnect (set by tryReconnect). Consume
    // the flag now; a fresh user-pressed Start (resume=false) resets reconnect
    // state + checks balance; a reconnect skips both and keeps the script position.
    const resume = resumeRef.current; resumeRef.current = false;
    if (!resume) {
      sessionBegunRef.current = false; reconnectAttemptsRef.current = 0; reconnectingRef.current = false;
      // BALANCE GUARD: don't stream if the credit balance is already at/below the min.
      const bal = await fetchBalance();
      if (bal && bal.low) {
        setError(`Baki kredit tidak cukup (baki RM${bal.available.toFixed(2)}, minimum RM${bal.minBalance}). Sila top up dulu.`);
        return;
      }
    }
    setConnecting(true);
    try {
      // Ensure the GPU is warm (instant if warm-on-open already booted it).
      const ready = await warmGpu();
      if (!ready) { setConnecting(false); return; }
      setWakeMsg("");
      const iceRes = await fetch(`${backendRef.current}/ice-servers`);
      if (!iceRes.ok) throw new Error(`ice-servers ${iceRes.status}`);
      const cfg: IceConfig = await iceRes.json();

      const pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceTransportPolicy: cfg.iceTransportPolicy || "all" });
      pcRef.current = pc;
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        const st = pc.connectionState;
        if (st === "connected") {
          // recovered (or first connect) — cancel grace, clear reconnect state
          if (disconnectGraceRef.current) { clearTimeout(disconnectGraceRef.current); disconnectGraceRef.current = null; }
          reconnectingRef.current = false; reconnectAttemptsRef.current = 0;
          setActive(true); setConnecting(false); setWakeMsg("");
          // Stream connected = GPU is RUNNING → report it so billing starts now
          // (reliable signal; the /avatars status ping is flaky while streaming).
          fetch("/api/livehost/gpu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "running" }) }).catch(() => {});
          if (!sessionBegunRef.current) { sessionBegunRef.current = true; beginSession(); } // once per live
        } else if (st === "failed" || st === "closed") {
          // Real drop → AUTO-RECONNECT (resume) instead of giving up.
          if (disconnectGraceRef.current) { clearTimeout(disconnectGraceRef.current); disconnectGraceRef.current = null; }
          if (activeRef.current || connectingRef.current) tryReconnectRef.current?.();
        } else if (st === "disconnected") {
          // TRANSIENT per WebRTC spec — a brief blip ICE usually recovers on its
          // own. Give it ~20s so ICE can recover SEAMLESSLY (no teardown, no gap)
          // — matches the worker's 20s grace. Only if still not back do we tear
          // down + auto-reconnect. (Reconnecting too early would preempt the ICE
          // recovery and force an avoidable new /offer.)
          if (disconnectGraceRef.current) clearTimeout(disconnectGraceRef.current);
          disconnectGraceRef.current = setTimeout(() => {
            disconnectGraceRef.current = null;
            if (pcRef.current === pc && pc.connectionState !== "connected"
                && (activeRef.current || connectingRef.current)) tryReconnectRef.current?.();
          }, 20000);
        }
      };

      const remote = new MediaStream();
      remoteStreamRef.current = remote;
      pc.ontrack = (ev) => {
        remote.addTrack(ev.track);
        // ~1s jitter buffer: absorbs TURN-relay network spikes so they never
        // become visible stutter. Invisible on a one-way TikTok broadcast (the
        // viewer doesn't interact with video timing; comment-replies are already
        // delayed by seconds), and turns "sometimes laggy" into "always smooth".
        try {
          const r: any = ev.receiver;
          if (r) {
            if ("playoutDelayHint" in r) r.playoutDelayHint = 1.0;
            if ("jitterBufferTarget" in r) r.jitterBufferTarget = 1000;
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
          audioEndRef.current = 0;
          pendingSayRef.current.clear(); // old in-flight says are dead on a new pc
          if (!resume) {
            // FRESH start: begin the rundown from the top + start the elapsed timer.
            // LOOPING follows the "Enable loop" checkbox (loopRef). Duration + auto
            // End-LIVE are handled by the extension, so we NEVER auto-stop here.
            posRef.current = { s: 0, l: 0 };
            liveStartAtRef.current = performance.now();
            liveEndAtRef.current = 0;
            startLiveTimer();
          }
          // RECONNECT: keep posRef + the running timer → resume the script exactly
          // where it was (speakNext reads posRef).
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
          // `barge` = any comment/chat reply (studio sim / extension / TikTok);
          // `ent.chat` covers studio-originated ones whose id we still hold.
          const isChat = (!!ent && "chat" in ent) || m.barge === true;
          // CHAT/COMMENT reply = BOOKKEEPING ONLY. It plays in the worker queue
          // BETWEEN script pieces (no discard, no hold), so the script chain must
          // NOT be touched here — touching it (rescheduling/holding) is exactly
          // what caused the script to go SILENT while waiting for the reply.
          if (isChat) {
            chatActiveRef.current = false;
            addVoiceChars(Number(m.chars) || 0, true);
            return;
          }
          // SCRIPT PIECE: advance the karaoke + pipeline the next piece.
          const startAt = Math.max(now, audioEndRef.current);
          audioEndRef.current = startAt + durMs;
          addVoiceChars(Number(m.chars) || 0, false);
          if (ent && durMs > 0) {
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
      // The control data-channel can close on its own (worker SCTP drop / worker
      // restart) WITHOUT pc.connectionState flipping — that left the script
      // sending into a dead channel = the mid-live "Not connected" you saw.
      // Recover it the same way as a full drop. Guards: same pc (a user Stop
      // nulls pcRef), still live, and not already reconnecting.
      dc.onclose = () => {
        if (pcRef.current === pc && activeRef.current && !reconnectingRef.current) {
          tryReconnectRef.current?.();
        }
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
      if (aid && previewUrl) {
        setWakeMsg("Menyediakan avatar… ⏳");
        for (let a = 0; a < 8; a++) {
          try {
            const avs = await fetch(`${backendRef.current}/avatars`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
            if (Array.isArray(avs?.avatars) && avs.avatars.includes(aid)) break;
            // Cross-origin (B2) avatars can't be fetched directly in the browser
            // (no CORS) — route through our same-origin image proxy. Stock
            // avatars (/avatars/*) are same-origin and usually break out above.
            const imgSrc = previewUrl.startsWith("http") ? `/api/proxy-image-fetch?url=${encodeURIComponent(previewUrl)}` : previewUrl;
            const img = await fetch(imgSrc).then((r) => r.blob());
            // avatar_id in the PATH (not query) — the serverless ingress strips
            // query params on POST, which made every avatar register as "custom".
            const rr = await fetch(`${backendRef.current}/register-avatar/${encodeURIComponent(aid)}`, {
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
        avatar_id: aid,
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
          tryReconnectRef.current?.(); // slow/failed connect → reconnect (capped)
        }
      }, 25000);
    } catch (e: any) {
      if (resume) {
        // reconnect attempt failed (worker maybe rebooting) → back off + retry
        reconnectingRef.current = false;
        setTimeout(() => tryReconnectRef.current?.(), 4000);
      } else {
        setError(e?.message || String(e));
        stop();
      }
    }
  }, [avatarId, previewUrl, backgrounds, voiceId, stop, speakNext, startWordSweep, buildKbPrompt, activeKb, speed, emotion, volume, configErr, addVoiceChars, beginSession, warmGpu]);
  useEffect(() => { startRef.current = start; }, [start]);

  // (No warm-on-open. The GPU is turned ON/OFF only at the Usage tab. Opening the
  // Livehost tab must NOT turn the GPU on. warmGpu() runs only when you press
  // ▶ Start — it connects to the worker you already turned on at Usage.)

  // (No idle auto-release / timeout — the GPU is dedicated + always-on per client,
  // controlled manually via the GPU ON/OFF button at Billing. ON = billed.)

  const sendControl = useCallback((payload: object): boolean => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") { dc.send(JSON.stringify(payload)); return true; }
    setError("Not connected — press Start first.");
    return false;
  }, []);

  const pauseRundown = useCallback(() => {
    // Resume at the sentence the viewer is ACTUALLY HEARING = the karaoke
    // highlight (playPos), which is set when each piece's audio starts. Do NOT
    // use posRef / the pending map: the studio PIPELINES pieces AHEAD of playback
    // (it sends the next sentences while the current one is still playing), so
    // those point PAST what's heard → resume skipped ahead. Worst case here =
    // re-speak the current sentence (fine); never skip.
    const pp = playPosRef.current;
    const resumeAt = pp.s >= 0 ? { s: pp.s, l: pp.l } : posRef.current;
    posRef.current = resumeAt;
    if (sayTimerRef.current) { clearTimeout(sayTimerRef.current); sayTimerRef.current = null; }
    if (wordTimerRef.current) { clearInterval(wordTimerRef.current); wordTimerRef.current = null; }
    highlightTimersRef.current.forEach((t) => clearTimeout(t));
    highlightTimersRef.current = [];
    pendingSayRef.current.clear();
    playingRef.current = false;
    setScriptPaused(true);
    setWordFrac(0);
    sendControl({ kind: "interrupt" });
  }, [sendControl]);

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

  const updateProduct = useCallback((id: string, patch: Partial<{ title: string; text: string }>) => {
    setProducts((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);
  const deleteProduct = useCallback(async (id: string) => {
    if (!(await confirmDelete("Padam knowledge ini?"))) return;
    setProducts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const addScript = useCallback(() => {
    const id = "s" + Date.now().toString(36);
    setScripts((prev) => [
      { id, title: `Script ${prev.length + 1}`, text: "", voiceId: VOICES[0].id, volume: 3.0, speed: 1.0, emotion: "fluent", saved: false },
      ...prev,
    ]);
    return id;
  }, []);
  const updateScript = useCallback((id: string, patch: Partial<Script>) => {
    // Changing content/voice invalidates the saved/generated audio.
    const dirties = ["text", "voiceId", "volume", "speed", "emotion"].some((k) => k in patch);
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch, ...(dirties ? { saved: false, audioUrls: [], audioPaths: [] } : {}) } : s)));
  }, []);
  const deleteScript = useCallback(async (id: string) => {
    if (!(await confirmDelete("Padam skrip ini?"))) return;
    const sc = scriptsRef.current.find((s) => s.id === id);
    if (sc?.saved) fetch(`/api/livehost/scripts?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    setScripts((prev) => prev.filter((s) => s.id !== id));
    setRundown((prev) => prev.filter((x) => x !== id));
  }, []);

  // ---- Per-script audio: Generate (preview, billable) + Save (persist) + Play ----
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewPlayId, setPreviewPlayId] = useState<string | null>(null);
  const [previewFrac, setPreviewFrac] = useState(0); // 0–1 progress → teleprompter sweep
  const [previewDur, setPreviewDur] = useState(0);    // total seconds (for the seek bar)

  const stopPreview = useCallback(() => {
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
    setPreviewPlayId(null); setPreviewFrac(0); setPreviewDur(0);
  }, []);
  // Preview a script by playing its pieces back-to-back (chunked playback).
  const playPreview = useCallback((id: string, srcs: string[]) => {
    if (previewAudioRef.current) { previewAudioRef.current.pause(); previewAudioRef.current = null; }
    const list = (srcs || []).filter(Boolean);
    if (!list.length) return;
    setPreviewPlayId(id); setPreviewFrac(0); setPreviewDur(0);
    let idx = 0;
    const playOne = () => {
      const a = new Audio(list[idx]);
      previewAudioRef.current = a;
      a.ontimeupdate = () => { if (a.duration) setPreviewFrac(Math.min(1, (idx + a.currentTime / a.duration) / list.length)); };
      a.onended = () => {
        if (previewAudioRef.current !== a) return; // superseded
        idx++;
        if (idx < list.length) playOne();
        else { setPreviewPlayId(null); setPreviewFrac(1); previewAudioRef.current = null; }
      };
      a.play().catch(() => setPreviewPlayId(null));
    };
    playOne();
  }, []);
  // Scrub the preview audio (drag the seek bar) to skip forward/back.
  const seekPreview = useCallback((frac: number) => {
    const a = previewAudioRef.current;
    if (a && a.duration) { a.currentTime = frac * a.duration; setPreviewFrac(frac); }
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
      if (!r.ok || !Array.isArray(d?.audio_urls) || !d.audio_urls.length) throw new Error(d?.error || "Generate gagal");
      setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, generating: false, audioUrls: d.audio_urls, audioPaths: d.audio_paths, chars: d.chars, saved: false } : s)));
      playPreview(id, d.audio_urls);
    } catch (e: any) {
      setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, generating: false } : s)));
      alert("Generate gagal: " + (e?.message || e));
    }
  }, [playPreview]);

  const saveScript = useCallback(async (id: string) => {
    const sc = scriptsRef.current.find((s) => s.id === id);
    if (!sc) return;
    if (!sc.audioPaths?.length) { alert("Generate audio dulu sebelum simpan."); return; }
    setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, saving: true } : s)));
    try {
      const r = await fetch("/api/livehost/scripts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: sc.title, text: sc.text, voice_id: sc.voiceId, volume: sc.volume, speed: sc.speed, emotion: sc.emotion, chars: sc.chars || sc.text.length, audio_paths: sc.audioPaths }),
      });
      const d = await r.json();
      if (!r.ok || !d?.id) throw new Error(d?.error || "Simpan gagal");
      // Swap the draft id for the persisted Supabase id; keep rundown refs +
      // the open editor modal pointing at the same row (else it goes blank).
      setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, id: d.id, saved: true, saving: false, audioUrls: d.audioUrls, audioPaths: [] } : s)));
      setRundown((prev) => prev.map((x) => (x === id ? d.id : x)));
      setScriptEditId((cur) => (cur === id ? d.id : cur));
    } catch (e: any) {
      setScripts((prev) => prev.map((s) => (s.id === id ? { ...s, saving: false } : s)));
      alert("Simpan gagal: " + (e?.message || e));
    }
  }, []);

  // Debounced auto-save of edited fields (e.g. title) for ALREADY-SAVED scripts.
  // Drafts have a local id (no DB row) so they're skipped until first Save.
  const scriptPatchTimer = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const autosaveScript = useCallback((id: string, patch: Record<string, unknown>) => {
    const sc = scriptsRef.current.find((s) => s.id === id);
    if (!sc?.saved) return;
    clearTimeout(scriptPatchTimer.current[id]);
    scriptPatchTimer.current[id] = setTimeout(() => {
      fetch("/api/livehost/scripts", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      }).catch(() => {});
    }, 600);
  }, []);

  const playSaved = useCallback((id: string) => {
    if (previewPlayId === id) { stopPreview(); return; }
    const sc = scriptsRef.current.find((s) => s.id === id);
    if (sc?.audioUrls?.length) playPreview(id, sc.audioUrls);
  }, [previewPlayId, stopPreview, playPreview]);

  // Download the generated/saved voiceover as a single MP3. Audio is
  // produced in ≤250-char pieces (multiple audioUrls); we fetch each and
  // concatenate the bytes into one audio/mpeg blob — MP3 is frame-based so
  // naive concatenation plays back fine. Falls back to downloading each
  // piece separately if a fetch is blocked (CORS on the signed URL).
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const triggerDownload = useCallback((url: string, filename: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, []);
  const downloadMp3 = useCallback(async (id: string) => {
    const sc = scriptsRef.current.find((s) => s.id === id);
    const urls = sc?.audioUrls || [];
    if (!urls.length) return;
    const base =
      (sc?.title || "voiceover").replace(/[^a-z0-9]+/gi, "_").slice(0, 40) ||
      "voiceover";
    setDownloadingId(id);
    try {
      const blobs: Blob[] = [];
      for (const u of urls) {
        const r = await fetch(u);
        if (!r.ok) throw new Error("fetch failed");
        blobs.push(await r.blob());
      }
      const merged = new Blob(blobs, { type: "audio/mpeg" });
      const obj = URL.createObjectURL(merged);
      triggerDownload(obj, base + ".mp3");
      setTimeout(() => URL.revokeObjectURL(obj), 15000);
    } catch {
      // CORS / fetch blocked → download the raw pieces directly.
      urls.forEach((u, i) =>
        triggerDownload(u, urls.length > 1 ? `${base}_${i + 1}.mp3` : `${base}.mp3`)
      );
    } finally {
      setDownloadingId(null);
    }
  }, [triggerDownload]);

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
  // DRAG-REORDER: pull item out of `from` and insert it at `to` (any position) —
  // not just an adjacent swap like moveInRundown. While playing, you can't move a
  // played/playing item or drop into an already-played slot (same guard as ↑↓).
  const reorderRundown = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    if (scriptPlaying && playPos.s >= 0 && (from <= playPos.s || to <= playPos.s)) return;
    setRundown((prev) => {
      if (from >= prev.length || to >= prev.length) return prev;
      const u = [...prev];
      const [m] = u.splice(from, 1);
      u.splice(to, 0, m);
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

  // Make the avatar speak a greeting/reply with an INSTANT barge-in: the moment
  // this fires we tell the worker to DISCARD the current script audio (kind:
  // "interrupt" → DiscardAvatarSpeechBuffer) and then speak this — no waiting for
  // a sentence. The script resumes when this finishes (chat say_done → speakNext).
  const cleanU = (u: string) => String(u || "").replace(/[*_~`]/g, "").trim().slice(0, 40);
  const speakNow = useCallback((kind: "say" | "ask", text: string) => {
    if (!text.trim()) return false;
    // NO HOLD: the script keeps playing while the worker prepares (LLM+synth) the
    // greeting/comment. The worker ENQUEUES the reply behind the current script
    // pieces (no discard), so it plays at the NEXT sentence boundary — the avatar
    // never goes silent waiting for synth. The script chain keeps running on its
    // own piece say_done's; the chat say_done is bookkeeping only (see onmessage).
    const id = "C" + ++sayCounterRef.current;
    pendingSayRef.current.set(id, { chat: true });
    return sendControl({ kind, text, id, barge: true });
  }, [sendControl]);

  const PURCHASE_RE = /\b(done|dah\s*beli|sudah\s*beli|checkout|dah\s*order|ordered?|dah\s*bayar)\b/i;
  const FEEDBACK_RE = /\b(best|sedap|berkesan|terbaik|memang\s*bagus|puas\s*hati|recommended)\b/i;
  const randMs = (min: number, max: number) => {
    const a = Math.min(min, max), b = Math.max(min, max);
    return (a + Math.random() * (b - a)) * 1000;
  };
  const activeGreet = useCallback(() =>
    greetProfilesRef.current.find((x) => x.id === activeGreetIdRef.current) || greetProfilesRef.current[0],
  []);

  // Record dashboard interactions (cookie auth). The studio is the brain, so it
  // logs the OUTCOMES it produces (greet / reply / skip) — the extension already
  // logs the raw join/follow/like/comment for REAL viewers. SIM events also log
  // their raw type so a rehearsal shows on the dashboard. Batched to stay cheap.
  const interBufRef = useRef<{ type: string; username: string; text: string }[]>([]);
  const interTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordInteraction = useCallback((type: string, username = "", text = "") => {
    interBufRef.current.push({ type, username: cleanU(username), text: String(text || "").slice(0, 500) });
    if (interTimerRef.current) return;
    interTimerRef.current = setTimeout(() => {
      interTimerRef.current = null;
      const events = interBufRef.current.splice(0, 200);
      if (events.length) fetch("/api/livehost/interactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ events }) }).catch(() => {});
    }, 2500);
  }, []);

  // Greeting loop: sequential rotation + random [greetDelayMin, greetDelayMax].
  const scheduleGreet = useCallback(() => {
    if (greetTimerRef.current) return;
    const g = activeGreet(); if (!g) return;
    greetTimerRef.current = setTimeout(() => {
      greetTimerRef.current = null;
      const item = greetQueueRef.current.shift();
      if (item) {
        let line = "";
        if (item.kind === "follow") { line = g.followGreeting; if (g.sfxAuto) playSfx("clap"); }
        else if (item.kind === "like") line = g.likeGreeting;
        else {
          const ls = (g.greetings || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
          if (ls.length) { line = ls[greetIdxRef.current % ls.length]; greetIdxRef.current++; }
        }
        if (line) { speakNow("say", line.replaceAll("[username]", cleanU(item.username))); setCaptionText(`👋 ${cleanU(item.username)}`); recordInteraction("greet", item.username); }
      }
      if (greetQueueRef.current.length) scheduleGreet();
    }, randMs(g.greetDelayMin, g.greetDelayMax));
  }, [activeGreet, speakNow, playSfx, recordInteraction]);

  // Comment loop: random [commentDelayMin, commentDelayMax] between replies.
  const scheduleComment = useCallback(() => {
    if (commentTimerRef.current) return;
    const g = activeGreet(); if (!g) return;
    commentTimerRef.current = setTimeout(() => {
      commentTimerRef.current = null;
      const c = commentQueueRef.current.shift();
      if (c) {
        const isPurchase = PURCHASE_RE.test(c.text);
        const isFeedback = !isPurchase && FEEDBACK_RE.test(c.text);
        if (isPurchase && g.sfxAuto) playSfx("bell");
        speakNow("ask", `Penonton bernama "${cleanU(c.username)}" komen: "${c.text}". Sebut nama dia dulu, kemudian jawab.`);
        setCaptionText(`💬 ${cleanU(c.username)}: ${c.text}`);
        if (isFeedback && g.sfxAuto) setTimeout(() => playSfx("clap"), 4000);
        recordInteraction("reply", c.username, c.text);
        if (isPurchase) recordInteraction("purchase", c.username, c.text);
      }
      if (commentQueueRef.current.length) scheduleComment();
    }, randMs(g.commentDelayMin, g.commentDelayMax));
  }, [activeGreet, speakNow, playSfx, recordInteraction]);

  // THE BRAIN — a viewer event (extension OR manual sim) → greet/reply. JOIN is
  // deduped by username (greet once); follow/like/comment are NOT deduped.
  const QUEUE_CAP = 50; // drop excess when a like/comment storm outpaces the random-delay pacing
  const handleLiveEvent = useCallback((type: string, username: string, text = "", fromSim = false) => {
    if (!activeRef.current) return; // only while streaming
    const u = cleanU(username) || "Penonton";
    // SIM events log their own raw type (so a rehearsal shows on the dashboard);
    // REAL events arrive via the extension which already logged the raw type.
    if (fromSim) recordInteraction(type, u, text);
    if (type === "join") {
      const key = u.toLowerCase();
      if (greetedJoinsRef.current.has(key)) return;       // JOIN deduped by username
      greetedJoinsRef.current.add(key);
      if (greetQueueRef.current.length < QUEUE_CAP) { greetQueueRef.current.push({ username: u, kind: "join" }); scheduleGreet(); }
      else recordInteraction("skip", u);
    } else if (type === "follow") {
      if (greetQueueRef.current.length < QUEUE_CAP) { greetQueueRef.current.push({ username: u, kind: "follow" }); scheduleGreet(); }
      else recordInteraction("skip", u);
    } else if (type === "like") {
      if (greetQueueRef.current.length < QUEUE_CAP) { greetQueueRef.current.push({ username: u, kind: "like" }); scheduleGreet(); }
      else recordInteraction("skip", u);
    } else if (type === "comment" && text.trim()) {
      if (commentQueueRef.current.length < QUEUE_CAP) { commentQueueRef.current.push({ username: u, text: text.trim() }); scheduleComment(); }
      else recordInteraction("skip", u, text);
    }
  }, [scheduleGreet, scheduleComment, recordInteraction]);

  // Manual sim → the SAME brain (true rehearsal). "Name JOIN/FOLLOW/LIKE" |
  // "Name: comment" | plain comment.
  const sendChat = useCallback(() => {
    const t = chatText.trim(); if (!t) return;
    const name = cleanU(nameInput) || "Penonton";
    const kw = t.match(/^(JOIN|FOLLOW|LIKE)$/i);
    if (kw) handleLiveEvent(kw[1].toLowerCase(), name, "", true);
    else {
      const cm = t.match(/^([^:]{1,30}):\s*(.+)$/);
      if (cm) handleLiveEvent("comment", cm[1].trim(), cm[2].trim(), true);
      else handleLiveEvent("comment", name, t, true);
    }
    setChatText("");
  }, [chatText, nameInput, handleLiveEvent]);

  // Receive scraped events from the extension (direct in-browser message — no
  // server round-trip). The extension posts {__lh_event, type, username, text}.
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d && d.__lh_event && typeof d.type === "string") handleLiveEvent(d.type, d.username || "", d.text || "");
      // DURATION auto-end (extension) → stop the avatar stream + turn the GPU OFF
      // ($0). gpuOff is true ONLY for the duration auto-end; a manual STOP never
      // posts __lh_stop, so the avatar + GPU keep running on manual stop.
      else if (d && d.__lh_stop) {
        stopRef.current?.();
        if (d.gpuOff) {
          fetch("/api/livehost/gpu", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "off" }), keepalive: true,
          }).catch(() => {});
        }
      }
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, [handleLiveEvent]);

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

  // CLEAN OUTPUT MODE (for OBS): hides ALL panels/UI and shows ONLY the 1080x1920
  // stage on black, filling the window — so OBS captures a clean feed (no dashboard
  // chrome). Toggle in the UI, or load with ?output=1 to start clean.
  const [outputMode, setOutputMode] = useState(false);
  useEffect(() => {
    try { if (new URLSearchParams(window.location.search).get("output") === "1") setOutputMode(true); } catch {}
  }, []);

  const captionLine = playPos.l >= 0 ? curLines[playPos.l] : captionText;

  // Avatar BOTTOM crop (+feather) — soft-fade the avatar's lower body away so the
  // gesture body shows there. undefined when no crop = full avatar (unchanged).
  const avatarMask = avatarClipBottom > 0
    ? `linear-gradient(to top, transparent ${avatarClipBottom}%, #000 ${Math.min(100, avatarClipBottom + avatarFeather)}%)`
    : undefined;

  return (
    <div className={"lh-studio" + (outputMode ? " output" : "")}>
      <style dangerouslySetInnerHTML={{ __html: STUDIO_CSS }} />

      {/* Exit button — only visible in clean output mode (everything else hidden) */}
      {outputMode && (
        <button type="button" onClick={() => setOutputMode(false)}
          style={{ position: "fixed", top: 8, right: 8, zIndex: 100, padding: "6px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,.25)", background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 12, cursor: "pointer" }}>
          ✕ Exit output
        </button>
      )}

      {configErr && <div className="error" style={{ margin: "8px 0" }}>{configErr}</div>}

      {/* ============ LIVE VIEW ============ */}
      <div style={{ display: view === "live" ? undefined : "none", height: "100%" }}>
        <div className="grid">
          <div className="panel video-panel">
            <div className="video-wrap">
              <div className="stage" ref={stageRef}
                onPointerDown={onStagePointerDown} onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp} onPointerCancel={onStagePointerUp}>
                <video ref={videoRef} autoPlay playsInline style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`, WebkitMaskImage: avatarMask, maskImage: avatarMask }} />
                {!active && previewUrl && (
                  <img className="avatar-preview" src={previewUrl} alt="" draggable={false}
                    style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`, WebkitMaskImage: avatarMask, maskImage: avatarMask }} />
                )}
                {/* BODY LAYER (live) — green/blue keyed canvas, ABOVE the avatar
                    (covers its static lower body) but BELOW the overlay. crop-top
                    hides the Kling head so the AVTR-1 head shows above. Imported +
                    aligned HERE at Livehost (drag via stage when editLayer=body). */}
                {bodyUrl && (
                  <canvas ref={bodyCanvasRef} className="body-layer"
                    style={{
                      transform: `translate(${bodyOffsetX}%, ${bodyOffsetY}%) scale(${bodyZoom * bodyWidth}, ${bodyZoom})`,
                      // Soft-fade the top edge (transparent above the crop, fading in
                      // over `bodyFeather`%) so the head↔body seam BLENDS instead of a
                      // hard cut line. feather=0 → same as the old hard crop.
                      WebkitMaskImage: `linear-gradient(to bottom, transparent ${bodyClipTop}%, #000 ${Math.min(100, bodyClipTop + bodyFeather)}%)`,
                      maskImage: `linear-gradient(to bottom, transparent ${bodyClipTop}%, #000 ${Math.min(100, bodyClipTop + bodyFeather)}%)`,
                      pointerEvents: "none",
                    }} />
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
                  // Locked = already played/playing while live → can't drag/move it.
                  const locked = scriptPlaying && playPos.s >= 0 && i <= playPos.s;
                  return (
                    <div key={`${id}-${i}`}
                      className={`queue-item ${playing ? "now" : done ? "done" : ""} ${dragOverIdx === i ? "drag-over" : ""} ${locked ? "" : "draggable"}`}
                      draggable={!locked}
                      onDragStart={(e) => { dragIndexRef.current = i; e.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={(e) => { if (dragIndexRef.current === null) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOverIdx !== i) setDragOverIdx(i); }}
                      onDragLeave={() => { if (dragOverIdx === i) setDragOverIdx(null); }}
                      onDrop={(e) => { e.preventDefault(); if (dragIndexRef.current !== null) reorderRundown(dragIndexRef.current, i); dragIndexRef.current = null; setDragOverIdx(null); }}
                      onDragEnd={() => { dragIndexRef.current = null; setDragOverIdx(null); }}>
                      <span className="queue-title">{locked ? "" : <span className="drag-grip" aria-hidden>⠿</span>}{i + 1}. {sc ? sc.title : "(deleted)"}</span>
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
                {scripts.filter((s) => s.saved && s.audioUrls?.length).map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
              </select>
              {!active && (
                <label className="dur-row" style={{ cursor: "pointer" }} title="Loop semua skrip sampai live tamat. Uncheck = main sekali sahaja. Durasi & End LIVE dikawal di extension TikTok.">
                  <input type="checkbox" checked={scriptLoop}
                    onChange={(e) => { setScriptLoop(e.target.checked); loopRef.current = e.target.checked; }} />
                  <span>🔁 Enable loop</span>
                  <span className="hint">{scriptLoop ? "→ ulang semua skrip sampai live tamat" : "→ main sekali sahaja"}</span>
                </label>
              )}
              <div className="loop-row">
                {/* IDLE state: ONLY ▶ Start is rendered. Stop/teleprompter-finish do NOT kill the GPU —
                    the 10-min idle watchdog keeps it warm so this ▶ Start restarts INSTANTLY; only after
                    10 min of no streaming do pings stop → Novita scales the worker to $0. */}
                {!active ? (
                  /* Start is enabled the moment the GPU is RUNNING (turned on at
                     Usage). gpuWarm may still be "idle" because the studio no
                     longer auto-warms — start() assigns + connects on click. */
                  <button className="restart-btn go" onClick={start}
                    disabled={connecting || (gpuWarm !== "ready" && serverState !== "running")}
                    title={gpuWarm === "ready" || serverState === "running" ? "Start streaming" : "Hidupkan GPU di tab Usage dahulu…"}>
                    {connecting ? "… Connecting" : gpuWarm === "warming" ? "⏳ Menyambung…" : serverState === "starting" ? "⏳ GPU menyala…" : "▶ Start"}
                  </button>
                ) : (
                  /* STREAMING state: Start is HIDDEN; only Stop + Pause/Restart are rendered.
                     Looping is driven by the live-duration timer (rotates the rundown until
                     the set time elapses), so the manual loop toggle was removed. */
                  <>
                    <button className="restart-btn stop-live" onClick={stop} title="Stop streaming (GPU → idle $0)">■ Stop</button>
                    <button className="restart-btn" onClick={scriptPaused ? resumeRundown : pauseRundown}
                      disabled={!scriptPlaying && !scriptPaused} title="Pause / Resume">
                      {scriptPaused ? "▶" : "⏸"}
                    </button>
                    <button className="restart-btn" onClick={restartRundown} title="Restart script">⟳</button>
                  </>
                )}
              </div>
              {/* Status / error line — GPU wake + connection feedback on Start */}
              <div className="rundown-status">
                {wakeMsg && <div className="status-line">{wakeMsg}</div>}
                {error && <div className="error">{error}</div>}
                {!wakeMsg && !error && active && <div className="status-line">● Live · GPU {serverState}</div>}
                {!wakeMsg && !error && !active && gpuWarm === "warming" && <div className="status-line">⏳ Menghidupkan GPU… boot kali pertama ~7-8 minit — Button Play muncul automatik bila siap</div>}
                {!wakeMsg && !error && !active && gpuWarm === "ready" && <div className="status-line" style={{ color: "#16a34a" }}>✓ GPU Ready — tekan ▶ Start</div>}
                {!wakeMsg && !error && !active && gpuWarm === "idle" && <div className="hint">GPU: {serverState}</div>}
                {scriptWaiting && <div className="status-line">⏸ Selesai — tunggu skrip lagi…</div>}
              </div>
            </div>

            <div className="prompter-col">
              <div className="label">
                Teleprompter{curScript ? ` — ${curScript.title}` : ""}{playPos.l >= 0 ? ` (${playPos.l + 1}/${curLines.length})` : ""}
                {active && liveTimer && (
                  <span className="live-timer" title={liveEndAtRef.current > 0 ? "Masa baki (auto-stop bila 0)" : "Masa berjalan"}>
                    {liveEndAtRef.current > 0 ? "⏳" : "⏱"} {liveTimer}
                  </span>
                )}
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

            {/* Avatar fit — head Zoom (CSS on the live video; never touches lipsync) */}
            {(previewUrl || active) && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
                  <span style={{ width: 64 }}>Zoom</span>
                  <input type="range" min="0.5" max="2.4" step="0.02" value={zoom}
                    onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ flex: 1 }} />
                </label>
                <button type="button" className="filebtn secondary" style={{ marginTop: 0 }}
                  onClick={() => { setOffsetX(0); setOffsetY(0); setZoom(1); }}>↺ Reset avatar</button>
                <div className="hint" style={{ marginTop: 0 }}>Seret kepala avatar + Zoom untuk besar/kecil. (Tak ganggu lipsync.)</div>
              </div>
            )}

            {/* CLEAN OUTPUT for OBS — hides all UI, shows only the 1080x1920 stage */}
            <button type="button" className="filebtn secondary" style={{ marginTop: 8 }}
              onClick={() => setOutputMode(true)}>
              🖥 Output mode (OBS) — paparan bersih
            </button>

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

            {/* Setup links — TikTok dashboard + SplitCam (virtual camera for
                routing the avatar into TikTok LIVE Studio). */}
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <a href="https://shop.tiktok.com/streamer/live/product/dashboard" target="_blank" rel="noopener noreferrer"
                className="filebtn" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#000", color: "#fff", border: "1px solid rgba(255,255,255,.22)", boxShadow: "none" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
                </svg>
                TikTok Live
              </a>
              <a href="https://splitcam.com/download" target="_blank" rel="noopener noreferrer"
                className="filebtn" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                🎥 SplitCam
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ============ TEMPLATE VIEW ============ */}
      {/* 100% copy of the live-host SCREEN + avatar / template / fit controls.
          Shares state with the live view, so composing here is exactly what
          streams in the Livehost tab. */}
      <div style={{ display: view === "template" ? undefined : "none", height: "100%", overflowY: "auto" }}>
        <div className="grid lh-tpl-grid">
          <div className="panel video-panel" style={{ justifyContent: "center" }}>
            <div className="video-wrap">
              <div className="stage" ref={templateStageRef}
                onPointerDown={onStagePointerDown} onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp} onPointerCancel={onStagePointerUp}>
                {/* Template tab = static design surface. Show the avatar STILL
                    image always (even while live) — never the live video. */}
                <video ref={templateVideoRef} autoPlay playsInline muted style={{ display: "none" }} />
                {previewUrl && (
                  <img className="avatar-preview" src={previewUrl} alt="" draggable={false}
                    style={{ transform: `translate(${offsetX}%, ${offsetY}%) scale(${zoom})` }} />
                )}
                {/* Template = avatar + overlay only. Body is added at Livehost. */}
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
              <div style={{ display: "flex", gap: 8, marginTop: 0 }}>
                <button type="button" className="filebtn secondary" style={{ flex: 1, marginTop: 0 }} disabled={uploading}
                  onClick={() => setAvatarPickerOpen(true)}>
                  {uploading ? "Processing…" : "🖼 Pick avatar from Attachments"}
                </button>
                {avatarId && (
                  <button type="button" className="filebtn secondary" style={{ flex: "0 0 auto", marginTop: 0, width: 44, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#ff9aa8" }} title="Buang avatar"
                    onClick={() => { setAvatarId(""); setPreviewUrl(""); setStockSel(""); }}>✕</button>
                )}
              </div>
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
                {overlayUrl && (
                  <button type="button" className="filebtn secondary" style={{ flex: "0 0 auto", marginTop: 0, width: 44, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#ff9aa8" }} title="Buang template"
                    onClick={() => { setOverlaySel(""); setCustomOverlay(""); }}>✕</button>
                )}
              </div>
              <div className="hint">Edit di Canva → <b>Share</b> → <b>Download</b> → File Type <b>PNG</b> → <b>Select Pages</b> Edit → <b>Download</b> → Upload <b>Attachment</b> balik.</div>

              {/* Avatar fit — drag the avatar on screen + zoom. Body is added at
                  LIVEHOST (after the avatar is streaming) so it aligns to the live
                  position — composing it here against a still image caused drift. */}
              <div className="label">Avatar fit — drag the avatar on screen to move it</div>
              <button type="button" className="filebtn secondary" onClick={() => { setOffsetX(0); setOffsetY(0); setZoom(1); }}>
                ↺ Reset position
              </button>
              <div className="range-row"><span>Zoom</span>
                <input type="range" min="0.5" max="2" step="0.02" value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} />
              </div>
              <div className="hint">Body (gesture) ditambah di tab <b>Livehost</b> selepas avatar live.</div>

              <button type="button" className="filebtn" style={{ marginTop: 14, opacity: previewUrl && overlayUrl ? 1 : 0.5, cursor: previewUrl && overlayUrl ? "pointer" : "not-allowed" }}
                disabled={!previewUrl || !overlayUrl} onClick={saveCurrentTemplate}>
                💾 Save current as template
              </button>
              {(!previewUrl || !overlayUrl) && (
                <div className="hint" style={{ marginTop: 6 }}>Perlu pilih <b>Avatar</b> {!previewUrl ? "❌" : "✓"} dan <b>Template</b> {!overlayUrl ? "❌" : "✓"} dahulu.</div>
              )}
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
              <p className="text-xs mt-0.5" style={{ color: "#888" }}>Tulis skrip → Generate → Save → tambah ke Rundown.</p>
            </div>
            <LhButton onClick={() => setScriptEditId(addScript())}>➕ New script</LhButton>
          </div>

          <LhCard>
            <LhCardHeader icon="📁" title={`Semua Scripts (${scripts.length})`} />
            {scripts.length === 0 ? (
              <p className="text-sm" style={{ color: "#888" }}>Tiada skrip lagi. Tekan ➕ New script untuk mula.</p>
            ) : (
              <LhGrid>
                {scripts.map((s) => {
                  const inRundown = rundown.includes(s.id);
                  const hasAudio = !!s.audioUrls?.length;
                  return (
                    <div key={s.id} onClick={() => setScriptEditId(s.id)} title="Klik untuk edit"
                      style={{ position: "relative", cursor: "pointer", borderRadius: 14, padding: "12px 14px", minHeight: 92,
                        background: "#fafaf7", border: `1px solid ${s.saved ? "#86efac" : "#e8e0d8"}` }}>
                      <button type="button" title="Padam" onClick={(e) => { e.stopPropagation(); deleteScript(s.id); }}
                        style={{ position: "absolute", top: 8, right: 8, border: "1px solid #f3c0c0", background: "#fff0f0", color: "#e23", borderRadius: 8, padding: "3px 7px", fontSize: 11, cursor: "pointer" }}>🗑</button>
                      <div style={{ fontWeight: 800, fontSize: 13, paddingRight: 30, color: "#1a1a1a" }}>{s.title || "Tanpa tajuk"}</div>
                      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginTop: 2, color: s.saved ? "#16a34a" : "#b45309" }}>
                        {s.saved ? "● saved" : "draf"}{inRundown ? " · rundown" : ""}{hasAudio ? " · 🔊" : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "#888", marginTop: 4, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{s.text || "Kosong…"}</div>
                    </div>
                  );
                })}
              </LhGrid>
            )}
          </LhCard>
        </LhSection>

        <LhModal open={!!scriptEditId} onClose={() => { stopPreview(); setScriptEditId(null); }} title="Script" maxWidth={680}>
          {(() => {
            const s = scripts.find((x) => x.id === scriptEditId);
            if (!s) return null;
            const inRundown = rundown.includes(s.id);
            const words = s.text.split(/\s+/).filter(Boolean);
            const onCount = previewPlayId === s.id ? Math.round(previewFrac * words.length) : -1;
            const hasAudio = !!s.audioUrls?.length;
            return (
              <>
                <LhLabel>Tajuk skrip</LhLabel>
                <input style={{ ...LH_FIELD_STYLE, fontWeight: 800 }} value={s.title}
                  onChange={(e) => { updateScript(s.id, { title: e.target.value }); autosaveScript(s.id, { title: e.target.value }); }} />
                <div style={{ marginTop: 14 }}><LhLabel>Dialog</LhLabel></div>
                <textarea style={{ ...LH_FIELD_STYLE, minHeight: 130, resize: "vertical" }} rows={5} placeholder="Tulis dialog skrip di sini…"
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
                  <span style={{ width: 120 }}>Speed {s.speed.toFixed(2)}×</span>
                  <input type="range" min="0.7" max="1.5" step="0.05" value={s.speed} onChange={(e) => updateScript(s.id, { speed: parseFloat(e.target.value) })} style={{ flex: 1, accentColor: "#f59e0b" }} />
                </div>

                <div className="flex flex-wrap gap-2 mt-4">
                  <LhButton onClick={() => generateScript(s.id)} disabled={s.generating || !s.text.trim()}>{s.generating ? "⏳ Generating…" : "🎙 Generate"}</LhButton>
                  <LhButton variant="ghost" onClick={() => playSaved(s.id)} disabled={!hasAudio}>{previewPlayId === s.id ? "■ Stop" : "▶ Play"}</LhButton>
                  <LhButton variant="ghost" onClick={() => saveScript(s.id)} disabled={!s.audioPaths?.length || s.saved || s.saving}>{s.saving ? "⏳ Saving…" : s.saved ? "💾 Saved" : "💾 Save"}</LhButton>
                  <LhButton variant="ghost" onClick={() => downloadMp3(s.id)} disabled={!hasAudio || downloadingId === s.id}>{downloadingId === s.id ? "⏳ …" : "⬇ MP3"}</LhButton>
                </div>

                {previewPlayId === s.id && (
                  <div style={{ marginTop: 12 }}>
                    <input type="range" min={0} max={1} step={0.001} value={previewFrac}
                      onChange={(e) => seekPreview(parseFloat(e.target.value))}
                      style={{ width: "100%", accentColor: "#f59e0b" }} />
                    <div className="flex items-center justify-between" style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                      <span>{fmtAudioTime(previewFrac * previewDur)}</span>
                      <span>{fmtAudioTime(previewDur)}</span>
                    </div>
                  </div>
                )}
                {previewPlayId === s.id && (
                  <div style={{ marginTop: 10, maxHeight: 140, overflowY: "auto", background: "#fafaf7", border: "1px solid #e8e0d8", borderRadius: 10, padding: 12, fontSize: 15, lineHeight: 1.6 }}>
                    {words.map((w, wi) => (<span key={wi} style={{ color: wi < onCount ? "#f59e0b" : "#1a1a1a", fontWeight: wi < onCount ? 800 : 500 }}>{w} </span>))}
                  </div>
                )}
                <p className="text-[11px] mt-3" style={{ color: "#888" }}>
                  {(s.chars ?? s.text.length)} aksara{inRundown ? " • dalam rundown" : ""}
                  {hasAudio ? " • 🔊 audio siap" : " • belum generate"}
                  {!s.saved && hasAudio ? " — tekan Save" : ""}
                </p>
              </>
            );
          })()}
        </LhModal>
      </div>

      {/* ============ PRODUCTS VIEW (library) ============ */}
      <div style={{ display: view === "products" ? undefined : "none" }}>
        <LhSection>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-extrabold text-xl tracking-tight" style={{ color: "#1a1a1a" }}>Knowledge</h2>
              <p className="text-xs mt-0.5" style={{ color: "#888" }}>AI jawab chat guna HANYA knowledge yang aktif.</p>
            </div>
            <LhButton onClick={() => setKbDraft({ id: null, title: `Produk ${products.length + 1}`, text: "" })}>➕ Knowledge baru</LhButton>
          </div>

          <LhCard>
            <LhCardHeader icon="📁" title={`Semua Knowledge (${products.length})`} />
            {products.length === 0 ? (
              <p className="text-sm" style={{ color: "#888" }}>Tiada knowledge lagi. Tekan ➕ Knowledge baru untuk mula.</p>
            ) : (
              <LhGrid>
                {products.map((pp) => {
                  const isActive = pp.id === activeProductId;
                  return (
                    <div key={pp.id} onClick={() => setKbDraft({ id: pp.id, title: pp.title, text: pp.text })} title="Klik untuk edit"
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
            )}
          </LhCard>
        </LhSection>

        <LhModal open={!!kbDraft} onClose={() => setKbDraft(null)} title="Knowledge">
          {kbDraft && (
            <>
              <LhLabel>Tajuk</LhLabel>
              <input style={LH_FIELD_STYLE} value={kbDraft.title} onChange={(e) => setKbDraft({ ...kbDraft, title: e.target.value })} />
              <div style={{ marginTop: 14 }}><LhLabel>Knowledge — avatar guna untuk jawab</LhLabel></div>
              <textarea style={{ ...LH_FIELD_STYLE, minHeight: 240, resize: "vertical" }} rows={12}
                placeholder={"Compact Powder — RM19.90...\nFoundation — RM49.90...\nVoucher: RM25 checkout masa live."}
                value={kbDraft.text} onChange={(e) => setKbDraft({ ...kbDraft, text: e.target.value })} />
              <div className="flex items-center justify-end mt-4">
                <LhButton onClick={() => {
                  const d = kbDraft;
                  if (d.id) {
                    updateProduct(d.id, { title: d.title, text: d.text });
                    setActiveProductId(d.id);
                  } else {
                    const id = "p" + Date.now().toString(36);
                    setProducts((prev) => [...prev, { id, title: d.title || `Produk ${prev.length + 1}`, text: d.text }]);
                    setActiveProductId(id);
                  }
                  setKbDraft(null);
                }} style={{ background: "#16a34a", color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(22,163,74,.3)" }}>💾 Save</LhButton>
              </div>
            </>
          )}
        </LhModal>
      </div>

      {/* ============ USAGE VIEW ============ */}
      <div style={{ display: view === "usage" ? undefined : "none" }}>
        <div className="space-y-6 max-w-[1400px] mx-auto px-1 sm:px-2 py-2">
          {/* GPU power — dedicated GPU on/off (admin must appoint first) */}
          <LivehostGpu />
          {/* Stats summary — radial-glow cards (match the main Usage tab).
              NOTE: inline-style grid (NOT className="grid") — the studio's
              own `.lh-studio .grid` rule would otherwise force 100vh height
              + 1.9fr/0.7fr columns and stretch these cards. */}
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {[
              { label: "Cost Audio Script", value: usageData?.costs ? `RM ${usageData.costs.audioScript.cost.toFixed(2)}` : "—", suffix: `${(usageData?.costs?.audioScript.chars ?? 0).toLocaleString()} aksara · ${usageData?.costs?.audioScript.generations ?? 0} generate`, glow: "rgba(59,130,246,0.12)", cls: "text-blue-500" },
              { label: "Cost Live", value: usageData?.costs ? `RM ${usageData.costs.live.cost.toFixed(2)}` : "—", suffix: `${Math.floor((usageData?.costs?.live.streamSec || 0) / 3600)}h ${Math.floor(((usageData?.costs?.live.streamSec || 0) % 3600) / 60)}m · ${usageData?.costs?.live.sessions ?? 0} live`, glow: "rgba(236,72,153,0.12)", cls: "text-pink-500" },
              { label: "Cost NON Live", value: usageData?.costs ? `RM ${usageData.costs.nonLive.cost.toFixed(2)}` : "—", suffix: `${usageData?.costs?.nonLive.sessions ?? 0} sesi + idle ${Math.floor((usageData?.costs?.nonLive.idleSec || 0) / 60)}m`, glow: "rgba(245,158,11,0.12)", cls: "text-amber-500" },
              { label: "Cost Comment", value: usageData?.costs ? `RM ${usageData.costs.comment.cost.toFixed(2)}` : "—", suffix: `${(usageData?.costs?.comment.chars ?? 0).toLocaleString()} aksara balas komen`, glow: "rgba(34,197,94,0.12)", cls: "text-emerald-500" },
              { label: "Cost Avatar", value: usageData?.costs ? `RM ${(usageData.costs.avatar?.cost ?? 0).toFixed(2)}` : "—", suffix: `${usageData?.costs?.avatar?.generations ?? 0} imej dijana`, glow: "rgba(168,85,247,0.12)", cls: "text-purple-500" },
              { label: "Cost Template Body", value: usageData?.costs ? `RM ${(usageData.costs.templateBody?.cost ?? 0).toFixed(2)}` : "—", suffix: `${usageData?.costs?.templateBody?.generations ?? 0} video dijana`, glow: "rgba(99,102,241,0.12)", cls: "text-indigo-500" },
              { label: "Baki kredit", value: usageData?.balance ? `RM ${usageData.balance.available.toFixed(2)}` : "—", suffix: `min RM${usageData?.balance?.minBalance ?? 5}`, glow: usageData?.balance?.low ? "rgba(239,68,68,0.18)" : "rgba(34,197,94,0.12)", cls: usageData?.balance?.low ? "text-red-500" : "text-emerald-500" },
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
              <span>🎙 Audio Script: RM {(usageData.costs?.audioScript.cost ?? 0).toFixed(2)} · {(usageData.costs?.audioScript.chars ?? 0).toLocaleString()} aksara · RM {usageData.rates.audioRateGen.toFixed(2)}/1k aksara</span>
              <span>🔴 Live: RM {(usageData.costs?.live.cost ?? 0).toFixed(2)} · GPU RM {usageData.rates.gpuRateHour.toFixed(2)}/jam</span>
              <span>🧪 NON Live: RM {(usageData.costs?.nonLive.cost ?? 0).toFixed(2)} (incl. idle RM {(usageData.costs?.nonLive.idleCost ?? 0).toFixed(2)})</span>
              <span>💬 Comment: RM {(usageData.costs?.comment.cost ?? 0).toFixed(2)} · RM {usageData.rates.voiceRate1k.toFixed(2)}/1k</span>
              <span>🖼 Avatar: RM {(usageData.costs?.avatar?.cost ?? 0).toFixed(2)} · {usageData.costs?.avatar?.generations ?? 0} imej</span>
              <span>🕺 Template Body: RM {(usageData.costs?.templateBody?.cost ?? 0).toFixed(2)} · {usageData.costs?.templateBody?.generations ?? 0} video</span>
              <span>💰 Jumlah: RM {(usageData.costs?.total ?? usageData.month.totalCost).toFixed(2)}</span>
            </div>
          )}

          {/* Sessions table card */}
          <div className="card p-0 overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--color-border)] flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] font-bold">Ledger caj</span>
              <span className="ml-auto text-xs text-[var(--color-text-muted)]">setiap caj · baki berjalan</span>
            </div>
            <div className="hidden md:flex px-6 py-3 border-b border-[var(--color-border)] text-xs font-mono uppercase tracking-wider text-[var(--color-text-muted)] font-bold" style={{ background: "rgba(200,245,62,0.04)" }}>
              <span className="flex-1">Tarikh / Masa</span>
              <span className="w-28">Jenis</span>
              <span className="w-24">Durasi</span>
              <span className="w-24 text-right">Kos</span>
              <span className="w-28 text-right">Baki Kredit</span>
            </div>
            {(!usageData || usageData.ledger.length === 0) ? (
              <div className="px-6 py-16 text-center">
                <p className="text-[var(--color-text-secondary)] font-medium mb-1">{usageData ? "Belum ada caj." : "Loading…"}</p>
                <p className="text-sm text-[var(--color-text-muted)]">Setiap live, audio & komen akan direkod di sini.</p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-border)]">
                {usageData.ledger.map((r, i) => {
                  const tc = r.type === "live" ? { bg: "rgba(236,72,153,0.14)", c: "#ec4899" }
                    : r.type === "audioScript" ? { bg: "rgba(59,130,246,0.14)", c: "#3b82f6" }
                    : r.type === "avatar" ? { bg: "rgba(168,85,247,0.14)", c: "#a855f7" }
                    : { bg: "rgba(245,158,11,0.14)", c: "#f59e0b" }; // nonLive
                  return (
                    <li key={i} className="px-6 py-4 flex flex-col md:flex-row md:items-center gap-1.5 md:gap-3 text-sm">
                      <span className="flex-1 font-mono text-xs text-[var(--color-text-secondary)]">{new Date(r.at).toLocaleString("ms-MY", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                      <span className="w-28">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider" style={{ background: tc.bg, color: tc.c }}>{r.typeLabel}</span>
                      </span>
                      <span className="w-24 font-mono text-xs text-[var(--color-text-primary)]">{r.durationSec > 0 ? `${Math.floor(r.durationSec / 3600)}:${String(Math.floor((r.durationSec % 3600) / 60)).padStart(2, "0")}:${String(r.durationSec % 60).padStart(2, "0")}` : "—"}</span>
                      <span className="w-24 md:text-right text-xs font-bold text-emerald-500">RM {r.cost.toFixed(2)}</span>
                      <span className="w-28 md:text-right text-xs font-bold text-[var(--color-text-primary)]">RM {r.balanceAfter.toFixed(2)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* BODY source <video> at the component ROOT (NOT inside a display:none
          view) so it keeps decoding regardless of the active tab — the render
          loop reads it + blits the keyed frame to both stage canvases. */}
      {bodyUrl && (
        // Route through the same-origin proxy so getImageData (chroma-key) isn't
        // blocked by the B2 host's missing CORS header (else the canvas is blank).
        <video ref={bodyVideoRef}
          src={bodyUrl.startsWith("http") ? `/api/proxy-video?url=${encodeURIComponent(bodyUrl)}` : bodyUrl}
          crossOrigin="anonymous" autoPlay loop muted playsInline
          style={{ position: "fixed", left: 0, top: 0, width: 2, height: 2, opacity: 0.01, pointerEvents: "none", zIndex: -1 }} />
      )}

      {/* Attachment pickers — avatar + overlay/template now come from the
          PeningLab Attachments library (Portal-rendered, app-styled). */}
      <AttachmentPicker
        open={avatarPickerOpen}
        onClose={() => setAvatarPickerOpen(false)}
        title="Pick avatar from Attachments"
        defaultCategory="avatar"
        categories={["avatar"]}
        pngOnly
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
        pngOnly
        autoTransparent
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

      {/* Body picker (Livehost) — pick a Template Body gesture clip to composite
          as a chroma-keyed body layer under the avatar head. */}
      {bodyPickerOpen && (
        <div onClick={() => setBodyPickerOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,.75)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 780, maxHeight: "85vh", overflowY: "auto", background: "#0a0a0c", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="label" style={{ margin: 0 }}>🎬 Pick body (gesture)</div>
              <button className="restart-btn" onClick={() => setBodyPickerOpen(false)}>✕</button>
            </div>
            {bodyClips.length === 0 ? (
              <div className="hint" style={{ marginTop: 12 }}>Belum ada body. Pergi tab <b>Template Body</b>, generate body gesture (background hijau/biru), kemudian pilih di sini.</div>
            ) : (
              <div className="tpl-grid">
                {bodyClips.map((b) => (
                  <button key={b.id} type="button" className="tpl-saved-card"
                    style={{ cursor: "pointer", padding: 0, border: "none", background: "none" }}
                    onClick={() => {
                      setBodyUrl(b.url);
                      setBodyKey(b.bgColor === "blue" ? "blue" : b.bgColor === "green" ? "green" : "auto");
                      setBodyOffsetX(0); setBodyOffsetY(0); setBodyZoom(1); setBodyClipTop(22); setEditLayer("body");
                      setBodyPickerOpen(false);
                    }}>
                    <video src={b.url + "#t=1"} muted preload="metadata" poster={b.poster || undefined}
                      style={{ width: "100%", borderRadius: 8, display: "block", background: "#000" }} />
                  </button>
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
.lh-studio .grid.lh-tpl-grid{grid-template-columns:2.3fr 0.7fr;}
@media (max-width:1100px){.lh-studio .grid{grid-template-columns:1fr;height:auto;min-height:0;}.lh-studio .grid.lh-tpl-grid{grid-template-columns:1fr;}}
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
.lh-studio .stage canvas.body-layer{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:center center;}
.lh-studio .stage canvas.body-layer.editing{outline:2px dashed #818cf8;outline-offset:-2px;}
.lh-studio .stage:fullscreen{height:100vh;width:auto;aspect-ratio:9/16;border-radius:0;}
/* CLEAN OUTPUT MODE — only the 9:16 stage on black, everything else hidden (for OBS capture) */
.lh-studio.output{background:#000;border-radius:0;height:100vh;overflow:hidden;}
.lh-studio.output .error{display:none;}
.lh-studio.output .grid{display:block;height:100vh;gap:0;padding:0;}
.lh-studio.output .grid > .panel:not(.video-panel){display:none;}
.lh-studio.output .video-panel{position:fixed;inset:0;padding:0;margin:0;background:#000;border:none;border-radius:0;height:100vh;width:100vw;}
.lh-studio.output .video-wrap{width:100%;height:100%;display:flex;align-items:center;justify-content:center;}
.lh-studio.output .stage{height:100vh;width:auto;aspect-ratio:9/16;border-radius:0;}
.lh-studio .placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#6b7596;font-size:14px;text-align:center;padding:24px;}
.lh-studio .captions{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);max-width:80%;background:rgba(0,0,0,.72);padding:8px 14px;border-radius:10px;font-size:18px;text-align:center;backdrop-filter:blur(4px);}
.lh-studio .queue-col{width:230px;flex:none;display:flex;flex-direction:column;min-width:0;min-height:0;}
.lh-studio .prompter-col{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}
.lh-studio .queue-col .label,.lh-studio .prompter-col .label{margin-top:0;}
.lh-studio .queue-col select{margin-top:8px;font-size:12px;}
.lh-studio .queue-list{flex:1;min-height:0;overflow-y:auto;background:rgba(0,0,0,.32);border:1px solid var(--border-s);border-radius:12px;padding:6px;}
.lh-studio .queue-item{display:flex;align-items:center;justify-content:space-between;gap:4px;padding:7px 9px;border-radius:9px;font-size:12px;color:var(--text);transition:background .15s;}
.lh-studio .queue-item:hover{background:rgba(99,102,241,.1);}
.lh-studio .queue-item.draggable{cursor:grab;}
.lh-studio .queue-item.draggable:active{cursor:grabbing;}
.lh-studio .queue-item.drag-over{box-shadow:inset 0 2px 0 0 #818cf8;background:rgba(99,102,241,.18);}
.lh-studio .drag-grip{display:inline-block;margin-right:6px;color:#818cf8;font-weight:700;letter-spacing:-1px;opacity:.75;cursor:grab;}
.lh-studio .queue-item.now{background:var(--grad);color:#fff;font-weight:700;box-shadow:0 6px 16px -6px rgba(99,102,241,.7);}
.lh-studio .queue-item.done{color:#5b6480;}
.lh-studio .queue-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.lh-studio .queue-btns{display:flex;gap:2px;flex-shrink:0;}
.lh-studio .queue-btns button{padding:2px 5px;font-size:11px;background:rgba(255,255,255,.1);color:inherit;border-radius:5px;border:none;cursor:pointer;}
.lh-studio .queue-btns button:hover{background:rgba(255,255,255,.24);}
.lh-studio .loop-row{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:10px;}
.lh-studio .dur-row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:10px;font-size:12px;color:#a9b4d6;}
.lh-studio .dur-row .dur-label{font-weight:800;letter-spacing:.04em;}
.lh-studio .dur-row input{width:52px;text-align:center;padding:4px 6px;border-radius:8px;border:1px solid var(--border-s);background:rgba(0,0,0,.32);color:inherit;font-variant-numeric:tabular-nums;}
.lh-studio .dur-row .hint{flex-basis:100%;font-size:11px;opacity:.7;}
.lh-studio .live-timer{margin-left:auto;font-weight:800;font-variant-numeric:tabular-nums;color:#7ee08a;letter-spacing:.02em;text-transform:none;font-size:12px;}
.lh-studio .restart-btn{background:rgba(255,255,255,.05);border:1px solid var(--border-s);color:var(--text);border-radius:9px;padding:7px 9px;font-size:12px;cursor:pointer;transition:all .15s;}
.lh-studio .restart-btn:hover{border-color:var(--accent);background:rgba(99,102,241,.14);transform:translateY(-1px);}
.lh-studio .restart-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;}
.lh-studio .restart-btn.go{background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border-color:transparent;font-weight:800;box-shadow:0 8px 18px -8px rgba(34,197,94,.7);flex:1;}
.lh-studio .restart-btn.stop-live{background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border-color:transparent;font-weight:800;box-shadow:0 8px 18px -8px rgba(239,68,68,.7);}
.lh-studio .restart-btn.stop-live:hover{transform:translateY(-1px);background:linear-gradient(135deg,#f05252,#e02424);}
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
