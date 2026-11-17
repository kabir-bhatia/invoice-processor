// In-browser stand-in for the FastAPI backend. Same shapes as docs/04_api_contract.md.
// State lives in memory and resets on reload (or via "Reset demo data").
import type {
  Api,
  DashboardData,
  Flag,
  GmailStatus,
  InvoiceDetail,
  QueueItem,
  QueueTab,
  RunEvent,
  Rules,
  Source,
  Stage,
  Vendor,
} from "../types";
import { build, RULE_VERSION, STAGE_ORDER, type Spec } from "./build";
import { cleanScenario, SAMPLES, SCENARIOS, seedPastInvoices, seedPOs, seedRules, seedVendors } from "./data";

interface Entry {
  final: InvoiceDetail;
  /** ms epoch when a live run started; null = already finished at seed time. */
  startedAt: number | null;
  retryOnRead: boolean;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

let entries: Entry[] = [];
let rules: Rules = seedRules();
let vendors: Vendor[] = seedVendors();
let gmail: GmailStatus = { connected: true, address: "northwind.ap.demo@gmail.com", last_checked_at: new Date().toISOString(), auto_reply_unreadable: false };
let seq = 0;

const newId = () => `inv_${(0x9c1d + seq++ * 0x1f3).toString(16)}`;
const wait = <T,>(v: T, ms = 140) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms));

function seed() {
  entries = [];
  seq = 0;
  rules = seedRules();
  RULE_VERSION.current = rules.version;
  vendors = seedVendors();
  const now = Date.now();
  const add = (spec: Omit<Spec, "source"> & { source?: Source }, source: Source, agoMs: number, human?: Spec["human"], idOverride?: string) => {
    const b = build(idOverride ?? newId(), { ...spec, source, human }, new Date(now - agoMs));
    entries.push({ final: b.detail, startedAt: null, retryOnRead: false });
  };

  // Needs action
  add(SCENARIOS.s2_duplicate, "email", 4 * MIN);
  add(SCENARIOS.s3_bank, "email", 26 * MIN);
  add(SCENARIOS.s1_split, "upload", 52 * MIN);
  add(SCENARIOS.s9_receipt, "camera", 2 * HOUR);
  // Ready
  add(SCENARIOS.s0_happy, "upload", 11 * MIN);
  add(SCENARIOS.s5a_within, "email", 38 * MIN);
  // Done
  add(cleanScenario("v_shree", "INV-1023", "2026-11-10", "Corrugated box 5-ply", 1200, "pcs", 130, "PO-1042", 95), "email", 5 * 24 * HOUR, { action: "approved" }, "inv_31aa");
  add(cleanScenario("v_orbit", "OL/1171", "2026-11-08", "Freight Gurugram–Jaipur, 20 ft", 2, "trips", 16500, null, 91), "email", 3 * HOUR, { action: "approved" });
  add(SCENARIOS.s8_quote, "email", 5 * HOUR, { action: "rejected", reason: "Quotation, not an invoice" });
  add(cleanScenario("v_kaveri", "KIS/26-27/0402", "2026-11-09", "Hex nut M12, zinc", 6000, "pcs", 4.1, "PO-1038", 97), "upload", 7 * HOUR, { action: "approved" });
  add(SCENARIOS.s7_gst, "upload", 22 * HOUR, { action: "info_requested", reason: "Asked vendor for a corrected invoice" });
  add(cleanScenario("v_bright", "BP-0921", "2026-10-05", "IT support retainer, Oct 2026", 1, "month", 75000, null, 93), "email", 26 * HOUR, { action: "approved" });
  add(SCENARIOS.s5b_over, "upload", 28 * HOUR, { action: "approved", reason: "Price revision approved by purchase (mail dt. 12 Nov)" });
  add(cleanScenario("v_sunrise", "SE/2610/051", "2026-10-28", "Contactor 3-pole 40A", 60, "pcs", 1180, "PO-1047", 96), "camera", 2 * 24 * HOUR, { action: "approved" });
  add(SCENARIOS.s6_injection, "email", 3 * 24 * HOUR, { action: "rejected", reason: "Hidden instructions in document. Escalated to vendor manager" });
  add(cleanScenario("v_metro", "MOS-771", "2026-08-29", "Office chairs, mesh back", 16, "pcs", 3600, "PO-1018", 94), "upload", 4 * 24 * HOUR, { action: "approved" });
}
seed();

// ---------- Live run timeline ----------
// Wall-clock pacing of a simulated run (independent of the reported duration_ms).
const wallMs = (s: Stage) => (s.status === "skipped" ? 260 : Math.min(Math.max((s.duration_ms ?? 0) * 0.8, 520), 2800));

interface Timed {
  at: number; // ms after start
  event: RunEvent;
}

function schedule(e: Entry): { events: Timed[]; total: number; ends: number[] } {
  const events: Timed[] = [];
  const ends: number[] = [];
  let t = 250;
  for (const s of e.final.stages) {
    events.push({ at: t, event: { type: "stage", data: { id: s.id, status: "running" } } });
    const w = wallMs(s) + (s.id === "read" && e.retryOnRead ? 1600 : 0);
    if (s.id === "read" && e.retryOnRead) {
      events.push({ at: t + 1500, event: { type: "error", data: { stage: "read", message: "Model timed out, retrying (2/3)" } } });
    }
    t += w;
    events.push({ at: t, event: { type: "stage", data: { id: s.id, status: s.status, summary: s.summary, duration_ms: s.duration_ms, details: s.details } } });
    for (const f of e.final.flags.filter((f) => f.stage === s.id)) events.push({ at: t + 30, event: { type: "flag", data: f } });
    ends.push(t);
    t += 120;
  }
  if (e.final.decision) events.push({ at: t, event: { type: "decision", data: e.final.decision } });
  events.push({ at: t + 60, event: { type: "done", data: { status: "done" } } });
  return { events, total: t + 60, ends };
}

function progress(e: Entry) {
  if (e.startedAt === null) return { done: true, stageIdx: STAGE_ORDER.length };
  const { total, ends } = schedule(e);
  const el = Date.now() - e.startedAt;
  if (el >= total) {
    e.startedAt = null;
    return { done: true, stageIdx: STAGE_ORDER.length };
  }
  const idx = ends.findIndex((end) => el < end);
  return { done: false, stageIdx: idx === -1 ? STAGE_ORDER.length - 1 : idx };
}

function view(e: Entry): InvoiceDetail {
  const p = progress(e);
  if (p.done) return e.final;
  const f = e.final;
  const readDone = p.stageIdx > 1;
  return {
    ...f,
    status: "processing",
    decision: null,
    doc_type: p.stageIdx > 2 ? f.doc_type : null,
    stages: f.stages.map((s, i) => (i < p.stageIdx ? s : { id: s.id, status: i === p.stageIdx ? "running" : "pending" })),
    fields: readDone ? f.fields : [],
    line_items: [],
    po: null,
    flags: f.flags.filter((fl) => STAGE_ORDER.indexOf(fl.stage) < p.stageIdx),
    vendor_message: null,
    audit: [],
  };
}

function toItem(e: Entry): QueueItem {
  const p = progress(e);
  const f = e.final;
  const field = (k: string) => f.fields.find((x) => x.key === k)?.value ?? null;
  const readDone = p.done || p.stageIdx > 1;
  return {
    id: f.id,
    status: p.done ? "done" : "processing",
    current_stage: p.done ? null : STAGE_ORDER[p.stageIdx],
    source: f.source,
    vendor_name: readDone ? (field("vendor_name") as string | null) : null,
    invoice_number: readDone ? (field("invoice_number") as string | null) : null,
    total: readDone ? (field("total") as number | null) : null,
    recommendation: p.done ? f.decision!.recommendation : null,
    trust_score: p.done ? f.decision!.trust_score : null,
    headline: p.done ? f.decision!.headline : null,
    human_action: f.human_action,
    created_at: f.created_at,
  };
}

function tabOf(i: QueueItem): QueueTab {
  if (i.human_action) return "done";
  if (i.status === "processing") return "needs_action"; // live rows show at the top of the working tab
  return i.recommendation === "ready" ? "ready" : "needs_action";
}

const find = (id: string) => {
  const e = entries.find((x) => x.final.id === id);
  if (!e) throw new Error("Invoice not found");
  return e;
};

const CAUSE: Record<string, string> = {
  DUPLICATE_NEAR: "duplicate",
  PO_OVERBILLED: "po_mismatch",
  PO_INFERRED: "po_mismatch",
  PRICE_OVER_TOLERANCE: "po_mismatch",
  QTY_NOT_RECEIVED: "po_mismatch",
  BANK_CHANGED: "fraud_risk",
  INJECTION: "fraud_risk",
  LOW_CONFIDENCE: "reading",
  NOT_AN_INVOICE: "reading",
  GST_TYPE_MISMATCH: "tax",
};

function start(scenarioId: string, source: Source): { id: string } {
  const spec = SCENARIOS[scenarioId];
  const b = build(newId(), { ...spec, source, photo: spec.photo || source === "camera" }, new Date());
  entries.unshift({ final: b.detail, startedAt: Date.now(), retryOnRead: b.retryOnRead });
  return { id: b.detail.id };
}

let uploadTurn = 0;
const UPLOAD_ROTATION = ["s0_happy", "s1_split", "s3_bank", "s9_receipt"];
const CAMERA_ROTATION = ["s4_inferred", "s2_duplicate"];

export const mockApi: Api = {
  listInvoices(tab, q) {
    const all = entries.map(toItem);
    const counts = { needs_action: 0, ready: 0, done: 0 } as Record<QueueTab, number>;
    for (const i of all) counts[tabOf(i)]++;
    const needle = q?.trim().toLowerCase();
    let items = all.filter((i) => tabOf(i) === tab);
    if (needle) {
      items = items.filter((i) => {
        const po = find(i.id).final.po?.number ?? "";
        return [i.vendor_name, i.invoice_number, po].some((s) => s?.toLowerCase().includes(needle));
      });
    }
    if (tab === "needs_action") {
      // Live rows first, then riskiest first.
      items.sort((a, b) => Number(b.status === "processing") - Number(a.status === "processing") || (a.trust_score ?? 0) - (b.trust_score ?? 0));
    }
    return wait({ counts, items });
  },

  uploadInvoice(_file, source) {
    const rot = source === "camera" ? CAMERA_ROTATION : UPLOAD_ROTATION;
    return wait(start(rot[uploadTurn++ % rot.length], source), 500);
  },

  listSamples() {
    return wait(
      SAMPLES.map((s) => ({ id: s.id, title: s.title, hint: s.hint, thumbnail_url: build("thumb", { ...SCENARIOS[s.id], source: "sample" }, new Date()).detail.document.page_urls[0] })),
    );
  },

  runSample(sampleId) {
    return wait(start(sampleId, "sample"), 200);
  },

  getInvoice(id) {
    return wait(view(find(id)));
  },

  subscribeRun(id, onEvent) {
    const e = find(id);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const { events } = schedule(e);
    const elapsed = e.startedAt === null ? Infinity : Date.now() - e.startedAt;
    for (const ev of events) {
      // Past events replay immediately (like the real SSE endpoint), the rest arrive on time.
      const delay = ev.at <= elapsed ? 0 : ev.at - elapsed;
      if (ev.event.type === "error" && delay === 0) continue;
      timers.push(setTimeout(() => onEvent(structuredClone(ev.event)), delay));
    }
    return () => timers.forEach(clearTimeout);
  },

  act(id, action, reason) {
    const e = find(id);
    const f = e.final;
    f.human_action = action === "approve" ? "approved" : action === "reject" ? "rejected" : "info_requested";
    f.human_reason = reason?.trim() || null;
    f.audit.push({
      at: new Date().toISOString(),
      actor: "Priya (AP)",
      event: action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "Requested info from vendor",
      detail: f.human_reason,
    });
    return wait(f, 300);
  },

  sendVendorMessage(id, subject, body) {
    const f = find(id).final;
    const sent_at = new Date().toISOString();
    if (f.vendor_message) Object.assign(f.vendor_message, { subject, body, sent_at });
    f.audit.push({ at: sent_at, actor: "Priya (AP)", event: "Message sent to vendor", detail: subject });
    return wait({ sent_at }, 500);
  },

  patchField(id, key, value) {
    const e = find(id);
    const fld = e.final.fields.find((x) => x.key === key);
    if (fld) Object.assign(fld, { value, confidence: 1, evidence: "Corrected by reviewer", inferred: false });
    e.final.audit.push({ at: new Date().toISOString(), actor: "Priya (AP)", event: `Corrected ${fld?.label ?? key}`, detail: String(value) });
    return wait(undefined, 200);
  },

  rerun(id) {
    const e = find(id);
    e.startedAt = Date.now();
    e.final.human_action = null;
    e.final.human_reason = null;
    return wait(undefined, 150);
  },

  getDashboard() {
    const all = entries.map(toItem).filter((i) => i.status === "done");
    const ready = all.filter((i) => i.recommendation === "ready").length;
    const held = all.filter((i) => i.recommendation === "hold" || i.recommendation === "reject").reduce((s, i) => s + (i.total ?? 0), 0);
    const secs = entries.map((e) => e.final.stages.reduce((s, st) => s + (st.duration_ms ?? 0), 0) / 1000);
    const causes = new Map<string, number>();
    for (const e of entries) {
      const seen = new Set<string>();
      for (const fl of e.final.flags as Flag[]) {
        const c = CAUSE[fl.code];
        if (c && fl.severity !== "info" && !seen.has(c)) {
          seen.add(c);
          causes.set(c, (causes.get(c) ?? 0) + 1);
        }
      }
    }
    const data: DashboardData = {
      kpis: {
        processed: all.length,
        ready_pct: all.length ? Math.round((ready / all.length) * 100) : 0,
        held_back_amount: held,
        avg_decision_seconds: secs.length ? +(secs.reduce((a, b) => a + b, 0) / secs.length).toFixed(1) : 0,
      },
      exceptions_by_cause: [...causes.entries()].map(([cause, count]) => ({ cause, count })).sort((a, b) => b.count - a.count),
      recent: [...all].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20),
    };
    return wait(data);
  },

  getRules: () => wait(rules),
  putRules(r) {
    rules = { ...rules, ...r, version: rules.version + 1, updated_at: new Date().toISOString() };
    RULE_VERSION.current = rules.version;
    return wait(rules, 300);
  },

  listVendors: () => wait(vendors),
  patchVendor(id, body) {
    const vd = vendors.find((x) => x.id === id);
    if (!vd) throw new Error("Vendor not found");
    Object.assign(vd, body);
    return wait(vd, 250);
  },

  listPOs: () => wait(seedPOs()),
  listPastInvoices: () => wait(seedPastInvoices()),

  resetDemo() {
    seed();
    return wait({ ok: true }, 600);
  },

  getGmail: () => wait(gmail),
  checkGmail: () => wait({ ...gmail, last_checked_at: new Date().toISOString(), started: 0 }, 400),
  putGmail(body) {
    gmail = { ...gmail, ...body };
    return wait(gmail, 200);
  },
};
