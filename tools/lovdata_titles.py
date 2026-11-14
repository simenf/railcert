#!/usr/bin/env python3
"""lovdata_titles.py <nodes.tsv> <out lovdata_titles.tsv>
Looks up the title of every cited Norwegian law/regulation id (NO:FOR-/LOV-) on Lovdata and caches it.
Lovdata blocks some cloud networks: run it from your own machine. Existing rows are kept."""
import csv, re, sys, os, html, urllib.request, concurrent.futures as cf
nodes, out = sys.argv[1], sys.argv[2]
old = {r["id"]: r for r in csv.DictReader(open(out, encoding="utf-8"), delimiter="\t")} if os.path.exists(out) else {}
ids = sorted({n["label"] for n in csv.DictReader(open(nodes, encoding="utf-8"), delimiter="\t") if n["target_id"].startswith("NO:")} - set(old))
def get(i):
    k = "forskrift" if i.startswith("FOR") else "lov"; u = f"https://lovdata.no/{k}/{i[4:]}"
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=20)
        t = re.search(r"<title>(.*?)</title>", r.read().decode("utf-8", "ignore"), re.S)
        return {"id": i, "title": html.unescape(t.group(1)).replace(" - Lovdata", "").strip() if t else "", "url": r.geturl(), "status": "200"}
    except Exception as e:
        return {"id": i, "title": "", "url": u, "status": str(getattr(e, "code", e))[:20]}
with cf.ThreadPoolExecutor(4) as ex:
    for r in ex.map(get, ids): old[r["id"]] = r
with open(out, "w", encoding="utf-8") as f:
    f.write("id\ttitle\turl\tstatus\n")
    for i in sorted(old): f.write("\t".join(old[i].get(k, "") for k in ("id", "title", "url", "status")) + "\n")
print(len(ids), "looked up")
