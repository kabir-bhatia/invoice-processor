"""Seed data: a small, realistic procurement system for Northwind Components Pvt Ltd (Gurugram, Haryana).

Every demo sample (samples/catalog.py) relies on history defined here — e.g. the split-billing sample needs
earlier invoices on PO-1047, the duplicate sample needs SP/26-27/1023 already approved.
"""
from __future__ import annotations

import shutil

from . import db
from .gst import make_gstin

BUYER = {
    "name": "Northwind Components Pvt Ltd",
    "state": "Haryana",
    "gstin": make_gstin("06", "AABCN4821K"),
    "address": ["Plot 42, Sector 37, Udyog Vihar", "Gurugram, Haryana 122001"],
}

VENDORS = [
    dict(id="v_shree", name="Shree Packaging Pvt Ltd", aliases=["Shree Packaging", "Shree Packaging Private Limited"],
         gstin=make_gstin("06", "AAACS1234F"), state="Haryana",
         address="Khasra 118, Sector 5, IMT Manesar, Gurugram, Haryana 122052", email="accounts@shreepack.example",
         bank_name="HDFC Bank", bank_account="50200012344821", ifsc="HDFC0001234", status="approved", first_invoice_on="2025-04-10"),
    dict(id="v_apex", name="Apex Metals & Alloys Pvt Ltd", aliases=["Apex Metals", "Apex Metals and Alloys"],
         gstin=make_gstin("27", "AABCA5678G"), state="Maharashtra",
         address="Plot D-14, MIDC Bhosari, Pune, Maharashtra 411026", email="billing@apexmetals.example",
         bank_name="Axis Bank", bank_account="912010045678123", ifsc="UTIB0000456", status="approved", first_invoice_on="2024-11-02"),
    dict(id="v_orbit", name="Orbit Logistics LLP", aliases=["Orbit Logistics"],
         gstin=make_gstin("06", "AAGFO9012H"), state="Haryana",
         address="Warehouse 7, NH-48, Bilaspur, Gurugram, Haryana 122413", email="finance@orbitlogistics.example",
         bank_name="ICICI Bank", bank_account="003905012345", ifsc="ICIC0000039", status="approved", first_invoice_on="2025-06-01"),
    dict(id="v_kaveri", name="Kaveri Electricals", aliases=["Kaveri Electricals Pvt Ltd", "Kaveri Electrical"],
         gstin=make_gstin("29", "AAFCK3456J"), state="Karnataka",
         address="No. 22, 3rd Cross, Peenya Industrial Area, Bengaluru, Karnataka 560058", email="accounts@kaverielec.example",
         bank_name="Canara Bank", bank_account="0412201009876", ifsc="CNRB0000412", status="approved", first_invoice_on="2025-01-15"),
    dict(id="v_nimbus", name="Nimbus Cloud Services Pvt Ltd", aliases=["Nimbus Cloud", "Nimbus Cloud Services"],
         gstin=make_gstin("29", "AACCN7890K"), state="Karnataka",
         address="5th Floor, Prestige Tech Park, Bengaluru, Karnataka 560103", email="billing@nimbuscloud.example",
         bank_name="Kotak Mahindra Bank", bank_account="8811223344", ifsc="KKBK0008011", status="approved", first_invoice_on="2026-04-30"),
    dict(id="v_precision", name="Precision Tools India Pvt Ltd", aliases=["Precision Tools", "Precision Tools India"],
         gstin=make_gstin("06", "AADCP2345L"), state="Haryana",
         address="Plot 88, Sector 24, Faridabad, Haryana 121005", email="accounts@precisiontools.example",
         bank_name="State Bank of India", bank_account="38123456789", ifsc="SBIN0001789", status="approved", first_invoice_on="2024-08-20"),
    dict(id="v_sunrise", name="Sunrise Office Supplies", aliases=["Sunrise Office Supply", "Sunrise Stationers"],
         gstin=make_gstin("07", "ABDPS6789M"), state="Delhi",
         address="Shop 14, Nehru Place, New Delhi 110019", email="sunrise.office@mail.example",
         bank_name="Punjab National Bank", bank_account="0151002100045678", ifsc="PUNB0015100", status="approved", first_invoice_on="2025-02-11"),
    dict(id="v_bharat", name="Bharat Fasteners Pvt Ltd", aliases=["Bharat Fasteners"],
         gstin=make_gstin("03", "AAECB1122N"), state="Punjab",
         address="Focal Point, Phase 8, Ludhiana, Punjab 141010", email="sales@bharatfasteners.example",
         bank_name="HDFC Bank", bank_account="50100098765432", ifsc="HDFC0000201", status="blocked", first_invoice_on="2024-05-05"),
]

# number, vendor, type, status, created, end_date, description, lines [(desc, qty, unit, price, gst, hsn)]
POS = [
    ("PO-1036", "v_kaveri", "goods", "closed", "2026-08-28", "2026-12-31", "Panel wiring material",
     [("PVC insulated cable 4 sq mm (90 m coil)", 30, "coils", 2650, 18, "8544")]),
    ("PO-1037", "v_apex", "goods", "closed", "2026-09-10", "2026-12-31", "Aluminium stock Q3",
     [("Aluminium sheet 6061 2 mm", 300, "kg", 305, 18, "7606")]),
    ("PO-1038", "v_apex", "goods", "open", "2026-10-28", "2027-01-31", "Aluminium + SS stock Q4",
     [("Aluminium sheet 6061 2 mm", 500, "kg", 312, 18, "7606"),
      ("SS 304 round rod 12 mm", 200, "kg", 245, 18, "7222")]),
    ("PO-1039", "v_apex", "goods", "open", "2026-11-02", "2027-01-31", "Copper busbars",
     [("Copper busbar 25x5 mm", 100, "pcs", 1450, 18, "7407")]),
    ("PO-1041", "v_precision", "goods", "closed", "2026-09-15", "2026-12-31", "Inserts",
     [("Carbide turning insert CNMG 120408", 200, "pcs", 410, 18, "8209")]),
    ("PO-1042", "v_shree", "goods", "open", "2026-10-30", "2027-01-31", "Packaging material Nov",
     [("Corrugated box 5-ply 18x12x10", 1200, "pcs", 85, 18, "4819"),
      ("Bubble wrap roll 1m x 100m", 40, "rolls", 1180, 18, "3923"),
      ("BOPP tape 48mm brown", 300, "pcs", 38.5, 18, "3919")]),
    ("PO-1043", "v_sunrise", "goods", "closed", "2026-09-25", "2026-12-31", "Stationery Oct",
     [("A4 paper 70 gsm (ream)", 150, "reams", 260, 12, "4802")]),
    ("PO-1044", "v_precision", "goods", "open", "2026-11-03", "2027-02-28", "End mills",
     [("Carbide end mill 10 mm 4-flute", 40, "pcs", 2500, 18, "8207")]),
    ("PO-1045", "v_precision", "goods", "open", "2026-11-03", "2027-02-28", "Drill sets",
     [("HSS drill bit set 1-13 mm (25 pc)", 25, "sets", 4000, 18, "8207")]),
    ("PO-1046", "v_precision", "goods", "open", "2026-11-05", "2027-02-28", "Measuring instruments",
     [("Digital vernier caliper 150 mm", 30, "pcs", 1850, 18, "9017")]),
    ("PO-1047", "v_orbit", "services", "open", "2026-10-01", "2026-12-31", "Q4 freight Gurugram - Pune",
     [("Full truck load Gurugram to Pune (32 ft MXL)", 10, "trips", 30000, 18, "9965")]),
    ("PO-1048", "v_sunrise", "goods", "open", "2026-11-04", "2027-01-31", "Office chairs",
     [("Ergonomic office chair, mesh back", 8, "pcs", 6800, 18, "9401")]),
    ("PO-1049", "v_sunrise", "goods", "open", "2026-11-06", "2027-01-31", "Stationery Nov",
     [("A4 paper 70 gsm (ream)", 200, "reams", 265, 12, "4802"),
      ("Toner cartridge HP 88A", 12, "pcs", 3150, 18, "8443"),
      ("Heavy duty stapler", 10, "pcs", 640, 18, "8472")]),
    ("PO-1050", "v_nimbus", "services", "open", "2026-04-01", "2027-03-31", "Cloud hosting FY26-27 (monthly)",
     [("Managed cloud hosting - monthly", 12, "months", 68000, 18, "998315")]),
    ("PO-1051", "v_kaveri", "goods", "open", "2026-11-01", "2027-01-31", "Shop-floor lighting upgrade",
     [("LED panel light 2x2 ft 40W", 150, "pcs", 1240, 18, "9405"),
      ("MCB 32A 4-pole", 60, "pcs", 980, 18, "8536")]),
    ("PO-1053", "v_bharat", "goods", "closed", "2026-05-12", "2026-08-31", "Fasteners",
     [("Hex bolt M10x50 (box of 100)", 40, "boxes", 820, 18, "7318")]),
]

# grn_number, po, line_no, qty, date
GRNS = [
    ("GRN-5501", "PO-1036", 1, 30, "2026-09-12"),
    ("GRN-5507", "PO-1037", 1, 300, "2026-09-25"),
    ("GRN-5531", "PO-1038", 1, 500, "2026-11-09"), ("GRN-5531", "PO-1038", 2, 200, "2026-11-09"),
    ("GRN-5538", "PO-1039", 1, 60, "2026-11-13"),            # only 60 of 100 received
    ("GRN-5512", "PO-1041", 1, 200, "2026-10-01"),
    ("GRN-5534", "PO-1042", 1, 1200, "2026-11-10"), ("GRN-5534", "PO-1042", 2, 40, "2026-11-10"), ("GRN-5534", "PO-1042", 3, 300, "2026-11-10"),
    ("GRN-5509", "PO-1043", 1, 150, "2026-10-03"),
    ("GRN-5536", "PO-1044", 1, 40, "2026-11-11"),
    ("GRN-5537", "PO-1045", 1, 25, "2026-11-11"),
    ("GRN-5540", "PO-1046", 1, 30, "2026-11-12"),
    ("GRN-5535", "PO-1048", 1, 8, "2026-11-12"),
    ("GRN-5541", "PO-1049", 1, 200, "2026-11-13"), ("GRN-5541", "PO-1049", 2, 12, "2026-11-13"), ("GRN-5541", "PO-1049", 3, 10, "2026-11-13"),
    ("GRN-5542", "PO-1051", 1, 150, "2026-11-14"), ("GRN-5542", "PO-1051", 2, 60, "2026-11-14"),
    ("GRN-5420", "PO-1053", 1, 40, "2026-06-02"),
]

# Past invoices already processed and approved (the "history" the checks look back on).
# id, vendor, number, date, po, billed_lines {line_no: qty}, subtotal, gst_rate, bank_account, acted_at
HISTORY = [
    ("h_sp1023", "v_shree", "SP/26-27/1023", "2026-11-11", "PO-1042", {1: 1200, 2: 40, 3: 300}, 160750.0, 18, "50200012344821", "2026-11-12T09:20:00Z"),
    ("h_ol1101", "v_orbit", "OL/1101", "2026-10-08", "PO-1047", {1: 4}, 120000.0, 18, "003905012345", "2026-10-10T11:05:00Z"),
    ("h_ol1134", "v_orbit", "OL/1134", "2026-10-29", "PO-1047", {1: 3}, 90000.0, 18, "003905012345", "2026-10-31T10:40:00Z"),
    ("h_ama298", "v_apex", "AMA/2026/298", "2026-09-27", "PO-1037", {1: 300}, 91500.0, 18, "912010045678123", "2026-09-30T08:15:00Z"),
    ("h_ncs09", "v_nimbus", "NCS/2026/09", "2026-09-30", "PO-1050", {1: 1}, 68000.0, 18, "8811223344", "2026-10-02T07:30:00Z"),
    ("h_ncs10", "v_nimbus", "NCS/2026/10", "2026-10-31", "PO-1050", {1: 1}, 68000.0, 18, "8811223344", "2026-11-02T07:30:00Z"),
    ("h_ke442", "v_kaveri", "KE/2026/0442", "2026-09-14", "PO-1036", {1: 30}, 79500.0, 18, "0412201009876", "2026-09-18T12:00:00Z"),
    ("h_sos1187", "v_sunrise", "SOS/1187", "2026-10-04", "PO-1043", {1: 150}, 39000.0, 12, "0151002100045678", "2026-10-07T09:45:00Z"),
    ("h_pti789", "v_precision", "PTI/26/0789", "2026-10-01", "PO-1041", {1: 200}, 82000.0, 18, "38123456789", "2026-10-04T10:10:00Z"),
]

DEFAULT_RULES = dict(tolerance_pct=2.0, tolerance_abs=5000.0, approval_limit=1000000.0)


def reset(keep_cache: bool = True) -> None:
    """Restore the seed state: master data, history invoices, rules v1; clears all runs and files."""
    with db.tx() as c:
        for t in ["vendors", "purchase_orders", "po_lines", "grn_lines", "invoices", "events", "rules", "kv"]:
            c.execute(f"DELETE FROM {t}")
        if not keep_cache:
            c.execute("DELETE FROM extraction_cache")
        for v in VENDORS:
            c.execute(
                "INSERT INTO vendors(id,name,aliases,gstin,state,address,email,bank_name,bank_account,ifsc,status,"
                "tolerance_pct,tolerance_abs,first_invoice_on) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (v["id"], v["name"], db.j(v["aliases"]), v["gstin"], v["state"], v["address"], v["email"], v["bank_name"],
                 v["bank_account"], v["ifsc"], v["status"], v.get("tolerance_pct"), v.get("tolerance_abs"), v["first_invoice_on"]))
        for num, vid, typ, status, created, end, desc, lines in POS:
            c.execute("INSERT INTO purchase_orders VALUES(?,?,?,?,?,?,?)", (num, vid, typ, status, created, end, desc))
            for i, (d, qty, unit, price, gst, hsn) in enumerate(lines, 1):
                c.execute("INSERT INTO po_lines VALUES(?,?,?,?,?,?,?,?)", (num, i, d, qty, unit, price, gst, hsn))
        for g in GRNS:
            c.execute("INSERT INTO grn_lines VALUES(?,?,?,?,?)", g)
        vend = {v["id"]: v for v in VENDORS}
        for hid, vid, number, date, po, billed, sub, gst, bank, acted in HISTORY:
            total = round(sub * (1 + gst / 100))
            c.execute(
                "INSERT INTO invoices(id,status,source,created_at,finished_at,vendor_id,vendor_name,invoice_number,invoice_date,"
                "po_number,subtotal,total,billed_lines,bank_account,recommendation,trust_score,headline,rule_version,"
                "human_action,human_reason,acted_at,is_history) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
                (hid, "done", "history", acted, acted, vid, vend[vid]["name"], number, date, po, sub, total,
                 db.j({str(k): q for k, q in billed.items()}), bank, "ready", 96, "Matched PO, all checks passed", 1,
                 "approved", None, acted))
        c.execute("INSERT INTO rules VALUES(1,?,?,?,?)",
                  (DEFAULT_RULES["tolerance_pct"], DEFAULT_RULES["tolerance_abs"], DEFAULT_RULES["approval_limit"], db.now()))
    if db.FILES_DIR.exists():
        shutil.rmtree(db.FILES_DIR, ignore_errors=True)
    db.FILES_DIR.mkdir(parents=True, exist_ok=True)


if __name__ == "__main__":
    reset()
    print("seeded", db.DB_PATH)
