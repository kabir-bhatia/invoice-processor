"""Render realistic Indian GST invoices as PDFs, and turn them into phone-photo / scan look-alikes.

Used by the sample generator (demo set) and the model spike test.
"""
from __future__ import annotations

import io
import math
import random
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import fitz  # PyMuPDF
import numpy as np
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


# ---------------------------------------------------------------- data model
@dataclass
class Line:
    description: str
    qty: float
    unit: str
    unit_price: float
    gst_rate: float = 18.0
    hsn: str = ""

    @property
    def amount(self) -> float:
        return round(self.qty * self.unit_price, 2)


@dataclass
class InvoiceDoc:
    vendor_name: str
    vendor_address: list[str]
    vendor_gstin: str | None
    vendor_state: str
    invoice_number: str | None
    invoice_date: str | None          # as printed, e.g. "14/11/2026"
    po_ref: str | None                # as printed, e.g. "PO-1042"
    lines: list[Line]
    tax_mode: str = "intra"           # "intra" -> CGST+SGST, "inter" -> IGST
    bank_name: str = "HDFC Bank"
    bank_account: str = "50200012344821"
    ifsc: str = "HDFC0001234"
    due_date: str | None = None
    payment_terms: str | None = "Net 30"
    title: str = "TAX INVOICE"
    number_label: str = "Invoice No:"
    extra_charges: list[tuple[str, float]] = field(default_factory=list)  # (label, amount) taxed at 18%
    total_override: float | None = None   # print a wrong grand total on purpose
    hidden_text: str | None = None        # tiny near-white text (prompt-injection sample)
    notes: str | None = None
    bill_to: list[str] = field(default_factory=lambda: [
        "Northwind Components Pvt Ltd",
        "Plot 42, Sector 37, Udyog Vihar",
        "Gurugram, Haryana 122001",
        "GSTIN: 06AABCN4821K1Z3",
    ])

    # ---- derived numbers
    def subtotal(self) -> float:
        return round(sum(l.amount for l in self.lines) + sum(a for _, a in self.extra_charges), 2)

    def tax_breakup(self) -> dict[float, float]:
        out: dict[float, float] = {}
        for l in self.lines:
            out[l.gst_rate] = out.get(l.gst_rate, 0) + l.amount * l.gst_rate / 100
        for _, a in self.extra_charges:
            out[18.0] = out.get(18.0, 0) + a * 0.18
        return {k: round(v, 2) for k, v in out.items()}

    def tax_total(self) -> float:
        return round(sum(self.tax_breakup().values()), 2)

    def grand_total(self) -> float:
        return round(self.subtotal() + self.tax_total(), 0)  # rounded off to rupee, like real bills


# ---------------------------------------------------------------- formatting
def inr(x: float, decimals: int = 2) -> str:
    """Indian digit grouping: 1,23,456.00"""
    neg = x < 0
    x = abs(x)
    s = f"{x:.{decimals}f}"
    whole, _, frac = s.partition(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return ("-" if neg else "") + whole + (("." + frac) if decimals else "")


# ---------------------------------------------------------------- layouts
def _layout_classic(c: canvas.Canvas, d: InvoiceDoc, accent):
    W, H = A4
    x0, y = 18 * mm, H - 18 * mm
    c.setFillColor(accent)
    c.setFont("Helvetica-Bold", 17)
    c.drawString(x0, y, d.vendor_name.upper())
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 8.5)
    for i, ln in enumerate(d.vendor_address + ([f"GSTIN: {d.vendor_gstin}"] if d.vendor_gstin else [])):
        c.drawString(x0, y - 13 - i * 10.5, ln)
    c.setFont("Helvetica-Bold", 14)
    c.drawRightString(W - x0, y, d.title)
    c.setFont("Helvetica", 9)
    meta = [(d.number_label, d.invoice_number), ("Date:", d.invoice_date), ("Your PO:", d.po_ref),
            ("Terms:", d.payment_terms), ("Due Date:", d.due_date)]
    yy = y - 16
    for k, v in meta:
        if v:
            c.drawRightString(W - x0 - 70, yy, k)
            c.drawRightString(W - x0, yy, v)
            yy -= 12
    y = min(yy, y - 13 - 10.5 * 5) - 14
    c.setStrokeColor(accent)
    c.setLineWidth(1.2)
    c.line(x0, y, W - x0, y)
    y -= 16
    c.setFont("Helvetica-Bold", 9)
    c.drawString(x0, y, "Bill To:")
    c.setFont("Helvetica", 9)
    for i, ln in enumerate(d.bill_to):
        c.drawString(x0, y - 12 - i * 11, ln)
    y -= 12 + 11 * len(d.bill_to) + 12
    return _table(c, d, x0, y, W - 2 * x0, accent, header_fill=True)


def _layout_modern(c: canvas.Canvas, d: InvoiceDoc, accent):
    W, H = A4
    x0 = 20 * mm
    c.setFillColor(accent)
    c.rect(0, H - 38 * mm, W, 38 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(x0, H - 20 * mm, "Invoice")
    c.setFont("Helvetica", 9)
    c.drawString(x0, H - 27 * mm, d.vendor_name)
    if d.vendor_gstin:
        c.drawString(x0, H - 31.5 * mm, f"GST No. {d.vendor_gstin}")
    c.setFont("Helvetica", 9)
    right = []
    if d.invoice_number:
        right.append(f"{d.number_label.rstrip(':')} {d.invoice_number}")
    if d.invoice_date:
        right.append(f"Issued {d.invoice_date}")
    if d.po_ref:
        right.append(f"Order ref {d.po_ref}")
    for i, t in enumerate(right):
        c.drawRightString(W - x0, H - 18 * mm - i * 11, t)
    c.setFillColor(colors.black)
    y = H - 50 * mm
    c.setFont("Helvetica-Bold", 8)
    c.setFillColor(colors.HexColor("#666666"))
    c.drawString(x0, y, "BILLED TO")
    c.drawString(W / 2, y, "FROM")
    c.setFillColor(colors.black)
    c.setFont("Helvetica", 9)
    for i, ln in enumerate(d.bill_to):
        c.drawString(x0, y - 12 - i * 11, ln)
    for i, ln in enumerate(d.vendor_address):
        c.drawString(W / 2, y - 12 - i * 11, ln)
    y -= 12 + 11 * max(len(d.bill_to), len(d.vendor_address)) + 16
    return _table(c, d, x0, y, W - 2 * x0, accent, header_fill=False)


def _layout_plain(c: canvas.Canvas, d: InvoiceDoc, accent):
    """Small-vendor, typed-looking bill (Courier)."""
    W, H = A4
    x0, y = 20 * mm, H - 22 * mm
    c.setFont("Courier-Bold", 15)
    c.drawCentredString(W / 2, y, d.vendor_name)
    c.setFont("Courier", 9)
    for i, ln in enumerate(d.vendor_address):
        c.drawCentredString(W / 2, y - 13 - i * 10, ln)
    yy = y - 13 - 10 * len(d.vendor_address)
    if d.vendor_gstin:
        c.drawCentredString(W / 2, yy, f"GSTIN {d.vendor_gstin}")
        yy -= 10
    c.setFont("Courier-Bold", 12)
    c.drawCentredString(W / 2, yy - 12, d.title)
    y = yy - 34
    c.setFont("Courier", 9)
    left = [f"Bill No : {d.invoice_number}" if d.invoice_number else "Bill No :",
            f"Date    : {d.invoice_date}" if d.invoice_date else "Date    :"]
    if d.po_ref:
        left.append(f"Ref     : {d.po_ref}")
    for i, t in enumerate(left):
        c.drawString(x0, y - i * 11, t)
    c.drawString(W / 2, y, "To: " + d.bill_to[0])
    for i, ln in enumerate(d.bill_to[1:]):
        c.drawString(W / 2 + 22, y - 11 - i * 11, ln)
    y -= 11 * max(len(left), len(d.bill_to)) + 14
    return _table(c, d, x0, y, W - 2 * x0, colors.black, header_fill=False, mono=True)


LAYOUTS = {"classic": _layout_classic, "modern": _layout_modern, "plain": _layout_plain}


def _table(c, d: InvoiceDoc, x0, y, width, accent, header_fill: bool, mono: bool = False):
    W, H = A4
    f, fb = ("Courier", "Courier-Bold") if mono else ("Helvetica", "Helvetica-Bold")
    cols = [("#", 0.05), ("Description", 0.39), ("HSN/SAC", 0.11), ("Qty", 0.1), ("Rate", 0.13), ("GST%", 0.07), ("Amount", 0.15)]
    xs, acc = [], x0
    for _, w in cols:
        xs.append(acc)
        acc += w * width
    rh = 16
    if header_fill:
        c.setFillColor(accent)
        c.rect(x0, y - 4, width, rh, fill=1, stroke=0)
        c.setFillColor(colors.white)
    c.setFont(fb, 8.5)
    for (name, w), x in zip(cols, xs):
        if name in ("Qty", "Rate", "GST%", "Amount"):
            c.drawRightString(x + w * width - 4, y, name)
        else:
            c.drawString(x + 3, y, name)
    c.setFillColor(colors.black)
    if not header_fill:
        c.setLineWidth(0.6)
        c.line(x0, y - 5, x0 + width, y - 5)
    y -= rh + 2
    c.setFont(f, 8.5)
    rows = [(l.description, l.hsn, f"{l.qty:g} {l.unit}", inr(l.unit_price), f"{l.gst_rate:g}", inr(l.amount)) for l in d.lines]
    rows += [(lbl, "9965", "", "", "18", inr(a)) for lbl, a in d.extra_charges]
    for i, r in enumerate(rows, 1):
        vals = [str(i), *r]
        for (name, w), x, v in zip(cols, xs, vals):
            if name in ("Qty", "Rate", "GST%", "Amount"):
                c.drawRightString(x + w * width - 4, y, v)
            else:
                c.drawString(x + 3, y, v[:52])
        y -= rh
    c.setLineWidth(0.6)
    c.line(x0, y + 8, x0 + width, y + 8)
    y -= 6
    # totals block
    tx_l, tx_r = x0 + width * 0.55, x0 + width - 4
    def tot(label, val, bold=False):
        nonlocal y
        c.setFont(fb if bold else f, 9.5 if bold else 8.5)
        c.drawString(tx_l, y, label)
        c.drawRightString(tx_r, y, val)
        y -= 13
    tot("Sub Total", inr(d.subtotal()))
    for rate, amt in sorted(d.tax_breakup().items()):
        if d.tax_mode == "intra":
            tot(f"CGST @ {rate / 2:g}%", inr(amt / 2))
            tot(f"SGST @ {rate / 2:g}%", inr(amt / 2))
        else:
            tot(f"IGST @ {rate:g}%", inr(amt))
    raw = d.subtotal() + d.tax_total()
    ro = d.grand_total() - raw
    if abs(ro) >= 0.01:
        tot("Round Off", inr(ro))
    gt = d.total_override if d.total_override is not None else d.grand_total()
    c.setLineWidth(0.8)
    c.line(tx_l, y + 9, x0 + width, y + 9)
    tot("Grand Total (INR)", "Rs. " + inr(gt), bold=True)
    y -= 10
    # bank + footer
    c.setFont(fb, 8.5)
    c.drawString(x0, y, "Bank Details")
    c.setFont(f, 8.5)
    for i, ln in enumerate([f"Bank: {d.bank_name}", f"A/c No: {d.bank_account}", f"IFSC: {d.ifsc}"]):
        c.drawString(x0, y - 12 - i * 11, ln)
    if d.notes:
        c.drawString(x0, y - 52, d.notes)
    c.setFont(f, 8)
    c.drawRightString(x0 + width, y - 30, f"For {d.vendor_name}")
    c.drawRightString(x0 + width, y - 58, "Authorised Signatory")
    if d.hidden_text:
        c.setFillColor(colors.HexColor("#FBFBFB"))
        c.setFont("Helvetica", 4)
        c.drawString(x0, 14 * mm, d.hidden_text)
        c.setFillColor(colors.black)
    c.setFont(f, 7)
    c.setFillColor(colors.HexColor("#777777"))
    c.drawCentredString(W / 2, 10 * mm, "This is a computer generated invoice.")
    c.setFillColor(colors.black)


def render_pdf(d: InvoiceDoc, path: Path, layout: str = "classic", accent: str = "#1F3A5F") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle(f"Invoice {d.invoice_number or ''}")
    LAYOUTS[layout](c, d, colors.HexColor(accent))
    c.showPage()
    c.save()
    return path


# ---------------------------------------------------------------- degradations
def pdf_to_image(pdf: Path, dpi: int = 150) -> np.ndarray:
    doc = fitz.open(pdf)
    pix = doc[0].get_pixmap(dpi=dpi)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    return cv2.cvtColor(img, cv2.COLOR_RGB2BGR) if pix.n == 3 else cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)


def to_scan(img: np.ndarray, seed: int = 1) -> np.ndarray:
    """Office-scanner look: slight rotation, grey cast, noise, softness."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), rng.uniform(-1.5, 1.5), 1.0)
    out = cv2.warpAffine(img, m, (w, h), borderValue=(235, 235, 235))
    out = cv2.GaussianBlur(out, (3, 3), 0.8)
    gray = cv2.cvtColor(out, cv2.COLOR_BGR2GRAY).astype(np.float32)
    gray = gray * 0.92 + 8 + rng.standard_normal(gray.shape, dtype=np.float32) * 6
    out = cv2.cvtColor(np.clip(gray, 0, 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    return out


def to_phone_photo(img: np.ndarray, seed: int = 1, crumple: float = 1.0, blur: float = 0.0,
                   shadow: float = 0.35) -> np.ndarray:
    """Phone photo of a paper invoice on a desk: crumple, perspective, shadow, warm light, JPEG."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    # crumple: smooth random displacement field
    if crumple > 0:
        dx = cv2.GaussianBlur(rng.normal(0, 1, (h // 20 + 1, w // 20 + 1)).astype(np.float32), (0, 0), 1.2)
        dy = cv2.GaussianBlur(rng.normal(0, 1, (h // 20 + 1, w // 20 + 1)).astype(np.float32), (0, 0), 1.2)
        dx = cv2.resize(dx, (w, h)) * 6 * crumple
        dy = cv2.resize(dy, (w, h)) * 6 * crumple
        gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
        img = cv2.remap(img, gx + dx, gy + dy, cv2.INTER_LINEAR, borderValue=(255, 255, 255))
        # crease shading
        crease = cv2.resize(cv2.GaussianBlur(rng.normal(0, 1, (8, 6)).astype(np.float32), (0, 0), 0.7), (w, h))
        img = np.clip(img.astype(np.float32) * (1 + 0.06 * crumple * crease[..., None]), 0, 255).astype(np.uint8)
    # place on desk with perspective
    pad = int(0.12 * w)
    H2, W2 = h + 2 * pad, w + 2 * pad
    desk = np.zeros((H2, W2, 3), np.float32)
    desk[:] = (70, 95, 125)  # wood-ish BGR
    desk += rng.standard_normal(desk.shape, dtype=np.float32) * 8
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    j = lambda: rng.uniform(-0.04, 0.04) * w
    dst = np.float32([[pad + j(), pad + j()], [pad + w + j(), pad + j()],
                      [pad + w + j(), pad + h + j()], [pad + j(), pad + h + j()]])
    M = cv2.getPerspectiveTransform(src, dst)
    paper = cv2.warpPerspective(img, M, (W2, H2), borderValue=(0, 0, 0))
    mask = cv2.warpPerspective(np.full((h, w), 255, np.uint8), M, (W2, H2))
    out = np.where(mask[..., None] > 0, paper.astype(np.float32), desk)
    # lighting: diagonal shadow + warm cast
    gy = np.arange(H2, dtype=np.float32)[:, None]
    gx = np.arange(W2, dtype=np.float32)[None, :]
    ang = rng.uniform(0, math.pi)
    grad = (gx * math.cos(ang) + gy * math.sin(ang))
    grad = (grad - grad.min()) / (grad.max() - grad.min())
    light = 1 - shadow * np.clip(grad - 0.45, 0, 1) * 1.8
    out *= light[..., None]
    out[..., 2] *= 1.04
    out[..., 0] *= 0.94
    out = np.clip(out + rng.standard_normal(out.shape, dtype=np.float32) * 4, 0, 255).astype(np.uint8)
    if blur > 0:
        out = cv2.GaussianBlur(out, (0, 0), blur)
    # downscale to phone-ish resolution and JPEG round-trip
    scale = 1600 / max(out.shape[:2])
    out = cv2.resize(out, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 78])
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def save_jpg(img: np.ndarray, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return path
