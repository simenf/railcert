#!/usr/bin/env python3
"""etsi_resolve.py <nodes.tsv> <out.tsv> : find latest published PDF for each referenced ETSI spec."""
import csv, re, sys, subprocess
nodes = list(csv.DictReader(open(sys.argv[1], encoding="utf-8"), delimiter="\t"))
UA = "Mozilla/5.0"

def get(url):
    r = subprocess.run(["curl", "-sSL", "--max-time", "60", "-A", UA, url], capture_output=True)
    return r.stdout.decode("utf-8", "ignore") if r.returncode == 0 else ""

def parse(label):
    m = re.match(r"(?:ETSI\s+)?(TS|EN|TR|ES)\s+(\d{3})\s?(\d{3})((?:-\d+)*)$", label.replace("STD:", "").replace("ETSI ", "ETSI "))
    if not m: return None
    return m.group(1), m.group(2) + m.group(3), m.group(4)

seen = {}
for n in nodes:
    lab = n["label"]
    if not (n["type"] == "ETSI spec" or re.match(r"EN 3\d\d ?\d{3}", lab)): continue
    p = parse(lab)
    if not p: continue
    seen.setdefault(p, []).append(n["target_id"])

out = open(sys.argv[2], "w", encoding="utf-8")
out.write("folder\tfilename\ttitle\treference\tdate_or_status\turl\tnotes\tmatched_ids\n")
for (kind, num, parts), ids in sorted(seen.items()):
    k = kind.lower(); lo = int(num) // 100 * 100
    base = f"https://www.etsi.org/deliver/etsi_{k}/{lo:06d}_{lo+99:06d}/{num}{parts.replace('-', '')}/"
    if parts:  # multipart: directory is number + part digits e.g. 30001901 for 300 019-1-4 -> try zero padded
        segs = [int(x) for x in parts.strip("-").split("-")]
        cand = [f"{num}{''.join(f'{s:02d}' for s in segs)}", f"{num}{''.join(str(s) for s in segs)}"]
    else:
        cand = [num]
    pdf = ver = None
    for c in cand:
        d = f"https://www.etsi.org/deliver/etsi_{k}/{lo:06d}_{lo+99:06d}/{c}/"
        h = get(d)
        vers = re.findall(r'HREF="(/deliver/[^"]+/(\d\d\.\d\d\.\d\d)_(\d\d)/)"', h, re.I)
        # prefer published (_60) over drafts
        vers = sorted([v for v in vers if v[2] in ("60", "40")], key=lambda v: v[1])
        if not vers: continue
        path, ver, _ = vers[-1]
        h2 = get("https://www.etsi.org" + path)
        pdfs = re.findall(r'HREF="(/deliver/[^"]+\.pdf)"', h2, re.I)
        if pdfs:
            pdf = "https://www.etsi.org" + pdfs[0]; break
    label = f"ETSI {kind} {num[:3]} {num[3:]}{parts}"
    fn = f"ETSI_{kind}_{num}{parts}_v{ver}.pdf" if pdf else f"ETSI_{kind}_{num}{parts}.url.txt"
    url = pdf or f"https://www.etsi.org/standards-search#search={kind}%20{num}"
    note = "latest published version (auto-resolved from ETSI deliver directory)" if pdf else "NOT FOUND in ETSI deliver directory – search manually"
    out.write(f"09_Referenced_Documents/ETSI\t{fn}\t{label}\t{label}\t{ver or ''}\t{url}\t{note}\t{';'.join(ids)}\n")
    print(label, ver, bool(pdf))
