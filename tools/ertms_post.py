#!/usr/bin/env python3
"""ertms_post.py <library_root> <ertms_sets.tsv> <status.tsv>
1. Oversized / failed downloads -> link files (.url.txt) in the set folder, rows rewritten in ertms_sets.tsv.
2. Identical files across the set folders -> hard links (stored once).
3. Loose copies in 07_ERTMS_Specifications/ (root) and 09_Referenced_Documents/ERTMS_Subsets that are identical
   to a file in a set folder -> removed (listed in removed_duplicates.txt)."""
import csv, hashlib, os, sys
from collections import defaultdict
root, tsv, status = sys.argv[1:4]
SETDIRS = ["Set4_ETCS_B4_R1_current", "Informative_specs", "Set3_ETCS_B3_R2", "Set2_ETCS_B3_MR1", "Set1_ETCS_B2"]
E = os.path.join(root, "07_ERTMS_Specifications")

# 1. failed -> link rows
st = {}
for line in open(status, encoding="utf-8"):
    p = line.rstrip("\n").split("\t")
    if len(p) >= 4 and p[1].startswith("07_ERTMS_Specifications/Set") or (len(p) >= 4 and "Informative_specs" in p[1]):
        st[(p[1], p[2])] = (p[0], p[4] if len(p) > 4 else "")
rows = list(csv.DictReader(open(tsv, encoding="utf-8"), delimiter="\t")); cols = list(rows[0].keys())
nlink = 0
for r in rows:
    s = st.get((r["folder"], r["filename"]))
    if s and s[0] in ("FAIL", "NOTPDF") and not r["filename"].endswith(".url.txt"):
        big = "Maximum file size" in s[1] or "maximum file size" in s[1].lower()
        r["notes"] = ("Not downloaded: larger than 150 MB – open the link to download. " if big else f"Not downloaded ({s[1][:80]}) – open the link. ") + r["notes"]
        r["filename"] = os.path.splitext(r["filename"])[0] + ".url.txt"
        d = os.path.join(root, r["folder"]); os.makedirs(d, exist_ok=True)
        open(os.path.join(d, r["filename"]), "w", encoding="utf-8").write(f"{r['title']}\n{r['reference']}\n{r['url']}\n{r['notes']}\n")
        nlink += 1
with open(tsv, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, cols, delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(rows)

def h(p):
    x = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): x.update(b)
    return x.hexdigest()

# 2. hard-link identical files across set folders
byhash = defaultdict(list)
for sd in SETDIRS:
    d = os.path.join(E, sd)
    if not os.path.isdir(d): continue
    for fn in sorted(os.listdir(d)):
        p = os.path.join(d, fn)
        if os.path.isfile(p) and not fn.endswith(".url.txt"): byhash[h(p)].append(p)
saved = 0; nl = 0
with open(os.path.join(os.path.dirname(tsv), "duplicate_groups.tsv"), "w", encoding="utf-8") as f:
    for k, ps in byhash.items():
        for p in ps[1:]:
            saved += os.path.getsize(p); nl += 1
            f.write(f"{os.path.relpath(ps[0], root)}\t{os.path.relpath(p, root)}\n")

# 3. remove loose duplicates of set files
removed = []
cands = [os.path.join(E, f) for f in os.listdir(E) if os.path.isfile(os.path.join(E, f))]
sub = os.path.join(root, "09_Referenced_Documents", "ERTMS_Subsets")
if os.path.isdir(sub): cands += [os.path.join(sub, f) for f in os.listdir(sub) if os.path.isfile(os.path.join(sub, f))]
for p in cands:
    if p.endswith(".url.txt"): continue
    k = h(p)
    if k in byhash:
        removed.append((os.path.relpath(p, root), os.path.relpath(byhash[k][0], root))); os.remove(p)
with open(os.path.join(os.path.dirname(tsv), "removed_duplicates.txt"), "w", encoding="utf-8") as f:
    for a, b in removed: f.write(f"{a}\t{b}\n")
print(f"link files for oversize/failed: {nlink}; identical copies across sets: {nl} ({saved/1048576:.0f} MB, to be hard-linked on the Mac); loose duplicates removed: {len(removed)}")
