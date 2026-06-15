# Release Flow Guardian Core

Motor global reutilizável para governança de APIs RAML, publicação no Anypoint Exchange, Contract Guard, auto bump de versão e report HTML.

## Uso local em uma interface

No repositório da interface RAML:

```bash
npm install --save-dev github:LeonelIntegrationXpert/release-flow-guardian-core#main --package-lock=false
npx release-flow-guardian validate
npx release-flow-guardian preflight
npx release-flow-guardian console
```

Console local:

```text
http://127.0.0.1:3030
```

## Comandos

```bash
npx release-flow-guardian deps:check
npx release-flow-guardian validate:config
npx release-flow-guardian validate:release
npx release-flow-guardian validate:raml
npx release-flow-guardian stability:resolve
npx release-flow-guardian contract:extract
npx release-flow-guardian contract:extract:git-base
npx release-flow-guardian contract:guard
npx release-flow-guardian package:exchange
npx release-flow-guardian publish:exchange
npx release-flow-guardian report:html
npx release-flow-guardian validate
npx release-flow-guardian preflight
npx release-flow-guardian ci:publish
npx release-flow-guardian console
```

## Proteção de endpoints

O Guardian compara o contrato atual contra:

1. `release/api-contract-baseline.json` — contrato oficial stable.
2. Git base — branch base do PR ou `HEAD~1`.

Se endpoint/método/parâmetro crítico sumir sem aprovação em `release/breaking-changes.yml`, a pipeline bloqueia.

## GitHub reusable workflow

Em cada interface, crie um workflow chamando:

```yaml
uses: LeonelIntegrationXpert/release-flow-guardian-core/.github/workflows/raml-ci-exchange.yml@main
```

## Secrets necessários para publish Exchange

- `ANYPOINT_CONNECTED_APP_CLIENT_ID`
- `ANYPOINT_CONNECTED_APP_CLIENT_SECRET`
- `ANYPOINT_ORG`
- `ANYPOINT_HOST`
- `EXCHANGE_GROUP_ID`

Nenhum secret deve ser salvo no repositório.
