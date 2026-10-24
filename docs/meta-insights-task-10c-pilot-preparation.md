# Task 10C — driver nativo protegido e preparação do primeiro piloto

22/10/2026. Branch `feat/socialflow-7a-meta-insights`, HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c`. Continuação das [mecânicas HTTPS 10B](meta-insights-task-10b-https-executor.md) e do [experimento 10A](meta-insights-task-10a-experiment.md). **Não houve piloto nem chamada autenticada.**

## 1. Implementação e fronteira de confiança

```text
plano Page imutável → consentimento SIMULATION_ONLY, em memória
 → provider síncrono de credenciais sintéticas
 → executor 10B (multipart, uma operação GET, parser 10A)
 → adaptador de node:https com validação/cópia de opções
 → testRequest explicitamente injetado (somente fake nesta Task)

node:https.request nativo → BLOQUEADO antes de qualquer chamada
rotas SocialFlow → nenhum import do experimento → 503 default preservado
```

- `server/experiments/metaInsightsNativeHttpsDriver.ts`: referência ao módulo nativo, allowlist exata de RequestOptions/headers e cópia canônica. HTTPS/Meta/443/SNI/v26.0/POST, TLS verificado com mínimo1.2, agent individual (`false`), sem DNS/CA/proxy/host configuráveis. Nunca admite o builtin nesta revisão, nem quando passado diretamente como dependência de teste. Sem conexão, timer ou log no import/factory.
- `server/experiments/metaInsightsPagePilot.ts`: plano congelado, fingerprint SHA256 apenas de metadados não secretos, finalidade fixa, aliases de operador/ativo, expiração5min, orçamento1. Consentimento emitido em memória (WeakMap), preso à identidade do plano e aos seus metadados; cópia JSON/objeto forjada não vale. Plano e consentimento são consumidos na admissão antes da fonte de credencial, inclusive se ela falhar. Dois consentimentos não permitem duas tentativas no mesmo plano.
- Reutiliza, **sem editar**, executor10B e builder/parser/HMAC10A. Eles fornecem codificação multipart nativa, GET interno fixo, limite32KiB de envio/1MiB de recebimento, deadline total≤10s, AbortSignal/destroy, proteção contra respostas/erros tardios e ocupação até finish+close. Não há retry, paginação, redirects ou fila automática.
- `tsconfig.native.json`: typecheck próprio dos experimentos/testes; o build da aplicação não os inclui.

DI é fronteira confiável de código: o nome `testRequest` não prova que uma função arbitrária é falsa. Um desenvolvedor poderia escrever uma função que conecta; isso não é permitido nesta Task. Todos os testes injetam streams/EventEmitters locais. Prefixo `SYNTHETIC_` é política de teste, não verificação criptográfica de validade de token. Os testes não comprovam TLS físico ou comportamento da Meta.

Não há CLI real, leitor de env/TTY/arquivo/DB, integração às rotas ou mecanismo que habilite rede por flag. Mesmo com modo `real`, variáveis de ambiente, consentimento e credenciais, o caminho normal é `real_execution_blocked` **antes da fonte de segredos**. O CLI DRY-RUN10A permanece inalterado. Consentimento de simulação **não é autorização humana de rede**. Implementar admissão real e uma entrada protegida de segredos exigirá tarefa/autorização separada.

## 2. Referências oficiais conferidas nesta Task

Consulta pública sem credencial em22/10/2026; nenhuma Graph API autenticada:

| Fonte primária | Evidência e limite |
| --- | --- |
| [Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US) | Page Access Token, pessoa com tarefa ANALYZE, read_insights e pages_read_engagement. page_media_view aceita day/week/days_28; candidata significa reproduções/exibições, não reach ou garantia de disponibilidade. Page≥100likes, janela since/until≤90dias, dados até2anos e atualização usual diária. Configuração local não comprova esses requisitos |
| [HTTPS Node22.23.3](https://nodejs.org/download/release/v22.23.3/docs/api/https.html#httpsrequestoptions-callback) | API request e opções TLS. O adaptador conserva validação de certificado e não admite overrides; execução física ainda não testada |
| [HTTP Node22.23.3](https://nodejs.org/download/release/v22.23.3/docs/api/http.html) | agent:false usa agente individual; proxyEnv é opção explícita/defaultundefined. Não admitir agent/proxyEnv alternativos nem depender do agente global |

Evidência pública/hashes em `task-10c-evidence.json` no ledger. A [pesquisa de transporte Task9](meta-insights-task-9-safe-transport.md) e a referência Batch/SecureRequests já revisada continuam válidas no seu escopo: multipart externo token+proof+batch é documentado genericamente. **Isto não comprova que essa composição funcione na edge Insights específica.** Não presumir equivalência com urlencoded, GET com body, header de proof ou fallback query. A Task10C não remove essa pendência.

`pages_show_list` é dependência de descoberta/contrato do client existente; não aparece como permissão direta na referência Page Insights consultada. Exigir evidência para a arquitetura atual sem reescrever a exigência oficial da edge. App Review/Standard/Advanced Access, modoDevelopment, papéis e Business Verification devem ser conferidos no contexto exato da App, usuário e ativos; não são comprovados por esse driver.

## 3. Pré-requisitos ainda NÃO verificados

O plano contém somente status `not_verified` para tokenKind, grants efetivos, ANALYZE, elegibilidade, acesso da App e composição Batch. Não aceita flags locais declarando concessão como prova. Validação local é sintaxe de ID decimal, métrica/versão/período fixos, janela de datas e aliases; **não** comprova posse/tenant/eligibilidade do ativo.

Operador precisará preparar, sem revelar valores secretos no chat/terminal/relatório:

- Metadados não secretos: alias e identidade do operador autorizado, alias da Page de teste, PageID exato em registro restrito, finalidade, métrica `page_media_view`, v26.0, day, início/fim UTC de dia completo recente, limite e expiração do consentimento.
- Evidências verificáveis: vínculo do operador/ativo autorizado, PageToken adequado, grants efetivos `read_insights`/`pages_read_engagement`, descoberta `pages_show_list` conforme contrato, tarefa ANALYZE, elegibilidade da Page e disponibilidade, modo/acesso/review da App. Sem autenticação autorizada, esses fatos continuam pendentes. Não inferir do nome de variável ou escopo solicitado.
- Segredos para **futura interface protegida ainda não implementada**: Page Access Token e Meta App Secret exclusivamente em memória; derivar HMAC-SHA256 appsecret_proof no processo. Não enviar UserToken IG como PageToken, nem usar o PageToken para o piloto IG posterior. Não obter automaticamente do Debian/DB/env de produção, não passar em argv nem escrever arquivos.

Verificações autenticadas de grants/identidade não estão dentro do orçamento da única leitura Insights: exigem autorização/endpoints/orçamento próprios ou evidência anterior válida aceita pelo responsável. Sem isso, parar sem chamada.

## 4. Protocolo futuro — NÃO executar agora

1. Aprovar explicitamente uma tarefa de ativação isolada, reconhecer que Batch+edge ainda é experimento e revisar seu novo mecanismo de admissão real. Não basta env/flag/consentimento de simulação. Não ligar rotas ou OAuth do produto.
2. Responsável aprova por escrito o PageID exato (registro restrito), alias, operador, finalidade, versão/métrica/período/janela e fingerprint. Confirmar todos os pré-requisitos acima. Escolher uma Page existente autorizada; não publicar conteúdo para preparar o teste.
3. Conferir pacote/hash/Node22 e ausência de logs/APM/capturas de payload; prover segredos em memória por interface revisada futura. Não mostrar payload/requestoptions autenticados, token, secret, proof, URL Graph completa, cursor ou corpo bruto.
4. Preparar **uma** operação interna `GET {page-id}/insights?metric=page_media_view&period=day&since={inicio}&until={fim}`. POST externo fixo `https://graph.facebook.com/v26.0/`, multipart externo com token/proof/batch. Credenciais nunca na relative_url. Body≤32KiB, response≤1MiB, TLS verificado, deadline10s, sem redirects/retry/paginação/parallelismo.
5. Consentimento real futuro deve ser explícito e consumível, preso ao pacote/operador/ativo/finalidade/operação/expiração/orçamento1. O plano atual prepara esses metadados, mas não implementa tal autorização de rede. Uma falha consome a tentativa: nenhuma nova consulta sem nova aprovação.
6. Avaliar HTTP externo **e** code/body da única operação interna; externo200 não é sucesso interno. Rejeitar null, cardinalidade diferente, payload parcial/inválido, encoding inesperado, paginação ou resposta acima do limite. Não alterar parser durante a consulta para aceitar forma desconhecida.
7. Registrar só UTC/alias/operador/versão/métrica/período/janela/latência/status externo+interno/categoria e identificador de evidência sanitizada. RealMetaValidated só poderá ser marcado por um procedimento futuro com evidência real; nesta implementação é sempre false.
8. Sucesso: origem real e objeto autorizado, resposta completa/compatível e nenhum segredo exposto. Zero é válido somente quando retornado explicitamente. Vazio legítimo é not_available, não zero; pode validar semântica de vazio, não o formato de uma série disponível.
9. Permissão/token: parar, classificar permission_required/token_expired, não reconectar/apagar token/pedir scopes automaticamente. Rate limit HTTP429 ou Graph4/17/32/613/80001: parar, registrar rate_limited sem retry. Batch recusado pela edge: registrar incompatibilidade/não comprovado e pedir nova decisão; não trocar método/token/header/query/host como fallback.
10. Interromper imediatamente em segredo em URL/log/erro, TLS/redirect/timeout/abort, ativo divergente, resposta nova/parcial, impacto no produto ou tentativa extra. Abort local destrói IO e suprime entrega; não prova que a Meta não recebeu/processou a leitura. Não repetir para compensar timeout.

Expansão futura somente com aprovação independente por família: Post usa feedPostID final comprovado e PageToken; IG Account usa Facebook **UserToken** no fluxo Facebook Login; IG Media usa ID final, vínculo/owner **e** top-level/formato elegível. Não incluir mídia externa, children/carrossel, Stories ou Reels na primeira rodada. Nada nesta Task libera essas famílias, nem prova produção.

## 5. Segurança, testes e limitações

Testes sintéticos cobrem opções TLS/host/porta/método, Batch, HMAC já preservado10A, erros DNS/TLS/socket, timeout/abort/late-response, limites,429/80001/190/200, null/JSON/redirect, consentimento/expiração/forja/budget, segredo ausente e defaultfailclosed. Imports são conferidos pelo Node22 sem recursos adicionais. Fixtures têm apenas tokens `SYNTHETIC_`.

Não há autoridade multi-tenant no driver: não é endpoint e só recebe plano criado por código confiável do experimento. Associação Workspace/conta/grants será pré-requisito humano/tarefa futura; não expor esse helper a entrada pública. Proteção de ocupação é por processo10B, não lock distribuído. Secret strings em JS não têm garantia de zeroização; não prometê-la. Nenhum dado simulado deve ser entregue pelas rotas como real.

Resultados e revisão independente serão consolidados em `task-10c-report.md` e `task-10c-verification.json` no diretório `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/`. Suítes globais/PG não são necessárias nesta fatia se hashes provarem produto/fixtures anteriores intactos. Migrations001–011 não são executadas ou editadas.

**Preparação local não é piloto autorizado nem integração real funcionando. Aguardar autorização separada.**
