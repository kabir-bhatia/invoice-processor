import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, Camera, Check, FlaskConical, Loader2, Mail, OctagonAlert, Upload, X, XCircle } from "lucide-react";
import type { Recommendation, Source } from "../api";
import { cx } from "../lib/format";
import { REC, TONE, type Tone } from "../lib/labels";

// ---------- Button ----------
type Variant = "primary" | "secondary" | "ghost" | "danger";
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  icon?: ReactNode;
}
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover border-transparent",
  secondary: "bg-surface text-ink border-line-strong hover:bg-subtle",
  ghost: "bg-transparent text-ink-2 border-transparent hover:bg-subtle hover:text-ink",
  danger: "bg-surface text-risk border-line-strong hover:bg-risk-soft hover:border-risk/30",
};
const SIZE = { sm: "h-8 px-2.5 text-[13px] gap-1.5", md: "h-9 px-3.5 gap-2", lg: "h-11 px-5 text-[15px] gap-2" };

export function Button({ variant = "secondary", size = "md", busy, icon, children, className, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-control border font-medium whitespace-nowrap transition-colors disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

// ---------- Card ----------
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx("rounded-card border border-line bg-surface", className)}>{children}</section>;
}

export function CardHeader({ title, right, sub }: { title: ReactNode; right?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5 md:px-5">
      <div className="min-w-0">
        <h2 className="font-semibold text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

// ---------- Status ----------
const REC_ICON: Record<Recommendation, typeof Check> = { ready: Check, review: AlertTriangle, hold: OctagonAlert, reject: XCircle };

export function RecIcon({ rec, className }: { rec: Recommendation; className?: string }) {
  const I = REC_ICON[rec];
  return <I className={cx(TONE[REC[rec].tone].text, className)} aria-hidden strokeWidth={2.2} />;
}

export function RecChip({ rec, short }: { rec: Recommendation; short?: boolean }) {
  const t = TONE[REC[rec].tone];
  return (
    <span className={cx("inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap", t.bg, t.text)}>
      <RecIcon rec={rec} className="size-3.5" />
      {short ? REC[rec].short : REC[rec].label}
    </span>
  );
}

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const t = TONE[tone];
  return <span className={cx("inline-flex h-5.5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap", t.bg, t.text)}>{children}</span>;
}

/** Trust score: number plus a thin meter. Colour follows the recommendation, not the number. */
export function Trust({ score, tone, size = "sm" }: { score: number; tone: Tone; size?: "sm" | "lg" }) {
  const t = TONE[tone];
  if (size === "lg") {
    return (
      <div className="w-24 shrink-0 md:w-28" aria-label={`Trust score ${score} out of 100`}>
        <div className="flex items-baseline gap-1 whitespace-nowrap">
          <span className={cx("num text-3xl leading-none font-semibold tracking-tight md:text-4xl", t.text)}>{score}</span>
          <span className="num text-sm text-ink-3">/ 100</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line">
          <div className={cx("h-full rounded-full transition-[width] duration-700", t.solid)} style={{ width: `${score}%` }} />
        </div>
        <div className="mt-1.5 text-xs text-ink-3" title="100 minus a penalty for every flag. Any critical flag forces a hold, whatever the score.">Trust score</div>
      </div>
    );
  }
  return (
    <span className="inline-flex items-center gap-2" aria-label={`Trust score ${score}`}>
      <span className="hidden h-1 w-10 overflow-hidden rounded-full bg-line sm:block">
        <span className={cx("block h-full rounded-full", t.solid)} style={{ width: `${score}%` }} />
      </span>
      <span className="num w-6 text-right text-[13px] font-medium text-ink-2">{score}</span>
    </span>
  );
}

const SOURCE: Record<Source, { icon: typeof Mail; label: string }> = {
  upload: { icon: Upload, label: "Upload" },
  camera: { icon: Camera, label: "Camera" },
  email: { icon: Mail, label: "Email" },
  sample: { icon: FlaskConical, label: "Sample" },
};
export function SourceIcon({ source, withLabel }: { source: Source; withLabel?: boolean }) {
  const { icon: I, label } = SOURCE[source];
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-3" title={label}>
      <I className="size-4" aria-hidden strokeWidth={1.8} />
      {withLabel ? <span className="text-[13px]">{label}</span> : <span className="sr-only">{label}</span>}
    </span>
  );
}

// ---------- Feedback ----------
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded bg-subtle", className)} />;
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <p className="font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-[13px] text-ink-3">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-risk/25 bg-risk-soft px-4 py-3 text-[13px] text-risk">
      <span>Couldn’t load this. {message}</span>
      {onRetry && (
        <button onClick={onRetry} className="font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

// ---------- Toggle ----------
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx("relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-line-strong")}
    >
      <span className={cx("absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform", checked && "translate-x-4")} />
    </button>
  );
}

// ---------- Dialog (centered on desktop, bottom sheet on mobile) ----------
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const first = ref.current?.querySelector<HTMLElement>("[data-autofocus], textarea, input, select, button:not([data-close])");
    first?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade absolute inset-0 bg-ink/35" onClick={onClose} />
      <div
        ref={ref}
        className={cx(
          "animate-sheet md:animate-rise relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-pop md:rounded-card",
          wide ? "md:max-w-2xl" : "md:max-w-md",
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button data-close onClick={onClose} aria-label="Close" className="-mr-1.5 grid size-8 place-items-center rounded-control text-ink-3 hover:bg-subtle hover:text-ink">
            <X className="size-4.5" />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="safe-bottom border-t border-line"><div className="flex justify-end gap-2 px-5 py-3.5">{footer}</div></footer>}
      </div>
    </div>
  );
}

// ---------- Toasts ----------
interface ToastMsg {
  id: number;
  text: string;
  tone: "ok" | "risk";
}
const ToastCtx = createContext<(text: string, tone?: "ok" | "risk") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const push = useCallback((text: string, tone: "ok" | "risk" = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 3600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 md:top-auto md:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="animate-rise pointer-events-auto flex items-center gap-2 rounded-control bg-ink px-3.5 py-2.5 text-[13px] font-medium text-white shadow-pop">
            {t.tone === "ok" ? <Check className="size-4 text-[#8fd0ad]" /> : <AlertTriangle className="size-4 text-[#f0a595]" />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
