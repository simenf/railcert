#!/usr/bin/env python3
"""Throwaway stub of the railcert-ask HTTP API (contract: worker/CONTRACT.md) for testing run_eval.py.

It reads questions.jsonl and fabricates plausible, deterministic responses:
- /api/search: expected docs first, but every 4th question has them pushed to rank 7, every 9th misses entirely.
- /api/ask: SSE with step/token/done; answers contain most expected terms; one answer has a failing quote check;
  `absent` questions get a "library does not contain" answer (one of them in Norwegian).
Usage: python3 -I tools/rag/eval/stub_server.py --port 8799
"""
import argparse, json, os, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
QS = [json.loads(l) for l in open(os.path.join(HERE, "questions.jsonl"), encoding="utf-8") if l.strip()]
BY_Q = {q["question"]: (i, q) for i, q in enumerate(QS)}
FILLER = ["01_EU_Framework/Dir_2012-34_SERA.pdf", "03_CSM_Safety/Reg_1078-2012_CSM_Monitoring.pdf",
          "06_ERA_Guides/Registers/RINF_Application_Guide_3.1.0.pdf", "02_TSI/INF/Reg_1299-2014_INF_TSI.pdf",
          "09_Referenced_Documents/ETSI/ETSI_EN_300330_v02.01.01.pdf", "10_Cybersecurity_CRA/CRA_FAQ_Commission.pdf",
          "02_TSI/SRT/Reg_1303-2014_SRT_TSI.pdf", "05_Vehicle_Authorisation_Registers/Reg_2019-777_RINF.pdf"]


def hit(path, n, locator="", score=1.0):
    return {"chunk_id": 1000 + n, "doc_path": path, "doc_title": path.rsplit("/", 1)[-1], "short_name": None,
            "reference": None, "status": "in force", "area": "x", "ertms_set": None, "locator": locator,
            "heading": locator, "page_start": 1, "page_end": 1, "inner_file": None, "anchor": None,
            "snippet": "... %s ..." % locator, "score": score, "file_url": "/files/" + path, "official_url": None}


def search(query, k):
    i, q = BY_Q.get(query, (None, None))
    if q is None:
        return [hit(p, n) for n, p in enumerate(FILLER[:k])]
    docs = list(q["expect_docs"])
    loc = (q["expect_locators"] or [""])[0]
    fill = [hit(p, 50 + n) for n, p in enumerate(FILLER)]
    if not docs:
        return fill[:k]
    exp = [hit(p, n, loc if n == 0 else "", 10.0 - n) for n, p in enumerate(docs)]
    if i % 9 == 8:
        return fill[:k]
    if i % 4 == 3:
        return (fill[:6] + exp + fill[6:])[:k]
    return (exp + fill)[:k]


def ask_events(question):
    i, q = BY_Q.get(question, (0, QS[0]))
    ev = [("step", {"n": 1, "tool": "search", "args": {"query": question}, "summary": "Searching - 8 hits"})]
    if q["expect_docs"]:
        ev.append(("step", {"n": 2, "tool": "read", "args": {"chunk_id": 1000}, "summary": "Reading chunk 1000"}))
    cites, answer = [], ""
    if q["type"] == "absent":
        if q["lang"] == "no":
            answer = "Teksten i denne standarden er ikke i biblioteket; jeg finner ikke innholdet og kan ikke sitere det."
        else:
            answer = "That is a paid standard and its text is not in the library, so I cannot quote it. The library only lists which documents cite it."
    else:
        terms = [t.split("|")[0] for t in q["expect_terms"]]
        if i % 5 == 4 and terms:
            terms = terms[:-1]  # drop one term in some answers
        answer = "According to the sources, " + "; ".join(terms) + " [1]."
        if i % 7 == 6:
            answer += ' The text states "this sentence was never in the cited source chunk at all" [1].'
        for n, p in enumerate(q["expect_docs"][:2] if i % 6 else q["expect_docs"][:1]):
            c = hit(p, n)
            c.pop("snippet"); c.pop("score")
            c["n"] = n + 1
            cites.append(c)
    qc = []
    if "never in the cited" in answer:
        qc = [{"quote": "this sentence was never in the cited source chunk at all", "chunk_id": 1000, "ok": False}]
    ev.append(("token", {"t": answer[:20]}))
    ev.append(("token", {"t": answer[20:]}))
    ev.append(("done", {"answer": answer, "citations": cites, "quote_checks": qc,
                        "usage": {"prompt_tokens": 4000 + 10 * i, "completion_tokens": 300, "cost_usd": 0.0012}, "steps": len(ev) - 0}))
    return ev


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/health":
            return self.send_json({"ok": True, "docs": 1, "chunks": 1, "vectors": False, "model": "stub", "build_date": "now"})
        if u.path == "/api/search":
            p = parse_qs(u.query)
            return self.send_json({"query": p["q"][0], "mode": "keyword", "results": search(p["q"][0], int(p.get("k", ["20"])[0]))})
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/api/ask":
            return self.send_json({"error": "not found"}, 404)
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        for name, data in ask_events(body["messages"][-1]["content"]):
            self.wfile.write(("event: %s\ndata: %s\n\n" % (name, json.dumps(data))).encode())
            self.wfile.flush()
            time.sleep(0.005)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8799)
    a = ap.parse_args()
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()
