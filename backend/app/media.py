"""Loading uploaded files into page images + text layer, and image quality scoring (stage 1)."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

import cv2
import fitz  # PyMuPDF
import numpy as np

MAX_PAGES = 4
MAX_SIDE = 2000


@dataclass
class Loaded:
    kind: str                         # pdf | image
    pages: list[bytes]                # PNG/JPEG bytes sent to the model
    previews: list[bytes]             # PNG bytes shown in the UI
    text_layer: str = ""
    page_count: int = 1
    quality: dict = field(default_factory=dict)


class UnsupportedFile(Exception):
    pass


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sniff(b: bytes, name: str = "") -> str:
    if b[:4] == b"%PDF":
        return "pdf"
    if b[:3] == b"\xff\xd8\xff" or b[:8] == b"\x89PNG\r\n\x1a\n" or b[:4] in (b"RIFF",):
        return "image"
    if b[4:12] in (b"ftypheic", b"ftypheix", b"ftypmif1", b"ftyphevc"):
        return "heic"
    n = name.lower()
    if n.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return "image"
    return "unknown"


def _encode_png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    return buf.tobytes()


def _fit(img: np.ndarray, side: int = MAX_SIDE) -> np.ndarray:
    h, w = img.shape[:2]
    s = side / max(h, w)
    return cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else img


def load(b: bytes, name: str = "") -> Loaded:
    kind = sniff(b, name)
    if kind == "pdf":
        try:
            doc = fitz.open(stream=b, filetype="pdf")
        except Exception as e:  # corrupted
            raise UnsupportedFile(f"PDF could not be opened ({e.__class__.__name__})")
        if doc.needs_pass:
            raise UnsupportedFile("PDF is password-protected")
        pages, previews, text = [], [], []
        for i, page in enumerate(doc):
            if i >= MAX_PAGES:
                break
            png = page.get_pixmap(dpi=150).tobytes("png")
            pages.append(png)
            previews.append(png)
            text.append(page.get_text())
        q = quality(cv2.imdecode(np.frombuffer(pages[0], np.uint8), cv2.IMREAD_COLOR)) if pages else {}
        return Loaded("pdf", pages, previews, "\n".join(text), len(doc), q)
    if kind == "image":
        img = cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise UnsupportedFile("Image could not be decoded")
        img = _fit(img)
        png = _encode_png(img)
        return Loaded("image", [png], [png], "", 1, quality(img))
    if kind == "heic":
        raise UnsupportedFile("HEIC photo — please export as JPG")
    raise UnsupportedFile("Unsupported file type — upload a PDF, JPG or PNG")


def quality(img: np.ndarray) -> dict:
    """Sharpness (Laplacian variance), brightness, glare, and 'is there a page at all'.
    Page test is relative (Otsu split), so a dim photo of a screen or a page in poor light still counts:
      paper  = share of pixels on the light side of the split that are colourless
      edges  = share of pixels on a sharp edge (text strokes)
      colour = share of strongly coloured pixels (skin, scenery)
    Same maths as the in-browser check in frontend/src/lib/quality.ts."""
    small = _fit(img, 420)
    b, g_, r = [small[..., i].astype(np.float32) for i in range(3)]
    y = 0.299 * r + 0.587 * g_ + 0.114 * b
    chroma = small.max(axis=2).astype(np.float32) - small.min(axis=2).astype(np.float32)
    y8 = np.clip(y, 0, 255).astype(np.uint8)
    otsu, _ = cv2.threshold(y8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    paper = float(((y > max(otsu, 60)) & (chroma < 45)).mean())
    colour = float((chroma > 60).mean())
    lap = cv2.Laplacian(y, cv2.CV_32F, ksize=1)
    edges = float((np.abs(lap) > 40).mean())
    var = float(lap.var())
    sharp = min(1.0, var / 420.0)
    bright = float(y.mean()) / 255.0
    glare = float((y >= 253).mean())
    document = paper >= 0.12 and edges >= 0.02 and colour < 0.35
    issues = []
    if not document:
        issues.append("no document in view")
    if var < 55:
        issues.append("blurry")
    if bright < 0.2:
        issues.append("too dark")
    if glare > 0.25:
        issues.append("glare")
    return {"sharpness": round(sharp, 2), "brightness": round(bright, 2), "glare": round(glare, 2),
            "paper": round(paper, 3), "colour": round(colour, 3), "edges": round(edges, 3),
            "document": bool(document), "ok": not issues, "issues": issues}
