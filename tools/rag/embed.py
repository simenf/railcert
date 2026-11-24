#!/usr/bin/env python3
"""embed.py - embeddings for railcert-ask chunks via Workers AI @cf/baai/bge-m3 (1024 dims).

  python3 -I tools/rag/embed.py --dry-run          # validate chunks.jsonl, print token/cost estimate (no network)
  python3 -I tools/rag/embed.py                    # needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
  python3 -I tools/rag/embed.py --restart          # discard previous progress
  python3 -I tools/rag/embed.py --check-fresh      # exit 0 if vectors.ndjson was embedded from the current
                                                   # chunks.jsonl, 1 if stale/unknown (used by deploy.sh)

Reads  .build/rag/out/chunks.jsonl  ({"id", "text", "doc_id", "area", "status", "ertms_set"?} per line)
Writes .build/rag/out/vectors.ndjson ({"id":"<chunk id>","values":[...1024],"metadata":{doc_id,area,ertms_set,status}})
       .build/rag/out/embed_progress.json  (resumable: ids already in vectors.ndjson are skipped; the progress
       file pins the chunks.jsonl fingerprint so a rebuilt index is never mixed with old vectors)
"""
import argparse, hashlib, json, os, random, sys, time, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, ".build", "rag", "out")
MODEL = "@cf/baai/bge-m3"
DIMS = 1024
PRICE_PER_M = 0.012          # USD per million input tokens (Workers AI bge-m3)
MAX_CHARS_PER_TEXT = 24_000  # bge-m3 context is 8192 tokens; chunks are far below this, guard anyway


def est_tokens(s):
    # bge-m3 (XLM-R sentencepiece) produces roughly 1 token per 3.3 chars on this mixed EN/NO technical text;
    # use chars/3.3 for cost (conservative) and report chars/4 for comparison with the index stats
    return len(s) / 3.3


def fingerprint(path):
    """sha256 of the WHOLE file (a rebuild can change only late chunks; the first MiB is not enough)."""
    st = os.stat(path)
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return f"sha256:{st.st_size}:{h.hexdigest()}"


def check_fresh(input_path, output_path, progress_path):
    """(ok, message): ok only if the progress file pins the current input's fingerprint."""
    if not os.path.exists(input_path):
        return False, f"missing {input_path}"
    if not os.path.exists(output_path):
        return False, f"missing {output_path}"
    if not os.path.exists(progress_path):
        return False, f"missing {progress_path}: cannot tell which chunks.jsonl {os.path.basename(output_path)} was built from"
    try:
        prog = json.load(open(progress_path, encoding="utf-8"))
    except Exception as e:
        return False, f"unreadable {progress_path}: {e}"
    if prog.get("input_fingerprint") != fingerprint(input_path):
        return False, ("stale: the vectors were embedded from a different chunks.jsonl (an older build). "
                       "Re-embed with: python3 -I tools/rag/embed.py --restart")
    msg = f"fresh: {prog.get('embedded', '?')}/{prog.get('total', '?')} chunks embedded from the current chunks.jsonl"
    if prog.get("embedded") != prog.get("total"):
        msg += " (incomplete: rerun embed.py to finish)"
    return True, msg


def load_chunks(path):
    chunks, errors, seen = [], [], set()
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            try:
                c = json.loads(line)
            except Exception as e:
                errors.append(f"line {n}: bad JSON ({e})")
                continue
            cid = c.get("id")
            if not isinstance(cid, int):
                errors.append(f"line {n}: id must be an integer")
                continue
            if cid in seen:
                errors.append(f"line {n}: duplicate id {cid}")
            seen.add(cid)
            if not isinstance(c.get("text"), str) or not c["text"].strip():
                errors.append(f"line {n}: empty text (id {cid})")
            for k in ("doc_id", "area", "status"):
                if c.get(k) in (None, ""):
                    errors.append(f"line {n}: missing metadata '{k}' (id {cid})")
            chunks.append(c)
    return chunks, errors


def metadata(c):
    m = {"doc_id": c["doc_id"], "area": c["area"], "status": c["status"]}
    if c.get("ertms_set"):
        m["ertms_set"] = c["ertms_set"]
    return m


def call_ai(account, token, texts, timeout=120):
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{MODEL}"
    body = json.dumps({"text": texts}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        res = json.loads(r.read().decode("utf-8"))
    if not res.get("success", True):
        raise RuntimeError(f"API error: {res.get('errors')}")
    out = res.get("result", res)
    vecs = out.get("data") or out.get("response")
    if not isinstance(vecs, list) or len(vecs) != len(texts):
        raise RuntimeError(f"unexpected response shape: keys={list(out)[:5]}")
    for v in vecs:
        if len(v) != DIMS:
            raise RuntimeError(f"expected {DIMS} dims, got {len(v)}")
    return vecs


class Fatal(Exception):
    pass


def embed_with_retry(account, token, texts, max_attempts=8):
    delay = 2.0
    for attempt in range(1, max_attempts + 1):
        try:
            return call_ai(account, token, texts)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")[:300]
            if e.code in (401, 403):
                raise Fatal(f"HTTP {e.code}: check CLOUDFLARE_API_TOKEN (needs Workers AI read/run): {detail}")
            if e.code in (400, 413) and len(texts) > 1:
                raise ValueError(f"HTTP {e.code}: {detail}")   # caller splits the batch
            if e.code in (400, 413):
                raise Fatal(f"HTTP {e.code} for a single text: {detail}")
            err = f"HTTP {e.code}: {detail}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, RuntimeError, json.JSONDecodeError) as e:
            err = f"{type(e).__name__}: {e}"
        if attempt == max_attempts:
            raise Fatal(f"giving up after {max_attempts} attempts: {err}")
        sleep = delay * (1 + random.random() * 0.5)
        print(f"  retry {attempt}/{max_attempts - 1} in {sleep:.0f}s ({err[:160]})", file=sys.stderr)
        time.sleep(sleep)
        delay = min(delay * 2, 120)


def embed_batch(account, token, batch):
    """returns list of vectors; splits the batch on 400/413"""
    try:
        return embed_with_retry(account, token, [c["_t"] for c in batch])
    except ValueError:
        mid = len(batch) // 2
        return embed_batch(account, token, batch[:mid]) + embed_batch(account, token, batch[mid:])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", default=os.path.join(OUT, "chunks.jsonl"))
    ap.add_argument("--output", default=os.path.join(OUT, "vectors.ndjson"))
    ap.add_argument("--batch", type=int, default=50, help="texts per request (default 50)")
    ap.add_argument("--max-batch-chars", type=int, default=120_000)
    ap.add_argument("--dry-run", action="store_true", help="validate input and print estimates; no network")
    ap.add_argument("--restart", action="store_true", help="ignore and overwrite previous progress")
    ap.add_argument("--limit", type=int, help="embed at most N new chunks (testing)")
    ap.add_argument("--check-fresh", action="store_true",
                    help="exit 0 if the output was embedded from the current input, 1 otherwise; no network")
    args = ap.parse_args()
    progress_path = os.path.join(os.path.dirname(args.output), "embed_progress.json")

    if args.check_fresh:
        ok, msg = check_fresh(args.input, args.output, progress_path)
        print(msg, file=sys.stdout if ok else sys.stderr)
        sys.exit(0 if ok else 1)

    if not os.path.exists(args.input):
        sys.exit(f"missing {args.input}; run tools/rag/build_index.py first")
    chunks, errors = load_chunks(args.input)
    if errors:
        print(f"{len(errors)} problem(s) in {args.input}:", file=sys.stderr)
        for e in errors[:20]:
            print("  " + e, file=sys.stderr)
        sys.exit(1)
    chars = sum(len(c["text"]) for c in chunks)
    toks = sum(est_tokens(c["text"][:MAX_CHARS_PER_TEXT]) for c in chunks)
    too_long = sum(1 for c in chunks if len(c["text"]) > MAX_CHARS_PER_TEXT)
    n_req = 0
    cur_n = cur_c = 0
    for c in chunks:
        l = min(len(c["text"]), MAX_CHARS_PER_TEXT)
        if cur_n and (cur_n >= args.batch or cur_c + l > args.max_batch_chars):
            n_req += 1
            cur_n = cur_c = 0
        cur_n += 1
        cur_c += l
    n_req += 1 if cur_n else 0
    print(f"chunks: {len(chunks):,}  chars: {chars:,}  est. tokens: {toks:,.0f} (chars/3.3; chars/4 = {chars / 4:,.0f})")
    print(f"requests: ~{n_req:,} at batch {args.batch}  est. cost: ${toks / 1e6 * PRICE_PER_M:.4f} (bge-m3 ${PRICE_PER_M}/M tokens)")
    print(f"vectors.ndjson size: ~{len(chunks) * 11.5 / 1024:,.0f} MB  ({DIMS} dims)")
    if too_long:
        print(f"note: {too_long} chunk(s) longer than {MAX_CHARS_PER_TEXT} chars will be truncated for embedding")
    if args.dry_run:
        print("dry run OK: input is valid; nothing was sent")
        return

    account, token = os.environ.get("CLOUDFLARE_ACCOUNT_ID"), os.environ.get("CLOUDFLARE_API_TOKEN")
    if not account or not token:
        sys.exit("set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI permission)")

    fp = fingerprint(args.input)
    done = set()
    if args.restart:
        for p in (args.output, progress_path):
            if os.path.exists(p):
                os.remove(p)
    if os.path.exists(progress_path):
        prog = json.load(open(progress_path, encoding="utf-8"))
        if prog.get("input_fingerprint") != fp:
            sys.exit("chunks.jsonl changed since the last embedding run (chunk ids are per build), or the progress "
                     "file predates the whole-file fingerprint. Run with --restart to re-embed everything.")
    elif os.path.exists(args.output) and os.path.getsize(args.output) > 0:
        # Without a progress file we cannot tell which build these vectors came from: resuming could mix builds.
        sys.exit(f"{args.output} exists but {progress_path} does not, so its chunks.jsonl is unknown. "
                 "Run with --restart to re-embed everything.")
    if os.path.exists(args.output):
        good = []
        with open(args.output, "rb") as f:
            data = f.read()
        for line in data.split(b"\n"):
            if not line.strip():
                continue
            try:
                v = json.loads(line)
                done.add(int(v["id"]))
                good.append(line)
            except Exception:
                pass          # partial last line from an interrupted run
        if len(good) != data.count(b"\n"):
            with open(args.output, "wb") as f:
                f.write(b"".join(l + b"\n" for l in good))
    todo = [c for c in chunks if c["id"] not in done]
    if args.limit:
        todo = todo[:args.limit]
    print(f"already embedded: {len(done):,}; to do: {len(todo):,}")
    out = open(args.output, "a", encoding="utf-8")
    t0, n_done = time.time(), 0

    def save_progress():
        json.dump({"input_fingerprint": fp, "model": MODEL, "dims": DIMS, "embedded": len(done),
                   "total": len(chunks), "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                  open(progress_path, "w", encoding="utf-8"))

    save_progress()
    i = 0
    try:
        while i < len(todo):
            batch, bc = [], 0
            while i < len(todo) and len(batch) < args.batch:
                t = todo[i]["text"][:MAX_CHARS_PER_TEXT]
                if batch and bc + len(t) > args.max_batch_chars:
                    break
                todo[i]["_t"] = t
                batch.append(todo[i])
                bc += len(t)
                i += 1
            vecs = embed_batch(account, token, batch)
            for c, v in zip(batch, vecs):
                out.write(json.dumps({"id": str(c["id"]), "values": [round(x, 6) for x in v], "metadata": metadata(c)},
                                     separators=(",", ":")) + "\n")
                done.add(c["id"])
            out.flush()
            n_done += len(batch)
            save_progress()
            el = time.time() - t0
            print(f"  {len(done):,}/{len(chunks):,} embedded ({n_done / el:.1f}/s, eta {(len(todo) - n_done) / max(n_done / el, 1e-9) / 60:.0f} min)",
                  file=sys.stderr)
    except Fatal as e:
        save_progress()
        sys.exit(f"stopped: {e}\nprogress saved; rerun to resume")
    except KeyboardInterrupt:
        save_progress()
        sys.exit("interrupted; progress saved; rerun to resume")
    finally:
        out.close()
    print(f"done: {len(done):,} vectors in {args.output}")


if __name__ == "__main__":
    main()
