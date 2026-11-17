"""Render the demo set to backend/samples/out/ (+ thumbnails and expected results).

Usage:  python -m samples.generate         (from backend/)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from samples.catalog import SAMPLES  # noqa: E402
from samples.render import pdf_to_image, render_pdf, save_jpg, to_phone_photo, to_scan  # noqa: E402

OUT = Path(__file__).resolve().parent / "out"


def build() -> list[dict]:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for s in SAMPLES:
        pdf = render_pdf(s.doc, OUT / f"{s.id}.pdf", s.layout, s.accent)
        if s.form == "pdf":
            path = pdf
            preview = pdf_to_image(pdf, 60)
        else:
            img = pdf_to_image(pdf, 120)
            img = to_scan(img, seed=3) if s.form == "scan" else to_phone_photo(img, **s.photo)
            path = save_jpg(img, OUT / f"{s.id}.jpg")
            pdf.unlink()
            preview = img
        h, w = preview.shape[:2]
        thumb = cv2.resize(preview, (240, int(240 * h / w)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(str(OUT / f"{s.id}_thumb.png"), thumb)
        rows.append({"id": s.id, "title": s.title, "hint": s.hint, "file": path.name, "form": s.form,
                     "expect": s.expect, "expect_flags": s.expect_flags, "headline": s.headline})
        print(f"  {s.id:18} {path.name:22} expect={s.expect:7} flags={s.expect_flags}")
    (OUT / "expected.json").write_text(json.dumps(rows, indent=1))
    return rows


if __name__ == "__main__":
    build()
