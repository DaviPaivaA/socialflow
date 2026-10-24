# SocialFlow 7A — Meta Insights Implementation Plan

**Histórico Facebook-only:** substituído por `2026-10-19-socialflow-meta-insights-plan-facebook-instagram.md` e revisão `docs/meta-insights-task-1-security-review.md`. Não executar esta versão para a7A atual. Erratas Task1: asterisco não marca depreciação e foto guarda photos.post_id.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Planejar uma API autenticada e tenant-safe para métricas **reais** de Facebook Pages e Page Posts, sem afetar publicação, e preparar a evolução 7B–7E.

**Architecture:** A futura 7A adiciona contrato compartilhado, client Graph de leitura, lookup PostgreSQL de conta/destino do tenant, service de autorização/normalização e rotas `node:http`. Allowlist candidata após pesquisa atual: `page_media_view`, `page_total_media_view_unique`, `page_video_views`, `post_media_view`, `post_total_media_view_unique`, reações por tipo; cada métrica depende de grant e piloto, sem alegar disponibilidade universal. Consulta sob demanda, sem migration ou job. 7B acrescentará snapshots/sincronização em migration posterior à 011, separada do scheduler de publicação.

**Tech Stack:** Node.js 22+, TypeScript strip-only onde aplicável, `node:http`, `pg`/PostgreSQL, React/Vite, Vitest; reutilizar crypto/sessão/cookie e fixtures existentes; nenhuma dependência nova prevista.

**Spec:** `docs/superpowers/specs/2026-10-19-socialflow-meta-insights-design.md`.

**Research:** `docs/meta-insights-api-research.md` ([Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US), [Post Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US), [deprecações](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics?locale=en_US), [read_insights](https://developers.facebook.com/docs/permissions/reference/read_insights?locale=en_US)).

**Status:** plano **não iniciado**, para revisão e aprovação humana. Nesta sessão só foram preparados documentos. Base auditada: `fix/scheduled-post-management@e44b031d194a959e3f4182b246d17525a0ebc09c`; deployment não verificado por acesso ao Debian. No futuro, partir da versão **efetivamente implantada e confirmada**, em branch própria sugerida `feat/socialflow-7a-meta-insights`, sem alterar a branch estável sem autorização.

## Global Constraints

- Não executar nenhuma Task de implementação antes de aprovação explícita da spec/plano e das decisões pendentes abaixo. A pesquisa oficial deve ser reconfirmada no início da implementação porque a Graph API muda.
- Não alterar migrations 001–011 nem criar migration na 7A; não tocar em produção, banco de produção, Docker/Compose, `.env.production`, credenciais ou deploy. 7B propõe uma `012` **somente depois** de design/testes e aprovação separados.
- Não estender OAuth silenciosamente. `read_insights` está ausente do escopo atual. Confirmar App Review/Advanced Access, task `ANALYZE` e concessão real. Falta de permissão produz estado seguro, nunca chamada Graph assumindo autorização.
- Consulta Graph exclusivamente read-only, HTTPS, host fixo e token fora de URL/log/DTO. Nenhum Graph request dentro de transação PostgreSQL longa. Não acoplar ao publisher/coordinator/scheduler e não criar timers na 7A.
- Tenant e membership exclusivamente da sessão. `socialAccountId` e `postPublicationId` são UUID locais e não substituem joins por tenant. Cross-tenant deve parecer inexistente (404). Não aceitar Page ID, post Graph ID, tenant ou token do cliente.
- `provider_post_id` de `/feed`, `/photos` e Reel não é presumido intercambiável. Não consultar Insights de foto/Reel sem gate documental + teste autorizado do mapeamento; registros legados sem destino permanecem intactos.
- Não renomear visualmente “impressões” ou “alcance” usando métricas novas sem semântica aprovada. Não exibir zero por ausência de dados. Analytics real fica na 7C.
- Testes RED→GREEN para todo comportamento futuro; mocks da Meta, schemas isolados com `TEST_DATABASE_URL` exclusivo `_test`, nenhuma publicação real. Não iniciar suites pesadas em paralelo. Sem commits/pushes automáticos; checkpoints/ledger para progresso.
- Na execução futura, usar `superpowers:systematic-debugging` para falha inesperada, revisão independente por Task, `superpowers:verification-before-completion` antes de alegar conclusão. Nesta fase documental não há RED/GREEN a executar.

## Decisions required before Task 1

- [ ] Confirmar, sem revelar segredo, Graph API version efetiva do deployment e commit base efetivamente implantado; não se basear só em `META_GRAPH_API_VERSION` default ou no relato do usuário.
- [ ] Aprovar leitura de métricas por qualquer `member` ativo do Workspace (proposta, alinhada à leitura de posts) ou restringir a owner/admin.
- [ ] Definir obtenção de `read_insights`, task Page `ANALYZE`, App Review/Advanced Access e ambiente de teste autorizado; não ampliar OAuth antes dessa decisão. Se indisponível, manter endpoints futuros com `permission_required`/não liberar produto.
- [ ] Aprovar MVP com texto Facebook e Pages; foto/Reel só após prova da associação do ID externo. Definir rótulos de indicadores e disposição dos dados de Page com <100 likes.
- [ ] Definir se chamadas reais de piloto com Page **de teste** serão autorizadas em sessão separada. Não necessárias/permitidas por este plano documental, mas podem ser gate para ativar métricas.
- [ ] Confirmar em fonte oficial ou piloto isolado como transmitir token e `appsecret_proof` nesta GET sem colocá-los em query string ou logs; a página oficial de [chamadas seguras](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US) não comprova headers para esse endpoint.

## Review Focus

1. Cross-tenant e papel/membership revalidados; nenhum token antes do gate de autorização; sessões trocadas/revogadas durante Graph não vazam resposta.
2. ID local de publicação → conta Facebook → ID Graph correto. Foto/Reel/legado/Instagram jamais lidos sob suposição de equivalência.
3. `read_insights` efetivamente concedido e `ANALYZE` observado; `pages_manage_posts`/`CREATE_CONTENT` não substituem insights.
4. Métricas depreciadas excluídas; `null` não vira `0`; Page metrics não entram como Post metrics; fonte/idade/período explícitos.
5. Graph errors e rate limits não revelam tokens/corpo bruto; chamadas limitadas não afetam a quota do publisher de forma descontrolada.
6. 7B não reutiliza `PublicationScheduler` e não cria FK que relacione post de um tenant a conta de outro.

---

## Task 1 — Gate de documentação, permissões e ID externo

**Arquivos a consultar:** `docs/meta-insights-api-research.md`, `server/src/config.ts`, `server/src/metaOAuthClient.ts`, `server/src/metaOAuthService.ts`, `server/src/metaPublishingClient.ts`, `server/src/facebookPublishingService.ts`, `server/src/postPublicationsRepository.ts`, `server/migrations/010_add_post_publications.sql`.

- [ ] Reconfirmar Page/Post Insights, deprecações e permissões na documentação oficial para a versão Graph efetiva; registrar data/URLs e qualquer divergência.
- [ ] Mapear precisamente IDs persistidos por `/feed`, `/photos` e Reel; definir um discriminante interno seguro (tipo/origem) sem reescrever histórico. Para cada endpoint de Insights, exigir prova de suporte do objeto.
- [ ] Com autorização específica e credenciais de teste, planejar/realizar smoke **fora da suíte automatizada** que confirme métricas, Page `ANALYZE`, escopo `read_insights`, resposta vazia e Page pequena. Se não autorizado/indisponível, manter foto/Reel desligados e demais métricas como não verificadas em runtime; não fabricar dados.
- [ ] Checkpoint: matriz documental aprovada, lista de métricas allowlisted e quais objetos podem ser consultados. **Nenhum código produtivo antes deste gate.**

### Task 1A — Escopo OAuth (somente se App Review/política aprovados)

**Arquivos previstos:** `server/src/metaOAuthClient.ts`, `server/src/metaOAuthService.ts`, `server/test/metaOAuth.integration.ts`, testes de credencial/conta. Dependência: Task 1 concluída e autorização explícita para ampliar escopos.

- [ ] RED: OAuth passa a pedir `read_insights` sem retirar permissões atuais; `grantedScopes` persiste concessão real; conta antiga/novo login sem concessão continua `permission_required`; reconexão não vaza token nem troca tenant.
- [ ] VERIFY RED: falhas esperadas dos novos testes, não falha por falta de Meta real.
- [ ] GREEN: menor mudança OAuth necessária para pedir e registrar o escopo; sem solicitar escopos de Analytics Instagram ou alterar fluxo de publicação. **Não assumir** que pedido implica concessão ou Advanced Access.
- [ ] VERIFY GREEN: OAuth/credencial focados e revisão independente de regressão 6E. Se autorização Meta indisponível, não executar esta subtask e bloquear ativação de Insights reais, preservando documentação/estados seguros.

## Task 2 — Contrato compartilhado e semântica HTTP

**Arquivos propostos:** criar `shared/insightsContract.ts`, `shared/insightsContract.test.ts`; consultar `shared/postPublicationContract.ts`, `server/src/postManagementContract.ts` e `server/src/app.ts`.

- [ ] RED: validar contrato, zero/null, tipos, períodos/UUIDs e campos inseguros. Rejeitar nomes explicitamente removidos e métricas fora da allowlist escolhida; não inferir depreciação de `*` (refresh intradiário). page_daily_follows permanece indefinido.
- [ ] VERIFY RED: executar somente teste do contrato; confirmar falha por ausência do comportamento, não setup.
- [ ] GREEN: implementar DTO discriminado e parser mínimo sem token, provider raw response ou paths.
- [ ] VERIFY GREEN: focados verdes; revisão independente da semântica `null` vs zero e tipos. Registrar checkpoint.

## Task 3 — MetaInsightsClient read-only

**Arquivos propostos:** criar `server/src/metaInsightsClient.ts`, `server/test/metaInsightsClient.test.ts`; consultar `server/src/metaPublishingClient.ts`, `server/src/metaOAuthClient.ts`.

- [ ] RED: URL/host/version fixos, token/prova em transporte seguro **comprovadamente suportado** (não URL de diagnóstico/log), `appsecret_proof` no formato adotado pelo projeto sem expor segredo, allowlist de métricas e períodos, `data` vazio/parcial/malformado, timeout/abort, 190/200/100/3001/4/17/32/613/429/5xx, paginação ou ausência dela.
- [ ] VERIFY RED: falhas esperadas do client novo, com fetch fake e nenhuma rede Meta.
- [ ] GREEN: client de leitura mínimo com limites de métricas, tamanho de resposta, timeout, parser estrito e erro interno tipado/sanitizado; sem adicionar biblioteca/ORM.
- [ ] VERIFY GREEN: focados verdes; review de segredo em logs/URLs e classificação de rate limit. Checkpoint.

## Task 4 — Lookup PostgreSQL tenant-safe e credencial de leitura

**Arquivos propostos:** criar `server/src/insightsRepository.ts`, `server/test/insightsRepository.integration.ts`; consultar `server/src/postgresSocialAccountsRepository.ts`, `server/src/authService.ts`, `server/src/postsStore.ts`, migrations 001/005/010/011.

- [ ] RED: conta inexistente/cross-tenant/desconectada/expired, falta de escopo/task, publicação de outro tenant, publicação vinculada a outra Page, destino IG, post antigo sem destinos, autor que saiu do Workspace mas leitor atual válido, user sem membership, concorrência entre tenants. Testar SQL pelo `TEST_DATABASE_URL` `_test` em schema isolado.
- [ ] VERIFY RED: falhas funcionais e PG real de testes, sem skips; não tocar em DATABASE_URL de produção.
- [ ] GREEN: queries pequenas sempre `(tenant_id,id)` + FK/joins consistentes; lookup de credencial pela **sessão do leitor** e membership atual, sem depender da autoria persistida para autorizar leitura. Descriptografia continua fora do repository ou em camada privada claramente definida.
- [ ] VERIFY GREEN: integração focada sem skips; revisão independente de isolation e escopo SQL. Checkpoint.

## Task 5 — InsightsService: gate, normalização e erro público

**Arquivos propostos:** criar `server/src/insightsService.ts`, `server/test/insightsService.test.ts`; consultar `server/src/metaPublishingContext.ts`, `server/src/socialTokenCrypto.ts`, `server/src/postManagementAuthorization.ts`.

- [ ] RED: conta/token não elegível → zero Graph calls; ID de texto comprovado → consulta; foto/Reel/legado sem prova → `unsupported_object`; métrica sem dado → null; valor 0 real → 0; resposta de outro Workspace nunca reutilizada; sessão revogada durante await longo bloqueia resposta; erro Meta vira código estável.
- [ ] VERIFY RED: falha causada por comportamento ausente.
- [ ] GREEN: regra mínima de autorização, janela temporal, descriptografia sob demanda, mapping explícito, revalidação antes da resposta quando necessário e normalização discriminada. Sem SQL transaction aberta durante HTTPS.
- [ ] VERIFY GREEN: focados verdes; review de privacidade/tenant/concurrency. Checkpoint.

## Task 6 — Endpoints GET autenticados

**Arquivos propostos:** modificar `server/src/app.ts`; criar `server/test/metaInsightsHttp.integration.ts`; atualizar fixture de API apenas se necessário.

- [ ] RED: duas rotas propostas na spec (`/insights/facebook/accounts/:id` e `/insights/facebook/publications/:id`), sessão exigida, UUID/query inválidos 400, cross-tenant 404, sem grant 409, throttle 429, provider down 503, no-store/CORS, respostas sem token/ID Graph/path. Meta totalmente fake.
- [ ] VERIFY RED: confirmar 404/ausência de rota como motivo correto.
- [ ] GREEN: wiring mínimo em `node:http`, error mapping seguro, request limits e lifetime/intervalo validados. Não mudar rotas de post/conta nem permissões OAuth nesta Task.
- [ ] VERIFY GREEN: HTTP+PG focados, review independente de CORS, Origin, isolamento e não vazamento. Checkpoint.

## Task 7 — Regressão, segurança e documentação da 7A

**Arquivos:** testes existentes `server/test/metaOAuth.integration.ts`, `server/test/socialAccounts.integration.ts`, `server/test/facebookPublishingService.integration.ts`, `server/test/postManagementConcurrency.integration.ts`, `server/test/publicationOperations.integration.ts`; `README.md` e docs somente se a 7A for aprovada para uso.

- [ ] Testes RED específicos para qualquer finding de review; correção mínima → GREEN → review de retorno.
- [ ] Executar **sequencialmente** `npm run test:frontend`, `npm run test:server`, `npm run test:integration` (PG real de testes, sem skips obrigatórios), `npm run build`, `npm run lint`, `git diff --check`; registrar contagens e tempos. Não declarar sucesso a partir de runs antigos.
- [ ] Verificar migrations 001–011 sem diff, ausência de nova migration, nenhuma alteração de scheduler/OAuth/publicação fora do aprovado, nenhum segredo/Graph raw response no DTO/log, host Graph fixo. Review independente geral + `verification-before-completion`.
- [ ] Somente então declarar 7A implementada. Separar aprovação automatizada de smoke real com Meta.

---

## 7B — Persistência e sincronização (plano subsequente, não executar agora)

Dependência: 7A e prova de shape/permissões. Escrever design/DDL final e testes de migration antes de código; migration proposta `012_add_facebook_insight_snapshots.sql`, sem alterar 001–011. Invariantes: FKs compostas tenant+conta+destino, relação comprovada com account, chave idempotente não nula por run/métrica/período/breakdown, índices de última amostra e claims, histórico/retention. Tasks futuras: TDD migration/runner, repository de snapshots, worker/coletor separado do publisher, leases/cooldown/backoff/jitter/rate budgets, reconexão/conta desconectada, replay idempotente e API de histórico. Sem collection timer na 7A.

## 7C — Analytics real (plano subsequente)

Dependência: 7B para histórico/séries. Substituir somente placeholders de `src/pages/Analytics.tsx` e `src/pages/Overview.tsx` por componentes que mostrem nome/definição/fonte/período/idade do dado e estados `not_available`/`permission_required`/`token_expired`/`rate_limited`; filtros e gráficos sem zero inventado. Repositories frontend específicos, testes de troca de Workspace, respostas stale, acessibilidade e mocks que não fingem valores reais.

## 7D — Regressão e segurança (plano subsequente)

Review independente completo de autenticação, escopos, IDs, vazamentos, SQL cross-tenant, concorrência, backoff e quotas; suíte PostgreSQL sem skips, regressão OAuth, Facebook/Instagram publishing, scheduler, gestão de agendamentos, mídia e frontend. Testes de burst/concurrency/rate limit com provider fake, sem publicações reais.

## 7E — Preparação de deploy manual (plano subsequente)

Confirmar commit/versão Graph instalada no Debian por procedimento autorizado; backup verificado do PostgreSQL e plano de recuperação; App Review/permissions; migration 012 só após testes e backup; estratégia de rollout compatível (API antiga/nova e worker novo), sem misturar versões de scheduler/publicação; smoke autorizado com Page de teste; monitoramento de 190/200/32/613 e no-store; rollback da aplicação preservando dados/migration, sem rollback destrutivo de schema. Deploy exclusivamente mediante autorização futura, nunca nesta auditoria.

## Handoff/approval gate

Após revisão humana deste documento, a primeira tarefa recomendada é **Task 1: confirmar versão/escopos reais e elegibilidade dos IDs Graph em ambiente de teste**, sem alterar produção. Se `read_insights`/`ANALYZE` ou o mapeamento de ID não puderem ser comprovados, pausar o trecho dependente; manter API honesta (`permission_required`/`unsupported_object`) e solicitar decisão. Nenhuma Task foi implementada pela produção destes documentos.
