# RAML Preview e Restore Assistant

Esta versão adiciona revisão e restauração segura de contrato RAML ao Release Flow Guardian Core.

## Principais recursos

- `RAML Preview`: visualiza `api.raml`, `release/baseline/api.raml` e diff textual.
- `Restore Assistant`: lista candidatos de restore para `POSSIBLE_REPLACEMENT` e endpoints removidos.
- Restore de path: troca o path atual pelo path aprovado do baseline com backup e confirmação forte.
- Restore de bloco: usa `release/baseline/api.raml` quando disponível para restaurar endpoint removido.
- Geração de patch em `dist/restore-patches/`.
- Histórico auditável em `release/history/contract-change-history.jsonl`.

## Segurança

O restore nunca é aplicado sem:

1. Preview do diff.
2. Backup em `release/backups`.
3. Confirmação exata: `CONFIRMO RESTAURAR CONTRATO`.
4. Registro no histórico.

O Guardian não executa `git restore api.raml` automaticamente, pois isso poderia descartar outras alterações legítimas.

## APIs locais adicionadas

- `GET /api/raml/current`
- `GET /api/raml/baseline`
- `GET /api/raml/diff`
- `POST /api/restore/preview`
- `POST /api/restore/apply`
- `POST /api/restore/generate-patch`
- `GET /api/restore/history`

Todas operam sobre o projeto consumidor informado via `--project`.
