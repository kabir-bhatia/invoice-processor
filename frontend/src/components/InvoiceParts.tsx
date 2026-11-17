import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, CircleDashed, Info, Loader2, Minus, OctagonAlert, Pencil, X, ZoomIn } from "lucide-react";
import type { AuditEvent, Field, Flag, InvoiceDetail, LineItem, PoSummary, Stage, StageStatus } from "../api";
import { cx, date, duration, number, rupees, rupees2, time } from "../lib/format";
import { STAGES, TONE, type Tone } from "../lib/labels";
import { Button, Card, CardHeader, Dialog, Pill, Skeleton } from "./ui";

// ---------- helpers ----------
const prettyKey = (k: string) => (k.includes("_") ? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : k);

function KV({ data, money }: { data: Record<string, unknown>; money?: boolean }) {
  const rows = Object.entries(data).filter(([k, v]) => v !== null && v !== undefined && typeof v !== "object" && !k.endsWith("_id"));
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{prettyKey(k)}</dt>
          <dd className="num min-w-0 break-words text-ink">
            {typeof v === "number" ? (money || v >= 1000 ? (Number.isInteger(v) && v >= 1000 ? rupees(v) : money ? rupees2(v) : number(v)) : number(v)) : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------- Run timeline ----------
function StageIcon({ status }: { status: StageStatus }) {
  const base = "grid size-5 shrink-0 place-items-center rounded-full";
  switch (status) {
    case "running":
      return <span className={cx(base, "text-accent")}><Loader2 className="size-4 animate-spin" /></span>;
    case "pass":
      return <span className={cx(base, "bg-ok-soft text-ok")}><Check className="size-3" strokeWidth={3} /></span>;
    case "warn":
      return <span className={cx(base, "bg-warn-soft text-warn")}><AlertTriangle className="size-3" strokeWidth={2.6} /></span>;
    case "fail":
      return <span className={cx(base, "bg-risk-soft text-risk")}><X className="size-3" strokeWidth={3} /></span>;
    case "skipped":
      return <span className={cx(base, "bg-subtle text-ink-3")}><Minus className="size-3" strokeWidth={2.6} /></span>;
    default:
      return <span className={cx(base, "text-line-strong")}><CircleDashed className="size-4" /></span>;
  }
}

const SEG: Record<StageStatus, string> = { pending: "bg-line", running: "bg-accent animate-pulse", pass: "bg-ok/70", warn: "bg-warn", fail: "bg-risk", skipped: "bg-line-strong" };

export function Timeline({ stages, live, retry, compact }: { stages: Stage[]; live: boolean; retry: string | null; compact: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const doneCount = stages.filter((s) => !["pending", "running"].includes(s.status)).length;
  const issues = stages.filter((s) => s.id !== "decision" && (s.status === "warn" || s.status === "fail")).length;
  const totalMs = stages.reduce((s, x) => s + (x.duration_ms ?? 0), 0);
  const showList = !compact || live || expanded;
  const summary = live ? `Check ${Math.min(doneCount + 1, 9)} of 9` : issues ? `${issues} ${issues === 1 ? "check" : "checks"} raised something` : "No check raised a problem";

  return (
    <Card>
      <button
        className={cx("flex w-full items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 text-left md:px-5", !compact && "cursor-default")}
        onClick={() => compact && setExpanded((v) => !v)}
        aria-expanded={showList}
        tabIndex={compact ? 0 : -1}
      >
        <span>
          <span className="block font-semibold text-ink">Checks</span>
          <span className="mt-0.5 block text-[13px] text-ink-3">{summary}{!live && totalMs ? ` · ${duration(totalMs)}` : ""}</span>
        </span>
        {compact && !live && <ChevronDown className={cx("size-4 text-ink-3 transition-transform", expanded && "rotate-180")} />}
      </button>

      {/* Segment strip: the whole run at a glance */}
      <div className="flex gap-1 px-4 pb-3.5 md:px-5" aria-hidden>
        {stages.map((s) => (
          <span key={s.id} className={cx("h-1 flex-1 rounded-full transition-colors duration-300", SEG[s.id === "decision" && (s.status === "warn" || s.status === "fail") ? "pass" : s.status])} />
        ))}
      </div>

      {showList && (
        <ol className="border-t border-line py-1.5">
          {stages.map((s, i) => {
            const meta = STAGES[i];
            const isOpen = open === s.id;
            const pending = s.status === "pending";
            const hasDetails = !!s.details && Object.keys(s.details).length > 0;
            return (
              <li key={s.id}>
                <button
                  onClick={() => hasDetails && setOpen(isOpen ? null : s.id)}
                  aria-expanded={hasDetails ? isOpen : undefined}
                  className={cx("flex w-full items-start gap-3 px-4 py-2 text-left md:px-5", hasDetails ? "hover:bg-subtle/50" : "cursor-default")}
                >
                  <span className="mt-px"><StageIcon status={s.id === "decision" && (s.status === "warn" || s.status === "fail") ? "pass" : s.status} /></span>
                  <span className="min-w-0 flex-1">
                    <span className={cx("block font-medium", pending && "text-ink-3", s.status === "skipped" && "text-ink-2")}>{meta.name}</span>
                    {s.status === "running" ? (
                      <span className={cx("block text-[13px]", retry && s.id === "read" ? "text-warn" : "text-ink-3")}>{retry && s.id === "read" ? "Taking longer than usual. Retrying…" : `${meta.doing}…`}</span>
                    ) : (
                      s.summary && <span key={s.status} className="animate-rise block text-[13px] text-ink-2">{s.summary}</span>
                    )}
                  </span>
                  {!pending && s.status !== "running" && s.status !== "skipped" && <span className="num mt-0.5 text-xs text-ink-3">{duration(s.duration_ms)}</span>}
                </button>
                {isOpen && hasDetails && (
                  <div className="animate-rise mr-4 mb-2 ml-12 rounded-control bg-subtle/70 px-3 py-2.5 md:mr-5 md:ml-13">
                    <KV data={s.details!} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

// ---------- Flags ----------
const SEV: Record<Flag["severity"], { tone: Tone; icon: typeof Info; label: string }> = {
  critical: { tone: "risk", icon: OctagonAlert, label: "Critical" },
  warning: { tone: "warn", icon: AlertTriangle, label: "Warning" },
  info: { tone: "neutral", icon: Info, label: "Note" },
};

export function Flags({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  const order = { critical: 0, warning: 1, info: 2 };
  const sorted = [...flags].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <Card className="animate-rise">
      <CardHeader title={flags.every((f) => f.severity === "info") ? (flags.length === 1 ? "1 note" : `${flags.length} notes`) : flags.length === 1 ? "1 flag" : `${flags.length} flags`} />
      <ul className="divide-y divide-line border-t border-line">
        {sorted.map((f) => {
          const s = SEV[f.severity];
          const t = TONE[s.tone];
          const otherId = f.evidence?.other_invoice_id as string | undefined;
          const otherNo = f.evidence?.other_invoice_number as string | undefined;
          const ev = Object.fromEntries(Object.entries(f.evidence ?? {}).filter(([k]) => !k.startsWith("other_invoice")));
          return (
            <li key={f.code} className="flex gap-3 px-4 py-3.5 md:px-5">
              <span className={cx("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full", t.bg, t.text)}>
                <s.icon className="size-3.5" strokeWidth={2.4} aria-label={s.label} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{f.title}</p>
                <p className="mt-0.5 text-ink-2">{f.message}</p>
                {Object.keys(ev).length > 0 && (
                  <div className="mt-2.5 rounded-control bg-subtle/70 px-3 py-2.5">
                    <KV data={ev} money />
                  </div>
                )}
                {otherId && (
                  <Link to={`/invoices/${otherId}`} className="mt-2.5 inline-block text-[13px] font-medium text-accent underline-offset-2 hover:underline">
                    Open {otherNo ?? "the earlier invoice"}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------- PO billing bar + match table ----------
export function PoCard({ po, lines }: { po: PoSummary; lines: LineItem[] }) {
  const over = po.billed_after > po.amount;
  const scale = Math.max(po.amount, po.billed_after);
  const pct = (n: number) => `${(n / scale) * 100}%`;
  const thisInv = po.billed_after - po.billed_before;
  const afterPct = Math.round((po.billed_after / po.amount) * 100);
  const issues = lines.filter((l) => l.status !== "ok").length;
  const [open, setOpen] = useState(issues > 0);

  return (
    <Card className="animate-rise">
      <CardHeader
        title={<span className="font-mono text-[13px]">{po.number}</span>}
        right={
          <span className="flex items-center gap-1.5">
            {po.match !== "explicit" && <Pill tone="warn">{po.match === "inferred" ? "Inferred" : "Fuzzy match"}</Pill>}
            <Pill>{po.type === "goods" ? "Goods" : "Services"}</Pill>
          </span>
        }
      />
      <div className="px-4 pb-4 md:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-ink-2">
            <span className={cx("num text-lg font-semibold", over ? "text-warn" : "text-ink")}>{rupees(po.billed_after)}</span>
            <span className="num"> of {rupees(po.amount)} billed</span>
          </p>
          <span className={cx("num text-[13px] font-medium", over ? "text-warn" : "text-ink-3")}>{afterPct}%</span>
        </div>
        <div className="relative mt-2.5">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-ink-3/55" style={{ width: pct(po.billed_before) }} />
            <div className="h-full bg-accent" style={{ width: pct(Math.min(thisInv, Math.max(po.amount - po.billed_before, 0))) }} />
            {over && <div className="h-full bg-warn" style={{ width: pct(po.billed_after - Math.max(po.amount, po.billed_before)) }} />}
          </div>
          {over && <div className="absolute -top-1 -bottom-1 w-px bg-ink" style={{ left: pct(po.amount) }} title="PO value" />}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-2">
          <Legend swatch="bg-ink-3/55" label="Earlier invoices" value={rupees(po.billed_before)} />
          <Legend swatch="bg-accent" label="This invoice" value={rupees(thisInv)} />
          {over && <Legend swatch="bg-warn" label="Over PO" value={rupees(po.billed_after - po.amount)} />}
        </div>
      </div>

      {lines.length > 0 && (
        <div className="border-t border-line">
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13px] hover:bg-subtle/50 md:px-5">
            <span className="font-medium text-ink-2">
              {issues ? `${issues} of ${lines.length} line${lines.length === 1 ? "" : "s"} differ${issues === 1 ? "s" : ""} from the PO` : lines.length === 1 ? "1 line matches the PO" : `${lines.length} lines match the PO`}
            </span>
            <ChevronDown className={cx("size-4 text-ink-3 transition-transform", open && "rotate-180")} />
          </button>
          {open && <MatchTable lines={lines} goods={po.type === "goods"} />}
        </div>
      )}
    </Card>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("size-2 rounded-sm", swatch)} />
      {label} <span className="num font-medium text-ink">{value}</span>
    </span>
  );
}

const LINE_STATUS: Record<LineItem["status"], { label: string; tone: Tone }> = {
  ok: { label: "Match", tone: "ok" },
  price_over: { label: "Price over", tone: "warn" },
  qty_over: { label: "Qty over", tone: "warn" },
  not_received: { label: "Short receipt", tone: "warn" },
  not_on_po: { label: "Not on PO", tone: "risk" },
};

function MatchTable({ lines, goods }: { lines: LineItem[]; goods: boolean }) {
  const bad = "rounded bg-warn-soft px-1 -mx-1 font-medium text-warn";
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-y border-line bg-subtle/50 text-left text-xs text-ink-3">
              <th className="py-2 pr-3 pl-5 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Billed</th>
              <th className="px-3 py-2 text-right font-medium">Ordered</th>
              {goods && <th className="px-3 py-2 text-right font-medium">Received</th>}
              <th className="px-3 py-2 text-right font-medium">Price</th>
              <th className="px-3 py-2 text-right font-medium">PO price</th>
              <th className="py-2 pr-5 pl-3 text-right font-medium">Result</th>
            </tr>
          </thead>
          <tbody className="num divide-y divide-line">
            {lines.map((l, i) => {
              const short = l.received_qty != null && l.received_qty < l.qty;
              const priceOver = (l.variance_pct ?? 0) > 0;
              return (
                <tr key={i}>
                  <td className="py-2.5 pr-3 pl-5 text-ink">{l.description}</td>
                  <td className="px-3 py-2.5 text-right">{number(l.qty)} <span className="text-ink-3">{l.unit}</span></td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{l.po_line ? number(l.po_line.qty) : "–"}</td>
                  {goods && <td className="px-3 py-2.5 text-right"><span className={short ? bad : "text-ink-2"}>{number(l.received_qty)}</span></td>}
                  <td className="px-3 py-2.5 text-right"><span className={priceOver && l.status !== "ok" ? bad : ""}>{rupees2(l.unit_price)}</span></td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{l.po_line ? rupees2(l.po_line.unit_price) : "–"}</td>
                  <td className="py-2.5 pr-5 pl-3 text-right">
                    <span className={cx("font-medium", TONE[LINE_STATUS[l.status].tone].text)}>
                      {LINE_STATUS[l.status].label}
                      {priceOver ? ` +${l.variance_pct}%` : ""}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Mobile: one block per line */}
      <ul className="divide-y divide-line border-t border-line md:hidden">
        {lines.map((l, i) => {
          const short = l.received_qty != null && l.received_qty < l.qty;
          const priceOver = (l.variance_pct ?? 0) > 0;
          return (
            <li key={i} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium">{l.description}</span>
                <span className={cx("shrink-0 text-[13px] font-medium", TONE[LINE_STATUS[l.status].tone].text)}>{LINE_STATUS[l.status].label}{priceOver ? ` +${l.variance_pct}%` : ""}</span>
              </div>
              <div className="num mt-1.5 grid grid-cols-3 gap-2 text-[13px]">
                <Cell label="Billed" value={`${number(l.qty)} ${l.unit}`} />
                {goods ? <Cell label="Received" value={number(l.received_qty)} bad={short} /> : <Cell label="Ordered" value={l.po_line ? number(l.po_line.qty) : "–"} />}
                <Cell label={l.po_line ? `PO ${rupees2(l.po_line.unit_price)}` : "Price"} value={rupees2(l.unit_price)} bad={priceOver && l.status !== "ok"} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Cell({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ink-3">{label}</div>
      <div className={cx(bad ? "font-medium text-warn" : "text-ink")}>{value}</div>
    </div>
  );
}

// ---------- Document + extracted fields ----------
const MONEY_KEYS = new Set(["subtotal", "tax_total", "total", "cgst", "sgst", "igst", "round_off"]);
const fieldValue = (f: Field) => (f.value === null ? null : MONEY_KEYS.has(f.key) && typeof f.value === "number" ? rupees(f.value) : f.key.endsWith("_date") ? date(String(f.value)) : String(f.value));

export function DocFields({ detail, reading, compact, onFix }: { detail: InvoiceDetail; reading: boolean; compact: boolean; onFix?: (key: string, value: string) => Promise<void> }) {
  const [view, setView] = useState<"fields" | "doc">("fields");
  const [zoom, setZoom] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const page = detail.document.page_urls[0];
  const low = detail.fields.filter((f) => f.value !== null && f.confidence < 0.75).length;

  const doc = (
    <button onClick={() => setZoom(true)} className="group relative block w-full overflow-hidden rounded-control border border-line bg-subtle" aria-label="Enlarge document">
      {page ? <img src={page} alt="Invoice document" className="block max-h-[30rem] w-full object-contain object-top" /> : <Skeleton className="h-80 w-full" />}
      <span className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-control bg-surface/90 text-ink-2 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <ZoomIn className="size-4" />
      </span>
    </button>
  );

  const fields = reading ? (
    <div className="space-y-3 py-1">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex justify-between"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-32" /></div>
      ))}
    </div>
  ) : (
    <ul className="-mx-2">
      {detail.fields.map((f) => (
        <FieldRow key={f.key} f={f} open={open === f.key} onToggle={() => setOpen(open === f.key ? null : f.key)} onFix={onFix} />
      ))}
      {/* With a PO the lines live in the match table. Without one, list them here. */}
      {!detail.po && detail.line_items.length > 0 && (
        <li className="mt-2 border-t border-line px-2 pt-3">
          <p className="text-xs font-medium text-ink-3">Line items</p>
          <ul className="mt-1.5 space-y-1.5">
            {detail.line_items.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4">
                <span className="min-w-0">
                  <span className="block truncate">{l.description}</span>
                  <span className="num block text-[13px] text-ink-3">{number(l.qty)} {l.unit} at {rupees2(l.unit_price)}</span>
                </span>
                <span className="num shrink-0 font-medium">{rupees(l.amount)}</span>
              </li>
            ))}
          </ul>
        </li>
      )}
    </ul>
  );

  return (
    <Card>
      <CardHeader
        title="Document"
        right={
          compact ? (
            <div className="flex rounded-control bg-subtle p-0.5 text-[13px] font-medium" role="tablist">
              {(["fields", "doc"] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx("h-7 rounded-[5px] px-3", view === v ? "bg-surface text-ink shadow-sm" : "text-ink-3")}>
                  {v === "fields" ? "Fields" : "Original"}
                </button>
              ))}
            </div>
          ) : low > 0 ? (
            <Pill tone="warn">{low} low confidence</Pill>
          ) : undefined
        }
      />
      <div className="px-4 pb-4 md:px-5">
        {compact ? (view === "fields" ? fields : doc) : (
          <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-6">
            {doc}
            <div>{fields}</div>
          </div>
        )}
      </div>
      <Dialog open={zoom} onClose={() => setZoom(false)} title="Original document" wide>
        {page && <img src={page} alt="Invoice document" className="w-full rounded-control border border-line" />}
      </Dialog>
    </Card>
  );
}

function FieldRow({ f, open, onToggle, onFix }: { f: Field; open: boolean; onToggle: () => void; onFix?: (key: string, value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const v = fieldValue(f);
  const low = f.value !== null && f.confidence < 0.75;
  const missing = f.value === null;
  return (
    <li className={cx("rounded-control", low && "bg-warn-soft/60")}>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center justify-between gap-4 rounded-control px-2 py-1.5 text-left hover:bg-subtle/60">
        <span className="shrink-0 text-ink-3">{f.label}</span>
        <span className="flex min-w-0 items-center gap-2">
          {f.inferred && <Pill tone="warn">Inferred</Pill>}
          {low && <span className="num text-xs font-medium text-warn">{Math.round(f.confidence * 100)}%</span>}
          <span className={cx("num truncate text-right", missing ? "text-ink-3" : "font-medium", /gstin|bank|number/.test(f.key) && !missing && "font-mono text-[13px]")}>{v ?? "Not found"}</span>
        </span>
      </button>
      {open && (
        <div className="animate-rise px-2 pt-0.5 pb-2.5 text-[13px]">
          {editing ? (
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!val.trim() || !onFix) return;
                setBusy(true);
                await onFix(f.key, val.trim()).finally(() => setBusy(false));
                setEditing(false);
              }}
            >
              <input data-autofocus autoFocus value={val} onChange={(e) => setVal(e.target.value)} aria-label={`Correct ${f.label}`} className="h-8 min-w-0 flex-1 rounded-control border border-line-strong bg-surface px-2 focus:border-accent focus:outline-none" />
              <Button size="sm" variant="primary" busy={busy} type="submit">Save & re-check</Button>
            </form>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <p className="text-ink-2">
                {f.evidence ? (
                  <>Read from <q className="font-mono text-xs text-ink">{f.evidence}</q></>
                ) : f.inferred ? (
                  "Not printed on the document. Inferred from other fields."
                ) : (
                  "Not found on the document."
                )}
                <span className="num text-ink-3"> · {missing ? "no reading" : `${Math.round(f.confidence * 100)}% sure`}</span>
              </p>
              {onFix && (
                <button onClick={() => { setVal(f.value === null ? "" : String(f.value)); setEditing(true); }} className="inline-flex shrink-0 items-center gap-1 font-medium text-accent hover:underline">
                  <Pencil className="size-3" /> Fix
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ---------- Collapsed sections ----------
export function Disclosure({ title, meta, children, defaultOpen }: { title: string; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <Card>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left md:px-5">
        <span className="font-medium">{title}</span>
        <span className="flex items-center gap-3 text-[13px] text-ink-3">
          {meta}
          <ChevronDown className={cx("size-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="animate-rise border-t border-line px-4 py-4 md:px-5">{children}</div>}
    </Card>
  );
}

export function Audit({ events }: { events: AuditEvent[] }) {
  return (
    <ol className="space-y-2.5 text-[13px]">
      {events.map((e, i) => (
        <li key={i} className="grid grid-cols-[6.5rem_1fr] gap-3">
          <time className="num text-ink-3">{time(e.at)}</time>
          <div className="min-w-0">
            <span className="font-medium text-ink">{e.event}</span>
            {e.actor !== "system" && <span className="text-ink-3"> · {e.actor}</span>}
            {e.detail && <p className="text-ink-2">{e.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
