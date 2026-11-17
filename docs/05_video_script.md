# 5-minute demo video — script & run sheet

**How to use this:** each section has **SHOW** (what's on screen and what to click) and **SAY** (the words). Read SAY naturally; you don't have to be word-perfect. Target length **≈ 4:50**.

**Live app:** https://web-production-9a768d3a.up.railway.app
**AP inbox:** northwind.ap.demo@gmail.com

---

## Part A — Record the iPhone clip first (once, ~10 min including setup)

You'll record a **35–40 second** phone screen recording and play it inside the main video. No editing needed.

### A1. Turn on screen recording on the iPhone (one-time)
1. **Settings → Control Center.**
   - iOS 17 or older: under *More Controls* tap the green **+** next to **Screen Recording**.
   - iOS 18: open Control Center (swipe down from the **top-right corner**), tap **+** at the top-left → **Add a Control** → search **Screen Recording** → add it.
2. Optional, to record your voice: in Control Center **press and hold** the record button → turn **Microphone On**. (You can also leave it off and narrate over it in the main video — easier.)
3. Turn on **Do Not Disturb** so no notifications appear in the clip.

### A2. What to have ready
- On the **laptop screen**, open the clean invoice full screen: `backend/samples/out/s0_happy.pdf` (or print it).
- On the iPhone, open **Safari → https://web-production-9a768d3a.up.railway.app** and allow the camera once beforehand (Scan → Allow), so the permission pop-up doesn't appear in the recording.

### A3. Record (35–40 s)
1. Swipe down from the top-right → tap the **record button** (circle). It counts down 3 s.
2. Then do exactly this:

| Step | On the phone |
|---|---|
| 1 | Show the **Queue** for 2 s (bottom bar: Queue · **Scan** · Dashboard). |
| 2 | Tap **Scan**. Point the camera at **your hand** → tap the shutter → **"No invoice in view. Retake?"** appears. Hold 2 s. |
| 3 | Tap **Retake**. Point at the **invoice on the laptop screen**, fill the frame → shutter → **"Page looks clear"**. |
| 4 | Tap **Use photo**. The 9 checks animate on the phone. Wait for **Ready to approve**. |
| 5 | Scroll a little to show the fields, then tap **Approve** in the sticky bottom bar. |

3. Stop: tap the **red pill / red time at the top-left** (or the Dynamic Island) → **Stop**. The video is saved in **Photos**.

### A4. Get the clip onto the laptop (Windows)
Easiest: **Photos → open the clip → Share → Save to Files → Google Drive** (or share to Google Drive app), then download it on the laptop.
Alternatives: plug the iPhone in with a cable → Windows **Photos app → Import**; or email it to yourself if it's under ~25 MB.

### A5. Clean up before the main recording
In the app on the laptop: **Settings → Data → Reset demo data** (removes the phone's test run so the queue is empty).

---

## Part B — Before you hit record on the laptop (5 min)

1. Chrome, full screen, zoom **110–125%** so text is readable in the video.
2. **Tab 1:** the app → **Settings → Data → Reset demo data** → back to **Queue** (empty).
3. **Warm-up** (avoids slow runs on camera): *Try a sample* → run **Clean invoice**, **Perfect match, new bank account**, **Third invoice on the same PO**, **Price 4% above PO** once each → then **Reset demo data** again. (Readings stay cached; the queue is empty again.)
4. **Tab 2:** your **personal Gmail**. Compose a new email (leave it open as a draft):
   - To: `northwind.ap.demo@gmail.com`
   - Subject: `Invoice PTI/26/0842`
   - Attach: `backend/samples/out/s5b_tol_over.pdf`
5. Have the **iPhone clip** open in the Windows video player, paused at 0:00 (window ready behind Chrome).
6. Close Slack/WhatsApp, turn on Windows **Focus / Do not disturb**. Start your recorder (Loom, or Windows **Snipping Tool → Record**, or **Win + Alt + R** with Xbox Game Bar).

> ⚠️ Use a **different** invoice for the email (s5b) than the ones you run from samples, or the email one will — correctly — be flagged as a duplicate.

---

## Part C — The script

### 1 · The problem — 0:00 → 0:20
**SHOW:** Queue screen, empty. Mouse still.
**SAY:**
> "An accounts-payable clerk gets hundreds of vendor invoices a month — by email, as PDFs, sometimes as a crumpled paper bill. For each one they find the purchase order, check the numbers and decide. It's slow, and the expensive mistakes — paying twice, or paying a fraudster's bank account — happen on a tired Friday afternoon.
> This is AP Desk. It reads every invoice, checks it against our procurement records, and recommends a decision with the evidence. A person always makes the final call."

### 2 · Happy path, live — 0:20 → 1:05
**SHOW:** Click **Try a sample** → **Clean invoice, exact PO match**. Let the **9 checks** animate on the left. When it finishes, hover the **verdict card** (Ready to approve · 100), then the **Document + fields** panel (point at one field's evidence text). Click **Approve**.
**SAY:**
> "Nine checks run live. Only step two uses AI — a vision model reads the invoice. Everything after that is plain rules, so the same invoice always gets the same answer and every decision can be explained.
> Each field shows the exact text it was read from and how confident the model is — it's not allowed to guess.
> Matches PO-1051, goods received, GST correct — ready to approve. One click."

### 3 · Edge case: fraud that looks perfect — 1:05 → 1:45
**SHOW:** Try a sample → **Perfect match, new bank account**. Point at **Vendor check** turning red, then the verdict **High risk – hold · 45** and the flag showing **both account numbers**. Click **Ask vendor** → show the draft for 3 s → **Cancel**.
**SAY:**
> "Now the dangerous one. Right vendor, right PO, right amounts — everything matches.
> But the invoice asks us to pay a *different bank account* than the one on file. That's the classic invoice-fraud pattern. A perfect match never outweighs one critical signal, so it's held, with both accounts side by side.
> And the drafted reply is deliberately neutral — 'routine verification, we'll call your registered contact' — we never tell a possible fraudster which check tripped."

### 4 · Edge case: split billing — 1:45 → 2:10
**SHOW:** Try a sample → **Third invoice on the same PO**. Point at the **PO billing bar** (earlier invoices · this invoice · over PO).
**SAY:**
> "Some problems are invisible one invoice at a time. This freight invoice is fine on its own — but two earlier invoices already used ₹2.1 lakh of a ₹3 lakh PO. With this one we're ₹30,000 over. The process remembers what's been billed, so split billing gets caught."

### 5 · Automated email inbox — 2:10 → 3:20  ⭐
**SHOW (in this order):**
1. Switch to **Tab 2 (Gmail)** → the prepared email to `northwind.ap.demo@gmail.com` with the PDF attached → **Send**.
2. Back to the app → **Settings → Integrations**: show **Gmail inbox · Connected** and the **Auto-reply to unreadable documents** toggle → click **Check now** → toast "1 new invoice queued".
3. **Queue** → the new row has the **✉ email** icon → open it. Header shows **"Email · from <your name>"**. Verdict: **Needs review · Price +4.0% above PO**; point at the flag (price vs PO, tolerance).
4. Click **Ask vendor** → show the draft (To: your address, Subject: **Re: Invoice PTI/26/0842**) → **Send**.
5. Switch to **Gmail** → open the conversation → the reply is **inside the same thread**.
**SAY:**
> "Real invoices arrive by email, so the app has its own AP inbox. I'll email this invoice like a vendor would.
> It checks the inbox every 30 seconds — 'Check now' saves time. There it is: picked up from the email, no upload, no typing.
> The price is 4% above the PO, more than our 2% tolerance, so it needs review. One click on 'Ask vendor' — the reply is already drafted for this exact problem — send.
> And it lands back in the vendor's *same email thread*, so they see it in context.
> There's also an optional auto-reply: if a vendor sends an unreadable photo, the app asks them for a clear copy by itself — but it never auto-sends anything about fraud."

### 6 · On the phone — 3:20 → 4:00
**SHOW:** Switch to the **video player** with the iPhone clip → press play (full screen or large window). Talk over it.
**SAY (timed to the clip):**
> "It's also built for the phone — for the site manager or receptionist who's handed a paper bill.
> *(hand)* If there's no invoice in the frame, it says so before uploading anything — the check runs on the phone itself.
> *(invoice)* A clear page passes, it uploads, and the same nine checks run live on the phone.
> *(approve)* The verdict and evidence fit on one screen, with Approve and Reject right under your thumb."

### 7 · Everything else it handles — 4:00 → 4:30
**SHOW:** Back to the app → **Queue → Try a sample** → slowly scroll the **list of 11 scenarios** (don't run them). Then **Settings → Rules** for 3 s (tolerance 2% / ₹5,000, rules version).
**SAY:**
> "Other scenarios it handles: duplicates re-sent as phone photos, bills with no PO number — it infers the likely PO and says how sure it is — quotations sent instead of invoices, the wrong GST type, billing for goods we never received, and hidden text telling the AI to 'approve this', which it catches and ignores.
> Tolerances are settings, even per vendor, and every decision records which rules version it used."

### 8 · Dashboard & wrap — 4:30 → 4:50
**SHOW:** **Dashboard**: KPI tiles (Invoices processed · Clean on arrival · **Held back** · Avg. check time) and the recent runs list.
**SAY:**
> "The dashboard shows every run, and the money held back — payments we did *not* make by mistake.
> In short: the AI only reads, rules decide, nothing is ever paid without a person, and every decision comes with its reasons. Thanks for watching."

---

## Feature checklist — everything the video covers

| Feature | Section |
|---|---|
| Live 9-stage run view | 2 |
| AI reads, rules decide (consistent, auditable) | 2, 8 |
| Evidence + confidence per field, no guessing | 2 |
| Human always decides (Approve / Reject / Ask vendor) | 2, 3, 5 |
| Bank-change fraud hold, critical flag beats a perfect match | 3 |
| Neutral vendor message when fraud is suspected | 3 |
| Cumulative / split billing across invoices (PO bar) | 4 |
| **Gmail AP inbox: automatic intake** | 5 |
| **Check now, email source shown on the invoice** | 5 |
| **Drafted reply sent in the same email thread** | 5 |
| **Auto-reply for unreadable documents (never for fraud)** | 5 |
| Price tolerance | 5, 7 |
| **Mobile: Scan, "no invoice in view" check, live run, one-thumb approve** | 6 |
| Duplicates, PO inference, wrong GST, not-an-invoice, three-way match, prompt injection | 7 |
| Per-vendor tolerance, rules versioning | 7 |
| Dashboard: history, held back | 8 |

---

## If something goes wrong while recording

| Problem | What to do |
|---|---|
| A run takes > 15 s | Keep talking over the live checks ("the model is reading the page"); it's still live. |
| Email doesn't appear after *Check now* | Wait 10 s, press again (Gmail can lag). Fallback: upload the same PDF and say "same flow as an email". |
| Reply lands in Spam | Before recording, send one test and mark it **Not spam**; then it lands in the inbox. |
| Something breaks badly | Stop, **Reset demo data**, restart from that section. A clean retake is fine. |

---

## Live interview: run order (no time limit, they'll ask questions)

1. Happy path → Approve.
2. Bank change → neutral vendor draft.
3. Split billing → PO bar.
4. **Phone, live:** scan your hand (rejected) → scan the near-duplicate photo (`s2_dup_photo.jpg` on the laptop screen) → "Duplicate of SP/26-27/1023".
5. Crumpled photo, no PO → "likely PO-1049": explain inference + confidence.
6. Tolerance: 4% sample → *Needs review* → **Settings → Vendors → Precision Tools → tolerance 5%** → back to the invoice → **Re-run** → *Ready*. "Rules are settings, not code; every decision records the rules version."
7. Prompt-injection sample → two independent detectors (the model + a text scan).
8. Email loop live, as in the video.

**Questions to be ready for**
- *Why not let the LLM decide?* — Consistency, audit, cost and safety (prompt injection). LLMs are good at reading messy documents; rules are good at policy.
- *What if the model misreads a number?* — Evidence quote + confidence per field; maths re-checked; GSTIN checksum repair; low confidence → *Needs review*; reviewers can correct a field and re-run.
- *How would this scale to 10,000 invoices a month?* — Queue + worker pool, Postgres, ERP connector instead of the seeded data, reading cache, learned per-vendor rules. The model call is ~5–10 s; everything else is milliseconds.
- *What would you measure?* — Touchless rate, exceptions by cause, ₹ held back, time to decision, reviewer overrides (where rules and humans disagree).
- *Biggest limitations?* — One invoice per file, no learning from corrections yet, demo data instead of a real ERP, sending via Brevo because the host blocks SMTP.
