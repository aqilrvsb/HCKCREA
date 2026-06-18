// Popup: login -> start/stop -> live stats (mirrors extension-aihost UX).
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

function showStats(stats) {
  if (!stats) return;
  for (const k of ["seen", "replied", "skipped", "joins", "greeted", "follows", "likes", "purchases"]) {
    const el = $("s_" + k);
    if (el) el.textContent = stats[k] || 0;
  }
}

function setRunning(running) {
  $("startBtn").classList.toggle("hidden", running);
  $("stopBtn").classList.toggle("hidden", !running);
  const b = $("statusBadge");
  if (b) { b.textContent = running ? "● LIVE" : "OFF"; b.classList.toggle("live", running); }
}

async function refresh() {
  const st = await send({ type: "GET_STATE" });
  if (!st) return;
  if (st.loggedIn) {
    $("loginView").classList.add("hidden");
    $("mainView").classList.remove("hidden");
    if (st.name) $("user").textContent = st.name;
  }
  showStats(st.stats);
  setRunning(!!st.running);
}

$("loginBtn").addEventListener("click", async () => {
  $("msg").textContent = "Logging in…";
  $("msg").className = "msg";
  const r = await send({ type: "EXT_LOGIN", email: $("email").value.trim(), password: $("password").value });
  if (r?.ok) {
    $("msg").textContent = "✓ Login berjaya";
    $("msg").className = "msg ok";
    if (r.name) $("user").textContent = r.name;
    if (r.version_ok === false && r.download_url) {
      const b = $("updateBanner"), l = $("updateLink");
      if (b) b.classList.remove("hidden");
      if (l) l.href = r.download_url;
    }
    refresh();
  } else {
    $("msg").textContent = r?.error || "Login gagal";
  }
});

$("startBtn").addEventListener("click", async () => {
  $("msg").textContent = "Starting…";
  $("msg").className = "msg";
  const r = await send({ type: "START" });
  if (r?.ok) {
    $("msg").textContent = "✓ Berjalan — avatar akan greet & reply automatik";
    $("msg").className = "msg ok";
    setRunning(true);
    // Schedule auto-end-live if a duration is set (0/0 = manual, no auto-end).
    const h = Math.max(0, Number($("durH")?.value) || 0);
    const m = Math.max(0, Number($("durM")?.value) || 0);
    const ms = (h * 3600 + m * 60) * 1000;
    if (ms > 0) await chrome.storage.local.set({ lhLiveEndAt: Date.now() + ms });
    else await chrome.storage.local.remove("lhLiveEndAt");
  } else {
    $("msg").textContent = r?.error || "Gagal start";
  }
});

$("stopBtn").addEventListener("click", async () => {
  await send({ type: "STOP" });
  await chrome.storage.local.remove("lhLiveEndAt"); // cancel any pending auto-end
  setRunning(false);
  $("msg").textContent = "Dihentikan";
  $("msg").className = "msg";
});

// Live-duration: persist the jam/minit inputs + show a live countdown to auto-end.
(async () => {
  const h = $("durH"), m = $("durM");
  if (h && m) {
    const { lhLiveDurH, lhLiveDurM } = await chrome.storage.local.get(["lhLiveDurH", "lhLiveDurM"]);
    if (lhLiveDurH != null) h.value = String(lhLiveDurH);
    if (lhLiveDurM != null) m.value = String(lhLiveDurM);
    const save = () => chrome.storage.local.set({ lhLiveDurH: Math.max(0, Number(h.value) || 0), lhLiveDurM: Math.max(0, Number(m.value) || 0) });
    h.addEventListener("change", save);
    m.addEventListener("change", save);
  }
  const cd = $("countdown");
  if (cd) setInterval(async () => {
    const { lhLiveEndAt } = await chrome.storage.local.get("lhLiveEndAt");
    if (!lhLiveEndAt) { cd.textContent = ""; return; }
    const left = Math.max(0, Number(lhLiveEndAt) - Date.now());
    const s = Math.floor(left / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    cd.textContent = left > 0 ? `⏱ Auto-end dalam ${hh}:${mm}:${ss}` : "⏱ Menamatkan LIVE…";
  }, 1000);
})();

// (Simulation, manual SFX buttons + the extension's own auto-pin toggle were
// removed — interactions are auto-handled, and Auto-Pin is now configured at
// PeningLab → Greetings (Pin Min/Max), applied automatically by content.js.)

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "STATS") {
    showStats(msg.stats);
    setRunning(!!msg.running);
  }
});

// show version pill in the header
send({ type: "GET_VERSION" }).then((r) => {
  if (r?.version) { const v = $("ver"); if (v) v.textContent = "v" + r.version; }
});

refresh();
setInterval(refresh, 3000);
