# Guided Configuration Console

Esta melhoria transforma a tela de configuração do Release Flow Guardian em uma experiência guiada.

## Objetivo

Evitar campos vazios e decisões ambíguas na configuração do `guardian.config.yml`.

## Recursos

- Catálogo central em `config/guardian-config-ui.schema.js`.
- Defaults globais aplicados pelo core.
- Dropdowns para valores fechados.
- Toggles para booleanos.
- Campos numéricos com `min`, `max`, `step` e default.
- Presets para Safe Default, Strict Release, Advisory Mode e Experimental Detection.
- Validação forte antes de salvar.
- Backup automático antes de salvar config.

## Defaults principais

- `contractGuard.baselineMode`: `stable-only`
- `similarityThreshold`: `70`
- `strongSimilarityThreshold`: `85`
- `removedEndpoint`: `block`
- `possibleReplacement`: `block`
- `changedBreakingEndpoint`: `block`
- `changedNonBreakingEndpoint`: `warn`
- `approvedBreakingChange`: `warn`

## Segurança

A melhoria não enfraquece o Contract Guard. Path alterado, endpoint removido ou possible replacement sem aprovação continuam gerando `BLOCK`.
