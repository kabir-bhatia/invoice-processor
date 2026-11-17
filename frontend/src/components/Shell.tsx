import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Inbox, ScanLine, Settings } from "lucide-react";
import { api, IS_MOCK } from "../api";
import { cx } from "../lib/format";
import { useAsync } from "../lib/useAsync";

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-7 place-items-center rounded-[7px] bg-accent text-[13px] font-bold text-white" aria-hidden>
        N
      </span>
      <span className="leading-tight">
        <span className="block text-[13px] font-semibold text-ink">AP Desk</span>
        <span className="block text-xs text-ink-3">Northwind Components</span>
      </span>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Queue", icon: Inbox, end: true },
  { to: "/dashboard", label: "Dashboard", icon: BarChart3, end: false },
  { to: "/settings", label: "Settings", icon: Settings, end: false },
];

export function Shell() {
  const loc = useLocation();
  const nav = useNavigate();
  const queue = useAsync(() => api.listInvoices("needs_action"), [loc.pathname], 8000);
  const gmail = useAsync(() => api.getGmail().catch(() => null), []);
  const pending = queue.data?.counts.needs_action ?? 0;
  // The invoice page owns the bottom of the screen on mobile (sticky decision bar).
  const onInvoice = loc.pathname.startsWith("/invoices/");

  return (
    <div className="min-h-dvh md:pl-56">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col border-r border-line bg-surface md:flex">
        <div className="px-4 pt-5 pb-6">
          <Logo />
        </div>
        <nav className="flex flex-col gap-0.5 px-2.5" aria-label="Main">
          {NAV.map(({ to, label, icon: I, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  "flex h-9 items-center gap-2.5 rounded-control px-2.5 font-medium transition-colors",
                  isActive || (to === "/" && onInvoice) ? "bg-subtle text-ink" : "text-ink-2 hover:bg-subtle/60 hover:text-ink",
                )
              }
            >
              <I className="size-4.5" strokeWidth={1.8} aria-hidden />
              <span className="flex-1">{label}</span>
              {to === "/" && pending > 0 && <span className="num text-xs text-ink-3">{pending}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 px-5 pb-5 text-xs text-ink-3">
          {gmail.data && (
            <NavLink to="/settings/integrations" className="flex items-center gap-2 hover:text-ink">
              <span className={cx("size-1.5 rounded-full", gmail.data.connected ? "bg-ok" : "bg-line-strong")} />
              {gmail.data.connected ? "Inbox connected" : "Inbox not connected"}
            </NavLink>
          )}
          {IS_MOCK && <div>Demo data</div>}
        </div>
      </aside>

      {/* Mobile top bar */}
      {!onInvoice && (
        <header className="sticky top-0 z-30 flex h-13 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur md:hidden">
          <Logo />
          <NavLink to="/settings" aria-label="Settings" className={({ isActive }) => cx("grid size-10 place-items-center rounded-control", isActive ? "bg-subtle text-ink" : "text-ink-2")}>
            <Settings className="size-5" strokeWidth={1.8} />
          </NavLink>
        </header>
      )}

      <main className={cx("mx-auto w-full max-w-[1180px] px-4 pt-5 md:px-8 md:pt-8 md:pb-12", onInvoice ? "pb-28" : "pb-28")}>
        <Outlet />
      </main>

      {/* Mobile bottom bar */}
      {!onInvoice && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface md:hidden" aria-label="Main">
          <div className="relative grid h-16 grid-cols-3 items-center">
            <Tab to="/" label="Queue" icon={Inbox} end badge={pending} />
            <div className="flex justify-center">
              <button
                onClick={() => nav("/scan")}
                className="-mt-7 flex size-16 flex-col items-center justify-center rounded-full bg-accent text-white shadow-pop ring-4 ring-canvas active:bg-accent-hover"
                aria-label="Scan an invoice"
              >
                <ScanLine className="size-6" strokeWidth={2} />
                <span className="mt-0.5 text-[11px] font-semibold">Scan</span>
              </button>
            </div>
            <Tab to="/dashboard" label="Dashboard" icon={BarChart3} />
          </div>
        </nav>
      )}
    </div>
  );
}

function Tab({ to, label, icon: I, end, badge }: { to: string; label: string; icon: typeof Inbox; end?: boolean; badge?: number }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx("flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium", isActive ? "text-accent" : "text-ink-3")}>
      <span className="relative">
        <I className="size-5.5" strokeWidth={1.8} aria-hidden />
        {!!badge && <span className="num absolute -top-1.5 -right-2.5 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-semibold text-white">{badge}</span>}
      </span>
      {label}
    </NavLink>
  );
}
