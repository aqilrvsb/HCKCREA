# PeningLab Livehost — Chrome Extension

Connects a client's real **TikTok Shop LIVE** to their **AI avatar** running in
PeningLab Livehost. While the client streams (OBS → TikTok), this extension
watches the live chat and makes the avatar **greet joiners, reply to comments,
and play sound effects** — all spoken by the avatar, lip-synced.

This is a fork of the proven `extension-aihost`, with ONE key change: the voice
no longer plays from the extension — every line is relayed to the client's GPU
so it comes out of the **avatar's mouth**.

## Install (client)
1. Download the `extension-livehost` folder (or the packed .zip we provide).
2. Chrome → `chrome://extensions` → enable **Developer mode** (top-right).
3. **Load unpacked** → select the `extension-livehost` folder.
4. Click the extension icon — it opens a **resizable side panel** beside the
   page (drag Chrome's divider to make it wider/narrower). **Login with the
   PeningLab email + password** (must be on the Livehost plan).

## Daily use
1. PeningLab → **Livehost** tab → **⏻ On GPU** → **▶ Start** (avatar streaming).
2. OBS captures the avatar (Browser/Window source) → push to TikTok LIVE.
3. Open the **TikTok Shop LIVE console** tab (shop.tiktok.com).
4. Extension popup → **START**. Done — it now runs automatically.
   - Test without a live stream using the **Simulation** box:
     `Ali JOIN`, `Siti FOLLOW`, `berapa harga powder?`

## What it does (logic = your Greetings tab config)
| Event (detected from TikTok chat DOM) | Action |
|---|---|
| Viewer **joins** | Avatar speaks the next greeting (rotates through your lines), after a random delay (greet Min–Max) |
| Viewer **follows** | 👏 clap + follow greeting |
| Viewer **likes** | Like greeting |
| Viewer **comments** | Avatar replies (focused on the selected product), spaced by reply Min–Max delay |
| Comment looks like a **purchase** (done/dah beli/checkout) | 🔔 bell, then avatar thanks them |
| Comment looks like **feedback** (best/sedap/berkesan…) | Avatar replies, then 👏 clap |

Greetings, delays, follow/like text, product focus, and the SFX toggle are all
edited in **PeningLab → Livehost → Greetings** (saved per client, fetched by the
extension at START).

## Architecture
```
TikTok LIVE chat (DOM)
   │  content.js MutationObserver → {comment|join|follow|like}
   ▼
background.js  (queues, sequential greeting rotation, random delays, SFX rules)
   │  POST /api/livehost/speak {token, kind, text}
   ▼
PeningLab  (verifies ext token → looks up client backend_url + box secret)
   │  POST <client GPU>/say {secret, kind, text}
   ▼
AVTR-1 avatar  → speaks the line, lip-synced, on the live stream
```
Stats batch to `POST /api/livehost/interactions` → client's **Interactions** tab.
SFX (bell/clap) play locally via the extension's offscreen audio document so OBS
desktop/tab-audio capture picks them up.

## Auth
Login = email+password → `POST /api/livehost/ext-login` verifies against Supabase
(livehost plan only) → returns a 90-day HMAC-signed token (signed with
`livehost_box_secret`). The token is all the extension stores; provider keys
never reach the browser.

## Files
- `manifest.json` — MV3, runs on shop.tiktok.com + talks to peninglab.com
- `content.js` — TikTok chat DOM watcher (comment/join/follow/like detection)
- `background.js` — the brain: queues, greeting rotation, delays, SFX, stats
- `offscreen.html` / `offscreen.js` — plays bell/clap mp3s (OBS captures audio)
- `studio.html` — native side-panel UI (login, START/STOP, stats, simulation, SFX)
- `popup.js` — shared logic for the side panel
- `sfx/` — bell.mp3, clap.mp3, cheer.mp3

## Regenerate / update
The extension is plain JS — edit and reload at `chrome://extensions`. When
clients should get an update, bump `version` in manifest.json and re-distribute.
