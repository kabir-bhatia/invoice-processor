"""Gmail integration: an inbox checker (IMAP) that turns invoice emails into runs, and threaded replies (SMTP).

Configured via env: GMAIL_ADDRESS + GMAIL_APP_PASSWORD (a Google App Password, 2-Step Verification required).
Without them the app runs normally on upload / camera / samples.

Design choices
- The checker only reads UNSEEN mail with a PDF/JPG/PNG attachment; everything else is left untouched.
- Mail sent from our own address is ignored (no loops). One run per attachment.
- Replies go to the original sender, in the same thread (In-Reply-To / References), subject "Re: ...".
- Auto-reply (optional setting) is only ever for unreadable documents. Fraud-type flags never auto-send.
"""
from __future__ import annotations

import email
import imaplib
import json
import os
import urllib.error
import urllib.request
import smtplib
import threading
import time
import traceback
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import parseaddr, parsedate_to_datetime

from . import db

POLL_SECONDS = int(os.getenv("GMAIL_POLL_SECONDS", "30"))
ATTACH_EXT = (".pdf", ".jpg", ".jpeg", ".png", ".webp")
AUTO_REPLY_CODES = {"UNREADABLE", "QUALITY_LOW", "NO_DOCUMENT"}
_thread: threading.Thread | None = None
_stop = threading.Event()


class NotConfigured(Exception):
    pass


def creds():
    a = (os.getenv("GMAIL_ADDRESS") or "").strip()
    p = (os.getenv("GMAIL_APP_PASSWORD") or "").replace(" ", "").strip()
    return (a, p) if a and p else (None, None)


def status() -> dict:
    a, _ = creds()
    return {"connected": bool(a), "address": a, "last_checked_at": db.get_kv("gmail_last_checked"),
            "last_error": db.get_kv("gmail_last_error"), "processed": db.get_kv("gmail_processed", 0),
            "auto_reply_unreadable": bool(db.get_kv("gmail_auto_reply", False))}


# ------------------------------------------------------------------ sending
class SendFailed(Exception):
    pass


def send(to: str, subject: str, body: str, in_reply_to: str | None = None, references: str | None = None) -> str:
    """Send a reply. Prefers Brevo's HTTPS API when BREVO_API_KEY is set (hosts like Railway block SMTP ports);
    falls back to Gmail SMTP otherwise (works locally)."""
    a, p = creds()
    if not a:
        raise NotConfigured()
    if not to:
        raise ValueError("No recipient")
    refs = ((references + " " + in_reply_to).strip() if references else in_reply_to) if in_reply_to else None
    if os.getenv("BREVO_API_KEY"):
        return _send_brevo(a, to, subject, body, in_reply_to, refs)
    try:
        return _send_smtp(a, p, to, subject, body, in_reply_to, refs)
    except OSError as e:
        raise SendFailed("This server can't reach Gmail's mail port (SMTP is blocked by the host). "
                         "Set BREVO_API_KEY to send over HTTPS.") from e


def _send_brevo(sender: str, to: str, subject: str, body: str, in_reply_to: str | None, refs: str | None) -> str:
    payload = {
        "sender": {"name": "Northwind Accounts Payable", "email": sender},
        "to": [{"email": to}],
        "replyTo": {"email": sender},
        "subject": subject,
        "textContent": body,
    }
    if in_reply_to:  # keeps the reply in the vendor's existing email thread
        payload["headers"] = {"In-Reply-To": in_reply_to, "References": refs or in_reply_to}
    req = urllib.request.Request(
        "https://api.brevo.com/v3/smtp/email", data=json.dumps(payload).encode(), method="POST",
        headers={"api-key": os.environ["BREVO_API_KEY"], "accept": "application/json", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            r.read()
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            msg = json.loads(raw).get("message") or raw
        except Exception:
            msg = raw
        raise SendFailed(f"Brevo rejected the email ({e.code}): {str(msg)[:160]}") from e
    except urllib.error.URLError as e:
        raise SendFailed(f"Couldn't reach Brevo ({e.reason})") from e
    return "brevo"


def _send_smtp(a: str, p: str, to: str, subject: str, body: str, in_reply_to: str | None, refs: str | None) -> str:
    msg = EmailMessage()
    msg["From"] = f"Northwind Accounts Payable <{a}>"
    msg["To"], msg["Subject"] = to, subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = refs or in_reply_to
    msg.set_content(body)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as s:
        s.login(a, p)
        s.send_message(msg)
    return "gmail"


def reply_subject(subject: str | None) -> str:
    s = (subject or "your invoice").strip()
    return s if s.lower().startswith("re:") else f"Re: {s}"


# ------------------------------------------------------------------ receiving
def _dec(v) -> str:
    try:
        return str(make_header(decode_header(v or "")))
    except Exception:
        return v or ""


def _attachments(msg) -> list[tuple[str, bytes]]:
    out = []
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        name = _dec(part.get_filename() or "")
        ctype = part.get_content_type()
        if not name and ctype in ("application/pdf", "image/jpeg", "image/png"):
            name = "attachment" + {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}[ctype]
        if name.lower().endswith(ATTACH_EXT):
            data = part.get_payload(decode=True)
            if data:
                out.append((name, data))
    return out


def check_once() -> int:
    """Fetch unseen invoice emails and start a run for each attachment. Returns runs started."""
    from . import pipeline  # late import: pipeline imports db/seed
    a, p = creds()
    if not a:
        return 0
    started = 0
    with imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=30) as m:
        m.login(a, p)
        m.select("INBOX")
        typ, data = m.search(None, "UNSEEN")
        ids = data[0].split() if typ == "OK" and data and data[0] else []
        for num in ids[-20:]:
            typ, raw = m.fetch(num, "(BODY.PEEK[])")
            if typ != "OK" or not raw or not isinstance(raw[0], tuple):
                continue
            msg = email.message_from_bytes(raw[0][1])
            sender_name, sender = parseaddr(msg.get("From", ""))
            if sender.lower() == a.lower():
                m.store(num, "+FLAGS", "\\Seen")
                continue
            atts = _attachments(msg)
            if not atts:
                continue  # leave non-invoice mail unread for a human
            mid = msg.get("Message-ID")
            if mid and db.q1("SELECT id FROM invoices WHERE email_meta LIKE ?", f"%{mid}%"):
                m.store(num, "+FLAGS", "\\Seen")
                continue
            try:
                received = parsedate_to_datetime(msg.get("Date")).isoformat() if msg.get("Date") else db.now()
            except Exception:
                received = db.now()
            meta = {"from": sender, "from_name": sender_name, "subject": _dec(msg.get("Subject")), "message_id": mid,
                    "references": msg.get("References"), "received_at": received, "attachments": len(atts)}
            for name, data in atts[:5]:
                inv = pipeline.create_invoice(data, name, "email", email_meta=meta)
                threading.Thread(target=_run_and_maybe_reply, args=(inv,), daemon=True).start()
                started += 1
            m.store(num, "+FLAGS", "\\Seen")
    if started:
        db.set_kv("gmail_processed", (db.get_kv("gmail_processed", 0) or 0) + started)
    return started


def _run_and_maybe_reply(inv_id: str) -> None:
    from . import messages, pipeline
    detail = pipeline.run(inv_id)
    if not detail or not db.get_kv("gmail_auto_reply", False):
        return
    codes = {f["code"] for f in detail.get("flags", []) if f["severity"] != "info"}
    if not (codes & AUTO_REPLY_CODES) or codes - AUTO_REPLY_CODES - {"MISSING_FIELD", "LOW_CONFIDENCE"}:
        return  # only auto-reply when the *only* problem is an unreadable document
    r = db.q1("SELECT * FROM invoices WHERE id=?", inv_id)
    meta = db.unj(r["email_meta"]) or {}
    body = ("Hello,\n\nThank you for your invoice. Unfortunately the copy we received isn't clear enough for us to read "
            "reliably. Could you please reply with a clear PDF (or a sharp, well-lit photo of the full page)?\n\n"
            "Regards,\nAccounts Payable\nNorthwind Components Pvt Ltd")
    try:
        send(meta.get("from"), reply_subject(meta.get("subject")), body, meta.get("message_id"), meta.get("references"))
        msg = {"available": True, "to": meta.get("from"), "subject": reply_subject(meta.get("subject")), "body": body,
               "sent_at": db.now(), "via": "gmail (auto-reply)"}
        db.set_kv(f"msg:{inv_id}", msg)
        with db.tx() as c:
            c.execute("UPDATE invoices SET human_action='info_requested', acted_at=? WHERE id=?", (db.now(), inv_id))
        pipeline.emit(inv_id, "message", {"actor": "system", "event": "Auto-replied: asked vendor for a clear copy",
                                          "detail": f"To {meta.get('from')}"})
    except Exception as e:
        pipeline.emit(inv_id, "error", {"stage": "decision", "message": f"Auto-reply failed: {e}"})


def _loop():
    while not _stop.is_set():
        try:
            check_once()
            db.set_kv("gmail_last_checked", db.now())
            db.set_kv("gmail_last_error", None)
        except Exception as e:
            traceback.print_exc()
            db.set_kv("gmail_last_error", f"{e.__class__.__name__}: {str(e)[:160]}")
        _stop.wait(POLL_SECONDS)


def start_checker() -> bool:
    global _thread
    if not creds()[0] or (_thread and _thread.is_alive()):
        return False
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="gmail-checker", daemon=True)
    _thread.start()
    return True
