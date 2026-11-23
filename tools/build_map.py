#!/usr/bin/env python3
"""build_map.py <catalogue.tsv> <edges.tsv> <nodes.tsv> <out_dir> [std_titles.tsv]
Writes reference_map.html (self-contained explorer), plus CSV exports."""
import csv, json, os, sys, re
from collections import defaultdict, Counter
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shortnames import ShortNames

catp, edgep, nodep, out = sys.argv[1:5]
stdp = sys.argv[5] if len(sys.argv) > 5 else None
cat = list(csv.DictReader(open(catp, encoding="utf-8"), delimiter="\t"))
edges = list(csv.DictReader(open(edgep, encoding="utf-8"), delimiter="\t"))
nodes = list(csv.DictReader(open(nodep, encoding="utf-8"), delimiter="\t"))
stitle = {}
if stdp and os.path.exists(stdp):
    for r in csv.DictReader(open(stdp, encoding="utf-8"), delimiter="\t"):
        if r["title"]: stitle[r["label"]] = (r["title"], r["title_source"])

SN = ShortNames(cat)
docs = {}
for r in cat:
    p = f"{r['folder']}/{r['filename']}"
    docs[p] = {"id": p, "t": r["title"], "f": r["folder"], "ref": r.get("reference", ""), "st": r.get("date_or_status", ""), "u": r.get("url", "")}
    if p in SN.doc:
        sname, num = SN.doc[p]
        docs[p]["s"] = sname
        if num: docs[p]["n"] = num

STDTYPES = ("Standard", "UIC leaflet", "ETSI spec")
ext = {}
for n in nodes:
    e = {"id": n["target_id"], "ty": n["type"], "l": n["label"], "t": n.get("title", ""),
         "lib": [x for x in n["in_library"].split(";") if x], "n": int(n["cited_by_docs"] or 0)}
    if e["ty"] in STDTYPES and n["label"] in stitle:
        if not e["t"] or e["t"].strip() == n["label"].strip(): e["t"] = stitle[n["label"]][0]
        e["ts"] = stitle[n["label"]][1]
    sname = SN.ext(e["id"], e["l"])
    if not sname and e["lib"]:
        ds = SN.doc.get(e["lib"][0])
        if ds: sname = re.sub(r" \((consolidated)\)$| – corrigendum$", "", ds[0])
    if sname: e["s"] = sname
    ext[n["target_id"]] = e

E = []
vers = defaultdict(Counter)
SETS = ["Set1_ETCS_B2", "Set2_ETCS_B3_MR1", "Set3_ETCS_B3_R2", "Set4_ETCS_B4_R1_current", "Informative_specs"]
def set_of(p):
    return next((k for k in SETS if "/" + k + "/" in p), None)
SRC_SET = [("Reg_2016-919", "Set3_ETCS_B3_R2"), ("Reg_2019-776", "Set3_ETCS_B3_R2"), ("Reg_2020-387", "Set3_ETCS_B3_R2"),
           ("ATC2_STM_Specifications/v5.1_2009/", "Set1_ETCS_B2"), ("ATC2_STM_Specifications/v5.2_2014/", "Set1_ETCS_B2"),
           ("ATC2_STM_Specifications/v6.0_2014/", "Set2_ETCS_B3_MR1"), ("ATC2_STM_Specifications/v6.1_2017/", "Set3_ETCS_B3_R2"),
           ("Bane_NOR/Teknisk_regelverk/", "Set3_ETCS_B3_R2")]   # Bane NOR's rules are written for Set 3 (system version 3.6.0)
def same_set_file(src, lib):
    """An ERTMS document cites the subset versions of its own specification set: resolve to that set's file.
    Outside the set folders: the 2016/919 CCS TSI family mandates sets 1-3 (Set 3 is the latest), and each
    ATC-2 STM version was written against the baseline of its time."""
    ss = set_of(src) or next((k for pat, k in SRC_SET if pat in src), None)
    if not ss or len(lib) < 2: return None
    if ss == "Informative_specs": ss = "Set4_ETCS_B4_R1_current"
    hit = next((f for f in lib if set_of(f) == ss), None)
    return hit if hit and hit != lib[0] else None
n_set = 0
for e in edges:
    row = [e["source_file"], e["target_id"], int(e["mentions"])]
    lib = ext[e["target_id"]]["lib"] if e["target_id"] in ext else []
    f = same_set_file(e["source_file"], lib)
    if f: row.append(f); n_set += 1
    E.append(row)
    for v in filter(None, e["versions_cited"].split(",")): vers[e["target_id"]][v] += 1
for k, c in vers.items():
    if k in ext: ext[k]["v"] = [v for v, _ in c.most_common()]

def avail(n):
    if n["lib"]: return "In library"
    ty = n["ty"]
    if ty == "Standard": return "Paid (CEN/CENELEC/IEC/ISO)"
    if ty == "UIC leaflet": return "Paid (UIC)"
    if ty == "ETSI spec": return "Free (ETSI) – not resolved"
    if ty == "EU act": return "Free (EUR-Lex) – not available/noise"
    return "Not found"
for n in ext.values(): n["a"] = avail(n)

# ---------- official / store links for every cited item ----------
from urllib.parse import quote_plus
cat_url = {f"{r['folder']}/{r['filename']}": r.get("url", "") for r in cat}
# ETSI folder structure cached by tools/etsi_dirs.py (exact folders; multi-part deliverables link to part 1)
ETSI_DIRS, ETSI_RANGES = {}, set()
_ed = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "etsi_dirs.tsv")
if os.path.exists(_ed):
    for r in csv.DictReader(open(_ed, encoding="utf-8"), delimiter="\t"):
        ETSI_DIRS.setdefault((r["kind"], r["range"]), []).append(r["folder"]); ETSI_RANGES.add((r["kind"], r["range"]))

def ext_link(n):
    lab, ty, nid = n["l"], n["ty"], n["id"]
    if n["lib"]:
        u = cat_url.get(n["lib"][0], "")
        if u.startswith("http"): return u, "Official source"
    if nid.startswith("EU:"):
        return f"https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{nid[3:]}", "EUR-Lex"
    if nid.startswith("NO:"):
        m = re.match(r"(FOR|LOV)-(\d{4}-\d{2}-\d{2}-\d+)", nid[3:])
        # short form: Lovdata redirects to the right collection (current, repealed, amending act...)
        if m: return (f"https://lovdata.no/forskrift/{m.group(2)}" if m.group(1) == "FOR" else f"https://lovdata.no/lov/{m.group(2)}"), "Lovdata"
    if ty == "ETSI spec":
        m = re.match(r"ETSI (TS|EN|TR|ES) (\d{3}) (\d{3})((?:-\d+)*)$", lab)
        if m:
            k, num = m.group(1).lower(), m.group(2) + m.group(3)
            parts = "".join(f"{int(x):02d}" for x in m.group(4).strip("-").split("-")) if m.group(4) else ""
            want = num + parts
            rg = next((r for (kk, r) in ETSI_RANGES if kk == k and int(r.split("_")[0]) <= int(num) <= int(r.split("_")[1])), None)
            if rg:
                folders = ETSI_DIRS.get((k, rg), [])
                hit = want if want in folders else next((f for f in folders if f.startswith(want)), None)
                if hit: return f"https://www.etsi.org/deliver/etsi_{k}/{rg}/{hit}/", "ETSI (free download)"
                return f"https://www.etsi.org/deliver/etsi_{k}/{rg}/", "ETSI (deliverable folder)"
            lo = int(num) // 100 * 100
            return f"https://www.etsi.org/deliver/etsi_{k}/{lo:06d}_{lo+99:06d}/{want}/", "ETSI (free download)"
    if ty == "UIC leaflet":
        num = re.sub(r"^(UIC|IRS)\s*", "", lab)
        return f"https://shop.uic.org/en/search?controller=search&s={quote_plus(num)}", "UIC shop"
    if ty == "Standard":
        if re.match(r"^IEC\b", lab):
            return f"https://webstore.iec.ch/en/catalogsearch/result/?q={quote_plus(re.sub(r'^IEC ', '', lab))}", "IEC webstore"
        q = re.sub(r"^(EN ISO|EN IEC) ", "EN ISO " if lab.startswith("EN ISO") else "EN ", lab)
        return f"https://online.standard.no/en/search?q={quote_plus(q)}", "Standard Norge (buy)"
    if ty == "ERTMS subset":
        return "https://www.era.europa.eu/domains/infrastructure/european-rail-traffic-management-system-ertms_en", "ERA ERTMS specifications"
    return "", ""
for n in ext.values():
    u, k = ext_link(n)
    if u: n["u"], n["uk"] = u, k

# ---------- precomputed, static layouts for the Graph tab ----------
def layout(node_ids, links, iters=450, seed=7):
    idx = {n: i for i, n in enumerate(node_ids)}; N = len(node_ids)
    if N == 0: return {}
    rng = np.random.default_rng(seed)
    P = rng.uniform(-1, 1, (N, 2)) * np.sqrt(N) * 10
    L = np.array([(idx[a], idx[b]) for a, b in links if a in idx and b in idx], dtype=int).reshape(-1, 2)
    k = 28.0; t = np.sqrt(N) * 6
    for it in range(iters):
        D = P[:, None, :] - P[None, :, :]
        d2 = (D ** 2).sum(-1) + 1e-2
        rep = (k * k / d2)[:, :, None] * D
        disp = rep.sum(1)
        if len(L):
            dv = P[L[:, 0]] - P[L[:, 1]]
            dl = np.sqrt((dv ** 2).sum(1)) + 1e-6
            f = (dl * dl / k)[:, None] * dv / dl[:, None]
            np.add.at(disp, L[:, 0], -f); np.add.at(disp, L[:, 1], f)
        disp -= P * 0.015                       # gravity keeps components together
        ln = np.sqrt((disp ** 2).sum(1)) + 1e-9
        P += disp / ln[:, None] * np.minimum(ln, t)[:, None]
        t *= 0.99
    P -= P.mean(0)
    return {n: [round(float(P[i, 0]), 1), round(float(P[i, 1]), 1)] for n, i in idx.items()}

def graph(mode):
    L = []; deg = Counter()
    for s, t, c, *_ in E:
        e = ext.get(t)
        if not e or s not in docs: continue
        if e["lib"]:
            for f in e["lib"]:
                if f in docs and f != s: L.append((s, f))
        elif mode == "std" and e["ty"] in STDTYPES and e["n"] >= 5:
            L.append((s, t))
    L = list(dict.fromkeys(L))
    for a, b in L: deg[a] += 1; deg[b] += 1
    ids = sorted(deg)
    return {"pos": layout(ids, L), "links": L}

G = {"docs": graph("docs"), "std": graph("std")}
data = {"docs": list(docs.values()), "ext": list(ext.values()), "edges": E, "G": G}
# Bane NOR Teknisk regelverk requirement index (tools/trv_crawl.py): "07113" -> [chapter file, section, text]
TRQ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "banenor_trv_requirements.tsv")
if os.path.exists(TRQ):
    data["trq"] = {}
    for r in csv.DictReader(open(TRQ, encoding="utf-8"), delimiter="\t"):
        p, k = f"{r['folder']}/{r['filename']}", r["req_id"].split(":")[-1]
        old = data["trq"].get(k)
        if p in docs and (not old or ("superseded" in docs[old[0]]["st"] and "superseded" not in docs[p]["st"])):
            data["trq"][k] = [p, r["section"][:90], r["text"][:140]]
os.makedirs(out, exist_ok=True)

# ---------- CSV exports ----------
with open(os.path.join(out, "references_edges.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["citing_document", "citing_short_name", "citing_title", "cited_id", "cited_type", "cited_label", "cited_short_name", "cited_title", "mentions", "versions_cited", "cited_in_library"])
    for e in edges:
        n = ext.get(e["target_id"], {})
        w.writerow([e["source_file"], docs.get(e["source_file"], {}).get("s", ""), e["source_title"], e["target_id"], e["target_type"], e["target_label"], n.get("s", ""), n.get("t", ""), e["mentions"], e["versions_cited"], e["target_in_library"]])
with open(os.path.join(out, "standards_register.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["standard", "title", "title_source", "type", "availability", "link", "versions_cited", "cited_by_n_docs", "citing_documents", "file_in_library"])
    citing = defaultdict(list)
    for e in edges: citing[e["target_id"]].append(e["source_file"])
    for n in sorted(ext.values(), key=lambda x: -x["n"]):
        if n["ty"] in STDTYPES:
            w.writerow([n["l"], n.get("t", ""), n.get("ts", ""), n["ty"], n["a"], n.get("u", ""), " ".join(n.get("v", [])), n["n"], " | ".join(citing[n["id"]]), ";".join(n["lib"])])

from navigator import build_nav, write_html
data["nav"] = build_nav(data)
_kb = write_html(out, data) // 1024
print("edges resolved to the citing document's own ERTMS set:", n_set)
print("short names: docs", sum(1 for d in docs.values() if d.get("s")), "cited items", sum(1 for e in ext.values() if e.get("s")), "|",  "ext", len(ext), "edges", len(E), "titled std", sum(1 for e in ext.values() if e["ty"] in STDTYPES and e["t"]),
      "graph nodes", len(G["docs"]["pos"]), len(G["std"]["pos"]), "html KB", _kb)
