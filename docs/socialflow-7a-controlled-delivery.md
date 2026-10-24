# Etapa 7A — commit único e preparação de implantação controlada

2026-10-24. Branch `feat/socialflow-7a-meta-insights`; base `e44b031d194a959e3f4182b246d17525a0ebc09c`. Decisão humana vigente: **um único commit**, mensagem `feat: complete socialflow 7a meta insights and tiktok frontend`. Substitui a sequência proposta na [Task12](socialflow-7a-task-12-commit-plan.md), preservada como histórico. Não autoriza merge/main/push.

## Escopo da árvore a consolidar

Inventário aprovado da Task12 (C01–C14), oito specs/planos 7A explicitamente selecionados, teste/relatório PostgreSQL17 da Task14 e delta frontend/tests/relatório da Task15. Não incluir os quatro históricos locais 6E/postmanagement, `.superpowers/sdd`, logs, screenshots, HTML de pesquisa, arquivos `.env`, chaves, dados PG, dumps, recibos sintéticos, `node_modules`, `dist` ou `dist-server`. Experimentos e testes são código QA versionável, **não runtime da imagem**. Não existem alterações de dependências nesta entrega.

Inventário histórico: [Task12](socialflow-7a-task-12-inventory.md). Compatibilidade efetivamente testada: [PostgreSQL17.11](socialflow-7a-task-14-postgresql17-validation.md). Ajustes finais e limites visuais: [Task15](socialflow-7a-task-15-frontend-validation.md). O acervo local mantém manifests, hashes e resultados completos; referências a esse acervo não são portáveis para clone sem o histórico local.

## Estado observado de produção, somente leitura

Foram executados exclusivamente os seis comandos restritos autorizados via `ssh -F ~/.ssh/config_codexdiag socialflow-diag`: `hostname`, `uptime`, `disk`, `memory`, `docker-status`, `socialflow`. Todos concluíram sem erro.

- Host `SeverCasa`; uptime cerca de dois dias; load 0,33 / 0,17 / 0,08 na captura.
- Docker `active`; API e web em execução há dois dias com tags **`socialflow-api:postmanagement-e44b031`** e **`socialflow-web:postmanagement-e44b031`**. Não foram obtidos digests de imagem ou SHA interno; tag é evidência identificável, não prova criptográfica do conteúdo.
- PostgreSQL `postgres:17` healthy; pgAdmin `dpage/pgadmin4:latest` em execução. API/web sem healthcheck Docker. CPU observada API/web 0%, PG0,01%; memória API114MiB, web13,26MiB, PG56,41MiB.
- Memória total3,7GiB, disponível1,7GiB; swap sem uso. `/srv`: **90%**, 173GiB usados e 21GiB livres. Alerta de capacidade: isso não comprova espaço suficiente para backup + imagens + rollback.
- Nenhum comando remoto de escrita, acesso administrativo, `.env`, PostgreSQL ou Docker direto foi executado. Nenhum arquivo foi transferido pelo Codex. Não há evidência recuperada de transferência/deploy anterior da 7A; os containers observados permanecem com as tags antigas.

## Gates impeditivos de implantação

1. **Backup consistente e restauração:** operador deve comprovar backup protegido, integridade e ensaio de restauração isolada, incluindo banco, mídias e configurações necessárias; sem enviar dumps/segredos ao chat. Nome do banco, usuário, volumes e ferramenta efetiva ainda não confirmados. Não inventar `pg_dump` contra um alvo presumido.
2. **Compose efetivo não fornecido:** arquivos reais `/home/servercasa/apps/socialflow/compose.production.yaml` e `compose.postmanagement.yaml` não foram inspecionados integralmente. Redes, volumes, env_files, entrypoint, políticas de restart, dependências e overrides não estão validados.
3. **Build/release:** não há Docker/Podman nem receita Docker/Compose no checkout local. Não foi construída imagem7A, não há tar de imagem nem hash de artefato de release. `dist`/`dist-server` são validação local, **não release para transferência**. A configuração pública real de `VITE_API_URL`, proxy/prefixo e `VITE_POSTS_REPOSITORY=http` precisa ser confirmada pelo operador antes de build imutável. Frontend vazio/mock não pode ser implantado.
4. **Rollback:** preservar IDs/digests e imagens anteriores API/web e configuração efetiva anterior, com capacidade de armazenamento. Não sobrescrever tags antigas nem executar prune/down/remoção de volumes.
5. **Scheduler:** confirmar sinal encaminhado pelo PID1/npm e janela de parada. O backend possui orçamento interno de shutdown de **330 segundos** (`server/src/index.ts`); o timeout Docker deve excedê-lo com margem. Isso sozinho não prova drenagem bem-sucedida. Operador precisa comprovar ausência/encerramento seguro de operações em voo e preservar histórico/idempotência, sem consultar/publicar conteúdo pela Meta. Não executar duas versões do scheduler simultaneamente.
6. **Flags:** código mantém OAuth Insights opcional/desligado por padrão e transporte Insights sem binding; ausência de transporte resulta em `503 meta_insights_not_enabled` para consulta elegível. Estado dos envs reais não foi lido; operador deve atestar flag desligada **sem revelar valores secretos**. TikTok somente frontend.
7. **Migrations:** 001–011 preservadas e nenhuma nova; não executar migrations na atualização7A. PostgreSQL17.11 validado localmente709/709, mas não houve ensaio de atualização sobre cópia do banco real.

**Conclusão operacional atual: implantação BLOQUEADA.** O commit local pode ser preparado após gates de código; não remove nenhum bloqueio acima.

## Próxima coleta pelo operador — somente leitura

Os comandos abaixo são para o operador, no próprio Debian, não para a conta restrita nem para execução pelo Codex. Não colar config completo, `--environment`, `.Config.Env`, dumps ou logs brutos. Antes, confirmar suporte da versão Compose instalada. Não alteram containers:

```bash
cd /home/servercasa/apps/socialflow
docker compose version
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --quiet
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --services
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --images
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --volumes
docker compose -p socialflow -f compose.production.yaml -f compose.postmanagement.yaml config --networks
docker inspect --format '{{.Name}} image={{.Config.Image}} id={{.Image}} signal={{.Config.StopSignal}} timeout={{json .Config.StopTimeout}}' socialflow-api socialflow-web
```

Revisão humana separada deve fornecer extrato **sanitizado** das definições api/web (build/image, command/entrypoint, portas, redes, volumes, stop_grace_period e nomes das variáveis relevantes, nunca seus segredos), prova de backup/restore e estratégia efetiva de pausa. Não criar nomes/caminhos de backup ou receitas a partir de suposições.

Referências oficiais consultadas: [Compose config](https://docs.docker.com/reference/cli/docker/compose/config/) descreve validação silenciosa e listagens seletivas; o [modelo Config do Docker/Moby](https://github.com/moby/moby/blob/master/api/types/container/config.go) coloca StopTimeout em Config, não HostConfig (ajuste documental após revisão). Campo ausente/null não comprova janela de parada adequada. A mesclagem real e esses comandos na versão instalada continuam não validados aqui.

## Execução futura, condicionada aos gates — não executada

Após evidências aceitas, preparar receita e artefatos a partir **da árvore do commit único**, com hashes e imagens API/web da mesma versão. Inspecionar o contexto de build e excluir segredos/dados/QA; conferir que nenhuma nova configuração substitui redes/volumes/serviços. Transferência será manual e verificada por checksum, sob autoridade do operador; esta Task não forneceu nem executou canal de escrita SSH.

Só então emitir comandos finais específicos da configuração real, limitados a `api web` e sem dependências. [Compose up](https://docs.docker.com/reference/cli/docker/compose/up/) pode recriar containers quando imagem/config muda; `--no-deps` evita iniciar dependências, mas não valida backup ou drenagem. [Compose stop](https://docs.docker.com/reference/cli/docker/compose/stop/) permite timeout explícito. Não executar receitas genéricas de stop/up antes de confirmar os gates e o novo override de imagens. Nenhum `down`, `prune`, `--remove-orphans` ou remoção de volume é permitido.

## Validação e rollback futuro

Operador deve apresentar imagem/ID nova dos dois containers, HTTP200+JSON status ok em `/health`, frontend200, login/Workspace e histórico/agendamentos preservados, TikTok local/sino, Meta Insights bloqueado e PostgreSQL/demais serviços inalterados. A captura atual não é validação HTTP pós-deploy e nenhum desses resultados foi inventado.

Em falha: interromper avanço e avaliar operações já processadas e shutdown antes de rollback. Restaurar seleção das **duas imagens anteriores e configuração anterior**, sem restaurar banco automaticamente; reverter banco pode perder publicações e invalidar idempotência. Restauração de backup exige decisão específica. Revalidar health, sessões e agendamentos após ação manual. Rollback automático não foi implementado nem executado.

## Estados que não devem ser confundidos

Commit local é diferente de build de imagem; build de validação é diferente de artefato de release; preparação é diferente de transferência; tags identificadas não significam atualização; containers running não provam HTTP/login/agendamento. O relatório final da execução registra separadamente cada estado e o SHA do commit, caso criado.
