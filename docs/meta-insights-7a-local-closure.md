# SocialFlow 7A — fechamento técnico local

23/10/2026. Branch `feat/socialflow-7a-meta-insights`, HEAD-base `e44b031d194a959e3f4182b246d17525a0ebc09c`. O código7A está no working tree, ainda sem commit/push. Este documento separa prontidão local de validação real. **Nenhum piloto Meta foi executado.** Resultados finais da10E serão consolidados no ledger, não inferidos de relatórios históricos.

## Inventário funcional e fronteiras

| Entrega | Implementação local | Limite real |
| --- | --- | --- |
| 1A OAuth opcional | Escopos Insights opcionais, desligados por padrão; concessões efetivas distintas das solicitadas; sessões/state/locks preservados | Nenhum consentimento/grant/App Review de conta real comprovado por testes |
| 2 Facebook/contratos | Page/Post, allowlists, períodos, zero versus ausência, normalização e erros sanitizados | Nenhuma resposta real ou transporte habilitado |
| 3 Instagram | Account/Media via Facebook Login; User token, formatos/top-level e contratos distintos | Não libera mídias externas, children ou formatos sem prova |
| 4 Repository | Lookup PostgreSQL com sessão/membership atual, UUID local e joins por tenant | Não consulta Meta nem descriptografa; sem snapshots novos |
| 5 Service | Gates antes da credencial, Page token FB/User token IG, revalidação após espera inclusive falhas | Sem transporte concreto na execução normal |
| 6 HTTP | Quatro GETs autenticados;401/404/409/429/503, DTO seguro e no-store | Alvo elegível sem transporte recebe503 meta_insights_not_enabled |
| 7–9 | Auditoria, pesquisa, runbook e F8-1: Graph80001→rate_limited | Batch genérico não comprova cada edge; quatro famílias reais bloqueadas |
| 10A–10D | Experimento/driver injetável, preflight e entrada sintética sem eco, consentimento de tentativa única | Nenhum binding nativo/CLI real; PREPARED não autoriza rede |
| 10E | VerificaçãoEd25519, admissão durável e fluxo manual sintético:66/66; regressão10A–10D251/251 | Não provisiona chave privada/pública real nem concede execução real |

```text
sessão opaca → Workspace/membership → UUID local → repository tenant-safe
 → grants + credencial apropriada → client sem transporte padrão
 → normalização → revalidação sessão/conta/snapshot → DTO HTTP

experimento isolado: solicitação assinável → aprovação externa futura
 → verificação offline → reserva de tentativa → entrada/IO SINTÉTICOS
 → relatório sanitizado (nunca autoridade de rede real nesta versão)
```

Leitura é permitida a qualquer membership ativo no Workspace; não exige autoria da publicação e não concede administração de conexões. Tenant informado por caller não substitui sessão. Um ID Graph isolado nunca comprova autorização. Os experimentos não implementam a autoridade do produto: o operador deverá comprovar vínculo do ativo ao Workspace, sem acessar produção automaticamente.

## Segurança revisada

Auditoria independente global1A–10D releu código e testes selecionados, conferindo47/47hashes preservados em relação ao manifesto10D. Nenhum novo Critical/Important/Minor confirmado. Revalidação em sucesso/erro e comparação de snapshots evitam entregar dados com sessão/conta/credencial revogada durante a operação. Isso não promete serializar uma revogação posterior ao último gate, cancelar SQL fisicamente ou eliminar strings da memória.

A aprovação externa futura deve usar chave privada exclusiva do operador, fora do repositório e inacessível ao executor/Codex. Não confundir assinatura criptograficamente válida com prova de quem controla a chave: bootstrap, identidade e custódia devem ser validados independentemente. Autorização técnica não substitui consentimento humano nem grants/tasks/elegibilidade Meta. DI é código confiável, não sandbox.

## Verificações desta sessão

- Frontend completo:357/357,0falhas/0skips, `task-10e-frontend.json`.
- Backend offline semPostgreSQL/10E:1263/1270 na sandbox; três testes de import nativo falharam comEPERM de subprocesso e quatro de mídia falharam com restrição de sockets. Sem patch, reexecução autorizada dos dois arquivos fora da sandbox passou27/27, incluindo os sete casos afetados e vinte antes aprovados. Não somar27a1270; não ocultar a primeira execução falha. Evidências task-10e-server-offline.json e task-10e-sandbox-rerun.json. Nenhuma alteração noCoordinator/scheduler/testes anteriores.
- Baseline:47caminhos anteriores preservados;11SQLs sem diff contraHEADbase. Conferência final ainda será registrada.
- PostgreSQL: `TEST_DATABASE_URL` ausente no ambiente; não carregar.env, obter credenciais reais, adivinhar banco ou alegar nova execuçãoPG. As integrações707/707 da8.1 são **históricas**, não repetidas nesta sessão.
- Task10E:66/66,0falhas/pendentes em task-10e-green.json. Regressão10A–10D:251/251,0falhas/pendentes em task-10e-regression.json. São conjuntos separados; os251 já pertencem aos1270backendoffline, não somar novamente. REDfuncional e correção do gate de identidadeHTTPS estão preservados no relatório de implementação.
- Typecheckdedicado `node ./node_modules/typescript/bin/tsc -p tsconfig.experiments-10e.json --noEmit`, buildfrontend/backend e lint:exit0 nesta sessão. Typechecknovo fica na raiz e inclui teste10E. Experimentos não integram buildprodutivo. Diffcheck e integridade finais constam no manifesto.
- Revisão independente10E consolidouSpecPASS/QualityAPPROVED,0Critical/0Important/0Minor confirmados. Não certifica Meta/TLS/TTY/produção reais. Parecer detalhado no ledger.

## Critérios de aceite e bloqueios de ativação

Aceite local exige testes novos RED→GREEN, revisão independente sem Critical/Important aberto, hashes preservados, build/typecheck/lint e nenhum acesso autenticado Meta ou produção. Fechamento local não significa aptidão para deploy ou integração real concluída. Uma nova regressãoPG depende de banco de teste explicitamente configurado e validado.

Ativação exige aprovação futura separada para o pacote exato, chave pública do operador provisionada fora do envelope, persistência confiável de recibos sem rollback/clonagem, entrada física protegida e admissão real revisadas. Exige também Page elegível, Page token adequado, grants efetivos read_insights/pages_read_engagement, ANALYZE, descoberta pages_show_list conforme contrato, acessos/AppReview aplicáveis e aceitação Batch+proof+Insights. Nenhuma dessas condições é comprovada por valores sintéticos.

Piloto inicial: uma Page, uma métrica page_media_view/day, v26.0, uma requisição externa/um GET interno, zero retry/redirect/paginação, limites10s/32KiB/1MiB. Erro/abort/timeout consome a tentativa; não repetir para compensar resposta desconhecida. Não usar secret em query, argv, envfile ou log. Vazio não é zero. Post e Instagram precisam de aprovações e validações separadas. Não publicar conteúdo para preparar o teste.

## Continuidade e recuperação

- Preservar worktree/branch, arquivos untracked e `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram/`.
- Ler `task-10e-brief.md`, plano10E, implementação/revisão/manifesto10E e `progress.md` antes de retomar.
- Não habilitar flagOAuth ou transporte para “testar” aprovação local. Não ligar experimento às rotas.
- Não fazer rollback de produto/DB nesta sessão. Interromper futuro piloto diante de divergência, segredo, quota/80001, TLS, redirect ou formato novo; não apagar recibo de tentativa.
- Etapas7B–7E (persistência/coleta/dashboard/deploy) e migrations posteriores dependem de desenho e aprovação separados. Migrations001–011 permanecem imutáveis.

Referências: [plano10E](superpowers/plans/2026-10-23-socialflow-meta-insights-10e.md), [runbook](meta-insights-pilot-runbook.md), [transporte](meta-insights-task-9-safe-transport.md), [contratosHTTP](meta-insights-http.md), [repository/service](meta-insights-repository-service.md).
