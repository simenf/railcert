#!/usr/bin/env bash
# railcert – downloads every document listed in catalogue.tsv into its folder.
# Usage (from the railcert folder):   bash download_all.sh
# Re-run safely: files already downloaded (valid PDF/HTML) are skipped.
# Columns in catalogue.tsv: folder filename title reference date_or_status url notes

set -u
cd "$(dirname "$0")"

CATALOGUE="catalogue.tsv"
LOG="download_log.txt"
FAILED="download_failed.tsv"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

[ -f "$CATALOGUE" ] || { echo "catalogue.tsv not found"; exit 1; }
: > "$LOG"
printf "folder\tfilename\ttitle\turl\treason\n" > "$FAILED"

ok=0; skip=0; fail=0; links=0

is_pdf()  { head -c 5 "$1" 2>/dev/null | grep -q '%PDF-'; }
is_html() { head -c 2048 "$1" 2>/dev/null | grep -qi '<html\|<!doctype'; }

while IFS=$'\t' read -r folder filename title reference status url notes; do
  [ -z "${url:-}" ] && continue
  mkdir -p "$folder"
  dest="$folder/$filename"

  # Link-only resources (web pages / databases): write a small link file.
  if [[ "$filename" == *.url.txt ]]; then
    printf "%s\n%s\n%s\n%s\n" "$title" "$reference" "$url" "${notes:-}" > "$dest"
    echo "LINK  $dest" >> "$LOG"; links=$((links+1)); continue
  fi

  if [ -s "$dest" ] && { is_pdf "$dest" || is_html "$dest"; }; then
    echo "SKIP  $dest" >> "$LOG"; skip=$((skip+1)); continue
  fi

  tmp="$dest.part"
  if curl -L --fail --silent --show-error --retry 3 --retry-delay 2 \
          --connect-timeout 20 --max-time 300 -A "$UA" \
          -H "Accept-Language: en,nb;q=0.8" -o "$tmp" "$url" 2>>"$LOG"; then
    if [[ "$filename" == *.pdf ]] && ! is_pdf "$tmp"; then
      # Server returned a web page (cookie wall / bot check / moved file)
      mv "$tmp" "$dest.notpdf.html"
      printf "%s\t%s\t%s\t%s\t%s\n" "$folder" "$filename" "$title" "$url" "not a PDF (saved .notpdf.html – open URL in browser)" >> "$FAILED"
      echo "BAD   $dest (not a PDF)" >> "$LOG"; fail=$((fail+1))
    else
      mv "$tmp" "$dest"; echo "OK    $dest" >> "$LOG"; ok=$((ok+1))
    fi
  else
    rm -f "$tmp" 2>/dev/null
    printf "%s\t%s\t%s\t%s\t%s\n" "$folder" "$filename" "$title" "$url" "HTTP/network error" >> "$FAILED"
    echo "FAIL  $dest" >> "$LOG"; fail=$((fail+1))
  fi
  sleep 0.5   # be polite to EUR-Lex / ERA
  printf "\rDownloaded: %d  skipped: %d  links: %d  failed: %d " "$ok" "$skip" "$links" "$fail"
done < <(tail -n +2 "$CATALOGUE")

echo
echo "Done. See $LOG; anything in $FAILED needs a manual download from the URL listed."
