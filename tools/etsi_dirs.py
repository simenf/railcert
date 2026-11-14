#!/usr/bin/env python3
"""etsi_dirs.py <nodes.tsv> <out etsi_dirs.tsv>
Caches ETSI's deliverable folder structure for the ETSI ids cited, so build_map.py can link to the exact
folder (or the first part of a multi-part deliverable) without guessing. One request per range folder."""
import csv, re, sys, subprocess, time, os
nodes, out = sys.argv[1], sys.argv[2]
ids = [n["label"] for n in csv.DictReader(open(nodes), delimiter="\t") if n["type"] == "ETSI spec"]
def get(u):
    r = subprocess.run(["curl", "-s", "-m", "60", "-A", "Mozilla/5.0 railcert", u], capture_output=True, text=True)
    time.sleep(0.4)
    return re.findall(r'HREF="[^"]*/([0-9_]+)/"', r.stdout, re.I)
ranges = {k: get(f"https://www.etsi.org/deliver/etsi_{k}/") for k in ("ts", "en", "tr", "es")}
need = {}
for lab in ids:
    m = re.match(r"ETSI (TS|EN|TR|ES) (\d{3}) (\d{3})", lab)
    if not m: continue
    k, num = m.group(1).lower(), int(m.group(2) + m.group(3))
    for rg in ranges[k]:
        a, b = map(int, rg.split("_"))
        if a <= num <= b: need[(k, rg)] = 1
rows = []
for (k, rg) in sorted(need):
    for d in get(f"https://www.etsi.org/deliver/etsi_{k}/{rg}/"):
        rows.append((k, rg, d))
with open(out, "w") as f:
    f.write("kind\trange\tfolder\n")
    for r in rows: f.write("\t".join(r) + "\n")
print(len(ranges["ts"]), "ts ranges;", len(need), "range folders read;", len(rows), "deliverable folders")
