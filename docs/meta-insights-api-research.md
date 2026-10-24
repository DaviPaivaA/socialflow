# SocialFlow 7A — pesquisa da Meta Graph API / Insights

**Histórico Facebook-only:** para a7A atual usar [pesquisa Facebook+Instagram](meta-insights-api-research-facebook-instagram.md) e [revisão Task1](meta-insights-task-1-security-review.md). Erratas em20/10/2026: `*` significa refresh intradiário, não depreciação; publisher de foto grava `/photos.post_id`, não photo.id. A implementação não foi iniciada.

Pesquisa inicial: 2026-10-19. Revisão documental: 2026-10-20. Estado: pesquisa documental, **sem chamadas autenticadas à Meta** e sem validação com uma Page real. Versão examinada: **v26.0**, que é o padrão local em `server/src/config.ts`; a versão efetiva do ambiente Debian não foi consultada. As referências abaixo são páginas oficiais da Meta, lidas em inglês (`locale=en_US`). “Documentado” significa que o nome aparece na referência; não significa que a conta/app do SocialFlow já tenha autorização ou que todos os tipos de publicação retornem dados.

## Fontes oficiais e pontos verificados

| Fonte | Evidência relevante |
| --- | --- |
| [Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US) | Requisitos (`read_insights`, `pages_read_engagement`, token de Page e task `ANALYZE`), métricas de Page e Page Post, períodos, janela, atraso e limites. |
| [Post Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US) | `GET /v26.0/{post-id}/insights`, `metric`, `period`, `since`, `until`; resposta `data`/`paging`; erros 100, 3001, 200 e 190. |
| [Post v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/?locale=en_US) | O objeto Post tem edge `insights` para Pages, edge `comments`, edge `reactions` e campo `shares.count`; esses campos/edges **não são** automaticamente métricas de Insights. |
| [Métricas depreciadas de Pages](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics?locale=en_US) | Substituições/remoções, inclusive `page_impressions` → `page_media_view`, `post_impressions` → `post_media_view`, e variantes de únicos → `*_total_media_view_unique`. |
| [Permissão `read_insights`](https://developers.facebook.com/docs/permissions/reference/read_insights?locale=en_US) | Dependências `pages_read_engagement`/`pages_show_list`, finalidade e exigências de App Review/Advanced Access em uso fora dos próprios ativos. |
| [Graph API rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/?locale=en_US) | Token de Page em Pages API sujeito a Business Use Case limits; cabeçalhos de uso e códigos de throttling 4, 17, 32 e 613. Não há quota fixa universal apropriada para hardcode. |
| [Secure Graph API Calls](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US) | TLS e `appsecret_proof` (HMAC-SHA256 do token com app secret); a página mostra prova como parâmetro, mas não confirma por si só suporte ao transporte de token/prova em headers para a consulta planejada. |

Errata documental: `*` significa métrica atualizada várias vezes ao dia; não indica depreciação. Aviso F1 e lista específica divergem em datas de remoção (15/06/2026 vs15/06/2025/15/11/2025), mas somente nomes com evidência própria de remoção devem ser classificados assim. `page_daily_follows` consta como “Not defined” e não é habilitado. Matriz atual completa na revisão Task1.

## Endpoint, autorização e semântica

Para uma Page, usar `GET https://graph.facebook.com/v26.0/{page-id}/insights?metric=...&period=...&since=...&until=...`. Para uma publicação da Page, `GET https://graph.facebook.com/v26.0/{post-id}/insights?metric=...&period=...`, **somente após provar que o identificador persistido corresponde a um Post aceito por essa edge**. A Meta mostra também `/{object-id}/insights/{metric}`. O parâmetro `metric` é obrigatório no fluxo documentado; batches extensos podem omitir resultados ou estourar tempo. O client futuro deve limitar lista, checar `data`, `name`, `period`, `values`/`value`, `end_time`, `paging` e não inferir zero de uma lista vazia. [Page Insights](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US), [Post Insights](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US).

O requisito documentado para esses Insights é Page access token emitido para pessoa com task `ANALYZE`, com `read_insights` e `pages_read_engagement`. `pages_show_list` é dependência de `read_insights` na referência de permissões. **O OAuth atual não pede `read_insights`; possuir token para publicação não equivale a permissão de métricas.** A referência `read_insights` exige App Review para dados que o app não possui/gerencia e informa que Business Verification é necessária para pedidos de Advanced Access; também pode haver requisitos de tratamento de dados. Modo development e ativos/usuários de teste têm restrições. Não ampliar escopos nem reconectar contas nesta auditoria. [Page Insights](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US), [read_insights](https://developers.facebook.com/docs/permissions/reference/read_insights?locale=en_US).

A referência informa: Page Insights disponíveis apenas para Pages com **100 ou mais likes**; a maioria das métricas atualiza aproximadamente a cada **24 h**; dados históricos limitados aos **últimos dois anos**; `since`/`until` por consulta no máximo **90 dias**; `lifetime` também não ignora o teto histórico; certos recortes demográficos exigem amostra mínima de 100; interações com **Reels não entram** em algumas métricas de Page. Esses limites são da documentação, não garantias sobre cada valor de uma Page específica. [Page Insights](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US).

## Matriz de métricas (candidatas documentadas, não habilitadas)

Em todas as linhas abaixo a base de autorização é a descrita acima: Page token + `ANALYZE` + `read_insights` + `pages_read_engagement`. A versão é **v26.0**. “Liberar” exige teste autorizado com conta de teste e resposta Graph real antes da implementação produtiva. Origem das linhas: [Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US).

| Objeto / endpoint | Nome exato | Período | Significado, restrição e decisão |
| --- | --- | --- | --- |
| Page `/page-id/insights` | `page_media_view` | `day`, `week`, `days_28` | Exibições/reproduções de conteúdo (posts, stories, vídeos e ads). **Não chamar de impressões legadas**. Candidata primária para visualizações da Page. |
| Page | `page_total_media_view_unique` | `day`, `week`, `days_28` | Pessoas/contas únicas que visualizaram conteúdo. Pode ser indicador de visualizadores únicos; **não equiparar automaticamente a alcance total legado**. |
| Page | `page_video_views` | `day`, `week`, `days_28` | Visualizações de vídeo de Page; não prometer cobertura dos Reels 6E sem verificação. |
| Page Post `/post-id/insights` | `post_media_view` | `lifetime` | Exibições/reproduções daquele conteúdo. Candidata primária de visualizações do post. |
| Page Post | `post_total_media_view_unique` | `lifetime` | Visualizadores únicos do post; não rotular como alcance legado sem qualificação. |
| Page Post | `post_reactions_by_type_total` | `lifetime` | Contagem por tipo; resposta estruturada exige normalização estrita, não um número único sem mapeamento. |
| Page Post | `post_reactions_like_total`, `post_reactions_love_total`, `post_reactions_wow_total`, `post_reactions_haha_total`, `post_reactions_sorry_total`, `post_reactions_anger_total` | `lifetime` | Reações por tipo; `like` inclui `care` segundo a referência. Candidatas, não somar categorias sem verificar sobreposição. |
| Page Post (vídeo compatível) | `post_video_views`, `post_video_view_time` | `lifetime`, `day` | Views de vídeo e tempo de visualização em ms. Compatibilidade com ID de Facebook Reel ainda **não comprovada**. |

Comentários e compartilhamentos não foram identificados como métricas simples equivalentes na tabela de Insights investigada. A referência do objeto Post expõe `comments` como edge e `shares.count` como campo; podem ser consultados via Graph separadamente, com permissões e comportamento verificados no piloto. Até lá são **fora do MVP de Insights**, não zeros nem números simulados. Taxa de engajamento também é derivada, não um campo Meta universal; definir denominador e tratamento de indisponibilidade antes de exibir. [Post v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/?locale=en_US).

## Métricas excluídas ou ainda não comprovadas

- `page_impressions`, `post_impressions`, `page_impressions_unique`, `post_impressions_unique` e variantes orgânico/pago/viral constam da [lista oficial de depreciações](https://developers.facebook.com/documentation/pages-api/platforminsights/page/deprecated-metrics?locale=en_US). **Não selecionar**, mesmo se aparecerem em tabela antiga da referência.
- `*` indica refresh intradiário. `page_post_engagements`, `page_follows`, `post_clicks` e `post_clicks_by_type` são candidatos documentados e não foram comprovados removidos por esse sinal; ainda exigem grant/piloto. `page_daily_follows` não é habilitado por constar como “Not defined”.
- `page_engaged_users`, `page_consumptions` e famílias explicitamente removidas ficam fora. Vídeo assinalado `Deprecated above Graph API v25` (page_video_views_unique/post_video_views_unique) também; `*` sozinho não é razão de exclusão.
- “Alcance”, “impressões”, “interações”, “cliques”, “comentários” e “shares” são rótulos de produto, não prova de métrica disponível. O contrato deve carregar nome exato da fonte, definição e estado de disponibilidade.
- Instagram Insights, Stories, TikTok e métricas de Reels não comprovadas **não entram no MVP 7A Facebook**.

## IDs de publicações e gate de compatibilidade

Correção da associação: texto grava `/feed.id`; foto grava **`/photos.post_id`** no client atual. Ambos são candidatos a Page Post Insights, provando Page/tenant. Reel guarda video_id e não é presumido Page Post. A revisão Task1 descreve também final IG media ID versus container e mídia externa. [Post Insights](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US).

## Erros, rate limit e coleta

Graph pode negar por permissão (referência de Post Insights: 200), token (190), parâmetro inválido (100), consulta inválida (3001) ou throttling (p.ex. 4/17/32/613). Também há falhas HTTP/timeout e respostas vazias. O client deve classificar por código confiável e status, aplicar timeout e nunca encaminhar erro bruto/token ao browser. O **transporte de token/prova fora de URLs** deve ser confirmado na documentação oficial ou em ambiente de teste antes de codificar; a página oficial de segurança confirma `appsecret_proof`, mas seu exemplo usa parâmetro de formulário, não comprova header para a operação GET. Não pôr token em URL de diagnóstico, logs ou DTO. A documentação diz que Page token usa limites BUC, com indicadores em cabeçalhos de uso; não fixar quota presumida. Ao atingir limite, parar chamadas e obedecer backoff; nenhum retry automático infinito em requisição HTTP. [Post Insights](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US), [Rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/?locale=en_US), [Secure Graph API Calls](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US).

**Decisão proposta:** 7A consulta explícita e limitada, sem timer/job/cache persistente; 7B adiciona snapshots, deduplicação de coleta e backoff controlado em worker separado do scheduler de publicação. Mesmo dados `lifetime` mudam com o tempo; não tratá-los como imutáveis. Para cada resultado incluir `fetchedAt`, `graphApiVersion`, período e status. `null` representa indisponibilidade; `0` somente quando a Meta forneceu zero válido.

## Questões de validação antes de liberar código produtivo

1. Confirmar versão Graph **efetiva** do deployment sem ler ou revelar segredos; o valor local padrão é v26.0.
2. Conseguir App Review/Advanced Access para `read_insights` e Page task `ANALYZE`, se necessário; verificar concessões reais em `grantedScopes`, sem supor que toda conta conectada tem o novo escopo.
3. Executar piloto **autorizado e isolado** com Page de teste (não nesta auditoria) para confirmar resposta de métricas escolhidas, presença/atraso dos dados, Page com <100 likes e Graph errors observados.
4. Provar mapeamento dos IDs de foto e Reel para objeto elegível em `/{post-id}/insights`, ou declarar esses tipos não suportados no MVP.
5. Reconfirmar depreciações e limites imediatamente antes de codificar, pois a Meta pode atualizar documentação e API.
6. Confirmar oficialmente o modo aceito de enviar Page access token **e** `appsecret_proof` em consulta de Insights sem colocá-los em query string; não afirmar suporte a headers apenas por memória.
