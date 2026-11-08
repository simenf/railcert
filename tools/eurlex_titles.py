#!/usr/bin/env python3
"""eurlex_titles.py <tsv> : set title of every row with a CELEX URL from EUR-Lex WT.z_docTitle (parallel)."""
import csv, re, sys, subprocess, html, concurrent.futures as cf
p = sys.argv[1]
rows = list(csv.DictReader(open(p, encoding="utf-8"), delimiter="\t")); cols = list(rows[0].keys())
def title(c):
    r = subprocess.run(["curl", "-sSL", "--max-time", "60", "-A", "Mozilla/5.0", f"https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:{c}"], capture_output=True)
    m = re.search(r'WT\.z_docTitle" content="([^"]+)"', r.stdout.decode("utf-8", "ignore"))
    if not m: return None
    t = html.unescape(m.group(1)).strip()
    t = re.sub(r"^((?:COMMISSION |COUNCIL )?(?:IMPLEMENTING |DELEGATED )?(?:REGULATION|DIRECTIVE|DECISION))", lambda x: x.group(1).title(), t)
    return t.replace("OF THE EUROPEAN PARLIAMENT AND OF THE COUNCIL", "of the European Parliament and of the Council")
todo = {i: re.search(r"CELEX:([0-9A-Z]+)", r["url"]).group(1) for i, r in enumerate(rows) if "CELEX:" in r["url"]}
with cf.ThreadPoolExecutor(6) as ex:
    res = dict(zip(todo, ex.map(title, todo.values())))
n = 0
for i, t in res.items():
    if t: rows[i]["title"] = t; n += 1
    elif rows[i]["title"].startswith("CELEX"): rows[i]["title"] = rows[i]["reference"]
with open(p, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, cols, delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(rows)
print(n, "of", len(todo), "titled")
