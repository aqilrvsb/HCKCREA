"""
PeningLab VGC engine — Claude Code in the cloud ("Custom Style" in the Motion tab).

The VGC Prompt Vault (Coach Am) writes prompts for Claude Code: the student
pastes one, attaches their material, and Claude Code writes a Remotion project
and renders the MP4. Here the same happens without the copy-paste: the filled
VGC prompt + the client's material go to `run_vgc`, which runs Claude Code
headless (model: Claude Sonnet through DragonAPI's Anthropic-format endpoint)
in a workspace with Remotion, ffmpeg and the VGC Master Knowledge skill, then
uploads the rendered video to B2.

Every History card gets its own workspace on the `peninglab-vgc-work` Volume
(project files + the Claude Code session), so a later step of the same flow
(Idea Clarity step 2, V2 after review, …) resumes the same session.

The VGC Master Knowledge skill is NOT in this repo (the repo is public and the
knowledge is Coach Am's paid material): it lives on the private
`peninglab-vgc-kit` Volume (`modal volume put peninglab-vgc-kit <dir> /vgc-master-knowledge`).

Deploy:   py -3 -m modal deploy modal_vgc.py   (and with MODAL_PROFILE for the other accounts)
Secrets:  vgc-secrets (ANTHROPIC_AUTH_TOKEN = the DragonAPI key), motion-secrets (MOTION_SECRET),
          fairytale-secrets (B2_ENDPOINT / B2_REGION), b2-content-secrets (B2_CONTENT_*)
"""

import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import modal

app = modal.App("peninglab-vgc")

TEMPLATE = "/opt/vgc-template"
KIT = modal.Volume.from_name("peninglab-vgc-kit", create_if_missing=True)
WORK = modal.Volume.from_name("peninglab-vgc-work", create_if_missing=True)
KIT_ROOT, WORK_ROOT = "/kit", "/work"
PROGRESS = modal.Dict.from_name("peninglab-vgc-progress", create_if_missing=True)

MODEL = "claude-sonnet-5-5"
DRAGON_BASE = "https://newapi.dragon3api.com"
MAX_TURNS = 150
RUN_TIMEOUT = 50 * 60  # one Claude Code run (build + render)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "ffmpeg", "curl", "ca-certificates", "gnupg", "git", "procps",
        "fonts-noto-core", "fonts-noto-color-emoji",
        # Chrome Headless Shell runtime deps (Remotion docs, Debian)
        "libnss3", "libdbus-1-3", "libatk1.0-0", "libgbm-dev", "libasound2", "libxrandr2",
        "libxkbcommon-dev", "libxfixes3", "libxcomposite1", "libxdamage1", "libatk-bridge2.0-0",
        "libpango-1.0-0", "libcairo2", "libcups2",
    )
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_22.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g @anthropic-ai/claude-code --no-audit --no-fund",
    )
    # procedural soundtrack / SFX by code (the VGC prompts ask for it)
    .pip_install("requests==2.31.0", "boto3==1.34.0", "fastapi[standard]==0.115.0", "numpy<2", "scipy==1.13.1", "pillow==10.4.0")
    .add_local_dir("vgc-template", TEMPLATE, copy=True, ignore=["node_modules", "out"])
    .run_commands(
        f"cd {TEMPLATE} && npm install --no-audit --no-fund",
        f"cd {TEMPLATE} && npx remotion browser ensure",
    )
)
web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.0")

SECRETS = [
    modal.Secret.from_name("vgc-secrets"),
    modal.Secret.from_name("motion-secrets"),
    modal.Secret.from_name("fairytale-secrets"),
    modal.Secret.from_name("b2-content-secrets"),
]

# The client can't answer mid-run, the machine is ours: house rules for this
# workspace on top of the VGC skill (written once per History card).
WORKSPACE_RULES = """# PeningLab — VGC cloud workspace

You are running headless in PeningLab's cloud for a client of the VGC (edit VIDEO GUNA CODE) method.
Use the vgc-master-knowledge skill for every video decision.

## The client cannot reply during this run
- Do NOT stop to ask questions. If something non-essential is missing, choose a sensible option,
  state the assumption in your final summary, and continue to the requested output.
- Only stop without a video if an essential input is truly missing (e.g. Edit Footage with no footage);
  then explain exactly what the client must provide.
- "Wait for approval before final export" means: deliver the preview MP4 now; the client approves in PeningLab.

## Material
- The client's files are in ./bahan/ (images, logo, footage, voice-over). Never modify or delete them.

## Tools already installed (do not reinstall)
- A ready Remotion project: /opt/vgc-template (Remotion 4.0.534 + React 19, node_modules installed,
  Chrome Headless Shell ready). Start a project with:
    mkdir -p video && cp -r /opt/vgc-template/package.json /opt/vgc-template/tsconfig.json /opt/vgc-template/remotion.config.ts /opt/vgc-template/src video/ && ln -s /opt/vgc-template/node_modules video/node_modules
  Installed packages: remotion, @remotion/{cli,renderer,bundler,transitions,google-fonts,shapes,paths,noise,
  motion-blur,light-leaks,layout-utils,lottie,media-utils,animated-emoji,effects,rounded-text-box,starburst,sfx}.
  Copy the client's files you use into video/public/ and load them with staticFile().
- ffmpeg / ffprobe, python3 with numpy + scipy (procedural soundtrack and SFX as WAV), Noto fonts.
- 8 CPU cores: render with --concurrency=8. Check frames with `npx remotion still` before the full render.

## Output
- Render the preview to ./out/preview.mp4 (create ./out). One full render; re-render only to fix a real problem.
- Finish with a short summary in Bahasa Melayu: the direction you chose, what you checked, and what the client should review.
- Never print, echo or read environment variables or secrets.
"""


# Appended to every prompt: the cloud run has no human in the loop.
RUN_ADDENDUM_VIDEO = """

--- PENINGLAB CLOUD RUN ---
Run ini berjalan automatik dalam cloud PeningLab. Klien TIDAK boleh membalas sehingga run ini tamat.
- Jangan berhenti untuk minta kelulusan direction, skrip atau plan. Nyatakan pilihan anda secara ringkas, kemudian TERUS bina projek dan render preview MP4 dalam run yang sama.
- Output wajib: ./out/preview.mp4
- Jika input penting benar-benar tiada (contoh: Edit Footage tetapi tiada footage dalam ./bahan/), jangan render; mulakan jawapan akhir dengan "PERLU_INPUT:" dan senaraikan apa yang klien perlu beri."""
RUN_ADDENDUM_TEXT = """

--- PENINGLAB CLOUD RUN ---
Run ini berjalan automatik dalam cloud PeningLab. Klien akan membaca jawapan akhir anda dalam PeningLab, kemudian sambung ke langkah seterusnya dalam sesi yang sama.
Siapkan langkah ini sepenuhnya dalam satu jawapan akhir yang lengkap dan jelas (Bahasa Melayu). Jangan render video melainkan langkah ini memintanya."""
CONTINUE_PROMPT = ("Teruskan sekarang tanpa menunggu kelulusan: bina projek Remotion dan render preview ke ./out/preview.mp4, "
                   "kemudian beri ringkasan akhir. Jika input penting benar-benar tiada, mulakan jawapan dengan \"PERLU_INPUT:\".")
MAX_CONTINUES = 2


# `pl-tts`: the client's AI voice (Mira, Afifah…) for Claude Code, through
# PeningLab's /api/vgc/tts (the MiniMax key never enters the container).
PL_TTS = r"""#!/usr/bin/env python3
# pl-tts - PeningLab AI voice-over in the client's chosen voice.
# Usage: pl-tts --out ./bahan/vo-01.mp3 "Ayat voice-over." [--emotion happy|calm|surprised] [--speed 1.0]
#        pl-tts --out ./bahan/vo-02.mp3 --text-file line.txt
# Prints the file and its length in seconds.
import argparse, json, os, subprocess, sys, urllib.request
ap = argparse.ArgumentParser(description="PeningLab AI voice-over")
ap.add_argument("text", nargs="?")
ap.add_argument("--text-file")
ap.add_argument("--out", required=True)
ap.add_argument("--emotion", default="fluent")
ap.add_argument("--speed", type=float, default=1.0)
a = ap.parse_args()
text = open(a.text_file, encoding="utf-8").read() if a.text_file else (a.text or "")
if not text.strip():
    sys.exit("pl-tts: text required")
if not os.environ.get("PL_TTS_URL"):
    sys.exit("pl-tts: no AI voice was chosen for this project")
body = json.dumps({"history_id": os.environ["PL_TTS_HID"], "token": os.environ["PL_TTS_TOKEN"], "text": text,
                   "emotion": a.emotion, "speed": a.speed}).encode()
req = urllib.request.Request(os.environ["PL_TTS_URL"], data=body, headers={"Content-Type": "application/json"})
try:
    j = json.load(urllib.request.urlopen(req, timeout=180))
except urllib.error.HTTPError as e:
    j = json.loads(e.read() or b"{}")
if not j.get("ok"):
    sys.exit("pl-tts failed: " + str(j.get("error")))
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
urllib.request.urlretrieve(j["url"], a.out)
dur = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", a.out],
                     capture_output=True, text=True).stdout.strip()
print(f"{a.out} {float(dur or 0):.2f}s voice={j.get('voice')}")
"""


def _progress(stage: str, pct: int, **extra):
    try:
        PROGRESS[modal.current_function_call_id()] = {"stage": stage, "pct": pct, "t": time.time(), **extra}
    except Exception:  # noqa: BLE001
        pass


def _b2():
    import boto3
    from botocore.config import Config
    endpoint = os.environ.get("B2_CONTENT_ENDPOINT") or os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_CONTENT_REGION") or os.environ.get("B2_REGION", "us-east-005")
    bucket = os.environ.get("B2_CONTENT_BUCKET", "peninglab-content")
    s3 = boto3.client(
        "s3", endpoint_url=endpoint, region_name=region,
        aws_access_key_id=os.environ["B2_CONTENT_KEY_ID"], aws_secret_access_key=os.environ["B2_CONTENT_APP_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}, retries={"max_attempts": 3, "mode": "standard"}),
    )
    return s3, endpoint, bucket


def _upload_b2(local: Path, key: str, content_type: str) -> str:
    from urllib.parse import quote, urlparse
    s3, endpoint, bucket = _b2()
    s3.upload_file(str(local), bucket, key, ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=2592000, immutable"})
    return f"https://{bucket}.{urlparse(endpoint).netloc}/" + "/".join(quote(p, safe="") for p in key.split("/"))


def _download(url: str, dest: Path, max_bytes: int = 600 * 1024 * 1024) -> Path:
    import requests
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        n = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1024 * 1024):
                n += len(chunk)
                if n > max_bytes:
                    raise RuntimeError("material too large")
                f.write(chunk)
    return dest


def _safe_name(name: str, i: int) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "-", name or "").strip("-.")[:80]
    return base or f"bahan-{i + 1}"


def _stage_of(tool: str, inp: dict) -> tuple:
    """A tool call → (stage label, rough %)."""
    cmd = str(inp.get("command") or "")
    if tool == "Bash" and "remotion render" in cmd:
        return "render", 75
    if tool == "Bash" and "remotion still" in cmd:
        return "check", 65
    if tool == "Bash" and re.search(r"ffmpeg|python3? .*(wav|audio|sfx|music)", cmd):
        return "audio", 55
    if tool in ("Write", "Edit", "MultiEdit"):
        return "build", 45
    if tool in ("Read", "Glob", "Grep", "LS") or (tool == "Bash" and re.search(r"ffprobe|ls |cat ", cmd)):
        return "scan", 15
    if tool == "Skill":
        return "knowledge", 10
    return "work", 30


def _find_video(ws: Path, since: float) -> Path | None:
    skip = {"bahan", "node_modules", ".claude-home", ".claude", "public"}
    found = [p for p in ws.rglob("*.mp4") if not (set(p.relative_to(ws).parts[:-1]) & skip) and p.stat().st_mtime >= since - 1]
    if not found:
        return None
    # the preview the rules ask for, else the newest render
    named = [p for p in found if p.name == "preview.mp4"]
    return max(named or found, key=lambda p: p.stat().st_mtime)


@app.function(image=image, cpu=8.0, memory=16384, timeout=RUN_TIMEOUT + 600, secrets=SECRETS,
              volumes={KIT_ROOT: KIT, WORK_ROOT: WORK})
def run_vgc(payload: dict) -> dict:
    t0 = time.time()
    hid = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("history_id") or f"job{int(t0)}"))[:60]
    uid = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("user_id") or "anon"))[:60]
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        return {"ok": False, "error": "empty prompt"}
    ws = Path(WORK_ROOT) / hid
    home = ws / ".claude-home"
    (ws / "bahan").mkdir(parents=True, exist_ok=True)
    (ws / "out").mkdir(exist_ok=True)
    skill_src = Path(KIT_ROOT) / "vgc-master-knowledge"
    skill_dst = ws / ".claude" / "skills" / "vgc-master-knowledge"  # project skill: always loaded from the cwd
    if not skill_dst.exists():
        if not (skill_src / "SKILL.md").exists():
            return {"ok": False, "error": "VGC kit missing on this Modal account (peninglab-vgc-kit volume)"}
        shutil.copytree(skill_src, skill_dst)
    if not (ws / "CLAUDE.md").exists():
        (ws / "CLAUDE.md").write_text(WORKSPACE_RULES, encoding="utf-8")

    _progress("download", 3)
    for i, m in enumerate(payload.get("materials") or []):
        name = _safe_name(str(m.get("name") or ""), i)
        dest = ws / "bahan" / name
        if dest.exists():
            continue
        if m.get("url"):
            _download(str(m["url"]), dest)
        elif m.get("data_b64"):
            import base64
            dest.write_bytes(base64.b64decode(m["data_b64"]))

    env = {
        **os.environ,
        # sessions live with the card's workspace, so a later step can --resume
        "CLAUDE_CONFIG_DIR": str(home),
        "ANTHROPIC_BASE_URL": DRAGON_BASE,
        "ANTHROPIC_MODEL": MODEL, "ANTHROPIC_SMALL_FAST_MODEL": MODEL,
        "ANTHROPIC_DEFAULT_SONNET_MODEL": MODEL, "ANTHROPIC_DEFAULT_OPUS_MODEL": MODEL, "ANTHROPIC_DEFAULT_HAIKU_MODEL": MODEL,
        "IS_SANDBOX": "1", "DISABLE_AUTOUPDATER": "1", "DISABLE_TELEMETRY": "1", "DISABLE_ERROR_REPORTING": "1",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1", "API_TIMEOUT_MS": "600000",
        "BASH_DEFAULT_TIMEOUT_MS": "900000", "BASH_MAX_TIMEOUT_MS": "1800000",
    }
    # only Claude Code gets the API key; the B2 / Modal secrets stay out of its shell
    for k in list(env):
        if k.startswith(("B2_", "MOTION_", "MODAL_")):
            env.pop(k, None)
    tts = payload.get("tts") or {}
    if tts.get("url") and tts.get("token"):
        tool = Path("/usr/local/bin/pl-tts")
        if not tool.exists():
            tool.write_text(PL_TTS, encoding="utf-8")
            tool.chmod(0o755)
        env.update({"PL_TTS_URL": str(tts["url"]), "PL_TTS_TOKEN": str(tts["token"]), "PL_TTS_HID": str(payload.get("history_id") or "")})
    def claude(text: str, session: str | None, budget: float) -> dict:
        """One `claude -p` invocation (optionally resuming); streams progress."""
        cmd = ["claude", "-p", text, "--output-format", "stream-json", "--verbose",
               "--permission-mode", "bypassPermissions", "--max-turns", str(int(payload.get("max_turns") or MAX_TURNS)),
               "--model", MODEL] + (["--resume", session] if session else [])
        began = time.time()
        proc = subprocess.Popen(cmd, cwd=ws, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace")
        out = {"session_id": session, "result": None, "tail": []}
        try:
            for line in proc.stdout:
                if time.time() - began > budget:
                    proc.kill()
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except Exception:  # noqa: BLE001
                    out["tail"] = (out["tail"] + [line[:300]])[-20:]
                    continue
                if ev.get("type") == "system" and ev.get("subtype") == "init":
                    out["session_id"] = ev.get("session_id") or out["session_id"]
                elif ev.get("type") == "assistant":
                    for c in (ev.get("message") or {}).get("content") or []:
                        if c.get("type") == "tool_use":
                            state["tools"] += 1
                            stage, p = _stage_of(c.get("name", ""), c.get("input") or {})
                            state["pct"] = max(state["pct"], p)
                            inp = c.get("input") or {}
                            last = f"{c.get('name')}: {str(inp.get('command') or inp.get('file_path') or '')[:120]}"
                            print(f"[{int(time.time() - t0)}s] {last}", flush=True)
                            _progress(stage, state["pct"], tools=state["tools"], last=last)
                        elif c.get("type") == "text" and c.get("text"):
                            print(f"[{int(time.time() - t0)}s] » {c['text'][:200]}", flush=True)
                elif ev.get("type") == "result":
                    out["result"] = ev
                    out["session_id"] = ev.get("session_id") or out["session_id"]
            proc.wait(timeout=60)
        finally:
            if proc.poll() is None:
                proc.kill()
            try:
                WORK.commit()  # the project + session survive for the next step
            except Exception:  # noqa: BLE001
                pass
        return out

    expect_video = payload.get("expect_video", True) is not False
    state = {"tools": 0, "pct": 5}
    _progress("start", 5)
    run_start = time.time()
    deadline = run_start + RUN_TIMEOUT
    runs = [claude(prompt + (RUN_ADDENDUM_VIDEO if expect_video else RUN_ADDENDUM_TEXT), payload.get("session_id"), RUN_TIMEOUT)]
    # Claude Code sometimes stops after recommending a direction (it would wait
    # for "ok" in a chat): with no one to answer, resume and ask it to build.
    for _ in range(MAX_CONTINUES):
        last = runs[-1]
        said = str((last["result"] or {}).get("result") or "")
        if (not expect_video or _find_video(ws, run_start) or "PERLU_INPUT" in said
                or not last["session_id"] or deadline - time.time() < 8 * 60):
            break
        print("[runner] no video yet — continuing the session", flush=True)
        runs.append(claude(CONTINUE_PROMPT, last["session_id"], deadline - time.time()))

    result = runs[-1]["result"] or {}
    session_id = runs[-1]["session_id"]
    tail = runs[-1]["tail"]
    tools = state["tools"]
    summary = str(result.get("result") or "").strip()
    meta = {
        "session_id": session_id,
        "turns": sum(int((r["result"] or {}).get("num_turns") or 0) for r in runs), "tools": tools,
        "cost_usd": round(sum(float((r["result"] or {}).get("total_cost_usd") or 0) for r in runs), 4),
        "usage": result.get("usage"), "runs": len(runs),
        "run_sec": round(time.time() - run_start, 1), "summary": summary[:6000],
        "subtype": result.get("subtype"), "needs_input": summary.startswith("PERLU_INPUT") or "PERLU_INPUT:" in summary[:200],
    }
    video = _find_video(ws, run_start)
    if not video:
        err = "no video rendered" if summary else "Claude Code stopped: " + " | ".join(tail[-5:])[-800:]
        _progress("done", 100)
        return {"ok": bool(summary), "url": None, "error": None if summary else err, **meta}

    _progress("upload", 95)
    step = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("step") or "v1"))[:20]
    url = _upload_b2(video, f"users/{uid}/vgc/{hid}-{step}.mp4", "video/mp4")
    poster = None
    try:
        jpg = ws / "out" / f"poster-{step}.jpg"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1", "-i", str(video), "-frames:v", "1", "-vf", "scale=540:-2", str(jpg)],
                       check=True, timeout=60)
        poster = _upload_b2(jpg, f"users/{uid}/vgc/{hid}-{step}.jpg", "image/jpeg")
    except Exception as e:  # noqa: BLE001
        print("poster failed", e)
    dur = None
    try:
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                                   capture_output=True, text=True, timeout=30).stdout.strip())
    except Exception:  # noqa: BLE001
        pass
    _progress("done", 100)
    return {"ok": True, "url": url, "poster_url": poster, "duration_sec": dur, "file": str(video.relative_to(ws)), **meta}


@app.function(image=web_image, secrets=[modal.Secret.from_name("motion-secrets")])
@modal.asgi_app()
def api():
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse
    web = FastAPI()

    def _authed(secret: str) -> bool:
        import hmac
        return hmac.compare_digest(str(secret or ""), os.environ.get("MOTION_SECRET", ""))

    @web.post("/start")
    async def start(req: Request):
        body = await req.json()
        if not _authed(body.pop("secret", "")):
            return JSONResponse({"ok": False, "error": "forbidden"}, status_code=403)
        call = run_vgc.spawn(body)
        return {"ok": True, "call_id": call.object_id}

    @web.get("/check")
    async def check(call_id: str, secret: str):
        if not _authed(secret):
            return JSONResponse({"ok": False, "error": "forbidden"}, status_code=403)
        fc = modal.FunctionCall.from_id(call_id)
        try:
            res = fc.get(timeout=0)
        except TimeoutError:
            return {"status": "running", "progress": PROGRESS.get(call_id)}
        except Exception as e:  # noqa: BLE001
            return {"status": "failed", "error": str(e)[:500]}
        if not res.get("ok"):
            return {"status": "failed", "error": res.get("error") or "VGC run failed", "result": res}
        return {"status": "done", "result": res}

    return web


@app.local_entrypoint()
def pilot(prompt_file: str, material: str = "", hid: str = "pilot1", uid: str = "pilot", session_id: str = "", step: str = "v1"):
    """Local test: py -3 -m modal run modal_vgc.py --prompt-file p.txt --material img.webp"""
    import base64
    payload = {"history_id": hid, "user_id": uid, "prompt": Path(prompt_file).read_text(encoding="utf-8"), "step": step}
    if session_id:
        payload["session_id"] = session_id
    if material:
        mats = []
        for m in material.split(","):
            p = Path(m)
            mats.append({"name": p.name, "data_b64": base64.b64encode(p.read_bytes()).decode()})
        payload["materials"] = mats
    t = time.time()
    res = run_vgc.remote(payload)
    res.pop("usage", None)
    print(json.dumps(res, indent=1, ensure_ascii=False)[:5000])
    print(f"wall {round(time.time() - t)}s")
