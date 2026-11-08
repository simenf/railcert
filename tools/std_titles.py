#!/usr/bin/env python3
"""std_titles.py <nodes.tsv> <text_dir> <era_standards.xlsx> <out.tsv>
Builds standard -> title from (1) ERA 'Standards quoted in TSIs', (2) titles printed next to the
reference in the corpus (most frequent plausible candidate)."""
import csv, os, re, sys
from collections import Counter, defaultdict
import openpyxl

nodes_p, txt, xlsx, outp = sys.argv[1:5]

def key(s):
    s = s.upper().replace(" ", " ").replace("–", "-").replace("—", "-")
    s = re.sub(r"[:+].*$", "", s)                 # drop :2017, +A1
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^(NS |PR)", "", s)
    return s.replace(" ", "")

def clean(t):
    t = re.sub(r"[\u0022\u201c\u201d\u201e]", "", t)
    t = t.replace("\u00ad", "").replace(" -- ", " – ").replace("--", " – ")
    t = re.sub(r"\s+", " ", t).strip(" -–—:;,.|'")
    t = re.sub(r"\s+-(?=[A-Z])", " – ", t)
    t = re.sub(r"\s+[—-]\s+", " – ", t)
    t = re.sub(r"(?<=[a-z])–(?=[A-Z])", " – ", t)
    return t

nodes = [n for n in csv.DictReader(open(nodes_p, encoding="utf-8"), delimiter="\t")
         if n["type"] in ("Standard", "UIC leaflet", "ETSI spec")]
want = {key(n["label"]): n["label"] for n in nodes}

titles, source = {}, {}
wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
ws = wb["Standards quoted in TSI"]
for row in ws.iter_rows(min_row=3, values_only=True):
    if not row or not row[0] or not row[1]: continue
    k = key(str(row[0]))
    titles[k] = clean(str(row[1])); source[k] = "ERA list of standards quoted in TSIs"

# ---- corpus mining ----
REF = r"(?:(?:pr)?EN(?: IEC| ISO)?|IEC|ISO(?:/IEC)?|CLC/TS|CLC/TR|CEN/TS|CEN/TR|ETSI (?:TS|EN|TR)|UIC(?: Leaflet| Code| IRS)?|IRS)"
NUM = r"\d{2,6}(?: \d{3})?(?:-\d{1,3}){0,3}"
START = (r"(?:Railway applications|Railways?\b|Public transport|Electromagnetic|Safety of|Safety requirements|Fire|Acoustics|"
         r"Information technology|Conformity assessment|Functional safety|Quality management|Industrial|Degrees of protection|"
         r"Electric|General requirements|Plastics|Rolling bearings|Paints|Glass|Graphical symbols|Light|Ergonomic|Systems and software|"
         r"Explosive atmospheres|Environmental|Insulation|Low-voltage|Welding|Steel|Mechanical|Measurement|Road vehicles|Wheelset|"
         r"Brake|Braking|Testing|Test|Tests|Composite|Reaction to fire|Classification|Metallic|Cables?|Power|Determination|Specification|"
         r"Accessibility|Tactile|Vibration|Shock|Signall?ing|Communication|Telecommunication|Global System|Digital|Universal Mobile|"
         r"LTE|5G|Electrical|Protection|Fixed installations|Current collection|Pantograph|Overhead|Track|Ballast|Concrete|Wagons?|"
         r"Couplings?|Buffers?|Draw gear|Rail\b|Rails\b|Bogies?|Axle|Wheels?|Gauges?|Doors?|Windows?|Toilets?|Seats?|Lifts?|Escalators?|"
         r"Guidance|Data|Security|Cybersecurity|Process management|Risk management|Software|Programmable|Basic|Fundamental)")
PAT = re.compile(r"\b(" + REF + r") (" + NUM + r")(?::\d{4})?(?:\+A\d(?::\d{4})?)*(?:/AC(?::\d{4})?)?[\s\"'“”(),:;|–—-]{1,6}(" + START + r"[^\n]{8,240})")
cand = defaultdict(Counter)
for f in os.listdir(txt):
    t = open(os.path.join(txt, f), encoding="utf-8", errors="ignore").read()
    t = t.replace(" ", " ").replace("‑", "-")
    t = re.sub(r"[ \t]+", " ", t)
    # join hyphen/line wraps: allow title to continue to next line if next line starts lowercase or with dash
    t = re.sub(r"\n(?=[a-z–—-] ?)", " ", t)
    for m in PAT.finditer(t):
        k = key(f"{m.group(1)} {m.group(2)}")
        if k not in want or k in titles: continue
        ti = m.group(3)
        ti = re.split(r"(?<=[a-z\)])\. |  |\t| \(\d| \[| \bEN \d| \bIEC \d| \bISO \d|\s{2,}", ti)[0]
        ti = clean(ti)
        if len(ti.split()) < 3 or len(ti) > 220: continue
        cand[k][ti] += 1
for k, c in cand.items():
    # prefer most frequent; tie -> longer
    best = sorted(c.items(), key=lambda x: (-x[1], -len(x[0])))[0][0]
    titles[k] = best; source[k] = f"title as printed in citing documents ({c[best]}×)"

# ---- curated titles for widely used standards (edition-independent wording) ----
CUR = {
 "ISO/IEC 17020": "Conformity assessment – Requirements for the operation of various types of bodies performing inspection",
 "ISO/IEC 17065": "Conformity assessment – Requirements for bodies certifying products, processes and services",
 "ISO/IEC 17021": "Conformity assessment – Requirements for bodies providing audit and certification of management systems",
 "ISO/IEC 17021-1": "Conformity assessment – Requirements for bodies providing audit and certification of management systems – Part 1: Requirements",
 "ISO/IEC 17011": "Conformity assessment – Requirements for accreditation bodies accrediting conformity assessment bodies",
 "ISO/IEC 17025": "General requirements for the competence of testing and calibration laboratories",
 "ISO/IEC 17000": "Conformity assessment – Vocabulary and general principles",
 "ISO 19011": "Guidelines for auditing management systems",
 "ISO 9001": "Quality management systems – Requirements",
 "ISO 9000": "Quality management systems – Fundamentals and vocabulary",
 "ISO 45001": "Occupational health and safety management systems – Requirements with guidance for use",
 "ISO 14001": "Environmental management systems – Requirements with guidance for use",
 "ISO 55000": "Asset management – Vocabulary, overview and principles",
 "ISO 55001": "Asset management – Asset management system – Requirements",
 "ISO 31000": "Risk management – Guidelines",
 "ISO 3166": "Codes for the representation of names of countries and their subdivisions",
 "ISO 3166-1": "Codes for the representation of names of countries and their subdivisions – Part 1: Country code",
 "ISO 4217": "Codes for the representation of currencies",
 "ISO 639-1": "Codes for the representation of names of languages – Part 1: Alpha-2 code",
 "ISO 10646": "Information technology – Universal coded character set (UCS)",
 "ISO 8601": "Date and time – Representations for information interchange",
 "ISO 9712": "Non-destructive testing – Qualification and certification of NDT personnel",
 "ISO 3095": "Acoustics – Railway applications – Measurement of noise emitted by railbound vehicles",
 "ISO 3381": "Railway applications – Acoustics – Noise measurement inside railbound vehicles",
 "ISO 5658": "Reaction to fire tests – Spread of flame",
 "ISO 1716": "Reaction to fire tests for products – Determination of the gross heat of combustion (calorific value)",
 "IEC 61508": "Functional safety of electrical/electronic/programmable electronic safety-related systems",
 "IEC 62443": "Security for industrial automation and control systems",
 "IEC 62443-3-3": "Industrial communication networks – Network and system security – Part 3-3: System security requirements and security levels",
 "IEC 61375-1": "Electronic railway equipment – Train communication network (TCN) – Part 1: General architecture",
 "IEC 62625-1": "Electronic railway equipment – On board driving data recording system – Part 1: System specification",
 "IEC 62625-2": "Electronic railway equipment – On board driving data recording system – Part 2: Conformity testing",
 "IEC 60812": "Failure modes and effects analysis (FMEA and FMECA)",
 "IEC 61025": "Fault tree analysis (FTA)",
 "IEC 61158": "Industrial communication networks – Fieldbus specifications",
 "IEC 60529": "Degrees of protection provided by enclosures (IP Code)",
 "IEC 60309-2": "Plugs, socket-outlets and couplers for industrial purposes – Part 2: Dimensional interchangeability requirements for pin and contact-tube accessories",
 "IEC 61000-6-2": "Electromagnetic compatibility (EMC) – Part 6-2: Generic standards – Immunity standard for industrial environments",
 "EN 50126": "Railway applications – The specification and demonstration of reliability, availability, maintainability and safety (RAMS)",
 "EN 50126-2": "Railway applications – The specification and demonstration of reliability, availability, maintainability and safety (RAMS) – Part 2: Systems approach to safety",
 "EN 50128": "Railway applications – Communication, signalling and processing systems – Software for railway control and protection systems",
 "EN 50716": "Railway applications – Requirements for software development",
 "EN 50657": "Railway applications – Rolling stock applications – Software on board rolling stock",
 "EN 50121": "Railway applications – Electromagnetic compatibility",
 "EN 50121-1": "Railway applications – Electromagnetic compatibility – Part 1: General",
 "EN 50121-3-1": "Railway applications – Electromagnetic compatibility – Part 3-1: Rolling stock – Train and complete vehicle",
 "EN 50121-3-2": "Railway applications – Electromagnetic compatibility – Part 3-2: Rolling stock – Apparatus",
 "EN 50121-4": "Railway applications – Electromagnetic compatibility – Part 4: Emission and immunity of the signalling and telecommunications apparatus",
 "EN 50155": "Railway applications – Rolling stock – Electronic equipment",
 "EN 50160": "Voltage characteristics of electricity supplied by public electricity networks",
 "EN 45545": "Railway applications – Fire protection on railway vehicles",
 "EN 12663": "Railway applications – Structural requirements of railway vehicle bodies",
 "EN 13103": "Railway applications – Wheelsets and bogies – Axles – Design method",
 "EN 13104": "Railway applications – Wheelsets and bogies – Powered axles – Design method",
 "EN 13261": "Railway applications – Wheelsets and bogies – Axles – Product requirements",
 "EN 13272": "Railway applications – Electrical lighting for rolling stock in public transport systems",
 "EN 13306": "Maintenance – Maintenance terminology",
 "EN 13848": "Railway applications – Track – Track geometry quality",
 "EN 14033-1": "Railway applications – Track – Railbound construction and maintenance machines – Part 1: Technical requirements for running",
 "EN 15273": "Railway applications – Gauges",
 "EN 15827": "Railway applications – Requirements for bogies and running gears",
 "EN 15380": "Railway applications – Classification system for railway vehicles",
 "EN 15437": "Railway applications – Axlebox condition monitoring",
 "EN 50124-2": "Railway applications – Insulation coordination – Part 2: Overvoltages and related protection",
 "EN 50206": "Railway applications – Rolling stock – Pantographs: Characteristics and tests",
 "EN 50215": "Railway applications – Rolling stock – Testing of rolling stock on completion of construction and before entry into service",
 "EN 50701": "Railway applications – Cybersecurity",
 "CLC/TS 50701": "Railway applications – Cybersecurity",
 "ETSI EN 301 549": "Accessibility requirements for ICT products and services",
 "ETSI EN 300 330": "Short Range Devices (SRD) – Radio equipment in the frequency range 9 kHz to 25 MHz and inductive loop systems in the frequency range 9 kHz to 30 MHz",
}
for lab, ti in CUR.items():
    k = key(lab)
    if not source.get(k, "").startswith("ERA"):
        titles[k] = ti; source[k] = "curated title (check edition)"

# ---- equivalences: EN ISO x == ISO x, EN IEC/EN 6xxxx == IEC 6xxxx ----
def family(k):
    m = re.match(r"^(?:EN|ENISO|ENIEC|ISO|IEC|ISO/IEC)(\d.*)$", k)
    return m.group(1) if m else None
byfam = {}
for k, ti in list(titles.items()):
    f_ = family(k)
    if f_ and ti: byfam.setdefault(f_, (k, ti))
for k in want:
    if k in titles: continue
    f_ = family(k)
    if f_ and f_ in byfam:
        titles[k] = byfam[f_][1]; source[k] = f"same standard as {byfam[f_][0]}"
# ---- series inheritance: EN 13103 <- EN 13103-1 (strip the part title) ----
for k in want:
    if k in titles: continue
    parts = [(kk, tt) for kk, tt in titles.items() if kk.startswith(k + "-") and tt]
    if parts:
        kk, tt = sorted(parts)[0]
        series = re.split(r" [–-] Part \d", tt)[0]
        titles[k] = series; source[k] = f"series title (from {kk})"

# ---- ETSI specs in the library: title from the cover page ----
import subprocess
LIB = os.path.join(os.path.dirname(xlsx), "..", "..")
for n in nodes:
    if n["type"] != "ETSI spec" or not n["in_library"]: continue
    f = os.path.join(LIB, n["in_library"].split(";")[0])
    if not f.endswith(".pdf") or not os.path.exists(f): continue
    t = subprocess.run(["pdftotext", "-l", "1", "-q", f, "-"], capture_output=True).stdout.decode("utf-8", "ignore")
    lines = [l.strip() for l in t.splitlines()]
    try: i = next(i for i, l in enumerate(lines) if re.match(r"ETSI (TS|EN|TR|ES) \d", l) and " V" in l)
    except StopIteration: continue
    tl = []
    for l in lines[i + 1:]:
        if not l:
            if tl: break
            continue
        if re.match(r"^(Technical Specification|European Standard|Harmoni[sz]ed European Standard|Technical Report|Final draft|Draft)\b", l, re.I):
            if tl: break
            continue
        tl.append(l)
    if tl:
        k = key(n["label"]); titles[k] = clean(" ".join(tl)); source[k] = "ETSI cover page (library copy)"

with open(outp, "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, delimiter="\t", lineterminator="\n"); w.writerow(["label", "title", "title_source"])
    n = 0
    for k, lab in sorted(want.items(), key=lambda x: x[1]):
        if k in titles: n += 1
        w.writerow([lab, titles.get(k, ""), source.get(k, "")])
print(f"titled {n} of {len(want)} (ERA list: {sum(1 for k in want if source.get(k,'').startswith('ERA'))})")
