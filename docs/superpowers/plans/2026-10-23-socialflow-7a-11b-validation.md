# Task 11B — validação integrada local da Etapa 7A

> Execução: coordenador verifica o roteiro explícito do usuário; um revisor independente examina o conjunto acumulado. Sem commits ou limpeza de checkpoints. Não há funcionalidade nova planejada.

**Objetivo:** fechar a lacuna PostgreSQL da 10E e verificar a regressão após 11A, sem confundir teste local/sintético com validação operacional Meta.

**Arquitetura:** infraestrutura descartável em `/tmp`, PostgreSQL novo com loopback e credenciais sintéticas, schemas isolados das fixtures existentes. Docker/Podman indisponíveis; PostgreSQL nativo 18.6 disponível. Nenhum banco preexistente será consultado. Logs/manifestos próprios no ledger11B, sem editar artefatos anteriores.

**Stack:** Node22, pg, Vitest, PostgreSQL18.6, TypeScript/Vite/ESLint existentes. Sem dependências novas.

**Spec:** solicitação humana Task11B nesta conversa; fechamentos10E/11A e contratos atuais são referências, não novos requisitos de produto.

## Restrições e revisão

- Preservar branch/HEAD/dirty/untracked, 90 registros Meta e todo frontend11A; nenhum Git destrutivo/commit/push/merge/deploy/SSH/credencial real.
- Nenhum acesso a `.env` ou bancos persistentes. Invocar Vitest diretamente, sem wrappers `--env-file`. Ambiente filho mínimo e `DATABASE_URL` inválida/sintética.
- Cluster exclusivo criado por `mkdtemp`, diretório privado, host127.0.0.1 e porta efêmera; comprovar `data_directory`, usuário, banco `_test`, listen_addresses e ausência de tabelas antes de migrations. Cleanup só do caminho gerado, após parada do próprio cluster.
- Migrations001–011 executadas somente neste cluster; comparar hashes/bytes com a base. Nada de migrations de métricas novas.
- Não modificar aplicação salvo defeito reproduzido no escopo, com causa e RED→GREEN; Coordinator/publisher/scheduler não serão corrigidos por hipótese.
- Sem chamadas reais Meta/TikTok. Publicação/OAuth simulados pelos testes; guard adicional de rede Node limitado a loopback.
- Observar sessões/membership/Workspace revogados durante awaits; PageTokenFB/UserTokenIG, scopes efetivos, legados sem destino; assinatura Ed25519 e reserva exclusiva; dadosTT fora do backend e limpezaURL.
- InsightsRepository não persiste métricas: somente snapshots privados de leitura/associações. Não declarar snapshots de métricas implementados.

## Checklist único de validação

- [x] Recuperar Git, relatórios10E/11A, scripts/configuração, fixtures e infraestrutura; preservar estado.
- [x] Preparar harness isolado e registrar baseline90Meta+frontend11A antes de testes. Conferir isolamento antes de SQL.
- [x] Inicializar cluster vazio, criar banco de teste, executar migrations existentes e verificar idempotência; registrar metadados sem senha/DSN.
- [x] Executar 21 arquivos do script `test:integration`, 1worker/sem paralelismo de arquivos, JSON/log próprios. Resultado esperado: exit0, nenhum skip/fail.
- [x] Executar frontend completo e complemento backend (todos os demais arquivos), incluindo66testes10E/251experimentos anteriores; contar conjuntos sem duplicação. Resultado esperado: exit0, nenhum skip/fail.
- [x] Executar tscfrontend, Vite com envDir vazio, tscserver, tsc experimental10E e ESLint, em série. Resultado esperado: exit0. Conferir diffcheck/integridade.
- [x] Revisão independente global de segurança e compatibilidade; confirmar Critical/Important abertos ou corrigir somente defeitos demonstrados por RED→GREEN.
- [x] Parar/remover somente cluster temporário comprovado, consolidar comandos/resultados/correções/risco/versionamento no relatório e ledger. Não habilitar próximo piloto.

## Arquivos e contratos de execução

- Criar `.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/{progress.md,offline-guard.mjs,run-validation.mjs}` e artefatos gerados: infraestrutura/testes/checagens/integridade/revisão.
- `run-validation.mjs`: cria somente infraestrutura temporária, usa fixtures/migrations reais, roda partições sem overlap e encerra recursos próprios. Nunca usa DATABASE_URL herdada, Docker remoto ou flags Meta reais.
- `offline-guard.mjs`: preload de testes, rejeita URLs/hosts externos antes de I/O; não é sandbox contra teste malicioso. Nenhuma alteração no produto.
- Fontes/testes compartilhados, backend e frontend existentes são somente leitura salvo finding demonstrado. Correção eventual exige registro de causa e verificação proporcional.
- Relatório final: `docs/socialflow-7a-task-11b-validation.md`; manifesto e logs neste ledger. Resultados históricos não substituem execuções atuais.

Decisão: aproveitar PostgreSQL nativo novo em vez de instalar Docker — satisfaz exclusividade e evita infraestrutura desnecessária; custo: versão18.6 não certifica paridade com a versão real de produção.

## Fechamento 2026-10-24

Task11B concluída: PG709/709,frontend395/395,backendcomplementar1336/1336 (2045backend em57arquivos semsobreposição),66/251experimentais como subconjuntos. Gatefinala4dc213d:TypeScript/build/lint/diffcheck0,cleanupaprovado. Somente4fixtures/testes legados corrigidos com evidênciaRED→GREEN e2controlesnovos; nenhumprodpatch.90hashesMeta/15arquivos11A/11migrations preservados. Revisão independente e retornos semfindingsabertos. Relatório `docs/socialflow-7a-task-11b-validation.md`, manifesto `final-verification.json` e evidência `final-evidence.json` noledger. Aceite somente LOCAL com restrições; Meta real e produção não habilitados.
