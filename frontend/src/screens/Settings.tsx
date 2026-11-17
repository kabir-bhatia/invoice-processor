import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useParams } from "react-router-dom";
import { api, type Rules, type Vendor } from "../api";
import { Button, Card, CardHeader, Dialog, ErrorNote, Pill, Skeleton, Toggle, useToast } from "../components/ui";
import { cx, date, rupees, time } from "../lib/format";
import { useAsync } from "../lib/useAsync";

const TABS = [
  { id: "rules", label: "Rules" },
  { id: "vendors", label: "Vendors" },
  { id: "data", label: "Data" },
  { id: "integrations", label: "Integrations" },
];

export function Settings() {
  const { tab = "rules" } = useParams();
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <div className="mt-5 flex gap-5 overflow-x-auto overflow-y-hidden border-b border-line" role="tablist">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/settings/${t.id}`}
            role="tab"
            className={({ isActive }) => cx("-mb-px border-b-2 pb-2.5 font-medium whitespace-nowrap", isActive ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <div className="mt-5">
        {tab === "rules" && <RulesTab />}
        {tab === "vendors" && <VendorsTab />}
        {tab === "data" && <DataTab />}
        {tab === "integrations" && <IntegrationsTab />}
      </div>
    </div>
  );
}

/** 1000000 -> 10,00,000 while typing (Indian grouping). */
const group = (v: string) => {
  if (!v) return v;
  const [i, d] = v.split(".");
  const g = i ? new Intl.NumberFormat("en-IN").format(Number(i)) : "";
  return d !== undefined ? `${g}.${d}` : g;
};

const inputCls = "num h-9 w-full rounded-control border border-line-strong bg-surface px-3 text-right focus:border-accent focus:outline-none";

function NumField({ label, hint, prefix, suffix, value, onChange }: { label: string; hint: string; prefix?: string; suffix?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3.5">
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        <span className="block text-[13px] text-ink-3">{hint}</span>
      </span>
      <span className="relative w-36 shrink-0">
        {prefix && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">{prefix}</span>}
        <input inputMode="decimal" value={group(value)} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} className={cx(inputCls, suffix && "pr-8")} />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-3">{suffix}</span>}
      </span>
    </label>
  );
}

function RulesTab() {
  const { data, error, reload, setData } = useAsync(() => api.getRules(), []);
  const [form, setForm] = useState<{ pct: string; abs: string; limit: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (data) setForm({ pct: String(data.tolerance_pct), abs: String(data.tolerance_abs), limit: String(data.approval_limit) });
  }, [data]);

  if (error && !data) return <ErrorNote message={error} onRetry={() => void reload()} />;
  if (!data || !form) return <Skeleton className="h-64 max-w-xl" />;

  const dirty = +form.pct !== data.tolerance_pct || +form.abs !== data.tolerance_abs || +form.limit !== data.approval_limit;
  const valid = [form.pct, form.abs, form.limit].every((v) => v !== "" && !isNaN(+v));

  async function save() {
    setSaving(true);
    try {
      const r: Rules = await api.putRules({ tolerance_pct: +form!.pct, tolerance_abs: +form!.abs, approval_limit: +form!.limit });
      setData(r);
      toast(`Saved as rules v${r.version}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save", "risk");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader title="Matching rules" right={<Pill>v{data.version}</Pill>} sub={`Last changed ${date(data.updated_at)}`} />
      <div className="divide-y divide-line border-t border-line px-4 md:px-5">
        <NumField label="Price tolerance" hint="How far a price may exceed the PO" suffix="%" value={form.pct} onChange={(v) => setForm({ ...form, pct: v })} />
        <NumField label="Tolerance cap" hint="Whichever is lower applies" prefix="₹" value={form.abs} onChange={(v) => setForm({ ...form, abs: v })} />
        <NumField label="Approval limit" hint="Above this, always needs review" prefix="₹" value={form.limit} onChange={(v) => setForm({ ...form, limit: v })} />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3.5 md:px-5">
        <span className="text-[13px] text-ink-3">{dirty ? `Saving creates v${data.version + 1}` : "No changes to save"}</span>
        <Button variant="primary" busy={saving} disabled={!dirty || !valid} onClick={() => void save()}>Save</Button>
      </div>
    </Card>
  );
}

function VendorsTab() {
  const { data, error, reload } = useAsync(() => api.listVendors(), []);
  const [edit, setEdit] = useState<Vendor | null>(null);
  if (error && !data) return <ErrorNote message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton className="h-72" />;
  return (
    <>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-line">
          <li className="hidden grid-cols-[minmax(0,1.6fr)_11rem_9rem_9rem_3.5rem] gap-4 bg-subtle/50 px-5 py-2 text-xs font-medium text-ink-3 md:grid">
            <span>Vendor</span><span>GSTIN</span><span>Bank a/c</span><span>Tolerance</span><span />
          </li>
          {data.map((v) => {
            const custom = v.tolerance_pct != null || v.tolerance_abs != null;
            return (
              <li key={v.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_11rem_9rem_9rem_3.5rem] md:px-5">
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{v.name}</span>
                    {v.status === "blocked" && <Pill tone="risk">Blocked</Pill>}
                  </span>
                  <span className="block text-[13px] text-ink-3">{v.state}</span>
                </span>
                <span className="hidden font-mono text-[13px] text-ink-2 md:block">{v.gstin}</span>
                <span className="hidden font-mono text-[13px] text-ink-2 md:block">{v.bank_account_masked}</span>
                <span className={cx("num hidden text-[13px] md:block", custom ? "font-medium text-ink" : "text-ink-3")}>{custom ? `${v.tolerance_pct ?? "–"}% · ${rupees(v.tolerance_abs)}` : "Default"}</span>
                <span className="row-span-2 flex flex-col items-end gap-1 md:row-span-1">
                  <button onClick={() => setEdit(v)} className="text-[13px] font-medium text-accent hover:underline">Edit</button>
                  <span className={cx("num text-xs md:hidden", custom ? "font-medium text-ink" : "text-ink-3")}>{custom ? `${v.tolerance_pct}% · ${rupees(v.tolerance_abs)}` : "Default tolerance"}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      {edit && <VendorDialog vendor={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </>
  );
}

function VendorDialog({ vendor, onClose, onSaved }: { vendor: Vendor; onClose: () => void; onSaved: () => void }) {
  const [pct, setPct] = useState(vendor.tolerance_pct?.toString() ?? "");
  const [abs, setAbs] = useState(vendor.tolerance_abs?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function save(clear = false) {
    setBusy(true);
    try {
      await api.patchVendor(vendor.id, clear ? { tolerance_pct: null, tolerance_abs: null } : { tolerance_pct: pct === "" ? null : +pct, tolerance_abs: abs === "" ? null : +abs });
      toast(clear ? "Back to default tolerance" : "Vendor tolerance saved");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t save", "risk");
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={vendor.name}
      footer={
        <>
          <Button variant="ghost" onClick={() => void save(true)} disabled={busy} className="mr-auto">Use default</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[13px]">
        <dt className="text-ink-3">GSTIN</dt><dd className="font-mono">{vendor.gstin}</dd>
        <dt className="text-ink-3">Bank a/c</dt><dd className="font-mono">{vendor.bank_account_masked}</dd>
        <dt className="text-ink-3">Email</dt><dd className="truncate">{vendor.email}</dd>
      </dl>
      <div className="mt-3 divide-y divide-line border-t border-line">
        <NumField label="Price tolerance" hint="Leave blank to use the default" suffix="%" value={pct} onChange={setPct} />
        <NumField label="Tolerance cap" hint="Leave blank to use the default" prefix="₹" value={abs} onChange={setAbs} />
      </div>
    </Dialog>
  );
}

function DataTab() {
  const pos = useAsync(() => api.listPOs(), []);
  const past = useAsync(() => api.listPastInvoices(), []);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function reset() {
    setBusy(true);
    try {
      await api.resetDemo();
      toast("Demo data restored");
      setConfirm(false);
      await Promise.all([pos.reload(), past.reload()]);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Reset failed", "risk");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <CardHeader title="Purchase orders" sub="Read-only, from procurement." />
        {pos.error && !pos.data ? <div className="p-4"><ErrorNote message={pos.error} onRetry={() => void pos.reload()} /></div> : !pos.data ? <Rows /> : (
          <ul className="divide-y divide-line border-t border-line">
            {pos.data.map((p) => {
              const pct = Math.round((p.billed / p.amount) * 100);
              return (
                <li key={p.number} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2.5 md:grid-cols-[6rem_minmax(0,1fr)_5.5rem_16rem] md:px-5">
                  <span className="font-mono text-[13px] font-medium">{p.number}</span>
                  <span className="order-3 col-span-2 truncate text-[13px] text-ink-2 md:order-none md:col-span-1 md:text-sm md:text-ink">{p.vendor_name}</span>
                  <span className="hidden md:block"><Pill>{p.type === "goods" ? "Goods" : "Services"}</Pill></span>
                  <span className="flex items-center justify-end gap-2.5">
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-subtle md:block"><span className="block h-full rounded-full bg-ink-3/60" style={{ width: `${Math.min(pct, 100)}%` }} /></span>
                    <span className="num text-[13px] whitespace-nowrap text-ink-2"><span className="font-medium text-ink">{rupees(p.billed)}</span> / {rupees(p.amount)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Past invoices" sub="History used for duplicate and PO balance checks." />
        {past.error && !past.data ? <div className="p-4"><ErrorNote message={past.error} onRetry={() => void past.reload()} /></div> : !past.data ? <Rows /> : (
          <ul className="divide-y divide-line border-t border-line">
            {past.data.map((p) => (
              <li key={p.number} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2.5 md:grid-cols-[9rem_minmax(0,1fr)_7rem_7rem_5rem] md:px-5">
                <span className="font-mono text-[13px] font-medium">{p.number}</span>
                <span className="order-3 col-span-2 truncate text-[13px] text-ink-2 md:order-none md:col-span-1 md:text-sm md:text-ink">{p.vendor_name}</span>
                <span className="num hidden text-[13px] text-ink-3 md:block">{date(p.date)}</span>
                <span className="num text-right font-medium">{rupees(p.total)}</span>
                <span className="hidden text-right text-[13px] text-ink-2 capitalize md:block">{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-5">
        <div>
          <p className="font-medium">Reset demo data</p>
          <p className="text-[13px] text-ink-3">Restores the seed vendors, POs and history, and clears every run.</p>
        </div>
        <Button variant="danger" onClick={() => setConfirm(true)}>Reset</Button>
      </Card>

      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Reset demo data?"
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" busy={busy} onClick={() => void reset()}>Reset</Button>
          </>
        }
      >
        <p className="text-ink-2">All runs, decisions and rule changes will be cleared, and the seed data restored. This can’t be undone.</p>
      </Dialog>
    </div>
  );
}

function Rows() {
  return <div className="space-y-3 border-t border-line p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5" />)}</div>;
}

function IntegrationsTab() {
  const { data, error, reload, setData } = useAsync(() => api.getGmail(), []);
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  if (error && !data) return <ErrorNote message={error} onRetry={() => void reload()} />;
  if (!data) return <Skeleton className="h-40 max-w-xl" />;
  return (
    <Card className="max-w-xl">
      <CardHeader title="Gmail inbox" right={<Pill tone={data.connected ? "ok" : "neutral"}>{data.connected ? "Connected" : "Not connected"}</Pill>} />
      <div className="divide-y divide-line border-t border-line px-4 md:px-5">
        {data.connected ? (
          <>
            <Line label="Address">{data.address}</Line>
            <div className="flex items-center justify-between gap-4 py-3">
              <span className="text-ink-2">Last checked</span>
              <span className="flex items-center gap-3">
                <span className="num">{data.last_checked_at ? time(data.last_checked_at) : "Never"}</span>
                <button
                  className="h-8 rounded-control border border-line-strong bg-surface px-3 text-[13px] font-medium hover:bg-sunken disabled:opacity-50"
                  disabled={checking}
                  onClick={async () => {
                    setChecking(true);
                    try {
                      const r = await api.checkGmail();
                      setData(r);
                      toast(r.started ? `${r.started} new invoice${r.started === 1 ? "" : "s"} queued` : "No new invoices", r.started ? "ok" : undefined);
                    } catch (e) {
                      toast(e instanceof Error ? e.message : "Inbox check failed", "risk");
                    } finally {
                      setChecking(false);
                    }
                  }}
                >
                  {checking ? "Checking…" : "Check now"}
                </button>
              </span>
            </div>
            {data.last_error && <p className="py-3 text-[13px] text-risk">Last check failed: {data.last_error}</p>}
            <div className="flex items-center justify-between gap-4 py-3.5">
              <span>
                <span className="block font-medium">Auto-reply to unreadable documents</span>
                <span className="block text-[13px] text-ink-3">Asks the sender to resend. Never used when fraud is suspected.</span>
              </span>
              <Toggle
                label="Auto-reply to unreadable documents"
                checked={data.auto_reply_unreadable}
                onChange={async (v) => {
                  setData({ ...data, auto_reply_unreadable: v });
                  try {
                    setData(await api.putGmail({ auto_reply_unreadable: v }));
                  } catch {
                    setData(data);
                    toast("Couldn’t save", "risk");
                  }
                }}
              />
            </div>
          </>
        ) : (
          <p className="py-4 text-ink-2">Invoices emailed to the AP inbox are queued automatically once Gmail is connected on the server. Upload and camera work without it.</p>
        )}
      </div>
    </Card>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-ink-2">{label}</span>
      <span className="num min-w-0 truncate font-medium">{children}</span>
    </div>
  );
}
