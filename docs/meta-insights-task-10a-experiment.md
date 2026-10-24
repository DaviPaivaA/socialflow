# SocialFlow 7A — Task 10A: experimento Batch sintético

22/10/2026. Branch `feat/socialflow-7a-meta-insights`, HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c` com o trabalho local anterior preservado.

**Prova de conceito experimental, não adaptador de produto. DRY-RUN apenas. Nenhuma compatibilidade real com a Meta foi demonstrada.** O modo de piloto é rejeitado incondicionalmente; não existe executor de HTTPS nem mecanismo de ativação por variável de ambiente. A preparação local foi autorizada na Task10A; as restrições históricas da Task9 sobre rede continuam válidas.

## 1. Hipótese e evidência

A pergunta do experimento é se o candidato genérico Graph Batch pode ser construído e interpretado corretamente, antes de um futuro teste de compatibilidade específico de Insights. Uma simulação não responde se a Meta aceita a combinação.

- Versão dos clients/default local: `v26.0`, conferida em `server/src/metaInsightsClient.ts` e `server/src/config.ts`. Nenhum `.env` ou configuração do Debian foi carregado.
- Em22/10/2026 a referência pública [Page Insights v26.0](https://developers.facebook.com/docs/graph-api/reference/v26.0/page/insights/?locale=en_US) listou `page_media_view`, períodos `day`, `week`, `days_28`, Page token, task ANALYZE e permissões read_insights/pages_read_engagement. Browser indisponível/429; HTTPS público sem credencial recuperou a página, cujo texto foi extraído sem execução de scripts. Essa é evidência da métrica candidata, não de Batch+Insights.
- O formato multipart genérico com token/proof externo está fundamentado na [Task9](meta-insights-task-9-safe-transport.md), especialmente suas fontes oficiais [Secure Requests](https://developers.facebook.com/docs/graph-api/guides/secure-requests/?locale=en_US) e [Batch Requests](https://developers.facebook.com/docs/graph-api/making-multiple-requests/?locale=en_US). Não se refez a pesquisa inteira; composição por edge e versão continua pendente.

## 2. Arquitetura isolada

```text
CLI dry-run (import inerte, não lê env)
  → builder Page/day/uma métrica e um GET
  → multipart externo sintético + HTTP falso explícito
  → limite de bytes + parsing do envelope e operação interna
  → FacebookInsightsClient já aprovado (injeção apenas na instância experimental)
  → relatório allowlisted, simulated=true / realMetaValidated=false
```

Arquivos:

- `server/experiments/metaInsightsBatchExperiment.ts`: tipos experimentais, HMAC puro, builder sintético, runner, limites e relatório; nenhum fetch/HTTPS/SQL.
- `server/experiments/metaInsightsBatchDryRun.ts`: CLI com guarda de execução direta. Só aceita ausência de argumentos ou `--dry-run`; qualquer outro argumento é recusado sem eco.
- `server/experiments/tsconfig.json`: typecheck separado, sem alterar o build do servidor.
- `server/test/metaInsightsBatchExperiment.test.ts`: testes de construção, parsing, falhas, cancelamento e isolamento.

Nenhuma importação da aplicação aponta para o experimento. Reutilizar o parser existente não conecta a instância experimental ao service, ao servidor ou à seam `insightsTransportForTests`. Não há cadastro, cache global, conta, tenant ou credencial persistida nesse spike.

## 3. Operação candidata

Endpoint externo fixo: `POST https://graph.facebook.com/v26.0/`. Corpo FormData multipart com `access_token`, `appsecret_proof`, `batch`. Uma operação interna:

```json
{"method":"GET","relative_url":"{page-id}/insights?metric=page_media_view&period=day&since={inicio}&until={fim}"}
```

Esse exemplo é lógico e não contém segredo. Os placeholders não são entrada livre de URL. O builder aceita somente ID decimal, versão fixa, métrica candidata, day e intervalo inteiro crescente, passado, até90dias e dentro de2anos; reaproveita o descriptor validado. Token e secret são marcadores sintéticos fixos no módulo; não são lidos de ambiente ou argumentos. Nenhum token ou proof entra em URL externa/interna, header inventado ou relatório. FormData faz o encoding dos caracteres reservados do token sintético no corpo, não na query. Não se define manualmente boundary.

O HMAC é SHA256, chave=App Secret, mensagem=token. O teste usa vetor independente RFC4231 (caso2), além de proof incorreto e comprimento inválido. Isso valida o algoritmo local, não a aceitação de proof pela edge real.

## 4. Executar apenas o DRY-RUN

Usar Node22 (verificado localmente22.23.3), dependências já instaladas e **não carregar `.env`**:

```bash
node server/experiments/metaInsightsBatchDryRun.ts
node server/experiments/metaInsightsBatchDryRun.ts --dry-run
node ./node_modules/vitest/vitest.mjs run --config vitest.server.config.ts server/test/metaInsightsBatchExperiment.test.ts --no-file-parallelism
node ./node_modules/typescript/bin/tsc -p server/experiments/tsconfig.json
```

O CLI escolhe o último dia UTC completo, ID sintético e resposta local. A saída é JSON com modo dry_run, simulated=true, realMetaValidated=false, família/métrica/versão e estados externo/interno/outcome. Não contém números de métricas, ID da Page, formulário, token, proof, resposta bruta, causa ou stack. `available` nesse relatório significa somente que o parser aceitou a fixture sintética; não significa dado real. Importar qualquer dos dois módulos não executa o experimento nem inicia servidor, scheduler, banco ou rede.

Não há comando real escondido: `--pilot`, `--real` ou argumentos desconhecidos falham. Variáveis como META_INSIGHTS_PILOT_ENABLED ou tokens no ambiente não são consultadas. META_INSIGHTS_OAUTH_ENABLED não foi alterada.

## 5. Segurança e interpretação

- Outer200 não significa sucesso do GET interno. Exigir array de cardinalidade1, item não-null, código HTTP inteiro válido e body JSON string. Null/ausência/mais de uma operação → incomplete_response, sem reenvio.
- Erros numéricos Graph reutilizam o core aprovado:190 token_expired;200 permission_required;4/17/32/613/80001 rate_limited. Mensagem/substrings e código string não viram quota. HTTP externo429 também é quota. Outros erros permanecem sanitizados.
- data vazio é not_available, zero explícito é available. Dados inválidos não viram zero. Não imprimir valores ou bodies para investigar.
- Não seguir paging.next ou redirects externos/internos, mesmo same-host. Paginação bloqueia o resultado como incompleto. Host, método e versão não são parâmetros externos.
- Limite incremental1MiB antes do parse, e limite do body interno; compressão recusada nesse protocolo identity-only. O fake fornece AsyncIterable de bytes; interromper leitura ao exceder limite.
- Timeout entre1ms e10s cobre espera por headers e leitura; AbortSignal impede entrega tardia. Deadline é efêmera e removida no finally, não job de coleta. Cancelamento é cooperativo no fake: não alegar cancelamento físico da Meta, SQL ou de fake que ignore signal.
- Zero retries, uma invocação do fake por execução. Nenhum fetch fallback. Falhas de dependências e abort.reason não são ecoados. Relatórios são snapshots finais, sem payloads tardios.
- Uma futura dependência HTTPS exige implementação e revisão novas; a interface fake não certifica streaming, TLS, redirects ou liberação de rede real.

## 6. Expansão futura — não implementada

| Família | Operação candidata | Token futuro | Gate adicional |
| --- | --- | --- | --- |
| Facebook Page | page_media_view/day | Page Access Token | Primeira prova Batch+edge/v26, grants/ANALYZE/Page elegível |
| Facebook Post | post_media_view/lifetime | Page token da Page dona | Feed post ID final e vínculo comprovados; começar texto existente |
| Instagram Account | views/day/total_value | Facebook User Access Token | Business/Creator via Facebook Login, vínculo Page e grants específicos |
| Instagram Media | views, period omitido no wire | Facebook User Access Token | IMAGE própria, ID final, ownership **e** top-level/formato elegíveis |

Não trocar o tipo de token nem liberar a próxima família pelo sucesso da anterior. Não implementar expansão apenas trocando uma string no builder: criar primeiro testes RED da família com os clients/contratos existentes e nova revisão. Não aceitar Graph ID isolado como autorização. Reels, Stories, carrosséis/children e mídia externa continuam excluídos.

## 7. Checklist humano antes de um piloto futuro

- [ ] Autorização escrita reconhecendo a incerteza Batch+Insights e permitindo uma única leitura Page, com operador/janela/versão/métrica/ativo definidos.
- [ ] Page de teste já existente e consentida, task ANALYZE, elegibilidade (incluindo limiar documentado), grants efetivos e App Review/acesso aplicáveis conferidos sem exibir tokens.
- [ ] Page Access Token e App Secret obtidos por mecanismo server-side aprovado fora do repo/terminal/histórico; não usar banco de produção. Nenhuma mudança de OAuth/grants implícita.
- [ ] Aprovar explicitamente qualquer preflight, seus endpoints e orçamento. Sem aprovação, orçamentozero.
- [ ] Nova implementação **separada** de HTTPS, revisada: host/versão fixos, multipart, zero redirects/retry, limite de bytes, timeout/abort, logs sanitizados, uma operação. O spike atual não a contém.
- [ ] Autorização de uso real em duas condições explícitas (consentimento do operador + habilitação da execução específica), nunca só variável de ambiente. A forma exata será revisada nessa tarefa futura.
- [ ] Conferir isolamento da aplicação, ausência de scheduler/produção e pacote/hash aprovado antes de enviar; manter rotas públicas bloqueadas.

Procedimento mínimo futuro: validar checklist → construir exatamente a operaçãoA aprovada → autorizar/envio único por executor novo revisado → analisar status externo e interno → registrar apenas alias/estados/métrica/período/versão/latência e evidência sanitizada → parar. Ausência legítima não é zero nem comprovação de payload disponível. Null/parcial/quota/redirect/segredo/divergência encerra o caso sem fallback/retry. Não salvar body bruto ou token. Esse procedimento não foi executado nem autorizado pela Task10A.

Só avançar a Post e Instagram com aceite específico do casoA, evidência do transporte, ativos/grants/token corretos, testes sintéticos próprios, revisão independente e autorização de cada família. Não ligar rede de produto ou produção por consequência de um piloto.

## 8. Evidências da execução local

Resultados consolidados no [relatório](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-10a-report.md), [manifesto](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-10a-verification.json) e [revisão independente](../.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/task-10a-review.md). Testes finais:67/67 do experimento;411/411 na regressão focada de5arquivos, incluindo esses67;zero falhas/skips. Typecheck experimental, build do produto e lint aprovados. Não somar subconjuntos como testes distintos.

Revisão independente sem Critical/Important; dois Minor corrigidos com RED→GREEN (429 antes do parse e case de Content-Encoding), além da semântica de UTF8 inválido. Retorno confirmou67/67 e aprovação apenas sintética. Os resultados Task8.1/9 são históricos, não nova regressão nesta Task. Nenhuma suíte PostgreSQL é necessária para um módulo experimental que não acessa banco e não altera as camadas aprovadas.

**Conclusão de escopo: preparado somente para simulação local. Piloto real e transporte das quatro famílias continuam BLOQUEADOS até nova autorização e evidências próprias. Não declarar7A concluída.**
