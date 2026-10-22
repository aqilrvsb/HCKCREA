"""CLIPPER · the virtual camera: one shot of a wide (landscape) video → a 9:16 crop path, plus shot-cut detection.

    plan_shot(a, b, W, H, cw, fps, samples, asd=None, turns=None)  who to frame and how the crop moves
    crop_sendcmd(xs, fps) + crop_filter(cw, H, cmds)                  the path, frame by frame, through ffmpeg sendcmd
    crop_expr(keys)                                                   the same path as one ffmpeg expression (no side file)
    shot_cuts(video)                                                  cut times: TransNetV2 on CPU, ffmpeg scene score fallback

Camera grammar (our own code; the rules are the ones editors and auto-reframers use for talking heads):
  · the speaker is chosen per diarized TURN — each diarized speaker is matched to a face by summing LR-ASD speaking
    scores over that speaker's turns (Hungarian assignment) — and the cut lands on the turn start; backchannels
    (< 1.2 s) never take the camera; ≥ 1 s between cuts; rapid cross-talk holds the main speaker (or is a split
    screen when the two sit far apart). No turns → the per-frame LR-ASD evidence rules (as _asd_cut).
  · within one speaker the crop is LOCKED while the face stays in the central half of the crop; when it leaves,
    one cubic ease-in-out re-centre (0.5–0.8 s typical) under a speed cap — no jitter, no drift. The face path is
    smoothed both ways (median + Gaussian, zero phase) before any decision.
  · hard cuts only between different speakers (or shots), and only when the framing changes enough to read as a
    cut — a small shift between two speakers is a short pan instead (no jump cut).

Pure numpy / scipy (plan_shot, crop_*); shot_cuts needs torch + transnetv2.py + the converted weights.
"""
import subprocess

import numpy as np

# the camera inside one speaker segment
BAND = 0.25        # the face may sit ≤ 0.25·cw from the crop centre (= the central 50 %) before the camera moves
MOVE = 1.0         # the cost of one re-centre, in (band-widths off centre)² · seconds
SHORT = 4.0        # the cost per second a hold falls short of HOLD_MIN
VMAX = 0.6         # peak pan speed, crop widths per second
PAN_MIN, PAN_MAX = 0.5, 1.5  # seconds per move (the speed cap stretches a big move past 0.8 s)
HOLD_MIN = 1.0     # seconds: no static hold shorter than this between two moves
CUT_MIN = 0.30     # crop widths: a speaker change that shifts the frame less than this pans instead of cutting
# who is on camera
BACKCHANNEL = 1.2  # s: a shorter turn never takes the camera
SWITCH_GAP = 1.0   # s between two speaker cuts
EDGE = 0.6         # s: no cut this close to a shot edge (the shot cut already moved the camera)
RAPID_TURN = 2.0   # s: turns this short, alternating…
RAPID_SPAN = 4.0   # s: …for longer than this = cross-talk
SPLIT_DX = 0.38    # two faces this far apart (frame widths) can be stacked
SPLIT_SHARE = 0.4  # cross-talk covering this much of the shot → the whole shot is a split screen

TRANSNET_WEIGHTS = "/models/transnetv2.pth"


# ── helpers ───────────────────────────────────────────────────────────────────────────────────────────────────
def _fill(v):
    """NaN holes filled linearly, edges held; None when nothing is known."""
    v = np.asarray(v, float)
    ok = ~np.isnan(v)
    if not ok.any():
        return None
    i = np.arange(len(v))
    return np.interp(i, i[ok], v[ok])


def _ease(u):
    """Cubic ease-in-out (Hermite): zero speed at both ends, peak speed 1.5× the mean."""
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3.0 - 2.0 * u)


def _smooth(d, fps):
    """Zero-phase smoothing of a face path: a 1.2 s median (detector outliers, a lean or a gesture shorter than
    ~0.6 s) then a Gaussian (σ 0.25 s)."""
    from scipy.ndimage import gaussian_filter1d, median_filter
    if len(d) < 3:
        return np.asarray(d, float)
    k = max(3, int(round(1.2 * fps)) | 1)
    d = median_filter(np.asarray(d, float), size=min(k, len(d) | 1), mode="nearest")
    return gaussian_filter1d(d, sigma=max(1.0, 0.25 * fps), mode="nearest")


# ── who is in the shot ────────────────────────────────────────────────────────────────────────────────────────
def _yunet_people(ss):
    """YuNet faces of a shot clustered by x: [{cx, n, area}], the biggest presence first."""
    clusters = []
    for s in ss:
        for f in s["faces"]:
            c = next((c for c in clusters if abs(c["cx"] - f["cx"]) < 0.12), None)
            if c:
                c["n"] += 1
                c["area"] += f["w"] * f["h"]
                c["cx"] = c["cx"] * 0.8 + f["cx"] * 0.2
            else:
                clusters.append({"cx": f["cx"], "n": 1, "area": f["w"] * f["h"]})
    clusters.sort(key=lambda c: -c["area"])
    return clusters


def _yunet_cx(ss, a, cx0, n, fps, reach=0.15):
    """One person's x per output frame from the 4 fps YuNet samples (nearest face to where they were)."""
    ts, xs, prev = [], [], cx0
    first = next((s for s in ss if s["faces"]), None)
    if first:  # start where the person is at the shot's start (the cluster's x leans to where they ended)
        prev = min(first["faces"], key=lambda f: abs(f["cx"] - cx0))["cx"]
    for s in ss:
        near = [f for f in s["faces"] if abs(f["cx"] - prev) < reach]
        if near:
            prev = max(near, key=lambda f: f["w"] * f["h"])["cx"]
            ts.append(s["t"] - a)
            xs.append(prev)
    if not ts:
        return np.full(n, float(cx0))
    return np.interp(np.arange(n) / fps, ts, xs)


def _asd_people(asd, a, b):
    """LR-ASD tracks of a shot grouped into people (one seat = one person; a track breaks when the face is lost):
    per person, per ASD frame: X (cx), S (speaking score), NaN when not on screen. Left → right."""
    fa = float(asd.get("fps") or 25)
    f0, f1 = int(round(a * fa)), int(round(b * fa))
    n = f1 - f0
    if n <= 0:
        return [], fa, 0
    rows = []
    for t in asd.get("tracks") or []:
        lo, hi = max(int(t["f0"]), f0), min(int(t["f0"]) + int(t["n"]), f1)
        if hi - lo < max(3, int(0.4 * fa)):
            continue
        j = lo - int(t["f0"])
        rows.append({"lo": lo - f0, "hi": hi - f0, "cx": np.asarray(t["cx"][j:j + hi - lo], float),
                     "sc": np.asarray(t["score"][j:j + hi - lo], float), "w": np.asarray(t["w"][j:j + hi - lo], float)})
    rows.sort(key=lambda r: -(r["hi"] - r["lo"]))
    people = []
    for r in rows:
        m = float(np.median(r["cx"]))
        home = None
        for p in people:
            if abs(p["m"] - m) < 0.1 and np.sum(~np.isnan(p["X"][r["lo"]:r["hi"]])) <= 0.2 * (r["hi"] - r["lo"]):
                home = p
                break
        if home is None:
            home = {"X": np.full(n, np.nan), "S": np.full(n, np.nan), "Wd": np.full(n, np.nan), "m": m}
            people.append(home)
        sl = slice(r["lo"], r["hi"])
        free = np.isnan(home["X"][sl])
        for key, v in (("X", r["cx"]), ("S", r["sc"]), ("Wd", r["w"])):
            home[key][sl][free] = v[free]
    out = []
    for p in people:
        cov = float(np.mean(~np.isnan(p["X"])))
        if cov >= 0.15:
            p.update(cov=cov, m=float(np.nanmedian(p["X"])), size=float(np.nanmedian(p["Wd"])))
            out.append(p)
    out.sort(key=lambda p: p["m"])
    return out, fa, n


def _person_cx(p, fa, n, fps, ss, a):
    """A person's x per output frame: the 25 fps ASD track, holes filled from YuNet samples at the same seat."""
    t = np.arange(n) / fps
    k = np.clip(np.round(t * fa).astype(int), 0, len(p["X"]) - 1)
    x = p["X"][k].copy()
    if np.isnan(x).any():
        ts, xs = [], []
        for s in ss:
            near = [f for f in s["faces"] if abs(f["cx"] - p["m"]) < 0.12]
            if near:
                ts.append(s["t"] - a)
                xs.append(min(near, key=lambda f: abs(f["cx"] - p["m"]))["cx"])
        if ts:
            x = np.where(np.isnan(x), np.interp(t, ts, xs), x)
    f = _fill(x)
    return f if f is not None else np.full(n, p["m"])


# ── who talks when ────────────────────────────────────────────────────────────────────────────────────────────
def _map_speakers(T, people, fa, n):
    """Diarized speaker → person: Σ LR-ASD score (clipped ±3) over the speaker's turns, Hungarian on speaker × person.
    A speaker whose best face never looks like talking (sum ≤ 0, or < 0.5 s seen) stays unmapped (off screen)."""
    from scipy.optimize import linear_sum_assignment
    spks = sorted({k for _, _, k in T}, key=str)
    M = np.zeros((len(spks), len(people)))
    seen = np.zeros_like(M)
    for s, e, k in T:
        i = spks.index(k)
        k0, k1 = int(round(s * fa)), min(n, int(round(e * fa)))
        for j, p in enumerate(people):
            v = p["S"][k0:k1]
            v = v[~np.isnan(v)]
            M[i, j] += float(np.clip(v, -3, 3).sum())
            seen[i, j] += len(v)
    r, c = linear_sum_assignment(-M)
    mapping = {spks[i]: int(j) for i, j in zip(r, c) if M[i, j] > 0 and seen[i, j] >= 0.5 * fa}
    return mapping, {str(spks[i]): [round(float(v), 1) for v in M[i]] for i in range(len(spks))}


def _crosstalk(T, dur):
    """Windows of rapid exchange: ≥ 3 alternating turns each < 2 s spanning > 4 s, or ≥ 40 % overlapped speech
    (turns ≥ 1.2 s) over 4 s. [(s, e)] in shot seconds."""
    wins, run = [], []

    def flush():
        if len(run) >= 3 and run[-1][1] - run[0][0] > RAPID_SPAN:
            wins.append([run[0][0], run[-1][1]])

    for t in T:
        short = t[1] - t[0] < RAPID_TURN
        if short and run and t[2] != run[-1][2] and t[0] - run[-1][1] < 1.0:
            run.append(t)
            continue
        flush()
        run = [t] if short else []
    flush()
    # overlapped speech (both really talking at once — backchannels don't count), 10 Hz
    n = int(dur * 10) + 1
    if n > 40:
        cnt = np.zeros(n)
        for k in {t[2] for t in T}:
            on = np.zeros(n, bool)
            for s, e, kk in T:
                if kk == k and e - s >= BACKCHANNEL:
                    on[int(s * 10):int(e * 10) + 1] = True
            cnt += on
        both = np.convolve((cnt >= 2).astype(float), np.ones(40) / 40, mode="same")
        hot = both >= 0.4
        i = 0
        while i < n:
            if hot[i]:
                j = i
                while j + 1 < n and hot[j + 1]:
                    j += 1
                wins.append([max(0.0, i / 10 - 2), min(dur, j / 10 + 2)])
                i = j + 1
            else:
                i += 1
    wins.sort()
    merged = []
    for w in wins:
        if merged and w[0] - merged[-1][1] < 1.0:
            merged[-1][1] = max(merged[-1][1], w[1])
        else:
            merged.append(list(w))
    return merged


def _turn_segments(turns, people, a, b, fa, n, dur):
    """Speaker per TURN: [(t0, t1, person, spk)] in shot seconds, plus the cross-talk windows and the mapping."""
    T0 = sorted(((max(float(t["s"]), a) - a, min(float(t["e"]), b) - a, t["spk"]) for t in turns
                 if float(t["e"]) > a and float(t["s"]) < b and min(float(t["e"]), b) - max(float(t["s"]), a) > 0.05),
                key=lambda t: (t[0], t[1], str(t[2])))
    if not T0:
        return None
    by = {}
    for s, e, k in T0:  # one speaker's turns split by a short pause = one turn
        L = by.setdefault(k, [])
        if L and s - L[-1][1] < 0.5:
            L[-1][1] = max(L[-1][1], e)
        else:
            L.append([s, e])
    T = sorted(((s, e, k) for k, L in by.items() for s, e in L), key=lambda t: (t[0], t[1], str(t[2])))
    mapping, M = _map_speakers(T, people, fa, n)
    if not mapping:
        return None
    long = [t for t in T if t[1] - t[0] >= BACKCHANNEL and t[2] in mapping]
    if not long:
        return None
    talk = {}
    for s, e, k in long:
        talk[k] = talk.get(k, 0.0) + e - s
    main = max(talk, key=talk.get)
    # floor changes: every long turn's start; and when a turn ends, whoever is still mid-turn takes the floor back
    ev = [(s, k, e) for s, e, k in long]
    for s, e, k in long:
        for s2, e2, k2 in long:
            if k2 != k and s2 < e and e2 - e >= BACKCHANNEL:
                ev.append((e, k2, e2))
    wins = _crosstalk(T, dur)
    if wins:  # cross-talk: no cuts inside; the main speaker holds the camera, then whoever still has the floor
        ev = [x for x in ev if not any(w0 < x[0] < w1 for w0, w1 in wins)]
        for w0, w1 in wins:
            ev.append((w0, main, w1))
            act = [t for t in long if t[0] < w1 < t[1] and t[1] - w1 >= 0.6]
            if act:
                s, e, k = max(act, key=lambda t: t[0])
                ev.append((w1, k, e))
    ev.sort(key=lambda x: (x[0], -x[2]))
    first = [t for t in long if t[0] <= 0.3 < t[1]] or long
    cur = first[0][2]
    segs, last = [[0.0, cur]], -1e9
    for t, k, e in ev:
        if k == cur:
            continue
        t2 = max(t, last + SWITCH_GAP)
        if t2 > e - 0.5 or t2 > dur - EDGE:
            continue
        if t2 < EDGE and len(segs) == 1:
            segs[0][1] = cur = k  # the turn starts right after the shot cut: it opens the shot
            continue
        segs.append([t2, k])
        cur, last = k, t2
    out = [(s, segs[i + 1][0] if i + 1 < len(segs) else dur, mapping[k], k) for i, (s, k) in enumerate(segs)]
    share = sum(min(w1, dur) - max(w0, 0) for w0, w1 in wins) / max(dur, 1e-6)
    said = {}  # the two people who talk most here (every turn counts: cross-talk is short turns)
    for s, e, k in T:
        if k in mapping:
            said[k] = said.get(k, 0.0) + e - s
    pair = sorted({mapping[k] for k in sorted(said, key=said.get, reverse=True)[:2]})
    return out, wins, share, pair, {"map": {str(k): v for k, v in mapping.items()}, "scores": M, "main": str(main)}


def _asd_rule_segments(people, fa, n):
    """No turns: per-frame LR-ASD evidence (_asd_cut's rules) — the speaker's score > 1 and > the next by 1; a rival
    must lead 0.4 s; ≥ 1 s between switches. [(t0, t1, person, None)] or None on weak evidence."""
    if len(people) < 2 or n < fa:
        return None
    S = np.array([np.where(np.isnan(p["S"]), -9.0, p["S"]) for p in people])
    S = np.array([np.convolve(r, np.ones(7) / 7, mode="same") for r in S])
    order = np.sort(S, axis=0)
    best, top, second = S.argmax(0), order[-1], order[-2]
    ev = (top > 1.0) & (top - second > 1.0)
    if ev.mean() < 0.3:
        return None
    fps = int(round(fa))
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
    return [(s0 / fa, s1 / fa, p, None) for s0, s1, p in segs]


# ── how the camera moves inside one speaker run ───────────────────────────────────────────────────────────────
def _holds(d, fps, cw):
    """Where the camera locks: the face path cut into static holds by dynamic programming (5 Hz decisions).
    Hard rule: inside a hold the face stays within BAND of the crop centre. Cost: the face's squared distance from
    the centre (band² · s) + MOVE per re-centre + SHORT per second a hold falls under HOLD_MIN — so a static
    person is framed centred, a drift gets as few moves as framing allows, and nothing hunts.
    [[f0, f1, x]] in frames."""
    n, band = len(d), BAND * cw
    step = max(1, int(round(fps / 5)))
    dd = np.asarray(d[::step], float)
    m, r = len(dd), fps / step
    S1 = np.concatenate([[0.0], np.cumsum(dd)])
    S2 = np.concatenate([[0.0], np.cumsum(dd * dd)])
    best = np.full(m + 1, np.inf)
    best[0] = 0.0
    arg, pos = np.zeros(m + 1, int), np.zeros(m + 1)
    hmin, lmax, b2 = HOLD_MIN * r, int(60 * r), band * band
    for j in range(1, m + 1):
        lo = hi = dd[j - 1]
        for i in range(j - 1, max(-1, j - 1 - lmax), -1):
            v = dd[i]
            lo, hi = min(lo, v), max(hi, v)
            if hi - lo > 2 * band:
                break
            L = j - i
            s1, s2 = S1[j] - S1[i], S2[j] - S2[i]
            P = min(max(s1 / L, hi - band), lo + band)
            c = best[i] + (s2 - 2 * P * s1 + L * P * P) / b2 / r
            if i > 0:
                c += MOVE
            if L < hmin and m > hmin:
                c += SHORT * (hmin - L) / r
            if c < best[j]:
                best[j], arg[j], pos[j] = c, i, P
    holds, j = [], m
    while j > 0:
        i = int(arg[j])
        holds.append([i * step, min(n, j * step), float(pos[j])])
        j = i
    holds.reverse()
    k = 0
    while k < len(holds) - 1:  # a re-centre too small to see is no re-centre (and long holds split at lmax rejoin)
        A, B = holds[k], holds[k + 1]
        if abs(A[2] - B[2]) < 0.06 * cw:
            la, lb = A[1] - A[0], B[1] - B[0]
            holds[k:k + 2] = [[A[0], B[1], (A[2] * la + B[2] * lb) / (la + lb)]]
        else:
            k += 1
    return holds


def _path(d, fps, cw):
    """A locked/eased crop path for one speaker run: (xs per frame, keys [[t0, t1, x0, x1]] in run seconds)."""
    n = len(d)
    holds = _holds(d, fps, cw)
    xs = np.empty(n)
    moves = []
    for k in range(len(holds) - 1):
        A, B = holds[k], holds[k + 1]
        dP = B[2] - A[2]
        T = min(PAN_MAX, max(PAN_MIN, 1.5 * abs(dP) / (VMAX * cw)))
        L = max(2, int(round(T * fps)))
        lo = A[0] + ((A[1] - A[0]) // 2 if k > 0 else 0)  # each hold lends at most half to a move
        hi = B[0] + (B[1] - B[0]) // 2 if k + 1 < len(holds) - 1 else B[1]
        s = max(lo, A[1] - L // 2)
        e = min(hi, s + L)
        s = max(lo, min(s, e - L))
        moves.append((s, e, A[2], B[2]))
    k = 0
    while k < len(moves) - 1:  # moves the same way with (almost) no rest between = one move (no stop-go stutter)
        s0, e0, a0, b0 = moves[k]
        s1, e1, a1, b1 = moves[k + 1]
        if s1 - e0 < 0.5 * fps and (b0 - a0) * (b1 - a1) > 0:
            moves[k:k + 2] = [(s0, e1, a0, b1)]
            del holds[k + 1]
        else:
            k += 1
    keys = []
    for k, Hk in enumerate(holds):
        s = moves[k - 1][1] if k > 0 else 0
        e = moves[k][0] if k < len(moves) else n
        xs[s:e] = Hk[2]
        if e > s:
            keys.append([s, e, Hk[2], Hk[2]])
        if k < len(moves):
            ms, me, x0, x1 = moves[k]
            u = (np.arange(ms, me) - ms) / max(1, me - ms)  # same phase as crop_expr's (t - t0) / T
            xs[ms:me] = x0 + (x1 - x0) * _ease(u)
            keys.append([ms, me, x0, x1])
    return xs, [[s / fps, e / fps, round(float(x0), 1), round(float(x1), 1)] for s, e, x0, x1 in keys]


# ── one shot ──────────────────────────────────────────────────────────────────────────────────────────────────
def plan_shot(a, b, W, H, cw, fps, samples, asd=None, turns=None) -> dict:
    """The camera for shot [a, b) (clip seconds) of a W×H source cropped cw wide (H·9/16) at `fps`.

    samples: YuNet samples [{t, faces: [{cx, cy, w, h, s}]}] (0..1) for the whole clip; asd: LR-ASD
    {fps, tracks: [{f0, n, cx[], cy[], w[], score[]}]} or None; turns: diarization [{s, e, spk}] (clip s) or None.

    → {layout: static|follow|speaker|split|none, xs: crop x (px) per output frame (len round((b-a)·fps)),
       switches: hard speaker cuts, keys: [[t0, t1, x0, x1]] (shot seconds; x0 == x1 = locked, else cubic ease;
       a jump between keys = cut) for crop_expr, split: [cx_left, cx_right] (split only), split_windows:
       [[s, e]] clip seconds of cross-talk between two far-apart people (the caller may split just those),
       targets: debug}."""
    n = max(1, int(round((b - a) * fps)))
    dur = n / fps
    xmax = max(0.0, W - cw)
    ss = [s for s in samples or [] if a <= s["t"] < b]
    withf = [s for s in ss if s["faces"]]
    if not ss or len(withf) < max(1, len(ss) * 0.3):
        return {"layout": "none", "xs": [], "switches": 0, "keys": [], "targets": []}
    clusters = _yunet_people(withf)
    people, fa, na = _asd_people(asd, a, b) if asd and asd.get("tracks") else ([], 25.0, 0)
    segs, how, info, wins = None, "main", {}, []
    if len(people) >= 2:
        if turns:
            r = _turn_segments(turns, people, a, b, fa, na, dur)
            if r:
                segs, wins, share, pair, info = r
                how = "turns"
                far = len(pair) == 2 and abs(people[pair[0]]["m"] - people[pair[1]]["m"]) > SPLIT_DX
                if far and share >= SPLIT_SHARE:
                    return {"layout": "split", "xs": [], "switches": 0, "keys": [],
                            "split": [round(float(people[pair[0]]["m"]), 4), round(float(people[pair[1]]["m"]), 4)],
                            "targets": [{"how": "turns-crosstalk", "share": round(share, 2), **info}]}
                if not far:
                    wins = []
        if segs is None:
            segs = _asd_rule_segments(people, fa, na)
            how = "asd" if segs else how
    if segs is None:
        # nobody to follow by voice: a two-shot of two similar faces far apart → stacked halves (as _reframe)
        two = [c for c in clusters[:2] if c["n"] >= len(withf) * 0.55]
        if (len(two) == 2 and abs(two[0]["cx"] - two[1]["cx"]) > SPLIT_DX
                and min(two[0]["area"], two[1]["area"]) > 0.4 * max(two[0]["area"], two[1]["area"])):
            l, r = sorted(float(c["cx"]) for c in two)
            return {"layout": "split", "xs": [], "switches": 0, "keys": [], "split": [round(l, 4), round(r, 4)],
                    "targets": [{"how": "two-shot"}]}
        main = clusters[0]
        seat = min(people, key=lambda p: abs(p["m"] - main["cx"])) if people else None
        if seat is not None and abs(seat["m"] - main["cx"]) < 0.1 and seat["cov"] >= 0.5:
            cx = _person_cx(seat, fa, n, fps, ss, a)
        else:
            cx = _yunet_cx(ss, a, main["cx"], n, fps)
        tracks = [(0, n, cx, None, None)]
    else:
        cache, tracks = {}, []
        for t0, t1, p, spk in segs:
            f0, f1 = int(round(t0 * fps)), min(n, int(round(t1 * fps)))
            if f1 <= f0:
                continue
            if p not in cache:
                cache[p] = _person_cx(people[p], fa, n, fps, ss, a)
            if tracks and tracks[-1][3] == p:
                tracks[-1] = (tracks[-1][0], f1, cache[p], p, spk)
            else:
                tracks.append((tracks[-1][1] if tracks else 0, f1, cache[p], p, spk))
        if not tracks:
            tracks = [(0, n, _yunet_cx(ss, a, clusters[0]["cx"], n, fps), None, None)]
        tracks[-1] = (tracks[-1][0], n, *tracks[-1][2:])  # contiguous, to the shot's last frame
    # the desired crop x (face centred), then runs: a new run (hard cut) only where the framing really changes
    d = np.empty(n)
    for f0, f1, cx, _p, _s in tracks:
        d[f0:f1] = np.clip(cx[f0:f1] * W - cw / 2, 0, xmax)
    runs = [[tracks[0][0], tracks[0][1]]]
    for f0, f1, *_ in tracks[1:]:
        before = float(np.median(d[max(runs[-1][0], f0 - int(fps)):f0]))
        after = float(np.median(d[f0:min(f1, f0 + int(fps))]))
        if abs(after - before) >= CUT_MIN * cw:
            runs.append([f0, f1])
        else:
            runs[-1][1] = f1
    xs, keys = np.empty(n), []
    for r0, r1 in runs:
        xr, kr = _path(_smooth(d[r0:r1], fps), fps, cw)
        xs[r0:r1] = xr
        keys += [[round(r0 / fps + k[0], 4), round(r0 / fps + k[1], 4), k[2], k[3]] for k in kr]
    xs = np.clip(xs, 0, xmax)
    switches = len(runs) - 1
    moving = any(k[2] != k[3] for k in keys)
    layout = "speaker" if switches else ("follow" if moving else "static")
    targets = [{"s": round(a + f0 / fps, 2), "e": round(a + f1 / fps, 2), "who": p,
                "cx": round(float(np.median(cx[f0:f1])), 3), **({"spk": str(s)} if s is not None else {})}
               for f0, f1, cx, p, s in tracks]
    out = {"layout": layout, "xs": [round(float(x), 1) for x in xs], "switches": switches, "keys": keys,
           "targets": targets, "how": how, "cuts": [round(a + r0 / fps, 3) for r0, _ in runs[1:]]}
    if info:
        out["speakers"] = info
    if wins:
        out["split_windows"] = [[round(a + w0, 2), round(a + w1, 2)] for w0, w1 in wins]
    return out


# ── ffmpeg ────────────────────────────────────────────────────────────────────────────────────────────────────
def crop_sendcmd(xs, fps, start_time=0.0, target="crop@cam") -> str:
    """An ffmpeg sendcmd script setting crop@cam's x per output frame (a line only when x changes). Each command
    fires half a frame early so frame k gets its own x even with timestamp jitter."""
    lines, prev = [], None
    for k, x in enumerate(xs):
        xi = int(round(float(x)))
        if xi == prev:
            continue
        t = start_time + (0.0 if k == 0 else (k - 0.5) / fps)
        lines.append(f"{max(0.0, t):.4f} {target} x {xi};")
        prev = xi
    return "\n".join(lines) + "\n"


def _fpath(p) -> str:
    """A file path as a filter option value (quoted; ':' escaped for Windows drive letters)."""
    return "'" + str(p).replace("\\", "/").replace("'", "").replace(":", "\\:") + "'"


def crop_filter(cw, H, cmds="cmds.txt", x0=0, out_w=1080, out_h=1920) -> str:
    """The filter chain matching crop_sendcmd: sendcmd → crop@cam (exact: odd x allowed, 1 px steps) → scale."""
    return (f"sendcmd=f={_fpath(cmds)},crop@cam=w={int(round(cw))}:h={int(H)}:x={int(round(float(x0)))}:y=0:exact=1,"
            f"scale={out_w}:{out_h}:flags=lanczos")


def crop_expr(keys) -> str:
    """The path as one ffmpeg expression in t (shot seconds) for crop's x: locked pieces are constants, moves are
    the exact cubic ease. keys = plan_shot()['keys']."""
    if not keys:
        return "0"
    expr = f"{keys[-1][3]}"
    for t0, t1, x0, x1 in reversed(keys):
        T = max(1e-3, t1 - t0)
        if abs(x1 - x0) < 0.5:
            seg = f"{x0}"
        else:
            u = f"clip((t-{t0})/{T:.4f},0,1)"
            seg = f"{x0}+({round(x1 - x0, 1)})*{u}*{u}*(3-2*{u})"
        expr = f"if(lt(t,{t1}),{seg},{expr})"
    return expr


# ── shot cuts ─────────────────────────────────────────────────────────────────────────────────────────────────
def _probe_fps(path: str) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=avg_frame_rate,r_frame_rate",
                        "-of", "csv=p=0", path], capture_output=True, text=True, timeout=60)
    for v in r.stdout.strip().replace("\n", ",").split(","):
        try:
            a, b = (v.split("/") + ["1"])[:2]
            f = float(a) / float(b)
            if 1 < f < 240:
                return f
        except (ValueError, ZeroDivisionError):
            continue
    return 25.0


def _ffmpeg_cuts(path: str, thr: float = 0.3) -> list:
    import re
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", path, "-an", "-vf", f"scale=192:-2,select='gt(scene,{thr})',showinfo",
                        "-f", "null", "-"], capture_output=True, text=True, errors="replace", timeout=600)
    cuts = []
    for m in re.finditer(r"pts_time:([0-9.]+)", r.stderr):
        t = round(float(m.group(1)), 3)
        if not cuts or t - cuts[-1] > 0.2:
            cuts.append(t)
    return cuts


_TRANSNET = None


def _transnet(weights: str):
    global _TRANSNET
    if _TRANSNET is None:
        import torch
        from transnetv2 import TransNetV2
        m = TransNetV2()
        m.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
        m.eval()
        _TRANSNET = m
    return _TRANSNET


def transnet_predict(frames, weights: str = TRANSNET_WEIGHTS, batch: int = 4):
    """Per-frame cut probability for uint8 frames [N, 27, 48, 3] RGB (the reference windowing: 100-frame windows,
    stride 50, the middle 50 kept; the first/last frame repeated as padding)."""
    import torch
    model = _transnet(weights)
    n = len(frames)
    pad_end = 25 + 50 - (n % 50 if n % 50 else 50)
    x = np.concatenate([np.repeat(frames[:1], 25, 0), frames, np.repeat(frames[-1:], pad_end, 0)])
    wins = [x[i:i + 100] for i in range(0, len(x) - 99, 50)]
    out = []
    with torch.inference_mode():
        for i in range(0, len(wins), batch):
            single, _many = model(torch.from_numpy(np.ascontiguousarray(np.stack(wins[i:i + batch]))))
            out.append(torch.sigmoid(single).numpy()[:, 25:75, 0])
    return np.concatenate(out).reshape(-1)[:n]


def shot_cuts(video_path, weights: str = TRANSNET_WEIGHTS, thr: float = 0.5, min_gap: float = 0.5) -> list:
    """Shot changes (seconds, the first frame of each new shot): TransNetV2 on 48×27 frames (CPU); the ffmpeg scene
    score (> 0.3) when the model can't run. A transition longer than 3 frames (dissolve) cuts at its middle."""
    path = str(video_path)
    try:
        fps = _probe_fps(path)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-an", "-vf", "scale=48:27", "-pix_fmt", "rgb24",
                              "-f", "rawvideo", "-"], capture_output=True, timeout=900).stdout
        frames = np.frombuffer(raw, np.uint8)
        frames = frames[: len(frames) // 3888 * 3888].reshape(-1, 27, 48, 3)
        if len(frames) < 2:
            return []
        p = transnet_predict(frames, weights)
    except Exception as e:  # noqa: BLE001
        print("transnet unavailable, ffmpeg scene cuts instead:", str(e)[:200], flush=True)
        return _ffmpeg_cuts(path)
    hit, n, cuts, i = p > thr, len(p), [], 0
    while i < n:
        if not hit[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and hit[j + 1]:
            j += 1
        f = j + 1 if j - i < 3 else (i + j + 1) // 2  # a cut is marked on the outgoing shot's last frame
        t = round(f / fps, 3)
        if 0 < f < n and (not cuts or t - cuts[-1] >= min_gap):
            cuts.append(t)
        i = j + 1
    return cuts
