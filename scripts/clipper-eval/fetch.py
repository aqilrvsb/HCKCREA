"""CLIPPER director eval — fetch the dataset (answer key + transcript) through the DEPLOYED Modal function.

For every video in videos.json: title / duration, YouTube's "most replayed" heatmap (~100 buckets) and the caption
lines, read by peninglab-motion.yt_task("info", ...) — the same reader (WARP proxy, json3 → lines) the CLIPPER
analysis uses in production. One JSON per video id is cached in <dir>/videos/<id>.json, so reruns are free.
Videos with no heatmap or no captions are skipped (listed in <dir>/fetch-report.json).

    py -3 scripts/clipper-eval/fetch.py --dir <cache dir> [--backups] [--only ID,ID] [--force] [--workers 4]

Uses MODAL_PROFILE=aqilrvsb unless MODAL_PROFILE is already set. Never deploys or activates anything.
"""
import argparse
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

os.environ.setdefault("MODAL_PROFILE", "aqilrvsb")  # before `import modal`: the profile is read at import time
try:
    sys.stdout.reconfigure(encoding="utf-8")  # titles carry non-ASCII; the Windows console default is cp1252
except Exception:  # noqa: BLE001
    pass

HERE = Path(__file__).resolve().parent
MAX_TRIES = 4
# caption languages accepted per videos.json "lang" (YouTube often labels Malay speech "id": its id-orig ASR is fine)
LANG_OK = {"ms": {"ms", "id"}, "en": {"en"}}


def fetch_one(fn, vid: dict, out: Path, force: bool) -> dict:
    vid_id = vid["id"]
    dest = out / f"{vid_id}.json"
    want = LANG_OK.get(vid.get("lang", "ms"), {vid.get("lang", "ms")})
    if dest.exists() and not force:
        d = json.loads(dest.read_text(encoding="utf-8"))
        if (d.get("lang") or "").split("-")[0] in want:  # (a cache from before the language check may be a dub track)
            return {"id": vid_id, "ok": True, "cached": True, "title": d["meta"].get("title"), "duration": d["meta"].get("duration"),
                    "heat": len(d["heat"]), "lines": len(d["lines"]), "lang": d.get("lang")}
        dest.unlink()
    url = f"https://www.youtube.com/watch?v={vid_id}"
    last: dict = {}
    for attempt in range(1, MAX_TRIES + 1):
        t0 = time.time()
        try:
            r = fn.remote("info", url, {"want": "auto", "via": "warp", "fresh": True})
        except Exception as e:  # noqa: BLE001
            r = {"ok": False, "error": f"modal call failed: {str(e)[:300]}"}
        sec = round(time.time() - t0, 1)
        if r.get("ok"):
            heat, lines = r.get("heat") or [], r.get("lines") or []
            title = (r.get("meta") or {}).get("title")
            if not heat:  # no "most replayed" graph: no answer key (doesn't change between tries)
                return {"id": vid_id, "ok": False, "skip": "no heatmap", "title": title, "lines": len(lines)}
            # empty captions = the caption track was refused (429) on this exit; a wrong language = the reader fell
            # back to a dubbed track (e.g. "ar-orig" on an English video) — both are worth a fresh exit
            if len(lines) < 3 or (r.get("lang") or "").split("-")[0] not in want:
                last = {"error": f"captions: {len(lines)} lines, lang={r.get('lang')} (want {'/'.join(sorted(want))})", "retry": True, "title": title}
                print(f"  {vid_id}: try {attempt}/{MAX_TRIES}: {last['error']}", flush=True)
                time.sleep(2 * attempt)
                continue
            rec = {"id": vid_id, "url": url, "lang_hint": vid.get("lang", "ms"), "channel_note": vid.get("channel"),
                   "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "fetch_sec": sec, "tries": attempt,
                   "meta": r.get("meta") or {}, "lang": r.get("lang"), "heat": heat, "lines": lines}
            dest.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
            return {"id": vid_id, "ok": True, "tries": attempt, "sec": sec, "title": rec["meta"].get("title"),
                    "duration": rec["meta"].get("duration"), "heat": len(heat), "lines": len(lines), "lang": r.get("lang")}
        last = r
        print(f"  {vid_id}: try {attempt}/{MAX_TRIES} failed ({'blocked' if r.get('blocked') else 'error'}, {sec}s): {str(r.get('error'))[:160]}", flush=True)
        if not r.get("blocked") and not r.get("nowarp") and "modal call failed" not in str(r.get("error")):
            break  # a real error (private / unavailable video): retrying won't help
        time.sleep(2 * attempt)
    return {"id": vid_id, "ok": False, "error": str(last.get("error"))[:300], "blocked": bool(last.get("blocked")), "title": last.get("title")}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dir", default=os.environ.get("CLIPPER_EVAL_DIR") or os.path.join(tempfile.gettempdir(), "clipper-eval"))
    ap.add_argument("--list", default=str(HERE / "videos.json"))
    ap.add_argument("--only", default="", help="comma-separated video ids")
    ap.add_argument("--backups", action="store_true", help="also fetch the videos marked backup")
    ap.add_argument("--force", action="store_true", help="refetch even when cached")
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()

    vids = json.loads(Path(a.list).read_text(encoding="utf-8"))["videos"]
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    if only:
        vids = [v for v in vids if v["id"] in only]
    else:
        vids = [v for v in vids if not v.get("exclude") and (a.backups or not v.get("backup"))]
    out = Path(a.dir) / "videos"
    out.mkdir(parents=True, exist_ok=True)

    import modal
    fn = modal.Function.from_name("peninglab-motion", "yt_task")
    print(f"fetching {len(vids)} videos → {out}", flush=True)
    with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
        res = list(ex.map(lambda v: fetch_one(fn, v, out, a.force), vids))
    for r in res:
        if r.get("ok"):
            how = "(cached)" if r.get("cached") else f"tries={r.get('tries')}"
            print(f"OK   {r['id']}  {round((r.get('duration') or 0) / 60):>4} min  heat={r['heat']:<3} lines={r['lines']:<5} "
                  f"lang={r.get('lang')}  {how}  {r.get('title')}")
        else:
            print(f"FAIL {r['id']}  {r.get('skip') or r.get('error')}  {r.get('title') or ''}")
    (Path(a.dir) / "fetch-report.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    ok = sum(1 for r in res if r.get("ok"))
    print(f"{ok}/{len(res)} videos usable")


if __name__ == "__main__":
    main()
