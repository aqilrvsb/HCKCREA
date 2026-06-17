/**
 * TikTok AI Live Host — Content Script
 *
 * 100% based on tiktok-live-reply v1.5.2 content.js
 * Watches TikTok Shop Live chat for new comments and join events.
 * Handles POST_REPLY (typing into chat) for Auto Reply mode.
 */

(async function () {
  console.log("[AI Host] Content script loaded on:", window.location.href);

  const url = window.location.href.toLowerCase();
  if (!url.includes("shop.tiktok.com/streamer/live")) {
    console.log("[AI Host] Not a TikTok Shop live page, exiting");
    return;
  }

  console.log("[AI Host] TikTok Shop live page detected, waiting 15s for page to fully load...");
  await new Promise(r => setTimeout(r, 15000));

  // Validate shop username against PeningBot registered accounts
  const { tiktokAccounts } = await chrome.storage.local.get("tiktokAccounts");
  if (tiktokAccounts && tiktokAccounts.length > 0) {
    const navUsername = document.querySelector('span.text-body-s-medium[class*="text-white"]');
    const shopUser = navUsername ? navUsername.textContent.trim().toLowerCase() : "";
    console.log("[AI Host] Shop username:", shopUser, "| Allowed accounts:", tiktokAccounts);

    if (shopUser && !tiktokAccounts.some(acc => acc.toLowerCase() === shopUser)) {
      console.log("[AI Host] Username mismatch! Stopping and closing tab.");
      alert("Username TikTok Shop (" + shopUser + ") tidak sepadan dengan akaun yang didaftarkan di PeningBot.\n\nAkaun berdaftar: " + tiktokAccounts.join(", ") + "\n\nTab akan ditutup dalam 5 saat.");
      try { chrome.runtime.sendMessage({ type: "STOP" }); } catch(e) {}
      setTimeout(() => { window.close(); }, 5000);
      return;
    }
  }

  console.log("[AI Host] Initializing...");
  initLiveHost();
  setupAutoPin();
})();

// ============================================================================
// AUTO-PIN: keep the FEATURED product pinned + re-pin it every N seconds so the
// product popup re-shows to viewers (a common live-selling tactic). Operates on
// the FIRST product in the list (put your target product at the top). TikTok
// needs an UNPIN before a re-PIN, so a re-bump = unpin → (1.5s) → pin.
// Controlled by chrome.storage.local: lhAutoPin (bool) + lhAutoPinSec (default 15).
// ============================================================================
function setupAutoPin() {
  let autoPinTimer = null;

  function tick() {
    const first = document.querySelector(".pc_pin_product_pin, .pc_pin_product_unpin");
    if (!first) return; // product list not loaded / no products
    if (first.classList.contains("pc_pin_product_unpin")) {
      // Already pinned → unpin, then re-pin the same (top) product to re-bump.
      first.click();
      setTimeout(() => {
        const pin = document.querySelector(".pc_pin_product_pin");
        if (pin) pin.click();
      }, 1500);
    } else {
      first.click(); // not pinned yet → pin it
    }
  }

  async function refresh() {
    const { lhAutoPin, lhAutoPinSec } = await chrome.storage.local.get(["lhAutoPin", "lhAutoPinSec"]);
    if (autoPinTimer) { clearInterval(autoPinTimer); autoPinTimer = null; }
    if (lhAutoPin) {
      const sec = Math.max(5, Number(lhAutoPinSec) || 15);
      tick(); // fire once now
      autoPinTimer = setInterval(tick, sec * 1000);
      console.log("[AI Host] Auto-pin ON — every", sec, "s");
    } else {
      console.log("[AI Host] Auto-pin OFF");
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && ("lhAutoPin" in changes || "lhAutoPinSec" in changes)) refresh();
  });
  refresh();
}

function initLiveHost() {
  // ============================================================================
  // DOM SELECTORS — proven from tiktok-live-reply v1.5.2
  // ============================================================================

  const SELECTORS = {
    chatContainer: '.arco-list-content.arco-list-virtual',
    chatMessage: '.rounded-8.relative',
    joinMessage: '.rounded-l-16',
    chatItem: '[type="view_filter"]',
    // TikTok uses text-body-m-medium (fullscreen) or text-body-s-medium (small window)
    commentUsername: '.text-neutral-text3[class*="text-body"][class*="-medium"]',
    commentText: '.text-neutral-text1.pl-32',
    hostBadge: '.arco-tag',
    chatInput: 'textarea[data-tid="m4b_input_textarea"]',
    sendButton: '.arco-icon-publish'
  };

  // ============================================================================
  // STATE
  // ============================================================================

  const recentComments = new Set();
  const MAX_DEDUP = 200;
  let scanInterval = null;
  let keepaliveInterval = null;
  let containerRef = null;

  // ============================================================================
  // CHAT CONTAINER
  // ============================================================================

  function findAllContainers() {
    return document.querySelectorAll(SELECTORS.chatContainer);
  }

  // ============================================================================
  // MESSAGE EXTRACTION
  // ============================================================================

  function isHostMessage(msgNode) {
    const tags = msgNode.querySelectorAll(SELECTORS.hostBadge);
    for (const tag of tags) {
      if (tag.textContent.trim() === "Host") return true;
    }
    return false;
  }

  function extractSingleComment(msgNode) {
    if (isHostMessage(msgNode)) return null;

    const usernameEl = msgNode.querySelector(SELECTORS.commentUsername);
    if (!usernameEl) return null;
    const commenter = usernameEl.textContent.trim();
    if (!commenter) return null;

    // Check if this is a join event — "Username just joined" has no .pl-32 text element
    // The full text of the parent span contains "just joined" or "joined the live"
    const parentText = msgNode.textContent || "";
    const parentLower = parentText.toLowerCase();
    if (parentLower.includes("join")) {
      return { type: 'join', username: commenter };
    }

    if (parentLower.includes("follow")) {
      return { type: 'follow', username: commenter };
    }

    if (parentLower.includes("like")) {
      return { type: 'like', username: commenter };
    }

    const textEl = msgNode.querySelector(SELECTORS.commentText);
    if (!textEl) return null;
    const text = textEl.textContent.trim();
    if (!text) return null;

    // Filter out @mentions
    if (text.startsWith("@")) return null;

    return { type: 'comment', username: commenter, text };
  }

  function safeSendMessage(msg) {
    try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch (e) {}
  }

  // ============================================================================
  // LIVE ENDED DETECTION
  // ============================================================================

  function isLiveEnded() {
    const modal = document.querySelector('.arco-modal');
    if (modal && modal.textContent.includes("Cheers to completing another LIVE")) {
      return true;
    }
    return false;
  }

  // ============================================================================
  // POLLING: Scan last 5 messages every 1 second
  // ============================================================================

  function scanLatestMessages() {
    if (isLiveEnded()) {
      console.log("[AI Host] Live ended, auto-stopping...");
      cleanup();
      safeSendMessage({ type: "LIVE_ENDED" });
      return;
    }

    // Scan ALL virtual list containers (Chat panel + Activity panel)
    const containers = findAllContainers();
    if (containers.length === 0) return;

    for (const container of containers) {
      // Select both comments (.rounded-8.relative) and joins (.rounded-l-16)
      const allMsgs = container.querySelectorAll(`${SELECTORS.chatMessage}, ${SELECTORS.joinMessage}`);
      const total = allMsgs.length;
      const startIdx = Math.max(0, total - 5);

      for (let i = startIdx; i < total; i++) {
        const data = extractSingleComment(allMsgs[i]);
        if (!data) continue;

        if (data.type === 'join') {
          const joinKey = `join:${data.username}`;
          if (recentComments.has(joinKey)) continue;
          recentComments.add(joinKey);
          if (recentComments.size > MAX_DEDUP) {
            const first = recentComments.values().next().value;
            recentComments.delete(first);
          }
          console.log("[AI Host] New join:", data.username);
          safeSendMessage({
            type: 'USER_JOINED',
            username: data.username
          });
          continue;
        }

        if (data.type === 'follow') {
          const followKey = `follow:${data.username}`;
          if (recentComments.has(followKey)) continue;
          recentComments.add(followKey);
          if (recentComments.size > MAX_DEDUP) {
            const first = recentComments.values().next().value;
            recentComments.delete(first);
          }
          console.log("[AI Host] New follow:", data.username);
          safeSendMessage({
            type: 'USER_FOLLOWED',
            username: data.username
          });
          continue;
        }

        if (data.type === 'like') {
          const likeKey = `like:${data.username}`;
          if (recentComments.has(likeKey)) continue;
          recentComments.add(likeKey);
          if (recentComments.size > MAX_DEDUP) {
            const first = recentComments.values().next().value;
            recentComments.delete(first);
          }
          console.log("[AI Host] New like:", data.username);
          safeSendMessage({
            type: 'USER_LIKED',
            username: data.username
          });
          continue;
        }

        // Comment dedup
        const key = `${data.username}:${data.text}`;
        if (recentComments.has(key)) continue;

        recentComments.add(key);
        if (recentComments.size > MAX_DEDUP) {
          const first = recentComments.values().next().value;
          recentComments.delete(first);
        }

        console.log("[AI Host] New comment:", data.username, ":", data.text);
        safeSendMessage({
          type: 'NEW_COMMENT',
          username: data.username,
          text: data.text
        });
      }
    }
  }

  // ============================================================================
  // START
  // ============================================================================

  let retries = 0;

  function start() {
    const containers = findAllContainers();
    if (containers.length === 0) {
      retries++;
      if (retries % 15 === 0) {
        console.log("[AI Host] Still waiting for chat containers... retry", retries);
      }
      setTimeout(start, 2000);
      return;
    }

    console.log("[AI Host] Found", containers.length, "chat/activity containers");

    // Mark existing COMMENTS so we don't process them (but NOT joins — we want to greet)
    for (const container of containers) {
      const existing = container.querySelectorAll(SELECTORS.chatMessage);
      console.log("[AI Host] Existing comments in container:", existing.length);
      existing.forEach(msg => {
        const data = extractSingleComment(msg);
        if (data && data.type === 'comment') {
          recentComments.add(`${data.username}:${data.text}`);
        }
      });
    }

    // Poll every 1s, scan last 5 messages
    scanInterval = setInterval(scanLatestMessages, 1000);
    console.log("[AI Host] Polling started (every 1s, last 5 messages)");

    // Keepalive ping every 25s
    keepaliveInterval = setInterval(() => {
      safeSendMessage({ type: 'KEEPALIVE' });
    }, 25000);
  }

  function cleanup() {
    if (scanInterval) clearInterval(scanInterval);
    if (keepaliveInterval) clearInterval(keepaliveInterval);
    scanInterval = null;
    keepaliveInterval = null;
  }

  // ============================================================================
  // AUTO REPLY: Type into chat and send
  // ============================================================================

  function findChatInput() {
    return document.querySelector(SELECTORS.chatInput);
  }

  function findSendButton() {
    const icon = document.querySelector(SELECTORS.sendButton);
    if (icon) return icon.closest('span') || icon.parentElement;
    return null;
  }

  async function postReplyToChat(text, commenter) {
    const fullReply = `@${commenter} ${text}`;
    const truncated = fullReply.substring(0, 100);

    const input = findChatInput();
    if (!input) {
      console.log("[AI Host] Chat input NOT found!");
      safeSendMessage({ type: "REPLY_POSTED", success: false, replyText: truncated });
      return;
    }

    console.log("[AI Host] Chat input found, typing:", truncated);

    input.focus();
    await new Promise(r => setTimeout(r, 100));

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(input, truncated);

    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await new Promise(r => setTimeout(r, 500));

    console.log("[AI Host] Pressing Enter to send");
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true
    }));
    input.dispatchEvent(new KeyboardEvent("keypress", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true
    }));
    input.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter", code: "Enter", keyCode: 13, bubbles: true
    }));

    await new Promise(r => setTimeout(r, 300));
    if (input.value && input.value.length > 0) {
      console.log("[AI Host] Enter didn't clear input, trying send button");
      const sendBtn = findSendButton();
      if (sendBtn) sendBtn.click();
    }

    safeSendMessage({ type: "REPLY_POSTED", success: true, replyText: truncated });
  }

  // ============================================================================
  // MESSAGE LISTENER
  // ============================================================================

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "POST_REPLY") {
      console.log("[AI Host] Posting reply to", message.commenter, ":", message.text);
      postReplyToChat(message.text, message.commenter);
    }
    if (message.type === "STOP") {
      console.log("[AI Host] Stopped by user");
      cleanup();
    }
    if (message.type === "RESUME") {
      console.log("[AI Host] Resuming...");
      cleanup();
      retries = 0;
      start();
    }
  });

  start();
}
