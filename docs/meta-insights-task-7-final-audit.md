# SocialFlow 7A — Task 7: auditoria final e gates de ativação

Data: **22/10/2026**. Escopo: revisão estática e documentação, sem implementação, testes reais Meta ou acesso ao Debian. **BLOQUEADO POR PENDÊNCIAS para piloto conectado à Meta.** A Task 7 documental não equivale à ativação nem à conclusão da integração real.

**Atualização posterior Task8:** [validação dirigida de transporte](meta-insights-task-8-transport-validation.md) mantém o bloqueio e registra o novo F8-1 (classificação Graph80001, sem correção autorizada). O [runbook atual](meta-insights-pilot-runbook.md) restringe a rodada inicial a APage/BPosttexto/CIGAccount/DIGIMAGEprópria, sem Reel. O parecer e as contagens Task7 abaixo são históricos da respectiva revisão; não fecham o finding posterior nem autorizam o piloto.

## 1. Base, autoridade e evidências

- Worktree: `/home/davip/Documentos/socialflow-6e-worktree`.
- Branch: `feat/socialflow-7a-meta-insights`.
- HEAD: `e44b031d194a959e3f4182b246d17525a0ebc09c`, sem commit novo. Os módulos auditados estão no working tree, não nesse commit isoladamente.
- Entrada: 12 caminhos modificados e 22 novos visíveis ao Git, staging vazio; arquivos locais/ignorados de planejamento também preservados. O inventário da Task 6 está em `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-6-files.md`.
- Fontes atuais comparadas por SHA-256 ao manifesto `task-6-buffer-final-checks.json`: **28/28 idênticas**, incluindo package, teste Buffer e integração HTTP. **11/11 migrations idênticas ao manifesto e ao HEAD-base; somente 11 SQLs existentes.** Nenhum banco foi acessado para essa conferência. Uma tentativa de subprocesso Git retornou EPERM; a repetição autorizada, somente leitura, concluiu sem divergência.
- Revisão independente de **todo o conjunto Tasks 1A–6**, não apenas do HTTP: [parecer local](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-7-security-review.md), GPT-6.1 Sol High, sem novos Critical/Important/Minor confirmados. É revisão estática, não certificação de produção.
- [Retorno independente dos documentos](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-7-documentation-review.md): Spec PASS / Quality APPROVED, zero Critical/Important/Minor. **Task7 documental concluída** após conferência final de hashes, links, Git e whitespace; os bloqueios de ativação abaixo não foram removidos.

Precedência: código atual + contratos aprovados + autorizações posteriores prevalecem sobre as seções históricas de 19–20/10. [Pesquisa conjunta](meta-insights-api-research-facebook-instagram.md), [implementação local](meta-insights-local-implementation.md), [repository/service](meta-insights-repository-service.md) e [HTTP](meta-insights-http.md) complementam este relatório. Os exemplos escalares, a ausência antiga de módulos e a seleção de 18 arquivos PostgreSQL da proposta original **não descrevem mais a implementação**. A seleção atual contém 21 arquivos. Não foram alterados os relatórios históricos para apagar essa evolução.

## 2. Inventário da implementação local

| Entrega | Estado auditado | Limite |
| --- | --- | --- |
| Task 1A — OAuth opcional | `META_INSIGHTS_OAUTH_ENABLED` default false; acrescenta `read_insights` e `instagram_manage_insights` somente por habilitação explícita do servidor | Não é aprovação Meta nem grant; não ativa transporte Insights; não existe consentimento por endpoint com flag independente |
| Task 2 — contrato/core/Facebook | Quatro scopes, allowlists v26.0, DTO `points`, parser FB, erros seguros, interface de transporte | Sem adaptador HTTP real |
| Task 3 — Instagram | Conta/media, `total_value`/`time_series`, gates de formato/top-level e token User | Prova do próprio fluxo local não autoriza mídia externa |
| Task 4 — repository | Snapshot privado PostgreSQL sessão → tenant → conta/conexão/destino/credencial | Somente leitura; retorna ciphertext privado; não decripta |
| Task 5 — service | Gates antes de decrypt, Page/User separados, revalidação após sucesso **e erro** assíncronos | Sem cache, persistência de métricas ou descoberta |
| Task 6 — HTTP | Quatro GETs autenticados, query estrita, erro sanitizado e no-store | Test seam explícita somente NODE_ENV=test; execução normal não retorna métricas fake |
| Task 7 — esta entrega | Auditoria, pesquisa atual, gates e runbook futuro | Nenhum transporte/escopo real habilitado |

### Arquivos e fluxo

```text
Cookie HttpOnly → AuthService.require → AuthContext(session/membership/user/tenant)
  → insightsHttp: UUID local + query allowlisted
  → InsightsService
      → InsightsRepository: SELECT parametrizado tenant-safe, snapshot cifrado
      → gates de conta/grants/objeto/expiração → decrypt no servidor
      ├─ FacebookInsightsClient: Page ou Page Post + Page Access Token
      └─ InstagramInsightsClient: Account ou Media + Facebook User Access Token
          → core metaInsightsClient: descriptor fixo v26.0/graph.facebook.com
          → transporte ausente: transport_blocked (nenhuma chamada HTTPS)
      → novo snapshot/gates/comparação integral, inclusive quando o client falha
  → DTO validado + resposta sem await adicional / Cache-Control: no-store
```

Referências: `server/src/{authService,sessionCookie,config,app,insightsHttp,insightsRepository,insightsService,metaInsightsClient,facebookInsightsClient,instagramInsightsClient}.ts`, `shared/insightsContract.ts`. OAuth: `metaOAuthClient.ts`, `metaOAuthService.ts`, `metaOAuthStateRepository.ts`, `postgresSocialAccountsRepository.ts`; criptografia: `socialTokenCrypto.ts`. IDs: `metaPublishingClient.ts`, `instagramPublishingService.ts`, `postPublicationsRepository.ts` e `publicationOperationsRepository.ts`. FKs: migrations 005/010/011. Nenhuma camada nova ou framework é necessário para esse desenho.

## 3. Resultado ponta a ponta de segurança

- **Tenant e leitor:** sessionId/membershipId/userId/tenantId são revalidados pelo repository no PostgreSQL; joins de conta/conexão/Page/post/destino/operação/mídia incluem tenant. Qualquer owner/admin/member ativo pode ler, sem depender do autor original. Cross-tenant é 404; sessão inválida é 401. Nenhuma decriptação antes desses gates.
- **OAuth:** state aleatório/hash persistido, sessão/membership vinculados e consumo único. Locks usam relógio PostgreSQL atualizado antes de persistir/confirmar. Somente grants efetivos entram na conexão; não há união com grants revogados. Insights não integra requiredPublishingScopes, não força reconexão e sua recusa não exclui tokens de publicação válidos. Revogação real de um grant básico não é escondida.
- **Credenciais:** AES-256-GCM existente. Facebook lê ciphertext Page por conta; Instagram lê ciphertext User da conexão e sua expiração, com Page vinculada ativa da mesma conexão/tenant. Nenhum fallback Page→User ou User→Page. AAD constante versionada não constitui vínculo criptográfico por tenant; a barreira atual são as relações/queries e autorização. Rotação/key-id por linha não foi implementada.
- **Concorrência:** contexto/request/snapshot privados copiados; reload depois do client, inclusive erro, detecta sessão revogada, Workspace trocado, membership removido, disconnect e token/grants/vínculos alterados, sem depender de updated_at. Falha descarta resultado. A fronteira é a observação final de autoridade, não serialização absoluta de revogação ocorrida depois dela; não há transação PostgreSQL mantida durante transporte.
- **HTTP:** allowlists, datas UTC reais, até quatro métricas, nenhum parâmetro Graph/token/host/tenant arbitrário, CORS/Origin/cookies existentes preservados e no-store/nosniff inclusive em erros. Mensagens e códigos fixos, sem stack/SQL/Graph raw/error cause. O namespace não oferece descoberta externa nem administração.
- **Rede:** nenhum transporte concreto, nenhuma fallback para fetch nem mock padrão. Conta elegível recebe **503 `meta_insights_not_enabled`**; falta de grant/token/objeto tem erro próprio antes de chegar ao transporte. Injeção fake exige opção explícita e NODE_ENV=test; não é uma chave de ativação para operação normal.
- **Timeout/abort:** client tem deadline local (padrão e máximo 10s), parsing limitado a 1MiB e DTO a 1000 pontos. Abort cancela espera e entrega; não cancela fisicamente SQL já enviado. O limite do body atua após entrega pelo transporte privado, não comprova streaming limitado de HTTP ainda inexistente. Não há deadline global novo para toda espera PostgreSQL.
- **Quota:** há classificação sanitizada de rate limit; **não** há controle de admissão/cooldown compartilhado nem backoff automático implementado. A futura rede precisará protegê-la sem consumir descontroladamente a quota de publicação. Sem jobs/retry loops/timers novos.

O bloqueio é específico de Insights: OAuth/publicação já podem usar rede nos seus fluxos existentes. O OAuth preexistente usa Bearer com proof na query; não foi alterado nesta Task e **não** comprova conformidade com a exigência mais forte do futuro transporte Insights. Não afirmar que todo o backend tem zero segredo em URLs.

## 4. Matriz das quatro famílias e IDs

| Família / rota HTTP local | Objeto e associação permitidos | Seleção local / período | Estado real |
| --- | --- | --- | --- |
| Facebook Account — `/insights/facebook/accounts/:socialAccountId` | UUID da Page local, conexão ativa; Graph Page ID resolvido internamente | `page_media_view`, `page_total_media_view_unique`, `page_video_views`; day/week/days_28; janela local ≤90dias e histórico ≤2anos | Local testado; transporte e dados reais bloqueados |
| Facebook Publication — `/insights/facebook/publications/:postPublicationId` | UUID de **post_publications**, published/sem erro; feed.id ou photos.post_id da Page; não post UUID nem photo.id | `post_media_view`, `post_total_media_view_unique`, `post_reactions_by_type_total` e totais like/love/wow/haha/sorry/anger; lifetime | Local testado; Reel/video ID não tratado como feed post |
| Instagram Account — `/insights/instagram/accounts/:socialAccountId` | UUID de conta profissional via Facebook Login + Page vinculada da mesma conexão | views/reach/accounts_engaged/total_interactions; day/total_value; somente reach admite time_series; últimos90dias, sem futuro | Local testado; elegibilidade Business/Creator e grants reais pendentes |
| Instagram Publication — `/insights/instagram/publications/:postPublicationId` | UUID do destino; media_publish.id final + operação succeeded e mídia/conta/versão consistentes; imagem única JPEG ou Reel próprios | views/reach/likes/comments/saved/shares/total_interactions; lifetime no contrato; period omitido no descriptor wire | Local testado; matriz por formato ainda depende de smoke autorizado |

Os clients privados também validam VIDEO/CAROUSEL_ALBUM e evidência REELS; isso **não** significa que o service/HTTP exponham esses objetos externos ou carrosséis. Container ID, media child e destino sem ID final não são promovidos a mídia publicada. Publicação legada sem destino não ganha vínculo novo. Ownership, formato e ID externo isolados não provam elegibilidade top-level.

Fontes reconferidas: [Page v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US), [Post v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US), [IG Account](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights), [IG Media](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights). v26.0 está fixada nos contratos/clients, além de ser o default de config; versão efetivamente implantada não foi inspecionada.

Limitações oficiais relevantes: a referência Page exige 100 likes, informa atualização geralmente diária e exclui interações de Reels; não generalizar a coleta para Reel. A tabela de reações agrupa care no total like: validar o shape real antes de ampliar o parser de mapa fechado. IG pode retornar conjunto vazio em vez de zero, ter atraso de até48h e, para Media, histórico até2anos; filhos de álbum não têm Insights. A referência atual distingue métricas orgânicas dos novos `total_*` com dados promovidos; estes últimos **não estão na allowlist local**. Não adicionar profile_views/impressions ou nomes legados por analogia. Tabelas oficiais ainda contêm entradas históricas/depreciadas: sua presença numa página v26 não libera uma métrica automaticamente.

## 5. Pesquisa de transporte seguro — 22/10/2026

Método: tentativas pelo navegador retornaram 429/indisponibilidade em fontes centrais. Leitura pública HTTPS por curl, com acesso autorizado, recuperou as referências oficiais abaixo; nenhuma requisição autenticada Graph ocorreu. Não foram usadas respostas de terceiros para aprovar comportamento. Os exemplos oficiais foram parafraseados, sem copiar tokens de exemplo ou comandos prontos para execução.

| Alternativa | Evidência oficial e versão | Restrição / risco | Situação |
| --- | --- | --- | --- |
| TLS e HMAC-SHA256(access token, App Secret) como appsecret_proof | [Secure Requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US), guia Graph genérico lido integralmente | Proof é segredo derivado; deve acompanhar o token correspondente e nunca entrar em logs/DTOs | **Confirmado genericamente**; não comprova transporte por header |
| Authorization Bearer para token em GET | Guia [Access Tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/?locale=en_US), Overview e quatro referências consultados; não forneceram confirmação direta suficiente da combinação necessária | Código OAuth existente não é evidência oficial. Mesmo que token em header seja aceito, falta transporte documentado do proof | **Não confirmado como solução completa** nesta auditoria |
| Header dedicado para appsecret_proof | Secure Requests documenta parâmetro, não header dedicado | Não inventar X-Appsecret-Proof nem remover proof para contornar o gate | **Não confirmado / não usar** |
| POST Graph Batch com access_token e appsecret_proof no corpo e GETs internos | Secure Requests mostra esse formato; [Batch Requests](https://developers.facebook.com/docs/graph-api/making-multiple-requests/?locale=en_US) documenta envelope/erros internos | Guia genérico e exemplos com versões antigas não provam Insights v26. Não copiar exemplos com query de token. Outer200 pode conter inner error | **Confirmado genericamente**, candidato preferencial |
| Batch específico Facebook Page/Post Insights v26 | Page/Post documentam GET da edge; guias acima documentam Batch, mas não foi encontrada confirmação específica suficiente dessa combinação | Token Page, ANALYZE, métricas atuais, inner parser e quota ainda precisam ser comprovados | **Parcialmente confirmado; bloqueado para ativação** |
| Batch específico Instagram Account/Media Insights via Facebook Login v26 | Referências específicas confirmam host graph.facebook.com e Facebook User token, não o transporte completo token+proof via Batch | Não extrapolar suporte genérico Graph. Não migrar para graph.instagram.com/Instagram Login | **Parcialmente confirmado; bloqueado para ativação** |
| GET com token/proof na query, POST method override ou GET body | Não resolve o requisito atual ou não tem evidência suficiente nas fontes consultadas | URL/cursor/log podem conter segredo; sem fallback silencioso | **Fora do desenho autorizado** |

### Menor proposta futura, não implementada

Após comprovação específica e autorização: adaptador backend com **um token, tenant e subrequest GET por envelope inicial**, host fixo HTTPS graph.facebook.com e versão explícita v26.0. Token e proof exclusivamente no corpo do POST externo; relative_url gerada do descriptor, sem segredo, host externo ou escrita. Secret só no servidor; proof calculado a partir do token capturado daquela requisição. Rejeitar redirects; não seguir paging.next bruto. Verificar status/corpo externos e internos, tipo/tamanho/contagem com limites de streaming, timeout/abort, sanitização de canaries em log/APM/erro e orçamento de chamadas. Batch não deve ser assumido desconto de quota. Não misturar tokens, tenants, publicação ou mutações no mesmo envelope.

Esse adaptador não existe e requer aprovação própria; a seam ForTests não será reaproveitada como configuração produtiva. Se a Meta exigir segredo em URL sem alternativa comprovada, manter bloqueado e pedir decisão arquitetural, não degradar silenciosamente a política.

## 6. Matriz de permissões e acesso

Fontes lidas em22/10: [Permissions Reference](https://developers.facebook.com/docs/permissions/reference/?locale=en_US), [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/?locale=en_US), [IG Insights/Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/insights/?locale=en_US), Page/IG Account/Media acima.

| Provider / endpoint Graph | Escopos e gates de produto local | Token / conta | App Review / disponibilidade |
| --- | --- | --- | --- |
| Facebook Page /{page-id}/insights | read_insights + pages_read_engagement; pages_show_list como dependência; ANALYZE explícito | Page Access Token da Page | Documentado; implementação local verifica grants/tasks. Aprovação efetiva e ativos reais **não verificados** |
| Facebook Post /{post-id}/insights | Mesma base Page; vínculo ao destino/Page antes da credencial | Page Access Token da Page dona | GET documentado; Standard/Advanced e grant reais pendentes |
| IG Account /{ig-user-id}/insights | instagram_basic + instagram_manage_insights + pages_read_engagement; pages_show_list como dependência | Facebook User Access Token; profissional ligado à Page | Facebook Login preservado; acesso e subtipo reais pendentes |
| IG Media /{ig-media-id}/insights | Mesma base IG + elegibilidade do objeto | Mesmo User token; ID final da conta autorizada | Sem descoberta externa/children; grant não prova mídia elegível |

**Três camadas distintas:** escopo incluído na URL OAuth ≠ concessão efetiva `/me/permissions` ≠ permissão aprovada/nível de acesso no App Dashboard. Metadata `connected` ou publicação bem-sucedida não comprova nenhuma concessão Insights. Nunca incluir Insights nos requisitos de publicação.

Standard/Advanced e App Review dependem do tipo/use case da app e de atender ativos próprios/usuários com papel versus terceiros; a referência de Access Levels tem escopo explícito para apps criadas por App Type. A documentação geral exige Business Verification para Advanced Access. Conferir o Dashboard e eventuais Data Use Checkup/data handling antes do piloto; **nenhuma dessas aprovações da app SocialFlow foi auditada**. Não afirmar que estar em modo Live basta.

### Divergências ainda abertas, sem alteração automática de escopos

1. Referências específicas IG Account/Media e guia dizem que papéis concedidos via Business Manager podem exigir **ads_management e ads_read**. Não estão nos grants requeridos localmente. Não ampliar scopes nem trocar token: excluir esses ativos do primeiro piloto até a aplicabilidade ser esclarecida/aprovada. Discovery /media tem requisitos condicionais diferentes; não reutilizá-los para a edge Insights.
2. A tabela geral atual de `instagram_basic` lista dependências `pages_read_user_content` e `pages_show_list`; as tabelas específicas de Insights listam instagram_basic/instagram_manage_insights/pages_read_engagement e não explicitam aquela dependência adicional. Trata-se de **divergência documental confirmada, aplicabilidade à app não confirmada**, não prova de defeito local ou autorização para pedir permissão mais ampla. Exige esclarecer no Dashboard/documentação/suporte antes de aprovar um piloto IG que dependa dela.
3. ANALYZE é exigido explicitamente para Facebook; não inferir que MANAGE/CREATE_CONTENT equivalem a ele nem transpor a mesma task para IG sem fonte.

## 7. Evidência de regressão preservada

Conferência nesta Task: leitura dos JSONs finais e comparação dos hashes atuais. **Nenhuma suíte, build, lint, runtime import ou integração PostgreSQL foi reexecutada**; não há alteração de código posterior que invalide a evidência abaixo.

| Gate já executado após o último código | Resultado registrado |
| --- | --- |
| Frontend | 357/357 |
| Backend | 1696/1696 |
| Integração PostgreSQL, 21 arquivos | 706/706 |
| HTTP Insights | 114/114 |
| Repository/service | 149/149 |
| OAuth/clients | 402/402 |
| Build/typecheck, lint, diff-check | exit0 na Task6 |
| Runtime Node22.23.3 | 12 imports; zero conexão/HTTP/listen/timer no harness registrado |

Todos os JSONs conferidos têm success:true, zero failures/pending/skips. **2053** é o total frontend+backend; integração e focados são subconjuntos, não somar novamente. Evidências: `task-6-buffer-final-*.json`, `task-6-buffer-final-checks.json`, `task-6-fix-2-final-invariants.json` no ledger corrente.

Cobertura estática/testes conferidos: troca Workspace, revogação de sessão/membership, rotação de token/grants mesmo com updated_at igual, desconexão após await (sucesso/erro), leitor não autor, tenants concorrentes, zero/ausência, child/carrossel/prova ausente, legado sem destino, ausência de rede default, fake recusado fora de teste, headers/Origin e abort em lookup/provider/reload. Não há cobertura real de Batch, quota, propagação de revogação exclusivamente na Meta ou App Review: o transporte ainda não existe.

**Coordinator histórico:** houve divergência uma vez na suíte completa; isolado e duas seleções completas finais passaram, sem mudança em source/test/scheduler. Causa não comprovada; a otimização de Buffer não constitui correção desse problema. Não há falha obrigatória atual registrada, mas recorrência deve bloquear a próxima liberação para diagnóstico e autorização específica. Nenhum patch ou teste novo desse componente nesta Task.

## 8. Bloqueios, critérios e próxima autorização

| Gate de ativação | Facebook | Instagram | Evidência / situação |
| --- | --- | --- | --- |
| Implementação e segurança local | Page/Post revisados | Account/Media revisados | Aprovado local; sem Critical/Important aberto |
| Transporte seguro genérico | Batch body documentado | Batch body documentado | Confirmado genérico, nenhum adaptador implementado |
| Transporte específico / v26 | Page/Post pendentes | Account/Media pendentes | Falta confirmação compatível com zero segredo em URL e teste autorizado |
| Grants / ANALYZE / ativos | Não verificados | Não verificados; dependências condicionais/divergência | Gate externo; código local não concede permissões |
| App Review / Advanced / Business Verification | Não verificados | Não verificados | Gate App Dashboard e responsável da app |
| IDs / formatos | Texto/foto candidatos; Reel excluído | Própria imagem/Reel; externos/children excluídos | Prova local existe; validação real por caso pendente |
| Plano de smoke e rollback | Documentado | Documentado | [Runbook futuro](meta-insights-pilot-runbook.md); não executado |

Próxima tarefa recomendada: **aprovar uma investigação/piloto técnico de transporte delimitado**, com evidência endpoint-específica e ativos de teste autorizados, antes de implementar/conectar o adaptador HTTP real. Esclarecer as dependências IG e o nível de acesso da app sem alterar scopes por tentativa e erro. Uma autorização de piloto não é autorização de produção; desenvolvimento do adaptador, smoke autenticado e deploy exigem gates separados. Se não houver evidência suficiente, encerrar mantendo503.

7B (snapshots/coletor separado), 7C (Analytics), 7D (regressão do novo transporte) e 7E (preparação de atualização manual) continuam não iniciadas nesta execução. Não modificar o scheduler de publicação para coletar métricas.

**Conclusão: BLOQUEADO POR PENDÊNCIAS para piloto Meta conectado.** A base local e sua auditoria estão preparadas; dados Meta reais não foram consultados nem validados. Produção, Debian, credenciais, aplicação, testes e migrations permaneceram intocados nesta Task. Aguardar aprovação humana da próxima fase.
