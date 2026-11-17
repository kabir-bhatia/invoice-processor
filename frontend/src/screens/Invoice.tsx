import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Clock, Loader2, MoreHorizontal, RotateCw, Send, X } from "lucide-react";
import { api, type ActionKind, type Decision, type Flag, type InvoiceDetail, type Stage } from "../api";
import { Audit, Disclosure, DocFields, Flags, PoCard, Timeline } from "../components/InvoiceParts";
import { Button, Card, Dialog, ErrorNote, RecIcon, Skeleton, SourceIcon, Trust, useToast } from "../components/ui";
import { ago, cx, rupees, time } from "../lib/format";
import { REC, STAGES, TONE } from "../lib/labels";
import { useMedia } from "../lib/useMedia";

const blankStages = (): Stage[] => STAGES.map((s) => ({ id: s.id, status: "pending" }));
const mergeStages = (incoming: Stage[]): Stage[] => STAGES.map((s) => incoming.find((x) => x.id === s.id) ?? { id: s.id, status: "pending" });

/** Loads an invoice and, while it is processing, follows the SSE run stream. */
function useRun(id: string) {
  const [detail, setDetail] = useState<InvoiceDetail>();
  const [stages, setStages] = useState<Stage[]>(blankStages);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [retry, setRetry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    let alive = true;
    let unsub: (() => void) | undefined;
    setDetail(undefined);
    setStages(blankStages());
    setFlags([]);
    setDecision(null);
    setRetry(null);
    setError(null);

    const refetch = () =>
      api.getInvoice(id).then((d) => {
        if (!alive) return;
        setDetail(d);
        if (d.status !== "processing") {
          setStages(mergeStages(d.stages));
          setFlags(d.flags);
          setDecision(d.decision);
        }
        return d;
      });

    refetch()
      .then((d) => {
        if (!alive || !d || d.status !== "processing") return;
        unsub = api.subscribeRun(id, (ev) => {
          if (!alive) return;
          if (ev.type === "stage") {
            setStages((prev) => prev.map((s) => (s.id === ev.data.id ? { ...s, ...ev.data } : s)));
            if (ev.data.status !== "running") {
              setRetry(null);
              if (ev.data.id === "read") void refetch(); // fields are available as soon as Read finishes
            }
          } else if (ev.type === "flag") setFlags((prev) => (prev.some((f) => f.code === ev.data.code) ? prev : [...prev, ev.data]));
          else if (ev.type === "decision") setDecision(ev.data);
          else if (ev.type === "error") setRetry(ev.data.message);
          else if (ev.type === "done") void refetch();
        });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Something went wrong"));

    return () => {
      alive = false;
      unsub?.();
    };
  }, [id, runKey]);

  return { detail, setDetail, stages, flags, decision, retry, error, restart: () => setRunKey((k) => k + 1) };
}

type Mode = { kind: ActionKind; needReason: boolean } | null;

export function Invoice() {
  const { id = "" } = useParams();
  const run = useRun(id);
  const { detail, stages, flags, decision, retry } = run;
  const compact = !useMedia("(min-width: 768px)");
  const toast = useToast();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [nextId, setNextId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const live = !detail || detail.status === "processing";
  const acted = !!detail?.human_action;
  const field = (k: string) => detail?.fields.find((f) => f.key === k)?.value ?? null;
  const vendor = field("vendor_name") as string | null;
  const invNo = field("invoice_number") as string | null;
  const total = field("total") as number | null;
  const rec = decision?.recommendation;
  const hasMessage = !!detail?.vendor_message?.available;

  // After a decision, offer the next invoice that needs attention.
  useEffect(() => {
    if (!acted) return;
    api.listInvoices("needs_action").then((r) => setNextId(r.items.find((i) => i.id !== id && i.status === "done")?.id ?? null)).catch(() => {});
  }, [acted, id]);

  const act = useCallback(
    async (kind: ActionKind, reason?: string) => {
      setBusy(true);
      try {
        const d = await api.act(id, kind, reason);
        run.setDetail(d);
        setMode(null);
        toast(kind === "approve" ? "Approved" : kind === "reject" ? "Rejected" : "Info requested");
      } catch (e) {
        toast(e instanceof Error ? e.message : "Couldn’t save", "risk");
      } finally {
        setBusy(false);
      }
    },
    [id, run, toast],
  );

  // One primary action per recommendation; the other two step back.
  const actions = useMemo(() => {
    if (!rec) return null;
    const approve = { kind: "approve" as const, label: rec === "hold" || rec === "reject" ? "Approve anyway" : "Approve" };
    const reject = { kind: "reject" as const, label: "Reject" };
    const ask = { kind: "request_info" as const, label: "Ask vendor" };
    if (rec === "ready" || rec === "review") return { primary: approve, secondary: reject, tertiary: ask };
    if (rec === "hold") return hasMessage ? { primary: ask, secondary: reject, tertiary: approve } : { primary: reject, secondary: ask, tertiary: approve };
    return { primary: reject, secondary: ask, tertiary: approve };
  }, [rec, hasMessage]);

  function trigger(kind: ActionKind) {
    setMoreOpen(false);
    if (kind === "approve" && rec === "ready") return void act("approve");
    setMode({ kind, needReason: kind === "reject" || (kind === "approve" && (rec === "hold" || rec === "reject")) });
  }

  if (run.error) {
    return (
      <div>
        <BackLink />
        <div className="mt-4"><ErrorNote message={run.error} onRetry={run.restart} /></div>
      </div>
    );
  }

  const showButtons = !live && !acted && actions;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <BackLink />
        {detail && (
          <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink-3">
            <SourceIcon source={detail.source} withLabel />
            {detail.email?.from && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate" title={detail.email.subject ?? undefined}>from {detail.email.from_name || detail.email.from}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="num" title={time(detail.created_at)}>{ago(detail.created_at) === "now" ? "just now" : `${ago(detail.created_at)} ago`}</span>
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h1 className="min-w-0 text-xl font-semibold tracking-tight md:text-2xl">
          {vendor ?? (detail ? <span className="text-ink-3">Reading invoice…</span> : <Skeleton className="h-7 w-56" />)}
        </h1>
        {total != null && <span className="num text-xl font-semibold tracking-tight md:text-2xl">{rupees(total)}</span>}
      </div>
      {invNo && <p className="mt-0.5 font-mono text-[13px] text-ink-3">{invNo}</p>}

      {/* Verdict */}
      <Card className="mt-4 overflow-hidden md:mt-5">
        {decision && rec ? (
          <div className="animate-rise">
            <div className="flex items-start justify-between gap-5 p-4 md:p-6">
              <div className="min-w-0">
                {acted ? (
                  <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <span className="flex items-center gap-2 font-semibold text-ink">
                      {detail!.human_action === "approved" ? <Check className="size-4.5 text-ok" /> : detail!.human_action === "rejected" ? <X className="size-4.5 text-risk" /> : <Clock className="size-4.5 text-warn" />}
                      {detail!.human_action === "approved" ? "Approved" : detail!.human_action === "rejected" ? "Rejected" : "Waiting on vendor"}
                    </span>
                    <span className="text-[13px] text-ink-3">Recommended: {REC[rec].short.toLowerCase()}</span>
                  </p>
                ) : (
                  <p className={cx("flex items-center gap-2 font-semibold", TONE[REC[rec].tone].text)}>
                    <RecIcon rec={rec} className="size-4.5" />
                    {REC[rec].label}
                  </p>
                )}
                <p className="mt-2 text-lg leading-snug font-semibold text-ink md:text-xl">{decision.headline}</p>
                {decision.reasons.length > 0 && (
                  <ul className="mt-2.5 space-y-1 text-ink-2">
                    {decision.reasons.slice(0, 2).map((r) => (
                      <li key={r} className="flex gap-2"><span className="mt-[0.55em] size-1 shrink-0 rounded-full bg-line-strong" />{r}</li>
                    ))}
                  </ul>
                )}
              </div>
              <Trust score={decision.trust_score} tone={REC[rec].tone} size="lg" />
            </div>

            {acted ? (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-subtle/50 px-4 py-3 md:px-6">
                <div className="min-w-0">
                  <p className="text-[13px] text-ink-2">{detail!.human_reason ?? "Decision recorded in the audit trail."}</p>
                </div>
                <div className="hidden gap-2 md:flex">
                  {nextId ? (
                    <Button variant="primary" onClick={() => nav(`/invoices/${nextId}`)}>Next invoice <ArrowRight className="size-4" /></Button>
                  ) : (
                    <Button onClick={() => nav("/")}>Back to queue</Button>
                  )}
                </div>
              </div>
            ) : (
              showButtons && (
                <div className="hidden items-center justify-between gap-3 border-t border-line px-6 py-3.5 md:flex">
                  <span className="text-[13px] text-ink-3">Rules v{decision.rule_version}</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => trigger(actions.tertiary.kind)}>{actions.tertiary.label}</Button>
                    <Button variant={actions.secondary.kind === "reject" ? "danger" : "secondary"} onClick={() => trigger(actions.secondary.kind)}>{actions.secondary.label}</Button>
                    <Button variant="primary" busy={busy && !mode} onClick={() => trigger(actions.primary.kind)} className="min-w-28">{actions.primary.label}</Button>
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-5 p-4 md:p-6" aria-live="polite">
            <div>
              <p className="flex items-center gap-2 font-semibold text-accent">
                <Loader2 className="size-4.5 animate-spin" />
                Checking this invoice
              </p>
              <Skeleton className="mt-3 h-6 w-64 max-w-full" />
              <Skeleton className="mt-2.5 h-4 w-44" />
            </div>
            <div className="w-28">
              <Skeleton className="h-9 w-16" />
              <Skeleton className="mt-2 h-1 w-full" />
            </div>
          </div>
        )}
      </Card>

      {/* Evidence */}
      <div className="mt-4 grid gap-4 md:grid-cols-[21rem_minmax(0,1fr)] md:items-start">
        <div className="md:sticky md:top-6">
          <Timeline stages={stages} live={live} retry={retry} compact={compact} />
          {decision && !live && (
            <p className="mt-2.5 hidden px-1 text-xs text-ink-3 md:block">
              Rules v{decision.rule_version} · {decision.model.replace(/^.*\//, "")}
              <button onClick={async () => { await api.rerun(id); run.restart(); }} className="ml-2 inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink">
                <RotateCw className="size-3" /> Re-run
              </button>
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Flags flags={flags} />
          {detail?.po && <PoCard po={detail.po} lines={detail.line_items} />}
          {detail && (
            <DocFields
              detail={detail}
              reading={detail.fields.length === 0 && live}
              compact={compact}
              onFix={live || acted ? undefined : async (key, value) => {
                await api.patchField(id, key, value);
                await api.rerun(id).catch(() => {});
                toast("Saved. Re-checking");
                run.restart();
              }}
            />
          )}
          {!live && detail && hasMessage && (
            <Disclosure title="Vendor message" meta={detail.vendor_message!.sent_at ? `Sent ${time(detail.vendor_message!.sent_at)}` : "Draft"}>
              <p className="text-[13px] text-ink-3">To {detail.vendor_message!.to}</p>
              <p className="mt-1.5 font-medium">{detail.vendor_message!.subject}</p>
              <p className="mt-2 whitespace-pre-line text-ink-2">{detail.vendor_message!.body}</p>
              {!detail.vendor_message!.sent_at && (
                <Button className="mt-4" icon={<Send className="size-4" />} onClick={() => setMode({ kind: "request_info", needReason: false })}>Edit and send</Button>
              )}
            </Disclosure>
          )}
          {!live && detail && detail.audit.length > 0 && (
            <Disclosure title="Audit trail" meta={`${detail.audit.length} events`}>
              <Audit events={detail.audit} />
            </Disclosure>
          )}
        </div>
      </div>

      {/* Mobile: sticky decision bar */}
      {compact && (showButtons || acted) && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface">
          {acted ? (
            <div className="flex gap-2 px-4 py-3">
              {nextId ? (
                <Button size="lg" variant="primary" className="flex-1" onClick={() => nav(`/invoices/${nextId}`)}>Next invoice <ArrowRight className="size-4" /></Button>
              ) : (
                <Button size="lg" className="flex-1" onClick={() => nav("/")}>Back to queue</Button>
              )}
            </div>
          ) : (
            actions && (
              <div className="relative flex gap-2 px-4 py-3">
                <button aria-label="More actions" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)} className="grid size-11 shrink-0 place-items-center rounded-control border border-line-strong bg-surface text-ink hover:bg-subtle">
                  <MoreHorizontal className="size-5" strokeWidth={2.2} />
                </button>
                <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More actions">
                  <Button size="lg" className="w-full" onClick={() => trigger(actions.tertiary.kind)}>{actions.tertiary.label}</Button>
                </Dialog>
                <Button size="lg" variant={actions.secondary.kind === "reject" ? "danger" : "secondary"} className="flex-1" onClick={() => trigger(actions.secondary.kind)}>{actions.secondary.label}</Button>
                <Button size="lg" variant="primary" className="flex-[1.4]" busy={busy && !mode} onClick={() => trigger(actions.primary.kind)}>{actions.primary.label}</Button>
              </div>
            )
          )}
        </div>
      )}

      {detail && mode && mode.kind !== "request_info" && (
        <ReasonDialog mode={mode} flags={flags} busy={busy} onClose={() => setMode(null)} onSubmit={(reason) => void act(mode.kind, reason)} />
      )}
      {detail && mode?.kind === "request_info" && (
        <MessageDialog
          detail={detail}
          busy={busy}
          onClose={() => setMode(null)}
          onSend={async (subject, body) => {
            setBusy(true);
            try {
              if (hasMessage) await api.sendVendorMessage(id, subject, body);
              await act("request_info", hasMessage ? `Sent: ${subject}` : body);
            } catch (e) {
              toast(e instanceof Error ? e.message : "Couldn’t send", "risk");
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="-ml-1.5 inline-flex h-8 items-center gap-1.5 rounded-control px-1.5 text-[13px] font-medium text-ink-2 hover:bg-subtle hover:text-ink">
      <ArrowLeft className="size-4" /> Queue
    </Link>
  );
}

const inputCls = "w-full rounded-control border border-line-strong bg-surface px-3 py-2 placeholder:text-ink-3 focus:border-accent focus:outline-none";

function ReasonDialog({ mode, flags, busy, onClose, onSubmit }: { mode: NonNullable<Mode>; flags: Flag[]; busy: boolean; onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const approving = mode.kind === "approve";
  const quick = approving
    ? ["Verified with vendor by phone", "Approved by purchase team", "Checked against the original"]
    : [...new Set([...flags.filter((f) => f.severity !== "info").map((f) => f.title), "Wrong amount", "Sent to wrong company"])].slice(0, 4);
  const ok = !mode.needReason || reason.trim().length > 2;
  return (
    <Dialog
      open
      onClose={onClose}
      title={approving ? (mode.needReason ? "Approve against the recommendation" : "Approve invoice") : "Reject invoice"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!ok} onClick={() => onSubmit(reason)}>{approving ? "Approve" : "Reject"}</Button>
        </>
      }
    >
      <label className="block">
        <span className="font-medium">{mode.needReason ? "Reason" : "Note"} <span className="font-normal text-ink-3">{mode.needReason ? "(required, kept in the audit trail)" : "(optional)"}</span></span>
        <textarea data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={cx(inputCls, "mt-2 resize-none")} placeholder={approving ? "Why is this safe to pay?" : "Why is this being rejected?"} />
      </label>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button key={q} onClick={() => setReason(q)} className="h-7 rounded-full border border-line px-2.5 text-[13px] text-ink-2 hover:bg-subtle">{q}</button>
        ))}
      </div>
    </Dialog>
  );
}

function MessageDialog({ detail, busy, onClose, onSend }: { detail: InvoiceDetail; busy: boolean; onClose: () => void; onSend: (subject: string, body: string) => void }) {
  const m = detail.vendor_message;
  const has = !!m?.available;
  const [subject, setSubject] = useState(has ? m!.subject : "");
  const [body, setBody] = useState(has ? m!.body : "");
  return (
    <Dialog
      open
      onClose={onClose}
      wide={has}
      title={has ? "Ask the vendor" : "Request info"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={body.trim().length < 3} icon={has ? <Send className="size-4" /> : undefined} onClick={() => onSend(subject, body)}>{has ? "Send" : "Mark as requested"}</Button>
        </>
      }
    >
      {has ? (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-3">To {m!.to} · drafted for you, edit before sending</p>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" className={cx(inputCls, "font-medium")} />
          <textarea data-autofocus value={body} onChange={(e) => setBody(e.target.value)} rows={11} aria-label="Message" className={cx(inputCls, "resize-none leading-relaxed")} />
        </div>
      ) : (
        <label className="block">
          <span className="font-medium">What do you need from the vendor?</span>
          <textarea data-autofocus value={body} onChange={(e) => setBody(e.target.value)} rows={4} className={cx(inputCls, "mt-2 resize-none")} placeholder="e.g. Please share the PO number for this invoice" />
        </label>
      )}
    </Dialog>
  );
}
