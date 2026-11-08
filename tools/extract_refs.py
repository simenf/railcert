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
def text_of(rel):
    p = os.path.join(root, rel)
    t = os.path.join(txtdir, rel.replace("/", "__") + ".txt")
    if os.path.exists(t) and os.path.getmtime(t) >= os.path.getmtime(p):
        return open(t, encoding="utf-8", errors="ignore").read()
    s = ""
    if rel.lower().endswith(".pdf"):
        r = subprocess.run(["pdftotext", "-q", "-enc", "UTF-8", p, "-"], capture_output=True, timeout=300)
        s = r.stdout.decode("utf-8", "ignore")
    elif rel.lower().endswith((".html", ".htm")):
        raw = open(p, encoding="utf-8", errors="ignore").read()
        raw = re.sub(r"(?is)<(script|style).*?</\1>", " ", raw)
        # Lovdata cross-references are hyperlinks: keep them as FOR-/LOV- ids
        body = re.search(r"(?is)<div[^>]+class=\"[^\"]*documentBody[^\"]*\".*", raw)
        scope = body.group(0) if body else raw
        ids = {("FOR-" if k == "forskrift" else "LOV-") + d for k, d in re.findall(r'(?:data-id="|href="/(?:dokument/(?:SF|NL)/)?)(forskrift|lov)/(\d{4}-\d{2}-\d{2}-\d+)', scope)}
        raw += " " + " ".join(sorted(ids))
        s = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    open(t, "w", encoding="utf-8").write(s)
    return s

# ---------- patterns ----------
NBSP = " "
ACT = re.compile(
    r"\b(?P<kind>(?:Implementing\s+|Delegated\s+|Commission\s+|Council\s+)*(?:Regulation|Directive|Decision)"
    r"|(?:gjennomførings|kommisjons|delegert\s+)?forordning(?:en)?|direktiv(?:et)?|(?:kommisjons)?beslutning(?:en)?|kommisjonsvedtak)"
    r"[\s" + NBSP + r"]*(?:\((?:EU|EC|EEC|EF|EØF|EU/Euratom)\)[\s" + NBSP + r"]*)?(?:(?:No|nr)\.?[\s" + NBSP + r"]*)?"
    r"(?P<a>\d{1,4})/(?P<b>\d{1,4})(?:/(?:EU|EC|EEC|EF|EØF))?\b", re.I)
STD = re.compile(
    r"\b(?P<org>(?:pr)?EN(?:[\s" + NBSP + r"]+(?:IEC|ISO))?|IEC|ISO(?:/IEC)?|CLC/TS|CLC/TR|CEN/TS|CEN/TR|CEN/CLC/TS|ETSI[\s" + NBSP + r"]+(?:TS|EN|TR|ES)|UIC(?:[\s" + NBSP + r"]+(?:Leaflet|Code|IRS))?|IRS|NS[\s" + NBSP + r"]+EN)"
    r"[ " + NBSP + r"]*(?P<num>\d{2,6}(?:[ " + NBSP + r"]\d{3})?(?:-\d{1,3}){0,3})(?::(?P<yr>(?:19|20)\d{2}))?(?:\+A(?P<amd>\d)(?::\d{4})?)?")
SUBSET = re.compile(r"\bSUBSET[-\s" + NBSP + r"]?(\d{3})(?:-(\d{1,2}))?", re.I)
ERADOC = re.compile(r"\b(ERA(?:/ERTMS|/GUI|/TD|/REC|/OPI|/REP|/PRG|/INT|/TMP|/ADV)?[/_-][A-Z0-9_./-]{3,20}\d|ERA1209/\d{3}|ERA-PRG-\d{3}|ERA-TD-\d{4}-\d+)", re.I)
NOR = re.compile(r"\b((?:FOR|LOV)-\d{4}-\d{2}-\d{2}-\d{1,5})\b")
MND = {m: i+1 for i, m in enumerate(["januar","februar","mars","april","mai","juni","juli","august","september","oktober","november","desember"])}
NOR2 = re.compile(r"\b(forskrift|lov)\s+(\d{1,2})\.\s*(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)\s+(\d{4})\s+nr\.?\s*(\d{1,5})", re.I)

KIND = {"regulation": "R", "directive": "L", "decision": "D", "forordning": "R", "direktiv": "L",
        "beslutning": "D", "kommisjonsvedtak": "D"}
LABEL = {"R": "Regulation", "L": "Directive", "D": "Decision"}

def act_key(kind, a, b):
    k = kind.lower()
    letter = next((v for w, v in KIND.items() if w in k), None)
    if not letter: return None
    a, b = int(a), int(b)
    if 1957 <= a <= 2030 and not (1957 <= b <= 2030 and a > 1999 and b < a):
        year, num = a, b
    elif 1957 <= b <= 2030:
        year, num = b, a
    else:
        return None
    if num == 0 or num > 9999: return None
    # Old-style directives/decisions are year/num; old regulations num/year: handled above.
    celex = f"3{year}{letter}{num:04d}"
    if letter == "R" and year < 2015:
        return celex, f"Regulation (EU/EC) No {num}/{year}"
    suffix = "" if letter == "R" else ("/EU" if year >= 2010 else "/EC")
    return celex, f"{LABEL[letter]} {year}/{num}{suffix}"

def norm_std(org, num):
    org = re.sub(r"\s+", " ", org.replace(NBSP, " ")).strip()
    org = re.sub(r"^NS EN", "EN", org)
    org = re.sub(r"^prEN", "EN", org)
    num = num.replace(NBSP, " ")
    if re.match(r"^\d{3} \d{3}$", num): num = num.replace(" ", " ")  # ETSI style '102 281'
    else: num = num.replace(" ", "")
    if org.startswith("UIC") : org = "UIC"
    m6 = re.match(r"^(\d{3}) ?(\d{3})((?:-\d+)*)$", num)
    if (org in ("EN", "ETSI EN") and m6 and num.startswith(("30", "31"))) or org.startswith("ETSI"):
        if m6:
            kind = org.split()[-1] if org.startswith("ETSI") else "EN"
            return f"ETSI {kind} {m6.group(1)} {m6.group(2)}{m6.group(3)}"
    return f"{org} {num}"

CELEX_RE = re.compile(r"CELEX[:%3A]+([0-9]{5}[A-Z][0-9]{4})")
self_celex = {}
for rel, r in by_path.items():
    m = CELEX_RE.search(r["url"])
    if m: self_celex[rel] = m.group(1)
celex_to_files = defaultdict(list)
for rel, c in self_celex.items(): celex_to_files[c].append(rel)

def subset_files():
    d = defaultdict(list)
    for rel in by_path:
        m = re.search(r"SUBSET[-_]?(\d{3})(?:[-_](\d{1,2}))?", rel, re.I)
        if m: d[f"SUBSET-{m.group(1)}"].append(rel)
    return d
sub_files = subset_files()
alias = defaultdict(set)
for rel, r in by_path.items():
    for mid in (r.get("matched_ids") or "").split(";"):
        mid = mid.strip()
        if not mid: continue
        if ":" in mid.split("/")[0] and mid.split(":")[0] in ("STD", "SS", "ERA", "EU", "NO"):
            alias[mid].add(rel)
        else:
            alias["SS:" + mid].add(rel); alias["ERA:" + mid.upper()].add(rel)
    for m in re.finditer(r"((?:FOR|LOV)-\d{4}-\d{2}-\d{2}-\d{1,5})", rel + " " + r.get("reference", "") + " " + r.get("url", "")):
        alias["NO:" + m.group(1)].add(rel)
    for m in re.finditer(r"/(forskrift|lov)/(\d{4}-\d{2}-\d{2}-\d{1,5})", r.get("url", "")):
        alias["NO:" + ("FOR-" if m.group(1) == "forskrift" else "LOV-") + m.group(2)].add(rel)

edges = defaultdict(lambda: {"count": 0, "versions": Counter()})
nodes = {}

files = []
for dp, dn, fn in os.walk(root):
    dn[:] = [x for x in dn if not x.startswith("_") and x != "99_Reference_Map"]
    for f in fn:
        if f.lower().endswith((".pdf", ".html", ".htm")) and not f.endswith(".notpdf.html"):
            files.append(os.path.relpath(os.path.join(dp, f), root))
files.sort()

for i, rel in enumerate(files):
    try: t = text_of(rel)
    except Exception as e:
        print("ERR", rel, e, file=sys.stderr); continue
    t = t.replace("‑", "-").replace("‐", "-").replace("–", "-")
    me = self_celex.get(rel)
    for m in ACT.finditer(t):
        k = act_key(m.group("kind"), m.group("a"), m.group("b"))
        if not k: continue
        celex, label = k
        if celex == me: continue
        nid = "EU:" + celex
        nodes.setdefault(nid, {"type": "EU act", "label": label, "celex": celex})
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
    for m in SUBSET.finditer(t):
        sid = f"SUBSET-{m.group(1)}"
        nid = "SS:" + sid
        nodes.setdefault(nid, {"type": "ERTMS subset", "label": sid})
        if any(rel == f for f in sub_files.get(sid, [])): continue
        edges[(rel, nid)]["count"] += 1
    for m in ERADOC.finditer(t):
        sid = m.group(1).upper().rstrip("./-")
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
    elif nid.startswith("SS:"): lib = sub_files.get(n["label"], [])
    PREF = ["Set4_ETCS_B4_R1_current", "Informative_specs", "Set3_ETCS_B3_R2", "Set2_ETCS_B3_MR1", "Set1_ETCS_B2"]
    def _rank(p):
        for i, k in enumerate(PREF):
            if "/" + k + "/" in p: return (i, p)
        return (len(PREF), p)
    lib = sorted(set(lib) | alias.get(nid, set()), key=_rank)
    if lib and not n.get("title"): n["title"] = by_path.get(lib[0], {}).get("title", "")
    n["in_library"] = ";".join(lib)

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
