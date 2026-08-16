#!/usr/bin/env python3
"""Build src/data/model.json for Transfer Chance Me from the transfer-outcomes dataset.

Reads from the sibling research repo (../data/processed). Re-run whenever the
dataset or school_advice.json changes:  python3 scripts/build_model.py
"""
import csv, json, math, os, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "..", "data", "processed"))
OUT = os.path.join(HERE, "..", "src", "data", "model.json")

SCHOOLS = ["Brown","Carnegie Mellon","Chicago","Columbia","Cornell","Dartmouth","Duke",
           "Emory","Georgetown","Harvard","Johns Hopkins","MIT","Michigan","Northwestern",
           "Notre Dame","Princeton","Rice","Stanford","UC Berkeley","UCLA","UNC","UPenn",
           "Vanderbilt","Yale"]

def pct(sorted_vals, q):
    if not sorted_vals: return None
    k = (len(sorted_vals) - 1) * q
    f, c = math.floor(k), math.ceil(k)
    if f == c: return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)

def parse_gpa(row):
    raw = (row.get("college_gpa") or "").strip()
    try:
        g = float(raw)
    except ValueError:
        return None
    scale = (row.get("gpa_scale") or "").strip()
    if scale and scale not in ("4.0", "4", "4.00", "4.3", "4.33"):
        return None
    if 2.0 <= g <= 4.34:
        return min(g, 4.0)
    return None

# 1) Admitted GPA distributions from the applicant-level table
gpas = defaultdict(list)
rows_by_school = defaultdict(int)
admits_by_school = defaultdict(int)
with open(os.path.join(DATA, "t25", "t25_applicants.csv")) as f:
    for row in csv.DictReader(f):
        s = row["school_name"]
        if s not in SCHOOLS: continue
        rows_by_school[s] += 1
        if row["decision"] == "accepted":
            admits_by_school[s] += 1
            g = parse_gpa(row)
            if g is not None:
                gpas[s].append(g)

# 2) Archetypes: official rate, majors, feeder
arch = {}
with open(os.path.join(DATA, "analysis", "school_archetypes.csv")) as f:
    for row in csv.DictReader(f):
        arch[row["school"]] = row

# 3) Official counts + cycle
official = {}
with open(os.path.join(DATA, "t25", "official_rates.csv")) as f:
    for row in csv.DictReader(f):
        official[row["school"]] = row

# 4) Trends + coadmits
with open(os.path.join(DATA, "analysis", "dashboard_compact.json")) as f:
    dash = json.load(f)

# 5) Qualitative counsel (produced by the signature-distillation pass)
advice_path = os.path.join(DATA, "analysis", "school_advice.json")
advice = {}
if os.path.exists(advice_path):
    with open(advice_path) as f:
        advice = json.load(f)
else:
    print("NOTE: school_advice.json not found; building without counsel", file=sys.stderr)

def hist(vals, lo=3.0, hi=4.0, nbins=20):
    bins = [0] * nbins
    for v in vals:
        if v < lo: continue
        i = min(nbins - 1, int((v - lo) / (hi - lo) * nbins))
        bins[i] += 1
    m = max(bins) or 1
    return [round(b / m, 3) for b in bins]

schools = []
for s in SCHOOLS:
    vals = sorted(gpas[s])
    a = arch.get(s, {})
    o = official.get(s, {})
    d = dash.get(s, {})
    rate = float(a.get("off_transfer_rate") or o.get("transfer_admit_rate_pct") or 0)
    entry = {
        "id": s.lower().replace(" ", "-"),
        "name": s,
        "rate": rate,
        "applicants": int(o["transfer_applicants"]) if o.get("transfer_applicants") else None,
        "admitted": int(o["transfer_admitted"]) if o.get("transfer_admitted") else None,
        "cycle": o.get("cycle") or "",
        "n": rows_by_school[s],
        "nAdmits": admits_by_school[s],
        "nGpa": len(vals),
        "gpa": {
            "p10": round(pct(vals, .10), 2) if vals else None,
            "p25": round(pct(vals, .25), 2) if vals else None,
            "p50": round(pct(vals, .50), 2) if vals else None,
            "p75": round(pct(vals, .75), 2) if vals else None,
            "p90": round(pct(vals, .90), 2) if vals else None,
        },
        "hist": hist(vals),
        "majors": [m.strip() for m in (a.get("top_majors") or "").split(";") if m.strip()][:3],
        "feeder": a.get("top_feeder") or "",
        "coadmit": d.get("c", [])[:3],
        "trend": [[t[0], t[3]] for t in d.get("t", []) if t[3] is not None],
        "counsel": advice.get(s) or None,
    }
    schools.append(entry)

total_rows = sum(rows_by_school.values())
total_admits = sum(admits_by_school.values())
model = {
    "meta": {
        "rows": total_rows,
        "admits": total_admits,
        "schools": len(schools),
        "yearSpan": "2011–2026",
        "sources": "Reddit (Arctic Shift full-history) + College Confidential; official rates from each school's Common Data Set / UC admit data",
    },
    "schools": schools,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(model, f, separators=(",", ":"))
print(f"wrote {OUT}: {len(schools)} schools, {total_rows} rows, {total_admits} admits, "
      f"{sum(len(v) for v in gpas.values())} admit GPAs; counsel={'yes' if advice else 'NO'}")
