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
for e in edges:
    E.append([e["source_file"], e["target_id"], int(e["mentions"])])
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
def ext_link(n):
    lab, ty, nid = n["l"], n["ty"], n["id"]
    if n["lib"]:
        u = cat_url.get(n["lib"][0], "")
        if u.startswith("http"): return u, "Official source"
    if nid.startswith("EU:"):
        return f"https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:{nid[3:]}", "EUR-Lex"
    if nid.startswith("NO:"):
        m = re.match(r"(FOR|LOV)-(\d{4}-\d{2}-\d{2}-\d+)", nid[3:])
        if m: return (f"https://lovdata.no/dokument/SF/forskrift/{m.group(2)}" if m.group(1) == "FOR" else f"https://lovdata.no/dokument/NL/lov/{m.group(2)}"), "Lovdata"
    if ty == "ETSI spec":
        m = re.match(r"ETSI (TS|EN|TR|ES) (\d{3}) (\d{3})((?:-\d+)*)$", lab)
        if m:
            num = m.group(2) + m.group(3); lo = int(num) // 100 * 100
            parts = "".join(f"{int(x):02d}" for x in m.group(4).strip("-").split("-")) if m.group(4) else ""
            return f"https://www.etsi.org/deliver/etsi_{m.group(1).lower()}/{lo:06d}_{lo+99:06d}/{num}{parts}/", "ETSI (free download)"
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
    for s, t, c in E:
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

HTML = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "map_template.html"), encoding="utf-8").read()
_js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
open(os.path.join(out, "reference_map.html"), "w", encoding="utf-8").write(HTML.replace("__MODE__", "local").replace("__DATA__", _js))
os.makedirs(os.path.join(out, "online"), exist_ok=True)
open(os.path.join(out, "online", "index.html"), "w", encoding="utf-8").write(HTML.replace("__MODE__", "online").replace("__DATA__", _js))
print("short names: docs", sum(1 for d in docs.values() if d.get("s")), "cited items", sum(1 for e in ext.values() if e.get("s")), "|",  "ext", len(ext), "edges", len(E), "titled std", sum(1 for e in ext.values() if e["ty"] in STDTYPES and e["t"]),
      "graph nodes", len(G["docs"]["pos"]), len(G["std"]["pos"]), "html KB", len(_js) // 1024)
