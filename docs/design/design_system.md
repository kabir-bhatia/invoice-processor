# Northwind AP Desk: Design System

The source of truth for tokens is `frontend/src/index.css` (`@theme` block, Tailwind v4). Shared components live in `frontend/src/components/ui.tsx`.

## Principles

1. **Verdict first, evidence on demand.** Every screen leads with the answer (recommendation, trust score, one-line reason). Detail is one tap away, never in the way.
2. **Numbers and status do the talking.** Short labels, no explanatory paragraphs. If a sentence can be a number, it is a number.
3. **Things appear when they fire.** Flags, PO bar, match table, vendor message and audit trail render only when they have something to say.
4. **One primary action per screen.** Only one filled button is visible at a time.
5. **Colour means status.** Green, amber and red are never decoration. Everything else is neutral plus one accent.

## Colour

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F5F5F2` | Page background (warm grey) |
| `surface` | `#FFFFFF` | Cards, bars, dialogs |
| `subtle` | `#EFEFEB` | Hover, inset evidence boxes, bar tracks |
| `line` / `line-strong` | `#E3E3DD` / `#CFCFC7` | Card borders and dividers / input and button borders |
| `ink` | `#1B1D1F` | Primary text |
| `ink-2` | `#4B5056` | Secondary text |
| `ink-3` | `#696F76` | Labels, meta (4.9:1 on white, passes AA) |
| `accent` | `#2B4570` | The one accent: primary button, active nav on mobile, links, "this invoice" bar segment |
| `accent-soft` | `#E8EDF5` | Drop-target tint |
| `ok` / `ok-soft` | `#256A48` / `#E6F1EA` | Ready to approve, passed check |
| `warn` / `warn-soft` | `#86590A` / `#F6EEDB` | Needs review, warning, low confidence |
| `risk` / `risk-soft` | `#A83E2A` / `#F6E6E2` | High risk hold, recommend reject, failed check |

Status colours are desaturated and always paired with an icon and a text label, so nothing relies on colour alone. All status text on its soft background is 4.5:1 or better.

Recommendation mapping: Ready = ok + check · Needs review = warn + triangle · High risk hold = risk + octagon · Recommend reject = risk + crossed circle. Hold and reject share a colour and differ by icon and label.

## Type

- **IBM Plex Sans** (400 / 500 / 600), self-hosted via `@fontsource` so it works offline. **IBM Plex Mono** for identifiers that people compare character by character: invoice numbers, GSTIN, bank account, PO numbers in tables.
- Base size 14px (dense tool). Inputs are 16px on touch devices to stop iOS zooming.
- All numbers use tabular figures (`num` utility). Money is right-aligned in tables.

| Role | Size / weight |
|---|---|
| Page title | 20px / 600 (invoice vendor name 24px on desktop) |
| Verdict headline | 18–20px / 600 |
| KPI and trust score | 28–36px / 600 |
| Body | 14px / 400, emphasis 500 |
| Secondary | 13px |
| Card eyebrow | 13px / 600, uppercase, tracked |
| Meta | 12px |

## Number formats

- Money: Indian grouping, no paise: `₹1,84,200`. Unit prices keep paise: `₹85.00`. KPI tiles use lakh/crore: `₹5.05L`.
- Dates: `14 Nov 2026`. Ages: `4m`, `2h`, `3d`, then `12 Nov`.
- Durations: `3.1s`, `<0.1s`.

## Space, shape, depth

- 4px grid. Card padding 16px on mobile, 20–24px on desktop. 16px between cards.
- Radius: 6px controls, 10px cards, full for chips. Bottom sheets 16px top corners.
- No shadows on cards (1px border only). One shadow, `shadow-pop`, for things that float: dialogs, menus, toasts, the Scan button.
- Content column max 1180px. Desktop sidebar 224px.

## Motion

- `rise` (220ms): new content entering (verdict, flags, stage summaries).
- `sheet` (240ms): bottom sheet on mobile.
- Running stage: spinner plus a pulsing segment in the run strip. Queue live rows: a slow sweep on the progress bar.
- `prefers-reduced-motion` disables all of it.

## Components

| Component | Notes |
|---|---|
| `Button` | `primary` (filled accent), `secondary` (outline), `ghost`, `danger` (outline, red text). Sizes 32 / 36 / 44px. 44px on mobile action bars. |
| `Card`, `CardHeader` | White, 1px border. Header is an uppercase eyebrow with an optional right slot. |
| `RecChip` | Recommendation pill: soft status background, icon, label. `short` variant on mobile ("Hold"). |
| `Pill` | Small neutral or status tag (Goods, Inferred, v3, Approved). |
| `Trust` | Score plus thin meter. Colour follows the recommendation, not the number, so a critical flag at score 60 still reads red. |
| `SourceIcon` | Upload, camera, email, sample. |
| `Timeline` | The 9 checks. Segment strip on top (whole run at a glance), expandable rows below. Collapsed to the strip on mobile once the run is finished. |
| `Flags` | Severity icon, title, one sentence, evidence box. Sorted critical first. |
| `PoCard` | Billing bar (earlier invoices, this invoice, overrun past the PO marker) plus a match table that opens by default only when a line differs. |
| `DocFields` | Document image beside extracted fields. Tap a field for the quote it was read from. Low-confidence rows are tinted and show the percentage. |
| `Disclosure` | Collapsed secondary sections: vendor message, audit trail. |
| `Dialog` | Centered on desktop, bottom sheet on mobile. Esc and backdrop close it, focus returns to the trigger. |
| `Toast` | Dark, bottom centre, 3.6s. |

## Layout

- **Desktop (≥768px):** fixed left sidebar (Queue, Dashboard, Settings), content column. Invoice page is verdict on top, then a sticky checks column (21rem) beside the evidence column.
- **Mobile (<768px):** top bar with Settings, bottom bar with Queue, raised Scan button, Dashboard. On an invoice the bottom bar is replaced by a sticky decision bar (more, secondary, primary). Scan is a full-screen dark capture view.

## Primary action by recommendation

| Recommendation | Primary | Secondary | Tertiary |
|---|---|---|---|
| Ready to approve | Approve (one click) | Reject | Ask vendor |
| Needs review | Approve (optional note) | Reject | Ask vendor |
| High risk hold | Ask vendor (draft ready) | Reject | Approve anyway (reason required) |
| Recommend reject | Reject (reason required) | Ask vendor | Approve anyway (reason required) |

## Voice

Plain, short, specific. "Billed 100 rolls, only 60 received", not "Quantity variance detected". Sentence case everywhere. No exclamation marks, no emoji. Buttons are verbs: Approve, Reject, Ask vendor, Retake, Use photo.

## Not in scope

Dark mode (the capture screen is dark by convention; the rest is light only). Multi-user roles.
