#!/usr/bin/env python3
"""trv_crawl.py [--refresh]  – downloads Bane NOR's Teknisk regelverk (TRV) from https://trv.banenor.no

Run from the repository root:   python3 -I tools/trv_crawl.py
Writes
  08_Norway/Bane_NOR/Teknisk_regelverk/<NNN>_<Book>/<NNN>_<CC>_<Chapter>.html   one clean HTML file per page
  08_Norway/Bane_NOR/Teknisk_regelverk/<NNN>_<Book>/Vedlegg/<file>             document attachments (PDF, xlsx …)
  tools/data/banenor_trv.tsv               catalogue rows (merged by finalize.sh)
  tools/data/banenor_trv_requirements.tsv  one row per requirement TRV:NNNNN, with its local anchor
The wiki's API and /w/ are closed to robots, so pages are read from /wiki/ (allowed by robots.txt).
Pages already downloaded are skipped unless --refresh (metadata is re-read from the saved files)."""
import csv, difflib, hashlib, html, json, os, re, subprocess, sys, time, unicodedata, urllib.parse as up
from collections import Counter

BASE = "https://trv.banenor.no"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REL = "08_Norway/Bane_NOR/Teknisk_regelverk"
OUT = os.path.join(ROOT, REL)
DATA = os.path.join(ROOT, "tools", "data")
REFRESH = "--refresh" in sys.argv
DOC_EXT = (".pdf", ".xls", ".xlsx", ".xlsm", ".doc", ".docx", ".dwg", ".dxf", ".zip", ".ppt", ".pptx", ".txt", ".csv")
MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "mai": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "okt": 10, "nov": 11, "des": 12,
          "may": 5, "oct": 10, "dec": 12}

_last = [0.0]
def get(url, binary=False):
    for attempt in range(4):
        wait = 1.0 - (time.time() - _last[0])
        if wait > 0: time.sleep(wait)
        _last[0] = time.time()
        # curl (not urllib): python.org builds on macOS often lack a CA bundle; download_all.sh uses curl too
        r = subprocess.run(["curl", "-sS", "-L", "--fail", "--max-time", "90", "-A", UA, url], capture_output=True)
        if r.returncode == 0:
            return r.stdout if binary else r.stdout.decode("utf-8", "replace")
        err = r.stderr.decode("utf-8", "replace").strip()
        if "404" in err: break
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{url}: {err}")


def ascii_name(s, maxlen=70):
    s = s.replace("æ", "ae").replace("Æ", "Ae").replace("ø", "o").replace("Ø", "O").replace("å", "a").replace("Å", "A")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[\s/]+", "_", s.strip())
    s = re.sub(r"[^A-Za-z0-9_.-]", "", s)
    return re.sub(r"_+", "_", s).strip("_.")[:maxlen].rstrip("_")


def wiki_title(href):
    """'/wiki/Signal/Prosjektering#x' -> 'Signal/Prosjektering' (unquoted, spaces as _)."""
    p = up.urlsplit(html.unescape(href)).path
    return up.unquote(p[len("/wiki/"):]) if p.startswith("/wiki/") else None


def content_of(page):
    i = page.find('<div id="mw-content-text"')
    if i < 0: return ""
    j = page.find('<div class="printfooter"', i)
    if j < 0: j = page.find("<!--esi", i)
    if j < 0: j = page.find('id="catlinks"', i)
    body = page[i:j] if j > 0 else page[i:]
    body = body[body.find(">") + 1:]
    body = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", body)
    body = re.sub(r"(?is)<!--.*?-->", "", body)
    body = re.sub(r'(?is)<input[^>]*toctogglecheckbox[^>]*>', "", body)
    return body


def meta_of(page):
    m = re.search(r'"wgRevisionId":(\d+)', page)
    rev = m.group(1) if m else ""
    m = re.search(r"sist redigert\s+(\d{1,2})\.\s*([a-zæøå]+)\.?\s+(\d{4})", page, re.I)
    date = ""
    if m and m.group(2)[:3].lower() in MONTHS:
        date = f"{int(m.group(3)):04d}-{MONTHS[m.group(2)[:3].lower()]:02d}-{int(m.group(1)):02d}"
    approved = "approved" if re.search(r"godkjente sideversjonen", page) else ("draft" if re.search(r"ikke godkjent|venter på godkjenning|utkast", page[:page.find('id="mw-content-text"')] if 'id="mw-content-text"' in page else "", re.I) else "")
    m = re.search(r"<title>(.*?)</title>", page, re.S)
    t = html.unescape(m.group(1)).split(" – ")[0].strip() if m else ""
    return {"rev": rev, "date": date, "approved": approved, "pagetitle": t}


# ------------------------------------------------------------------ fetching (raw pages cached in .build/, git-ignored)
RAW = os.path.join(ROOT, ".build", "trv_raw")
SKIP_NS = re.compile(r"^(TRV|FIGUR|TABELL|Fil|File|Media|Spesial|Special|Kategori|Category|Mal|Template|Hjelp|Help|Teknisk_regelverk|Bruker|User|Diskusjon)\b[:_]", re.I)


def norm(t):
    t = t.replace(" ", "_").strip("_")
    return t[:1].upper() + t[1:]


def fetch_page(t):
    os.makedirs(RAW, exist_ok=True)
    p = os.path.join(RAW, hashlib.sha1(t.encode()).hexdigest()[:16] + ".html")
    if os.path.exists(p) and not REFRESH:
        return open(p, encoding="utf-8").read()
    raw = get(BASE + "/wiki/" + up.quote(t, safe="/:,()'!"))
    open(p, "w", encoding="utf-8").write(raw)
    return raw


def canonical(raw, t):
    m = re.search(r'"wgPageName":"((?:[^"\\]|\\.)*)"', raw)
    return norm(json.loads('"' + m.group(1) + '"')) if m else t


# ------------------------------------------------------------------ discovery
def discover():
    """books {NNN: book page title}, entries [(NNN, kind, cc, title)] with kind book|chapter|log, from /wiki/Innhold."""
    body = content_of(fetch_page("Innhold"))
    seq = []
    for h in re.findall(r'<a [^>]*href="(/wiki/[^"]+)"', body):
        t = wiki_title(h)
        if t and (not seq or seq[-1] != norm(t)): seq.append(norm(t))
    books, entries, logs = {}, [], []
    for i, t in enumerate(seq):
        nxt = seq[i + 1] if i + 1 < len(seq) else None
        if re.fullmatch(r"\d{3}", t) and nxt:
            books.setdefault(t, nxt)
        elif (m := re.fullmatch(r"(\d{3})/(\d{1,2})", t)) and nxt:
            entries.append((m.group(1), "chapter", f"{int(m.group(2)):02d}", nxt))
        elif t.startswith("Endringslogg"):
            logs.append(t)
    # 590 (rolling stock, English) is one long page with appendix subpages
    books["590"] = "Rolling_stock/Supplementary_information_and_regulations"
    entries = [e for e in entries if e[0] != "590"]
    entries = [(b, "book", "00", t) for b, t in books.items()] + entries
    for lg in dict.fromkeys(logs):   # a change log belongs to the book whose page title it resembles most
        key = lg[len("Endringslogg_"):]
        b = max(books, key=lambda b: difflib.SequenceMatcher(None, key.lower(), books[b].lower()).ratio())
        entries.append((b, "log", "99", lg))
    entries.append(("590", "appendix", "90", "Rolling_stock/Characteristics_of_the_infrastructure/Signalling_and_train_control_system"))
    return books, entries


# ------------------------------------------------------------------ main
def main():
    books, entries = discover()
    order = sorted(books)
    areas = {books[b].split("/")[0] for b in books} | {"Rolling_stock"}
    folder_of = {b: f"{b}_{ascii_name(books[b], 60)}" for b in books}

    plan, by_title, used = [], {}, set()   # plan item: dict(b, kind, cc, title, folder, fn)

    def add(b, kind, cc, t, parent=None):
        t = norm(t)
        if t in by_title: return None
        if kind == "book": name = ascii_name(books[b].replace("/", " "), 60)
        elif kind == "log": name = "Endringslogg"
        elif kind == "chapter": name = ascii_name(t.split("/")[-1], 60)
        else:  # appendix: name after the chapter (or book) it hangs under
            base = parent or books[b]
            rest = t[len(base):].strip("/") if t.startswith(base) else t.split("/", 1)[-1]
            name = "V_" + ascii_name(rest.replace("Vedlegg/", ""), 60)
        fn = f"{b}_{cc}_{name}.html"
        n = 2
        while (folder_of[b], fn) in used:
            fn = f"{b}_{cc}_{name}_{n}.html"; n += 1
        used.add((folder_of[b], fn))
        it = {"b": b, "kind": kind, "cc": cc, "title": t, "folder": folder_of[b], "fn": fn}
        plan.append(it); by_title[t] = it
        return it

    for b, kind, cc, t in entries: add(b, kind, cc, t)

    # crawl: Innhold pages first, then appendix / sub pages they link to inside the rulebook
    raw_of, fails, i = {}, [], 0
    while i < len(plan):
        it = plan[i]; i += 1
        try:
            raw = fetch_page(it["title"])
        except Exception as e:
            fails.append((it["title"], str(e))); print("FAIL", it["title"], e, file=sys.stderr); continue
        canon = canonical(raw, it["title"])
        if canon != it["title"] and canon in by_title and by_title[canon] is not it:
            it["alias_of"] = by_title[canon]; continue          # redirect to a page we already have
        by_title.setdefault(canon, it)
        raw_of[it["title"]] = raw
        print(f"{len(raw_of):4d} {it['title']}", flush=True)
        if it["kind"] == "log": continue
        for h in re.findall(r'href="(/wiki/[^"#]+)', content_of(raw)):
            t = wiki_title(h)
            if not t: continue
            t = norm(t)
            if t in by_title or SKIP_NS.match(t) or "/" not in t or t.split("/")[0] not in areas: continue
            if re.fullmatch(r"\d{3}(/\d+)?", t): continue
            area = t.split("/")[0]
            same_area = it["b"] if books[it["b"]].split("/")[0] == area else min((b for b in books if books[b].split("/")[0] == area), default=it["b"])
            owner = max((b for b in books if t.startswith(books[b] + "/")), key=lambda b: len(books[b]), default=same_area)
            chap = max((p for p in plan if p["b"] == owner and p["kind"] == "chapter" and t.startswith(p["title"] + "/")),
                       key=lambda p: len(p["title"]), default=None)
            add(owner, "appendix", chap["cc"] if chap else "90", t, chap["title"] if chap else None)

    # requirement id -> page that defines it (first chapter/appendix page carrying it)
    req_home = {}
    for it in plan:
        if it["title"] in raw_of and it["kind"] != "log":
            # a requirement is defined where its label is bold italic; plain "se TRV:NNNNN" links are citations
            for rid in re.findall(r'href="/wiki/TRV:(\d+)"[^>]*>\s*<i>\s*<b>', content_of(raw_of[it["title"]])):
                req_home.setdefault(rid, it)

    attachments = {}   # file url -> (folder, relname, url) or None

    def attachment_for(h, it):
        url = up.urljoin(BASE + "/", h)
        sp = up.urlsplit(url)
        if sp.netloc != "trv.banenor.no": return None
        path, fname = up.unquote(sp.path), None
        if (path.startswith("/PDF/") or (path.startswith("/w/images/") and "/thumb/" not in path)) and path.lower().endswith(DOC_EXT):
            fname, furl = path.rsplit("/", 1)[1], url
        else:
            t = wiki_title(h) or up.parse_qs(sp.query).get("title", [""])[0]
            if re.match(r"(Fil|File|Media):", t or "") and t.lower().endswith(DOC_EXT):
                fname, furl = t.split(":", 1)[1], None
        if not fname: return None
        key = furl or "Fil:" + fname
        if key in attachments: return attachments[key]
        if furl is None:
            try:
                m = re.search(r'href="(/w/images/[^"]+)"', fetch_page("Fil:" + norm(fname)))
                furl = up.urljoin(BASE, html.unescape(m.group(1))) if m else None
            except Exception as e:
                fails.append((fname, str(e)))
            if not furl:
                attachments[key] = None; return None
        m = re.match(r"/PDF/[^/]+/(\d{3})/", path)
        b = m.group(1) if m and m.group(1) in books else it["b"]
        stem, ext = os.path.splitext(fname)
        local = ascii_name(stem, 90) + ext.lower()
        taken = {v[1] for v in attachments.values() if v and v[0] == folder_of[b]}
        n = 2
        while "Vedlegg/" + local in taken:
            local = f"{ascii_name(stem, 90)}_{n}{ext.lower()}"; n += 1
        dest = os.path.join(OUT, folder_of[b], "Vedlegg", local)
        if not os.path.exists(dest) or REFRESH:
            try:
                data = get(furl, binary=True)
            except Exception as e:
                fails.append((furl, str(e))); attachments[key] = None; return None
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(data)
            print("     vedlegg", furl, flush=True)
        attachments[key] = (folder_of[b], "Vedlegg/" + local, furl, b)
        return attachments[key]

    def title_of(it):
        b, bt = it["b"], books[it["b"]].replace("_", " ")
        leaf = it["title"].split("/")[-1].replace("_", " ")
        en = b == "590"
        tr = "Technical rules (TRV)" if en else "Teknisk regelverk"
        if it["kind"] == "book": return f"{tr} {b} {bt}", f"TRV {b}"
        if it["kind"] == "log": return f"{tr} {b} {bt} – endringslogg", f"TRV {b} endringslogg"
        if it["kind"] == "chapter": return f"{tr} {b} {bt} – kap. {int(it['cc'])} {leaf}", f"TRV {b} kap. {int(it['cc'])}"
        ch = f" kap. {int(it['cc'])}" if it["cc"] != "90" else ""
        lab = leaf if re.match(r"(?i)(appendix|vedlegg)\b", leaf) else f"{'appendix' if en else 'vedlegg'}: {leaf}"
        return f"{tr} {b} {bt}{ch} – {lab}", f"TRV {b}{ch} {'appendix' if en else 'vedlegg'}"

    rows, reqs = [], []
    for it in plan:
        if it["title"] not in raw_of: continue
        raw, folder = raw_of[it["title"]], it["folder"]
        meta, body = meta_of(raw), content_of(raw)
        url = BASE + "/wiki/" + up.quote(it["title"], safe="/:,()'!")
        link_text = {}
        for h_, txt in re.findall(r'<a [^>]*href="([^"]+)"[^>]*>(.*?)</a>', body, re.S):
            txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", txt))).strip()
            if txt: link_text.setdefault(html.unescape(h_), txt)
        my_atts = []

        def rel(tgt):
            tgt = tgt.get("alias_of", tgt)
            if tgt is it: return ""
            return tgt["fn"] if tgt["folder"] == folder else f"../{tgt['folder']}/{tgt['fn']}"

        def fix_href(m):
            h = html.unescape(m.group(1))
            if h.startswith(("#", "mailto:", "javascript:")): return m.group(0)
            a = attachment_for(h, it)
            if a:
                my_atts.append((a, link_text.get(h, "")))
                return 'href="' + html.escape(a[1] if a[0] == folder else f"../{a[0]}/{a[1]}") + '"'
            wt = wiki_title(h) if h.startswith("/") or h.startswith(BASE + "/wiki/") else None
            if h.startswith(BASE + "/wiki/"): wt = wiki_title(h[len(BASE):])
            if wt is not None:
                wt, frag = norm(wt), up.urlsplit(h).fragment
                if (m2 := re.fullmatch(r"TRV:(\d+)", wt)) and m2.group(1) in req_home:
                    return f'href="{html.escape(rel(req_home[m2.group(1)]))}#TRV-{m2.group(1)}"'
                if m2 := re.fullmatch(r"(\d{3})(?:/(\d{1,2}))?", wt):
                    cc2 = f"{int(m2.group(2)):02d}" if m2.group(2) else "00"
                    hit = next((p for p in plan if p["b"] == m2.group(1) and p["cc"] == cc2 and p["kind"] in ("book", "chapter")), None)
                    if hit: wt = hit["title"]
                if wt in by_title:
                    return f'href="{html.escape(rel(by_title[wt]))}{("#" + frag) if frag else ""}"'
            return f'href="{html.escape(up.urljoin(BASE + "/", h))}"'

        body = re.sub(r'\bhref="([^"]*)"', fix_href, body)
        body = re.sub(r'\bsrc="(/[^"]*)"', lambda m: f'src="{BASE}{m.group(1)}"', body)
        body = re.sub(r'\bsrcset="([^"]*)"', lambda m: 'srcset="' + re.sub(r"(^|,\s*)/", r"\g<1>" + BASE + "/", m.group(1)) + '"', body)
        # every requirement label gets an anchor id="TRV-NNNNN" (once per file)
        seen_ids = set()
        def anchor(m):
            rid = m.group(2)
            if rid in seen_ids: return m.group(0)
            seen_ids.add(rid)
            return f'<a id="TRV-{rid}" {m.group(1)}'
        body = re.sub(r'<a (href="[^"]*(?:#TRV-|/wiki/TRV:)(\d+)"[^>]*>)(?=\s*<i>\s*<b>)', anchor, body)

        nreq = 0
        if it["kind"] != "log":
            counters, section, cur = [0] * 6, "", None
            def flush(cur):
                if cur:
                    txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cur[1])))
                    txt = re.sub(r"\s+", " ", re.sub(r"</?[a-zA-Z][^>]*>", " ", txt))
                    txt = re.sub(r"^\s*TRV:\d+\s*", "", txt).strip()
                    reqs.append({"req_id": "TRV:" + cur[0], "folder": f"{REL}/{folder}", "filename": it["fn"], "anchor": "TRV-" + cur[0],
                                 "section": cur[2], "text": txt[:300]})
            toc = {html.unescape(i_): n_ for i_, n_ in re.findall(r'<a href="#([^"]+)"><span class="tocnumber">([\d.]+)</span>', body)}
            parts = re.split(r'(<h[1-5][^>]*>.*?</h[1-5]>|<a id="TRV-\d+"[^>]*>)', body, flags=re.S)
            for tok in parts:
                if hm := re.match(r"<h([1-5])[^>]*>(.*?)</h\1>", tok, re.S):
                    head = html.unescape(re.sub(r"<[^>]+>", "", hm.group(2))).strip()
                    if head.lower() in ("innhold", "contents"): continue
                    flush(cur); cur = None
                    lvl = int(hm.group(1)) - 1
                    counters[lvl] += 1
                    for x in range(lvl + 1, 6): counters[x] = 0
                    hid = re.search(r'id="([^"]+)"', hm.group(2))
                    num = toc.get(html.unescape(hid.group(1))) if hid else None
                    section = (num or ".".join(str(c) for c in counters[:lvl + 1] if c)) + " " + head
                elif rm := re.match(r'<a id="TRV-(\d+)"', tok):
                    flush(cur); cur = [rm.group(1), "", section]; nreq += 1
                elif cur is not None:
                    cur[1] += tok
            flush(cur)

        title, ref = title_of(it)
        lang = "en" if it["b"] == "590" else "no"
        head = (f'Bane NOR · Teknisk regelverk · source: <a href="{html.escape(url)}">{html.escape(url)}</a>'
                + (f' · permalink: <a href="{BASE}/w/index.php?title={up.quote(it["title"])}&amp;oldid={meta["rev"]}">oldid {meta["rev"]}</a>' if meta["rev"] else "")
                + (f' · last edited {meta["date"]}' if meta["date"] else "")
                + (" · approved version" if meta["approved"] == "approved" else ""))
        doc = (f'<!doctype html><html lang="{lang}"><head><meta charset="utf-8"><title>{html.escape(title)} (Bane NOR)</title>'
               f'<link rel="canonical" href="{html.escape(url)}"><style>body{{font:15px/1.45 system-ui,sans-serif;max-width:62em;margin:1.5em auto;padding:0 1em}}'
               f'.trv-src{{font-size:13px;color:#555;border-bottom:1px solid #ccc;padding-bottom:.6em;margin-bottom:1em}}.trv-src h1{{font-size:22px;color:#111}}'
               f'img{{max-width:100%;height:auto}}table{{border-collapse:collapse}}td,th{{border:1px solid #ccc;padding:2px 6px}}:target{{background:#ffef9e}}</style></head><body>'
               f'<div class="trv-src"><h1>{html.escape(title)}</h1>{head}</div>\n{body}\n</body></html>\n')
        dest = os.path.join(OUT, folder, it["fn"])
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if REFRESH or not os.path.exists(dest) or open(dest, encoding="utf-8").read() != doc:
            open(dest, "w", encoding="utf-8").write(doc)
        status = ("in force" if meta["approved"] == "approved" else "published") + (f"; last edited {meta['date']}" if meta["date"] else "")
        if re.search(r"(kapittelet|siden|vedlegget|boken) er utgått", re.sub(r"<[^>]+>", " ", body[:3000]), re.I):
            status = "superseded (marked 'utgått' by Bane NOR)" + (f"; last edited {meta['date']}" if meta["date"] else "")
        notes = "Bane NOR Teknisk regelverk" + (f"; oldid {meta['rev']}" if meta["rev"] else "") + (f"; {nreq} requirements" if nreq else "")
        if not re.sub(r"<[^>]+>|\s", "", body): notes += "; page is empty on trv.banenor.no"
        rows.append({"folder": f"{REL}/{folder}", "filename": it["fn"], "title": title, "reference": ref, "date_or_status": status, "url": url, "notes": notes})
        for (af, afn, aurl, ab), txt in my_atts:
            txt = re.sub(r"^(Fil|File|Media):", "", txt or "").strip()
            stem = os.path.splitext(os.path.basename(afn))[0]
            nm = txt if re.search(r"[A-Za-zÆØÅæøå]{3}", re.sub(r"\.(pdf|docx?|xlsx?|xlsm|zip|dwg|dxf|pptx?)\b|\b(pdf|docx?|xlsx?|zip)\b", "", txt, flags=re.I)) and not txt.startswith("http") else stem
            rows.append({"folder": f"{REL}/{af}", "filename": afn, "title": f"Teknisk regelverk {ab} {books[ab].replace('_', ' ')} – vedlegg: {nm}",
                         "reference": f"TRV {ab} vedlegg", "date_or_status": "attachment", "url": aurl,
                         "notes": f"Attachment linked from {ref} ({it['title'].split('/')[-1].replace('_', ' ')})"})

    seen, out_rows = set(), []
    for r in rows:
        if (r["folder"], r["filename"]) not in seen:
            seen.add((r["folder"], r["filename"])); out_rows.append(r)
    out_rows.sort(key=lambda r: (r["folder"], r["filename"]))
    dup = Counter(r["title"] for r in out_rows)
    for r in out_rows:
        if dup[r["title"]] > 1 and r["date_or_status"] == "attachment":
            r["title"] += f" ({os.path.basename(r['filename'])})"
    cols = ["folder", "filename", "title", "reference", "date_or_status", "url", "notes"]
    with open(os.path.join(DATA, "banenor_trv.tsv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, cols, delimiter="\t", lineterminator="\n"); w.writeheader(); w.writerows(out_rows)
    with open(os.path.join(DATA, "banenor_trv_requirements.tsv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, ["req_id", "folder", "filename", "anchor", "section", "text"], delimiter="\t", lineterminator="\n")
        w.writeheader(); w.writerows(sorted(reqs, key=lambda r: (r["req_id"], r["folder"], r["filename"])))
    kinds = Counter(it["kind"] for it in plan if it["title"] in raw_of and "alias_of" not in it)
    print(f"books={len(books)} pages={sum(kinds.values())} {dict(kinds)} attachments={sum(1 for v in attachments.values() if v)} "
          f"requirements={len({r['req_id'] for r in reqs})} failures={len(fails)}")
    for f_ in fails: print("  failed:", *f_)


if __name__ == "__main__":
    main()
