"""Vendor message drafts. Templates, not LLM: predictable wording, and a neutral tone when fraud is suspected
(never tell a possible fraudster which check tripped)."""
from __future__ import annotations

ASK = {
    "MISSING_FIELD": "the invoice is missing some required details ({fields}); please re-issue it with these included",
    "PO_MISSING": "the invoice doesn't quote our purchase order number; please re-issue it with the PO reference",
    "PO_NOT_FOUND": "we couldn't find the purchase order quoted on the invoice; please confirm the correct PO number",
    "PO_INFERRED": "the invoice doesn't quote our purchase order number; please confirm the PO it relates to",
    "PRICE_OVER_TOLERANCE": "some unit prices are higher than agreed on the purchase order; please send a corrected invoice or the approved revised rates",
    "PO_OVERBILLED": "the total billed against the purchase order now exceeds the order value; please share a statement of invoices raised against this PO",
    "QTY_NOT_RECEIVED": "the quantity invoiced is more than we have received so far; please invoice only delivered quantities or share the delivery proof",
    "QTY_OVER_PO": "the quantity invoiced is more than ordered; please send a corrected invoice",
    "LINE_NOT_ON_PO": "the invoice includes charges that aren't on the purchase order; please remove them or share the approval",
    "GST_TYPE_MISMATCH": "the GST type on the invoice doesn't match the place of supply; please issue a corrected tax invoice",
    "GST_RATE_MISMATCH": "the GST rate on one or more lines differs from the agreed rate; please issue a corrected tax invoice",
    "GSTIN_INVALID": "the GSTIN printed on the invoice doesn't validate; please re-issue it with the correct GSTIN",
    "MATH_MISMATCH": "the totals on the invoice don't add up; please send a corrected invoice",
    "BILL_TO_MISMATCH": "the invoice isn't addressed to Northwind Components Pvt Ltd (GSTIN as per PO); please re-issue it",
    "QUALITY_LOW": "the copy we received isn't clear enough to read; please send a clear PDF",
    "UNREADABLE": "we couldn't open or read the file; please send the invoice as a PDF",
    "NOT_AN_INVOICE": "we received a quotation/statement rather than a tax invoice; please send the tax invoice once goods or services are delivered",
    "DATE_FUTURE": "the invoice date is in the future; please check and re-issue",
}
# Flags where we must not reveal the reason (fraud / control checks) — verification happens out-of-band.
SENSITIVE = {"BANK_MISMATCH", "PROMPT_INJECTION", "GSTIN_MISMATCH", "DUPLICATE", "POSSIBLE_DUPLICATE", "VENDOR_UNKNOWN"}


def draft(detail: dict, inv: dict) -> dict:
    flags = detail.get("flags") or []
    vendor = detail.get("vendor") or {}
    codes = [f["code"] for f in flags if f["severity"] != "info"]
    num = inv.get("invoice_number") or "your recent invoice"
    rec = (detail.get("decision") or {}).get("recommendation")
    if rec == "ready" or not codes:
        return {"available": False}
    asks = []
    for f in flags:
        tmpl = ASK.get(f["code"])
        if tmpl and f["severity"] != "info":
            asks.append(tmpl.format(fields=", ".join(x.replace("_", " ") for x in (f.get("evidence") or {}).get("fields", [])) or "invoice number/date"))
    sensitive = any(c in SENSITIVE for c in codes)
    lines = [f"Dear {vendor.get('name') or 'Sir/Madam'} team,", ""]
    if asks:
        lines.append(f"Thank you for invoice {num}. Before we can process it for payment:")
        lines += [f"  • {a[0].upper() + a[1:]}." for a in dict.fromkeys(asks)]
        lines.append("")
    if sensitive:
        lines.append(f"Invoice {num} is under routine verification. Our accounts team will call your registered contact to "
                     "confirm a few details before payment is released. No action is needed from you until then.")
        lines.append("")
    lines += ["Regards,", "Accounts Payable", "Northwind Components Pvt Ltd"]
    return {"available": True, "to": vendor.get("email"), "subject": f"Re: Invoice {num}",
            "body": "\n".join(lines), "sensitive": sensitive, "sent_at": None}
