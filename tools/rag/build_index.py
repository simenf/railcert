#!/usr/bin/env python3
"""build_index.py - index builder for railcert-ask (see worker/CONTRACT.md).

  python3 -I tools/rag/build_index.py [--only <path-prefix>] [--limit N] [--jobs N] [--no-test]

Steps
  1. page-aware text extraction (pdftotext, zip/docx/xlsx/html), cached in .build/rag/text/
     keyed by the source mtime (and EXTRACTOR_VERSION)
  2. structure-aware chunking (Article / Annex / clause numbers / Norwegian section / TRV requirement
     anchors / headings), ~300-900 tokens (tokens ~ chars/4), never across documents or zip members
  3. writes .build/rag/out/: schema.sql, data-NNNN.sql, chunks.jsonl, r2_manifest.tsv, stats.json
  4. self-test: loads schema + data into .build/rag/out/test.sqlite with the sqlite3 CLI and runs
     a few FTS queries (skip with --no-test)

Python 3 stdlib only, plus the pdftotext CLI.
"""
import argparse, csv, html, io, json, os, re, shutil, subprocess, sys, tempfile, time, zipfile
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUILD = os.path.join(ROOT, ".build", "rag")
TEXT_DIR = os.path.join(BUILD, "text")
OUT_DIR = os.path.join(BUILD, "out")
SCHEMA = os.path.join(ROOT, "worker", "schema.sql")
EXTRACTOR_VERSION = 6

MIN_TOK, TARGET_TOK, MAX_TOK = 300, 700, 900
STMT_LIMIT = 80_000            # bytes per INSERT statement (D1 hard limit is 100 KB)
FILE_LIMIT = 25_000_000        # bytes per data-NNNN.sql
MARK = "\x1e"                  # structural marker lines in cached html/docx/xlsx text: \x1eH2\x1fid\x1ftext / \x1eA\x1fanchor
SEP = "\x1f"

csv.field_size_limit(10**9)


def tok(s):
    return (len(s) + 3) // 4


# =====================================================================================
# 1. Text extraction
# =====================================================================================
LIGA = str.maketrans({"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "­": None,
                      " ": " ", " ": " ", " ": " ", " ": " ", " ": " ", "﻿": None})
CTRL = re.compile(r"[\x00-\x08\x0b\x0e-\x1d\x7f]")    # keeps \t \n \x0c(\f) \x1e \x1f


def clean(s):
    return CTRL.sub("", s.translate(LIGA))


def run_pdftotext(path):
    try:
        r = subprocess.run(["pdftotext", "-q", "-enc", "UTF-8", path, "-"], capture_output=True, timeout=900)
    except subprocess.TimeoutExpired:
        return None
    pages = clean(r.stdout.decode("utf-8", "ignore")).split("\f")
    if pages and not pages[-1].strip():
        pages.pop()
    return pages


def docx_text(data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            x = z.read("word/document.xml").decode("utf-8", "ignore")
    except Exception:
        return ""
    out = []
    for p in re.findall(r"<w:p[ >].*?</w:p>|<w:p/>", x, re.S):
        p2 = re.sub(r"<w:tab/>", "\t", p)
        p2 = re.sub(r"<w:br[^>]*/>", "\n", p2)
        t = html.unescape("".join(re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>", p2)) if "<w:t" in p2 else "")
        t = clean(t).strip()
        if not t:
            out.append("")
            continue
        st = re.search(r'<w:pStyle w:val="([^"]+)"', p)
        lvl = None
        if st:
            m = re.search(r"(?i)(?:heading|overskrift|berschrift|titre)\s*(\d)", st.group(1))
            if m:
                lvl = int(m.group(1))
            elif st.group(1).lower() in ("title", "tittel"):
                lvl = 1
        if lvl and len(t) < 200:
            out.append(f"{MARK}H{lvl}{SEP}{SEP}{t}")
        else:
            out.append(t)
    return "\n".join(out)


def cfb_streams(data):
    """minimal OLE2 compound file reader -> {stream name: bytes}"""
    import struct
    if data[:8] != b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return {}
    ss = 1 << struct.unpack_from("<H", data, 0x1E)[0]
    mss = 1 << struct.unpack_from("<H", data, 0x20)[0]
    n_fat, dir_start = struct.unpack_from("<II", data, 0x2C)
    cutoff, minifat_start, n_minifat, difat_start, n_difat = struct.unpack_from("<IIIII", data, 0x38)

    def sector(n):
        o = (n + 1) * ss
        return data[o:o + ss]
    difat = list(struct.unpack_from("<109I", data, 0x4C))
    d = difat_start
    for _ in range(n_difat):
        if d >= 0xFFFFFFFA:
            break
        sec = sector(d)
        vals = struct.unpack_from(f"<{ss // 4}I", sec)
        difat += vals[:-1]
        d = vals[-1]
    fat = []
    for fs in difat[:n_fat]:
        if fs < 0xFFFFFFFA:
            fat += struct.unpack_from(f"<{ss // 4}I", sector(fs))

    def chain(start, table, limit=1 << 20):
        out, n = [], start
        while n < 0xFFFFFFFA and n < len(table) and len(out) < limit:
            out.append(n)
            n = table[n]
        return out
    dirdata = b"".join(sector(n) for n in chain(dir_start, fat))
    entries = []
    for o in range(0, len(dirdata) - 127, 128):
        nl = struct.unpack_from("<H", dirdata, o + 64)[0]
        name = dirdata[o:o + max(0, nl - 2)].decode("utf-16le", "ignore")
        typ = dirdata[o + 66]
        start, size = struct.unpack_from("<II", dirdata, o + 116)
        entries.append((name, typ, start, size))
    if not entries:
        return {}
    root = entries[0]
    ministream = b"".join(sector(n) for n in chain(root[2], fat))
    minifat = []
    for n in chain(minifat_start, fat):
        minifat += struct.unpack_from(f"<{ss // 4}I", sector(n))
    out = {}
    for name, typ, start, size in entries[1:]:
        if typ != 2:
            continue
        if size < cutoff:
            b = b"".join(ministream[n * mss:(n + 1) * mss] for n in chain(start, minifat))
        else:
            b = b"".join(sector(n) for n in chain(start, fat))
        if name not in out or size > len(out[name]):     # embedded objects carry their own streams; keep the main (largest)
            out[name] = b[:size]
    return out


def doc_text(data):
    """Word 97-2003 .doc main text via the piece table (no formatting)"""
    import struct
    try:
        st = cfb_streams(data)
        wd = st.get("WordDocument")
        if not wd or struct.unpack_from("<H", wd, 0)[0] != 0xA5EC:
            return ""
        flags = struct.unpack_from("<H", wd, 0x0A)[0]
        if flags & 0x0100:
            return ""                                           # encrypted
        table = st.get("1Table" if flags & 0x0200 else "0Table")
        ccp_text = struct.unpack_from("<i", wd, 0x4C)[0]
        fc_clx, lcb_clx = struct.unpack_from("<II", wd, 0x1A2)
        clx = table[fc_clx:fc_clx + lcb_clx] if table else b""
        i, pcdt = 0, None
        while i < len(clx):
            if clx[i] == 1:
                i += 3 + struct.unpack_from("<H", clx, i + 1)[0]
            elif clx[i] == 2:
                lcb = struct.unpack_from("<I", clx, i + 1)[0]
                pcdt = clx[i + 5:i + 5 + lcb]
                break
            else:
                break
        parts = []
        if pcdt:
            n = (len(pcdt) - 4) // 12
            cps = struct.unpack_from(f"<{n + 1}I", pcdt, 0)
            left = ccp_text
            for k in range(n):
                if left <= 0:
                    break
                fc = struct.unpack_from("<I", pcdt, 4 * (n + 1) + 8 * k + 2)[0]
                ln = min(cps[k + 1] - cps[k], left)
                left -= ln
                if fc & 0x40000000:
                    o = (fc & ~0x40000000) // 2
                    parts.append(wd[o:o + ln].decode("cp1252", "ignore"))
                else:
                    parts.append(wd[fc:fc + 2 * ln].decode("utf-16le", "ignore"))
        t = "".join(parts)
        for _ in range(3):
            t = re.sub("\x13[^\x13\x14\x15]*\x14", "", t)
            t = re.sub("\x13[^\x13\x14\x15]*\x15", "", t)
        t = t.replace("\x15", "").replace("\x07", " | \n").replace("\r", "\n").replace("\x0b", "\n").replace("\x0c", "\n")
        return clean(t)
    except Exception:
        return ""


def xlsx_text(data, max_chars=300_000):
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except Exception:
        return ""
    names = set(z.namelist())

    def rd(n):
        return z.read(n).decode("utf-8", "ignore") if n in names else ""
    shared = []
    for si in re.findall(r"<si>(.*?)</si>", rd("xl/sharedStrings.xml"), re.S):
        shared.append(html.unescape("".join(re.findall(r"<t(?:\s[^>]*)?>([^<]*)</t>", si))))
    wb = rd("xl/workbook.xml")
    rels = dict(re.findall(r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"', rd("xl/_rels/workbook.xml.rels")))
    rels.update({k: v for v, k in re.findall(r'<Relationship[^>]*Target="([^"]+)"[^>]*Id="([^"]+)"', rd("xl/_rels/workbook.xml.rels"))})
    out, total = [], 0
    for name, rid in re.findall(r'<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]+)"', wb):
        tgt = rels.get(rid, "")
        tgt = tgt.lstrip("/")
        if not tgt.startswith("xl/"):
            tgt = "xl/" + tgt
        sx = rd(tgt)
        if not sx:
            continue
        out.append(f"{MARK}H1{SEP}{SEP}Sheet: {html.unescape(name)}")
        for row in re.findall(r"<row[^>]*>(.*?)</row>", sx, re.S):
            cells = []
            for attrs, body in re.findall(r"<c([^>]*?)(?:/>|>(.*?)</c>)", row, re.S):
                v = re.search(r"<v>([^<]*)</v>", body or "")
                if 't="s"' in attrs and v:
                    try:
                        cells.append(shared[int(v.group(1))])
                    except Exception:
                        pass
                elif 't="inlineStr"' in attrs:
                    cells.append(html.unescape("".join(re.findall(r"<t[^>]*>([^<]*)</t>", body or ""))))
                elif v:
                    cells.append(v.group(1))
            line = " | ".join(c.strip() for c in cells if c and c.strip())
            if line and re.search(r"[^\W\d_]{3}", line):          # skip purely numeric rows
                line = clean(line)
                out.append(line)
                total += len(line)
                if total > max_chars:
                    return "\n".join(out)
        out.append("")
    return "\n".join(out)


VOID = {"br", "img", "hr", "meta", "link", "input", "area", "base", "col", "embed", "param", "source", "track", "wbr"}
BLOCK = {"p", "div", "li", "ul", "ol", "tr", "table", "section", "article", "dt", "dd", "dl", "blockquote", "pre",
         "h1", "h2", "h3", "h4", "h5", "h6", "header", "footer", "figure", "figcaption", "caption", "tbody", "thead"}
SKIP_TAGS = {"script", "style", "noscript", "nav", "form", "button", "select", "svg", "template", "head"}
SKIP_CLASS = re.compile(r"\b(toc|mw-editsection|navbox|noprint|share-paragraf|modal|footer|cookie|help-container|"
                        r"pager|visible-xs|sr-only|trv-src|catlinks|printfooter|mw-jump)\b")
TRV_ID = re.compile(r"^TRV-\d{4,6}$")


class HtmlText(HTMLParser):
    """HTML -> text lines with heading / anchor markers. Scope: Lovdata #documentBody, MediaWiki
    .mw-parser-output (Bane NOR TRV), else <body>."""

    def __init__(self, scope):
        super().__init__(convert_charrefs=True)
        self.scope = scope          # ("id", "documentBody") | ("class", "mw-parser-output") | None
        self.stack = []             # [tag, skip, id, in_scope_start]
        self.skip = 0
        self.in_scope = 0 if scope else 1
        self.out = []
        self.buf = []
        self.head = None            # [level, id, parts]

    def _flush(self):
        t = re.sub(r"[ \t\r\n]+", " ", "".join(self.buf)).strip()
        if t:
            self.out.append(t)
        self.buf = []

    def _ids(self):
        for e in reversed(self.stack):
            if e[2]:
                return e[2]
        return ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in VOID:
            if tag == "br" and not self.skip and self.in_scope:
                if self.head is None:
                    self._flush()
            return
        cls = a.get("class") or ""
        eid = a.get("id") or ""
        starts_scope = False
        if self.scope and not self.in_scope:
            k, v = self.scope
            if (k == "id" and eid == v) or (k == "class" and v in cls.split()):
                starts_scope = True
                self.in_scope = 1
        skip = tag in SKIP_TAGS or bool(SKIP_CLASS.search(cls)) or eid == "toc"
        trv_anchor = tag == "a" and TRV_ID.match(eid) and not self.skip and self.in_scope and self.head is None
        if trv_anchor:                      # the marker replaces the anchor text ("TRV:07113")
            self._flush()
            self.out.append(f"{MARK}A{SEP}{eid}")
            skip = True
        self.stack.append([tag, skip, eid, starts_scope])
        if skip:
            self.skip += 1
            return
        if self.skip or not self.in_scope:
            return
        if re.fullmatch(r"h[1-6]", tag):
            self._flush()
            self.head = [int(tag[1]), eid, []]
        elif self.head is not None:
            self.head[2].append(" ")
            if eid and not self.head[1]:
                self.head[1] = eid
        elif tag in BLOCK:
            self._flush()
        elif tag in ("td", "th"):
            self.buf.append(" | ")

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        idx = None
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                idx = i
                break
        if idx is None:
            return
        while len(self.stack) > idx:
            t, skip, eid, scope_start = self.stack.pop()
            if skip:
                self.skip -= 1
            elif not self.skip and self.in_scope:
                if self.head is not None and re.fullmatch(r"h[1-6]", t):
                    txt = re.sub(r"\s+", " ", "".join(self.head[2])).strip()
                    hid = self.head[1] or self._ids()
                    if txt:
                        self.out.append(f"{MARK}H{self.head[0]}{SEP}{hid}{SEP}{txt}")
                    self.head = None
                elif t in BLOCK:
                    self._flush()
            if scope_start:
                self._flush()
                self.in_scope = 0
                self.scope = ("done", None)

    def handle_data(self, data):
        if self.skip or not self.in_scope:
            return
        if self.head is not None:
            self.head[2].append(data)
        else:
            self.buf.append(data)

    def text(self):
        self._flush()
        return "\n".join(self.out)


def html_text(raw):
    raw = clean(raw)
    if 'id="documentBody"' in raw:
        scope = ("id", "documentBody")
    elif "mw-parser-output" in raw:
        scope = ("class", "mw-parser-output")
    else:
        scope = None
    p = HtmlText(scope)
    try:
        p.feed(raw)
        p.close()
    except Exception:
        pass
    t = p.text()
    if not t.strip() and scope:
        p = HtmlText(None)
        p.feed(raw)
        p.close()
        t = p.text()
    return t


def cache_path(rel):
    return os.path.join(TEXT_DIR, rel.replace("/", "__") + ".pages.json")


def kind_of(rel):
    ext = rel.lower().rsplit(".", 1)[-1]
    return {"pdf": "pdf", "zip": "zip", "html": "html", "htm": "html", "docx": "docx", "txt": "txt", "doc": "doc",
            "xlsx": "xlsx", "xlsm": "xlsx"}.get(ext)


def extract_file(rel):
    """Returns the cache dict for one library file (reads cache if fresh)."""
    src = os.path.join(ROOT, rel)
    cp = cache_path(rel)
    mt = os.path.getmtime(src)
    if os.path.exists(cp):
        try:
            c = json.load(open(cp, encoding="utf-8"))
            if c.get("src_mtime") == mt and c.get("v") == EXTRACTOR_VERSION:
                return c
        except Exception:
            pass
    kind = kind_of(rel)
    pages, err = [], None
    try:
        if kind == "pdf":
            ps = run_pdftotext(src)
            if ps is None:
                err = "pdftotext timeout"
            else:
                pages = [{"inner_file": None, "page": i + 1, "text": t} for i, t in enumerate(ps)]
        elif kind == "html":
            pages = [{"inner_file": None, "page": None, "text": html_text(open(src, encoding="utf-8", errors="ignore").read())}]
        elif kind == "docx":
            pages = [{"inner_file": None, "page": None, "text": docx_text(open(src, "rb").read())}]
        elif kind == "xlsx":
            pages = [{"inner_file": None, "page": None, "text": xlsx_text(open(src, "rb").read())}]
        elif kind == "doc":
            pages = [{"inner_file": None, "page": None, "text": doc_text(open(src, "rb").read())}]
        elif kind == "txt":
            pages = [{"inner_file": None, "page": None, "text": clean(open(src, encoding="utf-8", errors="ignore").read())}]
        elif kind == "zip":
            os.makedirs(os.path.join(BUILD, "tmp"), exist_ok=True)
            with zipfile.ZipFile(src) as z:
                for zi in sorted(z.infolist(), key=lambda i: i.filename):
                    nm = zi.filename
                    low = nm.lower()
                    if zi.is_dir() or "__macosx" in low or os.path.basename(nm).startswith("._") or zi.file_size > 200_000_000:
                        continue
                    ik = kind_of(nm)
                    if ik == "pdf":
                        with tempfile.NamedTemporaryFile(suffix=".pdf", dir=os.path.join(BUILD, "tmp")) as tf:
                            tf.write(z.read(zi))
                            tf.flush()
                            ps = run_pdftotext(tf.name) or []
                        pages += [{"inner_file": nm, "page": i + 1, "text": t} for i, t in enumerate(ps)]
                    elif ik == "docx":
                        pages.append({"inner_file": nm, "page": None, "text": docx_text(z.read(zi))})
                    elif ik == "xlsx":
                        pages.append({"inner_file": nm, "page": None, "text": xlsx_text(z.read(zi))})
                    elif ik == "doc":
                        pages.append({"inner_file": nm, "page": None, "text": doc_text(z.read(zi))})
                    elif ik == "html":
                        pages.append({"inner_file": nm, "page": None, "text": html_text(z.read(zi).decode("utf-8", "ignore"))})
                    elif ik == "txt" and not low.endswith(".url.txt"):
                        pages.append({"inner_file": nm, "page": None, "text": clean(z.read(zi).decode("utf-8", "ignore"))})
        else:
            err = "unsupported type"
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    c = {"src_mtime": mt, "v": EXTRACTOR_VERSION, "kind": kind or "other", "pages": pages}
    if err:
        c["error"] = err
    tmp = cp + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False)
    os.replace(tmp, cp)
    return c


# =====================================================================================
# 2. Structure detection and chunking
# =====================================================================================
RE_ARTICLE = re.compile(r"^(?:Article|ARTICLE|Artikkel|ARTIKKEL)\s+(\d{1,3}[a-z]?)\s*$")
RE_ANNEX_UP = re.compile(r"^(ANNEX|APPENDIX|VEDLEGG|BILAG)(?:\s+([IVXLC]{1,6}|[A-Z]|\d{1,2}[A-Z]?))?\s*$")
RE_ANNEX_CAP = re.compile(r"^(Annex|Appendix|Vedlegg|Bilag)\s+([IVXLC]{1,6}|[A-Z]|\d{1,2}[A-Z]?)\s*$")
RE_CHAPTER = re.compile(r"^(TITLE|PART|CHAPTER|SECTION|Chapter|Section|Part|Title|KAPITTEL|Kapittel|KAP\.|Kap\.|DEL|Del)\s+"
                        r"([IVXLC]{1,6}|\d{1,2}[A-Za-z]?)\.?\s*(?:[-–—:.]\s*(\S.{0,100}))?$")
CHAPTER_LEVEL = {"title": 1, "part": 1, "chapter": 2, "kapittel": 2, "kap.": 2, "section": 3, "del": 1}
RE_PAR_NO = re.compile(r"^§\s*(\d{1,3}\s?[a-z]?(?:\s*-\s*\d{1,3}\s?[a-z]?)?)\s*\.?\s*(.{0,140})$")
RE_CLAUSE_A = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){1,7})\.?$")
RE_CLAUSE_B = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,7})\.?[ \t]+(\S.{0,200})$")
RE_RECITAL = re.compile(r"^\((\d{1,3})\)(?:\s+\S.*)?$")
RE_DOTLEAD = re.compile(r"(?:\.\s?){5,}\s*\d{1,4}\s*$|\.{4,}|…{2,}")
RE_PAGENO = re.compile(r"^\s*(?:page|side|seite|p\.)?\s*#\s*(?:(?:/|of|av|sur|von|de)\s*#)?\s*$|^-\s*#\s*-$", re.I)
RE_PARASTART = re.compile(r"^(\d{1,3}\.(\s|$)|\(\d{1,3}\)(\s|$)|\(?[a-z]{1,4}\)\s|[-•–▪]\s|\d{1,2}(\.\d{1,2}){1,7}\.?(\s|$)|§\s*\d)")
RE_EUPARA = re.compile(r"^(\d{1,3})\.(?:\s|$)")


def boundary_ok(prev):
    """structural headings must follow a blank line, a page start or a sentence end"""
    return prev is None or not prev.strip() or prev.rstrip()[-1:] in ".:;!?)”’\"»" or prev.startswith(MARK)


def is_upper_start(s):
    c = s[:1]
    return bool(c) and c.isalpha() and c.isupper()


def plausible(prev, new):
    if prev is None:
        return new[0] <= 30
    if new[:len(prev)] == prev and len(new) == len(prev) + 1 and new[-1] <= 3:
        return True
    for k in range(min(len(prev), len(new))):
        if new[:k] == prev[:k] and 1 <= new[k] - prev[k] <= 5 and all(x <= 1 for x in new[k + 1:]):
            return True
        if new[k] != prev[k]:
            break
    return False


def norm_line(s):
    return re.sub(r"\s+", " ", re.sub(r"\d+", "#", s)).strip()


class Block:
    __slots__ = ("kind", "level", "locator", "display", "anchor", "path", "lines", "unit")

    def __init__(self, kind, level, locator, display, anchor, path, unit):
        self.kind, self.level, self.locator, self.display, self.anchor = kind, level, locator, display, anchor
        self.path, self.unit, self.lines = path, unit, []


def prep_pdf_lines(pages):
    """pages: list of (page_no, text). Strips repeating headers/footers, detects TOC pages.
    Returns [(page, line, detect_ok)]."""
    pls = [(pg, t.split("\n")) for pg, t in pages]
    n = len(pls)
    remove = set()
    if n >= 4:
        ce, cn = Counter(), Counter()
        cands = []
        for pi, (pg, lines) in enumerate(pls):
            idx = [i for i, l in enumerate(lines) if l.strip()]
            cand = sorted(set(idx[:5] + idx[-8:]))
            cands.append(cand)
            se, sn = set(), set()
            for i in cand:
                s = lines[i].strip()
                se.add(s)
                sn.add(norm_line(s))
            for s in se:
                ce[s] += 1
            for s in sn:
                cn[s] += 1
        th = 0.5 * n
        for pi, (pg, lines) in enumerate(pls):
            for i in cands[pi]:
                s = lines[i].strip()
                if ce[s] > th and len(s) >= 2:
                    remove.add((pi, i))
                    continue
                ns = norm_line(s)
                if ns != s and cn[ns] > th:
                    if RE_PAGENO.match(ns) or (len(ns) >= 4 and re.search(r"[^\W\d_]", ns) and not structural(s)):
                        remove.add((pi, i))
    out = []
    for pi, (pg, lines) in enumerate(pls):
        toc = sum(1 for l in lines if RE_DOTLEAD.search(l)) >= 3
        for i, l in enumerate(lines):
            if (pi, i) in remove:
                continue
            l = l.rstrip()
            if toc and (RE_DOTLEAD.search(l) or RE_CLAUSE_A.match(l.strip())):
                continue
            out.append((pg, l, not toc))
        out.append((pg, "", not toc))
    return out


def structural(s):
    return bool(RE_ARTICLE.match(s) or RE_ANNEX_UP.match(s) or RE_ANNEX_CAP.match(s) or RE_CHAPTER.match(s)
                or (RE_CLAUSE_A.match(s) and "0" not in s.split(".")[1:]))


def clause_cand(s):
    ma, mb = RE_CLAUSE_A.match(s), RE_CLAUSE_B.match(s)
    num, rest = None, None
    if ma:
        num = ma.group(1)
    elif mb and is_upper_start(mb.group(2)) and not RE_DOTLEAD.search(s):
        num, rest = mb.group(1), mb.group(2)
    if not num:
        return None
    t = tuple(int(x) for x in num.split("."))
    if not all(x > 0 for x in t[1:]):
        return None
    if len(t) == 1 and (rest is None or len(rest) > 80 or rest.endswith(".")):
        return None
    return (num, rest, t)


TITLE_STOP = {"the", "of", "to", "and", "a", "an", "in", "for", "be", "by", "with", "or", "on", "at", "is", "are", "that", "og", "i", "av", "til", "som", "er", "på"}


def next_title(lines, i):
    """next non-empty line after i if it looks like a heading title"""
    for j in range(i + 1, min(i + 4, len(lines))):
        s = lines[j][1].strip()
        if not s:
            continue
        if s.startswith(MARK):
            return None
        if len(s) <= 100 and " shall " not in s and s.split()[-1].lower() not in TITLE_STOP and (is_upper_start(s) or s[:1] in "‘'\"") and not s.endswith((".", ",", ";")) \
                and not RE_CLAUSE_A.match(s) and not RE_ARTICLE.match(s):
            return s
        return None
    return None


def parse_blocks(lines, is_html):
    """lines: [(page, text, detect_ok)] for one segment -> [Block]"""
    plain = [l for _, l, _ in lines if not l.startswith(MARK)]
    n_art = sum(1 for l in plain if RE_ARTICLE.match(l.strip()))
    eu = n_art >= 2
    nor = sum(1 for l in plain if l.strip().startswith("§")) >= 2
    # clause-number candidates (syntax only); accepted later if they continue the numbering
    cands, pl = [], None
    for i, (pg, ln, ok) in enumerate(lines):
        s = ln.strip()
        if s and ok and not ln.startswith(MARK) and boundary_ok(pl):
            c = clause_cand(s)
            if c:
                cands.append((i, c))
        pl = ln
    cand_at = {i: k for k, (i, _) in enumerate(cands)}
    stack = []          # [(level, display)]
    blocks = []
    cur = Block("pre", 0, None, None, None, "", False)
    blocks.append(cur)
    prev_clause = None
    in_annex = False
    in_recitals = False
    last_recital = 0
    prev_line = None

    def start(kind, level, locator, display, anchor=None, unit=True, leaf=False):
        nonlocal cur
        while stack and stack[-1][0] >= level:
            stack.pop()
        if leaf:
            path = " > ".join(d for _, d in stack)
        else:
            stack.append((level, display))
            path = " > ".join(d for _, d in stack)
        cur = Block(kind, level, locator, display, anchor, path, unit)
        blocks.append(cur)

    for i, (pg, ln, ok) in enumerate(lines):
        s = ln.strip()
        if ln.startswith(MARK):
            parts = ln[1:].split(SEP)
            if parts[0] == "A":
                start("trv", 99, parts[1], parts[1], anchor=parts[1], leaf=True)
                cur.lines.append((pg, f"{parts[1]} ({parts[1].replace('-', ':', 1)})"))
                prev_line = ln
                continue
            if parts[0].startswith("H"):
                lvl = int(parts[0][1:] or 1)
                hid = parts[1] if len(parts) > 1 else ""
                txt = parts[2] if len(parts) > 2 else ""
                m = re.match(r"^§\s*(\d{1,3}\s?[a-z]?(?:\s*-\s*\d{1,3}\s?[a-z]?)?)", txt)
                mv = re.match(r"^(Vedlegg|Annex|ANNEX|Appendix|Bilag)\s+([IVXLC\d]+[A-Z]?)\b", txt)
                if m:
                    start("par", lvl, "§ " + re.sub(r"\s+", "", m.group(1)), txt[:100], anchor=hid or None)
                elif mv:
                    start("annex", lvl, f"{mv.group(1)[0]}{mv.group(1)[1:].lower()} {mv.group(2)}", txt[:100], anchor=hid or None)
                else:
                    start("head", lvl, None, txt[:100], anchor=hid or None, unit=False)
                cur.lines.append((pg, txt))
                prev_line = ln
                continue
        if s and ok and eu and not in_annex and not in_recitals and re.match(r"^(Whereas|WHEREAS|considering)\s*:?$", s):
            start("head", 3, None, "Recitals", unit=False)
            in_recitals = True
            last_recital = 0
        elif s and ok and boundary_ok(prev_line):
            title = None
            m = RE_ARTICLE.match(s)
            if m and (eu or not is_html) and not in_annex:
                title = next_title(lines, i)
                start("art", 4, f"Art. {m.group(1)}", s + (f" {title[:90]}" if title else ""))
                in_annex = False
                in_recitals = False
                prev_clause = None
            elif RE_ANNEX_UP.match(s) or RE_ANNEX_CAP.match(s):
                m = RE_ANNEX_UP.match(s) or RE_ANNEX_CAP.match(s)
                word = m.group(1)[0] + m.group(1)[1:].lower()
                ident = m.group(2)
                title = next_title(lines, i)
                lvl = 2 if word == "Appendix" and in_annex else 1
                start("annex", lvl, f"{word} {ident}" if ident else word, s + (f" {title[:90]}" if title else ""))
                in_annex = True
                in_recitals = False
                prev_clause = None
            elif RE_CHAPTER.match(s) and (not RE_CHAPTER.match(s).group(3) or is_upper_start(RE_CHAPTER.match(s).group(3))):
                m = RE_CHAPTER.match(s)
                title = m.group(3) or next_title(lines, i)
                start("head", CHAPTER_LEVEL.get(m.group(1).lower(), 2), None, s if m.group(3) else s + (f" {title[:90]}" if title else ""), unit=False)
                if m.group(1).lower() in ("chapter", "kapittel", "title", "part"):
                    prev_clause = None
            elif nor and RE_PAR_NO.match(s) and (not RE_PAR_NO.match(s).group(2) or is_upper_start(RE_PAR_NO.match(s).group(2))):
                m = RE_PAR_NO.match(s)
                if len(m.group(2)) <= 100:
                    start("par", 4, "§ " + re.sub(r"\s+", "", m.group(1)), s[:100])
            elif in_recitals and RE_RECITAL.match(s) and int(RE_RECITAL.match(s).group(1)) == last_recital + 1:
                last_recital += 1
                start("recital", 5, f"Recital ({last_recital})", f"({last_recital})", leaf=True)
            elif in_recitals and re.match(r"^(HAVE|HAS) ADOPTED", s):
                in_recitals = False
                start("head", 3, None, "Enacting terms", unit=False)
            elif (not eu or in_annex) and i in cand_at:
                k = cand_at[i]
                num, rest, t = cands[k][1]
                if True:
                    depth_ok = len(t) >= 2 or (not eu or rest.isupper() or in_annex)
                    if depth_ok:
                        resync = rest is not None and len(t) <= 2 and len(rest) <= 80 and prev_clause is not None and t[0] >= prev_clause[0] and t > prev_clause
                        nxt = [c[1][2] for c in cands[k + 1:k + 3]]
                        if not resync and len(nxt) == 2 and plausible(t, nxt[0]) and plausible(nxt[0], nxt[1]):
                            resync = True
                        if plausible(prev_clause, t) or resync:
                            if rest is None:
                                title = next_title(lines, i)
                            else:
                                title = rest if len(rest) <= 100 and not rest.endswith(".") else None
                            disp = num + (f" {title[:90]}" if title else "")
                            ann = next((d for l2, d in reversed(stack) if l2 <= 2 and re.match(r"^(ANNEX|Annex|APPENDIX|Appendix)", d)), None)
                            loc = "§" + num
                            if eu and ann:
                                a0 = re.match(r"^(\S+)((?:\s+[IVXLC\d]+[A-Z]?)?)", ann)
                                loc = a0.group(1)[0] + a0.group(1)[1:].lower() + a0.group(2) + " " + loc
                            start("clause", 4 + len(t), loc, disp)
                            prev_clause = t
        cur.lines.append((pg, ln))
        prev_line = ln
    return blocks


def lines_text(lines):
    out, blank = [], False
    for _, l in lines:
        l = l.rstrip()
        if not l.strip():
            if out and not blank:
                out.append("")
            blank = True
            continue
        blank = False
        out.append(l)
    while out and not out[-1]:
        out.pop()
    return "\n".join(out)


def pages_of(lines):
    ps = [p for p, l in lines if p is not None and l.strip()]
    return (min(ps), max(ps)) if ps else (None, None)


def join_locators(locs):
    locs = [l for l in locs if l]
    if not locs:
        return None
    if len(locs) == 1 or locs[0] == locs[-1]:
        return locs[0]
    a, b = locs[0], locs[-1]
    if b.startswith(a + " "):
        return join_locators(locs[1:]) if len(locs) > 2 else b
    m = re.match(r"^(.*?)(\d[\d.\-]*[a-z]?|\(\d+\)|[IVXLC]+)$", a)
    if m and b.startswith(m.group(1)) and m.group(1):
        rest = b[len(m.group(1)):]
        if m.group(2).count(".") == rest.count(".") or m.group(1).endswith("-"):
            return f"{a}–{rest}"
        return f"{a}–{m.group(1)}{rest}" if not m.group(1).endswith(" ") else f"{a}–{rest}"
    return f"{a} – {b}"


def split_block(b):
    """split an oversize block by paragraphs; returns [(lines, sublocator)]"""
    paras, curp = [], []
    for pl in b.lines:
        st = pl[1].strip()
        if not st:
            if curp:
                paras.append(curp)
                curp = []
        else:
            if curp and RE_PARASTART.match(st):
                paras.append(curp)
                curp = []
            curp.append(pl)
    if curp:
        paras.append(curp)
    merged = []
    for p in paras:
        if merged and len(merged[-1]) == 1 and len(merged[-1][0][1].strip()) <= 12 and \
                re.match(r"^(\(?[\da-z]{1,3}[.)]|[\d.]+|§.*|Article.*|ANNEX.*)$", merged[-1][0][1].strip()):
            merged[-1] = merged[-1] + p
        else:
            merged.append(p)
    # split paragraphs that are themselves too long
    units = []
    for p in merged:
        t = sum(len(l) + 1 for _, l in p)
        if t <= MAX_TOK * 4:
            units.append(p)
            continue
        cur, cl = [], 0
        for pg, l in p:
            while len(l) > MAX_TOK * 4:
                if cur:
                    units.append(cur)
                    cur, cl = [], 0
                cut = l.rfind(" ", 0, TARGET_TOK * 4)
                cut = cut if cut > 1000 else TARGET_TOK * 4
                units.append([(pg, l[:cut])])
                l = l[cut:].lstrip()
            if cl + len(l) > TARGET_TOK * 4 and cur:
                units.append(cur)
                cur, cl = [], 0
            cur.append((pg, l))
            cl += len(l) + 1
        if cur:
            units.append(cur)
    is_art = b.kind == "art"
    parts = []
    cur, cl, para_no, first_no, last_no = [], 0, None, None, None
    for u in units:
        ul = sum(len(l) + 1 for _, l in u)
        if cur and cl + ul > TARGET_TOK * 4 and cl >= MIN_TOK * 4 * 0.6:
            parts.append((cur, first_no, last_no))
            tail, tl = [], 0
            for pl in reversed(cur):
                if tl + len(pl[1]) > 300:
                    break
                tail.insert(0, pl)
                tl += len(pl[1])
            cur = tail + ([(tail[-1][0], "")] if tail else [])
            cl = tl
            first_no, last_no = para_no, para_no
        if is_art:
            m = RE_EUPARA.match(u[0][1].strip())
            if m:
                para_no = int(m.group(1))
                if first_no is None:
                    first_no = para_no
                last_no = para_no
        cur += u + [(u[-1][0], "")]
        cl += ul
    if cur:
        parts.append((cur, first_no, last_no))
    out = []
    for lines, a, z in parts:
        loc = b.locator
        if is_art and loc and a is not None:
            loc = f"{loc}({a})" if z is None or z <= a else f"{loc}({a})–({z})"
        out.append((lines, loc))
    return out


def chunk_segment(blocks, inner_file):
    chunks = []

    def emit(lines, heading, locator, anchor, locs=None):
        text = lines_text(lines)
        if not text.strip():
            return
        ps, pe = pages_of(lines)
        chunks.append({"_locs": locs if locs is not None else ([locator] if locator else []),"heading": heading or None, "locator": locator, "inner_file": inner_file,
                       "page_start": ps, "page_end": pe, "anchor": anchor, "text": text, "tokens": tok(text)})

    buf, buf_tok = [], 0

    def flush(carry_heads=True):
        nonlocal buf, buf_tok
        if not buf:
            return
        carry = []
        if carry_heads:
            while buf and not buf[-1].unit and tok(lines_text(buf[-1].lines)) < 40 and len(buf) > 1:
                carry.insert(0, buf.pop())
        lines = [pl for b in buf for pl in b.lines + [(None, "")]]
        units = [b for b in buf if b.unit and b.locator]
        loc = join_locators([b.locator for b in units]) if units else next((b.locator for b in buf if b.locator), None)
        anchor = next((b.anchor for b in (units or buf) if b.anchor), None) or next((b.anchor for b in buf if b.anchor), None)
        first = units[0] if units else buf[0]
        heading = first.path if first.kind != "trv" else first.path
        emit(lines, heading or buf[0].path, loc, anchor, [b.locator for b in units] if units else None)
        buf = carry
        buf_tok = sum(tok(lines_text(b.lines)) for b in buf)

    for b in blocks:
        t = lines_text(b.lines)
        if not t.strip():
            continue
        bt = tok(t)
        if bt > MAX_TOK:
            heads = [x for x in buf if not x.unit] if buf and all(not x.unit for x in buf) and buf_tok < 60 else None
            if heads:
                b.lines = [pl for x in heads for pl in x.lines + [(None, "")]] + b.lines
                buf, buf_tok = [], 0
            else:
                flush(carry_heads=False)
            for lines, loc in split_block(b):
                emit(lines, b.path, loc, b.anchor)
            continue
        if buf:
            min_level = min(x.level for x in buf)
            if buf_tok + bt > MAX_TOK or buf_tok >= MIN_TOK or (buf_tok >= 120 and b.level < min_level and b.kind != "trv") \
                    or (b.kind == "annex" and buf_tok >= 60):
                flush()
        buf.append(b)
        buf_tok += bt
    flush(carry_heads=False)
    # merge tiny chunks into the previous one
    merged = []
    for c in chunks:
        if merged and c["tokens"] < 80 and merged[-1]["tokens"] + c["tokens"] <= MAX_TOK + 150:
            p = merged[-1]
            p["text"] += "\n\n" + c["text"]
            p["tokens"] = tok(p["text"])
            if c["page_end"] is not None:
                p["page_end"] = max(p["page_end"] or c["page_end"], c["page_end"])
                p["page_start"] = p["page_start"] or c["page_start"]
            p["_locs"] += c["_locs"]
            if p["_locs"]:
                p["locator"] = join_locators(p["_locs"])
        else:
            merged.append(c)
    for c in merged:
        c.pop("_locs", None)
    return merged


def chunk_doc(cache):
    segs = []
    for p in cache["pages"]:
        if not segs or segs[-1][0] != p["inner_file"]:
            segs.append((p["inner_file"], []))
        segs[-1][1].append((p["page"], p["text"] or ""))
    out = []
    for inner, pages in segs:
        if all(pg is None for pg, _ in pages):
            lines = [(None, l, True) for _, t in pages for l in t.split("\n")]
            is_html = True
        else:
            lines = prep_pdf_lines(pages)
            is_html = False
        out += chunk_segment(parse_blocks(lines, is_html), inner)
    return out


NO_WORDS = re.compile(r"\b(og|ikke|skal|eller|som|det|til|av|for|med|på|jernbane\w*|kravet|krav)\b", re.I)
EN_WORDS = re.compile(r"\b(the|and|shall|of|to|is|be|with|for|that|railway)\b", re.I)
DE_WORDS = re.compile(r"\b(und|der|die|das|nicht|wird|mit)\b", re.I)
FR_WORDS = re.compile(r"\b(et|les|des|est|dans|pour|une)\b", re.I)


def guess_lang(text, folder):
    s = text[:40000]
    if not s.strip():
        return None
    no = len(NO_WORDS.findall(s)) + 3 * len(re.findall(r"[æøåÆØÅ]", s))
    en = len(EN_WORDS.findall(s))
    de, fr = len(DE_WORDS.findall(s)), len(FR_WORDS.findall(s))
    best = max((no, "no"), (en, "en"), (de * 1.3, "de"), (fr * 1.3, "fr"))
    if best[0] < 5:
        return "no" if folder.startswith("08_Norway") else "en"
    return best[1]


def process(rel):
    """worker: extract (cached) + chunk one file"""
    t0 = time.time()
    try:
        c = extract_file(rel)
    except Exception as e:
        return {"rel": rel, "error": f"{type(e).__name__}: {e}", "chunks": [], "n_pages": None, "chars": 0, "lang": None, "kind": None, "secs": 0}
    try:
        chunks = chunk_doc(c)
    except Exception as e:
        import traceback
        return {"rel": rel, "error": "chunk: " + traceback.format_exc(limit=3), "chunks": [], "n_pages": None, "chars": 0, "lang": None, "kind": c.get("kind"), "secs": 0}
    pdf_pages = [p for p in c["pages"] if p["page"] is not None]
    n_pages = len(pdf_pages) if pdf_pages else None
    alltext = "\n".join(p["text"] or "" for p in c["pages"])
    plain = re.sub(MARK + r"[^\n]*", "", alltext)
    return {"rel": rel, "error": c.get("error"), "chunks": chunks, "n_pages": n_pages,
            "chars": len(plain.strip()), "lang": guess_lang(plain, rel), "kind": c.get("kind"),
            "secs": round(time.time() - t0, 2)}


# =====================================================================================
# 3. Catalogue-derived tables
# =====================================================================================
def area_of(folder):
    return re.sub(r"^\d+_", "", folder.split("/")[0])


def ertms_set_of(folder):
    m = re.search(r"/Set(\d)_", folder + "/")
    if m and folder.startswith("07_"):
        return f"Set{m.group(1)}"
    if "Informative_specs" in folder:
        return "informative"
    return None


def status_of(r):
    ds = (r.get("date_or_status") or "").lower()
    # ERTMS sets 1-3 are "archived" by ERA but remain parallel baselines in use (Set 3 in Norway);
    # they are told apart by ertms_set, not demoted as historical.
    if r["folder"].startswith("07_") and re.search(r"/set[123]_", "/" + r["folder"].lower() + "/") \
            and re.search(r"archived set of specifications", ds):
        return "in_force"
    fn = r["filename"].lower()
    notes = (r.get("notes") or "").lower()
    if "repealed" in fn or re.search(r"repealed|no longer in force|superseded|utgått|withdrawn|expired|opphevet", ds):
        return "repealed"
    if re.search(r"\barchived\b", ds) or re.search(r"superseded version|last consolidation before repeal", notes):
        return "historical"
    if "draft" in ds or "draft" in fn or "høring" in ds or "horing" in fn or "still labelled draft" in notes or "proposal" in ds:
        return "draft"
    if "consolidated" in ds or "consolidated" in fn:
        return "consolidated"
    if re.search(r"in force|current|\blive\b|published|valid from|set of specifications #4|living document|approved", ds):
        return "in_force"
    if re.search(r"/set[123]_", "/" + r["folder"].lower() + "/") and r["folder"].startswith("07_"):
        return "historical"
    return "unknown"


def act_numbers(s):
    """'2023/1695', '402/2013', '2004/49/ec' style numbers in a reference string"""
    out = set()
    for a, b, sfx in re.findall(r"(?<![\d/])(\d{2,4})/(\d{1,4})(?:/(EU|EC|EEC|EØF|EF|Euratom))?(?![\d/])", s, re.I):
        out.add(f"{a}/{b}")
        if sfx:
            out.add(f"{a}/{b}/{sfx}".lower())
    return out


def celex_numbers(celex):
    m = re.match(r"^[03](\d{4})([RLDH])(\d{4})", celex.upper())
    if not m:
        return set()
    y, k, n = m.group(1), m.group(2), int(m.group(3))
    if k == "R" and int(y) < 2015:
        return {f"{n}/{y}"}
    return {f"{y}/{n}"}


def build_aliases(docs, edges_rows, short_tsv):
    al = set()
    by_celex, by_lov = defaultdict(set), defaultdict(set)

    def add(alias, path, kind):
        a = re.sub(r"\s+", " ", (alias or "").strip().lower())
        if len(a) >= 2 and a not in ("-", "bane nor"):
            al.add((a, path, kind))
    for d in docs:
        p = d["path"]
        guide = d["area"] == "ERA_Guides" or re.search(r"guid|veiled", (d["filename"] + " " + (d.get("reference") or "")), re.I)
        blob = " ".join([d["filename"], d.get("url") or "", "" if guide else (d.get("notes") or ""), d.get("reference") or ""])
        if d.get("short_name"):
            add(d["short_name"], p, "short")
            base = re.sub(r"\s*\((consolidated|repealed|[^)]*version[^)]*)\)\s*$", "", d["short_name"], flags=re.I)
            if base != d["short_name"]:
                add(base, p, "short")
        ref = d.get("reference") or ""
        if ref and not re.match(r"^CELEX\s", ref):
            add(ref, p, "reference")
            add(re.sub(r"\s*\(consolidated\)", "", ref, flags=re.I), p, "reference")
        celexes = set()
        for c in re.findall(r"CELEX[:%3A\s]*([0-9]{5}[A-Z]{1,2}[0-9]{4}(?:-\d{8})?(?:R\(\d+\))?)", blob, re.I):
            celexes.add(c.upper())
        if re.match(r"^\d{5}[A-Z]\d{4}", ref):
            celexes.add(ref.upper())
        for c in celexes:
            add(c, p, "celex")
            base = re.sub(r"^0", "3", c.split("-")[0])
            base = re.sub(r"R\(\d+\)$", "", base)
            add(base, p, "celex")
            by_celex[base].add(p)
            for nnum in celex_numbers(base):
                add(nnum, p, "number")
        if re.search(r"regulation|directive|decision|recommendation|forordning|direktiv|beslutning|vedtak|reg\.|dir\.", ref, re.I) \
                and not re.match(r"^Art\.", ref) and not guide:
            for nnum in act_numbers(ref):
                add(nnum, p, "number")
        m = re.match(r"^(?:Reg|Dir|Dec|DelDec|DelReg|ImplReg|ImplDec|Rec)_(\d{2,4})-(\d{1,4})(?=[_.])", d["filename"])
        if m:
            add(f"{m.group(1)}/{m.group(2)}", p, "number")
        for lid in set(re.findall(r"\b((?:FOR|LOV)-\d{4}-\d{2}-\d{2}(?:-\d{1,5})?)\b", " ".join([d["filename"], d.get("url") or "", ref]))):
            add(lid, p, "lovdata")
            by_lov[lid].add(p)
        for lid in re.findall(r"lovdata\.no/(?:dokument/(?:SF|NL)/)?(forskrift|lov)/(\d{4}-\d{2}-\d{2}(?:-\d+)?)", d.get("url") or ""):
            k = ("FOR-" if lid[0] == "forskrift" else "LOV-") + lid[1]
            add(k, p, "lovdata")
            by_lov[k].add(p)
        for a, b2 in re.findall(r"SUBSET[-_ ]?(\d{3})((?:-\d{1,2}){0,2})", " ".join([d["filename"], d.get("title") or "", ref]), re.I):
            add(f"subset-{a}", p, "number")
            if b2:
                add(f"subset-{a}{b2}", p, "number")
        for a in re.findall(r"ERA[_ /-]ERTMS[_ /-](\d{6})", " ".join([d["filename"], d.get("title") or "", ref]), re.I):
            add(f"era/ertms/{a}", p, "number")
            add(f"era_ertms_{a}", p, "number")
    paths = {d["path"] for d in docs}
    for e in edges_rows:
        for cp in (e.get("cited_in_library") or "").split(";"):
            cp = cp.strip()
            if cp not in paths:
                continue
            pre, _, ident = e["cited_id"].partition(":")
            if pre == "EU":
                add(ident, cp, "celex")
            elif pre == "NO":
                add(ident, cp, "lovdata")
            elif pre in ("SS", "ERA", "STD"):
                add(ident, cp, "number")
            if e.get("cited_label") and pre != "LIB":
                add(e["cited_label"], cp, "reference")
            if e.get("cited_short_name") and pre != "LIB":
                add(re.sub(r"\s*\((B\d|Set)[^)]*\)\s*$", "", e["cited_short_name"]), cp, "short")
    for key, short in short_tsv:
        m = re.match(r"^([RLDH]) (\d{4}) (\d{1,4})$", key)
        targets = set()
        if m:
            targets = by_celex.get(f"3{m.group(2)}{m.group(1)}{int(m.group(3)):04d}", set())
        elif key.startswith(("FOR-", "LOV-")):
            targets = by_lov.get(key, set())
        for t in targets:
            add(short, t, "short")
            add(re.sub(r"\s*\([^)]*\)\s*$", "", short), t, "short")
    return sorted(al)


# =====================================================================================
# 4. SQL output
# =====================================================================================
def q(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    s = CTRL.sub("", str(v)).replace(MARK, "").replace(SEP, "")
    return "'" + s.replace("'", "''") + "'"


class SqlWriter:
    def __init__(self, out_dir):
        self.out_dir = out_dir
        self.n = 0
        self.f = None
        self.size = 0
        self.files = []
        self.total = 0
        self.max_stmt = 0
        self.statements = 0

    def _open(self):
        if self.f:
            self.f.close()
        self.n += 1
        p = os.path.join(self.out_dir, f"data-{self.n:04d}.sql")
        self.files.append(p)
        self.f = open(p, "w", encoding="utf-8")
        self.size = 0

    def stmt(self, s):
        b = len(s.encode("utf-8")) + 1
        if b > 90_000:
            raise ValueError(f"statement too large: {b} bytes")
        if self.f is None or self.size + b > FILE_LIMIT:
            self._open()
        self.f.write(s + "\n")
        self.size += b
        self.total += b
        self.max_stmt = max(self.max_stmt, b)
        self.statements += 1

    def new_file(self):
        self._open()

    def close(self):
        if self.f:
            self.f.close()


def insert_rows(emit, table, cols, rows, verb="INSERT"):
    head = f"{verb} INTO {table} ({', '.join(cols)}) VALUES\n"
    cur, size = [], len(head)
    for r in rows:
        v = "(" + ", ".join(q(x) for x in r) + ")"
        vb = len(v.encode("utf-8")) + 2
        if cur and size + vb > STMT_LIMIT:
            emit(head + ",\n".join(cur) + ";")
            cur, size = [], len(head)
        cur.append(v)
        size += vb
    if cur:
        emit(head + ",\n".join(cur) + ";")


CT = {"pdf": "application/pdf", "zip": "application/zip", "html": "text/html; charset=utf-8", "htm": "text/html; charset=utf-8",
      "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12", "doc": "application/msword", "txt": "text/plain; charset=utf-8"}


# =====================================================================================
# 5. Main
# =====================================================================================
def read_tsv(p):
    return list(csv.DictReader(open(p, encoding="utf-8", newline=""), delimiter="\t"))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="only library paths starting with this prefix")
    ap.add_argument("--limit", type=int, help="at most N files")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 4) - 1))
    ap.add_argument("--no-test", action="store_true", help="skip the sqlite3 load test")
    args = ap.parse_args()
    t_start = time.time()
    os.makedirs(TEXT_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    cat = read_tsv(os.path.join(ROOT, "catalogue.tsv"))
    dup_of = {}
    for line in open(os.path.join(ROOT, "tools", "data", "duplicate_groups.tsv"), encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2 and parts[0] and not parts[0].startswith("#"):
            for d in parts[1:]:
                if d:
                    dup_of[d] = parts[0]
    todo, seen, skipped = [], set(), Counter()
    for r in cat:
        rel = f"{r['folder']}/{r['filename']}"
        if rel in seen:
            continue
        seen.add(rel)
        if r["filename"].lower().endswith(".url.txt"):
            skipped["url.txt link stub"] += 1
            continue
        if "_to_delete" in rel.split("/"):
            skipped["_to_delete"] += 1
            continue
        if args.only and not rel.startswith(args.only):
            continue
        if not os.path.isfile(os.path.join(ROOT, rel)):
            skipped["missing file"] += 1
            continue
        if not kind_of(rel):
            skipped["unsupported type (" + rel.rsplit(".", 1)[-1].lower() + ")"] += 1
            continue
        todo.append((rel, r))
    if args.limit:
        todo = todo[:args.limit]
    print(f"[build] {len(todo)} files to process with {args.jobs} workers", file=sys.stderr)

    # remove old outputs
    for f in os.listdir(OUT_DIR):
        if re.match(r"data-\d{4}\.sql$", f) or f in ("chunks.jsonl", "r2_manifest.tsv", "stats.json", "test.sqlite", "_chunks.tmp"):
            os.remove(os.path.join(OUT_DIR, f))
    shutil.copy(SCHEMA, os.path.join(OUT_DIR, "schema.sql"))

    docs, no_text, errors = [], [], []
    by_kind = Counter()
    chunk_id = 0
    tmp_path = os.path.join(OUT_DIR, "_chunks.tmp")
    tmp = open(tmp_path, "w", encoding="utf-8")
    jsonl = open(os.path.join(OUT_DIR, "chunks.jsonl"), "w", encoding="utf-8")
    tok_total, slowest = 0, []
    t_ex = time.time()
    rows_by_rel = dict(todo)
    with ProcessPoolExecutor(max_workers=args.jobs) as ex:
        for i, res in enumerate(ex.map(process, [r for r, _ in todo], chunksize=1)):
            rel = res["rel"]
            r = rows_by_rel[rel]
            if (i + 1) % 50 == 0 or i + 1 == len(todo):
                print(f"[build] {i + 1}/{len(todo)} files, {chunk_id} chunks, {time.time() - t_ex:.0f}s", file=sys.stderr)
            slowest.append((res.get("secs", 0), rel))
            if res.get("error"):
                errors.append({"path": rel, "error": res["error"][:300]})
            if not res["chunks"] or res["chars"] < 200:
                no_text.append({"path": rel, "kind": res.get("kind"), "n_pages": res.get("n_pages"), "chars": res["chars"],
                                "error": res.get("error")})
                if not res["chunks"]:
                    continue
            doc_id = len(docs) + 1
            d = {"id": doc_id, "path": rel, "folder": r["folder"], "filename": r["filename"], "title": r.get("title") or None,
                 "reference": r.get("reference") or None, "short_name": r.get("short_name") or None,
                 "date_status": r.get("date_or_status") or None, "status": status_of(r), "area": area_of(r["folder"]),
                 "ertms_set": ertms_set_of(r["folder"]), "lang": res["lang"], "url": r.get("url") or None,
                 "notes": r.get("notes") or None, "n_pages": res["n_pages"], "r2_key": rel, "duplicate_of": dup_of.get(rel)}
            docs.append(d)
            by_kind[res.get("kind")] += 1
            label = d["short_name"] or d["title"] or d["filename"]
            rows = []
            for o, c in enumerate(res["chunks"]):
                chunk_id += 1
                tok_total += c["tokens"]
                rows.append((chunk_id, doc_id, o, c["heading"], c["locator"], c["inner_file"], c["page_start"], c["page_end"],
                             c["anchor"], c["text"], c["tokens"]))
                head = " > ".join(x for x in [label, c["inner_file"], c["heading"]] if x)
                if c["locator"] and c["locator"] not in (c["heading"] or ""):
                    head += f" [{c['locator']}]"
                jd = {"id": chunk_id, "text": head + "\n" + c["text"], "doc_id": doc_id, "area": d["area"], "status": d["status"]}
                if d["ertms_set"]:
                    jd["ertms_set"] = d["ertms_set"]
                jsonl.write(json.dumps(jd, ensure_ascii=False) + "\n")
            insert_rows(lambda s: tmp.write(json.dumps(s, ensure_ascii=False) + "\n"), "chunks",
                        ["id", "doc_id", "ord", "heading", "locator", "inner_file", "page_start", "page_end", "anchor", "text", "tokens"], rows)
    tmp.close()
    jsonl.close()
    t_extract = time.time() - t_ex

    # ---------- other tables ----------
    paths = {d["path"] for d in docs}
    edges_rows = list(csv.DictReader(open(os.path.join(ROOT, "99_Reference_Map", "references_edges.csv"), encoding="utf-8", newline="")))
    edges_out = []
    for e in edges_rows:
        if args.only and not e["citing_document"].startswith(args.only):
            continue
        cps = [x.strip() for x in (e.get("cited_in_library") or "").split(";") if x.strip()] or [None]
        for cp in cps:
            edges_out.append((e["citing_document"], e["cited_id"], e.get("cited_type") or None, e.get("cited_label") or None,
                              e.get("cited_short_name") or None, e.get("cited_title") or None,
                              int(e["mentions"]) if (e.get("mentions") or "").isdigit() else None, e.get("versions_cited") or None, cp))
    std_rows = []
    for s in csv.DictReader(open(os.path.join(ROOT, "99_Reference_Map", "standards_register.csv"), encoding="utf-8", newline="")):
        std_rows.append((s["standard"], s.get("title") or None, s.get("type") or None, s.get("availability") or None, s.get("link") or None,
                         s.get("versions_cited") or None, int(s["cited_by_n_docs"]) if (s.get("cited_by_n_docs") or "").isdigit() else None,
                         "; ".join(x.strip() for x in (s.get("citing_documents") or "").split("|") if x.strip()) or None,
                         s.get("file_in_library") or None))
    trv_rows = []
    for t in read_tsv(os.path.join(ROOT, "tools", "data", "banenor_trv_requirements.tsv")):
        p = f"{t['folder']}/{t['filename']}"
        if args.only and not p.startswith(args.only):
            continue
        trv_rows.append((t["req_id"], p, t.get("anchor") or None, t.get("section") or None, t.get("text") or None))
    short_tsv = []
    for line in open(os.path.join(ROOT, "99_Reference_Map", "short_names.tsv"), encoding="utf-8"):
        if line.startswith("#") or line.startswith("key\t"):
            continue
        parts = line.rstrip("\n").split("\t")
        if len(parts) >= 2:
            short_tsv.append((parts[0], parts[1]))
    aliases = build_aliases(docs, edges_rows, short_tsv)
    build_date = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # ---------- write SQL ----------
    w = SqlWriter(OUT_DIR)
    insert_rows(w.stmt, "docs", ["id", "path", "folder", "filename", "title", "reference", "short_name", "date_status", "status", "area",
                                 "ertms_set", "lang", "url", "notes", "n_pages", "r2_key", "duplicate_of"],
                [tuple(d[k] for k in ["id", "path", "folder", "filename", "title", "reference", "short_name", "date_status", "status", "area",
                                      "ertms_set", "lang", "url", "notes", "n_pages", "r2_key", "duplicate_of"]) for d in docs])
    with open(tmp_path, encoding="utf-8") as f:
        for line in f:
            w.stmt(json.loads(line))
    os.remove(tmp_path)
    insert_rows(w.stmt, "edges", ["citing_path", "cited_id", "cited_type", "cited_label", "cited_short_name", "cited_title", "mentions",
                                  "versions_cited", "cited_path"], edges_out)
    insert_rows(w.stmt, "standards", ["standard", "title", "type", "availability", "link", "versions_cited", "cited_by_n_docs",
                                      "citing_documents", "file_in_library"], std_rows, verb="INSERT OR IGNORE")
    insert_rows(w.stmt, "aliases", ["alias", "path", "kind"], aliases)
    insert_rows(w.stmt, "trv", ["req_id", "path", "anchor", "section", "text"], trv_rows, verb="INSERT OR IGNORE")
    meta = [("build_date", build_date), ("n_docs", str(len(docs))), ("n_chunks", str(chunk_id)), ("embed_model", "@cf/baai/bge-m3"),
            ("embed_dims", "1024"), ("n_tokens", str(tok_total))]
    insert_rows(w.stmt, "meta", ["k", "v"], meta, verb="INSERT OR REPLACE")
    w.new_file()
    w.stmt("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');")
    w.close()

    # ---------- manifest ----------
    with open(os.path.join(OUT_DIR, "r2_manifest.tsv"), "w", encoding="utf-8") as f:
        for d in docs:
            ext = d["filename"].lower().rsplit(".", 1)[-1]
            f.write(f"{d['r2_key']}\t{d['path']}\t{CT.get(ext, 'application/octet-stream')}\n")

    # ---------- stats ----------
    stats = {
        "build_date": build_date, "args": {"only": args.only, "limit": args.limit},
        "files_processed": len(todo), "docs": len(docs), "chunks": chunk_id, "tokens_total": tok_total,
        "avg_tokens_per_chunk": round(tok_total / chunk_id, 1) if chunk_id else 0,
        "docs_by_kind": dict(by_kind),
        "docs_by_area": dict(Counter(d["area"] for d in docs)),
        "docs_by_status": dict(Counter(d["status"] for d in docs)),
        "docs_by_lang": dict(Counter(d["lang"] for d in docs)),
        "edges": len(edges_out), "standards": len(std_rows), "aliases": len(aliases), "trv": len(trv_rows),
        "sql_files": [os.path.basename(p) for p in w.files], "sql_bytes": w.total, "sql_statements": w.statements,
        "max_statement_bytes": w.max_stmt, "skipped": dict(skipped), "no_text": no_text, "errors": errors,
        "slowest_files": [{"secs": s, "path": p} for s, p in sorted(slowest, reverse=True)[:10]],
        "timing_secs": {"extract_and_chunk": round(t_extract, 1), "total": round(time.time() - t_start, 1)},
    }
    json.dump(stats, open(os.path.join(OUT_DIR, "stats.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[build] docs={len(docs)} chunks={chunk_id} tokens={tok_total} sql={w.total / 1e6:.1f} MB in {len(w.files)} files; "
          f"no-text={len(no_text)} errors={len(errors)}; {time.time() - t_start:.0f}s", file=sys.stderr)
    if not args.no_test:
        selftest(w.files)


def selftest(files):
    db = os.path.join(OUT_DIR, "test.sqlite")
    if os.path.exists(db):
        os.remove(db)
    if not shutil.which("sqlite3"):
        print("[test] sqlite3 CLI not found; skipped", file=sys.stderr)
        return
    t0 = time.time()
    script = ".bail on\n" + "".join(f".read '{p}'\n" for p in [os.path.join(OUT_DIR, "schema.sql")] + files)
    r = subprocess.run(["sqlite3", db], input=script, text=True, capture_output=True)
    if r.returncode != 0:
        print("[test] LOAD FAILED:\n" + r.stderr[-3000:], file=sys.stderr)
        sys.exit(1)
    print(f"[test] loaded into {db} in {time.time() - t0:.0f}s", file=sys.stderr)
    queries = ['"2016/797"', '"SUBSET-026"', '"3.5.3.7"', "samtrafikkforskriften", '"TRV-07113"', '"TRV:07113"', '"Article 15"',
               '"Art. 15"', '"§ 1-1"', '"EN 50126"']
    for qq in queries:
        sql = (f"SELECT count(*) FROM chunks_fts WHERE chunks_fts MATCH {q(qq)};"
               f"SELECT c.id, d.path, c.locator, c.page_start FROM chunks_fts f JOIN chunks c ON c.id=f.rowid JOIN docs d ON d.id=c.doc_id "
               f"WHERE chunks_fts MATCH {q(qq)} ORDER BY bm25(chunks_fts, 1.0, 0.5, 2.0) LIMIT 3;")
        r = subprocess.run(["sqlite3", "-separator", " | ", db, sql], text=True, capture_output=True)
        out = (r.stdout or r.stderr).strip().split("\n")
        print(f"[test] MATCH {qq}: {out[0]} hits", file=sys.stderr)
        for l in out[1:]:
            print(f"         {l[:160]}", file=sys.stderr)
    r = subprocess.run(["sqlite3", db, "SELECT (SELECT count(*) FROM docs),(SELECT count(*) FROM chunks),(SELECT count(*) FROM aliases),"
                        "(SELECT count(*) FROM edges),(SELECT count(*) FROM trv),(SELECT count(*) FROM standards);"], text=True, capture_output=True)
    print(f"[test] rows docs|chunks|aliases|edges|trv|standards = {r.stdout.strip()}", file=sys.stderr)


if __name__ == "__main__":
    main()
