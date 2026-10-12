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
        "faster-whisper==1.0.3", "rembg[cpu]==2.0.59", "pillow==10.4.0", "numpy<2", "scipy==1.13.1",
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
FILLER_PROMPT = "Erm, okay jadi… aah, macam ni, kan? Emm, korang tahu tak, uhh, ni produk dia."


def _transcribe(src: Path, language, vad: bool, keep_fillers: bool = False) -> list:
    segs, _info = _whisper().transcribe(_pcm16k(src), language=language or None, word_timestamps=True,
                                        beam_size=5, vad_filter=vad,
                                        initial_prompt=FILLER_PROMPT if keep_fillers else None)
    words = []
    for s in segs:
        for w in (s.words or []):
            t = w.word.strip()
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


def _loudnorm_inplace(out: Path) -> None:
    """Normalise the finished mix (voice + SFX + music) to -14 LUFS."""
    tmp = out.with_name(out.stem + "_ln.mp4")
    try:
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(out), "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", LOUDNORM,
              "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(tmp)], "loudnorm", 300)
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
    info = {}
    if p and p.get("guard") and raws:
        # The client's own product photo is never dropped — only taped.
        try:
            st = _guard_images([r for _k, _im, r in raws], p, "product", max_lines=99, max_area=1.0)
            info = {"taped": sum(1 for v in st.values() if v == "taped")}
        except Exception as e:  # noqa: BLE001
            print("guard product images failed:", str(e)[:200])
            info = {"error": str(e)[:160]}
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
    want = 2 if guard else 1

    clips = {}  # poster path → clip path (video cutaways)

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
            except Exception as e:  # noqa: BLE001
                print("broll candidate failed", k, ci, str(e)[:120])
            if len(got) >= (1 if is_video else want):
                break
        return k, b, got

    with ThreadPoolExecutor(8) as ex:
        picks = list(ex.map(moment, list(enumerate(items[:16]))))
    info = {}
    if guard:
        allp = [x for _k, _b, got in picks for x in got]
        st = {}
        if allp:
            try:
                st = _guard_images(allp, p, "broll")
            except Exception as e:  # noqa: BLE001
                print("guard broll failed — dropping unchecked images:", str(e)[:200])
                st = {str(x): "drop" for x in allp}
        picks = [(k, b, [x for x in got if st.get(str(x)) != "drop"]) for k, b, got in picks]
        used = [st.get(str(got[0])) for _k, _b, got in picks if got]
        info = {"taped": used.count("taped"), "dropped": sum(1 for v in st.values() if v == "drop")}
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


def _fetch_gifs(overlays: list, d: Path, srv: _Serve) -> int:
    """Animated sticker overlays (src = remote GIF/WebP) → local files. A
    sticker that can't be fetched becomes its fallback animated emoji."""
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
            o["src"] = srv.url(f)
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
    out["censor"] |= _guard_classify({}, "speech", [], words)["censor"]
    out["censor"] -= out["cut"]
    return out


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


def _guard_images(paths: list, p: dict, kind: str, max_lines: int = 12, max_area: float = 0.25) -> dict:
    """OCR + classify + tape images in place → {path: clean | taped | drop}.
    Images with too much risky text (a claims poster) are dropped instead."""
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
        with Image.open(x) as im:
            area_img = float(im.width * im.height) or 1.0
        area = sum(_quad(ln["q"])["w"] * _quad(ln["q"])["h"] * 1.7 for ln in lines) / area_img
        if len(lines) > max_lines or area > max_area:
            status[str(x)] = "drop"
            continue
        _bake_tape(Path(x), [ln["q"] for ln in lines])
        status[str(x)] = "taped"
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
    _run(["node", f"{MOTION_DIR}/scripts/stills.mjs", f"{MOTION_DIR}/build", "MotionEdit", str(pp), str(sd), ",".join(map(str, frames)), "0.45"],
         "qa stills", 400)
    shots = []
    for fr in frames:
        f = sd / f"still_{fr}.jpg"
        if f.exists():
            t = fr / fps
            act = [x[4] + f"#{x[2]}{x[3]}" for x in spans if x[0] <= t < x[1]]
            shots.append({"frame": fr, "t": round(t, 2), "active": act,
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
    return props, {"qa": "applied", "drop": len(drop), "moved": len(patch.get("move") or []), "broll_drop": len(bdrop),
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
    rinfo = _render_parallel("MotionAd", props, d, out, _scale_for(p), 42, 95)
    return {"out": out, "duration": total, "poster_at": min(2.0, total / 3),
            "debug": {"lines": len(lines_out), "images": len(images), "render": rinfo,
                      **({"guard": guard_info} if p.get("guard") else {})}}


# ── Flow B: Edit Video ────────────────────────────────────────────────────────
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
    # Voice clean-up: rumble cut, FFT denoise, gentle compression, peak limit
    # (the final mix is loudness-normalised to -14 LUFS after the render).
    voice = "highpass=f=75,afftdn=nr=10:nf=-32,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=160:makeup=1.6,alimiter=limit=0.95"
    if segs and info["audio"]:
        expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in segs)
        fc += f";[0:a]aselect='{expr}',asetpts=N/SR/TB,{voice}[aout]"
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
    import requests
    max_sec = float(p.get("max_sec") or 180)
    style = p.get("style") or "gempak"
    _progress("download", 3)
    src = _download(p["video_url"], d / "src_video")
    info = _probe(src)
    if info["duration"] <= 0.5:
        raise RuntimeError("video has no duration (unreadable file?)")
    span = min(info["duration"], max_sec)
    lang = p.get("language") or "ms"
    jump = bool(p.get("jumpcut", True))

    _progress("transcribe", 8)
    raw_words = _transcribe(src, None if lang == "auto" else lang, vad=True, keep_fillers=jump) if info["audio"] else []
    raw_words = [w for w in raw_words if w["t"] < span]

    for i, w in enumerate(raw_words):
        w["ri"] = i
    guard = bool(p.get("guard"))
    gspeech = {"cut": set(), "censor": set(), "risk": None}
    if guard and raw_words:
        _progress("guard", 12)
        gspeech = _guard_speech(raw_words, p)
        if len(gspeech["cut"]) > 0.4 * len(raw_words):
            # mostly claims — cutting would gut the video: mute them instead
            gspeech["censor"] |= gspeech["cut"]
            gspeech["cut"], gspeech["cut_skipped"] = set(), True
    claims = gspeech["cut"]

    words, segs, cut = raw_words, None, {}
    if (jump or claims) and raw_words:
        sg, kept = _keep_segments(raw_words, span, drop=claims) if jump else _claim_segments(raw_words, span, claims)
        kept_len = sum(e - s for s, e in sg)
        if sg and 0.5 * span <= kept_len < span - 0.3:
            segs = sg
            words, _ = _remap_words(kept, sg)
            cut = {"removed_sec": round(span - kept_len, 2), "segments": len(sg)}
        elif claims:
            gspeech["censor"] |= claims  # couldn't cut → mute
            claims = set()
    if not jump:
        words = [w for w in words if not _is_filler(w["w"])] or words

    _progress("normalise", 16)
    try:
        vid = _normalise(src, d / "video.mp4", info, max_sec, segs)
    except Exception as e:  # noqa: BLE001
        print("cut/normalise failed, retrying without cuts:", str(e)[:300])
        segs, words, cut = None, raw_words, {"error": "jumpcut skipped"}
        gspeech["censor"] |= claims  # claims weren't cut → mute them
        claims = set()
        vid = _normalise(src, d / "video.mp4", info, max_sec, None)
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

    _progress("faces", 24)
    try:
        faces = _faces(vid)
    except Exception as e:  # noqa: BLE001
        print("face track failed:", str(e)[:200])
        faces = []

    _progress("plan", 30)
    plan, plan_fallback = None, False
    try:
        r = requests.post(p["plan_url"], json={"history_id": p["history_id"], "token": p["plan_token"], "duration": dur,
                                               "words": [{"i": i, **w} for i, w in enumerate(words)],
                                               "has_face": bool(faces)}, timeout=290)
        j = r.json()
        if r.ok and j.get("ok") and isinstance(j.get("plan"), dict):
            plan = j["plan"]
        else:
            print("plan rejected:", str(j)[:400])
    except Exception as e:  # noqa: BLE001
        print("plan call failed:", e)
    if not plan:
        plan, plan_fallback = _fallback_plan(), True

    # AI-corrected spelling for the captions (timing untouched, 1:1 by index)
    fixed = 0
    for fx in plan.get("fixes") or []:
        try:
            i, w = int(fx[0]), str(fx[1]).strip()
            if 0 <= i < len(words) and w and len(w) <= 40:
                words[i]["w"] = w
                fixed += 1
        except Exception:  # noqa: BLE001
            continue

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
    lottie = _fetch_lottie(chars, d, srv)

    props = {
        "fps": 30, "durationInFrames": int(math.floor(dur * 30)), "video": srv.url(vid), "words": words,
        "captions": plan.get("captions") or _fallback_plan()["captions"], "accent": plan.get("accent") or "#FFD93B",
        "overlays": plan.get("overlays") or [], "zooms": plan.get("zooms") or [], "hook": plan.get("hook"),
        "sfx": bool(p.get("sfx", True)), "style": style, "faces": faces, "broll": broll,
        "facts": plan.get("facts") or [], "keywords": plan.get("keywords") or [], "rehook": plan.get("rehook"),
        "cta": plan.get("cta"), "lottie": lottie, "progress": style == "gempak",
        "cuts": cut_marks,
    }
    guard_dbg = None
    if guard:
        _progress("guard", 44)
        if gthread:
            gthread.join(timeout=300)
        # mute risky spoken words: speech pass (raw indices → post-cut) ∪ /plan rules
        pos = {w.get("ri"): k for k, w in enumerate(words) if "ri" in w}
        censor = sorted({pos[ri] for ri in gspeech["censor"] if ri in pos}
                        | {int(i) for i in (plan.get("censor") or []) if str(i).isdigit() and int(i) < len(words)})
        if censor:
            try:
                props["video"] = srv.url(_mute_words(vid, words, censor, d / "video_guard.mp4"))
                props["censor"] = censor
            except Exception as e:  # noqa: BLE001
                print("guard mute failed:", e)
        props["tapes"] = gres.get("tracks") or []
        guard_dbg = {"tapes": len(props["tapes"]), "muted_words": len(props.get("censor") or []),
                     "muted": [words[i]["w"] for i in (props.get("censor") or [])][:30],
                     "cut_words": len(claims), "cut": " ".join(w["w"] for w in raw_words if w["ri"] in claims)[:400],
                     "risk": gspeech.get("risk"), "speech_via": gspeech.get("via"),
                     **({"cut_skipped": True} if gspeech.get("cut_skipped") else {}),
                     "risky_texts": gres.get("risky_texts") or [], "texts": gres.get("texts"), "via": gres.get("via"),
                     "sec": gres.get("sec"), "broll": broll_guard, **({"error": gres["error"]} if gres.get("error") else {})}
    if p.get("music") and words:
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
        job = {"totalSec": dur, "seed": int(time.time()) % 100000, "mood": mood,
               "speech": spans, "marks": {}, "bedOut": str(d / "bed.wav")}
        (d / "music.json").write_text(json.dumps(job), encoding="utf-8")
        _run(["node", f"{MOTION_DIR}/scripts/music.mjs", str(d / "music.json")], "music", 600)
        props["music"] = srv.url(d / "bed.wav")
        props["musicVolume"] = 0.28

    qa = {"qa": "off"}
    if p.get("qa_url") and not plan_fallback:
        _progress("qa", 46)
        try:
            props, qa = _qa(props, d, p)
        except Exception as e:  # noqa: BLE001
            qa = {"qa": f"error {str(e)[:160]}"}
            print("qa failed:", e)

    out = d / "out.mp4"
    _progress("render", 50)
    rinfo = _render_parallel("MotionEdit", props, d, out, _scale_for(p), 50, 92)

    # Second QA on the FINISHED video (guideline mode): OCR the output; any
    # claim text that still shows (a box the tracker lost, a sticker) gets a
    # screen-space tape patch and the video is rendered once more.
    final_qa = None
    if guard:
        _progress("qa", 92)
        try:
            final_qa = _final_check(d, out, dur, p, props)
            if final_qa.get("patched"):
                _progress("render", 93)
                rinfo = _render_parallel("MotionEdit", props, d, out, _scale_for(p), 93, 95)
        except Exception as e:  # noqa: BLE001
            final_qa = {"error": str(e)[:200]}
            print("final check failed:", e)
    if guard_dbg is not None:
        guard_dbg["final_qa"] = final_qa
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
    keys, texts = {}, []
    for x in dets:
        k = _tkey(x["x"])
        if len(k) >= 3 and x["s"] >= 0.5 and k not in keys:
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


# ── job + endpoints ───────────────────────────────────────────────────────────
@app.function(image=render_image, cpu=8.0, memory=16384, timeout=2400, secrets=SECRETS, volumes={JOBS_ROOT: JOBS})
def run_job(payload: dict) -> dict:
    import shutil
    t0 = time.time()
    flow = payload.get("flow")
    uid = str(payload.get("user_id") or "anon")
    hid = str(payload.get("history_id") or f"job{int(t0)}")
    d = Path(JOBS_ROOT) / f"{re.sub(r'[^A-Za-z0-9_-]', '', hid)[:60]}-{int(t0)}"
    d.mkdir(parents=True, exist_ok=True)
    srv = _Serve(d)
    try:
        res = _flow_ad(payload, d, srv) if flow == "ad" else _flow_edit(payload, d, srv)
        _progress("upload", 96)
        url = _upload_b2(res["out"], f"users/{uid}/motion/{hid}.mp4", "video/mp4")
        poster_url = None
        try:
            ptmp = Path(tempfile.gettempdir()) / f"{hid}_poster.jpg"
            poster_url = _upload_b2(_poster(res["out"], res["poster_at"], ptmp), f"users/{uid}/motion/{hid}.jpg", "image/jpeg")
        except Exception as e:  # noqa: BLE001
            print("poster failed", e)
        _progress("done", 100)
        return {"ok": True, "url": url, "poster_url": poster_url, "duration_sec": round(float(res["duration"]), 2),
                "render_sec": round(time.time() - t0, 1), **res.get("debug", {})}
    except Exception as e:  # noqa: BLE001
        _progress("failed", 100)
        return {"ok": False, "error": str(e)[:900]}
    finally:
        srv.close()
        try:
            shutil.rmtree(d, ignore_errors=True)
            JOBS.commit()
        except Exception:  # noqa: BLE001
            pass



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
