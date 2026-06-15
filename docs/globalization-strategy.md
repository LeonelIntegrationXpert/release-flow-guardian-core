# Estratégia de Globalização

## Global no `release-flow-guardian-core`

- scripts de validação
- Contract Guard
- Exchange Auto Bump
- HTML report
- Console local
- workflows reutilizáveis
- templates Azure

## Local em cada interface

- RAML e includes
- `release/guardian.config.yml`
- `release/api-contract-baseline.json`
- `release/breaking-changes.yml`
- secrets no GitHub/Azure

## Regra

Cada interface guarda seu contrato.
O Guardian guarda a inteligência.

## Correção Exchange 400 por `exchange.json`

Quando a publicação usa auto bump, a versão final só é conhecida no momento do publish. Por isso o `raml.zip` gerado pelo core não inclui `exchange.json` raiz do projeto consumidor.

Se o pacote incluir um `exchange.json` com placeholders, o Exchange pode retornar 400 com mensagem semelhante a:

```text
Mismatch properties are: organizationId should be ... instead of undefined,
groupId should be ... instead of ${EXCHANGE_GROUP_ID},
version should be ... instead of ${EXCHANGE_ASSET_VERSION_AUTO_RESOLVED},
apiVersion should be v1 instead of undefined
```

Regra: metadados de publish ficam em `release/guardian.config.yml` e variáveis de ambiente; o `exchange.json` raiz não é empacotado.
