#!/usr/bin/env python3
"""add_short_col.py <catalogue.tsv> : add/refresh a short_name column (last column, so download_all.sh column positions are unchanged)."""
import csv, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shortnames import ShortNames
p = sys.argv[1]
rows = list(csv.DictReader(open(p, encoding="utf-8"), delimiter="\t"))
cols = [c for c in rows[0].keys() if c != "short_name"]
SN = ShortNames(rows)
for r in rows:
    r["short_name"] = SN.doc.get(f"{r['folder']}/{r['filename']}", ("", ""))[0]
out = cols + ["short_name"]
with open(p, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, out, delimiter="\t", lineterminator="\n", extrasaction="ignore"); w.writeheader(); w.writerows(rows)
print("short names in catalogue:", sum(1 for r in rows if r["short_name"]), "of", len(rows))
