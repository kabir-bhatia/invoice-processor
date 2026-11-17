"""FastAPI app: implements docs/04_api_contract.md and serves the built frontend.

Run (from backend/):  ../.venv/Scripts/uvicorn app.main:app --port 8000
"""
from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, messages, pipeline, seed

BACKEND = Path(__file__).resolve().parents[1]
SAMPLES_DIR = BACKEND / "samples" / "out"
FRONTEND_DIST = BACKEND.parent / "frontend" / "dist"

app = FastAPI(title="Northwind AP Desk")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
pool = ThreadPoolExecutor(max_workers=3)


@app.on_event("startup")
def startup():
    if not db.q1("SELECT 1 x FROM vendors LIMIT 1"):
        seed.reset()
    # runs interrupted by a restart are marked failed instead of spinning forever
    with db.tx() as c:
        c.execute("UPDATE invoices SET status='failed' WHERE status='processing'")
    from . import mailer
    if mailer.start_checker():
        print(f"Gmail checker started for {mailer.creds()[0]} (every {mailer.POLL_SECONDS}s)")


def start(inv_id: str, **kw):
    pool.submit(pipeline.run, inv_id, **kw)


# ------------------------------------------------------------------ helpers
def tab_of(r: dict) -> str:
    if r["human_action"] == "info_requested":
        return "needs_action"
    if r["human_action"]:
        return "done"
    if r["status"] == "done" and r["recommendation"] == "ready":
        return "ready"
    return "needs_action"


def item(r: dict) -> dict:
    return {"id": r["id"], "status": r["status"], "current_stage": r["current_stage"] if r["status"] == "processing" else None,
            "source": r["source"], "vendor_name": r["vendor_name"], "invoice_number": r["invoice_number"], "total": r["total"],
            "recommendation": r["recommendation"], "trust_score": r["trust_score"], "headline": r["headline"],
            "human_action": r["human_action"], "created_at": r["created_at"], "sample_id": r["sample_id"],
            "po_number": r["po_number"]}


def stages_from_events(inv_id: str) -> list[dict]:
    st = {sid: {"id": sid, "status": "pending", "summary": "", "duration_ms": 0, "details": {}} for sid, _ in pipeline.STAGES}
    for e in db.q("SELECT data FROM events WHERE invoice_id=? AND type='stage' ORDER BY id", inv_id):
        d = json.loads(e["data"])
        st[d["id"]] = d
    return list(st.values())


AUDIT_TYPES = {"run", "stage", "decision", "action", "message", "error"}


def audit(inv_id: str) -> list[dict]:
    names = dict(pipeline.STAGES)
    out = []
    for e in db.q("SELECT at, type, data FROM events WHERE invoice_id=? ORDER BY id", inv_id):
        d = json.loads(e["data"])
        t = e["type"]
        if t == "stage" and d["status"] == "running":
            continue
        if t == "run":
            out.append({"at": e["at"], "actor": "system", "event": "Run started", "detail": f"Rules v{d.get('rule_version')}"})
        elif t == "stage":
            out.append({"at": e["at"], "actor": "system", "event": f"{names[d['id']]}: {d['status']}", "detail": d.get("summary")})
        elif t == "decision":
            out.append({"at": e["at"], "actor": "system", "event": f"Recommended: {d['recommendation']} ({d['trust_score']})",
                        "detail": f"Rules v{d['rule_version']} · {d['model']}"})
        elif t in ("action", "message"):
            out.append({"at": e["at"], "actor": d.get("actor", "reviewer"), "event": d["event"], "detail": d.get("detail")})
        elif t == "error":
            out.append({"at": e["at"], "actor": "system", "event": "Error", "detail": d.get("message")})
    return out


EVIDENCE_LABELS = {
    "invoice_account": "On invoice", "master_account": "In vendor master", "billed_before": "Billed before",
    "billed_after": "Billed incl. this", "po_amount": "PO value", "variance_pct": "Variance %", "over": "Over by",
    "allowed": "Tolerance allows", "billed": "Billed qty", "received": "Received qty", "expected": "Should be",
    "stated": "Invoice says", "lines": "Lines add to", "subtotal": "Subtotal", "po": "PO", "confidence": "Confidence",
    "vendor_state": "Vendor state", "ref": "PO on invoice", "doc_type": "Document type", "text": "Hidden text",
    "fields": "Fields", "sharpness": "Sharpness", "brightness": "Brightness",
}


def readable(ev: dict) -> dict:
    out = {}
    for k, v in ev.items():
        if k.startswith("other_invoice") or k.endswith("_id"):
            out[k] = v
            continue
        if k in ("glare", "ok", "issues"):
            continue
        if k == "variance_pct":
            v = f"{v:+.1f}%"
        elif k == "confidence":
            v = f"{round(v * 100)}%"
        elif k in ("billed", "received"):
            v = f"{v:g}"
        elif isinstance(v, list):
            v = ", ".join(str(x) for x in v)
        out[EVIDENCE_LABELS.get(k, k.replace("_", " ").capitalize())] = v
    return out


def next_id(inv_id: str) -> str | None:
    for r in db.q("SELECT * FROM invoices WHERE is_history=0 AND status='done' AND human_action IS NULL "
                  "AND recommendation<>'ready' AND id<>? ORDER BY created_at", inv_id):
        return r["id"]
    return None


def detail(inv_id: str) -> dict:
    r = db.q1("SELECT * FROM invoices WHERE id=?", inv_id)
    if not r or r["is_history"]:
        raise HTTPException(404, "Invoice not found")
    d = db.unj(r["detail"]) or {}
    folder = Path(r["file_path"]).parent if r["file_path"] else None
    pages = sorted(folder.glob("page*.png")) if folder else []
    vm = db.get_kv(f"msg:{inv_id}")
    if r["status"] == "done" and not vm:
        vm = messages.draft(d, r)
        em = db.unj(r["email_meta"]) or {}
        if vm.get("available") and em.get("from"):
            # Emailed invoices are answered to whoever sent them, in the same thread.
            from .mailer import reply_subject
            vm.update({"to": em["from"], "subject": reply_subject(em.get("subject")), "thread": True})
    return {
        "id": r["id"], "status": r["status"], "source": r["source"], "created_at": r["created_at"], "sample_id": r["sample_id"],
        "document": {"pages": len(pages), "page_urls": [f"/api/invoices/{inv_id}/pages/{i}.png" for i in range(1, len(pages) + 1)],
                     "original_url": f"/api/invoices/{inv_id}/original", "file_name": r["file_name"], "quality": d.get("quality")},
        "doc_type": d.get("doc_type"),
        "decision": d.get("decision"),
        "stages": d.get("stages") if r["status"] == "done" and d.get("stages") else stages_from_events(inv_id),
        "fields": d.get("fields", []),
        "line_items": d.get("line_items", []),
        "po": d.get("po"),
        "flags": [{**f, "evidence": readable(f.get("evidence") or {})} for f in d.get("flags", [])],
        "vendor": d.get("vendor"),
        "next_id": next_id(inv_id),
        "vendor_message": vm or {"available": False},
        "human_action": r["human_action"], "human_reason": r["human_reason"], "acted_at": r["acted_at"],
        "email": db.unj(r["email_meta"]),
        "audit": audit(inv_id),
    }


# ------------------------------------------------------------------ queue
@app.get("/api/invoices")
def list_invoices(tab: str = "needs_action", q: str = ""):
    rows = db.q("SELECT * FROM invoices WHERE is_history=0 ORDER BY created_at DESC")
    counts = {"needs_action": 0, "ready": 0, "done": 0}
    items = []
    for r in rows:
        t = tab_of(r)
        counts[t] += 1
        if t != tab:
            continue
        if q and q.lower() not in " ".join(str(r[k] or "") for k in ("vendor_name", "invoice_number", "po_number")).lower():
            continue
        items.append(item(r))
    if tab == "needs_action":
        rank = {"processing": -1}
        sev = {"hold": 0, "reject": 1, "review": 2}
        items.sort(key=lambda i: (rank.get(i["status"], 0), sev.get(i["recommendation"], 3), i["created_at"]), reverse=False)
        items.sort(key=lambda i: i["status"] != "processing")
    return {"counts": counts, "items": items}


@app.post("/api/invoices", status_code=201)
async def upload(file: UploadFile = File(...), source: str = Form("upload")):
    b = await file.read()
    if not b:
        raise HTTPException(400, "Empty file")
    if len(b) > 15 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 15 MB)")
    inv_id = pipeline.create_invoice(b, file.filename or "upload", source if source in ("upload", "camera") else "upload")
    start(inv_id)
    return {"id": inv_id}


@app.get("/api/samples")
def samples():
    exp = json.loads((SAMPLES_DIR / "expected.json").read_text())
    return [{"id": s["id"], "title": s["title"], "hint": s["hint"], "headline": s["headline"], "expect": s["expect"],
             "thumbnail_url": f"/api/samples/{s['id']}/thumb.png"} for s in exp]


@app.get("/api/samples/{sid}/thumb.png")
def sample_thumb(sid: str):
    p = SAMPLES_DIR / f"{sid}_thumb.png"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/api/samples/{sid}/file")
def sample_file(sid: str):
    for ext in (".pdf", ".jpg"):
        p = SAMPLES_DIR / f"{sid}{ext}"
        if p.exists():
            return FileResponse(p, filename=p.name)
    raise HTTPException(404)


@app.post("/api/samples/{sid}/run", status_code=201)
def run_sample(sid: str):
    for ext in (".pdf", ".jpg"):
        p = SAMPLES_DIR / f"{sid}{ext}"
        if p.exists():
            inv_id = pipeline.create_invoice(p.read_bytes(), p.name, "sample", sid)
            start(inv_id)
            return {"id": inv_id}
    raise HTTPException(404, "Unknown sample")


# ------------------------------------------------------------------ detail
@app.get("/api/invoices/{inv_id}")
def get_invoice(inv_id: str):
    return detail(inv_id)


@app.get("/api/invoices/{inv_id}/events")
async def events(inv_id: str, request: Request):
    if not db.q1("SELECT id FROM invoices WHERE id=?", inv_id):
        raise HTTPException(404)

    async def gen():
        last = 0
        idle = 0
        while True:
            if await request.is_disconnected():
                break
            rows = db.q("SELECT id, type, data FROM events WHERE invoice_id=? AND id>? ORDER BY id", inv_id, last)
            for r in rows:
                last = r["id"]
                yield f"event: {r['type']}\ndata: {r['data']}\n\n"
                if r["type"] == "done":
                    return
            if not rows:
                idle += 1
                if idle % 50 == 0:
                    yield ": keep-alive\n\n"
                st = db.q1("SELECT status FROM invoices WHERE id=?", inv_id)
                if st and st["status"] != "processing" and not db.q1("SELECT 1 x FROM events WHERE invoice_id=? AND type='done' AND id>?", inv_id, last):
                    if idle > 3:
                        yield f"event: done\ndata: {json.dumps({'status': st['status']})}\n\n"
                        return
            await asyncio.sleep(0.2)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/invoices/{inv_id}/pages/{n}.png")
def page(inv_id: str, n: int):
    r = db.q1("SELECT file_path FROM invoices WHERE id=?", inv_id)
    if not r:
        raise HTTPException(404)
    p = Path(r["file_path"]).parent / f"page{n}.png"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="image/png")


@app.get("/api/invoices/{inv_id}/original")
def original(inv_id: str):
    r = db.q1("SELECT file_path, file_name FROM invoices WHERE id=?", inv_id)
    if not r:
        raise HTTPException(404)
    return FileResponse(r["file_path"], filename=r["file_name"] or Path(r["file_path"]).name)


class ActionIn(BaseModel):
    action: str
    reason: str | None = None


@app.post("/api/invoices/{inv_id}/action")
def act(inv_id: str, body: ActionIn):
    r = db.q1("SELECT * FROM invoices WHERE id=?", inv_id)
    if not r:
        raise HTTPException(404)
    if r["status"] != "done":
        raise HTTPException(409, "Still processing")
    if body.action == "undo":
        return undo(inv_id)
    mapping = {"approve": "approved", "reject": "rejected", "request_info": "info_requested"}
    if body.action not in mapping:
        raise HTTPException(400, "Unknown action")
    reason = (body.reason or "").strip() or None
    if body.action == "reject" and not reason:
        raise HTTPException(400, "A reason is required to reject")
    if body.action == "approve" and r["recommendation"] in ("hold", "reject") and not reason:
        raise HTTPException(400, "A reason is required to approve against the recommendation")
    with db.tx() as c:
        c.execute("UPDATE invoices SET human_action=?, human_reason=?, acted_at=? WHERE id=?", (mapping[body.action], reason, db.now(), inv_id))
    label = {"approve": "Approved", "reject": "Rejected", "request_info": "Requested info from vendor"}[body.action]
    if body.action == "approve" and r["recommendation"] != "ready":
        label += f" (overrode '{r['recommendation']}')"
    pipeline.emit(inv_id, "action", {"actor": "reviewer", "event": label, "detail": reason})
    return detail(inv_id)


@app.post("/api/invoices/{inv_id}/undo")
def undo(inv_id: str):
    with db.tx() as c:
        c.execute("UPDATE invoices SET human_action=NULL, human_reason=NULL, acted_at=NULL WHERE id=?", (inv_id,))
    pipeline.emit(inv_id, "action", {"actor": "reviewer", "event": "Action undone"})
    return detail(inv_id)


class MessageIn(BaseModel):
    subject: str
    body: str
    to: str | None = None


@app.post("/api/invoices/{inv_id}/vendor-message/send")
def send_message(inv_id: str, body: MessageIn):
    from . import mailer
    r = db.q1("SELECT * FROM invoices WHERE id=?", inv_id)
    if not r:
        raise HTTPException(404)
    d = detail(inv_id)
    email = db.unj(r["email_meta"]) or {}
    # Invoices that arrived by email are answered in the same thread, to the original sender.
    to = email.get("from") or body.to or (d["vendor_message"] or {}).get("to")
    subject = mailer.reply_subject(email.get("subject")) if email.get("message_id") else body.subject
    if not to or to.endswith(".example"):
        sent_via = "logged (demo vendor has no real mailbox)"
    else:
        try:
            sent_via = mailer.send(to=to, subject=subject, body=body.body,
                                   in_reply_to=email.get("message_id"), references=email.get("references"))
            if email.get("message_id"):
                sent_via += " · same thread"
        except mailer.NotConfigured:
            sent_via = "logged (email not connected)"
        except mailer.SendFailed as e:
            raise HTTPException(502, str(e))
        except Exception as e:
            raise HTTPException(502, f"Couldn't send ({e.__class__.__name__}: {str(e)[:120]})")
    msg = {"available": True, "to": to, "subject": subject, "body": body.body, "sent_at": db.now(), "via": sent_via}
    db.set_kv(f"msg:{inv_id}", msg)
    pipeline.emit(inv_id, "message", {"actor": "reviewer", "event": "Message sent to vendor", "detail": f"To {msg['to']} · {sent_via}"})
    return {"sent_at": msg["sent_at"], "via": sent_via}


class FieldIn(BaseModel):
    key: str
    value: str | float | None


@app.patch("/api/invoices/{inv_id}/fields")
def fix_field(inv_id: str, body: FieldIn):
    r = db.q1("SELECT * FROM invoices WHERE id=?", inv_id)
    if not r:
        raise HTTPException(404)
    overrides = db.get_kv(f"fix:{inv_id}", {}) or {}
    overrides[body.key] = body.value
    db.set_kv(f"fix:{inv_id}", overrides)
    pipeline.emit(inv_id, "action", {"actor": "reviewer", "event": f"Corrected {body.key}", "detail": str(body.value)})
    with db.tx() as c:
        c.execute("UPDATE invoices SET human_action=NULL, human_reason=NULL, acted_at=NULL WHERE id=?", (inv_id,))
    start(inv_id, overrides=overrides)
    return {"id": inv_id}


@app.post("/api/invoices/{inv_id}/rerun")
def rerun(inv_id: str):
    if not db.q1("SELECT id FROM invoices WHERE id=?", inv_id):
        raise HTTPException(404)
    with db.tx() as c:
        c.execute("UPDATE invoices SET human_action=NULL, human_reason=NULL, acted_at=NULL WHERE id=?", (inv_id,))
    start(inv_id, overrides=db.get_kv(f"fix:{inv_id}") or None)
    return {"id": inv_id}


# ------------------------------------------------------------------ dashboard
@app.get("/api/dashboard")
def dashboard():
    rows = db.q("SELECT * FROM invoices WHERE is_history=0 AND status='done' ORDER BY created_at DESC")
    n = len(rows)
    ready = sum(1 for r in rows if r["recommendation"] == "ready")
    held = sum((r["total"] or 0) for r in rows if r["recommendation"] in ("hold", "reject") and r["human_action"] != "approved")
    secs = []
    for r in rows:
        if r["finished_at"] and r["created_at"]:
            from datetime import datetime
            a = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
            b = datetime.fromisoformat(r["finished_at"].replace("Z", "+00:00"))
            secs.append((b - a).total_seconds())
    cause_of = {"DUPLICATE": "duplicate", "POSSIBLE_DUPLICATE": "duplicate", "BANK_MISMATCH": "fraud_risk", "PROMPT_INJECTION": "fraud_risk",
                "GSTIN_MISMATCH": "fraud_risk", "VENDOR_UNKNOWN": "vendor", "VENDOR_BLOCKED": "vendor",
                "GST_TYPE_MISMATCH": "tax", "GST_RATE_MISMATCH": "tax", "GSTIN_INVALID": "tax",
                "LOW_CONFIDENCE": "reading", "MISSING_FIELD": "reading", "QUALITY_LOW": "reading", "UNREADABLE": "reading",
                "MATH_MISMATCH": "reading", "NOT_AN_INVOICE": "not_invoice", "QTY_NOT_RECEIVED": "receipt"}
    causes: dict[str, int] = {}
    for r in rows:
        if r["recommendation"] == "ready":
            continue
        d = db.unj(r["detail"]) or {}
        top = next((f for f in d.get("flags", []) if f["severity"] != "info"), None)
        if top:
            c = cause_of.get(top["code"], "po_mismatch")
            causes[c] = causes.get(c, 0) + 1
    all_rows = db.q("SELECT * FROM invoices WHERE is_history=0 ORDER BY created_at DESC LIMIT 20")
    return {"kpis": {"processed": n, "ready_pct": round(100 * ready / n) if n else 0, "held_back_amount": held,
                     "avg_decision_seconds": round(sum(secs) / len(secs), 1) if secs else 0},
            "exceptions_by_cause": [{"cause": k, "count": v} for k, v in sorted(causes.items(), key=lambda x: -x[1])],
            "recent": [item(r) for r in all_rows]}


# ------------------------------------------------------------------ settings
class RulesIn(BaseModel):
    tolerance_pct: float
    tolerance_abs: float
    approval_limit: float


@app.get("/api/settings/rules")
def get_rules():
    r = db.current_rules()
    return {**r, "updated_at": r["updated_at"]}


@app.put("/api/settings/rules")
def put_rules(body: RulesIn):
    cur = db.current_rules()
    v = cur["version"] + 1
    with db.tx() as c:
        c.execute("INSERT INTO rules VALUES(?,?,?,?,?)", (v, body.tolerance_pct, body.tolerance_abs, body.approval_limit, db.now()))
    return get_rules()


def vendor_out(v: dict) -> dict:
    return {"id": v["id"], "name": v["name"], "gstin": v["gstin"], "state": v["state"], "email": v["email"],
            "bank_account_masked": "XXXX XXXX " + v["bank_account"][-4:], "bank_name": v["bank_name"], "status": v["status"],
            "tolerance_pct": v["tolerance_pct"], "tolerance_abs": v["tolerance_abs"]}


@app.get("/api/vendors")
def vendors():
    return [vendor_out(v) for v in db.q("SELECT * FROM vendors ORDER BY name")]


class VendorIn(BaseModel):
    tolerance_pct: float | None = None
    tolerance_abs: float | None = None


@app.patch("/api/vendors/{vid}")
def patch_vendor(vid: str, body: VendorIn):
    if not db.q1("SELECT id FROM vendors WHERE id=?", vid):
        raise HTTPException(404)
    with db.tx() as c:
        c.execute("UPDATE vendors SET tolerance_pct=?, tolerance_abs=? WHERE id=?", (body.tolerance_pct, body.tolerance_abs, vid))
    return vendor_out(db.q1("SELECT * FROM vendors WHERE id=?", vid))


@app.get("/api/procurement/pos")
def pos():
    out = []
    names = {v["id"]: v["name"] for v in db.q("SELECT id, name FROM vendors")}
    for p in db.q("SELECT * FROM purchase_orders ORDER BY number"):
        lines = db.q("SELECT * FROM po_lines WHERE po_number=? ORDER BY line_no", p["number"])
        rec = {r["line_no"]: r["q"] for r in db.q("SELECT line_no, SUM(received_qty) q FROM grn_lines WHERE po_number=? GROUP BY line_no", p["number"])}
        billed = db.q1("SELECT COALESCE(SUM(subtotal),0) s FROM invoices WHERE po_number=? AND status='done' AND COALESCE(human_action,'')<>'rejected'", p["number"])["s"]
        out.append({"number": p["number"], "vendor_name": names.get(p["vendor_id"]), "type": p["type"], "status": p["status"],
                    "description": p["description"], "amount": sum(l["qty"] * l["unit_price"] for l in lines), "billed": billed,
                    "created": p["created"],
                    "lines": [{"description": l["description"], "qty": l["qty"], "unit": l["unit"], "unit_price": l["unit_price"],
                               "gst_rate": l["gst_rate"], "received_qty": rec.get(l["line_no"], 0) if p["type"] == "goods" else None} for l in lines]})
    return out


@app.get("/api/procurement/invoices")
def past_invoices():
    return [{"id": r["id"], "number": r["invoice_number"], "invoice_number": r["invoice_number"], "vendor_name": r["vendor_name"],
             "date": r["invoice_date"], "invoice_date": r["invoice_date"],
             "po_number": r["po_number"], "total": r["total"], "status": r["human_action"] or r["recommendation"], "history": bool(r["is_history"])}
            for r in db.q("SELECT * FROM invoices WHERE status='done' ORDER BY COALESCE(invoice_date, created_at) DESC")]


@app.post("/api/demo/reset")
def reset():
    seed.reset()
    return {"ok": True}


@app.get("/api/integrations/gmail")
def gmail_status():
    from . import mailer
    return mailer.status()


class GmailIn(BaseModel):
    auto_reply_unreadable: bool


@app.put("/api/integrations/gmail")
def gmail_put(body: GmailIn):
    from . import mailer
    db.set_kv("gmail_auto_reply", body.auto_reply_unreadable)
    return mailer.status()


@app.post("/api/integrations/gmail/check")
def gmail_check_now():
    """Check the inbox immediately (handy in a live demo instead of waiting for the next 30 s poll)."""
    from . import mailer
    if not mailer.creds()[0]:
        raise HTTPException(400, "Gmail is not connected")
    try:
        n = mailer.check_once()
        db.set_kv("gmail_last_checked", db.now())
    except Exception as e:
        raise HTTPException(502, f"Inbox check failed: {e.__class__.__name__}: {str(e)[:120]}")
    return {"started": n, **mailer.status()}


@app.get("/api/health")
def health():
    return {"ok": True, "model": pipeline.MODEL, "rules_version": db.current_rules()["version"]}


# ------------------------------------------------------------------ frontend
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        p = FRONTEND_DIST / path
        if path and p.is_file():
            return FileResponse(p)
        return FileResponse(FRONTEND_DIST / "index.html")
