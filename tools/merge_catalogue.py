#!/usr/bin/env python3
"""merge_catalogue.py <library_root> <out.tsv> <part.tsv>...  keeps only rows whose file exists in the library."""
import csv, os, sys
root, outp, parts = sys.argv[1], sys.argv[2], sys.argv[3:]
cols = ["folder", "filename", "title", "reference", "date_or_status", "url", "notes", "matched_ids"]
seen, rows, missing = set(), [], []
for p in parts:
    for r in csv.DictReader(open(p, encoding="utf-8"), delimiter="\t"):
        r = {k: (r.get(k) or "").strip() for k in cols}
        path = os.path.join(root, r["folder"], r["filename"])
        if not os.path.exists(path):
            alt = os.path.splitext(path)[0] + ".html"   # EUR-Lex HTML fallback
            if r["filename"].endswith(".pdf") and os.path.exists(alt):
                r["filename"] = os.path.basename(alt); r["notes"] = (r["notes"] + " · HTML version (no PDF on EUR-Lex)").strip(" ·")
            else:
                missing.append(r); continue
        key = (r["folder"], r["filename"])
        if key in seen: continue
        seen.add(key); rows.append(r)
rows.sort(key=lambda r: (r["folder"], r["filename"]))
with open(outp, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, cols, delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(rows)
with open(os.path.splitext(outp)[0] + "_not_downloaded.tsv", "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, cols, delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(missing)
print(f"rows={len(rows)} not_downloaded={len(missing)}")
