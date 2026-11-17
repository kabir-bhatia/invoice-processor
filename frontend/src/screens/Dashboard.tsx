import { Link } from "react-router-dom";
import { api } from "../api";
import { Card, CardHeader, Empty, ErrorNote, Pill, RecChip, Skeleton, SourceIcon } from "../components/ui";
import { ago, rupees, rupeesShort } from "../lib/format";
import { CAUSES } from "../lib/labels";
import { useAsync } from "../lib/useAsync";
import { ActionPill } from "./Queue";

export function Dashboard() {
  const { data, error, reload } = useAsync(() => api.getDashboard(), [], 10000);

  if (error && !data) return <Page><ErrorNote message={error} onRetry={() => void reload()} /></Page>;

  const k = data?.kpis;
  const tiles = [
    { label: "Invoices processed", value: k ? String(k.processed) : null, note: "All sources" },
    { label: "Clean on arrival", value: k ? `${k.ready_pct}%` : null, note: "Passed every check" },
    { label: "Held back", value: k ? rupeesShort(k.held_back_amount) : null, note: "Flagged hold or reject" },
    { label: "Avg. check time", value: k ? `${k.avg_decision_seconds}s` : null, note: "Upload to recommendation" },
  ];
  const causes = data?.exceptions_by_cause ?? [];
  const max = Math.max(1, ...causes.map((c) => c.count));

  return (
    <Page>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {tiles.map((t) => (
          <Card key={t.label} className="px-4 py-3.5 md:px-5 md:py-4">
            <p className="text-[13px] text-ink-2">{t.label}</p>
            {t.value ? <p className="num mt-1.5 text-2xl font-semibold tracking-tight md:text-[28px]" >{t.value}</p> : <Skeleton className="mt-2.5 h-7 w-16" />}
            <p className="mt-1 text-xs text-ink-3">{t.note}</p>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[20rem_minmax(0,1fr)] md:items-start">
        <Card>
          <CardHeader title="Exceptions by cause" />
          <div className="space-y-3 px-4 pb-4 md:px-5 md:pb-5">
            {!data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-5" />)}
            {data && causes.length === 0 && <p className="py-4 text-[13px] text-ink-3">No exceptions yet.</p>}
            {causes.map((c) => (
              <div key={c.cause} className="grid grid-cols-[6.5rem_1fr_1.5rem] items-center gap-3 text-[13px]">
                <span className="text-ink-2">{CAUSES[c.cause] ?? c.cause}</span>
                <span className="h-2 overflow-hidden rounded-full bg-subtle">
                  <span className="block h-full rounded-full bg-accent/75" style={{ width: `${(c.count / max) * 100}%` }} />
                </span>
                <span className="num text-right font-medium">{c.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Recent runs" />
          {!data ? (
            <div className="space-y-3 px-5 pb-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5" />)}</div>
          ) : data.recent.length === 0 ? (
            <Empty title="No runs yet" hint="Processed invoices will be listed here." />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              <li className="hidden items-center gap-4 bg-subtle/50 px-5 py-2 text-xs font-medium text-ink-3 md:flex">
                <span className="w-4" /><span className="flex-1">Vendor</span><span className="w-24 text-right">Amount</span><span className="w-36">Recommended</span><span className="hidden w-28 lg:block">Decision</span><span className="w-10 text-right">Age</span>
              </li>
              {data.recent.map((r) => (
                <li key={r.id}>
                  <Link to={`/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-subtle/50 md:gap-4 md:px-5">
                    <SourceIcon source={r.source} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.vendor_name ?? "Unknown vendor"}</span>
                      <span className="num block truncate text-[13px] text-ink-3 md:hidden">{rupees(r.total)} · {ago(r.created_at)}</span>
                    </span>
                    <span className="num hidden w-24 text-right md:block">{rupees(r.total)}</span>
                    <span className="hidden w-36 md:block">{r.recommendation && <RecChip rec={r.recommendation} />}</span>
                    <span className="md:hidden">{r.recommendation && <RecChip rec={r.recommendation} short />}</span>
                    <span className="hidden w-28 lg:block">{r.human_action ? <ActionPill a={r.human_action} /> : <Pill>Open</Pill>}</span>
                    <span className="num hidden w-10 text-right text-[13px] text-ink-3 md:block">{ago(r.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
      <div className="mt-5">{children}</div>
    </div>
  );
}
