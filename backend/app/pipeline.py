"""The 9-stage invoice pipeline.  The LLM *reads* (stage 2); deterministic rules *decide* (stages 4-9).

Each stage emits events (stored in `events`, streamed to the UI over SSE) and may add flags.
"""
from __future__ import annotations

import re
import time
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

from rapidfuzz import fuzz
from rapidfuzz.utils import default_process

from . import db, gst, media
from .extract import MODEL, extract
from .seed import BUYER

STAGES = [
    ("intake", "Intake & quality"), ("read", "Read"), ("classify", "Classify"), ("sanity", "Sanity checks"),
    ("vendor", "Vendor check"), ("po_match", "PO match"), ("receipt", "Receipt check"),
    ("duplicate", "Duplicate check"), ("decision", "Decision"),
]
import os as _os
# Minimum on-screen time per stage so the live run view is readable (real durations are still recorded).
STAGE_MIN_SECONDS = float(_os.getenv("AP_STAGE_MIN_SECONDS", "0.45"))
KEY_FIELDS = ["invoice_number", "invoice_date", "vendor_name", "total", "subtotal", "vendor_gstin"]
REJECT_CODES = {"NOT_AN_INVOICE", "VENDOR_BLOCKED", "UNREADABLE"}
PENALTY = {"critical": 40, "warning": 14, "info": 2}
TODAY = lambda: date.fromisoformat(db.get_kv("today") or date.today().isoformat())  # noqa: E731

INJECTION_RE = re.compile(
    r"(ignore (all |any )?(previous|prior|above)[^.]{0,40}instructions|note to (the )?ai|ai reviewer|"
    r"system prompt|mark (it|this|the invoice)?\s*(as )?approved|trust score|pre-?verified by)", re.I)


# ------------------------------------------------------------------ helpers
def sim(a, b) -> float:
    return fuzz.token_set_ratio(a or "", b or "", processor=default_process)


def norm_num(s) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def to_float(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d.\-]", "", str(v))
    try:
        return float(s) if s not in ("", "-", ".") else None
    except ValueError:
        return None


def parse_date(v) -> date | None:
    if not v:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def inr(x: float, decimals: int = 0) -> str:
    neg, x = x < 0, abs(x)
    s = f"{x:.{decimals}f}"
    whole, _, frac = s.partition(".")
    if len(whole) > 3:
        head, tail, parts = whole[:-3], whole[-3:], []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return ("-" if neg else "") + "₹" + whole + (("." + frac) if decimals else "")


# ------------------------------------------------------------------ context
@dataclass
class Ctx:
    inv: dict
    rules: dict
    loaded: media.Loaded | None = None
    ext: dict | None = None
    ext_meta: dict = field(default_factory=dict)
    fields: dict = field(default_factory=dict)
    lines: list[dict] = field(default_factory=list)
    flags: list[dict] = field(default_factory=list)
    stages: dict = field(default_factory=dict)
    vendor: dict | None = None
    po: dict | None = None
    po_lines: list[dict] = field(default_factory=list)
    po_info: dict | None = None
    doc_type: str = "invoice"
    stop: bool = False
    lines_out: list = field(default_factory=list)

    def f(self, key):
        return (self.fields.get(key) or {}).get("value")

    def flag(self, code, severity, title, message, stage, **evidence):
        self.flags.append({"code": code, "severity": severity, "title": title, "message": message,
                           "stage": stage, "evidence": evidence})
        emit(self.inv["id"], "flag", self.flags[-1])


def emit(inv_id: str, typ: str, data: dict) -> None:
    with db.tx() as c:
        c.execute("INSERT INTO events(invoice_id,at,type,data) VALUES(?,?,?,?)", (inv_id, db.now(), typ, db.j(data)))


def set_stage(ctx: Ctx, sid: str, status: str, summary: str = "", details: dict | None = None, ms: int = 0):
    ctx.stages[sid] = {"id": sid, "status": status, "summary": summary, "duration_ms": ms, "details": details or {}}
    with db.tx() as c:
        c.execute("UPDATE invoices SET current_stage=? WHERE id=?", (sid if status == "running" else ctx.inv["current_stage"], ctx.inv["id"]))
    if status == "running":
        ctx.inv["current_stage"] = sid
    emit(ctx.inv["id"], "stage", ctx.stages[sid])


# ------------------------------------------------------------------ public
def create_invoice(file_bytes: bytes, file_name: str, source: str, sample_id: str | None = None,
                   email_meta: dict | None = None) -> str:
    inv_id = "inv_" + uuid.uuid4().hex[:8]
    folder = db.FILES_DIR / inv_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / ("original" + (Path(file_name).suffix.lower() or ".bin"))
    path.write_bytes(file_bytes)
    with db.tx() as c:
        c.execute("INSERT INTO invoices(id,status,current_stage,source,sample_id,file_name,file_hash,file_path,created_at,email_meta)"
                  " VALUES(?,?,?,?,?,?,?,?,?,?)",
                  (inv_id, "processing", "intake", source, sample_id, file_name, media.sha256(file_bytes), str(path), db.now(),
                   db.j(email_meta) if email_meta else None))
    return inv_id


def run(inv_id: str, from_stage: str | None = None, overrides: dict | None = None) -> dict:
    """Run the full pipeline synchronously (call from a worker thread). Returns the final detail."""
    inv = db.q1("SELECT * FROM invoices WHERE id=?", inv_id)
    ctx = Ctx(inv=inv, rules=db.current_rules())
    with db.tx() as c:
        c.execute("UPDATE invoices SET status='processing', current_stage='intake', finished_at=NULL WHERE id=?", (inv_id,))
    emit(inv_id, "run", {"status": "started", "rule_version": ctx.rules["version"]})
    for sid, _ in STAGES:
        ctx.stages[sid] = {"id": sid, "status": "pending", "summary": "", "duration_ms": 0, "details": {}}
    try:
        for sid, fn in [("intake", st_intake), ("read", st_read), ("classify", st_classify), ("sanity", st_sanity),
                        ("vendor", st_vendor), ("po_match", st_po), ("receipt", st_receipt), ("duplicate", st_duplicate)]:
            if ctx.stop:
                set_stage(ctx, sid, "skipped", "Not run — document can't be processed further")
                continue
            if sid == "sanity" and overrides:
                for k, v in overrides.items():
                    ctx.fields.setdefault(k, {})
                    ctx.fields[k].update({"value": v, "confidence": 1.0, "evidence": "Corrected by reviewer", "corrected": True})
            set_stage(ctx, sid, "running")
            t = time.time()
            status, summary, details = fn(ctx)
            took = time.time() - t
            if took < STAGE_MIN_SECONDS:
                time.sleep(STAGE_MIN_SECONDS - took)
            set_stage(ctx, sid, status, summary, details, int(took * 1000))
        set_stage(ctx, "decision", "running")
        t = time.time()
        detail = st_decision(ctx)
        set_stage(ctx, "decision", {"ready": "pass", "review": "warn"}.get(detail["decision"]["recommendation"], "fail"),
                  detail["decision"]["headline"], {}, int((time.time() - t) * 1000))
        detail["stages"] = [ctx.stages[s] for s, _ in STAGES]
        save(ctx, detail)
        emit(inv_id, "decision", detail["decision"])
        emit(inv_id, "done", {"status": "done"})
        return detail
    except Exception as e:  # never leave a run hanging
        traceback.print_exc()
        sid = ctx.inv.get("current_stage") or "intake"
        set_stage(ctx, sid, "fail", f"Error: {e.__class__.__name__}")
        with db.tx() as c:
            c.execute("UPDATE invoices SET status='failed', finished_at=? WHERE id=?", (db.now(), inv_id))
        emit(inv_id, "error", {"stage": sid, "message": str(e)[:300]})
        emit(inv_id, "done", {"status": "failed"})
        return {}


# ------------------------------------------------------------------ stage 1
def st_intake(ctx: Ctx):
    b = Path(ctx.inv["file_path"]).read_bytes()
    try:
        ctx.loaded = media.load(b, ctx.inv["file_name"] or "")
    except media.UnsupportedFile as e:
        ctx.flag("UNREADABLE", "critical", "File can't be read", str(e), "intake")
        ctx.doc_type = "other"
        ctx.stop = True
        return "fail", str(e), {}
    L = ctx.loaded
    folder = Path(ctx.inv["file_path"]).parent
    for i, png in enumerate(L.previews, 1):
        (folder / f"page{i}.png").write_bytes(png)
    q = L.quality
    kind = "PDF" if L.kind == "pdf" else "Image"
    has_text = bool(L.text_layer.strip())
    details = {"kind": L.kind, "pages": L.page_count, "text_layer": has_text, "quality": q}
    if L.kind == "image" and not q.get("document", True):
        ctx.flag("NO_DOCUMENT", "warning", "No document in the photo",
                 "The photo doesn't look like a page (little paper or printed text in frame).", "intake",
                 paper=q.get("paper"), edges=q.get("edges"))
        return "warn", f"{kind}, no document detected", details
    if L.kind == "image" and not q.get("ok", True):
        ctx.flag("QUALITY_LOW", "warning", "Poor image quality", f"Image looks {', '.join(q['issues'])}. Reading may be unreliable.", "intake",
                 sharpness=q.get("sharpness"), brightness=q.get("brightness"))
        return "warn", f"{kind}, {', '.join(q['issues'])}", details
    extra = ", text layer" if has_text else (", photo" if L.kind == "image" else ", scanned")
    return "pass", f"{kind}, {L.page_count} page{'s' if L.page_count > 1 else ''}{extra}, good quality", details


# ------------------------------------------------------------------ stage 2
def st_read(ctx: Ctx):
    h = ctx.inv["file_hash"]
    cached = db.q1("SELECT data, meta FROM extraction_cache WHERE hash=?", h)
    if cached:
        ctx.ext, ctx.ext_meta = db.unj(cached["data"]), {**db.unj(cached["meta"]), "cached": True}
    else:
        last = None
        for attempt in range(1, 4):
            try:
                ctx.ext, ctx.ext_meta = extract(ctx.loaded.pages, ctx.loaded.text_layer or None)
                break
            except Exception as e:  # timeout / gateway error / bad JSON
                last = e
                emit(ctx.inv["id"], "error", {"stage": "read", "message": f"Model call failed ({e.__class__.__name__}), retrying ({attempt}/3)"})
                time.sleep(1.5 * attempt)
        if ctx.ext is None:
            ctx.flag("UNREADABLE", "critical", "Couldn't read the document", f"The reading model failed 3 times ({last.__class__.__name__}).", "read")
            ctx.stop = True
            return "fail", "Reading failed", {}
        with db.tx() as c:
            c.execute("INSERT OR REPLACE INTO extraction_cache VALUES(?,?,?,?)", (h, db.j(ctx.ext), db.j(ctx.ext_meta), db.now()))
    ctx.fields = ctx.ext["fields"]
    ctx.lines = ctx.ext.get("line_items", [])
    for k in ("subtotal", "cgst", "sgst", "igst", "tax_total", "round_off", "total"):
        if ctx.fields.get(k):
            ctx.fields[k]["value"] = to_float(ctx.fields[k]["value"])
    for li in ctx.lines:
        for k in ("qty", "unit_price", "amount", "gst_rate"):
            li[k] = to_float(li.get(k))

    found = sum(1 for v in ctx.fields.values() if v.get("value") is not None)
    low = [k for k in KEY_FIELDS if ctx.fields.get(k, {}).get("value") is not None and ctx.fields[k]["confidence"] < 0.75]
    missing = [k for k in ("invoice_number", "invoice_date", "total") if ctx.fields.get(k, {}).get("value") is None]
    status = "pass"
    if missing and ctx.ext.get("doc_type") == "invoice":
        ctx.flag("MISSING_FIELD", "warning", "Key details missing",
                 "Not found on the document: " + ", ".join(m.replace("_", " ") for m in missing) + ".", "read", fields=missing)
        status = "warn"
    if low:
        ctx.flag("LOW_CONFIDENCE", "warning", "Some values are uncertain",
                 "Low reading confidence for " + ", ".join(k.replace("_", " ") for k in low) + " — check against the document.",
                 "read", fields=low)
        status = "warn"
    for issue in ctx.ext.get("reading_issues", [])[:2]:
        ctx.flag("READING_NOTE", "info", "Reading note", issue, "read")
    src = "cached reading" if ctx.ext_meta.get("cached") else f"{ctx.ext_meta.get('seconds', 0)}s"
    return status, f"{found} fields, {len(ctx.lines)} line items ({src})", {"model": ctx.ext_meta.get("model", MODEL),
                                                                          "cached": bool(ctx.ext_meta.get("cached"))}


# ------------------------------------------------------------------ stage 3
DOC_WORDS = [("quote", r"\b(quotation|quote no|estimate|proforma|pro-forma)\b"), ("credit_note", r"\bcredit note\b"),
             ("statement", r"\bstatement of account\b")]


def st_classify(ctx: Ctx):
    dt = ctx.ext.get("doc_type") or "other"
    hay = " ".join(str(v.get("evidence") or "") for v in ctx.fields.values()) + " " + (ctx.ext.get("doc_type_evidence") or "") \
        + " " + (ctx.loaded.text_layer[:600] if ctx.loaded else "")
    for t, pat in DOC_WORDS:
        if re.search(pat, hay, re.I) and dt == "invoice" and not re.search(r"\btax invoice\b", hay, re.I):
            dt = t
    ctx.doc_type = dt
    # injection: two independent detectors — the model's report and a deterministic scan of the text layer
    aimed = re.compile(r"\b(ai|a\.i\.|assistant|model|llm|instructions?|ignore|approved?|system|prompt|reviewer|trust score|auto-?approve)\b", re.I)
    hits = [h for h in ctx.ext.get("suspicious_instructions", []) if aimed.search(h)]
    if ctx.loaded and ctx.loaded.text_layer:
        for m in INJECTION_RE.finditer(ctx.loaded.text_layer):
            line = next((l for l in ctx.loaded.text_layer.splitlines() if m.group(0) in l), m.group(0))
            if all(line.strip()[:40] not in h for h in hits):
                hits.append(line.strip())
    status, summary = "pass", {"invoice": "Tax invoice", "credit_note": "Credit note", "quote": "Quotation",
                               "statement": "Statement", "receipt": "Receipt"}.get(dt, "Not a finance document")
    if hits:
        ctx.flag("PROMPT_INJECTION", "critical", "Hidden instructions found",
                 "The document contains text aimed at the AI (\"" + hits[0][:120] + "\"). It was ignored; treat this vendor with suspicion.",
                 "classify", text=hits[:3])
        status, summary = "fail", summary + " · hidden instructions"
    if dt in ("quote", "statement", "receipt", "other"):
        ctx.flag("NOT_AN_INVOICE", "critical", "Not an invoice",
                 f"This looks like a {summary.split(' ·')[0].lower()}, not a payable invoice.", "classify", doc_type=dt)
        ctx.stop = True
        return "fail", summary, {"doc_type": dt}
    if dt == "credit_note":
        ctx.flag("CREDIT_NOTE", "warning", "Credit note", "Money flows back to us — link it to the original invoice.", "classify")
        status = "warn" if status == "pass" else status
    return status, summary, {"doc_type": dt}


# ------------------------------------------------------------------ stage 4
def st_sanity(ctx: Ctx):
    notes, status = [], "pass"
    sub, total = ctx.f("subtotal"), ctx.f("total")
    taxes = [ctx.f(k) or 0 for k in ("cgst", "sgst", "igst")]
    tax = ctx.f("tax_total") or sum(taxes)
    ro = ctx.f("round_off") or 0
    line_sum = round(sum((li.get("amount") or 0) for li in ctx.lines), 2)
    # line arithmetic
    bad_lines = [li for li in ctx.lines if li.get("qty") and li.get("unit_price") and li.get("amount")
                 and abs(li["qty"] * li["unit_price"] - li["amount"]) > max(1.0, 0.005 * li["amount"])]
    if bad_lines:
        ctx.flag("MATH_MISMATCH", "warning", "Line maths doesn't add up",
                 f"\"{bad_lines[0]['description'][:40]}\": {bad_lines[0]['qty']:g} × {inr(bad_lines[0]['unit_price'], 2)} ≠ {inr(bad_lines[0]['amount'], 2)}.",
                 "sanity")
        status = "warn"
    if sub and ctx.lines and abs(line_sum - sub) > max(2.0, 0.005 * sub):
        ctx.flag("MATH_MISMATCH", "warning", "Lines don't match subtotal",
                 f"Line items add to {inr(line_sum)} but the subtotal says {inr(sub)}.", "sanity", lines=line_sum, subtotal=sub)
        status = "warn"
    if sub is not None and total is not None and abs(sub + tax + ro - total) > 2.0:
        ctx.flag("MATH_MISMATCH", "warning", "Total doesn't add up",
                 f"Subtotal {inr(sub)} + GST {inr(tax)} = {inr(sub + tax + ro)}, but the total says {inr(total)}.",
                 "sanity", expected=round(sub + tax + ro, 2), stated=total)
        status = "warn"
    else:
        notes.append("totals add up")
    # GSTIN + GST type
    known = [v["gstin"] for v in db.q("SELECT gstin FROM vendors")]
    raw_g = gst.clean(ctx.f("vendor_gstin"))
    vg, fixed = gst.repair(raw_g, known)
    if fixed:
        ctx.fields["vendor_gstin"].update({"value": vg, "raw": raw_g,
                                           "evidence": (ctx.fields["vendor_gstin"].get("evidence") or "") + " (misread, corrected)"})
        ctx.flag("GSTIN_REPAIRED", "info", "GSTIN misread corrected",
                 f"Read as {raw_g}, which fails the GSTIN checksum, so it can't be a real registration. "
                 f"The closest registered GSTIN is {vg}; using that.", "sanity", read_as=raw_g, corrected_to=vg)
    ok, why = gst.validate(vg)
    if vg and not ok:
        ctx.flag("GSTIN_INVALID", "warning", "Vendor GSTIN invalid", f"GSTIN {vg}: {why}.", "sanity")
        status = "warn"
    vstate = gst.state_of(vg) if ok else None
    if vstate:
        intra = vstate == BUYER["state"]
        has_igst = (ctx.f("igst") or 0) > 0
        has_cs = (ctx.f("cgst") or 0) > 0 or (ctx.f("sgst") or 0) > 0
        if intra and has_igst and not has_cs:
            ctx.flag("GST_TYPE_MISMATCH", "warning", "Wrong GST type",
                     f"Vendor and buyer are both in {vstate}, so CGST + SGST applies — but IGST was charged. Input credit is at risk.",
                     "sanity", vendor_state=vstate)
            status = "warn"
        elif not intra and has_cs and not has_igst:
            ctx.flag("GST_TYPE_MISMATCH", "warning", "Wrong GST type",
                     f"Vendor is in {vstate}, buyer in {BUYER['state']} — IGST applies, but CGST + SGST was charged.",
                     "sanity", vendor_state=vstate)
            status = "warn"
        else:
            notes.append("GST type correct")
    # bill-to
    bt_g, _ = gst.repair(ctx.f("bill_to_gstin"), [BUYER["gstin"]])
    bt_n = ctx.f("bill_to_name")
    name_ok = bool(bt_n) and sim(bt_n, BUYER["name"]) >= 85
    gstin_bad = bool(bt_g) and bt_g != BUYER["gstin"] and gst.validate(bt_g)[0]   # a *valid* different GSTIN = really someone else
    if gstin_bad or (bt_n and not name_ok and not (bt_g == BUYER["gstin"])):
        ctx.flag("BILL_TO_MISMATCH", "warning", "Not billed to us",
                 f"Billed to \"{bt_n or bt_g}\", not {BUYER['name']} ({BUYER['gstin']}).", "sanity")
        status = "warn"
    # dates
    d = parse_date(ctx.f("invoice_date"))
    if d:
        today = TODAY()
        if d > today:
            ctx.flag("DATE_FUTURE", "warning", "Future-dated invoice", f"Invoice is dated {d:%d %b %Y}, after today.", "sanity")
            status = "warn"
        elif (today - d).days > 180:
            ctx.flag("DATE_STALE", "warning", "Old invoice", f"Invoice is {(today - d).days} days old.", "sanity")
            status = "warn"
    summary = "All checks passed" if status == "pass" else f"{sum(1 for f in ctx.flags if f['stage'] == 'sanity')} issue(s)"
    return status, summary, {"line_sum": line_sum, "vendor_state": vstate}


# ------------------------------------------------------------------ stage 5
def _mask_diff(a: str, b: str) -> str:
    """Mask an account number but keep enough trailing digits to show where it differs from the other one."""
    keep = 4
    while keep < len(a) and a[-keep:] == b[-keep:]:
        keep += 1
    return "XXXX" + a[-min(max(keep, 4), len(a)):]


def st_vendor(ctx: Ctx):
    vendors = db.q("SELECT * FROM vendors")
    g = gst.clean(ctx.f("vendor_gstin"))
    name = ctx.f("vendor_name") or ""
    by_gstin = next((v for v in vendors if g and v["gstin"] == g), None)
    best, score = None, 0
    for v in vendors:
        s = max([sim(name, v["name"])] + [sim(name, a) for a in db.unj(v["aliases"]) or []]) if name else 0
        if s > score:
            best, score = v, s
    v = by_gstin or (best if score >= 88 else None)
    if not v:
        ctx.flag("VENDOR_UNKNOWN", "critical", "Unknown vendor",
                 f"\"{name or 'No vendor name'}\" isn't in the approved vendor list." + (f" Closest: {best['name']} ({score:.0f}% match)." if best and score >= 60 else ""),
                 "vendor")
        return "fail", "Not in vendor master", {}
    ctx.vendor = v
    status, notes = "pass", []
    if by_gstin and name and score < 88 and sim(name, v["name"]) < 88:
        ctx.flag("VENDOR_NAME_VARIANT", "info", "Name differs from master", f"Printed as \"{name}\"; matched {v['name']} by GSTIN.", "vendor")
    if g and not by_gstin and gst.validate(g)[0]:
        ctx.flag("GSTIN_MISMATCH", "critical", "GSTIN doesn't match vendor",
                 f"Invoice GSTIN {g} differs from {v['name']}'s registered GSTIN {v['gstin']}.", "vendor")
        status = "fail"
    if v["status"] == "blocked":
        ctx.flag("VENDOR_BLOCKED", "critical", "Vendor is blocked", f"{v['name']} is blocked in the vendor master.", "vendor")
        status = "fail"
    bank = re.sub(r"\D", "", str(ctx.f("bank_account") or ""))
    ifsc = re.sub(r"[^A-Z0-9]", "", str(ctx.f("ifsc") or "").upper())
    if bank and bank != v["bank_account"]:
        from rapidfuzz.distance import Levenshtein
        dist = Levenshtein.distance(bank, v["bank_account"])
        same_ifsc = not ifsc or ifsc == v["ifsc"]
        low_conf = (ctx.fields.get("bank_account") or {}).get("confidence", 1) < 0.9
        if dist <= 2 and same_ifsc and (low_conf or ctx.loaded.kind == "image"):
            ctx.flag("BANK_READ_UNCERTAIN", "warning", "Bank a/c doesn't exactly match",
                     f"Read as a/c {_mask_diff(bank, v['bank_account'])}, {dist} digit{'s' if dist > 1 else ''} different from the registered "
                     f"account at the same bank (IFSC {v['ifsc']}). Probably a misread from the photo; check the digits on the document.",
                     "vendor", invoice_account=_mask_diff(bank, v["bank_account"]), master_account=_mask_diff(v["bank_account"], bank))
            status = "warn"
            bank = ""
    if bank:
        if bank != v["bank_account"]:
            last = db.q1("SELECT invoice_number, acted_at FROM invoices WHERE vendor_id=? AND human_action='approved' ORDER BY acted_at DESC LIMIT 1", v["id"])
            ctx.flag("BANK_MISMATCH", "critical", "Bank details changed",
                     f"Invoice asks for payment to a/c {_mask_diff(bank, v['bank_account'])}"
                     + (f" at a different bank (IFSC {ifsc})" if ifsc and ifsc != v['ifsc'] else "")
                     + f", but {v['name']} is registered with a/c {_mask_diff(v['bank_account'], bank)}"
                     + (f" (used for {last['invoice_number']})" if last else "") + ". Verify by phone with a known contact before paying.",
                     "vendor", invoice_account=_mask_diff(bank, v["bank_account"]), master_account=_mask_diff(v["bank_account"], bank))
            status = "fail"
        else:
            notes.append("bank matches")
    how = "GSTIN" if by_gstin else f"name ({score:.0f}%)"
    summary = f"{v['name']} · matched by {how}" + (" · bank ✓" if "bank matches" in notes else "")
    if status == "warn":
        summary += " · check bank a/c"
    if status == "fail":
        summary = f"{v['name']} · " + ", ".join(f["title"].lower() for f in ctx.flags if f["stage"] == "vendor" and f["severity"] == "critical")
    return status, summary, {"vendor_id": v["id"], "matched_by": how}


# ------------------------------------------------------------------ stage 6
def _po_lines(num):
    return db.q("SELECT * FROM po_lines WHERE po_number=? ORDER BY line_no", num)


def _billed(po_num: str, exclude_id: str) -> tuple[float, dict]:
    """Amount + qty per line already billed on a PO by other, non-rejected invoices."""
    rows = db.q("SELECT subtotal, billed_lines FROM invoices WHERE po_number=? AND id<>? AND status='done' "
                "AND COALESCE(human_action,'') <> 'rejected'", po_num, exclude_id)
    amt, qty = 0.0, {}
    for r in rows:
        amt += r["subtotal"] or 0
        for k, q in (db.unj(r["billed_lines"]) or {}).items():
            qty[int(k)] = qty.get(int(k), 0) + q
    return amt, qty


def _match_lines(lines, pls):
    out = []
    for li in lines:
        best, s = None, 0
        for pl in pls:
            sc = sim(li.get("description") or "", pl["description"])
            if sc > s:
                best, s = pl, sc
        out.append((li, best if s >= 70 else None, s))
    return out


def _tolerance(ctx):
    v = ctx.vendor or {}
    pct = v.get("tolerance_pct") if v.get("tolerance_pct") is not None else ctx.rules["tolerance_pct"]
    ab = v.get("tolerance_abs") if v.get("tolerance_abs") is not None else ctx.rules["tolerance_abs"]
    return pct, ab, v.get("tolerance_pct") is not None or v.get("tolerance_abs") is not None


def st_po(ctx: Ctx):
    ref = ctx.f("po_reference")
    po, how, conf = None, None, 1.0
    if ref:
        n = norm_num(ref)
        po = db.q1("SELECT * FROM purchase_orders WHERE REPLACE(REPLACE(UPPER(number),'-',''),' ','')=?", n)
        if not po:
            digits = re.sub(r"\D", "", n)
            cands = [p for p in db.q("SELECT * FROM purchase_orders") if re.sub(r"\D", "", p["number"]) == digits] if digits else []
            po = cands[0] if len(cands) == 1 else None
            how = "fuzzy" if po else None
        else:
            how = "explicit"
        if not po:
            ctx.flag("PO_NOT_FOUND", "warning", "PO not found", f"PO \"{ref}\" isn't in the procurement system.", "po_match", ref=ref)
    if not po and ctx.vendor:
        # infer: vendor's open POs scored by line-description overlap and amount closeness
        sub = ctx.f("subtotal") or sum((li.get("amount") or 0) for li in ctx.lines)
        best, bs = None, 0.0
        for p in db.q("SELECT * FROM purchase_orders WHERE vendor_id=? AND status='open'", ctx.vendor["id"]):
            pls = _po_lines(p["number"])
            m = _match_lines(ctx.lines, pls)
            desc = sum(s for _, pl, s in m if pl) / (100 * max(1, len(m)))
            billed_amt, _ = _billed(p["number"], ctx.inv["id"])
            remaining = sum(pl["qty"] * pl["unit_price"] for pl in pls) - billed_amt
            amt = 1 - min(1, abs(remaining - sub) / max(sub, 1)) if sub else 0
            sc = 0.65 * desc + 0.35 * amt
            if sc > bs:
                best, bs = p, sc
        if best and bs >= 0.6:
            po, how, conf = best, "inferred", round(bs, 2)
            ctx.flag("PO_INFERRED", "warning", "PO inferred",
                     f"No PO number on the invoice. Best match is {best['number']} ({best['description']}) — {round(bs * 100)}% confident. Confirm before approving.",
                     "po_match", po=best["number"], confidence=conf)
        elif not ref:
            ctx.flag("PO_MISSING", "warning", "No PO", "No PO number on the invoice and no open PO for this vendor matches.", "po_match")
    if not po:
        return "warn", "No matching PO", {}
    ctx.po = po
    pls = ctx.po_lines = _po_lines(po["number"])
    status = "warn" if how == "inferred" else "pass"
    if ctx.vendor and po["vendor_id"] != ctx.vendor["id"]:
        ctx.flag("PO_VENDOR_MISMATCH", "critical", "PO belongs to another vendor",
                 f"{po['number']} was issued to a different vendor.", "po_match")
        status = "fail"
    if po["status"] != "open":
        ctx.flag("PO_CLOSED", "warning", f"PO is {po['status']}", f"{po['number']} is {po['status']} — no further billing expected.", "po_match")
        status = "warn" if status == "pass" else status
    pct, ab, custom = _tolerance(ctx)
    billed_amt, billed_qty = _billed(po["number"], ctx.inv["id"])
    po_amount = sum(pl["qty"] * pl["unit_price"] for pl in pls)
    line_out, this_qty = [], {}
    for li, pl, s in _match_lines(ctx.lines, pls):
        row = {"description": li.get("description"), "qty": li.get("qty"), "unit": li.get("unit"), "unit_price": li.get("unit_price"),
               "amount": li.get("amount"), "gst_rate": li.get("gst_rate"), "po_line": None, "received_qty": None,
               "variance_pct": None, "status": "ok", "line_no": None}
        if not pl:
            row["status"] = "not_on_po"
            ctx.flag("LINE_NOT_ON_PO", "warning", "Charge not on PO",
                     f"\"{(li.get('description') or '')[:50]}\" ({inr(li.get('amount') or 0)}) isn't on {po['number']}.", "po_match")
            status = "warn" if status == "pass" else status
            line_out.append(row)
            continue
        row["po_line"] = {"qty": pl["qty"], "unit_price": pl["unit_price"], "description": pl["description"]}
        row["line_no"] = pl["line_no"]
        q = li.get("qty") or 0
        this_qty[pl["line_no"]] = this_qty.get(pl["line_no"], 0) + q
        price = li.get("unit_price")
        if price and pl["unit_price"]:
            var = (price - pl["unit_price"]) / pl["unit_price"] * 100
            row["variance_pct"] = round(var, 2)
            over = (price - pl["unit_price"]) * q
            allowed = min(pct / 100 * pl["unit_price"] * q, ab)
            if over > 0.5:
                tol_txt = f"{pct:g}% / {inr(ab)}" + (" (vendor-specific)" if custom else "")
                if over <= allowed:
                    ctx.flag("PRICE_WITHIN_TOLERANCE", "info", "Price slightly above PO",
                             f"{inr(price, 2)} vs PO {inr(pl['unit_price'], 2)} (+{var:.1f}%, {inr(over)} total) — within tolerance ({tol_txt}).",
                             "po_match", variance_pct=round(var, 2), over=round(over, 2), allowed=round(allowed, 2))
                else:
                    row["status"] = "price_over"
                    ctx.flag("PRICE_OVER_TOLERANCE", "warning", "Price above PO",
                             f"{inr(price, 2)} vs PO {inr(pl['unit_price'], 2)} (+{var:.1f}%) — {inr(over)} over, tolerance allows {inr(allowed)} ({tol_txt}).",
                             "po_match", variance_pct=round(var, 2), over=round(over, 2), allowed=round(allowed, 2))
                    status = "warn" if status == "pass" else status
        if pl.get("gst_rate") is not None and li.get("gst_rate") is not None and abs(pl["gst_rate"] - li["gst_rate"]) > 0.01:
            ctx.flag("GST_RATE_MISMATCH", "warning", "GST rate differs from PO",
                     f"\"{pl['description'][:40]}\" charged at {li['gst_rate']:g}%, PO says {pl['gst_rate']:g}%.", "po_match")
            status = "warn" if status == "pass" else status
        line_out.append(row)
    sub = ctx.f("subtotal") or sum((li.get("amount") or 0) for li in ctx.lines)
    after = billed_amt + sub
    allowed_total = min(pct / 100 * po_amount, ab)
    for ln, q in this_qty.items():
        pl = next(p for p in pls if p["line_no"] == ln)
        if billed_qty.get(ln, 0) + q > pl["qty"] + 1e-6 and billed_amt == 0:
            ctx.flag("QTY_OVER_PO", "warning", "Quantity above PO",
                     f"{q:g} {pl['unit']} billed for \"{pl['description'][:40]}\" but the PO is for {pl['qty']:g}.", "po_match")
            status = "warn" if status == "pass" else status
    explained = billed_amt == 0 and any(f["code"] in ("PRICE_OVER_TOLERANCE", "QTY_OVER_PO", "LINE_NOT_ON_PO") for f in ctx.flags)
    if after > po_amount + allowed_total + 0.5 and not explained:
        n_prev = db.q1("SELECT COUNT(*) n FROM invoices WHERE po_number=? AND id<>? AND status='done' AND COALESCE(human_action,'')<>'rejected'",
                       po["number"], ctx.inv["id"])["n"]
        ctx.flag("PO_OVERBILLED", "warning", "PO limit exceeded",
                 (f"{n_prev} earlier invoice{'s' if n_prev != 1 else ''} already billed {inr(billed_amt)} on {po['number']}. "
                  if billed_amt else "") + f"With this one the total is {inr(after)} against a PO of {inr(po_amount)} "
                 f"({inr(after - po_amount)} over).", "po_match", billed_before=billed_amt, billed_after=after, po_amount=po_amount)
        status = "warn" if status == "pass" else status
    ctx.po_info = {"number": po["number"], "type": po["type"], "status": po["status"], "amount": po_amount,
                   "billed_before": billed_amt, "billed_after": after, "match": how, "confidence": conf,
                   "description": po["description"]}
    ctx.inv["_billed_lines"] = {str(k): v for k, v in this_qty.items()}
    ctx.lines_out = line_out
    summary = f"{po['number']} · " + {"explicit": "matched", "fuzzy": "matched (fuzzy ref)", "inferred": f"inferred ({round(conf * 100)}%)"}[how]
    if status != "pass" and how != "inferred":
        summary += " · " + ", ".join(sorted({f["title"].lower() for f in ctx.flags if f["stage"] == "po_match" and f["severity"] != "info"}))
    return status, summary, {"po": po["number"], "match": how}


# ------------------------------------------------------------------ stage 7
def st_receipt(ctx: Ctx):
    if not ctx.po:
        return "skipped", "No PO to check receipts against", {}
    if ctx.po["type"] != "goods":
        return "skipped", "Services PO — no goods receipt needed", {}
    rec = {r["line_no"]: r["q"] for r in db.q("SELECT line_no, SUM(received_qty) q FROM grn_lines WHERE po_number=? GROUP BY line_no", ctx.po["number"])}
    _, billed_qty = _billed(ctx.po["number"], ctx.inv["id"])
    status, short = "pass", []
    for row in ctx.lines_out:
        ln = row.get("line_no")
        if not ln:
            continue
        r = rec.get(ln, 0)
        row["received_qty"] = r
        total_billed = billed_qty.get(ln, 0) + (row["qty"] or 0)
        if total_billed > r + 1e-6:
            row["status"] = "not_received" if row["status"] == "ok" else row["status"]
            short.append((row, r, total_billed, billed_qty.get(ln, 0)))
    if short:
        row, r, tb, prev = short[0]
        unit = (row.get("unit") or "").strip()
        more = f" (+{len(short) - 1} more line{'s' if len(short) > 2 else ''})" if len(short) > 1 else ""
        ctx.flag("QTY_NOT_RECEIVED", "warning", "Billed more than received",
                 f"\"{(row['description'] or '')[:40]}\": {tb:g} {unit} billed" + (f" (incl. {prev:g} earlier)" if prev else "")
                 + f", only {r:g} received (GRN){more}.", "receipt", billed=tb, received=r)
        status = "warn"
    return status, "All billed goods received" if status == "pass" else f"{len(short)} line(s) not fully received", {}


# ------------------------------------------------------------------ stage 8
def st_duplicate(ctx: Ctx):
    if not ctx.vendor:
        return "skipped", "Vendor unknown — can't check history", {}
    num = norm_num(ctx.f("invoice_number"))
    total = ctx.f("total")
    d = parse_date(ctx.f("invoice_date"))
    others = db.q("SELECT * FROM invoices WHERE vendor_id=? AND id<>? AND status='done'", ctx.vendor["id"], ctx.inv["id"])
    for o in others:
        if num and norm_num(o["invoice_number"]) == num:
            when = (o["acted_at"] or o["created_at"] or "")[:10]
            state = {"approved": "approved", "rejected": "rejected", None: "in the queue"}.get(o["human_action"], o["human_action"])
            if o["human_action"] == "rejected":
                ctx.flag("RESUBMISSION", "info", "Resubmission", f"Same number as {o['invoice_number']}, rejected on {when}. Treated as a corrected resubmission.", "duplicate")
                continue
            same = "Same number" if o["invoice_number"] == ctx.f("invoice_number") else f"Same number written differently ({o['invoice_number']})"
            ctx.flag("DUPLICATE", "critical", "Duplicate invoice",
                     f"{same}, same vendor — {state}" + (f" on {datetime.fromisoformat(when).strftime('%d %b')}" if when and state != "in the queue" else "")
                     + (f", {inr(o['total'])}." if o["total"] else "."),
                     "duplicate", other_invoice_id=o["id"], other_invoice_number=o["invoice_number"])
            return "fail", f"Matches {o['invoice_number']}", {"other": o["id"]}
    for o in others:
        od = parse_date(o["invoice_date"])
        if total and o["total"] and abs(o["total"] - total) <= 1 and d and od and abs((d - od).days) <= 7:
            ctx.flag("POSSIBLE_DUPLICATE", "warning", "Possible duplicate",
                     f"Same vendor and amount ({inr(total)}) as {o['invoice_number']}, dated {abs((d - od).days)} days apart.",
                     "duplicate", other_invoice_id=o["id"], other_invoice_number=o["invoice_number"])
            return "warn", f"Similar to {o['invoice_number']}", {"other": o["id"]}
    return "pass", f"No duplicates in {len(others)} earlier invoice{'s' if len(others) != 1 else ''}", {}


# ------------------------------------------------------------------ stage 9
def st_decision(ctx: Ctx) -> dict:
    total = ctx.f("total")
    if total and total > ctx.rules["approval_limit"]:
        ctx.flag("APPROVAL_LIMIT", "info", "Needs manager sign-off", f"Above the {inr(ctx.rules['approval_limit'])} approval limit.", "decision")
    crit = [f for f in ctx.flags if f["severity"] == "critical"]
    warn = [f for f in ctx.flags if f["severity"] == "warning"]
    if any(f["code"] in REJECT_CODES for f in crit):
        rec = "reject"
    elif crit:
        rec = "hold"
    elif warn:
        rec = "review"
    else:
        rec = "ready"
    confs = [ctx.fields[k]["confidence"] for k in KEY_FIELDS if ctx.fields.get(k, {}).get("value") is not None]
    avg_conf = sum(confs) / len(confs) if confs else 0
    score = 100 - sum(PENALTY[f["severity"]] for f in ctx.flags) - round((1 - avg_conf) * 20)
    cap = {"ready": 100, "review": 79, "hold": 45, "reject": 20}[rec]
    floor = {"ready": 80, "review": 46, "hold": 21, "reject": 0}[rec]
    score = max(floor, min(cap, score))
    order = {"critical": 0, "warning": 1, "info": 2}
    flags_sorted = sorted(ctx.flags, key=lambda f: order[f["severity"]])
    if rec == "ready":
        po = ctx.po_info["number"] if ctx.po_info else None
        headline = f"Matches {po} · all checks passed" if po else "All checks passed"
        if any(f["code"] == "PRICE_WITHIN_TOLERANCE" for f in ctx.flags):
            headline = f"Matches {po} within tolerance"
    else:
        top = flags_sorted[0]
        ev = top.get("evidence") or {}
        specific = {
            "PO_OVERBILLED": lambda: f"PO limit exceeded by {inr(ev['billed_after'] - ev['po_amount'])}" if "po_amount" in ev else None,
            "DUPLICATE": lambda: f"Duplicate of {ev['other_invoice_number']}" if ev.get("other_invoice_number") else None,
            "POSSIBLE_DUPLICATE": lambda: f"Possible duplicate of {ev['other_invoice_number']}" if ev.get("other_invoice_number") else None,
            "PRICE_OVER_TOLERANCE": lambda: f"Price {ev['variance_pct']:+.1f}% above PO" if "variance_pct" in ev else None,
            "PO_INFERRED": lambda: f"No PO on invoice — likely {ev['po']}" if ev.get("po") else None,
            "QTY_NOT_RECEIVED": lambda: f"Billed {ev['billed']:g}, received {ev['received']:g}" if "billed" in ev else None,
        }.get(top["code"], lambda: None)()
        headline = specific or top["title"]
    reasons = [f["message"] for f in flags_sorted if f["severity"] != "info"][:4] or \
              ["Vendor, GSTIN and bank details match the vendor master.", "Every line matches the PO price and quantity.",
               "Totals and GST add up; no duplicates found."]
    decision = {"recommendation": rec, "trust_score": int(score), "headline": headline, "reasons": reasons,
                "rule_version": ctx.rules["version"], "model": ctx.ext_meta.get("model", MODEL) if ctx.ext_meta else MODEL}
    fields_out = []
    labels = {"invoice_number": "Invoice no.", "invoice_date": "Date", "po_reference": "PO", "vendor_name": "Vendor",
              "vendor_gstin": "GSTIN", "bank_account": "Bank a/c", "subtotal": "Subtotal", "cgst": "CGST", "sgst": "SGST",
              "igst": "IGST", "tax_total": "GST total", "total": "Total", "due_date": "Due date", "payment_terms": "Terms",
              "bill_to_name": "Billed to"}
    for k, lab in labels.items():
        fv = ctx.fields.get(k)
        if not fv or (fv.get("value") is None and k in ("cgst", "sgst", "igst", "tax_total", "due_date", "payment_terms")):
            continue
        val = fv.get("value")
        if k == "bank_account" and val:
            digits = re.sub(r"\D", "", str(val))
            val = f"XXXX XXXX {digits[-4:]}" if digits else val
        if k == "po_reference" and val is None and ctx.po_info and ctx.po_info["match"] == "inferred":
            fields_out.append({"key": k, "label": lab, "value": ctx.po_info["number"], "confidence": ctx.po_info["confidence"],
                               "evidence": "Inferred from vendor, items and amount", "inferred": True})
            continue
        ev = fv.get("evidence")
        if k == "bank_account" and ev:
            ev = re.sub(r"\d(?=\d{4})", "X", ev)
        fields_out.append({"key": k, "label": lab, "value": val, "confidence": fv.get("confidence", 0), "evidence": ev,
                           "corrected": fv.get("corrected", False)})
    detail = {
        "doc_type": ctx.doc_type,
        "decision": decision,
        "fields": fields_out,
        "line_items": ctx.lines_out or [
            {"description": li.get("description"), "qty": li.get("qty"), "unit": li.get("unit"), "unit_price": li.get("unit_price"),
             "amount": li.get("amount"), "gst_rate": li.get("gst_rate"), "po_line": None, "received_qty": None,
             "variance_pct": None, "status": "ok"} for li in ctx.lines],
        "po": ctx.po_info,
        "flags": flags_sorted,
        "quality": ctx.loaded.quality if ctx.loaded else None,
        "page_count": len(ctx.loaded.previews) if ctx.loaded else 0,
        "vendor": {"id": ctx.vendor["id"], "name": ctx.vendor["name"], "email": ctx.vendor["email"]} if ctx.vendor else None,
        "model_meta": ctx.ext_meta,
    }
    return detail


def save(ctx: Ctx, detail: dict) -> None:
    d = detail["decision"]
    v = ctx.vendor or {}
    bank = re.sub(r"\D", "", str(ctx.f("bank_account") or "")) or None
    with db.tx() as c:
        c.execute("""UPDATE invoices SET status='done', current_stage=NULL, finished_at=?, vendor_id=?, vendor_name=?,
                     invoice_number=?, invoice_date=?, po_number=?, subtotal=?, total=?, billed_lines=?, bank_account=?,
                     recommendation=?, trust_score=?, headline=?, rule_version=?, detail=? WHERE id=?""",
                  (db.now(), v.get("id"), v.get("name") or ctx.f("vendor_name"), ctx.f("invoice_number"),
                   (parse_date(ctx.f("invoice_date")) or "") and parse_date(ctx.f("invoice_date")).isoformat(),
                   ctx.po_info["number"] if ctx.po_info else None,
                   ctx.f("subtotal") or (sum((li.get("amount") or 0) for li in ctx.lines) or None), ctx.f("total"),
                   db.j(ctx.inv.get("_billed_lines") or {}), bank,
                   d["recommendation"], d["trust_score"], d["headline"], d["rule_version"], db.j(detail), ctx.inv["id"]))
