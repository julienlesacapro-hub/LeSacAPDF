#!/usr/bin/env bash
# Lance toutes les séries de tests sur téléphone émulé (Chromium + Playwright).
# Usage : tools/test-all.sh [android|iphone|all] [dossier des résultats]
# Prérequis : Node.js, Playwright (npm ci), poppler-utils (pdftotext, pdfinfo).
set -uo pipefail
cd "$(dirname "$0")/.."
F=tests/fixtures
DEVS=${1:-all}; [ "$DEVS" = all ] && DEVS="android iphone"
OUT=${2:-test-results}; mkdir -p "$OUT"

node tools/serve.js 8765 > /dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
for _ in $(seq 1 50); do curl -fs http://localhost:8765/ > /dev/null && break; sleep 0.2; done

fail=0
run() {   # run <nom> <commande…>
  local name=$1; shift
  if "$@" > "$OUT/$name.log" 2>&1; then
    echo "✓ $name : $(grep -c '^✓' "$OUT/$name.log") vérifications"
  else
    fail=1; echo "✗ $name — détail :"; tail -5 "$OUT/$name.log" | sed 's/^/    /'
  fi
}

for d in $DEVS; do
  run "$d-editeur"   node tools/e2e-test.js    $F/test.pdf "$OUT/$d" "$d"
  run "$d-v31"       node tools/e2e-v31.js     $F/test.pdf $F/annexe.pdf $F/photo-doc.jpg "$OUT/$d" "$d"
  run "$d-v4"        env OLD_DOC=$F/ancien.doc OLD_PPT=$F/ancien.ppt OLD_XLS=$F/ancien.xls XLSX=$F/tableau.xlsx \
                     node tools/e2e-v4.js      $F/test.pdf $F/testB.pdf $F/photo-doc.jpg $F/img-test.png $F/page.html \
                                               $F/doc.docx $F/doc.odt "$OUT/$d" "$d"
  run "$d-diaporama" node tools/e2e-show.js    $F/test.pdf "$OUT/$d" "$d"
  run "$d-stockage"  node tools/e2e-storage.js $F/test.pdf "$d"
  run "$d-ocr"       node tools/e2e-ocr.js     $F "$OUT/$d" "$d"
  run "$d-v46"       node tools/e2e-v46.js     $F "$OUT/$d" "$d"
  run "$d-v47"       node tools/e2e-v47.js     $F "$OUT/$d" "$d"
done
case " $DEVS " in *" android "*) run "exports" node tools/e2e-export.js $F/test.pdf "$OUT/exports" ;; esac

exit $fail
