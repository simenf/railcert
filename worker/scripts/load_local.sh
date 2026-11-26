#!/usr/bin/env bash
# load_local.sh - load the index built by tools/rag/build_index.py into the LOCAL D1 database (Miniflare)
# used by `wrangler dev`. Never touches remote Cloudflare resources.
#
#   bash worker/scripts/load_local.sh            # default: `wrangler d1 execute DB --local --file=…` for schema + each file
#   bash worker/scripts/load_local.sh --fast     # fast path: sqlite3 straight into the Miniflare D1 SQLite file
#   bash worker/scripts/load_local.sh --files    # also put every r2_manifest.tsv entry into the LOCAL R2 bucket
#                                                # (one wrangler call per file: slow, ~1600 files)
# Env: PERSIST_TO=<dir>  use a non-default Miniflare state dir (same as `wrangler dev --persist-to`)
#      OUT=<dir>         build output dir (default <repo>/.build/rag/out)
#
# Stop `wrangler dev` before running the fast path (it writes the SQLite file directly).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$WORKER_DIR/.." && pwd)"
OUT="${OUT:-$REPO_DIR/.build/rag/out}"
MODE=wrangler
WITH_FILES=0
for a in "$@"; do
  case "$a" in
    --wrangler) MODE=wrangler ;;
    --fast) MODE=fast ;;
    --files) WITH_FILES=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

cd "$WORKER_DIR"
[ -f wrangler.jsonc ] || [ -f wrangler.toml ] || [ -f wrangler.json ] || { echo "no wrangler config in $WORKER_DIR" >&2; exit 1; }
[ -f "$OUT/schema.sql" ] || { echo "missing $OUT/schema.sql - run: python3 -I tools/rag/build_index.py" >&2; exit 1; }
shopt -s nullglob
DATA=("$OUT"/data-[0-9][0-9][0-9][0-9].sql)
shopt -u nullglob
[ ${#DATA[@]} -gt 0 ] || { echo "no data-NNNN.sql files in $OUT" >&2; exit 1; }

WRANGLER=(npx --no-install wrangler)
[ -x node_modules/.bin/wrangler ] && WRANGLER=(node_modules/.bin/wrangler)
PERSIST_ARGS=()
STATE_DIR="$WORKER_DIR/.wrangler/state"
if [ -n "${PERSIST_TO:-}" ]; then
  PERSIST_ARGS=(--persist-to "$PERSIST_TO")
  STATE_DIR="$PERSIST_TO"
fi
d1() { "${WRANGLER[@]}" d1 execute DB --local ${PERSIST_ARGS[@]+"${PERSIST_ARGS[@]}"} --yes "$@"; }
t0=$(date +%s)
echo "== railcert-ask local load ($MODE) from $OUT: schema + ${#DATA[@]} data files"

if [ "$MODE" = wrangler ]; then
  i=0
  for f in "$OUT/schema.sql" "${DATA[@]}"; do
    i=$((i + 1))
    printf '[%d/%d] %s (%s)\n' "$i" "$(( ${#DATA[@]} + 1 ))" "$(basename "$f")" "$(du -h "$f" | cut -f1 | tr -d ' ')"
    d1 --file="$f" >/dev/null
  done
else
  command -v sqlite3 >/dev/null || { echo "sqlite3 CLI not found; use --wrangler" >&2; exit 1; }
  # Make Miniflare create (or open) the database file for binding DB, then find it by a probe row.
  probe="probe_$(date +%s)_$$"
  echo "-- locating the Miniflare D1 file for binding DB (state: $STATE_DIR)"
  d1 --command "CREATE TABLE IF NOT EXISTS _railcert_probe (v TEXT); INSERT INTO _railcert_probe VALUES ('$probe');" >/dev/null
  DBFILE=""
  for f in "$STATE_DIR"/v3/d1/miniflare-D1DatabaseObject/*.sqlite; do
    [ "$(basename "$f")" = metadata.sqlite ] && continue
    if [ "$(sqlite3 "$f" "SELECT count(*) FROM _railcert_probe WHERE v='$probe';" 2>/dev/null || echo 0)" = 1 ]; then DBFILE="$f"; break; fi
  done
  [ -n "$DBFILE" ] || { echo "could not find the local D1 file under $STATE_DIR/v3/d1 (try --wrangler)" >&2; exit 1; }
  echo "-- D1 file: $DBFILE"
  sqlite3 "$DBFILE" "DROP TABLE IF EXISTS _railcert_probe;"
  i=0
  for f in "$OUT/schema.sql" "${DATA[@]}"; do
    i=$((i + 1))
    printf '[%d/%d] %s (%s)\n' "$i" "$(( ${#DATA[@]} + 1 ))" "$(basename "$f")" "$(du -h "$f" | cut -f1 | tr -d ' ')"
    sqlite3 -bail "$DBFILE" ".read '$f'"
  done
  sqlite3 "$DBFILE" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null || true
fi

echo "-- check:"
d1 --command "SELECT (SELECT count(*) FROM docs) AS docs, (SELECT count(*) FROM chunks) AS chunks, (SELECT v FROM meta WHERE k='build_date') AS build_date;" \
  | grep -E '"(docs|chunks|build_date)"' | tr -d ' ,' | paste -sd' ' - || true
d1 --command "SELECT count(*) AS fts_hits FROM chunks_fts WHERE chunks_fts MATCH '\"SUBSET-026\"';" | grep -E '"fts_hits"' | tr -d ' ,' || true

if [ "$WITH_FILES" = 1 ]; then
  MANIFEST="$OUT/r2_manifest.tsv"
  n=$(wc -l < "$MANIFEST" | tr -d ' ')
  echo "== uploading $n files to the LOCAL R2 bucket railcert-library"
  i=0
  while IFS=$'\t' read -r key path ctype; do
    i=$((i + 1))
    [ $((i % 50)) -eq 0 ] && echo "  $i/$n"
    "${WRANGLER[@]}" r2 object put "railcert-library/$key" --file "$REPO_DIR/$path" --content-type "$ctype" --local ${PERSIST_ARGS[@]+"${PERSIST_ARGS[@]}"} >/dev/null
  done < "$MANIFEST"
fi
echo "== done in $(( $(date +%s) - t0 ))s"
