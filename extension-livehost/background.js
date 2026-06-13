// PeningLab Livehost Extension — service worker.
// Watches TikTok Shop LIVE (content.js) and drives the client's AI avatar:
// every spoken line goes through PeningLab -> the client's GPU -> lip-synced
// avatar voice. Logic mirrors the proven extension-aihost:
//   - greetings rotate SEQUENTIALLY through N lines, [username] replaced,
//     each fired after a random delay in [greetDelayMin, greetDelayMax]s
//   - follow -> 👏 clap + followGreeting ; like -> likeGreeting
//   - comments -> avatar replies (box LLM + Product Knowledge, focused on
//     selectedProduct), spaced by random [commentDelayMin, commentDelayMax]s
//   - purchase comment (DONE/dah beli/checkout) -> 🔔 bell then voice
//   - feedback comment (best/sedap/berkesan...) -> voice then 👏 clap
// Stats (seen/replied/skipped/joins/greeted/follows/likes/purchases) are
// batched to PeningLab for the client's Interactions dashboard.

const BASE = "https://peninglab.com";
const QUEUE_CAP = 50;

const PURCHASE_RE = /\b(done|dah\s*beli|sudah\s*beli|checkout|dah\s*order|ordered?|dah\s*bayar)\b/i;
const FEEDBACK_RE = /\b(best|sedap|berkesan|terbaik|memang\s*bagus|puas\s*hati|recommended)\b/i;

let running = false;
let token = "";
let config = null;
let stats = null;
let greetQueue = [];   // {username, kind: join|follow|like}
let commentQueue = []; // {username, text}
let greetIdx = 0;      // sequential rotation pointer
let greetTimer = null;
let commentTimer = null;
let pendingEvents = []; // batched -> /api/livehost/interactions
let flushTimer = null;

function freshStats() {
  return { seen: 0, replied: 0, skipped: 0, joins: 0, greeted: 0, follows: 0, likes: 0, purchases: 0 };
}

function rand(min, max) {
  const a = Math.min(min, max), b = Math.max(min, max);
  return (a + Math.random() * (b - a)) * 1000;
}

function cleanUsername(u) {
  return String(u || "").replace(/[*_~`]/g, "").trim().slice(0, 40);
}

async function api(path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---- speech: everything the avatar says goes through here -----------------
async function speak(kind, text) {
  const d = await api("/api/livehost/speak", { token, kind, text });
  if (!d.ok) console.warn("[Livehost] speak failed:", d);
  return !!d.ok;
}

// ---- SFX via offscreen document (OBS captures desktop/tab audio) ----------
async function ensureOffscreen() {
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Play bell/clap sound effects for TikTok Live",
      });
    }
  } catch (e) {}
}
function playSfx(name) {
  if (config && config.sfxAuto === false) return;
  chrome.runtime.sendMessage({ type: "PLAY_SFX", sfx: name }).catch(() => {});
}

// ---- stats + interaction recording ----------------------------------------
function record(type, username = "", text = "") {
  pendingEvents.push({ type, username, text });
  if (pendingEvents.length >= 25) flushEvents();
}
async function flushEvents() {
  if (!pendingEvents.length || !token) return;
  const batch = pendingEvents.splice(0, 200);
  api("/api/livehost/interactions", { token, events: batch });
}
function broadcast() {
  chrome.runtime.sendMessage({ type: "STATS", stats, running }).catch(() => {});
  chrome.storage.local.set({ lhStats: stats, lhRunning: running });
}

// ---- greeting loop: sequential rotation + random min/max delay ------------
function scheduleGreet() {
  if (!running || greetTimer) return;
  greetTimer = setTimeout(async () => {
    greetTimer = null;
    if (!running) return;
    const item = greetQueue.shift();
    if (item) {
      let line = "";
      if (item.kind === "follow") line = config.followGreeting;
      else if (item.kind === "like") line = config.likeGreeting;
      else {
        const lines = (config.greetings || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
        if (lines.length) {
          line = lines[greetIdx % lines.length]; // SEQUENTIAL rotation
          greetIdx++;
        }
      }
      if (line) {
        const text = line.replaceAll("[username]", cleanUsername(item.username));
        if (await speak("say", text)) {
          stats.greeted++;
          record("greet", item.username, text);
          broadcast();
        }
      }
    }
    if (greetQueue.length) scheduleGreet();
  }, rand(config.greetDelayMin, config.greetDelayMax));
}

// ---- comment loop: random min/max delay between replies -------------------
function scheduleComment() {
  if (!running || commentTimer) return;
  commentTimer = setTimeout(async () => {
    commentTimer = null;
    if (!running) return;
    const c = commentQueue.shift();
    if (c) {
      const isPurchase = PURCHASE_RE.test(c.text);
      const isFeedback = !isPurchase && FEEDBACK_RE.test(c.text);
      if (isPurchase) playSfx("bell"); // 🔔 bell FIRST, then voice
      const focus = config.selectedProduct ? `[FOKUS PRODUK: ${config.selectedProduct}] ` : "";
      const ask = `${focus}${cleanUsername(c.username)}: ${c.text}`;
      const ok = await speak("ask", ask);
      if (ok) {
        stats.replied++;
        record("reply", c.username, c.text);
        if (isPurchase) { stats.purchases++; record("purchase", c.username, c.text); }
        if (isFeedback) {
          record("feedback", c.username, c.text);
          setTimeout(() => playSfx("clap"), 4000); // voice, THEN 👏 clap
        }
      } else {
        stats.skipped++;
        record("skip", c.username, c.text);
      }
      broadcast();
    }
    if (commentQueue.length) scheduleComment();
  }, rand(config.commentDelayMin, config.commentDelayMax));
}

// ---- event handlers --------------------------------------------------------
function onJoin(username) {
  stats.joins++;
  record("join", username);
  if (greetQueue.length < QUEUE_CAP) greetQueue.push({ username, kind: "join" });
  broadcast();
  scheduleGreet();
}
function onFollow(username) {
  stats.follows++;
  record("follow", username);
  playSfx("clap"); // 👏 immediately on follow
  if (greetQueue.length < QUEUE_CAP) greetQueue.push({ username, kind: "follow" });
  broadcast();
  scheduleGreet();
}
function onLike(username) {
  stats.likes++;
  record("like", username);
  if (greetQueue.length < QUEUE_CAP) greetQueue.push({ username, kind: "like" });
  broadcast();
  scheduleGreet();
}
function onComment(username, text) {
  stats.seen++;
  record("comment", username, text);
  if (commentQueue.length < QUEUE_CAP) commentQueue.push({ username, text });
  else { stats.skipped++; record("skip", username, text); }
  broadcast();
  scheduleComment();
}

// ---- lifecycle --------------------------------------------------------------
async function handleStart() {
  const stored = await chrome.storage.local.get(["lhToken"]);
  token = stored.lhToken || "";
  if (!token) return { ok: false, error: "Sila login dulu (email PeningLab)" };
  const r = await fetch(`${BASE}/api/livehost/greet-config?token=${encodeURIComponent(token)}`);
  const d = await r.json().catch(() => ({}));
  if (!d.config) return { ok: false, error: d.error || "Gagal ambil config — login semula?" };
  config = d.config;
  stats = freshStats();
  greetQueue = []; commentQueue = []; greetIdx = 0;
  running = true;
  await ensureOffscreen();
  if (!flushTimer) flushTimer = setInterval(flushEvents, 20000);
  broadcast();
  return { ok: true };
}
function handleStop() {
  running = false;
  if (greetTimer) { clearTimeout(greetTimer); greetTimer = null; }
  if (commentTimer) { clearTimeout(commentTimer); commentTimer = null; }
  flushEvents();
  broadcast();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "EXT_LOGIN": {
        const d = await api("/api/livehost/ext-login", { email: msg.email, password: msg.password });
        if (d.token) {
          await chrome.storage.local.set({ lhToken: d.token, lhName: d.name, lhEmail: msg.email });
          sendResponse({ ok: true, name: d.name });
        } else sendResponse({ ok: false, error: d.error || "Login gagal" });
        break;
      }
      case "START": sendResponse(await handleStart()); break;
      case "STOP": handleStop(); sendResponse({ ok: true }); break;
      case "GET_STATE": {
        const st = await chrome.storage.local.get(["lhStats", "lhRunning", "lhName", "lhToken"]);
        sendResponse({ stats: stats || st.lhStats || freshStats(), running, name: st.lhName || "", loggedIn: !!st.lhToken });
        break;
      }
      case "NEW_COMMENT": if (running) onComment(msg.username, msg.text); break;
      case "USER_JOINED": if (running) onJoin(msg.username); break;
      case "USER_FOLLOWED": if (running) onFollow(msg.username); break;
      case "USER_LIKED": if (running) onLike(msg.username); break;
      case "LIVE_ENDED": handleStop(); break;
      case "PLAY_MANUAL_SFX": await ensureOffscreen(); chrome.runtime.sendMessage({ type: "PLAY_SFX", sfx: msg.sfx }).catch(() => {}); break;
      case "SIM": {
        // simulation: "comment text" | "NAME JOIN" | "NAME FOLLOW" | "NAME LIKE"
        const t = String(msg.text || "").trim();
        const m = t.match(/^(\S+)\s+(JOIN|FOLLOW|LIKE)$/i);
        if (m && running) {
          const u = m[1], k = m[2].toUpperCase();
          if (k === "JOIN") onJoin(u); else if (k === "FOLLOW") onFollow(u); else onLike(u);
        } else if (running) onComment("Simulasi", t);
        sendResponse({ ok: running });
        break;
      }
    }
  })();
  return true; // async sendResponse
});
