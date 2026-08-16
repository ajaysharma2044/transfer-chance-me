#!/usr/bin/env python3
"""Build public/schools.json — searchable US institution directory.

Sources: IPEDS HD2023 (directory) + ADM2023 (admissions), US Dept of
Education, public domain.
Usage: python3 scripts/build_schools_db.py /path/to/HD2023.csv [/path/to/adm2023.csv]
Output rows: [name, state, kind, domain, city, sizeCat, admitRatePct|null]
kind: cc | public4 | private4; sizeCat: IPEDS INSTSIZE 1-5 (under 1k … over
20k, -1/-2 unknown → 0); admit rate is FRESHMAN admissions (transfer rates
aren't collected by IPEDS) — null when not reported (e.g. open admission).
"""
import csv, json, sys, os

src = sys.argv[1] if len(sys.argv) > 1 else "HD2023.csv"
adm_src = sys.argv[2] if len(sys.argv) > 2 else None
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "schools.json")

adm = {}
if adm_src and os.path.exists(adm_src):
    with open(adm_src, encoding="utf-8-sig", errors="replace") as f:
        for r in csv.DictReader(f):
            try:
                applied = int(r["APPLCN"])
                admitted = int(r["ADMSSN"])
                if applied > 0:
                    adm[r["UNITID"].strip()] = round(admitted / applied * 100, 1)
            except (ValueError, KeyError):
                continue

rows = []
with open(src, encoding="utf-8-sig", errors="replace") as f:
    for r in csv.DictReader(f):
        # SECTOR: 1 pub4, 2 priv-nonprofit4, 3 priv-forprofit4, 4 pub2, 5 priv-np2, 6 priv-fp2
        try:
            sector = int(r["SECTOR"])
        except ValueError:
            continue
        if sector not in (1, 2, 3, 4, 5, 6):
            continue
        if r.get("CYACTIVE", "1").strip() not in ("1", ""):
            continue
        # Degree-granting, at least 2-year level (drops beauty/barber/trade certs)
        if r.get("DEGGRANT", "1").strip() != "1":
            continue
        if r.get("ICLEVEL", "1").strip() == "3":
            continue
        name = r["INSTNM"].strip()
        state = r["STABBR"].strip()
        # Carnegie 1-14 = associate's-dominant (incl. CCs that award one bachelor's,
        # e.g. Santa Monica College) — treat as community college for transfer purposes
        try:
            c21 = int(r.get("C21BASIC") or 0)
        except ValueError:
            c21 = 0
        if sector in (4, 5, 6) or 1 <= c21 <= 14:
            kind = "cc"
        else:
            kind = "public4" if sector == 1 else "private4"
        # normalize website to bare domain for favicon lookup
        web = (r.get("WEBADDR") or "").strip().lower()
        web = web.removeprefix("https://").removeprefix("http://").removeprefix("www.")
        domain = web.split("/")[0] if "." in web else ""
        city = (r.get("CITY") or "").strip()
        try:
            size_cat = max(0, int(r.get("INSTSIZE") or 0))
        except ValueError:
            size_cat = 0
        rows.append([name, state, kind, domain, city, size_cat, adm.get(r["UNITID"].strip())])

rows.sort(key=lambda x: x[0].lower())
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(rows, f, separators=(",", ":"))
kinds = {}
with_rate = sum(1 for r in rows if r[6] is not None)
for r in rows:
    kinds[r[2]] = kinds.get(r[2], 0) + 1
print(f"wrote {out}: {len(rows)} institutions {kinds}; {with_rate} with admit rates")
