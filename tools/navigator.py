#!/usr/bin/env python3
"""Builds the Navigator hierarchy (tab 1 of the reference map).

    from navigator import build_nav, write_html
    data["nav"] = build_nav(data)          # data = {"docs": [...], "ext": [...], "edges": [...]}

Top of the tree (tiers 0-1) is hand-set in nav_config.py. Everything else is placed by rule:
folder default -> file-name override -> the higher-tier node it shares most citations with.
Amending, correcting, consolidated and superseded acts fold into their current family."""
import json, os, re, sys
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav_config as C

STDTYPES = ("Standard", "UIC leaflet", "ETSI spec", "ERTMS subset", "ERA document")
TIER_W = {0: 0.35, 1: 1.0, 2: 0.8, 3: 0.5}
LEGAL = re.compile(r"^(0[1-5]_|10_|08_Norway/Lover_og_forskrifter|09_Referenced_Documents/EU_Acts)")


def base_name(s):
    s = re.sub(r" – (amendment|correction|corrigendum|supplement|annex)( .*)?$", "", s)
    return re.sub(r" \(consolidated\)$", "", s)


def current_name(b, fams):
    """Name of the current family a superseded/renamed act folds into (or b itself)."""
    x = b
    for step in (lambda v: v, lambda v: re.sub(r" \((old|repealed)\)$", "", v),
                 lambda v: re.sub(r" (19|20)\d\d$", "", v), lambda v: re.sub(r"^(HS|CR) | (HS|CR)$", "", v)):
        x = step(x)
        if x in C.FAMILY_ALIAS: return C.FAMILY_ALIAS[x]
        if x != b and x in fams: return x
    return b


def badge(d):
    st, s, i = (d.get("st") or ""), (d.get("s") or ""), d["id"]
    if re.search(r"REPEALED|no longer in force|end of validity", st, re.I) or "(repealed)" in s: return "repealed"
    if "(old)" in s or re.search(r"superseded|OUTDATED", st + " " + d.get("t", ""), re.I): return "superseded"
    if re.search(r"UNVERIFIED", st): return "unverified"
    if re.search(r"^in force|; in force|in force[;(]|in force$", st) and not re.search(r"UNVERIFIED|assumed", st): return "in force"
    if re.search(r"draft|hearing|høring|deadline", st + " " + d.get("t", ""), re.I): return "draft"
    if i.endswith(".url.txt") or re.search(r"\blive\b", st): return "web page"
    if re.search(r"amended", st): return "amended"
    if re.search(r"in force|current|applies|valid from", st, re.I): return "in force"
    return ""


def tier_of(folder):
    if folder.startswith("09_"): return 4
    if folder.startswith(("07_", "08_Norway/ATC2")): return 2
    if folder.startswith(("06_", "08_Norway/SJT", "08_Norway/Bane", "08_Norway/Nasjonale", "10_")): return 3
    return 1


def build_nav(data, verbose=True):
    docs = {d["id"]: d for d in data["docs"]}
    ext = {e["id"]: e for e in data["ext"]}
    warn = []

    # ---------------- citation matrices ----------------
    M = defaultdict(lambda: defaultdict(int))       # doc -> doc mentions (via resolved cited item)
    citers = defaultdict(set)                       # doc -> docs citing it (any of its versions)
    ext_by = defaultdict(lambda: defaultdict(int))  # ext id -> citing doc -> mentions
    for s, t, c in data["edges"]:
        e = ext.get(t)
        if not e or s not in docs: continue
        if e["lib"]:
            if e["lib"][0] != s: M[s][e["lib"][0]] += c
            for f in e["lib"]:
                if f != s: citers[f].add(s)
        else:
            ext_by[t][s] += c

    # ---------------- families ----------------
    fams = defaultdict(list)
    for d in data["docs"]:
        if d.get("s") and LEGAL.match(d["f"]): fams[base_name(d["s"])].append(d["id"])
    for _ in range(3):                               # fold superseded acts into the current family
        for b in list(fams):
            cur = current_name(b, fams)
            if cur != b and cur in fams:
                fams[cur] += fams.pop(b)
    fam_of = {i: k for k, v in fams.items() for i in v}

    def primary(key):
        mem = fams[key]
        for want in (key + " (consolidated)", key):
            for i in mem:
                if docs[i].get("s") == want: return i
        return mem[0]

    def member_order(key, i):
        s = docs[i].get("s", "")
        old = 1 if (fam_of.get(i) == key and base_name(s) != key) else 0
        num = docs[i].get("n", "")
        m = re.search(r"(\d{4})", num)
        return (old, 0 if s.endswith("(consolidated)") else 1 if s == key else 2, -(int(m.group(1)) if m else 0), s)

    # ---------------- nodes ----------------
    N = {}           # key -> node
    kids = defaultdict(list)
    placed = {}      # doc id -> node key

    def add(key, parent, **kw):
        n = {"k": key, "p": parent, "ty": kw.pop("ty"), "w": kw.pop("w", 0), "hand": kw.pop("hand", 0)}
        n.update({k: v for k, v in kw.items() if v not in (None, "", [])})
        N[key] = n
        if parent is not None: kids[parent].append(key)
        return n

    def doc_node(i, parent, hand=0, tier=None):
        d = docs[i]
        lab, sub = d.get("s"), ""
        if lab: sub = re.sub(r"\s*\[(Set\d|Informative)\]$", "", d.get("t", ""))
        else:
            t = d.get("t") or i
            m = re.match(r"^(\d{4}/\d+/E[CU]+):|^((?:Council |Commission )?(?:Implementing |Delegated )?(?:Decision|Directive|Regulation)(?: \(E[CU]+\))?(?: No)? \d+/\d+(?:/E[CU]+)?)", t)
            if m and len(t) > 70:
                lab, sub = (m.group(1) and "Decision " + m.group(1)) or m.group(2), re.sub(r"^\d{4}/\d+/E[CU]+:\s*", "", t)
            else:
                lab = t
        b = badge(d)
        if b == "in force" and d["f"].startswith("07_ERTMS_Specifications/Set"): b = ""   # the set row says it
        n = add("d:" + i, parent, ty="doc", id=i, l=lab, n=d.get("n"), d=sub if sub != lab else "", b=b,
                w=len(citers[i]), hand=hand, tier=tier)
        placed[i] = n["k"]
        return n

    def fam_node(key, parent, tier, hand):
        pi = primary(key)
        d = docs[pi]
        mem = sorted(fams[key], key=lambda i: member_order(key, i))
        base = next((i for i in mem if docs[i].get("s") == key), pi)
        cons = re.search(r"Consolidated (\d\d/\d\d/\d{4})", d.get("st", "")) if d.get("s", "").endswith("(consolidated)") else None
        b = badge(docs[base])
        if b == "amended" and cons: b = "in force"
        w = len(set().union(*(citers[i] for i in mem)))
        n = add(key, parent, ty="fam", id=pi, l=key, n=d.get("n") or docs[base].get("n"), d=docs[base].get("t", ""),
                b=b, c=("consolidated " + cons.group(1)) if cons else "", w=w, hand=hand, tier=tier)
        for i in mem: placed[i] = key
        rest = [i for i in mem if i != pi]
        if rest:
            add(key + "#v", key, ty="grp", l=f"Versions, amendments & superseded acts", w=-1, tier=tier, role="v")
            for i in rest:
                doc_node(i, key + "#v", tier=tier)["hand"] = 1   # keep chronological order
            for i in mem: placed[i] = key                           # the family row is the doc's home
        return n

    # 1. skeleton
    for key, parent, tier, label in C.SKELETON:
        if parent is not None and parent not in N:
            warn.append(f"skeleton: parent {parent!r} of {key!r} missing"); continue
        if key.startswith("@"):
            add(key, parent, ty="grp", l=label, tier=tier, hand=1, root=1 if parent is None else None)
        elif key in fams:
            fam_node(key, parent, tier, 1)
        else:
            warn.append(f"skeleton: no library document for {key!r}")

    # 2. everything else
    def root_of(k):
        while N[k]["p"] is not None: k = N[k]["p"]
        return k

    units = []   # (tier, root, [doc ids], family key or None)
    seen = set()
    for d in data["docs"]:
        i = d["id"]
        if i in placed or i in seen: continue
        root = "@no" if d["f"].startswith("08_Norway") else "@eu"
        if i in fam_of and fam_of[i] not in N:
            k = fam_of[i]; seen.update(fams[k]); units.append((tier_of(d["f"]), root, fams[k], k))
        else:
            seen.add(i); units.append((tier_of(d["f"]), root, [i], None))
    units.sort(key=lambda u: u[0])

    def members(k):
        n = N[k]
        if n["ty"] == "fam": return fams[n["k"]]
        return [n["id"]] if n.get("id") else []

    def candidates(root, max_tier):
        for k, n in N.items():
            if (n["ty"] == "fam" or (n["ty"] == "doc" and not n["p"].endswith("#v"))) \
                    and n.get("tier", 9) <= max_tier and n.get("tier") != 2 and root_of(k) == root:
                yield k

    def scored(unit_ids, root, max_tier):
        res = []
        for k in candidates(root, max_tier):
            mem = members(k)
            sc = sum(M[u][v] + M[v][u] for u in unit_ids for v in mem)
            if sc: res.append((sc * TIER_W.get(N[k].get("tier", 1), 0.5), k))
        res.sort(reverse=True)
        return res

    def override(i):
        fn = i.rsplit("/", 1)[-1]
        for pat, target in C.OVERRIDES:
            m = re.match(pat, fn)
            if m:
                if target is None: target = m.group(1) + " TSI"
                return target
        return None

    stats = defaultdict(int)
    for tier, root, ids, famkey in units:
        i0 = ids[0]; folder = docs[i0]["f"]
        par = override(i0) or C.FOLDER_PARENT.get(folder)
        how = "override" if override(i0) else "folder"
        ranked = scored(ids, root, 1 if tier >= 3 else 0) or scored(ids, root, 3)
        if par and par not in N:
            warn.append(f"override target {par!r} missing for {i0}"); par = None
        if not par:
            how = "citations"
            if ranked: par = ranked[0][1]
            else:
                how = "fallback"
                par = root + "-other"
                if par not in N: add(par, root, ty="grp", l="Other documents", tier=4, w=-2)
        if tier == 4 and how == "citations":
            g = par + "#r"
            if g not in N: add(g, par, ty="grp", l="Referenced documents", w=-0.7, tier=4, role="r")
            par = g
        also = [k for _, k in ranked if k != par][:4]
        n = fam_node(famkey, par, tier, 0) if famkey else doc_node(i0, par, tier=tier)
        if also: n["also"] = also
        stats[how] += 1

    # 3. standards and other cited items not in the library
    def std_group(k):
        g = k + "#s"
        if g not in N: add(g, k, ty="grp", l="Standards & external specifications", w=-0.5, tier=4, role="s")
        return g

    placed_ext = {}
    fam_or_doc = {}   # doc id -> node key that represents it as a parent candidate
    for k, n in N.items():
        if n["ty"] == "fam":
            for i in fams[k]: fam_or_doc.setdefault(i, k)
        elif n["ty"] == "doc" and not n["p"].endswith("#v"):
            fam_or_doc.setdefault(n["id"], k)
    for eid, by in ext_by.items():
        e = ext[eid]
        if e["ty"] not in STDTYPES or e["n"] < 2: continue
        sc = defaultdict(float)
        for s, c in by.items():
            k = fam_or_doc.get(s)
            if k: sc[k] += c
        best = None
        for max_tier in (1, 3):
            r = sorted(((v * TIER_W.get(N[k].get("tier", 1), 0.5), k) for k, v in sc.items() if N[k].get("tier", 9) <= max_tier), reverse=True)
            if r: best = r; break
        if not best: continue
        home = best[0][1]
        while N[home]["ty"] == "doc" and N[home].get("tier") == 2 and N[home]["p"]:
            home = N[home]["p"]
            if N[home]["ty"] == "grp": break
        par = std_group(home)
        lab = e.get("s") or e["l"]
        n = add("e:" + eid, par, ty="ext", id=eid, l=lab, n=e["l"] if e.get("s") else "", d=e.get("t", ""),
                b="paid" if "Paid" in e["a"] else ("free" if e["ty"] in ("ETSI spec",) else ""), w=e["n"], tier=4)
        also = [k for _, k in best[1:5]]
        if also: n["also"] = also
        placed_ext[e["l"]] = n["k"]
    # nest parts under their series (EN 50126-1 under EN 50126) when both sit in the same group
    for lab, k in placed_ext.items():
        b = lab
        while True:
            m = re.match(r"^(.+?)-\d+$", b)
            if not m: break
            b = m.group(1)
            pk = placed_ext.get(b)
            if pk and N[pk]["p"] == N[k]["p"]:
                kids[N[k]["p"]].remove(k); N[k]["p"] = pk; kids[pk].append(k); break

    # 4. Norway <-> EU cross references
    for no, eu in C.TRANSPOSES.items():
        if no in N and eu in N:
            N[no]["imp"] = eu
            add(eu + "#no", eu, ty="x", l="Norway: " + no, n=N[no].get("n"), x=no, w=1e9, hand=1)
            kids[eu].remove(eu + "#no"); kids[eu].insert(0, eu + "#no")
        else:
            warn.append(f"transposition {no!r} -> {eu!r}: missing node")

    # 5. collapse multi-part documents (same short name under one parent)
    for p in list(kids):
        if p.endswith("#v"): continue
        groups = defaultdict(list)
        for k in kids[p]:
            if N[k]["ty"] == "doc" and not N[k]["hand"]: groups[N[k]["l"]].append(k)
        for lab, ks in groups.items():
            if len(ks) < 2: continue
            ks.sort(key=lambda k: N[k]["id"])
            g = add(f"{p}#p:{lab}", p, ty="parts", id=N[ks[0]]["id"], l=lab, n=f"{len(ks)} parts",
                    d=N[ks[0]].get("d"), b=N[ks[0]].get("b"), w=max(N[k]["w"] for k in ks), tier=N[ks[0]].get("tier"))
            for k in ks:
                kids[p].remove(k); N[k]["p"] = g["k"]; kids[g["k"]].append(k); N[k]["hand"] = 1

    # ---------------- order, visibility, output ----------------
    out, index = [], {}

    def walk(k):
        index[k] = len(out)
        n = N[k]
        rec = {x: n[x] for x in ("k", "ty", "id", "l", "n", "d", "b", "c", "x", "imp", "also", "root", "role") if n.get(x) not in (None, "", [])}
        rec["p"] = index[n["p"]] if n["p"] is not None else -1
        if n.get("tier") is not None: rec["t"] = n["tier"]
        out.append(rec)
        ch = kids.get(k, [])
        hand = [c for c in ch if N[c]["hand"]]
        auto = sorted((c for c in ch if not N[c]["hand"] and N[c]["w"] >= 0), key=lambda c: (-N[c]["w"], N[c]["l"].lower()))
        tail = sorted((c for c in ch if not N[c]["hand"] and N[c]["w"] < 0), key=lambda c: -N[c]["w"])
        for j, c in enumerate(auto):
            if j >= C.SHOW: N[c]["hid"] = 1
        for c in hand + auto + tail:
            walk(c)
            if N[c].get("hid"): out[index[c]]["h"] = 1
    for k, n in N.items():
        if n["p"] is None: walk(k)
    # convert also/x/imp keys to indexes
    for r in out:
        if "also" in r: r["also"] = [index[k] for k in r["also"] if k in index]
        if "x" in r: r["x"] = index[r["x"]]
        if "imp" in r: r["imp"] = index[r["imp"]]

    # ---------------- task paths ----------------
    by_short = {}
    for d in data["docs"]:
        if d.get("s"): by_short.setdefault(d["s"], d["id"])
    by_label = {e["l"]: e for e in data["ext"]}

    def resolve(ref):
        if ref in N and N[ref]["ty"] == "fam": return N[ref]["id"]
        if ref in by_short: return by_short[ref]
        if ref in by_label:
            e = by_label[ref]; return e["lib"][0] if e["lib"] else e["id"]
        for d in data["docs"]:
            if ref in d["id"]: return d["id"]
        return None

    paths = []
    for p in C.PATHS:
        steps = []
        for text, refs in p["steps"]:
            ids = []
            for r in refs:
                i = resolve(r)
                if i: ids.append(i)
                else: warn.append(f"path {p['id']}: unresolved {r!r}")
            steps.append([text, ids])
        paths.append({"id": p["id"], "t": p["t"], "d": p.get("d", ""), "s": steps})

    unplaced = [i for i in docs if i not in placed]
    if verbose:
        print(f"navigator: {len(out)} rows · docs placed {len(placed)}/{len(docs)} · cited items {len(placed_ext)} · "
              f"placement {dict(stats)} · paths {len(paths)}")
        for w in warn: print("  warning:", w)
        for i in unplaced: print("  unplaced:", i)
    return {"n": out, "paths": paths}


def write_html(out_dir, data):
    """Render both editions of the map from tools/map_template.html."""
    here = os.path.dirname(os.path.abspath(__file__))
    html = open(os.path.join(here, "map_template.html"), encoding="utf-8").read()
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    os.makedirs(os.path.join(out_dir, "online"), exist_ok=True)
    open(os.path.join(out_dir, "reference_map.html"), "w", encoding="utf-8").write(html.replace("__MODE__", "local").replace("__DATA__", js))
    open(os.path.join(out_dir, "online", "index.html"), "w", encoding="utf-8").write(html.replace("__MODE__", "online").replace("__DATA__", js))
    return len(js)
