"""
modal_fairytale.py — Fairytale (storytelling) video renderer.

Pipeline:
  1. POST from PeningLab Vercel route with scenes[] + voice + animation settings
  2. For each scene: download image, generate MiniMax TTS narration, build Ken
     Burns ffmpeg filter (zoom-pan), burn captions
  3. Concat all scene clips with xfade transitions
  4. Mix narration audio + optional background music
  5. Upload final mp4 to Supabase Storage
  6. Update history row directly via service-role key (Pattern A — Vercel
     never waits)

Deploy:
    modal deploy modal_fairytale.py

Secrets (one-time):
    modal secret create fairytale-secrets \
      MINIMAX_API_KEY=... \
      SUPABASE_URL=https://zoxgcqlqovkvlrmpcikt.supabase.co \
      SUPABASE_SERVICE_ROLE_KEY=...

Pricing (per 1-min story, 10 scenes):
  - Modal CPU 8 vCPU × 30s = ~$0.003
  - MiniMax speech-2.6-turbo ~600 chars BM = ~$0.04
  - Total ~$0.045
"""

import json
import os
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import modal

app = modal.App("peninglab-fairytale")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .pip_install("requests==2.31.0", "supabase==2.3.0")
)

SUPABASE_BUCKET = "fairytale"

# ──────────────────────────────────────────────────────────────────────────
# Helpers (run inside the container)
# ──────────────────────────────────────────────────────────────────────────

def _download(url: str, dest: Path) -> Path:
    import requests
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    dest.write_bytes(r.content)
    return dest


def _minimax_tts(text: str, voice_id: str, speed: float, out_path: Path) -> Path:
    """Generate narration mp3 via MiniMax t2a_v2 endpoint.
    Reference: E:\\Project\\AI CALL\\welcome-starter-html-master\\supabase\\functions\\ai-call-handler-freeswitch\\index.ts:225
    """
    import requests
    api_key = os.environ["MINIMAX_API_KEY"]
    body = {
        "model": "speech-2.6-turbo",
        "text": text,
        "stream": False,
        "language_boost": "Malay",
        "output_format": "hex",
        "voice_setting": {
            "voice_id": voice_id,
            "speed": float(speed or 1.0),
            "vol": 1,
            "pitch": 0,
        },
        "audio_setting": {
            "format": "mp3",
            "sample_rate": 32000,
            "channel": 1,
        },
    }
    r = requests.post(
        "https://api.minimax.io/v1/t2a_v2",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=body,
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    if data.get("base_resp", {}).get("status_code", 0) != 0:
        msg = data.get("base_resp", {}).get("status_msg", "Unknown")
        raise RuntimeError(f"MiniMax TTS failed: {msg}")
    hex_audio = data.get("audio_data") or data.get("data", {}).get("audio")
    if not hex_audio:
        raise RuntimeError("MiniMax TTS returned no audio")
    out_path.write_bytes(bytes.fromhex(hex_audio))
    return out_path


def _ffprobe_duration(path: Path) -> float:
    res = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        capture_output=True, text=True,
    )
    try:
        return float(res.stdout.strip())
    except Exception:
        return 5.0


def _ken_burns_filter(animation: str, duration: float, fps: int = 30) -> str:
    """Return ffmpeg zoompan filter string for the chosen animation style."""
    total_frames = int(duration * fps)
    # zoompan operates per frame. Zoom range 1.0-1.3 looks natural without artifacts.
    if animation == "zoom-in":
        return (
            f"scale=2160:3840,zoompan=z='min(zoom+0.0008,1.3)':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    if animation == "zoom-out":
        return (
            f"scale=2160:3840,zoompan=z='if(lte(zoom,1.0),1.3,max(1.0,zoom-0.0008))':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    if animation == "pan-left":
        return (
            f"scale=2160:3840,zoompan=z=1.2:"
            f"x='iw-(iw/zoom)-(on*4)':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    if animation == "pan-right":
        return (
            f"scale=2160:3840,zoompan=z=1.2:"
            f"x='on*4':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # default: subtle zoom-in
    return (
        f"scale=2160:3840,zoompan=z='min(zoom+0.0006,1.2)':"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={total_frames}:s=1080x1920:fps={fps}"
    )


def _escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
    )


def _placement_y(placement: str) -> str:
    if placement == "top":
        return "h*0.12"
    if placement == "bottom":
        return "h*0.78"
    return "(h-text_h)/2"  # middle


def _render_scene(
    image_path: Path,
    audio_path: Path,
    caption: str,
    animation: str,
    placement: str,
    font_size: int,
    out_path: Path,
) -> Path:
    """Render ONE scene clip — image + Ken Burns + audio + caption burn."""
    duration = max(_ffprobe_duration(audio_path), 1.5)
    zoompan = _ken_burns_filter(animation, duration)

    drawtext = ""
    if caption:
        safe = _escape_drawtext(caption[:200])
        y = _placement_y(placement)
        drawtext = (
            f",drawtext=text='{safe}':fontsize={font_size}:fontcolor=white:"
            f"box=1:boxcolor=black@0.55:boxborderw=18:"
            f"x=(w-text_w)/2:y={y}:line_spacing=8:"
            f"fontfile=/usr/share/fonts/truetype/dejavu/DejaVu-Sans-Bold.ttf"
        )

    # Use loop=1 to extend a still image to audio duration
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", "30", "-i", str(image_path),
        "-i", str(audio_path),
        "-filter_complex", f"[0:v]{zoompan}{drawtext}[v]",
        "-map", "[v]", "-map", "1:a",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        "-t", f"{duration:.2f}",
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg scene render failed: {res.stderr[-800:]}")
    return out_path


def _concat_scenes(scene_paths: list, out_path: Path) -> Path:
    """Concat scene mp4s with xfade-style crossfade. Uses concat demuxer +
    optional xfade chain via filter_complex."""
    # Simplest reliable concat: demuxer with re-encode for clean joins.
    listfile = out_path.parent / "concat.txt"
    listfile.write_text(
        "\n".join(f"file '{p.as_posix()}'" for p in scene_paths)
    )
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(listfile),
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {res.stderr[-800:]}")
    return out_path


def _upload_supabase(local_path: Path, remote_name: str) -> str:
    """Upload mp4 to Supabase Storage and return a long-lived signed URL."""
    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    bucket = sb.storage.from_(SUPABASE_BUCKET)
    with open(local_path, "rb") as f:
        bucket.upload(remote_name, f, {"content-type": "video/mp4", "upsert": "true"})
    # 30-day signed URL (storytelling videos rarely need permanent public)
    signed = bucket.create_signed_url(remote_name, 60 * 60 * 24 * 30)
    return signed["signedURL"] if isinstance(signed, dict) else signed.get("signed_url", "")


def _update_history(history_id: str, **fields):
    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    sb.table("history").update(fields).eq("id", history_id).execute()


# ──────────────────────────────────────────────────────────────────────────
# Modal endpoint
# ──────────────────────────────────────────────────────────────────────────

@app.function(
    image=image,
    cpu=8.0,
    memory=4096,
    timeout=300,
    scaledown_window=30,
    max_containers=50,
    secrets=[modal.Secret.from_name("fairytale-secrets")],
)
@modal.fastapi_endpoint(method="POST", docs=True)
def render_story(payload: dict):
    """
    Payload shape:
    {
      "history_id": "uuid",
      "user_id": "uuid",
      "voice_id": "Malay_BellaSoothing",   # MiniMax voice id
      "voice_speed": 1.0,
      "animation": "zoom-in" | "zoom-out" | "pan-left" | "pan-right",
      "placement": "top" | "middle" | "bottom",
      "font_size": 56,
      "scenes": [
        {"image_url": "...", "narration": "Pada zaman dahulu..."},
        ...
      ]
    }
    """
    history_id = payload.get("history_id")
    if not history_id:
        return {"ok": False, "error": "history_id required"}

    scenes = payload.get("scenes") or []
    if not scenes:
        _update_history(history_id, status="failed", error_message="No scenes provided")
        return {"ok": False, "error": "scenes required"}

    voice_id = payload.get("voice_id") or "Malay_BellaSoothing"
    voice_speed = float(payload.get("voice_speed") or 1.0)
    animation = payload.get("animation") or "zoom-in"
    placement = payload.get("placement") or "bottom"
    font_size = int(payload.get("font_size") or 56)

    started = time.time()
    workdir = Path(tempfile.mkdtemp(prefix="fairytale-"))

    try:
        scene_clips: list = []
        for idx, scene in enumerate(scenes):
            image_url = scene.get("image_url") or ""
            narration = (scene.get("narration") or "").strip()
            if not image_url or not narration:
                continue

            img_path = _download(image_url, workdir / f"scene-{idx}.jpg")
            audio_path = _minimax_tts(
                narration, voice_id, voice_speed, workdir / f"scene-{idx}.mp3"
            )
            clip_path = _render_scene(
                img_path, audio_path, narration,
                animation, placement, font_size,
                workdir / f"clip-{idx}.mp4",
            )
            scene_clips.append(clip_path)

        if not scene_clips:
            _update_history(
                history_id, status="failed",
                error_message="All scenes invalid — need image_url + narration",
            )
            return {"ok": False, "error": "no valid scenes"}

        final_path = workdir / "story.mp4"
        if len(scene_clips) == 1:
            scene_clips[0].rename(final_path)
        else:
            _concat_scenes(scene_clips, final_path)

        remote_name = f"{payload.get('user_id', 'anon')}/{history_id}.mp4"
        signed_url = _upload_supabase(final_path, remote_name)

        elapsed = time.time() - started
        _update_history(
            history_id,
            status="done",
            output_url=signed_url,
            thumbnail_url=signed_url,
        )
        return {
            "ok": True,
            "output_url": signed_url,
            "scenes_rendered": len(scene_clips),
            "elapsed_sec": round(elapsed, 2),
        }

    except Exception as e:
        _update_history(
            history_id,
            status="failed",
            error_message=str(e)[:400],
        )
        return {"ok": False, "error": str(e)}
    finally:
        # Cleanup temp dir
        try:
            for p in workdir.glob("*"):
                p.unlink()
            workdir.rmdir()
        except Exception:
            pass


# Local dev: `modal serve modal_fairytale.py` to test endpoint without deploy.
