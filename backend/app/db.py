"""SQLite storage: procurement master data + runs + audit events."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("AP_DATA_DIR", BACKEND / "var"))
DB_PATH = DATA_DIR / "ap.db"
FILES_DIR = DATA_DIR / "files"

_lock = threading.RLock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY, name TEXT, aliases TEXT, gstin TEXT, state TEXT, address TEXT, email TEXT,
  bank_name TEXT, bank_account TEXT, ifsc TEXT, status TEXT, tolerance_pct REAL, tolerance_abs REAL,
  first_invoice_on TEXT
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  number TEXT PRIMARY KEY, vendor_id TEXT, type TEXT, status TEXT, created TEXT, end_date TEXT, description TEXT
);
CREATE TABLE IF NOT EXISTS po_lines (
  po_number TEXT, line_no INTEGER, description TEXT, qty REAL, unit TEXT, unit_price REAL, gst_rate REAL, hsn TEXT,
  PRIMARY KEY (po_number, line_no)
);
CREATE TABLE IF NOT EXISTS grn_lines (
  grn_number TEXT, po_number TEXT, line_no INTEGER, received_qty REAL, received_on TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, status TEXT, current_stage TEXT, source TEXT, sample_id TEXT,
  file_name TEXT, file_hash TEXT, file_path TEXT, mime TEXT, created_at TEXT, finished_at TEXT,
  vendor_id TEXT, vendor_name TEXT, invoice_number TEXT, invoice_date TEXT, po_number TEXT,
  subtotal REAL, total REAL, billed_lines TEXT, bank_account TEXT,
  recommendation TEXT, trust_score INTEGER, headline TEXT, rule_version INTEGER,
  detail TEXT, human_action TEXT, human_reason TEXT, acted_at TEXT, is_history INTEGER DEFAULT 0,
  email_meta TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id TEXT, at TEXT, type TEXT, data TEXT
);
CREATE TABLE IF NOT EXISTS rules (
  version INTEGER PRIMARY KEY, tolerance_pct REAL, tolerance_abs REAL, approval_limit REAL, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS extraction_cache (
  hash TEXT PRIMARY KEY, data TEXT, meta TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE INDEX IF NOT EXISTS ix_events_inv ON events(invoice_id, id);
CREATE INDEX IF NOT EXISTS ix_inv_vendor ON invoices(vendor_id);
"""


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


_con: sqlite3.Connection | None = None


def con() -> sqlite3.Connection:
    global _con
    if _con is None:
        _con = connect()
        _con.executescript(SCHEMA)
    return _con


@contextmanager
def tx():
    with _lock:
        c = con()
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


def q(sql: str, *args) -> list[dict]:
    with _lock:
        return [dict(r) for r in con().execute(sql, args).fetchall()]


def q1(sql: str, *args) -> dict | None:
    rows = q(sql, *args)
    return rows[0] if rows else None


def j(v) -> str:
    return json.dumps(v, ensure_ascii=False, default=str)


def unj(s):
    return json.loads(s) if s else None


def get_kv(k: str, default=None):
    r = q1("SELECT v FROM kv WHERE k=?", k)
    return unj(r["v"]) if r else default


def set_kv(k: str, v) -> None:
    with tx() as c:
        c.execute("INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, j(v)))


def current_rules() -> dict:
    return q1("SELECT * FROM rules ORDER BY version DESC LIMIT 1")
