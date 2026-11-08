#!/usr/bin/env python3
"""era_crawl.py <out.tsv> <set_name>=<folder_url> ...
Recursively crawls ERA 'era-folder' pages and lists every file (title, url, size hint, folder path)."""
import re, sys, html, time, subprocess
from urllib.parse import urljoin, unquote

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
def get(url, tries=4):
    for i in range(tries):
        r = subprocess.run(["curl", "-sSL", "--max-time", "60", "-A", UA, "-w", "\n%{http_code}", url], capture_output=True)
        body, _, code = r.stdout.decode("utf-8", "ignore").rpartition("\n")
        if code == "200": return body
        time.sleep(6 * (i + 1))
    print("FAILED", url, code, file=sys.stderr); return ""

def clean(t): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip()

out = open(sys.argv[1], "w", encoding="utf-8")
out.write("set\tsubfolder\ttitle\turl\tsize\n")
for arg in sys.argv[2:]:
    name, root = arg.split("=", 1)
    seen, queue = set(), [(root, "")]
    while queue:
        url, path = queue.pop(0)
        if url in seen: continue
        seen.add(url); time.sleep(3)
        s = get(url)
        if not s: continue
        main = s[s.find("<main"):] if "<main" in s else s
        # drop header/footer navigation links outside the folder listing
        main = re.split(r'<footer', main)[0]
        n_files = 0
        # file rows: anchors to files with visible text
        for m in re.finditer(r'<a[^>]+href="([^"]+\.(?:pdf|zip|docx?|xlsx?|xlsm|txt|7z|rar)(?:\?[^"]*)?)"[^>]*>(.*?)</a>', main, re.S | re.I):
            u = urljoin(url, html.unescape(m.group(1)).split("?")[0])
            t = clean(m.group(2)) or unquote(u.rsplit("/", 1)[-1])
            tail = main[m.end():m.end() + 500]; tail = tail.split("<a ")[0]
            sz = re.search(r"(\d+(?:[.,]\d+)?\s*(?:KB|MB|GB|kB|bytes))", clean(tail))
            out.write(f"{name}\t{path}\t{t}\t{u}\t{sz.group(1) if sz else ''}\n"); n_files += 1
        # sub-folders: era-folder links that are children of this page (not breadcrumb/parents)
        for m in re.finditer(r'<a[^>]+href="(/era-folder/[^"#?]+)"[^>]*>(.*?)</a>', main, re.S):
            u = urljoin(url, m.group(1)); t = clean(m.group(2))
            if u in seen or u == root or not t or "era-root" in u or u.endswith("/ertms"): continue
            if any(u == q for q, _ in queue): continue
            if "archived-set" in u and not u.startswith(root) and name not in u and root not in u:
                # links to sibling sets – skip
                if u.split("/")[-1] != root.split("/")[-1]: continue
            if "set-specifications" in u and u != root: continue   # sibling set
            if re.search(r"/era-folder/(\d-ccs-tsi|ertms$)", u): continue
            queue.append((u, (path + "/" if path else "") + t[:60]))
        print(f"{name} | {path or '(root)'} : {n_files} files, queue {len(queue)}", file=sys.stderr)
        out.flush()
