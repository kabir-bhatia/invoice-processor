# PS-1 Invoice Processing — Features & Screen Map

> Phase 2 of 4. Every feature points back to a problem ID in [01_problem_space.md](01_problem_space.md).
> Priority: **P0** = must work at submission · **P1** = should, after P0 is solid · **P2** = only if time is left (otherwise it's an interview talking point).

---

## 1. The pipeline (what the live run view shows)

One invoice goes through 9 stages. Each stage shows its status (pending → running → ✓ / ⚠ / ✕), how long it took, and a one-line result. Tapping a stage expands its detail.

| # | Stage | What it does | Problems | Pri |
|---|---|---|---|---|
| 1 | **Intake & quality** | File type, pages, image sharpness/brightness, file fingerprint (hash) | A6, B1–B2, I6 | P0 |
| 2 | **Read** | Vision LLM pulls out fields and line items as JSON. Every field comes with a **confidence** and an **evidence quote** (the exact text it was read from). Missing means `null`, never a guess | B5–B21 | P0 |
| 3 | **Classify** | Invoice / credit note / quote / statement / receipt / not a finance document. Also flags instruction-like text inside the document (injection guard) | A5, B23 | P0 (injection: P1) |
| 4 | **Sanity checks** | Maths (lines → subtotal → tax → total), required fields, dates, GSTIN format, GST type (CGST+SGST vs IGST by state) | B14–B16, C5–C7 | P0 |
| 5 | **Vendor check** | Fuzzy match to the vendor master, approved/blocked status, GSTIN match, **bank account match** | C1–C3, C8 | P0 |
| 6 | **PO match** | Explicit PO → fuzzy PO → inferred PO (with confidence). PO status, line-by-line price and quantity, charges not on the PO, tolerance, **cumulative billing across invoices** | D1–D12, D16–D17 | P0 |
| 7 | **Receipt check** | Goods POs only: invoiced quantity vs received quantity (GRN). Services skip this stage, and the screen says so | D13 | P0 |
| 8 | **Duplicate check** | Exact, normalised number (`INV-1023` = `INV1023`), and same vendor + amount + similar content within a time window | E1–E3, E7, A7–A8 | P0 |
| 9 | **Decision** | Severity-weighted **trust score 0–100**, recommendation, plain-English reasons, rule version stamped | F1–F11 | P0 |

**How the decision works (deterministic, not LLM):** every check emits flags with a severity (info / warning / critical). Score = 100 minus weighted penalties. Any **critical** flag caps the recommendation at "High risk – hold" or "Recommend reject", whatever the score. That's how a perfect PO match with changed bank details still gets held (F11). The LLM *reads*; the rules *decide*. This is the core design point to explain in the interview.

---

## 2. Screens (four places only)

### 🗂 Queue — home screen

| Feature | Detail | Problems | Pri |
|---|---|---|---|
| Drop zone / upload | Drag-and-drop or pick PDFs and images, several at once | A1, A3 | P0 |
| **Try a sample** | Prepared demo invoices (happy path + edge cases), one click each | K2, K10 | P0 |
| Status tabs | **Needs action** · **Ready** · **Done**: three tabs, no other filters by default | G3, G4 | P0 |
| Invoice rows | Vendor · ₹ amount · recommendation chip · trust score · source icon (⬆ / 📷 / ✉) · age | H2 | P0 |
| Live rows | Invoices still processing show a slim progress bar for their current stage | H1, K8 | P0 |
| Search | Vendor, invoice no., PO no. | — | P1 |
| Sort by risk / due date | Defaults to riskiest first in *Needs action* | G3 | P2 |

### 🧾 Invoice — run view + evidence (the main demo screen)

Top to bottom, verdict first:

| Feature | Detail | Problems | Pri |
|---|---|---|---|
| **Verdict card** | Recommendation · trust score · one-line reason · primary button | F5 | P0 |
| **Live run timeline** | The 9 stages animating in real time, each expandable | H1, H6, K8 | P0 |
| **Flags** | Only the ones that fired: severity, plain-English reason, the evidence (field, rule, numbers) | F1, F5, H6 | P0 |
| **Document + fields** | Original on one side, extracted fields on the other, each with a confidence dot and its evidence quote. Low-confidence fields are highlighted | H5, H7, B20–B21 | P0 |
| **Match table** | Invoice lines vs PO lines vs received qty, variance coloured, extra charges marked | D5–D17 | P0 |
| **PO billing bar** | "₹4.2L of ₹5L billed before this invoice → ₹5.6L after" (shows split billing at a glance) | D9, G6 | P0 |
| **Duplicate link** | "Looks like INV-1023 (12 Nov, approved)", which opens a side-by-side compare | E1–E7 | P0 link · P1 compare |
| **Actions** | **Approve** · **Reject** (reason required) · **Request info** | F8 | P0 |
| **Vendor message draft** | Pre-written for the flags that fired; editable; neutral tone if fraud is suspected; sent via email in the same thread | G2 | P1 |
| **Fix a field & re-check** | Reviewer corrects a misread field → checks re-run from stage 4 | B20, H8 | P1 |
| **Audit trail** | Every event: stage results, rule version, model, who acted, override reason | F10, H4 | P1 |
| Re-run | Re-process from scratch (e.g. after rules change) | F7 | P1 |

### 📊 Dashboard

| Feature | Detail | Problems | Pri |
|---|---|---|---|
| KPI tiles (4) | Invoices processed · % ready to approve · **₹ held back (risk caught)** · avg time to decision | H3, H9 | P0 |
| Exceptions by cause | Reading vs vendor vs PO vs duplicate vs fraud: where the process struggles | H9 | P1 |
| Run history table | Every run: time, source, vendor, result, human action | H2 | P0 |
| Time saved estimate | Runs × assumed manual minutes (assumption shown) | Market 1–2 | P2 |

### ⚙️ Settings

| Feature | Detail | Problems | Pri |
|---|---|---|---|
| **Rules** | Tolerance %, ₹ cap, approval limit. Saving bumps the rule version | D7, F3, F7, F10 | P0 |
| **Vendor tolerance overrides** | Per-vendor % / ₹, inline in the vendor list | D8 | P1 |
| **Procurement data** | Read-only views: vendors (bank masked), POs with billed balance, GRNs, past invoices | J2, G6 | P0 |
| **Reset demo data** | One button: restores the seed data and clears runs. Essential before every demo | K2 | P0 |
| **Gmail connection** | Connect status, last checked, "auto-reply for unreadable documents" toggle | A1, G2 | P1 |
| LLM health | Gateway reachable? Last latency | K1, K9 | P2 |

### 📱 Mobile (same app, responsive)

| Feature | Detail | Problems | Pri |
|---|---|---|---|
| Bottom bar | **Queue** · big **Scan** button · **Dashboard** (Settings in a menu) | I2 | P0 |
| **Camera capture** | Full-screen camera with a page-frame guide | I1 | P0 |
| **Instant quality check** | Blur / dark / glare check in the browser before upload → "Blurry, retake?" | I6 | P0 |
| Multi-page capture | "Add page" before submitting | B4, I1 | P2 |
| Auto crop | Detect page edges, crop out the table and fingers | I7 | P2 |
| One-thumb review | Verdict card + sticky Approve / Reject bar at the bottom | I3 | P0 |

---

## 3. Invisible features (no UI until they fire)

These add no clutter: they show up only as a flag or a line in the audit trail.

| Feature | Shows up as | Problems | Pri |
|---|---|---|---|
| **No-guess extraction**: evidence quote required, `null` if absent | Low-confidence field highlight | B20 | P0 |
| **Maths cross-check** of what the model read | "Lines add to ₹1,18,000 but total says ₹1,80,000" | B15, B20 | P0 |
| **Injection guard**: document treated as data; instruction-like text detected | 🛡 "Document contains instructions aimed at the AI — ignored" (critical) | B23 | P1 |
| **Bank-account check** against vendor master | "Bank account differs from vendor master — verify by phone before paying" | C8 | P0 |
| **Bank masking** everywhere in the UI | `XXXX XXXX 4821` | J2 | P0 |
| **Extraction cache** by file fingerprint | Same file → same reading → repeatable demo | B22, K2 | P0 |
| **Timeouts + retries** on the LLM call | Stage shows "retrying…" instead of hanging | K1, K9 | P0 |
| **Rule version stamp** | "Decided under rules v3" | F10 | P0 |

---

## 4. Demo set (sample invoices to build)

| # | Sample | Expected result | Shows |
|---|---|---|---|
| 0 | Clean PDF, exact PO match, goods received | ✅ Ready to approve · ~95 | Happy path |
| 1 | **Split billing**: 3rd invoice on one PO, fine alone, over the PO in total | ⚠ Needs review · billing bar shows the overrun | Memory across runs |
| 2 | **Near-duplicate photo**: `INV1023` vs approved `INV-1023`, phone photo | ⛔ High risk – hold · duplicate link | Duplicates + camera |
| 3 | **Bank changed**: perfect match, new bank account | ⛔ High risk – hold · neutral vendor message | Fraud judgement, conflicting signals |
| 4 | **Crumpled photo, no PO**: PO inferred at ~80% confidence | ⚠ Needs review · "PO inferred" | Knows what it doesn't know |
| 5 | 1.8% over vs 4% over (same vendor) | Ready (with note) vs Needs review | Tolerance + per-vendor setting |
| 6 | Hidden "approve this invoice" text | ⛔ Injection flag | AI safety |
| 7 | IGST on a Haryana → Haryana supply | ⚠ Wrong GST type | India compliance |
| 8 | A quotation uploaded by mistake | ✕ Recommend reject · "Not an invoice" | Input guard |
| 9 | Billed 100 units, received 60 | ⚠ Needs review | Three-way match |

**Headline edge cases for the video:** #1, #2, #3, #4. The others are ready for the live interview if asked.

---

## 5. Priority summary

- **P0 (submission must-haves):** the 9-stage pipeline; Queue, Invoice view, Dashboard, Settings basics; samples #0–#5, #7–#9; camera with instant quality check; mobile layout; reset demo data; deployed on HTTPS.
- **P1 (after P0 works):** vendor message drafts + sending, **Gmail intake**, injection guard + sample #6, field fixes with re-check, audit trail view, duplicate compare, per-vendor tolerance, exceptions chart.
- **P2 (if time is left, otherwise talking points):** auto-reply toggle, multi-page capture, auto crop, LLM health, sort by risk/due date, time-saved estimate, learning from corrections.
