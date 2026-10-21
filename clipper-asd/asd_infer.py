"""CLIPPER · active speaker detection: who is talking, frame by frame.

YuNet faces (OpenCV Zoo, MIT) are linked into tracks; each track's face crops + the clip's audio go through LR-ASD
(Junhua Liao, MIT — model/ and LICENSE-LR-ASD here, weights from github.com/Junhua-Liao/LR-ASD) the way its
Columbia demo prepares them: 25 fps, 224×224 crop around the face → grey 112×112 centre, MFCC 13 × 100 Hz (4 audio
frames per video frame), scores averaged over several window lengths. CPU only (the model is ~1M parameters).
"""
import math
import subprocess

import cv2
import numpy as np
import python_speech_features
import torch
import torch.nn as nn
from scipy import signal

from model.Model import ASD_Model

FPS = 25
SCAN_W = 640  # face DETECTION on a 640-wide copy; the crops come from full-resolution frames
CROP_MAX_W = 1920  # (cutawan measured: crops from a 640 copy dropped the true speaker's logit 2.83 → 0.17)
DET_STRIDE = 2  # detect every 2nd frame (the tracks interpolate between)
CROP_SCALE = 0.40  # the demo's --cropScale
DURATIONS = (1, 1, 2, 2, 3, 4)  # the demo averages several window lengths for a steadier score


class ASDNet(nn.Module):
    """LR-ASD's model + the audio-visual head (lossAV.FC) — inference only."""

    def __init__(self):
        super().__init__()
        self.model = ASD_Model()
        self.fc = nn.Linear(128, 2)

    def load(self, path: str) -> None:
        sd = torch.load(path, map_location="cpu")
        own = {}
        for k, v in sd.items():
            k = k.replace("module.", "")
            if k.startswith("model."):
                own[k] = v
            elif k.startswith("lossAV.FC."):
                own["fc." + k[len("lossAV.FC."):]] = v
        missing, _unexpected = self.load_state_dict(own, strict=False)
        if missing:
            raise RuntimeError(f"LR-ASD weights incomplete: {missing[:4]}")
        self.eval()

    @torch.no_grad()
    def score(self, mfcc: np.ndarray, faces: np.ndarray) -> np.ndarray:
        """mfcc (≈4·T, 13), faces (T, 112, 112) uint8 → (T,) speaking score (> 0 = speaking)."""
        n = faces.shape[0]
        length = min((mfcc.shape[0] - mfcc.shape[0] % 4) / 100.0, n / FPS)  # seconds
        if length < 0.2:
            return np.full(n, -5.0)
        a_all = mfcc[: int(round(length * 100))]
        v_all = faces[: int(round(length * FPS))]
        runs = []
        for dur in DURATIONS:
            parts = []
            for i in range(int(math.ceil(length / dur))):
                a = a_all[i * dur * 100:(i + 1) * dur * 100]
                v = v_all[i * dur * FPS:(i + 1) * dur * FPS]
                if len(v) == 0 or len(a) < 4:
                    continue
                k = min(len(v), len(a) // 4)
                a, v = a[: k * 4], v[:k]
                ea = self.model.forward_audio_frontend(torch.FloatTensor(a).unsqueeze(0))
                ev = self.model.forward_visual_frontend(torch.FloatTensor(v).unsqueeze(0))
                out = self.model.forward_audio_visual_backend(ea, ev)
                parts.append(self.fc(out)[:, 1].numpy())
            if parts:
                runs.append(np.concatenate(parts))
        m = min(len(r) for r in runs)
        s = np.mean([r[:m] for r in runs], axis=0)
        return np.pad(s, (0, n - m), mode="edge") if m < n else s


def _frames(video: str, w: int, h: int):
    """BGR frames at 25 fps, w×h (frame i = time i / 25)."""
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", f"fps={FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                         stdout=subprocess.PIPE)
    size = w * h * 3
    try:
        while True:
            buf = p.stdout.read(size)
            if not buf or len(buf) < size:
                break
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3)
    finally:
        p.stdout.close()
        p.wait(timeout=60)


def _iou(a, b) -> float:
    ax2, ay2, bx2, by2 = a[0] + a[2], a[1] + a[3], b[0] + b[2], b[1] + b[3]
    iw, ih = max(0.0, min(ax2, bx2) - max(a[0], b[0])), max(0.0, min(ay2, by2) - max(a[1], b[1]))
    inter = iw * ih
    return inter / max(1e-6, a[2] * a[3] + b[2] * b[3] - inter)


def _tracks(dets: list, n_frames: int, max_gap: int = 12, min_len: int = 12) -> list:
    """Per-frame boxes → face tracks (IoU linking, gaps ≤ max_gap filled linearly, median-smoothed like the demo)."""
    done, live = [], []
    for fi, boxes in enumerate(dets):
        for b in sorted(boxes, key=lambda x: -x[2] * x[3]):
            best, best_iou = None, 0.3
            for tr in live:
                if fi - tr["f"][-1] <= max_gap and tr["f"][-1] != fi:
                    v = _iou(tr["b"][-1], b)
                    if v > best_iou:
                        best, best_iou = tr, v
            if best is None:
                best = {"f": [], "b": []}
                live.append(best)
            best["f"].append(fi)
            best["b"].append(b)
        for tr in [t for t in live if fi - t["f"][-1] > max_gap]:
            live.remove(tr)
            done.append(tr)
    done += live
    out = []
    for tr in done:
        if tr["f"][-1] - tr["f"][0] + 1 < min_len or len(tr["f"]) < min_len // 2:
            continue
        f = np.arange(tr["f"][0], tr["f"][-1] + 1)
        b = np.array(tr["b"], dtype=float)
        cx = np.interp(f, tr["f"], b[:, 0] + b[:, 2] / 2)
        cy = np.interp(f, tr["f"], b[:, 1] + b[:, 3] / 2)
        s = np.interp(f, tr["f"], np.maximum(b[:, 2], b[:, 3]) / 2)
        k = 13 if len(f) >= 13 else (len(f) // 2) * 2 + 1 if len(f) >= 3 else 1
        if k > 1:
            cx, cy, s = signal.medfilt(cx, k), signal.medfilt(cy, k), signal.medfilt(s, k)
        out.append({"f0": int(f[0]), "n": len(f), "cx": cx, "cy": cy, "s": s})
    return out


def _crop(frame: np.ndarray, cx: float, cy: float, s: float) -> np.ndarray:
    """The demo's crop: a box 2·s wide (+ CROP_SCALE margin) around the face → 224 → grey → centre 112."""
    bsi = int(s * (1 + 2 * CROP_SCALE))
    pad = np.pad(frame, ((bsi, bsi), (bsi, bsi), (0, 0)), "constant", constant_values=110)
    my, mx = cy + bsi, cx + bsi
    face = pad[int(my - s): int(my + s * (1 + 2 * CROP_SCALE)), int(mx - s * (1 + CROP_SCALE)): int(mx + s * (1 + CROP_SCALE))]
    if face.size == 0:
        return np.full((112, 112), 110, np.uint8)
    face = cv2.cvtColor(cv2.resize(face, (224, 224)), cv2.COLOR_BGR2GRAY)
    return face[56:168, 56:168]


def active_speakers(video: str, net: ASDNet, yunet_path: str) -> dict:
    """{fps, tracks: [{f0, n, cx[], cy[], w[], score[]}]} — positions normalised to the frame (0..1)."""
    pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video],
                        capture_output=True, text=True, timeout=60)
    w0, h0 = [int(x) for x in pr.stdout.strip().split(",")[:2]]
    W = SCAN_W
    H = max(2, int(round(W * h0 / w0 / 2)) * 2)
    det = cv2.FaceDetectorYN.create(yunet_path, "", (W, H), 0.6, 0.3, 5000)
    dets = []
    for fi, fr in enumerate(_frames(video, W, H)):
        boxes = []
        if fi % DET_STRIDE == 0:
            _n, faces = det.detect(fr)
            for f in (faces if faces is not None else []):
                x, y, bw, bh = float(f[0]), float(f[1]), float(f[2]), float(f[3])
                if bw >= W * 0.025:
                    boxes.append((x, y, bw, bh))
        dets.append(boxes)
    tracks = _tracks(dets, len(dets))
    if not tracks:
        return {"fps": FPS, "tracks": []}
    # pass 2: the face crops of every track, cut from full-resolution frames
    FW = min(w0, CROP_MAX_W)
    FH = max(2, int(round(FW * h0 / w0 / 2)) * 2)
    k = FW / W
    crops = [[] for _ in tracks]
    for fi, fr in enumerate(_frames(video, FW, FH)):
        for ti, tr in enumerate(tracks):
            j = fi - tr["f0"]
            if 0 <= j < tr["n"]:
                crops[ti].append(_crop(fr, tr["cx"][j] * k, tr["cy"][j] * k, tr["s"][j] * k))
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True, timeout=300).stdout
    audio = np.frombuffer(pcm, np.int16)
    mfcc = python_speech_features.mfcc(audio, 16000, numcep=13, winlen=0.025, winstep=0.010) if len(audio) > 1600 else np.zeros((0, 13))
    out = []
    for tr, cr in zip(tracks, crops):
        if len(cr) < 8:
            continue
        faces = np.array(cr)
        a = mfcc[tr["f0"] * 4: (tr["f0"] + len(faces)) * 4]
        sc = net.score(a, faces) if len(a) >= 8 else np.full(len(faces), -5.0)
        n = len(faces)
        out.append({"f0": tr["f0"], "n": n,
                    "cx": np.round(tr["cx"][:n] / W, 4).tolist(), "cy": np.round(tr["cy"][:n] / H, 4).tolist(),
                    "w": np.round(2 * tr["s"][:n] / W, 4).tolist(), "score": np.round(sc[:n], 2).tolist()})
    return {"fps": FPS, "tracks": out}
