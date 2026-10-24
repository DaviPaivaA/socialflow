# Task10D — preflight e entrada protegida sintética

22/10/2026. Branch `feat/socialflow-7a-meta-insights`, HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c`. Desenho delimitado e cinco pontos aprovados pelo usuário antes da implementação. Continuação da [preparação10C](meta-insights-task-10c-pilot-preparation.md), sem piloto nem habilitação de rede.

## 1. Arquitetura e estados

```text
plano imutável emitido10C + seleção local explícita
 → preparePilotPreflight → consentimento SYNTHETIC_INPUT_ONLY
 → consumo síncrono da tentativa/plano antes de qualquer espera
 → terminal falso em rawmode, sem eco, token/secret sintéticos
 → revalidação após cada campo e após await/restauração
 → PREPARED (somente metadados), ou BLOCKED (erro sanitizado)

PREPARED ── NÃO HÁ TRANSIÇÃO ──> EXECUTION AUTHORIZED
```

`server/experiments/metaInsightsPilotPreflight.ts` reutiliza o emissor10C para validar identidade do plano; não modifica seus módulos, privates ou contratos e **não chama** runPreparedPagePilot/executor/driver. Os WeakMaps10D autorizam somente uma tentativa de **entrada sintética e preflight**, não consomem autoridade de execução10C e não podem habilitar rede. Re-preparar o mesmo plano não zera a tentativa. Consentimento clonado/forjado não é emitido; consentimento genuíno usado no contexto errado também é consumido. Marcação síncrona anterior a callbacks/await impede concorrência. Erro, modo inválido, cancelamento ou expiração não fazem rollback; nem voltar o relógio permite reutilização depois da tentativa.

`server/experiments/metaInsightsProtectedInput.ts` não escolhe stdin/stdout, não possui CLI nem leitor de env/arquivo/DB. Apenas `mode: simulation` + terminal de teste explicitamente injetado; ausência de dependência/TTY falha fechada. Valores devem ser sintéticos. A função retorna credencial somente em memória para o fluxo interno, nunca como relatório. O preflight descarta seu resultado e retorna somente estados/metadados seguros.

DI é código confiável, não sandbox nem prova infalível de fake. Não passar streams físicos ou wrappers de rede nesta Task. Prefixo SYNTHETIC é restrição de teste, não verificação de autenticidade/ownership de token. Não há possibilidade autorizada de entrada real nesta versão; preparar futura interface real exige alteração e revisão separadas.

## 2. Preflight local versus dependências externas

| Verificação local | Comportamento |
| --- | --- |
| Versão | Seleção explícita deve coincidir com plano v26.0; não lê env/.env nem presume versão de produção |
| Ativo e métrica | PageID decimal validado pelo builder10A, vínculo exato à seleção, page_media_view/day |
| Operação | Uma leitura GET interna, budget1; nenhuma operação externa é executada pelo preflight |
| Consentimento | Plano genuíno/frozen, operador/fingerprint/ack explícitos, prazo original5min, consumo irrevogável por identidade |
| Integridade após espera | Revalida Page/métrica/op/versão/janela/limites/snapshot/expiração após token, secret e await final |
| Política HTTPS | Conserva contrato fixo do driver10C: HTTPS Meta443/SNI, certificado verificado, sem overrides; não testa TLS físico nesta fase |
| Limites | Contrato do plano:10s de rede,32KiB de envio/1MiB de resposta,zero retry. Entrada sintética tem timeout separado≤60s, campos≤8192/1024chars e chunk≤16KiB |

As verificações abaixo permanecem `not_verified`, inclusive depois de PREPARED: validade/tipo efetivo do PageToken, grants read_insights/pages_read_engagement e dependência discovery/contrato pages_show_list, task ANALYZE, elegibilidade/limiares/disponibilidade da Page, modo/review/acessos/BusinessVerification aplicáveis à App, aceitação real Batch+proof+edge e formato real da resposta. Estado local não prova nenhum desses fatos. Não confundir pages_show_list com requisito direto da edge: consultar distinção na documentação10C.

## 3. Entrada sem eco e restauração

Fonte primária dirigida: [Node22.23.3 — TTY](https://nodejs.org/download/release/v22.23.3/docs/api/tty.html#readstreamsetrawmodemode), consultada publicamente em22/10/2026, sem credenciais. Rawmode desabilita eco e processamento especial; Ctrl+C passa a ser tratado pelo leitor. `isRaw` é estado reportado pelo Node, não prova universal do estado original do terminal físico.

- Exige input/outputTTY e API rawmode; recusa terminal ocupado ou consumidor data/readable existente.
- Captura rawmode/paused reportados, ativa rawmode **antes** do prompt, não escreve caracteres ou asteriscos. Saída permitida: prompts constantes e quebras de linha. Ctrl+C/AbortSignal cancelam; Ctrl+D/end/close encerram. CRLF e backspace são tratados sem eco.
- Em sucesso, falha, timeout ou cancelamento: remove listeners próprios e listenerAbort, cancela timer, restaura rawmode e estado paused reportados. Não destrói streams compartilhados ou listeners alheios.
- Callbacks síncronos reentrantes durante registro de listeners, prompts ou resume podem concluir/cancelar a leitura. O setup para imediatamente nesses casos, sem reativar terminal/listeners/timers após a restauração. Rawmode é ativado antes de registrar o listenerdata. FindingImportant identificado na revisão independente foi reproduzido emRED e corrigido; detalhes no relatório/review10D.
- Se a restauração falha, retorna terminal_restore_failed, jamais PREPARED, e mantém esse objeto de terminal em quarentena; não o reutiliza automaticamente. Não promete restaurar fisicamente um terminal cujo SO/driver falhou. Uma futura entrada física precisará de recuperação operacional e tratamento de sinais de processo revisados; SIGKILL/crash/terminal comprometido não são garantias deste teste.
- Exceções de inspeção/read/write/setup/cleanup não propagam mensagem/cause bruta. Não há console/log/captura de payload. Nenhum arquivo, envarquivo ou credencial persistente é criado.
- Buffers/strings só são usados em memória; referências locais são liberadas quando possível. **Não há garantia de zeroização, eliminação de cópias, GC imediato ou limpeza de swap/core dump em JavaScript.**

## 4. Testes e evidências

Testes novos: `server/test/metaInsightsProtectedInput.test.ts`, `server/test/metaInsightsPilotPreflight.test.ts`; helper `metaInsightsProtectedInputFixtures.ts` tem somente EventEmitters e valores sintéticos. Executam parser/leitor/admissão reais com IO falso, não um mock do módulo sob teste. HTTP/fetch/persistência são bloqueados/observados nos controles; import Node22 não inicia recursos e default continua bloqueado. Nada disso é prova de transporte Meta real.

RED/GREEN, revisão e gates consolidados no ledger `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/`, arquivos task-10d-*. Typecheck próprio: `node ./node_modules/typescript/bin/tsc -p server/experiments/tsconfig.preflight.json --noEmit`. Build da aplicação não inclui experimentos. Sem necessidade técnica de suitePG extensa nesta mudança sem produto/schema; gates10A10D,build/lint/diff/hashes são executados sequencialmente.

## 5. Checklist de autorização futura — não executar

Dados não secretos do operador: identidade/alias, autorização do responsável, alias/PageID exato em registro restrito, finalidade, métrica/período/janelaUTC, v26.0, pacote/hash, orçamento de uma chamada, prazo/horário e critério de interrupção. Nenhum token ou AppSecret no chat, argv, envfile, log ou captura de tela.

Antes de qualquer credencial ou chamada real:

1. Nova autorização específica para desenhar/revisar uma admissão **real** e entrada protegida física. SYNTHETIC_INPUT_ONLY não é essa autorização; PREPARED não possui capability de execução.
2. Confirmar ativo autorizado, grants/task/elegibilidade/acessos e risco conhecido Batch+edge não comprovado. Preflight autenticado de permissões é separado, com endpoints/orçamento próprios; não cabe automaticamente na única chamadaInsights.
3. Operador fornece PageToken e AppSecret exclusivamente pelo mecanismo em memória aprovado futuramente, sem importação automática do produto/DB/Debian. Não usar UserTokenIG como PageToken ou vice-versa.
4. Aprovar explicitamente pacote/ativo/operador/finalidade/operação/janela/versão/limites/expiração/uma tentativa, sem env/flags autorizarem sozinhos. Conferir terminal físico/sem captura e plano de recuperação em falha; nunca desabilitarTLS.
5. Futuro executor faz somente umPOSTBatch/umGET interno,semretry/redirect/paging; status externo e interno separados. Vazio não é zero. Permissão/token/quota/80001/TLS/timeout/abort/Batchrecusado/payloadnovo/segredo exposto encerram a tentativa, semfallback.
6. Relatório sanitizado: alias,UTC,operador,versão,métrica/período/janela,duração,status externo/interno/categoria/evidência. Nunca request/response brutos, token,proof,secret,URLautenticada.

Procedimento geral e pilotos posteriores: [runbook](meta-insights-pilot-runbook.md). Instagram e FacebookPost continuam dependentes de suas próprias comprovações/autorizações; nenhum sucesso simulado Page libera outras famílias. Não iniciar10E nem consulta real automaticamente.

**Task10D prepara entrada/preflight locais; piloto real e aplicação continuam bloqueados.**
