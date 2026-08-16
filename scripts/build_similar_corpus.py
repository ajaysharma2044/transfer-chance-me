#!/usr/bin/env python3
"""Build src/data/similar.json — the real matched-profile corpus.

Groups the recorded outcomes by pseudonymous author into real PEOPLE, each with
the GPA / major / institution they applied from and the full list of schools
that admitted and denied them. Nothing here is generated: every field traces to
a recorded outcome, and any person we cannot resolve is dropped rather than
guessed at.
"""
import csv, json, collections, statistics, re, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "transfer-chance-me")
SRC = [
    os.path.join(ROOT, "data/processed/outcomes.csv"),
    os.path.join(ROOT, "data/processed/cc_outcomes_all.csv"),
]

# ── canonical school names, exactly as the app knows them ──────────────────
def app_schools():
    names = set()
    m = json.load(open(os.path.join(APP, "src/data/model.json")))
    names.update(s["name"] for s in m["schools"])
    for x in json.load(open(os.path.join(APP, "src/data/extra_schools.json"))):
        names.add(x["name"])
    uc = json.load(open(os.path.join(APP, "src/data/uc_data.json")))
    names.update(uc["campuses"].keys())
    return names

CANON = app_schools()

ALIAS = {
    "ucsb": "UC Santa Barbara", "uc santa barbara": "UC Santa Barbara",
    "ucsd": "UC San Diego", "uc san diego": "UC San Diego", "ucsandiego": "UC San Diego",
    "ucla": "UCLA",
    "ucb": "UC Berkeley", "berkeley": "UC Berkeley", "cal": "UC Berkeley",
    "uc berkeley": "UC Berkeley", "university of california berkeley": "UC Berkeley",
    "ucd": "UC Davis", "uc davis": "UC Davis",
    "uci": "UC Irvine", "uc irvine": "UC Irvine",
    "ucsc": "UC Santa Cruz", "uc santa cruz": "UC Santa Cruz",
    "ucr": "UC Riverside", "uc riverside": "UC Riverside",
    "ucm": "UC Merced", "uc merced": "UC Merced",
    "cal poly": "Cal Poly SLO", "cal poly slo": "Cal Poly SLO",
    "cal poly san luis obispo": "Cal Poly SLO", "calpoly": "Cal Poly SLO",
    "cpp": "Cal Poly Pomona", "cal poly pomona": "Cal Poly Pomona",
    "sdsu": "San Diego State", "san diego state": "San Diego State",
    "sjsu": "San Jose State", "san jose state": "San Jose State",
    "sfsu": "SF State", "san francisco state": "SF State", "sf state": "SF State",
    "csulb": "Cal State Long Beach", "cal state long beach": "Cal State Long Beach",
    "long beach state": "Cal State Long Beach",
    "csuf": "Cal State Fullerton", "cal state fullerton": "Cal State Fullerton",
    "csula": "Cal State LA", "cal state la": "Cal State LA",
    "csun": "Cal State Northridge", "cal state northridge": "Cal State Northridge",
    "csudh": "Cal State Dominguez Hills", "csusb": "Cal State San Bernardino",
    "csusm": "Cal State San Marcos", "csuci": "Cal State Channel Islands",
    "csu east bay": "Cal State East Bay", "csueb": "Cal State East Bay",
    "sac state": "Sacramento State", "csus": "Sacramento State",
    "umich": "Michigan", "university of michigan": "Michigan", "u michigan": "Michigan",
    "unc": "UNC", "unc chapel hill": "UNC", "unc-chapel hill": "UNC",
    "uchicago": "Chicago", "university of chicago": "Chicago",
    "upenn": "UPenn", "penn": "UPenn", "university of pennsylvania": "UPenn",
    "jhu": "Johns Hopkins", "hopkins": "Johns Hopkins",
    "nyu": "NYU", "usc": "USC", "bu": "Boston University", "bc": "Boston College",
    "gwu": "George Washington", "gw": "George Washington",
    "lmu": "Loyola Marymount", "usf": "University of San Francisco",
    "vt": "Virginia Tech", "uva": "Virginia", "uw": "Washington",
    "utexas": "UT Austin", "ut austin": "UT Austin",
    "gatech": "Georgia Tech", "cmu": "Carnegie Mellon", "mit": "MIT",
    "csu fullerton": "Cal State Fullerton",
    "csu san marcos": "Cal State San Marcos",
    "csu bakersfield": "Cal State Bakersfield", "csub": "Cal State Bakersfield",
    "csu chico": "Chico State", "csuc": "Chico State",
    "uiuc": "Illinois", "illinois urbana champaign": "Illinois",
    "wustl": "WashU", "washington in st louis": "WashU",
    "william and mary": "William & Mary", "w m": "William & Mary",
    "rit": "Rochester Institute of Technology",
    "unr": "Nevada Reno", "nevada reno": "Nevada Reno",
    "umd": "Maryland", "uf": "Florida", "uga": "Georgia", "uw madison": "Wisconsin",
    "osu": "Ohio State", "psu": "Penn State", "asu": "Arizona State",
    "pitt": "Pittsburgh", "rutgers": "Rutgers", "purdue": "Purdue",
    "csumb": "Cal State Monterey Bay", "cal state monterey bay": "Cal State Monterey Bay",
    "csu sac": "Sacramento State", "csu sonoma": "Sonoma State",
    "uw seattle": "Washington", "u washington": "Washington",
    "texas a m university": "Texas A&M", "texas a m": "Texas A&M", "tamu": "Texas A&M",
    "minnesota": "Minnesota", "wisconsin madison": "Wisconsin",
}

STRIP = re.compile(r"\b(the|university|univ|college|of)\b", re.I)

def canon(raw):
    """Resolve a recorded school string to an app school name, or None.

    Every alias target is checked against the app's own school list: an alias
    pointing at a name the app does not have would otherwise leak a school
    that renders as a dead link and cannot be looked up.
    """
    s = (raw or "").strip()
    if not s:
        return None
    if s in CANON:
        return s
    k = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    k = re.sub(r"\s+", " ", k).strip()
    if k in ALIAS:
        return ALIAS[k] if ALIAS[k] in CANON else None
    for name in CANON:
        if name.lower() == k:
            return name
    # "CSU Long Beach" / "CSU Sac" style — the campus under its Cal State name.
    if k.startswith("csu "):
        for cand in (f"cal state {k[4:]}", f"{k[4:]} state"):
            if cand in ALIAS and ALIAS[cand] in CANON:
                return ALIAS[cand]
            for name in CANON:
                if name.lower() == cand:
                    return name
    bare = re.sub(r"\s+", " ", STRIP.sub(" ", k)).strip()
    if bare in ALIAS:
        return ALIAS[bare] if ALIAS[bare] in CANON else None
    for name in CANON:
        if re.sub(r"\s+", " ", STRIP.sub(" ", name.lower())).strip() == bare and bare:
            return name
    return None

# ── major families, for similarity matching (display keeps the real string) ─
FAMILY = [
    ("econ_biz", ("econ", "business", "finance", "account", "management", "marketing")),
    ("cs_eng", ("computer", "cs", "software", "engineer", "data science", "informat")),
    ("bio_health", ("bio", "nurs", "health", "pre-med", "premed", "kinesi", "neuro", "public health")),
    ("phys_math", ("math", "physic", "chem", "statistic", "astro")),
    ("social", ("psych", "sociol", "polit", "poli sci", "anthro", "internation", "communic", "criminal")),
    ("human_arts", ("english", "histor", "philos", "art", "music", "film", "media", "design", "literat", "language")),
    ("env_earth", ("environment", "geolog", "geograph", "ecolog", "marine", "agricult")),
    ("edu_other", ("educat", "social work", "architect", "urban")),
]

def family(major):
    m = (major or "").lower()
    for fam, kws in FAMILY:
        if any(k in m for k in kws):
            return fam
    return "other"

INST = {
    "community_college": "cc",
    "4yr_public": "public4",
    "4yr_private": "private4",
    "international": "intl",
}

def main():
    dead = sorted({v for v in ALIAS.values() if v not in CANON})
    if dead:
        print(f"NOTE: {len(dead)} alias target(s) are not schools the app measures — "
              f"records pointing at them are dropped, not renamed:")
        for v in dead:
            print(f"  · {v}")
        print()

    rows = []
    for f in SRC:
        with open(f) as fh:
            rows.extend(csv.DictReader(fh))

    def g(r, k):
        return (r.get(k) or "").strip()

    def gpa(r):
        try:
            v = float(g(r, "college_gpa"))
            return v if 1.0 <= v <= 4.5 else None
        except ValueError:
            return None

    by_auth = collections.defaultdict(list)
    for r in rows:
        a = g(r, "author_id")
        if a:
            by_auth[a].append(r)

    people = []
    unresolved = collections.Counter()
    for rs in by_auth.values():
        gp = [gpa(r) for r in rs if gpa(r) is not None]
        if not gp:
            continue
        gv = round(statistics.median(gp), 2)

        # Institution is recorded for only some posts. Where it is missing we
        # keep the person and mark it unknown — the matcher scores it as a
        # weaker match and the UI omits the line. We never infer it.
        insts = [INST[g(r, "current_institution_type")] for r in rs
                 if g(r, "current_institution_type") in INST]
        inst = collections.Counter(insts).most_common(1)[0][0] if insts else "unk"
        if inst == "intl":
            continue

        majors = [g(r, "intended_major") for r in rs if g(r, "intended_major")]
        if not majors:
            continue
        major = collections.Counter(majors).most_common(1)[0][0]
        if len(major) > 42:
            continue

        years = [int(g(r, "post_year")) for r in rs if g(r, "post_year").isdigit()]
        year = max(years) if years else None
        if not year:
            continue

        adm, den = set(), set()
        for r in rs:
            c = canon(g(r, "school_name"))
            if not c:
                if g(r, "school_name"):
                    unresolved[g(r, "school_name")] += 1
                continue
            d = g(r, "decision").lower()
            if d in ("accepted", "enrolled"):
                adm.add(c)
            elif d == "rejected":
                den.add(c)
        # A school recorded both ways for one person is ambiguous — drop it.
        den -= adm
        if not adm:
            continue

        people.append({
            "g": gv, "m": major, "i": inst, "y": year,
            "f": family(major),
            "a": sorted(adm), "d": sorted(den),
        })

    # School index table keeps the payload small.
    schools = sorted({s for p in people for s in p["a"] + p["d"]})
    idx = {s: i for i, s in enumerate(schools)}
    for p in people:
        p["a"] = [idx[s] for s in p["a"]]
        p["d"] = [idx[s] for s in p["d"]]

    people.sort(key=lambda p: (-len(p["a"]) - len(p["d"]), -p["y"]))

    out = {
        "meta": {
            "people": len(people),
            "records": sum(len(p["a"]) + len(p["d"]) for p in people),
            "schools": len(schools),
            "years": [min(p["y"] for p in people), max(p["y"] for p in people)],
            "note": "Real recorded transfer outcomes, grouped by pseudonymous author. "
                    "No names, no identifying detail, nothing generated.",
        },
        "schools": schools,
        "people": people,
    }
    dest = os.path.join(APP, "src/data/similar.json")
    with open(dest, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))

    print(f"people        : {len(people)}")
    print(f"outcome rows  : {out['meta']['records']}")
    print(f"schools       : {len(schools)}")
    print(f"years         : {out['meta']['years']}")
    print(f"file          : {dest} ({os.path.getsize(dest)/1024:.0f} KB)")
    print(f"inst mix      : {collections.Counter(p['i'] for p in people).most_common()}")
    print(f"family mix    : {collections.Counter(p['f'] for p in people).most_common()}")
    print(f"\nunresolved school strings (top 15):")
    for n, c in unresolved.most_common(15):
        print(f"  {c:4} {n}")

if __name__ == "__main__":
    main()
