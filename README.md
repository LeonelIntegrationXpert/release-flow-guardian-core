# Release Flow Guardian Core

Motor global reutilizável para governança de APIs RAML/Design Center.

Ele centraliza:

- Validação RAML
- Release manifest validation
- API Contract Guard
- Endpoint removal approval
- Exchange Auto Bump
- HTML/JSON/Markdown report
- Console local de configuração
- GitHub reusable workflow
- Azure DevOps templates

## Instalação local em uma interface

Dentro do repositório da interface RAML:

```bash
npm install --save-dev ../release-flow-guardian-core
npx release-flow-guardian validate
npx release-flow-guardian preflight
npx release-flow-guardian console
```

Depois que este core estiver no GitHub:

```bash
npm install --save-dev github:LeonelIntegrationXpert/release-flow-guardian-core#main
```

## Comandos

```bash
npx release-flow-guardian deps:check
npx release-flow-guardian validate:config
npx release-flow-guardian validate:release
npx release-flow-guardian validate:raml
npx release-flow-guardian stability:resolve
npx release-flow-guardian contract:extract
npx release-flow-guardian contract:guard
npx release-flow-guardian package:exchange
npx release-flow-guardian publish:exchange
npx release-flow-guardian report:html
npx release-flow-guardian validate
npx release-flow-guardian preflight
npx release-flow-guardian ci:publish
npx release-flow-guardian console
```

## O que fica no repositório da interface

Cada interface RAML mantém apenas os arquivos específicos:

```text
api.raml
examples/
types/
traits/
securitySchemes/
release/guardian.config.yml
release/release-manifest.yml
release/api-contract-baseline.json
release/breaking-changes.yml
```

## GitHub Actions reutilizável

No repositório da interface:

```yaml
jobs:
  guardian:
    uses: LeonelIntegrationXpert/release-flow-guardian-core/.github/workflows/raml-ci-exchange.yml@main
    with:
      config-path: release/guardian.config.yml
      publish-exchange: ${{ github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master') }}
    secrets:
      ANYPOINT_CONNECTED_APP_CLIENT_ID: ${{ secrets.ANYPOINT_CONNECTED_APP_CLIENT_ID }}
      ANYPOINT_CONNECTED_APP_CLIENT_SECRET: ${{ secrets.ANYPOINT_CONNECTED_APP_CLIENT_SECRET }}
      ANYPOINT_ORG: ${{ secrets.ANYPOINT_ORG }}
      ANYPOINT_HOST: ${{ secrets.ANYPOINT_HOST }}
      EXCHANGE_GROUP_ID: ${{ secrets.EXCHANGE_GROUP_ID }}
```

## Regra principal

Código fonte fica em cada interface.
A inteligência de validação fica no Guardian Core.

