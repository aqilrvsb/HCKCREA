"""CLIPPER · audio intelligence: a 16 kHz mono WAV → words (aligned, with speaker), speaker turns, sound events, loudness.

    run(wav_path, language=None, hint=None, stages=("asr","align","diar","events","energy"), hf_token=None) -> dict

Stages (each fails soft: a note is added and the rest carries on; only ASR raises):
  asr     Whisper large-v3-turbo (OpenAI, MIT) as a CTranslate2 conversion (mobiuslabsgmbh/faster-whisper-large-v3-turbo,
          MIT) through faster-whisper (MIT), batched + Silero VAD, word timestamps.
  align   WhisperX (BSD-2) forced alignment. ms/id → cahya/wav2vec2-large-xlsr-indonesian (Apache-2.0, Common Voice);
          en → torchaudio WAV2VEC2_ASR_BASE_960H (WhisperX's default; fairseq MIT, LibriSpeech). No MMS (CC-BY-NC).
  diar    pyannote.audio (MIT) pipeline pyannote/speaker-diarization-community-1 (CC-BY-4.0, gated on HF), whole file,
          exclusive diarization; 3.1 (MIT) is tried if community-1 is refused. Optional: a mirror of community-1 whose
          files are checked byte-for-byte (sha256) against the official ones — off unless allow_diar_mirror=True or the
          image baked it on purpose.
  events  PANNs Cnn14_DecisionLevelMax (code MIT, weights CC-BY-4.0, Kong et al. 2020) frame-wise AudioSet tags at 32 kHz,
          reduced to per-second laugh / applause / music / shout / cheer.
  energy  RMS per second in dB, normalised 0..1 between the 5th and 95th percentile.

Stages run sequentially in one process (diarization in a thread beside CTranslate2 segfaulted on a 2.5 h file). To
overlap the two big ones on a long file, run stages=("diar",) in a second container and merge with
assign_speakers(words, turns).

Importable without Modal and without the ML stack (heavy imports happen inside the stages); models are cached in module
globals so a warm container pays the load once. Model files are read from AI_MODELS_DIR (/models, baked by
audio_intel_image.build_image) and fall back to a pinned Hugging Face download.

Attribution required by the CC-BY-4.0 weights (show it somewhere user-facing, e.g. the credits page):
  "Sound event detection uses PANNs (Kong, Cao, Iqbal, Wang, Wang, Plumbley — 'PANNs: Large-Scale Pretrained Audio Neural
   Networks for Audio Pattern Recognition', 2020), weights CC BY 4.0, https://zenodo.org/records/3987831"
  "Speaker diarization uses pyannote/speaker-diarization-community-1 by pyannoteAI, CC BY 4.0,
   https://huggingface.co/pyannote/speaker-diarization-community-1"
"""
from __future__ import annotations

import math
import os
import subprocess
import threading
import time

SR = 16000
DEFAULT_STAGES = ("asr", "align", "diar", "events", "energy")
MODELS_DIR = os.environ.get("AI_MODELS_DIR", "/models")

# Everything a download needs, pinned (repo, revision). audio_intel_image.py bakes exactly these.
PINS = {
    "turbo": ("mobiuslabsgmbh/faster-whisper-large-v3-turbo", "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"),  # MIT
    "align_id": ("cahya/wav2vec2-large-xlsr-indonesian", "fe66c9f1114e958d0c08de5dcc7e82bb8001d4a1"),  # Apache-2.0
    "align_en": "WAV2VEC2_ASR_BASE_960H",  # torchaudio bundle (WhisperX default for en)
    "diar": ("pyannote/speaker-diarization-community-1", "3533c8cf8e369892e6b79ff1bf80f7b0286a54ee"),  # CC-BY-4.0, gated
    "diar_31": ("pyannote/speaker-diarization-3.1", None),  # MIT, gated (needs segmentation-3.0 terms too)
    "diar_mirror": ("pyannote-community/speaker-diarization-community-1", "8a527374977391da736e0daaef26855d949d9685"),
    "panns_url": "https://zenodo.org/records/3987831/files/Cnn14_DecisionLevelMax_mAP=0.385.pth?download=1",
    "panns_md5": "70539c43c18b6a289b3199c503a82c5a",
    "panns_file": "Cnn14_DecisionLevelMax_mAP=0.385.pth",
    "audioset_labels_url": "http://storage.googleapis.com/us_audioset/youtube_corpus/v1/csv/class_labels_indices.csv",
}
# sha256 of the official community-1 files (HF LFS metadata) — a mirror is only used when every file matches.
DIAR_SHA256 = {
    "embedding/pytorch_model.bin": "6f10ff60898a1d185fa22e1d11e0bfa8a92efec811f11bca48cb8cafebefd929",
    "plda/plda.npz": "9b77bcd840692710dd3496f62ecfeed8d8e5f002fd991b785079b244eab7d255",
    "plda/xvec_transform.npz": "325f1ce8e48f7e55e9c8aa47e05d2766b7c48c4b25b8de8dd751e7a4cc5fbe8f",
    "segmentation/pytorch_model.bin": "7ad24338d844fb95985486eb1a464e32d229f6d7a03c9abe60f978bacf3f816e",
}
DIAR_CONFIG_GIT_SHA1 = "4022db43960736338378fdb6b5a85cfdae198910"  # config.yaml (not LFS → git blob sha1)
DIAR_TERMS_NOTE = ("diarization skipped: HF account must accept terms at "
                   "https://huggingface.co/pyannote/speaker-diarization-community-1")

MS_PROMPT = "Okey korang, hari ni kita sembang pasal ni. Jom tengok sampai habis."

# AudioSet display names → our five event groups (looked up by name in the PANNs label list, not by index).
EVENT_CLASSES = {
    "laugh": ("Laughter", "Baby laughter", "Giggle", "Snicker", "Belly laugh", "Chuckle, chortle"),
    "applause": ("Applause", "Clapping"),
    "music": ("Music",),
    "shout": ("Shout", "Yell", "Screaming", "Bellow", "Children shouting"),
    "cheer": ("Cheering", "Crowd"),
}
EVENT_MIN = 0.15  # only seconds where some group scores above this are returned

MIN_TURN = 1.0  # diarization turns shorter than this (backchannels: "haa", "betul") fold into a neighbour

_M: dict = {}  # model cache for warm containers
_LOCKS: dict = {}
_LOCKS_GUARD = threading.Lock()


def _lock(name: str) -> threading.Lock:
    """One lock per model, so diarization can load in its thread while ASR loads in the main one."""
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(name, threading.Lock())


# ───────────────────────────── helpers ─────────────────────────────

def _device() -> str:
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _hf_token(tok: str | None) -> str | None:
    return tok or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN") or None


def _local(name: str) -> str | None:
    p = os.path.join(MODELS_DIR, name)
    return p if os.path.isdir(p) and os.listdir(p) else None


def load_audio(path: str):
    """→ float32 mono 16 kHz numpy array. Plain 16 kHz mono PCM16 WAV is read directly, anything else via ffmpeg."""
    import numpy as np
    import wave
    try:
        with wave.open(path, "rb") as w:
            if w.getnchannels() == 1 and w.getsampwidth() == 2 and w.getframerate() == SR:
                return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
    except Exception:
        pass
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype="<f4").copy()


def _clean_token(w: str, lang: str) -> str:
    """What the wav2vec2 aligner sees for one word: lowercase letters/digits (digits become the wildcard column)."""
    keep_apos = lang == "en"
    return "".join(ch for ch in w.lower() if ch.isalnum() or (keep_apos and ch == "'"))


# ───────────────────────────── stage: ASR ─────────────────────────────

def _asr_models(device: str):
    with _lock("asr"):
        if "asr" not in _M:
            from faster_whisper import BatchedInferencePipeline, WhisperModel
            path = _local("whisper-turbo")
            if not path:
                from huggingface_hub import snapshot_download
                repo, rev = PINS["turbo"]
                path = snapshot_download(repo, revision=rev)
            model = WhisperModel(path, device=device, compute_type="float16" if device == "cuda" else "int8")
            _M["asr"] = (model, BatchedInferencePipeline(model))
        return _M["asr"]


def _detect_language(model, audio) -> tuple[str, float, list]:
    mid = len(audio) // 2
    sample = audio[max(0, mid - 30 * SR): mid + 30 * SR]  # middle minute; VAD keeps the first 30 s of speech in it
    lang, prob, allp = model.detect_language(audio=sample, vad_filter=True, language_detection_segments=1)
    return lang, float(prob), [(l, round(float(p), 3)) for l, p in (allp or [])[:3]]


def _asr(audio, language, hint, device, notes, opts) -> tuple[str, list, list]:
    model, batched = _asr_models(device)
    if not language:
        language, prob, top = _detect_language(model, audio)
        notes.append(f"language auto-detected: {language} p={prob:.2f} top={top}")
    prompt_parts = [MS_PROMPT] if language == "ms" else []
    if hint:
        prompt_parts.append(str(hint).strip()[:200])
    prompt = " ".join(prompt_parts) or None
    # without_timestamps=False: with the prompt and the batched default (True), Whisper skipped the first 7.5 s of a
    # chunk on the test podcast (and ran past its end); timestamp tokens keep it anchored.
    segs, _info = batched.transcribe(
        audio, language=language, task="transcribe", beam_size=int(opts.get("beam_size", 5)), temperature=0.0,
        condition_on_previous_text=False, initial_prompt=prompt, word_timestamps=True, vad_filter=True,
        without_timestamps=not opts.get("timestamps", True), batch_size=int(opts.get("batch_size", 16)),
        log_progress=False)
    segs = list(segs)

    norm_prompt = "".join(ch for ch in (prompt or "").lower() if ch.isalnum())
    words, groups, dropped = [], [], 0
    for s in segs:
        txt = "".join(ch for ch in (s.text or "").lower() if ch.isalnum())
        if norm_prompt and len(txt) >= 12 and txt in norm_prompt:  # the prompt echoed back in a quiet window
            dropped += 1
            continue
        idx = []
        for w in s.words or []:
            t = (w.word or "").strip()
            if not t:
                continue
            idx.append(len(words))
            words.append({"w": t, "t": round(float(w.start), 3), "e": round(float(w.end), 3), "spk": None,
                          "p": round(float(w.probability), 3)})
        if idx:
            groups.append((float(s.start), float(s.end), idx))
    if dropped:
        notes.append(f"asr: dropped {dropped} segment(s) that only repeated the prompt")
    return language, words, groups


# ───────────────────────────── stage: alignment ─────────────────────────────

def _align_model(lang: str, device: str):
    key = "align_en" if lang == "en" else "align_id"
    with _lock(key):
        if key not in _M:
            import whisperx
            if key == "align_en":
                model_dir = _local("torchaudio") or os.path.join(MODELS_DIR, "torchaudio")
                _M[key] = whisperx.load_align_model(language_code="en", device=device, model_dir=model_dir)
            else:
                path = _local("align-id")
                if not path:
                    from huggingface_hub import snapshot_download
                    repo, rev = PINS["align_id"]
                    path = snapshot_download(repo, revision=rev, allow_patterns=["*.json", "pytorch_model.bin"])
                _M[key] = whisperx.load_align_model(language_code=lang, device=device, model_name=path)
            _cache_punkt()
        return _M[key]


def _cache_punkt() -> None:
    """whisperx.align re-reads the NLTK punkt tables for every segment (~0.13 s each, ~40 s on a 2.5 h file)."""
    import functools

    import whisperx.alignment as wa
    if not getattr(wa.nltk_load, "_ai_cached", False):
        cached = functools.lru_cache(maxsize=16)(wa.nltk_load)
        cached._ai_cached = True
        wa.nltk_load = cached


def _align(audio, lang, words, groups, device, notes) -> None:
    """Re-time words in place with WhisperX forced alignment; words it cannot place keep Whisper's timing."""
    if lang not in ("ms", "id", "en"):
        notes.append(f"align skipped: no commercial-safe aligner configured for '{lang}' (Whisper timing kept)")
        return
    import contextlib

    import torch
    import whisperx
    model, meta = _align_model(lang, device)
    meta = dict(meta, language=lang)
    counts = [0, 0, 0]  # aligned, kept Whisper timing, failed segments
    # fp16 wav2vec2 emissions: same word times as fp32 on the test podcast, a little faster
    amp = torch.autocast("cuda", dtype=torch.float16) if device == "cuda" else contextlib.nullcontext()
    with amp:
        _align_groups(whisperx, model, meta, audio, device, lang, words, _blocks(words, groups), len(audio) / SR,
                      counts)
    moved, kept, failed = counts
    _monotonic(words)
    if failed or kept:
        notes.append(f"align: {moved} words aligned, {kept} kept Whisper timing, {failed} segment(s) failed")


def _blocks(words, groups, max_len=30.0, min_gap=1.0) -> list:
    """Merge Whisper's sentence segments into alignment blocks (≤ max_len s) that end at a pause ≥ min_gap where
    possible. Whisper's segment edges are often ~0.5 s off; aligning across them in one window lets wav2vec2 place
    the boundary words itself, and block edges then fall in silence."""
    out, cur = [], None
    for s0, s1, idx in groups:
        t0, e0 = words[idx[0]]["t"], words[idx[-1]]["e"]
        if cur is not None:
            gap = t0 - words[cur[2][-1]]["e"]
            if gap < min_gap and max(s1, e0) - cur[0] <= max_len:
                cur = (cur[0], max(cur[1], s1, e0), cur[2] + idx)
                continue
            out.append(cur)
        cur = (min(s0, t0), max(s1, e0), list(idx))
    if cur is not None:
        out.append(cur)
    return out


def _align_groups(whisperx, model, meta, audio, device, lang, words, groups, dur, counts) -> None:
    import difflib
    for g, (s0, s1, idx) in enumerate(groups):
        toks = [(i, _clean_token(words[i]["w"], lang)) for i in idx]
        toks = [(i, t) for i, t in toks if t]
        if not toks:
            continue
        # Whisper's own segment edges can sit inside the first/last word: pad up to 1 s, but not into the neighbours.
        prev_e = words[groups[g - 1][2][-1]]["e"] if g > 0 else 0.0
        next_t = words[groups[g + 1][2][0]]["t"] if g + 1 < len(groups) else dur
        a0 = max(0.0, min(s0, words[toks[0][0]]["t"]) - 1.0, min(prev_e, words[toks[0][0]]["t"]))
        a1 = min(dur, max(s1, words[toks[-1][0]]["e"]) + 1.0, max(next_t, words[toks[-1][0]]["e"]))
        try:
            r = whisperx.align([{"start": a0, "end": a1, "text": " ".join(t for _, t in toks)}], model, meta, audio,
                               device, return_char_alignments=False)
        except Exception:
            counts[2] += 1
            continue
        aw = r.get("word_segments") or []
        if len(aw) == len(toks):
            pairs = [(toks[k][0], aw[k]) for k in range(len(toks))]
        else:  # rare: sentence regrouping changed the count — match by text
            sm = difflib.SequenceMatcher(a=[t for _, t in toks], b=[str(x.get("word", "")).lower() for x in aw],
                                         autojunk=False)
            pairs = [(toks[blk.a + k][0], aw[blk.b + k]) for blk in sm.get_matching_blocks() for k in range(blk.size)]
        for i, x in pairs:
            st, en = x.get("start"), x.get("end")
            if st is None or en is None or not (math.isfinite(st) and math.isfinite(en)) or en < st:
                counts[1] += 1
                continue
            w = words[i]
            if abs((st + en) / 2 - (w["t"] + w["e"]) / 2) > 3.0:  # aligner lost the thread (music, crosstalk)
                counts[1] += 1
                continue
            w["t"], w["e"] = round(float(st), 3), round(float(en), 3)
            counts[0] += 1


def _monotonic(words) -> None:
    prev_t = 0.0
    for w in words:
        if w["t"] < prev_t:
            w["t"] = prev_t
        if w["e"] < w["t"]:
            w["e"] = w["t"]
        prev_t = w["t"]


# ───────────────────────────── stage: diarization ─────────────────────────────

def _sha256(path: str) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _git_sha1(path: str) -> str:
    import hashlib
    data = open(path, "rb").read()
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def verify_diar_dir(path: str) -> bool:
    """True when a community-1 directory is byte-identical to the official release."""
    try:
        if _git_sha1(os.path.join(path, "config.yaml")) != DIAR_CONFIG_GIT_SHA1:
            return False
        return all(_sha256(os.path.join(path, f)) == h for f, h in DIAR_SHA256.items())
    except OSError:
        return False


def _gated(e: Exception) -> bool:
    code = getattr(getattr(e, "response", None), "status_code", None)
    name = type(e).__name__
    return code in (401, 403) or name in ("GatedRepoError", "RepositoryNotFoundError") or "gated" in str(e).lower()


def _diar_pipeline(hf_token, allow_mirror, device, notes):
    with _lock("diar"):
        if "diar" in _M:
            if "mirror" in _M["diar"][1] and not allow_mirror:  # cached from an earlier call that allowed the mirror
                raise _DiarRefused(DIAR_TERMS_NOTE)
            return _M["diar"]
        import torch
        from pyannote.audio import Pipeline
        tok = _hf_token(hf_token)
        pipe, source = None, None
        baked = _local("diar-community-1")
        if baked:
            src = open(os.path.join(baked, "SOURCE")).read().strip() if os.path.exists(os.path.join(baked, "SOURCE")) else "?"
            if src == "official" or (allow_mirror and src == "mirror" and verify_diar_dir(baked)):
                pipe, source = Pipeline.from_pretrained(baked), f"community-1 (baked, {src})"
        refused = []
        if pipe is None:
            for key in ("diar", "diar_31"):
                repo, rev = PINS[key]
                try:
                    pipe = Pipeline.from_pretrained(repo, revision=rev, token=tok)
                    if pipe is not None:
                        source = repo
                        break
                except Exception as e:  # noqa: BLE001
                    if not _gated(e):
                        raise
                    refused.append(repo)
        if pipe is None and allow_mirror:
            from huggingface_hub import snapshot_download
            repo, rev = PINS["diar_mirror"]
            path = snapshot_download(repo, revision=rev, allow_patterns=["config.yaml", *DIAR_SHA256])
            if not verify_diar_dir(path):
                raise RuntimeError("diarization mirror does not match the official community-1 hashes — not loaded")
            pipe, source = Pipeline.from_pretrained(path), f"community-1 (hash-verified mirror {repo})"
        if pipe is None:
            raise _DiarRefused(DIAR_TERMS_NOTE + (f" (refused: {', '.join(refused)})" if refused else ""))
        if device == "cuda":
            pipe.to(torch.device("cuda"))
        for attr in ("segmentation_batch_size", "embedding_batch_size"):
            try:
                setattr(pipe, attr, 32)
            except Exception:
                pass
        _M["diar"] = (pipe, source)
        return _M["diar"]


class _DiarRefused(RuntimeError):
    pass


def _clean_turns(raw: list) -> list:
    """Sorted, exclusive turns; same-speaker neighbours joined; turns < MIN_TURN folded into the closer neighbour."""
    turns = [[float(s), float(e), str(k)] for s, e, k in sorted(raw) if e - s > 0.01]

    def join(ts):
        out = []
        for t in ts:
            if out and out[-1][2] == t[2] and t[0] - out[-1][1] <= 0.6:
                out[-1][1] = max(out[-1][1], t[1])
            elif out and t[0] < out[-1][1]:  # defensive: never overlap
                t[0] = out[-1][1]
                if t[1] > t[0]:
                    out.append(t)
            else:
                out.append(t)
        return out

    turns = join(turns)
    stuck: set = set()
    while True:
        cand = [(t[1] - t[0], i) for i, t in enumerate(turns) if t[1] - t[0] < MIN_TURN and (t[0], t[2]) not in stuck]
        if not cand:
            break
        _, i = min(cand)
        t = turns[i]
        prv = turns[i - 1] if i > 0 else None
        nxt = turns[i + 1] if i + 1 < len(turns) else None
        gp = t[0] - prv[1] if prv else 1e9
        gn = nxt[0] - t[1] if nxt else 1e9
        if min(gp, gn) > 2.0:  # isolated short utterance: keep it
            stuck.add((t[0], t[2]))
            continue
        if prv and nxt and prv[2] == nxt[2] and max(gp, gn) <= 2.0:
            prv[1] = nxt[1]
            del turns[i:i + 2]
        elif gp <= gn:
            prv[1] = t[1]
            del turns[i]
        else:
            nxt[0] = t[0]
            del turns[i]
        turns = join(turns)
    return turns


def _diarize(audio, hf_token, allow_mirror, device, notes, opts) -> tuple[list, list, dict]:
    """Whole-file diarization → (speakers by talk time, exclusive turns, talk seconds per speaker)."""
    import torch
    pipe, source = _diar_pipeline(hf_token, allow_mirror, device, notes)
    if source == PINS["diar_31"][0]:
        notes.append("diarization: community-1 refused, used pyannote/speaker-diarization-3.1 (MIT)")
    elif "mirror" in source:
        notes.append(f"diarization weights: {source} — sha256-identical to the official CC-BY-4.0 release")
    kw = {k: int(opts[k]) for k in ("num_speakers", "min_speakers", "max_speakers") if opts.get(k)}
    out = pipe({"waveform": torch.from_numpy(audio).unsqueeze(0), "sample_rate": SR}, **kw)
    ann = getattr(out, "exclusive_speaker_diarization", None) or getattr(out, "speaker_diarization", None) or out
    raw = [(seg.start, seg.end, lab) for seg, _, lab in ann.itertracks(yield_label=True)]
    turns = _clean_turns(raw)
    talk: dict = {}
    for s, e, k in turns:
        talk[k] = talk.get(k, 0.0) + (e - s)
    order = sorted(talk, key=lambda k: -talk[k])
    name = {k: f"S{i + 1}" for i, k in enumerate(order)}
    out_turns = [{"s": round(s, 2), "e": round(e, 2), "spk": name[k]} for s, e, k in turns]
    return [name[k] for k in order], out_turns, {name[k]: round(talk[k], 1) for k in order}


def assign_speakers(words, turns) -> None:
    """Set each word's "spk" (in place) to the turn covering its midpoint, or the nearest turn within 1 s, else None.
    Public so results of run(stages=("diar",)) from another container can be merged into ASR words."""
    import bisect
    starts = [t["s"] for t in turns]
    for w in words:
        mid = (w["t"] + w["e"]) / 2
        i = bisect.bisect_right(starts, mid) - 1
        best, dist = None, 1e9
        for j in (i, i + 1):
            if 0 <= j < len(turns):
                t = turns[j]
                d = 0.0 if t["s"] <= mid <= t["e"] else min(abs(mid - t["s"]), abs(mid - t["e"]))
                if d < dist:
                    best, dist = t["spk"], d
        w["spk"] = best if dist <= 1.0 else None


# ───────────────────────────── stage: audio events (PANNs) ─────────────────────────────

def _ensure_audioset_labels() -> None:
    """panns_inference reads ~/panns_data/class_labels_indices.csv at import (and shells out to wget if missing)."""
    dst = os.path.join(os.path.expanduser("~"), "panns_data", "class_labels_indices.csv")
    if os.path.exists(dst):
        return
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    baked = os.path.join(MODELS_DIR, "panns", "class_labels_indices.csv")
    if os.path.exists(baked):
        import shutil
        shutil.copyfile(baked, dst)
    else:
        import urllib.request
        urllib.request.urlretrieve(PINS["audioset_labels_url"], dst)


class _no_librosa:
    """Build torchlibrosa's STFT / log-mel layers without librosa: its first use JIT-compiles numba ufuncs
    (~20 s per cold container), and every matrix it would compute is replaced by the checkpoint anyway (strict load)."""

    def __enter__(self):
        import types

        import numpy as np
        import scipy.signal
        import torchlibrosa.stft as tls

        def pad_center(data, size, axis=-1, **_):
            n = data.shape[axis]
            lpad = (size - n) // 2
            widths = [(0, 0)] * data.ndim
            widths[axis] = (lpad, size - n - lpad)
            return np.pad(data, widths)

        stub = types.SimpleNamespace(
            filters=types.SimpleNamespace(
                get_window=lambda window, nx, fftbins=True: scipy.signal.get_window(window, nx, fftbins=fftbins),
                mel=lambda sr, n_fft, n_mels, fmin, fmax, **_: np.zeros((n_mels, 1 + n_fft // 2), np.float32)),
            util=types.SimpleNamespace(pad_center=pad_center))
        self._mod, self._orig = tls, tls.librosa
        tls.librosa = stub
        return self

    def __exit__(self, *exc):
        self._mod.librosa = self._orig
        return False


def _panns(device: str):
    with _lock("panns"):
        if "panns" not in _M:
            import torch
            _ensure_audioset_labels()
            from panns_inference.config import labels
            from panns_inference.models import Cnn14_DecisionLevelMax
            ck = os.path.join(MODELS_DIR, "panns", PINS["panns_file"])
            if not os.path.exists(ck):
                import urllib.request
                ck = os.path.join(os.path.expanduser("~"), "panns_data", PINS["panns_file"])
                if not os.path.exists(ck):
                    urllib.request.urlretrieve(PINS["panns_url"], ck)
            with _no_librosa():
                model = Cnn14_DecisionLevelMax(sample_rate=32000, window_size=1024, hop_size=320, mel_bins=64,
                                               fmin=50, fmax=14000, classes_num=len(labels))
            state = torch.load(ck, map_location="cpu", weights_only=True)
            model.load_state_dict(state["model"], strict=True)  # also overwrites every STFT / mel matrix
            model.eval().to(device)
            lab = {name: i for i, name in enumerate(labels)}
            groups = {g: [lab[n] for n in names if n in lab] for g, names in EVENT_CLASSES.items()}
            _M["panns"] = (model, groups)
        return _M["panns"]


def _events(audio, device, notes, opts) -> list:
    import numpy as np
    import torch
    import torchaudio
    model, groups = _panns(device)
    n_sec = int(math.ceil(len(audio) / SR))
    chunk_s = 60
    x = torch.from_numpy(audio).to(device)
    x = torchaudio.functional.resample(x, SR, 32000)
    total = n_sec + (-n_sec) % chunk_s
    x = torch.nn.functional.pad(x, (0, total * 32000 - x.shape[0]))
    x = x.view(-1, chunk_s * 32000)
    per_sec = []
    bs = int(opts.get("events_batch", 8))
    with torch.inference_mode():
        for b in range(0, x.shape[0], bs):
            fw = model(x[b:b + bs], None)["framewise_output"]  # (B, frames≈100/s, 527)
            fw = fw[:, : chunk_s * 100, :].reshape(fw.shape[0], chunk_s, 100, fw.shape[-1]).amax(dim=2)
            per_sec.append(fw.reshape(-1, fw.shape[-1]).float().cpu())
    ps = torch.cat(per_sec)[:n_sec].numpy()
    cols = {g: (ps[:, idx].max(axis=1) if idx else np.zeros(n_sec)) for g, idx in groups.items()}
    out = []
    for t in range(n_sec):
        row = {g: round(float(cols[g][t]), 3) for g in EVENT_CLASSES}
        if max(row.values()) > EVENT_MIN:
            out.append({"t": t, **row})
    return out


# ───────────────────────────── stage: energy ─────────────────────────────

def _energy(audio) -> list:
    import numpy as np
    n = int(math.ceil(len(audio) / SR))
    if n == 0:
        return []
    x = np.pad(audio, (0, n * SR - len(audio))).reshape(n, SR).astype(np.float64)
    db = 20 * np.log10(np.sqrt((x * x).mean(axis=1)) + 1e-9)
    lo, hi = np.percentile(db, 5), np.percentile(db, 95)
    norm = np.clip((db - lo) / max(hi - lo, 1e-6), 0, 1)
    return [round(float(v), 3) for v in norm]


# ───────────────────────────── entry ─────────────────────────────

def run(wav_path: str, language: str | None = None, hint: str | None = None, stages=DEFAULT_STAGES,
        hf_token: str | None = None, *, allow_diar_mirror: bool | None = None, **opts) -> dict:
    """Analyse one audio file. opts: beam_size (5), batch_size (16), num_speakers/min_speakers/max_speakers,
    events_batch (8). allow_diar_mirror defaults to env AI_DIAR_MIRROR == "1"."""
    t_all = time.time()
    stages = tuple(stages or DEFAULT_STAGES)
    if allow_diar_mirror is None:
        allow_diar_mirror = os.environ.get("AI_DIAR_MIRROR") == "1"
    notes: list = []
    timing = {"load": 0.0}
    res = {"language": language, "words": [], "speakers": [], "turns": [], "events": [], "energy": [],
           "timing": timing, "notes": notes}

    t = time.time()
    audio = load_audio(wav_path)
    timing["decode"] = round(time.time() - t, 2)
    res["duration"] = round(len(audio) / SR, 2)
    device = _device()

    # Each stage's first use in a container loads its model; that time is booked under timing.load (and load_<stage>),
    # not under the stage itself. Stages run one after another: diarization in a thread beside CTranslate2 segfaulted
    # on the 2.5 h test file. To overlap them, call run(stages=("diar",)) in a second container and merge the two
    # results with assign_speakers(words, turns).
    def booked(name, t0):
        dt = time.time() - t0
        timing["load"] += dt
        timing[f"load_{name}"] = round(dt, 2)

    if "energy" in stages:
        try:
            t0 = time.time()
            res["energy"] = _energy(audio)
            timing["energy"] = round(time.time() - t0, 2)
        except Exception as e:  # noqa: BLE001
            notes.append(f"energy skipped: {type(e).__name__}: {e}"[:300])

    groups: list = []
    if "asr" in stages:
        t0 = time.time()
        if "asr" not in _M:
            _asr_models(device)
            booked("asr", t0)
            t0 = time.time()
        lang, words, groups = _asr(audio, language, hint, device, notes, opts)  # required: raises on failure
        timing["asr"] = round(time.time() - t0, 2)
        res["language"], res["words"] = lang, words

    if "align" in stages:
        if not res["words"]:
            notes.append("align skipped: no ASR words")
        else:
            try:
                t0 = time.time()
                key = "align_en" if res["language"] == "en" else "align_id"
                if key not in _M and res["language"] in ("ms", "id", "en"):
                    _align_model(res["language"], device)
                    booked("align", t0)
                    t0 = time.time()
                _align(audio, res["language"], res["words"], groups, device, notes)
                timing["align"] = round(time.time() - t0, 2)
            except Exception as e:  # noqa: BLE001
                notes.append(f"align skipped: {type(e).__name__}: {e}"[:300])

    if "diar" in stages:
        try:
            t0 = time.time()
            if "diar" not in _M:
                _diar_pipeline(hf_token, allow_diar_mirror, device, notes)
                booked("diar", t0)
                t0 = time.time()
            res["speakers"], res["turns"], res["speaker_time"] = _diarize(
                audio, hf_token, allow_diar_mirror, device, notes, opts)
            assign_speakers(res["words"], res["turns"])
            timing["diar"] = round(time.time() - t0, 2)
        except _DiarRefused as e:
            notes.append(str(e))
        except Exception as e:  # noqa: BLE001
            notes.append(f"diarization skipped: {type(e).__name__}: {e}"[:300])

    if "events" in stages:
        try:
            t0 = time.time()
            if "panns" not in _M:
                _panns(device)
                booked("events", t0)
                t0 = time.time()
            res["events"] = _events(audio, device, notes, opts)
            timing["events"] = round(time.time() - t0, 2)
        except Exception as e:  # noqa: BLE001
            notes.append(f"events skipped: {type(e).__name__}: {e}"[:300])

    timing["load"] = round(timing["load"], 2)
    timing["total"] = round(time.time() - t_all, 2)
    return res
