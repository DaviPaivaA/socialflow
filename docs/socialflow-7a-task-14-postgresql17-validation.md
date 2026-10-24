# Task 14 — validação operacional local PostgreSQL 17

Data: 2026-10-24. Branch `feat/socialflow-7a-meta-insights`.
HEAD/base: `e44b031d194a959e3f4182b246d17525a0ebc09c`. Task 13 continua adiada; nenhum commit, merge, push ou deploy.

## 1. Ambiente efetivamente executado

`SELECT version()` retornou:

```text
PostgreSQL 17.11 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 16.2.1 20260810, 64-bit
```

`server_version_num = 170011`. Fonte estável selecionada no [catálogo oficial 17.11](https://www.postgresql.org/ftp/source/v17.11/), baixada por HTTPS de `ftp.postgresql.org`, sem redirecionamentos. SHA-256 oficial conferido antes da extração/compilação:

```text
5367f6fb2ec97efe1eb2e0c7926bb33438e51b0bd3a9733b88498056a7dc9a7e
```

Build com `make -j2`, prefixo privado `/tmp/socialflow-14-pg17-build-mncUEO4E/install`, OpenSSL existente e sem readline. A [documentação de instalação](https://www.postgresql.org/docs/17/install-make.html) fundamenta o prefixo privado. Configure, compilação, instalação e build/install de pgcrypto passaram com exit0. Não houve sudo, instalação global, dependência nova ou substituição do PostgreSQL18.6.

Postgres/initdb/pg_ctl/pg_config/psql foram fixados em caminhos absolutos, todos17.11. Sharedir, biblioteca e pgcrypto/control/SQL vieram do mesmo prefixo compilado. A versão dos executáveis, `PG_VERSION` e versão SQL foram exigidas antes de CREATE DATABASE/migrations.

## 2. Isolamento

- Diretórios exclusivos criados por mkdtemp, modo0700 e owner marcador; usuário/banco `socialflow_14`/`socialflow_14_test`, senha sintética.
- Escuta somente127.0.0.1, portas efêmeras; nenhum PostgreSQL persistente acessado. Cluster final17: `/tmp/socialflow-14-pg17-5sqJlz`, porta44071.
- Identidade SQL confirmou major, data_directory, usuário, listen e porta; apenas banco postgres inicial e zero tabelas no banco novo.
- Ambiente mínimo sem DSNs herdados; DATABASE_URL deliberadamente inválido. TEST_DATABASE_URL construído somente para o cluster verificado, com envDir vazio, sem ler arquivos .env.
- Guard offline bloqueou net/HTTPS/fetch externos antes de I/O nos controles; mocks Meta/TikTok. É defesa contra egress acidental em testes confiáveis, não sandbox universal.
- Harness11B preservado; cópia e configuração14 ficam em ledger ignorado. Não são infraestrutura produtiva ou CI portátil.

## 3. Migrations e estrutura

001–011 executadas na ordem, com onze checksums iguais aos arquivos oficiais locais; reexecução idempotente conferida. Probe em schema exclusivo foi removido antes das fixtures, sem deixar tabelas públicas como fallback de search_path.

O probe encontrou14tabelas(incluindo schema_migrations),49índices,39CHECK,18FK,14PK e15UNIQUE; pgcrypto1.3. Sessões, memberships, contas/credenciais, posts/destinos/operações e relações de mídia foram exercitados. Não há tabela nova de snapshots de métricas na7A: InsightsRepository consulta associações existentes; persistência/coleta de métricas continua futura.

Nenhuma migration foi alterada. Nenhum SQL destaTask foi enviado a banco existente, Debian ou produção.

## 4. Resultados reais e comandos

Comando-base: `node .superpowers/sdd/2026-10-24-socialflow-7a-task-14-postgresql17/run-validation.mjs <modo>`.

| Execução | Modo / evidência | Resultado |
| --- | --- | --- |
| Primeiro PostgreSQL17 | --pg-only; run2b032692 |707/709; duas expectativas SQLSTATE incompatíveis; zero skips. RED preservado. |
| GREEN focal17 | --restrict-focused-17; run4591674d |78/78, dois arquivos completos32+46, zero falhas/skips. |
| Controle focal18.6 | --restrict-focused-18; runa267bb17 |78/78, cluster18 novo e descartável, sem alterar binários/bancos existentes. |
| PostgreSQL17 completo final | --pg-only; run978afff0 |709/709,21arquivos, zero failed/pending/todo. |
| Autorização Ed25519/admissão | Sequencial ao PG final; mesmo run |66/66, um arquivo, zero failed/pending/todo; sintético e offline. |
| Controles do harness | node --test no ledger14 |RED funcional8falhas/5pass, depois13/13GREEN. Não são casos do produto. |
| Typecheck frontend/experimental, build frontend/server, lint/diff-check | Mesmo run final |Todos exit0; zero schemas de fixture remanescentes. |

Os78focais17 são subconjunto dos709. Os66 são subconjunto da partição offline histórica, não testes PostgreSQL nem números a somar ao total2045 anterior. Frontend395/395 e backend offline1336/1336 da11B continuam evidências históricas preservadas, não foram integralmente reexecutados nestaTask sem necessidade. Os66 foram reexecutados explicitamente.

Relatórios completos, comandos/durações, JSONs e logs estão em `.superpowers/sdd/2026-10-24-socialflow-7a-task-14-postgresql17/`. `run-978afff0-74d2-413c-b41a-bab8c3aa0adc.json` é o manifesto da execução final; comparison.json registra confronto com18.6. Não se interpretou exit1 inicial como falha de infraestrutura ou limpeza.

## 5. Diferença17 versus18 e correção mínima

F14-2: dois testes legados exigiam SQLSTATE23001 de uma exclusão RESTRICT. No17.11 o banco protege a relação, mas retorna23503. A fonte oficial17.11 baixada usa FOREIGN_KEY_VIOLATION nesse ramo; o [código oficial18](https://raw.githubusercontent.com/postgres/postgres/REL_18_STABLE/src/backend/utils/adt/ri_triggers.c) distingue RESTRICT_VIOLATION. Não há tratamento desses dois códigos nas fontes produtivas SocialFlow que exija patch.

Alterados exclusivamente:

- `server/test/api.integration.ts`: caso cross-tenant/CASCADE/RESTRICT.
- `server/test/publicationOperations.integration.ts`: caso de unicidade e vínculos entre destinos/mídias.

Os testes consultam o major na própria conexão, exigem17ou18 e escolhem um único código exato por major, sem aceitar ambos indiscriminadamente. Conferem RESTRICT não diferível no catálogo, schema/tabela referenciadora/FK precisos e permanência da mídia e vínculo/operação após a exclusão rejeitada. As verificações cross-tenant, unicidade, CASCADE, assertions e timeouts anteriores foram mantidos.

Não houve alteração produtiva, de migrations, publisher, Coordinator, scheduler, OAuth, contrato, dependência ou TikTok. A correção temporal Date/ms da11B continua presente e passou em17; o probe distingue1microssegundo futuro e normaliza123000microssegundos de um Date.

Os mesmos21arquivos e709casos da11B passaram. Quatro títulos parametrizados contêm UUIDs aleatórios diferentes: comparison.json normaliza somente esses UUIDs de exibição para comparar o multiconjunto de nomes, sem mudar valores ou resultados das assertions. Não houve diferença adicional observada no escopo da suíte; não é benchmark ou garantia sobre toda configuração/dataset.

I14-1, anterior aoDB: completude/cleanup não eram gates obrigatórios no harness herdado. Corrigido somente no ledger14 com13controles RED→GREEN. Agora exige paths exatos/únicos,709/709 ou66/66,zero skips/todo, statuspassed por arquivo,exit0 e zero schemas restantes. Retorno independente encerrou I14-1 antes da primeira suíte.

## 6. Integridade e limpeza

Os90registros Meta e15arquivos finais11A permanecem intactos. Contra o baseline235 da11B, somente os dois testes justificados acima mudaram; durante o run final os235arquivos não tiveram alteração. Migrations001–011 e binários18originais preservados.

Os quatro clusters destaTask(RED17, focal17, focal18 e final17) foram parados pelo pg_ctl da respectiva versão e seus diretórios removidos após conferir owner/PID/data/porta. O build temporário inteiro(fonte, arquivo baixado e binários compilados) foi removido por script de alvo literal, validando realpath/UID/modo0700/owner e ausência de processos. Resultados em cleanup-build.json; logs, checksum e evidências permanecem no projeto. Nenhum recurso alheio ou arquivo do projeto foi removido. O build pode ser reproduzido a partir da fonte/hash oficiais.

## 7. Revisão e limites do aceite

Revisão independente de harness, retorno I14-1, correção de testes e cleanup realizada por /root/review_delivery_12. A revisão final aprovou as evidências e encerrou I14-1/F14-2: nenhum Critical, Important ou Minor aberto. Parecer em final-review.md no ledger14; o revisor não executou SQL/testes ou alterações.

Parecer técnico do ensaio: compatibilidade operacional local comprovada com PostgreSQL17.11 para as migrations/consultas/concorrência exercitadas. Não se certifica toda versão minor/configuração17, dados reais, roles, extensões alheias, Debian ou procedimento de atualização. O parecer estático12 permanece histórico, complementado por este resultado runtime.

Meta real continua bloqueada, OAuth Insights desabilitado por padrão; TikTok permanece frontend local. Nenhuma credencial real, chamada autenticada, publicação, SSH ou deploy. Validação em navegador, configuração realDocker/Compose, backup/restore e autorização operacional permanecem gates separados.

**Task 14 concluída: compatibilidade operacional local aprovada com PostgreSQL 17.11 no escopo ensaiado, sem finding impeditivo aberto.** Integridade e cleanup conferidos; sem autorização de deploy ou ativação real.

Task13 não foi executada. O inventário12 é um retrato anterior à14; futura seleção de commits deverá considerar os dois deltas adicionais de testes e este novo relatório. Índice permanece vazio. As evidências e o fechamento canônico estão no ledger14.
