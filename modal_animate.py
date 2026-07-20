"""
modal_animate.py — Editor "Frame → Animate" renderer.

Takes a still COVER image + the ORIGINAL video, applies a Ken Burns camera move
(zoom/pan) to the cover to make a short animated intro clip, then concatenates
it in FRONT of the video and uploads ONE merged MP4 to Backblaze B2.

Everything is normalized to 1080x1920 (9:16) so the merged output is ALWAYS
9:16 — the cover intro and the video are both scaled+padded to the same frame,
so a landscape or odd-size source can never mangle the result.

Synchronous web endpoint: POST → does the work → returns { ok, url }.
The PeningLab Frame route stamps `url` onto the framed history row and charges
the fixed RM0.10 (Animate) itself, only on success.

Deploy:
    modal deploy modal_animate.py

Secrets (reused from the fairytale app — no new secrets needed):
    fairytale-secrets     — B2_ENDPOINT / B2_REGION (+ others, unused here)
    b2-content-secrets    — B2_CONTENT_KEY_ID / B2_CONTENT_APP_KEY / bucket
"""

import os
import subprocess
import tempfile
from pathlib import Path

import modal

app = modal.App("peninglab-animate")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("requests==2.31.0", "boto3==1.34.0", "fastapi[standard]==0.115.0")
)

# ── B2 (peninglab-content) — same convention as lib/b2.ts / modal_fairytale ──

def _b2_content_config():
    missing = [k for k in ("B2_CONTENT_KEY_ID", "B2_CONTENT_APP_KEY") if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f"Animate upload misconfigured: missing Modal Secrets {missing}")
    endpoint = os.environ.get("B2_CONTENT_ENDPOINT") or os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_CONTENT_REGION") or os.environ.get("B2_REGION", "us-east-005")
    access_key = os.environ["B2_CONTENT_KEY_ID"]
    secret_key = os.environ["B2_CONTENT_APP_KEY"]
    bucket = os.environ.get("B2_CONTENT_BUCKET", "peninglab-content")
    return endpoint, region, access_key, secret_key, bucket


def _b2_public_url(b2_key: str) -> str:
    from urllib.parse import urlparse, quote
    endpoint, _r, _a, _s, bucket = _b2_content_config()
    host = urlparse(endpoint).netloc
    key = "/".join(quote(p, safe="") for p in b2_key.split("/"))
    return f"https://{bucket}.{host}/{key}"


def _upload_b2(local_path: Path, b2_key: str, content_type: str = "video/mp4") -> None:
    size = local_path.stat().st_size if local_path.exists() else 0
    if size < 1024:
        raise RuntimeError(f"Upload skipped: {local_path} is {size} bytes — ffmpeg produced no/corrupt output")
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
    cfg = TransferConfig(multipart_threshold=5 * 1024 * 1024, multipart_chunksize=5 * 1024 * 1024, max_concurrency=4)
    s3.upload_file(
        str(local_path), bucket, b2_key,
        ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=2592000, immutable"},
        Config=cfg,
    )


# ── ffmpeg helpers ──────────────────────────────────────────────────────────

def _download(url: str, dest: Path) -> Path:
    import requests
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    dest.write_bytes(r.content)
    return dest


def _has_audio(path: Path) -> bool:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    return bool(r.stdout.strip())


# Ken Burns zoompan → always outputs 1080x1920 (9:16). Ported from
# modal_fairytale._ken_burns_filter (the 4 motions the Editor exposes + a safe
# default). fps kept modest (30) since a 1–5s intro doesn't need 120.
def _ken_burns(animation: str, duration: float, fps: int = 30) -> str:
    n = max(1, int(duration * fps))
    base = "scale=2160:3840,zoompan="
    tail = f":d={n}:s=1080x1920:fps={fps}"
    if animation == "zoom-in":
        return base + f"z='1.0+0.18*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'" + tail
    if animation == "zoom-out":
        return base + f"z='1.18-0.18*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'" + tail
    if animation == "pan-right":
        return base + f"z=1.15:x='(iw-iw/zoom)*on/{n}':y='ih/2-(ih/zoom/2)'" + tail
    if animation == "pan-left":
        return base + f"z=1.15:x='(iw-iw/zoom)*(1-on/{n})':y='ih/2-(ih/zoom/2)'" + tail
    if animation == "pan-down":
        return base + f"z=1.15:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*on/{n}'" + tail
    if animation == "pan-up":
        return base + f"z=1.15:x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/{n})'" + tail
    # default: gentle zoom-in
    return base + f"z='1.0+0.18*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'" + tail


# Uniform normalize: any clip → 1080x1920, 30fps, yuv420p, AAC stereo 44.1k.
# A clip with no audio gets a silent track so concat has a matching stream on
# every input (concat demuxer needs identical params).
_VF_916 = ("scale=1080:1920:force_original_aspect_ratio=decrease,"
           "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30")


def _normalize(src: Path, out: Path) -> Path:
    has_a = _has_audio(src)
    cmd = ["ffmpeg", "-y"]
    cmd += ["-i", str(src)]
    if not has_a:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]
    cmd += ["-map_metadata", "-1", "-filter_complex", f"[0:v]{_VF_916}[v]", "-map", "[v]"]
    cmd += ["-map", "0:a" if has_a else "1:a"]
    cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2"]
    if not has_a:
        cmd += ["-shortest"]
    cmd += [str(out)]
    r = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"normalize failed (rc={r.returncode}): {r.stderr[-1500:]}")
    return out


def _render_intro(cover: Path, animation: str, duration: float, out: Path) -> Path:
    """Ken Burns the cover → a `duration`s 1080x1920 clip with a silent track."""
    zoom = _ken_burns(animation, duration)
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", "30", "-i", str(cover),
        "-f", "lavfi", "-t", f"{duration:.2f}", "-i", "anullsrc=r=44100:cl=stereo",
        "-map_metadata", "-1",
        "-filter_complex", f"[0:v]{zoom}[v]",
        "-map", "[v]", "-map", "1:a",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
        "-t", f"{duration:.2f}", str(out),
    ]
    r = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"intro render failed (rc={r.returncode}): {r.stderr[-1500:]}")
    return out


def _concat_to_b2(clips: list[Path], user_id: str, history_id: str, workdir: Path) -> str:
    """Concat already-normalized clips (identical params) → upload → public URL."""
    listf = workdir / "list.txt"
    listf.write_text("".join(f"file '{c}'\n" for c in clips))
    out = workdir / "out.mp4"
    r = subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listf),
         "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", str(out)],
        capture_output=True, text=True, errors="replace",
    )
    if r.returncode != 0:
        raise RuntimeError(f"concat failed (rc={r.returncode}): {r.stderr[-800:]}")
    b2_key = f"users/{user_id}/ugc/{history_id}.mp4"
    _upload_b2(out, b2_key, "video/mp4")
    return _b2_public_url(b2_key)


@app.function(
    image=image,
    timeout=300,
    secrets=[
        modal.Secret.from_name("fairytale-secrets"),
        modal.Secret.from_name("b2-content-secrets"),
    ],
)
@modal.fastapi_endpoint(method="POST")
def merge_intro(payload: dict):
    """POST { intro_url, video_url, user_id, history_id }
    → normalize BOTH videos to 1080x1920 (9:16) and concat [intro, video],
    upload one merged MP4. Used by the Editor's Frame → Grok mode, where the
    intro is an already-rendered Grok i2v clip. Returns { ok, url }.
    """
    intro_url = str(payload.get("intro_url") or "").strip()
    video_url = str(payload.get("video_url") or "").strip()
    user_id = str(payload.get("user_id") or "").strip()
    history_id = str(payload.get("history_id") or "").strip()
    if not (intro_url and video_url and user_id and history_id):
        return {"ok": False, "error": "intro_url, video_url, user_id, history_id required"}
    try:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            intro = _download(intro_url, d / "intro.mp4")
            video = _download(video_url, d / "video.mp4")
            intro_n = _normalize(intro, d / "intro_n.mp4")
            video_n = _normalize(video, d / "video_n.mp4")
            url = _concat_to_b2([intro_n, video_n], user_id, history_id, d)
            return {"ok": True, "url": url}
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}


@app.function(
    image=image,
    timeout=300,
    secrets=[
        modal.Secret.from_name("fairytale-secrets"),
        modal.Secret.from_name("b2-content-secrets"),
    ],
)
@modal.fastapi_endpoint(method="POST")
def animate_and_merge(payload: dict):
    """POST { cover_url, video_url, animation, duration_sec, user_id, history_id }
    → Ken Burns the cover, concat in front of the video, upload merged 9:16 MP4.
    Returns { ok, url } | { ok:false, error }.
    """
    cover_url = str(payload.get("cover_url") or "").strip()
    video_url = str(payload.get("video_url") or "").strip()
    user_id = str(payload.get("user_id") or "").strip()
    history_id = str(payload.get("history_id") or "").strip()
    animation = str(payload.get("animation") or "zoom-in").strip()
    try:
        duration = float(payload.get("duration_sec") or 1.0)
    except Exception:
        duration = 1.0
    duration = max(1.0, min(5.0, duration))  # 1–5s

    if not (cover_url and video_url and user_id and history_id):
        return {"ok": False, "error": "cover_url, video_url, user_id, history_id required"}

    try:
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            cover = _download(cover_url, d / "cover.png")
            video = _download(video_url, d / "video.mp4")

            intro = _render_intro(cover, animation, duration, d / "intro.mp4")
            video_n = _normalize(video, d / "video_n.mp4")

            # concat demuxer — both clips now share identical params (1080x1920,
            # 30fps, yuv420p, aac stereo 44.1k), so this is a clean join.
            listf = d / "list.txt"
            listf.write_text(f"file '{intro}'\nfile '{video_n}'\n")
            out = d / "out.mp4"
            r = subprocess.run(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listf),
                 "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
                 "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2", str(out)],
                capture_output=True, text=True, errors="replace",
            )
            if r.returncode != 0:
                return {"ok": False, "error": f"concat failed (rc={r.returncode}): {r.stderr[-800:]}"}

            b2_key = f"users/{user_id}/ugc/{history_id}.mp4"
            _upload_b2(out, b2_key, "video/mp4")
            return {"ok": True, "url": _b2_public_url(b2_key)}
    except Exception as e:
        return {"ok": False, "error": str(e)[:400]}
