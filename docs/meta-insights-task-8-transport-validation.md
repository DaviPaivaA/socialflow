# SocialFlow 7A — Task 8: transporte e preparação do piloto

**Adendo Task8.1 — 22/10/2026 (posterior ao relatório abaixo): F8-1 FECHADO localmente.** Houve autorização específica e correção mínima: somente `body.error.code` numérico80001 passa a `rate_limited`, propagado para HTTP429/`meta_insights_rate_limited`. RED funcional,567 testes focados,430 OAuth/clients e revisão independente do delta aprovados, sem findings. Gates finais:357FE+1726BE=2083, incluindo707PG/21arquivos;zero falhas/skips nas execuções finais;build/typecheck/lint/runtime/diff-check aprovados. As falhas ambientais anteriores e limites da evidência estão no [relatório Task8.1](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-8-1-report.md). As menções abaixo a F8-1 aberto/sem patch são históricas da Task8. **Transporte e piloto continuam bloqueados**; nenhuma alternativa de rede foi habilitada, nenhuma7Arealconcluída.

Data: **22/10/2026**. Branch `feat/socialflow-7a-meta-insights`; HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c`. Resultado: **comprovação parcial; transporte e piloto autenticado permanecem bloqueados**. Somente documentação foi editada. Não há adaptador real novo, teste `.ts` novo, credencial real, chamada autenticada, banco, migration ou deploy nesta entrega.

**Revisão independente:** [parecer Task8](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-8-review.md) aprovou a documentação **com restrições**: 0 Critical, **1 Important F8-1 ABERTO**, 0 Minor. Não há novo finding documental; o defeito de classificação não foi fechado nem corrigido por esta aprovação. Investigação/preparação entregue, produto/rede/piloto não liberados.

Não houve commit: os módulos locais das Tasks1A–6 estão no working tree preservado, não no HEAD isolado. A revisão de segurança desta Task e os resultados de verificação estão no [relatório do checkpoint](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-8-report.md).

## 1. Recuperação, escopo e diferença para Task 7

Preservados os 12 arquivos modificados e 24 novos visíveis ao Git na entrada, além de documentos/snapshots ignorados. Lidos os fechamentos das Tasks1A–3 (`2026-10-20-socialflow-7a-local-oauth-clients/task-4-report.md`),4/5 (`final-report.md`),6 (`task-6-final-report.md`) e7 (`task-7-report.md`), no ledger conjunto `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/`. [Auditoria Task7](meta-insights-task-7-final-audit.md), [pesquisa conjunta](meta-insights-api-research-facebook-instagram.md) e [runbook](meta-insights-pilot-runbook.md) consultados. Nenhum implementador/teste anterior ativo no ambiente visível; não foram reabertas as Tasks aprovadas.

Esta Task concentra-se nas lacunas de rede: confirmação **por endpoint**, estrutura/cancelamento/erros de Batch, protocolo sintético futuro e pilotos A–D. A restrição humana nova prevalece sobre o caso Reel do runbook anterior: **somente Page, Post texto e mídia IG própria IMAGE no início**; foto FB é expansão separada, e Reel de qualquer provedor não inicia o piloto. O suporte local existente a Reel não foi removido ou alterado.

Código inspecionado nas interfaces relevantes: `server/src/metaInsightsClient.ts`, `facebookInsightsClient.ts`, `instagramInsightsClient.ts`, `insightsService.ts`, `insightsRepository.ts`, composição em `app.ts`, flag em `config.ts`, `shared/insightsContract.ts`. Sem reauditoria completa dos módulos já revisados.

## 2. Fontes oficiais consultadas e alcance da prova

Método: buscas com filtro oficial não retornaram resultados; navegador retornou indisponibilidade/429 para páginas centrais. Leitura pública HTTPS via curl autorizado recuperou os textos abaixo. Não houve Graph API autenticada. Menção a Batch na navegação comum de Page/Post **não é evidência de suporte do endpoint**; foram analisadas as seções operacionais, não apenas uma busca por palavra. Ausência de um termo não prova incompatibilidade universal.

| Ref. / URL oficial | Evidência em22/10/2026 |
| --- | --- |
| S1 — [Secure Requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US) | TLS; HMAC-SHA256(token, App Secret); exemplo multipart POST com token/proof/batch no corpo e GETs internos. Evidência **genérica**, sem exemplo Insights específico. |
| S2 — [Batch Requests](https://developers.facebook.com/docs/graph-api/making-multiple-requests/?locale=en_US) | Tokens de topo podem servir de fallback; respostas ordenadas por operação com code/body JSON-string; inner failure e operações null em lote incompleto; GET/DELETE não usam body interno como POST/PUT. Limite genérico50; cada operação consome quota. |
| S3 — [Page Insights v26](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US) | GET, métricas e Page token/ANALYZE/grants; não documenta a combinação completa Batch+Insights+proof nessa versão. |
| S4 — [Post Insights v26](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US) | GET /v26.0/{post-id}/insights; não exemplifica Batch ou header/proof por essa edge. |
| S5 — [IG Account Insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights) | Facebook Login: User token, graph.facebook.com, grants específicos, v26.0. Não comprova Batch/headers para essa operação. |
| S6 — [IG Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) | Mesma distinção de login/token; formato/children/ausência; não comprova transporte completo fora da query. |
| S7 — [IG Overview](https://developers.facebook.com/documentation/instagram-platform/overview) e [guia Insights](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/insights/?locale=en_US) | Overview genérico aceita User ou Page conforme operação; referências S5/S6 específicas determinam **User** para Insights. Nenhuma confirmação específica Batch encontrada. Exemplos antigos de métricas não substituem a allowlist atual. |
| S8 — [Access Tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/?locale=en_US) | Tipos Page/User e HTTPS; não resolveu a combinação necessária token+proof em headers GET. |
| S9 — [Using Graph API](https://developers.facebook.com/docs/graph-api/using-graph-api/?locale=en_US) e [Get Started](https://developers.facebook.com/docs/graph-api/get-started/?locale=en_US) | GETs autenticados e versionamento no path; exemplos com token em query/Explorer não serão copiados sob a política do projeto. |
| S10 — [Versioning](https://developers.facebook.com/docs/graph-api/guides/versioning/?locale=en_US) | Indica v26.0 como atual e recomenda versão explícita. Não fornece regra específica de herança/override das operações Batch que resolva o gate endpoint-específico. |
| S11 — [Rate Limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/?locale=en_US) | Quotas dependem de token/API; chamada por Page token sujeita a BUC, não número universal. Código80001 é apresentado como throttling de Page; parar ao atingir limite. Ver lacuna local na seção6. |

As permissões/dependências da [Permissions Reference](https://developers.facebook.com/docs/permissions/reference/?locale=en_US) e os níveis de [Access Levels](https://developers.facebook.com/docs/graph-api/overview/access-levels/?locale=en_US) foram reconferidos na Task7, mesma data; não foram reconsultados integralmente nesta Task. S5/S6/guia foram lidos novamente e mantêm as condições Business Manager. Nenhum estado real da app foi acessado.

## 3. Alternativas: comprovado, insuficiente e rejeitado

| Alternativa | Token / proof / versão | FB Page / Post | IG Account / Media | Decisão |
| --- | --- | --- | --- | --- |
| GET direto, Authorization Bearer | Mesmo que token seja aceito em header, falta comprovar o canal do proof; path v26 explícito | Solução completa não confirmada | Solução completa não confirmada | Não implementar por suposição. Não afirmar que Bearer é universalmente rejeitado. |
| Header próprio de proof | Nenhum header dedicado comprovado em S1/S3–S9 | Não confirmado | Não confirmado | Rejeitar invenção de X-Appsecret-Proof ou equivalente. |
| POST Batch, token+proof **no corpo externo**, GET interno | S1 comprova mecanismo genérico; S2 token de topo e envelope; versão explícita ainda exige conferir regra efetiva das operações | **Parcialmente confirmado**, sem prova específica suficiente | **Parcialmente confirmado**, sem extrapolar suporte genérico | Candidato preferencial, **não aprovado para implementação/ativação** nesta Task. |
| Body em GET direto ou em GET interno de Batch | Nenhuma modalidade direta comprovada; S2 distingue GET/DELETE de POST/PUT com body | Sem solução comprovada | Sem solução comprovada | Não usar body de GET para transportar os segredos. |
| POST direto na edge /insights ou method=GET override | S3/S4 documentam leitura e não criação; S5/S6 documentam GET, não esse override | Não comprovado | Não comprovado | Não alterar método/edge para contornar prova ausente. |
| Token/proof em query externa/interna | Exemplos de token em query existem, mas violam a política de transporte escolhida | Fora da política | Fora da política | Rejeitado como fallback, mesmo se exemplo oficial o usar. |
| SDK genérico, publicação/OAuth existente ou Graph Explorer | Existência de método, wrapper Batch ou fluxo funcional não comprova token+proof+Insights v26 por família | Evidência insuficiente | Evidência insuficiente | Não adicionar SDK/dependência, não executar Explorer/autenticação real. |

**Comprovado tecnicamente de forma documental:** algoritmo da prova, requisitos HTTPS, POST Batch genérico com segredos no corpo, envelope e erros internos. **Não comprovado:** essa composição completa para os quatro endpoints, sem exigir outro canal de segredo. Não foi encontrada proibição oficial universal de Batch Insights; o bloqueio é de evidência/autorização, não alegação de impossibilidade Meta.

## 4. Credenciais e permissões — sem mudança de OAuth

| Piloto / endpoint Graph | Credencial e identidade | Grants / requisitos a comprovar |
| --- | --- | --- |
| A — /{page-id}/insights | Page token da conta Facebook do tenant; Page ID resolvido pelo repository | read_insights, pages_read_engagement, dependência pages_show_list; emissor com ANALYZE; Page elegível |
| B — /{post-id}/insights | Page token da Page dona; ID final feed do destino published | Mesma base Facebook; vínculo do destino à Page, ausência de erro/unknown |
| C — /{ig-user-id}/insights | **Facebook User token** de oauth_connections, com expiração própria; IG Professional ID | instagram_basic, instagram_manage_insights, pages_read_engagement e dependências pages_show_list; Business/Creator ligado a Page ativa da mesma conexão |
| D — /{ig-media-id}/insights | Mesmo User token; final media_publish.id da mídia própria, não container | Mesmos grants IG + ownership e top-level/formato elegíveis comprovados; operação local coerente não autoriza qualquer ID externo |

O repository atual escolhe ciphertext Page em social_account_credentials para FB e ciphertext User da conexão para IG; service só decripta depois da autorização, e revalida depois do await. Publicação IG usar Page credential não altera a regra Insights. Nenhum token veio do frontend ou foi lido de ambiente real nesta Task.

Solicitação OAuth, concessão efetiva e aprovação/nível de acesso Meta são evidências distintas. `META_INSIGHTS_OAUTH_ENABLED` permanece defaultfalse, sem alteração de configuração; os scopes opcionais não são requiredPublishingScopes. A app real, grants e ativos não foram verificados. Condição IG via Business Manager pode exigir ads_management+ads_read; dependência pages_read_user_content em instagram_basic na referência geral diverge das tabelas específicas. Esclarecer sem ampliar privilégios automaticamente ou migrar para Instagram Login.

## 5. Protocolo de testes locais futuro — não implementado

**Nenhum adaptador comprovado foi escolhido; portanto não há novo teste de transporte `.ts` nem pseudo-implementação a validar com mocks.** Não criar um fake HTTP cujo sucesso seria usado como prova Meta. Esta seção é a especificação verificável de RED→GREEN para a futura autorização de um transporte, não uma suíte executada.

Pré-condições: autorização específica, prova/experimento explicitamente delimitado por endpoint, seam HTTP local sem egress, secrets sintéticos e ambiente sem .env. O adaptador será privado e separado de app/config; não ligar ForTests como config de rede. Manter clients/services/OAuth aprovados salvo mudança aprovada em separado. Inputs são descriptors fixos e credenciais já autorizadas, não URLs/tokens do browser.

### Construção e prova

- Host exatamente graph.facebook.com, HTTPS/443, sem userinfo/fragment/host override. Descriptor fixa v26.0; variáveis ou parâmetros do caller não mudam a versão. Documentar e confirmar onde a versão é aplicada ao envelope e à operação; não duplicar segmentos ou depender de default do Dashboard.
- Proposta Batch **condicional**: um token e uma operação GET por envelope; access_token/appsecret_proof no formulário externo, relative_url gerada com ID/edge/params allowlisted, sem segredo. Sem body interno GET, método mutável, operação extra ou token alternativo. Envelope com Page token não recebe operação IG.
- HMAC-SHA256 usando token como mensagem e App Secret como chave; teste contra vetor independente conhecido, não só a mesma função usada duas vezes. Diferenciar token PageA, UserA e UserB com sentinelas sintéticas; comprovar que trocar token muda proof e não contamina outra requisição. Nunca imprimir as sentinelas/segredos de uma execução real.
- Spy do transporte verifica URL externa, relative_url, exceções, logger, serialização e cursors: nenhum token/proof/AppSecret/ciphertext/cookie pode escapar. Logs HTTP/APM devem omitir corpo e headers sensíveis; ausência em URL sozinha não protege o corpo. Sem segredos em Error.cause ou abort.reason.
- Redirects301/302/307/308 são recusados, sem reenviar credenciais nem para o próprio host. Testar URL absoluta, host semelhante, protocolo inválido, porta alternativa, traversal e paging.next com token/host malicioso; nenhum segundo envio.

### Envelope, erros e normalização

| Cenário sintético a escrever primeiro em RED | Expectativa mínima preservando contratos atuais |
| --- | --- |
| Outer200 + único inner200 com JSON válido | Desembrulhar por índice validado para `{status,body}` do core; parser da família normaliza, não envelope bruto no DTO |
| Outer200 + inner400/401/403/429/500 | Nunca tratar outer200 como sucesso; classificar erro interno pelo status+código Graph confiável, sem expor body bruto |
| Outer400/401/403/429/500 | Parar antes de presumir array válido; HTTP401/403 do provider não vira sessão local401 por si só |
| Graph190 / Graph200 / Graph100 / 4,17,32,613 /80001 | token_expired / permission_required / invalid_query / rate_limited;80001 tem correção pendenteF8-1, não está atendido hoje |
| HTTP401/403 sem código confiável; erro desconhecido ou HTML | provider_unavailable seguro conforme core atual; não presumir token vencido ou grant específico |
| Lote parcial, slotnull, item ausente/extra, arrayfora de ordem/cardinalidade | Para envelope inicial de uma operação, null/ausente/excesso é falha segura; não inventar dado ou repetir automaticamente |
| Resposta200 com data[] vazia ou métrica ausente válida | not_available/null; não é zero. Ausência não comprova shape de métrica disponível |
| Zero explícito, datapoints parciais válidos, reações e totais IG | Preservar valor, período e status por métrica; sem somas ou categorias inventadas |
| JSON externo/interno inválido, body não string quando exigido, metadado estranho | Falha sanitizada; nunca desserialização dupla insegura nem retorno do material cru |
| Datas inválidas, duplicadas com offsets do mesmo instante, períodos errados | Rejeitar; preservar regra UTC e limites da família já implementados |
| Payload acima do limite, chunked/gzip excessivo, muitos itens/pontos | Limite durante leitura/descompressão e total de envelope+inner decodificado, além dos1MiB/1000pontos já locais. TamanhoJSON pós-leitura não é limite streaming |
| Timeout no envio/headers/body, abort antes/durante/depois | Uma deadline cobre operação inteira; destruir/cancelar I/O do adaptador, observar rejeição tardia e nunca entregar após abort; não prometer cancelamento SQL/remoto físico |
| Paginação presente/cursor com segredo/loop | Inicialmente nenhuma paginação automática; não seguir rawURL. Sem afirmar completude da série se houver próxima página não coletada: definir tratamento seguro antes da implementação, não ignorar/truncar silenciosamente |
| Rate limit externo/interno, Retry-After ausente/inválido e retries | Sem retry automático no primeiro piloto, sem cooldown inventado; parar e registrar estado sanitizado. Headers de uso só por allowlist e sem IDs sensíveis |
| Dois tenants/providers com conclusões invertidas | Tokens/proofs/bodies isolados, zero cache/envelope compartilhado; sessão/grant/conta alterados durante await descartam resultado via service real |
| Default da app e flag OAuth | Sem transporte continua503not_enabled para alvo elegível; mocks somente injetados explicitamente em testes; flag OAuth não liga rede |

Algumas expectativas requerem desenho adicional do adaptador antes de código (paginação/completude, limites streaming e propagação de timeout). Não são capacidades existentes. Meta Batch admite múltiplos tokens e até50 operações genericamente; o projeto propõe **proibir** isso no piloto. Limite de uma operação/zero retry é política operacional local, não imposição Meta.

## 6. Finding F8-1 — diagnóstico histórico anterior à correção Task8.1

**Important para liberar rede; ABERTO, sem correção autorizada.** `server/src/metaInsightsClient.ts:151` classifica HTTP429 ou códigos4/17/32/613 como rate_limited; um Graph80001 em HTTP400 cai em provider_unavailable. S11 documenta80001 como throttling de Page. Isso pode ocultar o diagnóstico/cooldown específico quando houver rede. Hoje não produz vazamento nem retry automático: a rede está bloqueada, e esta constatação não é incidente de produção.

Investigação com systematic-debugging: seguir status/body no validador até fallback; comparar com os quatro códigos reconhecidos; variar somente o código Graph em fake injetado. Diagnóstico inline Node22, sem .env, sem Graph e sem editar fontes/testes, executou cinco chamadas sintéticas ao core existente:

| HTTP de todas as respostas | Graph.code | Resultado observado |
| --- | --- | --- |
| 400 |4|rate_limited|
| 400 |17|rate_limited|
| 400 |32|rate_limited|
| 400 |613|rate_limited|
| 400 |80001|**provider_unavailable**|

O fake apenas retorna objetos em memória e fetch global foi substituído por função proibitiva no diagnóstico. Não foi criado transporte HTTP, não foram usados tokens reais e não se alega uma suíte RED→GREEN ou Meta real. A causa local é a seleção fechada de códigos, não o repository, grants ou sessão. Preservar sanitização e não classificar qualquer800xx como quota sem prova por código/endpoint.

**Autorização solicitada para uma fase posterior:** teste RED permanente de80001 + correção mínima da classificação no core e revisão/HTTP/regressão proporcionais; avaliar outros códigos somente com fonte e escopo próprios. A Task8 proíbe mudar clients aprovados sem autorização, portanto nenhum patch foi aplicado. Não absorver esse ajuste silenciosamente no futuro adaptador.

## 7. Pilotos A–D e checklist do operador

Procedimento detalhado, explicitamente futuro: [runbook atualizado](meta-insights-pilot-runbook.md). Quatro fichas independentes; uma prova não libera as outras. Primeira rodada: A Page/day/page_media_view, B Post texto/lifetime/post_media_view, C IGAccount/day/total_value/views, D própria IMAGE JPEG/lifetime/views. Sem criação de conteúdo, sem Reel/foto-expansão/Story/carrossel/externos no início.

Antes da primeira chamada de cada ficha:

- [ ] Consentimento explícito do responsável com operador, janela, endpoints, ativos de teste e limite de chamadas; sem credencial real nesta Task.
- [ ] Transporte completo confirmado **ou** autorização específica para um experimento técnico de compatibilidade ainda incerta, separado da app. Uma autorização genérica de smoke não remove esse gate.
- [x] Correção local e revisão do F8-1 autorizadas na Task8.1; consultar gates no relatório atualizado. Isso não comprova App Review/Standard/Advanced/Business Verification ou grants efetivos, que permanecem pendentes e separados, sem ampliar scopes por tentativa e erro.
- [ ] PageANALYZE/IGprofissional/Pagevinculada, tipo correto de token e validade. Esclarecer dependênciasIG condicionais/divergentes antes do piloto correspondente.
- [ ] IDs e autoria do ativo comprovados no backend, nunca por GraphID isolado; mídia própria com owner+top-level/formato reais, container não serve.
- [ ] Ambiente exclusivo de teste, sem banco de produção/Debian; nenhum publisher/job no experimento, nenhuma alteração de conta/conteúdo.
- [ ] Registro somente sanitizado, logs/APM sem bodies de credencial/PII; headers/URLs/erros revisados. No máximo1Insights inicial por ficha, zero retry automático; orçamento de preflight autorizado separado, sem descoberta aberta.
- [ ] Critérios de parada e rollback de Insights entendidos. Resultados vazios não viram zero; falha ou comportamento inesperado interrompe, sem tentativa de outro token/transporte não aprovado.

## 8. Verificação e status final por família

No início:28hashes de fontes/testes/package iguais ao manifesto pós-Task6,11migrations iguais ao manifesto e HEADbase,11SQLs em disco e staging vazio. Não foram executadas suites/build/lint/DB/runtime globais; resultados anteriores não são apresentados como execuções desta Task. Foram feitas leituras de fontes oficiais, inspeção pontual de interfaces e o diagnóstico sintético de classificação acima. Conferência final e revisão independente ficam registradas no relatórioTask8 do ledger.

| Família | Mecanismo genérico token+proof no corpo | Comprovação específica de transporte v26 | Classificação desta Task | Estado normal |
| --- | --- | --- | --- | --- |
| Facebook Page | Documentado S1/S2 | Não concluída | **PARCIALMENTE CONFIRMADO** | Transporte bloqueado;F8-1 pendente |
| Facebook Post | Documentado S1/S2 | Não concluída | **PARCIALMENTE CONFIRMADO** | Transporte bloqueado;F8-1 na base Page |
| Instagram Account | Documentado S1/S2, sem extrapolar | Não concluída | **PARCIALMENTE CONFIRMADO** | Transporte bloqueado, grants/dependências pendentes |
| Instagram Media | Documentado S1/S2, sem extrapolar | Não concluída | **PARCIALMENTE CONFIRMADO** | Transporte bloqueado, elegibilidade pendente |

Nenhuma família foi classificada TRANSPORTE DOCUMENTALMENTE CONFIRMADO ou PRONTO PARA PILOTO AUTORIZADO. A revisão/documentação pode ser encerrada com bloqueios explícitos; não equivale a liberar a rede. Próximo passo mínimo: obter decisão humana sobre esclarecimento oficial por endpoint/experimento técnico isolado, resolverF8-1 em mudança separada e aprovar os pré-requisitos de ativos/permissões; só depois executar piloto com consentimento específico. Parar aqui, sem implementação produtiva, chamadas reais,7B/dashboard ou deploy.
