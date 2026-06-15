# Release Flow Guardian Core

Motor global reutilizável para validação RAML, Contract Guard, Endpoint Governance, geração de report e publicação RAML no Anypoint Exchange.

Este repositório deve concentrar a inteligência. Os projetos consumidores devem manter apenas o contrato RAML, arquivos `release/*` e um launcher simples em `tools/guardian.cmd`.

## Uso com projeto consumidor

```bash
node bin/guardian.js validate --project "C:\\caminho\\mule-tlf-com-test"
node bin/guardian.js preflight --project "C:\\caminho\\mule-tlf-com-test"
node bin/guardian.js console --project "C:\\caminho\\mule-tlf-com-test"
node bin/guardian.js report:html --project "C:\\caminho\\mule-tlf-com-test"
```

O core resolve todos os arquivos a partir do `--project`:

```text
api.raml
release/guardian.config.yml
release/api-contract-baseline.json
release/breaking-changes.yml
release/release-manifest.yml
dist/
```

## Comandos

```text
deps:check
validate:config
validate:release
validate:raml
stability:resolve
contract:extract
contract:extract:git-base
contract:guard
package:exchange
publish:exchange
report:html
validate
preflight
ci:publish
console
version
```

## Console local

```bash
node bin/guardian.js console --project "C:\\caminho\\mule-tlf-com-test"
```

Acesse:

```text
http://127.0.0.1:3030
```

O console sempre lê e grava arquivos no projeto consumidor informado por `--project`, nunca dentro do core.

## Reusable workflow GitHub

Projetos consumidores podem usar:

```yaml
jobs:
  guardian:
    uses: LeonelIntegrationXpert/release-flow-guardian-core/.github/workflows/raml-ci-exchange.yml@main
    with:
      config-path: release/guardian.config.yml
      guardian-ref: main
      publish-exchange: false
```

## Regra de arquitetura

```text
Projeto consumidor guarda o contrato.
Core guarda a inteligência.
```

## Change History / Audit Trail

O core agora registra uma trilha de auditoria no projeto consumidor.

Arquivo principal:

```text
release/history/contract-change-history.jsonl
```

Também gera um snapshot de leitura rápida:

```text
dist/contract-change-history-latest.json
```

Comandos:

```bash
release-flow-guardian history --project "C:\repos\mule-tlf-com-test"
release-flow-guardian history:summary --project "C:\repos\mule-tlf-com-test"
```

O histórico registra criação, remoção, alteração, possible replacement, aprovações, revogações, decisão do Contract Guard, usuário Git/CI, branch, commit, ticket e motivo. Veja `docs/history-audit-trail.md`.


## Guided Configuration Console

A versão atual do console usa um catálogo central de configuração (`config/guardian-config-ui.schema.js`) para renderizar campos com defaults recomendados, dropdowns, toggles, help text, validação e presets.

Principais melhorias:

- `Similarity threshold` default `70` e `Strong similarity threshold` default `85`.
- `Baseline mode` agora é dropdown: `stable-only`, `git-base-only`, `stable-and-git`, `disabled`.
- Decisões padrão agora usam dropdown: `ok`, `warn`, `block`.
- Toggles visuais substituem checkboxes crus.
- Presets: Safe Default, Strict Release, Advisory Mode e Experimental Detection.
- Seções Restore e History aparecem na configuração guiada.
- Save Config valida, cria backup e registra histórico.

O core continua rodando com `--project`:

```bash
node bin/guardian.js console --project /path/to/mule-tlf-com-test
```
