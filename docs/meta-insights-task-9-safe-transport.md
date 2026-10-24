# SocialFlow 7A — Task 9: transporte seguro condicionado a comprovação

Data: **22/10/2026**. Branch `feat/socialflow-7a-meta-insights`; HEAD-base `e44b031d194a959e3f4182b246d17525a0ebc09c`. Os módulos das Tasks1A–8.1 estão no working tree, não nesse commit isolado.

**Decisão: BLOQUEADO nas quatro famílias. Não foi implementado adaptador.** O POST Batch genérico com segredos no corpo está documentado; falta prova suficiente da composição completa por edge Insights v26.0. Isso não prova incompatibilidade universal da Meta. A condição humana para implementar rede local não foi satisfeita. Nenhuma chamada autenticada, credencial real, OAuth, SQL, migration, publicação, produção ou deploy nesta Task.

## 1. Recuperação e arquitetura preservada

Relatórios Tasks7/8/8.1, pesquisa, auditoria, runbook e interfaces foram lidos. Entrada:12 modificados+25 novos visíveis, staging vazio, sem agentes anteriores executando. Todos os28 hashes de fontes/testes/package e11 migrations conferiram com o pós-Task8.1;11 SQLs também conferiram com o HEAD-base. Snapshots e logs anteriores permanecem preservados.

Fronteiras relevantes:

- `server/src/config.ts`: `META_INSIGHTS_OAUTH_ENABLED` continua **false por padrão**; não é controle de rede. `META_GRAPH_API_VERSION` tem defaultv26.0.
- `server/src/metaInsightsClient.ts`: descriptor fixa host `graph.facebook.com`, versão `v26.0`, GET/edge insights, IDs e seleção validados. `InsightsTransport(descriptor,credential,signal)` retorna `{status,body}`. Não tem implementação HTTPS nem fallbackfetch.
- `server/src/{facebookInsightsClient,instagramInsightsClient}.ts` e `shared/insightsContract.ts`: queries/normalização já aprovadas. Page token no Facebook; **Facebook User token** no Instagram via Facebook Login. Não migrar para Instagram Login.
- `server/src/{insightsRepository,insightsService}.ts`: associação UUID local/tenant/conta/destino, credencial cifrada e revalidação de autoridade. O transporte futuro não recebe autoridade para escolher Workspace nem descobrir objetos externos.
- `server/src/app.ts`: só passa `insightsTransportForTests`, recusado fora de `NODE_ENV=test`. Execução normal não injeta adaptador ou fake. Core sem transporte→`transport_blocked`; `server/src/insightsHttp.ts`→**503 `meta_insights_not_enabled`** para alvo autorizado/elegível. Erros de grant/objeto/sessão podem ocorrer antes, com seus próprios códigos.

Essa é confirmação estática local, não inspeção do processo Debian ou das flags efetivas em produção. A versão auditada é a fixa dos clients; não foi carregado `.env` nem confirmado deployment. Nenhuma linha de aplicação/teste/configuração foi alterada nesta Task.

## 2. Fontes oficiais e qualidade da evidência

Consulta pública em22/10/2026. O navegador retornou429/indisponibilidade e as buscas dirigidas não trouxeram resultados. HTTPS público autorizado recuperou o conteúdo abaixo, sem fornecer cookies/tokens. Scripts das páginas não foram executados. Redirects do leitor documental não autorizam redirects de um adaptador com credenciais.

| Ref. | Fonte oficial consultada | Confirmação / limite observado |
| --- | --- | --- |
| S1 | [Secure Requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US) | TLS, HMAC-SHA256 do token com App Secret e exemplo multipart POST com access_token/appsecret_proof/batch no corpo externo. Exemplo genérico, não Insights. |
| S2 | [Batch Requests](https://developers.facebook.com/docs/graph-api/making-multiple-requests/?locale=en_US) | Até50 operações, respostas na ordem solicitada e quota contada por operação; token de topo, GET relativo e lote parcial. Não contém demonstração específica das quatro edges. Uma operação no piloto é limite local, não limite Meta. |
| S3 | [Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US) | GET, Page token, ANALYZE, grants, media_view e resposta data/paging. A tabela de erros inclui80001. Menção a Batch apenas na navegação recebida. |
| S4 | [Post Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/post/insights/?locale=en_US) | GET/metric/period/data/paging e erros; não especifica transporte completo token+proof via Batch ou headers. |
| S5 | [Instagram Account Insights](https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights) | Separa logins/tokens/hosts; Facebook Login exige Facebook User token. Referev26.0, views/day/total_value; não confirma Batch/proof/header. |
| S6 | [Instagram Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) | GET/metric/User token, formatos/children, ausência e resposta lifetime. Não confirma Batch/proof/header; tabela de parâmetros e seção de resposta não são equivalentes quanto a period. |
| S7 | [Access Tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/?locale=en_US) | Tipos Page/User e token por ativo; não resolve o canal de proof sem URL para essas consultas. |
| S8 | [Graph Overview](https://developers.facebook.com/docs/graph-api/overview/?locale=en_US) | Host/HTTPS/objetos/versão; não resolve proof em headers ou compatibilidade específica Batch. |
| S9 | [Using Graph API](https://developers.facebook.com/docs/graph-api/using-graph-api/?locale=en_US) | Conteúdo recebido com título Overview; não contou como confirmação independente de transporte. |
| S10 | [Instagram Overview](https://developers.facebook.com/documentation/instagram-platform/overview) | Facebook Login é Page-linked; regra genérica de tokens não substitui S5/S6. Nenhuma prova operacional Batch encontrada. |
| S11 | [Instagram Insights guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/insights/?locale=en_US) | Reconfirma tokens/grants específicos. Não confirma a composição completa investigada. |
| S12 | [Versioning](https://developers.facebook.com/docs/graph-api/guides/versioning/?locale=en_US) | Documenta v26.0 e versão explícita no path. A leitura não resolveu herança/override de versão das operações Insights em Batch. |

Registro de observações/URLs e hashes de textos quando capturados: [task-9-official-evidence.json](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-9-official-evidence.json). Não são atestação da API real. A ausência de um termo não basta: foram conferidas as seções de requisição/requisitos/resposta, não apenas buscada a palavra Batch. Não foram usados terceiros, SDK genérico ou links de navegação para liberar uma edge.

## 3. Matriz endpoint-específica

Todos são endpoints lógicos Graph emv26.0, não URLs aceitas do browser. `access_token` aparece como parâmetro nos exemplos/referências; isso **não** é autorização para copiá-lo para uma query no SocialFlow. O único corpo token+proof confirmado emS1 é Batch genérico.

| Família / endpoint | Método, token e requisitos | Consulta candidata / resposta | Lacuna de transporte / classificação |
| --- | --- | --- | --- |
| Facebook Page `/{page-id}/insights` | GET; Page token da Page; read_insights/pages_read_engagement, ANALYZE; pages_show_list como dependência da auditoria aprovada | metric=page_media_view,period=day,since/until; data com valores temporais e paging. S3 requer Page elegível e janela válida | Falta comprovar Batch+token+proof no corpo externo emv26.0 para esta edge. **BLOQUEADO** |
| Facebook Post `/{post-id}/insights` | GET; Page token da Page dona. S3 fornece a base Page/Page-post; S4 confirma a edge, não uma tabela autônoma de grants | metric=post_media_view,period=lifetime; data/paging. Usar feed post ID final, não photo/video/container/local post UUID | Mesma composição ainda não confirmada; não presumir equivalência de objetos. **BLOQUEADO** |
| Instagram Account `/{ig-user-id}/insights` | GET; **Facebook User token**; instagram_basic/instagram_manage_insights/pages_read_engagement, dependências aplicáveis, Business/Creator ligado à Page | metric=views,period=day,metric_type=total_value,since/until; data/total_value. S5 distingue períodos/tipos | S5/S11 não comprovam transporte completo em Batch, nem proofheader. **BLOQUEADO** |
| Instagram Media `/{ig-media-id}/insights` | GET; mesmo User token; grants IG e prova de vínculo/owner/top-level/formato da própria mídia | metric=views; period=lifetime interno, omitido no wire inicial; data/values conforme S6. Só IMAGE própria elegível no piloto inicial | S6 não comprova Batch+proof; ownership isolado não resolve elegibilidade. **BLOQUEADO** |

Permissão solicitada≠grant efetivo≠App Review/acesso aprovado. Dashboard, Standard/Advanced Access, Business Verification e ativos reais não foram verificados. Permanecem as condições IG via Business Manager (ads_management/ads_read) e a divergência da dependência pages_read_user_content documentadas na [auditoria](meta-insights-task-7-final-audit.md#6-matriz-de-permissões-e-acesso). Nenhum scope foi alterado para tentar resolver isso.

Erros documentados emS3/S4 incluem100/190/200/3001; S3 também80001/104/2500. Nem todo erro documental tem mapeamento dedicado no core atual: fallback sanitizado é preservado, sem alterar clientes nesta entrega. S6 pode retornar ausência ou erro dependente do objeto; não converter qualquer401/403 em sessão local expirada nem deduzir grant só pelo texto de erro.

## 4. Alternativas e gate de decisão

| Alternativa | Evidência | Decisão nesta execução |
| --- | --- | --- |
| POST Batch com segredos no formulário externo | S1+S2 comprovam mecanismo genérico, token de topo e operação GET relativa | **Candidato preferencial**, mas composição por edge/v26 insuficiente. Sem adaptador. |
| Authorization Bearer em GET + proof | Não foi obtida prova completa para o conjunto por família; falta canal comprovado de proof | Não inventar suporte nem afirmar que Bearer é universalmente rejeitado. |
| Header dedicado de proof | Nenhuma evidência suficiente encontrada nas fontes examinadas | Não criar X-Appsecret-Proof ou equivalente. |
| Body em GET direto/interno | Não comprovado; S2 distingue body de operações POST/PUT | Rejeitado para este desenho. |
| POST direto /insights ou method override | Não comprovado porS3–S6 | Não contornar o método documentado. |
| Token/proof na query, SDK ou Explorer como fallback | Não atende à política local ou não prova a combinação específica | Rejeitado; nenhum fallback silencioso ou SDK novo. |

Não há nesta Task família com status TRANSPORTE CONFIRMADO DOCUMENTALMENTE, IMPLEMENTADO LOCALMENTE NÃO VALIDADO NA META ou PENDENTE APENAS DE PILOTO. O bloqueio é de evidência suficiente, não um finding novo de vazamento no código aprovado. F8-1 continua **fechado**.

## 5. Protocolo futuro do candidato Batch — não implementado

Esta seção especifica o que um experimento/adaptador **futuro autorizado** deverá provar; não é código, teste executado ou nova autorização. O [protocolo anterior](meta-insights-task-8-transport-validation.md#5-protocolo-de-testes-locais-futuro--não-implementado) permanece aplicável, com F8-1 já corrigido.

| Item a verificar | Política local proposta / condição de aceite |
| --- | --- |
| Envelope e versão | Candidato único inicial: POST HTTPS `graph.facebook.com/v26.0/`, uma operação GET relativa `{id}/insights?...`. Confirmar oficialmente ou em experimento explicitamente autorizado a versão efetiva/proof/token por edge. Não tentar outra versão/forma automaticamente. |
| Token externo | Um token capturado por requisição: Page paraFB, User paraIG; nenhum token individual interno ou mistura de tenants. S2 admite token de topo genericamente, não certifica as quatro consultas. |
| Proof | HMAC-SHA256 com **mensagem=accessToken e chave=AppSecret**, server-side; token/proof exclusivamente em campos multipart externos, nunca URL relativa/externa/header inventado. Não derivar proof de token diferente nem usar token sintético como evidência real. |
| Encoding e autoridade | `batch` é JSON serializado; parâmetros públicos da operação são codificados separadamente e allowlisted. Descritor é validado; URL/host/versão/credencial do browser não entram. Transporte não faz autorização de Workspace. |
| Sucesso | Outer2xx é apenas envelope. Exigir array de cardinalidade1, item válido, status inteiro e body string JSON válido. Só inner2xx com payload válido chega ao parser da família. |
| Falha externa vs interna | Preservar status/body Graph estruturado validado de onde ocorreu a falha, sem repassar HTML/corpo bruto/cause. Inner403 sob outer200 não é sucesso. Nunca transformar HTTP401Meta em401da sessão local automaticamente. |
| Quota | Preservar códigos numéricos4/17/32/613/80001; F8-1 do core já os classifica. Não coagir strings nem procurar80001 em message/subcode. **Zero retries automáticos**, inclusive em429/null/timeout; cada operação consome quota conformeS2. |
| Parcial/incompleto | Null, item ausente/extra ou lote malformado não viram dados/zero. S2 descreve null para operação não concluída; política local para uma operação é falhar sem reenviar. |
| Paginação | Não seguir paging.next nem cursores como URL. Se existir próxima página sem completude comprovada, parar o caso e não afirmar DTO completo. Isso pode bloquear respostas válidas; decidir semântica/solução antes de qualquer liberação. Não alterar contrato público para acomodá-la sem autorização. |
| SSRF/redirect | Host/HTTPS/443 fixos; sem userinfo, host override, traversal, proxy ou URL Graph arbitrária. Recusar301/302/307/308 sem reenvio, mesmo para o mesmo host. Não herdar credenciais em redirects. |
| Tamanho | Proposta conservadora: até1MiB de envelope e até1MiB do body interno decodificado; leitura incremental antes de JSON.parse, além do limite atual1000pontos. A proposta de compressão inicial é solicitar identity e recusar compressão; se houver suporte futuro, limitar também bytes descompactados. Esses limites de rede ainda não existem. |
| Timeout/abort | Reutilizar o signal do core e sua deadline máxima10s; cobrir envio/headers/leitura, destruir I/O e remover listeners/handles. Não competir com a deadline do core de modo que timeout vire falha genérica. Observar rejeições tardias, não entregar dados após abort. Não prometer cancelamento físico da Meta/SQL. |
| Segredos | Sem logs de formulário/headers/URLs de retorno/Graph raw/PII, erro cause ou abort.reason. HMAC e tokens nunca em DTO; registrar apenas estado sanitizado, sem trace/cursor/identificadores externos desnecessários. |
| Isolamento | Sem cache global/token mutable compartilhado; concluirFB/IG/tenants em ordem invertida nos testes. Revalidação de sessão/membership/conta/credencial continua no service, fora do transporte e sem transaçãoHTTPS longa. |
| Ativação | Adaptador privado isolado, dependênciaHTTP injetável, Node22 strip-only, sem timer/job/import-side-effect. Não ligar a `insightsTransportForTests`. Qualquer futura ativação exige controle backend explícito/fail-closed separado da flagOAuth; não criado/configurado aqui. |

Não há necessidade aprovada de mudar OAuth, repository, service ou endpoints. Um futuro módulo `server/src/metaInsightsBatchTransport.ts` e teste correspondente seriam apenas **proposta de caminhos**, não arquivos criados. Se limites/paginação/erros exigirem mudar interfaces aprovadas, apresentar o diff/necessidade e obter nova autorização antes.

## 6. Experimento técnico e quatro pilotos futuros

Procedimento completo: [runbook atualizado](meta-insights-pilot-runbook.md). Primeiro obter confirmação específica da Meta ou autorização **nova** para investigar essa composição ainda incerta num executor isolado, não conectado às rotas públicas. Nenhum executor existe hoje. A autorização deve cobrir sua preparação/revisão e a primeira chamada autenticada; esta Task não a concede.

Ordem proposta A→B→C→D. Para cada ficha: ativo de teste autorizado e previamente identificado, grants atuais, token correto, associação segura, corpo/versão exatos aprovados, logs redigidos e orçamento. Uma métrica por ficha e **uma chamada Insights**;até4 no conjunto, sem retry/paginação. Preflight de grants/owner/top-level tem endpoints e orçamento próprios a aprovar; sem isso, orçamentozero e piloto bloqueado. Não criar/publicar conteúdo para preparar os ativos.

Cada ficha diferencia sucesso de transporte, compatibilidade da edge, resposta vazia legítima e prova do formato de dados disponíveis. Zero só se explicitamente retornado. Parar em segredo, contexto/objeto divergente, erro inesperado, quota ou resposta incompleta, sem mudar token/escopo/transporte. Sem Reels, Stories, carrossel/filhos ou mídias externas na primeira rodada. Smoke de produto e deploy continuam etapas separadas.

## 7. TDD, revisão e verificação desta entrega

**Nenhum adaptador/teste `.ts` foi criado, portanto não houve RED/GREEN de transporte, build/lint ou suíte nova nesta Task documental.** Não usar os mocks aprovados anteriormente como prova de rede. Se a autorização/prova futura permitir código: primeiro RED para as quatro famílias, tokens Page/User, vetor HMAC independente, encoding, outer/inner/parcial/JSON inválido,80001/quotas,token/grant,timeout/abort/redirect/tamanho/paginação/segredos/concorrência; GREEN mínimo, regressão clients/HTTP, Node22/build/lint e revisão independente antes de ligar qualquer via real.

Os resultados Task8.1 são **históricos preservados**, não reexecutados:357FE/1726BE=2083, incluindo707PG/21arquivos;567focados/430OAuth-clients são subconjuntos. Build/lint/typecheck/runtime aprovados naquela rodada; nenhum hash de aplicação/teste mudou aqui. Timeouts/IO e causa histórica do Coordinator continuam documentados, não corrigidos ou reatribuídos nesta Task.

O [parecer independente](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-9-review.md) aprovou **somente a entrega documental**, com0Critical/0Important/0Minor. Também conferiu39 hashes sem divergência, defaults e bloqueio estático; não certificou Meta real. Gates e limitações estão no [relatório Task9](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-9-report.md): links/whitespace, `git diff --check`, hashes de fontes/testes/configurações comparáveis e11SQLs, HEAD/branch/index. Produção não foi inspecionada; nenhuma configuração real foi alterada.

## 8. Conclusão e próxima decisão

**BLOQUEADO** para implementar transporte das quatro famílias sob o gate solicitado. Pesquisa/protocolo podem ser concluídos com essa restrição explícita; não há nova integração real funcionando.

Próxima ação mínima: encaminhar à Meta uma pergunta concreta sobre `GET /v26.0/{objeto}/insights` por família com **Page tokenFB / Facebook User tokenIG** e token+proof apenas no multipart externo do Batch, incluindo regra de versão, ou autorizar por escrito um experimento isolado que reconheça essa incerteza. Não enviar credenciais ao suporte/relatório. Confirmar permissões/ativos em etapa separada e só então discutir implementação/piloto. Encerrar aqui; sem7B, endpoint adicional, OAuth, banco, Gitmutation ou deploy.
