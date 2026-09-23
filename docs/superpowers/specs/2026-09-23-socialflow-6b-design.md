# SocialFlow — Etapa 6B: Relação Post ↔ MediaAsset

**Data:** 2026-09-23  
**Status:** Design aprovado, aguardando revisão da especificação escrita  
**Branch-alvo:** `feat/routing-api-client`

## 1. Objetivo

Implementar uma relação persistente, segura e transacional entre `Post` e `MediaAsset`, permitindo que uma publicação referencie uma mídia previamente enviada pela Etapa 6A.

A Etapa 6B não implementa seleção/upload de mídia no Composer, preview, URL pública de mídia nem publicação em provedores sociais.

Critérios de sucesso:

- um Post pode ser criado sem mídia;
- um Post pode ser criado com exatamente uma mídia na API da 6B;
- a mesma mídia pode ser reutilizada por vários Posts do mesmo Workspace;
- uma mídia de outro Workspace nunca pode ser associada ao Post;
- o isolamento cross-tenant é garantido tanto pela aplicação quanto pelo PostgreSQL;
- Posts antigos permanecem válidos e retornam `mediaAssetIds: []`;
- criação de Post + relação com mídia é atômica;
- nenhuma operação da 6B altera o arquivo físico persistido pela 6A.

## 2. Estado atual

A aplicação já possui:

- autenticação por sessão opaca;
- contexto de Workspace derivado server-side;
- PostgreSQL;
- `posts`;
- `media_assets`;
- `POST /media-assets`;
- `GET /media-assets`;
- `GET /media-assets/:id`;
- storage persistente em filesystem;
- migration `008_add_media_assets.sql` já aplicada em produção.

A migration `008_add_media_assets.sql` é imutável. A 6B deve usar exclusivamente uma nova migration.

## 3. Escopo

Incluído:

- migration `009_add_post_media.sql`;
- tabela associativa `post_media`;
- contrato público de Post com `mediaAssetIds`;
- criação transacional de Post + relação;
- validação tenant-scoped da mídia;
- leitura de Posts com IDs de mídia agregados;
- compatibilidade com Posts antigos;
- testes de contratos, integração, constraints e concorrência;
- atualização mínima de frontend/mock para o novo contrato.

Fora do escopo:

- upload no Composer;
- preview;
- servir binário;
- URL pública ou assinada;
- DELETE de MediaAsset;
- exclusão física de arquivos;
- publicação Facebook/Instagram;
- permissões Meta de publicação;
- múltiplas mídias/carrossel em uso real;
- TikTok;
- Analytics;
- RAG;
- workers, filas e retries.

## 4. Modelo de dados

Criar `server/migrations/009_add_post_media.sql`.

Schema conceitual:

```sql
post_media (
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
)
```

Constraints:

- `PRIMARY KEY (tenant_id, post_id, media_asset_id)`;
- `UNIQUE (tenant_id, post_id, position)`;
- FK composta `(tenant_id, post_id) -> posts(tenant_id, id) ON DELETE CASCADE`;
- FK composta `(tenant_id, media_asset_id) -> media_assets(tenant_id, id) ON DELETE RESTRICT`.

Se `media_assets` ainda não possuir chave candidata compatível para a FK composta, a migration 009 deve adicionar `UNIQUE (tenant_id, id)`.

A migration 008 não deve ser alterada.

Adicionar índice útil para consultas reversas por mídia:

```sql
(tenant_id, media_asset_id)
```

## 5. Modelo de autorização

A autorização é por Workspace, não por `uploaded_by_user_id`.

Uma mídia enviada por outro membro do mesmo Workspace pode ser usada em um Post.

A proteção cross-tenant terá três níveis:

1. o tenant é derivado exclusivamente da sessão;
2. a validação SQL da mídia filtra por `tenant_id` e `deleted_at IS NULL`;
3. a FK composta do PostgreSQL impede relações cross-tenant mesmo diante de um bug na aplicação.

Uma mídia inexistente, soft-deleted ou pertencente a outro Workspace deve produzir o mesmo comportamento público:

- HTTP 404;
- `media_asset_not_found`.

A resposta não deve revelar se o UUID existe em outro tenant.

## 6. Contrato público

### `Post`

Adicionar campo obrigatório:

```ts
mediaAssetIds: string[];
```

Esse campo deve estar sempre presente.

Sem mídia:

```json
"mediaAssetIds": []
```

Com mídia:

```json
"mediaAssetIds": ["<uuid>"]
```

A ordem segue `post_media.position`.

Não aninhar `MediaAsset` inteiro dentro de `Post`.

Não expor `storage_key`, `sha256`, paths ou dados internos do filesystem.

### `CreatePostInput`

Adicionar:

```ts
mediaAssetIds?: string[];
```

Na 6B:

- ausente → normalizar para `[]`;
- `[]` → válido;
- `[uuid]` → válido;
- mais de um item → inválido;
- `null` → inválido;
- string em vez de array → inválido;
- UUID inválido → inválido;
- IDs duplicados → inválido.

Erro estrutural:

- HTTP 400;
- `invalid_post`;
- `fields: ["mediaAssetIds"]`.

A API usa array desde já para evitar nova quebra de contrato quando múltiplas mídias forem liberadas futuramente.

## 7. Criação transacional

`PostgresPostsStore.create` deve criar Post e relação na mesma transação.

Fluxo:

```text
BEGIN
  validar contexto
  validar media_assets dentro do tenant e com deleted_at IS NULL
  INSERT posts
  INSERT post_media (position = 0), quando aplicável
COMMIT
```

Qualquer falha deve executar `ROLLBACK`.

Não pode existir Post parcial caso a mídia seja inválida ou a inserção em `post_media` falhe.

A validação de mídia deve ocorrer na mesma transação da criação.

É aceitável usar um lock de leitura compatível, como `FOR SHARE`, se ele preservar concorrência legítima e impedir alterações destrutivas durante o vínculo. Não deve haver serialização desnecessária entre tenants ou entre Posts diferentes reutilizando a mesma mídia.

## 8. Reuso e concorrência

Uma mesma MediaAsset pode ser referenciada por vários Posts do mesmo Workspace.

Duas requisições concorrentes criando Posts diferentes com a mesma mídia são válidas.

Não criar unicidade global em `media_asset_id`.

A 6B não altera, move, copia ou remove o arquivo físico da mídia.

## 9. Leitura

`GET /posts` continua retornando `Post[]`, agora com `mediaAssetIds`.

Posts antigos ou sem relações devem retornar `[]`, nunca `null`.

Evitar N+1 queries. Preferir agregação/subquery/lateral ou outra consulta SQL simples e determinística.

A ordenação de Posts deve permanecer a atual.

A ordenação de `mediaAssetIds` deve seguir `position`.

## 10. Compatibilidade com frontend e mocks

Nenhuma mudança visual no Composer.

O Composer atual continuará criando Post sem `mediaAssetIds`, o que deve equivaler a `[]`.

Atualizar os contratos e repositories mínimos necessários.

`MockPostsRepository` deve:

- retornar `mediaAssetIds`;
- usar `[]` quando ausente;
- clonar o array para não compartilhar referência mutável.

Fixtures antigas de Post devem receber `mediaAssetIds: []`.

Não criar MediaAssets fake visíveis ao usuário.

## 11. Ciclo de vida

A política inicial é:

- deletar um Post → relações `post_media` desaparecem por CASCADE;
- deletar fisicamente uma MediaAsset referenciada → bloqueado por RESTRICT;
- remover uma relação/Post não remove a MediaAsset nem o arquivo físico.

Não criar endpoint DELETE de mídia nesta etapa.

`deleted_at IS NOT NULL` impede novo vínculo, mas a 6B não implementa o soft-delete.

## 12. Erros

Mídia inválida estruturalmente no request:

- `400 invalid_post`;
- `fields: ["mediaAssetIds"]`.

Mídia sintaticamente válida mas indisponível no Workspace:

- `404 media_asset_not_found`.

Falhas internas permanecem no mecanismo existente de erro 500, sem vazar SQL, filesystem path, `storage_key`, `sha256` ou segredos.

## 13. Testes obrigatórios

### Contratos

Cobrir:

- ausência de `mediaAssetIds`;
- `[]`;
- `[uuid]`;
- UUID inválido;
- `null`;
- string;
- dois IDs;
- duplicatas.

### Integração PostgreSQL

Cobrir:

- migration 009 aplicada;
- runner idempotente;
- schema de `post_media`;
- FK composta para Post;
- FK composta para MediaAsset;
- CASCADE do Post;
- RESTRICT da MediaAsset;
- unique de posição;
- Post sem mídia;
- Post com mídia válida;
- GET preserva relação;
- restart preserva relação;
- mídia inexistente;
- mídia de outro tenant;
- mídia soft-deleted;
- mídia enviada por outro usuário do mesmo tenant;
- mesma mídia em dois Posts;
- rollback sem Post parcial;
- relação cross-tenant direta falha no PostgreSQL;
- respostas públicas não expõem campos internos.

### Compatibilidade

Posts preexistentes sem `post_media` devem retornar:

```json
"mediaAssetIds": []
```

### Frontend/mock

Atualizar testes afetados pelo novo campo e garantir clone seguro do array.

## 14. Arquivos esperados

Criação:

- `server/migrations/009_add_post_media.sql`

Modificações prováveis:

- `shared/postContract.ts`
- `server/src/postContract.ts`
- `server/src/postsStore.ts`
- `src/data/posts/PostsRepository.ts`
- `src/data/posts/HttpPostsRepository.ts`
- `src/data/posts/MockPostsRepository.ts`
- `src/data/mockData.ts`
- testes relacionados a posts/migrations
- `README.md`

Não adicionar dependências sem necessidade.

## 15. Deploy

A 6B não deve exigir nova variável de ambiente, novo volume, mudança em Nginx ou mudança no Tailscale Funnel.

Deploy esperado:

1. atualizar código;
2. rebuild da API/web conforme necessário;
3. aplicar migration 009;
4. subir os containers;
5. executar smoke tests.

A migration 009 deve ser aditiva e preservar dados existentes.

## 16. Restrições globais

- Node 22+;
- TypeScript/NodeNext atuais;
- PostgreSQL com `pg`;
- sem ORM;
- sem novo framework HTTP;
- manter compatibilidade com o runtime TypeScript atual;
- não alterar migration 008;
- não introduzir comportamento de publicação;
- preservar autenticação, Workspaces, Social Accounts e OAuth Meta.

## 17. Critérios de conclusão

A 6B está concluída quando:

- todas as migrations 001–009 aplicam corretamente;
- criação de Post sem mídia continua funcionando;
- criação com uma mídia válida funciona;
- cross-tenant é bloqueado pela aplicação e pelo banco;
- criação é atômica;
- GET /posts sempre retorna `mediaAssetIds`;
- posts legados continuam funcionando;
- arquivos físicos da 6A permanecem inalterados;
- build, testes, integração, lint e diff-check passam com evidência fresca.

Comandos finais:

```bash
npm run build
npm test
npm run test:integration
npm run lint
git diff --check
```

Nenhum commit/push de implementação deve ser feito antes da revisão final.
