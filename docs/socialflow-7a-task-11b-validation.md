# Etapa 7A — Task 11B: validação integrada local

Atualizado em 2026-10-24. Branch `feat/socialflow-7a-meta-insights`; HEAD preservado `e44b031d194a959e3f4182b246d17525a0ebc09c`. Trabalho anterior modificado/não rastreado mantido, sem commit, push, merge ou deploy.

**Task11B concluída. ACEITE TÉCNICO LOCAL APROVADO COM RESTRIÇÕES.** Gates locais encerrados, sem testes impeditivos pendentes. Não aprova piloto, ativação Meta real ou deploy.

## Recuperação e diagnóstico do exit 1

Foram recuperados o plano11B, os sete manifestos anteriores, JSONs/logs e pareceres independentes. Nenhuma implementação 10E/11A foi reiniciada. Na retomada, não havia agente ou suíte ativa da Task11B, nem diretório `/tmp/socialflow-11b-pg-*` remanescente. Os sete diretórios registrados estavam ausentes.

O último `--pg-only` (`d5e73813-f9ce-402b-bddd-2a5631d1dd40`) terminou por **duas falhas de teste**, não por infraestrutura nem limpeza:

- `api.integration.ts`: “retorna 201 pending para Reel misto e o scheduler termina os dois destinos” — recebido `publishing`, esperado `published`.
- Mesmo arquivo: “cliente desconectado após commit não cancela criação nem causa segundo container” — destino ainda `publishing`, esperado `published`.

Nesse run, 707/709 passaram, gates estáticos passaram e `pg-stop`/cleanup terminaram com sucesso. Nenhum banco persistente foi usado. Na primeira execução completa, havia 23 falhas de fixtures temporais em três outros arquivos, corrigidas e aprovadas antes da interrupção; essas 23 não reapareceram no run d5e73813.

## Ambiente PostgreSQL e isolamento

Docker e Podman não estavam disponíveis; foi utilizado **PostgreSQL nativo 18.6**, instalado no ambiente local, sem instalar dependências. Cada tentativa cria um cluster novo por `mkdtemp` em `/tmp/socialflow-11b-pg-*`, modo0700, marcador de runUUID e recursos próprios. Não reutiliza instância, banco, container ou volume preexistente.

- Host fixo `127.0.0.1`, porta efêmera; não escuta interfaces externas. Socket Unix fica no diretório privado.
- Usuário e senha PostgreSQL são exclusivamente sintéticos. SCRAM no TCP; arquivo temporário da senha em0600 removido logo após `initdb`. Nenhuma credencial Meta/produção é lida.
- Antes de CREATE DATABASE/migrations: conferidos `data_directory`, usuário, porta, listen_addresses e inventário de bancos do cluster novo. Banco `socialflow_11b_test` com zero tabelas antes da migração.
- Probe das migrations001–011 em schema próprio, conferência de checksums e segunda execução idempotente. Probe removido antes das fixtures para não contaminar `search_path` com tabelas públicas.
- Fixtures criam schemas exclusivos por UUID. Cleanup valida caminho real, marcador/runID e identidade do postmaster antes de parar e remover somente o diretório criado.
- Ambiente dos filhos é mínimo; `TEST_DATABASE_URL` só é construída após comprovar o cluster. `DATABASE_URL` é uma identidade inválida/sintética, não a aplicação. Vitest/Vite usam envDir vazio; nenhum wrapper `--env-file` é usado.
- Guard Node adicional bloqueia conexões externas antes de I/O; seus controles negam net/HTTPS/fetch para Graph sem conectar. É prevenção de egress acidental em testes confiáveis, não sandbox universal contra código malicioso.

As falhas iniciais de preparação foram distintas: sandbox negou listen127 comEPERM; depois initdb não conseguiu reabrir stdin/socket como `/dev/stdin`. Foram registradas, sem SQL de aplicação, e os próprios diretórios foram removidos. A correção do pwfile foi somente no harness.

## Correções e RED→GREEN

**F11B-1 — Important para o gate de validação: fixtures “devido agora” misturavam relógios de precisões diferentes.** Não foi demonstrada necessidade de corrigir código produtivo.

`claimAction` compara `next_action_at <= Date` recebido. Os helpers gravavam `clock_timestamp()` com microssegundos; um Date possui milissegundos. O round-trip SQL não garante que o milissegundo seguinte já tenha chegado.

Prova numérica em `cab193ab`: T+500µs recusado emT e aceito emT+1ms; igualdade exata aceita; T+60s recusado. O padrão original apresentou29claimsnull/50tentativas, com deltas607/540/647µs e condições processing/publishing/unleased verificadas. Isso comprova mecanismo e reprodução contemporânea; não reconstrói retrospectivamente cada delta das falhas originais.

Correção exclusivamente em fixtures:

1. `server/test/publicationOperations.integration.ts`: setStage usa Date parametrizado. Dois novos casos protegem precisão/igualdade/futuro e o helper com relógio lógico controlado; somente Date é simulado, I/O/leases PostgreSQL continuam reais, timers restaurados emfinally.
2. `server/test/metaPublicationResume.integration.ts`: stage/due parametrizados.
3. `server/test/metaPublicationServices.integration.ts`: due e duas preparações manuais parametrizadas.
4. `server/test/api.integration.ts`: último helper tick parametrizado, mantendo tenant, lease, terminalidade e cinco iterações.

Nenhuma assertion antiga, cenário futuro59s/1h, cadência31/60s, teto de polls, exclusividade, crash recovery, timeout ou payload foi reduzido. A comparação DB→DB de reserveStatusPoll permaneceu com clock_timestamp. Coordinator, scheduler, publishers e fontes da aplicação não foram modificados.

Evidências: RED inicial23falhas; controlehelperRED e precisãoPASS emcab193ab; GREEN focal2/2 emc5832d39 (44casos não selecionados pelo -t, não desativados no fonte); RED API2casos emd5e73813; GREEN arquivoAPI completo32/32 emf0943b2a,0pendentes; regressão final709/709 em a4dc213d. A primeira preparação do novo controle esqueceu external_id obrigatório; corrigiu-se apenas o dado da fixture, mantendo a constraint. Logs históricos não foram sobrescritos. F11B-1 encerrado, sem correção produtiva.

## Resultados finais

| Gate | Resultado confirmado |
| --- | --- |
| Frontend completo após11A | 395/395 em29arquivos,0falhas/pendentes — rune547df81 |
| Backend complementar | 1336/1336 em36arquivos,0falhas/pendentes — mesmo run |
| Experimentos10A–10D | 251/251, subconjunto dos1336 |
| Autorização10E | 66/66, subconjunto dos1336 |
| TikTok11A | 28/28, subconjunto dos395; inclui seleção/localfiles/cleanup/Workspace/payloadMeta |
| ÚltimoPG completo antes da retomada | 707/709 em21arquivos,2falhasAPI — d5e73813 |
| API completo pós-ajuste | 32/32,0falhas/pendentes — f0943b2a |
| PG completo pós-ajuste | 709/709 em21arquivos,0falhas/pendentes,exit0 — a4dc213d |
| Backend total | 2045/2045 em57arquivos: PG709 + complemento1336; partições disjuntas, nenhum arquivo ausente |
| TypeScript frontend | exit0 — a4dc213d |
| Vite build frontend | exit0 — a4dc213d, envDir vazio |
| TypeScript/build servidor | exit0 — a4dc213d |
| Typecheck experimental10E | exit0 — a4dc213d |
| ESLint e diffcheck | exit0 — a4dc213d e nova conferência de diffcheck no fechamento |

Os21arquivosPG vêm do script test:integration. O complemento backend exclui exatamente esses arquivos, portanto não há duplicação entre partições. Subconjuntos não devem ser somados novamente. Frontend e complemento não foram repetidos na retomada: o delta ficou restrito a arquivos de testePG excluídos dessas partições, com hashes de todas as fontes preservados.

A coberturaPG inclui sessões/membership/Workspace, OAuth, contas/credenciais, repository/service/HTTP Insights, posts/destinos, edição/cancelamento, leases/transações/concorrência/recuperação. Testes de providers usam mocks; nenhum envio real. **Persistência de métricas/snapshots não existe nesta entrega:** o repository lê relações/credenciais/resultados persistidos. Essa implementação futura não é simulada nem declarada aprovada.

## Comandos reproduzíveis e evidências

Somente no ambiente local autorizado, com dependências já instaladas:

```bash
node .superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/run-validation.mjs
node .superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/run-validation.mjs --clock-probe
node .superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/run-validation.mjs --api-only
node .superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/run-validation.mjs --pg-only
```

Não é necessário repetir todos; representam a cronologia, não instrução para rerun redundante. O manifesto de cada run contém argumentos completos, logs, duração, código e JSON de resultados.

Comandos internos: Vitest com `validation.config.mjs`,1worker/sem paralelismo de arquivos; `tsc --noEmit -p tsconfig.app.json`; Vite build API com envDir vazio; `tsc -p tsconfig.server.json`; `tsc --noEmit -p tsconfig.experiments-10e.json`; ESLint CLI e `git diff --check`. São equivalentes aos gates do projeto sem os wrappers que carregam.env.

Ledger/evidências: `.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/`. Referências: [plano](superpowers/plans/2026-10-23-socialflow-7a-11b-validation.md), [revisão global](../.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/independent-review.md), [retorno fixtures](../.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/fixture-fix-return-review.md), [retorno API](../.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/api-fixture-return-review.md).

## Revisão e limites do aceite

Revisor independente `/root/review_7a_11b`, GPT6.1SolHigh: revisão global7A+11A e retornos das fixtures aprovados, sem findings novos confirmados. Leitura somente; não executou gates. Cobertura e trechos legados/testes não integralmente reavaliados constam do parecer, sem alegar auditoria universal. Condições de fechamento (gates/integridade/cleanup) conferidas pelo coordenador: nenhum Critical/Important/Minor aberto e nenhum teste impeditivo pendente.

Permanecem bloqueios externos, independentemente de testes locais:

- Nenhuma chamada real Meta/TikTok ou piloto; compatibilidade operacional Batch/token/proof não validada.
- Grants,ANALYZE,ownership/elegibilidade,AppReview/AdvancedAccess reais não comprovados.
- Bootstrap/chave do operador, admissão/TTY físicos e autorização humana real exigem etapa separada. Assinatura sintética não autoriza execução real.
- A versão aprovada deve vincular o conteúdo efetivo do pacote: o HEAD-base sozinho não contém as alterações ainda não commitadas da7A. Congelamento/hash e revisão humana são pré-requisitos de uma futura autorização, não realizados como deploy nestaTask.
- Replay exige armazenamento privado confiável preservado, sem antirollback/root/sameUID/NFS; revalidação não serializa revogações posteriores; abort não cancela fisicamente SQL nem garante zeroização.
- PostgreSQL18.6 local não certifica paridade com a versão em produção. TikTok foi testado em DOM/CSS; codecs/layout físico/memória de navegador real não foram certificados.
- Nenhum backendTikTok, job, dashboard real ou persistência nova de métricas implementado.

## Integridade, arquivos e recursos finais

- 90/90 registros protegidos7A com SHA256 inalterado; 15/15 arquivos do inventário final11A inalterados. Topbar preservada pelo baseline completo.
- Entre235arquivos do baseline inicial11B, somente os quatro testes listados acima mudaram. Nenhuma fonte produtiva, contrato, dependência ou configuração existente foi alterada nesta tarefa. Cada execução também conferiu fontes estáveis durante os testes.
- Migrations001–011 idênticas ao HEAD, sem migration nova. Coordinator, scheduler e publishers sem diff contra HEAD. Índice Git sem mudanças staged; branch/HEAD preservados, trabalho acumulado dirty/untracked.
- Além dos quatro testes, foram criados plano11B, este relatório e helpers/artefatos no ledger (harness/config/guard, JSONs/logs, pareceres e diff). Artefatos anteriores de outras Tasks não foram sobrescritos.
- Todos os nove diretórios temporários registrados foram removidos pelo cleanup exclusivo. Sete clusters chegaram a ser iniciados e foram parados; duas tentativas abortaram antes disso. Nenhum `/tmp/socialflow-11b-pg-*` permanece. Nenhum container, volume ou banco de outra aplicação foi removido. Dados sintéticos descartados são reproduzíveis; logs/manifestos preservados.
- Último cluster: PostgreSQL18.6 em127.0.0.1:42027, diretório `/tmp/socialflow-11b-pg-ZBIEWh`, banco novo `socialflow_11b_test`. Identidade/vazio comprovados, migrations idempotentes e zero schemas de fixtures antes da parada.

Evidências finais: [manifesto](../.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/final-verification.json), [conferência detalhada](../.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/final-evidence.json) e [diff dos testes](../.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation/task-11b-test-fixes.diff). O manifesto separa evidência recuperada e executada após o último ajuste, sem somar subconjuntos.

Nenhum acesso ao Debian, banco de produção, credencial real, migration persistente, deploy, commit, push ou merge. **Aceite somente LOCAL, com restrições externas mantidas.** Próximo passo: revisão humana do pacote; piloto real exige autorização e pré-requisitos próprios. Nenhuma próxima Task iniciada.
