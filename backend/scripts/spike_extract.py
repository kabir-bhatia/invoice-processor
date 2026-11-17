"""Step 0: can glm-5.3-flash read our invoices (clean PDF, scan, crumpled phone photo)?"""
import json
import sys
from pathlib import Path

import cv2
import fitz

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.extract import extract  # noqa: E402
from samples.render import InvoiceDoc, Line, pdf_to_image, render_pdf, save_jpg, to_phone_photo, to_scan  # noqa: E402

OUT = Path(__file__).resolve().parents[1] / "samples" / "spike"

doc = InvoiceDoc(
    vendor_name="Shree Packaging Pvt Ltd",
    vendor_address=["Khasra 118, Sector 5, IMT Manesar", "Gurugram, Haryana 122052", "accounts@shreepack.example"],
    vendor_gstin="06AAACS1234F1Z5", vendor_state="Haryana",
    invoice_number="SP/26-27/1023", invoice_date="14/11/2026", po_ref="PO-1042", due_date="14/12/2026",
    lines=[Line("Corrugated box 5-ply 18x12x10", 1200, "pcs", 85.0, 18, "4819"),
           Line("Bubble wrap roll 1m x 100m", 40, "rolls", 1180.0, 18, "3923"),
           Line("BOPP tape 48mm brown", 300, "pcs", 38.5, 18, "3919")],
    bank_account="50200012344821",
)
truth = {
    "invoice_number": doc.invoice_number, "invoice_date": "2026-11-14", "po_reference": doc.po_ref,
    "vendor_gstin": doc.vendor_gstin, "bank_account": doc.bank_account,
    "subtotal": doc.subtotal(), "tax_total": doc.tax_total(), "total": doc.grand_total(),
}


def page_png(pdf: Path) -> bytes:
    return fitz.open(pdf)[0].get_pixmap(dpi=150).tobytes("png")


def run(name: str, images: list[bytes], text: str | None):
    data, meta = extract(images, text)
    f = data["fields"]
    got = {k: f[k]["value"] for k in truth}
    tax = f["tax_total"]["value"]
    if tax is None and f["cgst"]["value"] is not None:
        got["tax_total"] = round((f["cgst"]["value"] or 0) + (f["sgst"]["value"] or 0) + (f["igst"]["value"] or 0), 2)
    ok = {}
    for k, v in truth.items():
        g = got[k]
        ok[k] = (abs(float(g) - float(v)) < 1.01) if isinstance(v, float) and g is not None else str(g).replace(" ", "") == str(v)
    lines_ok = len(data["line_items"]) == 3 and all(
        abs((li.get("amount") or 0) - l.amount) < 1 for li, l in zip(data["line_items"], doc.lines))
    score = sum(ok.values())
    print(f"\n=== {name}: {score}/{len(ok)} fields, lines {'OK' if lines_ok else 'WRONG'}, "
          f"{meta['seconds']}s, finish={meta['finish_reason']}, tokens={meta['usage'] and meta['usage'].get('total_tokens')}")
    for k in truth:
        mark = "OK " if ok[k] else "BAD"
        print(f"  {mark} {k:15} got={got[k]!r:24} want={truth[k]!r:24} conf={f[k]['confidence']} ev={f[k]['evidence']!r}")
    print("  doc_type:", data["doc_type"], "| issues:", data["reading_issues"], "| injection:", data["suspicious_instructions"])
    (OUT / f"{name}.json").write_text(json.dumps({"data": data, "meta": meta}, indent=1))
    return score, lines_ok


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    pdf = render_pdf(doc, OUT / "clean.pdf", "classic")
    pdf2 = render_pdf(doc, OUT / "modern.pdf", "modern", "#2E4A62")
    pdf3 = render_pdf(doc, OUT / "plain.pdf", "plain")
    scan = save_jpg(to_scan(pdf_to_image(pdf2, 150), seed=3), OUT / "scan.jpg")
    photo = save_jpg(to_phone_photo(pdf_to_image(pdf3, 120), seed=7, crumple=1.3, blur=0.7), OUT / "crumpled_photo.jpg")
    which = sys.argv[1:] or ["clean_text", "clean_image", "scan", "photo"]
    if "clean_text" in which:
        run("clean_pdf_with_text", [page_png(pdf)], fitz.open(pdf)[0].get_text())
    if "clean_image" in which:
        run("clean_pdf_image_only", [page_png(pdf)], None)
    if "scan" in which:
        run("scan", [scan.read_bytes()], None)
    if "photo" in which:
        run("crumpled_photo", [photo.read_bytes()], None)
