"""GSTIN validation (format + official mod-36 checksum) and state codes."""
from __future__ import annotations

import re

CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")

STATE_CODES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
    "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "32": "Kerala", "33": "Tamil Nadu", "36": "Telangana",
    "37": "Andhra Pradesh",
}


def checksum_char(first14: str) -> str:
    total = 0
    for i, ch in enumerate(first14):
        prod = CHARS.index(ch) * (1 if i % 2 == 0 else 2)
        total += prod // 36 + prod % 36
    return CHARS[(36 - total % 36) % 36]


def make_gstin(state_code: str, pan: str, entity: str = "1") -> str:
    base = f"{state_code}{pan}{entity}Z"
    return base + checksum_char(base)


def clean(gstin: str | None) -> str | None:
    if not gstin:
        return None
    return re.sub(r"[\s\-.]", "", str(gstin)).upper()


def validate(gstin: str | None) -> tuple[bool, str]:
    """(ok, reason)."""
    g = clean(gstin)
    if not g:
        return False, "missing"
    if len(g) != 15 or not GSTIN_RE.match(g):
        return False, "bad format"
    if g[:2] not in STATE_CODES:
        return False, f"unknown state code {g[:2]}"
    if checksum_char(g[:14]) != g[14]:
        return False, "checksum does not match"
    return True, "valid"


def state_of(gstin: str | None) -> str | None:
    g = clean(gstin)
    return STATE_CODES.get(g[:2]) if g and len(g) >= 2 else None


# Characters OCR / vision models commonly confuse. GSTIN has a checksum, so we can use it to repair misreads.
CONFUSABLE = {"I": "1", "1": "I", "O": "0", "0": "O", "S": "5", "5": "S", "B": "8", "8": "B", "Z": "2", "2": "Z", "L": "1", "G": "6", "6": "G"}


def repair(gstin: str | None, prefer: list[str] | None = None) -> tuple[str | None, bool]:
    """If the GSTIN fails validation, try single/double confusable-character swaps that make it valid.
    Returns (gstin, repaired). Candidates in `prefer` (known GSTINs) win."""
    g = clean(gstin)
    if not g or validate(g)[0]:
        return g, False
    pos = [i for i, ch in enumerate(g) if ch in CONFUSABLE]
    cands = []
    for i in pos:
        c = g[:i] + CONFUSABLE[g[i]] + g[i + 1:]
        if validate(c)[0]:
            cands.append(c)
        for k in pos:
            if k <= i:
                continue
            c2 = c[:k] + CONFUSABLE[c[k]] + c[k + 1:]
            if validate(c2)[0]:
                cands.append(c2)
    for c in cands:
        if prefer and c in prefer:
            return c, True
    if len(set(cands)) == 1:
        return cands[0], True
    # Insertions/deletions (e.g. an extra 'A' read into the PAN): an invalid GSTIN can't be a real company,
    # so if it is within 2 edits of exactly one known GSTIN, that's what was printed.
    if prefer:
        from rapidfuzz.distance import Levenshtein
        near = sorted((Levenshtein.distance(g, k), k) for k in set(prefer))
        if near and near[0][0] <= 2 and (len(near) == 1 or near[1][0] > near[0][0]):
            return near[0][1], True
    return g, False
