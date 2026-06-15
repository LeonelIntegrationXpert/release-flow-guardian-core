# Remote Core Launcher

O Release Flow Guardian Core é o motor global. Ele não precisa conhecer previamente os projetos consumidores.

Cada projeto RAML deve ter apenas um launcher local em `tools/guardian.cmd`. Esse launcher baixa ou atualiza o core em cache local, instala dependências fora do projeto consumidor e executa o core com `--project` apontando para o projeto que chamou o launcher.

## Fluxo

```text
Projeto RAML → tools/guardian.cmd
CMD → baixa/atualiza release-flow-guardian-core no cache local
Core → executa validate/preflight/console/report usando --project
Console → roda via Node em http://127.0.0.1:3030
```

## Comando base

```bash
node "%CORE_CACHE_DIR%\\bin\\guardian.js" validate --project "%PROJECT_DIR%"
```

## Regras

- Não instalar `node_modules` dentro do projeto consumidor apenas para rodar o Guardian.
- Não abrir `index.html` via `file://`.
- Não duplicar scripts do core em cada interface.
- Usar `main` durante evolução rápida e tags `v1.x.x` quando estabilizar.
