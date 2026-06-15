# Release Flow Guardian Core — Estratégia Global

Este repositório é o motor global reutilizável do Release Flow Guardian.

## Regra de arquitetura

- Cada interface RAML mantém apenas seu contrato e suas configurações.
- O `release-flow-guardian-core` mantém toda a inteligência reutilizável.

## O que fica global

- Validação de RAML
- Validação de release manifest
- Stable Baseline Guard
- Git Diff Guard
- API Contract Guard
- Exchange Auto Bump
- HTML Report
- Console local de configuração
- GitHub reusable workflow
- Azure templates

## O que fica local em cada interface

- `api.raml`
- `release/guardian.config.yml`
- `release/release-manifest.yml`
- `release/api-contract-baseline.json`
- `release/breaking-changes.yml`

## Proteção de contrato

O Guardian usa duas camadas:

1. **Stable Baseline Guard**: compara o RAML atual contra o último baseline stable oficial.
2. **Git Diff Guard**: compara o RAML atual contra a branch base do PR ou `HEAD~1`.

A fonte oficial para bloquear é o baseline stable. O Git Diff Guard adiciona rastreabilidade.

## Regra default

Endpoint removido sem aprovação explícita em `release/breaking-changes.yml` bloqueia a release.
