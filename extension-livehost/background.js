// PeningLab Livehost Extension — service worker (SCRAPE-ONLY).
// The extension is now just "eyes": it watches TikTok Shop LIVE (content.js),
// records raw viewer events for the dashboard, and FORWARDS each event to the
// PeningLab studio page (the brain) via the on-page bridge. ALL logic —
// greeting/comment selection, random delays, JOIN dedup, driving the avatar,
// SFX — now lives in the PeningLab studio (livehost-studio.tsx), which holds
// the pooled GPU/WebRTC connection. No avatar calls from here anymore.

const BASE = "https://peninglab.com";

try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch (e) {}

let running = false;
let token = "";
let stats = null;
let pendingEvents = [];
let flushTimer = null;

function freshStats() {
  return { seen: 0, replied: 0, skipped: 0, joins: 0, greeted: 0, follows: 0, likes: 0, purchases: 0 };
}
function cleanUsername(u) { return String(u || "").replace(/[*_~`]/g, "").trim().slice(0, 40); }

async function api(path, body) {
  try {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) { return { ok: false, error: String(e) }; }
}

// ---- forward a scraped event to the PeningLab studio (the brain) ------------
// Direct in-browser relay to every open peninglab.com tab's bridge — no server
// round-trip, near-zero cost even under like-spam.
async function forwardEvent(evType, username, text) {
  try {
    const tabs = await chrome.tabs.query({ url: "https://peninglab.com/*" });
    for (const t of tabs) {
      chrome.tabs.sendMessage(t.id, { type: "LH_EVENT", evType, username: cleanUsername(username), text: text || "" }).catch(() => {});
    }
  } catch (e) {}
}

// ---- stats (the dashboard's live activity counters) ------------------------
function record(type, username = "", text = "") {
  pendingEvents.push({ type, username, text });
  if (pendingEvents.length >= 8) flushEvents();
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

// ---- event handlers: record stat + forward to the studio brain -------------
function onJoin(username) { stats.joins++; record("join", username); forwardEvent("join", username); broadcast(); }
function onFollow(username) { stats.follows++; record("follow", username); forwardEvent("follow", username); broadcast(); }
function onLike(username) { stats.likes++; record("like", username); forwardEvent("like", username); broadcast(); }
function onComment(username, text) { stats.seen++; record("comment", username, text); forwardEvent("comment", username, text); broadcast(); }

// ---- lifecycle --------------------------------------------------------------
async function handleStart() {
  const stored = await chrome.storage.local.get(["lhToken"]);
  token = stored.lhToken || "";
  if (!token) return { ok: false, error: "Sila login dulu (email PeningLab)" };
  stats = freshStats();
  running = true;
  if (!flushTimer) flushTimer = setInterval(flushEvents, 5000);
  broadcast();
  return { ok: true };
}
function handleStop() {
  running = false;
  flushEvents();
  broadcast();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "EXT_LOGIN": {
        const ver = chrome.runtime?.getManifest?.()?.version || "1.0.0";
        const d = await api("/api/livehost/ext-login", { email: msg.email, password: msg.password, extension_version: ver });
        if (d.token) {
          await chrome.storage.local.set({ lhToken: d.token, lhName: d.name, lhEmail: msg.email });
          sendResponse({ ok: true, name: d.name, version_ok: d.version_ok, required_version: d.required_version, download_url: d.download_url, current_version: ver });
        } else sendResponse({ ok: false, error: d.error || "Login gagal" });
        break;
      }
      case "GET_VERSION": sendResponse({ version: chrome.runtime?.getManifest?.()?.version || "1.0.0" }); break;
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
      case "SIM": {
        // Manual sim from the side panel → forward to the studio brain, same as
        // a real event. "Name JOIN/FOLLOW/LIKE" | "Name: comment" | plain text.
        const t = String(msg.text || "").trim();
        if (!running) { sendResponse({ ok: false, error: "Tekan START dulu" }); break; }
        const ev = t.match(/^(.+?)\s+(JOIN|FOLLOW|LIKE)$/i);
        if (ev) {
          const u = ev[1].trim(), k = ev[2].toUpperCase();
          if (k === "JOIN") onJoin(u); else if (k === "FOLLOW") onFollow(u); else onLike(u);
        } else {
          const cm = t.match(/^([^:]{1,30}):\s*(.+)$/);
          if (cm) onComment(cm[1].trim(), cm[2].trim()); else onComment("Penonton", t);
        }
        sendResponse({ ok: true });
        break;
      }
    }
  })();
  return true;
});
