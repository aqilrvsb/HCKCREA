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
  } else {
    $("msg").textContent = r?.error || "Gagal start";
  }
});

$("stopBtn").addEventListener("click", async () => {
  await send({ type: "STOP" });
  setRunning(false);
  $("msg").textContent = "Dihentikan";
  $("msg").className = "msg";
});

$("simBtn").addEventListener("click", async () => {
  const t = $("simText").value.trim();
  if (!t) return;
  const r = await send({ type: "SIM", text: t });
  $("msg").textContent = r?.ok ? "✓ Simulasi dihantar" : "Tekan START dulu";
  $("msg").className = r?.ok ? "msg ok" : "msg";
  $("simText").value = "";
});

$("bellBtn").addEventListener("click", () => send({ type: "PLAY_MANUAL_SFX", sfx: "bell" }));
$("clapBtn").addEventListener("click", () => send({ type: "PLAY_MANUAL_SFX", sfx: "clap" }));

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
