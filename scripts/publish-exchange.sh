#!/usr/bin/env bash
set -euo pipefail

# Wrapper mantido para compatibilidade com pipelines antigas.
# A lógica premium de preflight, auto bump, retry e relatório fica no script Node.

node scripts/exchange-publish-guardian.js
