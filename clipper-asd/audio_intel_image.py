"""Modal image for clipper-asd/audio_intel.py (GPU L4): faster-whisper turbo + WhisperX align + pyannote 4 + PANNs.

    from audio_intel_image import build_image
    image = build_image(modal)                      # deps + baked weights (turbo, cahya aligner, en aligner, PANNs, punkt)
    image = image.add_local_python_source("audio_intel")   # or copy audio_intel.py into the main app's image

Why this stack pins together: whisperx 3.8.6 pins torch ~2.8 / torchaudio ~2.8 / torchcodec <0.8 and pyannote.audio >= 4;
torch 2.8.0 from PyPI is the CUDA 12.8 build and pulls nvidia-cublas-cu12 + nvidia-cudnn-cu12 (cuDNN 9) wheels, which
CTranslate2 4.8.x (CUDA 12, cuDNN 9; cuDNN optional since 4.6.3) finds through LD_LIBRARY_PATH below.

Diarization weights (pyannote community-1) are gated on Hugging Face. The `diar` bake step tries the official repo with the
HF token from `hf_secret` and silently leaves it out when refused (runtime then retries, or notes the skip). If
`diar_mirror=True`, a mirror is baked instead, but only after its files match the official sha256s. Modal caches layers by
command text, so after the HF account accepts the terms bump `diar_tag` to force the step to rerun.
"""
from __future__ import annotations

import base64
import importlib.util
import json
import os

PY = "3.11"
SITE = f"/usr/local/lib/python{PY}/site-packages"

# Verified together on Modal L4 (2026-10-22).
PIP_PINS = [
    "torch==2.8.0",
    "torchaudio==2.8.0",
    "torchvision==0.23.0",
    "torchcodec==0.7.0",
    "ctranslate2==4.8.3",
    "faster-whisper==1.2.1",
    "whisperx==3.8.6",
    "pyannote.audio==4.0.7",
    "transformers==4.57.6",
    "huggingface-hub==0.36.2",
    "nltk==3.9.4",
    "panns-inference==0.1.1",
    "torchlibrosa==0.1.0",
    "librosa==0.11.0",
]

ENV = {
    "AI_MODELS_DIR": "/models",
    "HF_HOME": "/models/hf",
    "NLTK_DATA": "/models/nltk",
    "TORCH_HOME": "/models/torch",
    "PYANNOTE_METRICS_ENABLED": "false",
    "HF_HUB_DISABLE_TELEMETRY": "1",
    "TOKENIZERS_PARALLELISM": "false",
    "LD_LIBRARY_PATH": ":".join(f"{SITE}/nvidia/{p}/lib" for p in ("cublas", "cudnn", "cuda_runtime", "cuda_nvrtc")),
}


def _pins() -> dict:
    """PINS / DIAR_SHA256 from audio_intel.py next to this file (single source of truth, no heavy imports)."""
    here = os.path.dirname(os.path.abspath(__file__))
    spec = importlib.util.spec_from_file_location("_audio_intel_pins", os.path.join(here, "audio_intel.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return {"PINS": mod.PINS, "DIAR_SHA256": mod.DIAR_SHA256, "DIAR_CONFIG_GIT_SHA1": mod.DIAR_CONFIG_GIT_SHA1}


_BAKE = r'''
import hashlib, json, os, shutil, sys, urllib.request
C = json.loads(%r)
P, M = C["PINS"], os.environ.get("AI_MODELS_DIR", "/models")
what = sys.argv[1]

def fetch(url, dst, md5=None):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    tmp = dst + ".part"
    with urllib.request.urlopen(url, timeout=600) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 22)
    if md5:
        h = hashlib.md5(open(tmp, "rb").read()).hexdigest()
        assert h == md5, f"md5 mismatch for {dst}: {h}"
    os.replace(tmp, dst)

if what == "core":
    from huggingface_hub import snapshot_download
    snapshot_download(P["turbo"][0], revision=P["turbo"][1], local_dir=f"{M}/whisper-turbo")
    snapshot_download(P["align_id"][0], revision=P["align_id"][1], local_dir=f"{M}/align-id",
                      allow_patterns=["*.json", "pytorch_model.bin"])
    import torchaudio
    getattr(torchaudio.pipelines, P["align_en"]).get_model(dl_kwargs={"model_dir": f"{M}/torchaudio"})
    import nltk
    nltk.download("punkt_tab", download_dir=f"{M}/nltk", quiet=True)
    fetch(P["audioset_labels_url"], f"{M}/panns/class_labels_indices.csv")
    os.makedirs("/root/panns_data", exist_ok=True)
    shutil.copyfile(f"{M}/panns/class_labels_indices.csv", "/root/panns_data/class_labels_indices.csv")
    fetch(P["panns_url"], f"{M}/panns/{P['panns_file']}", P["panns_md5"])
    for d in ("hf/xet", "hf/hub/.locks"):
        shutil.rmtree(f"{M}/{d}", ignore_errors=True)
    import faster_whisper, ctranslate2, whisperx, pyannote.audio, panns_inference  # import smoke test
    print("baked core:", sorted(os.listdir(M)))

elif what == "diar":
    from huggingface_hub import snapshot_download
    dst = f"{M}/diar-community-1"
    files = ["config.yaml", *C["DIAR_SHA256"]]
    tok = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    src = None
    if tok:
        try:
            snapshot_download(P["diar"][0], revision=P["diar"][1], local_dir=dst, token=tok, allow_patterns=files)
            src = "official"
        except Exception as e:
            print("diar official not baked:", type(e).__name__)
    if src is None and os.environ.get("AI_BAKE_DIAR_MIRROR") == "1":
        snapshot_download(P["diar_mirror"][0], revision=P["diar_mirror"][1], local_dir=dst, allow_patterns=files)
        def sha(p, git=False):
            data = open(p, "rb").read()
            return hashlib.sha1(b"blob %%d\0" %% len(data) + data).hexdigest() if git else hashlib.sha256(data).hexdigest()
        ok = sha(f"{dst}/config.yaml", True) == C["DIAR_CONFIG_GIT_SHA1"] and all(
            sha(f"{dst}/{f}") == h for f, h in C["DIAR_SHA256"].items())
        if ok:
            src = "mirror"
        else:
            print("diar mirror hash mismatch -> not baked")
    if src:
        open(f"{dst}/SOURCE", "w").write(src)
        shutil.rmtree(f"{dst}/.cache", ignore_errors=True)
    else:
        shutil.rmtree(dst, ignore_errors=True)
    print("baked diar:", src)
'''


def _bake_cmds(what: str, consts: dict) -> list:
    script = _BAKE % json.dumps(consts)
    b64 = base64.b64encode(script.encode()).decode()
    return [f"echo {b64} | base64 -d > /tmp/ai_bake.py && python /tmp/ai_bake.py {what} && rm /tmp/ai_bake.py"]


def build_image(modal, *, hf_secret: str | None = "lh-hf", diar_mirror: bool = False, diar_tag: str = "1"):
    """→ modal.Image with every audio_intel dependency and the weights baked under /models.

    hf_secret:   Modal secret holding HF_TOKEN, used only by the diarization bake step (None → skip that step).
    diar_mirror: also bake the sha256-verified community-1 mirror when the official repo is refused (and set
                 AI_DIAR_MIRROR=1 so audio_intel.run uses it by default).
    diar_tag:    change to force the diarization bake step to rerun (e.g. after accepting the HF terms).
    """
    consts = _pins()
    img = (
        modal.Image.debian_slim(python_version=PY)
        .apt_install("ffmpeg", "libsndfile1")
        .pip_install(*PIP_PINS)
        .env(ENV)
        .run_commands(*_bake_cmds("core", consts))
    )
    diar_env = {"AI_BAKE_DIAR_MIRROR": "1" if diar_mirror else "0", "AI_DIAR_BAKE_TAG": diar_tag}
    if diar_mirror:
        diar_env["AI_DIAR_MIRROR"] = "1"
    img = img.env(diar_env)
    if hf_secret or diar_mirror:
        secrets = [modal.Secret.from_name(hf_secret)] if hf_secret else []
        img = img.run_commands(*_bake_cmds("diar", consts), secrets=secrets)
    return img
