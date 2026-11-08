#!/usr/bin/env python3
"""Parallel downloader: fetch.py <catalogue.tsv> <library_root> [workers]
Writes <root>/_status.tsv with one line per row (status, folder, filename, url, info)."""
import csv, os, sys, subprocess, concurrent.futures as cf

cat, root = sys.argv[1], sys.argv[2]
workers = int(sys.argv[3]) if len(sys.argv) > 3 else 6
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

rows = list(csv.DictReader(open(cat, encoding="utf-8"), delimiter="\t"))

def magic(p):
    try:
        with open(p, "rb") as f: return f.read(8)
    except Exception: return b""

def job(r):
    folder, fn, url = r["folder"].strip(), r["filename"].strip(), r["url"].strip()
    if not url: return ("NOURL", folder, fn, url, "")
    d = os.path.join(root, folder); os.makedirs(d, exist_ok=True)
    dest = os.path.join(d, fn)
    if fn.endswith(".url.txt"):
        with open(dest, "w", encoding="utf-8") as f:
            f.write(f"{r.get('title','')}\n{r.get('reference','')}\n{url}\n{r.get('notes','')}\n")
        return ("LINK", folder, fn, url, "")
    if os.path.exists(dest) and os.path.getsize(dest) > 0 and (not fn.endswith(".pdf") or magic(dest).startswith(b"%PDF")):
        return ("SKIP", folder, fn, url, "")
    import time; time.sleep(float(os.environ.get("FETCH_DELAY", "0")))
    tmp = dest + ".part"
    p = subprocess.run(["curl", "-L", "--fail", "-sS", "--retry", "3", "--retry-delay", "2",
                        "--connect-timeout", "20", "--max-time", "600", "-A", UA,
                        "-H", "Accept-Language: en,nb;q=0.8"] + (["--max-filesize", os.environ["MAXSIZE"]] if os.environ.get("MAXSIZE") else []) + ["-o", tmp, url],
                       capture_output=True, text=True)
    if p.returncode != 0:
        if os.path.exists(tmp): os.remove(tmp)
        return ("FAIL", folder, fn, url, p.stderr.strip()[:200])
    if fn.endswith(".pdf") and not magic(tmp).startswith(b"%PDF"):
        os.replace(tmp, dest + ".notpdf.html")
        return ("NOTPDF", folder, fn, url, "server returned non-PDF")
    os.replace(tmp, dest)
    return ("OK", folder, fn, url, str(os.path.getsize(dest)))

with cf.ThreadPoolExecutor(workers) as ex:
    res = list(ex.map(job, rows))

with open(os.path.join(root, "_status.tsv"), "a", encoding="utf-8") as f:
    for r in res: f.write("\t".join(r) + "\n")
from collections import Counter
print(Counter(r[0] for r in res))
for r in res:
    if r[0] in ("FAIL", "NOTPDF"): print(*r, sep=" | ")
