# SocialFlow — runbook futuro de piloto Meta Insights

**Adendo Task10B — 22/10/2026:** [executor HTTPS isolado e roteiro futuro10C](meta-insights-task-10b-https-executor.md). A mecânica de ClientRequest/IncomingMessage foi preparada para dependência falsa explícita, com TLS/host fixos, multipart, limites, destroy, one-shot e exclusão mútua no processo. Não existe driver HTTPS nativo padrão nem CLI real; credenciais não sintéticas são recusadas. CLI10A continua DRY-RUN, rotas permanecem bloqueadas. Implementação/testes locais não comprovam compatibilidadeMeta ou handshake real e não autorizam10C; os gates/limites/registro/parada estão no novo documento. Os adendos anteriores são históricos preservados.

**Adendo Task10A — 22/10/2026:** [experimento sintético isolado](meta-insights-task-10a-experiment.md) preparado por autorização específica. Existe agora somente um executor DRY-RUN sem HTTP real, com tokens sintéticos e modo piloto incondicionalmente recusado. As afirmações anteriores de inexistência de executor descrevem o checkpointTask9; nenhum executor autenticado passou a existir. A composição Batch+Insights continua não comprovada. Este adendo não autoriza piloto, OAuth, rede de produto ou deploy e não substitui os gates abaixo.

**Task9 — 22/10/2026:** [decisão de transporte e protocolo isolado](meta-insights-task-9-safe-transport.md). Prova endpoint-específica ainda insuficiente nas quatro famílias; nenhum adaptador implementado. O primeiro experimento futuro não usa as rotas públicas nem a seam ForTests: exige executor isolado e autorização própria para a incerteza de transporte, preparação e primeira chamada. F8-1 permanece fechado. Nenhuma credencial, piloto ou ativação foi autorizada/executada aqui.

**Adendo Task8.1 — 22/10/2026: F8-1 FECHADO localmente.** A correção autorizada adicionou somente Graph80001 à classificação numérica de rate limits. RED→GREEN, revisão do delta e gates locais aprovados; consultar resultados e limitações no [relatório Task8.1](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-8-1-report.md). Não altera a prova de transporte, credenciais, escopos, limites ou necessidade de autorização deste runbook. Nenhum piloto foi executado.

Data:22/10/2026. **NÃO EXECUTADO / NÃO AUTORIZADO NESTA ENTREGA.** Este procedimento não habilita rede, OAuth, grants, credenciais ou deploy. A autorização atual é apenas documental. Base e conclusões: [auditoria final Task7](meta-insights-task-7-final-audit.md).

**Revisão Task8,22/10/2026:** [prova de transporte e protocolo](meta-insights-task-8-transport-validation.md). A preparação foi autorizada, **não a execução autenticada**. Primeira rodada limitada aos pilotos A–D abaixo, começando Post texto e IG IMAGE própria; o caso Reel anteriormente proposto foi retirado da primeira rodada. Transporte continua parcialmente confirmado por família. O findingF8-1 de classificação Graph80001 recebeu correção separada na Task8.1; isso não libera conexão do produto.

## 1. Autorizações e gates anteriores a qualquer chamada

São decisões separadas: (a) investigação controlada do transporte em ambiente de teste; (b) implementação do adaptador real; (c) smoke autenticado das quatro famílias; (d) liberação de produto/deploy. Não interpretar aprovação de uma como aprovação das demais. Se o piloto técnico servir precisamente para confirmar Batch+Insights, aprovar por escrito essa incerteza e os endpoints específicos antes de executá-lo; não conectar essa experiência ao fluxo normal do produto.

- Responsável autoriza contas/ativos de teste, janela, operador, endpoints, versão v26.0 e orçamento inicial **operacional** de chamadas (proposta:1 chamada por caso, sem retry automático). Registrar permissão de leitura, não de publicação. Não usar dados do PostgreSQL de produção nem acessar Debian sem autorização nova.
- Confirmar código/snapshot candidato, ambiente isolado e configuração sem scheduler de produção. Nunca usar NODE_ENV=test para liberar mocks como métricas reais. Nenhum endpoint produtivo deve ganhar transporte por fallback.
- App Dashboard: identificar app/use case, modo e níveis por permissão, papéis de app/testadores, Business Verification/Data Use Checkup e App Review aplicáveis. Registrar somente estados e identificadores internos de evidência, nunca segredo/screenshot de token. Não afirmar Advanced Access pela presença de um scope.
- Page de teste gerida pelo operador, task ANALYZE efetiva e requisitos Page Insights (incluindo limiar documentado de likes). Se não elegível, marcar caso bloqueado; não simular resultado. Instagram Business/Creator de teste ligado a Page elegível, mesmo usuário/conexão autorizados. Pessoal não é elegível.
- Esclarecer previamente ads_management/ads_read condicionais e a divergência pages_read_user_content da matriz geral de instagram_basic. Sem ampliação automática de privilégios, sem migração para Instagram Login.
- Antes de ligar a rede do produto: desenho revisado do transporte completo token+proof, testes de envelope/inner error/redirect/body-size/timeout/abort/quota/segredos e revisão independente. Sem evidência de transporte adequado, **parar**. Não colocar token/proof na query, nem inventar header.
- Task8 não confirmou uma alternativa completa por endpoint. Um piloto técnico para investigar Batch+Insights exige autorização específica que reconheça essa incerteza; uma aprovação genérica de smoke não basta. Não usar body de GET interno, POST direto /insights ou method override como fallback. Conferir o fechamento e os gates da correção F8-1 na Task8.1 antes do transporte do produto.
- Secrets somente no mecanismo server-side aprovado, fora de terminal/history/arquivo de relatório/captura HTTP. Evitar Graph Explorer/browser/proxy que capture URL/token/proof. Não mudar .env.production nem chave de criptografia.

## 2. Conferência de grants e tokens, sem revelar valores

Em execução futura aprovada, utilizar o callback existente e/ou verificação server-side autorizada de permissões, sob sessão/Workspace de teste. O relatório retém apenas `{scope,status}`, task ANALYZE presente/ausente, tokenKind page/user, validade temporal e vínculo de conta/conexão por aliases locais. Não imprimir access token, appsecret_proof, ciphertext, state, code OAuth, cookies, App Secret ou DSN. Não guardar resposta Graph bruta em log, APM, captura de tela ou fixture.

Verificar três evidências independentes: pedido OAuth explícito, grant efetivamente devolvido, acesso aprovado no Dashboard. Facebook exige read_insights/pages_read_engagement e dependência pages_show_list, Page token e ANALYZE. IG exige instagram_basic/instagram_manage_insights/pages_read_engagement e dependências aplicáveis, **Facebook User token**, não Page. Consentimento negado/expirado resulta em caso bloqueado, preservando publicação. Não forçar reconexão das contas antigas para ativar Insights.

Conferir expiração/invalidação usando fluxo oficialmente suportado e transporte seguro aprovado; jamais copiar token para serviço externo de diagnóstico. Usar aliases por ativo no relatório, sem permitir que um Graph ID arbitrário do browser seja fonte de autorização.

## 3. Casos de smoke — somente leitura, quatro gates independentes

As datas abaixo são escolhidas na ocasião: dias UTC completos recentes, até ontem, intervalo positivo pequeno e dentro das janelas locais. Não usar outubro2026 fixo numa execução futura. Accounts aceitam since/until; publications não aceitam datas. Começar com **uma métrica**, só ampliar depois de confirmar semântica e parser. As requisições abaixo são **operações Graph lógicas**, não comandos executáveis nem autorização para ligar produto. O primeiro experimento será isolado; as quatro rotas locais existentes só terão smoke de produto após autorização de integração separada. Se Batch for aprovado, um token e um GET interno por envelope; tratar erro interno mesmo quando HTTP externo200. Tokens/proof ficam apenas no corpo externo aprovado, nunca nas queries lógicas abaixo.

| Caso | Preparação e consulta futura | Evidência de aceite específica |
| --- | --- | --- |
| **A — Facebook Page** | Page de teste elegível (S3 requer100likes), UUID local/vínculo autorizado, Page token, ANALYZE e grants FB da seção2. Operação `GET /{page-id}/insights?metric=page_media_view&period=day&since={inicio}&until={fim}` | Uma chamada Insights. Confirmar transporte/v26 e série data/values com datas válidas. Ausência legítima deve permanecer null/not_available; não prova o formato de um valor disponível. Sem erro, segredo ou incompletude ignorada |
| **B — Facebook Post texto** | Post próprio já existente, destino published e feed.id final comprovados, Page token e grants FB. Operação `GET /{post-id}/insights?metric=post_media_view&period=lifetime` | Uma chamada Insights. Confirmar vínculo Page/post/tenant e data/values de lifetime ou ausência legítima. Sem photo.id/video/container/unknown/legado sem destino. Não criar publicação para esse piloto |
| **C — Instagram Account** | Business/Creator de teste ligado à Page autorizada, UUID/vínculo comprovados, **Facebook User token** e grants IG da seção2. Operação `GET /{ig-user-id}/insights?metric=views&period=day&metric_type=total_value&since={inicio}&until={fim}` | Uma chamada Insights. Confirmar conta/host/v26 e data/total_value compatível, sem trocar por Page token. Views é candidata e consta como métrica em desenvolvimento emS5; disponibilidade real deve ser confirmada, não inferida |
| **D — Instagram Media IMAGE própria** | JPEG própria de teste já existente, ID final media_publish, operação succeeded e prova atual owner/top-level/formato; User token e grants IG. Operação `GET /{ig-media-id}/insights?metric=views` | Uma chamada Insights. Confirmar vínculo e data/values com lifetime; omitir period no wire conforme gate local. Ausência não vira zero. Nenhum child/container/externo ou ownership isolado autoriza a leitura |

S3/S5 referem-se às fontes da [Task9](meta-insights-task-9-safe-transport.md#2-fontes-oficiais-e-qualidade-da-evidência). `{inicio}`/`{fim}` são timestamps Unix de janela previamente validada. As métricas são candidatas documentais, não promessas para todo ativo/conta. A forma do Batch, versão efetiva por operação e herança token/proof continuam objetos do experimento futuro, não certezas. Fixar por escrito **uma** forma antes da chamada e parar se falhar; não testar outro token/path/método automaticamente. Se paging.next exigir coleta adicional sem completude comprovada, registrar incompleto e bloquear entrega de DTO completo, sem paginação silenciosa.

Não criar posts para viabilizar este runbook de leitura. Se não existir um ativo próprio com histórico/proveniência suficientes, registrar bloqueio e solicitar uma preparação separada ao responsável. Facebook Reel/video, **Instagram Reel ainda não validado**, mídia externa, carrosséis/filhos e Stories **ficam fora desse piloto inicial**. Não chamar endpoints Graph arbitrários para tentar descobrir equivalências. Prova local de publicação não é verificação universal de ownership/top-level; confirmar conta/objeto no ambiente controlado e interromper em qualquer divergência, sem adicionar bypass ao service.

Orçamento futuro proposto: **uma chamada Insights por ficha autorizada, no máximo quatro no conjunto A–D**, sem retry automático ou paginação automática. Preflight de grants/identidade/ownership não está incluído nesses quatro: exige lista de endpoints read-only e orçamento adicional explícito aprovado antes de qualquer acesso; na ausência dessa aprovação, seu orçamento ézero e a ficha permanece bloqueada. Falha encerra a ficha, sem testar outro token ou ampliar métrica. Nenhuma quantidade aqui é quota da Meta ou autorização nesta Task.

Expansões somente após novo aceite: foto Facebook usando photos.post_id, métricas extras, reach/time_series de conta IG e Reel IG com evidência específica por formato. Não inferir que IMAGE aprovada valida Reel ou que texto valida foto/reações. A requisição de leitura nunca publica conteúdo de preparação.

Mídia externa exige tarefa futura própria: descoberta autorizada por conta, prova atual de owner **e** top-level, tratamento de filhos e formatos. A resposta de GET /media ou um owner coincidente, isoladamente, não libera a consulta. Histórico legado sem destino não é migrado/reassociado.

## 4. Ausência, erro e divergência

- `available` com0 somente se houve zero explícito válido da Meta. `data:[]` ou ausência válida → not_available/null, não falha fictícia nem zero. Atraso de cálculo/limiares podem justificar ausência, mas não inventar sua causa.
- Forma nova, número fora do contrato, tipo de reação inesperado, período incompatível ou payload parcial inconsistente: provider_unavailable; guardar diagnóstico sanitizado e abrir revisão do parser, não relaxá-lo no piloto.
- Grant recusado → permission_required; token vencido → token_expired; 429/Graph quota → rate_limited; indisponibilidade temporária → provider_unavailable. Sem automatizar reconexão, retry ou exclusão de token por esse resultado.
- Com transporte ausente,503 meta_insights_not_enabled é o comportamento correto, **não** smoke bem-sucedido de dados reais. Com mock injetado,200 é somente teste automatizado e não conta neste runbook.
- Código Graph isolado não prova causa: IG10 pode ser limitação de audiência em certos objetos. Comparar contexto oficial e erro sanitizado, sem ampliar scopes como tentativa genérica.
- Meta revogar algo ainda não refletido no DB depende da resposta real do provider; não alegar detecção instantânea sem evidência.

## 5. Segurança e interrupção

Testar primeiro em mocks os casos adversariais; após autorização, repetir somente cenários reais explicitamente aprovados. Conferir sessão/membership atuais antes da chamada e no retorno. Trocar Workspace/revogar sessão no ambiente de teste durante uma consulta controlada: a resposta não pode transportar métricas antigas. Conferir duas contas de tenants diferentes, sem envelope/cache compartilhado. Nunca consultar deliberadamente um ativo alheio sem consentimento de seu responsável.

**Parada imediata** diante de segredo em URL/log/erro/cursor/APM, cross-tenant, chamada antes de autorização, token trocado entre tenants/providers, uso de child/container como mídia, mutation inesperada, redirecionamento não confiável, grant maior não autorizado ou impacto no publisher/quota. Não salvar mais conteúdo bruto para diagnosticar. Desligar somente a via Insights conforme plano aprovado, preservar evidência sanitizada, avisar responsável. Exposição efetiva de segredo requer resposta a incidente e rotação específica autorizada, não alteração improvisada nesta auditoria.

Timeout/abort deve impedir entrega; confirmar separadamente a cooperação do futuro transporte HTTPS. Não inferir cancelamento de SQL ou da chamada remota pelo abort local. Não há mutações de publicação nesse procedimento, mas quota é consumida e deve ser monitorada.

## 6. Registro seguro e aceite

Para cada caso, registrar: data UTC, operador/autorização, commit + hash do pacote candidato, versão Graph, família, alias do ativo/UUID local autorizado, grant/nível de acesso verificados, tokenKind, métrica/período/janela, formato, resultado available/not_available/erro, latência, estados externo/interno do envelope e ID da evidência sanitizada. Não incluir corpo cru/URL completa/cursor/query sensível/headers de autenticação/trace Graph. Fixtures futuras devem ser reconstruídas manualmente sem PII/segredo e revisadas antes de entrar no Git.

Aceite não exige número positivo; exige fonte real, vínculo seguro e semântica correta. Ausência legítima documentada pode aprovar o comportamento vazio, **não** provar a forma de dados disponíveis; cada forma/período adicional precisa de caso próprio. Registro de sucesso de uma família não libera automaticamente outra.

## 7. Habilitação progressiva proposta — não existente ainda

1. Aprovar transporte e implementação isolada com TDD/independente, sem modificar publishers, crypto ou scheduler; revisão de admissão/quota e limites de streaming antes da ativação.
2. Conferir App Review/acesso/grants e resolver divergências de permissões. Autorizar consentimento em ativos de teste, nunca ampliar scopes globalmente sem decisão. `META_INSIGHTS_OAUTH_ENABLED` controla pedido de scopes, **não rede**, e é única para o par de Insights scopes; flags por família não existem hoje.
3. Executar piloto técnico/read-only e smoke de produto, conforme autorizações distintas. Primeira rodada A Page → B Post texto → C IGAccount → D própria IMAGE; cada ficha exige consentimento/gates e não libera a próxima automaticamente. Foto e Reels somente em expansão separada comprovada e autorizada. A ordem é operacional, não motivo para omitir Instagram do escopo 7A.
4. Antes de qualquer ativação produtiva, propor e revisar controle explícito, fail-closed, por família/ativo elegível, configurável só no backend, desligado por padrão. Isso é trabalho futuro, não um recurso instalado. Sem flag ou bypass vindo do browser.
5. Rodar regressões afetadas e gates completos depois da última mudança de código, sem reaproveitar a aprovação Task6 para o adaptador novo. Revisão de segurança independente antes de rollout.
6. Somente com aprovação separada planejar atualização manual integral API/worker compatíveis, backup, janela e monitoramento. A Task7 não acessa a instalação Debian nem comprova o commit implantado.

## 8. Rollback futuro

- Manter o transporte bloqueado ou desligar o controle Insights futuro aprovado. Não usar a flag OAuth como substituto do bloqueio de rede; false impede novos pedidos opcionais, não revoga grants nem desativa um adaptador.
- Não apagar credenciais, contas, posts, resultados, mídias ou operações; não mudar SOCIAL_TOKEN_ENCRYPTION_KEY; não fazer downgrade de permissões Meta como rollback de software.
- Se necessário, retornar ao artefato anterior **completo e compatível** de API/worker, após autorização e comparação de schema/contratos. Não misturar scheduler e API incompatíveis nem interromper operações de publicação cegamente; usar shutdown/recuperação existentes e janela planejada.
- Esta fatia não tem migration; 001–011 permanecem aplicadas/intactas. Não executar down migration, restore destrutivo ou SQL de limpeza para desligar Insights. Backups e restore são procedimentos futuros independentes, com autorização e teste próprios.
- Validar401/404/no-store e503 default, saúde de autenticação e estado do scheduler sem publicar conteúdo real por teste. Registrar o motivo, impacto de quota e autorização do rollback.

O runbook está preparado, mas **não autoriza sua execução**. Aguardar decisão humana sobre transporte, acesso Meta e escopo exato do piloto.

## Adendo Task10C — preparação local, execução real ainda bloqueada

O [driver protegido e protocolo10C](meta-insights-task-10c-pilot-preparation.md) adiciona plano imutável e consentimento **SIMULATION_ONLY** vinculado à Page, operador, finalidade, janela, fingerprint e orçamento1, com expiração5min. Dois consentimentos não ampliam o orçamento do mesmo plano. Pré-requisitos Meta continuam `not_verified`; configuração local não comprova grants/ANALYZE/eligibilidade/acesso.

O adaptador referencia node:https, mas seu builtin permanece bloqueado antes de qualquer chamada. Somente dependência falsa explícita é exercitada nesta Task; não há CLI real ou leitor de credenciais. Env/flags não liberam rede. Segredos somente sintéticos em memória nos testes. Preservados32KiB/1MiB/deadline10s/TLS verificado/zero retries, redirects e paginação; fechamento/abort seguem10B.

Antes da primeira leitura futura será preciso autorizar e revisar uma admissão **real**, uma entrada protegida de PageToken/AppSecret e as evidências do ativo. Aprovar exatamente uma operação Page/day/page_media_view/v26.0; preflight autenticado exige orçamento separado. A interface10C não executa esse protocolo hoje. Falha de permissão/quota/Batch encerra a tentativa, sem fallback ou retry. Registro só sanitizado, sem request/response brutos ou URL autenticada.

Facebook Post e Instagram Account/Media exigem autorização e validação próprias, com PageToken para FB e FacebookUserToken para IG. Nenhuma ativação da aplicação, Debian ou OAuth foi realizada. Não iniciar piloto automaticamente.

## Adendo Task10D — PREPARED não é autorização de execução

O [preflight e entrada protegida10D](meta-insights-task-10d-preflight.md) são exclusivamente locais/sintéticos. A tentativa é consumida sincronicamente antes de qualquer espera e não volta após erro/cancelamento/expiração; re-preparação e consentimentos concorrentes não zeram esse orçamento. Vínculo/metric/op/versão/limites/prazo são revalidados após as esperas. Pré-requisitos externos continuam not_verified.

Não existe stdin/stdoutbinding ou entrada real habilitada. Terminal falso explícito testa rawmode semeco e restauração do estado reportado em sucesso/erro/cancelamento, sem guardar segredos. Falha de restauração bloqueia a preparação e mantém o objeto em quarentena. Não prometer recuperação física diante de falha de SO/stream nem zeroização de stringsJS.

O resultado PREPARED contém só metadados e não chama executor/driver/HTTP. Não há transição automática para EXECUTION AUTHORIZED por API, CLI, flag ou env. Primeiro piloto futuro exige nova autorização humana, entrada física/admissão real revisadas, ativo/exatasoperação/finalidade/grants/task/elegibilidade/acessos e orçamento1; preflightMeta autenticado tem autorização separada. Não enviar segredos em chat/argv/envfiles/logs. Os blocos10A10C permanecem preservados e o builtin real continua bloqueado. Não iniciar10E nesta entrega.

## Adendo Task10E — aprovação externa assinada, somente validação sintética

23/10/2026. A autorização posterior permitiu implementar10E localmente; a proibição histórica acima refere-se à entrega10D. [Arquitetura e protocolo10E](meta-insights-task-10e-external-authorization.md), [fechamento local7A](meta-insights-7a-local-closure.md). Nenhuma autorização de execução real é emitida nesta entrega.

Solicitação canônica vincula runUUID, identidade/alias do operador e solicitante distintos, tenant/WorkspaceUUID, PageID, page_media_view/day, janelaUTC, finalidade, v26.0, códigoSHA256, ambiente sintético, prazo≤5min e limites1chamada/zero retry/redirect/paginação/gasto monetário automático,10s/32KiB/1MiB. AprovaçãoEd25519 assina domínio próprio+hashSHA256. A chave pública confiável é fornecida separadamente do envelope; nenhuma função de assinatura/chave privada pertence ao executor. Testes geram somente chaves efêmeras sintéticas. Domínios/ambiente reais não são aceitos.

Recibo `<runId>.json` contém só metadados, criado exclusivamente e sincronizado antes de qualquer espera/entrada/execução sintética, em diretório privado explicitamente fornecido. Mesmo runID com outrohash, outroprocesso ou outra instância não renova tentativa. Nunca apagar recibos para repetir após erro/abort/timeout. Diretório local/ancestralidade/UID confiáveis são pré-requisitos, não serviço antirrollback/distribuído nem defesa contra root/sameUID comprometido. Apagar/clonar/restaurar o diretório invalida a garantia operacional de replay. Não usarNFS ou diretório novo para “tentar novamente”.

PREPARED e READY_FOR_AUTHORIZATION descrevem preparação, **não** EXECUTION AUTHORIZED. O fluxo10E aceita terminal/driver sintéticos explícitos; sem defaults, CLI real, leitura deenv/DB ou bindingHTTPS nativo. `realExecutionAuthorized`, `realCredentialsAccepted`, `realMetaValidated` permanecemfalse. O builtinHTTPS é recusado antes da entrada; DI arbitrária é código confiável, não sandbox.

### Primeiro piloto futuro — sequência mínima, ainda NÃO executável

1. Confirmar regressão de PostgreSQL em banco exclusivo configurado; nesta sessão TEST_DATABASE_URL estava ausente. Aprovações históricas não são execução nova. Aprovar pacote exato em worktree limpo/versionado futuramente, sem usar apenas oHEADbasee44 como fingerprint dos arquivos7A ainda não commitados.
2. Fora do Codex e do executor, responsável mantém chave privadaEd25519 offline e provisiona sua chave pública por canal autenticado. Conferir identidade/fingerprint e confiar no código/bootstrap/hash/contexto por mecanismo independente. Não enviar chave privada, PageToken ou AppSecret aochat. Essa raiz **real** ainda não existe no programa; revisão/implementação separada da admissão real é necessária antes de qualquer chamada.
3. Com dados não secretos, preparar exatamente uma solicitação: runUUID novo, operador, tenant/Workspace, Page de teste autorizada, finalidade, métrica/período/janela, versão, hash completo aprovado, ambiente, prazo e todos os limites. Operador inspeciona e assina externamente. Uma confirmação textual ou envvar não substitui assinatura/consentimento. Não reusar assinatura sintética no ambiente real.
4. Comprovar separadamente consentimento/posse daPage, tipo/validadePageToken, grants efetivos read_insights/pages_read_engagement e dependências de descoberta, taskANALYZE, elegibilidade, acessos/AppReview/AdvancedAccess aplicáveis. Verificação autenticada desses fatos requer autorização/endpoints/orçamento próprios; a assinatura não os comprova.
5. Nova autorização humana específica permite revisar/habilitar apenas a admissão real/TTY físico isolados, vinculados ao pacote e ativo. Não conectar às rotasSocialFlow nem alterar flagsOAuth. Prover PageToken/AppSecret somente em memória por entrada sem eco revisada, semargv/envfile/DBprodução/log. Não prometer zeroizaçãoJavaScript.
6. Em uma futura execução aprovada, validarassinatura/plano/contexto e reservar tentativa duravelmente antes da entrada. Revalidar após esperas e imediatamente antes daIO. Fazer uma requisição externaPOSTBatch/umGETInsights, hostfixo/TLSverificado/semredirect/retry/paging. Batch+proof+edge ainda é hipótese decompatibilidade a medir, não garantia da preparação local.
7. Avaliar separadamenteHTTPexterno e operaçãointerna. Resposta vazia não vira zero. Registrar só run/alias/UTC/versão/métrica/período/duração/status externo+interno/categoria e evidência sanitizada; não gravar body, assinatura, token,proof ouAppSecret emlogs. Empermissão/token/quota/80001/TLS/redirect/timeout/abort/segredo/forma inesperada: parar, manterrecibo, não executar fallback nem compensar com segunda chamada.

O primeiro resultado real pode ser erro legítimo: isso não autoriza reconexão, novo grant, publicação ou repetição. FacebookPost e InstagramAccount/Media dependem de autorização, token e elegibilidade próprios. Este adendo não executa nenhuma etapa real, não comprova oBatch naMeta e não prepara deploy.
