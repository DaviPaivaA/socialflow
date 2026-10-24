# Etapa 7A — plano de commits revisáveis

Proposta de 2026-10-24, não executada. Base `e44b031d194a959e3f4182b246d17525a0ebc09c`, branch `feat/socialflow-7a-meta-insights`. Não autoriza staging, commit, merge, push ou deploy.

## Regras da futura execução

- Obter autorização humana específica. Preservar o worktree inteiro, inclusive arquivos não selecionados. Não usar reset/clean/checkout destrutivo, stash para esconder alterações, `git add .`, `git add -A` ou `git commit -a`.
- O [inventário](socialflow-7a-task-12-inventory.md) enumera os arquivos de cada Cxx. Atribuição por arquivo inteiro; publisher, scheduler e migrations não precisam entrar na série, pois não mudaram.
- Validar cada árvore candidata limpa/exportada sob autorização. Testar apenas o worktree atual pode esconder dependências em arquivos futuros não staged. Os commits intermediários não foram criados nem testados nesta Task.
- Rever diff staged, imports, segredos e escopo. Os gates abaixo são recomendações futuras, não novas execuções da Task 12.
- Há oito specs/planos da 7A ignorados. Sua inclusão exige seleção explícita autorizada, por exemplo `git add -f -- <caminho-aprovado>`, nunca diretórios inteiros. Não alterar .gitignore. Os quatro históricos 6E/postmanagement ficam fora deste pacote sem serem apagados.
- Links históricos para ledgers ignorados dependem do acervo local e não são portáveis para um clone. Não incluir logs para “consertá-los”: distinguir referências locais históricas dos links entre documentos selecionados. Uma futura checagem de links deve declarar essa exclusão.

## Sequência sugerida

| Ordem | Mensagem proposta | Conteúdo e dependência | Gate da árvore candidata |
| --- | --- | --- | --- |
| C01 | `test(regression): stabilize binary equality and due-time fixtures` | Cinco testes legados: mídia, API, operations, resume e services. Somente testes, sem produção. | Casos afetados em PG descartável; comparação binária integral e controles temporais, sem timeout/assertion removidos. |
| C02 | `feat(oauth): add optional Insights consent and revalidate callbacks` | Config, escopos opcionais, state/session locks, grants/reconexão e testes; nove arquivos. | OAuth e integrações de sessão, locks e grants parciais; publicação sem novos grants obrigatórios. |
| C03 | `feat(insights): add contracts and local Facebook client` | Contrato compartilhado, núcleo, Facebook e três arquivos de testes; seis arquivos. | Allowlist, períodos, normalização, 80001, vazio versus zero e rede bloqueada. |
| C04 | `feat(insights): add local Instagram client and eligibility gates` | Client e teste Instagram; depende de C03. | Account/Media, User Token, formatos/children/top-level e permissões, sem Meta real. |
| C05 | `feat(insights): add tenant-safe repository and application service` | Dois módulos, fixtures e testes unitários/PG; seis arquivos, depende de C03–04. | SQL em banco novo, membership, tenant, sessão, reconexão, associação e revalidação. |
| C06 | `feat(api): expose authenticated Insights read endpoints` | insightsHttp, app, teste HTTP e package.json; depende de C02–05. Package só acrescenta três arquivos ao script de integração. | Quatro rotas, 401/404/409/429/503, no-store, CORS, abort e ausência de fake 200; build Node 22. |
| C07 | `test(experiments): add offline Graph Batch and HTTPS simulation` | 10A–10B: três módulos, duas configs e dois testes; depende de C03. | 135 testes sintéticos, typechecks correspondentes e zero egress. |
| C08 | `test(experiments): add blocked pilot preflight and protected input` | 10C–10D: driver, preflight, input, configs e fixtures; 12 arquivos, depende de C07. | 116 casos adicionais e regressão 10A–10D de 251; imports, terminal, abort e consentimento. Sem CLI/binding real. |
| C09 | `test(security): verify synthetic Ed25519 approvals and durable admission` | 10E: três módulos, teste com 66 casos e config raiz; depende de C07–08. | Admissão/recibos, concorrência multiprocesso, claims, abort, hash e bloqueio HTTPS. Sem signer/bootstrap real. |
| C10 | `fix(ui): use bell for notifications without changing behavior` | Topbar e teste; símbolo apenas. | Aria-label, className, type, navegação e autenticação preservados. |
| C11 | `feat(ui): add disconnected TikTok channel and visual identity` | Badge SVG, Canais, CTA, mock sem conta fictícia, destinos, CSS e testes; 11 arquivos. | Canais, badge, mock, CTA e destinos Meta. CSS já contém estruturas usadas em C12. |
| C12 | `feat(ui): add local TikTok composer preview and empty dashboards` | Composer/preview, Agenda, Analytics/App e testes; dez arquivos, depende de C11. | Frontend completo 395, Workspace, respostas tardias, ObjectURLs e payload Meta separado. TikTok sem backend. |
| C13 | `docs(insights): record architecture and real-network safety gates` | Pesquisa, contratos, segurança/transporte, runbook e fechamento 10E; 16 documentos visíveis, além de specs/planos selecionados. | Coerência Facebook + Instagram e links versionáveis. Fechamento 10E acompanha o runbook para não depender de C14. Referências locais históricas são identificadas separadamente. |
| C14 | `docs(delivery): consolidate local acceptance and integration prerequisites` | Fechamentos 11A/11B/12, inventário, este plano e parecer PG17; seis documentos visíveis, além de planos 11A/11B aprovados. | Contagens/hashes e links; evidências locais não viram parte da imagem. PG17 executável, Meta real e deploy continuam pendentes. |

Imports para módulos antigos da base (app, contas sociais etc.) não representam arquivos ausentes quando seu delta vem depois. Não foi identificado import de fonte nova que só apareça em commit posterior. Ainda assim, cada árvore limpa precisa ser validada; configs com glob experimental evoluem conforme os módulos são adicionados.

Cada unidade deve conter seus testes. A divisão não permite omitir falhas, selecionar apenas resultados verdes ou levar mocks ao runtime. Os experimentos são QA versionável, não integração Meta operacional.

## O que não selecionar

Não versionar `.superpowers/sdd/**`, snapshots, diffs, logs, JSONs brutos, HTML capturado, dados PG, recibos sintéticos, caches, node_modules/dist/dist-server, chaves ou .env. Preservar o acervo local; versionar resumos revisados.

O harness 11B depende de baselines ignorados. Forçar somente seus scripts produziria receita incompleta; uma extração portátil para CI requer tarefa própria. Os testes versionáveis continuam no pacote e não devem carregar .env de produção.

## Gate após a série autorizada

A união dos commits deve coincidir com o inventário aprovado. Registrar novo SHA/hash do artefato, não somente e44b031. Executar gates sobre essa árvore efetiva e completar PG17 antes de autorizar atualização. Preservar imagem anterior e preparar backup/rollback. Refs remotas, conflitos e Compose real não foram consultados; integração exige aprovação separada.

**Recomendação: pronto para solicitar autorização de criação da série. Nenhum commit autorizado ou executado nesta Task.**
