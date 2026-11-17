const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** ₹1,84,200 (Indian grouping, no paise). */
export const rupees = (n: number | null | undefined) => (n == null ? "–" : inr0.format(n));
/** ₹85.00, for unit prices. */
export const rupees2 = (n: number | null | undefined) => (n == null ? "–" : inr2.format(n));
export const number = (n: number | null | undefined) => (n == null ? "–" : num.format(n));

/** ₹6.8L / ₹1.2Cr, for KPI tiles and bars. */
export function rupeesShort(n: number): string {
  const a = Math.abs(n);
  const trim = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(x >= 10 ? 1 : 2).replace(/\.?0+$/, ""));
  if (a >= 1e7) return `₹${trim(n / 1e7)}Cr`;
  if (a >= 1e5) return `₹${trim(n / 1e5)}L`;
  if (a >= 1e3) return `₹${trim(n / 1e3)}K`;
  return `₹${Math.round(n)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-11-14 → 14 Nov 2026 */
export function date(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Compact age: now, 4m, 2h, 3d, then 12 Nov. */
export function ago(iso: string): string {
  const d = new Date(iso);
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function time(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function clock(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function duration(ms: number | undefined): string {
  if (ms == null) return "";
  if (ms < 100) return "<0.1s";
  return `${(ms / 1000).toFixed(1)}s`;
}

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
