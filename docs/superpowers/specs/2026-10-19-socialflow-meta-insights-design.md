# SocialFlow — 7A Meta Insights para Facebook (design)

**Documento histórico Facebook-only, substituído pela variante `2026-10-19-socialflow-meta-insights-design-facebook-instagram.md` e pelo relatório `docs/meta-insights-task-1-security-review.md`.** Errata Task1: asterisco significa refresh intradiário; foto publica/grava post_id. Não executar este plano antigo para a7A atual.

Data: 2026-10-19. Estado: **proposta para revisão humana; implementação não autorizada nesta execução**. Base auditada: branch local `fix/scheduled-post-management`, HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c` (worktree limpo antes destes documentos). O usuário informa que essa linha funciona no Debian; **não houve acesso ao servidor para confirmar o commit efetivamente implantado**. A versão Graph local padrão é v26.0 (`server/src/config.ts`), não verificação do ambiente de produção.

Pesquisa oficial, matriz de métricas e lacunas: [`docs/meta-insights-api-research.md`](../../meta-insights-api-research.md). Fontes principais: [Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US), [Post Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US), [depreciações](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics?locale=en_US), [read_insights](https://developers.facebook.com/docs/permissions/reference/read_insights?locale=en_US), [limites de uso](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/?locale=en_US).

## 1. Objetivo, escopo e critérios

**Objetivo da 7A futura:** oferecer consultas autenticadas e tenant-safe a métricas reais de Facebook Pages e Page Posts publicados pelo SocialFlow, com definição e estado de disponibilidade explícitos. Manter Analytics/Overview sem números inventados até a 7C. Na fase documental atual, **somente planejar**; nenhuma rota, escopo OAuth, migration, job ou UI foi alterado.

Escopo histórico: allowlist mínima de visualizações/únicos/vídeo de Page e visualizações/reações de Post. **Errata:** page_post_engagements/page_follows/post_clicks são candidatos documentados; `*` indica refresh intradiário, não remoção. page_daily_follows continua sem definição. O escopo vigente Facebook+Instagram e critérios atuais estão na variante e relatório Task1, não nesta versão histórica.

Critérios de aceite futuros: respostas de origem Meta ou indisponibilidade explicitada; nenhuma métrica falsa/zero implícito; 401 sem sessão; 404 para conta/publicação de outro tenant ou inexistente; zero token/secret em DTO/log/URL; consultas limitadas, canceláveis e com timeouts; publicação/OAuth/scheduler sem regressão; testes RED→GREEN com Meta mock e PostgreSQL `_test` sem skips obrigatórios; documentação operacional atualizada. Nenhuma chamada Graph real nos testes automatizados.

## 2. Arquitetura existente confirmada na árvore local

Estrutura relevante identificada: `src/` (React, componentes, páginas e repositories HTTP/mock), `server/src/` (API Node), `server/migrations/` (001–011), `server/test/` (Vitest e integração PostgreSQL), `shared/` (contratos TypeScript) e `docs/`. Stack existente `node:http` + `pg`, sem Express/ORM. `package.json` suporta Node `^22.22.0 || >=24.0.0`; `npm test` encadeia frontend e backend, `npm run test:integration` seleciona 18 arquivos e `npm run build` compila frontend e backend. A auditoria não executou suítes porque esta etapa é documental.

| Caminho | Responsabilidade e consequência para 7A |
| --- | --- |
| `server/src/app.ts`, `server/src/index.ts` | Rotas `node:http`, `AuthService.require`, CORS/Origin, `Cache-Control: no-store`, composição de serviços e start/stop do scheduler. Nova rota autenticada segue esse padrão; não adicionar framework. |
| `server/src/authService.ts`, `server/src/sessionCookie.ts`, `server/src/postsContext.ts` | Sessão opaca em PostgreSQL, cookie HttpOnly, usuário/tenant/membership atuais. Insights deriva `tenantId` só da sessão; membership é revalidado no backend. |
| `server/src/metaOAuthClient.ts`, `server/src/metaOAuthService.ts`, `server/src/metaOAuthStateRepository.ts` | OAuth, escopos pedidos e concessões efetivas. Hoje pede `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `pages_manage_posts`, `instagram_content_publish`; **não `read_insights`**. Autorização é persistida/reconectável. |
| `server/src/socialAccountsRepository.ts`, `server/src/postgresSocialAccountsRepository.ts`, `server/src/socialTokenCrypto.ts` | Contas e credenciais por tenant; AES-256-GCM com `SOCIAL_TOKEN_ENCRYPTION_KEY`. `findMetaPublishingCredential` só lê credencial se autor persistido ainda tiver membership; essa regra de publicação **não é automaticamente adequada** a leitura de Analytics por outros membros. Criar lookup de Insights com sessão/membership atual, não usar autor de post como ator da consulta. |
| `server/src/metaPublishingClient.ts`, `server/src/facebookPublishingService.ts`, `server/src/publicationOperationsRepository.ts`, `server/src/postPublicationsRepository.ts` | Publicação texto `/feed`, foto `/photos`, Facebook Reel por sessão de vídeo; destino guarda `provider_post_id`, operação assíncrona guarda checkpoint/leases. Não tocar nesse fluxo nem executar Insights dentro de suas transações. |
| `server/src/publicationCoordinator.ts`, `server/src/publicationScheduler.ts`, `server/src/publishingService.ts` | Claim e retomada de publicação; execução externa fora de transações longas. 7A não adiciona trabalho ao scheduler; 7B terá mecanismo separado. |
| `server/src/postsStore.ts`, `shared/postContract.ts`, `shared/postPublicationContract.ts`, `shared/postManagementContract.ts` | Post, destino por conta, estado e detalhes tenant-safe; registros legados sem destinos continuam possíveis e não oferecem associação externa. |
| `server/migrations/001_create_posts.sql`, `005_add_social_accounts.sql`, `009_add_post_media.sql`, `010_add_post_publications.sql`, `011_add_publication_operations.sql` | FKs compostas e histórico de posts/contas/destinos/operações. **001–011 imutáveis**. 7A não exige migration; proposta para 7B abaixo. |
| `src/pages/Analytics.tsx`, `src/pages/Overview.tsx`, `src/App.tsx`, `src/data/createAppServices.ts`, `src/data/mockData.ts`, `src/data/posts/MockPostsRepository.ts` | Analytics mostra “—” e indisponibilidade, sem API de métricas; Overview usa a quantidade de posts retornada pelo repository ativo, mas alcance/engajamento/seguidores são placeholders. No modo mock, posts vêm de `initialPosts`; `mockData.ts` também fornece títulos, canais e preferências de demonstração usados pelo shell/fixtures. Não há números fake exibidos como Analytics real no código auditado. |
| `server/test/*integration.ts`, `server/test/publicationFixtures.ts`, `server/test/postManagementFixtures.ts`, `vitest.server.config.ts`, `package.json` | Testes com `TEST_DATABASE_URL`, schemas temporários e Meta mock; `npm run test:integration` seleciona 18 arquivos PostgreSQL. Testes não foram executados nesta auditoria documental. |

**Lacunas reais:** não há Insights client/service/repository/contratos/endpoints; OAuth não pede `read_insights`; não há estado de coleta nem snapshots; `provider_post_id` não indica tipo de objeto externo; Analytics/Overview não consultam métricas; não foi verificada concessão real `ANALYZE`/Advanced Access nem versão Graph efetiva no Debian. A presença de conta `connected` e token de publicação não comprova permissão de Insights.

Os arquivos de Docker Compose/infraestrutura de produção não foram localizados na árvore versionada auditada. O plano de deploy 7E deve usar a configuração efetivamente instalada somente após acesso/autorização específicos; não inferir seu conteúdo a partir do código.

## 3. Associação de IDs e autorização de objeto

O cliente informa **somente IDs locais UUID**: `socialAccountId` ou `postPublicationId`. A API busca por `(tenant_id, id)` e exige `account_type='facebook_page'`, conta ativa, conexão não revogada, credencial existente e escopo **efetivamente concedido**. Para destino: `post_publications` + `posts` + `social_accounts` no **mesmo tenant** e `status='published'`; `provider_post_id` presente; a Page associada deve ser a mesma da credencial. Nunca aceitar ID Graph, Page ID, tenant ou token do request como autoridade. A consulta a posts legados sem destino ou destino de Instagram retorna ausência/objeto não suportado, **não** inventa vínculo.

`provider_post_id`: texto vem de `/feed.id`; foto grava **`/photos.post_id`**, não photo.id; Reel é video ID. A edge oficial `/{post-id}/insights` exige Post; texto/foto são candidatos com Page/tenant comprovados, Reel precisa de gate próprio. A versão vigente detalha também IG IDs. Proposta histórica de gate (substituída pela variante):

1. No 7A, habilitar busca de Insights por destino de **texto Facebook** apenas se a resposta Graph de teste confirmar que `provider_post_id` é um Post da Page.
2. Foto não é bloqueada por falta de Post ID, pois o client já grava post_id. Reel continua dependendo de prova de objeto/edge; não reescrever histórico.
3. Nunca consultar por texto de legenda, horário, post local sem destino ou tentativa incerta (`publication_state_unknown`). Não agregar métricas de Page e post como se fossem a mesma granularidade.

Fonte da edge: [Post Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US). A limitação de mapeamento é **inferência da auditoria local + lacuna documental**, não afirmação da Meta sobre impossibilidade de foto/Reel.

## 4. Fluxo e módulos propostos

```
GET autenticado /insights/facebook/...
  → AuthService.require() → tenant + membership atuais
  → InsightsService (política, janela, estado público)
  → InsightsRepository (joins tenant-safe, leitura de credencial e associação)
  → MetaInsightsClient (HTTPS Graph v26.0, allowlist, timeout, parser)
  → DTO normalizado sem segredo + Cache-Control: no-store
```

- `shared/insightsContract.ts`: enums e DTOs discriminados (`available`, `not_available`, `unsupported`, `permission_required`, `token_expired`, `rate_limited`, `provider_unavailable`) e validadores. Um estado não disponível sempre `value:null`; `0` apenas se Meta respondeu zero real. Sem `storage_key`, token, URL física, Graph trace ou objeto raw Graph.
- `server/src/metaInsightsClient.ts`: wrapper de **leitura** isolado, Graph host fixo e versão configurada, métricas/períodos em allowlist, `appsecret_proof` derivado do segredo da app conforme [orientação oficial](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US), token/prova fora de URL quando o modo de transporte estiver documentalmente confirmado, timeout/AbortSignal, limite pequeno de métricas, sem log do corpo bruto; normalização contra shape inválido e paginação quando aplicável. **Gate aberto:** a página oficial consultada mostra prova em parâmetro de formulário, não confirma header para esta GET. Não codificar transporte de header por suposição. Sem mutations.
- `server/src/insightsRepository.ts`: somente consultas necessárias ao banco, por tenant + ID; relacionamento composto destino→Post→conta; lookup de credencial de Insights revalidando sessão/membership atual. **Não** reutilizar `findMetaPublishingCredential` com autor persistido, pois Analytics é leitura do Workspace e não depende de o autor original ainda ser membro. A autorização de conta social precisa de regra explícita de leitura: membros atuais podem ler métricas do Workspace, se aprovado; não conceder escopo Meta automaticamente.
- `server/src/insightsService.ts`: seleção de métricas, regra de objeto, estado de conta/token, permissão/`ANALYZE`, classificação segura de erros Graph, janela ≤90 dias e ≤2 anos quando `since/until`; nenhuma transação longa durante Graph. Consulta ao DB antes de Graph e, se necessário, revalidação leve de conta/tenant antes de responder a chamada demorada. Em mudança de Workspace/sessão durante a requisição, a resposta deve permanecer vinculada ao contexto autenticado de **início** e não ser reutilizada para outro workspace; antes de enviar, revalidar sessão e membership se houver revogação crítica. Frontend ignora respostas cujo workspace/generation não corresponda ao atual.
- `server/src/app.ts`: duas rotas GET autenticadas, UUIDs válidos, limites de query, `Cache-Control: no-store`, CORS existente, mensagens estáveis. Não expor endpoints administrativos nem aceitar tenant via query/header.

As consultas de Insights **não modificam** post, publicação, credencial ou scheduler. Sem cache global in-memory com chave incompleta; se surgir cache, chave sempre inclui tenant, conta, publicação, métricas, período e versão Graph. Usuários do mesmo Workspace podem visualizar métricas agregadas, sujeito à política humana da seção 10; não herdar a regra “member só edita seus posts” como limitação de leitura, pois o gerenciamento atual permite a todos os membros visualizar posts do Workspace.

## 5. Contratos HTTP propostos (não implementados)

`GET /insights/facebook/accounts/:socialAccountId?since=2026-10-01&until=2026-10-19&period=day&metrics=page_media_view,page_total_media_view_unique`

`GET /insights/facebook/publications/:postPublicationId?period=lifetime&metrics=post_media_view,post_reactions_like_total`

Histórico **não existe na 7A**. Na 7B, depois da persistência, considerar `GET /insights/facebook/accounts/:socialAccountId/history?metric=...&since=...&until=...` e rota análoga para destino, com paginação/cursor opaco e a mesma autorização tenant-safe. Não oferecer endpoint vazio que pareça histórico real antes da coleta.

Sem `tenantId` no request. Para Page, datas ISO UTC/dia no formato `YYYY-MM-DD`, obrigatórias, `since <= until`, intervalo máximo 90 dias e dentro da janela documentada de dois anos; granularidade/período canônicos por métrica, não arbitrários do cliente. Para Post, `lifetime` nesta primeira versão; IDs de outros tipos não são repassados à Meta. `metrics` opcional com conjunto padrão pequeno, allowlist e máximo fixo (proposta: 4 por request, sujeito a testes/limites); métricas desconhecidas → 400 `invalid_insights_query` com campo. “Todas as métricas” não é default.

Exemplo de 200 com valor disponível:

```json
{
  "source": "meta_graph_api",
  "scope": "facebook_page",
  "socialAccountId": "<uuid-local>",
  "graphApiVersion": "v26.0",
  "fetchedAt": "2026-10-19T12:00:00.000Z",
  "metrics": [{
    "key": "page_media_view", "period": "day", "referenceEnd": "2026-10-18T08:00:00.000Z",
    "status": "available", "value": 37, "unit": "count"
  }]
}
```

Exemplo de publicação sem associação Graph segura:

```json
{
  "source": "meta_graph_api", "scope": "facebook_post",
  "postPublicationId": "<uuid-local>", "graphApiVersion": "v26.0",
  "fetchedAt": null,
  "metrics": [{"key": "post_media_view", "period": "lifetime", "referenceEnd": null,
    "status": "unsupported", "value": null, "unit": "count", "reason": "unsupported_object"}]
}
```

Estados públicos: `available` quando Meta retornou valor válido; `not_available` quando a consulta Meta foi executada, mas não retornou datapoint interpretável (não inventar a causa); `not_collected` somente em 7B/7C quando não existe snapshot coletado para o escopo/período; `unsupported` para objeto/métrica fora da allowlist ou comprovadamente incompatível; `permission_required` se escopo/task não concedido; `token_expired` para credencial vencida; `rate_limited` e `provider_unavailable` para falhas de leitura. Não usar `not_available` como sinônimo de “ainda não coletado”. Para falha total, usar erro HTTP estável (`meta_insights_permission_required`/`meta_insights_reconnect_required` em 409, `meta_insights_rate_limited` em 429 com `Retry-After` apenas quando seguro, `meta_insights_unavailable` em 503); parcial por métrica pode manter 200 com estados. **Não** transformar 403 local em erro Meta: 401 sessão ausente, 404 UUID ausente/cross-tenant, 400 UUID/query inválidos. A semântica exata de 409/429/503 é **decisão proposta**, não comportamento existente.

`fetchedAt` descreve consulta Graph executada, não data de referência da métrica. Uma resposta sem chamada Meta usa `fetchedAt:null`. `referenceEnd` pode ser nulo para lifetime quando Meta não fornecer data. Para `post_reactions_by_type_total`, definir `value` como mapa validado de tipos, ou usar entradas separadas por tipo; não aceitar `number` incorreto. O contrato final deve discriminar tipos e limitar campos para evitar propagação de dados Graph arbitrários.

## 6. Persistência: 7A sem migration; proposta para 7B

**7A:** consulta sob demanda sem persistência de métricas; leitura do schema existente. Isso evita criar tabela antes de validar permissões/shape real. **7B:** se aprovado, migration **posterior à 011** (provável `012_add_facebook_insight_snapshots.sql`, não criada agora). Esboço SQL conceitual, a revisar contra schema/runner na implementação:

```sql
-- Chave candidata adicional, criada SOMENTE pela futura migration 012.
ALTER TABLE post_publications ADD CONSTRAINT post_publications_insights_scope_key
  UNIQUE (tenant_id,id,social_account_id);
CREATE TABLE insights_collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  social_account_id uuid NOT NULL,
  post_publication_id uuid,
  scope text NOT NULL CHECK (scope IN ('facebook_page','facebook_post')),
  state text NOT NULL CHECK (state IN ('running','succeeded','partial','failed','rate_limited')),
  graph_api_version text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  next_allowed_at timestamptz,
  error_code text,
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id, social_account_id) REFERENCES social_accounts(tenant_id,id),
  FOREIGN KEY (tenant_id, post_publication_id, social_account_id)
    REFERENCES post_publications(tenant_id,id,social_account_id),
  CHECK ((scope='facebook_page' AND post_publication_id IS NULL)
      OR (scope='facebook_post' AND post_publication_id IS NOT NULL))
);
CREATE TABLE insights_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  collection_run_id uuid NOT NULL,
  metric_name text NOT NULL,
  period text NOT NULL,
  reference_end timestamptz,
  dimension_key text NOT NULL,
  value_json jsonb,
  availability text NOT NULL CHECK (availability IN ('available','not_available','unsupported')),
  collected_at timestamptz NOT NULL,
  UNIQUE (tenant_id,id),
  UNIQUE (tenant_id,collection_run_id,metric_name,period,dimension_key),
  FOREIGN KEY (tenant_id,collection_run_id)
    REFERENCES insights_collection_runs(tenant_id,id)
);
```

**Atenção:** o esboço evita FK cross-tenant/cross-account por chave composta e evita o problema de `UNIQUE` com `reference_end NULL` usando `dimension_key` canônica não nula. Ainda **não** é migration final: faltam índices de leitura/claim, limite de tamanho/forma de `value_json`, regra de geração de `dimension_key`, política de retenção, verificação de versão PostgreSQL e decisão sobre ID externo resolvido. Não executar/copiar o esboço antes da revisão 7B. Não persistir token, resposta Graph bruta ou URL de mídia. Coleta pode incluir histórico append-only por run + índice de último valor; processo com lease por `(tenant,conta,objeto,janela)` evita dupla coleta. Desconexão interrompe novas chamadas; política de leitura/retenção histórica depende de aprovação.

## 7. Sincronização, limites, resiliência

7A apenas leitura sob demanda, com validação de intervalo, allowlist, limite de chamadas por request/conta, timeout, abort e sem loops de retry no HTTP. A [documentação de rate limit](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/?locale=en_US) classifica Pages API com Page token em Business Use Case limits e fornece cabeçalhos para observar uso; não há quota universal estável. Erros Graph 4/17/32/613 ou 429 exigem cooldown/backoff; nunca traduzir falta de dado em zero. Observar `Retry-After` quando houver e não logar token/corpo bruto.

7B planeja coleta assíncrona **separada** do `PublicationScheduler`, com janelas recentes, refresh de published históricos, deduplicação/lease, jitter, backoff limitado, prioridade por tenant e orçamento de rate limit. Repetir **GET Insights** é seguro do ponto de vista de publicação, mas pode gastar quota; a política de “não reenviar mutações Meta incertas” continua intocada. Capacidade de dados: no máximo dois anos; atualizar periodicamente somente janelas cuja métrica ainda pode mudar; reter histórico conforme decisão de produto/privacidade.

## 8. Segurança e compatibilidade

- `AuthService.require` resolve tenant da sessão; não aceitar tenant/header de Workspace; validar UUID e fazer SQL com tenant em todos os joins, incluindo eventual snapshot. Para cross-tenant: 404 indistinguível de inexistente.
- Revalidar membership/conta ativa antes de descriptografar credencial; verificar `grantedScopes` e task `ANALYZE`. Uma Page com `CREATE_CONTENT`/`MANAGE` para publicação não implica `ANALYZE`. Contas expired/revoked/desconectadas nunca acionam Graph; histórico futuro pode ser exibido somente com sinalização explícita de obsolescência, sujeito à política de retenção.
- Descriptografar no backend apenas no último momento e descartar após chamada. Não colocar token em URL de diagnóstico/log, parâmetros de logger, `Error.cause` público, frontend ou resultado Graph; confirmar transporte seguro e suportado antes da implementação. Host Graph fixo, sem SSRF por ID/URL do cliente.
- Consultas concorrentes de dois tenants não compartilham cache/headers/credencial. Uma resposta de Workspace antigo deve ser descartada pelo frontend 7C via geração/AbortSignal e nunca contaminar store do Workspace atual. Se sessão revogada durante chamada longa, regra de revalidação de resposta deve impedir exposição.
- Nenhuma mudança em OAuth/escopos até App Review/decisão humana, nenhuma mutation Graph e nenhuma transação PostgreSQL envolvendo a chamada HTTPS.
- Não alterar publicação Facebook/Instagram, scheduler, mídia, edição/cancelamento, sessão opaca ou contratos de Post; mocks existentes continuam sem métricas inventadas.

**Configuração proposta:** 7A não introduz variáveis novas. Reutiliza o Graph version em `META_GRAPH_API_VERSION` (local default `v26.0`), `META_APP_ID`/`META_APP_SECRET` apenas server-side para prova da chamada, `META_OAUTH_ENABLED`/`META_OAUTH_REDIRECT_URI`, `SOCIAL_TOKEN_ENCRYPTION_KEY` e `DATABASE_URL`; testes usam `TEST_DATABASE_URL` apontando a banco de teste exclusivo. Nenhum valor secreto deve constar nesta documentação. O ambiente Debian pode definir valores diferentes e precisa ser verificado em operação futura sem imprimir segredo. Os arquivos Compose não foram encontrados na árvore versionada.

## 9. Testes planejados RED→GREEN

Unitários: contrato discriminado (valor zero vs null, mapa de reações, períodos e UUIDs); normalização de `data` vazio, dados parciais, paginação, campos inesperados; client Graph com fetch mock para 190/200/100/3001/4/17/32/613/429, timeout, abort, payload inválido e não vazamento; escolha de objetos text/photo/Reel; métrica deprecated rejeitada; janela >90 dias. HTTP: 401/400/404/409/429/503, no-store, CORS/Origin preservados, sem token/ID externo em body. PostgreSQL `_test` schema isolado: FK tenant, Page de outro tenant, destino de outro tenant, publicação Instagram, post legado sem destinos, member atual vs autor removido, desconexão/reconexão, sessão revogada durante chamada, concorrência inter-tenant, associação Page/post. Regressão: OAuth, SocialAccounts, Facebook/Instagram publishing, scheduler, post management, Workspaces e frontend. Meta sempre fake; `npm run test:integration` deve executar PG real **de testes** sem skips obrigatórios.

## 10. Roadmap e decisões sujeitas a aprovação

| Etapa | Dependência / entrega |
| --- | --- |
| **7A** | Pesquisa e gate de permissões/IDs → contratos → client de leitura → lookup seguro → service → HTTP → testes; sem migration nem UI Analytics real. |
| **7B** | Após piloto 7A: migration nova, runs/snapshots, coleta assíncrona fora do scheduler, lease/rate limit/backoff, retenção e idempotência. |
| **7C** | Após contratos e snapshots 7B: Analytics/Overview com fonte real, timestamp, séries/gráficos/filtros, estados vazios/sem autorização, troca segura de Workspace. |
| **7D** | Revisão independente de autorização, Graph e concorrência; regressão PG, frontend e 6E/gestão; testes de segurança e compatibilidade. |
| **7E** | Plano manual de deploy/backup, App Review/escopos, migração 7B com compatibilidade de versões, smoke autorizado, rollback de aplicação sem perda de dados. Sem produção nesta auditoria. |

**Aprovação humana necessária antes de implementar:** (1) leitura de Analytics por todo member atual do Workspace ou papel mais restrito; (2) escopos/App Review e piloto Meta de teste; (3) se 7A deve incluir foto/Reel somente após mapeamento provado ou começar com texto; (4) política de retenção e acesso a históricos de contas desconectadas para 7B; (5) nomenclatura do painel (“visualizações” em vez de “impressões”/“alcance”) e se dados de Page abaixo de 100 likes serão explicitamente indisponíveis; (6) transporte oficial seguro de token/`appsecret_proof` para a GET. Nenhum destes pontos foi decidido por esta auditoria.

## 11. Não ações desta sessão

Nenhum código de produção, migrations 001–011, escopo OAuth, frontend, banco, servidor Debian, Docker/Compose, segredo, job, publicação Meta, branch, commit ou push foi modificado. Os testes históricos não foram repetidos porque a tarefa é exclusivamente documental. Os documentos devem ser revistos antes de iniciar qualquer implementação 7A.
