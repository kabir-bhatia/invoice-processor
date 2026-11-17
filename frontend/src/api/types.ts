// Shapes from docs/04_api_contract.md. Keep in lockstep with the contract.

export type Source = "upload" | "camera" | "email" | "sample";
export type Recommendation = "ready" | "review" | "hold" | "reject";
export type RunStatus = "processing" | "done" | "failed";
export type HumanAction = "approved" | "rejected" | "info_requested" | null;
export type QueueTab = "needs_action" | "ready" | "done";
export type StageId =
  | "intake"
  | "read"
  | "classify"
  | "sanity"
  | "vendor"
  | "po_match"
  | "receipt"
  | "duplicate"
  | "decision";
export type StageStatus = "pending" | "running" | "pass" | "warn" | "fail" | "skipped";
export type Severity = "info" | "warning" | "critical";
export type DocType = "invoice" | "credit_note" | "quote" | "statement" | "receipt" | "other";

export interface QueueItem {
  id: string;
  status: RunStatus;
  current_stage: StageId | null;
  source: Source;
  vendor_name: string | null;
  invoice_number: string | null;
  total: number | null;
  recommendation: Recommendation | null;
  trust_score: number | null;
  headline: string | null;
  human_action: HumanAction;
  created_at: string;
}

export interface QueueResponse {
  counts: Record<QueueTab, number>;
  items: QueueItem[];
}

export interface Sample {
  id: string;
  title: string;
  hint: string;
  thumbnail_url: string;
}

export interface Quality {
  sharpness: number;
  brightness: number;
  glare: number;
  ok: boolean;
}

export interface Decision {
  recommendation: Recommendation;
  trust_score: number;
  headline: string;
  reasons: string[];
  rule_version: number;
  model: string;
}

export interface Stage {
  id: StageId;
  status: StageStatus;
  summary?: string;
  duration_ms?: number;
  details?: Record<string, unknown>;
}

export interface Field {
  key: string;
  label: string;
  value: string | number | null;
  confidence: number;
  evidence: string | null;
  inferred?: boolean;
}

export type LineStatus = "ok" | "price_over" | "qty_over" | "not_received" | "not_on_po";

export interface LineItem {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
  gst_rate: number;
  po_line: { qty: number; unit_price: number } | null;
  received_qty: number | null;
  variance_pct: number | null;
  status: LineStatus;
}

export interface PoSummary {
  number: string;
  type: "goods" | "services";
  status: string;
  amount: number;
  billed_before: number;
  billed_after: number;
  match: "explicit" | "fuzzy" | "inferred";
}

export interface Flag {
  code: string;
  severity: Severity;
  title: string;
  message: string;
  stage: StageId;
  evidence?: Record<string, unknown>;
}

export interface VendorMessage {
  available: boolean;
  to: string | null;
  subject: string;
  body: string;
  sent_at: string | null;
}

export interface AuditEvent {
  at: string;
  actor: string;
  event: string;
  detail?: string | null;
}

export interface InvoiceDetail {
  id: string;
  status: RunStatus;
  source: Source;
  created_at: string;
  document: {
    pages: number;
    page_urls: string[];
    original_url: string;
    quality: Quality | null;
  };
  doc_type: DocType | null;
  decision: Decision | null;
  stages: Stage[];
  fields: Field[];
  line_items: LineItem[];
  po: PoSummary | null;
  flags: Flag[];
  vendor_message: VendorMessage | null;
  human_action: HumanAction;
  human_reason: string | null;
  audit: AuditEvent[];
  /** Present when the invoice arrived by email. */
  email?: { from: string; from_name?: string | null; subject?: string | null; received_at?: string | null } | null;
}

export type ActionKind = "approve" | "reject" | "request_info";

export interface DashboardData {
  kpis: {
    processed: number;
    ready_pct: number;
    held_back_amount: number;
    avg_decision_seconds: number;
  };
  exceptions_by_cause: { cause: string; count: number }[];
  recent: QueueItem[];
}

export interface Rules {
  version: number;
  tolerance_pct: number;
  tolerance_abs: number;
  approval_limit: number;
  updated_at: string;
}

export interface Vendor {
  id: string;
  name: string;
  gstin: string;
  state: string;
  bank_account_masked: string;
  status: "approved" | "blocked";
  tolerance_pct: number | null;
  tolerance_abs: number | null;
  email: string;
}

export interface PurchaseOrder {
  number: string;
  vendor_name: string;
  type: "goods" | "services";
  status: string;
  amount: number;
  billed: number;
  created: string;
  lines: { description: string; qty: number; unit_price: number; received_qty: number | null }[];
}

export interface PastInvoice {
  number: string;
  vendor_name: string;
  date: string;
  total: number;
  status: string;
}

export interface GmailStatus {
  connected: boolean;
  address: string | null;
  last_checked_at: string | null;
  auto_reply_unreadable: boolean;
  last_error?: string | null;
  processed?: number;
}

// ---- Live run stream (SSE) ----
export type RunEvent =
  | { type: "stage"; data: Stage }
  | { type: "flag"; data: Flag }
  | { type: "decision"; data: Decision }
  | { type: "done"; data: { status: RunStatus } }
  | { type: "error"; data: { stage: StageId; message: string } };

export interface Api {
  listInvoices(tab: QueueTab, q?: string): Promise<QueueResponse>;
  uploadInvoice(file: Blob, source: "upload" | "camera", filename?: string): Promise<{ id: string }>;
  listSamples(): Promise<Sample[]>;
  runSample(sampleId: string): Promise<{ id: string }>;
  getInvoice(id: string): Promise<InvoiceDetail>;
  /** Subscribe to the run stream. Returns an unsubscribe function. */
  subscribeRun(id: string, onEvent: (e: RunEvent) => void): () => void;
  act(id: string, action: ActionKind, reason?: string): Promise<InvoiceDetail>;
  sendVendorMessage(id: string, subject: string, body: string): Promise<{ sent_at: string }>;
  patchField(id: string, key: string, value: string): Promise<void>;
  rerun(id: string): Promise<void>;
  getDashboard(): Promise<DashboardData>;
  getRules(): Promise<Rules>;
  putRules(r: Pick<Rules, "tolerance_pct" | "tolerance_abs" | "approval_limit">): Promise<Rules>;
  listVendors(): Promise<Vendor[]>;
  patchVendor(id: string, body: { tolerance_pct: number | null; tolerance_abs: number | null }): Promise<Vendor>;
  listPOs(): Promise<PurchaseOrder[]>;
  listPastInvoices(): Promise<PastInvoice[]>;
  resetDemo(): Promise<{ ok: boolean }>;
  getGmail(): Promise<GmailStatus>;
  putGmail(body: { auto_reply_unreadable: boolean }): Promise<GmailStatus>;
  /** Check the inbox right now instead of waiting for the next poll. */
  checkGmail(): Promise<GmailStatus & { started: number }>;
}
