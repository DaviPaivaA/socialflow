# Etapa 7A — parecer PostgreSQL 17

Data da consulta: 2026-10-24. Base local: `e44b031d194a959e3f4182b246d17525a0ebc09c`, branch `feat/socialflow-7a-meta-insights` e alterações inventariadas na Task12.

**Parecer: nenhuma incompatibilidade SQL concreta com PostgreSQL 17 identificada no conjunto examinado; validação executável em 17 PENDENTE.** Os 709 testes PostgreSQL da Task11B rodaram em18.6, não em17. Isso não comprova paridade operacional.

## Ambiente e origem das afirmações

- PostgreSQL17 em produção é informação fornecida pelo operador. Debian, versão minor, extensões, permissões, configurações e dados reais não foram consultados.
- `command -v` e `postgres --version` localizaram somente PostgreSQL18.6 no ambiente local. Docker/Podman e binários17 nos caminhos convencionais verificados não estavam disponíveis. Não foi criada instância17, instalada dependência, baixado binário ou consultado banco persistente.
- Não renomear binários18 nem alterar PG_VERSION para simular17. Uma futura instância17 precisa de binários/extensões17 reais e diretório novo.
- O revisor independente leu integralmente migrations001–011, `server/src/migrations.ts`, `insightsRepository.ts`, `metaOAuthStateRepository.ts` e `postgresSocialAccountsRepository.ts`. Os legados de publicação foram confrontados nos pontos de integração e não têm delta.

## Matriz estática — referências oficiais da versão17

| Recurso observado | Onde importa | Evidência17 e conclusão limitada |
| --- | --- | --- |
| CTE `MATERIALIZED` | `insightsRepository.ts:91`; instantes de CAS legados | Disponível em [WITH17](https://www.postgresql.org/docs/17/queries-with.html). Não depende de18. |
| `LEFT JOIN LATERAL`, joins e subqueries parametrizadas | `insightsRepository.ts:105` e associações tenant-safe | Sintaxe documentada em [SELECT17](https://www.postgresql.org/docs/17/sql-select.html). |
| `FOR UPDATE OF`, `NOWAIT`, `SKIP LOCKED` | OAuth/session locks; claims legados | Suportados em [SELECT17](https://www.postgresql.org/docs/17/sql-select.html). Isso não certifica ausência de contenção/deadlock no ambiente real. |
| JSONB, build_object, agg ordenado, concatenação, extração/type | Snapshots privados de leitura e metadata de contas | Operações presentes em [JSON17](https://www.postgresql.org/docs/17/functions-json.html). Não há persistência de métricas nova. |
| `clock_timestamp`, `now`, timestamptz/interval | Expiração após lock e leases/checkpoints | [Data/hora17](https://www.postgresql.org/docs/17/functions-datetime.html) distingue relógio atual e início da transação. Preservar revalidação pós-espera. |
| `ON CONFLICT DO UPDATE`, `RETURNING` | Reconexão/persistência de contas e grants | Documentados em [INSERT17](https://www.postgresql.org/docs/17/sql-insert.html). Os privilégios reais não foram verificados. |
| `pg_advisory_lock/unlock` | Runner de migrations, lock de sessão | Presentes nas [funções administrativas17](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS). Runner libera emfinally; não alterar unidade transacional por conveniência. |
| Enum `ALTER TYPE ... ADD VALUE` | Migration006 e enums existentes | [ALTER TYPE17](https://www.postgresql.org/docs/17/sql-altertype.html) exige COMMIT antes de usar valor adicionado na mesma transação. `migrations.ts:68–89` faz transação por arquivo;006 é separada. |
| `pgcrypto`, `gen_random_uuid()` | Migrations001/005 e IDs locais | Disponíveis em [pgcrypto17](https://www.postgresql.org/docs/17/pgcrypto.html). Instalação da extensão e permissõesCREATE são pré-requisitos, não fatos confirmados na produção. Criptografia de tokens da aplicação continua AES-GCM em Node, não migração criptográfica SQL. |
| `pg_constraint`/`pg_attribute` | Reconciliação do schema em `migrations.ts:127–170` | Campos conkey/confkey/conrelid/confrelid/confdeltype/confupdtype/confmatchtype/condeferrable/condeferred e attrelid/attnum/attname existem nos catálogos [constraint17](https://www.postgresql.org/docs/17/catalog-pg-constraint.html) e [attribute17](https://www.postgresql.org/docs/17/catalog-pg-attribute.html). |
| Tipos/índices/CHECK/FK compostas já existentes | Migrations001–011 | Sem DDL novo na7A e arquivos idênticos à base. Não foi identificado recurso que exija18; a conclusão não substitui executar as migrations em17. |

Os reparos11B ajustam fixtures que gravavam microssegundos SQL mas exigiam vencimento usando Date de milissegundos. Não são um downgrade de SQL18, tolerância produtiva nem prova exclusiva de comportamento17. Os controles negativos de igualdade/futuro e a comparação produtiva estrita permaneceram intactos.

## Gate futuro para executar em17 — NÃO executado nesta Task

1. Autorizar ambiente local descartável com PostgreSQL17 real, minor e origem/digest registrados, extensões correspondentes e recursos exclusivos. Não reutilizar produção/dev persistente.
2. Confirmar major17 pelo executável e pelo servidor antes de SQL de aplicação. Criar diretório/volume novo, banco vazio `_test`, credenciais sintéticas, loopback/porta efêmera e cleanup restrito à identidade criada.
3. Conferir identidade, ausência de tabelas, aplicação001–011/checksums e idempotência em probe separado; remover probe antes das fixtures. Não editar migrations antigas.
4. Executar os21arquivos PostgreSQL, atualmente709casos, serialmente e com mocks Meta; incluir locks/expiração, reconexão, tenant/Workspace, HTTP, publicação/cancelamento, recuperação e fronteira microssegundo/Date.
5. Registrar zero skips/falhas, versões/SQL/recursos e cleanup. Não apontar o harness11B cegamente para17: ele usa os binários noPATH e baselines locais; a adaptação/ambiente precisa ser explicitamente verificada.
6. Acrescentar a nova evidência sem substituir a18.6. Uma divergência exige diagnóstico antes de qualquer patch. Só depois considerar liberar o gate pré-atualização.

## Efeito na decisão de entrega

- Preparação de commits revisáveis: parecer estático favorável, sem bloqueio de código SQL17 demonstrado.
- Merge/deploy: não autorizados. A regressão executável17, configuração real/permissões/pgcrypto e procedimento operacional continuam gates antes de uma atualização aprovada.
- Não foi executada nenhuma migration nestaTask12, nem leitura do banco Debian. A documentação oficial comprova disponibilidade dos recursos citados, não desempenho, dados, privilégios ou sucesso de uma operação real.
