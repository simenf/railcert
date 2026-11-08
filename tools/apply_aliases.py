#!/usr/bin/env python3
"""apply_aliases.py <master.tsv> <unresolved.tsv> : add ALREADY_IN_LIBRARY ids to matched_ids of the matching library row."""
import csv, re, sys
mp, up = sys.argv[1], sys.argv[2]
rows = list(csv.DictReader(open(mp, encoding="utf-8"), delimiter="\t")); cols = list(rows[0].keys())
bypath = {f"{r['folder']}/{r['filename']}": r for r in rows}
n = 0
for u in csv.DictReader(open(up, encoding="utf-8"), delimiter="\t"):
    if u["status"] != "ALREADY_IN_LIBRARY": continue
    targets = re.findall(r"(\d\d_[A-Za-z_]+/[^\s()]+?\.(?:pdf|zip|xlsx|docx|xlsm))", u["note"])
    m = re.match(r"ERA1209/(\d{3})", u["id"])
    if m: targets += [p for p in bypath if f"ERA1209-{m.group(1)}" in p]
    if "PRG-005/02-361" in u["id"]: targets += [p for p in bypath if "ERA1209-222_PA_VA_Guidelines" in p]
    for t in targets:
        if t in bypath:
            r = bypath[t]; ids = [x for x in r["matched_ids"].split(";") if x]
            if u["id"] not in ids: ids.append(u["id"]); r["matched_ids"] = ";".join(ids); n += 1
with open(mp, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, cols, delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(rows)
print("aliases added:", n)
