"""
modal_motion.py — Motion tab renderer (Remotion on CPU).

Two flows, one job function (`run_job`), one light ASGI endpoint (`api`):

  POST /start   { secret, flow: "ad" | "edit", ... }  → { ok, call_id }
  GET  /check   ?call_id=…&secret=…                     → { status: running|done|failed, progress?, result? }
  POST /upload  ?key=…&exp=…&sig=…  (raw video body)    → { ok, url }   browser upload, CORS

Flow "ad"   (Buat Iklan): PeningLab already wrote the script + scene spec
            (LLM) and the per-line MiniMax voice. Here: Whisper word timings
            → VO timeline → procedural music + VO mix → product cut-outs →
            Remotion MotionAd → MP4 on B2.
Flow "edit" (Edit Video): client video → normalise 1080x1920 → Whisper
            transcript → POST it to PeningLab /api/motion/plan (LLM writes
            the caption/overlay plan with admin's model cascade) → optional
            music bed → Remotion MotionEdit → MP4 on B2.

The Remotion project lives in ./motion and is installed + pre-bundled into
the image at build time. Job assets are served to the renderer from a local
HTTP server inside the container.

Deploy:   py -3 -m modal deploy modal_motion.py
Secrets:  motion-secrets (MOTION_SECRET), fairytale-secrets (B2_ENDPOINT /
          B2_REGION), b2-content-secrets (B2_CONTENT_KEY_ID / _APP_KEY / bucket)
"""

import json
import math
import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import modal

app = modal.App("peninglab-motion")

MOTION_DIR = "/app/motion"


def _preload_models():
    from faster_whisper import WhisperModel
    WhisperModel("small", device="cpu", compute_type="int8", download_root="/models/whisper")
    from rembg import new_session
    new_session("isnet-general-use")


render_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "ffmpeg", "curl", "ca-certificates", "gnupg",
        "fonts-noto-core", "fonts-noto-color-emoji",
        # Chrome Headless Shell runtime deps (Remotion docs, Debian)
        "libnss3", "libdbus-1-3", "libatk1.0-0", "libgbm-dev", "libasound2", "libxrandr2",
        "libxkbcommon-dev", "libxfixes3", "libxcomposite1", "libxdamage1", "libatk-bridge2.0-0",
        "libpango-1.0-0", "libcairo2", "libcups2",
    )
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
    )
    .pip_install(
        "faster-whisper==1.0.3", "rembg[cpu]==2.0.59", "pillow==10.4.0", "numpy<2", "scipy==1.13.1",
        "requests==2.31.0", "boto3==1.34.0", "fastapi[standard]==0.115.0",
    )
    .run_function(_preload_models)
    .add_local_dir("motion", MOTION_DIR, copy=True, ignore=["node_modules", "build", "out", "public/sfx"])
    .run_commands(
        f"cd {MOTION_DIR} && npm ci --no-audit --no-fund",
        f"cd {MOTION_DIR} && npx remotion browser ensure",
        f"cd {MOTION_DIR} && node scripts/sfx.mjs && node scripts/bundle.mjs",
    )
)

web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.0")

PROGRESS = modal.Dict.from_name("peninglab-motion-progress", create_if_missing=True)

SECRETS = [
    modal.Secret.from_name("motion-secrets"),
    modal.Secret.from_name("fairytale-secrets"),
    modal.Secret.from_name("b2-content-secrets"),
]


# ── B2 (peninglab-content) — same convention as modal_animate.py ─────────────
def _b2_content_config():
    missing = [k for k in ("B2_CONTENT_KEY_ID", "B2_CONTENT_APP_KEY") if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Motion upload misconfigured: missing Modal Secrets {missing}")
    endpoint = os.environ.get("B2_CONTENT_ENDPOINT") or os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_CONTENT_REGION") or os.environ.get("B2_REGION", "us-east-005")
    bucket = os.environ.get("B2_CONTENT_BUCKET", "peninglab-content")
    return endpoint, region, os.environ["B2_CONTENT_KEY_ID"], os.environ["B2_CONTENT_APP_KEY"], bucket


def _b2_public_url(b2_key: str) -> str:
    from urllib.parse import urlparse, quote
    endpoint, _r, _a, _s, bucket = _b2_content_config()
    host = urlparse(endpoint).netloc
    return f"https://{bucket}.{host}/" + "/".join(quote(p, safe="") for p in b2_key.split("/"))


def _upload_b2(local_path: Path, b2_key: str, content_type: str) -> str:
    if not local_path.exists() or local_path.stat().st_size < 1024:
        raise RuntimeError(f"Upload skipped: {local_path.name} missing or empty")
    import boto3
    from botocore.config import Config
    from boto3.s3.transfer import TransferConfig
    endpoint, region, access_key, secret_key, bucket = _b2_content_config()
    s3 = boto3.client(
        "s3", endpoint_url=endpoint, region_name=region,
        aws_access_key_id=access_key, aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"},
                      retries={"max_attempts": 3, "mode": "standard"}, connect_timeout=30, read_timeout=300),
    )
    s3.upload_file(
        str(local_path), bucket, b2_key,
        ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=2592000, immutable"},
        Config=TransferConfig(multipart_threshold=8 * 1024 * 1024, multipart_chunksize=8 * 1024 * 1024, max_concurrency=4),
    )
    return _b2_public_url(b2_key)


# ── small helpers ─────────────────────────────────────────────────────────────
def _progress(stage: str, pct: int = 0):
    try:
        cid = modal.current_function_call_id()
        if cid:
            PROGRESS[cid] = {"stage": stage, "pct": int(pct), "ts": time.time()}
    except Exception:
        pass


def _download(url: str, dest: Path, max_bytes: int = 600 * 1024 * 1024) -> Path:
    import requests
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        n = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1024 * 1024):
                n += len(chunk)
                if n > max_bytes:
                    raise RuntimeError("download too large")
                f.write(chunk)
    return dest


def _run(cmd: list, what: str, timeout: int = 900) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True, errors="replace", timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{what} failed (rc={r.returncode}): {(r.stderr or r.stdout)[-1200:]}")
    return r.stdout


def _probe(path: Path) -> dict:
    out = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
                "-of", "json", str(path)], "ffprobe", 60)
    j = json.loads(out or "{}")
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), {})
    has_a = any(s.get("codec_type") == "audio" for s in j.get("streams", []))
    return {"duration": float(j.get("format", {}).get("duration") or 0), "w": int(v.get("width") or 0),
            "h": int(v.get("height") or 0), "audio": has_a}


class _Serve:
    """Serve a directory on 127.0.0.1 so the headless renderer can load job assets."""

    def __init__(self, root: Path):
        import functools
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

        class Quiet(SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(root)))
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def url(self, p: Path) -> str:
        return f"{self.base}/{p.name}"

    def close(self):
        self.httpd.shutdown()


_WHISPER = None


def _whisper():
    global _WHISPER
    if _WHISPER is None:
        from faster_whisper import WhisperModel
        _WHISPER = WhisperModel("small", device="cpu", compute_type="int8", download_root="/models/whisper", cpu_threads=8)
    return _WHISPER


def _pcm16k(src: Path):
    import numpy as np
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def _transcribe(src: Path, language, vad: bool) -> list:
    segs, _info = _whisper().transcribe(_pcm16k(src), language=language or None, word_timestamps=True,
                                        beam_size=5, vad_filter=vad)
    words = []
    for s in segs:
        for w in (s.words or []):
            t = w.word.strip()
            if t:
                words.append({"w": t, "t": round(float(w.start), 3), "e": round(float(w.end), 3)})
    return words


def _render(comp: str, props: dict, workdir: Path, out: Path, pct_from: int, pct_to: int):
    pp = workdir / "props.json"
    pp.write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
    env = {**os.environ, "RENDER_CONCURRENCY": os.environ.get("RENDER_CONCURRENCY", "8")}
    proc = subprocess.Popen(["node", "scripts/render.mjs", f"{MOTION_DIR}/build", comp, str(pp), str(out)],
                            cwd=MOTION_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", env=env)
    tail = []
    for line in proc.stdout:
        line = line.rstrip()
        tail = (tail + [line])[-40:]
        m = re.match(r"PROGRESS (\d+)", line)
        if m:
            _progress("render", pct_from + (pct_to - pct_from) * int(m.group(1)) // 100)
    proc.wait(timeout=1700)
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError("render failed: " + " | ".join(tail[-12:])[-1500:])


def _poster(video: Path, at: float, out: Path) -> Path:
    _run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, at):.2f}", "-i", str(video), "-frames:v", "1",
          "-vf", "scale=540:-2", "-q:v", "4", str(out)], "poster", 60)
    return out


# ── images: sticker cut-out (colour, white outline, baked shadow) + blur bg ──
_REMBG = None


def _cutout(src: Path, out: Path):
    import numpy as np
    from PIL import Image
    from scipy import ndimage
    global _REMBG
    im = Image.open(src)
    im.thumbnail((1400, 1400))
    if im.mode in ("RGBA", "LA") and np.array(im.split()[-1]).min() < 250:
        rgba = im.convert("RGBA")  # already transparent — keep the client's own cut
    else:
        from rembg import remove, new_session
        if _REMBG is None:
            _REMBG = new_session("isnet-general-use")
        rgba = remove(im.convert("RGB"), session=_REMBG, post_process_mask=True)
    a = np.array(rgba.split()[-1]).astype(np.float32) / 255.0
    cover = float((a > 0.5).mean())
    if cover < 0.04 or cover > 0.96:
        return None  # nothing (or everything) removed → caller uses the photo card instead
    a = np.where(a > 0.5, 1.0, a * 0.6)
    m = a > 0.5
    OUT, SH = 16, 46
    pad = OUT + SH
    yy, xx = np.ogrid[-OUT:OUT + 1, -OUT:OUT + 1]
    disk = xx * xx + yy * yy <= OUT * OUT
    mp = np.pad(m, pad)
    d = ndimage.gaussian_filter(ndimage.binary_dilation(mp, structure=disk).astype(np.float32), 1.0)
    W, H = rgba.size
    size = (W + 2 * pad, H + 2 * pad)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow = ndimage.shift(ndimage.gaussian_filter(d, 14), (24, 0), order=1)
    sh = Image.new("RGBA", size, (0, 0, 0, 0))
    sh.putalpha(Image.fromarray((np.clip(shadow, 0, 1) * 0.42 * 255).astype(np.uint8)))
    canvas.alpha_composite(sh)
    white = Image.new("RGBA", size, (255, 255, 255, 0))
    white.putalpha(Image.fromarray((np.clip(d, 0, 1) * 255).astype(np.uint8)))
    canvas.alpha_composite(white)
    fig = rgba.copy()
    fig.putalpha(Image.fromarray((a * 255).astype(np.uint8)))
    canvas.alpha_composite(fig, (pad, pad))
    canvas.crop(canvas.getbbox()).save(out)
    return out


def _blur_bg(src: Path, out: Path) -> Path:
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
    im = ImageOps.fit(Image.open(src).convert("RGB"), (540, 960))
    im = ImageEnhance.Brightness(im.filter(ImageFilter.GaussianBlur(22))).enhance(0.72)
    im.resize((1080, 1920), Image.BICUBIC).save(out, quality=85)
    return out


def _prepare_images(images: list, d: Path, srv: "_Serve") -> list:
    out = []
    for k, im in enumerate(images[:4]):
        url = str((im or {}).get("url") or "").strip()
        if not url:
            continue
        ext = ".png" if url.lower().split("?")[0].endswith(".png") else ".jpg"
        raw = _download(url, d / f"img{k}{ext}", 40 * 1024 * 1024)
        asset = {"url": srv.url(raw)}
        if im.get("cutout", True):
            try:
                c = _cutout(raw, d / f"img{k}_cut.png")
                if c:
                    asset["cutout"] = srv.url(c)
            except Exception as e:
                print("cutout failed", k, e)
        try:
            asset["blur"] = srv.url(_blur_bg(raw, d / f"img{k}_blur.jpg"))
        except Exception as e:
            print("blur failed", k, e)
        out.append(asset)
    return out


# ── Flow A: Buat Iklan ────────────────────────────────────────────────────────
def _align_display(display: str, tts_words: list, dur: float) -> list:
    """Map each DISPLAY word to a spoken-word time (they differ where the TTS
    text spells things out, e.g. "RM19" → "sembilan belas ringgit")."""
    norm = lambda x: "".join(c for c in x.lower() if c.isalnum())
    disp = display.split()
    timed, j = [], 0
    for k, w in enumerate(disp):
        if not tts_words:
            timed.append({"w": w, "t": round(dur * k / max(1, len(disp)), 3)})
            continue
        dn, hit = norm(w), None
        for m in range(j, min(len(tts_words), j + 6)):
            tw = norm(tts_words[m]["w"])
            if tw and dn and (dn.startswith(tw) or tw.startswith(dn)):
                hit = m
                break
        m = hit if hit is not None else min(j, len(tts_words) - 1)
        timed.append({"w": w, "t": round(tts_words[m]["t"], 3)})
        j = m + 1
    # keep monotonic
    for k in range(1, len(timed)):
        if timed[k]["t"] < timed[k - 1]["t"]:
            timed[k]["t"] = timed[k - 1]["t"]
    return timed


def _flow_ad(p: dict, d: Path, srv: _Serve) -> dict:
    lines_in = p.get("lines") or []
    if not lines_in:
        raise RuntimeError("no script lines")
    language = p.get("language") or "ms"

    _progress("voice", 5)
    raws = []
    for i, ln in enumerate(lines_in):
        raws.append(_download(ln["audio_url"], d / f"vo_{i}.mp3", 30 * 1024 * 1024))

    _progress("align", 12)
    lines_out, t = [], float(p.get("lead_in", 0.35))
    vo = []
    for i, (ln, raw) in enumerate(zip(lines_in, raws)):
        words = _transcribe(raw, language, vad=False)
        lead = max(0.0, (words[0]["t"] - 0.06) if words else 0.0)
        wav = d / f"vo_{i}.wav"
        _run(["ffmpeg", "-v", "error", "-y", "-ss", f"{lead:.3f}", "-i", str(raw), "-af",
              "areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.06,areverse",
              "-ar", "44100", "-ac", "2", str(wav)], "trim", 120)
        dur = _probe(wav)["duration"] or 0.5
        tts_words = [{"w": w["w"], "t": max(0.0, w["t"] - lead)} for w in words]
        start = 0.0 if i == 0 else t
        end = t + dur + float(ln.get("pause", 0.25))
        lines_out.append({
            "id": str(ln["id"]), "act": ln.get("act") or "benefit", "text": ln.get("text") or "",
            "audioStart": round(t, 3), "audioDur": round(dur, 3), "sceneStart": round(start, 3), "sceneEnd": round(end, 3),
            "words": _align_display(ln.get("text") or "", tts_words, dur),
        })
        vo.append({"file": str(wav), "start": t})
        t = end
        _progress("align", 12 + 18 * (i + 1) // len(lines_in))
    total = t + float(p.get("tail", 1.8))
    lines_out[-1]["sceneEnd"] = round(total, 3)

    _progress("music", 32)
    def first(acts):
        for l in lines_out:
            if l["act"] in acts:
                return l["sceneStart"]
        return None
    marks = {k: v for k, v in {"reveal": first(("reveal", "benefit")), "price": first(("price",)),
                               "cta": first(("cta",)), "final": first(("end",))}.items() if v is not None}
    job = {"totalSec": total, "seed": int(time.time()) % 100000, "mood": p.get("mood") or "upbeat",
           "speech": [[l["audioStart"], l["audioStart"] + l["audioDur"]] for l in lines_out], "marks": marks,
           "bedOut": str(d / "bed.wav"),
           "mix": {"vo": vo, "out": str(d / "final.wav"), "bedVol": 0.55 if p.get("music", True) else 0.0}}
    (d / "music.json").write_text(json.dumps(job), encoding="utf-8")
    _run(["node", f"{MOTION_DIR}/scripts/music.mjs", str(d / "music.json")], "music", 600)

    _progress("images", 38)
    images = _prepare_images(p.get("images") or [], d, srv)

    fps = 30
    props = {
        "fps": fps, "durationInFrames": int(math.ceil(total * fps)), "lines": lines_out,
        "scenes": p.get("scenes") or [], "images": images, "brand": p.get("brand") or {"name": "", "accent": "#22c55e"},
        "audio": srv.url(d / "final.wav"), "captions": bool(p.get("captions", True)),
        "captionStyle": p.get("caption_style") or "pop", "sfx": bool(p.get("sfx", True)),
    }
    out = d / "out.mp4"
    _progress("render", 40)
    _render("MotionAd", props, d, out, 40, 95)
    return {"out": out, "duration": total, "poster_at": min(2.0, total / 3), "debug": {"lines": len(lines_out), "images": len(images)}}


# ── Flow B: Edit Video ────────────────────────────────────────────────────────
def _normalise(src: Path, out: Path, info: dict, max_sec: float) -> Path:
    w, h = info["w"] or 1080, info["h"] or 1920
    ar = w / h if h else 0.5625
    if 0.53 <= ar <= 0.6:
        vf = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p"
        fc = f"[0:v]{vf}[v]"
    else:
        fc = ("[0:v]split[a][b];"
              "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:6,eq=brightness=-0.08[bg];"
              "[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];"
              "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[v]")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src)]
    if not info["audio"]:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    cmd += ["-t", f"{max_sec:.2f}", "-filter_complex", fc, "-map", "[v]", "-map", "0:a:0" if info["audio"] else "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]
    if not info["audio"]:
        cmd += ["-shortest"]
    _run(cmd + [str(out)], "normalise", 900)
    return out


def _fallback_plan() -> dict:
    return {"captions": {"on": True, "style": "pop", "pos": "low", "maxWords": 3}, "accent": "#FFD93B",
            "overlays": [], "zooms": [], "music": False}


def _flow_edit(p: dict, d: Path, srv: _Serve) -> dict:
    import requests
    max_sec = float(p.get("max_sec") or 180)
    _progress("download", 3)
    src = _download(p["video_url"], d / "src_video")
    info = _probe(src)
    if info["duration"] <= 0.5:
        raise RuntimeError("video has no duration (unreadable file?)")
    dur = min(info["duration"], max_sec)

    _progress("normalise", 8)
    vid = _normalise(src, d / "video.mp4", info, dur)
    dur = _probe(vid)["duration"] or dur

    _progress("transcribe", 20)
    lang = p.get("language") or "ms"
    words = _transcribe(vid, None if lang == "auto" else lang, vad=True) if info["audio"] else []

    _progress("plan", 35)
    plan, plan_fallback = None, False
    try:
        r = requests.post(p["plan_url"], json={"history_id": p["history_id"], "token": p["plan_token"], "duration": dur,
                                               "words": [{"i": i, **w} for i, w in enumerate(words)]}, timeout=280)
        j = r.json()
        if r.ok and j.get("ok") and isinstance(j.get("plan"), dict):
            plan = j["plan"]
        else:
            print("plan rejected:", str(j)[:400])
    except Exception as e:
        print("plan call failed:", e)
    if not plan:
        plan, plan_fallback = _fallback_plan(), True

    props = {
        "fps": 30, "durationInFrames": int(math.floor(dur * 30)), "video": srv.url(vid), "words": words,
        "captions": plan.get("captions") or _fallback_plan()["captions"], "accent": plan.get("accent") or "#FFD93B",
        "overlays": plan.get("overlays") or [], "zooms": plan.get("zooms") or [], "hook": plan.get("hook"),
        "sfx": bool(p.get("sfx", True)),
    }
    if p.get("music") and words is not None:
        _progress("music", 42)
        spans, cur = [], None
        for w in words:
            if cur and w["t"] - cur[1] < 0.35:
                cur[1] = w["e"]
            else:
                if cur:
                    spans.append(cur)
                cur = [w["t"], w["e"]]
        if cur:
            spans.append(cur)
        job = {"totalSec": dur, "seed": int(time.time()) % 100000, "mood": plan.get("mood") or p.get("mood") or "chill",
               "speech": spans, "marks": {}, "bedOut": str(d / "bed.wav")}
        (d / "music.json").write_text(json.dumps(job), encoding="utf-8")
        _run(["node", f"{MOTION_DIR}/scripts/music.mjs", str(d / "music.json")], "music", 600)
        props["music"] = srv.url(d / "bed.wav")
        props["musicVolume"] = 0.3

    out = d / "out.mp4"
    _progress("render", 45)
    _render("MotionEdit", props, d, out, 45, 95)
    return {"out": out, "duration": dur, "poster_at": min(1.5, dur / 3),
            "debug": {"words": len(words), "overlays": len(props["overlays"]), "plan_fallback": plan_fallback}}


# ── job + endpoints ───────────────────────────────────────────────────────────
@app.function(image=render_image, cpu=8.0, memory=16384, timeout=1800, secrets=SECRETS)
def run_job(payload: dict) -> dict:
    t0 = time.time()
    flow = payload.get("flow")
    uid = str(payload.get("user_id") or "anon")
    hid = str(payload.get("history_id") or f"job{int(t0)}")
    try:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            srv = _Serve(d)
            try:
                res = _flow_ad(payload, d, srv) if flow == "ad" else _flow_edit(payload, d, srv)
            finally:
                srv.close()
            _progress("upload", 96)
            url = _upload_b2(res["out"], f"users/{uid}/motion/{hid}.mp4", "video/mp4")
            poster_url = None
            try:
                poster_url = _upload_b2(_poster(res["out"], res["poster_at"], d / "poster.jpg"),
                                        f"users/{uid}/motion/{hid}.jpg", "image/jpeg")
            except Exception as e:
                print("poster failed", e)
            _progress("done", 100)
            return {"ok": True, "url": url, "poster_url": poster_url, "duration_sec": round(float(res["duration"]), 2),
                    "render_sec": round(time.time() - t0, 1), **res.get("debug", {})}
    except Exception as e:
        _progress("failed", 100)
        return {"ok": False, "error": str(e)[:900]}


def _authorised(secret: str) -> bool:
    import hmac
    want = os.environ.get("MOTION_SECRET") or ""
    return bool(want) and hmac.compare_digest(secret, want)


def _upload_sig_ok(key: str, exp: str, sig: str) -> bool:
    """Upload URLs are minted by PeningLab: sig = HMAC-SHA256(MOTION_SECRET, "key|exp")."""
    import hashlib
    import hmac
    want = os.environ.get("MOTION_SECRET") or ""
    if not (want and key and exp and sig):
        return False
    try:
        if int(exp) < time.time():
            return False
    except ValueError:
        return False
    if not re.fullmatch(r"motion-uploads/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(mp4|mov|webm|m4v)", key):
        return False
    mac = hmac.new(want.encode(), f"{key}|{exp}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, sig)


MAX_UPLOAD = 300 * 1024 * 1024
upload_image = web_image.pip_install("boto3==1.34.0")


# One ASGI app = one Modal endpoint slot for everything the web side needs:
#   POST /start   (server → Modal, MOTION_SECRET)    spawn a render job
#   GET  /check   (server → Modal, MOTION_SECRET)    job status / progress / result
#   POST /upload  (browser → Modal, signed URL)      client video → B2 (bypasses
#                 Vercel's 4.5MB body cap and the Supabase 50MB storage cap)
@app.function(image=upload_image, secrets=SECRETS, timeout=900)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    web = FastAPI()
    web.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"https://([a-z0-9-]+\.)?peninglab\.com|http://localhost:\d+|https://[a-z0-9-]+\.vercel\.app",
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["content-type"],
    )

    @web.post("/start")
    async def start(payload: dict):
        if not _authorised(str(payload.get("secret") or "")):
            return JSONResponse({"ok": False, "error": "unauthorised"}, status_code=401)
        if payload.get("flow") not in ("ad", "edit"):
            return {"ok": False, "error": "flow must be ad or edit"}
        job = {k: v for k, v in payload.items() if k != "secret"}
        call = await run_job.spawn.aio(job)
        return {"ok": True, "call_id": call.object_id}

    @web.get("/check")
    async def check(call_id: str = "", secret: str = ""):
        if not _authorised(secret):
            return JSONResponse({"status": "failed", "error": "unauthorised"}, status_code=401)
        if not call_id:
            return {"status": "failed", "error": "call_id required"}
        try:
            fc = modal.FunctionCall.from_id(call_id)
            res = await fc.get.aio(timeout=0)
        except TimeoutError:
            prog = None
            try:
                prog = await PROGRESS.get.aio(call_id)
            except Exception:
                pass
            return {"status": "running", "progress": prog}
        except Exception as e:
            return {"status": "failed", "error": f"{type(e).__name__}: {str(e)[:300]}"}
        if isinstance(res, dict) and res.get("ok"):
            return {"status": "done", "result": res}
        return {"status": "failed", "error": (res or {}).get("error") if isinstance(res, dict) else "unknown"}

    @web.post("/upload")
    async def upload(request: Request, key: str = "", exp: str = "", sig: str = ""):
        import asyncio
        if not _upload_sig_ok(key, exp, sig):
            return JSONResponse({"ok": False, "error": "invalid or expired upload link"}, status_code=403)
        ctype = (request.headers.get("content-type") or "video/mp4").split(";")[0].strip()
        if not ctype.startswith("video/"):
            return JSONResponse({"ok": False, "error": "video files only"}, status_code=415)
        declared = int(request.headers.get("content-length") or 0)
        if declared > MAX_UPLOAD:
            return JSONResponse({"ok": False, "error": "video too large (max 300MB)"}, status_code=413)
        with tempfile.NamedTemporaryFile(suffix=Path(key).suffix, delete=False) as f:
            tmp = Path(f.name)
            n = 0
            async for chunk in request.stream():
                n += len(chunk)
                if n > MAX_UPLOAD:
                    tmp.unlink(missing_ok=True)
                    return JSONResponse({"ok": False, "error": "video too large (max 300MB)"}, status_code=413)
                f.write(chunk)
        try:
            if n < 1024:
                return JSONResponse({"ok": False, "error": "empty upload"}, status_code=400)
            url = await asyncio.to_thread(_upload_b2, tmp, key, ctype)
            return {"ok": True, "url": url, "bytes": n}
        except Exception as e:
            return JSONResponse({"ok": False, "error": str(e)[:300]}, status_code=500)
        finally:
            tmp.unlink(missing_ok=True)

    return web
