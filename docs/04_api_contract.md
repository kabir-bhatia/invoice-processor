# API Contract (backend ↔ frontend)

> The backend (FastAPI, `backend/`) implements this. The frontend (`frontend/`) builds against it, using mock data with these exact shapes until the backend is live.
> All JSON. Money in **rupees as numbers** (e.g. `184200.0`); the frontend formats it (₹1,84,200). Dates are ISO `YYYY-MM-DD`; timestamps are ISO 8601 UTC.
> Base path: `/api`. Dev: backend on `http://localhost:8000`, Vite proxies `/api` to it.

---

## Enums

```ts
type Source = "upload" | "camera" | "email" | "sample";
type Recommendation = "ready" | "review" | "hold" | "reject";   // Ready to approve · Needs review · High risk – hold · Recommend reject
type RunStatus = "processing" | "done" | "failed";
type HumanAction = "approved" | "rejected" | "info_requested" | null;
type QueueTab = "needs_action" | "ready" | "done";
// needs_action = done & no human action & recommendation in (review, hold, reject)
// ready        = done & no human action & recommendation == ready
// done         = human action taken
type StageId = "intake" | "read" | "classify" | "sanity" | "vendor" | "po_match" | "receipt" | "duplicate" | "decision";
type StageStatus = "pending" | "running" | "pass" | "warn" | "fail" | "skipped";
type Severity = "info" | "warning" | "critical";
type DocType = "invoice" | "credit_note" | "quote" | "statement" | "receipt" | "other";
```

Stage display names: Intake & quality · Read · Classify · Sanity checks · Vendor check · PO match · Receipt check · Duplicate check · Decision.

---

## Queue

### `GET /api/invoices?tab=needs_action|ready|done&q=`
```json
{
  "counts": { "needs_action": 4, "ready": 2, "done": 11 },
  "items": [
    {
      "id": "inv_8f2a",
      "status": "done",
      "current_stage": null,
      "source": "email",
      "vendor_name": "Shree Packaging Pvt Ltd",
      "invoice_number": "INV1023",
      "total": 184200.0,
      "recommendation": "hold",
      "trust_score": 32,
      "headline": "Looks like INV-1023, already approved on 12 Nov",
      "human_action": null,
      "created_at": "2026-11-17T10:42:00Z"
    }
  ]
}
```
While processing: `status: "processing"`, `current_stage: "po_match"`, and the decision fields are `null`.

### `POST /api/invoices` (multipart)
Fields: `file` (PDF/JPG/PNG/HEIC), `source` (`upload` | `camera`). → `201 { "id": "inv_9c1d" }`. Processing starts immediately.

### `GET /api/samples`
```json
[{ "id": "s0_happy", "title": "Clean invoice, exact PO match", "hint": "Happy path", "thumbnail_url": "/api/samples/s0_happy/thumb.png" }]
```
### `POST /api/samples/{sample_id}/run` → `201 { "id": "inv_..." }`

---

## Invoice detail

### `GET /api/invoices/{id}`
```json
{
  "id": "inv_8f2a",
  "status": "done",
  "source": "email",
  "created_at": "2026-11-17T10:42:00Z",
  "document": { "pages": 1, "page_urls": ["/api/invoices/inv_8f2a/pages/1.png"], "original_url": "/api/invoices/inv_8f2a/original", "quality": { "sharpness": 0.82, "brightness": 0.61, "glare": 0.04, "ok": true } },
  "doc_type": "invoice",

  "decision": {
    "recommendation": "hold",
    "trust_score": 32,
    "headline": "Looks like INV-1023, already approved on 12 Nov",
    "reasons": ["Same vendor, amount and PO as INV-1023 (approved 12 Nov)", "Invoice number differs only in formatting"],
    "rule_version": 3,
    "model": "hyde/glm-5.3-flash"
  },

  "stages": [
    { "id": "intake", "status": "pass", "summary": "PDF, 1 page, good quality", "duration_ms": 180, "details": {} },
    { "id": "read",   "status": "pass", "summary": "14 fields, 3 line items", "duration_ms": 3120, "details": {} },
    { "id": "receipt","status": "skipped", "summary": "Services PO — no goods receipt needed", "duration_ms": 0, "details": {} }
  ],

  "fields": [
    { "key": "invoice_number", "label": "Invoice no.", "value": "INV1023", "confidence": 0.97, "evidence": "Invoice No: INV1023" },
    { "key": "invoice_date",   "label": "Date",        "value": "2026-11-14", "confidence": 0.93, "evidence": "Dated 14/11/2026" },
    { "key": "po_number",      "label": "PO",          "value": "PO-1042", "confidence": 0.91, "evidence": "Your PO: PO-1042", "inferred": false },
    { "key": "vendor_name",    "label": "Vendor",      "value": "Shree Packaging Pvt Ltd", "confidence": 0.98, "evidence": "SHREE PACKAGING PVT. LTD." },
    { "key": "vendor_gstin",   "label": "GSTIN",       "value": "06AAACS1234F1Z5", "confidence": 0.95, "evidence": "GSTIN: 06AAACS1234F1Z5" },
    { "key": "bank_account",   "label": "Bank a/c",    "value": "XXXX XXXX 4821", "confidence": 0.9, "evidence": "A/c No: XXXX4821" },
    { "key": "subtotal",       "label": "Subtotal",    "value": 156102.0, "confidence": 0.95, "evidence": "Sub Total 1,56,102.00" },
    { "key": "tax_total",      "label": "GST",         "value": 28098.0, "confidence": 0.94, "evidence": "CGST 9% 14,049 / SGST 9% 14,049" },
    { "key": "total",          "label": "Total",       "value": 184200.0, "confidence": 0.96, "evidence": "Grand Total ₹1,84,200.00" }
  ],
  // confidence < 0.75 → frontend highlights as low confidence. value may be null (not found on document).

  "line_items": [
    { "description": "Corrugated box 5-ply", "qty": 1200, "unit": "pcs", "unit_price": 85.0, "amount": 102000.0, "gst_rate": 18,
      "po_line": { "qty": 1200, "unit_price": 85.0 }, "received_qty": 1200, "variance_pct": 0.0, "status": "ok" }
    // status: "ok" | "price_over" | "qty_over" | "not_received" | "not_on_po"
  ],

  "po": { "number": "PO-1042", "type": "goods", "status": "open", "amount": 500000.0, "billed_before": 210000.0, "billed_after": 394200.0, "match": "explicit" },
  // match: "explicit" | "fuzzy" | "inferred" ; po may be null

  "flags": [
    { "code": "DUPLICATE_NEAR", "severity": "critical", "title": "Possible duplicate", "message": "Same vendor, amount and PO as INV-1023, approved on 12 Nov.", "stage": "duplicate", "evidence": { "other_invoice_id": "inv_31aa", "other_invoice_number": "INV-1023" } }
  ],

  "vendor_message": { "available": true, "to": "accounts@shreepack.example", "subject": "Re: Invoice INV1023", "body": "...", "sent_at": null },

  "human_action": null,
  "human_reason": null,
  "audit": [
    { "at": "2026-11-17T10:42:01Z", "actor": "system", "event": "Stage read finished", "detail": "14 fields" }
  ]
}
```

### `GET /api/invoices/{id}/events` (Server-Sent Events)
Replays past events on connect, then streams live. Event types:
```
event: stage      data: { "id": "po_match", "status": "running" }
event: stage      data: { "id": "po_match", "status": "pass", "summary": "Matched PO-1042", "duration_ms": 120 }
event: flag       data: { ...flag object... }
event: decision   data: { ...decision object... }
event: done       data: { "status": "done" }
event: error      data: { "stage": "read", "message": "Model timed out, retrying (2/3)" }
```
After `done`, the frontend re-fetches `GET /api/invoices/{id}` for the full detail.

### `GET /api/invoices/{id}/pages/{n}.png` · `GET /api/invoices/{id}/original`

### `POST /api/invoices/{id}/action`
```json
{ "action": "approve" | "reject" | "request_info", "reason": "string, required for reject and for approving a hold/reject recommendation" }
```
→ updated detail.

### `POST /api/invoices/{id}/vendor-message/send` *(P1)*
`{ "subject": "...", "body": "..." }` → `{ "sent_at": "..." }`

### `PATCH /api/invoices/{id}/fields` *(P1)*
`{ "key": "po_number", "value": "PO-1042" }` → re-runs from Sanity checks; stream on `/events`.

### `POST /api/invoices/{id}/rerun` *(P1)*

---

## Dashboard

### `GET /api/dashboard`
```json
{
  "kpis": { "processed": 24, "ready_pct": 58, "held_back_amount": 680000.0, "avg_decision_seconds": 9.4 },
  "exceptions_by_cause": [ { "cause": "duplicate", "count": 4 }, { "cause": "po_mismatch", "count": 3 }, { "cause": "fraud_risk", "count": 2 }, { "cause": "reading", "count": 1 }, { "cause": "tax", "count": 1 } ],
  "recent": [ /* same shape as queue items, last 20 */ ]
}
```

---

## Settings

### `GET /api/settings/rules` · `PUT /api/settings/rules`
```json
{ "version": 3, "tolerance_pct": 2.0, "tolerance_abs": 5000.0, "approval_limit": 1000000.0, "updated_at": "..." }
```
PUT bumps `version`.

### `GET /api/vendors` · `PATCH /api/vendors/{id}`
```json
[{ "id": "v_shree", "name": "Shree Packaging Pvt Ltd", "gstin": "06AAACS1234F1Z5", "state": "Haryana", "bank_account_masked": "XXXX XXXX 4821", "status": "approved", "tolerance_pct": null, "tolerance_abs": null, "email": "accounts@shreepack.example" }]
```
PATCH body: `{ "tolerance_pct": 3.0, "tolerance_abs": 10000 }` (null = use global).

### `GET /api/procurement/pos`
```json
[{ "number": "PO-1042", "vendor_name": "...", "type": "goods", "status": "open", "amount": 500000.0, "billed": 210000.0, "created": "2026-10-20", "lines": [ { "description": "...", "qty": 1200, "unit_price": 85.0, "received_qty": 1200 } ] }]
```
### `GET /api/procurement/invoices` — past invoice history (number, vendor, date, total, status).

### `POST /api/demo/reset` → `{ "ok": true }`

### `GET /api/integrations/gmail` *(P1)*
```json
{ "connected": true, "address": "northwind.ap.demo@gmail.com", "last_checked_at": "...", "auto_reply_unreadable": false }
```
`PUT /api/integrations/gmail` → `{ "auto_reply_unreadable": true }`
