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
Flow "edit" (Edit Video): client video → Whisper transcript → jump cuts
            (silences / fillers / stutters) + normalise 1080x1920 → face
            track (MediaPipe) → POST transcript to PeningLab /api/motion/plan
            (director LLM with admin's model cascade + Serper Google images &
            fact cards) → download B-roll + animated emoji → visual QA
            (stills → /api/motion/qa → patch) → parallel chunk render
            (render_chunk containers, Volume-shared job dir) → MP4 on B2.

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
import sys
import tempfile
import threading
import time
from pathlib import Path

import modal

app = modal.App("peninglab-motion")

MOTION_DIR = "/app/motion"


FACE_MODEL = "/models/blaze_face_short_range.tflite"
FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"


def _preload_models():
    from faster_whisper import WhisperModel
    WhisperModel("small", device="cpu", compute_type="int8", download_root="/models/whisper")
    from rembg import new_session
    new_session("isnet-general-use")
    import urllib.request
    urllib.request.urlretrieve(FACE_MODEL_URL, FACE_MODEL)


render_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        "ffmpeg", "curl", "ca-certificates", "gnupg",
        "fonts-noto-core", "fonts-noto-color-emoji",
        # Chrome Headless Shell runtime deps (Remotion docs, Debian)
        "libnss3", "libdbus-1-3", "libatk1.0-0", "libgbm-dev", "libasound2", "libxrandr2",
        "libxkbcommon-dev", "libxfixes3", "libxcomposite1", "libxdamage1", "libatk-bridge2.0-0",
        "libpango-1.0-0", "libcairo2", "libcups2",
        # mediapipe / opencv runtime
        "libgl1", "libglib2.0-0",
    )
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
    )
    .pip_install(
        # 1.0.3's word alignment crashed on some phone videos with VAD on
        # ("boolean index did not match indexed array …"); fixed in 1.1.x
        "faster-whisper==1.1.1", "rembg[cpu]==2.0.59", "pillow==10.4.0", "numpy<2", "scipy==1.13.1",
        "mediapipe==0.10.21", "requests==2.31.0", "boto3==1.34.0", "fastapi[standard]==0.115.0",
    )
    .run_commands("mkdir -p /models")
    .run_function(_preload_models)
    .add_local_dir("motion", MOTION_DIR, copy=True, ignore=["node_modules", "build", "out", "public/sfx/**"])
    .run_commands(
        f"cd {MOTION_DIR} && npm ci --no-audit --no-fund",
        f"cd {MOTION_DIR} && npx remotion browser ensure",
        f"cd {MOTION_DIR} && node scripts/sfx.mjs && node scripts/bundle.mjs",
    )
)


# Laju v2: the same compositions rendered by HyperFrames (motion-hf/: the
# Remotion components compiled against a Preact shim). HyperFrames needs Node
# 22, installed beside the image's Node 20 (which Remotion keeps using): only
# the HyperFrames calls put /opt/node22/bin first on PATH.
NODE22 = "/opt/node22"
NODE22_VERSION = "v22.12.0"
HF_VERSION = "0.8.181"
HF_DIR = "/app/motion-hf"
DEEP_FILTER_URL = "https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-unknown-linux-musl"
hf_render_image = (
    render_image
    .apt_install("xz-utils")
    .run_commands(
        f"curl -fsSL https://nodejs.org/dist/{NODE22_VERSION}/node-{NODE22_VERSION}-linux-x64.tar.xz | tar -xJ -C /opt"
        f" && mv /opt/node-{NODE22_VERSION}-linux-x64 {NODE22} && {NODE22}/bin/node --version",
        f"PATH={NODE22}/bin:$PATH npm install -g hyperframes@{HF_VERSION} --no-audit --no-fund",
        f"PATH={NODE22}/bin:$PATH hyperframes browser ensure",
    )
    # voice clean-up: DeepFilterNet3 as one static binary (MIT / Apache-2.0, model built in, no torch)
    .run_commands(
        f"curl -fsSL -o /usr/local/bin/deep-filter {DEEP_FILTER_URL} && chmod +x /usr/local/bin/deep-filter && /usr/local/bin/deep-filter --version",
    )
    # CLIPPER: yt-dlp (YouTube needs a JS runtime: Deno) and YuNet (OpenCV Zoo, MIT) for faces in wide shots
    .apt_install("unzip")
    .run_commands(
        "curl -fsSL -o /tmp/deno.zip https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip"
        " && unzip -o /tmp/deno.zip -d /usr/local/bin && rm /tmp/deno.zip && deno --version",
        "curl -fsSL -o /models/yunet.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        " && test $(stat -c%s /models/yunet.onnx) -gt 100000",
    )
    .pip_install("yt-dlp[default]", "yt-dlp-ejs")
    .env({"HYPERFRAMES_NO_TELEMETRY": "1", "DO_NOT_TRACK": "1", "HYPERFRAMES_SKIP_SKILLS": "1"})
    .add_local_dir("motion-hf", HF_DIR, copy=True, ignore=["node_modules", "dist"])
    .run_commands(
        f"cd {HF_DIR} && PATH={NODE22}/bin:$PATH PUPPETEER_SKIP_DOWNLOAD=true npm ci --no-audit --no-fund",
        f"cd {HF_DIR} && PATH={NODE22}/bin:$PATH node build/bundle.mjs && ls -la dist",
    )
    # CLIPPER: the virtual camera (static locks, eased re-centring, speaker cuts on diarized turns)
    .add_local_file("clipper-asd/camera.py", "/app/clipper-asd/camera.py", copy=True)
)


web_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]==0.115.0")

# Speaker cut-out (HyperFrames Pro: text behind the speaker, spotlight, speaker sticker over a scene):
# BiRefNet-lite (ZhengPeng7/BiRefNet_lite, MIT — code and weights) on a GPU, only on the windows the
# director's plan needs; delivered as VP9 + alpha WebM (HyperFrames decodes VP9 alpha to PNG frames).
MATTE_MODEL = "ZhengPeng7/BiRefNet_lite"
MATTE_DIR = "/models/birefnet"


def _preload_matte():
    from huggingface_hub import snapshot_download
    snapshot_download(MATTE_MODEL, local_dir=MATTE_DIR)


matte_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("torch==2.5.1", "torchvision==0.20.1", "transformers==4.46.3", "timm==1.0.11", "kornia==0.7.4",
                 "einops==0.8.0", "numpy<2", "pillow==10.4.0", "huggingface_hub==0.26.2", "safetensors==0.4.5", "scipy==1.13.1")
    .run_function(_preload_matte)
)

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
_STAGES: dict = {}  # stage → first time it was reported (this job), for the timing breakdown


def _progress(stage: str, pct: int = 0):
    _STAGES.setdefault(stage, time.time())
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



# Shared scratch for one job across the orchestrator + its render-chunk
# containers (they each serve the job dir on the same local port, so asset
# URLs in props are valid everywhere).
JOBS = modal.Volume.from_name("peninglab-motion-jobs", create_if_missing=True)
JOBS_ROOT = "/jobs"
SERVE_PORT = 8765
CHUNK_FRAMES = 200  # ≈6.7 s of video per chunk container
MAX_CHUNKS = 16


class _Serve:
    """Serve a directory on 127.0.0.1 so the headless renderer can load job assets."""

    def __init__(self, root: Path, port: int = SERVE_PORT):
        import functools
        from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

        class Quiet(SimpleHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def end_headers(self):
                # The renderer page (localhost:3000) fetch()es Lottie JSON from
                # here — without CORS the browser blocks it.
                self.send_header("Access-Control-Allow-Origin", "*")
                super().end_headers()

        ThreadingHTTPServer.allow_reuse_address = True
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Quiet, directory=str(root)))
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def url(self, p: Path) -> str:
        return f"{self.base}/{p.name}"

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()



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


# Whisper drops "erm/aah" unless the prompt shows them — the jump cut needs them.
# Both also carry a few English terms the way Malaysians mix them in, so Whisper
# keeps those in English spelling instead of writing them the Malay way.
FILLER_PROMPT = "Erm, okay jadi… aah, macam ni, kan? Emm, korang tahu tak, uhh, ni produk dia, memang best untuk skincare routine."
# Without fillers a Malay video still gets a Malay context, so unclear audio is
# decoded toward Malay words rather than sound-alikes.
MALAY_PROMPT = "Okey korang, hari ni saya nak share review produk ni. Senang je nak guna, kulit terus glowing, jom tengok sampai habis."


def _asr_prompt(language, keep_fillers: bool, hint) -> str | None:
    parts = [FILLER_PROMPT] if keep_fillers else ([MALAY_PROMPT] if language == "ms" else [])
    hint = re.sub(r"\s+", " ", str(hint or "")).strip()[:120]
    if hint:
        parts.append(f"Produk: {hint}.")  # brand / product spelling
    return " ".join(parts) or None


def _transcribe(src: Path, language, vad: bool, keep_fillers: bool = False, hint=None) -> list:
    pcm = _pcm16k(src)

    def run(use_vad: bool):
        segs, _info = _whisper().transcribe(pcm, language=language or None, word_timestamps=True,
                                            beam_size=5, vad_filter=use_vad,
                                            initial_prompt=_asr_prompt(language, keep_fillers, hint))
        return list(segs)  # the segments are lazy: decode (and fail) here

    try:
        segs = run(vad)
    except Exception as e:  # noqa: BLE001
        if not vad:
            raise
        # a word-alignment failure on one segment must not fail the client's job
        print("transcribe with VAD failed, retrying without:", str(e)[:200], flush=True)
        segs = run(False)
    words = []
    for s in segs:
        for w in (s.words or []):
            # Whisper glues a hyphen to the front of some words ("-satu", "-cepat")
            t = re.sub(r"^[-–—]+(?=\w)", "", w.word.strip())
            if t:
                words.append({"w": t, "t": round(float(w.start), 3), "e": round(float(w.end), 3)})
    return words



def _node_render(comp: str, props_path: Path, out: Path, extra: list, scale: float, conc: str = "8",
                 on_pct=None, timeout: int = 1700):
    env = {**os.environ, "RENDER_CONCURRENCY": conc, "RENDER_SCALE": str(scale)}
    proc = subprocess.Popen(["node", "scripts/render.mjs", f"{MOTION_DIR}/build", comp, str(props_path), str(out), *extra],
                            cwd=MOTION_DIR, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", env=env)
    tail = []
    for line in proc.stdout:
        line = line.rstrip()
        tail = (tail + [line])[-40:]
        m = re.match(r"PROGRESS (\d+)", line)
        if m and on_pct:
            on_pct(int(m.group(1)))
    proc.wait(timeout=timeout)
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError("render failed: " + " | ".join(tail[-12:])[-1500:])


LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11"  # TikTok / Reels loudness target
MUSIC_BPM = {"chill": 88, "upbeat": 100, "hype": 116}  # the tempos motion/scripts/music.mjs plays


def _loudnorm_inplace(out: Path) -> None:
    """Master the finished mix (voice + SFX + music) to -14 LUFS: measure, then ONE static gain to the target and a
    peak limiter that only shaves the SFX transients (-2 dBFS ceiling). A linear two-pass loudnorm stops short when the
    transients hit the true-peak ceiling (an 83 s edit came out at -20.4 LUFS); single-pass loudnorm rides the gain
    and lifts the room noise in every pause. Single pass only if measuring fails."""
    tmp = out.with_name(out.stem + "_ln.mp4")
    af = LOUDNORM
    try:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(out), "-vn", "-af", LOUDNORM + ":print_format=json", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=300)
        m = json.loads(r.stderr[r.stderr.rindex("{"):r.stderr.rindex("}") + 1])
        if float(m["input_i"]) > -60:
            gain = max(-20.0, min(20.0, -14.0 - float(m["input_i"])))
            af = f"volume={gain:.2f}dB,alimiter=limit=0.79:attack=5:release=60:level=0,aresample=48000"
    except Exception as e:  # noqa: BLE001
        print("loudnorm measure failed (single pass):", str(e)[:160])
    try:
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", af,
              "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(tmp)], "loudnorm", 300)
        tmp.replace(out)
    except Exception as e:  # noqa: BLE001
        print("loudnorm skipped:", str(e)[:160])


def _render_single(comp: str, props: dict, d: Path, out: Path, scale: float, pct_from: int, pct_to: int):
    pp = d / "props.json"
    pp.write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
    _node_render(comp, pp, out, [], scale, on_pct=lambda p: _progress("render", pct_from + (pct_to - pct_from) * p // 100))
    _loudnorm_inplace(out)


def _render_parallel(comp: str, props: dict, d: Path, out: Path, scale: float, pct_from: int, pct_to: int) -> dict:
    """Split the frames over several containers (job dir shared through the
    Volume, chunks returned as bytes), render the audio once here, stitch with
    ffmpeg. Failed chunk → one retry → whole-job single render (cascade)."""
    total = int(props["durationInFrames"])
    n = max(1, min(MAX_CHUNKS, math.ceil(total / CHUNK_FRAMES)))
    if n == 1:
        _render_single(comp, props, d, out, scale, pct_from, pct_to)
        return {"chunks": 1, "mode": "single"}
    pp = d / "props.json"
    pp.write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
    JOBS.commit()
    size = math.ceil(total / n)
    ranges = [(i, i * size, min(total - 1, (i + 1) * size - 1)) for i in range(n) if i * size < total]
    job = d.name
    tmp = Path(tempfile.mkdtemp(prefix="chunks_"))

    got = {}
    for res in render_chunk.map([job] * len(ranges), [comp] * len(ranges), [r[1] for r in ranges], [r[2] for r in ranges],
                                [r[0] for r in ranges], [scale] * len(ranges), order_outputs=False, return_exceptions=True):
        if isinstance(res, dict) and res.get("ok") and res.get("data") and res.get("audio"):
            got[res["idx"]] = res
            _progress("render", pct_from + (pct_to - pct_from) * len(got) // (len(ranges) + 1))
        else:
            print("chunk failed:", str(res)[:300])
    for idx, s, e in ranges:  # one retry each
        if idx in got:
            continue
        try:
            res = render_chunk.remote(job, comp, s, e, idx, scale)
            if res.get("ok") and res.get("data") and res.get("audio"):
                got[idx] = res
        except Exception as ex:  # noqa: BLE001
            print("chunk retry failed:", idx, str(ex)[:200])
    missing = [idx for idx, _s, _e in ranges if idx not in got]
    if missing:
        print("parallel render incomplete → single render", missing)
        _render_single(comp, props, d, out, scale, pct_from, pct_to)
        return {"chunks": len(ranges), "mode": "fallback-single", "missing": missing}

    for idx, _s, _e in ranges:
        (tmp / f"chunk_{idx:02d}.mp4").write_bytes(got[idx]["data"])
        (tmp / f"chunk_{idx:02d}.wav").write_bytes(got[idx]["audio"])
    vlst = tmp / "chunks.txt"
    vlst.write_text("".join(f"file '{tmp / f'chunk_{idx:02d}.mp4'}'\n" for idx, _s, _e in ranges))
    alst = tmp / "audio.txt"
    alst.write_text("".join(f"file '{tmp / f'chunk_{idx:02d}.wav'}'\n" for idx, _s, _e in ranges))
    audio = tmp / "audio.wav"
    _run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(alst), "-c", "copy", str(audio)], "audio join", 300)
    _run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(vlst), "-i", str(audio),
          "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-af", LOUDNORM, "-c:a", "aac", "-b:a", "192k", "-shortest",
          "-movflags", "+faststart", str(out)], "stitch", 600)
    got_sec = _probe(out)["duration"]
    want = total / float(props.get("fps") or 30)
    if abs(got_sec - want) > 1.0:
        print(f"stitched duration {got_sec:.2f}s vs {want:.2f}s → single render")
        _render_single(comp, props, d, out, scale, pct_from, pct_to)
        return {"chunks": len(ranges), "mode": "fallback-single", "reason": "duration"}
    return {"chunks": len(ranges), "mode": "parallel"}



@app.function(image=render_image, cpu=8.0, memory=16384, timeout=1500, volumes={JOBS_ROOT: JOBS})
def render_chunk(job: str, comp: str, start: int, end: int, idx: int, scale: float) -> dict:
    """Render frames [start, end] of a prepared job: muted video + the same
    range's audio (WAV) in parallel; return both as bytes."""
    t0 = time.time()
    JOBS.reload()
    d = Path(JOBS_ROOT) / job
    srv = _Serve(d)
    try:
        rng = ["--from", str(start), "--to", str(end)]
        out = Path(tempfile.gettempdir()) / f"{job}_chunk_{idx:02d}.mp4"
        wav = Path(tempfile.gettempdir()) / f"{job}_chunk_{idx:02d}.wav"
        err = []

        def _aud():
            try:
                _node_render(comp, d / "props.json", wav, rng + ["--audio-only"], 1.0, conc="3")
            except Exception as e:  # noqa: BLE001
                err.append(str(e))

        th = threading.Thread(target=_aud, daemon=True)
        th.start()
        _node_render(comp, d / "props.json", out, rng + ["--muted"], scale, conc="6")
        th.join(timeout=1200)
        if err or not wav.exists():
            raise RuntimeError("chunk audio failed: " + (err[0][:300] if err else "missing"))
        return {"ok": True, "idx": idx, "sec": round(time.time() - t0, 1), "data": out.read_bytes(), "audio": wav.read_bytes()}
    finally:
        srv.close()


# ── Laju v2: HyperFrames, distributed ─────────────────────────────────────────
# The orchestrator builds the page and the Plan v2 (audio mixed once), the
# chunk containers render frame ranges in parallel, the orchestrator stitches
# them. Chunk containers are started before planning so their cold start
# overlaps it; they wait for the plan on the Volume.
HF_MAX_CHUNKS = 32
HF_PLAN = "hfplan"
HF_READY = "hfplan.ready"
_LOCAL_URL = re.compile(r"http://127\.0\.0\.1:\d+/([^\"?#\\]+)")


def _hf_env() -> dict:
    return {**os.environ, "PATH": f"{NODE22}/bin:" + os.environ.get("PATH", "")}


def _hf_node(args: list, what: str, timeout: int = 900) -> dict:
    """Run a Node 22 script of motion-hf; it prints one JSON line ({ok, …})."""
    r = subprocess.run([f"{NODE22}/bin/node", *args], capture_output=True, text=True, timeout=timeout, env=_hf_env(), cwd=HF_DIR)
    lines = [ln for ln in r.stdout.splitlines() if ln.startswith("{")]
    try:
        j = json.loads(lines[-1]) if lines else {}
    except ValueError:
        j = {}
    if r.returncode != 0 or not j.get("ok"):
        raise RuntimeError(f"{what} failed: " + str(j.get("error") or (r.stdout + r.stderr)[-1200:])[:1500])
    return j


def _hf_chunk_frames(total: int) -> int:
    """Frames per chunk: whole seconds (HyperFrames lags the footage one frame in
    a chunk that starts mid-second — see motion-hf/build/dist.mjs), at most
    HF_MAX_CHUNKS chunks."""
    return 30 * max(1, math.ceil(total / (30 * HF_MAX_CHUNKS)))


@app.function(image=hf_render_image, cpu=4.0, memory=8192, timeout=900, volumes={JOBS_ROOT: JOBS})
def hf_chunk(job: str, idx: int) -> dict:
    """Render chunk `idx` of a job's HyperFrames plan (waits for the plan to land on the Volume)."""
    import shutil
    t_up = time.time()
    d = Path(JOBS_ROOT) / job
    ready = d / HF_READY
    while True:
        JOBS.reload()
        if ready.exists():
            break
        if time.time() - t_up > 420:
            raise RuntimeError("plan never arrived")
        time.sleep(0.4)
    waited = round(time.time() - t_up, 1)
    count = int(json.loads(ready.read_text())["chunkCount"])
    if idx >= count:
        return {"ok": True, "idx": idx, "skip": True}
    t0 = time.time()
    plan = Path(tempfile.mkdtemp(prefix="hfplan_"))
    shutil.copytree(d / HF_PLAN, plan, dirs_exist_ok=True)
    copy = round(time.time() - t0, 1)
    out = Path(tempfile.gettempdir()) / f"{job}_hf_{idx:02d}.mp4"
    info = _hf_node([f"{HF_DIR}/build/dist.mjs", "chunk", str(plan), str(idx), str(out)], f"chunk {idx}", 600)
    data = out.read_bytes()
    shutil.rmtree(plan, ignore_errors=True)
    return {"ok": True, "idx": idx, "waited": waited, "copy": copy, "sec": round(time.time() - t0, 1), "info": info, "data": data}


def _hf_project(props: dict, d: Path, comp: str, proj: Path) -> dict:
    """A HyperFrames project for the composition in `proj`: only the files the props use (the job folder also
    holds the client's original upload, which must not travel into the plan), the page, the registry blocks."""
    import shutil
    blob = json.dumps(props, ensure_ascii=False)
    for name in sorted(set(_LOCAL_URL.findall(blob))):
        src = d / name
        if src.is_file():
            shutil.copy2(src, proj / name)
    (proj / "props.json").write_text(blob, encoding="utf-8")
    return _hf_node([f"{HF_DIR}/build/laju-page.mjs", str(proj), comp, f"{MOTION_DIR}/public"], "page", 300)


def _hf_stills(props: dict, d: Path, comp: str, frames: list, out_dir: Path) -> list:
    """QA stills of the composition as HyperFrames draws it (the Pro edit), 486 px wide JPEGs still_<frame>.jpg."""
    import shutil
    fps = props["fps"]
    proj = Path(tempfile.mkdtemp(prefix="hfqa_"))
    try:
        # stills need no sound: every <audio> element (SFX, music) makes the snapshot wait on it — an 83 s edit
        # with ~55 SFX took minutes, the same page without audio seconds
        _hf_project({**props, "sfx": False, "music": None}, d, comp, proj)
        snap = proj / "_snap"
        times = [f / fps for f in frames]
        r = subprocess.run(["hyperframes", "snapshot", "--at", ",".join(f"{t:.3f}" for t in times), "--no-end", "--timeout", "30000",
                            "--describe", "false", "-o", str(snap), str(proj)],
                           capture_output=True, text=True, timeout=240, env=_hf_env(), cwd=str(proj))
        pngs = sorted(snap.glob("frame-*.png"))
        if r.returncode != 0 or len(pngs) != len(frames):
            raise RuntimeError(f"snapshot: {len(pngs)}/{len(frames)} {(r.stdout + r.stderr)[-400:]}")
        out = []
        for fr, png in zip(frames, pngs):
            jpg = out_dir / f"still_{fr}.jpg"
            _run(["ffmpeg", "-v", "error", "-y", "-i", str(png), "-vf", "scale=486:-2", "-q:v", "4", str(jpg)], "qa still", 60)
            out.append(jpg)
        return out
    finally:
        shutil.rmtree(proj, ignore_errors=True)


def _render_hf(comp: str, props: dict, d: Path, out: Path, pct_from: int, pct_to: int) -> dict:
    """Render the composition with HyperFrames across hf_chunk containers → out (loudness-normalised).
    Raises on any failure (the caller then renders with Remotion)."""
    import shutil
    t0 = time.time()
    T = {}
    total = int(props["durationInFrames"])
    size = _hf_chunk_frames(total)
    n = math.ceil(total / size)
    job = d.name
    ready, plan_vol = d / HF_READY, d / HF_PLAN
    ready.unlink(missing_ok=True)
    shutil.rmtree(plan_vol, ignore_errors=True)
    JOBS.commit()
    calls = [hf_chunk.spawn(job, i) for i in range(n)]
    proj = Path(tempfile.mkdtemp(prefix="hfproj_"))
    plan_root = Path(tempfile.mkdtemp(prefix="hfplan_"))
    plan = plan_root / "plan"  # planV2 creates it (it refuses an existing folder)
    tmp = Path(tempfile.mkdtemp(prefix="hfchunks_"))
    done = False
    try:
        page = _hf_project(props, d, comp, proj)
        music = _LOCAL_URL.search(str(props.get("music") or ""))
        if music and (proj / music.group(1)).is_file():
            bed, tmp_bed = proj / music.group(1), proj / ("faded_" + music.group(1))
            dur_s = total / 30.0
            try:
                _run(["ffmpeg", "-v", "error", "-y", "-i", str(bed), "-af",
                      f"afade=t=in:d=0.8,afade=t=out:st={max(0.0, dur_s - 1.7):.2f}:d=1.7", str(tmp_bed)], "music fade", 120)
                tmp_bed.replace(bed)
            except Exception as e:  # noqa: BLE001
                print("music fade skipped:", str(e)[:160])
        T["page"] = round(time.time() - t0, 1)
        t = time.time()
        pinfo = _hf_node([f"{HF_DIR}/build/dist.mjs", "plan", str(proj), str(plan), str(size)], "plan", 600)
        if int(pinfo["totalFrames"]) != total:
            raise RuntimeError(f"plan has {pinfo['totalFrames']} frames, the composition {total}")
        count = int(pinfo["chunkCount"])
        T["plan"] = round(time.time() - t, 1)
        t = time.time()
        shutil.copytree(plan, plan_vol)
        ready.write_text(json.dumps({"chunkCount": count}))
        JOBS.commit()
        T["publish"] = round(time.time() - t, 1)
        calls += [hf_chunk.spawn(job, i) for i in range(n, count)]
        _progress("render", pct_from + 4)
        t = time.time()
        # collect as chunks finish; a failed chunk is re-run at once (≤ 2 extra runs), and once most are in, a
        # straggler running far past the median gets a twin — the first copy to finish wins (tail latency: one
        # chunk on a slow host used to hold the whole render 60–80 s)
        got, stats, runs, extra, hedged = {}, [], {}, {}, set()
        for i, c in enumerate(calls):
            if i < count:
                runs.setdefault(i, []).append((c, time.time()))
        sec_done = []
        while len(got) < count and time.time() - t < 900:
            for i in range(count):
                if i in got:
                    continue
                for c, started in list(runs.get(i, [])):
                    try:
                        res = c.get(timeout=0)
                    except (TimeoutError, modal.exception.TimeoutError):
                        continue
                    except Exception as e:  # noqa: BLE001
                        runs[i].remove((c, started))
                        print("hf chunk failed:", i, str(e)[:300], flush=True)
                        if not runs[i] and extra.get(i, 0) < 2:
                            extra[i] = extra.get(i, 0) + 1
                            c2 = hf_chunk.spawn(job, i)
                            calls.append(c2)
                            runs[i].append((c2, time.time()))
                        continue
                    if res.get("skip"):
                        continue
                    got[i] = res["data"]
                    sec_done.append(time.time() - started)
                    inf = res.get("info") or {}
                    stats.append((i, res.get("waited"), res.get("sec"), res.get("copy"), inf.get("boot"), inf.get("capture"), inf.get("encode"), inf.get("ms")))
                    _progress("render", pct_from + 4 + (pct_to - pct_from - 8) * len(got) // max(1, count))
                    break
                if i not in got and not runs.get(i) and extra.get(i, 0) >= 2:
                    raise RuntimeError(f"chunk {i} failed 3 times")
            if len(got) >= count:
                break
            if len(got) >= max(1, int(count * 0.75)) and sec_done:
                med = sorted(sec_done)[len(sec_done) // 2]
                for i in range(count):
                    if i in got or i in hedged or not runs.get(i):
                        continue
                    oldest = min(st for _, st in runs[i])
                    if time.time() - oldest > max(20.0, 1.8 * med):
                        hedged.add(i)
                        c2 = hf_chunk.spawn(job, i)
                        calls.append(c2)
                        runs[i].append((c2, time.time()))
                        print(f"hf chunk {i} hedged after {time.time() - oldest:.0f}s (median {med:.0f}s)", flush=True)
            time.sleep(0.5)
        for c in calls:  # the losing twins and any leftovers
            try:
                c.cancel()
            except Exception:  # noqa: BLE001
                pass
        missing = [i for i in range(count) if i not in got]
        if missing:
            raise RuntimeError(f"chunks missing: {missing}")
        T["chunks"] = round(time.time() - t, 1)
        T["hedged"] = len(hedged)
        t = time.time()
        paths = []
        for i in range(count):
            p = tmp / f"c{i:02d}.mp4"
            p.write_bytes(got[i])
            paths.append(str(p))
        _hf_node([f"{HF_DIR}/build/dist.mjs", "assemble", str(plan), str(out), *paths], "assemble", 600)
        _loudnorm_inplace(out)
        T["assemble"] = round(time.time() - t, 1)
        got_sec, want = _probe(out)["duration"], total / 30.0
        if abs(got_sec - want) > 0.5:
            raise RuntimeError(f"duration {got_sec:.2f}s vs {want:.2f}s")
        done = True
        T["total"] = round(time.time() - t0, 1)
        med = lambda k: sorted((s[k] or 0) for s in stats)[len(stats) // 2] if stats else None  # noqa: E731
        return {"mode": "hyperframes", "chunks": count, "chunk_frames": size, "media": page.get("media"),
                "timings": T, "slowest_chunk": max((s[2] or 0) for s in stats) if stats else None,
                "chunk_median": {"waited": med(1), "sec": med(2), "copy": med(3), "boot_ms": med(4), "capture_ms": med(5),
                                 "encode_ms": med(6), "node_ms": med(7)},
                "chunk_max_waited": max((s[1] or 0) for s in stats) if stats else None}
    finally:
        if not done:
            for c in calls:
                try:
                    c.cancel()
                except Exception:  # noqa: BLE001
                    pass
        ready.unlink(missing_ok=True)
        shutil.rmtree(plan_vol, ignore_errors=True)
        try:
            JOBS.commit()
        except Exception:  # noqa: BLE001
            pass
        for p in (proj, plan_root, tmp):
            shutil.rmtree(p, ignore_errors=True)


def _gather_chunks(job: str, count: int, calls: list, limit: float = 900) -> dict:
    """Collect a plan's chunks from hf_chunk calls: a failed chunk is re-run (≤ 2 extra runs); once 75 % are in, a
    straggler far past the median gets a twin and the first copy wins. Returns {index: mp4 bytes}; cancels leftovers."""
    t = time.time()
    got, runs, extra, hedged, sec_done = {}, {}, {}, set(), []
    for i, c in enumerate(calls):
        if i < count:
            runs.setdefault(i, []).append((c, time.time()))
    try:
        while len(got) < count and time.time() - t < limit:
            for i in range(count):
                if i in got:
                    continue
                for c, started in list(runs.get(i, [])):
                    try:
                        res = c.get(timeout=0)
                    except (TimeoutError, modal.exception.TimeoutError):
                        continue
                    except Exception as e:  # noqa: BLE001
                        runs[i].remove((c, started))
                        print("hf chunk failed:", i, str(e)[:300], flush=True)
                        if not runs[i] and extra.get(i, 0) < 2:
                            extra[i] = extra.get(i, 0) + 1
                            c2 = hf_chunk.spawn(job, i)
                            calls.append(c2)
                            runs[i].append((c2, time.time()))
                        continue
                    if res.get("skip"):
                        continue
                    got[i] = res["data"]
                    sec_done.append(time.time() - started)
                    break
                if i not in got and not runs.get(i) and extra.get(i, 0) >= 2:
                    raise RuntimeError(f"chunk {i} failed 3 times")
            if len(got) >= count:
                break
            if len(got) >= max(1, int(count * 0.75)) and sec_done:
                med = sorted(sec_done)[len(sec_done) // 2]
                for i in range(count):
                    if i in got or i in hedged or not runs.get(i):
                        continue
                    if time.time() - min(st for _, st in runs[i]) > max(20.0, 1.8 * med):
                        hedged.add(i)
                        c2 = hf_chunk.spawn(job, i)
                        calls.append(c2)
                        runs[i].append((c2, time.time()))
            time.sleep(0.5)
    finally:
        for c in calls:
            try:
                c.cancel()
            except Exception:  # noqa: BLE001
                pass
    missing = [i for i in range(count) if i not in got]
    if missing:
        raise RuntimeError(f"chunks missing: {missing}")
    return got


@app.function(image=hf_render_image, cpu=4.0, memory=8192, timeout=1800, volumes={JOBS_ROOT: JOBS})
def render_project(job: str, project: str = "ws/video", out_name: str = "render.mp4") -> dict:
    """Render a whole HyperFrames project from the jobs Volume across hf_chunk containers — the parallel renderer
    Default uses — into <job>/<out_name>. Custom Style's `pl-render` (modal_vgc.py) calls it: its workspace's
    ./video (+ ./bahan, so relative media paths hold) is copied to <job>/ws first. No loudness pass here (the
    Custom Style run masters its own audio)."""
    import shutil
    t0 = time.time()
    T = {}
    JOBS.reload()
    d = Path(JOBS_ROOT) / job
    if not (d / project / "index.html").exists():
        raise RuntimeError(f"no HyperFrames project at {project}")
    local = Path(tempfile.mkdtemp(prefix="vgcproj_"))
    plan_root = Path(tempfile.mkdtemp(prefix="hfplan_"))
    tmp = Path(tempfile.mkdtemp(prefix="hfchunks_"))
    ready, plan_vol = d / HF_READY, d / HF_PLAN
    calls = []
    try:
        # plan from a local copy (the Volume is slow for many small reads)
        shutil.copytree(d / project.split("/")[0], local / project.split("/")[0])
        proj = local / project
        T["copy"] = round(time.time() - t0, 1)
        t = time.time()
        plan = plan_root / "plan"
        size = 90
        pinfo = _hf_node([f"{HF_DIR}/build/dist.mjs", "plan", str(proj), str(plan), str(size)], "plan", 600)
        total = int(pinfo["totalFrames"])
        if int(pinfo["chunkCount"]) > HF_MAX_CHUNKS:
            size = _hf_chunk_frames(total)
            shutil.rmtree(plan, ignore_errors=True)
            pinfo = _hf_node([f"{HF_DIR}/build/dist.mjs", "plan", str(proj), str(plan), str(size)], "plan", 600)
        count = int(pinfo["chunkCount"])
        T["plan"] = round(time.time() - t, 1)
        t = time.time()
        ready.unlink(missing_ok=True)
        shutil.rmtree(plan_vol, ignore_errors=True)
        shutil.copytree(plan, plan_vol)
        ready.write_text(json.dumps({"chunkCount": count}))
        JOBS.commit()
        T["publish"] = round(time.time() - t, 1)
        t = time.time()
        calls = [hf_chunk.spawn(job, i) for i in range(count)]
        got = _gather_chunks(job, count, calls)
        T["chunks"] = round(time.time() - t, 1)
        t = time.time()
        paths = []
        for i in range(count):
            p = tmp / f"c{i:02d}.mp4"
            p.write_bytes(got[i])
            paths.append(str(p))
        out = tmp / "out.mp4"
        _hf_node([f"{HF_DIR}/build/dist.mjs", "assemble", str(plan), str(out), *paths], "assemble", 600)
        got_sec, want = _probe(out)["duration"], total / 30.0
        if abs(got_sec - want) > 0.5:
            raise RuntimeError(f"duration {got_sec:.2f}s vs {want:.2f}s")
        shutil.copy2(out, d / out_name)
        T["assemble"] = round(time.time() - t, 1)
        T["total"] = round(time.time() - t0, 1)
        return {"ok": True, "chunks": count, "chunk_frames": size, "frames": total, "timings": T}
    finally:
        ready.unlink(missing_ok=True)
        shutil.rmtree(plan_vol, ignore_errors=True)
        try:
            JOBS.commit()
        except Exception:  # noqa: BLE001
            pass
        for p in (local, plan_root, tmp):
            shutil.rmtree(p, ignore_errors=True)


def _render(comp: str, props: dict, d: Path, out: Path, scale: float, pct_from: int, pct_to: int, p: dict) -> dict:
    """Render with the renderer PeningLab asked for (payload "renderer"). HyperFrames only, no Remotion
    fallback: a failed HyperFrames render is tried once more from scratch, then the job fails. It always
    renders 1080p; a 720p job is scaled down afterwards."""
    t = time.time()
    if str(p.get("renderer") or "") == "hyperframes":
        tries = []
        for attempt in range(2):
            try:
                info = _render_hf(comp, props, d, out, pct_from, pct_to)
                if scale != 1.0:
                    small = out.with_name(out.stem + "_sd.mp4")
                    _run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-vf", f"scale={int(1080 * scale) // 2 * 2}:-2:flags=lanczos",
                          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "copy", "-movflags", "+faststart", str(small)], "downscale", 600)
                    small.replace(out)
                return {"renderer": "hyperframes", "render_phase_sec": round(time.time() - t, 1), **({"hf_retries": tries} if tries else {}), **info}
            except Exception as e:  # noqa: BLE001
                tries.append(str(e)[:300])
                print(f"hyperframes render failed (try {attempt + 1}):", tries[-1], flush=True)
        raise RuntimeError(f"HyperFrames render failed twice: {tries[-1]}")
    info = _render_parallel(comp, props, d, out, scale, pct_from, pct_to)
    return {"renderer": "remotion", "render_phase_sec": round(time.time() - t, 1), **info}



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


def _prepare_images(images: list, d: Path, srv: "_Serve", p: dict = None) -> tuple:
    raws = []
    for k, im in enumerate(images[:4]):
        url = str((im or {}).get("url") or "").strip()
        if not url:
            continue
        ext = ".png" if url.lower().split("?")[0].endswith(".png") else ".jpg"
        raws.append((k, im, _download(url, d / f"img{k}{ext}", 40 * 1024 * 1024)))
    # The client's own product photos are used as they are — the guideline
    # check never tapes, crops or drops the client's content.
    info = {}
    out = []
    for k, im, raw in raws:
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
    return out, info


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


# ── jump cuts ─────────────────────────────────────────────────────────────────
_FILLER_RE = re.compile(r"^(e+r+m*|e+m+|a{2,}h*|a+h+|u+h+|u+m+|h+m+|m{2,}|e+h+|uh|um)$")


def _wnorm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _is_filler(w: str) -> bool:
    n = _wnorm(w)
    return bool(n) and bool(_FILLER_RE.match(n))


def _keep_segments(words: list, dur: float, max_gap: float = 0.35, pad_in: float = 0.08, pad_out: float = 0.14,
                   drop: set = None):
    """Speech segments to keep: drop non-lexical fillers + immediate repeats
    (+ the TikTok-guard claim words in `drop`, by raw index "ri"), merge words
    closer than max_gap, trim every longer silence."""
    kept = []
    for w in words:
        if _is_filler(w["w"]) or (drop and w.get("ri") in drop):
            continue
        if kept and len(_wnorm(w["w"])) > 1 and _wnorm(kept[-1]["w"]) == _wnorm(w["w"]) and w["t"] - kept[-1]["e"] < 0.5:
            kept[-1] = w  # stutter: keep the later take
            continue
        kept.append(w)
    segs = []
    for w in kept:
        s = max(0.0, w["t"] - pad_in)
        e = min(dur, w["e"] + pad_out)
        if e <= s:
            continue
        if segs and s - segs[-1][1] <= max_gap:
            segs[-1][1] = max(segs[-1][1], e)
        else:
            segs.append([s, e])
    if segs and segs[0][0] < 0.4:
        segs[0][0] = 0.0
    return segs, kept


def _remap_words(kept: list, segs: list):
    """Word times after the cut (each kept segment is glued to the previous)."""
    starts, acc = [], 0.0
    for s, e in segs:
        starts.append(acc)
        acc += e - s
    out = []
    for w in kept:
        for i, (s, e) in enumerate(segs):
            if s - 1e-3 <= w["t"] <= e + 1e-3:
                nt = starts[i] + (w["t"] - s)
                ne = starts[i] + (min(w["e"], e) - s)
                out.append({"w": w["w"], "t": round(nt, 3), "e": round(max(ne, nt + 0.05), 3),
                            **({"ri": w["ri"]} if "ri" in w else {})})
                break
    return out, acc


def _claim_segments(words: list, dur: float, drop: set):
    """Jump cut OFF but guard ON: keep everything except the claim words."""
    holes = []
    for w in words:
        if w.get("ri") in drop:
            s, e = max(0.0, w["t"] - 0.06), min(dur, w["e"] + 0.08)
            if holes and s - holes[-1][1] < 0.35:
                holes[-1][1] = max(holes[-1][1], e)
            else:
                holes.append([s, e])
    segs, cur = [], 0.0
    for s, e in holes:
        if s - cur > 0.05:
            segs.append([cur, s])
        cur = max(cur, e)
    if dur - cur > 0.05:
        segs.append([cur, dur])
    return segs, [w for w in words if w.get("ri") not in drop]


# ── faces ─────────────────────────────────────────────────────────────────────
def _faces(video: Path, fps_s: int = 4) -> list:
    """Largest face per sample (normalised 0..1), lightly smoothed."""
    import numpy as np
    import mediapipe as mp
    from mediapipe.tasks import python as mpp
    from mediapipe.tasks.python import vision
    det = vision.FaceDetector.create_from_options(
        vision.FaceDetectorOptions(base_options=mpp.BaseOptions(model_asset_path=FACE_MODEL), min_detection_confidence=0.5))
    W, H = 360, 640
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={fps_s},scale={W}:{H}",
                             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    raw, i, size = [], 0, W * H * 3
    while True:
        buf = proc.stdout.read(size)
        if not buf or len(buf) < size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()
        res = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=frame))
        if res.detections:
            b = max(res.detections, key=lambda d: d.bounding_box.width * d.bounding_box.height).bounding_box
            raw.append({"t": round(i / fps_s, 2), "x": b.origin_x / W, "y": b.origin_y / H, "w": b.width / W, "h": b.height / H})
        i += 1
    proc.wait(timeout=60)
    out = []
    for k, f in enumerate(raw):  # 3-sample moving average
        win = raw[max(0, k - 1): k + 2]
        out.append({"t": f["t"], **{q: round(sum(x[q] for x in win) / len(win), 4) for q in ("x", "y", "w", "h")}})
    return out[:2000]


# ── web assets: B-roll images + animated emoji ───────────────────────────────
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def _fetch_image(url: str, dest: Path):
    """Download + decode one web image (≥360 px) → JPEG at `dest`, or None."""
    import requests
    from PIL import Image
    r = requests.get(url, timeout=12, stream=True, headers={"User-Agent": UA, "Accept": "image/*,*/*;q=0.8"})
    if not r.ok:
        return None
    data = r.raw.read(12 * 1024 * 1024 + 1, decode_content=True)
    if len(data) > 12 * 1024 * 1024 or len(data) < 4000:
        return None
    raw = dest.with_suffix(".bin")
    raw.write_bytes(data)
    im = Image.open(raw)
    im.load()
    if min(im.size) < 360:
        return None
    im = im.convert("RGB")
    im.thumbnail((1080, 1350))
    im.save(dest, quality=88)
    return dest


def _fetch_clip(url: str, d: Path, k: int, ci: int, layout: str):
    """Stock clip → ≤4.5 s muted H.264 cropped for its layout + a poster JPEG
    (the poster is what the guard OCR and the vision QA look at)."""
    raw = _download(url, d / f"brv{k}_{ci}.src", 90 * 1024 * 1024)
    clip = d / f"broll_{k}_{ci}.mp4"
    vf = ("scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920" if layout == "full"
          else "scale=720:540:force_original_aspect_ratio=increase,crop=720:540")
    _run(["ffmpeg", "-v", "error", "-y", "-ss", "0.3", "-t", "4.5", "-i", str(raw), "-an", "-vf", f"{vf},fps=30",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", str(clip)], "broll clip", 240)
    poster = d / f"broll_{k}_{ci}.jpg"
    _run(["ffmpeg", "-v", "error", "-y", "-ss", "0.6", "-i", str(clip), "-frames:v", "1", "-q:v", "3", str(poster)], "clip poster", 60)
    raw.unlink(missing_ok=True)
    return clip, poster


def _fetch_broll(items: list, d: Path, srv: _Serve, p: dict = None) -> tuple:
    """First decodable, big-enough candidate per moment (moments fetched in
    parallel); none → moment dropped. With the TikTok guard: two candidates
    per moment are OCR'd, risky printed lines taped, poster-like images
    (too many claims) skipped."""
    from concurrent.futures import ThreadPoolExecutor
    guard = bool(p and p.get("guard"))
    want = 3 if guard else 1  # spare candidates so a risky web image can be replaced

    clips = {}  # poster path → clip path (video cutaways)
    own = set()  # local paths of the client's own product photos (never checked / dropped)

    def moment(kb):
        k, b = kb
        got = []
        is_video = b.get("kind") == "video"
        layout = b.get("layout") if b.get("layout") in ("full", "pip") else "pip"
        for ci, url in enumerate((b.get("candidates") or [])[:5]):
            try:
                if is_video:
                    clip, poster = _fetch_clip(url, d, k, ci, layout)
                    clips[str(poster)] = clip
                    got.append(poster)
                else:
                    x = _fetch_image(url, d / f"broll_{k}_{ci}.jpg")
                    if x:
                        got.append(x)
                        if "/motion-images/" in url:
                            own.add(str(x))
            except Exception as e:  # noqa: BLE001
                print("broll candidate failed", k, ci, str(e)[:120])
            if len(got) >= (1 if is_video or (got and str(got[0]) in own) else want):
                break
        return k, b, got

    with ThreadPoolExecutor(8) as ex:
        picks = list(ex.map(moment, list(enumerate(items[:16]))))
    info = {}
    if guard:
        # Guideline mode never tapes anything: a web image with a risky printed
        # line is replaced by the moment's next candidate (or the moment goes
        # without B-roll). The client's own photos are used as they are.
        web = [x for _k, _b, got in picks for x in got if str(x) not in own]
        st, risky_lines = {}, {}
        if web:
            try:
                st = _guard_images(web, p, "broll", taped_out=risky_lines, tape=False)
            except Exception as e:  # noqa: BLE001
                print("guard broll failed — dropping unchecked web images:", str(e)[:200])
                st = {str(x): "drop" for x in web}
        picks = [(k, b, [x for x in got if st.get(str(x)) != "drop"]) for k, b, got in picks]
        replaced = sum(1 for v in st.values() if v == "drop")
        info = {"replaced": replaced, "dropped": replaced,
                "replaced_texts": list(dict.fromkeys(t for lines in risky_lines.values() for t in lines))[:24]}
    out = []
    for k, b, got in picks:
        if not got:
            continue
        src = got[0]
        layout = b.get("layout") if b.get("layout") in ("full", "pip") else "pip"
        entry = {"at": b.get("at"), "src": srv.url(src), "layout": layout}
        if b.get("to") is not None:
            entry["to"] = b["to"]
        if b.get("label"):
            entry["label"] = str(b["label"])[:40]
        if str(src) in clips:
            entry["video"] = srv.url(clips[str(src)])
        elif layout == "full":
            entry["blur"] = srv.url(_blur_bg(src, d / f"broll_{k}_blur.jpg"))
        out.append(entry)
    info["clips"] = sum(1 for e in out if e.get("video"))
    return out, info


def _sticker_webm(src: Path, out: Path, seconds: float = 6.0, box: int = 360) -> bool:
    """An animated GIF / WebP sticker → a VP9 + alpha WebM at 30 fps, looped to `seconds`, centred in a box² canvas.
    HyperFrames renders video frame by frame (a browser plays a GIF on its own clock, so chunks would disagree);
    Pillow decodes animated WebP, which the image's ffmpeg can't."""
    from PIL import Image, ImageSequence
    try:
        im = Image.open(src)
        frames, ends, t = [], [], 0
        for fr in ImageSequence.Iterator(im):
            rgba = fr.convert("RGBA")
            rgba.thumbnail((box, box))
            canvas = Image.new("RGBA", (box, box), (0, 0, 0, 0))
            canvas.paste(rgba, ((box - rgba.width) // 2, (box - rgba.height) // 2), rgba)
            frames.append(canvas.tobytes())
            t += max(20, int(fr.info.get("duration") or im.info.get("duration") or 100))
            ends.append(t)
            if len(frames) >= 400:
                break
        if not frames:
            return False
        n = int(seconds * 30)
        enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{box}x{box}", "-r", "30", "-i", "-",
                                "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", "30",
                                "-deadline", "realtime", "-cpu-used", "8", "-an", "-metadata:s:v:0", "alpha_mode=1", str(out)], stdin=subprocess.PIPE)
        import bisect
        for i in range(n):
            ms = (i * 1000 / 30) % ends[-1]  # the sticker loops
            enc.stdin.write(frames[min(len(frames) - 1, bisect.bisect_right(ends, ms))])
        enc.stdin.close()
        enc.wait(timeout=120)
        return enc.returncode == 0 and out.exists() and out.stat().st_size > 1000
    except Exception as e:  # noqa: BLE001
        print("sticker → webm failed:", str(e)[:160])
        return False


def _fetch_gifs(overlays: list, d: Path, srv: _Serve) -> int:
    """Animated sticker overlays (src = remote GIF/WebP) → local VP9-alpha WebM (frame-accurate on HyperFrames).
    A sticker that can't be fetched or converted becomes its fallback animated emoji."""
    import requests
    n = 0
    for i, o in enumerate(overlays):
        if o.get("t") != "gif":
            continue
        url = str(o.get("src") or "")
        try:
            if not url.startswith("https://"):
                raise ValueError("no source")
            r = requests.get(url, timeout=15, headers={"User-Agent": UA})
            ct = (r.headers.get("content-type") or "").lower()
            if not r.ok or len(r.content) > 12 * 1024 * 1024 or not any(x in ct for x in ("gif", "webp", "png")):
                raise ValueError(f"HTTP {r.status_code} {ct}")
            ext = "webp" if "webp" in ct else "png" if "png" in ct else "gif"
            f = d / f"sticker_{i}.{ext}"
            f.write_bytes(r.content)
            vid = d / f"sticker_{i}.webm"
            if not _sticker_webm(f, vid):
                raise ValueError("could not convert the sticker")
            o["src"] = srv.url(vid)
            n += 1
        except Exception as e:  # noqa: BLE001
            print("sticker fallback → emoji:", str(e)[:120])
            o["t"], o["text"] = "emoji", (o.get("sub") or "✨")
            o.pop("src", None)
    return n


def _emoji_cps(ch: str) -> list:
    full = "_".join(f"{ord(c):x}" for c in ch)
    bare = "_".join(f"{ord(c):x}" for c in ch if ord(c) != 0xFE0F)
    return list(dict.fromkeys([bare, full]))


def _fetch_lottie(chars: list, d: Path, srv: _Serve) -> dict:
    """Google Noto animated emoji (CC BY 4.0) → char → local URL."""
    import requests
    out = {}
    for ch in list(dict.fromkeys(c for c in chars if c))[:24]:
        for cp in _emoji_cps(ch):
            try:
                r = requests.get(f"https://fonts.gstatic.com/s/e/notoemoji/latest/{cp}/lottie.json", timeout=10)
                if not r.ok:
                    continue
                j = r.json()
                if not isinstance(j, dict) or "layers" not in j:
                    continue
                f = d / f"lot_{cp}.json"
                f.write_text(r.text, encoding="utf-8")
                out[ch] = srv.url(f)
                break
            except Exception:  # noqa: BLE001
                continue
    return out



# ── TikTok guard ("Check Guideline TikTok") ───────────────────────────────────
# Malaysian sellers cover the medical / claim words printed on a product box
# with sellotape before filming so TikTok Shop's review doesn't flag the video.
# Digital version: RapidOCR (PP-OCR ONNX, CPU) reads every printed line in the
# video frames (fanned out over guard_scan containers), the B-roll and the
# product photos; PeningLab's /api/motion/guard (LLM with the 2026 TikTok Shop
# + Malaysian ad rules, plus a hard-term safety net) says which lines and which
# spoken words are risky; we tape the lines (tracked in video, baked into
# images) and mute the words (captions show tape). Fail-safe: when the LLM is
# unreachable the rule safety net still applies; unreadable B-roll is dropped.

def _preload_ocr():
    import numpy as np
    from rapidocr import RapidOCR
    RapidOCR()(np.zeros((64, 64, 3), np.uint8))


guard_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install("rapidocr==3.4.5", "onnxruntime==1.20.1", "numpy<2", "pillow==10.4.0")
    .run_function(_preload_ocr)
)

GUARD_FPS = 5.0  # OCR samples per second (tape keyframes); runs in parallel with the plan call
# Safety net on OCR lines (keys are lowercase alphanumerics, no spaces).
_GUARD_HARD = re.compile(
    r"diabet|kencingmanis|guladarah|bloodsugar|bloodglucose|antiblood|antisugar|insulin|pancrea|darahtinggi|hypertens|"
    r"bloodpressure|kolesterol|cholesterol|kanser|cancer|tumou?r|buahpinggang|kidney|jantung|stroke|gout|asma|asthma|"
    r"arthrit|ubat|medicine|medical|perubatan|rawat|treatment|sembuh|cure|penyakit|disease|antiinflam|inflammat|doctor|doktor|"
    r"clinical|klinikal|terbukti|proven|dijamin|guarantee|slimming|kuruskan|turunberat|weightloss|fatburn|detox|barah|glukosa|"
    r"parasgula|sugarlevel|tekanandarah|mujarab|ajaib|miracle|toprated|pertamadimalaysia|terbaik|termurah|bestselling|"
    r"nosideeffect|tiadakesansampingan|matipucuk|lemahbatin|ozempic|glp1")
# Safety net on single spoken words (whole-word, after normalising).
_GUARD_WORD = re.compile(r"^(diabetes|diabetik|diabetic|kanser|cancer|tumor|sembuh|ubat|penyakit|cure|"
                         r"hipertensi|kolesterol|insulin|strok|stroke|gout|asma)$")

_OCR = None


def _ocr():
    global _OCR
    if _OCR is None:
        from rapidocr import RapidOCR
        _OCR = RapidOCR()
    return _OCR


def _tkey(s) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def _quad(b, sx: float = 1.0, sy: float = 1.0) -> dict:
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = [(float(x) * sx, float(y) * sy) for x, y in b]
    w = (math.hypot(x1 - x0, y1 - y0) + math.hypot(x2 - x3, y2 - y3)) / 2
    h = (math.hypot(x3 - x0, y3 - y0) + math.hypot(x2 - x1, y2 - y1)) / 2
    return {"cx": round((x0 + x1 + x2 + x3) / 4, 1), "cy": round((y0 + y1 + y2 + y3) / 4, 1), "w": round(w, 1),
            "h": round(h, 1), "a": round(math.degrees(math.atan2(y1 - y0, x1 - x0)), 1)}


def _ocr_lines(eng, img) -> list:
    r = eng(img)
    if r is None or getattr(r, "boxes", None) is None or not getattr(r, "txts", None):
        return []
    return [(b, str(t), float(s)) for b, t, s in zip(r.boxes.tolist(), r.txts, r.scores)]


@app.function(image=guard_image, cpu=4.0, memory=4096, timeout=600, volumes={JOBS_ROOT: JOBS})
def guard_scan(job: str, start: float, length: float, fps: float, j0: int, name: str = "video.mp4") -> dict:
    """OCR the sampled frames of [start, start+length) of the job's video.
    Each detection: j (global sample index), t, box (1080x1920 px), text, score."""
    import numpy as np
    JOBS.reload()
    video = Path(JOBS_ROOT) / job / name
    eng = _ocr()
    W, H = 720, 1280
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{length:.3f}", "-i", str(video),
                             "-vf", f"fps={fps},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                            stdout=subprocess.PIPE)
    dets, k, size = [], 0, W * H * 3
    while True:
        buf = proc.stdout.read(size)
        if not buf or len(buf) < size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        j = j0 + k
        for b, txt, sc in _ocr_lines(eng, frame):
            dets.append({"j": j, "t": round(j / fps, 3), **_quad(b, 1080 / W, 1920 / H), "x": txt[:120], "s": round(sc, 3)})
        k += 1
    proc.wait(timeout=60)
    return {"ok": True, "dets": dets, "frames": k}


@app.function(image=guard_image, cpu=4.0, memory=4096, timeout=300)
def guard_ocr_images(images: list) -> dict:
    """[(name, bytes)] → {name: [{"q": quad in image px, "x": text, "s": score}]}."""
    import io
    import numpy as np
    from PIL import Image
    eng = _ocr()
    out = {}
    for name, data in images:
        try:
            im = Image.open(io.BytesIO(data)).convert("RGB")
            k = min(1.0, 1280 / max(im.size))
            small = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k)))) if k < 1 else im
            arr = np.array(small)[:, :, ::-1].copy()
            out[name] = [{"q": [[round(px / k, 1), round(py / k, 1)] for px, py in b], "x": txt[:120], "s": round(sc, 3)}
                         for b, txt, sc in _ocr_lines(eng, arr)]
        except Exception as e:  # noqa: BLE001
            print("ocr image failed", name, str(e)[:120])
            out[name] = []
    return out


def _guard_classify(p: dict, kind: str, texts: list, words: list = None) -> dict:
    """PeningLab /api/motion/guard → risky text indices + word indices to mute.
    The rule safety net is always added on top (union)."""
    import requests
    out = {"risky": set(), "censor": set(), "via": "rules"}
    if p.get("guard_url") and (texts or words):
        try:
            body = {"history_id": p["history_id"], "token": p["plan_token"], "kind": kind, "texts": texts[:200]}
            if words is not None:
                body["words"] = [{"i": i, "w": w["w"]} for i, w in enumerate(words)]
            r = requests.post(p["guard_url"], json=body, timeout=150)
            j = r.json()
            if r.ok and j.get("ok"):
                out["risky"] = {int(i) for i in j.get("risky") or [] if str(i).isdigit() and int(i) < len(texts)}
                out["censor"] = {int(i) for i in j.get("censor") or [] if str(i).isdigit() and (words is None or int(i) < len(words))}
                out["via"] = "llm"
            else:
                print("guard rejected:", str(j)[:300])
        except Exception as e:  # noqa: BLE001
            print("guard call failed:", str(e)[:200])
    for i, t in enumerate(texts):
        if _GUARD_HARD.search(_tkey(t)):
            out["risky"].add(i)
    for i, w in enumerate(words or []):
        a = re.sub(r"[^a-z]", "", str(w.get("w", "")).lower())
        b = re.sub(r"[^a-z]", "", str(words[i + 1].get("w", "")).lower()) if i + 1 < len(words) else ""
        if _GUARD_WORD.match(a):
            out["censor"].add(i)
        if (a, b) in (("kencing", "manis"), ("darah", "tinggi"), ("gula", "darah"), ("buah", "pinggang")):
            out["censor"].update((i, i + 1))
    return out


def _guard_tracks(dets: list, risky: set, fps: float, cuts: list = None) -> list:
    """Group risky OCR lines into tracks across samples; extend each track
    through blurred / misread frames where a box sits in the same place.
    A track never spans a jump cut (`cuts`: boundary times of the cut video)
    and its tape never lingers into the next shot."""
    cuts = sorted(cuts or [])

    def seg_of(t: float) -> int:
        return sum(1 for c in cuts if c <= t)
    by_j = {}
    for x in dets:
        by_j.setdefault(x["j"], []).append(x)

    def near(a, b):
        if not (0.5 < (b["w"] + 1) / (a["w"] + 1) < 2.0 and 0.45 < (b["h"] + 1) / (a["h"] + 1) < 2.2):
            return False
        return math.hypot(a["cx"] - b["cx"], a["cy"] - b["cy"]) < max(40.0, 0.6 * max(a["w"], a["h"] * 3))

    gap = int(1.0 * fps)  # bridge OCR misses (blur) up to 1 s; longer = the box left the frame
    tracks = []
    for j in sorted(by_j):
        for x in by_j[j]:
            if x["s"] < 0.5 or _tkey(x["x"]) not in risky:
                continue
            best, bd = None, 1e9
            for tr in tracks:
                last = tr[-1]
                if last["j"] >= j or j - last["j"] > gap or not near(last, x) or seg_of(last["t"]) != seg_of(x["t"]):
                    continue
                dd = math.hypot(last["cx"] - x["cx"], last["cy"] - x["cy"])
                if dd < bd:
                    best, bd = tr, dd
            if best is not None:
                best.append(x)
            else:
                tracks.append([x])
    for tr in tracks:
        for step in (1, -1):
            for _ in range(int(1.2 * fps)):
                edge = tr[-1] if step > 0 else tr[0]
                cand = [x for x in by_j.get(edge["j"] + step, []) if near(edge, x) and seg_of(x["t"]) == seg_of(edge["t"])]
                if not cand:
                    break
                c = min(cand, key=lambda x: math.hypot(x["cx"] - edge["cx"], x["cy"] - edge["cy"]))
                if step > 0:
                    tr.append(c)
                else:
                    tr.insert(0, c)
    out = []
    hold = 0.5 / fps + 0.06  # cover the half-interval before/after the first/last sample
    for tr in tracks[:80]:
        keys = []
        for n, x in enumerate(tr):
            # Position is NOT smoothed (smoothing makes the tape lag a moving
            # box); size / angle get a light 3-sample smoothing. Faster motion
            # → a little extra padding so the tape still covers between samples.
            win = tr[max(0, n - 1): n + 2]
            a, b = tr[max(0, n - 1)], tr[min(len(tr) - 1, n + 1)]
            dt = max(1e-3, (b["j"] - a["j"]) / fps)
            v = math.hypot(b["cx"] - a["cx"], b["cy"] - a["cy"]) / dt if b is not a else 0.0
            pad = min(40.0, v * 0.08)
            keys.append([round(x["j"] / fps, 3), x["cx"], x["cy"],
                         round(sum(y["w"] for y in win) / len(win) + pad, 1), round(sum(y["h"] for y in win) / len(win) + pad * 0.6, 1),
                         round(sorted(y["a"] for y in win)[len(win) // 2], 1)])
        t0, t1 = keys[0][0], keys[-1][0]
        before = [c for c in cuts if c <= t0]
        after = [c for c in cuts if c > t1]
        pre = max(0.0, min(hold, t0 - before[-1] if before else hold))
        post = max(0.0, min(hold, after[0] - t1 - 1 / 30 if after else hold))
        out.append({"k": keys, "pre": round(pre, 3), "post": round(post, 3)})
    return out


def _guard_speech(words: list, p: dict) -> dict:
    """Before the jump cut: which whole claim statements to CUT (an implied
    claim survives a single bleep), which isolated words to MUTE, and how risky
    the product itself is (some can't be sold on TikTok Shop MY whatever the
    edit). Word indices are raw (pre-cut). Rules always added on top."""
    import requests
    out = {"cut": set(), "censor": set(), "risk": None, "via": "rules"}
    if p.get("guard_url") and words:
        try:
            r = requests.post(p["guard_url"], json={"history_id": p["history_id"], "token": p["plan_token"], "kind": "speech",
                                                   "words": [{"i": i, "w": w["w"]} for i, w in enumerate(words)]}, timeout=150)
            j = r.json()
            if r.ok and j.get("ok"):
                for a, b in (j.get("cut") or []):
                    a, b = int(a), int(b)
                    if 0 <= a <= b < len(words) and b - a < 60:
                        out["cut"].update(range(a, b + 1))
                out["censor"] = {int(i) for i in j.get("censor") or [] if str(i).isdigit() and int(i) < len(words)}
                out["risk"] = j.get("risk") if isinstance(j.get("risk"), dict) else None
                out["via"] = j.get("via") or "llm"
            else:
                print("guard speech rejected:", str(j)[:300])
        except Exception as e:  # noqa: BLE001
            print("guard speech failed:", str(e)[:200])
    # the hard rule hits (disease / medical terms) — kept apart so an
    # over-flagging model can be trimmed back to them (_cap_censor)
    out["rules"] = set(_guard_classify({}, "speech", [], words)["censor"])
    out["censor"] |= out["rules"]
    out["censor"] -= out["cut"]
    return out


def _cap_censor(g: dict, n_words: int) -> None:
    """Muting is for a few risky words. When far more are flagged the model
    over-flagged (an everyday cosmetic benefit read as a claim): keep only the
    hard rule hits — a soundtrack full of holes is worse than the edit."""
    cap = max(6, int(0.08 * n_words))
    if len(g["censor"]) > cap:
        g["censor"] = set(g["censor"]) & set(g.get("rules") or set())
        g["censor_capped"] = True


def _scene_cuts(video: Path, thr: float = 0.1) -> list:
    """Hard shot changes inside the video (pre-edited client footage, a box
    that pops into frame). Measured: a box appearing scores ~0.11–0.18,
    talking / hand movement stays < 0.07."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-an", "-vf", f"scale=192:-2,select='gt(scene,{thr})',showinfo",
                        "-f", "null", "-"], capture_output=True, text=True, errors="replace", timeout=300)
    cuts = []
    for m in re.finditer(r"pts_time:([0-9.]+)", r.stderr):
        t = round(float(m.group(1)), 3)
        if not cuts or t - cuts[-1] > 0.2:
            cuts.append(t)
    return cuts


def _guard_video(d: Path, dur: float, p: dict, cuts: list = None) -> dict:
    """OCR the whole (jump-cut) video in parallel containers, classify the
    unique printed lines in one call, build the tape tracks. Tracks never
    cross a jump cut or a hard shot change."""
    t0 = time.time()
    scenes = []

    def _sc():
        try:
            scenes.extend(_scene_cuts(d / "video.mp4"))
        except Exception as e:  # noqa: BLE001
            print("scene detect failed:", str(e)[:160])

    sth = threading.Thread(target=_sc, daemon=True)
    sth.start()
    total = int(dur * GUARD_FPS)
    n = max(1, min(12, math.ceil(dur / 8)))
    cf = math.ceil(total / n) if total else 0
    jobs = [(i * cf, min(cf, total - i * cf)) for i in range(n) if cf and i * cf < total]
    dets, failed = [], 0
    if jobs:
        for res in guard_scan.map([d.name] * len(jobs), [a / GUARD_FPS for a, _ in jobs], [c / GUARD_FPS for _, c in jobs],
                                  [GUARD_FPS] * len(jobs), [a for a, _ in jobs], order_outputs=False, return_exceptions=True):
            if isinstance(res, dict) and res.get("ok"):
                dets += res["dets"]
            else:
                failed += 1
                print("guard chunk failed:", str(res)[:200])
    freq, best = {}, {}
    for x in dets:
        k = _tkey(x["x"])
        if len(k) < 3 or x["s"] < 0.5:
            continue
        freq[k] = freq.get(k, 0) + 1
        if k not in best or x["s"] > best[k]["s"]:
            best[k] = x
    keys = sorted(freq, key=lambda k: -freq[k])[:160]
    texts = [best[k]["x"] for k in keys]
    cls = _guard_classify(p, "video", texts)
    risky = {keys[i] for i in cls["risky"]}
    sth.join(timeout=120)
    tracks = _guard_tracks(dets, risky, GUARD_FPS, sorted(set((cuts or []) + scenes)))
    return {"tracks": tracks, "texts": len(texts), "scene_cuts": len(scenes),
            "risky_texts": [texts[i] for i in sorted(cls["risky"])][:24], "via": cls["via"],
            "chunks": len(jobs), "failed_chunks": failed, "sec": round(time.time() - t0, 1)}


def _mute_words(vid: Path, words: list, idx: list, out: Path) -> Path:
    """Silence the audio under the given words (video stream copied)."""
    rng = []
    for i in sorted(set(idx)):
        if not 0 <= i < len(words):
            continue
        w = words[i]
        s, e = max(0.0, w["t"] - 0.04), (w.get("e") or w["t"] + 0.35) + 0.05
        if rng and s <= rng[-1][1] + 0.06:
            rng[-1][1] = max(rng[-1][1], e)
        else:
            rng.append([s, e])
    if not rng:
        return vid
    expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in rng)
    script = out.with_suffix(".filter.txt")
    script.write_text(f"[0:a]volume=0:enable='{expr}'[a]", encoding="utf-8")
    _run(["ffmpeg", "-v", "error", "-y", "-i", str(vid), "-filter_complex_script", str(script), "-map", "0:v", "-map", "[a]",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", str(out)], "guard mute", 300)
    return out


def _tape_poly(g: dict, n: int) -> list:
    """A masking-tape strip over one text line: padded, a little crooked,
    torn (zig-zag) ends."""
    import random
    rnd = random.Random(n * 7919 + 13)
    w = g["w"] * 1.03 + max(14.0, g["h"] * 0.6)
    h = max(14.0, g["h"] * 1.55 + 6)
    a = math.radians(g["a"] + rnd.uniform(-1.6, 1.6))
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2)]
    for k in range(1, 6):
        pts.append((w / 2 - rnd.uniform(0, 0.16) * h, -h / 2 + h * k / 6))
    pts += [(w / 2, h / 2), (-w / 2, h / 2)]
    for k in range(5, 0, -1):
        pts.append((-w / 2 + rnd.uniform(0, 0.16) * h, -h / 2 + h * k / 6))
    ca, sa = math.cos(a), math.sin(a)
    return [(g["cx"] + x * ca - y * sa, g["cy"] + x * sa + y * ca) for x, y in pts]


def _bake_tape(path: Path, quads: list) -> None:
    """Draw tape over the given text quads, in place (keeps transparency)."""
    from PIL import Image, ImageDraw, ImageFilter
    src = Image.open(path)
    fmt = src.format or ("PNG" if path.suffix.lower() == ".png" else "JPEG")
    alpha = src.mode in ("RGBA", "LA") or "transparency" in src.info
    im = src.convert("RGBA")
    shadow = Image.new("RGBA", im.size, (0, 0, 0, 0))
    tape = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ds, dt = ImageDraw.Draw(shadow), ImageDraw.Draw(tape)
    for n, q in enumerate(quads):
        g = _quad(q)
        poly = _tape_poly(g, n)
        ds.polygon([(x + 2, y + 3) for x, y in poly], fill=(0, 0, 0, 85))
        dt.polygon(poly, fill=(233, 223, 198, 255))
        dt.line([poly[7], poly[8]], fill=(217, 204, 170, 255), width=max(2, int(g["h"] * 0.12)))  # lower edge
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(2.5)))
    im.alpha_composite(tape)
    if fmt == "PNG" and alpha:
        im.save(path, format="PNG")
    else:
        im.convert("RGB").save(path, format="JPEG" if fmt != "PNG" else "PNG", quality=90)


def _guard_images(paths: list, p: dict, kind: str, max_lines: int = 12, max_area: float = 0.25,
                  taped_out: dict | None = None, tape: bool = True) -> dict:
    """OCR + classify images → {path: clean | taped | drop}. With `tape` the
    risky lines are taped in place (a claims poster is dropped); without it any
    image with a risky line is dropped (the caller picks another one).
    `taped_out` (optional) gets {path: [the risky lines]} for the job summary."""
    from PIL import Image
    res = guard_ocr_images.remote([(str(x), Path(x).read_bytes()) for x in paths])
    keys, texts = {}, []
    for lines in res.values():
        for ln in lines:
            k = _tkey(ln["x"])
            if len(k) >= 3 and ln["s"] >= 0.5 and k not in keys:
                keys[k] = len(texts)
                texts.append(ln["x"])
    cls = _guard_classify(p, kind, texts) if texts else {"risky": set()}
    risky = {_tkey(texts[i]) for i in cls["risky"]}
    status = {}
    for x in paths:
        lines = [ln for ln in res.get(str(x), []) if ln["s"] >= 0.5 and _tkey(ln["x"]) in risky]
        if not lines:
            status[str(x)] = "clean"
            continue
        if not tape:
            status[str(x)] = "drop"
            if taped_out is not None:
                taped_out[str(x)] = [ln["x"] for ln in lines]
            continue
        with Image.open(x) as im:
            area_img = float(im.width * im.height) or 1.0
        area = sum(_quad(ln["q"])["w"] * _quad(ln["q"])["h"] * 1.7 for ln in lines) / area_img
        if len(lines) > max_lines or area > max_area:
            status[str(x)] = "drop"
            continue
        _bake_tape(Path(x), [ln["q"] for ln in lines])
        status[str(x)] = "taped"
        if taped_out is not None:
            taped_out[str(x)] = [ln["x"] for ln in lines]
    return status


# ── visual QA (stills → vision LLM → plan patch) ─────────────────────────────
def _cue_sec(c, words: list, fallback: float) -> float:
    if c is None or c == "":
        return fallback
    if isinstance(c, (int, float)):
        return float(c)
    s = str(c).strip()
    if re.fullmatch(r"[+-]?\d*\.?\d+", s):
        return float(s)
    m = re.fullmatch(r"w(\d+)(\$)?([+-]\d*\.?\d+)?", s, re.I)
    if not m or not words:
        return fallback
    w = words[min(len(words) - 1, int(m.group(1)))]
    base = w.get("e", w["t"] + 0.3) if m.group(2) else w["t"]
    return base + (float(m.group(3)) if m.group(3) else 0.0)


def _qa(props: dict, d: Path, p: dict) -> tuple:
    """Render ≤6 stills at the busiest moments, ask PeningLab's vision model
    what's wrong, apply its patch. Any failure → props unchanged."""
    import base64
    import requests
    fps = props["fps"]
    words = props.get("words") or []
    dur = props["durationInFrames"] / fps
    spans = []  # (start, end, kind, idx, label)
    for i, o in enumerate(props.get("overlays") or []):
        s = _cue_sec(o.get("at"), words, 0)
        e = _cue_sec(o.get("to"), words, s + 2.6) if o.get("to") is not None else s + 2.6
        spans.append((s, e, "overlay", i, f"{o.get('t')}:{(o.get('text') or '')[:30]}@{o.get('zone') or 'middle'}"))
    for i, b in enumerate(props.get("broll") or []):
        s = _cue_sec(b.get("at"), words, 0)
        spans.append((s, s + 2.4, "broll", i, f"broll-{b.get('layout')}"))
    for i, f in enumerate(props.get("facts") or []):
        s = _cue_sec(f.get("at"), words, 0)
        spans.append((s, s + 3, "fact", i, "fact"))
    cands = []
    for s, e, *_ in spans:
        t = min(dur - 0.1, s + 0.4)
        active = [x for x in spans if x[0] <= t < x[1]]
        cands.append((len(active), t, active))
    cands.sort(key=lambda x: -x[0])
    picked = [(0.7, [x for x in spans if x[0] <= 0.7 < x[1]])]
    for score, t, active in cands:
        if len(picked) >= 6:
            break
        if all(abs(t - q[0]) > 1.4 for q in picked):
            picked.append((t, active))
    frames = sorted({int(t * fps) for t, _ in picked})
    sd = Path(tempfile.mkdtemp(prefix="qa_"))
    pp = d / "props.json"
    pp.write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
    via = "remotion"
    if str(p.get("renderer") or "") == "hyperframes":
        # HyperFrames only: stills of the edit as it will render; if they fail, QA is skipped (never Remotion stills)
        try:
            _hf_stills(props, d, "MotionEdit", frames, sd)
            via = "hyperframes"
        except Exception as e:  # noqa: BLE001
            print("hf qa stills failed → QA skipped:", str(e)[:300], flush=True)
            return props, {"qa": f"skipped (stills: {str(e)[:100]})"}
    if via == "remotion":
        _run(["node", f"{MOTION_DIR}/scripts/stills.mjs", f"{MOTION_DIR}/build", "MotionEdit", str(pp), str(sd), ",".join(map(str, frames)), "0.45"],
             "qa stills", 400)
    shots = []
    for fr in frames:
        f = sd / f"still_{fr}.jpg"
        if f.exists():
            t = fr / fps
            act = [x[4] + f"#{x[2]}{x[3]}" for x in spans if x[0] <= t < x[1]]
            # the band of the speaker's eyes in this still from the face tracker (QA's "covers the eyes" must reach
            # it): brows → mid-face of the detector box, widened for the camera zoom about the face centre
            near = [fc for fc in (props.get("faces") or []) if abs(float(fc.get("t", -9)) - t) <= 0.6]
            eyes = None
            if near:
                fc = min(near, key=lambda x: abs(float(x["t"]) - t))
                fy, fh = float(fc["y"]), float(fc["h"])
                cy = fy + fh / 2
                a, b = cy + (fy + fh * 0.12 - cy) * 1.15, cy + (fy + fh * 0.5 - cy) * 1.15
                eyes = [round(max(0.0, a), 3), round(min(1.0, b), 3)]
            shots.append({"frame": fr, "t": round(t, 2), "active": act, "eyes": eyes,
                          "image": "data:image/jpeg;base64," + base64.b64encode(f.read_bytes()).decode()})
    if not shots:
        return props, {"qa": "no stills"}
    body = {"history_id": p["history_id"], "token": p["plan_token"], "duration": dur, "stills": shots,
            "overlays": [{"idx": i, "t": o.get("t"), "text": o.get("text"), "zone": o.get("zone")} for i, o in enumerate(props.get("overlays") or [])],
            "broll": [{"idx": i, "layout": b.get("layout")} for i, b in enumerate(props.get("broll") or [])]}
    r = requests.post(p["qa_url"], json=body, timeout=200)
    j = r.json()
    if not (r.ok and j.get("ok") and isinstance(j.get("patch"), dict)):
        return props, {"qa": f"skipped ({str(j)[:120]})"}
    patch = j["patch"]
    ov = list(props.get("overlays") or [])
    drop = {int(x) for x in patch.get("drop_overlays") or [] if str(x).isdigit()}
    for mv in patch.get("move") or []:
        try:
            i = int(mv.get("idx"))
            if 0 <= i < len(ov) and mv.get("zone") in ("top", "middle", "bottom"):
                ov[i] = {**ov[i], "zone": mv["zone"]}
        except Exception:  # noqa: BLE001
            pass
    props["overlays"] = [o for i, o in enumerate(ov) if i not in drop]
    br = list(props.get("broll") or [])
    bdrop = {int(x) for x in patch.get("drop_broll") or [] if str(x).isdigit()}
    for i in patch.get("pip_broll") or []:
        if str(i).isdigit() and int(i) < len(br):
            br[int(i)] = {**br[int(i)], "layout": "pip"}
    props["broll"] = [b for i, b in enumerate(br) if i not in bdrop]
    return props, {"qa": "applied", "stills": via, "drop": len(drop), "moved": len(patch.get("move") or []), "broll_drop": len(bdrop),
                   "notes": str(patch.get("notes") or "")[:200]}



def _scale_for(p: dict) -> float:
    return 0.6667 if str(p.get("resolution") or "") == "720" else 1.0


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
    style = p.get("style") or "gempak"
    mood = p.get("mood") or ("hype" if style == "gempak" else "upbeat")
    job = {"totalSec": total, "seed": int(time.time()) % 100000, "mood": mood,
           "speech": [[l["audioStart"], l["audioStart"] + l["audioDur"]] for l in lines_out], "marks": marks,
           "bedOut": str(d / "bed.wav"),
           "mix": {"vo": vo, "out": str(d / "final.wav"), "bedVol": 0.55 if p.get("music", True) else 0.0}}
    (d / "music.json").write_text(json.dumps(job), encoding="utf-8")
    _run(["node", f"{MOTION_DIR}/scripts/music.mjs", str(d / "music.json")], "music", 600)

    _progress("images", 38)
    images, guard_info = _prepare_images(p.get("images") or [], d, srv, p)
    chars = [it.get("text") for sc in (p.get("scenes") or []) for it in (sc.get("items") or []) if it.get("t") == "emoji"]
    lottie = _fetch_lottie(chars, d, srv)

    fps = 30
    props = {
        "fps": fps, "durationInFrames": int(math.ceil(total * fps)), "lines": lines_out,
        "scenes": p.get("scenes") or [], "images": images, "brand": p.get("brand") or {"name": "", "accent": "#22c55e"},
        "audio": srv.url(d / "final.wav"), "captions": bool(p.get("captions", True)),
        "captionStyle": p.get("caption_style") or "pop", "sfx": bool(p.get("sfx", True)),
        "style": style, "lottie": lottie,
    }
    out = d / "out.mp4"
    _progress("render", 42)
    rinfo = _render("MotionAd", props, d, out, _scale_for(p), 42, 95, p)
    return {"out": out, "duration": total, "poster_at": min(2.0, total / 3),
            "debug": {"lines": len(lines_out), "images": len(images), "render": rinfo,
                      **({"guard": guard_info} if p.get("guard") else {})}}


# ── Flow B: Edit Video ────────────────────────────────────────────────────────
# the client's voice after DeepFilterNet: rumble cut, less boxiness, a little presence, de-ess, gentle compression
VOICE_POST = ("highpass=f=80,equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=3200:t=q:w=0.9:g=2,deesser=i=0.4:m=0.5:f=0.5,"
              "acompressor=threshold=-24dB:ratio=3:attack=12:release=150:knee=4:makeup=2,alimiter=limit=0.95")
# without it (the binary failed): the FFT denoiser does the clean-up
VOICE_LEGACY = "highpass=f=75,afftdn=nr=10:nf=-32,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160:makeup=1.6,alimiter=limit=0.95"


def _cut_audio(src_label: str, segs: list, chain: str) -> str:
    """Filter graph: keep `segs` of the stream with an 8 ms fade at both ends of every piece (a hard sample cut
    clicks), joined end to end, then `chain` → [aout]. Same total length as aselect over the same segments."""
    n = len(segs)
    parts = [f"{src_label}asplit={n}" + "".join(f"[s{i}]" for i in range(n))] if n > 1 else [f"{src_label}anull[s0]"]
    for i, (a, b) in enumerate(segs):
        ln = max(0.001, b - a)
        f = min(0.008, ln / 4)
        parts.append(f"[s{i}]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,afade=t=in:st=0:d={f:.4f},"
                     f"afade=t=out:st={ln - f:.4f}:d={f:.4f}[c{i}]")
    parts.append("".join(f"[c{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1,{chain}[aout]")
    return ";".join(parts)


def _enhance_voice(src: Path, d: Path, span: float) -> Path | None:
    """DeepFilterNet3 on the whole source voice (before any cut, so the noise floor never jumps at a splice).
    Its strength follows the measured noise: a clean recording keeps its room tone (a limit, not full removal —
    full removal is what sounds "underwater"). None when the binary is missing or anything fails."""
    import shutil
    import wave
    import numpy as np
    exe = shutil.which("deep-filter")
    if not exe:
        return None
    t0 = time.time()
    try:
        wav = d / "voice_in.wav"
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-t", f"{span:.2f}", "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(wav)],
             "voice extract", 300)
        with wave.open(str(wav)) as w:
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        fr = x[: len(x) // 960 * 960].reshape(-1, 960)
        if not len(fr):
            return None
        e = 10 * np.log10((fr ** 2).mean(1) + 1e-10)
        snr = float(np.percentile(e, 95) - np.percentile(e, 10))
        atten = 8 if snr >= 35 else 12 if snr >= 25 else 18
        od = d / "dfn"
        od.mkdir(exist_ok=True)
        _run([exe, "-D", "-a", str(atten), "-o", str(od), str(wav)], "deep-filter", 300)
        out = od / wav.name
        if not out.exists() or out.stat().st_size < 1000:
            return None
        print(f"[voice] DeepFilterNet3 atten {atten} dB (noise spread {snr:.1f} dB) in {time.time() - t0:.1f} s", flush=True)
        return out
    except Exception as e:  # noqa: BLE001
        print("voice enhance skipped:", str(e)[:200])
        return None


def _remux_voice(vid: Path, voice: Path, segs, max_sec: float) -> bool:
    """Replace the normalised video's audio with the enhanced voice, cut on the same segments."""
    tmp = vid.with_name(vid.stem + "_v.mp4")
    try:
        if segs:
            fc = _cut_audio("[1:a]apad=pad_dur=0.5,", segs, VOICE_POST)
        else:
            fc = f"[1:a]apad=pad_dur=0.5,{VOICE_POST}[aout]"
        script = vid.with_suffix(".voice.txt")
        script.write_text(fc, encoding="utf-8")
        before = _probe(vid)["duration"]
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(vid), "-i", str(voice), "-filter_complex_script", str(script),
               "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", f"{before:.3f}"]
        _run(cmd + [str(tmp)], "voice remux", 300)
        after = _probe(tmp)["duration"]
        if abs(after - before) > 0.15:
            print(f"voice remux length {after:.2f} vs {before:.2f} s: kept the original voice")
            return False
        tmp.replace(vid)
        return True
    except Exception as e:  # noqa: BLE001
        print("voice remux skipped:", str(e)[:200])
        return False


def _normalise(src: Path, out: Path, info: dict, max_sec: float, segs=None) -> Path:
    """1080x1920 30 fps H.264 (lanczos; sharpen low-res sources) — and, with
    `segs`, keep only those time ranges (jump cut) in the same pass."""
    w, h = info["w"] or 1080, info["h"] or 1920
    ar = w / h if h else 0.5625
    sharpen = ",unsharp=5:5:0.7:5:5:0.0" if w < 900 else ""
    if segs:
        expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in segs)
        vpre = f"fps=30,select='{expr}',setpts=N/(30*TB),"
    else:
        vpre = "fps=30,"
    # mild "phone footage" lift: a touch more contrast + saturation
    grade = ",eq=contrast=1.04:saturation=1.1:gamma=1.02"
    if 0.53 <= ar <= 0.6:
        fc = (f"[0:v]{vpre}scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920"
              f"{sharpen}{grade},setsar=1,format=yuv420p[v]")
    else:
        fc = (f"[0:v]{vpre}split[a][b];"
              "[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:6,eq=brightness=-0.08[bg];"
              f"[b]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos{sharpen}{grade}[fg];"
              "[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]")
    amap = "0:a:0" if info["audio"] else "1:a"
    # Voice clean-up: rumble cut, FFT denoise, gentle compression, peak limit (the final mix is
    # loudness-normalised to -14 LUFS after the render). _remux_voice swaps in the DeepFilterNet voice.
    voice = VOICE_LEGACY
    if segs and info["audio"]:
        fc += ";" + _cut_audio("[0:a]", segs, voice)
        amap = "[aout]"
    elif info["audio"]:
        fc += f";[0:a]{voice}[aout]"
        amap = "[aout]"
    script = out.with_suffix(".filter.txt")
    script.write_text(fc, encoding="utf-8")
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src)]
    if not info["audio"]:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    if not segs:
        cmd += ["-t", f"{max_sec:.2f}"]
    cmd += ["-filter_complex_script", str(script), "-map", "[v]", "-map", amap,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]
    if not info["audio"]:
        cmd += ["-shortest"]
    _run(cmd + [str(out)], "normalise", 900)
    return out


def _fallback_plan() -> dict:
    return {"captions": {"on": True, "style": "pop", "pos": "low", "maxWords": 3}, "accent": "#FFD93B",
            "overlays": [], "zooms": [], "music": False}


def _flow_edit(p: dict, d: Path, srv: _Serve) -> dict:
    """Edit Video in one go (script → cut + plan → render)."""
    return _edit_finish(p, d, srv, _edit_direct(p, d, srv, _edit_script(p, d, srv)))


def _caption_fixes(words: list, p: dict) -> list:
    """AI spelling clean-up of the transcript for the captions (one fast LLM
    call through /api/motion/plan, mode "fixes"). [[index, word], ...]; [] on error."""
    import requests
    if not p.get("plan_url") or not words:
        return []
    try:
        r = requests.post(p["plan_url"], json={"history_id": p["history_id"], "token": p["plan_token"], "mode": "fixes",
                                               "words": [{"i": i, "w": w["w"]} for i, w in enumerate(words)]}, timeout=150)
        j = r.json()
        return j.get("fixes") or [] if isinstance(j, dict) else []
    except Exception as e:  # noqa: BLE001
        print("caption fixes failed:", e)
        return []


def _edit_script(p: dict, d: Path, srv: _Serve) -> dict:
    """Step 1 of Edit Video: download → transcribe → guideline speech report →
    jump-cut map (times only) → caption spelling fixes (captions on only).
    Nothing is encoded or planned yet, so it is quick. The client reviews these
    words before step 2 (_edit_direct) cuts the video and the AI plans the edit."""
    max_sec = float(p.get("max_sec") or 180)
    _progress("download", 5)
    src = _download(p["video_url"], d / "src_video")
    info = _probe(src)
    if info["duration"] <= 0.5:
        raise RuntimeError("video has no duration (unreadable file?)")
    span = min(info["duration"], max_sec)
    lang = p.get("language") or "ms"
    jump = bool(p.get("jumpcut", True))

    _progress("transcribe", 15)
    raw_words = _transcribe(src, None if lang == "auto" else lang, vad=True, keep_fillers=jump,
                            hint=p.get("hint")) if info["audio"] else []
    raw_words = [w for w in raw_words if w["t"] < span]
    for i, w in enumerate(raw_words):
        w["ri"] = i

    # "Check Guideline TikTok" only REPORTS (the footage and voice are never cut,
    # taped or muted for it). It runs beside the caption fixes.
    guard = bool(p.get("guard"))
    gspeech = {"cut": set(), "censor": set(), "risk": None}
    gt = None
    if guard and raw_words:
        def _gs():
            try:
                gspeech.update(_guard_speech(raw_words, p))
            except Exception as e:  # noqa: BLE001
                print("guard speech failed:", e)

        gt = threading.Thread(target=_gs, daemon=True)
        gt.start()

    # jump cut: which time ranges stay. The words move onto the cut timeline
    # now; the video itself is cut in step 2 with these same segments.
    words, segs, cut, kept_len = raw_words, None, {}, span
    if jump and raw_words:
        sg, kept = _keep_segments(raw_words, span)
        kl = sum(e - s for s, e in sg)
        if sg and 0.5 * span <= kl < span - 0.3:
            segs, kept_len = sg, kl
            words, _ = _remap_words(kept, sg)
            cut = {"removed_sec": round(span - kl, 2), "segments": len(sg)}
    if not jump:
        words = [w for w in words if not _is_filler(w["w"])] or words

    # AI-corrected spelling for the captions (timing untouched, 1:1 by index)
    captions = p.get("captions") is not False
    fixed = 0
    if captions and words:
        _progress("captions", 55)
        for fx in _caption_fixes(words, p):
            try:
                i, w = int(fx[0]), str(fx[1]).strip()
                if 0 <= i < len(words) and w and len(w) <= 40:
                    words[i]["w"] = w
                    fixed += 1
            except Exception:  # noqa: BLE001
                continue
    if gt:
        _progress("guard", 80)
        gt.join(timeout=240)
    flagged_speech = " ".join(w["w"] for w in raw_words if w["ri"] in gspeech["cut"])[:600]
    flagged_words = list(dict.fromkeys(raw_words[i]["w"] for i in sorted(gspeech["censor"]) if i < len(raw_words)))[:30]

    return {"words": words, "segs": segs, "span": round(span, 3), "kept": round(kept_len, 3), "cut": cut,
            "fixed": fixed, "captions": captions, "guard": guard,
            "flagged_speech": flagged_speech, "flagged_words": flagged_words,
            "gspeech": {"risk": gspeech.get("risk"), "via": gspeech.get("via")},
            # live only (not part of a stored draft): the downloaded source
            "_src": str(src), "_info": info}


def _unmap_words(words: list, segs: list) -> list:
    """Cut-timeline word times back onto the source (the cut was skipped)."""
    spans, acc = [], 0.0
    for s, e in segs:
        spans.append((acc, s, e - s))
        acc += e - s

    def back(t: float) -> float:
        for a, s, ln in spans:
            if t <= a + ln + 1e-3:
                return round(s + max(0.0, t - a), 3)
        a, s, ln = spans[-1]
        return round(s + ln, 3)

    out = []
    for w in words:
        t = back(float(w["t"]))
        out.append({**w, "t": t, "e": round(max(back(float(w.get("e") or w["t"] + 0.3)), t + 0.05), 3)})
    return out


def _edit_direct(p: dict, d: Path, srv: _Serve, st: dict) -> dict:
    """Step 2 of Edit Video, up to the plan: cut + normalise the source with the
    step-1 segments → guideline video scan (background) → faces → AI director
    on the (client-reviewed) words. Returns the state _edit_finish renders."""
    import requests
    max_sec = float(p.get("max_sec") or 180)
    style = p.get("style") or "gempak"
    src = Path(st["_src"]) if st.get("_src") else None
    if not src or not src.exists():
        _progress("download", 3)
        # an older draft carries its already-cut video (words on its timeline,
        # no segments); otherwise the client's source video
        src = _download(str(st.get("video_url") or p["video_url"]), d / "src_video")
    info = st.get("_info") or _probe(src)
    words, segs, cut = list(st.get("words") or []), st.get("segs") or None, st.get("cut") or {}
    span = float(st.get("span") or min(info["duration"], max_sec))
    guard = bool(st.get("guard"))

    _progress("normalise", 10)
    # the voice is cleaned (DeepFilterNet3) while the video encodes
    vbox: dict = {}
    vthread = None
    if info.get("audio"):
        vthread = threading.Thread(target=lambda: vbox.update(wav=_enhance_voice(src, d, span)), daemon=True)
        vthread.start()
    try:
        vid = _normalise(src, d / "video.mp4", info, max_sec, segs)
    except Exception as e:  # noqa: BLE001
        print("cut/normalise failed, retrying without cuts:", str(e)[:300])
        if segs:
            words = _unmap_words(words, segs)
        segs, cut = None, {"error": "jumpcut skipped"}
        vid = _normalise(src, d / "video.mp4", info, max_sec, None)
    if vthread:
        vthread.join(timeout=240)
        if vbox.get("wav"):
            _remux_voice(vid, vbox["wav"], segs, max_sec)
    dur = _probe(vid)["duration"] or span

    gres, gthread = {}, None
    cut_marks, acc = [], 0.0  # where one kept segment ends and the next begins
    for s0, e0 in (segs or [])[:-1]:
        acc += e0 - s0
        cut_marks.append(round(acc, 3))
    if guard:
        JOBS.commit()  # guard_scan containers read video.mp4 from the Volume

        def _g():
            try:
                gres.update(_guard_video(d, dur, p, cut_marks))
            except Exception as e:  # noqa: BLE001
                gres["error"] = str(e)[:300]
                print("guard video failed:", e)

        gthread = threading.Thread(target=_g, daemon=True)
        gthread.start()

    _progress("faces", 20)
    try:
        faces = _faces(vid)
    except Exception as e:  # noqa: BLE001
        print("face track failed:", str(e)[:200])
        faces = []

    _progress("plan", 26)
    plan, plan_fallback = None, False
    try:
        # the words were spell-fixed in step 1 (and reviewed by the client):
        # the director only plans, no second round of fixes
        r = requests.post(p["plan_url"], json={"history_id": p["history_id"], "token": p["plan_token"], "mode": "plan",
                                               "duration": dur, "words": [{"i": i, **w} for i, w in enumerate(words)],
                                               "has_face": bool(faces), "renderer": str(p.get("renderer") or "")}, timeout=290)
        j = r.json()
        if r.ok and j.get("ok") and isinstance(j.get("plan"), dict):
            plan = j["plan"]
        else:
            print("plan rejected:", str(j)[:400])
    except Exception as e:  # noqa: BLE001
        print("plan call failed:", e)
    if not plan:
        plan, plan_fallback = _fallback_plan(), True  # captions only
    if st.get("captions", p.get("captions")) is False and isinstance(plan.get("captions"), dict):
        plan["captions"] = {**plan["captions"], "on": False}

    # AI Auto: the director chose the look (render energy), the music and the
    # hook-opener sound from the video itself
    auto = bool(p.get("auto"))
    if auto and plan.get("energy") in ("gempak", "clean"):
        style = plan["energy"]
    music_on = plan.get("music") is True if auto else bool(p.get("music"))
    hook_sfx = plan.get("hookSound") if isinstance(plan.get("hookSound"), int) else None

    return {"vid": str(vid), "dur": dur, "words": words, "faces": faces, "cut_marks": cut_marks, "plan": plan,
            "plan_fallback": plan_fallback, "fixed": int(st.get("fixed") or 0), "style": style, "music_on": music_on,
            "hook_sfx": hook_sfx, "guard": guard, "flagged_speech": st.get("flagged_speech") or "",
            "flagged_words": st.get("flagged_words") or [], "gspeech": st.get("gspeech") or {}, "cut": cut,
            # live only: the guideline video scan thread
            "_gthread": gthread, "_gres": gres}


def _matte_plan(direction: dict, words: list, dur: float, fps: int = 30) -> list:
    """The [first, end) frame windows the speaker cut-out is needed for: text behind the speaker, a spotlight,
    a scene that keeps the speaker on screen as a sticker. Merged, ≤ 30 s in all (later ones dropped)."""
    win = []
    # full-screen scenes hide the speaker: a word behind them / a spotlight inside one never shows
    scene_spans = []
    for sc in direction.get("scenes") or []:
        if isinstance(sc, dict) and not (sc.get("kind") == "card" and sc.get("style") == "float"):
            a = _cue_sec(sc.get("at"), words, -1)
            if a >= 0:
                scene_spans.append((a, _cue_sec(sc.get("to"), words, a + 3) if sc.get("to") is not None else a + 3))
    in_scene = lambda t: any(a <= t < b for a, b in scene_spans)  # noqa: E731
    for b in direction.get("behind") or []:
        if isinstance(b, dict) and b.get("text"):
            a = _cue_sec(b.get("at"), words, -1)
            if a >= 0 and not in_scene(a):
                e = _cue_sec(b.get("to"), words, a + 2.5) if b.get("to") is not None else a + 2.5
                # the word holds at least 1.2 s on screen (MotionEditPro), even for a short spoken "to"
                win.append((a - 0.2, min(max(e, a + 1.3), a + 4.0) + 0.2))
    for m in direction.get("moves") or []:
        if isinstance(m, dict) and m.get("move") == "spotlight":
            a = _cue_sec(m.get("at"), words, -1)
            if a >= 0 and not in_scene(a):
                win.append((a - 0.1, a + 2.6))
    for sc in direction.get("scenes") or []:
        if isinstance(sc, dict) and sc.get("speaker") in ("left", "right"):
            a = _cue_sec(sc.get("at"), words, -1)
            if a >= 0:
                e = _cue_sec(sc.get("to"), words, a + 3) if sc.get("to") is not None else a + 3
                win.append((a - 0.2, min(e, a + 14.0) + 0.3))
    win = sorted((max(0.0, a), min(dur, b)) for a, b in win if b > a)
    merged = []
    for a, b in win:
        if merged and a - merged[-1][1] < 0.5:
            merged[-1] = (merged[-1][0], max(merged[-1][1], b))
        else:
            merged.append((a, b))
    out, total = [], 0.0
    for a, b in merged:
        if total + (b - a) > 30:
            break
        total += b - a
        out.append((int(math.floor(a * fps)), int(math.ceil(b * fps))))
    return out


def _edit_finish(p: dict, d: Path, srv: _Serve, st: dict) -> dict:
    """B-roll / stickers → guideline report → music → QA → render, from a
    prepared state (from _edit_direct, or an older draft that already had its plan)."""
    vid, dur, words, faces = Path(st["vid"]), float(st["dur"]), st["words"], st.get("faces") or []
    cut_marks, plan, plan_fallback, fixed = st.get("cut_marks") or [], st["plan"], bool(st.get("plan_fallback")), int(st.get("fixed") or 0)
    style, music_on, hook_sfx, guard = st.get("style") or "gempak", bool(st.get("music_on")), st.get("hook_sfx"), bool(st.get("guard"))
    flagged_speech, flagged_words = st.get("flagged_speech") or "", st.get("flagged_words") or []
    gspeech, cut = st.get("gspeech") or {}, st.get("cut") or {}
    gthread = st.get("_gthread")
    gres = st["_gres"] if st.get("_gres") is not None else (st.get("gres") or {})

    # speaker cut-out (HyperFrames Pro): the GPU matte runs while the B-roll, stickers and music are fetched
    matte_call, matte_win = None, []
    if str(p.get("renderer") or "") == "hyperframes" and isinstance(plan.get("direction"), dict):
        try:
            matte_win = _matte_plan(plan["direction"], words, dur)
            if matte_win:
                JOBS.commit()
                matte_call = matte_windows.spawn(d.name, matte_win)
        except Exception as e:  # noqa: BLE001
            print("matte spawn failed:", str(e)[:200])
            matte_call = None

    _progress("assets", 40)
    broll_guard = {}
    try:
        broll, broll_guard = _fetch_broll(plan.get("broll") or [], d, srv, p)
    except Exception as e:  # noqa: BLE001
        print("broll failed:", str(e)[:200])
        broll = []
    stickers = _fetch_gifs(plan.get("overlays") or [], d, srv)
    chars = [o.get("text") for o in (plan.get("overlays") or []) if o.get("t") == "emoji"]
    chars += [o.get("sub") or "👇" for o in (plan.get("overlays") or []) if o.get("t") == "point"]
    chars += [k.get("emoji") for k in (plan.get("keywords") or []) if k.get("emoji")]
    # emoji the Pro director put on scene lines (HyperFrames) animate too
    direction = plan.get("direction") if isinstance(plan.get("direction"), dict) else {}
    chars += [ln.get("emoji") for sc in (direction.get("scenes") or []) if isinstance(sc, dict)
              for ln in (sc.get("lines") or []) if isinstance(ln, dict) and ln.get("emoji")]
    chars += [sc.get("rain") for sc in (direction.get("scenes") or []) if isinstance(sc, dict) and sc.get("rain")]
    lottie = _fetch_lottie(chars, d, srv)

    props = {
        "fps": 30, "durationInFrames": int(math.floor(dur * 30)), "video": srv.url(vid), "words": words,
        "captions": plan.get("captions") or _fallback_plan()["captions"], "accent": plan.get("accent") or "#FFD93B",
        "overlays": plan.get("overlays") or [], "zooms": plan.get("zooms") or [], "hook": plan.get("hook"),
        "sfx": bool(p.get("sfx", True)), "style": style, "faces": faces, "broll": broll,
        "facts": plan.get("facts") or [], "keywords": plan.get("keywords") or [], "rehook": plan.get("rehook"),
        "cta": plan.get("cta"), "lottie": lottie, "progress": style == "gempak",
        "cuts": cut_marks, **({"hookSfx": hook_sfx} if hook_sfx is not None else {}),
    }
    hf = str(p.get("renderer") or "") == "hyperframes"
    if hf:
        import hashlib
        if isinstance(plan.get("direction"), dict):
            props["direction"] = plan["direction"]
        key = f"{p.get('history_id') or ''}{p.get('out_suffix') or ''}"
        props["lookSeed"] = int(hashlib.md5(key.encode()).hexdigest()[:8], 16)
    guard_dbg = None
    if guard:
        _progress("guard", 44)
        if gthread:
            gthread.join(timeout=300)
        # Report only — no mute, no tape: what in the client's own video may
        # break the guideline (sentences, words, printed text on screen).
        guard_dbg = {"mode": "report", "flagged_speech": flagged_speech, "flagged_words": flagged_words,
                     "flagged_texts": gres.get("risky_texts") or [],
                     "risk": gspeech.get("risk"), "speech_via": gspeech.get("via"),
                     "texts": gres.get("texts"), "via": gres.get("via"),
                     "sec": gres.get("sec"), "broll": broll_guard, **({"error": gres["error"]} if gres.get("error") else {})}
    if music_on and words:
        _progress("music", 44)
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
        mood = plan.get("mood") or p.get("mood") or ("upbeat" if style == "gempak" else "chill")
        marks = {}
        if hf:
            bpm = MUSIC_BPM.get(mood, 100)
            beat = 60.0 / bpm
            snap = lambda t: round(round(max(0.0, t) / beat) * beat, 3)  # noqa: E731
            if plan.get("hook"):
                marks["reveal"] = snap(_cue_sec((plan.get("hook") or {}).get("to"), words, 2.4))
            if plan.get("cta"):
                marks["cta"] = snap(_cue_sec((plan.get("cta") or {}).get("at"), words, dur * 0.85))
            marks["final"] = snap(dur - 2.5)
            props["musicBpm"] = bpm
        job = {"totalSec": dur, "seed": int(time.time()) % 100000, "mood": mood,
               "speech": spans, "marks": marks, "bedOut": str(d / "bed.wav")}
        (d / "music.json").write_text(json.dumps(job), encoding="utf-8")
        _run(["node", f"{MOTION_DIR}/scripts/music.mjs", str(d / "music.json")], "music", 600)
        props["music"] = srv.url(d / "bed.wav")
        props["musicVolume"] = 0.28

    qa = {"qa": "off"}
    if p.get("qa_url") and not plan_fallback:
        _progress("qa", 46)
        # the matte is still running: QA's stills use the planned cut-out windows, so they show the same text
        # behind the speaker (and drop the same stickers) as the final render — no waiting for the GPU
        if matte_win:
            props["cutoutsPlanned"] = [{"s": round(f0 / 30, 4), "e": round(f1 / 30, 4)} for f0, f1 in matte_win]
        try:
            props, qa = _qa(props, d, p)
        except Exception as e:  # noqa: BLE001
            qa = {"qa": f"error {str(e)[:160]}"}
            print("qa failed:", e)
        props.pop("cutoutsPlanned", None)

    if matte_call is not None:
        try:
            cutouts = []
            for k, (res, (f0, f1)) in enumerate(zip(matte_call.get(timeout=300), matte_win)):
                blob = (res or {}).get("webm") or b""
                if len(blob) > 2000:
                    fp = d / f"cut_{k}.webm"
                    fp.write_bytes(blob)
                    cutouts.append({"src": srv.url(fp), "s": round(f0 / 30, 4), "e": round(f1 / 30, 4),
                                    **({"top": res["top"]} if isinstance(res.get("top"), int) else {})})
            if cutouts:
                props["cutouts"] = cutouts
        except Exception as e:  # noqa: BLE001
            print("matte failed (no cut-out effects):", str(e)[:200])

    out = d / "out.mp4"
    _progress("render", 50)
    rinfo = _render("MotionEdit", props, d, out, _scale_for(p), 50, 92, p)

    # (No post-render tape patching: the guideline check only reports.)
    return {"out": out, "duration": dur, "poster_at": min(1.5, dur / 3),
            "debug": {"words": len(words), "overlays": len(props["overlays"]), "broll": len(broll), "facts": len(props["facts"]),
                      "faces": len(faces), "jumpcut": cut, "plan_fallback": plan_fallback, "qa": qa, "render": rinfo,
                      "caption_fixes": fixed, "stickers": stickers, "broll_clips": broll_guard.get("clips", 0) if broll_guard else 0,
                      **({"guard": guard_dbg} if guard_dbg else {})}}


def _final_check(d: Path, out: Path, dur: float, p: dict, props: dict) -> dict:
    """OCR the rendered video at 2 fps; risky lines still visible → patch tapes."""
    fps = 2.0
    JOBS.commit()
    total = int(dur * fps)
    n = max(1, min(12, math.ceil(dur / 8)))
    cf = math.ceil(total / n) if total else 0
    jobs = [(i * cf, min(cf, total - i * cf)) for i in range(n) if cf and i * cf < total]
    dets = []
    for res in guard_scan.map([d.name] * len(jobs), [a / fps for a, _ in jobs], [c / fps for _, c in jobs], [fps] * len(jobs),
                              [a for a, _ in jobs], [out.name] * len(jobs), order_outputs=False, return_exceptions=True):
        if isinstance(res, dict) and res.get("ok"):
            dets += res["dets"]
    # The burned-in captions are the speaker's own words — the speech guard
    # already cut / muted the claims there, so a usage word like "gatal" in a
    # caption is never taped here. Caption text = runs of 1–4 spoken words.
    spoken = [_tkey(w.get("w")) for w in props.get("words") or []]
    caption_keys = {"".join(spoken[i:i + n]) for n in range(1, 5) for i in range(len(spoken))}
    single = set(spoken)

    def is_caption(text: str) -> bool:
        toks = [_tkey(t) for t in str(text).split()]
        toks = [t for t in toks if t]
        return bool(toks) and (_tkey(text) in caption_keys or all(t in single for t in toks))

    keys, texts = {}, []
    for x in dets:
        k = _tkey(x["x"])
        if len(k) >= 3 and x["s"] >= 0.5 and k not in keys and not is_caption(x["x"]):
            keys[k] = len(texts)
            texts.append(x["x"])
    if not texts:
        return {"texts": 0, "leaks": 0}
    cls = _guard_classify(p, "final", texts[:200])
    risky = {_tkey(texts[i]) for i in cls["risky"]}
    if not risky:
        return {"texts": len(texts), "leaks": 0}
    tracks = _guard_tracks(dets, risky, fps, [])
    for tr in tracks:  # 2 fps samples: hold a little longer either side
        tr["pre"], tr["post"] = 0.45, 0.45
    props["patchTapes"] = tracks
    return {"texts": len(texts), "leaks": len(tracks), "leak_texts": sorted({texts[keys[k]] for k in risky if k in keys})[:12],
            "patched": bool(tracks)}


@app.function(image=matte_image, gpu=["L40S", "L4"], cpu=8.0, memory=16384, timeout=600, volumes={JOBS_ROOT: JOBS})
def matte_windows(job: str, windows: list) -> list:
    """Cut the subject out of video.mp4 for each [first, end) frame window → {"webm": VP9-with-alpha bytes (same
    1080x1920 / 30 fps timing, frame 0 = the window's first frame), "top": the top of the subject's head (px, median
    over the window — a word behind the speaker sits on it)}. Mask: BiRefNet-lite at 576x1024 (the frame's own 9:16 — half
    the pixels of a squashed 1024², no distortion), fp16, then a 3-frame
    median so the edge doesn't shimmer."""
    import numpy as np
    import torch
    from scipy import ndimage
    from transformers import AutoModelForImageSegmentation
    t0 = time.time()
    JOBS.reload()
    vid = Path(JOBS_ROOT) / job / "video.mp4"
    if not vid.exists():
        raise FileNotFoundError(f"matte: no video.mp4 in job {job}")
    torch.set_float32_matmul_precision("high")
    model = AutoModelForImageSegmentation.from_pretrained(MATTE_DIR, trust_remote_code=True).to("cuda").eval().half()
    t_model = time.time() - t0
    mean = torch.tensor([0.485, 0.456, 0.406], device="cuda").view(1, 3, 1, 1).half()
    std = torch.tensor([0.229, 0.224, 0.225], device="cuda").view(1, 3, 1, 1).half()
    W, H = 1080, 1920
    fsz = W * H * 3
    outs = []
    for k, (f0, f1) in enumerate(windows):
        f0, f1 = int(f0), int(f1)
        if f1 <= f0:
            outs.append({"webm": b"", "top": None})
            continue
        tmp = Path(tempfile.mkdtemp(prefix="matte_")) / f"cut_{k}.webm"
        # seek straight to the window (decoding from frame 0 cost seconds per window); frame f0 is the first one at/after
        # (f0 - 0.25) / 30 s on the 30 fps CFR timeline
        dec = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, (f0 - 0.25) / 30):.4f}", "-i", str(vid), "-frames:v", str(f1 - f0),
                                "-vf", f"scale={W}:{H}", "-vsync", "0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
        enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{W}x{H}", "-r", "30", "-i", "-",
                                "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-b:v", "0", "-crf", "32",
                                "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-threads", "8", "-tile-columns", "2",
                                "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                                "-metadata:s:v:0", "alpha_mode=1", str(tmp)], stdin=subprocess.PIPE)
        pend_rgb, pend_m = [], []  # one frame of look-ahead for the median
        tops = []
        tm = {"read": 0.0, "infer": 0.0, "post": 0.0, "write": 0.0}

        def emit(rgb, m):
            tw = time.time()
            enc.stdin.write(np.concatenate([rgb, m[..., None]], axis=2).tobytes())
            tm["write"] += time.time() - tw
            rows = np.nonzero((m[:, 270:810] > 128).any(axis=1))[0]
            if len(rows):
                tops.append(int(rows[0]))

        n = 0
        while True:
            batch = []
            tr = time.time()
            for _ in range(8):
                buf = dec.stdout.read(fsz)
                if len(buf) < fsz:
                    break
                batch.append(np.frombuffer(buf, np.uint8).reshape(H, W, 3))
            tm["read"] += time.time() - tr
            if not batch:
                break
            ti = time.time()
            x = torch.from_numpy(np.stack(batch)).to("cuda").permute(0, 3, 1, 2).half() / 255
            x = torch.nn.functional.interpolate(x, size=(1024, 576), mode="bilinear", align_corners=False)
            with torch.no_grad():
                pred = model((x - mean) / std)[-1].sigmoid()
            m = torch.nn.functional.interpolate(pred.float(), size=(H, W), mode="bilinear", align_corners=False)
            masks = (m[:, 0] * 255).clamp(0, 255).byte().cpu().numpy()
            tm["infer"] += time.time() - ti
            tp = time.time()
            # keep the main subject only (the speaker and whatever they hold); a lamp or shelf the model also found
            # is dropped: the largest connected region at quarter size, grown a little, gates the soft mask
            for j in range(len(masks)):
                small = masks[j][::4, ::4] > 128
                lab, nlab = ndimage.label(small)
                if nlab > 1:
                    sizes = ndimage.sum(small, lab, range(1, nlab + 1))
                    keep = ndimage.binary_dilation(lab == (int(np.argmax(sizes)) + 1), iterations=3)
                    masks[j] = masks[j] * np.repeat(np.repeat(keep, 4, axis=0), 4, axis=1)[:H, :W]
            tm["post"] += time.time() - tp
            for rgb, mk in zip(batch, masks):
                pend_rgb.append(rgb)
                pend_m.append(mk)
                if n == 0 and len(pend_m) == 2:  # the first frame has no left neighbour: its own mask
                    emit(pend_rgb[0], pend_m[0])
                    n += 1
                if len(pend_m) == 3:
                    emit(pend_rgb[1], np.median(np.stack(pend_m), axis=0).astype(np.uint8))
                    pend_rgb.pop(0)
                    pend_m.pop(0)
                    n += 1
            if len(batch) < 8:
                break
        # the last frame (no right neighbour) keeps its own mask
        if pend_m:
            emit(pend_rgb[-1], pend_m[-1])
        dec.wait()
        enc.stdin.close()
        te = time.time()
        enc.wait()
        tm["encode_tail"] = time.time() - te
        print(f"[matte] window {k}: {f1 - f0} frames, " + ", ".join(f"{a} {b:.1f}s" for a, b in tm.items()), flush=True)
        outs.append({"webm": tmp.read_bytes() if tmp.exists() else b"", "top": int(np.median(tops)) if tops else None,
                     "ms": {a: round(b * 1000) for a, b in tm.items()}, "model_s": round(t_model, 1)})
    print(f"[matte] {len(windows)} window(s), {sum(int(b) - int(a) for a, b in windows)} frames in {time.time() - t0:.1f} s (model ready at {t_model:.1f} s)", flush=True)
    return outs


# ── job + endpoints ───────────────────────────────────────────────────────────
@app.function(image=hf_render_image, cpu=8.0, memory=16384, timeout=2400, secrets=SECRETS, volumes={JOBS_ROOT: JOBS})
def run_job(payload: dict) -> dict:
    import shutil
    t0 = time.time()
    _STAGES.clear()
    flow = payload.get("flow")
    uid = str(payload.get("user_id") or "anon")
    hid = str(payload.get("history_id") or f"job{int(t0)}")
    d = Path(JOBS_ROOT) / f"{re.sub(r'[^A-Za-z0-9_-]', '', hid)[:60]}-{int(t0)}"
    d.mkdir(parents=True, exist_ok=True)
    srv = _Serve(d)
    # Edit Video 2-step flow: "draft" = the script + captions only (transcript,
    # jump-cut map, spelling fixes, guideline speech report) for the client to
    # review; "render" = cut, plan and render from that reviewed draft.
    # No phase = everything at once.
    phase = str(payload.get("phase") or "")
    try:
        if flow == "clip-analyze":
            res = _clip_analyze(payload, d)
            _progress("done", 100)
            return {**res, "render_sec": round(time.time() - t0, 1)}
        if flow == "clip":
            # CLIPPER: the clip's segment, reframed + transcribed, then the Edit Video pipeline as usual
            res = _edit_finish(payload, d, srv, _edit_direct(payload, d, srv, _clip_prepare(payload, d)))
            wm = (payload.get("clip") or {}).get("watermark")
            if isinstance(wm, dict) and (wm.get("text") or wm.get("image")):
                try:
                    _clip_watermark(Path(res["out"]), wm, d)
                except Exception as e:  # noqa: BLE001
                    print("watermark failed:", str(e)[:300], flush=True)
        elif flow != "ad" and phase == "draft":
            st = _edit_script(payload, d, srv)
            st.pop("_src", None)
            st.pop("_info", None)
            _progress("review", 100)
            return {"ok": True, "draft": st, "duration_sec": round(float(st["kept"]), 2), "render_sec": round(time.time() - t0, 1)}
        elif flow != "ad" and phase == "render":
            st = dict(payload.get("draft") or {})
            if isinstance(st.get("plan"), dict) and st.get("video_url"):
                # a draft made before step 1 was slimmed down: the video was
                # already cut (on B2) and the plan already made
                _progress("download", 3)
                st["vid"] = str(_download(str(st["video_url"]), d / "video.mp4"))
                res = _edit_finish(payload, d, srv, st)
            else:
                res = _edit_finish(payload, d, srv, _edit_direct(payload, d, srv, st))
        elif flow != "clip":
            res = _flow_ad(payload, d, srv) if flow == "ad" else _flow_edit(payload, d, srv)
        _progress("upload", 96)
        # a re-render of the same History card gets its own file name — the
        # first one is cached immutable for 30 days
        suffix = re.sub(r"[^A-Za-z0-9_-]", "", str(payload.get("out_suffix") or ""))[:12]
        url = _upload_b2(res["out"], f"users/{uid}/motion/{hid}{suffix}.mp4", "video/mp4")
        poster_url = None
        try:
            ptmp = Path(tempfile.gettempdir()) / f"{hid}_poster.jpg"
            poster_url = _upload_b2(_poster(res["out"], res["poster_at"], ptmp), f"users/{uid}/motion/{hid}{suffix}.jpg", "image/jpeg")
        except Exception as e:  # noqa: BLE001
            print("poster failed", e)
        _progress("done", 100)
        marks = sorted(_STAGES.items(), key=lambda kv: kv[1])
        stages = {k: round((marks[i + 1][1] if i + 1 < len(marks) else time.time()) - v, 1) for i, (k, v) in enumerate(marks) if k != "done"}
        return {"ok": True, "url": url, "poster_url": poster_url, "duration_sec": round(float(res["duration"]), 2),
                "render_sec": round(time.time() - t0, 1), "stages": {"start": round(marks[0][1] - t0, 1) if marks else 0, **stages},
                **res.get("debug", {})}
    except Exception as e:  # noqa: BLE001
        _progress("failed", 100)
        return {"ok": False, "error": str(e)[:900]}
    finally:
        srv.close()
        try:
            # keep_job: an internal A/B test keeps props.json + assets on the Volume, so the very same
            # job can be rendered again by another renderer (never set for client jobs)
            if not payload.get("keep_job"):
                shutil.rmtree(d, ignore_errors=True)
            JOBS.commit()
        except Exception:  # noqa: BLE001
            pass



# ── CLIPPER: long video → viral clips ─────────────────────────────────────────
# "clip-analyze": read a YouTube / Google Drive / uploaded video (title, transcript, "most replayed" heatmap),
# then the director (Sonnet 5.5, /api/clipper/plan on Vercel) picks the clips. "clip": one chosen clip — the
# segment is fetched, reframed to 9:16 around the speaker (shot by shot), transcribed word by word, and handed to
# the Edit Video pipeline (voice clean-up, face-safe captions, HyperFrames render) like any Motion edit.
CLIP_MAX_SOURCE_SEC = 4 * 3600
YUNET_MODEL = "/models/yunet.onnx"
YT_ID = re.compile(r"(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|live/|embed/)|youtu\.be/)([A-Za-z0-9_-]{11})")
GD_ID = re.compile(r"(?:/file/d/|[?&]id=|/open\?id=)([A-Za-z0-9_-]{20,})")


# YouTube flags some cloud IPs ("Sign in to confirm you're not a bot") — per container, not per account: every YouTube
# read runs in yt_task, a small container that retires itself when flagged, so the retry lands on a fresh machine.
yt_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "curl", "unzip", "ca-certificates")
    .run_commands("curl -fsSL -o /tmp/deno.zip https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip"
                  " && unzip -o /tmp/deno.zip -d /usr/local/bin && rm /tmp/deno.zip && deno --version")
    # yt-dlp must be CURRENT (YouTube changes weekly): a requests==2.31 pin here once made pip fall back to yt-dlp
    # 2024.05 ("Precondition check failed", no formats). curl-cffi = browser impersonation for the requests that want it.
    .pip_install("yt-dlp[default,curl-cffi]>=2026.10.21", "yt-dlp-ejs", "requests>=2.32.2")
    # Cloudflare WARP over MASQUE (usque, MIT): YouTube answers WARP exits where it bot-checks Modal's own IPs
    # (measured 2026-10-22: every blocked test video read + downloaded through it). WireGuard WARP can't bind its UDP
    # socket in Modal's sandbox; usque --http2 runs over TCP.
    .run_commands("curl -fsSL -o /tmp/u.zip https://github.com/Diniboy1123/usque/releases/download/v4.2.1/usque_4.2.1_linux_amd64.zip"
                  " && unzip -o /tmp/u.zip -d /tmp/usque && find /tmp/usque -name usque -type f -exec cp {} /usr/local/bin/usque \\;"
                  " && chmod +x /usr/local/bin/usque && rm -rf /tmp/u.zip /tmp/usque")
)
WARP = modal.Dict.from_name("peninglab-yt-warp", create_if_missing=True)
_WARP_PROC = None
_WARP_NOW: dict = {}  # the running exit: {"ip", "cfg"}
# YouTube's bot-check is per exit IP (measured 2026-10-22: one IAD exit passed 6/6, three others failed every time),
# so exits are remembered: an identity whose exit worked is reused first; a bot-checked exit IP is skipped for 6 h.
# The YouTube workers run in us-east so a remembered identity lands on the same exit.
WARP_BAD_TTL = 6 * 3600
YT_REGION = "us-east"


def _warp_bad() -> dict:
    now = time.time()
    try:
        return {ip: t for ip, t in (WARP.get("bad") or {}).items() if now - float(t) < WARP_BAD_TTL}
    except Exception:  # noqa: BLE001
        return {}


def _warp_mark(ok: bool) -> None:
    """How the running exit did with YouTube: worked → its identity goes to the front of the reuse list;
    bot-checked → its IP is skipped for a while."""
    ip, cfg = _WARP_NOW.get("ip"), _WARP_NOW.get("cfg")
    if not ip:
        return
    try:
        bad = _warp_bad()
        good = [g for g in (WARP.get("good") or []) if g.get("ip") != ip and g.get("cfg") != cfg]
        if ok:
            bad.pop(ip, None)
            good = [{"ip": ip, "cfg": cfg, "t": time.time()}] + good
        else:
            bad[ip] = time.time()
        WARP["good"] = good[:8]
        WARP["bad"] = bad
    except Exception as e:  # noqa: BLE001
        print("warp mark failed:", str(e)[:120], flush=True)


def _warp_start(cfg_text: str | None, wd: Path):
    """One WARP identity up as a local proxy (cfg_text None → register a new one): (process, exit ip, config) or None."""
    import subprocess as sp
    import requests
    url = "http://127.0.0.1:8085"
    cfg = wd / "config.json"
    if cfg_text:
        cfg.write_text(cfg_text, encoding="utf-8")
    else:
        cfg.unlink(missing_ok=True)
        r = sp.run(["usque", "register", "-c", str(cfg)], input="y\ny\n", capture_output=True, text=True, timeout=90, cwd=wd)
        if r.returncode != 0 or not cfg.exists():
            print("warp register failed:", (r.stdout + r.stderr)[-300:], flush=True)
            return None
        cfg_text = cfg.read_text(encoding="utf-8")
    proc = sp.Popen(["usque", "http-proxy", "-c", str(cfg), "--http2", "-b", "127.0.0.1", "-p", "8085"], cwd=wd,
                    stdout=sp.DEVNULL, stderr=sp.DEVNULL)
    for _ in range(30):
        time.sleep(0.5)
        if proc.poll() is not None:
            break
        try:
            t = requests.get("https://www.cloudflare.com/cdn-cgi/trace", proxies={"http": url, "https": url}, timeout=8).text
            if "warp=on" in t or "warp=plus" in t:
                ip = next((ln[3:] for ln in t.splitlines() if ln.startswith("ip=")), "")
                return proc, ip, cfg_text
        except Exception:  # noqa: BLE001
            continue
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:  # noqa: BLE001
        pass
    return None


def _warp_proxy(fresh: bool = False) -> str | None:
    """A local HTTP proxy through Cloudflare WARP (usque http-proxy --http2 — TCP, which Modal's sandbox allows).
    Remembered good identities first (not when fresh=True), then new ones; an exit IP bot-checked lately is skipped."""
    global _WARP_PROC
    url = "http://127.0.0.1:8085"
    if _WARP_PROC is not None and _WARP_PROC.poll() is None and not fresh:
        return url
    if _WARP_PROC is not None:
        _WARP_PROC.terminate()
        try:
            _WARP_PROC.wait(timeout=5)
        except Exception:  # noqa: BLE001
            pass
        _WARP_PROC = None
    _WARP_NOW.clear()
    wd = Path("/tmp/warp")
    wd.mkdir(exist_ok=True)
    bad = _warp_bad()
    try:
        remembered = [g["cfg"] for g in (WARP.get("good") or []) if g.get("cfg")][:3]
    except Exception:  # noqa: BLE001
        remembered = []
    for cfg_text in ([] if fresh else remembered) + [None] * 4:
        got = _warp_start(cfg_text, wd)
        if not got:
            continue
        proc, ip, text = got
        if ip and ip in bad:
            print(f"warp exit {ip} was bot-checked lately — next identity", flush=True)
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:  # noqa: BLE001
                pass
            continue
        _WARP_PROC = proc
        _WARP_NOW.update(ip=ip, cfg=text)
        print(f"warp exit {ip}", flush=True)
        return url
    print("warp: no usable exit", flush=True)
    return None


_YT_AUTH: dict = {}


def _yt_cli_auth() -> list:
    a = []
    if _YT_AUTH.get("cookiefile"):
        a += ["--cookies", _YT_AUTH["cookiefile"]]
    if _YT_AUTH.get("proxy"):
        a += ["--proxy", _YT_AUTH["proxy"]]
    return a


def _yt_blocked(msg: str) -> bool:
    m = msg.lower()
    # (no playable formats on this container = its JS challenge / client was refused: a fresh container usually gets them)
    return ("confirm you" in m or "not a bot" in m or "page needs to be reloaded" in m or "http error 429" in m
            or "requested format is not available" in m or "http error 403" in m)


@app.function(image=yt_image, cpu=2.0, memory=4096, timeout=1800, region=YT_REGION)
def yt_task(kind: str, url: str, args: dict) -> dict:
    """kind "info": title / heatmap / captions (lines); "segment": one clip as MP4 bytes; "audio": the soundtrack (Opus)."""
    import shutil
    import modal.experimental
    global _YT_AUTH
    d = Path(tempfile.mkdtemp(prefix="yt_"))
    _YT_AUTH = {}
    auth = args.get("auth") or {}
    if auth.get("cookies"):
        cf = d / "cookies.txt"
        cf.write_text(str(auth["cookies"]), encoding="utf-8")
        _YT_AUTH["cookiefile"] = str(cf)
    if auth.get("proxy"):
        _YT_AUTH["proxy"] = str(auth["proxy"])
    via = str(args.get("via") or "warp")
    on_warp = False
    if via == "warp" and not _YT_AUTH.get("proxy"):
        wp = _warp_proxy(fresh=bool(args.get("fresh")))
        if not wp:
            return {"ok": False, "error": "warp unavailable", "nowarp": True}
        _YT_AUTH["proxy"] = wp
        on_warp = True
    res = _yt_task_run(kind, url, args, d)
    if on_warp and (res.get("ok") or res.get("blocked")):
        _warp_mark(bool(res.get("ok")))
    if res.get("blocked"):
        # this container is flagged: take no more work, the next call starts a fresh one
        try:
            modal.experimental.stop_fetching_inputs()
        except Exception:  # noqa: BLE001
            pass
    shutil.rmtree(d, ignore_errors=True)
    return res


def _yt_task_run(kind: str, url: str, args: dict, d: Path) -> dict:
    try:
        if kind == "info":
            info = _yt_info(url, args.get("want") or "auto")
            if not info.get("duration") and not info.get("is_live") or str(info.get("title") or "").startswith("youtube video #"):
                # a soft block: YouTube answered this IP with an empty player (no title / length / captions)
                raise RuntimeError("not a bot: empty player response")
            lines, lang = info.get("_caps") or ([], None)
            heat = [{"start": round(float(h.get("start_time") or 0), 2), "end": round(float(h.get("end_time") or 0), 2), "value": round(float(h.get("value") or 0), 3)}
                    for h in (info.get("heatmap") or [])]
            meta = {"title": info.get("title"), "channel": info.get("channel") or info.get("uploader"), "duration": float(info.get("duration") or 0),
                    "thumb": info.get("thumbnail"), "video_id": info.get("id"), "live": bool(info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming")),
                    "spoken": (info.get("language") or "").split("-")[0] or None}
            return {"ok": True, "meta": meta, "heat": heat, "lines": lines, "lang": lang}
        if kind == "segment":
            out = d / "segment.mp4"
            _yt_segment(url, float(args["start"]), float(args["end"]), out)
            return {"ok": True, "data": out.read_bytes()}
        if kind == "audio":
            src = _yt_audio(url, d)
            out = d / "audio.ogg"
            _run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", str(out)], "audio", 1500)
            return {"ok": True, "data": out.read_bytes()}
        return {"ok": False, "error": f"unknown kind {kind}"}
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if _yt_blocked(msg):
            return {"ok": False, "blocked": True, "error": msg[:300]}
        return {"ok": False, "error": msg[:600]}


def _first_ok(calls: list, timeout: float) -> dict:
    """Several spawned yt_task calls racing: the first good answer wins (the rest are cancelled); none good → a
    "blocked" answer when there is one (so the caller keeps retrying), else the last error."""
    import queue
    q: queue.Queue = queue.Queue()

    def wait(c):
        try:
            q.put(c.get(timeout=timeout))
        except Exception as e:  # noqa: BLE001
            q.put({"ok": False, "error": str(e)[:300]})
    for c in calls:
        threading.Thread(target=wait, args=(c,), daemon=True).start()
    seen: list = []
    for _ in calls:
        r = q.get()
        seen.append(r)
        if r.get("ok"):
            for c in calls:
                try:
                    c.cancel()
                except Exception:  # noqa: BLE001
                    pass
            return r
    return next((r for r in seen if r.get("blocked")), next((r for r in seen if r.get("nowarp")), seen[-1]))


def _yt_call(kind: str, url: str, args: dict | None = None, auth: dict | None = None) -> dict:
    has_auth = bool(auth and (auth.get("cookies") or auth.get("proxy")))
    # round 1: two WARP exits at once (the saved identity + a fresh one, two containers) — about 1 in 4 exits is
    # bot-checked, so racing two cuts both the failures and the wait
    last = _first_ok([yt_task.spawn(kind, url, {**(args or {}), "via": "warp", "fresh": f}) for f in (False, True)], 1800)
    if last.get("ok"):
        return last
    if not last.get("blocked") and not last.get("nowarp"):
        raise RuntimeError(str(last.get("error") or "YouTube gagal")[:400])
    print(f"youtube {'unavailable via WARP' if last.get('nowarp') else 'blocked'} ({kind}, 2 WARP exits), retrying", flush=True)
    # then one by one: (via, fresh WARP identity, use the admin's auth)
    plan = [("warp", True, False), ("direct", False, False), ("direct", False, False)]
    plan += [("direct", False, True)] * 3 if has_auth else []
    for i, (via, fresh, use_auth) in enumerate(plan):
        if via == "warp" and last.get("nowarp"):
            continue
        try:
            last = yt_task.remote(kind, url, {**(args or {}), "via": via, "fresh": fresh, **({"auth": auth} if use_auth else {})})
        except Exception as e:  # noqa: BLE001
            last = {"ok": False, "error": str(e)[:300]}
        if last.get("ok"):
            return last
        if not last.get("blocked") and not last.get("nowarp"):
            break
        print(f"youtube {'unavailable via WARP' if last.get('nowarp') else 'blocked'} ({kind}, {via}{', with cookies/proxy' if use_auth else ''}), retrying", flush=True)
        time.sleep(1.5 * min(i + 1, 4))
    if last.get("blocked"):
        raise RuntimeError("YouTube menyekat pelayan kami untuk video ini buat masa ini — cuba lagi nanti, atau guna Upload / Google Drive untuk video yang sama.")
    raise RuntimeError(str(last.get("error") or "YouTube gagal")[:400])


@app.function(image=yt_image, cpu=0.25, memory=512, timeout=3 * 3600)
def yt_mirror(url: str, key: str) -> dict:
    """CLIPPER, a YouTube source: the whole video (≤ 1080p) copied to B2 in the background while the analysis runs,
    so the clip renders cut their segments from our copy — no YouTube call (and no bot-check) at render time.
    Each attempt in its own container (a bot-checked container stops taking work → the next lands elsewhere)."""
    last: dict = {}
    for attempt in range(5):
        try:
            last = yt_mirror_try.remote(url, key, attempt > 0, "warp" if attempt < 4 else "direct")
        except Exception as e:  # noqa: BLE001
            last = {"ok": False, "error": str(e)[:300]}
        if last.get("ok") or not last.get("blocked"):
            break
        print(f"mirror: blocked on attempt {attempt + 1}, next container", flush=True)
    if not last.get("ok"):
        print("mirror failed (renders fall back to YouTube segments):", str(last.get("error"))[:300], flush=True)
    return last


@app.function(image=yt_image.pip_install("boto3==1.34.0"), cpu=2.0, memory=4096, timeout=3600, secrets=SECRETS, region=YT_REGION)
def yt_mirror_try(url: str, key: str, fresh: bool, via: str) -> dict:
    import shutil
    global _YT_AUTH
    # already copied (a retried call): nothing to do
    if _remote_ok(_b2_public_url(key), 50_000_000):
        return {"ok": True, "url": _b2_public_url(key), "cached": True}
    d = Path(tempfile.mkdtemp(prefix="ytm_"))
    t0 = time.time()
    _YT_AUTH = {}
    on_warp = False
    try:
        if via == "warp":
            wp = _warp_proxy(fresh=fresh)
            if not wp:
                return {"ok": False, "blocked": True, "error": "warp unavailable"}
            _YT_AUTH["proxy"] = wp
            on_warp = True
        for _once in range(1):
            try:
                # faststart: the renders seek into this file over HTTP — the index must sit at the front
                _run(["yt-dlp", *_yt_cli_auth(), "--no-playlist", "--no-progress", "-f", YT_FORMAT, "--merge-output-format", "mp4",
                      "--postprocessor-args", "Merger+ffmpeg_o:-movflags +faststart",
                      "--http-chunk-size", "10M", "-o", str(d / "src.%(ext)s"), url], "youtube mirror", 3000)
            except Exception as e:  # noqa: BLE001
                blocked = _yt_blocked(str(e))
                if on_warp and blocked:
                    _warp_mark(False)
                if blocked:
                    try:
                        modal.experimental.stop_fetching_inputs()
                    except Exception:  # noqa: BLE001
                        pass
                return {"ok": False, "blocked": blocked, "error": str(e)[-300:]}
            got = sorted(d.glob("src.*"))
            if got:
                if on_warp:
                    _warp_mark(True)
                mb = round(got[0].stat().st_size / 1e6)
                out = _upload_b2(got[0], key, "video/mp4")
                print(f"mirror: {mb} MB in {round(time.time() - t0)} s", flush=True)
                return {"ok": True, "url": out, "mb": mb}
        return {"ok": False, "error": "no file"}
    finally:
        shutil.rmtree(d, ignore_errors=True)


def _remote_ok(url: str, min_bytes: int = 5_000_000) -> bool:
    """A finished object at this URL (a B2 copy still uploading answers 404)."""
    import requests
    try:
        r = requests.head(url, timeout=15, allow_redirects=True)
        return r.ok and int(r.headers.get("content-length") or 0) >= min_bytes
    except Exception:  # noqa: BLE001
        return False


def _yt_dl_opts(extra: dict | None = None) -> dict:
    o = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 20, "retries": 3}
    if _YT_AUTH.get("cookiefile"):
        o["cookiefile"] = _YT_AUTH["cookiefile"]
    if _YT_AUTH.get("proxy"):
        o["proxy"] = _YT_AUTH["proxy"]
    o.update(extra or {})
    return o


def _yt_info(url: str, want: str | None = None) -> dict:
    """The video's info; with want (the caption language or "auto"), its caption track is read in the SAME yt-dlp
    session (its cookies / impersonation / PO-token logic — a bare request to the timedtext URL comes back empty)."""
    import yt_dlp
    last = None
    for attempt in range(2):
        try:
            # the info only (title, heatmap, captions): a container offered no playable formats still reads it
            with yt_dlp.YoutubeDL(_yt_dl_opts({"skip_download": True, "ignore_no_formats_error": True})) as y:
                info = y.extract_info(url, download=False)
                if want is not None:
                    info["_caps"] = _yt_captions(info, want, y)
                return info
        except Exception as e:  # noqa: BLE001
            last = e
            if _yt_blocked(str(e)):
                break  # a flagged IP stays flagged: hand over to a fresh container
            time.sleep(2 + attempt * 3)
    msg = str(last)
    if _yt_blocked(msg):
        raise RuntimeError(msg)
    if "Private video" in msg or "unavailable" in msg.lower():
        raise RuntimeError("Video YouTube ini peribadi / tidak tersedia.")
    raise RuntimeError(f"Tak dapat baca video YouTube: {msg[:200]}")


def _words_to_lines(words: list, max_words: int = 14, max_sec: float = 9.0, gap: float = 0.75) -> list:
    """Timed words → transcript lines (sentence ends, pauses, ≤ max_words / max_sec; a new line where the speaker
    changes when the words carry speakers — each line then has its "spk")."""
    from collections import Counter
    lines, cur = [], []
    for w in words:
        turn = cur and w.get("spk") and cur[-1].get("spk") and w["spk"] != cur[-1]["spk"]
        if cur and (turn or len(cur) >= max_words or w["t"] - cur[-1]["e"] > gap or w["e"] - cur[0]["t"] > max_sec):
            lines.append(cur)
            cur = []
        cur.append(w)
        if re.search(r"[.!?…]$", w["w"]) and len(cur) >= 4:
            lines.append(cur)
            cur = []
    if cur:
        lines.append(cur)
    out = []
    for c in lines:
        line = {"start": round(c[0]["t"], 2), "end": round(c[-1]["e"], 2), "text": " ".join(x["w"] for x in c)}
        spk = Counter(x.get("spk") for x in c if x.get("spk")).most_common(1)
        if spk:
            line["spk"] = spk[0][0]
        out.append(line)
    return out


def _lines_speakers(lines: list, turns: list) -> None:
    """Caption lines (YouTube) + diarization turns: each line gets the speaker who talks most inside it."""
    for ln in lines:
        best, most = None, 0.0
        for t in turns:
            ov = min(ln["end"], t["e"]) - max(ln["start"], t["s"])
            if ov > most:
                best, most = t["spk"], ov
        if best and most >= 0.3 * max(0.1, ln["end"] - ln["start"]):
            ln["spk"] = best


# audio events → transcript tags the director reads ([KETAWA] after a punchline = the moment landed);
# the reaction usually FOLLOWS the line, so laughter / applause / cheering look 2 s past its end
EVENT_TAGS = (("laugh", "KETAWA", 0.18, 2.0), ("applause", "TEPUK", 0.3, 2.0), ("cheer", "SORAK", 0.3, 2.0),
              ("shout", "JERIT", 0.3, 0.0), ("music", "MUZIK", 0.5, 0.0))


def _tag_lines(lines: list, events: list) -> int:
    by = {int(e.get("t", -1)): e for e in events or []}
    n = 0
    for ln in lines:
        tags = []
        for key, tag, thr, after in EVENT_TAGS:
            lo, hi = int(ln["start"]), int(ln["end"] + after)
            if any(float((by.get(s) or {}).get(key) or 0) >= thr for s in range(lo, hi + 1)):
                tags.append(tag)
        if tags:
            ln["tags"] = tags
            n += 1
    return n


def _json3_words(data: dict) -> list:
    """YouTube json3 captions → timed words (auto captions carry word offsets; manual lines are spread evenly)."""
    words = []
    for ev in data.get("events") or []:
        segs = ev.get("segs") or []
        t0 = (ev.get("tStartMs") or 0) / 1000.0
        dur = (ev.get("dDurationMs") or 0) / 1000.0
        parts = [(s.get("utf8") or "", s.get("tOffsetMs")) for s in segs]
        text = "".join(p for p, _ in parts).replace("\n", " ").strip()
        if not text or text in ("[Music]", "[Muzik]", "[Musik]"):
            continue
        if any(o is not None for _, o in parts[1:]):
            for i, (p, o) in enumerate(parts):
                tok = p.strip()
                if not tok:
                    continue
                t = t0 + (o or 0) / 1000.0
                nxt = next((t0 + (parts[j][1] or 0) / 1000.0 for j in range(i + 1, len(parts)) if parts[j][1] is not None), t0 + max(dur, 0.3))
                for k, wtok in enumerate(tok.split()):
                    words.append({"w": wtok, "t": round(t, 3), "e": round(max(t + 0.05, nxt), 3)})
        else:
            toks = text.split()
            step = max(dur, 0.3 * len(toks)) / max(1, len(toks))
            for k, wtok in enumerate(toks):
                words.append({"w": wtok, "t": round(t0 + k * step, 3), "e": round(t0 + (k + 1) * step, 3)})
    words.sort(key=lambda w: w["t"])
    return words


def _yt_captions(info: dict, want: str | None, ydl=None) -> tuple:
    """The spoken-language caption track of a YouTube video → (lines, language) or ([], None). ydl = the session that
    read the info (preferred); a 429 on the track is retried once."""
    import json as _json
    import requests
    subs = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    spoken = (info.get("language") or "").split("-")[0] or None
    orig = next((k[:-5] for k in auto if k.endswith("-orig")), None)
    lang = want if want and want != "auto" else (spoken or orig)
    order = []
    if lang:
        order += [("s", k) for k in subs if k == lang or k.startswith(lang + "-")]
        order += [("a", f"{lang}-orig"), ("a", lang)]
    if orig:
        order.append(("a", f"{orig}-orig"))
    for pref in ("ms", "id", "en"):
        order += [("s", k) for k in subs if k.startswith(pref)]
    for kind, key in order:
        tracks = (subs if kind == "s" else auto).get(key) or []
        fmt = next((t for t in tracks if t.get("ext") == "json3"), None)
        if not fmt:
            continue
        for attempt in range(2):
            try:
                if ydl is not None:
                    body = ydl.urlopen(fmt["url"]).read()
                else:
                    r = requests.get(fmt["url"], timeout=30, headers={"User-Agent": UA},
                                     proxies={"http": _YT_AUTH["proxy"], "https": _YT_AUTH["proxy"]} if _YT_AUTH.get("proxy") else None)
                    r.raise_for_status()
                    body = r.content
                if not body.strip():
                    raise RuntimeError("empty caption body")
                words = _json3_words(_json.loads(body))
                if len(words) >= 20:
                    return _words_to_lines(words), key.split("-")[0]
                break
            except Exception as e:  # noqa: BLE001
                print("caption track failed:", key, str(e)[:200], flush=True)
                if "429" not in str(e):
                    break
                time.sleep(4)
    return [], None


def _yt_audio(url: str, d: Path) -> Path:
    out = d / "yt_audio.%(ext)s"
    # the analysis only needs speech: the ~50 kbps tracks (249 Opus / 139 AAC) are a third of the default 128 kbps
    _run(["yt-dlp", *_yt_cli_auth(), "--no-playlist", "-f", "249/250/139/ba[abr<=96]/ba/b[height<=480]/b", "--http-chunk-size", "10M",
          "-o", str(out), "--no-progress", url], "youtube audio", 1800)
    got = sorted(d.glob("yt_audio.*"))
    if not got:
        raise RuntimeError("Tak dapat muat turun audio YouTube.")
    return got[0]


GDRIVE_MAX = 12 * 1024 ** 3  # a 3-hour 1080p recording is ~3–8 GB


def _gdrive_download(url: str, dest: Path) -> Path:
    """A Google Drive file shared as "Anyone with the link" → local file (server to server, no upload by the client).
    A big file first answers with Drive's "can't scan for viruses" page: its form is submitted to get the file."""
    import html as _html
    import requests
    m = GD_ID.search(url)
    if not m:
        raise RuntimeError("Pautan Google Drive tidak sah.")
    fid = m.group(1)
    s = requests.Session()
    s.headers["User-Agent"] = UA
    base = "https://drive.usercontent.google.com/download"
    r = s.get(base, params={"id": fid, "export": "download", "confirm": "t"}, stream=True, timeout=60)
    for _ in range(2):
        if not (r.ok and "text/html" in r.headers.get("content-type", "")):
            break
        page = r.text
        if "accounts.google.com" in page and "ServiceLogin" in page:
            raise RuntimeError("Fail Google Drive ini peribadi — tukar Share → General access → \"Anyone with the link\".")
        if re.search(r"(?i)quota|too many users have viewed or downloaded", page):
            raise RuntimeError("Google Drive had kuota muat turun fail ini buat masa ini — cuba lagi nanti, atau buat salinan fail itu dalam Drive anda.")
        # the confirm form: its action + hidden inputs (id, export, confirm, uuid, …)
        form = re.search(r'<form[^>]+action="([^"]+)"[^>]*>(.*?)</form>', page, re.S)
        if not form:
            break
        fields = {k: _html.unescape(v) for k, v in re.findall(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]+value="([^"]*)"', form.group(2))}
        r = s.get(_html.unescape(form.group(1)), params=fields or {"id": fid, "export": "download", "confirm": "t"}, stream=True, timeout=60)
    ctype = r.headers.get("content-type", "")
    if r.ok and "text/html" not in ctype:
        n = 0
        with open(dest, "wb") as f:
            for chunk in r.iter_content(8 << 20):
                n += len(chunk)
                if n > GDRIVE_MAX:
                    raise RuntimeError("Fail Google Drive terlalu besar (maks 12GB).")
                f.write(chunk)
        if n > 500_000:
            print(f"gdrive: {n / 1024 ** 2:.0f} MB", flush=True)
            return dest
    # fallback: yt-dlp's Drive extractor
    tmpl = dest.with_name("gd.%(ext)s")
    try:
        _run(["yt-dlp", "-f", "bv*+ba/b", "--merge-output-format", "mp4", "-o", str(tmpl), "--no-progress", url], "gdrive", 1800)
        got = sorted(dest.parent.glob("gd.*"))
        if got:
            got[0].rename(dest)
            return dest
    except Exception as e:  # noqa: BLE001
        print("gdrive yt-dlp failed:", str(e)[:300], flush=True)
    raise RuntimeError("Tak dapat muat turun dari Google Drive — pastikan fail dikongsi \"Anyone with the link\".")


def _audio16k(src: str, out: Path, start: float | None = None, length: float | None = None) -> Path:
    cmd = ["ffmpeg", "-v", "error", "-y"]
    if start:
        cmd += ["-ss", f"{start:.2f}"]
    cmd += ["-i", src]
    if length:
        cmd += ["-t", f"{length:.2f}"]
    _run(cmd + ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(out)], "audio", 1800)
    return out


def _pcm_raw(wav: Path) -> Path:
    """16 kHz mono s16le with no header (numpy reads it straight from disk)."""
    raw = wav.with_suffix(".raw")
    if not raw.exists():
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-f", "s16le", "-ac", "1", "-ar", "16000", str(raw)], "pcm", 900)
    return raw


def _energy_heatmap(wav: Path, buckets: int = 100) -> list:
    """Loudness over the video as a stand-in for YouTube's "most replayed" (100 points, 0.1–1)."""
    import numpy as np
    pcm = np.memmap(str(_pcm_raw(wav)), dtype=np.int16, mode="r")
    n = len(pcm)
    if n < buckets * 160:
        return []
    size = n // buckets
    rms = np.array([float(np.sqrt(np.mean(np.square(pcm[i * size:(i + 1) * size].astype(np.float32))))) for i in range(buckets)])
    lo, hi = float(rms.min()), float(rms.max())
    dur = n / 16000.0
    if hi - lo < 1e-6:
        return []
    return [{"start": round(i * dur / buckets, 2), "end": round((i + 1) * dur / buckets, 2), "value": round(float(0.1 + 0.9 * (v - lo) / (hi - lo)), 3)}
            for i, v in enumerate(rms)]


def _detect_language(wav: Path) -> str | None:
    import numpy as np
    pcm = np.memmap(str(_pcm_raw(wav)), dtype=np.int16, mode="r")
    mid = len(pcm) // 2
    sample = np.asarray(pcm[max(0, mid - 16000 * 15): mid + 16000 * 15], dtype=np.float32) / 32768.0
    try:
        _segs, info = _whisper().transcribe(sample, language=None, beam_size=1)
        return info.language
    except Exception as e:  # noqa: BLE001
        print("language detect failed:", str(e)[:200], flush=True)
        return None


@app.function(image=hf_render_image, cpu=8.0, memory=8192, timeout=1800, volumes={JOBS_ROOT: JOBS})
def clip_asr(rel: str, language: str | None, offset: float, keep_from: float, keep_to: float) -> list:
    """Whisper on one chunk of a long source (on the jobs Volume); words in source time, only [keep_from, keep_to)."""
    JOBS.reload()
    words = _transcribe(Path(JOBS_ROOT) / rel, language or None, vad=True)
    out = []
    for w in words:
        t, e = w["t"] + offset, w["e"] + offset
        if keep_from <= t < keep_to:
            out.append({"w": w["w"], "t": round(t, 3), "e": round(e, 3)})
    return out


def _asr_long(wav: Path, d: Path, language: str | None) -> list:
    """Whisper over a long source: ~10-minute chunks (with overlap) transcribed in parallel containers."""
    dur = _probe(wav)["duration"]
    if dur <= 720:
        return _transcribe(wav, language or None, vad=True)
    CH, PAD = 600.0, 4.0
    jobs = []
    rel_root = d.relative_to(JOBS_ROOT)
    k, t = 0, 0.0
    while t < dur:
        a, b = max(0.0, t - PAD), min(dur, t + CH + PAD)
        part = d / f"asr_{k:03d}.wav"
        _audio16k(str(wav), part, a, b - a)
        jobs.append((str(rel_root / part.name), a, t, min(dur, t + CH) if t + CH < dur else dur + 1))
        t += CH
        k += 1
    JOBS.commit()
    calls = [clip_asr.spawn(rel, language, off, kf, kt) for rel, off, kf, kt in jobs]
    words = []
    for c in calls:
        words += c.get(timeout=1700)
    words.sort(key=lambda w: w["t"])
    return words


# CLIPPER audio engine (GPU L4, clipper-asd/audio_intel.py): Whisper large-v3-turbo (MIT) + forced alignment (cahya
# wav2vec2 Indonesian/Malay, Apache-2.0) + pyannote community-1 speakers (CC-BY-4.0; gated — skipped until the HF account
# behind "lh-hf" accepts its terms, then bump diar_tag) + PANNs sound events (CC-BY-4.0). The image is built locally
# only (inside containers the definition isn't rebuilt).
try:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "clipper-asd"))
    from audio_intel_image import build_image as _audio_image_builder
    audio_image = _audio_image_builder(modal, hf_secret="lh-hf", diar_mirror=False, diar_tag="2").add_local_file(
        "clipper-asd/audio_intel.py", "/app/clipper-asd/audio_intel.py", copy=True)
except Exception as _e:  # noqa: BLE001
    if modal.is_local():
        raise
    audio_image = modal.Image.debian_slim(python_version="3.11")


@app.function(image=audio_image, gpu="L4", cpu=8.0, memory=16384, timeout=1800, secrets=[modal.Secret.from_name("lh-hf")],
              volumes={JOBS_ROOT: JOBS}, scaledown_window=180)
def clip_audio(rel: str | None, data: bytes | None, language: str | None, hint: str | None, stages: list) -> dict:
    """The audio engine on one file: a jobs-Volume path (a whole podcast) or bytes (a clip). → words / turns / events."""
    if "/app/clipper-asd" not in sys.path:
        sys.path.insert(0, "/app/clipper-asd")
    import audio_intel
    if rel:
        JOBS.reload()
        path = str(Path(JOBS_ROOT) / rel)
    else:
        f = Path(tempfile.mkdtemp(prefix="ai_")) / "clip.audio"
        f.write_bytes(data or b"")
        path = str(f)
    t = time.time()
    res = audio_intel.run(path, language=language or None, hint=(hint or None), stages=tuple(stages))
    res["wall"] = round(time.time() - t, 1)
    return res


def _engine_get(call, what: str, timeout: int = 1700) -> dict | None:
    try:
        res = call.get(timeout=timeout)
        print(f"audio engine ({what}): {len(res.get('words') or [])} words, {len(res.get('speakers') or [])} speakers, "
              f"{len(res.get('turns') or [])} turns, {len(res.get('events') or [])} event seconds, timing {res.get('timing')}", flush=True)
        for n in (res.get("notes") or [])[:6]:
            print("  note:", str(n)[:200], flush=True)
        return res
    except Exception as e:  # noqa: BLE001
        print(f"audio engine ({what}) failed — the CPU path instead:", str(e)[:300], flush=True)
        return None


def _assign_speakers(words: list, turns: list) -> None:
    """Each word gets the speaker of the turn covering its midpoint (or the nearest turn within 1 s)."""
    import bisect
    starts = [t["s"] for t in turns]
    for w in words:
        mid = (w["t"] + w["e"]) / 2
        i = bisect.bisect_right(starts, mid) - 1
        best, dist = None, 1e9
        for j in (i, i + 1):
            if 0 <= j < len(turns):
                t = turns[j]
                dd = 0.0 if t["s"] <= mid <= t["e"] else min(abs(mid - t["s"]), abs(mid - t["e"]))
                if dd < dist:
                    best, dist = t["spk"], dd
        if best and dist <= 1.0:
            w["spk"] = best


def _visual_check(clips: list, src: str, p: dict, d: Path, uid: str, hid: str) -> list:
    """The top candidates SEEN, not only read: 6 frames across each clip → one contact sheet (B2) → the director's vision
    check (/api/clipper/vision, DragonAPI Sonnet 5.5) → a small score nudge ((visual − 6) × 1.5) and the note on the clip."""
    import requests
    from concurrent.futures import ThreadPoolExecutor
    order = sorted(range(len(clips)), key=lambda i: -float(clips[i].get("score") or 0))[:8]

    def sheet(k: int, i: int):
        c = clips[i]
        s0, e0 = float(c.get("start") or 0), float(c.get("end") or 0)
        if e0 - s0 < 3:
            return None
        got = []
        for j in range(6):
            t = s0 + (e0 - s0) * (j + 0.5) / 6
            f = d / f"vis_{k}_{j}.jpg"
            try:
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", src, "-frames:v", "1", "-vf", "scale=480:-2",
                                "-q:v", "4", str(f)], capture_output=True, timeout=90)
            except Exception:  # noqa: BLE001
                continue
            if f.exists() and f.stat().st_size > 1000:
                got.append(f)
        if len(got) < 3:
            return None
        while len(got) < 6:  # a full 3×2 sheet
            got.append(got[-1])
        for x, f in enumerate(got):
            (d / f"visseq_{k}_{x}.jpg").write_bytes(f.read_bytes())
        out = d / f"vis_{k}.jpg"
        _run(["ffmpeg", "-v", "error", "-y", "-framerate", "1", "-i", str(d / f"visseq_{k}_%d.jpg"), "-vf",
              "scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=black,tile=3x2",
              "-frames:v", "1", "-q:v", "4", str(out)], "vision sheet", 60)
        url = _upload_b2(out, f"users/{uid}/clipper/{hid}-vis-{k}.jpg", "image/jpeg")
        return {"i": i, "title": c.get("title"), "hook": c.get("hook"), "image": url}

    def safe(a):
        try:
            return sheet(*a)
        except Exception as e:  # noqa: BLE001
            print("vision sheet failed:", str(e)[:160], flush=True)
            return None
    t = time.time()
    with ThreadPoolExecutor(8) as ex:
        items = [x for x in ex.map(safe, list(enumerate(order))) if x]
    if not items:
        return clips
    r = requests.post(p["vision_url"], json={"history_id": p["history_id"], "token": p["plan_token"], "items": items}, timeout=115)
    j = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if not (r.ok and j.get("ok")):
        print("vision check skipped:", str(j.get("error") or r.status_code)[:200], flush=True)
        return clips
    for v in j.get("results") or []:
        i = int(v.get("i", -1))
        if 0 <= i < len(clips):
            vis = max(0.0, min(10.0, float(v.get("visual") or 0)))
            c = clips[i]
            c["visual"] = {"score": round(vis, 1), "note": str(v.get("note") or "")[:120]}
            c["score"] = int(max(1, min(100, round(float(c.get("score") or 60) + (vis - 6) * 1.5))))
    clips.sort(key=lambda c: -float(c.get("score") or 0))
    print(f"vision check: {len(items)} candidates seen in {round(time.time() - t)} s", flush=True)
    return clips


def _clip_analyze(p: dict, d: Path) -> dict:
    import shutil
    import requests
    src = p.get("source") or {}
    kind, url = str(src.get("type") or ""), str(src.get("url") or "")
    want = str((p.get("options") or {}).get("language") or "auto")
    uid, hid = str(p.get("user_id") or "anon"), str(p.get("history_id") or "job")
    meta = {"source_type": kind}
    lines, lang, heat, cap_src, media_url = [], None, [], "", None
    _progress("source", 4)
    if kind == "youtube":
        yi = _yt_call("info", url, {"want": want}, p.get("yt_auth"))
        m = yi["meta"]
        if m.get("live"):
            raise RuntimeError("Siaran langsung belum tamat — cuba bila live sudah habis.")
        meta.update(title=m.get("title"), channel=m.get("channel"), duration=float(m.get("duration") or 0), thumb=m.get("thumb"), video_id=m.get("video_id"))
        heat = yi.get("heat") or []
        # our own copy of the video for the clip renders, made in the background (renders check it exists first)
        if 0 < meta["duration"] <= CLIP_MAX_SOURCE_SEC:
            try:
                mkey = f"users/{uid}/clipper/{hid}-source.mp4"
                yt_mirror.spawn(url, mkey)
                media_url = _b2_public_url(mkey)
            except Exception as e:  # noqa: BLE001
                print("mirror not started:", str(e)[:200], flush=True)
        _progress("transcript", 15)
        lines, lang = yi.get("lines") or [], yi.get("lang")
        cap_src = "youtube" if lines else ""
        wav = None
        if not lines:
            _progress("audio", 20)
            audio = d / "yt_audio.ogg"
            audio.write_bytes(_yt_call("audio", url, None, p.get("yt_auth"))["data"])
            wav = _audio16k(str(audio), d / "audio16k.wav")
            lang = lang or (want if want != "auto" else None) or m.get("spoken")
    else:
        if kind == "gdrive":
            _progress("download", 6)
            gtmp = Path(tempfile.mkdtemp(prefix="gdrive_"))  # local disk (a 2–3 hour file is GBs)
            local = _gdrive_download(url, gtmp / "source.mp4")
            info = _probe(local)
            if not info.get("w"):
                raise RuntimeError("Fail Google Drive itu bukan video.")
            # the clip renders read their segments from a B2 copy: uploaded in the background meanwhile
            media_url = _b2_public_url(f"users/{uid}/clipper/{hid}-source.mp4")
            upbox: dict = {}

            def _up():
                try:
                    _upload_b2(local, f"users/{uid}/clipper/{hid}-source.mp4", "video/mp4")
                    upbox["ok"] = True
                except Exception as e:  # noqa: BLE001
                    upbox["error"] = str(e)[:300]
            upthread = threading.Thread(target=_up, daemon=True)
            upthread.start()
            src_for_audio = str(local)
        elif kind == "upload":
            media_url, src_for_audio = url, url
            info = _probe_url(url)
        else:
            raise RuntimeError("Sumber video tidak dikenali.")
        meta.update(title=str(src.get("name") or "Video"), channel=None, duration=float(info.get("duration") or 0), thumb=None, video_id=None)
        wav = _audio16k(src_for_audio, d / "audio16k.wav")
    if meta["duration"] > CLIP_MAX_SOURCE_SEC:
        raise RuntimeError("Video terlalu panjang (maks 4 jam).")
    # ── the GPU audio engine: who speaks when + laughter / applause / music (+ the transcript when there are no
    # captions: Whisper large-v3-turbo, word-aligned) ──
    eng_path = None
    if kind == "youtube" and wav is None:
        try:
            _progress("audio", 20)
            audio = d / "yt_audio.ogg"
            audio.write_bytes(_yt_call("audio", url, None, p.get("yt_auth"))["data"])
            eng_path = audio
        except Exception as e:  # noqa: BLE001
            print("audio for the engine not fetched (captions only):", str(e)[:200], flush=True)
    elif kind == "youtube":
        eng_path = d / "yt_audio.ogg" if (d / "yt_audio.ogg").exists() else wav
    else:
        eng_path = wav
    turns, events = [], []
    if eng_path is not None and Path(eng_path).exists():
        JOBS.commit()
        rel = str(Path(eng_path).relative_to(JOBS_ROOT))
        hint = str(meta.get("title") or "")[:120] or None
        lang_hint = (want if want != "auto" else None) or lang
        if lines:  # captions: speakers + sound events only
            _progress("speakers", 30)
            res = _engine_get(clip_audio.spawn(rel, None, lang_hint, hint, ["diar", "events", "energy"]), "speakers + events")
        else:  # the transcript too — transcription and speaker separation side by side
            _progress("transcript", 30)
            main = clip_audio.spawn(rel, None, lang_hint, hint, ["asr", "align", "events", "energy"])
            diar = clip_audio.spawn(rel, None, lang_hint, hint, ["diar"])
            res = _engine_get(main, "transcript + events")
            rd = _engine_get(diar, "speakers")
            if res is not None and rd is not None:
                res["turns"] = rd.get("turns") or []
            if res and len(res.get("words") or []) >= 20:
                words = res["words"]
                if res.get("turns"):
                    _assign_speakers(words, res["turns"])
                lines = _words_to_lines(words)
                cap_src = "whisper-turbo"
                lang = res.get("language") or lang
        if res:
            turns, events = res.get("turns") or [], res.get("events") or []
    if not lines:  # the engine failed: the CPU transcriber (Whisper small, in parallel chunks)
        if wav is None and eng_path is not None:
            wav = _audio16k(str(eng_path), d / "audio16k.wav")
        if wav is None:
            raise RuntimeError("Tak dapat baca audio video ini.")
        lang = (want if want != "auto" else None) or _detect_language(wav)
        _progress("transcript", 40)
        words = _asr_long(wav, d, lang)
        lines = _words_to_lines(words)
        cap_src = "whisper"
    if not heat and wav is not None:
        heat = _energy_heatmap(wav)
    if turns and cap_src == "youtube":
        _lines_speakers(lines, turns)
    if events:
        print(f"audio tags on {_tag_lines(lines, events)} lines", flush=True)
    if len(lines) < 3:
        raise RuntimeError("Tiada percakapan yang boleh dibaca dalam video ini.")
    meta["language"] = lang
    _progress("director", 70)
    plan, err = None, ""
    try:
        r = requests.post(p["plan_url"], json={"history_id": p["history_id"], "token": p["plan_token"], "meta": meta,
                                               "heatmap": heat, "segments": lines}, timeout=295)
        j = r.json()
        if r.ok and j.get("ok"):
            plan = j
        else:
            err = str(j.get("error") or r.status_code)[:300]
    except Exception as e:  # noqa: BLE001
        err = str(e)[:300]
    clips_out = (plan or {}).get("clips") or []
    if clips_out and p.get("vision_url"):
        vsrc = None
        if kind == "gdrive":
            vsrc = str(local)
        elif kind == "upload":
            vsrc = url
        elif media_url:  # YouTube: our B2 copy (usually done by now — wait a little for it)
            for _ in range(12):
                if _remote_ok(media_url):
                    vsrc = media_url
                    break
                time.sleep(10)
        if vsrc:
            _progress("vision", 86)
            try:
                clips_out = _visual_check(clips_out, vsrc, p, d, uid, hid)
            except Exception as e:  # noqa: BLE001
                print("vision check failed (picks kept as they are):", str(e)[:200], flush=True)
    if kind == "gdrive":
        _progress("save", 92)
        upthread.join(timeout=1800)
        shutil.rmtree(gtmp, ignore_errors=True)
        if not upbox.get("ok"):
            raise RuntimeError(f"Gagal simpan salinan video: {upbox.get('error') or 'masa tamat'}")
    _progress("save", 95)
    seg_url = None
    try:
        tf = d / "transcript.json"
        tf.write_text(json.dumps(lines, ensure_ascii=False), encoding="utf-8")
        seg_url = _upload_b2(tf, f"users/{uid}/clipper/{hid}-transcript.json", "application/json")
    except Exception as e:  # noqa: BLE001
        print("transcript upload failed:", str(e)[:200], flush=True)
    # the speaker turns (compact) — each clip render gets its own slice for the camera's speaker cuts
    meta["turns"] = [[round(float(t["s"]), 2), round(float(t["e"]), 2), str(t["spk"])] for t in turns[:8000]]
    return {"ok": True, "analysis": {**meta, "media_url": media_url, "heatmap": heat, "caption_source": cap_src, "transcript_url": seg_url,
                                     "lines": len(lines), "summary": (plan or {}).get("summary") or "", "clips": clips_out,
                                     "director": (plan or {}).get("director"), "plan_error": err or None}}


def _probe_url(url: str) -> dict:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", url],
                       capture_output=True, text=True, timeout=120)
    try:
        j = json.loads(r.stdout or "{}")
    except Exception:  # noqa: BLE001
        j = {}
    v = next((s for s in j.get("streams", []) if s.get("codec_type") == "video"), {})
    return {"duration": float((j.get("format") or {}).get("duration") or 0), "w": v.get("width"), "h": v.get("height")}


YT_FORMAT = "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b"


def _yt_segment(url: str, start: float, end: float, out: Path) -> Path:
    """One clip of a YouTube video, frame-accurate, ≤ 1080p: yt-dlp's section download (cut points re-encoded),
    else the stream URLs read by ffmpeg."""
    def hms(x: float) -> str:
        return f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{x % 60:06.3f}"
    tmpl = out.with_name("ytseg.%(ext)s")
    try:
        _run(["yt-dlp", *_yt_cli_auth(), "--no-playlist", "--no-progress", "-f", YT_FORMAT, "--download-sections", f"*{hms(start)}-{hms(end)}",
              "--force-keyframes-at-cuts", "--merge-output-format", "mp4", "-o", str(tmpl), url], "youtube clip", 900)
        got = sorted(out.parent.glob("ytseg.*"))
        if got:
            got[0].replace(out)
            if _probe(out)["duration"] > (end - start) * 0.8:
                return out
    except Exception as e:  # noqa: BLE001
        if _yt_blocked(str(e)):
            raise RuntimeError("not a bot: YouTube bot-checked this exit") from None
        print("yt-dlp section download failed, trying stream URLs:", str(e)[:300], flush=True)
    r = subprocess.run(["yt-dlp", *_yt_cli_auth(), "--no-playlist", "-g", "-f", YT_FORMAT, url],
                       capture_output=True, text=True, timeout=180)
    urls = [u for u in (r.stdout or "").split("\n") if u.startswith("http")]
    if not urls:
        err = r.stderr or ""
        if _yt_blocked(err):  # the whole stderr: the "not a bot" line sits before a long tail of help links
            raise RuntimeError("not a bot: YouTube bot-checked this exit")  # → yt_task marks it blocked → a fresh one
        raise RuntimeError(f"Tak dapat ambil video YouTube: {err[-300:]}")
    pad = 0.0
    cmd = ["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0.0, start - pad):.3f}", "-i", urls[0]]
    if len(urls) > 1:
        cmd += ["-ss", f"{max(0.0, start - pad):.3f}", "-i", urls[1], "-map", "0:v:0", "-map", "1:a:0"]
    cmd += ["-t", f"{end - start:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-c:a", "aac", "-b:a", "192k", str(out)]
    _run(cmd, "youtube clip", 900)
    return out


def _media_segment(url: str, start: float, end: float, out: Path) -> Path:
    _run(["ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-i", url, "-t", f"{end - start:.3f}",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-c:a", "aac", "-b:a", "192k", str(out)], "clip", 900)
    return out


def _faces_wide(video: Path, fps_s: int = 4) -> list:
    """Every face per sample of a (wide) video, YuNet: [{t, faces: [{cx, cy, w, h, s}]}] (0..1)."""
    import numpy as np
    import cv2
    info = _probe(video)
    W0, H0 = info["w"] or 1920, info["h"] or 1080
    W = 640
    H = max(2, int(round(W * H0 / W0 / 2)) * 2)
    det = cv2.FaceDetectorYN.create(YUNET_MODEL, "", (W, H), 0.6, 0.3, 5000)
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(video), "-vf", f"fps={fps_s},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                            stdout=subprocess.PIPE)
    out, i, size = [], 0, W * H * 3
    while True:
        buf = proc.stdout.read(size)
        if not buf or len(buf) < size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        _n, faces = det.detect(frame)
        fl = []
        for f in (faces if faces is not None else []):
            x, y, w, h, score = float(f[0]), float(f[1]), float(f[2]), float(f[3]), float(f[-1])
            if w / W < 0.025:
                continue
            fl.append({"cx": (x + w / 2) / W, "cy": (y + h / 2) / H, "w": w / W, "h": h / H, "s": score})
        out.append({"t": round(i / fps_s, 3), "faces": fl})
        i += 1
    proc.wait(timeout=120)
    return out


def _lerp_expr(keys: list) -> str:
    """Piecewise-linear x(t) for ffmpeg from [(t, x), …]."""
    keys = [(round(t, 3), round(x, 1)) for t, x in keys]
    expr = f"{keys[-1][1]}"
    for (t0, x0), (t1, x1) in reversed(list(zip(keys, keys[1:]))):
        seg = f"{x0}" if abs(x1 - x0) < 0.5 or t1 - t0 < 1e-3 else f"{x0}+({x1 - x0})*(t-{t0})/{round(t1 - t0, 3)}"
        expr = f"if(lt(t,{t1}),{seg},{expr})"
    return expr


# Active speaker detection (CLIPPER): LR-ASD (MIT, Junhua Liao) on YuNet face tracks, CPU — clipper-asd/asd_infer.py.
# AVA-trained weights only (the TalkSet fine-tune's data licence is unclear); no S3FD (unlicensed).
asd_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "curl", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.5.1", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install("numpy<2", "scipy==1.13.1", "opencv-python-headless==4.10.0.84", "python_speech_features==0.6")
    .run_commands(
        "mkdir -p /models && curl -fsSL -o /models/lrasd_ava.model https://raw.githubusercontent.com/Junhua-Liao/LR-ASD/main/weight/pretrain_AVA.model"
        " && test $(stat -c%s /models/lrasd_ava.model) -gt 1000000",
        "curl -fsSL -o /models/yunet.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        " && test $(stat -c%s /models/yunet.onnx) -gt 100000",
        # TransNetV2 shot cuts (MIT): PyTorch conversion of the official weights, checked against its hash
        "curl -fsSL -o /models/transnetv2.pth https://huggingface.co/Sn4kehead/TransNetV2/resolve/db6ceabeb692ec71ecc6beb6d00db67ad1412d7f/transnetv2-pytorch-weights.pth"
        " && echo '834b10f25ae9e1b4e4f2652fe2843bd2b1388057a435d68b7c52635578fcc04d  /models/transnetv2.pth' | sha256sum -c -",
    )
    .add_local_dir("clipper-asd", "/app/clipper-asd", copy=True)
)
_ASD_NET = None


@app.function(image=asd_image, cpu=4.0, memory=6144, timeout=900)
def clip_asd(video: bytes) -> dict:
    """Who is talking in a clip: face tracks with a speaking score per frame (25 fps)."""
    import sys
    global _ASD_NET
    sys.path.insert(0, "/app/clipper-asd")
    import torch
    from asd_infer import ASDNet, active_speakers
    torch.set_num_threads(4)
    if _ASD_NET is None:
        _ASD_NET = ASDNet()
        _ASD_NET.load("/models/lrasd_ava.model")
    p = Path(tempfile.mkdtemp(prefix="asd_")) / "clip.mp4"
    p.write_bytes(video)
    t = time.time()
    res = active_speakers(str(p), _ASD_NET, "/models/yunet.onnx")
    res["sec"] = round(time.time() - t, 1)
    try:
        from camera import shot_cuts
        res["cuts"] = [float(c) for c in shot_cuts(str(p), weights="/models/transnetv2.pth")]
    except Exception as e:  # noqa: BLE001
        print("transnet cuts failed:", str(e)[:200], flush=True)
    return res


def _clip_asd_for(src: Path, d: Path) -> dict | None:
    """The clip's speaker timeline (a ≤1280-wide copy goes to the ASD container); None when it can't be had."""
    try:
        small = d / "asd_src.mp4"
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast",
              "-crf", "22", "-c:a", "aac", "-b:a", "96k", str(small)], "asd copy", 600)
        res = clip_asd.remote(small.read_bytes())
        print(f"asd: {len(res.get('tracks') or [])} face tracks in {res.get('sec')} s, {len(res.get('cuts') or [])} shot cuts", flush=True)
        return res
    except Exception as e:  # noqa: BLE001
        print("asd failed (camera falls back to the face follow):", str(e)[:300], flush=True)
        return None


def _asd_cut(asd: dict, a: float, b: float, W: float, H: float, cw: float):
    """A shot with two or more people: hard cuts to whoever is talking (cutawan's rules: evidence = the speaker's
    score > 1 and ahead of the next by > 1; a rival must lead 0.4 s; ≥ 1 s between switches). None = weak evidence."""
    import numpy as np
    fps = int(asd.get("fps") or 25)
    f0, f1 = int(round(a * fps)), int(round(b * fps))
    n = f1 - f0
    tr = [t for t in asd.get("tracks") or [] if t["f0"] < f1 and t["f0"] + t["n"] > f0]
    if len(tr) < 2 or n < fps:
        return None
    S = np.full((len(tr), n), -9.0)
    X = np.full((len(tr), n), np.nan)
    for i, t in enumerate(tr):
        for j in range(t["n"]):
            k = t["f0"] + j - f0
            if 0 <= k < n:
                S[i, k] = t["score"][j]
                X[i, k] = t["cx"][j]
    S = np.array([np.convolve(r, np.ones(7) / 7, mode="same") for r in S])
    order = np.sort(S, axis=0)
    best, top, second = S.argmax(0), order[-1], order[-2]
    ev = (top > 1.0) & (top - second > 1.0)
    if ev.mean() < 0.3:
        return None
    cur = int(best[int(np.argmax(ev))])
    segs, start, run_t, run_n, last = [], 0, None, 0, -10 ** 9
    for i in range(n):
        cand = int(best[i]) if ev[i] else cur
        if cand == cur:
            run_t, run_n = None, 0
            continue
        run_n = run_n + 1 if run_t == cand else 1
        run_t = cand
        if run_n >= int(0.4 * fps) and i - run_n + 1 - last >= fps:
            sw = i - run_n + 1
            segs.append((start, sw, cur))
            start, cur, last, run_t, run_n = sw, cand, sw, None, 0
    segs.append((start, n, cur))
    keys = []
    for s0, s1, ti in segs:
        xs = X[ti, s0:s1]
        xs = xs[~np.isnan(xs)]
        if not len(xs):
            xs = X[ti][~np.isnan(X[ti])]
        x = float(min(max(float(np.median(xs)) * W - cw / 2, 0), W - cw))
        t0 = s0 / fps
        if keys:
            keys.append((max(keys[-1][0] + 0.001, t0 - 0.034), keys[-1][1]))  # a hard cut (one frame)
        keys.append((t0, x))
    expr = _lerp_expr(keys) if len(keys) > 1 else f"{keys[0][1]:.1f}"
    return f"crop={cw:.0f}:{H}:x='{expr}':y=0,scale=1080:1920:flags=lanczos", len(segs) - 1


def _cam():
    import sys
    if "/app/clipper-asd" not in sys.path:
        sys.path.insert(0, "/app/clipper-asd")
    import camera
    return camera


def _stack_vf(lcx: float, rcx: float, W: float, H: float):
    """Two people far apart in one shot: each in their own half (left on top), or None when they don't fit."""
    hh = H * 0.62
    ww = hh * 9 / 8
    if ww > W / 2 + 40:
        return None

    def box(cx):
        x = min(max(cx * W - ww / 2, 0), W - ww)
        return f"crop={ww:.0f}:{hh:.0f}:{x:.0f}:{(H - hh) * 0.35:.0f},scale=1080:960:flags=lanczos"
    return f"split=2[a][b];[a]{box(lcx)}[t];[b]{box(rcx)}[u];[t][u]vstack"


def _reframe(src: Path, out: Path, d: Path, mode: str = "face", turns=None) -> dict:
    """A wide clip → 9:16 1080x1920, shot by shot: the camera follows the main speaker (dead zone + eased pans);
    two people far apart in one shot → stacked halves; no face → the whole frame over a blurred copy."""
    info = _probe(src)
    W, H, dur = info["w"] or 1920, info["h"] or 1080, info["duration"] or 0
    if not dur or mode == "fit" or W / H <= 0.62:
        return {"mode": "as-is"}  # _normalise fits it (a vertical source, or the client asked for the whole frame)
    cw = H * 9 / 16
    if cw > W:
        return {"mode": "as-is"}
    fps = 30
    samples = _faces_wide(src) if mode in ("face", "split") else []
    # who is talking (face mode): two or more people in a shot → the camera cuts to the speaker
    asd = _clip_asd_for(src, d) if mode == "face" and any(len(s["faces"]) >= 2 for s in samples) else None
    # shot cuts: TransNetV2 (from the ASD container) when it ran, else ffmpeg's scene score
    raw_cuts = asd.get("cuts") if asd and asd.get("cuts") is not None else _scene_cuts(src, 0.3)
    asd = asd if asd and asd.get("tracks") else None
    cuts = [c for c in raw_cuts if 0.6 < c < dur - 0.6]
    edges = [0.0] + cuts + [dur]
    shots = []
    for a, b in zip(edges, edges[1:]):
        if shots and b - a < 0.8:
            shots[-1] = (shots[-1][0], b)
        else:
            shots.append((a, b))
    parts, report = [], []
    for k, (a, b) in enumerate(shots):
        fa, fb = round(a * fps), round(b * fps)
        if fb - fa < 2:
            continue
        ss = [s for s in samples if a <= s["t"] < b]
        withf = [s for s in ss if s["faces"]]
        layout, vf = "center", None
        switches = 0
        if mode == "face":
            # the virtual camera: a static crop while the face stays central, eased re-centring, a hard cut to
            # whoever talks (per diarized turn when we have turns, else LR-ASD's per-frame evidence)
            try:
                cam = _cam()
                pl = cam.plan_shot(fa / fps, fb / fps, W, H, cw, fps, samples, asd, turns)
                if pl["layout"] in ("static", "follow", "speaker") and pl.get("xs"):
                    cmds = d / f"shot_{k:03d}.cmd"
                    cmds.write_text(cam.crop_sendcmd(pl["xs"], fps), encoding="utf-8")
                    vf = cam.crop_filter(cw, H, cmds, pl["xs"][0])
                    layout, switches = pl["layout"], int(pl.get("switches") or 0)
                elif pl["layout"] == "split" and pl.get("split"):
                    vf = _stack_vf(pl["split"][0], pl["split"][1], W, H)
                    layout = "split" if vf else layout
            except Exception as e:  # noqa: BLE001
                print("camera planner failed on a shot (old follow instead):", str(e)[:200], flush=True)
                vf = None
        if vf is None and mode in ("face", "split") and len(withf) >= max(1, len(ss) * 0.3):
            # face clusters across the shot (by x position)
            clusters: list = []
            for s in withf:
                for f in s["faces"]:
                    c = next((c for c in clusters if abs(c["cx"] - f["cx"]) < 0.12), None)
                    if c:
                        c["n"] += 1
                        c["area"] += f["w"] * f["h"]
                        c["cx"] = c["cx"] * 0.8 + f["cx"] * 0.2
                    else:
                        clusters.append({"cx": f["cx"], "n": 1, "area": f["w"] * f["h"]})
            clusters.sort(key=lambda c: -c["area"])
            main = clusters[0]
            if asd and len(clusters) >= 2:
                cut = _asd_cut(asd, a, b, W, H, cw)
                if cut:
                    vf, switches = cut
                    layout = "speaker"
            two = [c for c in clusters[:2] if c["n"] >= len(withf) * 0.55]
            if vf is None and len(two) == 2 and abs(two[0]["cx"] - two[1]["cx"]) > 0.38 and min(two[0]["area"], two[1]["area"]) > 0.4 * max(two[0]["area"], two[1]["area"]):
                # a two-shot: each person in their own half (left on top)
                left, right = sorted(two, key=lambda c: c["cx"])
                hh = H * 0.62
                ww = hh * 9 / 8
                if ww <= W / 2 + 40:
                    def box(cx):
                        x = min(max(cx * W - ww / 2, 0), W - ww)
                        return f"crop={ww:.0f}:{hh:.0f}:{x:.0f}:{(H - hh) * 0.35:.0f},scale=1080:960:flags=lanczos"
                    vf = f"split=2[a][b];[a]{box(left['cx'])}[t];[b]{box(right['cx'])}[u];[t][u]vstack"
                    layout = "split"
            if vf is None:
                track = []
                prev = main["cx"]
                for s in ss:
                    near = [f for f in s["faces"] if abs(f["cx"] - prev) < 0.15]
                    if near:
                        prev = max(near, key=lambda f: f["w"] * f["h"])["cx"]
                    track.append((s["t"] - a, prev))
                xs = [min(max(cx * W - cw / 2, 0), W - cw) for _, cx in track]
                # median smoothing, then a dead zone: the camera moves only when the face leaves it, easing over 0.6 s
                med = [sorted(xs[max(0, i - 2): i + 3])[len(xs[max(0, i - 2): i + 3]) // 2] for i in range(len(xs))]
                keys = [(0.0, med[0] if med else (W - cw) / 2)]
                pos = keys[0][1]
                for (t, _), x in zip(track, med):
                    if abs(x - pos) > cw * 0.12 and t - keys[-1][0] > 0.7:
                        keys.append((t, pos))
                        keys.append((t + 0.6, x))
                        pos = x
                expr = _lerp_expr(keys) if len(keys) > 1 else f"{keys[0][1]:.1f}"
                vf = f"crop={cw:.0f}:{H}:x='{expr}':y=0,scale=1080:1920:flags=lanczos"
                layout = "follow" if len(keys) > 1 else "face"
        if vf is None:
            if mode == "center":
                vf = f"crop={cw:.0f}:{H}:{(W - cw) / 2:.0f}:0,scale=1080:1920:flags=lanczos"
            else:  # no face in this shot: the whole frame over a blurred copy of itself
                vf = ("split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:6,eq=brightness=-0.08[bg];"
                      "[b]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2")
                layout = "fit"
        part = d / f"shot_{k:03d}.mp4"
        script = d / f"shot_{k:03d}.txt"
        script.write_text(f"[0:v]fps={fps},{vf},setsar=1,format=yuv420p[v]", encoding="utf-8")
        _run(["ffmpeg", "-v", "error", "-y", "-ss", f"{fa / fps:.3f}", "-i", str(src), "-frames:v", str(fb - fa), "-an",
              "-filter_complex_script", str(script), "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-r", str(fps), str(part)],
             f"reframe shot {k}", 600)
        parts.append(part)
        report.append({"s": round(a, 2), "e": round(b, 2), "layout": layout, **({"switches": switches} if switches else {})})
    if not parts:
        return {"mode": "as-is"}
    lst = d / "shots.txt"
    lst.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
    vid = d / "framed_v.mp4"
    _run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(vid)], "reframe concat", 300)
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(vid), "-i", str(src), "-map", "0:v:0"]
    cmd += (["-map", "1:a:0", "-c:a", "aac", "-b:a", "192k"] if info.get("audio") else [])
    _run(cmd + ["-c:v", "copy", "-shortest", str(out)], "reframe mux", 300)
    return {"mode": mode, "shots": report}


def _clip_segments(words: list, dur: float, gap: float = 0.6):
    """A clip's pace: pauses longer than 0.6 s shortened (0.12 s / 0.18 s padding keeps the breaths), "erm/aah" fillers
    cut — Malay particles ("eh") stay. Gentler than an Edit Video's jump cut: a podcast clip must still sound natural."""
    kept = [w for w in words if not (_is_filler(w["w"]) and _wnorm(w["w"]) not in ("eh", "ehh"))]
    segs: list = []
    for w in kept:
        s, e = max(0.0, w["t"] - 0.12), min(dur, w["e"] + 0.18)
        if e <= s:
            continue
        if segs and s - segs[-1][1] <= gap:
            segs[-1][1] = max(segs[-1][1], e)
        else:
            segs.append([s, e])
    if segs and segs[0][0] < 0.4:
        segs[0][0] = 0.0
    if segs and dur - segs[-1][1] < 0.4:
        segs[-1][1] = dur
    return segs, kept


def _cold_open(src: Path, words: list, fs: float, fe: float, d: Path):
    """The clip's punchline teased first (the director's "flash" line, snapped to its words), a quick white flash,
    then the clip from its start — (video, words in the new timeline) or None when the line can't be used."""
    info = _probe(src)
    dur = info["duration"] or 0
    # the whole sentence the director pointed at (its line came from caption chunks, which cut across sentences):
    # the sentence overlapping the line most, its last ~4 s when it runs longer
    sents, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[.!?…]$", w["w"]):
            sents.append(cur)
            cur = []
    if cur:
        sents.append(cur)
    best = max(sents, key=lambda s: min(s[-1]["e"], fe) - max(s[0]["t"], fs), default=[])
    if best and min(best[-1]["e"], fe) - max(best[0]["t"], fs) > 0.3 and len(sents) > 1:
        inside = [w for w in best if w["t"] >= best[-1]["e"] - 4.0]
    else:
        inside = [w for w in words if w["t"] >= fs - 0.2 and w["e"] <= fe + 0.35]
    if len(inside) < 2 or not dur:
        return None
    fs, fe = max(0.0, inside[0]["t"] - 0.08), min(dur, inside[-1]["e"] + 0.15)
    ln = fe - fs
    if not 0.8 <= ln <= 4.5:
        return None
    out = d / "coldopen.mp4"
    fc = (f"[0:v]trim={fs:.3f}:{fe:.3f},setpts=PTS-STARTPTS,fade=t=out:st={ln - 0.1:.3f}:d=0.1:color=white[v0];"
          "[0:v]setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.15:color=white[v1];")
    if info.get("audio"):
        fc += (f"[0:a]atrim={fs:.3f}:{fe:.3f},asetpts=PTS-STARTPTS,afade=t=out:st={ln - 0.06:.3f}:d=0.06[a0];"
               "[0:a]asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.05[a1];[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]")
        maps = ["-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "192k"]
    else:
        fc += "[v0][v1]concat=n=2:v=1:a=0[v]"
        maps = ["-map", "[v]"]
    _run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-filter_complex", fc, *maps, "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "17", str(out)], "cold open", 600)
    nw = [{**w, "t": round(w["t"] - fs, 3), "e": round(w["e"] - fs, 3)} for w in inside]
    nw += [{**w, "t": round(w["t"] + ln, 3), "e": round(w["e"] + ln, 3)} for w in words]
    print(f"cold open: {ln:.1f} s teased ({' '.join(w['w'] for w in inside)[:80]})", flush=True)
    return out, nw


def _clip_prepare(p: dict, d: Path) -> dict:
    """CLIPPER render, before the Edit Video pipeline: the clip's segment, reframed, with its own word timings."""
    c = p.get("clip") or {}
    start, end = float(c.get("start") or 0), float(c.get("end") or 0)
    if not (end - start >= 3):
        raise RuntimeError("Klip terlalu pendek.")
    _progress("download", 3)
    seg = d / "segment.mp4"
    if c.get("source_type") == "youtube":
        # our B2 copy of the video when it's ready (no YouTube call), else the segment straight from YouTube
        mu = str(c.get("media_url") or "")
        got = False
        if mu.startswith("https://") and _remote_ok(mu):
            try:
                _media_segment(mu, start, end, seg)
                got = _probe(seg)["duration"] > (end - start) * 0.8
            except Exception as e:  # noqa: BLE001
                print("segment from our copy failed, asking YouTube:", str(e)[:200], flush=True)
        if not got:
            seg.write_bytes(_yt_call("segment", str(c.get("url")), {"start": start, "end": end}, p.get("yt_auth"))["data"])
    else:
        _media_segment(str(c.get("media_url") or c.get("url")), start, end, seg)
    lang = c.get("language") or p.get("language")
    # the clip's words on the GPU engine (Whisper turbo + alignment), running while the camera is planned
    asr_call = None
    try:
        a16 = d / "clip_audio.ogg"
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(seg), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "48k", str(a16)], "clip audio", 300)
        asr_call = clip_audio.spawn(None, a16.read_bytes(), lang if lang in ("ms", "en", "id") else None,
                                    str(c.get("title") or "")[:120] or None, ["asr", "align"])
    except Exception as e:  # noqa: BLE001
        print("clip audio engine not started:", str(e)[:200], flush=True)
    # who speaks when (from the analysis, clip seconds) → the camera cuts on speaker turns
    turns = [{"s": float(t["s"]), "e": float(t["e"]), "spk": str(t["spk"])} for t in (c.get("turns") or [])
             if isinstance(t, dict) and float(t.get("e", 0)) > float(t.get("s", 0))] or None
    _progress("reframe", 8)
    framed = d / "framed.mp4"
    rep = _reframe(seg, framed, d, str(c.get("frame") or "face"), turns=turns)
    src = framed if framed.exists() else seg
    _progress("transcribe", 14)
    words, aligned = None, False
    if asr_call is not None:
        res = _engine_get(asr_call, "clip words", 900)
        if res and res.get("words"):
            words = [{"w": w["w"], "t": float(w["t"]), "e": float(w["e"])} for w in res["words"] if str(w.get("w") or "").strip()]
            aligned = True
    if not words:
        words = _transcribe(src, lang if lang in ("ms", "en", "id") else None, vad=True)
    # the captions' spelling, cleaned like an Edit Video draft (one fast AI call; timing untouched)
    if p.get("captions") is not False and words:
        _progress("captions", 18)
        for fx in _caption_fixes(words, p):
            try:
                i, w = int(fx[0]), str(fx[1]).strip()
                if 0 <= i < len(words) and w and len(w) <= 40:
                    words[i]["w"] = w
            except Exception:  # noqa: BLE001
                continue
    # the cold open: the director's punchline line teased before the clip
    fl = c.get("flash") or None
    if isinstance(fl, dict) and words:
        try:
            got = _cold_open(src, words, float(fl.get("start")) - start, float(fl.get("end")) - start, d)
            if got:
                src, words = got
        except Exception as e:  # noqa: BLE001
            print("cold open skipped:", str(e)[:200], flush=True)
    info = _probe(src)
    segs = None
    if c.get("jumpcut", True) is not False and words:
        # aligned word edges are tight: a dropped "erm" / long breath shows as a gap — trim from 0.45 s
        sg, kept = _clip_segments(words, info["duration"], 0.45 if aligned else 0.6)
        if sg and info["duration"] - sum(e - s for s, e in sg) > 0.8:  # worth a cut
            words, _ = _remap_words(kept, sg)
            segs = [[round(s, 3), round(e, 3)] for s, e in sg]
    return {"_src": str(src), "_info": info, "words": words, "segs": segs, "span": info["duration"],
            "captions": p.get("captions"), "reframe": rep}


def _clip_watermark(video: Path, wm: dict, d: Path) -> None:
    """The client's @handle (or logo) burned in, top right, after the render."""
    import requests
    text = re.sub(r"[^\w@.\- ]", "", str(wm.get("text") or ""))[:40].strip()
    logo = str(wm.get("image") or "")
    if not text and not logo.startswith("https://"):
        return
    out = video.with_name("wm_" + video.name)
    if logo.startswith("https://"):
        lp = d / "wm_logo.png"
        r = requests.get(logo, timeout=30)
        if not r.ok:
            return
        lp.write_bytes(r.content)
        fc = "[1:v]scale=200:-1,format=rgba,colorchannelmixer=aa=0.85[l];[0:v][l]overlay=W-w-40:150[v]"
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-i", str(lp), "-filter_complex", fc, "-map", "[v]", "-map", "0:a?"]
    else:
        font = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"
        safe = text.replace(":", r"\:").replace("'", "")
        vf = f"drawtext=fontfile={font}:text='{safe}':fontsize=40:fontcolor=white@0.85:shadowcolor=black@0.6:shadowx=2:shadowy=2:x=w-tw-44:y=160"
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vf", vf, "-map", "0:v", "-map", "0:a?"]
    _run(cmd + ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "copy", "-movflags", "+faststart", str(out)], "watermark", 600)
    out.replace(video)


# image = upload_image's spec (that name is defined further down)
@app.function(image=web_image.apt_install("ffmpeg").pip_install("boto3==1.34.0"), secrets=SECRETS, timeout=900)
def clip_zip(items: list, key: str) -> str:
    """The client's rendered clips in one ZIP on B2 (stored, not compressed: MP4s don't shrink)."""
    import shutil
    import urllib.request
    import zipfile
    tmp = Path(tempfile.mkdtemp(prefix="zip_")) / "clips.zip"
    used = set()
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as z:
        for it in items[:40]:
            url = str(it.get("url") or "")
            if not url.startswith("https://"):
                continue
            base = re.sub(r"[^\w\- ]", "", str(it.get("name") or "klip")).strip()[:60] or "klip"
            name, n = f"{base}.mp4", 2
            while name in used:
                name, n = f"{base} ({n}).mp4", n + 1
            used.add(name)
            with urllib.request.urlopen(url, timeout=120) as r, z.open(name, "w", force_zip64=True) as f:
                shutil.copyfileobj(r, f, 1 << 20)
            stem = name[:-4]
            # the posting kit: title / caption / hashtags, and a cover frame (the hook is on screen at ~1.2 s)
            kit = it.get("kit") or {}
            if kit:
                lines = [f"Tajuk: {kit.get('title') or ''}".strip()]
                if kit.get("hook"):
                    lines.append(f"Hook: {kit['hook']}")
                if kit.get("caption"):
                    lines += ["", "Caption:", str(kit["caption"])]
                if kit.get("hashtags"):
                    lines += ["", " ".join(str(h) for h in kit["hashtags"])]
                z.writestr(f"{stem}.txt", "\n".join(lines) + "\n")
            try:
                cover = tmp.parent / f"cover_{len(used)}.jpg"
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1.2", "-i", url, "-frames:v", "1", "-q:v", "3", str(cover)],
                               capture_output=True, timeout=120)
                if cover.exists() and cover.stat().st_size > 2000:
                    z.write(cover, f"{stem}.jpg")
            except Exception as e:  # noqa: BLE001
                print("cover skipped:", str(e)[:120], flush=True)
    return _upload_b2(tmp, key, "application/zip")


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
    if not (re.fullmatch(r"motion-uploads/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(mp4|mov|webm|m4v)", key)
            or re.fullmatch(r"motion-images/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)", key)
            or re.fullmatch(r"vgc-uploads/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg|bin)", key)
            or re.fullmatch(r"clipper-uploads/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.(mp4|mov|webm|m4v)", key)):
        return False
    mac = hmac.new(want.encode(), f"{key}|{exp}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, sig)


MAX_UPLOAD = 300 * 1024 * 1024
MAX_CLIP_UPLOAD = 1024 * 1024 * 1024
MAX_IMAGE_UPLOAD = 12 * 1024 * 1024
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
        if payload.get("flow") not in ("ad", "edit", "clip-analyze", "clip"):
            return {"ok": False, "error": "unknown flow"}
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

    @web.post("/zip")
    async def zip_(payload: dict):
        if not _authorised(str(payload.get("secret") or "")):
            return JSONResponse({"ok": False, "error": "unauthorised"}, status_code=401)
        key = str(payload.get("key") or "")
        if not re.fullmatch(r"users/[A-Za-z0-9_-]+/clipper/zips/[A-Za-z0-9_-]+\.zip", key):
            return JSONResponse({"ok": False, "error": "bad key"}, status_code=400)
        try:
            url = await clip_zip.remote.aio(list(payload.get("items") or []), key)
            return {"ok": True, "url": url}
        except Exception as e:  # noqa: BLE001
            return JSONResponse({"ok": False, "error": str(e)[:300]}, status_code=500)

    @web.post("/upload")
    async def upload(request: Request, key: str = "", exp: str = "", sig: str = ""):
        import asyncio
        if not _upload_sig_ok(key, exp, sig):
            return JSONResponse({"ok": False, "error": "invalid or expired upload link"}, status_code=403)
        # motion-uploads/… = the client's video; motion-images/… = their product photos;
        # vgc-uploads/… = Custom Style (VGC) material: images, footage or a voice-over
        is_image = key.startswith("motion-images/")
        is_vgc = key.startswith("vgc-uploads/")
        is_clip = key.startswith("clipper-uploads/")  # CLIPPER: a long source video
        ctype = (request.headers.get("content-type") or ("image/jpeg" if is_image else "video/mp4")).split(";")[0].strip()
        if is_vgc:
            if not ctype.startswith(("image/", "video/", "audio/")):
                return JSONResponse({"ok": False, "error": "image, video or audio files only"}, status_code=415)
        elif not ctype.startswith("image/" if is_image else "video/"):
            return JSONResponse({"ok": False, "error": "image files only" if is_image else "video files only"}, status_code=415)
        limit = MAX_IMAGE_UPLOAD if is_image else MAX_CLIP_UPLOAD if is_clip else MAX_UPLOAD
        too_big = ("image too large (max 12MB)" if is_image else "file too large (max 300MB)" if is_vgc
                   else "video too large (max 1GB)" if is_clip else "video too large (max 300MB)")
        declared = int(request.headers.get("content-length") or 0)
        if declared > limit:
            return JSONResponse({"ok": False, "error": too_big}, status_code=413)
        with tempfile.NamedTemporaryFile(suffix=Path(key).suffix, delete=False) as f:
            tmp = Path(f.name)
            n = 0
            async for chunk in request.stream():
                n += len(chunk)
                if n > limit:
                    tmp.unlink(missing_ok=True)
                    return JSONResponse({"ok": False, "error": too_big}, status_code=413)
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
