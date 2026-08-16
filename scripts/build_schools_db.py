#!/usr/bin/env python3
"""Build public/schools.json — searchable US institution directory.

Source: IPEDS HD2023 (US Dept of Education, public domain).
Usage: python3 scripts/build_schools_db.py /path/to/HD2023.csv
Output: [name, state, kind] per school; kind: cc | public4 | private4.
"""
import csv, json, sys, os

src = sys.argv[1] if len(sys.argv) > 1 else "HD2023.csv"
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "schools.json")

rows = []
with open(src, encoding="latin-1") as f:
    for r in csv.DictReader(f):
        # SECTOR: 1 pub4, 2 priv-nonprofit4, 3 priv-forprofit4, 4 pub2, 5 priv-np2, 6 priv-fp2
        try:
            sector = int(r["SECTOR"])
        except ValueError:
            continue
        if sector not in (1, 2, 3, 4, 5, 6):
            continue
        # CYACTIVE 1 = active institution
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
        rows.append([name, state, kind])

rows.sort(key=lambda x: x[0].lower())
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(rows, f, separators=(",", ":"))
kinds = {}
for _, _, k in rows:
    kinds[k] = kinds.get(k, 0) + 1
print(f"wrote {out}: {len(rows)} institutions {kinds}")
