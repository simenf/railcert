#!/usr/bin/env python3
"""make_readme.py <library_root> <master.tsv> <not_downloaded.tsv> <nodes.tsv> <edges.tsv> <template> <out>"""
import csv, os, sys, datetime
from collections import Counter, defaultdict
root, mp, nd, np_, ep, tp, outp = sys.argv[1:8]
cat = list(csv.DictReader(open(mp, encoding="utf-8"), delimiter="\t"))
miss = list(csv.DictReader(open(nd, encoding="utf-8"), delimiter="\t"))
nodes = list(csv.DictReader(open(np_, encoding="utf-8"), delimiter="\t"))
nedges = sum(1 for _ in open(ep, encoding="utf-8")) - 1
size = 0
for dp, dn, fn in os.walk(root):
    dn[:] = [d for d in dn if d not in ('.build', '.git', 'tools')]
    for f in fn: size += os.path.getsize(os.path.join(dp, f))
std = [n for n in nodes if n["type"] == "Standard"]
uic = [n for n in nodes if n["type"] == "UIC leaflet"]
etsi_files = [r for r in cat if r["folder"].endswith("/ETSI") and not r["filename"].endswith(".url.txt")]
top = sorted(std, key=lambda n: -int(n["cited_by_docs"]))[:15]
topstd = ", ".join(f"{n['label']} ({n['cited_by_docs']})" for n in top)

# missing section
lines = []
links = [r for r in cat if r["filename"].endswith(".url.txt")]
lines.append(f"- **{len(links)} link files (`*.url.txt`)**: web pages, databases and portals with no downloadable file, such as ERA's SRD/RDD, the OSS portal, many SJT guidance pages and the ERTMS spec folders. Each holds the title and URL.")
lines.append("- **Paid standards**: EN/IEC/ISO/CLC and UIC are listed in `99_Reference_Map/standards_register.csv`, not downloaded.")
lines.append("- **ETCS test-sequence archives** (SUBSET-076-6-3 test sequences and SUBSET-103 Euroloop TSOE parts, about 100–150 MB per part and roughly 5 GB in total across the four sets) are machine-readable test-lab data. They are linked, not downloaded: each part has a `.url.txt` in its set folder. The test specification documents themselves (SUBSET-076-x, SUBSET-103) are downloaded.")
lines.append("- **Jernbanekjøretøyforskriften**: no Lovdata entry found under FOR-2022-05-25-923; SJT's text is linked instead. Bane NOR's ERTMS system descriptions on oppslagsverk.banenor.no block scripts, so they are linked.")
lines.append("- **ERA documents no longer published**: the 2011 SMS/ECM guides (GUI/01–05-2011 and GUI/08–11-2011, superseded), ERA recommendations from before 2015, ERA-TD-101, ERA/REP/13-2011 and ERA/INF/10-2009. **UNISIG subsets not public**: SUBSET-110/111 (interoperability test documents) and 131 (unpublished).")
miss = [m for m in miss if m["folder"].endswith("EU_Acts")]
if miss:
    lines.append(f"- **{len(miss)} cited EU acts not available on EUR-Lex**: most are extraction noise, such as a footnote digit glued to an act number (2016/7972). Others are acts with no English text online. All are listed in `catalogue_not_downloaded.tsv`.")
missing = "\n".join(lines)

# tree
cnt = Counter(); sz = Counter()
for r in cat:
    cnt[r["folder"]] += 1
    p = os.path.join(root, r["folder"], r["filename"])
    if os.path.exists(p): sz[r["folder"]] += os.path.getsize(p)
tree = ["| Folder | Files | Size |", "|---|---:|---:|"]
for f in sorted(cnt):
    tree.append(f"| `{f}` | {cnt[f]} | {sz[f]/1048576:.1f} MB |")
reg = list(csv.DictReader(open(os.path.join(root, "99_Reference_Map", "standards_register.csv"), encoding="utf-8")))
tot = sum(int(r["cited_by_n_docs"]) for r in reg); got = sum(int(r["cited_by_n_docs"]) for r in reg if r["title"])
stdtitles = f"{sum(1 for r in reg if r['title'])} of the {len(reg)} cited standards have a title. Together they account for about {round(100*got/max(tot,1))}% of all citations to standards."
t = open(tp, encoding="utf-8").read()
for k, v in {"__DATE__": datetime.date.today().isoformat(), "__NDOCS__": str(len(cat)), "__SIZE__": f"{size/1048576/1024:.2f} GB" if size > 1 << 30 else f"{size/1048576:.0f} MB",
             "__NEDGES__": f"{nedges:,}", "__NSTD__": str(len(std)), "__NUIC__": str(len(uic)), "__NETSI__": str(len(etsi_files)),
             "__TOPSTD__": topstd, "__STDTITLES__": stdtitles, "__MISSING__": missing, "__TREE__": "\n".join(tree)}.items():
    t = t.replace(k, v)
open(outp, "w", encoding="utf-8").write(t)
print("README written", len(cat), "docs")
