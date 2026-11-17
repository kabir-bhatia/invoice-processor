# Independent design critique

One round (a second round was dropped at the user's request). The reviewer was a fresh agent with no project context. It was given only the app URL and the line "an internal tool for an accounts-payable team to review invoices", and it reviewed the running mock-mode app at 1440×900 and 375×812.

## Scores

| Area | Score | Reviewer's reason |
|---|---|---|
| Visual quality | 7/10 | Calm and consistent, but generic, with a few ragged tables and cramped small text |
| Ease of use | 7/10 | Verdict, reason and actions sit together; no undo, no sort or bulk action |
| Clarity | 6/10 | Plain-English reasons are the best part; undermined by contradictory counts and stale status labels |
| Mobile | 7/10 | Sticky action bar and bottom sheets work well; queue rows lost information and one menu was broken |

(The reviewer's baseline: "a typical decent internal tool is a 6".)

## Findings and what was done

| # | Finding | Action |
|---|---|---|
| 1 | Checks count and flag count disagree; Decision counted as a failed check | **Fixed.** Decision is no longer counted or shown as a failure. Summary reads "2 checks raised something" / "No check raised a problem". Info-only flags are titled "1 note" |
| 2 | After a decision the card still leads with the old recommendation; "Rejected" had a tick | **Fixed.** Final status leads (Approved / Rejected / Waiting on vendor, each with its own icon); the recommendation is demoted to "Recommended: …" |
| 3 | "Info requested" filed under Done; vendor message still "Draft" | **Partly fixed.** Label is now "Waiting on vendor" (amber) and the mock marks the message as sent. It still sits in the Done tab because the contract defines Done as "human action taken". See open issues |
| 4 | One-click Approve has no undo | **Not changed.** One-click approve for Ready is a locked product decision; undo needs an API that does not exist. See open issues |
| 5 | Decisions vanish on reload | **Not a UI bug.** Mock state is in memory by design; the real backend persists |
| 6 | Mobile "…" button tiny, menu did not close | **Fixed.** Larger icon; opens a bottom sheet that closes on Esc and backdrop |
| 7 | Mobile queue rows drop the reason and score; no search | **Fixed.** Rows now show the trust score and the one-line reason; search added on mobile |
| 8 | No column headers in Queue and Recent runs | **Fixed.** Header rows added on desktop |
| 9 | Recent runs drops the vendor at ~1000px | **Fixed.** The Decision column now hides first (below 1024px) |
| 10 | KPI tiles ambiguous | **Fixed.** Renamed ("Clean on arrival", "Avg. check time") and each tile has a one-line caption |
| 11 | Rules values unformatted; Save looks disabled with no hint | **Fixed.** Indian grouping in the inputs; hint reads "No changes to save" |
| 12 | PO amounts wrap unevenly in Settings → Data | **Fixed.** No-wrap, wider column |
| 13 | Audit times have no date | **Fixed.** Date and time shown. (Email source plus "Photo" intake is correct: a photo sent by email) |
| 14 | Document is small and below the fold; line items missing when there is no PO | **Partly fixed.** Line items are listed under the fields when there is no PO; image is slightly taller. The layout stays verdict-first by design |
| 15 | Desktop action bar scrolls away | **Not changed.** Open issue |
| 16 | Raw "Model timed out, retrying (2/3)" | **Fixed.** Shows "Taking longer than usual. Retrying…" |
| 17 | Small grey text contrast | **Checked, not changed.** `ink-3` on white is 4.9:1 (passes AA) |
| 18 | Toast covers a link on mobile | **Fixed.** Toasts appear at the top on mobile |
| 19 | Cards looked washed-out after load | Reviewer's own caveat: background tab stalling animations. Not reproduced |
| AI-look | Uppercase tracked card labels; "You decide…" line on every invoice; demo-speak ("In production this is the ERP"); raw sharpness numbers | **Fixed.** Card titles are sentence case; the reassurance line is gone; copy cleaned; quality shown as Good / Soft / Low |
| AI-look | Dashboard is the stock four-tiles layout; "N" monogram; trust score shown as number + bar + pill | **Not changed.** The four KPIs are a P0 requirement. Trust score now has a tooltip explaining it |

## Open issues

1. **Fixes re-checked on screen** at 1440px and 375px after the change (Queue with headers and mobile reason line, decided invoice, more-actions sheet, reject flow, Dashboard, Rules). One extra bug found and fixed in that pass: the mobile "more" button was squashed by conflicting padding.
2. **"Waiting on vendor" belongs in its own tab** or under Needs action. Needs a contract change (`QueueTab`), so it is logged as request 6 in `api_requests.md`.
3. **Undo after Approve/Reject** (5-second toast) needs an API to clear `human_action` (request 7 in `api_requests.md`).
4. **Sticky decision bar on desktop** for long invoices.
5. **Camera capture not tested on a real phone.** The browser pane blocks camera access, so only the fallback screen and the quality maths (sharp / blurry / dark / glare on synthetic pages) were verified. Glare threshold may need tuning on real white paper.
6. Sorting and bulk approve in the queue (P2 in the feature list).
