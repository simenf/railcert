#!/usr/bin/env python3
"""validate_celex.py <nodes.tsv> <out celex_check.tsv>
Asks the Publications Office SPARQL endpoint which cited CELEX numbers exist. For a number that does not exist,
tries the usual extraction slips (a footnote digit glued on, a dropped digit) and prints candidate repairs; the repair column is filled in by hand.
Results are cached in tools/data/celex_check.tsv so builds stay offline."""
import csv, sys, json, subprocess, os
nodes, out = sys.argv[1], sys.argv[2]
old = {r["celex"]: r for r in csv.DictReader(open(out), delimiter="\t")} if os.path.exists(out) else {}
cel = sorted({n["celex"] for n in csv.DictReader(open(nodes), delimiter="\t") if n["celex"]} - set(old))
EP = "https://publications.europa.eu/webapi/rdf/sparql"
def exist(cs):
    found = set()
    for i in range(0, len(cs), 80):
        vals = ",".join(f'"{c}"^^<http://www.w3.org/2001/XMLSchema#string>' for c in cs[i:i+80])
        q = f"PREFIX cdm: <http://publications.europa.eu/ontology/cdm#> SELECT DISTINCT ?c WHERE {{ ?w cdm:resource_legal_id_celex ?c . FILTER(?c IN ({vals})) }}"
        r = subprocess.run(["curl", "-sS", "-m", "120", "-G", EP, "--data-urlencode", "query=" + q, "-H", "Accept: application/sparql-results+json"], capture_output=True, text=True)
        found |= {b["c"]["value"] for b in json.loads(r.stdout)["results"]["bindings"]}
    return found
ok = exist(cel)
bad = [c for c in cel if c not in ok]
cand = {}
for c in bad:
    y, l, n = c[1:5], c[5], c[6:]
    opts = {n[:-1].rjust(4, "0"), ("0" + n)[-4:]} | ({n[1:].rjust(4, "0")} if n[0] != "0" else set())
    if l in "LD": opts |= {f"{c[0]}{y}{x}{n}" for x in ""}  # placeholder, letters kept
    cand[c] = [f"3{y}{l}{o}" for o in opts if o.strip("0")] + [f"3{y}{x}{n}" for x in "RLD" if x != l]
alts = exist(sorted({a for v in cand.values() for a in v}))
rows = dict(old)
for c in cel:
    rep = ""
    if c in bad:
        hit = [a for a in cand[c] if a in alts]
        if hit: print(f"  {c} does not exist; candidates {hit} (add a repair by hand if one is right)")
    rows[c] = {"celex": c, "exists": "1" if c in ok else "0", "repair": rep}
with open(out, "w") as f:
    f.write("celex\texists\trepair\n")
    for c in sorted(rows): f.write(f"{c}\t{rows[c]['exists']}\t{rows[c]['repair']}\n")
print(f"checked {len(cel)} new, {len(bad)} not on EUR-Lex")
