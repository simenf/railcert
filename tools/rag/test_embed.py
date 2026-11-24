#!/usr/bin/env python3
"""Offline tests for embed.py's freshness guards (no network): python3 -I tools/rag/test_embed.py"""
import json, os, subprocess, sys, tempfile, unittest

sys.dont_write_bytecode = True

EMBED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "embed.py")


def run(*args, env_extra=None):
    env = {"PATH": os.environ.get("PATH", ""), **(env_extra or {})}
    return subprocess.run([sys.executable, "-I", EMBED, *args], capture_output=True, text=True, env=env, timeout=60)


class EmbedGuards(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        d = self.tmp.name
        self.inp, self.out, self.prog = (os.path.join(d, n) for n in ("chunks.jsonl", "vectors.ndjson", "embed_progress.json"))
        # 2 MiB of chunks, so a change after the first MiB is a realistic "late chunks changed" rebuild
        self.lines = [json.dumps({"id": i, "text": f"chunk {i} " + "x" * 2000, "doc_id": 1, "area": "TSI", "status": "in_force"})
                      for i in range(1000)]
        self.write_input(self.lines)
        self.io = ["--input", self.inp, "--output", self.out]

    def tearDown(self):
        self.tmp.cleanup()

    def write_input(self, lines):
        with open(self.inp, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def fp(self):
        sys.path.insert(0, os.path.dirname(EMBED))
        try:
            import embed
            return embed.fingerprint(self.inp)
        finally:
            sys.path.pop(0)

    def write_progress(self, fp, embedded=1000):
        with open(self.prog, "w", encoding="utf-8") as f:
            json.dump({"input_fingerprint": fp, "embedded": embedded, "total": 1000}, f)
        with open(self.out, "w", encoding="utf-8") as f:
            f.write(json.dumps({"id": "0", "values": [0.0], "metadata": {}}) + "\n")

    def test_check_fresh(self):
        self.assertEqual(run("--check-fresh", *self.io).returncode, 1)          # nothing embedded yet
        self.write_progress(self.fp())
        r = run("--check-fresh", *self.io)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("fresh", r.stdout)
        # change only a chunk well past the first MiB, keeping the size identical
        lines = list(self.lines)
        lines[900] = lines[900].replace("chunk 900 x", "chunk 900 y")
        self.write_input(lines)
        r = run("--check-fresh", *self.io)
        self.assertEqual(r.returncode, 1)
        self.assertIn("stale", r.stderr)

    def test_check_fresh_without_progress(self):
        with open(self.out, "w") as f:
            f.write("{}\n")
        r = run("--check-fresh", *self.io)
        self.assertEqual(r.returncode, 1)
        self.assertIn("missing", r.stderr)

    def test_refuses_resume_without_progress_file(self):
        with open(self.out, "w") as f:
            f.write(json.dumps({"id": "0", "values": [0.0], "metadata": {}}) + "\n")
        r = run(*self.io, env_extra={"CLOUDFLARE_ACCOUNT_ID": "x", "CLOUDFLARE_API_TOKEN": "x"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--restart", r.stderr)

    def test_refuses_resume_with_stale_progress(self):
        self.write_progress("256:deadbeef")   # old-format / other build
        r = run(*self.io, env_extra={"CLOUDFLARE_ACCOUNT_ID": "x", "CLOUDFLARE_API_TOKEN": "x"})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--restart", r.stderr)


if __name__ == "__main__":
    unittest.main()
