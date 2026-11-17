import type { Recommendation, StageId } from "../api";

export const REC: Record<Recommendation, { label: string; short: string; tone: "ok" | "warn" | "risk" }> = {
  ready: { label: "Ready to approve", short: "Ready", tone: "ok" },
  review: { label: "Needs review", short: "Review", tone: "warn" },
  hold: { label: "High risk – hold", short: "Hold", tone: "risk" },
  reject: { label: "Recommend reject", short: "Reject", tone: "risk" },
};

export const STAGES: { id: StageId; name: string; doing: string }[] = [
  { id: "intake", name: "Intake & quality", doing: "Checking the file" },
  { id: "read", name: "Read", doing: "Reading the document" },
  { id: "classify", name: "Classify", doing: "Classifying" },
  { id: "sanity", name: "Sanity checks", doing: "Checking the maths" },
  { id: "vendor", name: "Vendor check", doing: "Checking the vendor" },
  { id: "po_match", name: "PO match", doing: "Matching the PO" },
  { id: "receipt", name: "Receipt check", doing: "Checking goods receipt" },
  { id: "duplicate", name: "Duplicate check", doing: "Looking for duplicates" },
  { id: "decision", name: "Decision", doing: "Deciding" },
];

export const CAUSES: Record<string, string> = {
  duplicate: "Duplicate",
  po_mismatch: "PO mismatch",
  fraud_risk: "Fraud risk",
  reading: "Reading",
  tax: "Tax",
  vendor: "Vendor",
};

export const TONE = {
  ok: { text: "text-ok", bg: "bg-ok-soft", solid: "bg-ok", border: "border-ok/25" },
  warn: { text: "text-warn", bg: "bg-warn-soft", solid: "bg-warn", border: "border-warn/25" },
  risk: { text: "text-risk", bg: "bg-risk-soft", solid: "bg-risk", border: "border-risk/25" },
  neutral: { text: "text-ink-2", bg: "bg-subtle", solid: "bg-ink-3", border: "border-line" },
} as const;
export type Tone = keyof typeof TONE;
