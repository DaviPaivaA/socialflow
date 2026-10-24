# SocialFlow — 7A Meta Insights para Facebook e Instagram (design)

**Estado atual — 22/10/2026:** Tasks1A–6 concluídas e aprovadas **localmente**, na branch `feat/socialflow-7a-meta-insights`, working tree sobre HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c`. A descrição original de19–20/10 abaixo permanece histórica; não interpretar “módulo ausente”, “18 arquivos PG”, exemplos escalares ou proibição antiga de HTTP como estado atual. A seção14 define o HTTP implementado; a seção15 e a [auditoria Task7](../../meta-insights-task-7-final-audit.md) definem a revisão documental atual. Rede real, mídia externa, snapshots, jobs, dashboard e produção **não foram liberados**.

Data: 2026-10-19. Estado: **proposta para revisão humana; implementação não autorizada nesta execução**. Base auditada: branch local `fix/scheduled-post-management`, HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c` (worktree limpo antes destes documentos). O usuário informa que essa linha funciona no Debian; **não houve acesso ao servidor para confirmar o commit efetivamente implantado**. A versão Graph local padrão é v26.0 (`server/src/config.ts`), não verificação do ambiente de produção.

Pesquisa de trabalho: [Facebook + Instagram](../../meta-insights-api-research-facebook-instagram.md). Revisão aprofundada Task 1: [relatório de arquitetura/segurança](../../meta-insights-task-1-security-review.md), de 20/10/2026, com matrizes oficiais independentes e gates. Esse relatório prevalece sobre hipóteses anteriores. Fontes principais: [Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US), [Post Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US), [IG Account Insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights), [IG Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights).

## 1. Objetivo, escopo e critérios

**Objetivo da 7A futura:** oferecer consultas autenticadas e tenant-safe a métricas reais de Facebook Pages, Page Posts, contas profissionais Instagram e mídias Instagram elegíveis associadas ao SocialFlow, com definição e estado de disponibilidade explícitos. Manter Analytics/Overview sem números inventados até a 7C. Na fase documental atual, **somente planejar**; nenhuma rota, escopo OAuth, migration, job ou UI foi alterado.

Allowlist inicial proposta: Page page_media_view/page_total_media_view_unique/page_video_views; Post post_media_view/post_total_media_view_unique e reações. Vídeo exige objeto/ID comprovado. **Errata Task1:** `*` significa refresh intradiário; page_post_engagements/page_follows/post_clicks são candidatos documentados, não removidos por asterisco, e podem ser acrescentados mediante decisão/teste. page_daily_follows é “Not defined”; impressões antigas têm remoção explícita e não entram. Comentários/shares de Post são outras edges/campos. Instagram Professional/Media faz parte obrigatória da7A. Reels/Stories/carrossel exigem gates próprios; TikTok, dashboard e sincronização ficam fora. [Page Insights](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US), [depreciações](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics?locale=en_US).

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

**Lacunas reais:** não há Insights client/service/repository/contratos/endpoints; OAuth não pede `read_insights` nem `instagram_manage_insights`; não há estado de coleta nem snapshots; `provider_post_id` não indica tipo de objeto externo; Analytics/Overview não consultam métricas; não foi verificada concessão real `ANALYZE`/Advanced Access nem versão Graph efetiva no Debian. A presença de conta `connected` e token de publicação não comprova permissão de Insights **de Facebook nem de Instagram**. Para Instagram, confirmar o fluxo atual Facebook Login, conta profissional IG vinculada a Page, tarefas/permissões e suporte real aos IDs de mídia.

Os arquivos de Docker Compose/infraestrutura de produção não foram localizados na árvore versionada auditada. O plano de deploy 7E deve usar a configuração efetivamente instalada somente após acesso/autorização específicos; não inferir seu conteúdo a partir do código.

## 3. Associação de IDs e autorização de objeto

As rotas de conta/destino recebem UUIDs locais `socialAccountId`/`postPublicationId`; SQL sempre por `(tenant_id,id)`. Facebook exige conta `facebook_page`; Instagram exige conta `instagram_business` elegível do fluxo Facebook Login, com Page vinculada. Para destino: join `post_publications` + `posts` + conta no mesmo tenant, status published e ID externo presente. Tenant/token/ID Graph nunca são autoridade do cliente. Post legado sem destino não cria associação. Um destino Instagram legítimo com final media ID é elegível na própria trilha IG; não retornar unsupported só por ser Instagram.

`provider_post_id`: Facebook texto grava `/feed.id`; **foto grava `/photos.post_id`** (não photo.id, correção da auditoria anterior); Reel é video ID. Instagram grava o ID final de `media_publish`; container ID de operação não serve para Insights. Recuperação PUBLISHED pode ter ID final null; não inventar associação. Proposta de gate:

1. Texto **e foto Facebook** são candidatos diretos a Page Post Insights; comprovar Page/tenant e testar a edge sem reescrever IDs.
2. Reel Facebook permanece `unsupported_object` até prova oficial/consulta isolada autorizada do objeto/edge de vídeo; não inferir equivalência com Page Post.
3. Para Instagram, resolver exclusivamente IG user/media IDs pertencentes à conta Instagram profissional autenticada e ao tenant; publicação IG só se houver destino existente e associação provada. Não inventar mapeamento a partir de Facebook Page/post ID.
4. Nunca consultar por texto de legenda, horário, post local sem destino ou tentativa incerta (`publication_state_unknown`). Não agregar métricas de Page e post como se fossem a mesma granularidade.

Fonte da edge: [Post Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US). A limitação de mapeamento é **inferência da auditoria local + lacuna documental**, não afirmação da Meta sobre impossibilidade de foto/Reel.

## 4. Fluxo e módulos propostos

```
GET autenticado /insights/{facebook|instagram}/...
  → AuthService.require() → tenant + membership atuais
  → InsightsService (política, janela, estado público)
  → InsightsRepository (joins tenant-safe, leitura de credencial e associação)
  → MetaInsightsClient (HTTPS Graph v26.0, allowlist, timeout, parser)
  → DTO normalizado sem segredo + Cache-Control: no-store
```

- `shared/insightsContract.ts`: escopos explícitos `facebook_page`, `facebook_post`, `instagram_account`, `instagram_media`; enums e DTOs discriminados (`available`, `not_available`, `unsupported`, `permission_required`, `token_expired`, `rate_limited`, `provider_unavailable`) e validadores. Um estado não disponível sempre `value:null`; `0` apenas se Meta respondeu zero real. Sem `storage_key`, token, URL física, Graph trace ou objeto raw Graph.
- `server/src/metaInsightsClient.ts`: núcleo de transporte HTTP injetável e funções/adaptadores por família FB Page/Post e IG Account/Media. Host/version fixos, allowlist por formato/período, timeout/abort e parser específico. [Secure requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US) documenta token+proof no body de **POST Graph batch com GETs internos**; um token/tenant por envelope, outer+inner errors verificados, sem seguir paging.next bruto. Não presumir proof em header de GET direta. Suporte específico IG Insights nesse transporte ainda não foi confirmado: **rede IG bloqueada** até fonte/piloto autorizado. Não extrair clients de publicação/OAuth em refactor amplo para essa Task.
- `server/src/insightsRepository.ts`: consultas por tenant+ID e AuthContext completo, com sessão/membership atuais. **Token discriminado por endpoint:** Facebook usa Page token de `social_account_credentials`; referências específicas IG exigem Facebook **User token** de `oauth_connections`, com a expiração dessa conexão. Não reutilizar cegamente `findMetaPublishingCredential` (Page token/autor) para Analytics. Capturar revisão de conta/conexão/credencial e revalidar depois do HTTP; conta IG desconectada bloqueia mesmo com conexão compartilhada ativa. Política de leitura por papel precisa de aprovação, não de autoria do publisher.
- `server/src/insightsService.ts`: seleção por endpoint: FB query≤90dias/histórico≤2anos; IG Account retenção≤90dias e atraso≤48h; IG Media lifetime/histórico≤2anos, Story24h. Não aplicar limite Facebook global a IG. Antes de decriptar e depois do await HTTP, revalidar sessão/membership/conta e revisão de credencial/grants; alteração descarta resposta. Sem transaction longa durante Graph. Workspace generation/AbortSignal no frontend continua barreira adicional.
- `server/src/app.ts`: quatro rotas account/publication + duas rotas de mídia IG existente sob UUID local da conta, com validação/ownership/top-level comprovados, no-store, CORS e erro seguro. Nenhuma rota aceita tenant/credencial como autoridade.

As consultas de Insights **não modificam** post, publicação, credencial ou scheduler. Sem cache global in-memory com chave incompleta; se surgir cache, chave sempre inclui tenant, conta, publicação, métricas, período e versão Graph. Usuários do mesmo Workspace podem visualizar métricas agregadas, sujeito à política humana da seção 10; não herdar a regra “member só edita seus posts” como limitação de leitura, pois o gerenciamento atual permite a todos os membros visualizar posts do Workspace.

## 5. Contratos HTTP propostos (não implementados)

`GET /insights/facebook/accounts/:socialAccountId?since=2026-10-01&until=2026-10-19&period=day&metrics=page_media_view,page_total_media_view_unique`

`GET /insights/facebook/publications/:postPublicationId?period=lifetime&metrics=post_media_view,post_reactions_like_total`

Histórico **não existe na 7A**. Na 7B, depois da persistência, considerar histórico por conta/destino em **ambos** os provedores, com paginação/cursor opaco e a mesma autorização tenant-safe. Não oferecer endpoint vazio que pareça histórico real antes da coleta.

Para Instagram:

`GET /insights/instagram/accounts/:socialAccountId?since=2026-10-01&until=2026-10-19&period=day&metricType=total_value&metrics=views,reach`

`GET /insights/instagram/publications/:postPublicationId?metrics=views,reach`

As referências canônicas IG foram conferidas: Account `views/reach/accounts_engaged/total_interactions` com period=day e total_value; `reach` também permite time_series. `profile_views` ausente da tabela atual, impressions depreciado: excluir. Media `views/reach/shares/total_interactions` em FEED/REELS/STORY e `likes/comments/saved` em FEED/REELS, sujeitos a piloto. No MVP propor FEED imagem e REELS; carrossel/Story somente após teste específico. A rota publication usa ID final IG já persistido, nunca container.

Proposta de mídia não criada no SocialFlow: `GET /insights/instagram/accounts/:socialAccountId/media` e `GET /insights/instagram/accounts/:socialAccountId/media/:mediaId?metrics=views,reach`. O ID externo é apenas **seletor subordinado à conta local**, nunca prova. Exigir `owner.id` igual à conta IG do tenant e **prova independente de objeto top-level**; owner+IMAGE/FEED não distingue filho de carrossel. Sem prova, não consultar Insights; outro owner→404, formato/top-level não comprovado→unsupported. Referência de mídia externa não requer tabela/assinatura nova na 7A. Política de seletor subordinado depende de aprovação, pois altera a proibição mais ampla de versões anteriores do plano.

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

Estados públicos: `available` com valor validado, inclusive0; `not_available` para resposta Meta válida sem datapoint, sem inventar causa; resposta malformada/inconsistente→`provider_unavailable`, nunca zero nem ausência silenciosa. `not_collected` somente7B/7C sem snapshot; unsupported para objeto/métrica não comprovado; permission_required/token_expired/rate_limited/provider_unavailable separados. Código10 IG pode ser audiência insuficiente de Story, não mapear automaticamente como grant recusado. Erros totais propostos:409 por grant/reconexão,429 por quota,503 provider,401 sessão inválida,404 recurso fora do tenant/inexistente,400 ID/query inválidos. Parcial pode retornar200 com estado por métrica; semântica proposta, não contrato existente.

Para Instagram, `source` poderá continuar `meta_graph_api`, mas os campos `scope` e `metric.key` devem preservar o provedor, a granularidade e a semântica próprios de IG. Retornos podem exigir `total_value`/`time_series` e `breakdown` e não devem ser reduzidos a um escalar sem validação.

`fetchedAt` descreve consulta Graph executada, não data de referência da métrica. Uma resposta sem chamada Meta usa `fetchedAt:null`. `referenceEnd` pode ser nulo para lifetime quando Meta não fornecer data. Para `post_reactions_by_type_total`, definir `value` como mapa validado de tipos, ou usar entradas separadas por tipo; não aceitar `number` incorreto. O contrato final deve discriminar tipos e limitar campos para evitar propagação de dados Graph arbitrários.

## 6. Persistência: 7A sem migration; proposta para 7B

**7A:** consulta sob demanda sem persistência de métricas/migration. **7B:** futura migration posterior à011 (nome proposto `012_add_meta_insight_snapshots.sql`). O SQL abaixo é um **exemplo antigo parcial para fontes ligadas a publicação**, não atende mídia IG externa (exige post_publication para instagram_media). Reprojetar o sujeito provider/conta/mídia e suas FKs antes da7B; não executar o exemplo como migration.

```sql
-- Chave candidata adicional, criada SOMENTE pela futura migration 012.
ALTER TABLE post_publications ADD CONSTRAINT post_publications_insights_scope_key
  UNIQUE (tenant_id,id,social_account_id);
CREATE TABLE insights_collection_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  social_account_id uuid NOT NULL,
  post_publication_id uuid,
  scope text NOT NULL CHECK (scope IN ('facebook_page','facebook_post','instagram_account','instagram_media')),
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
  CHECK ((scope IN ('facebook_page','instagram_account') AND post_publication_id IS NULL)
       OR (scope IN ('facebook_post','instagram_media') AND post_publication_id IS NOT NULL))
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

7B planeja coleta separada do PublicationScheduler, com lease/backoff/orçamento por tenant. Histórico da fonte é por endpoint: FB e IG Media até2anos, IG Account até90dias e Story24h, conforme referências. Repetir GET Insights gasta quota mas não muda publicação; a política de mutations incertas continua intocada. Retenção local é decisão separada.

## 8. Segurança e compatibilidade

- `AuthService.require` resolve tenant da sessão; não aceitar tenant/header de Workspace; validar UUID e fazer SQL com tenant em todos os joins, incluindo eventual snapshot. Para cross-tenant: 404 indistinguível de inexistente.
- Revalidar membership/conta ativa antes de descriptografar credencial; verificar `grantedScopes` e task `ANALYZE` para Page; para Instagram confirmar `instagram_manage_insights`, dependências do Facebook Login e tarefas/papéis aplicáveis sem inferir do grant Facebook. Uma Page com `CREATE_CONTENT`/`MANAGE` para publicação não implica `ANALYZE`. Contas expired/revoked/desconectadas nunca acionam Graph; histórico futuro pode ser exibido somente com sinalização explícita de obsolescência, sujeito à política de retenção.
- Descriptografar no backend apenas no último momento e descartar após chamada. Não colocar token em URL de diagnóstico/log, parâmetros de logger, `Error.cause` público, frontend ou resultado Graph; confirmar transporte seguro e suportado antes da implementação. Host Graph fixo, sem SSRF por ID/URL do cliente.
- Consultas concorrentes de dois tenants não compartilham cache/headers/credencial. Uma resposta de Workspace antigo deve ser descartada pelo frontend 7C via geração/AbortSignal e nunca contaminar store do Workspace atual. Se sessão revogada durante chamada longa, regra de revalidação de resposta deve impedir exposição.
- Nenhuma mudança em OAuth/escopos `read_insights` e `instagram_manage_insights` até App Review/decisão humana, nenhuma mutation Graph e nenhuma transação PostgreSQL envolvendo a chamada HTTPS.
- Não alterar publicação Facebook/Instagram, scheduler, mídia, edição/cancelamento, sessão opaca ou contratos de Post; mocks existentes continuam sem métricas inventadas.

**Compatibilidade OAuth obrigatória:** Insights scopes são opcionais e independentes de connected/publishing. Recusa de novos scopes com base grants mantidos não invalida conta nem impede envio; não incluir Insights em `requiredPublishingScopes`, não filtrar discovery pelos novos grants e não forçar reconexão. Guardar somente grants reais, sem união com antigos revogados. Expiração/erro do User token de Insights não apaga Page token nem marca toda conexão como inválida automaticamente. Testar callback cancelado, grant parcial e reconciliação de contas. O risco A7 (expiração durante lock no callback com `now()` transacional) exige RED específico antes de eventual correção mínima, sem declarar falha reproduzida nesta auditoria.

**Revisão de autoridade:** comparar snapshot privado da conexão/conta/ciphertext/grants/expiração depois do HTTP; updated_at sozinho não é versão garantida. Troca de token/grant mesmo com timestamp igual descarta resposta. Nenhum ciphertext/fingerprint em DTO/log.

**Configuração proposta:** 7A não introduz variáveis novas. Reutiliza o Graph version em `META_GRAPH_API_VERSION` (local default `v26.0`), `META_APP_ID`/`META_APP_SECRET` apenas server-side para prova da chamada, `META_OAUTH_ENABLED`/`META_OAUTH_REDIRECT_URI`, `SOCIAL_TOKEN_ENCRYPTION_KEY` e `DATABASE_URL`; testes usam `TEST_DATABASE_URL` apontando a banco de teste exclusivo. Nenhum valor secreto deve constar nesta documentação. O ambiente Debian pode definir valores diferentes e precisa ser verificado em operação futura sem imprimir segredo. Os arquivos Compose não foram encontrados na árvore versionada.

## 9. Testes planejados RED→GREEN

Unitários: contratos zero/null, parsers FB/IG, janelas por endpoint, formato/top-level, erros Graph e sanitização; exclusão por remoção comprovada (não asterisco). HTTP:401/400/404/409/429/503, no-store/CORS e **sem token/proof/Graph raw response ou IDs não autorizados**; permitir `mediaId` explicitamente definido como seletor no DTO de mídia da conta. PG `_test`: tenant/account/destination, leitor versus autor, reconexão/disconnect, expiração/grant/credencial alterada durante espera, owner+top-level e duas credenciais concorrentes. Regressão OAuth/6E/gestão/scheduler/frontend sem Meta real; seleção explícita de novas suites sem skips obrigatórios.

## 10. Roadmap e decisões sujeitas a aprovação

| Etapa | Dependência / entrega |
| --- | --- |
| **7A** | Gates FB/IG → contratos → transporte/adaptadores → lookups de Page/User token → service → quatro rotas account/publication + duas de mídia IG externa → testes; sem migration ou Analytics UI. |
| **7B** | Após pilotos Facebook/Instagram 7A: migration nova, runs/snapshots para ambos os provedores, coleta assíncrona fora do scheduler, lease/rate limit/backoff, retenção e idempotência. |
| **7C** | Após contratos e snapshots 7B: Analytics/Overview com fonte real, timestamp, séries/gráficos/filtros, estados vazios/sem autorização, troca segura de Workspace. |
| **7D** | Revisão independente de autorização, Graph e concorrência; regressão PG, frontend e 6E/gestão; testes de segurança e compatibilidade. |
| **7E** | Plano manual de deploy/backup, App Review/escopos, migração 7B com compatibilidade de versões, smoke autorizado, rollback de aplicação sem perda de dados. Sem produção nesta auditoria. |

**Decisões humanas/gates:** política de leitura por papel; consentimento incremental de scopes; ads scopes condicionais Business Manager; aprovação da alternativa batch e comprovação de suporte IG; seletor de mídia externa com ownership+top-level; rótulos de produto e retenção7B. Texto/foto já possuem Page Post IDs no código; Reel precisa de objeto/edge próprios. Nenhum gate autoriza automaticamente código, piloto ou produção.

## 11. Não ações desta sessão

Nenhum código de produção, migrations 001–011, escopo OAuth, frontend, banco, servidor Debian, Docker/Compose, segredo, job, publicação Meta, branch, commit ou push foi modificado. Os testes históricos não foram repetidos porque a tarefa é exclusivamente documental. Os documentos devem ser revistos antes de iniciar qualquer implementação 7A.


## 12. Revisão obrigatória de escopo — Instagram incluído na 7A

**Esta seção prevalece sobre qualquer menção residual do plano antigo de que Instagram seria implementado somente em 7B–7E.** A 7A termina com API read-only de **Facebook e Instagram**, ou registra explicitamente bloqueio externo por provedor sem declarar ativação real indevida.

- **OAuth vigente:** reutilizar Instagram API with Facebook Login e a conta `instagram_business` conectada via Page, preservando publicação Meta atual; avaliar Instagram Login como outro projeto, não migrar silenciosamente. No fluxo atual, validar `instagram_manage_insights`, `instagram_basic`, `pages_read_engagement` e `pages_show_list`, com grant e tarefas reais. `read_insights` de Facebook não cobre automaticamente Instagram.
- **Tipos de conta:** Business/Creator profissionais elegíveis conforme documentação e concessões; não prometer conta pessoal.
- **Account Insights:** referências canônicas conferidas Task1: `views/reach/accounts_engaged/total_interactions`, day/total_value inicialmente; `profile_views` não habilitado. User token com expiração própria; não Page token por similaridade com publisher.
- **Media Insights:** `/{ig-media-id}/insights`, candidatas `views`, `reach`, `likes`, `comments`, `saved`, `shares`, `total_interactions`. Tipo feed/reel/carousel/story e `media_product_type` determinam elegibilidade; resultados e limitações mudam por mídia. Nenhum endpoint ou métrica pode ser liberado sem documentação e teste autorizado.
- **Associação:** publisher IG confirmado no código, final media ID persistido quando conhecido, container jamais usado como mídia. Mídia externa requer owner+top-level comprovados sob conta do tenant.
- **HTTP:** acrescentar `GET /insights/instagram/accounts/:socialAccountId` e `GET /insights/instagram/publications/:postPublicationId`, além das duas rotas Facebook. Mesma autenticação/membership/tenant, allowlists separadas e estados honestos.
- **7B:** refinar DDL conceitual acima para ambos os provedores (escopo, FK por tenant+social_account, retenção) **antes** de escrever migration `012`; este SQL permanece não executável como migração final.
- **Verificação:** testes unitários/HTTP/PG separados para Facebook e Instagram, incluindo Page ↔ IG business, papéis, grant ausente, id externo incorreto, tipos de mídia, concorrência e cross-tenant. Não usar Meta real em testes automatizados.
- **Documentação de referência:** [IG Account](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights), [IG Media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) conferidas integralmente Task1. Fontes genéricas ainda usam exemplos antigos; a matriz do relatório Task1 registra precedência, divergências, scope ads condicional e bloqueio de transporte IG. Nenhuma revisão documental habilita automaticamente a implementação.

## 13. Autorização local de 21/10/2026 — repository e service

O pedido humano desta data autoriza somente Tasks4/5 do plano amplo, usando os clients/contratos locais e OAuth opcional já aprovados. A redação histórica “sem implementação” acima descreve a auditoria original; os resultados locais aprovados estão em `docs/meta-insights-local-implementation.md` e no ledger do plano de20/10. Não autoriza rede, HTTP, persistência, jobs ou produção.

Política aprovada: membros ativos owner/admin/member podem ler métricas de contas do próprio Workspace; isso não concede administração de tokens/conexões. Resolver pela sessão completa do leitor e membership atual; autor original/conector não é requisito. Cross-tenant continua inexistente/404 futuro. Tenant/GraphID/token nunca são autoridade vinda de request.

Repository apenas lê e retorna snapshot privado cifrado e associações persistidas; service resolve seleção, valida credencial Page para FB/User para IG, decripta apenas após gates e usa os clients existentes sem transporte concreto. Antes de entregar sucesso ou erro após await, revalidar sessão/conta e conteúdo relevante de token/grants/vínculos/expiração; `updated_at` sozinho não basta. Sem transação aberta durante transporte simulado ou futuro HTTPS.

IG local exige ID final de destino publicado e evidência persistida do próprio fluxo de publicação única; container não é mídia final. Mídia externa permanece sem descoberta/persistência e sem solução top-level; owner ou boolean fornecido pelo caller não habilita consulta. Nenhuma migration nem alteração de publisher/scheduler/OAuth/clients aprovada nesta extensão.

Contratos locais aprovados usam `points[{value,endTime}]`, não o exemplo HTTP escalar histórico. Erros de pré-gate podem ser tipados/sanitizados com disponibilidade explícita, sem inventar valor ou timestamp de consulta externa. `transport_blocked` continua explícito; dados de teste nunca são apresentados como Meta real. Integração/rotas públicas exigem autorização posterior.

## 14. Autorização posterior — Task6 HTTP local (21/10/2026)

Adendo humano22/10/2026 de desbloqueio de regressão: autoriza exclusivamente comparação binária integral equivalente no teste legado `metaMediaDelivery.integration.ts`, com ambos valoresBuffer,comprimento e todosbytes,sem reduzir2MB ou demais verificações/mocks/timeouts. Essa exceção test-only não autoriza alterar produção,OAuth,clients,coordinator/scheduler ou testesCoordinator; os últimos apenas investigação/reprodução. Revalidar gates sequenciais e revisar independentemente o delta; não iniciar Task7/rede/produção.

O pedido humano posterior autoriza implementar somente as quatro rotas GET account/publication Facebook e Instagram da seção5. Não autoriza as duas rotas de descoberta/mídia externa, transporte real, Task7, jobs, dashboard, persistência, migration ou produção. Isso prevalece sobre os escopos históricos mais amplos e as proibições de HTTP das entregas anteriores. Reutilizar integralmente os contratos/clients/repository/service aprovados, sem reimplementar suas regras.

Rotas: `/insights/facebook/accounts/:socialAccountId`, `/insights/facebook/publications/:postPublicationId`, `/insights/instagram/accounts/:socialAccountId`, `/insights/instagram/publications/:postPublicationId`. IDs são UUIDs locais, no último caso sempre destino (`post_publications.id`), nunca Graph ID ou post ID como fallback. Não há rota genérica nem seletor externo nesta Task.

Contrato query: `metrics` opcional, uma única lista separada por vírgulas,1–4 nomes únicos da allowlist, sem nomes vazios/whitespace. Defaults de uma métrica: Page `page_media_view`, Post `post_media_view`, IG Account/Media `views`. `period` opcional: default Page/IG Account `day`, Post/IG Media `lifetime`; validação pelo scope aprovado. IG Account permite `metricType` (`total_value` default ou `time_series` somente com `reach`); demais scopes o rejeitam. Accounts exigem `since` e `until` em datas UTC reais `YYYY-MM-DD`, convertidas em segundos; intervalo `[since,until)`, com `until > since`. Isso corrige a ambiguidade histórica `since <= until` sem mudar o service, que já exige intervalo positivo. Service continua fonte das janelas locais: FB até90dias e histórico até2anos; IG Account últimos90dias, sem futuro. Publications rejeitam datas e metricType. Parâmetros duplicados, desconhecidos, vazios, autoridade/URL/token/version ou GraphIDs são400. Provider/tipo de recurso desconhecido no path é404. Não ecoar valores/nomes arbitrários de parâmetro em erro.

HTTP200 é exatamente `InsightsResponse` aprovado com points, sem wrapper escalar/source/GraphIDs do exemplo antigo. Validar DTO na fronteira; nada de números fake ou campos extras. Erros usam envelope existente `{error:{code,message}}`, com mensagem fixa:

| Caso | HTTP | Código |
| --- | --- | --- |
| UUID inválido |400|invalid_insights_id|
| Query/seleção/intervalo inválido |400|invalid_insights_query|
| Sessão inválida/revogada |401|unauthorized|
| Recurso ausente/cross-tenant |404|insights_not_found|
| Grant/conta desconectada |409|meta_insights_permission_required|
| Token expirado |409|meta_insights_token_expired|
| Objeto não suportado/sem prova |409|meta_insights_unsupported_object|
| Quota |429|meta_insights_rate_limited|
| Transporte bloqueado |503|meta_insights_not_enabled|
| Timeout/abort com conexão ainda utilizável |503|meta_insights_timeout / meta_insights_aborted|
| Provider/erro inesperado/DTO inválido |503|meta_insights_provider_unavailable|

Não inventar Retry-After sem evidência. Dados parciais válidos seguem200 com estados por métrica. Todo namespace Insights recebe no-store/nosniff antes dos checks de Origin; preservar CORS/Vary/cookie/OPTIONS e GET sem Origin existentes. Não alterar política global ou aceitar métodos de mutação (405/Allow GET, OPTIONS para rotas reconhecidas, sujeito aos checks globais existentes).

Composição em `createApiServer`: repository e service reais com cipher existente e clients padrão sem transporte. Única seam nova é `insightsTransportForTests`, injetada explicitamente e recusada fora de `NODE_ENV=test`; index/config nunca a preenchem. Não injetar service/repository fake que contorne autorização. Isso não é config para habilitar rede nem prova de suporte Meta.

Um helper HTTP focado em `server/src/insightsHttp.ts` mantém app mínimo: autentica antes de validar UUID/query, delega ao service, traduz erros por allowlist e nunca loga erro bruto/query/headers. Recebe sendJson existente como dependência, sem duplicar serialização nem importar app criando ciclo. Propagar AbortSignal de request aborted/response close prematuro e remover listeners no finally. Não escrever em resposta destruída, encerrada ou abortada. Não aguardar outro SQL depois da revalidação final do service: validar DTO e enviar sincronamente, sem criar uma nova janela assíncrona após o gate de conta. Nenhuma query de autorização/credencial é duplicada na rota.

Testes HTTP usam servidor local efêmero, sessão opaca real, repository/service/clients reais e apenas transporte Meta fake explícito; PG loopback `_test`, identidade distinta da aplicação e schemas isolados. Cancelamento físico de SQL não é alegado. Migrations001–011 e todos os módulos aprovados permanecem byte-idênticos; package só acrescenta o novo arquivo PG ao seletor (21arquivos). Testes/gates desta Task são novos e sequenciais, não substituídos pelos resultados históricos das Tasks4/5.

## 15. Autorização Task7 — auditoria e preparação documental (22/10/2026)

Somente documentos podem ser modificados nesta execução. Revisar o conjunto OAuth/contratos/clients/repository/service/HTTP e as fontes oficiais atuais, sem repetir suítes aprovadas quando os hashes não mudaram. A autorização não permite corrigir código nem executar piloto. Finding de aplicação que exigir mudança deve ser reportado para aprovação, não implementado silenciosamente.

Entregas: [auditoria final](../../meta-insights-task-7-final-audit.md), [runbook futuro](../../meta-insights-pilot-runbook.md), adendo da [pesquisa](../../meta-insights-api-research-facebook-instagram.md), revisão independente do conjunto e retorno de coerência documental no ledger. O aceite documental requer zero Critical/Important aberto na revisão local, inventário, matrizes de transporte/permissões, bloqueios, smoke e rollout/rollback futuros. Isso **não** torna a rede pronta nem encerra integração Meta real.

O default atual continua sem transporte; conta elegível recebe503meta_insights_not_enabled, sem métricas fake. A flag META_INSIGHTS_OAUTH_ENABLED é defaultoff e controla os dois scopes opcionais, não a rede. Clients/DTO fixam v26.0; produção não foi inspecionada. Os21arquivosPG e DTOpoints são atuais; o DDL7B e as rotas externas históricas não são executáveis/aprovados nesta fatia.

Gates externos atuais: comprovar Batch ou outra alternativa segura **por família** com zero token/proof em URL, esclarecer requisitos condicionais/divergentes IG, confirmar grants/tasks/acesso/MetaAppReview e validar shapes em ativos autorizados. Não inventar header proof nem assumir Page token para IG. Apenas mídia própria com operação/final ID coerentes passa no service; carrossel/child/Story/externos e Facebook Reel permanecem fora da ativação inicial.

Próxima fase exige aprovação humana separada. Nenhuma alteração em001–011, scheduler, credenciais, OAuth real, servidor ou deploy decorre da aprovação documental.

## 16. Task8 — transporte e piloto preparado, não executado (22/10/2026)

**Precedência Task9:** [resultado condicionado de transporte](../../meta-insights-task-9-safe-transport.md) reconfirma o mecanismo Batch genérico, mas não a composição endpoint-específica necessária. A condição para implementar adaptador não foi satisfeita; nenhuma interface/camada produtiva ou flag mudou. F8-1 segue fechado. Experimento isolado futuro requer autorização própria; não injetar rede real em ForTests nem nas rotas públicas. Gates documentais/revisão no ledgerTask9, sem nova aprovação Meta ou7Arealconcluída.

**Adendo posterior Task8.1 — F8-1 FECHADO localmente:** autorização específica permitiu adicionar somente80001 à classificação numérica do core, com RED→GREEN, revisão independente sem findings e gates locais aprovados; o diagnóstico abaixo sem patch é histórico. [Evidências e limitações](../../../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-8-1-report.md). Contratos, autorização, OAuth e bloqueio de transporte não mudam. Não declarar integração real ou piloto liberado.

Autorização atual permite investigar fontes, especificar validação e revisar segurança, nunca ligar rede ou usar credenciais reais. [Relatório técnicoTask8](../../meta-insights-task-8-transport-validation.md) registra comprovação parcial por família, sem adaptador concreto/teste`.ts` novo. Não há evidência suficiente para alterar os clients/repository/service/OAuth aprovados nesta execução.

Regras futuras: token/proof no corpoBatch é mecanismo genérico documentado, não suporte Insightsv26 comprovado. Sem bodyGET interno/headerinventado/POSToverride/segredo naquery. Testes de envelope/innerfailure/nullslot/JSON/paginação/streaming/timeout/grants/tenant são protocolo futuro, não testes aprovados. F8-1: core atual classifica Graph80001 emHTTP400 como provider_unavailable, apesar de quotaPage documentada; corrigir exige autorização separada, RED→GREEN e revisão antes de conectar produto.

Runbook revisado: quatro fichas APage/BPosttexto/CIGAccount/DIGIMAGEprópria, umaInsights porficha/zeroretry, preflight com orçamento/consentimento separados; Reel/fotoexpansão/carrossel/Story/mídiaexterna não iniciam piloto. Nenhum grant solicitado/credencial alterada e nenhuma verificação noDashboard/Meta real. Task8 documental não muda os gates Task7, não conclui7Areal e não autoriza produção.

## 17. Task10E — autorização externa preparada offline (23/10/2026)

Entrega posterior autorizada implementa exclusivamente verificação de assinaturasEd25519 sintéticas, solicitação imutável vinculada ao contexto/ativo/código/prazo/limites e admissão durável porrunUUID. Workspace étenant. Nenhuma chave privada/signer ou trustbootstrapreal é entregue ao executor; PREPARED/READY_FOR_AUTHORIZATION não concedem EXECUTION AUTHORIZED. A composição experimental usa10C/10D sem editar contratos anteriores. Falhas/cancelamento não renovam reserva; filesystem/contexto/hash/DI são fronteiras confiáveis, sem promessa antirrollback/root/sameUID ou zeroização.

[Documento10E](../../meta-insights-task-10e-external-authorization.md),[fechamento e evidências](../../meta-insights-7a-local-closure.md),[plano10E](../plans/2026-10-23-socialflow-meta-insights-10e.md). Aprovação local não habilita aplicativo, MetaOAuth, piloto ou deploy. Continuidade exige configuração de banco exclusivo para repetirPG, bootstrap externo real/identidade/contexto/código aprovados, consentimento e evidênciasMeta separados. As quatro famílias continuam semvalidação real; não inferir compatibilidade deBatch dos testes.
