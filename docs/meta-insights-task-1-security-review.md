# SocialFlow 7A — Task 1: revisão de arquitetura, OAuth e segurança

Data: 2026-10-20. Natureza: auditoria de código e documentação pública, sem implementação e sem chamadas autenticadas à Meta. Base: `/home/davip/Documentos/socialflow-6e-worktree`, branch `fix/scheduled-post-management`, HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c`. Nenhum acesso ao Debian ou banco. A implantação relatada pelo responsável não foi auditada remotamente.

O ambiente local tem Node **22.23.3**, `.env` presente e nenhuma sobreposição local de `META_GRAPH_API_VERSION`: o valor efetivo é o default **v26.0**. Foram impressos somente versão e presença do arquivo, nunca outros valores de ambiente. As referências atuais de IG User/Media também identificam v26.0 como versão mais recente. Nenhuma versão de produção foi lida.

Documentos de trabalho: versões `-facebook-instagram` de pesquisa, design e plano. Os originais Facebook-only foram preservados como histórico. As variantes já existiam como arquivos locais; antes da auditoria, Git mostrava apenas os dois documentos de pesquisa como untracked, pois `docs/superpowers/specs/` e `plans/` são gitignored. Nenhum arquivo rastreado de aplicação/migration apresentava diff.

## 1. Evidência e limites

**CO** = confirmado na documentação oficial; **CC** = confirmado no código; **TR** = pendente de teste real autorizado; **NC** = não confirmado; **B** = bloqueado sob o requisito atual. CO não significa que o app do SocialFlow tenha Advanced Access, que o grant foi concedido ou que uma conta específica retorne dados. Nenhum teste automatizado foi executado, pois a entrega é exclusivamente documental.

Fontes consultadas em 20/10/2026:

- **F1:** [Facebook Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US).
- **F2:** [Facebook Post Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US) e [Post](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/?locale=en_US).
- **F3:** [Depreciações Pages](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics?locale=en_US).
- **I1:** [Instagram Insights, Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/insights/?locale=en_US).
- **I2:** [Instagram Account Insights — referência canônica atual](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights).
- **I3:** [Instagram Media Insights — referência canônica atual](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights).
- **I4:** [Instagram Media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media) e [IG User /media](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media).
- **I5:** [Instagram overview](https://developers.facebook.com/documentation/instagram-platform/overview).
- **P1:** [read_insights](https://developers.facebook.com/docs/permissions/reference/read_insights?locale=en_US) e [instagram_manage_insights](https://developers.facebook.com/docs/permissions/reference/instagram_manage_insights?locale=en_US).
- **T1:** [Secure Graph API Calls](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US).
- **T2:** [Graph Batch Requests](https://developers.facebook.com/docs/graph-api/making-multiple-requests/?locale=en_US).
- **T3:** [Graph rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/?locale=en_US).

O navegador de pesquisa não conseguiu abrir várias páginas; leitura pública por HTTPS/curl retornou o corpo oficial. As duas URLs antigas de referência IG User/Media renderizaram shell vazio; as referências canônicas I2/I3, ligadas pelo guia oficial I1 e pelo índice oficial `https://developers.facebook.com/documentation/instagram-platform/llms.txt`, retornaram conteúdo completo. Isso não equivale a teste da API.

## 2. OAuth, credenciais e fluxo atual (CC)

```
POST /auth/meta/start, sessão + JSON {}
  → app.ts → AuthService.require → user/tenant/membership/session
  → MetaOAuthService.start: 32 bytes aleatórios, base64url; hash SHA-256 no DB
  → oauth_authorization_requests: sessão + membership + expiração, single-use
  → Facebook OAuth com scopes fixos atuais
  → callback exige cookie/sessão → consume state atomicamente
  → code → user token → user token de longa duração
  → /me + /me/permissions → somente grants status=granted
  → /me/accounts → Pages + Page tokens + tasks + instagram_business_account
  → perfil IG confirmado com Page token e instagram_basic/pages_read_engagement
  → upsert transacional tenant-safe: user token na conexão, Page token na conta
```

| Arquivo / referência | Constatação |
| --- | --- |
| `server/src/app.ts:527` | Start não aceita tenant/scopes/author do cliente; callback exige sessão e não devolve code/state/token no redirect público. |
| `server/src/metaOAuthService.ts` | State de 43 caracteres, TTL configurável; `uniqueGrantedScopes` guarda somente grants reais. `pages_show_list` obrigatório para descoberta; novos Insights scopes não são requisitos atuais. |
| `server/src/metaOAuthStateRepository.ts` | Create/consume associados à sessão/membership, usuário ativo e validade; consume via UPDATE condicional impede replay. Workspace switch revoga a sessão antiga. |
| `server/src/metaOAuthClient.ts:3` | Scopes: `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `pages_manage_posts`, `instagram_content_publish`. Ausentes `read_insights`, `instagram_manage_insights`, ads scopes. |
| `server/src/metaOAuthClient.ts:listPages` | Descoberta paginada por cursor, máximo 20 páginas/200 contas; não segue cegamente `paging.next`. Perfil IG exige ID igual ao esperado. Não persiste subtipo Business/Creator. |
| `server/src/metaOAuthClient.ts:graphGet` | Token em Bearer header; `appsecret_proof` na query. É evidência de implementação, não confirmação oficial de proof em header nem conformidade com nova exigência de zero proof em URLs. Erros são sanitizados, redirects rejeitados. |
| `server/src/socialTokenCrypto.ts` | AES-256-GCM, chave 32 bytes, nonce aleatório 12 bytes, tag 16, AAD constante versionada, payload v1. AAD não vincula tenant; isolamento depende também das relações/queries. Nenhuma necessidade de mudar crypto na 7A. |
| `server/migrations/005_add_social_accounts.sql` | `oauth_connections`: user token e expiração; `social_account_credentials`: Page token por conta. Todas as relações de conta/credencial usam tenant composto. Grants são connection-wide. |
| `server/src/postgresSocialAccountsRepository.ts:556` | Reconexão mantém IDs por unicidade `(tenant,account_type,external_id)`; troca tokens/grants/metadados, reativa conta e limpa disconnected_at. Não faz união de grants antigos com novos. |
| Mesmo arquivo, `disconnect:829` | Transaction bloqueia conexão compartilhada, inativa conta e apaga tokens da conta. Só apaga user token/revoga conexão quando nenhuma conta ativa resta. Conta IG desconectada deve continuar barrada em Insights mesmo se user token compartilhado ainda existir. |
| `server/src/authService.ts:authenticate/selectWorkspace` | Cookie opaco é hasheado; sessão vinculada a membership, usuário ativo e expiração. Troca de Workspace rotaciona sessão. `postsContext.ts` perde sessionId/membershipId; não deve ser contexto de Insights que precisa revalidar sessão. |

O lookup existente `findMetaPublishingCredential` usa tenant + usuário/autor e entrega **Page token**, grants e tasks; não tem autoridade suficiente para o novo contexto completo de sessão. Publishing resolve autor a partir do Post persistido. Insights deve autorizar o **leitor da sessão atual**, usando a conexão associada à conta e o tipo de token exigido pelo endpoint. Não alterar o comportamento do publisher para servir Analytics.

## 3. Matriz de permissões e tokens

| Provider | Endpoint | Escopos | Token documentado | Requisitos da conta | App Review / acesso | Evidência / situação |
| --- | --- | --- | --- | --- | --- | --- |
| Facebook | `/{page-id}/insights` | `read_insights`, `pages_read_engagement`; `pages_show_list` dependência de grant/descoberta | Page Access Token | Page; emissor com task `ANALYZE`; limiares F1 | Standard restrito a ativos/usuários elegíveis; terceiros exigem acesso/aprovação aplicáveis; Business Verification para Advanced Access segundo P1 | **CO F1/P1**, CC Page token disponível; novo grant ausente no pedido; **TR** |
| Facebook | `/{post-id}/insights` | Mesma base Page Insights | Page Access Token da Page dona do Post | Page Post associado ao destino, tenant e Page | Mesmos gates; publicar não concede Insights | **CO F1/F2/P1**; associação texto/foto **CC**, dados **TR** |
| Instagram Facebook Login | `/{ig-user-id}/insights` | `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`; `pages_show_list` dependência P1 | **Facebook User Access Token** | Business/Creator ligado a Page, usuário Meta com acesso ao ativo | I1/I5: Standard para próprios/geridos adicionados à app; Advanced para terceiros. P1: App Review/Business Verification | **CO I1/I2/P1**; user token persistido **CC**, lookup Insights ausente; **TR** |
| Instagram Facebook Login | `/{ig-media-id}/insights` | Mesma base de IG Insights | **Facebook User Access Token** | Mídia da conta profissional autorizada; regras por formato | Mesmo gate; não usar permissão de publicação como substituto | **CO I3**, IG published media ID persistido **CC**; **TR** |
| Instagram Facebook Login, atribuição via Business Manager | Ambos Insights IG | I1/I2/I3 dizem também `ads_management` **e** `ads_read` no cenário condicional descrito | User token do concedente, não Page token inferido | Confirmar como o usuário Meta recebeu papel na Page | Não ampliar automaticamente; decisão de acesso/review separada | **CO condição**, aplicabilidade no SocialFlow **NC/B** até confirmação; queries atuais não identificam origem da atribuição |
| Instagram Facebook Login | `/{ig-user-id}/media`, `/{ig-media-id}?fields=owner,...` | Base de leitura IG; referências I4 divergem nos ads scopes condicionais (`ads_management`/`business_management` no /media; `ads_management`/`ads_read` no nó) | User token | Provar conta dona, não Business Discovery ou username | Gate de leitura distinto; não adicionar business/ads scopes com base em inferência | **CO I4** com divergência, implementação de leitura **TR/B** |

`instagram_business_manage_insights` pertence ao fluxo Instagram Login; **não pedir** nesta arquitetura. I5 aceita genericamente User ou Page token para Facebook Login, porém **I2/I3 especificam User token para Insights**. Escolher o requisito mais específico. O token certo já está criptografado na conexão; não há necessidade justificada de migration ou migração para Instagram Login.

## 4. Matrizes de métricas

Todas as linhas são para v26.0 conforme referências F1/F2 e I2/I3 consultadas. CO é suporte documental; cada combinação precisa de fixture e teste isolado antes de ativação externa. Métrica disponível com valor zero é diferente de dado ausente.

### Facebook Page — F1

Endpoint `/{page-id}/insights`; autorização da primeira linha da matriz de permissões; `metric` obrigatório, `period` da tabela; `since/until` limitados à janela de até 90 dias, histórico máximo documentado de dois anos. Resposta `data[].values[]` com valores e datas de referência. A maioria atualiza em cerca de 24h; Page Insights documenta mínimo de 100 likes. Não usar um endpoint antigo de fans para presumir elegibilidade.

| Métrica | Período | Objeto/formato | Tipo e semântica | Disponibilidade / evidência pendente |
| --- | --- | --- | --- | --- |
| `page_media_view` | day/week/days_28 | Page/conteúdo agregado | contagem de exibições/reproduções; não equivaler a impressões antigas | CO F1, **TR** |
| `page_total_media_view_unique` | day/week/days_28 | Page | visualizadores únicos; não somar períodos sobrepostos ou chamar de alcance legado sem qualificar | CO F1, **TR** |
| `page_video_views` | day/week/days_28 | vídeos da Page | views de pelo menos 3s ou quase todo vídeo curto; cobertura de Reel não comprovada | CO F1, **TR** por formato |
| `page_post_engagements` | day/week/days_28 | Page/posts agregados | eventos de interação; `*` significa refresh intradiário, não depreciação | CO F1, TR; opcional fora da allowlist inicial mínima |
| `page_follows` | day | Page | estoque líquido de seguidores, não novos follows; `*` não implica remoção | CO F1/F3 (alternativa a page_fans), TR; opcional |

### Facebook Post — F1/F2

Endpoint `/{post-id}/insights`; Page token e grants acima; `metric` obrigatório e período lifetime salvo vídeo. Só destino Facebook published com Page/ID válidos; sem associação não executar Graph.

| Métrica | Período | Tipo de resposta | Formato / limitações | Situação |
| --- | --- | --- | --- | --- |
| `post_media_view` | lifetime | contagem em values | Page Post de texto/foto; Reel/video precisa de objeto próprio comprovado | CO F1, **TR** |
| `post_total_media_view_unique` | lifetime | contagem em values | único por Post; não somar para obter pessoas únicas da Page | CO F1, **TR** |
| `post_reactions_by_type_total` | lifetime | mapa de tipos | não inferir cardinalidade/contar duas vezes categorias | CO F1, **TR** |
| `post_reactions_like_total`, `post_reactions_love_total`, `post_reactions_wow_total`, `post_reactions_haha_total`, `post_reactions_sorry_total`, `post_reactions_anger_total` | lifetime | número por tipo | like inclui care segundo F1; sem mapear campo de objeto para Insights | CO F1, **TR** |
| `post_video_views`, `post_video_view_time` | lifetime/day | contagem / tempo em ms | ID de vídeo/Reel e cobertura precisam de prova; fora da primeira allowlist de Page Post | CO nomes F1, **NC** equivalência do ID |
| `post_clicks`, `post_clicks_by_type` | lifetime | contagem / mapa de tipos | clique em qualquer parte, não necessariamente link; asterisco não significa depreciação | CO F1, TR; opcional fora da primeira allowlist |

**Correção A10 da pesquisa anterior:** F1 explica que `*` indica métrica atualizada várias vezes ao dia; **não** é símbolo de depreciação. Portanto page_post_engagements/page_follows/post_clicks não foram comprovadas removidas por essa marca e aparecem acima como candidatas documentadas. Excluir somente nomes explicitamente removidos (famílias antigas de impressões em F3, vídeo unique removido acima v25 etc.) ou semanticamente indefinidos (`page_daily_follows` aparece “Not defined”). F1/F3 divergem em datas de remoção, não na semântica do asterisco. Reels não têm interações incluídas em todas as métricas de Page. Comentários/shares são edges/campos de Post, não métricas Insights equivalentes.

### Instagram Professional Account — I2

Endpoint `/{ig-user-id}/insights`, User token e grants IG. v26.0; `metric`, `period=day`; `metric_type` conforme linha. `since/until` são Unix timestamps UTC; sem intervalo, fonte diz últimas 24h. Dados de User armazenados até 90 dias (I1), cálculo pode atrasar até 48h (I2); não aplicar histórico Facebook de dois anos a conta IG. A exigência de 100 seguidores é **por métrica**, não bloqueio global de reach/views.

| Métrica | metric_type | breakdown documentado | Resposta / formatos | Estado |
| --- | --- | --- | --- | --- |
| `views` | total_value | follower_type, media_product_type | total_value.value; conta agrega posts/Reels/Stories; métrica em desenvolvimento | **CO I2**, TR; primeiro MVP sem breakdown |
| `reach` | total_value ou time_series | media_product_type, follow_type | total_value.value ou série; estimada; não somar únicos ao longo do tempo | **CO I2**, TR |
| `accounts_engaged` | total_value | nenhum | número de contas com interação; inclui ads, estimada | **CO I2**, TR |
| `total_interactions` | total_value | media_product_type | total de eventos de interação; não equivale a contas únicas, inclui conteúdo impulsionado | **CO I2**, TR |
| `likes`, `comments`, `shares` | total_value | media_product_type | contagens de conta (não de mídia individual) | **CO I2**, candidatas fora do conjunto inicial mínimo |
| `profile_views` | não definido na tabela atual | — | aparece no exemplo antigo I1, mas ausente da lista atual I2 | **NC/B**; excluir da allowlist |
| `impressions` | antigo | — | I2 marca removido v22+ / todas versões desde 21/04/2025 | **CO remoção**, excluída |

I2 usa `follower_type` para views e `follow_type` para reach; não padronizar esses parâmetros por similaridade. A tabela de resposta menciona `total_values` em alguns textos, mas o enum/exemplo usa `total_value`; adotar somente valor do enum e teste de wire. Demografia, follower_count/online_followers e seus limiares não entram no MVP.

### Instagram Media — I3/I4

Endpoint `/{ig-media-id}/insights`, User token e grants IG; `metric` obrigatório. A tabela de parâmetros lista vários períodos, mas a seção de resposta diz **lifetime fixo**: no MVP omitir `period` no wire e validar resposta lifetime; não oferecer intervalos customizados para mídia. Essa divergência documental exige teste de fixture/piloto antes de expandir. Dados de mídia até dois anos; atraso até 48h; Stories até 24h.

| Métrica | Produto de mídia documentado | Tipo de valor | Limitações / situação |
| --- | --- | --- | --- |
| `views` | FEED/REELS/STORY | values[].value / lifetime | exibições orgânicas IG, não ads/total cross-surface; em desenvolvimento; CO I3/TR |
| `reach` | FEED/REELS/STORY | contagem lifetime | únicos estimados; CO I3/TR |
| `likes`, `comments` | FEED/REELS | contagem lifetime | não Story; campos like_count/comments_count são outra fonte; CO I3/TR |
| `saved` | FEED/REELS | contagem lifetime | no nível conta o nome é `saves`, não `saved`; CO I3/TR |
| `shares`, `total_interactions` | FEED/REELS/STORY | contagem lifetime | resposta/semântica por formato; total_interactions em desenvolvimento; CO I3/TR |
| `accounts_engaged`, `profile_views` | não listados em I3 | — | não copiar métricas de conta para mídia; **NC/B** |
| `impressions` | FEED/STORY legado | antigo | I3 restringe por criação anterior a 02/07/2024; não habilitar em MVP moderno |

Imagem e vídeo de feed se distinguem por `media_type=IMAGE/VIDEO`; Reel usa `media_product_type=REELS`. `CAROUSEL_ALBUM` é pai; Insights dos **filhos** do álbum não são suportados. Não prometer métricas individuais dos filhos nem implementar publicação de carrossel. Stories exigem edge `/stories` (não `/media`), expiram rápido e podem retornar código 10 por audiência insuficiente (<5); isso **não prova falta de permissão**. No MVP propor FEED imagem + REELS; carrossel pai/Story permanecem estudados, mas desabilitados até teste por formato e aprovação.

I3 diferencia `comments/likes/views/total_interactions` orgânicos de `total_comments/total_likes/total_views`, que podem incluir ads e outras superfícies (estes últimos específicos Facebook Login). Não somar nem renomear como equivalentes. O guia I1 e o exemplo de conta ainda usam nomes antigos; prevalece a referência de endpoint.

## 5. IDs e prova de associação (CC + I4)

| Identificador | Origem real | Uso proposto |
| --- | --- | --- |
| UUID Post/destino/conta | PostgreSQL | seleção local, sempre por tenant; não é Graph ID |
| Facebook feed post ID | resposta `/feed.id` | candidato direto `/post-id/insights`, validar Page dona |
| Facebook foto | client atual lê **`post_id`** da resposta `/photos`, em `metaPublishingClient.ts:request` | já guarda Page Post ID, não photo.id; texto e foto podem seguir mesma edge; documentos anteriores estavam errados |
| Facebook Reel | `/video_reels.video_id`, checkpoint e provider_post_id na conclusão | não presumir equivalência com Page Post; NC para Post Insights |
| IG professional account ID | Page.instagram_business_account → perfil confirmado | conta IG em social_accounts.external_account_id; metadata.pageId é vínculo observado, não grant novo |
| IG container ID | createInstagramContainer.id / publication_operations.external_id | **não** usar como ID de mídia publicada |
| IG media ID | media_publish.id → post_publications.provider_post_id | candidato direto `/{ig-media-id}/insights`; status published e prova de conta continuam exigidos |
| IG published sem ID recuperável | recuperação container PUBLISHED → provider_post_id null | unavailable/unsupported; nunca usar container ID nem reconstruir por legenda/data |

A publicação IG **já está implementada**: `InstagramPublishingService`, `MetaPublishingDispatcher`, scheduler compartilhado e persistência de final media ID. A hipótese dos documentos de que poderia ainda não existir foi resolvida por código; smoke externo continua não realizado.

Mídia IG não criada no SocialFlow: I4 documenta `/{ig-user-id}/media` (até 10 mil recentes, paginação temporal, sem Stories) e campo `owner` no nó. Proposta mínima sem schema/crypto novos: listar sob UUID local da conta e permitir um ID externo **como seletor subordinado**, jamais como autoridade; antes de Insights ler `id,owner,media_type,media_product_type` com a credencial autorizada e exigir `owner.id === external_account_id` da conta do tenant. Esses campos provam somente parte da elegibilidade: **não distinguem positivamente um IMAGE/FEED top-level de filho de carrossel**. Exigir prova adicional de objeto top-level (p.ex. associação em `/media` se a semântica top-level for confirmada oficialmente/testada), além de ownership atual; sem prova, bloquear o subconjunto e não inferir “não é filho” de `media_type !== CAROUSEL_ALBUM`. Owner ausente/divergente/collab não comprovada → 404; formato/top-level não comprovado → unsupported sem Insights. Não aceitar username como prova. `/media` listado anteriormente não substitui a revalidação no request seguinte. Essa escolha precisa ser aprovada porque os documentos antigos proibiam qualquer ID externo no request.

## 6. Token e appsecret_proof: resultado da investigação

T1 confirma HMAC-SHA256(token, app secret), TLS e mostra **formulário POST Graph batch** com `access_token`, `appsecret_proof` e subrequests `method=GET`, `relative_url`. T2 documenta o envelope batch, token fallback no nível superior, respostas individuais e contagem de quota por subrequest. Isso é uma alternativa oficial para manter token/prova no **body**, sem inventar header de proof. A operação de negócio continua leitura; somente GETs internos em allowlist. A URL externa fixa não contém segredo.

Restrições propostas: um token/tenant/conta por envelope; nunca batch multi-tenant; tamanho um subrequest inicialmente; validar outer HTTP e inner `code/body`; aceitar somente relative path gerado pelo servidor, sem access_token/proof na relative_url; redirects bloqueados; resposta/cursors regenerados por allowlist, nunca seguir/logar `paging.next` bruto; timeout/AbortSignal/limite de corpo. Não tratar POST batch como autorização para criar conteúdo.

**O que não foi confirmado:** transporte de token **e** proof em headers de uma GET direta de Insights; header arbitrário `X-Appsecret-Proof` não foi documentado. O OAuth/publisher existentes usam Bearer + proof na URL, mas isso não resolve a exigência mais forte da 7A. Também não foi localizada confirmação específica de batch para **Instagram Insights** nas referências I1–I5. Portanto: Facebook tem alternativa batch documentada genericamente para Graph (TR por edge); **rede IG sob política zero-segredo-em-URL fica B** até fonte oficial explícita ou piloto isolado autorizado confirmar a combinação. Não alegar que o suporte genérico prova uma exceção específica desconhecida. Nenhuma chamada foi feita para testar.

## 7. Incremento OAuth compatível

O schema atual pode guardar os dois grants adicionais e User token. Alteração mínima futura, após aprovação: pedir `read_insights` + `instagram_manage_insights` em ação explícita de habilitar métricas/reconectar, preservando Facebook Login e scopes existentes. Não pedir `instagram_business_manage_insights`; não acrescentar ads/business scopes sem decisão sobre cenário Business Manager. Publicação continua verificando só `requiredPublishingScopes` atuais; nenhum novo escopo vira requisito de connected ou de publicar.

Não forçar logout, apagar tokens, invalidar contas conectadas ou exigir reconexão automática. Callback que conserva grants básicos e não concede Insights mantém publicação e retorna capability `permission_required` apenas para métricas. Guardar o conjunto **real** de `/me/permissions`, não união com grants antigos (que poderiam ter sido revogados). Discovery não pode passar a filtrar contas por Insights grants, pois `upsertMetaAuthorization` desativa contas ausentes da descoberta. Cancelamento/erro antes do upsert preserva banco atual. Revogação real de grant básico deve ser reportada honestamente, não mascarada para fingir compatibilidade.

O start atual aceita `{}` e usa scopes fixos. Para minimizar interface, reaproveitar start/callback depois de definir política de scopes server-side. Pedido seletivo por propósito/scopo exigiria desenho adicional e state vinculado ao propósito; não aceitar lista arbitrária do frontend. Reautorização de scopes recusados pode requerer fluxo rerequest oficial; confirmar esse detalhe antes de desenhar novo parâmetro. Nenhuma dessas alterações foi aplicada.

## 8. Arquitetura mínima recomendada

```
GET /insights/{facebook|instagram}/... (IDs locais; IG externo apenas sob conta)
  → AuthService.require: sessão/membership/tenant/ator
  → InsightsRepository: joins tenant+conta+destino; conta ativa; concessões
      Facebook → Page token da credencial da conta
      Instagram → User token da oauth_connection vinculada
  → InsightsService: capability por endpoint + versão de autoridade capturada
  → MetaInsightsClient
      transporte Graph read-only (batch se aprovado/documentado)
      adaptador FB Page/Post ou IG Account/Media: whitelist, params, parser
  → revalidar sessão/membership + conexão/conta + credencial/grants atualizados
  → DTO tipado, Cache-Control: no-store; valor ausente=null
```

Um núcleo pequeno de transporte HTTP (timeout, host, proof, envelope/erro sanitizado) e adaptadores/funções por família bastam. Não extrair/reconfigurar os clients de publicação/OAuth em refactor amplo. Parser Facebook values e parser IG total_value/time_series têm contratos diferentes. Cache futuro precisa de tenant, conta, conexão/revisão, principal do token, métricas, escopo/período e versão Graph.

Repository deve receber `AuthContext` completo ou identidade de leitura equivalente (sessionId,membershipId,userId,tenantId); nenhuma autoridade de `authorUserId` do cliente. Retornar credencial privada discriminada `{tokenKind:'page'|'user', encryptedToken, expiresAt, connectionId, scopes, tasks, authorityRevision}`. A revisão privada deve revalidar o snapshot de autoridade, incluindo ciphertext capturado, conexão/conta, grants e expiração (comparação SQL ou fingerprint interno equivalente), **não apenas updated_at**, que não é contador de versão garantido. Não retornar/logar ciphertext ou fingerprint. Para IG, verificar **expiração do User token** mesmo que Page token da conta tenha expiresAt null. Antes de responder, se autoridade mudou, descartar dados e exigir nova consulta, sem reuso automático de token antigo. Não manter transaction/row lock no await HTTP. Falha/expiração específica de Insights não altera status/grants globais nem invalida Page tokens de publicação automaticamente.

Rotas mínimas propostas: quatro account/publication endpoints das variantes, mais `GET /insights/instagram/accounts/:id/media` e `GET /insights/instagram/accounts/:id/media/:mediaId` para mídia externa. `mediaId` numérico limitado é seletor, com ownership revalidada server-side; 404 uniforme para mídia de outra conta. Não haveria migration na 7A. No 7B, o esboço atual precisa mudar: exige post_publication para instagram_media e por isso **não representa mídia externa**; refazer sujeito provider/conta/mídia, preservando FK por tenant, em futura migration posterior à 011.

## 9. Cenários de segurança e testes propostos

| Cenário | Comportamento obrigatório / teste RED→GREEN |
| --- | --- |
| Conta de outro Workspace | Lookup tenant+ID → 404, zero decriptação e Graph calls; repetir com UUID existente/inexistente. |
| Troca Workspace durante Graph | Sessão antiga rotacionada/inválida → descartar resultado; frontend generation/AbortSignal também ignora; nenhum store novo recebe resposta antiga. |
| Sessão expira/membership revogado | Revalidar relógio atual no DB e relações antes de resposta; 401; não reaproveitar autorização capturada no início. |
| Conta desconectada | Mesmo com conexão compartilhada ativa, account.is_active/disconnected_at bloqueiam; se durante Graph, descartar resposta. |
| Credencial renovada durante consulta | Snapshot mudou → descartar sem cachear, inclusive fixture com updated_at igual mas ciphertext/grants diferentes; próxima consulta usa token novo/proof correspondente. |
| Publicação de outro tenant | Join post/destination/account tenant-safe → 404 antes de obter token. |
| Mídia IG de outra conta / filho de carrossel | Tamper de mediaId; owner não coincide/ausente → 404. Filho com mesmo owner + IMAGE/FEED não pode disparar Insights sem prova top-level independente. |
| Leitor não é autor | Leitor válido de outro membro consulta conforme papel aprovado; leitor inválido é recusado mesmo se o autor persistido continua válido. Não usar o contexto de publishing para dar autoridade à leitura. |
| Duas credenciais concorrentes | Requests/envelopes imutáveis isolados; prova de A nunca enviada com token B; sem headers/globais mutáveis. |
| Graph ID isolado/URL arbitrária | Rotas não aceitam autoridade externa; media selector só sob conta com owner proof. Reject absolute URL, traversal e ids malformados. |
| Token/proof em erro/cursor | Canary secrets em fixtures nunca surgem no body/log/URL/request diagnostic; nested batch error e paging.next sanitizados. |
| Scopes novos recusados | OAuth persistido com base grants intactos mantém publicação texto/foto/Reel/IG; Insights permission_required; nenhuma exclusão/recriação de contas. |
| Datas/tipos | FB 2yr/90d, IG account 90d retenção e atraso48h, IG media lifetime/Story24h; nenhuma regra global comum incorreta. |
| Métricas | Zero real preservado; array vazio=null/unavailable; profile_views/impressions IG excluídos; formato sem métrica não cai em zero. |
| Código IG10 de audiência | Não classificar como grant recusado só pelo número; use contexto/erro seguro sem exigir novas permissões indevidas. |

Usar Vitest/fetch fake; PG só `TEST_DATABASE_URL` exclusivo de testes, schemas isolados. Novos testes de repository/HTTP devem entrar no script de integração explícito (hoje 18 arquivos), sem skips obrigatórios. Regressões: OAuth/state, SocialAccounts/disconnect/reconnect, Facebook texto/foto/Reel, Instagram image/Reel, publisher scheduler/leases, edição/cancelamento, mídia privada e sessão/Workspace. Nenhum test cria conteúdo Meta real.

## 10. Findings, severidade e rulings

**Critical:** nenhum vazamento/exploit confirmado nesta auditoria estática. Isso não é certificação de ausência de falhas nem smoke em produção.

| ID | Severidade | Evidência / impacto | Tratamento documental |
| --- | --- | --- | --- |
| A1 | Important | Variantes ainda vinculavam spec/research Facebook-only; SQL e regras de janela/autor eram genéricos | Corrigir links/escopo; relatório por endpoint prevalece; não usar DDL 7B atual como pronto |
| A2 | Important | Docs diziam foto.id; código grava photos.post_id. IG publisher e final IDs já existem | Corrigir associações; foto não é excluída por ID errado; container nunca vira mídia |
| A3 | Important | Lookup sugerido não discriminava User token IG vs Page token FB | Novo lookup por endpoint, expiração/revisão da conexão; sem migration nem reutilização cega de publisher |
| A4 | Important / bloqueante de rede | Proof header direto não documentado; IG batch específico ainda NC | Não liberar rede IG; batch Graph é proposta documentada, suporte específico sujeito a confirmação |
| A5 | Important | OAuth troca grants connection-wide e reconcilia contas; novo gate indevido poderia quebrar publicação | Scopes Insights opcionais, sem filtro novo de discovery, grants reais sem união falsa; testes regressivos |
| A6 | Important | Regras Facebook 2yr/90d não se aplicam a IG account/Story; métricas guide antigas divergem de referência | Allowlist/params/parser por endpoint, excluir profile_views; erro10 por audiência não é automaticamente autorização |
| A7 | Important (risco a reproduzir) | lockMetaAuthorizationContextWith usa now() transacional e bloqueia sessão/request; expiração enquanto espera lock pode não usar relógio atualizado | Antes de alterar OAuth, teste concorrente com expiração durante wait; revalidar clock_timestamp após lock se RED provar. Não corrigir código nesta auditoria |
| A8 | Important | DDL 7B exige destino para toda instagram_media; não serve mídia externa obrigatória | Não executar DDL; revisar subject/mapping em 7B antes da migration nova |
| A9 | Important (review independente) | owner/media_type não distinguem filho IMAGE/FEED de mídia top-level | Gate separado de prova top-level; se não comprovável, bloquear subconjunto; fixture explícita de filho com owner válido |
| A10 | Important (erro documental anterior) | Auditoria anterior tomou `*` de refresh intradiário como sinal de depreciação | Nota explícita de F1 corrigiu classificação; page_post_engagements/page_follows/post_clicks documentadas candidatas, exclusões só por evidência própria/allowlist escolhida |
| M1 | Minor | AAD constante, payload sem key-id/tenant; não prova isolamento criptográfico entre linhas | Hardening/rotação como trabalho separado; FKs/queries são a barreira atual |
| M2 | Minor | Scripts de integração explicitam arquivos; novas suites poderiam ficar fora | Plano exige atualizar seleção explícita e verificar zero skips relevantes |
| M3 | Minor | `instagram_business` não distingue Creator no DB | Não prometer subtipo detectado; validar elegibilidade via retorno oficial antes de consultar |

A7 é hipótese de concorrência fundamentada no código, ainda sem reprodução autorizada; não declarar defeito explorável confirmado. A4 é bloqueio de evidência/compatibilidade de rede, não incidente de credencial. Nenhuma aplicação corrigida nesta sessão.

## 11. Arquivos previstos e gates de liberação

Mudanças futuras mínimas: `metaOAuthClient.ts` (escopos server-side opcionais), `metaOAuthService.ts` (grants/capabilities sem regressão); lookup novo em `insightsRepository.ts` ou helper privado do repo de contas; `metaInsightsClient.ts` com transporte injetável + adaptadores FB/IG focados; `insightsService.ts`; `shared/insightsContract.ts`; wiring limitado `app.ts`; testes unitários/PG/HTTP; seleção explícita no package.json quando novas suites forem criadas. Evitar alterar scheduler, schemas 001–011, publicação, crypto ou DTOs Post.

Dependências externas: aprovação/acesso Meta, disponibilidade dos endpoints/versão, concessão do usuário e acesso aos ativos. Não confundir App Review concedido no Dashboard com scopes devolvidos por /me/permissions. Ambos precisam de evidência.

Para liberar OAuth + Client: aprovação humana deste escopo, política de leitura owner/admin/member, estratégia de grants opcionais, solução de transporte compatível por endpoint, regra de mídia externa/top-level e testes A7. Para habilitar dados reais: App Review/Advanced Access conforme uso, grants, token correto, ownership e smoke isolado separado autorizado. Sem grants, integração local deve responder permission_required, sem quebrar publicação e sem afirmar acesso real.

Revisão independente realizada por `/root/review_7a_task1`, GPT-6 Astra / High, usando `requesting-code-review`: fatos centrais confirmados; 0 Critical, 1 Important documental inicial (A9) e 1 Minor de cobertura leitor/autor. Retorno encontrou ainda a contradição Important entre proibir ID externo no DTO e permitir seletor subordinado, além de Minor no handoff que repetiria Task1. Todos foram corrigidos. A10 foi identificado pelo auditor e conferido pelo reviewer na nota oficial local. **Revisão final de retorno: nenhuma contradição material remanescente nos trechos conferidos.** O reviewer não alterou arquivos, não executou testes/rede autenticada e não revisou produção. Coerência documental aprovada não elimina gates externos, prova top-level ou autorização humana.

## 12. Matriz final e conclusão

| Gate | Facebook | Instagram | Evidência | Situação |
| --- | --- | --- | --- | --- |
| Documentação | Page/Post v26 lidos; deprecações divergentes registradas | Referências canônicas User/Media lidas, guia antigo corrigido | F1–F3, I1–I5, 20/10/2026 | CO; divergências limitam combinações |
| Escopos | read_insights ausente | instagram_manage_insights ausente; ads condicional NC no caso real | P1 + META_OAUTH_SCOPES | Pedido futuro depende de aprovação; TR grants |
| OAuth | State/sessão/grants/upsert existentes | Facebook Login e descoberta IG existentes | metaOAuth*.ts, postgresSocialAccountsRepository.ts | CC; incremental/A7 exigem testes futuros |
| Token/proof | Page token; batch Graph documentado genericamente | User token; headers diretos/batch específico Insights não comprovados | T1/T2 + I2/I3 | FB proposta com TR; IG rede B |
| IDs externos | Feed/foto post_id CC; Reel video não equivalente | media_publish.id CC; owner proof para mídia externa planejado | clients/services + I4 | Mapeamento definido; ownership TR |
| Allowlist | Page/Post com nomes atuais, sem depreciados | Account day/total_value; Media lifetime por formato; profile_views excluído | F1, I2/I3 | CO candidata; TR por combinação |
| Segurança tenant | FK/queries existentes reutilizáveis; lookup sessão novo | User token da conexão só após tenant/owner gate | migrations/auth/repos | CC base; novo comportamento ainda não implementado |
| Testes planejados | Auth/claims/IDs/erros/compatibilidade | Token tipo/grant/owner/formato/expiração/batch | Seção 9 e plano revisado | Planejados, não executados |

**BLOQUEADO POR PENDÊNCIAS** para liberar implementação de rede dos dois provedores como pacote completo: falta comprovação específica do transporte IG sob zero token/proof em URLs, decisão sobre grants condicionais/consentimento e aprovação humana de política/IDs. A auditoria está concluída; código local de contratos e mocks poderá ser iniciado somente após autorização do usuário, com gates de rede desabilitados onde necessário. Nenhuma implementação foi iniciada e nenhuma evidência documental foi apresentada como smoke real.

## 13. Verificação de encerramento documental

- Branch/HEAD mantidos: fix/scheduled-post-management, e44b031d194a959e3f4182b246d17525a0ebc09c.
- `git diff --name-only` vazio: nenhum arquivo rastreado da aplicação alterado. `git diff --check` sem diagnóstico; documentos novos/ignorados também conferidos por arquivo.
- Comparação SHA-256 das **11 migrations 001–011 contra HEAD:11/11 idênticas**, nenhuma migration nova. A primeira tentativa de subprocesso git teve EPERM do sandbox; a execução somente leitura com acesso autorizado concluiu a comparação. Nenhum banco foi acessado.
- Quatro documentos atuais (relatório + três variantes): links Markdown relativos verificados, **zero links locais ausentes**. Originais marcados históricos com erratas de asterisco/ID de foto, preservando conteúdo anterior.
- Arquivos documentais desta entrega: `docs/meta-insights-task-1-security-review.md` (novo), pesquisa/design/plano `-facebook-instagram` (revisados) e três originais Facebook-only (aviso histórico/erratas). Spec/plans permanecem gitignored pelas regras existentes; nenhum staging.
- Nenhum teste, build ou lint da aplicação executado nesta auditoria; nada foi implementado. Nenhuma chamada autenticada, publicação Meta, SQL/migration, acesso Debian, mudança de credencial, branch, commit, push, merge ou deploy.
