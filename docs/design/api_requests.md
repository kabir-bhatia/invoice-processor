# API notes from the frontend

Nothing here blocks the UI. The frontend is built to the contract in `docs/04_api_contract.md` as written. These are small requests and assumptions for the backend session.

## Assumptions the frontend makes (please confirm or tell me)

1. **`GET /api/invoices/{id}` while `status: "processing"`** returns the same shape with `decision: null`, `stages` holding whatever has finished (missing stages are treated as pending), and `fields` filled as soon as the Read stage is done. The UI re-fetches once when the `read` stage event arrives, so fields can show before the run ends, and again on `done`.
2. **SSE `stage` events** may carry `details` (same object as in the detail response). Optional; if absent the row is just not expandable until the final re-fetch.
3. **SSE `error` event** is a named event with a JSON `data` payload. A transport-level `error` (no data) is ignored and left to EventSource's auto-reconnect.
4. **Processing rows in the queue** come back under `tab=needs_action` so a new upload is visible on the default tab. `vendor_name`, `invoice_number` and `total` may be `null` until Read finishes; the row then shows "New invoice".
5. **`POST /api/invoices/{id}/action`**: `reason` is sent as an empty string when not required.
6. **`PATCH /fields` and `POST /rerun`** return any 2xx; the UI then re-opens the event stream. After a field fix the UI calls `PATCH` then `rerun` (and ignores a failure of the second call, since `PATCH` already re-runs).
7. **`page_urls`** are plain image URLs usable in `<img src>`.

## Requests (nice to have)

| # | Request | Why |
|---|---|---|
| 1 | Add `po_number` to queue items | Search by PO is already supported via `q`; showing the PO in the row would explain why a row matched |
| 2 | In `flags[].evidence`, keep keys human-readable (`"On invoice"`, `"In vendor master"`) and values pre-formatted strings where they are not plain rupee amounts | The UI renders evidence as a key/value list. Keys ending in `_id` and `other_invoice_*` are hidden and used for the "Open INV-1023" link. Bare numbers are shown as rupees |
| 3 | `stages[].details`: same convention, flat key/value, human-readable keys | Rendered as-is when a check row is expanded. Numbers ≥ 1000 are shown as rupees |
| 4 | `GET /api/invoices/{id}` → `next_id` (optional): the next invoice in `needs_action` | The UI offers "Next invoice" after a decision. Today it fetches the queue to work this out, which is fine |
| 5 | `GET /api/procurement/pos` lines could include `unit` | Not shown today; would let the PO view print "60 of 100 rolls received" |
| 6 | A fourth queue tab `waiting` (human action = `info_requested`), or count those under `needs_action` | An invoice waiting on the vendor is not finished, but the contract files every human action under `done`. The UI labels these rows "Waiting on vendor" for now |
| 7 | `POST /api/invoices/{id}/action` with `{ "action": "undo" }` (clears `human_action`, adds an audit event) | Lets the UI offer a 5-second undo after Approve or Reject |

## Mock mode

`npm run dev:mock` (or `VITE_MOCK=1`) swaps `src/api/http.ts` for `src/api/mock/`. Screens only import from `src/api/index.ts`, so nothing else changes when the backend is live. In mock mode uploads are mapped to prepared scenarios in rotation (upload: clean, split billing, bank change, short receipt; camera: crumpled photo, near-duplicate).
