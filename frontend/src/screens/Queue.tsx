import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, FileUp, Search, Upload } from "lucide-react";
import { api, type QueueItem, type QueueTab, type Sample } from "../api";
import { Button, Card, Dialog, Empty, ErrorNote, Pill, RecChip, Skeleton, SourceIcon, Trust, useToast } from "../components/ui";
import { ago, cx, rupees } from "../lib/format";
import { REC, STAGES } from "../lib/labels";
import { useAsync } from "../lib/useAsync";

const TABS: { id: QueueTab; label: string }[] = [
  { id: "needs_action", label: "Needs action" },
  { id: "ready", label: "Ready" },
  { id: "done", label: "Done" },
];

const EMPTY: Record<QueueTab, { title: string; hint: string }> = {
  needs_action: { title: "Nothing needs you right now", hint: "Invoices with open questions will show up here." },
  ready: { title: "No invoices waiting for approval", hint: "Clean invoices land here for a one-click approve." },
  done: { title: "No decisions yet", hint: "Approved and rejected invoices are kept here." },
};

export function Queue() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as QueueTab) || "needs_action";
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [samplesOpen, setSamplesOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => {
    const t = setTimeout(() => setDq(q), 220);
    return () => clearTimeout(t);
  }, [q]);

  const list = useAsync(() => api.listInvoices(tab, dq || undefined), [tab, dq]);
  const live = list.data?.items.some((i) => i.status === "processing");
  // Poll fast while anything is running, slowly otherwise (email intake can add rows).
  useEffect(() => {
    const t = setInterval(() => void list.reload(), live ? 900 : 6000);
    return () => clearInterval(t);
  }, [live, list.reload]);

  async function upload(files: FileList | File[]) {
    const arr = [...files].filter((f) => /pdf|image/.test(f.type) || /\.(pdf|png|jpe?g|heic)$/i.test(f.name));
    if (!arr.length) return toast("Only PDF or image files", "risk");
    setUploading(true);
    try {
      const ids = [];
      for (const f of arr) ids.push((await api.uploadInvoice(f, "upload")).id);
      if (ids.length === 1) nav(`/invoices/${ids[0]}`);
      else {
        toast(`${ids.length} invoices added`);
        setParams({});
        await list.reload();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Upload failed", "risk");
    } finally {
      setUploading(false);
    }
  }

  // Whole-page drop target.
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => { if (has(e)) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files.length) void upload(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = list.data?.counts;
  const items = list.data?.items;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Queue</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => setSamplesOpen(true)}>Try a sample</Button>
          <Button variant="primary" busy={uploading} icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>
            Upload
          </Button>
          <input ref={fileRef} type="file" multiple accept="application/pdf,image/*,.heic" className="hidden" onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} />
        </div>
      </div>

      <div className="mt-5 flex items-end justify-between gap-4 border-b border-line">
        <div className="-mb-px flex gap-5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setParams(t.id === "needs_action" ? {} : { tab: t.id })}
              className={cx(
                "flex items-center gap-1.5 border-b-2 pb-2.5 font-medium whitespace-nowrap transition-colors",
                tab === t.id ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {t.label}
              <span className={cx("num text-[13px]", tab === t.id ? "text-ink-2" : "text-ink-3")}>{counts ? counts[t.id] : ""}</span>
            </button>
          ))}
        </div>
        <label className="relative mb-2 hidden md:block">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Vendor, invoice or PO"
            aria-label="Search invoices"
            className="h-8 w-56 rounded-control border border-line bg-surface pr-2 pl-8 text-[13px] placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      <label className="relative mt-3 block md:hidden">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vendor, invoice or PO" aria-label="Search invoices" className="h-10 w-full rounded-control border border-line bg-surface pr-3 pl-9 placeholder:text-ink-3 focus:border-accent focus:outline-none" />
      </label>

      <div className="mt-3 md:mt-4">
        {list.error && !items ? (
          <ErrorNote message={list.error} onRetry={() => void list.reload()} />
        ) : !items ? (
          <Card className="divide-y divide-line">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4 md:px-5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto h-4 w-20" />
                <Skeleton className="hidden h-4 w-28 md:block" />
              </div>
            ))}
          </Card>
        ) : items.length === 0 ? (
          <Card>
            {dq ? <Empty title="No matches" hint={`Nothing in this tab matches “${dq}”.`} /> : <Empty {...EMPTY[tab]} action={tab !== "done" ? <Button onClick={() => setSamplesOpen(true)}>Try a sample</Button> : undefined} />}
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            <div className="hidden items-center gap-4 bg-subtle/50 px-5 py-2 text-xs font-medium text-ink-3 md:flex">
              <span className="w-4" /><span className="flex-1">Vendor</span><span className="w-28 text-right">Amount</span><span className="w-40">{tab === "done" ? "Decision" : "Recommended"}</span><span className="w-20 text-right">Trust</span><span className="w-10 text-right">Age</span><span className="w-4" />
            </div>
            {items.map((it) => (
              <Row key={it.id} item={it} />
            ))}
          </Card>
        )}
        <p className="mt-3 hidden items-center gap-1.5 text-[13px] text-ink-3 md:flex">
          <FileUp className="size-4" aria-hidden /> Drop PDFs or photos anywhere on this page to add them.
        </p>
      </div>

      {dragging && (
        <div className="animate-fade pointer-events-none fixed inset-0 z-40 grid place-items-center bg-canvas/85 p-8">
          <div className="grid h-full w-full place-items-center rounded-2xl border-2 border-dashed border-accent bg-accent-soft/60">
            <div className="text-center">
              <FileUp className="mx-auto size-8 text-accent" />
              <p className="mt-3 text-lg font-semibold text-accent">Drop to add invoices</p>
              <p className="text-ink-2">PDF or image</p>
            </div>
          </div>
        </div>
      )}

      <SampleDialog open={samplesOpen} onClose={() => setSamplesOpen(false)} />
    </div>
  );
}

function Row({ item: it }: { item: QueueItem }) {
  const processing = it.status === "processing";
  const failed = it.status === "failed";
  const stageIdx = STAGES.findIndex((s) => s.id === it.current_stage);
  const tone = it.recommendation ? REC[it.recommendation].tone : "neutral";

  return (
    <Link to={`/invoices/${it.id}`} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle/50 md:gap-4 md:px-5 md:py-3.5">
      <span className="hidden md:block">
        <SourceIcon source={it.source} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className={cx("truncate font-medium", !it.vendor_name && "text-ink-3")}>{it.vendor_name ?? "New invoice"}</span>
          <span className="num font-medium md:hidden">{it.total != null ? rupees(it.total) : ""}</span>
        </div>
        {/* Second line: desktop shows the one-line reason, mobile shows the status chip */}
        <div className="mt-0.5 hidden truncate text-[13px] text-ink-3 md:block">
          {processing ? "Checking now" : failed ? "Couldn’t be processed" : [it.invoice_number, it.headline].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3 md:hidden">
          {processing ? (
            <LiveStage idx={stageIdx} />
          ) : failed ? (
            <Pill tone="risk">Failed</Pill>
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              {it.human_action ? <ActionPill a={it.human_action} /> : it.recommendation && <RecChip rec={it.recommendation} short />}
              {it.trust_score != null && <span className="num text-[13px] font-medium text-ink-2">{it.trust_score}</span>}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-3">
            <SourceIcon source={it.source} />
            <span className="num">{ago(it.created_at)}</span>
          </span>
        </div>
        {!processing && !failed && it.headline && <p className="mt-1.5 truncate text-[13px] text-ink-2 md:hidden">{it.headline}</p>}
      </div>

      {/* Desktop columns */}
      {processing ? (
        <div className="hidden w-[23.5rem] md:block">
          <LiveStage idx={stageIdx} />
        </div>
      ) : (
        <>
          <span className="num hidden w-28 text-right font-medium md:block">{rupees(it.total)}</span>
          <span className="hidden w-40 md:block">
            {failed ? <Pill tone="risk">Failed</Pill> : it.human_action ? <ActionPill a={it.human_action} /> : it.recommendation && <RecChip rec={it.recommendation} />}
          </span>
          <span className="hidden w-20 justify-end md:flex">{it.trust_score != null && <Trust score={it.trust_score} tone={tone} />}</span>
        </>
      )}
      <span className="num hidden w-10 text-right text-[13px] text-ink-3 md:block">{ago(it.created_at)}</span>
      <ChevronRight className="hidden size-4 text-line-strong transition-colors group-hover:text-ink-3 md:block" aria-hidden />
    </Link>
  );
}

export function ActionPill({ a }: { a: NonNullable<QueueItem["human_action"]> }) {
  if (a === "approved") return <Pill tone="ok">Approved</Pill>;
  if (a === "rejected") return <Pill tone="risk">Rejected</Pill>;
  return <Pill tone="warn">Waiting on vendor</Pill>;
}

function LiveStage({ idx }: { idx: number }) {
  const i = Math.max(idx, 0);
  return (
    <div className="flex w-full min-w-0 items-center gap-3" aria-label={`Stage ${i + 1} of 9: ${STAGES[i].name}`}>
      <div className="relative h-1 w-24 shrink-0 overflow-hidden rounded-full bg-line md:w-32">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${((i + 0.5) / 9) * 100}%` }} />
        <div className="animate-sweep absolute inset-y-0 w-1/3 bg-white/50" />
      </div>
      <span className="truncate text-[13px] text-ink-2">{STAGES[i].doing}…</span>
    </div>
  );
}

function SampleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [samples, setSamples] = useState<Sample[]>();
  const [busy, setBusy] = useState<string | null>(null);
  const nav = useNavigate();
  const toast = useToast();
  useEffect(() => {
    if (open && !samples) api.listSamples().then(setSamples).catch(() => toast("Couldn’t load samples", "risk"));
  }, [open, samples, toast]);

  async function run(id: string) {
    setBusy(id);
    try {
      const r = await api.runSample(id);
      nav(`/invoices/${r.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn’t start", "risk");
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Try a sample invoice">
      <ul className="-mx-2 -my-1">
        {!samples && [0, 1, 2, 3].map((i) => <li key={i} className="px-2 py-2"><Skeleton className="h-10" /></li>)}
        {samples?.map((s) => (
          <li key={s.id}>
            <button
              disabled={!!busy}
              onClick={() => void run(s.id)}
              className="flex w-full items-center gap-3 rounded-control px-2 py-2 text-left hover:bg-subtle disabled:opacity-60"
            >
              <img src={s.thumbnail_url} alt="" className="h-11 w-8.5 shrink-0 rounded-[3px] border border-line bg-subtle object-cover object-top" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.title}</span>
                <span className="block text-[13px] text-ink-3">{s.hint}</span>
              </span>
              <span className="text-[13px] font-medium text-accent">{busy === s.id ? "Starting…" : "Run"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
