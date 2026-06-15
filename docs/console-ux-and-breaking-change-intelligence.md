# Console UX e Breaking Change Intelligence

Esta versão melhora o console local do Release Flow Guardian com foco em operação real de releases RAML.

## Melhorias de interface

- Layout dark enterprise responsivo.
- Sidebar agrupada por Operação e Configuração.
- Topbar mobile com menu colapsável.
- Cards executivos de status.
- Painel de decisão consolidada.
- Endpoint Inventory com filtros.
- Seção dedicada para Possible Replacements.
- Tela Breaking Change Approval para remoção, alteração e substituição.

## Regra importante

Alteração de path/method continua sendo breaking change. O Guardian pode sugerir `POSSIBLE_REPLACEMENT`, mas não aprova automaticamente.

- Possible replacement sem aprovação: `BLOCK`.
- Possible replacement aprovado: `WARN`.

## Approval

A tela grava a aprovação no arquivo do projeto consumidor:

```text
release/breaking-changes.yml
```

O console nunca altera `api.raml` automaticamente.
