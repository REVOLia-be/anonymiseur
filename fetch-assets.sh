#!/usr/bin/env bash
# Télécharge les gros fichiers exclus du dépôt (modèle IA, OCR, runtime wasm).
# À lancer après un clone, avant de servir le site.
#   bash fetch-assets.sh
set -euo pipefail
cd "$(dirname "$0")"

say(){ printf "\n\033[1;32m== %s ==\033[0m\n" "$1"; }
get(){ # url, dest
  mkdir -p "$(dirname "$2")"
  if [ -f "$2" ]; then echo "  ✓ déjà présent : $2"; return; fi
  echo "  ↓ $2"
  curl -fsSL "$1" -o "$2"
}

say "Runtime ONNX (Transformers.js)"
get "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/ort-wasm-simd-threaded.jsep.wasm" \
    "vendor/transformers/ort-wasm-simd-threaded.jsep.wasm"

# Le modèle (~135 Mo) dépasse la limite 25 Mo/fichier de Cloudflare Pages :
# sur Pages, lancez avec SKIP_MODEL=1 (le modèle est servi depuis Cloudflare R2).
if [ "${SKIP_MODEL:-0}" = "1" ]; then
  say "Modèle NER : IGNORÉ (SKIP_MODEL=1 — à héberger sur R2, voir DEPLOY.md)"
else
  say "Modèle de détection (NER, ~135 Mo)"
  M="vendor/models/Xenova/distilbert-base-multilingual-cased-ner-hrl"
  B="https://huggingface.co/Xenova/distilbert-base-multilingual-cased-ner-hrl/resolve/main"
  get "$B/config.json"               "$M/config.json"
  get "$B/tokenizer.json"            "$M/tokenizer.json"
  get "$B/tokenizer_config.json"     "$M/tokenizer_config.json"
  get "$B/special_tokens_map.json"   "$M/special_tokens_map.json"
  get "$B/onnx/model_quantized.onnx" "$M/onnx/model_quantized.onnx"
fi

say "Moteur OCR (Tesseract.js — cœurs WASM + français)"
T="vendor/tesseract"; C="https://cdn.jsdelivr.net/npm/tesseract.js-core@5"
get "$C/tesseract-core-simd.wasm"        "$T/tesseract-core-simd.wasm"
get "$C/tesseract-core-simd.wasm.js"     "$T/tesseract-core-simd.wasm.js"
get "$C/tesseract-core.wasm"             "$T/tesseract-core.wasm"
get "$C/tesseract-core.wasm.js"          "$T/tesseract-core.wasm.js"
get "$C/tesseract-core-simd-lstm.wasm"   "$T/tesseract-core-simd-lstm.wasm"
get "$C/tesseract-core-simd-lstm.wasm.js" "$T/tesseract-core-simd-lstm.wasm.js"
get "$C/tesseract-core-lstm.wasm"        "$T/tesseract-core-lstm.wasm"
get "$C/tesseract-core-lstm.wasm.js"     "$T/tesseract-core-lstm.wasm.js"
get "https://tessdata.projectnaptha.com/4.0.0/fra.traineddata.gz" "$T/fra.traineddata.gz"

say "Terminé ✅  — lancez ensuite :  python3 -m http.server 4599"
echo "Puis ouvrez http://localhost:4599"
echo
echo "Note : la police de marque iBrand (vendor/fonts/ibrand.otf) est sous licence"
echo "et n'est PAS téléchargée ici. Sans elle, le mot-symbole s'affiche en Poppins."
