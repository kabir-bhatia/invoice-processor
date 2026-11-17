# PS-1 Invoice Processing — UI Layout & Build Plan

> Phase 3–4 of 4. Features come from [02_features.md](02_features.md).
> Working name: **Northwind AP Desk** (the internal AP tool of our fictional buyer, Northwind Components Pvt Ltd). Easy to rename.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | **Python + FastAPI** | Your strongest language; async suits LLM calls, live events and the Gmail checker |
| Live run view | **Server-Sent Events (SSE)** | One-way stream of stage updates to the browser. Simpler than WebSockets |
| LLM | **Hyde gateway → `hyde/glm-5.3-flash`** via the OpenAI SDK, temperature 0, JSON mode, image input | The only model the key allows; vision + JSON verified |
| PDF handling | **PyMuPDF** | Renders pages to images for the model and pulls the text layer when there is one (used to cross-check the model) |
| Image quality | **OpenCV** on the server (sharpness / brightness / glare); the same maths in **JS canvas** on the phone | Instant "Blurry, retake?" with no LLM call |
| Fuzzy matching | **RapidFuzz** | Vendor names, invoice-number duplicates |
| Database | **SQLite** | Writable, zero setup, one file; reset = restore the seed |
| Frontend | **React + Vite + Tailwind**, built and served by FastAPI | Clean, professional look fast; one deployable app; responsive for mobile |
| Email (P1) | **IMAP** (read) + **SMTP** (reply) with a Gmail App Password | No OAuth screens, no MCP |
| Sample invoices | **ReportLab** (PDFs in different vendor layouts) + **OpenCV** (turn some into realistic phone photos: skew, shadow, blur, crumple) | Controlled, realistic, repeatable inputs |
| Hosting | **Railway** (always-on, persistent volume, HTTPS) · fallback: run locally + **Cloudflare Tunnel** for an HTTPS link | Camera needs HTTPS; Gmail checking needs an always-on server; SQLite needs a disk that survives restarts |

---

## 2. Data model (SQLite)

| Table | Holds |
|---|---|
| `vendors` | name, aliases, GSTIN, state, **bank account**, status (approved / blocked), tolerance override |
| `purchase_orders` + `po_lines` | PO number, vendor, type (goods / services), status, dates, lines (item, qty, unit price, GST rate) |
| `grns` + `grn_lines` | goods received per PO line |
| `invoices` | one row per run: source (upload / camera / email), file hash, extracted JSON, recommendation, trust score, rule version, human action + reason |
| `invoice_lines` | extracted line items |
| `flags` | per invoice: code, severity, message, evidence |
| `events` | audit trail: stage start/end, results, human actions, timestamps |
| `rules` | versioned settings: tolerance %, ₹ cap, approval limit |
| `extraction_cache` | file hash → extraction JSON (repeatable demos) |
| `emails` (P1) | Gmail message ID, thread, sender, linked invoice |

Seed: about 8 vendors, about 15 POs, matching GRNs, about 10 past invoices, prepared so every sample in the demo set has the history it needs.

---

## 3. UI layout

### Visual style
- **Font:** Inter. **Colours:** white / soft-grey surfaces, near-black text, **one accent (indigo)**; status only: green (ready), amber (review), red (hold/reject).
- Rounded cards, thin borders, no heavy shadows, generous spacing. Feel: Linear / Stripe / Ramp.
- Numbers in Indian format (₹1,23,456) with tabular figures so columns line up.

### Desktop: left sidebar + content

```
┌──────────┬──────────────────────────────────────────────────────────┐
│ ◆ AP Desk│  Queue                              [Try a sample ▾] [⬆ Upload] │
│          │  ┌────────────────────────────────────────────────────┐  │
│ ▣ Queue  │  │   Drop invoices here — PDF or image                 │  │
│ ◔ Dash   │  └────────────────────────────────────────────────────┘  │
│ ⚙ Settings│  Needs action (4)   Ready (2)   Done (11)               │
│          │  ─────────────────────────────────────────────────────── │
│          │  ✉ Shree Packaging   ₹1,84,200   ⛔ Hold     32   2m    │
│          │  📷 Apex Metals      ₹96,400     ⚠ Review    71   5m    │
│          │  ⬆ Orbit Logistics   ₹42,000     ▰▰▰▱▱ Matching PO…      │
│ ● Gmail  │                                                          │
│   live   │                                                          │
└──────────┴──────────────────────────────────────────────────────────┘
```

### Invoice view (main demo screen): verdict on top, two columns below

```
← Queue    Shree Packaging · INV1023 · ₹1,84,200                    ✉ email
┌────────────────────────────────────────────────────────────────────────┐
│ ⛔ HIGH RISK — HOLD          Trust 32/100                               │
│ Looks like INV-1023 already approved on 12 Nov (same amount, same PO). │
│                          [ Request info ]  [ Reject ]  [ Approve anyway ]│
└────────────────────────────────────────────────────────────────────────┘
┌─ Run ───────────────────────┐ ┌─ Document ─────────┬─ Extracted ──────┐
│ ✓ Intake & quality   0.2s  │ │                    │ Invoice no INV1023●│
│ ✓ Read               3.1s  │ │   [invoice image]  │ Date  14-11-2026 ● │
│ ✓ Classify  Invoice  0.0s  │ │                    │ PO    PO-1042    ● │
│ ✓ Sanity checks      0.0s  │ │                    │ Total ₹1,84,200  ● │
│ ✓ Vendor  matched    0.1s  │ │                    │ ● high  ● low conf │
│ ✓ PO match  PO-1042  0.1s  │ └────────────────────┴──────────────────┘
│ ✓ Receipt  received  0.0s  │ ┌─ Flags (1) ──────────────────────────────┐
│ ✕ Duplicate  INV-1023 0.1s │ │ ⛔ Possible duplicate of INV-1023 → compare│
│ ✓ Decision  Hold     0.0s  │ └──────────────────────────────────────────┘
│                             │ ┌─ PO-1042 ── billed ▰▰▰▰▰▰▰▱▱ 78% → 115% ┐
│ Rules v3 · glm-5.3-flash    │ │ line table: invoiced / ordered / received│
└─────────────────────────────┘ └──────────────────────────────────────────┘
                                 ▸ Vendor message (draft)   ▸ Audit trail
```

- While running, the timeline animates stage by stage; the verdict card shows a skeleton until stage 9.
- Flags, PO bar and match table appear only when they have something to say.
- "Vendor message" and "Audit trail" are collapsed by default.

### Dashboard

```
 Processed 24 │ Ready to approve 58% │ ₹ held back ₹6.8L │ Avg decision 9.4s
 ┌─ Exceptions by cause ────────────┐ ┌─ Recent runs ────────────────────┐
 │ Duplicate ▰▰▰▰  PO ▰▰▰  Fraud ▰▰ │ │ time · source · vendor · result  │
 └──────────────────────────────────┘ └──────────────────────────────────┘
```

### Settings: one page, four tabs
**Rules** (tolerance %, ₹ cap, approval limit, current version) · **Vendors** (master list, masked bank, tolerance override) · **Data** (POs with billed %, GRNs, past invoices, **Reset demo data**) · **Integrations** (Gmail status, auto-reply toggle).

### Mobile

```
┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
│ Queue                 │   │  ┌─────────────────┐  │   │ ⚠ NEEDS REVIEW   71   │
│ Needs action · Ready  │   │  │                 │  │   │ PO inferred (80%)     │
│ ─────────────────────│   │  │  page frame     │  │   │ ✓✓✓✓⚠✓✓✓✓ stages      │
│ ⛔ Shree   ₹1,84,200  │   │  │                 │  │   │ Flags · Fields ·Match │
│ ⚠ Apex    ₹96,400    │   │  └─────────────────┘  │   │                       │
│                       │   │  ⚠ Blurry — retake?   │   │                       │
│ ▣ Queue  ( ◉ Scan )  ◔│   │  [Retake]   [Use it]  │   │ [ Reject ] [ Approve ]│
└───────────────────────┘   └───────────────────────┘   └───────────────────────┘
        Queue                    Scan + instant check         One-thumb review
```

---

## 4. Build plan

Effort is in focused hours. I write most of the code; your time goes into checking results, the camera test on your phone, accounts, and the video.

### Step 0: Model spike *(30 min, before anything else)*
Generate 3 sample invoices (clean PDF, scanned-looking, crumpled photo) and check that `glm-5.3-flash` reads them accurately with evidence quotes. **If it reads photos poorly, we change the extraction design now** (e.g. PDF text layer first, model second), not on day 2.

### Milestone 1: Data and samples *(2 h)*
- Project scaffold, `.env`, requirements.
- Seed CSVs → SQLite (vendors, POs, GRNs, past invoices).
- Sample generator: 10 demo invoices in 4–5 vendor layouts, plus photo versions of some.
- `expected_results.csv`: what each sample *should* produce.

### Milestone 2: Pipeline engine *(3–4 h)*
- The 9 stages as plain Python functions, each emitting events.
- Extraction prompt + JSON schema (confidence + evidence per field, `null` if absent).
- Rules + flag severities + trust score + recommendation.
- **Regression runner**: one command runs all 10 samples and compares to `expected_results.csv`. This is what makes the live demo safe.

✅ *Checkpoint: all samples give their expected result from the command line.*

### Milestone 3: API *(1 h)*
- Upload / sample / list / detail / action / settings / reset endpoints.
- SSE stream of stage events per invoice; runs saved to SQLite.

### Milestone 4: Desktop UI *(4 h)*
- Shell + sidebar, Queue with live rows, Invoice view with live timeline, Dashboard, Settings.

### Milestone 5: Mobile + camera *(2 h)*
- Responsive layouts, bottom bar, Scan screen, in-browser quality check, one-thumb review.

### Milestone 6: Deploy *(1–1.5 h)*
- Railway (or local + Cloudflare Tunnel), HTTPS, persistent DB, test the camera on your phone.

✅ *Checkpoint: **P0 complete.** Record a rough backup video now, so there is always something to submit.*

### Milestone 7: Email (P1) *(2–2.5 h)*
- Vendor message drafts (template per flag type, neutral tone for fraud).
- SMTP send in the same thread; Gmail IMAP checker → auto-queue.

### Milestone 8: Extras (P1) *(1–1.5 h)*
- Injection guard + sample #6, audit trail view, fix a field & re-check, duplicate compare, per-vendor tolerance.

### Milestone 9: Finish *(1.5 h)*
- Polish pass, README (assumptions, how to run, design decisions), rehearse the demo order, record the 5-minute video.

**Total: about 18–20 focused hours.** If time runs short, cut from the bottom: Milestone 8 first, then the Gmail checker (keep the vendor message draft).

---

## 5. What I'll need from you (and when)

| When | What |
|---|---|
| Now | The **exact submission deadline** (date + time), so the plan can be cut to fit |
| Milestone 6 | A **Railway account** (GitHub sign-in), or OK to use the local + Cloudflare Tunnel fallback |
| Milestone 6 | Your phone, to test the camera on the live link |
| Milestone 7 | A **new Gmail account** for the demo with 2-step verification on and an **App Password** created. Use a fresh account, never your personal one |
| Milestone 9 | You: recording the video (I'll write the script and the demo order) |
