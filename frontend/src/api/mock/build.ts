// Builds a complete InvoiceDetail (contract shape) from a compact spec, so every
// mock scenario stays internally consistent (lines → subtotal → GST → total → PO balance).
import type {
  AuditEvent,
  Decision,
  DocType,
  Field,
  Flag,
  InvoiceDetail,
  LineItem,
  LineStatus,
  Recommendation,
  Source,
  Stage,
  StageId,
  Vendor,
  VendorMessage,
} from "../types";
import { renderInvoiceSvg } from "./docImage";

export const STAGE_ORDER: StageId[] = [
  "intake",
  "read",
  "classify",
  "sanity",
  "vendor",
  "po_match",
  "receipt",
  "duplicate",
  "decision",
];

export const RULE_VERSION = { current: 3 };
export const MODEL = "hyde/glm-5.3-flash";

export interface LineSpec {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  gst_rate: number;
  po?: { qty: number; unit_price: number } | null; // undefined = same as invoice
  received?: number | null; // undefined = fully received
  status?: LineStatus;
}

export interface Spec {
  vendor: Vendor;
  invoice_number: string;
  date: string;
  source: Source;
  photo?: boolean;
  quality?: { sharpness: number; brightness: number; glare: number };
  doc_type?: DocType;
  docTitle?: string;
  gst: "intra" | "inter";
  lines: LineSpec[];
  po?: {
    number: string;
    type: "goods" | "services";
    amount: number;
    billed_before: number;
    match?: "explicit" | "fuzzy" | "inferred";
    printed?: boolean; // is the PO number printed on the document?
  } | null;
  bank_on_invoice?: string;
  hiddenText?: string;
  fields?: Record<string, Partial<Field>>;
  stages?: Partial<Record<StageId, Partial<Stage>>>;
  flags?: Flag[];
  decision: { recommendation: Recommendation; trust_score: number; headline: string; reasons: string[] };
  message?: { subject: string; body: string } | null;
  retryOnRead?: boolean;
  human?: { action: "approved" | "rejected" | "info_requested"; reason?: string; minutesAfter?: number };
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n);

const REC_LABEL: Record<Recommendation, string> = {
  ready: "Ready to approve",
  review: "Needs review",
  hold: "High risk – hold",
  reject: "Recommend reject",
};

export interface Built {
  detail: InvoiceDetail;
  retryOnRead: boolean;
}

export function build(id: string, spec: Spec, createdAt: Date): Built {
  const subtotal = spec.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const tax = spec.lines.reduce((s, l) => s + (l.qty * l.unit_price * l.gst_rate) / 100, 0);
  const total = Math.round(subtotal + tax);
  const rate = spec.lines[0]?.gst_rate ?? 18;
  const bank = spec.bank_on_invoice ?? spec.vendor.bank_account_masked;
  const isInvoice = (spec.doc_type ?? "invoice") === "invoice";
  const po = spec.po ?? null;
  const goods = po?.type === "goods";

  const line_items: LineItem[] = spec.lines.map((l) => {
    const poLine = !po ? null : l.po === null ? null : (l.po ?? { qty: l.qty, unit_price: l.unit_price });
    const received = !goods ? null : l.received === undefined ? l.qty : l.received;
    const variance = poLine ? +(((l.unit_price - poLine.unit_price) / poLine.unit_price) * 100).toFixed(1) : null;
    return {
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unit_price: l.unit_price,
      amount: l.qty * l.unit_price,
      gst_rate: l.gst_rate,
      po_line: poLine,
      received_qty: received,
      variance_pct: variance,
      status: l.status ?? (poLine ? "ok" : po ? "not_on_po" : "ok"),
    };
  });

  const taxEvidence =
    spec.gst === "intra"
      ? `CGST ${rate / 2}% ${inr(tax / 2)} / SGST ${rate / 2}% ${inr(tax / 2)}`
      : `IGST ${rate}% ${inr(tax)}`;

  const baseFields: Field[] = [
    { key: "invoice_number", label: "Invoice no.", value: spec.invoice_number, confidence: 0.97, evidence: `${isInvoice ? "Invoice No" : "Ref"}: ${spec.invoice_number}` },
    { key: "invoice_date", label: "Date", value: spec.date, confidence: 0.94, evidence: `Dated ${spec.date.split("-").reverse().join("/")}` },
    {
      key: "po_number",
      label: "PO",
      value: po?.number ?? null,
      confidence: po ? (po.match === "inferred" ? 0.8 : 0.93) : 0,
      evidence: po && po.printed !== false ? `Your PO: ${po.number}` : null,
      inferred: po?.match === "inferred",
    },
    { key: "vendor_name", label: "Vendor", value: spec.vendor.name, confidence: 0.98, evidence: spec.vendor.name.toUpperCase() },
    { key: "vendor_gstin", label: "GSTIN", value: spec.vendor.gstin, confidence: 0.95, evidence: `GSTIN: ${spec.vendor.gstin}` },
    { key: "bank_account", label: "Bank a/c", value: bank, confidence: 0.92, evidence: `A/c No: ${bank.replace(/ /g, "")}` },
    { key: "subtotal", label: "Subtotal", value: subtotal, confidence: 0.95, evidence: `Sub Total ${inr(subtotal)}` },
    { key: "tax_total", label: "GST", value: tax, confidence: 0.94, evidence: taxEvidence },
    { key: "total", label: "Total", value: total, confidence: 0.96, evidence: `Grand Total ₹${inr(total)}` },
  ];
  const fields = baseFields.map((f) => ({ ...f, ...(spec.fields?.[f.key] ?? {}) }));

  const q = spec.quality ?? { sharpness: 0.86, brightness: 0.62, glare: 0.03 };
  const qualityOk = q.sharpness >= 0.35 && q.brightness >= 0.25 && q.glare <= 0.2;

  const def: Record<StageId, Stage> = {
    intake: {
      id: "intake",
      status: "pass",
      summary: spec.photo ? `Photo, 1 page, ${q.sharpness < 0.6 ? "soft but readable" : "good quality"}` : "PDF, 1 page, good quality",
      duration_ms: 180,
      details: { File: spec.photo ? "JPEG photo" : "PDF with text layer", Pages: 1, Sharpness: q.sharpness < 0.6 ? "Soft" : "Good", Lighting: q.brightness < 0.3 ? "Dark" : "Good", Glare: q.glare > 0.14 ? "High" : "Low" },
    },
    read: {
      id: "read",
      status: "pass",
      summary: `${fields.filter((f) => f.value !== null).length} fields, ${line_items.length} line item${line_items.length === 1 ? "" : "s"}`,
      duration_ms: spec.photo ? 4380 : 3120,
      details: { Model: MODEL, "Low-confidence fields": fields.filter((f) => f.value !== null && f.confidence < 0.75).length },
    },
    classify: { id: "classify", status: "pass", summary: "Tax invoice", duration_ms: 12, details: { "Document type": "Invoice", "Instruction-like text": "None found" } },
    sanity: {
      id: "sanity",
      status: "pass",
      summary: "Maths, dates and GST add up",
      duration_ms: 9,
      details: { "Lines → subtotal": "Match", "Subtotal + GST → total": "Match", "GST type": spec.gst === "intra" ? "CGST + SGST (same state)" : "IGST (inter-state)", "GSTIN format": "Valid" },
    },
    vendor: {
      id: "vendor",
      status: "pass",
      summary: "Approved vendor, GSTIN and bank match",
      duration_ms: 46,
      details: { "Vendor master": spec.vendor.name, Status: "Approved", GSTIN: "Match", "Bank account": "Match" },
    },
    po_match: po
      ? {
          id: "po_match",
          status: "pass",
          summary: `Matched ${po.number}, prices and quantities agree`,
          duration_ms: 118,
          details: { PO: po.number, "Match type": po.match ?? "explicit", "PO value": po.amount, "Billed before": po.billed_before, "Billed after": po.billed_before + total },
        }
      : { id: "po_match", status: "skipped", summary: "No purchase order", duration_ms: 0, details: {} },
    receipt: goods
      ? { id: "receipt", status: "pass", summary: "Goods received in full", duration_ms: 31, details: { "Goods receipt": "All lines received" } }
      : { id: "receipt", status: "skipped", summary: po ? "Services PO, no goods receipt needed" : "Nothing to check", duration_ms: 0, details: {} },
    duplicate: { id: "duplicate", status: "pass", summary: "No earlier invoice like this", duration_ms: 64, details: { "Exact number": "No match", "Normalised number": "No match", "Same vendor and amount": "No match" } },
    decision: {
      id: "decision",
      status: spec.decision.recommendation === "ready" ? "pass" : spec.decision.recommendation === "review" ? "warn" : "fail",
      summary: `${REC_LABEL[spec.decision.recommendation]} · trust ${spec.decision.trust_score}`,
      duration_ms: 4,
      details: { "Rule version": `v${RULE_VERSION.current}`, "Decided by": "Rules, not the model" },
    },
  };

  const stages: Stage[] = STAGE_ORDER.map((sid) => ({ ...def[sid], ...(spec.stages?.[sid] ?? {}) }));

  const decision: Decision = { ...spec.decision, rule_version: RULE_VERSION.current, model: MODEL };

  const vendor_message: VendorMessage = spec.message
    ? { available: true, to: spec.vendor.email, subject: spec.message.subject, body: spec.message.body, sent_at: spec.human?.action === "info_requested" ? new Date(createdAt.getTime() + 8 * 60_000).toISOString() : null }
    : { available: false, to: spec.vendor.email, subject: "", body: "", sent_at: null };

  // Audit trail derived from the stages, then the human action if any.
  let t = createdAt.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const audit: AuditEvent[] = [{ at: iso(t), actor: "system", event: `Received via ${spec.source}`, detail: spec.photo ? "Phone photo" : "PDF" }];
  for (const s of stages) {
    t += Math.max(s.duration_ms ?? 0, 5);
    audit.push({ at: iso(t), actor: "system", event: `${STAGE_NAMES[s.id]} ${s.status === "skipped" ? "skipped" : "finished"}`, detail: s.summary ?? null });
  }
  audit.push({ at: iso(t + 2), actor: "system", event: `Recommended: ${REC_LABEL[decision.recommendation]}`, detail: `Trust ${decision.trust_score} · rules v${decision.rule_version} · ${MODEL}` });

  let human_action: InvoiceDetail["human_action"] = null;
  let human_reason: string | null = null;
  if (spec.human) {
    human_action = spec.human.action;
    human_reason = spec.human.reason ?? null;
    audit.push({
      at: iso(t + (spec.human.minutesAfter ?? 6) * 60_000),
      actor: "Priya (AP)",
      event: human_action === "approved" ? "Approved" : human_action === "rejected" ? "Rejected" : "Requested info from vendor",
      detail: human_reason,
    });
  }

  const svg = renderInvoiceSvg({
    vendor: spec.vendor,
    title: spec.docTitle ?? "TAX INVOICE",
    number: spec.invoice_number,
    date: spec.date,
    po: po && po.printed !== false ? po.number : null,
    lines: line_items,
    subtotal,
    tax,
    total,
    gst: spec.gst,
    rate,
    bank,
    photo: !!spec.photo,
    soft: q.sharpness < 0.6,
    hiddenText: spec.hiddenText,
  });

  return {
    retryOnRead: !!spec.retryOnRead,
    detail: {
      id,
      status: "done",
      source: spec.source,
      created_at: createdAt.toISOString(),
      document: { pages: 1, page_urls: [svg], original_url: svg, quality: { ...q, ok: qualityOk } },
      doc_type: spec.doc_type ?? "invoice",
      decision,
      stages,
      fields,
      line_items,
      po: po
        ? { number: po.number, type: po.type, status: "open", amount: po.amount, billed_before: po.billed_before, billed_after: po.billed_before + total, match: po.match ?? "explicit" }
        : null,
      flags: spec.flags ?? [],
      vendor_message,
      human_action,
      human_reason,
      audit,
    },
  };
}

export const STAGE_NAMES: Record<StageId, string> = {
  intake: "Intake & quality",
  read: "Read",
  classify: "Classify",
  sanity: "Sanity checks",
  vendor: "Vendor check",
  po_match: "PO match",
  receipt: "Receipt check",
  duplicate: "Duplicate check",
  decision: "Decision",
};
