#!/usr/bin/env bash
# deploy.sh - OWNER-RUN remote setup for railcert-ask on Cloudflare. Safe to re-run (idempotent-ish).
#
#   bash worker/scripts/deploy.sh                 # all stages, in order
#   bash worker/scripts/deploy.sh resources d1    # only some stages
#
# Stages
#   resources  create D1 db `railcert-ask`, R2 bucket `railcert-library`, Vectorize index `railcert-chunks`
#              (1024 dims, cosine) + metadata indexes (area, ertms_set, status: string; doc_id: number) if missing
#   d1         wrangler d1 execute --remote: schema.sql, then every data-NNNN.sql. DESTRUCTIVE: drops and
#              reloads all tables, so the live Worker is DOWN (errors / empty results) until the last file
#              is loaded. Asks you to type "yes" first; non-interactive runs need CONFIRM_D1_RELOAD=1.
#   r2         upload every r2_manifest.tsv entry (skips keys already recorded in .build/rag/out/r2_uploaded.tsv)
#   vectors    upsert .build/rag/out/vectors.ndjson (from tools/rag/embed.py) in parts of $VEC_PART vectors;
#              refuses if the vectors were embedded from a different chunks.jsonl (embed.py --check-fresh)
#   worker     wrangler deploy --env production
#
# Prerequisites: `npx wrangler login` (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID), Workers Paid plan
# (Vectorize with ~75M stored dimensions; D1 db of ~300 MB), a fresh `python3 -I tools/rag/build_index.py`
# and `python3 -I tools/rag/embed.py`.
# Env: WRANGLER_ENV (default production), R2_PARALLEL (default 4), VEC_PART (default 5000), VEC_BATCH (default 1000),
#      CONFIRM_D1_RELOAD=1 (skip the typed confirmation of the destructive d1 stage)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$WORKER_DIR/.." && pwd)"
OUT="${OUT:-$REPO_DIR/.build/rag/out}"
ENV_NAME="${WRANGLER_ENV:-production}"
DB_NAME=railcert-ask
BUCKET=railcert-library
INDEX=railcert-chunks
R2_PARALLEL="${R2_PARALLEL:-4}"
VEC_PART="${VEC_PART:-5000}"
VEC_BATCH="${VEC_BATCH:-1000}"

STAGES=("$@")
[ ${#STAGES[@]} -gt 0 ] || STAGES=(resources d1 r2 vectors worker)
for s in "${STAGES[@]}"; do
  case "$s" in resources|d1|r2|vectors|worker) ;; -h|--help) sed -n '2,25p' "$0"; exit 0 ;; *) echo "unknown stage: $s" >&2; exit 2 ;; esac
done
want() { local s; for s in "${STAGES[@]}"; do [ "$s" = "$1" ] && return 0; done; return 1; }

cd "$WORKER_DIR"
WRANGLER=(npx --no-install wrangler)
[ -x node_modules/.bin/wrangler ] && WRANGLER=(node_modules/.bin/wrangler)
w() { "${WRANGLER[@]}" "$@"; }
hr() { printf '\n== %s\n' "$*"; }

hr "preflight"
w whoami >/dev/null 2>&1 || { echo "not logged in: run 'npx wrangler login' (in $WORKER_DIR) or set CLOUDFLARE_API_TOKEN" >&2; exit 1; }
[ -f "$OUT/schema.sql" ] || { echo "missing $OUT/schema.sql - run: python3 -I tools/rag/build_index.py" >&2; exit 1; }
grep -q "\"$ENV_NAME\"" wrangler.jsonc || { echo "wrangler.jsonc has no env \"$ENV_NAME\"" >&2; exit 1; }
echo "env=$ENV_NAME  out=$OUT"

# ---------------------------------------------------------------- resources
if want resources; then
  hr "D1 database $DB_NAME"
  if w d1 list --json 2>/dev/null | grep -q "\"name\": *\"$DB_NAME\""; then
    echo "exists"
  else
    w d1 create "$DB_NAME"
  fi
  DB_ID="$(w d1 list --json | python3 -I -c 'import json,sys; print(next((d.get("uuid") or d.get("id") for d in json.load(sys.stdin) if d.get("name")==sys.argv[1]), ""))' "$DB_NAME")"
  echo "database_id: $DB_ID"
  # Only env.$ENV_NAME gets the real id. The top-level (local dev) entry KEEPS the placeholder, so an
  # accidental plain `wrangler deploy` (no --env) fails instead of publishing a second Worker.
  read -r TOP_ID ENV_ID < <(python3 -I - wrangler.jsonc "$ENV_NAME" <<'PY'
import json, re, sys
src = open(sys.argv[1], encoding="utf-8").read()
# strip // and /* */ comments outside strings, then trailing commas (JSONC -> JSON)
out, i, n, q = [], 0, len(src), None
while i < n:
    c = src[i]
    if q:
        out.append(c)
        if c == "\\": out.append(src[i + 1]); i += 1
        elif c == q: q = None
    elif c == '"': q = c; out.append(c)
    elif src.startswith("//", i): i = src.find("\n", i); i = n if i < 0 else i; continue
    elif src.startswith("/*", i): i = src.find("*/", i) + 2; continue
    else: out.append(c)
    i += 1
cfg = json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))
db = lambda c: next((d.get("database_id", "") for d in c.get("d1_databases", []) if d.get("binding") == "DB"), "") or "-"
print(db(cfg), db(cfg.get("env", {}).get(sys.argv[2], {})))
PY
) || true
  PLACEHOLDER=00000000-0000-0000-0000-000000000000
  if [ -z "${ENV_ID:-}" ] || [ "$ENV_ID" = "$PLACEHOLDER" ] || [ "$ENV_ID" = "-" ]; then
    echo "!! wrangler.jsonc env.$ENV_NAME still has the placeholder database_id. Replace ONLY that one"
    echo "   (env.$ENV_NAME.d1_databases; leave the top-level placeholder alone) with:"
    echo "     $DB_ID"
    echo "   then re-run this script."
    exit 1
  fi
  [ "$ENV_ID" = "$DB_ID" ] || echo "!! warning: env.$ENV_NAME database_id is $ENV_ID, but D1 '$DB_NAME' has id $DB_ID - check it"
  [ "$TOP_ID" = "$PLACEHOLDER" ] || echo "!! warning: the top-level database_id is no longer the placeholder; put $PLACEHOLDER back so a plain 'wrangler deploy' fails"

  hr "R2 bucket $BUCKET (private: do NOT enable r2.dev or a public custom domain)"
  if w r2 bucket list 2>/dev/null | grep -qE "(^|[^a-z0-9-])$BUCKET([^a-z0-9-]|$)"; then
    echo "exists"
  else
    w r2 bucket create "$BUCKET"
  fi

  hr "Vectorize index $INDEX (1024 dims, cosine)"
  if w vectorize get "$INDEX" >/dev/null 2>&1; then
    echo "exists"
  else
    w vectorize create "$INDEX" --dimensions=1024 --metric=cosine --description="railcert-ask chunks (bge-m3)"
  fi
  # metadata indexes must exist BEFORE vectors are inserted (earlier vectors are not indexed)
  existing="$(w vectorize list-metadata-index "$INDEX" 2>/dev/null || true)"
  for spec in area:string ertms_set:string status:string doc_id:number; do
    prop="${spec%%:*}"; typ="${spec##*:}"
    if printf '%s' "$existing" | grep -qw "$prop"; then
      echo "metadata index $prop: exists"
    else
      w vectorize create-metadata-index "$INDEX" --propertyName="$prop" --type="$typ"
    fi
  done
fi

# ---------------------------------------------------------------- d1
if want d1; then
  hr "D1 load (remote): schema + data files"
  echo "!! This DROPS and reloads every table of the remote D1 database '$DB_NAME' (env $ENV_NAME)."
  echo "!! The live Worker is down (errors or empty answers) from the first file until the last one is loaded."
  if [ "${CONFIRM_D1_RELOAD:-}" = 1 ]; then
    echo "CONFIRM_D1_RELOAD=1: proceeding"
  elif [ -t 0 ]; then
    read -r -p "Type yes to reload the remote database: " answer
    [ "$answer" = yes ] || { echo "aborted: remote D1 not touched" >&2; exit 1; }
  else
    echo "refusing: not interactive. Re-run with CONFIRM_D1_RELOAD=1 to reload the remote D1 database." >&2
    exit 1
  fi
  shopt -s nullglob
  DATA=("$OUT"/data-[0-9][0-9][0-9][0-9].sql)
  shopt -u nullglob
  [ ${#DATA[@]} -gt 0 ] || { echo "no data files in $OUT" >&2; exit 1; }
  i=0
  for f in "$OUT/schema.sql" "${DATA[@]}"; do
    i=$((i + 1))
    printf '[%d/%d] %s (%s)\n' "$i" "$(( ${#DATA[@]} + 1 ))" "$(basename "$f")" "$(du -h "$f" | cut -f1 | tr -d ' ')"
    w d1 execute "$DB_NAME" --remote --env "$ENV_NAME" --yes --file="$f" >/dev/null
  done
  w d1 execute "$DB_NAME" --remote --env "$ENV_NAME" --command \
    "SELECT (SELECT count(*) FROM docs) AS docs, (SELECT count(*) FROM chunks) AS chunks, (SELECT v FROM meta WHERE k='build_date') AS build_date;"
fi

# ---------------------------------------------------------------- r2
if want r2; then
  MANIFEST="$OUT/r2_manifest.tsv"
  LOG="$OUT/r2_uploaded.tsv"
  touch "$LOG"
  hr "R2 upload to $BUCKET ($(wc -l < "$MANIFEST" | tr -d ' ') manifest entries, $R2_PARALLEL parallel)"
  # pending = manifest entries whose key+size+mtime is not yet in the log
  PENDING="$(mktemp)"
  python3 -I - "$MANIFEST" "$LOG" "$REPO_DIR" > "$PENDING" <<'PY'
import os, sys
manifest, log, repo = sys.argv[1:4]
done = set(l.rstrip("\n") for l in open(log, encoding="utf-8"))
for line in open(manifest, encoding="utf-8"):
    key, path, ctype = line.rstrip("\n").split("\t")
    p = os.path.join(repo, path)
    st = os.stat(p)
    sig = f"{key}\t{st.st_size}\t{int(st.st_mtime)}"
    if sig not in done:
        sys.stdout.write("\t".join([key, p, ctype, sig.replace("\t", "\x1f")]) + "\0")
PY
  n_pending="$(tr -cd '\0' < "$PENDING" | wc -c | tr -d ' ')"
  echo "pending: $n_pending"
  upload_one() {
    IFS=$'\t' read -r key path ctype sig <<< "$1"
    if "${WRANGLER[@]}" r2 object put "$BUCKET/$key" --file "$path" --content-type "$ctype" --remote >/dev/null 2>&1; then
      printf '%s\n' "${sig//$'\x1f'/$'\t'}" >> "$LOG"
      echo "ok   $key"
    else
      echo "FAIL $key" >&2
    fi
  }
  export -f upload_one
  export BUCKET LOG
  export WRANGLER_STR="${WRANGLER[*]}"
  if [ "$n_pending" -gt 0 ]; then
    xargs -0 -n1 -P "$R2_PARALLEL" bash -c 'WRANGLER=($WRANGLER_STR); upload_one "$1"' _ < "$PENDING" || true
  fi
  rm -f "$PENDING"
  left="$(python3 -I -c 'import sys; m=sum(1 for _ in open(sys.argv[1])); d=len(set(open(sys.argv[2]))); print(max(m-d,0))' "$MANIFEST" "$LOG")"
  [ "$left" = 0 ] && echo "all files uploaded" || echo "!! about $left file(s) not uploaded yet - re-run: bash worker/scripts/deploy.sh r2"
fi

# ---------------------------------------------------------------- vectors
if want vectors; then
  VEC="$OUT/vectors.ndjson"
  if [ ! -s "$VEC" ]; then
    echo "!! $VEC missing - run: python3 -I tools/rag/embed.py (skipping vectors; set USE_VECTORS=0 or embed first)"
  else
    # chunk ids are per build: vectors from an older chunks.jsonl would point at the wrong passages
    if ! python3 -I "$REPO_DIR/tools/rag/embed.py" --check-fresh --input "$OUT/chunks.jsonl" --output "$VEC"; then
      echo "refusing to upsert: $VEC does not match the current $OUT/chunks.jsonl" >&2
      echo "  re-embed: python3 -I tools/rag/embed.py --restart   (then re-run: bash worker/scripts/deploy.sh vectors)" >&2
      exit 1
    fi
    total="$(wc -l < "$VEC" | tr -d ' ')"
    chunks="$(wc -l < "$OUT/chunks.jsonl" | tr -d ' ')"
    [ "$total" = "$chunks" ] || echo "!! warning: $total vectors for $chunks chunks (embedding incomplete?)"
    hr "Vectorize upsert: $total vectors in parts of $VEC_PART (batch $VEC_BATCH)"
    PARTS="$(mktemp -d)"
    split -l "$VEC_PART" "$VEC" "$PARTS/part-"
    for f in "$PARTS"/part-*; do
      echo "  $(basename "$f"): $(wc -l < "$f" | tr -d ' ') vectors"
      w vectorize upsert "$INDEX" --file="$f" --batch-size="$VEC_BATCH" >/dev/null
    done
    rm -rf "$PARTS"
    echo "note: Vectorize applies upserts asynchronously; 'wrangler vectorize info $INDEX' shows the count catching up"
    echo "note: chunk ids are per build - after a rebuild with fewer chunks, stale ids beyond the new max remain;"
    echo "      the Worker must ignore vector hits whose chunk id is not in D1 (or recreate the index)."
  fi
fi

# ---------------------------------------------------------------- worker
if want worker; then
  hr "wrangler deploy --env $ENV_NAME"
  w deploy --env "$ENV_NAME"
fi

hr "OWNER CHECKLIST"
cat <<TXT
 1. Secret:   cd worker && npx wrangler secret put OPENROUTER_API_KEY --env $ENV_NAME
 2. Access:   Zero Trust > Access > Applications > Add a self-hosted application covering EVERY hostname
              that reaches this Worker (the custom domain and, if enabled, railcert-ask.<subdomain>.workers.dev;
              workers_dev is false in env.$ENV_NAME - keep it off or protect it too). Policy: allow only the team.
 3. Vars:     set ACCESS_TEAM_DOMAIN (e.g. myteam.cloudflareaccess.com) and ACCESS_AUD (the application's AUD tag)
              in wrangler.jsonc env.$ENV_NAME, then: bash worker/scripts/deploy.sh worker
              (REQUIRE_ACCESS=1 makes the Worker refuse all requests until both are set.)
 4. LLM:      optionally point LLM_BASE_URL at your AI Gateway: https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openrouter
 5. R2:       keep the bucket private: no r2.dev URL and no public custom domain (files are licensed to the team).
 6. Verify:   curl -s https://<host>/api/health  (through Access) shows docs/chunks/vectors.
TXT
