#!/usr/bin/env python3
"""Evaluation runner for railcert-ask (retrieval via /api/search, answers via /api/ask).

Python 3 stdlib only.  Run with:  python3 -I tools/rag/eval/run_eval.py --base http://localhost:8787
"""
import argparse, datetime, http.client, json, os, re, subprocess, sys, tempfile, time
import urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

ABSENT_PATTERNS = [
    # English
    r"not (?:\w+ ){0,3}(?:in|part of|included in|available in|found in|covered by|contained in) (?:the|this|our) (?:library|collection|corpus|documents|knowledge base)",
    r"(?:library|collection|corpus) (?:does not|doesn't|do not|has no|contains no|does not contain|doesn't contain|lacks)",
    r"(?:no|not any) (?:relevant |direct |specific )?(?:information|text|content|mention|passage|document)s? (?:on|about|in|of|for|was found|is available|available)",
    r"(?:cannot|can't|could not|couldn't|unable to|did not|didn't) (?:find|locate|provide|quote|retrieve)",
    r"not (?:publicly )?(?:available|downloaded|included|reproduced|public)",
    r"(?:paid|copyrighted|licensed|proprietary|commercial|purchased) (?:standard|document|text)",
    # Norwegian
    r"ikke (?:\w+ ){0,3}(?:i|med i|inkludert i|tilgjengelig i|dekket av) (?:biblioteket|samlingen|dokumentene|kunnskapsbasen)",
    r"(?:biblioteket|samlingen) (?:inneholder ikke|har ikke|mangler|dekker ikke)",
    r"(?:finner|fant|kan|klarer) ikke (?:å )?(?:finne|funnet|gi|sitere|hente)",
    r"ingen (?:relevant |direkte )?(?:informasjon|tekst|innhold|treff|dokument)",
    r"(?:betalt|opphavsrettsbeskyttet|lisensiert|kjøpt)e? (?:standard|dokument)",
    r"ikke (?:offentlig )?(?:tilgjengelig|lastet ned|inkludert|gjengitt)",
]
ABSENT_RE = re.compile("|".join("(?:%s)" % p for p in ABSENT_PATTERNS), re.I)


# ----------------------------------------------------------------------------- helpers
def norm_text(s):
    s = (s or "").lower()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub("[‐-―−­]", "-", s)
    s = s.replace(" ", " ")
    return re.sub(r"\s+", " ", s)


def norm_loc(s):
    s = norm_text(s)
    s = re.sub(r"\barticle\b", "art", s)
    s = re.sub(r"\bsection\b|\bpoint\b|\bclause\b", "", s)
    return re.sub(r"[\s.]+", "", s)


def term_present(term, text_n):
    """A term may list alternatives with '|' (any of them counts)."""
    return any(norm_text(alt) in text_n for alt in term.split("|") if alt.strip())


def load_questions(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError as e:
                sys.exit("questions.jsonl line %d: %s" % (i, e))
    return out


def validate(questions, catalogue):
    import csv
    with open(catalogue, encoding="utf-8", newline="") as f:
        known = {r["folder"] + "/" + r["filename"] for r in csv.DictReader(f, delimiter="\t")}
    bad, ids = [], set()
    for q in questions:
        if q["id"] in ids:
            bad.append("duplicate id " + q["id"])
        ids.add(q["id"])
        for k in ("id", "lang", "type", "question", "expect_docs", "expect_any_doc", "expect_locators", "expect_terms", "notes"):
            if k not in q:
                bad.append("%s: missing %s" % (q["id"], k))
        if q.get("type") not in ("lookup", "concept", "multihop", "version", "absent"):
            bad.append("%s: bad type %r" % (q["id"], q.get("type")))
        if q.get("type") != "absent" and not q.get("expect_docs"):
            bad.append("%s: non-absent question without expect_docs" % q["id"])
        for d in q.get("expect_docs", []):
            if d not in known:
                bad.append("%s: not in catalogue: %s" % (q["id"], d))
    return bad


class Server:
    def __init__(self, base, headers, timeout):
        self.base, self.headers, self.timeout = base.rstrip("/"), headers, timeout

    def req(self, path, data=None, accept="application/json"):
        h = dict(self.headers)
        h["Accept"] = accept
        body = None
        if data is not None:
            body = json.dumps(data).encode()
            h["Content-Type"] = "application/json"
        return urllib.request.Request(self.base + path, data=body, headers=h, method="POST" if body else "GET")

    def get_json(self, path):
        with urllib.request.urlopen(self.req(path), timeout=self.timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def ask(self, question):
        """POST /api/ask, parse the SSE stream. Returns dict with events."""
        t0 = time.time()
        res = {"steps": [], "tokens": 0, "done": None, "error": None, "ttft_s": None}
        state = {"ev": None, "data": []}

        def flush():
            ev, data = state["ev"], state["data"]
            state["ev"], state["data"] = None, []
            if ev is None or not data:
                return
            try:
                payload = json.loads("\n".join(data))
            except ValueError:
                payload = {"raw": "\n".join(data)}
            if ev == "step":
                res["steps"].append(payload)
            elif ev == "token":
                res["tokens"] += 1
                if res["ttft_s"] is None:
                    res["ttft_s"] = round(time.time() - t0, 3)
            elif ev == "done":
                res["done"] = payload
            elif ev == "error":
                res["error"] = payload.get("message", str(payload))

        with urllib.request.urlopen(self.req("/api/ask", {"messages": [{"role": "user", "content": question}]},
                                             accept="text/event-stream"), timeout=self.timeout) as r:
            for raw in r:
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                if line == "":
                    flush()
                elif line.startswith(":"):
                    continue
                elif line.startswith("event:"):
                    state["ev"] = line[6:].strip()
                elif line.startswith("data:"):
                    v = line[5:]
                    state["data"].append(v[1:] if v.startswith(" ") else v)
            flush()
        res["latency_s"] = round(time.time() - t0, 3)
        return res


# ----------------------------------------------------------------------------- scoring
def hit_blob(h):
    return norm_loc(" ".join(str(h.get(f) or "") for f in ("locator", "heading", "snippet")))


def score_retrieval(q, hits, k):
    exp = q.get("expect_docs") or []
    top = hits[:k]
    docs = [h.get("doc_path") for h in top]
    r = {"n_hits": len(hits), "top_docs": docs}
    if exp:
        def recall(n):
            got = set(docs[:n])
            if q.get("expect_any_doc"):
                return 1.0 if any(d in got for d in exp) else 0.0
            return sum(1 for d in exp if d in got) / len(exp)
        r["recall@5"], r["recall@10"] = recall(5), recall(10)
        rank = next((i + 1 for i, d in enumerate(docs) if d in exp), None)
        r["first_rank"] = rank
        r["mrr"] = 1.0 / rank if rank else 0.0
    locs = [norm_loc(x) for x in (q.get("expect_locators") or [])]
    if locs:
        # hit: a locator appears in locator/heading/snippet of any top-k hit that is in an expected doc
        r["locator_hit"] = any(l in hit_blob(h) for h in top if (not exp or h.get("doc_path") in exp) for l in locs)
    return r


def score_answer(q, done):
    answer = (done or {}).get("answer") or ""
    an = norm_text(answer)
    exp = q.get("expect_docs") or []
    cites = (done or {}).get("citations") or []
    cited = {c.get("doc_path") for c in cites}
    s = {"answer_chars": len(answer), "n_citations": len(cites)}
    if exp:
        s["cited_expected_any"] = any(d in cited for d in exp)
        s["cited_expected_frac"] = sum(1 for d in exp if d in cited) / len(exp)
        s["cited_expected"] = s["cited_expected_any"] if q.get("expect_any_doc") else s["cited_expected_frac"] == 1.0
    terms = q.get("expect_terms") or []
    if terms:
        missing = [t for t in terms if not term_present(t, an)]
        s["terms_found"] = len(terms) - len(missing)
        s["terms_total"] = len(terms)
        s["terms_frac"] = s["terms_found"] / len(terms)
        s["terms_missing"] = missing
    qc = (done or {}).get("quote_checks") or []
    s["quotes"] = len(qc)
    s["quote_fail"] = sum(1 for c in qc if not c.get("ok"))
    admits = bool(ABSENT_RE.search(answer))
    if q["type"] == "absent":
        s["admits_absent"] = admits
    else:
        s["false_refusal_flag"] = admits and len(answer) < 600
    return s


def judge(base, model, key, q, answer, timeout):
    prompt = (
        "You grade answers of a railway-regulation RAG assistant.\n"
        "Question: %s\n\nReference notes (what a good answer says): %s\n\nAnswer under test:\n%s\n\n"
        "Score 1-5 (5 = correct, complete, grounded; 3 = partly right; 1 = wrong or unsupported). "
        "For questions whose answer is not in the library, 5 means the answer clearly says so and does not invent content. "
        "Reply with JSON only: {\"score\": <1-5>, \"reason\": \"<one sentence>\"}."
    ) % (q["question"], q["notes"], answer[:6000])
    body = json.dumps({"model": model, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}).encode()
    req = urllib.request.Request(base.rstrip("/") + "/chat/completions", data=body, method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json",
                                          "X-Title": "Railcert Ask eval"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        txt = json.loads(r.read().decode())["choices"][0]["message"]["content"]
    m = re.search(r"\{.*\}", txt, re.S)
    j = json.loads(m.group(0)) if m else {}
    return {"judge_score": int(j.get("score", 0)) or None, "judge_reason": str(j.get("reason", ""))[:300]}


# ----------------------------------------------------------------------------- reporting
def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def pct(x):
    return "n/a" if x is None else "%.0f%%" % (100 * x)


def num(x, f="%.3f"):
    return "n/a" if x is None else f % x


def summarise(rows, ask, k, base):
    L = []
    ret = [r for r in rows if r.get("retrieval", {}).get("recall@5") is not None]
    L.append("# railcert-ask evaluation\n")
    L.append("- server: `%s` | questions run: %d | k=%d | ask: %s\n" % (base, len(rows), k, "yes" if ask else "no"))
    L.append("## Retrieval (questions with expected docs: %d)\n" % len(ret))
    L.append("| metric | value |\n|---|---|")
    L.append("| recall@5 | %s |" % num(mean([r["retrieval"]["recall@5"] for r in ret])))
    L.append("| recall@10 | %s |" % num(mean([r["retrieval"]["recall@10"] for r in ret])))
    L.append("| MRR | %s |" % num(mean([r["retrieval"]["mrr"] for r in ret])))
    lh = [r["retrieval"]["locator_hit"] for r in rows if r.get("retrieval", {}).get("locator_hit") is not None]
    L.append("| locator hit rate | %s (%d questions) |" % (pct(mean([1.0 if x else 0.0 for x in lh])), len(lh)))
    L.append("")
    by = {}
    for r in ret:
        by.setdefault(r["type"], []).append(r["retrieval"])
    L.append("| type | n | recall@5 | recall@10 | MRR |\n|---|---|---|---|---|")
    for t, v in sorted(by.items()):
        L.append("| %s | %d | %s | %s | %s |" % (t, len(v), num(mean([x["recall@5"] for x in v]), "%.2f"),
                                                num(mean([x["recall@10"] for x in v]), "%.2f"), num(mean([x["mrr"] for x in v]), "%.2f")))
    errs = [r for r in rows if r.get("search_error")]
    if errs:
        L.append("\nSearch errors: " + ", ".join("%s (%s)" % (r["id"], r["search_error"]) for r in errs))
    if ask:
        ans = [r for r in rows if r.get("answer") is not None]
        L.append("\n## Answers (%d answered, %d errors)\n" % (len(ans), sum(1 for r in rows if r.get("ask_error"))))
        na = [(r, r["score"]) for r in ans if r["type"] != "absent"]
        L.append("| metric | value |\n|---|---|")
        L.append("| cited an expected doc (per question rule) | %s |" % pct(mean([1.0 if s["cited_expected"] else 0.0 for r, s in na if "cited_expected" in s])))
        L.append("| expected terms present (mean fraction) | %s |" % pct(mean([s["terms_frac"] for r, s in na if "terms_frac" in s])))
        L.append("| failed quote checks | %d of %d quotes |" % (sum(r["score"]["quote_fail"] for r in ans), sum(r["score"]["quotes"] for r in ans)))
        ab = [r["score"]["admits_absent"] for r in ans if r["type"] == "absent"]
        L.append("| absent questions: admitted library lacks it | %d / %d |" % (sum(1 for x in ab if x), len(ab)))
        L.append("| possible false refusals (non-absent) | %d |" % sum(1 for r, s in na if s.get("false_refusal_flag")))
        L.append("| mean latency | %s s |" % num(mean([r["ask"]["latency_s"] for r in ans]), "%.1f"))
        L.append("| mean steps | %s |" % num(mean([r["ask"]["done"].get("steps", len(r["ask"]["steps"])) for r in ans]), "%.1f"))
        cost = [(r["ask"]["done"].get("usage") or {}).get("cost_usd") for r in ans]
        cost = [c for c in cost if c is not None]
        L.append("| total cost | %s |" % ("$%.4f" % sum(cost) if cost else "n/a"))
        pt = sum((r["ask"]["done"].get("usage") or {}).get("prompt_tokens", 0) for r in ans)
        ct = sum((r["ask"]["done"].get("usage") or {}).get("completion_tokens", 0) for r in ans)
        L.append("| tokens (prompt / completion) | %d / %d |" % (pt, ct))
        js = [r["score"].get("judge_score") for r in ans if r["score"].get("judge_score")]
        if js:
            L.append("| LLM judge mean (1-5) | %.2f over %d |" % (mean(js), len(js)))
    L.append("\n## Per question\n")
    hdr = "| id | type | lang | rank | R@5 | R@10 | loc |"
    if ask:
        hdr += " cited | terms | bad quotes | admits-absent | judge | s |"
    L.append(hdr)
    L.append("|" + "---|" * (hdr.count("|") - 1))
    for r in rows:
        rt = r.get("retrieval", {})
        has = rt.get("recall@5") is not None
        line = "| %s | %s | %s | %s | %s | %s | %s |" % (
            r["id"], r["type"], r["lang"], (rt.get("first_rank") or "-") if has else "",
            num(rt.get("recall@5"), "%.2f") if has else "", num(rt.get("recall@10"), "%.2f") if has else "",
            "" if rt.get("locator_hit") is None else ("y" if rt["locator_hit"] else "n"))
        if ask:
            s = r.get("score")
            if s:
                line += " %s | %s | %s | %s | %s | %.0f |" % (
                    "" if "cited_expected" not in s else ("y" if s["cited_expected"] else "n"),
                    "" if "terms_frac" not in s else "%d/%d" % (s["terms_found"], s["terms_total"]),
                    s["quote_fail"], "" if "admits_absent" not in s else ("y" if s["admits_absent"] else "n"),
                    s.get("judge_score") or "", r["ask"]["latency_s"])
            else:
                line += " ERR %s | | | | | |" % (r.get("ask_error") or "")[:40]
        L.append(line)
    miss = [r for r in ret if r["retrieval"]["recall@10"] < 1.0]
    if miss:
        L.append("\n## Retrieval misses (recall@10 < 1)\n")
        for r in miss:
            L.append("- %s: %s\n  - expected: %s\n  - got: %s" % (r["id"], r["question"], "; ".join(r["expect_docs"]),
                                                               "; ".join(str(x) for x in r["retrieval"]["top_docs"][:5])))
    return "\n".join(L) + "\n"


# ----------------------------------------------------------------------------- main
def run(args):
    qs = load_questions(args.questions)
    bad = validate(qs, args.catalogue)
    if bad:
        print("question validation problems:\n  " + "\n  ".join(bad), file=sys.stderr)
        if args.validate:
            return 1
    elif args.validate:
        print("OK: %d questions, all expect_docs exist in catalogue.tsv" % len(qs))
        return 0
    if args.only:
        want = {x.strip() for x in args.only.split(",")}
        qs = [q for q in qs if q["id"] in want]
        if not qs:
            print("no questions match --only", file=sys.stderr)
            return 1
    headers = {}
    for h in args.header or []:
        n, _, v = h.partition(":")
        headers[n.strip()] = v.strip()
    srv = Server(args.base, headers, args.timeout)
    try:
        srv.get_json("/api/health")
    except urllib.error.HTTPError as e:
        print("warning: /api/health returned HTTP %s (continuing)" % e.code, file=sys.stderr)
    except (urllib.error.URLError, ConnectionError, OSError, http.client.HTTPException) as e:
        print("cannot reach %s: %s\nIs the worker running (npm run dev in worker/)? Nothing was evaluated."
              % (args.base, getattr(e, "reason", e)), file=sys.stderr)
        return 2
    except ValueError:
        pass
    out = args.out or os.path.join(ROOT, ".build", "rag", "eval", datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
    os.makedirs(out, exist_ok=True)
    jkey = os.environ.get("OPENROUTER_API_KEY") if args.judge_model else None
    if args.judge_model and not jkey:
        print("warning: --judge-model given but OPENROUTER_API_KEY not set; judge disabled", file=sys.stderr)
    rows = []
    for i, q in enumerate(qs, 1):
        row = {k: q[k] for k in ("id", "lang", "type", "question", "expect_docs", "expect_any_doc", "expect_locators", "expect_terms")}
        t0 = time.time()
        try:
            res = srv.get_json("/api/search?" + urllib.parse.urlencode({"q": q["question"], "k": args.k}))
            hits = res.get("results", [])
            row["search_mode"] = res.get("mode")
            row["search_s"] = round(time.time() - t0, 3)
            row["retrieval"] = score_retrieval(q, hits, args.k)
            row["hits"] = [{k2: h.get(k2) for k2 in ("doc_path", "locator", "heading", "page_start", "score", "chunk_id")} for h in hits[:args.k]]
        except Exception as e:  # noqa
            row["search_error"] = "%s: %s" % (type(e).__name__, getattr(e, "reason", e))
            row["retrieval"] = {"recall@5": None}
        if args.ask:
            try:
                a = srv.ask(q["question"])
                if a["error"] or not a["done"]:
                    raise RuntimeError(a["error"] or "stream ended without done event")
                row["ask"] = a
                row["answer"] = a["done"].get("answer", "")
                row["citations"] = a["done"].get("citations", [])
                row["score"] = score_answer(q, a["done"])
                if jkey:
                    try:
                        row["score"].update(judge(args.judge_base, args.judge_model, jkey, q, row["answer"], args.timeout))
                    except Exception as e:  # noqa
                        row["score"]["judge_error"] = type(e).__name__
            except Exception as e:  # noqa
                row["ask_error"] = "%s: %s" % (type(e).__name__, getattr(e, "reason", e))
        rt = row["retrieval"]
        print("[%2d/%d] %s %-9s rank=%s R@5=%s%s" % (
            i, len(qs), q["id"], q["type"], rt.get("first_rank"), rt.get("recall@5"),
            ("  ask=%s" % ("ERR" if row.get("ask_error") else "%.1fs" % row["ask"]["latency_s"])) if args.ask else ""), flush=True)
        rows.append(row)
    with open(os.path.join(out, "results.jsonl"), "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    md = summarise(rows, args.ask, args.k, args.base)
    with open(os.path.join(out, "summary.md"), "w", encoding="utf-8") as f:
        f.write(md)
    print("\n" + md)
    print("written to", out)
    return 0


def selftest(args):
    """Start the stub server on a free port and run the whole pipeline against it."""
    import socket
    s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    p = subprocess.Popen([sys.executable, "-I", os.path.join(HERE, "stub_server.py"), "--port", str(port)])
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=1).read()
                break
            except Exception:
                time.sleep(0.1)
        args.base = "http://127.0.0.1:%d" % port
        args.ask = True
        args.out = args.out or tempfile.mkdtemp(prefix="railcert-eval-selftest-")
        return run(args)
    finally:
        p.terminate()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://localhost:8787")
    ap.add_argument("--questions", default=os.path.join(HERE, "questions.jsonl"))
    ap.add_argument("--catalogue", default=os.path.join(ROOT, "catalogue.tsv"))
    ap.add_argument("--ask", action="store_true", help="also call /api/ask and score the answers")
    ap.add_argument("--only", help="comma-separated question ids")
    ap.add_argument("--k", type=int, default=10)
    ap.add_argument("--out", help="output dir (default .build/rag/eval/<timestamp>)")
    ap.add_argument("--timeout", type=float, default=180)
    ap.add_argument("--header", action="append", help="extra request header 'Name: value' (e.g. Cf-Access-Jwt-Assertion)")
    ap.add_argument("--judge-model", help="OpenRouter model id for an LLM judge (needs OPENROUTER_API_KEY); off by default")
    ap.add_argument("--judge-base", default="https://openrouter.ai/api/v1")
    ap.add_argument("--validate", action="store_true", help="only validate questions.jsonl against catalogue.tsv")
    ap.add_argument("--selftest", action="store_true", help="run against the bundled stub server")
    args = ap.parse_args()
    sys.exit(selftest(args) if args.selftest else run(args))


if __name__ == "__main__":
    main()
