# SocialFlow 7A — fatia local OAuth e Insights Clients

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Passos RED→GREEN e revisão independente por módulo; nenhum commit.

**Goal:** implementar exclusivamente a fatia local autorizada em 20/10/2026, sem declarar 7A completa.

**Architecture:** OAuth Facebook Login opcional; contratos discriminados e dois adaptadores locais sobre transporte injetável sem implementação HTTP real. Nenhum wiring na API, repository de Insights, service, dashboard ou coletor.

**Tech Stack:** TypeScript/Node 22 strip-only, Vitest, pg existente, sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-10-19-socialflow-meta-insights-design-facebook-instagram.md`; precedência do pedido de execução controlada e do relatório `docs/meta-insights-task-1-security-review.md`.

## Global Constraints

- Base e HEAD inicial: e44b031d194a959e3f4182b246d17525a0ebc09c. Branch feat/socialflow-7a-meta-insights; worktree existente preservado.
- Nenhum commit/push/merge/deploy; nenhuma alteração de migrations 001–011 ou nova migration, scheduler, credenciais reais ou produção. Testes só TEST_DATABASE_URL exclusivo de testes/schema isolado e Meta fake.
- Rede Insights real BLOQUEADA nos dois providers, inclusive se globalThis.fetch existir. Nenhum fallback, transporte batch, header de proof inventado, segredo em query/log/erro/DTO. Transporte injetado somente por código interno confiável, nunca parâmetros HTTP.
- Escopos Insights opcionais não pertencem a requiredPublishingScopes. Facebook Insights usa tokenKind page; Instagram Facebook Login usa tokenKind user. Grants reais, não escopos pedidos e não união de grants revogados.
- Contratos sem tokens, proofs, objetos Graph brutos ou caminhos. Ausência de dado não é zero. IDs/URL/host/versão não são strings arbitrárias do cliente.
- Mídia externa IG requer prova top-level explícita além de owner. Filho não elegível; Reel/formato não comprovado não habilitado por MIME ou owner.
- Implementador não cria subagentes. Controlador fornece revisão independente, sem suítes pesadas concorrentes. Checkpoints substituem commits e são preservados.

## Review Focus

1. Escopo opcional recusado não desativa publicação nem remove tokens válidos (Task 1).
2. Sessão/state expiram durante espera do bloqueio final; relógio deve ser consultado após locks, não só no WHERE antes da espera (Task 1).
3. Zero, dado ausente, malformed e reações mapeadas não são equivalentes (Task 2).
4. Owner IG válido não prova top-level nem formato/REELS elegível; Page token IG recusado (Task 3).
5. Fake pendente/abort/timeout e erro com segredo não acionam fetch global nem vazam o erro original (Tasks 2–3).

## Task 1: OAuth opcional e revalidação final

**Files:** modificar `server/src/metaOAuthClient.ts`, `server/src/config.ts`, se necessário `server/src/metaOAuthService.ts`, `server/src/postgresSocialAccountsRepository.ts` e `server/src/metaOAuthStateRepository.ts`; testes `server/test/metaOAuthClient.test.ts`, `server/test/metaOAuthService.test.ts`, `server/test/metaOAuth.integration.ts`, `server/test/config.test.ts` (ou arquivo de config existente).

**Interfaces:** `MetaOAuthConfig.insightsEnabled?: boolean`; `META_OAUTH_SCOPES` base preservado; `META_INSIGHTS_OAUTH_SCOPES` somente read_insights/instagram_manage_insights. Helper de seleção de scopes compartilhado com metaOAuthRequestedScopes, preservando chamada sem argumento. Config `META_INSIGHTS_OAUTH_ENABLED` default false, parser boolean existente; somente true explícito server-side adiciona os dois scopes, sem input arbitrário do request. Nenhuma mudança no contrato start/callback. Novos grants não necessários para discovery/publicação.

- [x] RED unitário para URL base/default desligado versus opt-in, configuração inválida, grants efetivos parciais/reconexão e preservação de publicação/tokens com Insights recusado; manter testes existentes state inválido/cancelado, troca Workspace, isolamento e callbacks concorrentes.
- [x] VERIFY RED: testes novos falham por ausência da seleção opcional. Não contar caracterização já verde como RED.
- [x] RED PostgreSQL: sessão e request expiram enquanto upsert final espera row lock; provar rejeição e ausência de mutação de tokens/contas. Se state consume também aceitar autoridade expirada durante lock, cobrir e corrigir minimamente dentro do mesmo escopo.
- [x] GREEN: seleção mínima e grants reais; bloquear contexto e consultar relógio atual PostgreSQL DEPOIS da espera antes da mutação, preservando ordem de locks. Não envolver Meta em transaction. Não refatorar publishing.
- [x] VERIFY GREEN: OAuth/config focados e integração OAuth/socialAccounts/credenciais usando schemas isolados, sem skips. Relatório com comandos/contagens/RED real + self-review; revisão independente obrigatória.

## Task 2: Contratos e Facebook Client local

**Files:** criar `shared/insightsContract.ts`, `server/test/insightsContract.test.ts`, `server/src/metaInsightsClient.ts` (núcleo, tipos/erros/transporte), `server/src/facebookInsightsClient.ts`, `server/test/facebookInsightsClient.test.ts`, `server/test/metaInsightsClient.test.ts` se necessário. Teste de contrato em server/test porque o include atual de nenhuma configuração cobre shared/**/*.test.ts; não modificar seletores globais desnecessariamente.

**Interfaces:** exportar tipos discriminados scope facebook_page/facebook_post/instagram_account/instagram_media; períodos day/week/days_28/lifetime; resposta segura com metrics, status available/not_available/unsupported/permission_required/token_expired/rate_limited/provider_unavailable, value número ou mapa de reações validado, ausente null. `MetaInsightsClientError` com code sanitizado (invalid_query, permission_required, token_expired, rate_limited, invalid_response, provider_unavailable, timeout, aborted, transport_blocked, unsupported_object); nenhum raw cause. `InsightsTransport` interno recebe descriptor readonly gerado com graphApiVersion v26.0, host fixo graph.facebook.com, ID validado e parâmetros allowlist; credencial privada discriminada tokenKind page/user não integra DTO. Retorna status HTTP + body unknown. Default sem transporte retorna erro explícito transport_blocked, sem fetch.

Os nomes exatos de funções auxiliares podem seguir o padrão local; registrar assinaturas finais no relatório para Task 3. Limites operacionais internos: máximo 4 métricas distintas/request, 10s timeout default, resposta até 1MiB/1000 datapoints; validação estrita em fixtures. Não inferir envio/aceitação de token/proof na interface abstrata.

Decisão de interface local durante preflight de Task2: resposta `{scope,period,graphApiVersion,fetchedAt,metrics:[{name,status,points:[{value,endTime}]}]}`. Preservar todos os datapoints sem agregação; ausência é not_available com value:null/endTime:null. Esta forma detalha o exemplo escalar da spec para séries; nenhum contrato HTTP público é criado nesta fatia.

**Allowlist mínima FB v26.0:** Page page_media_view/page_total_media_view_unique/page_video_views em day/week/days_28. Post post_media_view/post_total_media_view_unique/post_reactions_by_type_total e reações like/love/wow/haha/sorry/anger total, lifetime; Post sujeito comprovado feed_post, não video/Reel. page_post_engagements/page_follows/post_clicks são fora da seleção, NÃO depreciadas por asterisco. Sem vídeo ID→PagePost inferido. Page requires read_insights/pages_read_engagement/pages_show_list + ANALYZE; credencial Page. Dados de request internos previamente autorizados, não endpoint público.

- [x] RED contratos: scope/period incompatíveis, zero preservado, null ausente, segredo/extra arbitrário não propagado, reações com chaves canônicas (like/love/wow/haha/sorry/anger, care somente se shape comprovado; não inventar soma).
- [x] RED client: allowlist versus métrica depreciada/desconhecida, período/versão/ID inválido e URL absoluta antes do transporte; falta grants/task/tokenKind; vazio, parcial, zero, duplicados/name/period inesperados, malformed values/datas/números; Graph 190/200/4/17/32/613/HTTP429/transient/100 sem segredo; abort/timeout, zero fetch default, concorrência de duas credenciais sem estado global.
- [x] VERIFY RED; implementar mínimo shared/core/adaptador; VERIFY GREEN frontend contrato e server focados, typecheck relevante; revisão independente.

## Task 3: Instagram Client local

**Files:** criar `server/src/instagramInsightsClient.ts`, `server/test/instagramInsightsClient.test.ts`; consumir contratos/core Task 2 sem duplicação de timeout/sanitização.

**Interfaces:** mesmo transporte/core da Task 2. Credencial User; grants instagram_basic/instagram_manage_insights/pages_read_engagement/pages_show_list, Facebook Login apenas. Account period day: views/accounts_engaged/total_interactions total_value; reach total_value ou time_series. Sem breakdown nesta fatia. profile_views/impressions excluídos. Media lifetime, omitir period no descriptor de wire conforme auditoria; views/reach/likes/comments/saved/shares/total_interactions para FEED/REELS elegíveis. IMAGE/VIDEO/CAROUSEL_ALBUM e media_product_type FEED/REELS devem ser coerentes; REELS só VIDEO. STORY fora desta seleção inicial. Pai carrossel exige prova de formato/top-level, filho sempre recusado; owner sozinho não habilita. `formatVerified` e evidência top-level explícitos são gates do objeto interno, não campos de request HTTP. Reel unproven → unsupported_object, não chamada. Todos continuam não validados na Meta real.

- [x] RED Account total_value/time_series reach; tipos/períodos/métricas por objeto; grants/tokenKind divergentes; Media IMAGE/VIDEO/CAROUSEL_ALBUM/REELS, filho/owner/top-level ausente, Reel sem prova; vazios/parciais/zero, response inválida/unexpected period, IG código10 não automaticamente permission_required, 190/429, abort/timeout; ausência de rede real e segredos.
- [x] VERIFY RED; GREEN adaptador específico/parsers; VERIFY GREEN focados; revisão independente; nenhum repository/HTTP novo.

## Task 4: Gates finais e revisão global

- [x] Confirmar TEST_DATABASE_URL exclusivo de testes por nome e identidade distinta do banco da aplicação, sem imprimir segredo. Nunca conectar DATABASE_URL.
- [x] Sequencialmente: OAuth focado; Insights focado; npm run test:frontend; npm run test:server; npm run test:integration (18 arquivos reais, sem skips); npm run build; npm run lint; git diff --check. Registrar logs/contagens nesta execução.
- [x] Verificar Node22 strip-only importação inerte dos clients novos; checksums 11/11 migrations contra HEAD inicial; nenhum scheduler/env real/package/dependência ou aplicação fora do escopo modificada.
- [x] Revisão independente global; Critical/Important → teste RED, correção mínima, revisão de retorno e repetir gates afetados depois da alteração. Minor registrar explicitamente.
- [x] Documentar configuração opcional, contratos locais, limitações do transporte e pendências App Review/grants/piloto. Nada de alegar Meta funcional ou 7A completa. Entregar status IMPLEMENTADO E TESTADO LOCALMENTE / NÃO VALIDADO CONTRA META / BLOQUEADO / NÃO INICIADO. Aguardar autorização futura.
