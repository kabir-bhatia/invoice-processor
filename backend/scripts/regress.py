"""Regression runner: every demo sample must produce its expected recommendation and flags.

Usage (from backend/):  ../.venv/Scripts/python scripts/regress.py [sample_id ...]
Each sample runs on a freshly reset database (reading cache kept), so results don't depend on order.
"""
import os
import sys
from pathlib import Path
os.environ.setdefault("AP_STAGE_MIN_SECONDS", "0")
# Tests run on their own copy of the data so they never wipe the live app's database.
_LIVE = Path(__file__).resolve().parents[1] / "var" / "ap.db"
os.environ["AP_DATA_DIR"] = str(Path(__file__).resolve().parents[1] / "var" / "test")
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import db, pipeline, seed  # noqa: E402
from samples.catalog import SAMPLES  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "samples" / "out"
DEMO_TODAY = "2026-11-17"


def run_one(s):
    seed.reset()
    db.set_kv("today", DEMO_TODAY)
    f = next(OUT.glob(f"{s.id}.*[!g]")) if (OUT / f"{s.id}.pdf").exists() else OUT / f"{s.id}.jpg"
    f = OUT / f"{s.id}.pdf" if (OUT / f"{s.id}.pdf").exists() else OUT / f"{s.id}.jpg"
    inv = pipeline.create_invoice(f.read_bytes(), f.name, "sample", s.id)
    t = time.time()
    d = pipeline.run(inv)
    return d, time.time() - t


def copy_cache():
    """Reuse the live app's reading cache (saves model calls); everything else starts from seed."""
    import sqlite3
    if not _LIVE.exists():
        return
    src = sqlite3.connect(_LIVE)
    rows = src.execute("SELECT hash, data, meta, created_at FROM extraction_cache").fetchall()
    with db.tx() as c:
        c.executemany("INSERT OR IGNORE INTO extraction_cache VALUES(?,?,?,?)", rows)


if __name__ == "__main__":
    copy_cache()
    want = set(sys.argv[1:])
    fails = 0
    for s in SAMPLES:
        if want and s.id not in want:
            continue
        d, secs = run_one(s)
        if not d:
            print(f"FAIL {s.id:18} pipeline error"); fails += 1; continue
        dec = d["decision"]
        codes = [f["code"] for f in d["flags"]]
        ok = dec["recommendation"] == s.expect and all(c in codes for c in s.expect_flags)
        fails += not ok
        print(f"{'PASS' if ok else 'FAIL'} {s.id:18} {dec['recommendation']:7} (want {s.expect:7}) score={dec['trust_score']:3} "
              f"{secs:5.1f}s  flags={codes}")
        print(f"      headline: {dec['headline']}")
        if not ok:
            for fl in d["flags"]:
                print(f"        [{fl['severity']}] {fl['code']}: {fl['message']}")
    print(f"\n{'ALL PASS' if not fails else f'{fails} FAILED'}")
    sys.exit(1 if fails else 0)
