# SocialFlow 7A — Meta Insights Implementation Plan (Facebook + Instagram)

**Atualização vinculante22/10/2026:** Tasks1A–6 concluídas localmente com contratos/clients/repository/service/HTTP aprovados e transporte real bloqueado. As Tasks1A–3 locais foram executadas sob o plano específico de20/10; checkboxes originais abaixo são histórico do desenho amplo, não autorização para reimplementá-las. Task7 agora é **exclusivamente documental**, conforme seção própria revisada e [auditoria final](../../meta-insights-task-7-final-audit.md). Trechos antigos “não iniciado”, “sem flag”, “sem rotas” ou “declarar7A implementada” não prevalecem sobre essa autorização. Sem Git mutations/produção.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Planejar uma API autenticada e tenant-safe para métricas **reais** de Facebook Pages, Page Posts, contas profissionais Instagram e mídias Instagram elegíveis, sem afetar publicação, e preparar a evolução 7B–7E.

**Architecture:** A futura 7A adiciona contrato compartilhado, client Graph de leitura, lookup PostgreSQL de conta/destino do tenant, service de autorização/normalização e rotas `node:http`. Allowlists separadas por provedor: Facebook `page_media_view`, `page_total_media_view_unique`, `page_video_views`, `post_media_view`, `post_total_media_view_unique`, reações por tipo; Instagram com candidatos `views`, `reach`, `accounts_engaged` e métricas de mídia compatíveis ainda sujeitos a confirmação oficial por formato/período; cada métrica depende de grant e piloto, sem alegar disponibilidade universal. Consulta sob demanda, sem migration ou job. 7B acrescentará snapshots/sincronização em migration posterior à 011, separada do scheduler de publicação.

**Tech Stack:** Node.js 22+, TypeScript strip-only onde aplicável, `node:http`, `pg`/PostgreSQL, React/Vite, Vitest; reutilizar crypto/sessão/cookie e fixtures existentes; nenhuma dependência nova prevista.

**Spec:** `docs/superpowers/specs/2026-10-19-socialflow-meta-insights-design-facebook-instagram.md`.

**Research:** `docs/meta-insights-api-research-facebook-instagram.md`; **Task1 audit:** `docs/meta-insights-task-1-security-review.md` (matrizes por endpoint, divergências e gates). Fontes canônicas IG atuais: [Account](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights), [Media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights).

**Status:** implementação não iniciada; **auditoria documental Task1 concluída em20/10/2026**, sujeita aos gates externos/humanos do relatório. Base local `fix/scheduled-post-management@e44b031d194a959e3f4182b246d17525a0ebc09c`, versão Graph local efetiva v26.0. Deployment não verificado no Debian. Futura branch sugerida `feat/socialflow-7a-meta-insights` somente quando autorizada.

## Global Constraints

- Não executar nenhuma Task de implementação antes de aprovação explícita da spec/plano e das decisões pendentes abaixo. A pesquisa oficial deve ser reconfirmada no início da implementação porque a Graph API muda.
- Não alterar migrations 001–011 nem criar migration na 7A; não tocar em produção, banco de produção, Docker/Compose, `.env.production`, credenciais ou deploy. 7B propõe uma `012` **somente depois** de design/testes e aprovação separados.
- Não estender OAuth silenciosamente. `read_insights` **e** `instagram_manage_insights` estão ausentes do escopo atual. Confirmar App Review/Advanced Access, task `ANALYZE` e elegibilidade de Page/conta Instagram profissional e concessão real. Falta de permissão produz estado seguro, nunca chamada Graph assumindo autorização.
- Consulta Graph exclusivamente read-only, HTTPS, host fixo e token fora de URL/log/DTO. Nenhum Graph request dentro de transação PostgreSQL longa. Não acoplar ao publisher/coordinator/scheduler e não criar timers na 7A.
- Tenant e membership exclusivamente da sessão. Contas/destinos por UUID local, lookup tenant-safe e404 cross-tenant. Para mídia IG externa, propor seletor numérico subordinado a UUID local da conta com ownership **e top-level** comprovados no backend; não é autoridade Graph do cliente. Essa exceção de seletor precisa de aprovação e não permite URL/tenant/token arbitrários.
- Texto Facebook guarda `/feed.id`; foto guarda **`/photos.post_id`**, candidatos a Page Post Insights. Reel guarda vídeo: não presumir Page Post. IG guarda ID final `media_publish`, nunca container; validar owner/top-level quando necessário. Nenhum registro legado é reconstruído.
- Não renomear visualmente “impressões” ou “alcance” usando métricas novas sem semântica aprovada. Não exibir zero por ausência de dados. Analytics real fica na 7C.
- Testes RED→GREEN para todo comportamento futuro; mocks da Meta, schemas isolados com `TEST_DATABASE_URL` exclusivo `_test`, nenhuma publicação real. Não iniciar suites pesadas em paralelo. Sem commits/pushes automáticos; checkpoints/ledger para progresso.
- Na execução futura, usar `superpowers:systematic-debugging` para falha inesperada, revisão independente por Task, `superpowers:verification-before-completion` antes de alegar conclusão. Nesta fase documental não há RED/GREEN a executar.

## Decisions required before Task 1

- [ ] Confirmar, sem revelar segredo, Graph API version efetiva do deployment e commit base efetivamente implantado; não se basear só em `META_GRAPH_API_VERSION` default ou no relato do usuário.
- [x] Leitura por qualquer membro ativo owner/admin/member aprovada explicitamente no pedido de21/10/2026; não concede administração.
- [ ] Definir obtenção de `read_insights` (Facebook), `instagram_manage_insights` (Instagram via Facebook Login), task Page `ANALYZE`, App Review/Advanced Access e ambiente de teste autorizado; não ampliar OAuth antes dessa decisão. Se indisponível, manter endpoints futuros com `permission_required`/não liberar produto.
- [ ] Aprovar MVP conjunto com **Facebook Page + Instagram Professional e mídia IG compatível**, sem restringir 7A somente ao Facebook. Facebook foto/Reel e Instagram feed/Reels/carrossel/Stories só depois da prova de ID, métrica, formato e permissões. Definir rótulos de indicadores e disposição dos dados de Page com <100 likes.
- [ ] Definir se chamadas reais de pilotos com Facebook Page e **Instagram Professional de teste** serão autorizadas em sessão separada. Não necessárias/permitidas por este plano documental, mas podem ser gate para ativar métricas.
- [ ] Aprovar alternativa Graph batch: T1/T2 do relatório documentam token+proof no body e subrequests GET, sem header inventado. **IG Insights específico nesse transporte permanece NC/B** até fonte ou piloto autorizado. Rede não pode ser habilitada por analogia com o código atual Bearer+proof-query.

## Review Focus

1. Cross-tenant e papel/membership revalidados; nenhum token antes do gate de autorização; sessões trocadas/revogadas durante Graph não vazam resposta.
2. ID local de publicação → conta social correta (`facebook_page` ou `instagram_business`) → ID Graph específico do provedor. Facebook foto/Reel e IG feed/Reel/carrossel/Story/legado jamais lidos sob suposição de equivalência.
3. `read_insights` (Facebook) e `instagram_manage_insights` (Instagram) efetivamente concedidos conforme fluxo, com tarefas/papéis observados; `pages_manage_posts`/`CREATE_CONTENT` não substituem insights.
4. Métricas depreciadas de ambos os provedores excluídas; `null` não vira `0`; Page metrics não entram como Post metrics; fonte/idade/período explícitos.
5. Graph errors e rate limits não revelam tokens/corpo bruto; chamadas limitadas não afetam a quota do publisher de forma descontrolada.
6. 7B não reutiliza `PublicationScheduler` e não cria FK que relacione post de um tenant a conta de outro.

---

## Task 1 — Gate de documentação, permissões e ID externo

**Arquivos a consultar:** pesquisa/design variantes `-facebook-instagram`, `docs/meta-insights-task-1-security-review.md`, `server/src/config.ts`, `server/src/metaOAuthClient.ts`, `server/src/metaOAuthService.ts`, `server/src/metaPublishingClient.ts`, `server/src/facebookPublishingService.ts`, `server/src/instagramPublishingService.ts`, `server/src/postPublicationsRepository.ts`, migrations005/010/011.

**Checkpoint documental Task1 em20/10/2026:** auditoria concluída, código intacto; IDs foto/IG e User token IG confirmados, quatro tabelas oficiais lidas. Restam gates de transporte IG, grants/roles/piloto e política humana; conclusão **BLOQUEADO POR PENDÊNCIAS** para liberar rede. Não repetir auditoria do código como se nada tivesse sido feito; reabrir somente com mudança de base/documentação ou evidência nova.

- [ ] Reconfirmar Page/Post **e Instagram User/Media** Insights, deprecações e permissões na documentação oficial para a versão Graph efetiva; registrar data/URLs e qualquer divergência.
- [ ] Mapear precisamente IDs persistidos por Facebook `/feed`, `/photos`, Reel e por qualquer publicação Instagram já implementada; definir um discriminante interno seguro (tipo/origem) sem reescrever histórico. Para cada endpoint de Insights, exigir prova de suporte do objeto.
- [ ] Com autorização específica e credenciais de teste, planejar/realizar smoke **fora da suíte automatizada** para Facebook Page (`ANALYZE`, `read_insights`, Page pequena) e Instagram profissional (`instagram_manage_insights`, ligação à Page, conta e IG media compatíveis), além de resposta vazia. Se não autorizado/indisponível, manter foto/Reel desligados e demais métricas como não verificadas em runtime; não fabricar dados.
- [ ] Checkpoint: matrizes documentais **Facebook e Instagram** aprovadas, duas allowlists por provedor/mídia e quais objetos podem ser consultados. **Nenhum código produtivo antes deste gate.**

### Task 1A — Escopo OAuth (somente se App Review/política aprovados)

**Arquivos previstos:** `server/src/metaOAuthClient.ts`, `server/src/metaOAuthService.ts`, `server/test/metaOAuth.integration.ts`, testes de credencial/conta. Dependência: Task 1 concluída e autorização explícita para ampliar escopos.

- [ ] RED: OAuth passa a pedir **`read_insights` e `instagram_manage_insights`** somente após aprovação dos dois escopos, preservando o mesmo fluxo Facebook Login; a decisão pode ser feita por escopo separadamente. Testar pedidos e grants distintos; OAuth passa a pedir `read_insights` sem retirar permissões atuais; `grantedScopes` persiste concessão real; conta antiga/novo login sem concessão continua `permission_required`; reconexão não vaza token nem troca tenant.
- [ ] VERIFY RED: falhas esperadas dos novos testes, não falha por falta de Meta real.
- [ ] GREEN: menor mudança OAuth necessária para pedir e registrar o escopo; sem migrar para Instagram Login nem alterar fluxo de publicação; Instagram Insights via Facebook Login requer `instagram_manage_insights`, não `instagram_business_manage_insights`. **Não assumir** que pedido implica concessão ou Advanced Access.
- [ ] VERIFY GREEN: OAuth/credencial focados e revisão independente de regressão 6E. Se autorização Meta indisponível, não executar esta subtask e bloquear ativação de Insights reais, preservando documentação/estados seguros.

- [ ] RED de compatibilidade obrigatório: recusar novos Insights scopes **não** muda connected/publicação quando os grants básicos permanecem válidos; não adicionar novos scopes a `requiredPublishingScopes`, não filtrar discovery por Insights, não unir grants antigos que tenham sido revogados. Cancelamento antes do upsert não altera contas/tokens. RED concorrente A7: sessão/request expira durante espera do lock final OAuth; se provar uso de now() antigo, corrigir somente a revalidação após lock com relógio atual PostgreSQL. Não assumir essa hipótese reproduzida nesta auditoria.

## Task 2 — Contrato compartilhado e semântica HTTP

**Arquivos propostos:** criar `shared/insightsContract.ts`, `shared/insightsContract.test.ts`; consultar `shared/postPublicationContract.ts`, `server/src/postManagementContract.ts` e `server/src/app.ts`.

- [ ] RED: quatro scopes e allowlist por formato/período; zero real vs null, tipos de reações, UUIDs e campos inseguros. Rejeitar métricas explicitamente removidas e page_daily_follows indefinido. **Não** rejeitar page_post_engagements/page_follows/post_clicks alegando depreciação por `*`: a marca significa refresh intradiário; se fora do MVP, erro é fora da allowlist selecionada.
- [ ] VERIFY RED: executar somente teste do contrato; confirmar falha por ausência do comportamento, não setup.
- [ ] GREEN: implementar DTO discriminado e parser mínimo sem token, provider raw response ou paths.
- [ ] VERIFY GREEN: focados verdes; revisão independente da semântica `null` vs zero e tipos. Registrar checkpoint.

## Task 3 — MetaInsightsClient read-only

**Arquivos propostos:** criar `server/src/metaInsightsClient.ts`, `server/test/metaInsightsClient.test.ts`; consultar `server/src/metaPublishingClient.ts`, `server/src/metaOAuthClient.ts`.

- [ ] RED: graph.facebook.com/version fixos, transporte de leitura injetável, envelope Graph batch um token/tenant com GET interno, token/proof somente body; outer200 com inner400/429 também falha; body interno inválido/ausente, redirect/cursor com token não é seguido/logado. IG rede permanece desabilitada se gate específico não comprovado. Testar params/shape por família, allowlist, timeout/abort e códigos Graph sem vazar erro bruto.
- [ ] VERIFY RED: falhas esperadas do client novo, com fetch fake e nenhuma rede Meta.
- [ ] GREEN: client de leitura mínimo com limites de métricas, tamanho de resposta, timeout, parser estrito e erro interno tipado/sanitizado; sem adicionar biblioteca/ORM.
- [ ] VERIFY GREEN: focados verdes; review de segredo em logs/URLs e classificação de rate limit. Checkpoint.

## Task 4 — Lookup PostgreSQL tenant-safe e credencial de leitura

**Arquivos propostos:** criar `server/src/insightsRepository.ts`, `server/test/insightsRepository.integration.ts`; consultar `server/src/postgresSocialAccountsRepository.ts`, `server/src/authService.ts`, `server/src/postsStore.ts`, migrations 001/005/010/011.

- [x] RED: conta inexistente/cross-tenant/desconectada/expired; **Page token FB vs User token IG** selecionado da conexão vinculada, com expiração própria e sessionId/membershipId revalidados; IG sem vínculo/grant; publicação/account mismatched; final media ID versus container; legado sem destino; leitor de outro membro autorizado conforme papel, autor válido com leitor revogado é recusado; duas credenciais concorrentes isoladas. PG somente banco `_test`/schema isolado.
- [x] VERIFY RED: falhas funcionais e PG real de testes, sem skips; não tocar em DATABASE_URL de produção.
- [x] GREEN: queries pequenas sempre `(tenant_id,id)` + FK/joins consistentes; lookup de credencial pela **sessão do leitor** e membership atual, sem depender da autoria persistida para autorizar leitura. Descriptografia continua fora do repository ou em camada privada claramente definida.
- [x] VERIFY GREEN: integração focada sem skips; revisão independente de isolation e escopo SQL. Checkpoint.

## Task 5 — InsightsService: gate, normalização e erro público

**Arquivos propostos:** criar `server/src/insightsService.ts`, `server/test/insightsService.test.ts`; consultar `server/src/metaPublishingContext.ts`, `server/src/socialTokenCrypto.ts`, `server/src/postManagementAuthorization.ts`.

- [x] RED: conta/grant inadequado→zero Insights calls; FB texto/foto post_id e IG final media ID comprovados→consulta. IG externo exige owner + **prova top-level separada**: filho com mesmo owner e IMAGE/FEED não passa. Conta desconectada, sessão/membership revogados ou snapshot de token/grant alterado durante await→descartar resposta, mesmo com updated_at igual; comparar snapshot privado, não somente timestamp. Métrica vazia válida=null; shape inválido=provider_unavailable. Janela FB não é aplicada a IG account; Media lifetime; Story código10 de audiência não vira automaticamente grant recusado. Erro/expiração Insights não invalida credenciais globais de publicação.
- [x] VERIFY RED: falha causada por comportamento ausente; execuções inválidas de fixture/infra separadas no task-5-report.md.
- [x] GREEN: regra mínima de autorização, janela temporal, descriptografia sob demanda, mapping explícito, revalidação antes da resposta quando necessário e normalização discriminada. Sem SQL transaction aberta durante HTTPS.
- [x] VERIFY GREEN: focados149/149 verdes; review independente SpecPASS/qualityApproved em21/10/2026. Gates globais no ledger desta extensão.

## Task 6 — Endpoints GET autenticados

**Fechamento22/10/2026:** Task6 CONCLUÍDA LOCALMENTE. HTTP114/114,repository/service149/149,OAuth/clients402/402,frontend357/357,backend1696/1696 e integração706/706 nos21arquivos,zero falhas/skips. Build/typecheck/lint/diffcheck/runtimeNode22/hashes11migrations aprovados. Revisões independente/global e retorno Buffer-only aprovados,sem findings abertos. Falha históricaCoordinator não reproduziu nas duas seleções completas novas,causa não comprovada,nenhum patch autorizado/aplicado nesse componente. Reports/falhas históricas preservados no ledger. Encerrar; não iniciar Task7/rede/produção automaticamente.

**Autorização humana adicional22/10:** permitido somente ajustar comparação integral de Buffer em `server/test/metaMediaDelivery.integration.ts` e controles negativos equivalentes; exigir ambosBuffer,comprimentos iguais,todosbytes,mesmos2MB/expectativas/mocks/timeout. Produção/coordinator/scheduler/testesCoordinator continuam imutáveis. Brief `task-6-buffer-brief.md` e snapshot preservado; implementador original→revisão independente→gates completos sequenciais novos. Diagnóstico Coordinator é só leitura/reprodução, qualquer correção exige autorização específica.

**Autorização vinculante posterior (21/10/2026):** apenas quatro rotas account/publication FB/IG, conforme spec seção14 e pedido humano. Mídias externas/descoberta e rede real continuam bloqueadas. Tasks1A–5 já aprovadas; não refazê-las. Não iniciar Task7 ao terminar esta execução.

**Files:** criar `server/src/insightsHttp.ts`, `server/test/metaInsightsHttp.integration.ts`; modificar minimamente `server/src/app.ts`, `package.json` (somente novoPG no test:integration,21arquivos). Não modificar módulos/fixtures aprovados; helpers exclusivos deste teste ficam nele ou em novo `server/test/metaInsightsHttpFixtures.ts` se necessário.

**Interfaces:** consome `PostgresAuthService.require(IncomingMessage):Promise<AuthContext>`, `InsightsService.query(AuthContext,InsightsServiceQuery,{signal?}):Promise<InsightsResponse>`, `PostgresInsightsRepository(pool)`, `SocialTokenCipher`, clients FB/IG aprovados e validadores `isUuid`, `isInsightsSelection`, `isInsightsResponse`. Produz `handleInsightsRequest(request:IncomingMessage,response:ServerResponse,url:URL,dependencies:{authService:Pick<PostgresAuthService,"require">;insightsService:Pick<InsightsService,"query">;sendJson:(response:ServerResponse,status:number,body:unknown)=>void}):Promise<boolean>`, true quando a rota foi tratada. Recebe o sendJson existente do app, sem duplicar serialização/refatorar ou importar app de volta. `createApiServer` compõe service/repository REAIS; seam opcional `insightsTransportForTests?:InsightsTransport` só em NODE_ENV=test, recusada fora de testes, sem novo transporte/configenv. Não há injeção pública de service fake.

**Contrato HTTP vinculante:** quatro paths da spec14, IDs locais UUID; autenticar antes de validar parâmetros. Accounts exigem since/until UTC YYYY-MM-DD reais, ambos positivos e until>since; converter para epoch segundos, janelas do service mantidas. Publications não aceitam datas. Métricas CSV opcionais1–4 únicas, sem vazio/whitespace, allowlists aprovadas; defaults Page page_media_view,Post post_media_view,IG views. Period default day para accounts/lifetime para publications. Só IG Account aceita metricType default total_value, time_series exige reach. Duplicados/desconhecidos/autoridade/URL/version/tokens→400. Provider/recurso/path desconhecido→404. Sucesso exatamente DTO points aprovado, sem campos extras ou números fake. Erros envelope `{error:{code,message}}`, tabela de status/códigos/mensagens fixas da spec14; no-store/nosniff no namespace desde antes de Origin; CORS/cookies/OPTIONS existentes intocados; métodos não suportados405/Allow.

**Review Focus e testes obrigatórios:**
1. Request fecha durante lookup/provider/reload: sinal chega ao service, nenhuma entrega tardia/log bruto; remover listeners sem abortar GET só porque request complete ocorreu. Usar response close prematuro/request aborted, não request close normal.
2. Revogação de sessão, membership, troca de Workspace, disconnect ou rotação durante await (success e erro): respostas não carregam dados antigos. Nenhum await adicional entre gate final do service e envio HTTP.
3. Datas normalizadas implicitamente, datas iguais/futuras/janelas fora dos limites, métricas duplicadas por parâmetro/CSV, params percent-decoded duplicados, authority extras e Graph ID local inválido:400 antes de decrypt/Graph.
4. Test seam enviada fora de NODE_ENV=test ou configuração Insights não injetada: mock recusado fora de testes; default elegível503meta_insights_not_enabled, nunca200fake, com global fetch/https espionado para provar ausência de Meta real.
5. Requisições FB/IG e tenants distintos completando invertidas: sem cache/credenciais/dados cruzados. Todos owner/admin/member leem outro autor; FB Page vs IG User permanecem distintos; nenhuma conexão/credencial é modificada por erro.

- [x] **RED:** escrever HTTP PG real em `metaInsightsHttp.integration.ts`, com fixtures existentes e raw cookie real vinculado ao token_hash. Instanciar app sem dependências novas inicialmente para obter404/ausência funcional, não import failure. Sucessos quatro scopes com zeros/ausência reais do fake e DTOvalidado; auth401sem/inválida/expirada/revogada; UUID400, foreign/unknown404equivalentes; todos papéis. Queryvalidação completa e erros409/429/503distintos; Grant/parcial/tokenexpired/desconectada/IGprova/mídia/conta incompatíveis sem decrypt/Graph. Meta/publish/scheduler não executam efeitos. Cenários de ReviewFocus têm testes limitados e promises de rejeição observadas, sem hangs. Caracterizações CORS/OPTIONS existentes podem passar já, mas nenhum comportamento novo será escrito antes do RED correspondente.
- [x] **VERIFY RED:** `npm run test:server -- server/test/metaInsightsHttp.integration.ts --no-file-parallelism --maxWorkers=1 --reporter=json --outputFile=.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-6-red.json`; confirmar falhas de status/ação por rota ausente, não fixture/permissão/import. Se dividir fases, guardar cada RED/GREEN antes do código da fase; não contar filtros como skips obrigatórios finais. Evidência válida: task-6-verified-red.json; execuções iniciais de fixture não contam e limitações por caso estão no relatório.
- [x] **GREEN:** helper HTTP parseia sintaxe/seleção e usa service como autoridade das janelas/elegibilidade; erro mapping por allowlist seguro e DTOvalidado. App injeta service real sem transporte padrão e fake seam test-only, headers no namespace antes de Origin e handler depois dos checks globais/OPTIONS. Abort sem refletir reason e sem escrever em response destruída; nenhuma rawexception vai ao logger global da rota. Sem querySQL duplicada, middlewareglobalnovo, timer/job ou refactor amplo.
- [x] **VERIFY GREEN:** repetir arquivoHTTP completo (sem filtro/skip) e regressão app/auth/6E relevante; report `task-6-report.md`, snapshot/diff e revisão independente spec+quality. Findings Critical/Important em TDD e review de retorno. Manter `task-6-*` distintos dos finais históricos.
- [x] **Gates finais sequenciais:** HTTPfocados, repository/service149, OAuth/clients402 (contagens anteriores apenas referência), frontend,server,integration21PGreaissem skips,build,lint,diffcheck. TestDBguard antes de PG; runtime imports novos+appinertes Node22 e hashes001–011/base. Snapshot byte preserva todos os23arquivosdeOAuth/clients/repo/service/testes aprovados; package somente seletor novo, index/scheduler/publishers/crypto/env/lock intactos. Nenhum Meta real ou servidor produção.
- [x] **Review global e checkpoint:** revisão independente da extensão/integração com módulos aprovados, registrar findings/rulings/resultadosreais e inventário em `task-6-final-report.md`, `task-6-files.md`, progress.md. Semcommits/cleanup. Concluir sóTask6; aguardar autorização antes deTask7/Graphreal.

## Task 7 — Regressão, segurança e documentação da 7A

**Autorização humana22/10/2026:** somente auditoria/documentação; não executar a instrução histórica de implementar correções ou repetir gates globais sem necessidade. Código/testes são somente leitura; se surgir finding que os afete, pedir autorização. Não usar a conclusão documental como liberação de rede ou declaração de7Areal concluída.

**Arquivos documentais:** `docs/meta-insights-task-7-final-audit.md`, `docs/meta-insights-pilot-runbook.md`, pesquisa/spec/plano conjuntos e `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-7-*.md`/progress.md. **Review Focus:** conjunto inteiro Tasks1A–6, tenant/credenciais/reauthorização/zero mocks normais; não apenas último diffHTTP. Nenhum source/SQL/migration/.env, README ou package deve ser alterado.

- [x] Recuperar Git/HEAD/checkpoints e verificar fontes contra hashes pós-gates. Preservar históricos inclusive falhas e snapshots.
- [x] Revisar arquitetura ponta a ponta e pedir parecer independente do conjunto. Classificar findings e limites sem corrigir aplicação nesta execução.
- [x] Reconsultar fontes oficiais públicas; matriz transporte/permissões com data/versão/nível de confirmação. Separar evidência Batch genérica de Insights específico. Não executar Graph autenticada.
- [x] Documentar quatro famílias, allowlists, Page/User tokens, IDs/formatos e gates externos; diferenças da proposta antiga claramente datadas.
- [x] Escrever runbook futuro: pré-requisitos/consentimento e grants, smoke separado por endpoint, resultados vazios, evidência sanitizada, parada, habilitação gradual proposta e rollback sem perda de histórico.
- [x] Revisão independente de retorno dos documentos; corrigir contradições documentais e registrar ausência de Critical/Important local aberto. task-7-documentation-review.md: SpecPASS/QualityAPPROVED,0C/I/M.
- [x] Verification-before-completion: conferir hashes/fontes/migrations/staging/HEAD e diff-check, links e escopo documental. Atualizar relatório/ledger e encerrar Task7documental; **aguardar aprovação**, sem continuar7B–7E/Meta real.28fontes e11migrations iguais ao manifesto,11SQLs iguais àbase,stagingvazio; somente docs desta Task. Suítes não reexecutadas.

Preservar evidência anterior:357frontend/1696backend/706integração,HTTP114/repo-service149/OAuth-clients402,build/lint/typecheck/runtime aprovados, desde que hashes permaneçam iguais. Nesta Task não alegar nova execução. Se no futuro houver mudança de código autorizada, regressão afetada e gates correspondentes deverão ser novos; qualquer falha Coordinator permanece fora de escopo de correção.

---

## Task 8 — validação técnica de transporte e preparação do piloto (22/10/2026)

**Adendo posterior Task8.1 CONCLUÍDA localmente (autorização específica): F8-1 FECHADO.** Corrigido somente Graph80001 numérico→rate_limited no core. RED→GREEN, revisão independente do delta e gates locais aprovados; consultar [resultados e limitações](../../../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-8-1-report.md). O diagnósticoF8-1 aberto abaixo é histórico da Task8. Nada libera transporte/piloto ou próxima implementação automaticamente.

**Escopo aprovado:** recuperar checkpoints sem repetir implementação; pesquisar alternativas oficiais por família; criar protocolo se a prova for insuficiente; ajustar runbook A–D; revisão independente. Sem transporte real/credencial/Graph autenticada, sem código produtivo aprovado alterado ou migração. Testes locais de transporte somente se existir alternativa suficientemente comprovada; mocks não são essa prova.

**Arquivos:** novo `docs/meta-insights-task-8-transport-validation.md`; atualizar runbook/pesquisa/spec/plano e ledger/task-8-report.md. Parecer independente em task-8-review.md. Nenhum .ts/SQL/package/dependência precisa mudar para documentar o bloqueio.

- [x] Recuperar branch/HEAD/status/relatórios1A–7, confirmar28fontes e11migrations preservadas e nenhuma execução equivalente ativa.
- [x] Verificar SecureRequests/Batch,4edgesInsights,Auth/Versioning/RateLimits; separar evidência genérica de específica, atualizar matriz/data/fontes.
- [x] Manter rede bloqueada quando prova insuficiente; escrever protocolo futuro de RED→GREEN sem implementá-lo. Não criar teste fake que alegue validar Meta.
- [x] Preparar APage/BPosttexto/CIGAccount/DIGIMAGEprópria,umaInsights/ficha/zeroretry,preflightaprovadoseparado,semReelinicial. Consentimento e critérios de parada obrigatórios.
- [x] Documentar F8-1 após diagnóstico sintético: Graph80001→provider_unavailable,controles4/17/32/613→rate_limited. Nenhum patch: solicitar autorização específica para alterarcoreaprovado.
- [x] Revisão independente das propostas/diagnóstico: task-8-review.md aprova documentação com restrições,0Critical/1ImportantF8-1aberto/0Minor,sem novo finding documental. F8-1 não foi fechado por estar fora do escopo de correção.
- [x] Conferir links/whitespace/diff-check,hashes/fontes/migrations/HEAD/staging; registrar resultados atuais sem repetir suites globais.28fontes/11migrations preservadas,stagingvazio. Encerrar investigação/preparação com quatrofamíliasPARCIALMENTECONFIRMADO/redeBLOQUEADA e aguardar aprovação.

**Critério:** a entrega documental pode ser concluída mantendo rede BLOQUEADA e F8-1 aberto com pedido de autorização. Não afirmar PRONTOparaPiloto,transporteimplementado ou7Arealfuncionando. Se necessário corrigir OAuth/repository/service/client aprovado, interromper essa correção e aguardar autorização; somente documentação continua nesta execução.

## Task9 — transporte condicionado (22/10/2026)

Autorização humana permite adaptador isolado **somente com prova documental suficiente por família**. Pesquisa dirigida atual: [Task9](../../meta-insights-task-9-safe-transport.md). Gate não satisfeito; executar apenas a entrega documental, não Tasks de código/rede/7B. F8-1 está fechado pela Task8.1; menções históricas abaixo a sua autorização pendente não descrevem mais o código atual.

- [x] Recuperar checkpoints7/8/8.1 e contratos/composição, preservar28fontes/testes e11migrations;defaultOAuthfalse/defaulttransporte503.
- [x] Consultar fontes oficiais públicas, registrar prova genérica versus cadaedge, versão/tokens/proof, envelope/erros e lacunas; não generalizar suporte Batch.
- [x] Preservar bloqueio nas quatro famílias; não criar adaptador/teste de rede sem prova suficiente, não alterar módulos aprovados.
- [x] Atualizar quatro pilotos somenteleitura e protocolo futuro isolado, sem código executor, credencial ou chamada real.
- [x] Revisão independente documental/segurança/compatibilidade aprovada,0C/I/M; links/whitespace/diff-check/hashes e relatório final conferidos no ledgerTask9. A entrega documental foi concluída, não a implementação de transporte ou ativação real.

## 7B — Persistência e sincronização (plano subsequente, não executar agora)

**Gate posterior Task8(22/10):** antes de qualquer rede/7B, consultar a [validação de transporte](../../meta-insights-task-8-transport-validation.md). Quatro famílias permanecem parcialmente confirmadas, F8-1 requer autorização de correção no core e pilotos A–D ainda não foram autorizados/executados. Não transformar o plano de teste/mock em prova Meta.

Dependência:7A e prova de shape/permissões. Futura `012_add_meta_insight_snapshots.sql`, sem alterar001–011. **Reprojetar sujeito de mídia IG externa**: DDL ilustrativo da spec ainda exige destino e não a representa. Garantir tenant+conta+objeto, chaves de amostra não nulas, índices/retention e claims. Coletor separado do scheduler, sem timers na7A.

## 7C — Analytics real (plano subsequente)

Dependência: 7B para histórico/séries. Substituir somente placeholders de `src/pages/Analytics.tsx` e `src/pages/Overview.tsx` por componentes que mostrem nome/definição/fonte/período/idade do dado e estados `not_available`/`permission_required`/`token_expired`/`rate_limited`; filtros e gráficos sem zero inventado. Repositories frontend específicos, testes de troca de Workspace, respostas stale, acessibilidade e mocks que não fingem valores reais.

## 7D — Regressão e segurança (plano subsequente)

Review independente completo das duas integrações, autenticação, escopos, IDs, vazamentos, SQL cross-tenant, concorrência, backoff e quotas; suíte PostgreSQL sem skips, regressão OAuth, Facebook/Instagram publishing, scheduler, gestão de agendamentos, mídia e frontend. Testes de burst/concurrency/rate limit com provider fake, sem publicações reais.

## 7E — Preparação de deploy manual (plano subsequente)

Confirmar commit/versão Graph instalada no Debian por procedimento autorizado; backup verificado do PostgreSQL e plano de recuperação; App Review/permissions **Facebook e Instagram**; migration 012 só após testes e backup; estratégia de rollout compatível (API antiga/nova e worker novo), sem misturar versões de scheduler/publicação; smoke autorizado com Page de teste; monitoramento de 190/200/32/613 e no-store; rollback da aplicação preservando dados/migration, sem rollback destrutivo de schema. Deploy exclusivamente mediante autorização futura, nunca nesta auditoria.

## Handoff/approval gate

Próximo passo após aprovação: **resolver somente os gates pendentes da Task1** (transporte IG, grants/acesso condicional, top-level de mídia externa e política humana), revalidando apenas evidência alterada. Não repetir o mapeamento de código já concluído. Sem prova, manter trecho de rede bloqueado e contratos honestos; nenhuma implementação foi iniciada nesta entrega.


## Adendo vinculante — inclusão de Instagram na própria 7A

Este adendo integra **todas as Tasks 1–7**, não cria uma Task futura opcional. Caso haja conflito com a redação Facebook-only anterior, seguir o escopo conjunto.

- **Trilha Instagram dentro da 7A:** usar inicialmente Instagram API **with Facebook Login**, já empregado na descoberta da conta `instagram_business`; validar `instagram_manage_insights`/`instagram_basic`/`pages_read_engagement`/`pages_show_list`, Page vinculada, tarefas e App Review/Advanced Access aplicáveis. Não migrar silenciosamente para Instagram Login (`instagram_business_manage_insights`).
- **Task 1:** acrescentar auditoria da publicação Instagram efetiva, credenciais, `instagram_business_account`, IG user/media IDs, métricas User/Media, tipos (`media_type`, `media_product_type`), deprecações/períodos; smoke autorizado com conta profissional de teste. Proibir alegar suporte sem fontes+resposta comprovada.
- **Task 1A:** planejar concessões distintas para `read_insights` e `instagram_manage_insights`; não forçar reconexão de contas existentes nem tratar solicitação como grant.
- **Task 2:** DTOs discriminados e quatro `scope`s. Separar semântica de account/media e Page/Post; `null` sem dado e 0 apenas explicitamente retornado.
- **Task 3:** MetaInsightsClient poderá conter adaptadores por Graph objeto, com allowlist por provedor/formato/period; endpoint `/{ig-user-id}/insights` e `/{ig-media-id}/insights` exclusivamente por Facebook Login, não string Graph informada pelo cliente. Verificar transporte seguro token/proof antes de codificar.
- **Task 4:** incluir lookups SQL tenant-safe IG↔Page↔oauth_connection e IG media⇄post_publication somente se existente; sem relação provada, `unsupported`.
- **Task 5:** gates separados de autorização, normalização de account/media Insights, `metric_type`/`breakdown`, cancelamento, revalidação de sessão e throttling.
- **Task 6:** publicação IG já confirmada no código; ainda assim, mídia externa exige as rotas account/media próprias, owner+top-level comprovados e contexto atual. Seletor Graph sob conta não concede autoridade e depende de aprovação do desenho. Não adiar arbitrariamente o suporte estudado; não habilitar formatos sem prova.
- **Task 7:** regressões Instagram além de Facebook; revisão independente para cada integração e revisão global, sem comprometer o fluxo de publicação/scheduler.
- **7B:** refinar a migration 012 concebida para suportar snapshots por provedor e vínculos tenant/conta/mídia distintos, sem tocar migrations 001–011.
- **7C:** dashboard com filtros separados Facebook e Instagram; nunca somar `views` e `page_media_view` como métricas idênticas sem uma regra semântica documentada.
- **Critério de aceite 7A:** os dois provedores devem ter implementação tenant-safe com testes. Se a Meta ainda não conceder acesso externo, exibir `permission_required` e registrar que a integração está tecnicamente preparada, **não** afirmar dados reais ativados.

**Fontes IG conferidas Task1:** [IG Account](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights), [IG Media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights). `profile_views` ausente da tabela atual e impressions depreciado não entram; combinações documentadas continuam sujeitas a grant/piloto, sem afirmar dados reais ativados. Bloqueio de rede IG e top-level proof estão no relatório Task1; reconfirmar só com fonte nova ou ao executar implementação autorizada.

## Execução local autorizada em21/10/2026

Somente Tasks4/5 nesta execução, sem repetir OAuth/contratos/clients aprovados no plano local de20/10. A Task4 de encerramento daquele plano não é a Task4 repository deste documento. Estado/checkpoints próprios: `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/progress.md`; briefs4/5 nessa pasta incorporam os requisitos exatos do novo pedido.

Reutilizar credenciais cifradas e AuthContext completos, sem autor como gate de leitura. Query/load privado por UUID local, snapshot consistente, revalidação por conteúdo após await e tokens Page/User separados. Clients reais locais com transporte fake nos testes; default permanece bloqueado. Não criar HTTP/repository de snapshots/jobs/migration nem alterar17arquivos aprovados/scheduler/publicação. Só adição seletiva de novos testes PG ao script test:integration, sem dependências.

Teste primeiro → RED funcional → GREEN focado → revisão independente por Task. Depois, gates sequenciais completos do pedido e revisão global da extensão. Checkpoints substituem commits e são preservados. Rede/appreview/piloto/deployment e mídia externa top-level continuam gates externos; não declarar toda7A concluída.

## Fechamento local10E —23/10/2026 (precedência atual)

Autorização humana posterior permitiu10A–10E estritamente locais/sintéticas. Tasks1A–10D preservadas e auditadas;10E adiciona verificaçãoEd25519, recibos privados duráveis e fluxo manual sintético, sem confiança/bindingreal. Plano específico[10E](2026-10-23-socialflow-meta-insights-10e.md),[fechamento local](../../meta-insights-7a-local-closure.md),[runbook](../../meta-insights-pilot-runbook.md).66/66novos e251/251regressãoexperimental; revisãoindependentefinal semfindings. Frontend357/357; backendoffline com restrições sandbox resolvidas porrerunautorizado, PGnãoexecutado nesta sessão porURLausente. Build/typecheck/lint e hashes anteriores aprovados. Todas as proibições históricas de iniciar10E eram específicas das entregas anteriores; nenhuma permite piloto/rede/produção.

Preparação local concluída com restrições de validação/ativação, **não integraçãoMeta real concluída**. Sem próximaTaskautomática: banco exclusivo para novaPG, bootstrapreal/TTY/admissãoexteriores revisados, consentimento/ativo/grants e novaautorização antes de qualquer consulta. SQL001–011 e publisher/Coordinator/scheduler permanecem intactos.
