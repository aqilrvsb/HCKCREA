// PeningLab Livehost — page bridge (runs on peninglab.com).
// The extension is now SCRAPE-ONLY: it captures TikTok LIVE events and relays
// them here; this bridge forwards each into the PeningLab studio page (via
// window.postMessage), where the brain (greeting/comment logic + random delays
// + driving the avatar) lives. In-browser only — no server round-trip.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "LH_EVENT") {
    window.postMessage(
      { __lh_event: true, type: msg.evType, username: msg.username || "", text: msg.text || "" },
      window.location.origin,
    );
  } else if (msg && msg.type === "LH_STOP") {
    // TikTok LIVE ended (duration auto-end or manual) → stop the studio stream.
    window.postMessage({ __lh_stop: true }, window.location.origin);
  }
});
