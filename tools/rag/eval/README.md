# railcert-ask evaluation

Python 3 stdlib only. Always run with `python3 -I`.

## Files

- `questions.jsonl`: 40 questions (31 en, 9 no; lookup / concept / multihop / version / absent). Each line has `expect_docs` (library paths from `catalogue.tsv`), `expect_any_doc` (true = any one listed doc counts, false = all are needed), `expect_locators` (article / clause / TRV id strings), `expect_terms` (case-insensitive; `a|b` means either), and `notes` (what a good answer says; also the judge reference). `absent` questions have no expected docs; the right behaviour is to say the library does not contain the answer.
- `run_eval.py`: the runner. `stub_server.py`: a fake backend used by `--selftest`.

## Run

```
python3 -I tools/rag/eval/run_eval.py --validate                      # check questions against catalogue.tsv
python3 -I tools/rag/eval/run_eval.py --base http://localhost:8787    # retrieval only (/api/search)
python3 -I tools/rag/eval/run_eval.py --base http://localhost:8787 --ask [--only q01,q05] [--k 10]
python3 -I tools/rag/eval/run_eval.py --selftest                      # whole pipeline against the stub
```

Options: `--out DIR` (default `.build/rag/eval/<timestamp>`), `--header "Name: value"` (repeatable, e.g. an Access token), `--timeout`, and `--judge-model <openrouter id>` (reads `OPENROUTER_API_KEY` from the environment, never printed; off by default). Output: `results.jsonl` (one row per question with hits, answer, citations, steps, usage, scores) and `summary.md`. Exit code 2 if the server cannot be reached.

## Metrics

- **recall@5 / @10**: share of expected docs found among the first 5 / 10 hits by `doc_path` (any-of questions: 1 if at least one is found). Absent questions are excluded.
- **MRR**: 1 / rank of the first expected doc in the hits (0 if none within k).
- **locator hit rate**: an expected locator (normalised, so "Article 15" matches "Art. 15") appears in the `locator`, `heading` or `snippet` of a top-k hit from an expected doc.
- **cited an expected doc** (`--ask`): the answer's citations include the expected docs (any-of or all, per question).
- **terms present**: fraction of `expect_terms` found in the answer text. A cheap proxy for factual coverage; check misses by hand.
- **failed quote checks**: `quote_checks` entries with `ok=false` (verbatim quotes not found in the cited chunk). Should be 0.
- **absent questions**: keyword heuristic (English and Norwegian) for "the library does not contain this". The same heuristic flags short answers to normal questions that read like refusals (possible false refusals).
- **latency, steps, tokens, cost** come from the `done` event; **LLM judge** (optional) gives a 1-5 score against `notes`.
