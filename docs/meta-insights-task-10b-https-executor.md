# SocialFlow 7A — Task10B: executor HTTPS isolado

22/10/2026. Branch `feat/socialflow-7a-meta-insights`, HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c`. **Executor experimental local; nenhuma chamada autenticada real autorizada ou executada. Não conectado ao SocialFlow.**

## 1. Escopo e composição

Continuação do [experimento10A](meta-insights-task-10a-experiment.md), sem alterar seus fontes, testes ou CLI. Arquivos novos:

- `server/experiments/metaInsightsBatchHttpsExecutor.ts`: mecânica de request/response compatível com `https.request`, executada somente com dependência falsa explícita nesta entrega.
- `server/experiments/tsconfig.https.json`: typecheck próprio, incluindo os dois testes experimentais, sem mudar configuração do produto.
- `server/test/metaInsightsBatchHttpsExecutor.test.ts`: fake do limite Node IO, usando streams/eventos reais e valores sintéticos.

Fluxo:

```text
execute(PageProbe, credencial sintética, modo simulation explícito)
  → validação local + one-shot + exclusão mútua no processo
  → runner/builder/HMAC10A
  → FormData multipart → bytes limitados
  → dependência simulationRequest(RequestOptions fixos)
  → leitor Node limitado + destroy em fim/erro/abort
  → parser externo/interno10A e clientFacebook já aprovados
  → relatório sanitizado, simulated=true, realMetaValidated=false
```

O módulo importa tipos Node, **não importa nem conecta `https.request` nativo**. A dependência fake é fornecida pelo teste; não existe driver padrão, fallbackfetch, mecanismo de secrets, comando de rede ou ativação por env. O código prepara a mecânica necessária para uma futura vinculação nativa revisada, não uma via de piloto pronta. Um programador capaz de injetar funções arbitrárias é uma fronteira confiável de código, não um usuário autorizado pelo produto: o nome simulationRequest não prova matematicamente que uma função não faz IO. Nesta Task todas as dependências injetadas são falsas, e o executor adicionalmente recusa credenciais sem marcador sintético e tokens de User.

O CLI10A continua somente DRY-RUN; não chama este executor. Imports são inertes: nenhuma requisição, conexão, timer, servidor, scheduler ou SQL. Nenhum import da aplicação aponta para experiments. Reutilizar parsers não altera autorização/repository/service/rotas.

## 2. Formato Graph Batch e evidência

Pesquisa pública dirigida em22/10/2026, sem credenciais ou scripts de páginas. O browser não abriu as três referênciasMeta; HTTPS público recuperou conteúdo. A [referência PageInsights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US) continua listando page_media_view/day como candidata; a elegibilidade da Page real não foi verificada.

| Fonte | Evidência recuperada | Limite |
| --- | --- | --- |
| [Secure Requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US) | Exemplo curl-F com access_token, appsecret_proof e batch no formulário externo; HMAC-SHA256 com token como mensagem | Mecanismo genérico, não PageInsights/v26 operacional |
| [Batch Requests](https://developers.facebook.com/docs/graph-api/making-multiple-requests/?locale=en_US) | GETs relativos, body interno como stringJSON, respostas null e exemplos multipart; também há exemplos com query | Exemplos que põem segredos em query NÃO são adotados; exemplos de escrita NÃO são implementados |
| [HTTPS Node22.23.3](https://nodejs.org/download/release/v22.23.3/docs/api/https.html#httpsrequestoptions-callback) | RequestOptions TLS e ClientRequest; agentfalse evita uso do agente global | Mecânica da plataforma, não compatibilidadeMeta ou handshake testado |
| [TLS Node22](https://nodejs.org/docs/latest-v22.x/api/tls.html#tlsconnectoptions-callback) | rejectUnauthorized verifica certificado e há verificação de hostname padrão | Página servida v22.23.4; runtime local verificado22.23.3. Não foram alteradas versões/dependências |

**Decisão: multipart/form-data externo**, com boundary e escaping gerados pelo encoder FormData/Request nativo e Content-Length exato. Não usar multipart manual nem presumir que x-www-form-urlencoded seja equivalente por endpoint. Não há fallback para formulário URL-encoded, query token/proof, Authorization/proof header inventado, GETbody ou methodoverride. A versão externa fixa é v26.0; a herança efetiva de versão/proof/token na edge continua pergunta do futuro piloto.

O candidato tem exatamente um GET interno para `{page-id}/insights`, page_media_view/day e since/until validados; o externo é POST em `https://graph.facebook.com:443/v26.0/`. O sucesso de multipart genérico não comprova que a Meta aceite Insights nesse envelope. Manter as quatro famílias bloqueadas para uso real.

## 3. Garantias locais implementadas

- Destino HTTPS/host/porta/path/método e SNI fixos. Nenhuma URL/host/versão/operação arbitrária é aceita; o builder rejeita propriedades extras, writes e múltiplas operações. Sem URLs autenticadas em relatórios.
- RequestOptions impõem rejectUnauthorized=true, mínimoTLS1.2, agente individual `false`, headercap16KiB, sem CA/lookup/proxy/createConnection/checkServerIdentity customizável. O callback ainda exige socket encrypted/authorized. TLS failure é erro seguro, sem desabilitar verificação. Esses são testes da política/options/eventos, não handshake real.
- Apenas tokenKind page com token/secret sintéticos limitados (8192/1024 caracteres, prefixoSYNTHETIC_, sem controles); o HMAC usa credencial injetada em memória. Token+proof somente em campos do corpo externo; nenhum ambiente/CLI/DB/arquivo de credencial é lido. A interface não retorna o formulário nem a credencial.
- Limites: request32KiB; envelope1MiB incremental; advertised Content-Length validado e tamanho final consistente; encoding identity-only/case-insensitive; corpo interno/parser limitado pela10A. Não descomprimir nem concatenar body ilimitado.
- Redirect3xx e quota429 são tratados sem seguir destino nem exigir parse de corpo. Outer200 não libera erro interno; Graph190/200/80001 e demais quotas continuam classificados pelo core aprovado. Null/extra/incompleto/paging não vira zero ou nova chamada. Zero explícito e ausência legítima continuam distintos.
- Timeout máximo10s e AbortSignal do runner10A cobrem encoding/envio/headers/body/parsing. Request/response são destruídos no término, erro ou abort; listeners de abort e deadline são removidos. Guards de error ficam até close para não propagar erro tardio de destruição. Não prometer que destroy cancela processamento já recebido pela Meta.
- Cada instância é one-shot depois de admitida: não há retry. Marker compartilhado bloqueia outra execução no processo até finalizar e observar close do request. Se o driver não emite close após destroy, o gate permanece fechado; não abrir concorrência por timeout. Não há fila, cache, token global ou coordenação entre processos. Um piloto futuro deverá ser um único processo/executor autorizado.
- `simulationRequest` deve ser fake nesta Task; não existe driver nativo padrão. Exigir modo simulation não autoriza rede e não aceita credenciais reais. Nem modo, env, OAuthflag ou CLI simples instala um driver ou libera o prefixo de credencial. Nenhuma ativação automática de Insights.

## 4. Relatório e execução local

O resultado contém apenas simulated, realMetaValidated=false, família, versão, método, localValidation, outcome, errorCategory, status externo/interno, durationMs e blockedReason. Validação local passada significa somente que input/credencial sintética/construção foram aceitos; `available` em simulação não é métrica real. Nenhum valor de métrica, IDGraph, URL autenticada completa, token, proof, secret, cookie, SQL, stack, rawbody, trace ou abort.reason aparece.

Sem driver: transport_blocked / simulation_driver_required, simulated=false e nenhum fake é apresentado como dado real. Com fake e modo explícito: simulated=true / realMetaValidated=false, com bloqueio real_pilot_not_authorized ainda registrado. Não há CLI próprio do executor. Comandos locais autorizados, sem carregar `.env`:

```bash
node ./node_modules/vitest/vitest.mjs run --config vitest.server.config.ts server/test/metaInsightsBatchHttpsExecutor.test.ts server/test/metaInsightsBatchExperiment.test.ts --no-file-parallelism
node ./node_modules/typescript/bin/tsc -p server/experiments/tsconfig.https.json
node server/experiments/metaInsightsBatchDryRun.ts
```

Nenhum desses comandos envia Graphautenticada. Não passar tokens como argumento ou exportá-los para reproduzir testes. Não substituir o fake por driver nativo nesta entrega.

## 5. Task10C futura — roteiro, não execução

1. Obter aprovação separada do responsável para preparar o vínculo nativo e o mecanismo de secrets/consentimento. Revisar código/gates antes de permitir credenciais não sintéticas; não basta variável de ambiente ou trocar um booleano. Não habilitar rotas do produto.
2. Aprovar operador/janela/ativoPage de teste já existente, uma operação page_media_view/day/v26.0, uma chamada sem retry/paginação, reconhecendo incerteza de Batch+Insights. Autorizar explicitamente endpoints e orçamento de qualquer preflight; sem aprovação, orçamentozero.
3. Conferir PageAccessToken válido, grants efetivos, ANALYZE, requisitos da Page/AppReview/acesso e associação autorizada ao ativo. Scope solicitado não é grant ou AppReview aprovado. Não buscar credenciais no banco de produção nem ampliar OAuth automaticamente.
4. Definir mecanismo server-side de injeção segura em memória, sem argv/log/repo/envproduction/captura. Revalidar o transporte nativo/options/TLS/proxy/segredos e mecanismo de autorização do piloto em revisão independente específica.
5. Rodar primeiro mocks/gates do pacote/hash candidato. Confirmar que CLI10A e rotas permanecem bloqueados e não há worker/scheduler produtivo no executor. A eventual interface real será nova, ainda inexistente e não autorizada por este documento.
6. Só com consentimento específico final, efetuar uma leitura e parar. Registrar alias/versão/métrica/período/janela/latência/status/errorCategory e autorização; nunca guardar resposta bruta ou segredos. Nenhum retry ou troca de token/path/encoding/métrica em caso de falha.
7. Aceitar a primeira resposta apenas quando TLS, status externos/internos, associação, grants, versão e shape estão comprovados, sem segredo/incompletude/paging. Ausência legítima pode validar caso vazio, não payload disponível; zero só se explicitamente retornado. SucessoPage não libera outra família ou produção.

Parar imediatamente em segredo/ID divergente, token de tipo errado, TLS/redirect, quota, JSON/encoding/tamanho inesperado, ausência de autorização, operação extra/escrita, incompletude ou impacto no produto. Não coletar body adicional para diagnosticar. Retomar somente por nova decisão do responsável, preservando evidência sanitizada.

Logs permitidos: relatório allowlisted e referência da autorização/alias local seguro. Proibidos: bodies/headers completos, token/proof/AppSecret, URLs retornadas/cursors/PII, abort.reason, causa/stack de dependências, screenshots de credenciais e secrets em history. A interface programática interna recebe somente contexto/ativos que o operador já autorizou; não é mecanismo de membership do produto.

## 6. Expansão e pendências

FacebookPost precisa de feedPostID final/vínculoPage e métrica própria. InstagramAccount/Media via FacebookLogin exigem **Facebook User Access Token**, novos testes/contratos experimentais específicos e autorização independente; o executorPage atual os recusa. Media precisa de IDfinal IMAGE próprio e owner+top-level/formato, não ownership isolado. Sem Reels/Stories/children/externos nesta rodada.

Pendentes: composição real Batch+proof+edge/v26, grants/ativos, vínculo nativo HTTPS e validação física de TLS/destroy, mecanismo seguro de secrets e autorização10C. Nenhum teste mock remove esses gates. A infraestrutura do produto, migrations001–011 e o scheduler não foram alterados.

Resultados consolidados no [relatório](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-10b-report.md), [manifesto](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-10b-verification.json) e [parecer independente](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-10b-review.md). Gates locais:135/135 (68executor+67Task10A), zero falhas/skips, typecheck experimental/build/lint aprovados. Revisão sem Critical/Important; observação Minor de cobertura fechada com teste persistente e retorno read-only. Resultados são somente simulados, sem handshake real ou compatibilidade Meta certificada.

**EXECUTOR LOCAL APROVADO COM RESTRIÇÕES.** Não declarar integraçãoMeta ou7A concluída; encerrar10B e aguardar autorização para10C.
