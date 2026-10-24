# Inventário da entrega 7A — Task12

2026-10-24. Base/HEAD `e44b031d194a959e3f4182b246d17525a0ebc09c`, branch `feat/socialflow-7a-meta-insights`. Inventário do delta completo contra HEAD, incluindo arquivos novos; não somente diff de commits. Nenhum arquivo foi movido, apagado ou staged.

## Código, testes, experimentos e documentos visíveis no Git

M = modificado; ?? = novo/não rastreado. Cxx corresponde ao plano de commits proposto. Runtime indica elegibilidade de código da aplicação, não comprovação da composição da imagem Docker (receita não fornecida).

| Arquivo | Git | Grupo | Classe | Runtime aplicação |
| --- | --- | --- | --- | --- |
| `server/test/api.integration.ts` | M | C01 | teste/fixture | não |
| `server/test/metaMediaDelivery.integration.ts` | M | C01 | teste/fixture | não |
| `server/test/metaPublicationResume.integration.ts` | M | C01 | teste/fixture | não |
| `server/test/metaPublicationServices.integration.ts` | M | C01 | teste/fixture | não |
| `server/test/publicationOperations.integration.ts` | M | C01 | teste/fixture | não |
| `server/src/config.ts` | M | C02 | código da aplicação | sim |
| `server/src/metaOAuthClient.ts` | M | C02 | código da aplicação | sim |
| `server/src/metaOAuthService.ts` | M | C02 | código da aplicação | sim |
| `server/src/metaOAuthStateRepository.ts` | M | C02 | código da aplicação | sim |
| `server/src/postgresSocialAccountsRepository.ts` | M | C02 | código da aplicação | sim |
| `server/test/authContract.test.ts` | M | C02 | teste/fixture | não |
| `server/test/metaOAuth.integration.ts` | M | C02 | teste/fixture | não |
| `server/test/metaOAuthClient.test.ts` | M | C02 | teste/fixture | não |
| `server/test/metaOAuthService.test.ts` | M | C02 | teste/fixture | não |
| `server/src/facebookInsightsClient.ts` | ?? | C03 | código da aplicação | sim |
| `server/src/metaInsightsClient.ts` | ?? | C03 | código da aplicação | sim |
| `server/test/facebookInsightsClient.test.ts` | ?? | C03 | teste/fixture | não |
| `server/test/insightsContract.test.ts` | ?? | C03 | teste/fixture | não |
| `server/test/metaInsightsClient.test.ts` | ?? | C03 | teste/fixture | não |
| `shared/insightsContract.ts` | ?? | C03 | código da aplicação | sim |
| `server/src/instagramInsightsClient.ts` | ?? | C04 | código da aplicação | sim |
| `server/test/instagramInsightsClient.test.ts` | ?? | C04 | teste/fixture | não |
| `server/src/insightsRepository.ts` | ?? | C05 | código da aplicação | sim |
| `server/src/insightsService.ts` | ?? | C05 | código da aplicação | sim |
| `server/test/insightsFixtures.ts` | ?? | C05 | teste/fixture | não |
| `server/test/insightsRepository.integration.ts` | ?? | C05 | teste/fixture | não |
| `server/test/insightsService.integration.ts` | ?? | C05 | teste/fixture | não |
| `server/test/insightsService.test.ts` | ?? | C05 | teste/fixture | não |
| `package.json` | M | C06 | manifesto; somente script de testes mudou | sim |
| `server/src/app.ts` | M | C06 | código da aplicação | sim |
| `server/src/insightsHttp.ts` | ?? | C06 | código da aplicação | sim |
| `server/test/metaInsightsHttp.integration.ts` | ?? | C06 | teste/fixture | não |
| `server/experiments/metaInsightsBatchDryRun.ts` | ?? | C07 | experimental/sintético | não |
| `server/experiments/metaInsightsBatchExperiment.ts` | ?? | C07 | experimental/sintético | não |
| `server/experiments/metaInsightsBatchHttpsExecutor.ts` | ?? | C07 | experimental/sintético | não |
| `server/experiments/tsconfig.https.json` | ?? | C07 | experimental/sintético | não |
| `server/experiments/tsconfig.json` | ?? | C07 | experimental/sintético | não |
| `server/test/metaInsightsBatchExperiment.test.ts` | ?? | C07 | teste/fixture | não |
| `server/test/metaInsightsBatchHttpsExecutor.test.ts` | ?? | C07 | teste/fixture | não |
| `server/experiments/metaInsightsNativeHttpsDriver.ts` | ?? | C08 | experimental/sintético | não |
| `server/experiments/metaInsightsPagePilot.ts` | ?? | C08 | experimental/sintético | não |
| `server/experiments/metaInsightsPilotPreflight.ts` | ?? | C08 | experimental/sintético | não |
| `server/experiments/metaInsightsProtectedInput.ts` | ?? | C08 | experimental/sintético | não |
| `server/experiments/tsconfig.native.json` | ?? | C08 | experimental/sintético | não |
| `server/experiments/tsconfig.preflight.json` | ?? | C08 | experimental/sintético | não |
| `server/test/metaInsightsNativeHttpsDriver.test.ts` | ?? | C08 | teste/fixture | não |
| `server/test/metaInsightsPagePilot.test.ts` | ?? | C08 | teste/fixture | não |
| `server/test/metaInsightsPilotPreflight.test.ts` | ?? | C08 | teste/fixture | não |
| `server/test/metaInsightsPilotTestFixtures.ts` | ?? | C08 | teste/fixture | não |
| `server/test/metaInsightsProtectedInput.test.ts` | ?? | C08 | teste/fixture | não |
| `server/test/metaInsightsProtectedInputFixtures.ts` | ?? | C08 | teste/fixture | não |
| `server/experiments/metaInsightsAuthorizedManualFlow.ts` | ?? | C09 | experimental/sintético | não |
| `server/experiments/metaInsightsDurableAdmission.ts` | ?? | C09 | experimental/sintético | não |
| `server/experiments/metaInsightsExternalAuthorization.ts` | ?? | C09 | experimental/sintético | não |
| `server/test/metaInsightsExternalAuthorization.test.ts` | ?? | C09 | teste/fixture | não |
| `tsconfig.experiments-10e.json` | ?? | C09 | typecheck experimental | não |
| `src/layout/Topbar.test.tsx` | M | C10 | teste/fixture | não |
| `src/layout/Topbar.tsx` | M | C10 | código da aplicação | sim |
| `src/components/ChannelBadge.test.tsx` | ?? | C11 | teste/fixture | não |
| `src/components/ChannelBadge.tsx` | M | C11 | código da aplicação | sim |
| `src/components/TikTokComingSoon.tsx` | ?? | C11 | código da aplicação | sim |
| `src/data/socialAccounts/MockSocialAccountsRepository.test.ts` | ?? | C11 | teste/fixture | não |
| `src/data/socialAccounts/MockSocialAccountsRepository.ts` | M | C11 | código da aplicação | sim |
| `src/features/composer/ComposerDestinations.test.tsx` | ?? | C11 | teste/fixture | não |
| `src/features/composer/ComposerDestinations.tsx` | M | C11 | código da aplicação | sim |
| `src/features/tiktok/tiktok.css` | ?? | C11 | código da aplicação | sim |
| `src/index.css` | M | C11 | código da aplicação | sim |
| `src/pages/Channels.test.tsx` | M | C11 | teste/fixture | não |
| `src/pages/Channels.tsx` | M | C11 | código da aplicação | sim |
| `src/App.tsx` | M | C12 | código da aplicação | sim |
| `src/features/composer/Composer.test.tsx` | M | C12 | teste/fixture | não |
| `src/features/composer/Composer.tsx` | M | C12 | código da aplicação | sim |
| `src/features/tiktok/MetaAgendaFilter.tsx` | ?? | C12 | código da aplicação | sim |
| `src/features/tiktok/TikTokAgenda.test.tsx` | ?? | C12 | teste/fixture | não |
| `src/features/tiktok/TikTokApp.test.tsx` | ?? | C12 | teste/fixture | não |
| `src/features/tiktok/TikTokExperience.test.tsx` | ?? | C12 | teste/fixture | não |
| `src/features/tiktok/TikTokLocalComposer.tsx` | ?? | C12 | código da aplicação | sim |
| `src/pages/Agenda.tsx` | M | C12 | código da aplicação | sim |
| `src/pages/Analytics.tsx` | M | C12 | código da aplicação | sim |
| `docs/meta-insights-7a-local-closure.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-api-research-facebook-instagram.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-api-research.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-http.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-local-implementation.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-pilot-runbook.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-repository-service.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-1-security-review.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-10a-experiment.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-10b-https-executor.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-10c-pilot-preparation.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-10d-preflight.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-10e-external-authorization.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-7-final-audit.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-8-transport-validation.md` | ?? | C13 | documentação | não |
| `docs/meta-insights-task-9-safe-transport.md` | ?? | C13 | documentação | não |
| `docs/socialflow-7a-postgresql17-compatibility.md` | ?? | C14 | documentação | não |
| `docs/socialflow-7a-task-11b-validation.md` | ?? | C14 | documentação | não |
| `docs/socialflow-7a-task-12-commit-plan.md` | ?? | C14 | documentação | não |
| `docs/socialflow-7a-task-12-consolidation.md` | ?? | C14 | documentação | não |
| `docs/socialflow-7a-task-12-inventory.md` | ?? | C14 | documentação | não |
| `docs/tiktok-frontend-11a.md` | ?? | C14 | documentação | não |

## Grupos funcionais

- C01: Regressão legada: binários e fixtures temporais.
- C02: OAuth Insights opcional, state e grants.
- C03: Contratos, núcleo e Facebook Insights local.
- C04: Instagram Insights local.
- C05: Repository e service multi-tenant.
- C06: HTTP autenticado e integração da aplicação.
- C07: Experimentos 10A–10B: Batch e executor simulado.
- C08: Experimentos 10C–10D: driver, preflight e entrada sintética.
- C09: Experimento 10E: Ed25519 e admissão durável.
- C10: Topbar: sino e propriedades preservadas.
- C11: TikTok: identidade, Canais e CTA informativa.
- C12: TikTok: compositor, preview, Agenda e Analytics.
- C13: Documentação de arquitetura, pesquisa e gates Meta.
- C14: Fechamentos, evidências resumidas e entrega.
- HISTORY: Histórico fora do pacote7A proposto; preservar.
- LOCAL: Artefato local/gerado: não incluir em commit de produção.
- UNKNOWN: Não classificado: exige revisão humana.

## Specs/planos locais ignorados

Não editar .gitignore nestaTask. Uma futura inclusão requer autorização e seleção explícita (por exemplo force-add do caminho aprovado, nunca wildcard). História alheia deve ser preservada e não adicionada em bloco.

| Caminho | Grupo | Tratamento |
| --- | --- | --- |
| `docs/superpowers/plans/2026-10-03-socialflow-6e-implementation-plan.md` | HISTORY | preservar fora do pacote |
| `docs/superpowers/plans/2026-10-15-socialflow-scheduled-post-management.md` | HISTORY | preservar fora do pacote |
| `docs/superpowers/plans/2026-10-19-socialflow-meta-insights-plan-facebook-instagram.md` | C13 | seleção explícita futura; atualmente ignorado |
| `docs/superpowers/plans/2026-10-19-socialflow-meta-insights-plan.md` | C13 | seleção explícita futura; atualmente ignorado |
| `docs/superpowers/plans/2026-10-20-socialflow-7a-local-oauth-clients.md` | C13 | seleção explícita futura; atualmente ignorado |
| `docs/superpowers/plans/2026-10-23-socialflow-7a-11b-validation.md` | C14 | seleção explícita futura; atualmente ignorado |
| `docs/superpowers/plans/2026-10-23-socialflow-meta-insights-10e.md` | C13 | seleção explícita futura; atualmente ignorado |
| `docs/superpowers/plans/2026-10-23-socialflow-tiktok-11a.md` | C14 | seleção explícita futura; atualmente ignorado |
| `docs/superpowers/specs/2026-10-03-socialflow-6e-design.md` | HISTORY | preservar fora do pacote |
| `docs/superpowers/specs/2026-10-15-socialflow-scheduled-post-management-design.md` | HISTORY | preservar fora do pacote |
| `docs/superpowers/specs/2026-10-19-socialflow-meta-insights-design-facebook-instagram.md` | C13 | seleção explícita futura; atualmente ignorado |
| `docs/superpowers/specs/2026-10-19-socialflow-meta-insights-design.md` | C13 | seleção explícita futura; atualmente ignorado |

## Checkpoints/harnesses locais (fora do commit e da imagem)

O JSON complementar contém todos os caminhos individuais destes grupos; conteúdo bruto não foi publicado nem reescrito.

| Coleção | Arquivos | Bytes | Destino |
| --- | ---: | ---: | --- |
| `.superpowers/sdd/.gitignore` | 1 | 2 | local; não commit nem imagem |
| `.superpowers/sdd/2026-10-03-socialflow-6e-implementation-plan` | 149 | 3077235 | local; não commit nem imagem |
| `.superpowers/sdd/2026-10-15-socialflow-scheduled-post-management` | 3336 | 29491434 | local; não commit nem imagem |
| `.superpowers/sdd/2026-10-19-socialflow-meta-insights-plan-facebook-instagram` | 266 | 12414846 | local; não commit nem imagem |
| `.superpowers/sdd/2026-10-20-socialflow-7a-local-oauth-clients` | 62 | 3363610 | local; não commit nem imagem |
| `.superpowers/sdd/2026-10-23-socialflow-7a-11b-validation` | 96 | 2084354 | local; não commit nem imagem |
| `.superpowers/sdd/2026-10-23-socialflow-tiktok-11a` | 52 | 915513 | local; não commit nem imagem |

## Limites e seleção de entrega

- Experimentos, fixtures e testes podem ser versionados em commits próprios, mas não são runtime da aplicação; o tsconfig produtivo exclui server/experiments. A imagem deve ter sua receita auditada antes de deploy.
- O harness 11B fica no ledger ignorado e depende de baselines ali armazenados: não é um utilitário portátil de CI. Não versionar só o script e declarar reprodutibilidade. Sua eventual extração exige tarefa e revisão próprias.
- HTML de pesquisa capturado, logs, JSONs de resultados, snapshots/diffs, dados PG/recibos sintéticos e caches não entram em commit de produção. Nada foi apagado.
- node_modules/, dist/, dist-server/ são derivados; .env*, tokens, App Secret, chaves e dados/volumes não são material de commit e não foram lidos.
- Documentos antigos exclusivos Facebook permanecem históricos; o estado atual é Facebook + Instagram e a consolidação 12 indexa a autoridade. Não apagar nem atualizar históricos para apagar sua cronologia.
- Topbar e teste são acabamento separado e explicitamente autorizado; testes legados de mídia/relógio são suporte à regressão, não novas funcionalidades Meta. Não foi identificada alteração funcional visível inteiramente alheia ao escopo autorizado; ver UNKNOWN no JSON para lacunas.
- O fechamento 10E está em C13 junto ao runbook que o referencia, eliminando a dependência futura C13 → C14 identificada na revisão.
- Arquivos gerados pela Task 12 e sua coleção local são declarados no manifesto 12; este Markdown não contém seu próprio hash. Hashes de todos os arquivos Git visíveis estão em inventory-final.json após geração, incluindo este arquivo. inventory.json preserva a captura documental anterior à revisão.

[Plano dos commits](socialflow-7a-task-12-commit-plan.md) · [Consolidação](socialflow-7a-task-12-consolidation.md) · [Inventário JSON completo final](../.superpowers/sdd/2026-10-24-socialflow-7a-task-12/inventory-final.json)
