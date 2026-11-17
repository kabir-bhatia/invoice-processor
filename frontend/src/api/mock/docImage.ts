// Draws a plausible invoice page as an SVG data URL so the document pane has
// something real to show in mock mode. The live backend serves PNG page renders instead.
import type { LineItem, Vendor } from "../types";

interface DocSpec {
  vendor: Vendor;
  title: string;
  number: string;
  date: string;
  po: string | null;
  lines: LineItem[];
  subtotal: number;
  tax: number;
  total: number;
  gst: "intra" | "inter";
  rate: number;
  bank: string;
  photo: boolean;
  soft: boolean;
  hiddenText?: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (n: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export function renderInvoiceSvg(d: DocSpec): string {
  const W = 620;
  const H = 800;
  const rows = d.lines
    .map((l, i) => {
      const y = 322 + i * 26;
      return `<text x="48" y="${y}">${i + 1}</text><text x="76" y="${y}">${esc(l.description)}</text>
<text x="388" y="${y}" text-anchor="end">${l.qty} ${esc(l.unit)}</text>
<text x="470" y="${y}" text-anchor="end">${money(l.unit_price)}</text>
<text x="572" y="${y}" text-anchor="end">${money(l.amount)}</text>`;
    })
    .join("");
  const ty = 322 + d.lines.length * 26 + 30;
  const taxRows =
    d.gst === "intra"
      ? `<text x="470" y="${ty + 22}" text-anchor="end">CGST ${d.rate / 2}%</text><text x="572" y="${ty + 22}" text-anchor="end">${money(d.tax / 2)}</text>
<text x="470" y="${ty + 44}" text-anchor="end">SGST ${d.rate / 2}%</text><text x="572" y="${ty + 44}" text-anchor="end">${money(d.tax / 2)}</text>`
      : `<text x="470" y="${ty + 22}" text-anchor="end">IGST ${d.rate}%</text><text x="572" y="${ty + 22}" text-anchor="end">${money(d.tax)}</text>`;
  const gy = ty + (d.gst === "intra" ? 74 : 52);

  const page = `
<rect x="20" y="16" width="${W - 40}" height="${H - 32}" fill="#fffefb" stroke="#d9d7cf"/>
<g font-family="Georgia, 'Times New Roman', serif" fill="#22252a" font-size="12">
  <text x="48" y="66" font-size="19" font-weight="700">${esc(d.vendor.name)}</text>
  <text x="48" y="86" fill="#555" font-size="11">${esc(d.vendor.state)}, India · GSTIN: ${d.vendor.gstin}</text>
  <text x="572" y="66" text-anchor="end" font-size="15" font-weight="700" letter-spacing="1.5">${esc(d.title)}</text>
  <line x1="48" y1="104" x2="572" y2="104" stroke="#22252a" stroke-width="1.4"/>
  <text x="48" y="134" fill="#666" font-size="10.5">BILL TO</text>
  <text x="48" y="152" font-weight="700">Northwind Components Pvt Ltd</text>
  <text x="48" y="169" fill="#555" font-size="11">Plot 41, Sector 18, Gurugram, Haryana 122015</text>
  <text x="48" y="185" fill="#555" font-size="11">GSTIN: 06AAECN4471H1ZT</text>
  <text x="572" y="134" text-anchor="end">${d.title === "QUOTATION" ? "Ref" : "Invoice No"}: <tspan font-weight="700">${esc(d.number)}</tspan></text>
  <text x="572" y="152" text-anchor="end">Dated ${d.date.split("-").reverse().join("/")}</text>
  ${d.po ? `<text x="572" y="170" text-anchor="end">Your PO: ${esc(d.po)}</text>` : ""}
  <rect x="40" y="276" width="540" height="24" fill="#eceae3"/>
  <g font-size="10.5" font-weight="700" fill="#444">
    <text x="48" y="292">#</text><text x="76" y="292">DESCRIPTION</text>
    <text x="388" y="292" text-anchor="end">QTY</text><text x="470" y="292" text-anchor="end">RATE</text><text x="572" y="292" text-anchor="end">AMOUNT</text>
  </g>
  ${rows}
  <line x1="330" y1="${ty - 16}" x2="572" y2="${ty - 16}" stroke="#bbb"/>
  <text x="470" y="${ty}" text-anchor="end">Sub Total</text><text x="572" y="${ty}" text-anchor="end">${money(d.subtotal)}</text>
  ${taxRows}
  <line x1="330" y1="${gy - 16}" x2="572" y2="${gy - 16}" stroke="#22252a"/>
  <text x="470" y="${gy + 2}" text-anchor="end" font-weight="700">Grand Total ₹</text>
  <text x="572" y="${gy + 2}" text-anchor="end" font-weight="700" font-size="14">${money(d.total)}</text>
  <text x="48" y="${H - 132}" fill="#666" font-size="10.5">BANK DETAILS</text>
  <text x="48" y="${H - 114}" font-size="11">A/c Name: ${esc(d.vendor.name)}</text>
  <text x="48" y="${H - 98}" font-size="11">A/c No: ${esc(d.bank.replace(/ /g, ""))}</text>
  <text x="572" y="${H - 98}" text-anchor="end" font-size="11" fill="#555">Authorised signatory</text>
  <path d="M470 ${H - 122} q14 -18 26 -4 t22 -6 t26 4" fill="none" stroke="#33415c" stroke-width="1.3"/>
  ${d.hiddenText ? `<text x="48" y="${H - 58}" font-size="6.5" fill="#e9e7df">${esc(d.hiddenText)}</text>` : ""}
</g>`;

  const svg = d.photo
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="sh" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.22"/></linearGradient>
  ${d.soft ? `<filter id="soft"><feGaussianBlur stdDeviation="0.55"/></filter>` : ""}
</defs>
<rect width="${W}" height="${H}" fill="#6f6658"/>
<g transform="rotate(-2.4 ${W / 2} ${H / 2}) translate(14 10) scale(0.95)" ${d.soft ? `filter="url(#soft)"` : ""}>${page}
<path d="M20 300 L600 268" stroke="#000" stroke-opacity="0.07" stroke-width="2"/>
<path d="M210 16 L250 784" stroke="#000" stroke-opacity="0.05" stroke-width="2"/>
</g>
<rect width="${W}" height="${H}" fill="url(#sh)"/>
</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#eceae4"/>${page}</svg>`;

  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
