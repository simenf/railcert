#!/usr/bin/env python3
"""eu_titles.py <library_root> <ref_eu_acts.tsv> : fill real titles from the first page text."""
import csv, os, re, subprocess, sys
root, p = sys.argv[1], sys.argv[2]
rows = list(csv.DictReader(open(p, encoding="utf-8"), delimiter="\t")); cols = list(rows[0].keys())
for r in rows:
    f = os.path.join(root, r["folder"], r["filename"])
    if not os.path.exists(f) or not f.endswith(".pdf"): continue
    t = subprocess.run(["pdftotext", "-l", "2", "-q", f, "-"], capture_output=True).stdout.decode("utf-8", "ignore")
    t = re.sub(r"\s+", " ", t).replace("\u00ad ", "").replace("\u00ad", "")[:2500]
    m = re.search(r"((?:COMMISSION |COUNCIL )?(?:IMPLEMENTING |DELEGATED )?(?:REGULATION|DIRECTIVE|DECISION)\b(?:[^a-z]{0,40}?(?:No )?\d+/\d+(?:/\w+)?)?\s+(?:OF THE EUROPEAN PARLIAMENT AND OF THE COUNCIL\s+)?of \d{1,2} \w+ \d{4}.{5,260}?)(?= \(Text with EEA| THE EUROPEAN| THE COMMISSION| THE COUNCIL| HAVE ADOPTED|\(\d\))", t, re.I)
    if m:
        title = m.group(1).strip()
        title = title[0] + title[1:]  # keep case as in OJ
        r["title"] = re.sub(r"^((?:[A-Z]+ ){1,4})", lambda x: x.group(1).title(), title)[:300]
csv.DictWriter(open(p, "w", encoding="utf-8", newline=""), cols, delimiter="\t", lineterminator="\n").writeheader() if False else None
with open(p, "w", encoding="utf-8", newline="") as fh:
    w = csv.DictWriter(fh, cols, delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(rows)
print(sum(1 for r in rows if " of " in r["title"]), "of", len(rows), "titled")
