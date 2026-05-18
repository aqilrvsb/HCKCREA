"""
modal_fairytale.py — Fairytale (storytelling) video renderer.

Pipeline:
  1. POST from PeningLab Vercel route with scenes[] + voice + animation settings
  2. For each scene: download image, generate MiniMax TTS narration, build Ken
     Burns ffmpeg filter (zoom-pan), burn captions
  3. Concat all scene clips with xfade transitions
  4. Mix narration audio + optional background music
  5. Upload final mp4 directly to Backblaze B2 at the user's permanent
     storage path (users/{user_id}/fairytale/{history_id}.mp4) — same
     bucket the Storage tab uses, no Supabase Storage involved
  6. Update history row directly via service-role key (Pattern A — Vercel
     never waits)

Deploy:
    modal deploy modal_fairytale.py

Secrets (one-time):
    modal secret create fairytale-secrets \
      MINIMAX_API_KEY=... \
      SUPABASE_URL=https://zoxgcqlqovkvlrmpcikt.supabase.co \
      SUPABASE_SERVICE_ROLE_KEY=... \
      B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com \
      B2_REGION=us-east-005 \
      B2_KEY_ID=... \
      B2_APP_KEY=... \
      B2_BUCKET_PRIVATE=peninglab-storage

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
    .apt_install(
        "ffmpeg",
        "fonts-dejavu-core",       # bold display fallback
        "fonts-liberation",         # liberation sans/serif/mono
        "fonts-noto-core",          # multilingual incl. accented chars
        "fonts-roboto",             # modern sans
    )
    # supabase 2.3.0 + newer httpx breaks with `Client.__init__() got unexpected
    # keyword argument 'proxy'`. Pin the working trio.
    .pip_install(
        "requests==2.31.0",
        "supabase==2.10.0",
        "httpx==0.27.2",
        "fastapi[standard]==0.115.0",
        # boto3 for multipart upload to B2 — single-shot requests.put
        # truncates with IncompleteBody for files > ~50MB on Modal's
        # container network. Multipart splits the file into 5MB parts
        # and uploads each separately, so a transient network hiccup
        # only affects one part (which retries independently).
        "boto3==1.34.0",
    )
)

# Font catalog — maps UI value → installed .ttf path. Keep in sync with
# fairytale.tsx FONT_FAMILIES list.
FONT_PATHS: dict = {
    "bold-display":  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "sans":          "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "sans-bold":     "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "serif":         "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "mono":          "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf",
    "roboto":        "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Bold.ttf",
}

def _font_path(family: str) -> str:
    return FONT_PATHS.get(family, FONT_PATHS["bold-display"])

# Permanent media path on Backblaze B2 — same convention as lib/b2.ts
# `buildKey()` so the file ends up where the Storage tab expects it.
def _b2_key_for(user_id: str, history_id: str) -> str:
    return f"users/{user_id}/fairytale/{history_id}.mp4"

# ──────────────────────────────────────────────────────────────────────────
# Helpers (run inside the container)
# ──────────────────────────────────────────────────────────────────────────

def _download(url: str, dest: Path) -> Path:
    import requests
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    dest.write_bytes(r.content)
    return dest


def _minimax_tts(text: str, voice_id: str, out_path: Path, language: str = "ms") -> Path:
    """Generate narration mp3 via MiniMax t2a_v2 at natural (1.0x) speed.
    Speed is applied later via ffmpeg atempo so the cached MP3 is reusable
    across speed changes (and the live preview can re-time without paying
    for another TTS call).
    `language` selects the MiniMax language_boost (ms → "Malay", en → "English").
    Reference: E:\\Project\\AI CALL\\welcome-starter-html-master\\supabase\\functions\\ai-call-handler-freeswitch\\index.ts:225
    """
    import requests
    api_key = os.environ["MINIMAX_API_KEY"]
    body = {
        "model": "speech-2.6-turbo",
        "text": text,
        "stream": False,
        "language_boost": "English" if language == "en" else "Malay",
        "output_format": "hex",
        "voice_setting": {
            "voice_id": voice_id,
            "speed": 1.0,
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


def _apply_audio_speed(in_path: Path, speed: float, out_path: Path) -> Path:
    """Speed up / slow down audio without pitch shift via ffmpeg atempo.
    atempo accepts 0.5–2.0 in one stage; we chain stages for wider ranges.
    No-op (just returns in_path) when speed is ~1.0.
    """
    if abs(speed - 1.0) < 0.01:
        return in_path
    # Build atempo filter chain (e.g. 2.5x = atempo=2.0,atempo=1.25)
    remaining = float(speed)
    stages: list = []
    while remaining > 2.0:
        stages.append(2.0)
        remaining /= 2.0
    while remaining < 0.5:
        stages.append(0.5)
        remaining /= 0.5
    stages.append(remaining)
    afilter = ",".join(f"atempo={s:.4f}" for s in stages)
    res = subprocess.run(
        ["ffmpeg", "-y", "-i", str(in_path), "-filter:a", afilter, str(out_path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise RuntimeError(f"atempo speed adjust failed: {res.stderr[-300:]}")
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


def _ken_burns_filter(animation: str, duration: float, fps: int = 120) -> str:
    """Return ffmpeg zoompan filter string for the chosen animation style.

    REVERTED from Path C (scale+crop+eval=frame) — that approach
    produced odd intermediate pixel dimensions which libx264 yuv420p
    cannot encode, killing every merge. The proven zoompan pattern
    (formula form, not increment form) gives sub-pixel-precise zoom
    expressions and reliable output dimensions.

    Tuned to match the wizard's CSS preview:
      • 120 fps output (matches 120Hz ProMotion / OLED Android displays
        and gives denser motion samples on 60Hz displays).
      • Zoom range 1.0 → 1.18 matches CSS ftKenBurnsZoomIn keyframes.
      • Per-frame zoom is computed via formula `1.0 + 0.18*on/N` so
        ffmpeg evaluates it fresh each frame (no accumulator drift).
      • Pan amplitude matches CSS translateX/Y ±3%.

    100% pixel-perfect to the preview is not achievable with ffmpeg —
    zoompan rounds the crop window to integer pixels. For true match,
    use the browser-record path (Path A).
    """
    total_frames = max(1, int(duration * fps))
    # Zoom-in: linear scale(1.0) → scale(1.18) over the scene duration.
    if animation == "zoom-in":
        return (
            f"scale=2160:3840,zoompan=z='1.0+0.18*on/{total_frames}':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # Zoom-out: linear scale(1.18) → scale(1.0).
    if animation == "zoom-out":
        return (
            f"scale=2160:3840,zoompan=z='1.18-0.18*on/{total_frames}':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # Pan-left: hold zoom at 1.15, slide x from right→left across 6% of width.
    if animation == "pan-left":
        return (
            f"scale=2160:3840,zoompan=z=1.15:"
            f"x='(iw-iw/zoom)*(1-on/{total_frames})':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # Pan-right: same but left→right.
    if animation == "pan-right":
        return (
            f"scale=2160:3840,zoompan=z=1.15:"
            f"x='(iw-iw/zoom)*on/{total_frames}':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # Pan-down: zoom 1.15, slide y from top→bottom.
    if animation == "pan-down":
        return (
            f"scale=2160:3840,zoompan=z=1.15:"
            f"x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*on/{total_frames}':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # Zoom-pan: combined zoom-in + slight x-pan.
    if animation == "zoom-pan":
        return (
            f"scale=2160:3840,zoompan=z='1.0+0.18*on/{total_frames}':"
            f"x='(iw-iw/zoom)*(0.3+0.4*on/{total_frames})':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # Slide-reveal-left: approximate with horizontal pan.
    if animation == "slide-reveal-left":
        return (
            f"scale=2160:3840,zoompan=z=1.05:"
            f"x='(iw-iw/zoom)*(0.65-0.15*on/{total_frames})':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # Fade-in: subtle zoom + opacity ramp via fade filter chain.
    if animation == "fade-in":
        return (
            f"scale=2160:3840,zoompan=z='1.05+0.05*on/{total_frames}':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps},"
            f"fade=in:0:{max(1, int(0.6 * fps))}"
        )
    # Scale-pulse: sinusoidal 1.05 ↔ 1.15.
    if animation == "scale-pulse":
        return (
            f"scale=2160:3840,zoompan=z='1.10-0.05*cos(2*PI*on/{total_frames})':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps}"
        )
    # Color-shift: standard zoom-in + hue cycle.
    if animation == "color-shift":
        return (
            f"scale=2160:3840,zoompan=z='1.0+0.18*on/{total_frames}':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d={total_frames}:s=1080x1920:fps={fps},"
            f"hue=h='20*sin(2*PI*t/{duration:.3f})':"
            f"s='1+0.3*abs(sin(2*PI*t/{duration:.3f}))'"
        )
    # None: static image at output size.
    if animation == "none":
        return f"scale=1080:1920,fps={fps}"
    # Default: subtle zoom-in matching CSS preview.
    return (
        f"scale=2160:3840,zoompan=z='1.0+0.18*on/{total_frames}':"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={total_frames}:s=1080x1920:fps={fps}"
    )


def _escape_drawtext(text: str) -> str:
    # Note: this function is for SINGLE-LINE text only. Multi-line wrapping
    # is handled upstream by emitting one drawtext filter per line via
    # _emit_wrapped_drawtexts() — that side-steps ffmpeg's filter-graph
    # backslash-escape ambiguity entirely.
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
    )


def _placement_y(placement: str, y_offset_pct: int) -> str:
    """Resolve Y position: placement preset + fine-tune offset (-50 to +50%).
    Returns a ffmpeg-evaluable expression in pixels."""
    base = {
        "top":          "h*0.10",
        "top-third":    "h*0.30",
        "middle":       "(h-text_h)/2",
        "bottom-third": "h*0.65",
        "bottom":       "h*0.82",
    }.get(placement, "h*0.82")
    if y_offset_pct == 0:
        return base
    return f"({base})+(h*{y_offset_pct/100:.3f})"


def _alignment_x(align: str) -> str:
    """Resolve X position. Always anchored with text width-aware math."""
    if align == "left":   return "w*0.05"
    if align == "right":  return "w*0.95-text_w"
    return "(w-text_w)/2"  # center default


COLOR_MAP = {
    "white":  "white",
    "yellow": "0xfde047",
    "orange": "0xfb923c",
    "red":    "0xef4444",
    "black":  "black",
    "pink":   "0xf9a8d4",
    "cyan":   "0x67e8f9",
}

def _color(name: str) -> str:
    return COLOR_MAP.get(name, "white")


def _bg_style(style: str, fontcolor: str) -> str:
    """Returns the ffmpeg drawtext snippet for the background style."""
    if style == "box":
        return "box=1:boxcolor=black@0.55:boxborderw=18"
    if style == "outline":
        return "borderw=4:bordercolor=black"
    if style == "shadow":
        return "shadowcolor=black@0.7:shadowx=3:shadowy=3"
    if style == "outline+shadow":
        return "borderw=3:bordercolor=black:shadowcolor=black@0.5:shadowx=2:shadowy=2"
    return ""  # "none"


def _wrap_text(text: str, font_size: int, video_width: int = 1080, side_padding_pct: float = 0.12) -> str:
    """Word-wrap caption to multiple lines so it never bleeds off the
    video frame. Heuristic uses 0.62 glyph width (was 0.55) since bold
    Grobold/DejaVu sans-bold glyphs run wider than plain sans, and 12%
    side padding leaves comfortable breathing room.
    Returns a string with literal newlines that ffmpeg drawtext renders
    as multi-line text via the `\\n` escape."""
    import textwrap
    usable_px = video_width * (1 - 2 * side_padding_pct)
    char_px = max(1, font_size * 0.62)
    max_chars = max(10, int(usable_px / char_px))
    if len(text) <= max_chars:
        return text
    return "\n".join(textwrap.wrap(text, width=max_chars, break_long_words=False, break_on_hyphens=False))


def _emit_wrapped_drawtexts(
    text: str,
    font_size: int,
    font_path: str,
    color: str,
    bg_snippet: str,
    x_expr: str,
    y_expr: str,
    extra: str = "",
) -> list:
    """Wrap `text` to multiple lines and emit ONE drawtext filter per line,
    each at its own y position. Centers the block vertically around
    y_expr. Sidesteps the ffmpeg filter-graph \\n escape ambiguity by
    never embedding a newline in the text param.

    `extra` is appended to every drawtext (e.g. enable=… or alpha=…)."""
    wrapped = _wrap_text(text, font_size)
    lines = wrapped.split("\n")
    line_height = font_size + 12  # font + line gap
    block_height = len(lines) * line_height
    out = []
    for i, line in enumerate(lines):
        if not line.strip():
            continue
        safe = _escape_drawtext(line)
        # Vertical offset so the multi-line block is centered around y_expr
        y_offset = (i - (len(lines) - 1) / 2.0) * line_height
        line_y = f"({y_expr})+({y_offset:.1f})"
        bg = f":{bg_snippet}" if bg_snippet else ""
        ex = f":{extra}" if extra else ""
        out.append(
            f"drawtext=text='{safe}':fontsize={font_size}:fontcolor={color}{bg}:"
            f"x={x_expr}:y={line_y}:fontfile={font_path}{ex}"
        )
    return out


def _karaoke_drawtexts(
    text: str,
    duration: float,
    font_size: int,
    font_path: str,
    color: str,
    bg_snippet: str,
    x_expr: str,
    y_expr: str,
    hold_until: float | None = None,
) -> str:
    """Word-by-word progressive reveal. Pacing distributes word reveals
    over `duration` (which should be the TTS audio length, not the
    padded scene length, so subtitles stay in sync with the voice).
    Once the last word reveals, the full wrapped text stays visible
    until `hold_until` (the scene length) so the user keeps seeing the
    sentence during the silent tail of the slide."""
    words = text.split()
    if not words:
        return ""
    per_word = duration / len(words)
    end_full = hold_until if (hold_until and hold_until > duration) else duration
    parts: list = []
    cumulative: list = []
    for i, w in enumerate(words):
        cumulative.append(w)
        start = i * per_word
        # Last reveal stays on until the end of the entire slide
        end = (i + 1) * per_word if i < len(words) - 1 else end_full
        enable = f"enable='between(t,{start:.3f},{end:.3f})'"
        line_filters = _emit_wrapped_drawtexts(
            " ".join(cumulative), font_size, font_path, color, bg_snippet,
            x_expr, y_expr, extra=enable,
        )
        parts.extend(line_filters)
    return "," + ",".join(parts) if parts else ""


def _static_drawtext(
    text: str,
    font_size: int,
    font_path: str,
    color: str,
    bg_snippet: str,
    x_expr: str,
    y_expr: str,
) -> str:
    parts = _emit_wrapped_drawtexts(text[:400], font_size, font_path, color, bg_snippet, x_expr, y_expr)
    return "," + ",".join(parts) if parts else ""


def _fade_drawtext(
    text: str,
    duration: float,
    font_size: int,
    font_path: str,
    color: str,
    bg_snippet: str,
    x_expr: str,
    y_expr: str,
) -> str:
    """Fade-in 0.5s, hold, fade-out last 0.5s."""
    fade_out_start = max(0.5, duration - 0.5)
    alpha_expr = (
        f"alpha='if(lt(t,0.5),t/0.5,"
        f"if(gt(t,{fade_out_start:.2f}),1-(t-{fade_out_start:.2f})/0.5,1))'"
    )
    parts = _emit_wrapped_drawtexts(text[:400], font_size, font_path, color, bg_snippet, x_expr, y_expr, extra=alpha_expr)
    return "," + ",".join(parts) if parts else ""


def _render_scene(
    image_path: Path,
    audio_path: Path,
    caption: str,
    animation: str,
    placement: str,
    font_size: int,
    out_path: Path,
    subtitle_style: dict,
    min_duration: float = 10.0,
) -> Path:
    """Render ONE scene clip — image + Ken Burns + audio + caption burn.
    subtitle_style keys: animation_mode, font_family, color, bg_style,
    align, y_offset_pct.

    min_duration sets the floor for scene length (wizard slide duration).
    If TTS audio is shorter, Ken Burns holds + audio is silence-padded to
    fill. If audio is longer than min_duration, scene runs the full audio
    length — we don't truncate narration mid-word.
    """
    audio_dur = _ffprobe_duration(audio_path)
    duration = max(audio_dur, float(min_duration))
    zoompan = _ken_burns_filter(animation, duration)

    drawtext = ""
    if caption:
        font_path = _font_path(subtitle_style.get("font_family", "bold-display"))
        color = _color(subtitle_style.get("color", "white"))
        bg = _bg_style(subtitle_style.get("bg_style", "box"), color)
        x_expr = _alignment_x(subtitle_style.get("align", "center"))
        y_expr = _placement_y(placement, int(subtitle_style.get("y_offset_pct", 0)))
        mode = subtitle_style.get("animation_mode", "static")

        if mode == "karaoke":
            # Karaoke MUST sync to actual TTS audio length, not the padded
            # 10s scene duration. Otherwise words reveal slower than the
            # voice speaks them. After the audio ends, the final wrapped
            # block stays on screen for the rest of the scene via the last
            # word's enable window extending to `duration`.
            karaoke_span = max(0.5, audio_dur)
            drawtext = _karaoke_drawtexts(caption, karaoke_span, font_size, font_path, color, bg, x_expr, y_expr, hold_until=duration)
        elif mode == "fade":
            drawtext = _fade_drawtext(caption, duration, font_size, font_path, color, bg, x_expr, y_expr)
        else:  # static
            drawtext = _static_drawtext(caption, font_size, font_path, color, bg, x_expr, y_expr)

    # Use loop=1 to extend a still image to audio duration. Pad audio with
    # silence to match the wizard scene length when narration is shorter —
    # apad+atrim ensures the audio track is exactly `duration` long
    # without -shortest cutting the video early.
    #
    # `-map_metadata -1` strips ALL input metadata before encoding. This
    # is critical for MP3s from MiniMax / Mountsea which embed an `aigc`
    # ID3 tag containing nested JSON ({"aigc": {"Label": "1", ...}}).
    # ffmpeg's lavf demuxer can crash mid-parse on those values when the
    # nested quotes/colons collide with downstream filter graph parsing,
    # leaving stderr at "Metadata: aigc : {..." with no error line —
    # which is exactly what we saw in production. Stripping metadata
    # sidesteps the issue entirely; we don't need the tags anyway.
    #
    # `-fflags +genpts` regenerates packet timestamps if the source MP3
    # has gaps (Mountsea sometimes does), preventing apad/atrim drift.
    cmd = [
        "ffmpeg", "-y",
        "-fflags", "+genpts",
        # 120 fps input → 120 fps output. Combined with the scale+crop
        # sub-pixel filter (Path C) the result is buttery smooth on
        # ProMotion (120Hz) displays AND still better than 60fps on
        # standard 60Hz displays (the encoder produces denser motion
        # samples, less risk of perceptible step between frames).
        "-loop", "1", "-framerate", "120", "-i", str(image_path),
        "-i", str(audio_path),
        "-map_metadata", "-1",
        "-filter_complex",
        f"[0:v]{zoompan}{drawtext}[v];"
        f"[1:a]apad,atrim=0:{duration:.2f},asetpts=N/SR/TB[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-t", f"{duration:.2f}",
        str(out_path),
    ]
    # errors="replace" so a non-UTF8 byte in the MP3's binary metadata
    # (Mountsea sometimes embeds raw bytes) doesn't blow up Python's
    # subprocess decode. Without this, capture_output fails before we
    # even see the ffmpeg returncode.
    res = subprocess.run(
        cmd, capture_output=True, text=True, errors="replace"
    )
    if res.returncode != 0:
        # 2500-char stderr window. The previous 800-char window was being
        # consumed entirely by AIGC metadata dumps, hiding the real error
        # line from us. Include returncode so we can spot OOM kills (-9).
        raise RuntimeError(
            f"ffmpeg scene render failed (rc={res.returncode}): "
            f"{res.stderr[-2500:]}"
        )
    return out_path


# Maps the wizard's transition names to ffmpeg xfade types. Anything
# not listed falls back to "fade" which is the safest default.
_XFADE_MAP = {
    "fade":         "fade",
    "slide-left":   "slideleft",
    "slide-right":  "slideright",
    "slide-up":     "slideup",
    "slide-down":   "slidedown",
    "wipe-left":    "wipeleft",
    "wipe-right":   "wiperight",
    "wipe-up":      "wipeup",
    "wipe-down":    "wipedown",
    "circle-open":  "circleopen",
    "circle-close": "circleclose",
    "dissolve":     "dissolve",
    "radial":       "radial",
    "none":         "fade",  # treat 'no transition' as instant fade (0.05s)
}


def _xfade_merge(
    scene_paths: list,
    transitions: list,
    xfade_dur: float,
    out_path: Path,
) -> Path:
    """Single-pass merge: stitches all scene clips with xfade transitions
    in ONE ffmpeg invocation — no per-scene "concat boundary" abrupt cuts.

    Why this replaces _concat_scenes for multi-scene cases:
      • The previous concat (even with stream copy) hard-cut from scene N
        to scene N+1. Visually: the Ken Burns zoom on scene N ends at
        scale=1.18, then scene N+1 instantly starts at scale=1.0 — the
        camera appears to "jump back" at every boundary. That's what
        the user reported as "laggy".
      • xfade chains the clips with a configurable crossfade window
        (typically 0.5s). During the fade, scene N's final zoom blends
        into scene N+1's initial state — eye sees a smooth transition
        instead of a snap-back.
      • acrossfade does the same for audio so the narration crossfades
        gently instead of an abrupt cut.

    `transitions[i]` is applied between clip i and clip i+1, so
    `len(transitions) == len(scene_paths) - 1`. Any transition name not
    in _XFADE_MAP falls back to plain "fade".

    Single-scene case is handled by the caller (just rename the lone
    clip — no transition needed).
    """
    n = len(scene_paths)
    if n < 2:
        raise ValueError("_xfade_merge requires at least 2 clips")
    if len(transitions) < n - 1:
        # Pad missing transitions with "fade" so we never index out of range
        transitions = list(transitions) + ["fade"] * (n - 1 - len(transitions))

    # ffprobe each clip to get its actual duration. The per-frame xfade
    # `offset` parameter needs the cumulative duration up to clip i so
    # the transition window starts in the right place. Cheaper than
    # computing from audio durations because the clip's container
    # already encodes the final length.
    durations = [_ffprobe_duration(p) for p in scene_paths]

    # Build the inputs flat list: -i clip0 -i clip1 ... -i clipN-1
    inputs_args: list = []
    for p in scene_paths:
        inputs_args.extend(["-i", str(p)])

    # Build filter_complex:
    #   • Video chain: [0:v][1:v]xfade=t=...:d=X:o=O[vx1];
    #                  [vx1][2:v]xfade=t=...:d=X:o=O'[vx2]; ...
    #   • Audio chain: [0:a][1:a]acrossfade=d=X[ax1];
    #                  [ax1][2:a]acrossfade=d=X[ax2]; ...
    # `offset` for xfade is the timestamp (in the OUTPUT timeline) when
    # the transition starts. Cumulative duration grows by
    # (durations[i] - xfade_dur) each step because each xfade overlaps
    # the prior clip by xfade_dur seconds.
    parts: list = []
    # Video
    prev_v = "[0:v]"
    cumulative = durations[0]
    for i in range(1, n):
        xname = _XFADE_MAP.get(transitions[i - 1], "fade")
        offset = max(0.0, cumulative - xfade_dur)
        new_label = f"[vx{i}]"
        parts.append(
            f"{prev_v}[{i}:v]xfade="
            f"transition={xname}:duration={xfade_dur}:offset={offset:.3f}"
            f"{new_label}"
        )
        prev_v = new_label
        cumulative += durations[i] - xfade_dur
    final_v = prev_v

    # Audio — acrossfade between each consecutive pair. c1/c2=tri gives
    # a triangular fade curve which sounds natural for spoken narration.
    prev_a = "[0:a]"
    for i in range(1, n):
        new_label = f"[ax{i}]"
        parts.append(
            f"{prev_a}[{i}:a]acrossfade="
            f"d={xfade_dur}:c1=tri:c2=tri"
            f"{new_label}"
        )
        prev_a = new_label
    final_a = prev_a

    filter_complex = ";".join(parts)

    cmd = [
        "ffmpeg", "-y",
        *inputs_args,
        "-filter_complex", filter_complex,
        "-map", final_v,
        "-map", final_a,
        # Re-encode the final stitched stream. We can't stream-copy here
        # because xfade fundamentally requires decode + blend + encode at
        # every transition boundary. CRF 23 keeps quality high; ultrafast
        # preset keeps render time reasonable.
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if res.returncode != 0:
        raise RuntimeError(
            f"ffmpeg xfade merge failed (rc={res.returncode}): "
            f"{res.stderr[-2500:]}"
        )
    if not out_path.exists() or out_path.stat().st_size < 1024:
        size = out_path.stat().st_size if out_path.exists() else 0
        raise RuntimeError(
            f"xfade merge produced empty/tiny output ({size} bytes). "
            f"stderr tail: {res.stderr[-400:]}"
        )
    return out_path


def _concat_scenes(scene_paths: list, out_path: Path) -> Path:
    """Legacy concat — kept as a fallback. New flow uses _xfade_merge.

    Concat scene mp4s with xfade-style crossfade. Uses concat demuxer +
    optional xfade chain via filter_complex."""
    # Simplest reliable concat: demuxer with re-encode for clean joins.
    listfile = out_path.parent / "concat.txt"
    listfile.write_text(
        "\n".join(f"file '{p.as_posix()}'" for p in scene_paths)
    )
    # Stream-copy concat — no re-encode. All scene clips were rendered
    # with identical codec params (libx264 ultrafast / 120fps / yuv420p /
    # aac 128k) so the concat demuxer can just stitch the bitstreams
    # together without decoding/re-encoding. Benefits:
    #   • Fixes the "laggy after merge" perception users reported. Each
    #     re-encode introduces sub-frame timing drift between clips and
    #     motion-estimation artifacts at clip boundaries — stream copy
    #     preserves the exact frames the per-scene renders produced.
    #   • ~3-5× faster than re-encoding (no encoder pass needed).
    #   • No quality loss — bit-perfect copy of the source streams.
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(listfile),
        "-c", "copy",
        "-movflags", "+faststart",  # web-friendly: moov atom at start
        str(out_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg concat failed: {res.stderr[-800:]}")
    # ffmpeg occasionally exits 0 but writes an unusably small / empty
    # file (e.g. when the input list is parsed but every entry fails).
    # Catch that here so the row's error_message tells the user the
    # merge produced no output instead of the cryptic B2 "request body
    # was too small" XML the upload step would raise later.
    if not out_path.exists() or out_path.stat().st_size < 1024:
        size = out_path.stat().st_size if out_path.exists() else 0
        raise RuntimeError(
            f"ffmpeg concat produced empty/tiny output ({size} bytes) — "
            f"check scene render outputs. stderr tail: {res.stderr[-400:]}"
        )
    return out_path


def _b2_content_config() -> tuple[str, str, str, str, str]:
    """Resolve B2 config for the peninglab-content (public CDN) bucket.

    Same bucket + same credentials scene images already upload to via
    Vercel's lib/b2.ts → uploadBufferToContent. The merged Storytelling
    MP4 now goes to the same place so:
      • the URL shape (https://peninglab-content.{ep}/{key}) matches
        scene images — rest of the system already understands it
      • the 30-day immutable browser cache via cache-control header
      • the 30-day B2 lifecycle rule auto-expires unsaved files

    REQUIRES B2_CONTENT_* env vars on Modal Secrets — the legacy
    B2_KEY_ID / B2_APP_KEY is a B2 application key scoped to the
    peninglab-storage bucket only, so reusing it for peninglab-content
    would fail with AccessDenied. We fail fast (KeyError) with a clear
    diagnostic when these aren't set rather than silently falling back
    and producing a confusing 403.

    Bucket defaults to 'peninglab-content' but respects B2_CONTENT_BUCKET
    override (matches lib/b2.ts uploadBufferToContent's default).

    Returns (endpoint, region, access_key, secret_key, bucket).
    """
    # Only the CREDENTIALS must be content-scoped — those are different
    # B2 application keys for different bucket scopes (peninglab-storage
    # vs peninglab-content) and there's no shared default. Endpoint +
    # region + bucket fall back to the legacy values from
    # fairytale-secrets because B2 endpoints/regions are per-account, NOT
    # per-bucket — same URL serves every bucket in the account, so reusing
    # B2_ENDPOINT for the content upload is correct.
    missing = [
        k for k in ("B2_CONTENT_KEY_ID", "B2_CONTENT_APP_KEY")
        if not os.environ.get(k)
    ]
    if missing:
        raise RuntimeError(
            f"Storytelling merge upload misconfigured: missing Modal Secrets {missing}. "
            "Add B2_CONTENT_KEY_ID and B2_CONTENT_APP_KEY (the credentials scoped to "
            "the peninglab-content bucket) to the b2-content-secrets bundle in Modal, "
            "then `modal deploy modal_fairytale.py`."
        )
    endpoint = os.environ.get("B2_CONTENT_ENDPOINT") or os.environ["B2_ENDPOINT"]
    region = (
        os.environ.get("B2_CONTENT_REGION")
        or os.environ.get("B2_REGION", "us-east-005")
    )
    access_key = os.environ["B2_CONTENT_KEY_ID"]
    secret_key = os.environ["B2_CONTENT_APP_KEY"]
    bucket = os.environ.get("B2_CONTENT_BUCKET", "peninglab-content")
    return endpoint, region, access_key, secret_key, bucket


def _b2_sign_v4(method: str, b2_key: str, body: bytes | None, content_type: str | None, cache_control: str | None = None):
    """Produce SigV4 authorization headers for a B2 S3-compatible request.

    Returns (host, canonical_uri, headers_dict_for_request).

    We use manual SigV4 because boto3/aws-sdk variants force chunked
    transfer encoding which B2 rejects with 'request body too small'.
    See lib/b2.ts for the same pattern in TypeScript.
    """
    import hashlib
    import hmac
    import datetime
    from urllib.parse import urlparse, quote

    endpoint, region, access_key, secret_key, bucket = _b2_content_config()

    endpoint_host = urlparse(endpoint).netloc
    host = f"{bucket}.{endpoint_host}"
    canonical_uri = "/" + quote(b2_key, safe="/")

    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    payload_hash = hashlib.sha256(body).hexdigest() if body is not None else hashlib.sha256(b"").hexdigest()

    headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
    if body is not None:
        headers["content-length"] = str(len(body))
    if content_type:
        headers["content-type"] = content_type
    if cache_control:
        # Persisted by B2 as object metadata, returned on every GET so the
        # browser disk-caches the file. Matches the JS upload path's behaviour.
        headers["cache-control"] = cache_control

    sorted_keys = sorted(headers)
    signed_headers = ";".join(sorted_keys)
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in sorted_keys)

    canonical_request = "\n".join([
        method, canonical_uri, "", canonical_headers, signed_headers, payload_hash,
    ])
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])

    def _hmac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k_date = _hmac(("AWS4" + secret_key).encode(), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, "s3")
    k_signing = _hmac(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    auth = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    out_headers = {
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": auth,
        "Host": host,
    }
    if body is not None:
        out_headers["Content-Length"] = str(len(body))
    if content_type:
        out_headers["Content-Type"] = content_type

    return host, canonical_uri, out_headers


def _upload_b2(local_path: Path, b2_key: str, content_type: str = "video/mp4") -> None:
    """Upload local file to peninglab-content via boto3 multipart upload.

    Previous implementation used requests.put(data=bytes) with manual
    SigV4 — that consistently failed with B2 'IncompleteBody: request
    body was too small' for files >50MB on Modal's container network,
    because requests/urllib3 occasionally truncates a single large PUT
    over the long-lived socket. Adding retries didn't help (every
    attempt hit the same truncation point).

    Multipart upload via boto3.upload_file:
      • Splits the file into 5MB parts
      • Each part is a separate PUT (small enough to complete reliably)
      • boto3 retries each part independently on transient failure
      • Final POST commits all parts atomically
      • Memory-efficient: streams from disk, no need to hold the whole
        file in a bytes object
      • Handles signing internally — no manual SigV4 maintenance burden

    Validates the file is non-empty BEFORE the upload so a 0-byte
    ffmpeg output surfaces as a clear error instead of a cryptic
    'request body too small' from B2.
    """
    if not local_path.exists():
        raise RuntimeError(
            f"B2 upload skipped: {local_path} does not exist — merge step likely failed silently"
        )
    size = local_path.stat().st_size
    if size == 0:
        raise RuntimeError(
            f"B2 upload skipped: {local_path} is empty (0 bytes) — ffmpeg merge produced no output, "
            "check the scene render + concat steps for silent failures"
        )
    # Sanity floor — a real merged mp4 is at least a few KB for the moov atom alone.
    if size < 1024:
        raise RuntimeError(
            f"B2 upload skipped: {local_path} is suspiciously small ({size} bytes) — likely corrupt merge output"
        )

    import boto3
    from botocore.config import Config
    from boto3.s3.transfer import TransferConfig

    endpoint, region, access_key, secret_key, bucket = _b2_content_config()

    # Disable boto3's chunked transfer encoding for single-part PUTs
    # (B2 rejected those previously — see comment in _b2_sign_v4). For
    # MULTIPART (which we use here for any file > 5MB), boto3 uploads
    # each part as a separate request which B2 handles fine.
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "virtual"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=30,
            read_timeout=300,
        ),
    )

    # Force multipart for anything > 5MB. 5MB part size = ~12 parts
    # for a 60MB MP4, each part PUT independently with its own retry
    # budget. max_concurrency=4 uploads 4 parts in parallel for speed.
    transfer_config = TransferConfig(
        multipart_threshold=5 * 1024 * 1024,
        multipart_chunksize=5 * 1024 * 1024,
        max_concurrency=4,
        use_threads=True,
    )

    try:
        s3.upload_file(
            str(local_path),
            bucket,
            b2_key,
            ExtraArgs={
                "ContentType": content_type,
                # Matches lib/b2.ts uploadBufferToContent so the merged
                # MP4 cache-control is identical to scene images.
                "CacheControl": "public, max-age=2592000, immutable",
            },
            Config=transfer_config,
        )
    except Exception as e:
        # Surface the actual boto3 error (S3 error code + part number
        # if multipart) instead of a generic catch-all.
        raise RuntimeError(
            f"B2 multipart upload failed: {type(e).__name__}: {e} (file size {size} bytes)"
        )


def _b2_public_s3_url(b2_key: str) -> str:
    """Build the public S3-style URL for an object in the content bucket.
    No signing needed — bucket is public + we want browsers to cache the
    URL forever via the immutable cache-control header set at upload time.

    Resolved through _b2_content_config so the URL matches whatever
    bucket the upload actually targeted (peninglab-content when the
    new content-scoped Modal Secrets are set; legacy bucket otherwise).
    """
    from urllib.parse import urlparse
    endpoint, _region, _access, _secret, bucket = _b2_content_config()
    endpoint_host = urlparse(endpoint).netloc
    from urllib.parse import quote
    key_encoded = "/".join(quote(p, safe="") for p in b2_key.split("/"))
    return f"https://{bucket}.{endpoint_host}/{key_encoded}"


def _presign_b2_get(b2_key: str, expires_sec: int = 7 * 86400) -> str:
    """Build a presigned GET URL for a B2 object (default 7-day expiry).

    Frontend caches the URL; refresh via /api/storage/refresh-url when it
    nears expiry.
    """
    import hashlib
    import hmac
    import datetime
    from urllib.parse import urlparse, quote

    endpoint = os.environ["B2_ENDPOINT"]
    region = os.environ.get("B2_REGION", "us-east-005")
    access_key = os.environ["B2_KEY_ID"]
    secret_key = os.environ["B2_APP_KEY"]
    bucket = os.environ["B2_BUCKET_PRIVATE"]

    endpoint_host = urlparse(endpoint).netloc
    host = f"{bucket}.{endpoint_host}"
    canonical_uri = "/" + quote(b2_key, safe="/")

    now = datetime.datetime.utcnow()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"

    query_params = [
        ("X-Amz-Algorithm", "AWS4-HMAC-SHA256"),
        ("X-Amz-Credential", f"{access_key}/{credential_scope}"),
        ("X-Amz-Date", amz_date),
        ("X-Amz-Expires", str(expires_sec)),
        ("X-Amz-SignedHeaders", "host"),
    ]
    canonical_query = "&".join(
        f"{quote(k, safe='')}={quote(v, safe='')}" for k, v in sorted(query_params)
    )

    canonical_request = "\n".join([
        "GET", canonical_uri, canonical_query,
        f"host:{host}\n", "host", "UNSIGNED-PAYLOAD",
    ])
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256", amz_date, credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])

    def _hmac(key: bytes, msg: str) -> bytes:
        return hmac.new(key, msg.encode(), hashlib.sha256).digest()

    k_date = _hmac(("AWS4" + secret_key).encode(), date_stamp)
    k_region = _hmac(k_date, region)
    k_service = _hmac(k_region, "s3")
    k_signing = _hmac(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()

    return f"https://{host}{canonical_uri}?{canonical_query}&X-Amz-Signature={signature}"


def _update_history(history_id: str, **fields):
    from supabase import create_client
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    sb.table("history").update(fields).eq("id", history_id).execute()


def _deduct_storytelling(user_id: str, amount: float, history_id: str) -> None:
    """Charge the user `amount` RM credits for a successful render and log
    a credit_transactions row. Mirrors lib/deduct.ts deduct() — atomic
    decrement_credits RPC + transaction insert. Called only on Modal
    success so failures cost the user nothing.
    """
    if amount <= 0:
        return
    try:
        from supabase import create_client
        sb = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        )
        result = sb.rpc(
            "decrement_credits",
            {"p_user_id": user_id, "p_amount": amount},
        ).execute()
        new_balance = result.data
        try:
            after = float(new_balance) if new_balance is not None else 0.0
        except (TypeError, ValueError):
            after = 0.0
        sb.table("credit_transactions").insert({
            "user_id": user_id,
            "amount": -amount,
            "balance_after": after,
            "reason": "storytelling",
            "history_id": history_id,
            "metadata": {"rate": amount, "source": "modal"},
        }).execute()
    except Exception as e:
        # Charge failure shouldn't fail the render — log + carry on. Worst
        # case: user got a free video. Worth investigating but not worth
        # blocking the user on.
        print(f"[fairytale] deduct failed for {user_id}: {e}", flush=True)


# ──────────────────────────────────────────────────────────────────────────
# Modal endpoint
# ──────────────────────────────────────────────────────────────────────────

@app.function(
    image=image,
    cpu=8.0,
    memory=4096,
    timeout=600,  # 10 min — covers worst case (15-scene 120fps render)
    # Two secret bundles attached:
    #   fairytale-secrets    — legacy B2_KEY_ID / B2_APP_KEY / B2_BUCKET_PRIVATE
    #   b2-content-secrets   — B2_CONTENT_* for peninglab-content uploads
    secrets=[
        modal.Secret.from_name("fairytale-secrets"),
        modal.Secret.from_name("b2-content-secrets"),
    ],
)
def _render_story_impl(payload: dict) -> dict:
    """Internal implementation of the storytelling render.

    Same shape as the original render_story body — kept as a regular
    @app.function (no web_endpoint) so it can be invoked via .spawn()
    for async background execution. The synchronous render_story web
    endpoint below calls this via .remote() for backward compatibility,
    and the new start_render endpoint calls .spawn() to return a
    call_id immediately so Vercel never has to wait the full 60-180s.

    Payload shape:
    {
      "history_id": "uuid",
      "user_id": "uuid",
      "voice_id": "moss_audio_60caaba6-4799-11f1-bb39-7aa70590506b",
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

    voice_id = payload.get("voice_id") or "moss_audio_60caaba6-4799-11f1-bb39-7aa70590506b"
    voice_speed = float(payload.get("voice_speed") or 1.0)
    animation = payload.get("animation") or "zoom-in"
    placement = payload.get("placement") or "bottom"
    font_size = int(payload.get("font_size") or 56)
    # Fixed per-scene visual length in seconds. Wizard sends 5/8/10/12/15s.
    # Audio shorter than this gets padded with silence; longer audio gets
    # clamped. Bound 3-20s for safety.
    scene_duration = max(3, min(20, int(payload.get("scene_duration_sec") or 10)))
    language = "en" if payload.get("language") == "en" else "ms"
    subtitle_style = {
        "animation_mode": payload.get("subtitle_animation") or "static",
        "font_family":    payload.get("font_family") or "bold-display",
        "color":          payload.get("font_color") or "white",
        "bg_style":       payload.get("subtitle_bg") or "box",
        "align":          payload.get("text_align") or "center",
        "y_offset_pct":   int(payload.get("y_offset_pct") or 0),
    }

    started = time.time()
    workdir = Path(tempfile.mkdtemp(prefix="fairytale-"))

    # Payload-level transition + xfade duration. Per-scene `transition`
    # on individual scene objects overrides this. Wizard sends names
    # like 'fade' / 'slide-left' / 'circle-open' — mapped to ffmpeg's
    # xfade types in _XFADE_MAP. Xfade duration is the OVERLAP between
    # consecutive scenes (0.5s gives a noticeable but not sluggish blend).
    payload_transition = (payload.get("transition") or "fade").strip()
    xfade_duration = max(0.1, min(2.0, float(payload.get("xfade_duration") or 0.5)))

    try:
        scene_clips: list = []
        scene_transitions: list = []  # transition between clip i and clip i+1
        for idx, scene in enumerate(scenes):
            image_url = scene.get("image_url") or ""
            narration = (scene.get("narration") or "").strip()
            if not image_url or not narration:
                continue

            img_path = _download(image_url, workdir / f"scene-{idx}.jpg")
            # Use pre-generated narration audio if the wizard sent one (it
            # cached the TTS in B2 for the live preview). Falls back to
            # generating fresh via MiniMax if missing/empty. Either way the
            # MP3 we get is at 1.0x natural speed — speed adjustment is
            # applied via ffmpeg atempo so the cached audio is reusable
            # across speed changes.
            cached_audio_url = (scene.get("audio_url") or "").strip()
            raw_audio_path = workdir / f"scene-{idx}-raw.mp3"
            if cached_audio_url:
                _download(cached_audio_url, raw_audio_path)
            else:
                _minimax_tts(narration, voice_id, raw_audio_path, language=language)
            audio_path = _apply_audio_speed(
                raw_audio_path, voice_speed, workdir / f"scene-{idx}.mp3"
            )
            # Per-scene animation override — wizard sends `animation` on
            # individual scene objects when the user has tweaked them
            # via the per-scene picker. Falls back to the payload-level
            # `animation` (the global default) otherwise.
            scene_anim = (scene.get("animation") or animation).strip() or animation
            clip_path = _render_scene(
                img_path, audio_path, narration,
                scene_anim, placement, font_size,
                workdir / f"clip-{idx}.mp4",
                subtitle_style,
                min_duration=scene_duration,
            )
            scene_clips.append(clip_path)
            # Per-scene transition override — scene i's `transition`
            # determines the xfade type entering scene i+1. We collect
            # all of them but only the first n-1 are used (last scene
            # has no "next" transition).
            scene_transition = (scene.get("transition") or payload_transition or "fade").strip()
            scene_transitions.append(scene_transition)

        if not scene_clips:
            _update_history(
                history_id, status="failed",
                error_message="All scenes invalid — need image_url + narration",
            )
            return {"ok": False, "error": "no valid scenes"}

        # SINGLE-PASS xfade merge: one ffmpeg invocation handles all
        # scene-to-scene transitions in one filter_complex. No more
        # per-scene "hard cut + zoom snap-back" boundary the user saw
        # as laggy. transitions[i] is applied between clip i and i+1
        # (so we only need n-1 of them; trim the trailing entry).
        concat_path = workdir / "story_concat.mp4"
        if len(scene_clips) == 1:
            scene_clips[0].rename(concat_path)
        else:
            transitions_between = scene_transitions[: len(scene_clips) - 1]
            _xfade_merge(scene_clips, transitions_between, xfade_duration, concat_path)

        # Background music mix step. If a music URL was provided AND the
        # url is reachable, download the track and amix it under the
        # narration at the wizard-chosen voice/music volumes. ffmpeg
        # `-shortest` clamps to the narration length so a 90s music
        # clip under a 60s story doesn't extend the runtime. If music
        # download fails for any reason we fall back to the narration-
        # only concat — never block the story for missing music.
        background_music_url = payload.get("background_music_url")
        voice_volume_payload = float(payload.get("voice_volume") or 1.0)
        music_volume_payload = float(payload.get("music_volume") or 0.25)
        final_path = workdir / "story.mp4"
        if background_music_url:
            try:
                music_path = workdir / "bgm.mp3"
                _download(background_music_url, music_path)
                # Build the amix filter:
                #   [0:a] = scene audio (narration), volume = voice_volume
                #   [1:a] = bgm (looped + clamped), volume = music_volume
                # weights normalize so amix doesn't auto-attenuate when
                # mixing two streams. duration=first matches narration.
                vv = max(0.0, min(1.0, voice_volume_payload))
                mv = max(0.0, min(1.0, music_volume_payload))
                filter_str = (
                    f"[0:a]volume={vv}[a0];"
                    f"[1:a]aloop=loop=-1:size=2e+09,volume={mv}[a1];"
                    f"[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[aout]"
                )
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(concat_path),
                    "-i", str(music_path),
                    "-filter_complex", filter_str,
                    "-map", "0:v",
                    "-map", "[aout]",
                    "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "192k",
                    "-shortest",
                    str(final_path),
                ]
                res = subprocess.run(cmd, capture_output=True, text=True)
                if res.returncode != 0:
                    raise RuntimeError(f"amix failed: {res.stderr[-400:]}")
            except Exception as bgm_err:
                print(f"[fairytale] bgm mix failed, falling back to narration-only: {bgm_err}")
                if final_path.exists():
                    final_path.unlink()
                concat_path.rename(final_path)
        else:
            concat_path.rename(final_path)

        # Upload merged mp4 to peninglab-content B2 with immutable cache
        # headers (set inside _upload_b2). output_url is the S3-style
        # public URL — no signing, never expires, browser caches 30 days.
        # Matches the JS rehost path in lib/b2.ts → uploadBufferToContent.
        user_id = payload.get("user_id") or "anon"
        b2_key = _b2_key_for(user_id, history_id)
        _upload_b2(final_path, b2_key, content_type="video/mp4")
        signed_url = _b2_public_s3_url(b2_key)

        elapsed = time.time() - started
        # Clear error_message too — if Vercel's after() previously stamped a
        # timeout / 422, that stale message would otherwise stay on a row
        # whose status is now 'done'.
        _update_history(
            history_id,
            status="done",
            output_url=signed_url,
            thumbnail_url=signed_url,
            error_message=None,
        )

        # Charge the user — only on success, never upfront, no refund
        # pattern. Vercel's /api/generate/fairytale stamps row.cost with
        # the computed amount but does NOT deduct; Modal does the deduct
        # here so failed renders cost the user nothing. Best-effort: a
        # deduct failure is logged but doesn't roll back the render
        # (worst case the user got a free video).
        cost_to_charge = float(payload.get("cost") or 0.0)
        if cost_to_charge > 0 and user_id and user_id != "anon":
            _deduct_storytelling(user_id, cost_to_charge, history_id)
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


# ──────────────────────────────────────────────────────────────────────────
# Async architecture (replaces the synchronous render_story endpoint)
# ──────────────────────────────────────────────────────────────────────────
#
# Vercel routes flow:
#   1. /api/generate/fairytale POSTs to /start_render → returns immediately
#      with {call_id, status: "queued"}. Vercel stores call_id on the row
#      and the user gets a "pending" placeholder card instantly.
#   2. /api/fairytale/recheck POSTs to /check_render with {call_id} →
#      returns Modal's actual function-call status (queued/running/done/
#      failed/expired). No more guessing via B2 HEAD + age heuristic.
#   3. _render_story_impl still writes status='done' + output_url to the
#      Supabase row directly when finished — SWR poll on the dashboard
#      picks that up within 15s without anyone needing to query Modal.
#
# The legacy render_story web endpoint is kept (calls .remote() which
# blocks) so any unmigrated Vercel deploy keeps working during cutover.


@app.function(
    image=image,
    secrets=[
        modal.Secret.from_name("fairytale-secrets"),
        modal.Secret.from_name("b2-content-secrets"),
    ],
)
@modal.fastapi_endpoint(method="POST")
def start_render(payload: dict):
    """Async start: spawn the render and return the call_id immediately.

    Vercel stores the returned call_id on history.metadata.modal_call_id
    so the recheck button (and any future background poller) can query
    the exact function call status from Modal — no more B2 HEAD guessing.
    """
    history_id = payload.get("history_id")
    if not history_id:
        return {"ok": False, "error": "history_id required"}
    if not payload.get("scenes"):
        return {"ok": False, "error": "scenes required"}
    # spawn() returns a FunctionCall handle whose object_id is the call_id
    # we'll use to query status later. The actual render runs in a
    # separate container; this endpoint returns within a few hundred ms.
    call = _render_story_impl.spawn(payload)
    return {
        "ok": True,
        "call_id": call.object_id,
        "history_id": history_id,
        "status": "queued",
    }


@app.function(image=image)
@modal.fastapi_endpoint(method="POST")
def check_render(payload: dict):
    """Query a FunctionCall by its call_id and report Modal's actual status.

    States:
      queued   — spawned but no container assigned yet (rare, <5s window)
      running  — container running the render right now
      done     — finished successfully; result dict included
      failed   — finished with an exception/error
      expired  — call_id too old; Modal's output retention expired

    Vercel decides what to do with each status. Typically:
      queued/running → tell user "still rendering"
      done → row is already updated by the impl (it writes directly);
             just confirm to the user
      failed → row is already marked failed by the impl; surface the
               error message
      expired → fall back to B2 HEAD as before
    """
    call_id = payload.get("call_id")
    if not call_id:
        return {"ok": False, "error": "call_id required"}
    try:
        call = modal.FunctionCall.from_id(call_id)
    except Exception as e:
        return {"ok": False, "error": f"invalid call_id: {e}"}
    try:
        # .get(timeout=0) returns instantly:
        #   - if function finished → returns the result
        #   - if still running    → raises TimeoutError
        #   - if expired          → raises OutputExpiredError
        result = call.get(timeout=0)
        if isinstance(result, dict):
            if result.get("ok"):
                return {
                    "ok": True,
                    "status": "done",
                    "output_url": result.get("output_url"),
                    "elapsed_sec": result.get("elapsed_sec"),
                }
            return {
                "ok": True,
                "status": "failed",
                "error": str(result.get("error") or "unknown error"),
            }
        return {"ok": True, "status": "done", "raw": str(result)[:200]}
    except modal.exception.OutputExpiredError:
        return {"ok": True, "status": "expired"}
    except TimeoutError:
        return {"ok": True, "status": "running"}
    except Exception as e:
        # Unknown error — surface so we can debug. NOT marked as failed
        # because we don't know that for sure; the impl writes the
        # authoritative status to the row when it finishes.
        return {
            "ok": False,
            "status": "unknown",
            "error": f"{type(e).__name__}: {e}",
        }


@app.function(
    image=image,
    cpu=8.0,
    memory=4096,
    timeout=600,
    secrets=[
        modal.Secret.from_name("fairytale-secrets"),
        modal.Secret.from_name("b2-content-secrets"),
    ],
)
@modal.fastapi_endpoint(method="POST")
def render_story(payload: dict):
    """Legacy synchronous endpoint — kept for backward compat.

    Old Vercel deployments POST here and block. New deployments use
    start_render + check_render instead. This wrapper just calls the
    impl in the same container so behavior is identical to before the
    refactor. Once all Vercel routes are on the new flow this can be
    removed.
    """
    return _render_story_impl.local(payload)


# Local dev: `modal serve modal_fairytale.py` to test endpoint without deploy.
