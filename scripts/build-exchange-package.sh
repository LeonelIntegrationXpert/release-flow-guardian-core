#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-mule-tlf-com-test}"
DIST_DIR="${DIST_DIR:-dist}"
OUTPUT_ZIP="${EXCHANGE_ZIP:-${DIST_DIR}/${APP_NAME}-exchange.zip}"

mkdir -p "$DIST_DIR"
rm -f "$OUTPUT_ZIP"

required_files=(
  "api.raml"
  "README.md"
  "types"
  "examples"
  "traits"
  "securitySchemes"
  "release/release-manifest.yml"
)

for item in "${required_files[@]}"; do
  if [ ! -e "$item" ]; then
    echo "❌ Item obrigatório não encontrado: $item"
    exit 1
  fi
done

echo "================================================================================"
echo "📦 Gerando pacote Exchange"
echo "================================================================================"
echo "Saída: $OUTPUT_ZIP"

zip -r "$OUTPUT_ZIP"   api.raml   README.md   types   examples   traits   securitySchemes   resourceTypes   docs   release   config/exchange.asset.json   -x "*.git*" "node_modules/*" "dist/*" ".github/*" ".azuredevops/*" ".maven/*" "scripts/*"

ls -lh "$OUTPUT_ZIP"
echo "✅ Pacote gerado com sucesso"
