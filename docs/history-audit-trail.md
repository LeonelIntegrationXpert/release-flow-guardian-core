# Release Flow Guardian — Change History / Audit Trail

O Guardian mantém duas camadas diferentes:

- `release/breaking-changes.yml`: aprovações ativas que permitem WARN em breaking changes intencionais.
- `release/history/contract-change-history.jsonl`: histórico auditável de eventos detectados pelo Contract Guard e ações feitas no Console.

## O que fica registrado

Cada evento possui:

- data/hora (`createdAt`)
- tipo do evento (`eventType`)
- ação (`created`, `removed`, `changed`, `approved`, `revoked`, `decision`)
- endpoint antigo e novo, quando aplicável
- decisão (`OK`, `WARN`, `BLOCK`, `REVOKED`)
- ticket, aprovador e motivo
- usuário local/Git/CI
- branch, commit, mensagem do último commit e arquivos alterados
- origem do evento: `contract-guard`, `guardian-console`, `report-html`, etc.

## Arquivos gerados no projeto consumidor

```text
release/history/contract-change-history.jsonl
dist/contract-change-history-latest.json
```

O JSONL é incremental: cada linha é um evento independente. Isso facilita auditoria, diff e append seguro.

## Comandos

```bash
release-flow-guardian history --project "C:\\repos\\mule-tlf-com-test"
release-flow-guardian history:summary --project "C:\\repos\\mule-tlf-com-test"
```

Ou pelo launcher do projeto:

```bat
tools\guardian.cmd
```

## Eventos principais

- `ENDPOINT_CREATED`
- `ENDPOINT_REMOVED`
- `ENDPOINT_CHANGED`
- `POSSIBLE_REPLACEMENT_DETECTED`
- `POSSIBLE_REPLACEMENT_APPROVED`
- `ENDPOINT_REMOVAL_APPROVAL_CREATED`
- `ENDPOINT_REMOVAL_APPROVAL_REVOKED`
- `BREAKING_CHANGES_UPDATED`
- `CONFIG_UPDATED`
- `CONTRACT_BLOCK_DETECTED`
- `CONTRACT_WARNING_APPROVED`
- `CONTRACT_GUARD_DECISION`
- `REPORT_GENERATED`

## Regra importante

O histórico não substitui o Git. O Git mostra o diff técnico. O histórico do Guardian mostra a intenção e a evidência de release:

- quem aprovou
- qual ticket
- por que aprovou
- qual endpoint antigo e novo
- se a decisão foi OK, WARN ou BLOCK
