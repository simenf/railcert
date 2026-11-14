#!/usr/bin/env python3
"""extract_refs.py <library_root> <catalogue.tsv> <out_dir>
Extracts cross-references from every PDF/HTML in the library and writes:
  edges.tsv   source_file -> target_id (with counts and version strings seen)
  nodes.tsv   every target id with type, label, CELEX / file in library
"""
import csv, os, re, sys, subprocess, json, html
from collections import defaultdict, Counter

root, catpath, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
txtdir = os.path.join(out, "_text"); os.makedirs(txtdir, exist_ok=True)

cat = list(csv.DictReader(open(catpath, encoding="utf-8"), delimiter="\t"))
by_path = {os.path.join(r["folder"], r["filename"]): r for r in cat}

# ---------- text extraction ----------
def docx_text(data):
    import zipfile, io
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            x = z.read("word/document.xml").decode("utf-8", "ignore")
        return html.unescape(re.sub(r"<[^>]+>", " ", re.sub(r"</w:p>", "\n", x)))
    except Exception:
        return ""
def text_of(rel):
    p = os.path.join(root, rel)
    t = os.path.join(txtdir, rel.replace("/", "__") + ".txt")
    if os.path.exists(t) and os.path.getmtime(t) >= os.path.getmtime(p):
        return open(t, encoding="utf-8", errors="ignore").read()
    s = ""
    if rel.lower().endswith(".pdf"):
        r = subprocess.run(["pdftotext", "-q", "-enc", "UTF-8", p, "-"], capture_output=True, timeout=300)
        s = r.stdout.decode("utf-8", "ignore")
    elif rel.lower().endswith(".docx"):
        s = docx_text(open(p, "rb").read())
    elif rel.lower().endswith(".zip"):
        import zipfile, tempfile
        parts = []
        try:
            with zipfile.ZipFile(p) as z:
                for zi in z.infolist():
                    nm = zi.filename.lower()
                    if zi.file_size > 80_000_000: continue
                    if nm.endswith(".pdf"):
                        with tempfile.NamedTemporaryFile(suffix=".pdf") as tf:
                            tf.write(z.read(zi)); tf.flush()
                            r = subprocess.run(["pdftotext", "-q", "-enc", "UTF-8", tf.name, "-"], capture_output=True, timeout=300)
                            parts.append(r.stdout.decode("utf-8", "ignore"))
                    elif nm.endswith(".docx"):
                        parts.append(docx_text(z.read(zi)))
        except Exception as e:
            print("zip", rel, e, file=sys.stderr)
        s = "\n".join(parts)
    elif rel.lower().endswith((".html", ".htm")):
        raw = open(p, encoding="utf-8", errors="ignore").read()
        raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
        # Lovdata cross-references are hyperlinks: keep them as FOR-/LOV- ids
        body = re.search(r"(?is)<div[^>]+class=\"[^\"]*documentBody[^\"]*\".*", raw)
        scope = body.group(0) if body else raw
        ids = {("FOR-" if k == "forskrift" else "LOV-") + d for k, d in re.findall(r'(?:data-id="|href="/(?:dokument/(?:SF|NL)/)?)(forskrift|lov)/(\d{4}-\d{2}-\d{2}(?:-\d+)?)(?=["/#?])', scope)}
        raw += " " + " ".join(sorted(ids))
        s = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    open(t, "w", encoding="utf-8").write(s)
    return s

# ---------- patterns ----------
NBSP = " "
ACT = re.compile(
    r"\b(?P<kind>(?:Implementing\s+|Delegated\s+|Commission\s+|Council\s+|Framework\s+)*(?:Regulation|Directive|Decision|Recommendation)s?|Reg\.(?=\s*\(E)"
    r"|(?:gjennomførings|kommisjons|delegert\s+|råds|europaparlaments-\s+og\s+råds|EU-?|jernbanesikkerhets|interoperabilitets)?forordning(?:en|ene|er)?"
    r"|(?:råds|europaparlaments-\s+og\s+råds|jernbanesikkerhets|interoperabilitets|EU-?)?direktiv(?:et|ene)?"
    r"|(?:kommisjons|gjennomførings|råds|europaparlaments-\s+og\s+råds)?beslutning(?:en|ene)?|(?:kommisjons)?vedtak(?:et)?(?=\s+(?:nr\.?\s*)?\d{2,4}/\d{1,4}/E[FU])|(?:kommisjons)?anbefaling(?:en)?)"
    r"[\s" + NBSP + r"]*(?:\((?:EU|EC|EEC|EF|EØF|Euratom|ECSC|EKSF)(?:\s*[,/]\s*(?:EU|EC|EEC|Euratom|ECSC))*\)[\s" + NBSP + r"]*)?(?P<no>(?:Nos?|nr)\.?[\s" + NBSP + r"]*)?"
    r"(?P<a>\d{1,4})/(?P<b>\d{1,4})(?:/(?P<sfx>EU|EC|EEC|EF|EØF|ECSC|EKSF|JHA|JIS|CFSP|Euratom))?\b(?!/\d)", re.I)
# continuation of a list after an act: "..., 1300/2014 and 1301/2014"
ACT_MORE = re.compile(r"[ \t]*\n?[ \t]*(?:,|;|\band\b|\bog\b|\bor\b|\beller\b|&)[ \t]*\n?[ \t]*(?:\((?:EU|EC|EEC|EF|EØF)\)\s*)?(?:(?:No|nr)\.?\s*)?(\d{1,4})/(\d{1,4})(?:/(EU|EC|EEC|EF|EØF|ECSC|JHA|Euratom|CFSP))?\b(?!/\d)", re.I)
# non-EU bodies whose decisions look like EU acts: EEA Joint Committee, EU–Switzerland Inland Transport Committee ...
NONEU_AFTER = re.compile(r"\A[^\n]{0,20}?\s*of\s+the\s+(?:Community/Switzerland|EU-Switzerland|EU/Switzerland|Joint\s+Committee|EEA\s+Joint|Inland\s+Transport|Land\s+Transport|[A-Z][a-z]+\s+Committee|Management\s+Board|Administrative\s+Board|Executive\s+Director|ECB)", re.S)
NONEU_BEFORE = re.compile(r"(?:EØS-komiteens|EEA\s+Joint\s+Committee|Joint\s+Committee|ITC|Management\s+Board|EØS-komiteen)\s*\Z", re.I)
ITC_CH = {"1/2013": "22013D0804", "2/2019": "22020D0040", "1/2020": "22020D0896", "2/2020": "22021D0035", "3/2020": "22021D0036",
          "1/2021": "22021D1171", "2/2021": "22022D0308", "1/2022": "22023D0143", "1/2023": "22024D1182", "1/2024": "22025D0717", "1/2025": "22026D0566"}
# other instruments cited by name that are in the library
NAMED_EU = [(re.compile(r"\bUN(?:/ECE|ECE)?\s+Regulation\s+No\.?\s*155\b"), "EU:42021X0387", "UN Regulation No 155"),
            (re.compile(r"Interinstitutional\s+Agreement\s+of\s+13\s+April\s+2016\s+on\s+Better\s+Law-?\s*Making", re.I), "EU:32016Q0512", "Interinstitutional Agreement on Better Law-Making (2016)")]
STD = re.compile(
    r"\b(?P<org>(?:pr)?EN(?:[\s" + NBSP + r"]+(?:IEC|ISO))?|IEC|ISO(?:/IEC)?|CLC/TS|CLC/TR|CEN/TS|CEN/TR|CEN/CLC/TS|ETSI[\s" + NBSP + r"]+(?:TS|EN|TR|ES)|UIC(?:[\s" + NBSP + r"]+(?:[Ll]eaflet|Code|IRS))?|IRS(?:[\s" + NBSP + r"]+UIC)?|NS[\s" + NBSP + r"]+EN|CENELEC)"
    r"[ " + NBSP + r"]*\n?(?P<num>\d{2,6}(?:[ " + NBSP + r"]\d{3}(?!\d))?(?:-\d{1,3}(?!\d)){0,3})(?!\d)(?::(?P<yr>(?:19|20)\d{2}))?(?:\+A(?P<amd>\d)(?::\d{4})?)?")
SUBSET = re.compile(r"\bSUBSET[-_\s" + NBSP + r"–]{0,3}(\d{3})((?:-\d{1,2}){0,2})(?!\d)", re.I)
SS_ABBR = re.compile(r"\b[Ss][Ss][-_ ]?(\d{3})((?:-\d{1,2}){0,2})(?![\d.])")      # SS-026, SS026 (ERTMS documents only)
ETSI_BARE = re.compile(r"(?<![/\w])(TS|TR|ES)[ " + NBSP + r"]+(1\d{2})[ " + NBSP + r"](\d{3})((?:-\d{1,2}){0,2})(?!\d)")
GPP = re.compile(r"\b(?:3GPP|3G)?\s*(TS|TR)[ " + NBSP + r"]+(\d{2})\.(\d{3})((?:-\d{1,2}){0,2})(?![\d.])")
MORANE = re.compile(r"\b([AEFP])\s?(\d{2})\s?T\s?(\d{4})\b")
ATC2_LABELS = {"ESRS": "SS:SUBSET-026", "ESTM": "SS:SUBSET-035", "ESTMA": "SS:SUBSET-058", "ESTMT": "SS:SUBSET-056", "ESTML": "SS:SUBSET-057",
               "ESTMP": "SS:SUBSET-059", "ETI": "SS:SUBSET-034", "EMMI": "SS:SUBSET-033", "ERADMI": "ERA:ERA/ERTMS/015560"}
ATC2_LAB = re.compile(r"\[(" + "|".join(ATC2_LABELS) + r")\]")
ERTMS_DOC_IDS = [(re.compile(r"(?<![\w/.-])(\d{2}E\d{3})(?![\w])"), lambda m: "ERA:" + m.group(1)),                     # EUG/ERA notes: 13E154, 21E089
                 (re.compile(r"\b(FFFIS|FU|FIS|TOBA|AT)-(7\d{3})\b"), lambda m: f"ERA:FRMCS-{m.group(1)}-{m.group(2)}"),          # FRMCS
                 (re.compile(r"(?<![\w-])O-(2475|2875|3001)(?:-(\d))?\b"), lambda m: "ERA:O-" + m.group(1) + (f"-{m.group(2)}" if m.group(2) else "")),
                 (re.compile(r"\b(?:TD/)?011REC1028\b"), lambda m: "ERA:TD/011REC1028")]
ERA120X = re.compile(r"\bERA[\s_-]?120([89])[/_ -](\d{2,3})(?!\d)")
ERADOC = re.compile(r"\b(ERA(?:/ERTMS|/GUI|/TD|/REC|/OPI|/REP|/PRG|/INT|/TMP|/ADV)?[/_-][A-Z0-9_./-]{3,20}\d|ERA1209/\d{3}|ERA-PRG-\d{3}|ERA-TD-\d{4}-\d+)", re.I)
EIRENE = re.compile(r"\bEIRENE\s+(FRS|SRS|Functional\s+Requirements?\s+Specification|System\s+Requirements?\s+Specification)", re.I)
NOR = re.compile(r"\b(FOR-\d{4}-\d{2}-\d{2}-\d{1,5}|LOV-\d{4}-\d{2}-\d{2}(?:-\d{1,5})?)\b(?!-)")   # only old laws lack a serial number
MND = {m: i+1 for i, m in enumerate(["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"])}
NOR2 = re.compile(r"\b(forskrift|lov)\s+(\d{1,2})\.\s*(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\s+(\d{4})\s+nr\.?\s*(\d{1,5})", re.I)

# TSIs cited by name resolve to the TSI regulation currently in force
TSI_NAME = re.compile(r"\b(CCS|ENE|INF|LOC\s*&\s*PAS|WAG|NOI|OPE|PRM|SRT|TAF|TAP)\s+TSI\b|\bTSI(?:\s+for)?\s+(CCS|ENE|INF|LOC\s*&\s*PAS|WAG|NOI|OPE|PRM|SRT|TAF|TAP)\b|\bTSI[\s-]+(CCS|ENE|INF|LOC\s*&\s*PAS|WAG|NOI|OPE|PRM|SRT|TAF|TAP)-forskrift"
                      r"|\b(?P<long>(?:Freight\s+)?Wagons?|Infrastructure|Energy|Noise|(?:Safety\s+in\s+Railway\s+)?Tunnels|Operation\s+and\s+Traffic\s+Management|Control[- ]Command\s+and\s+Signalling|Locomotives\s+and\s+Passenger\s+Rolling\s+Stock|Persons\s+with\s+Reduced\s+Mobility)\s+TSI\b", re.I)
TSI_LONG = {"wagon": "WAG", "freight": "WAG", "infrastructure": "INF", "energy": "ENE", "noise": "NOI", "tunnels": "SRT", "safety": "SRT",
            "operation": "OPE", "control": "CCS", "locomotives": "LOC&PAS", "persons": "PRM"}
TSI_HIST = {  # (from year, CELEX) – the TSI regulation/decision in force for documents of that year
    "CCS": [(2012, "32012D0088"), (2016, "32016R0919"), (2023, "32023R1695")],
    "LOC&PAS": [(2011, "32011D0291"), (2014, "32014R1302")], "WAG": [(2006, "32006D0861"), (2013, "32013R0321")],
    "INF": [(2011, "32011D0275"), (2014, "32014R1299")], "ENE": [(2011, "32011D0274"), (2014, "32014R1301")],
    "NOI": [(2011, "32011D0229"), (2014, "32014R1304")], "OPE": [(2011, "32011D0314"), (2013, "32012D0757"), (2019, "32019R0773")],
    "PRM": [(2008, "32008D0164"), (2014, "32014R1300")], "SRT": [(2008, "32008D0163"), (2014, "32014R1303")],
    "TAF": [(2006, "32006R0062"), (2014, "32014R1305"), (2026, "32026R0253")], "TAP": [(2011, "32011R0454"), (2026, "32026R0253")]}
def tsi_for(key, year):
    h = TSI_HIST.get(key, [])
    if not year: return h[-1][1] if h else None
    ok = [c for y, c in h if y <= year]
    return ok[-1] if ok else None
TSI_CELEX = {"CCS": "32023R1695", "ENE": "32014R1301", "INF": "32014R1299", "LOC&PAS": "32014R1302", "WAG": "32013R0321",
             "NOI": "32014R1304", "OPE": "32019R0773", "PRM": "32014R1300", "SRT": "32014R1303", "TAF": "32014R1305", "TAP": "32011R0454"}
# Norwegian laws and regulations cited by their short name
NOR_IDS = {"jernbaneloven": "LOV-1993-06-11-100", "samtrafikkforskriften": "FOR-2021-09-09-2742",
           "sikkerhetsforskriften": "FOR-2021-09-08-2740", "tillatelsesforskriften": "FOR-2010-12-10-1569",
           "jernbaneforskriften": "FOR-2021-06-30-2315", "sikringsforskriften": "FOR-2022-01-19-100",
           "førerforskriften": "FOR-2009-11-27-1414", "jernbaneundersøkelsesloven": "LOV-2005-06-03-34",
           "jernbaneundersøkelsesforskriften": "FOR-2006-03-31-378", "sidesporforskriften": "FOR-2014-12-10-1573",
           "museumsbaneforskriften": "FOR-2014-12-10-1574", "jernbaneinfrastrukturforskriften": "FOR-2011-04-11-388",
           "arbeidsmaskinforskriften": "FOR-2022-05-25-924", "kravforskriften": "FOR-2014-12-10-1572",
           "varslings- og rapporteringsforskriften": "FOR-2006-03-31-379", "sikkerhetsstyringsforskriften": "FOR-2011-04-11-389",
           "csm sms-forskriften": "FOR-2021-09-08-2703", "csm ra-forskriften": "FOR-2014-10-27-1344", "tsi ccs-forskriften": "FOR-2025-03-14-450",
           "tsi ope-forskriften": "FOR-2021-09-08-2714", "tsi-opeforskriften": "FOR-2021-09-08-2714", "tsi loc&pas-forskriften": "FOR-2015-07-23-913",
           "tsi loc & pas-forskriften": "FOR-2015-07-23-913", "togframføringsforskriften": "FOR-2008-02-29-240"}
NOR_NAME = re.compile(r"\b(" + "|".join(sorted(map(re.escape, NOR_IDS), key=len, reverse=True)) + r")(?:s|en)?\b", re.I)

KIND = {"framework decision": "F", "recommendation": "H", "anbefaling": "H", "regulation": "R", "directive": "L", "decision": "D",
        "forordning": "R", "direktiv": "L", "beslutning": "D", "kommisjonsvedtak": "D"}
LABEL = {"R": "Regulation", "L": "Directive", "D": "Decision", "H": "Recommendation", "F": "Framework Decision"}

def act_key(kind, a, b, sfx=None, no=False):
    k = kind.lower()
    if k.startswith("reg."): k = "regulation"
    letter = next((v for w, v in KIND.items() if w in k), None)
    if not letter: return None
    sa, sb = a, b
    a, b = int(a), int(b); old = False
    # pre-1999 acts use two-digit years: Directive 96/48/EC (year/num), Regulation (EEC) No 1191/69 and
    # Decision No 1692/96/EC (num/year); "01/16/EC" is 2001
    if len(sb) == 2 and (58 <= b <= 98) and len(sa) >= 3 and (not (1957 <= a <= 2030) or a > 2026 or no):
        b = 1900 + b; old = True
    elif len(sa) == 2 and letter in ("L", "D", "H") and (sfx or letter == "L") and not (1957 <= b <= 2030) and len(sb) <= 4:
        a = 1900 + a if a >= 58 else (2000 + a if a <= 14 and sfx else a)
    ya, yb = 1957 <= a <= 2030, 1957 <= b <= 2030
    if old:
        year, num = b, a
    elif ya and yb:
        # both look like years: "No number/year" (No 1986/2006, Decision No 1982/2006/EC) before 2015;
        # since 2015 every act is "year/number" (2018/1999); directives and decisions otherwise year/number
        year, num = (b, a) if (no and a < 2015 and b < 2015) or (letter == "R" and a < 2015) or a > 2026 else (a, b)
    elif ya:
        year, num = a, b
    elif yb:
        year, num = b, a
    else:
        return None
    if num == 0 or num > 9999: return None
    # Old-style directives/decisions are year/num; old regulations num/year: handled above.
    celex = f"3{year}{letter}{num:04d}"
    if letter == "R" and year < 2015:
        return celex, f"Regulation (EU/EC) No {num}/{year}"
    if letter in "HF":
        return celex, f"{LABEL[letter]} {year}/{num}"
    if old:
        return celex, f"{LABEL[letter]} No {num}/{str(year)[2:]}/EC"
    suffix = "" if letter == "R" else ("/EU" if year >= 2010 else "/EC")
    return celex, f"{LABEL[letter]} {year}/{num}{suffix}"

def norm_std(org, num):
    org = re.sub(r"\s+", " ", org.replace(NBSP, " ")).strip()
    org = re.sub(r"^NS EN", "EN", org)
    org = re.sub(r"^prEN", "EN", org)
    num = num.replace(NBSP, " ")
    if re.match(r"^\d{3} \d{3}$", num): num = num.replace(" ", " ")  # ETSI style '102 281'
    else: num = num.replace(" ", "")
    if "IRS" in org: org = "IRS"
    elif org.startswith("UIC"): org = "UIC"
    if org == "CENELEC": org = "EN"
    if org in ("ISO", "ISO/IEC", "EN ISO") and re.match(r"^170\d{2}", num): org = "ISO/IEC"   # conformity-assessment series
    if org == "EN ISO" and re.match(r"^/?IEC", num): org = "ISO/IEC"
    m6 = re.match(r"^(\d{3}) ?(\d{3})((?:-\d+)*)$", num)
    if (org in ("EN", "ETSI EN") and m6 and num.startswith(("30", "31"))) or org.startswith("ETSI"):
        if m6:
            kind = org.split()[-1] if org.startswith("ETSI") else "EN"
            return f"ETSI {kind} {m6.group(1)} {m6.group(2)}{m6.group(3)}"
    return f"{org} {num}"

CELEX_RE = re.compile(r"CELEX[:%3A]+([0-9]{5}[A-Z][0-9]{4})(?!R\()|/NLX3/(3\d{4}[rld]\d{4})\.pdf")
self_celex = {}
SELF_ALT = {}   # consolidated texts (CELEX 0YYYY...) count as the act itself
for rel, r in by_path.items():
    m = CELEX_RE.search(r["url"])
    if m:
        c = (m.group(1) or m.group(2)).upper()
        if m.group(2): SELF_ALT[rel] = c; continue   # a translation (Lovdata) cites the act as itself, but is not a copy of it
        self_celex[rel] = c
        if c[0] == "0": SELF_ALT[rel] = "3" + c[1:]
celex_to_files = defaultdict(list)
for rel, c in self_celex.items(): celex_to_files[c].append(rel)

SET_YEAR = {"Set1_ETCS_B2": 2012, "Set2_ETCS_B3_MR1": 2015, "Set3_ETCS_B3_R2": 2019, "Set4_ETCS_B4_R1_current": None}

def doc_year(rel):
    """Year of the citing document: its own CELEX, else a 4-digit year in the catalogue date/file name (None = current)."""
    c = self_celex.get(rel)
    if c: return int(c[1:5])
    for k, y in SET_YEAR.items():
        if "/" + k + "/" in rel: return y
    r = by_path.get(rel, {})
    m = re.search(r"\b(19[5-9]\d|20[0-3]\d)\b", r.get("date_or_status", "")) or re.search(r"(?:^|[_-])(19[5-9]\d|20[0-3]\d)(?:[_-]|$)", os.path.basename(rel))
    return int(m.group(1)) if m else None

def subset_files():
    d = defaultdict(list)
    for rel in by_path:
        m = re.search(r"SUBSET[-_]?(\d{3})((?:[-_]\d{1,2}(?![\d.]))*)", os.path.basename(rel), re.I)
        if m:
            parts = [x for x in re.split(r"[-_]", m.group(2)) if x]
            for i in range(len(parts) + 1):
                d["-".join([f"SUBSET-{m.group(1)}"] + parts[:i])].append(rel)
        m = re.search(r"EIRENE[_ -](FRS|SRS)", rel, re.I)
        if m: d[f"EIRENE-{m.group(1).upper()}"].append(rel)
    return d
sub_files = subset_files()
era_files = defaultdict(list)
for rel in by_path:
    if rel.startswith("06_ERA_Guides/"): continue          # a guide *about* a spec is not the spec
    m = re.search(r"ERA[_-]ERTMS[_-]0*(\d{4,6})", os.path.basename(rel), re.I)
    if m: era_files[f"ERA:ERA/ERTMS/{int(m.group(1)):06d}"].append(rel)
    m = re.search(r"ERA[_-]?120([89])[-_](\d{2,3})(?!\d)", os.path.basename(rel), re.I)
    if m: era_files[f"ERA:ERA120{m.group(1)}/{int(m.group(2)):03d}"].append(rel)
    m = re.search(r"(?<![A-Za-z0-9])([AEFP]\d{2}T\d{4})", os.path.basename(rel), re.I)
    if m: era_files["ERA:MORANE-" + m.group(1).upper()].append(rel)
    bn = os.path.basename(rel)
    for rx_, fmt_ in ((r"(?<![A-Za-z0-9])(\d{2}[eE]\d{3})(?![\d])", lambda m: "ERA:" + m.group(1).upper()),
                      (r"\((FFFIS|FU|FIS|TOBA|AT)-(7\d{3})\)", lambda m: f"ERA:FRMCS-{m.group(1)}-{m.group(2)}"),
                      (r"(?<![A-Za-z0-9])[oO]-(\d{4})(?:-(\d))?(?![\d])", lambda m: "ERA:O-" + m.group(1) + (f"-{m.group(2)}" if m.group(2) else "")),
                      (r"ATO_Glossary", lambda m: "ERA:13E154"), (r"ESC-RSC_Technical_Document", lambda m: "ERA:TD/011REC1028")):
        m = re.search(rx_, bn)
        if m and rel.startswith("07_"): era_files[fmt_(m)].append(rel)
    if "/07_ERTMS_Specifications/" in "/" + rel or rel.startswith("09_Referenced_Documents/ETSI/"):
        m = re.search(r"(?:^|[_\-\d])(en|ts|tr)[_ ]?(\d{3})[_ ]?(\d{3})((?:-\d{1,2})*)", os.path.basename(rel), re.I)
        if m: era_files[f"STD:ETSI {m.group(1).upper()} {m.group(2)} {m.group(3)}{m.group(4)}"].append(rel)
        m = re.search(r"cenelec_en_?(\d{5})", os.path.basename(rel), re.I)
        if m: era_files[f"STD:EN {m.group(1)}"].append(rel)
alias = defaultdict(set)
for rel, r in by_path.items():
    for mid in (r.get("matched_ids") or "").split(";"):
        mid = mid.strip()
        if not mid: continue
        if ":" in mid.split("/")[0] and mid.split(":")[0] in ("STD", "SS", "ERA", "EU", "NO"):
            alias[mid].add(rel)
            if mid.startswith("STD:"):
                mm = re.match(r"STD:((?:ETSI\s+)?(?:EN|TS|TR|ES)|[A-Z/ ]+?)\s+(\d[\d -]*)$", mid)
                if mm: alias["STD:" + norm_std(mm.group(1), mm.group(2).strip())].add(rel)
        else:
            alias["SS:" + mid].add(rel); alias["ERA:" + mid.upper()].add(rel)
    for m in re.finditer(r"((?:FOR|LOV)-\d{4}-\d{2}-\d{2}(?:-\d{1,5})?)", rel + " " + r.get("reference", "") + " " + r.get("url", "")):
        alias["NO:" + m.group(1)].add(rel)
    for m in re.finditer(r"/(forskrift|lov)/(\d{4}-\d{2}-\d{2}(?:-\d{1,5})?)", r.get("url", "")):
        alias["NO:" + ("FOR-" if m.group(1) == "forskrift" else "LOV-") + m.group(2)].add(rel)

edges = defaultdict(lambda: {"count": 0, "versions": Counter()})
nodes = {}

files = []
for dp, dn, fn in os.walk(root):
    dn[:] = [x for x in dn if not x.startswith(("_", ".")) and x not in ("99_Reference_Map", "tools")]
    for f in fn:
        if f.lower().endswith((".pdf", ".html", ".htm", ".zip", ".docx")) and not f.endswith(".notpdf.html"):
            files.append(os.path.relpath(os.path.join(dp, f), root))
files.sort()

for i, rel in enumerate(files):
    try: t = text_of(rel)
    except Exception as e:
        print("ERR", rel, e, file=sys.stderr); continue
    t = t.replace("‑", "-").replace("‐", "-").replace("–", "-")
    t = re.sub(r"\u00ad[ \t]*\n[ \t]*", "", t).replace("\u00ad", "")   # words split by a soft hyphen at a line end
    t = re.sub(r"(?<=\d)/[ \t]*\n[ \t]*(?=\d)", "/", t)                    # act numbers split after the slash
    t = re.sub(r"\b(Regu|Direc|Deci|Recom|Recommen|Imple|Imple-men|Dele)-\s*\n\s*(lation|tive|sion|mendation|dation|menting|ting|gated)", r"\1\2", t)
    me = SELF_ALT.get(rel) or self_celex.get(rel)
    src_year = doc_year(rel)
    def add_act(kind, a, b, sfx, no=False):
        k = act_key(kind, a, b, sfx, no)
        if not k: return
        celex, label = k
        if celex == me: return
        nid = "EU:" + celex
        nodes.setdefault(nid, {"type": "EU act", "label": label, "celex": celex})
        edges[(rel, nid)]["count"] += 1
    for m in ACT.finditer(t):
        no = bool(m.group("no"))
        # decisions of non-EU bodies (EEA Joint Committee, EU-Switzerland committee, ERA boards) are not EU acts
        kl = m.group("kind").lower()
        if "decision" in kl or "beslutning" in kl or "vedtak" in kl:
            after, before = t[m.end():m.end() + 160], t[max(0, m.start() - 40):m.start()]
            small = int(m.group("a")) < 10 and not m.group("sfx")
            if NONEU_BEFORE.search(before) or NONEU_AFTER.search(after) or (small and no):
                ch = re.search(r"Switzerland|Swiss|Sveits|\bITC\b", after + t[max(0, m.start() - 300):m.start()], re.I)
                keys, pos = [f"{int(m.group('a'))}/{m.group('b')}"], m.end()
                for _ in range(10):                         # "Decisions No 1/2020, 2/2020, 2/2021"
                    mm = ACT_MORE.match(t, pos)
                    if not mm: break
                    keys.append(f"{int(mm.group(1))}/{mm.group(2)}"); pos = mm.end()
                for key in keys:
                    if key in ITC_CH and ch:
                        nid = "EU:" + ITC_CH[key]
                        nodes.setdefault(nid, {"type": "EU act", "label": f"EU–Switzerland Inland Transport Committee Decision No {key}", "celex": ITC_CH[key]})
                        edges[(rel, nid)]["count"] += 1
                continue
        add_act(m.group("kind"), m.group("a"), m.group("b"), m.group("sfx"), no)
        pos = m.end()
        for _ in range(30):
            mm = ACT_MORE.match(t, pos)
            if not mm: break
            add_act(m.group("kind"), mm.group(1), mm.group(2), mm.group(3) or m.group("sfx"), no)
            pos = mm.end()
    for rx, nid, lab in NAMED_EU:
        if rx.search(t) and nid[3:] != me:
            nodes.setdefault(nid, {"type": "EU act", "label": lab, "celex": nid[3:]})
            edges[(rel, nid)]["count"] += len(rx.findall(t))
    for m in TSI_NAME.finditer(t):
        if m.group("long"):
            w = m.group("long").split()[0].lower()
            key = next(v for k_, v in TSI_LONG.items() if w.startswith(k_))
        else:
            key = re.sub(r"\s+", "", (m.group(1) or m.group(2) or m.group(3)).upper())
        celex = tsi_for(key, src_year)
        if not celex or celex == me: continue
        nid = "EU:" + celex
        nodes.setdefault(nid, {"type": "EU act", "label": act_key("Regulation", celex[1:5], celex[6:].lstrip("0") or "0")[1], "celex": celex})
        edges[(rel, nid)]["count"] += 1
    for m in NOR_NAME.finditer(t):
        # "forskrift 16. juni 2010 nr. 820 (samtrafikkforskriften)": the name belongs to the dated (often repealed) act
        if re.search(r"nr\.?\s*\d+\s*\(\s*$", t[max(0, m.start() - 25):m.start()]): continue
        fid = NOR_IDS[re.sub(r"\s+", " ", m.group(1).lower())]
        if rel in alias.get("NO:" + fid, ()): continue
        nid = "NO:" + fid
        nodes.setdefault(nid, {"type": "Norwegian law/regulation", "label": fid})
        edges[(rel, nid)]["count"] += 1
    for m in STD.finditer(t):
        org, num = m.group("org"), m.group("num")
        if org.upper().startswith("EN") and len(num.replace("-", "")) < 4: continue  # EN 1 etc noise
        if re.match(r"^(19|20)\d{2}$", num) and not org.startswith(("ISO", "IEC", "EN")): continue
        sid = norm_std(org, num)
        base = sid.split()[0]
        typ = {"ETSI": "ETSI spec", "UIC": "UIC leaflet", "IRS": "UIC leaflet"}.get(base, "Standard")
        if sid in ("ETSI TS 100", "EN 301", "ETSI EN 301"): continue
        nid = "STD:" + sid
        nodes.setdefault(nid, {"type": typ, "label": sid})
        e = edges[(rel, nid)]; e["count"] += 1
        if m.group("yr"): e["versions"][m.group("yr") + (f"+A{m.group('amd')}" if m.group("amd") else "")] += 1
    def add_subset(num, parts):
        sid = f"SUBSET-{num}"
        for p_ in [x for x in parts.split("-") if x]:            # most specific part that exists in the library
            if f"{sid}-{int(p_)}" in sub_files or f"{sid}-{p_}" in sub_files:
                sid = f"{sid}-{p_ if f'{sid}-{p_}' in sub_files else int(p_)}"
            else: break
        nid = "SS:" + sid
        nodes.setdefault(nid, {"type": "ERTMS subset", "label": sid})
        if rel in sub_files.get(sid, []): return
        edges[(rel, nid)]["count"] += 1
    for m in SUBSET.finditer(t):
        add_subset(m.group(1), m.group(2))
    if rel.startswith(("07_", "02_", "06_", "08_Norway/ATC2", "09_Referenced_Documents/ERTMS")):
        for m in SS_ABBR.finditer(t):
            if f"SUBSET-{m.group(1)}" in sub_files: add_subset(m.group(1), m.group(2))
    if rel.startswith("08_Norway/ATC2"):
        for m in ATC2_LAB.finditer(t):
            nid = ATC2_LABELS[m.group(1)]
            if rel in sub_files.get(nid[3:], []) or rel in era_files.get(nid, []): continue
            nodes.setdefault(nid, {"type": "ERTMS subset" if nid.startswith("SS:") else "ERA document", "label": nid.split(":", 1)[1]})
            edges[(rel, nid)]["count"] += 1
    for rx, fmt in ((ETSI_BARE, lambda m: f"ETSI {m.group(1)} {m.group(2)} {m.group(3)}{m.group(4)}"),
                    (GPP, lambda m: f"ETSI TS 1{m.group(2)} {m.group(3)}{m.group(4)}")):
        for m in rx.finditer(t):
            sid = fmt(m); nid = "STD:" + sid
            nodes.setdefault(nid, {"type": "ETSI spec", "label": sid})
            edges[(rel, nid)]["count"] += 1
    if rel.startswith(("07_", "02_", "06_", "09_Referenced_Documents/ERA")):
        for rx_, fmt_ in ERTMS_DOC_IDS:
            for m in rx_.finditer(t):
                nid = fmt_(m)
                if rel in era_files.get(nid, []): continue
                nodes.setdefault(nid, {"type": "ERA document", "label": nid[4:]})
                edges[(rel, nid)]["count"] += 1
    for m in MORANE.finditer(t):
        nid = "ERA:MORANE-" + "".join(m.groups()[:2]) + "T" + m.group(3)
        if rel in era_files.get(nid, []): continue
        nodes.setdefault(nid, {"type": "ERA document", "label": nid[4:].replace("-", " ", 1)})
        edges[(rel, nid)]["count"] += 1
    for m in ERA120X.finditer(t):
        nid = f"ERA:ERA120{m.group(1)}/{int(m.group(2)):03d}"
        if rel in era_files.get(nid, []) or rel in alias.get(nid, set()): continue
        nodes.setdefault(nid, {"type": "ERA document", "label": nid[4:]})
        edges[(rel, nid)]["count"] += 1
    for m in EIRENE.finditer(t):
        k = m.group(1).upper()
        sid = "EIRENE-" + ("FRS" if k.startswith(("FRS", "FUNCTIONAL")) else "SRS")
        nid = "SS:" + sid
        nodes.setdefault(nid, {"type": "ERTMS subset", "label": sid.replace("-", " ")})
        if rel in sub_files.get(sid, []): continue
        edges[(rel, nid)]["count"] += 1
    for m in ERADOC.finditer(t):
        sid = m.group(1).upper().rstrip("./-")
        if re.match(r"ERA[\s_-]?120[89]", sid): continue      # handled by ERA120X
        me_ = re.match(r"ERA[_/ -]ERTMS[_/ -]0*(\d{4,6})$", sid)
        if me_:
            if len(re.sub(r"\D", "", sid)) not in (6, 7): continue  # 5 digits = number cut at a line break
            sid = f"ERA/ERTMS/{int(me_.group(1)):06d}"
        if len(sid) < 8: continue
        nid = "ERA:" + sid
        nodes.setdefault(nid, {"type": "ERA document", "label": sid})
        edges[(rel, nid)]["count"] += 1
    for m in NOR.finditer(t):
        nid = "NO:" + m.group(1)
        nodes.setdefault(nid, {"type": "Norwegian law/regulation", "label": m.group(1)})
        edges[(rel, nid)]["count"] += 1
    for m in NOR2.finditer(t):
        pre = "FOR" if m.group(1).lower() == "forskrift" else "LOV"
        fid = f"{pre}-{m.group(4)}-{MND[m.group(3).lower()]:02d}-{int(m.group(2)):02d}-{m.group(5)}"
        nid = "NO:" + fid
        nodes.setdefault(nid, {"type": "Norwegian law/regulation", "label": fid})
        edges[(rel, nid)]["count"] += 1
    if (i + 1) % 25 == 0: print(f"{i+1}/{len(files)}", file=sys.stderr)

# ---- repair dropped hyphens: EN 455454 -> EN 45545-4 ----
known = defaultdict(set)
for nid in nodes:
    if nid.startswith("STD:"):
        org, num = nid[4:].rsplit(" ", 1) if " " in nid[4:] else ("", nid[4:])
        if "-" in num: known[org].add(num.split("-")[0])
remap = {}
for nid in list(nodes):
    if not nid.startswith("STD:"): continue
    lab = nid[4:]
    if " " not in lab: continue
    org, num = lab.rsplit(" ", 1)
    if "-" in num or not num.isdigit() or len(num) < 6: continue
    for cut in (1, 2):
        base, part = num[:-cut], num[-cut:]
        if base in known[org] and part != "0":
            remap[nid] = f"STD:{org} {base}-{part}"; break
for old, new in remap.items():
    nodes.setdefault(new, dict(nodes[old], label=new[4:]))
    del nodes[old]
    for (s_, t_) in [k for k in edges if k[1] == old]:
        e = edges.pop((s_, t_)); ne = edges[(s_, new)]
        ne["count"] += e["count"]; ne["versions"].update(e["versions"])
print("hyphen repairs:", len(remap), file=sys.stderr)

# titles for in-library EU acts from catalogue
for nid, n in nodes.items():
    if nid.startswith("EU:"):
        fl = celex_to_files.get(n["celex"])
        if fl:
            n["title"] = by_path[fl[0]]["title"]

# library matches
for nid, n in nodes.items():
    lib = []
    if nid.startswith("EU:"): lib = celex_to_files.get(n["celex"], [])
    elif nid.startswith("SS:"): lib = sub_files.get(nid[3:], [])
    elif nid in era_files: lib = era_files[nid]
    PREF = ["Set4_ETCS_B4_R1_current", "Informative_specs", "Set3_ETCS_B3_R2", "Set2_ETCS_B3_MR1", "Set1_ETCS_B2"]
    def _rank(p):
        stub = p.endswith(".url.txt") or "_link" in p.lower()
        for i, k in enumerate(PREF):
            if "/" + k + "/" in p: return (i, stub, p)
        return (len(PREF), stub, p)
    lib = sorted(set(lib) | alias.get(nid, set()), key=_rank)
    if lib and not n.get("title"): n["title"] = by_path.get(lib[0], {}).get("title", "")
    n["in_library"] = ";".join(lib)

# ---- CELEX check: acts that do not exist on EUR-Lex are extraction noise (e.g. a footnote digit
# glued to the number: 2016/7972 -> 2016/797). tools/data/celex_check.tsv: celex, exists(0/1), repair
CC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "celex_check.tsv")
if os.path.exists(CC):
    chk = {r["celex"]: r for r in csv.DictReader(open(CC, encoding="utf-8"), delimiter="\t")}
    for nid in [x for x in nodes if x.startswith("EU:")]:
        r = chk.get(nodes[nid]["celex"])
        if not r or r["exists"] == "1" or nodes[nid]["in_library"]: continue
        new = "EU:" + r["repair"] if r.get("repair") else None
        for (s_, t_) in [k for k in edges if k[1] == nid]:
            e = edges.pop((s_, t_))
            if new and new in nodes:
                ne = edges[(s_, new)]; ne["count"] += e["count"]
        del nodes[nid]
    edges_ = {k: v for k, v in edges.items() if k[1] in nodes}; edges.clear(); edges.update(edges_)

# ---- manual corrections: tools/data/edge_overrides.tsv (action add|remove|retarget, source_file, target_id, new_target_id, note)
OV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "edge_overrides.tsv")
TYPES = {"EU": "EU act", "SS": "ERTMS subset", "ERA": "ERA document", "NO": "Norwegian law/regulation"}
def ensure_node(nid):
    if nid in nodes: return
    pre, lab = nid.split(":", 1)
    if pre == "LIB":           # a library document cited by title only (guides, RFUs ...): target is the file itself
        r = by_path.get(lab, {})
        typ = "EU act" if "/EU_Acts/" in lab else ("ERTMS subset" if lab.startswith("07_") else "ERA document")
        nodes[nid] = {"type": typ, "label": r.get("reference") or os.path.basename(lab), "title": r.get("title", ""), "in_library": lab}
        return
    typ = TYPES.get(pre) or {"ETSI": "ETSI spec", "UIC": "UIC leaflet", "IRS": "UIC leaflet"}.get(lab.split()[0], "Standard")
    n = {"type": typ, "label": lab, "in_library": ";".join(sorted(alias.get(nid, set()) | set(sub_files.get(lab, [])) | set(era_files.get(nid, []))))}
    if pre == "EU":
        n["celex"] = lab if re.match(r"^3\d{4}[RLD]\d{4}$", lab) else ""
        k = act_key({"R": "Regulation", "L": "Directive", "D": "Decision"}[lab[5]], lab[1:5], str(int(lab[6:]))) if n["celex"] else None
        if k: n["label"] = k[1]
        n["in_library"] = ";".join(celex_to_files.get(lab, []))
        fl = celex_to_files.get(lab)
        if fl: n["title"] = by_path[fl[0]]["title"]
    nodes[nid] = n
n_ov = Counter()
if os.path.exists(OV):
    for r in csv.DictReader((l for l in open(OV, encoding="utf-8") if not l.startswith("#")), delimiter="\t"):
        act, src, tid, new = r["action"].strip(), r["source_file"].strip(), r["target_id"].strip(), (r.get("new_target_id") or "").strip()
        if act == "remove":
            if edges.pop((src, tid), None) is not None: n_ov[act] += 1
        elif act == "add":
            if tid == "LIB:" + src: continue
            ensure_node(tid); e = edges[(src, tid)]; e["count"] = max(e["count"], 1); n_ov[act] += 1
        elif act == "retarget" and new:
            ensure_node(new)
            srcs = [k for k in edges if k[1] == tid and (src in ("*", "") or k[0] == src)]
            for k in srcs:
                e = edges.pop(k); ne = edges[(k[0], new)]; ne["count"] += e["count"]; ne["versions"].update(e["versions"])
            if srcs: n_ov[act] += 1
print("overrides applied:", dict(n_ov), file=sys.stderr)

# titles of Norwegian ids not in the library (cached by tools/lovdata_titles.py)
LT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "lovdata_titles.tsv")
if os.path.exists(LT):
    lt = {r["id"]: r for r in csv.DictReader(open(LT, encoding="utf-8"), delimiter="\t")}
    for nid, n in nodes.items():
        r = lt.get(nid[3:]) if nid.startswith("NO:") else None
        if r and r.get("title") and not n.get("title"): n["title"] = r["title"]

# drop trivial noise: targets cited only once in only one doc for STD with odd numbers kept; keep all
for k in [k for k in edges if k[0] in nodes[k[1]]["in_library"].split(";")]:
    del edges[k]
with open(os.path.join(out, "edges.tsv"), "w", encoding="utf-8") as f:
    f.write("source_file\tsource_title\ttarget_id\ttarget_type\ttarget_label\tmentions\tversions_cited\ttarget_in_library\n")
    for (s, t_), e in sorted(edges.items()):
        n = nodes[t_]
        title = by_path.get(s, {}).get("title", os.path.basename(s))
        vers = ",".join(f"{v}" for v, _ in e["versions"].most_common())
        f.write(f"{s}\t{title}\t{t_}\t{n['type']}\t{n['label']}\t{e['count']}\t{vers}\t{n['in_library']}\n")
with open(os.path.join(out, "nodes.tsv"), "w", encoding="utf-8") as f:
    f.write("target_id\ttype\tlabel\ttitle\tcelex\tcited_by_docs\ttotal_mentions\tin_library\n")
    cited = defaultdict(set); tot = Counter()
    for (s, t_), e in edges.items(): cited[t_].add(s); tot[t_] += e["count"]
    for nid, n in sorted(nodes.items(), key=lambda x: -len(cited[x[0]])):
        f.write(f"{nid}\t{n['type']}\t{n['label']}\t{n.get('title','')}\t{n.get('celex','')}\t{len(cited[nid])}\t{tot[nid]}\t{n['in_library']}\n")
print(f"files={len(files)} nodes={len(nodes)} edges={len(edges)}")
