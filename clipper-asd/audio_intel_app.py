"""Ephemeral test app for audio_intel (never deployed):

    MODAL_PROFILE=aqilrvsb py -3 -m modal run clipper-asd/audio_intel_app.py --path some.wav [--language ms]
        [--hint "video title"] [--stages asr,align,diar,events,energy] [--repeat 2] [--mirror] [--out result.json]

--repeat N calls the same container N times (1st = cold, rest = warm). --mirror lets diarization use the
sha256-verified community-1 mirror baked into this test image; --last-no-mirror turns that off for the final call (shows
the "accept the HF terms" note the default config produces). Any ffmpeg-readable audio is accepted (WAV, Opus…).
"""
import json
import os
import sys
import time

import modal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from audio_intel_image import build_image  # noqa: E402

app = modal.App("clipper-audio-intel-test")
image = build_image(modal, diar_mirror=True).add_local_python_source("audio_intel", "audio_intel_image")


@app.function(image=image, gpu="L4", cpu=8.0, memory=16384, timeout=1800,
              secrets=[modal.Secret.from_name("lh-hf")], max_containers=1)
def analyze(wav_bytes: bytes, language: str | None = None, hint: str | None = None,
            stages: list | None = None, allow_diar_mirror: bool = False) -> dict:
    import tempfile

    import audio_intel
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as f:
        f.write(wav_bytes)
    try:
        return audio_intel.run(f.name, language=language or None, hint=hint or None,
                               stages=tuple(stages or audio_intel.DEFAULT_STAGES), allow_diar_mirror=allow_diar_mirror)
    finally:
        os.unlink(f.name)


@app.local_entrypoint()
def main(path: str, language: str = "", hint: str = "", stages: str = "asr,align,diar,events,energy",
         repeat: int = 1, mirror: bool = False, last_no_mirror: bool = False, out: str = ""):
    data = open(path, "rb").read()
    st = [s for s in stages.split(",") if s]
    for i in range(repeat):
        t = time.time()
        use_mirror = mirror and not (last_no_mirror and i == repeat - 1)
        r = analyze.remote(data, language or None, hint or None, st, use_mirror)
        wall = time.time() - t
        print(f"[run {i + 1}{'' if use_mirror else ' no-mirror'}] wall {wall:.1f}s duration {r.get('duration')}s lang {r['language']} words {len(r['words'])} "
              f"speakers {r['speakers']} turns {len(r['turns'])} events {len(r['events'])} energy {len(r['energy'])}")
        print("   timing", r["timing"])
        for n in r["notes"]:
            print("   note:", n)
        if out:
            p = out if repeat == 1 else out.replace(".json", f".{i + 1}.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump(dict(r, wall=round(wall, 1)), f, ensure_ascii=False)
