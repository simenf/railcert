#!/usr/bin/env bash
# Rebuilds catalogue.tsv, the reference map (local + online editions) and README.md.
# Needs the downloaded documents (run download_all.sh first), python3 and pdftotext (poppler).
# Usage, from the repository root:   bash tools/finalize.sh
set -euo pipefail
L=$(cd "$(dirname "$0")/.." && pwd)   # library / repository root
T=$L/tools                            # scripts
R=$T/data                             # catalogue sources (one TSV per harvest)
W=${WORK:-$L/.build}                  # scratch: extracted text, edges, nodes (git-ignored)
mkdir -p "$W/refs" "$W/meta"
n=$(find "$L" -name '*.pdf' -not -path '*/.git/*' | wc -l)
if [ "$n" -lt 500 ]; then echo "Only $n PDFs found. Run 'bash download_all.sh' first; the catalogue keeps only rows whose file exists." >&2; exit 1; fi
python3 -I $T/merge_catalogue.py $L $R/master.tsv $R/eu_legal.tsv $R/era_guides.tsv $R/norway_fixed.tsv $R/ref_eu_acts.tsv $R/etsi.tsv $R/era_subsets_resolved.tsv $R/cra.tsv $R/ertms_sets.tsv $R/stm.tsv
python3 -I $T/apply_aliases.py $R/master.tsv $R/era_subsets_unresolved.tsv
python3 -I $T/extract_refs.py $L $R/master.tsv $W/refs 2>&1 | grep -v "^[0-9]*/[0-9]*$" || true
mkdir -p $L/99_Reference_Map/online
python3 -I $T/std_titles.py $W/refs/nodes.tsv $W/refs/_text $L/06_ERA_Guides/TSI_Application_Guides/Standards_quoted_in_TSIs.xlsx $W/refs/std_titles.tsv
python3 -I $T/build_map.py $R/master.tsv $W/refs/edges.tsv $W/refs/nodes.tsv $L/99_Reference_Map $W/refs/std_titles.tsv
cp $T/DEPLOY.md $T/_headers $L/99_Reference_Map/online/
cp $R/master.tsv $L/catalogue.tsv
python3 -I $T/add_short_col.py $L/catalogue.tsv
cp $T/short_names.tsv $L/99_Reference_Map/short_names.tsv
cp $R/master_not_downloaded.tsv $L/catalogue_not_downloaded.tsv
cp $T/download_all.sh $L/download_all.sh
python3 -I $T/make_readme.py $L $R/master.tsv $R/master_not_downloaded.tsv $W/refs/nodes.tsv $W/refs/edges.tsv $T/README_template.md $L/README.md
mv -f $L/_status.tsv $W/meta/ 2>/dev/null || true
find $L -name "*.part" -delete; find $L -name "*.notpdf.html" -delete
echo "files: $(find $L -type f -not -path '*/.git/*' | wc -l)  size: $(du -sh $L | cut -f1)"
