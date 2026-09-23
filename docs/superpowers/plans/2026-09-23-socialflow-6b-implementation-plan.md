# SocialFlow Etapa 6B — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (recommended for this repo/session) or `superpowers:subagent-driven-development` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every production-code change and `superpowers:verification-before-completion` before claiming completion. Do **not** commit or push; this project owner wants to review the complete diff first.

**Goal:** Add a secure, transactional Post ↔ MediaAsset relation so `POST /posts` may reference zero or one existing media asset while PostgreSQL itself prevents cross-tenant relationships.

**Architecture:** Add a new `post_media` join table in migration 009 with composite tenant-aware foreign keys. Extend the Post contract with `mediaAssetIds`, then make `PostgresPostsStore.create` validate media and create the Post/relation in one PostgreSQL transaction. Read Posts with media IDs in a single query and keep frontend/mock behavior compatible without adding media UI.

**Tech Stack:** Node.js 22+, TypeScript 5.9, native `node:http`, PostgreSQL via `pg`, React/Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-socialflow-6b-design.md` (the approved 6B design supplied with this plan).

## Global Constraints

- `server/migrations/008_add_media_assets.sql` has already been applied in production and MUST NOT be edited.
- All schema changes go into `server/migrations/009_add_post_media.sql`.
- Tenant identity always comes from the authenticated session; never accept tenant authority from request data.
- 6B API accepts zero or one media asset, represented as `mediaAssetIds?: string[]`.
- Public `Post` responses always contain `mediaAssetIds: string[]`.
- No Composer media UI, preview, binary-serving endpoint, public URL, Meta publishing, deletion, carousel, TikTok, Analytics, or RAG.
- No new runtime dependency is expected.
- Do not move, copy, rename, or delete files under `MEDIA_STORAGE_PATH`.
- Do not modify Docker, Nginx, Tailscale, or production environment variables.
- Do not commit or push.

## Review Focus

1. **Cross-tenant UUID probing:** valid media UUID from another tenant must return the same 404 as an unknown UUID and leave no partial Post.
2. **Transaction rollback after Post INSERT:** a failure inserting `post_media` must roll back the newly inserted Post.
3. **Concurrent reuse:** two Posts may concurrently reuse the same MediaAsset in the same Workspace without deadlock or uniqueness failure.
4. **Legacy Posts:** existing Posts with no join rows must deserialize as `mediaAssetIds: []`, never `null`.
5. **Database-level isolation:** direct SQL attempting `Post tenant A -> MediaAsset tenant B` must fail even if application validation is bypassed.

---

## File Map

**Create**
- `server/migrations/009_add_post_media.sql` — tenant-safe relation and indexes.

**Modify**
- `shared/postContract.ts` — add `mediaAssetIds` to public `Post` and validate it.
- `server/src/postContract.ts` — add/normalize `mediaAssetIds` on `CreatePostInput`.
- `server/src/postsStore.ts` — single-query reads plus transactional create.
- `server/src/app.ts` — map unavailable media during Post creation to public 404.
- `server/test/postContract.test.ts` — contract RED/GREEN coverage.
- `server/test/api.integration.ts` — migration/schema, transaction, isolation, concurrency, cascade/restrict coverage.
- `src/data/posts/PostsRepository.ts` — frontend create type accepts optional `mediaAssetIds`.
- `src/data/posts/HttpPostsRepository.test.ts` — HTTP contract coverage.
- `src/data/posts/MockPostsRepository.ts` — default/copy `mediaAssetIds`.
- `src/data/posts/MockPostsRepository.test.ts` — mock behavior and defensive copy.
- `src/data/mockData.ts` — existing Posts get `mediaAssetIds: []`.
- any other test fixture containing a `Post` object that TypeScript identifies after the contract change.
- `README.md` — document 6B.
- `package.json` only if the existing integration test command needs adjustment; do not add dependencies.

---

### Task 1: Extend the Post contracts with `mediaAssetIds`

**Files:**
- Modify: `server/test/postContract.test.ts`
- Modify: `shared/postContract.ts`
- Modify: `server/src/postContract.ts`

**Interfaces:**
- Produces public `Post.mediaAssetIds: string[]`.
- Produces server `CreatePostInput.mediaAssetIds: string[]` after validation/normalization.
- The request may omit `mediaAssetIds`; validated data must normalize omission to `[]`.
- Later tasks consume these exact property names.

- [ ] **Step 1: Write failing contract tests**

In `server/test/postContract.test.ts`, add a media UUID constant:

```ts
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";
```

Update `validPost` to contain:

```ts
mediaAssetIds: [],
```

Add focused tests:

```ts
it("normaliza ausência de mediaAssetIds para lista vazia", () => {
  expect(validateCreatePost(validInput)).toEqual({
    success: true,
    data: {
      ...validInput,
      mediaAssetIds: [],
    },
  });
});

it("aceita uma mídia no DTO de criação", () => {
  expect(
    validateCreatePost({
      ...validInput,
      mediaAssetIds: [MEDIA_ID],
    }),
  ).toEqual({
    success: true,
    data: {
      ...validInput,
      mediaAssetIds: [MEDIA_ID],
    },
  });
});

it.each([
  ["null", null],
  ["string", MEDIA_ID],
  ["uuid inválido", ["media-invalida"]],
  ["duas mídias", [MEDIA_ID, "55555555-5555-4555-8555-555555555555"]],
  ["ids duplicados", [MEDIA_ID, MEDIA_ID]],
])("rejeita mediaAssetIds %s", (_label, mediaAssetIds) => {
  expect(
    validateCreatePost({ ...validInput, mediaAssetIds }),
  ).toEqual({
    success: false,
    fields: ["mediaAssetIds"],
  });
});

it("exige mediaAssetIds no Post público", () => {
  expect(isPost(validPost)).toBe(true);
  const { mediaAssetIds: _removed, ...withoutMedia } = validPost;
  expect(isPost(withoutMedia)).toBe(false);
  expect(isPost({ ...validPost, mediaAssetIds: [MEDIA_ID] })).toBe(true);
  expect(isPost({ ...validPost, mediaAssetIds: ["invalid"] })).toBe(false);
});
```

Adjust the existing first test so its expected validated data includes `mediaAssetIds: []`.

- [ ] **Step 2: Run the server contract test and verify RED**

Run:

```bash
npm run test:server -- server/test/postContract.test.ts
```

Expected: failures because `mediaAssetIds` is not yet part of `Post` validation and `validateCreatePost` does not normalize it.

Do not continue until the failures are caused by the missing 6B behavior rather than a typo.

- [ ] **Step 3: Implement the minimum shared/public contract**

In `shared/postContract.ts`, add:

```ts
mediaAssetIds: string[];
```

to `Post`.

Add a helper that validates a public array:

```ts
function isMediaAssetIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 1 &&
    value.every(isUuid) &&
    new Set(value).size === value.length
  );
}
```

Use it inside `isPost`:

```ts
isMediaAssetIds(post.mediaAssetIds)
```

Keep the current UUID and timestamp behavior unchanged.

- [ ] **Step 4: Implement request validation and normalization**

In `server/src/postContract.ts`, change `CreatePostInput` to:

```ts
export type CreatePostInput = {
  caption: string;
  mediaAssetIds: string[];
  scheduledFor: string;
  status: "scheduled";
  title?: string;
};
```

In `validateCreatePost`:

```ts
const mediaAssetIds =
  value.mediaAssetIds === undefined ? [] : value.mediaAssetIds;

if (
  !Array.isArray(mediaAssetIds) ||
  mediaAssetIds.length > 1 ||
  !mediaAssetIds.every(isUuid) ||
  new Set(mediaAssetIds).size !== mediaAssetIds.length
) {
  invalidFields.push("mediaAssetIds");
}
```

Import `isUuid` from the shared contract. On success return a fresh array:

```ts
mediaAssetIds: [...(mediaAssetIds as string[])],
```

Do not accept `null`, alternate property names, or tenant/user IDs as authority.

- [ ] **Step 5: Run the contract test and verify GREEN**

Run:

```bash
npm run test:server -- server/test/postContract.test.ts
```

Expected: PASS.

Then run the complete server unit suite:

```bash
npm run test:server
```

Expected: any remaining failures should be only downstream `Post` fixtures missing the newly-required field; note their file names for Task 4 rather than weakening `isPost`.

---

### Task 2: Add migration 009 and prove database-level tenant isolation

**Files:**
- Create: `server/migrations/009_add_post_media.sql`
- Modify: `server/test/api.integration.ts`

**Interfaces:**
- Produces table `post_media(tenant_id, post_id, media_asset_id, position, created_at)`.
- Produces candidate key `media_assets(tenant_id, id)`.
- Enables Task 3 to insert relation rows with composite FKs.

- [ ] **Step 1: Add failing migration/schema assertions**

In the fresh-schema integration test in `server/test/api.integration.ts`, update the expected migration count from 8 to 9 and the ordered migration list to end with:

```ts
"008_add_media_assets.sql",
"009_add_post_media.sql",
```

Extend `expectOfficialSchema` to include `post_media` and assert:

```ts
expect(byColumn.get("post_media.tenant_id")?.data_type).toBe("uuid");
expect(byColumn.get("post_media.post_id")?.data_type).toBe("uuid");
expect(byColumn.get("post_media.media_asset_id")?.data_type).toBe("uuid");
expect(byColumn.get("post_media.position")?.data_type).toBe("integer");
expect(byColumn.get("post_media.created_at")?.data_type).toBe(
  "timestamp with time zone",
);
```

Query `pg_constraint` for `post_media` and assert named constraints/definitions equivalent to:

```text
PRIMARY KEY (tenant_id, post_id, media_asset_id)
UNIQUE (tenant_id, post_id, position)
FOREIGN KEY (tenant_id, post_id)
  REFERENCES posts(tenant_id, id) ON DELETE CASCADE
FOREIGN KEY (tenant_id, media_asset_id)
  REFERENCES media_assets(tenant_id, id) ON DELETE RESTRICT
CHECK (position >= 0)
```

Also assert that `media_assets` has a unique key covering exactly `(tenant_id, id)` and that an index exists for `(tenant_id, media_asset_id)` on `post_media`.

- [ ] **Step 2: Run the integration test and verify RED**

With `TEST_DATABASE_URL` configured to the dedicated `_test` database, run:

```bash
node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run \
  --config vitest.server.config.ts \
  server/test/api.integration.ts
```

Expected: FAIL because migration 009 and `post_media` do not exist yet.

- [ ] **Step 3: Create migration 009**

Create `server/migrations/009_add_post_media.sql` with this shape:

```sql
ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_tenant_id_id_key
  UNIQUE (tenant_id, id);

CREATE TABLE post_media (
  tenant_id uuid NOT NULL,
  post_id uuid NOT NULL,
  media_asset_id uuid NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT post_media_pkey
    PRIMARY KEY (tenant_id, post_id, media_asset_id),

  CONSTRAINT post_media_tenant_post_position_key
    UNIQUE (tenant_id, post_id, position),

  CONSTRAINT post_media_position_nonnegative
    CHECK (position >= 0),

  CONSTRAINT post_media_post_fkey
    FOREIGN KEY (tenant_id, post_id)
    REFERENCES posts (tenant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT post_media_media_asset_fkey
    FOREIGN KEY (tenant_id, media_asset_id)
    REFERENCES media_assets (tenant_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_post_media_tenant_media_asset
  ON post_media (tenant_id, media_asset_id);
```

Before keeping that exact constraint name, inspect the existing schema/migrations to ensure `media_assets_tenant_id_id_key` is not already present. If an equivalent unique constraint already exists, do not create a duplicate; assert/reuse the existing candidate key instead. Never edit migration 008.

- [ ] **Step 4: Add direct database isolation/cascade/restrict tests**

In `server/test/api.integration.ts`, after creating two tenants, a Post in tenant A, and MediaAssets in tenants A/B, test direct SQL:

Cross-tenant relation must fail:

```ts
await expect(
  pool.query(
    `
      INSERT INTO post_media (
        tenant_id, post_id, media_asset_id, position
      )
      VALUES ($1::uuid, $2::uuid, $3::uuid, 0)
    `,
    [tenantA, postA, mediaB],
  ),
).rejects.toMatchObject({ code: "23503" });
```

For a valid relation, deleting the referenced media must fail:

```ts
await expect(
  pool.query(
    `DELETE FROM media_assets
     WHERE tenant_id = $1::uuid AND id = $2::uuid`,
    [tenantA, mediaA],
  ),
).rejects.toMatchObject({ code: "23503" });
```

Deleting the Post must remove its join row:

```ts
await pool.query(
  `DELETE FROM posts WHERE tenant_id = $1::uuid AND id = $2::uuid`,
  [tenantA, postA],
);

const relationCount = await pool.query<{ count: string }>(
  `SELECT count(*)::text AS count
   FROM post_media
   WHERE tenant_id = $1::uuid AND post_id = $2::uuid`,
  [tenantA, postA],
);

expect(relationCount.rows[0]?.count).toBe("0");
```

- [ ] **Step 5: Run the integration test and verify migration GREEN**

Run the same integration command.

Expected: migration/schema/direct-constraint assertions PASS. Post API media behavior may still be RED until Task 3.

---

### Task 3: Make Post reads and creation media-aware and transactional

**Files:**
- Modify: `server/src/postsStore.ts`
- Modify: `server/src/app.ts`
- Modify: `server/test/api.integration.ts`

**Interfaces:**
- `PostgresPostsStore.list(context): Promise<Post[]>` returns `mediaAssetIds`.
- `PostgresPostsStore.create(context, input): Promise<Post>` validates media and atomically inserts both tables.
- `PostMediaAssetNotFoundError` maps to `404 media_asset_not_found`.

- [ ] **Step 1: Add failing API integration behavior tests**

Add a helper in `server/test/api.integration.ts` that inserts a test MediaAsset directly without touching filesystem:

```ts
async function insertMediaAsset(
  pool: Pool,
  input: {
    tenantId: string;
    uploadedByUserId: string;
  },
) {
  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO media_assets (
        id,
        tenant_id,
        uploaded_by_user_id,
        storage_key,
        original_filename,
        media_type,
        mime_type,
        size_bytes,
        sha256
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3::uuid,
        $4,
        'fixture.jpg',
        'image',
        'image/jpeg',
        8,
        $5
      )
    `,
    [
      id,
      input.tenantId,
      input.uploadedByUserId,
      `${input.tenantId}/${id}.jpg`,
      "a".repeat(64),
    ],
  );
  return id;
}
```

Add behavior tests for:

```text
POST /posts without mediaAssetIds
→ 201
→ mediaAssetIds = []
→ zero post_media rows

POST /posts with [mediaA] from same tenant
→ 201
→ mediaAssetIds = [mediaA]
→ post_media position = 0

GET /posts
→ preserves mediaAssetIds after creation

unknown valid UUID
→ 404 media_asset_not_found
→ no new Post

media from another tenant
→ same 404 body as unknown UUID
→ no new Post

media with deleted_at set
→ same 404 body
→ no new Post
```

Use exact response check:

```ts
expect(await response.json()).toEqual({
  error: {
    code: "media_asset_not_found",
    message: "A mídia não foi encontrada.",
  },
});
```

For all three unavailable cases, compare bodies to ensure they are indistinguishable.

- [ ] **Step 2: Add same-workspace/reuse/concurrency tests**

Create a second user who is a member of tenant A and insert a MediaAsset with:

```text
tenant_id = tenant A
uploaded_by_user_id = second user
```

Then create a Post authenticated as the first user with that media. Expect `201`.

Test reuse:

```ts
const [first, second] = await Promise.all([
  apiFetch(`${baseUrl}/posts`, requestFor(mediaA), accountA.cookie),
  apiFetch(`${baseUrl}/posts`, requestFor(mediaA), accountA.cookie),
]);

expect(first.status).toBe(201);
expect(second.status).toBe(201);
```

Assert two different Post IDs and two valid `post_media` rows pointing to the same `media_asset_id`.

- [ ] **Step 3: Add rollback-after-Post-insert test**

The unavailable-media cases fail before Post INSERT, so add a test that proves rollback after the Post row has already been inserted.

Inside the isolated test schema, create a temporary trigger that deliberately rejects `post_media` insertion:

```sql
CREATE FUNCTION reject_post_media_for_test()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'forced post_media failure';
END;
$$;

CREATE TRIGGER reject_post_media_for_test
BEFORE INSERT ON post_media
FOR EACH ROW
EXECUTE FUNCTION reject_post_media_for_test();
```

Record Post count, call `POST /posts` with valid media, expect `500`, then assert the Post count is unchanged.

Remove the trigger/function in a `finally` block:

```sql
DROP TRIGGER IF EXISTS reject_post_media_for_test ON post_media;
DROP FUNCTION IF EXISTS reject_post_media_for_test();
```

This test must never run against production; it stays inside the integration schema.

- [ ] **Step 4: Run integration tests and verify RED**

Run:

```bash
node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run \
  --config vitest.server.config.ts \
  server/test/api.integration.ts
```

Expected: new API tests FAIL because Posts do not yet expose/use `mediaAssetIds`.

- [ ] **Step 5: Extend Post row mapping with one-query media aggregation**

In `server/src/postsStore.ts`, extend `PostRow`:

```ts
media_asset_ids: string[];
```

Extend the selected fields with a correlated array expression so every Post has one database query and no N+1:

```sql
ARRAY(
  SELECT relation.media_asset_id
  FROM post_media relation
  WHERE relation.tenant_id = posts.tenant_id
    AND relation.post_id = posts.id
  ORDER BY relation.position
) AS media_asset_ids
```

Because the existing `RETURNING_FIELDS` fragment is used by `INSERT ... RETURNING`, split the SQL constants if necessary:

```ts
const POST_COLUMNS = `...`;
const MEDIA_ASSET_IDS_SELECT = `...`;
```

Do not attempt to put a correlated subquery against `posts` into an `INSERT RETURNING` clause if that makes the SQL unclear. It is acceptable to insert first, create the relation, then SELECT the newly-created Post once inside the same transaction.

Map:

```ts
mediaAssetIds: row.media_asset_ids,
```

and let `isPost` validate it.

- [ ] **Step 6: Add a post-specific unavailable-media error**

In `server/src/postsStore.ts`:

```ts
export class PostMediaAssetNotFoundError extends Error {
  constructor() {
    super("A mídia não foi encontrada.");
    this.name = "PostMediaAssetNotFoundError";
  }
}
```

Use this error for nonexistent, cross-tenant, or `deleted_at IS NOT NULL` media IDs.

Do not leak which condition occurred.

- [ ] **Step 7: Refactor `create` into one PostgreSQL transaction**

Acquire a client:

```ts
const client = await this.pool.connect();
```

Use:

```ts
await client.query("BEGIN");
```

Run context validation using the same client.

For a requested media ID, validate under the authenticated tenant and protect the row through relation creation:

```sql
SELECT id
FROM media_assets
WHERE tenant_id = $1::uuid
  AND id = $2::uuid
  AND deleted_at IS NULL
FOR SHARE
```

`FOR SHARE` permits concurrent shared readers but blocks destructive update/delete while the transaction establishes the relation.

Then:

1. insert the Post;
2. insert `post_media` with `position = 0`;
3. SELECT the newly-created Post including ordered `mediaAssetIds`;
4. COMMIT;
5. return the mapped Post.

On every error after BEGIN:

```ts
await client.query("ROLLBACK");
throw error;
```

Always:

```ts
client.release();
```

Do not create a second transaction and do not use the media repository outside this transaction for authorization.

- [ ] **Step 8: Map the error in `app.ts`**

Import `PostMediaAssetNotFoundError` beside the other posts-store errors.

Before the generic 500 handler:

```ts
if (error instanceof PostMediaAssetNotFoundError) {
  sendJson(response, 404, {
    error: {
      code: "media_asset_not_found",
      message: error.message,
    },
  });
  return;
}
```

Do not expose tenant existence or `storage_key`.

- [ ] **Step 9: Run integration tests and verify GREEN**

Run:

```bash
node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run \
  --config vitest.server.config.ts \
  server/test/api.integration.ts
```

Expected: PASS, including unavailable-media equality, direct DB cross-tenant rejection, concurrency, rollback trigger, cascade, and restrict.

Then run:

```bash
npm run test:server
```

Expected: PASS except any frontend-only fixture failures that belong to Task 4.

---

### Task 4: Keep HTTP/mock frontend contracts compatible

**Files:**
- Modify: `src/data/posts/PostsRepository.ts`
- Modify: `src/data/posts/HttpPostsRepository.test.ts`
- Modify: `src/data/posts/MockPostsRepository.ts`
- Modify: `src/data/posts/MockPostsRepository.test.ts`
- Modify: `src/data/mockData.ts`
- Modify: any typed `Post` fixture identified by `tsc`/Vitest.

**Interfaces:**
- Frontend `CreatePostInput.mediaAssetIds?: string[]`.
- Composer remains unchanged and omits the field.
- HTTP repository sends the field when supplied and otherwise sends the existing DTO unchanged.
- Mock repository returns `Post.mediaAssetIds` and clones the array.

- [ ] **Step 1: Write failing HTTP repository tests**

In `src/data/posts/HttpPostsRepository.test.ts`:

Add:

```ts
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";
```

Add `mediaAssetIds: []` to `existingPost`.

Add a test:

```ts
it("envia mediaAssetIds quando a criação referencia mídia", async () => {
  const createdPost = { ...existingPost, mediaAssetIds: [MEDIA_ID] };
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(jsonResponse(createdPost, 201));
  const repository = createRepository(fetchMock);

  const input = {
    ...newPost,
    mediaAssetIds: [MEDIA_ID],
  };

  await expect(repository.create(input)).resolves.toEqual(createdPost);

  const requestBody = JSON.parse(
    String(fetchMock.mock.calls[0]?.[1]?.body),
  );
  expect(requestBody.mediaAssetIds).toEqual([MEDIA_ID]);
});
```

Add invalid response coverage:

```ts
[
  "mediaAssetIds ausente",
  [(() => {
    const { mediaAssetIds: _removed, ...post } = existingPost;
    return post;
  })()],
],
[
  "mediaAssetIds inválido",
  [{ ...existingPost, mediaAssetIds: ["invalid"] }],
],
```

- [ ] **Step 2: Write failing mock defensive-copy tests**

In `src/data/posts/MockPostsRepository.test.ts`, add `mediaAssetIds: []` to `existingPost`.

Add:

```ts
it("normaliza e clona mediaAssetIds", async () => {
  const mediaId = "44444444-4444-4444-8444-444444444444";
  const seed = { ...existingPost, mediaAssetIds: [mediaId] };
  const repository = new MockPostsRepository([seed]);

  const first = await repository.list();
  first[0]!.mediaAssetIds.push(
    "55555555-5555-4555-8555-555555555555",
  );

  const second = await repository.list();
  expect(second[0]!.mediaAssetIds).toEqual([mediaId]);

  const created = await repository.create(newPost);
  expect(created.mediaAssetIds).toEqual([]);
});
```

Also test a create with one supplied media ID if `CreatePostInput` accepts it.

- [ ] **Step 3: Run frontend tests and verify RED**

Run:

```bash
npm run test:frontend -- \
  src/data/posts/HttpPostsRepository.test.ts \
  src/data/posts/MockPostsRepository.test.ts
```

Expected: FAIL because frontend types/fixtures/mock do not yet support the required field.

- [ ] **Step 4: Implement the minimum frontend type change**

In `src/data/posts/PostsRepository.ts`:

```ts
export type CreatePostInput = {
  caption: string;
  mediaAssetIds?: string[];
  scheduledFor: string;
  status: "scheduled";
  title?: string;
};
```

Do not modify `Composer.tsx`; it should continue omitting `mediaAssetIds`.

- [ ] **Step 5: Update mock behavior**

In `MockPostsRepository.ts`, defensive clone:

```ts
function clonePost(post: Post): Post {
  return {
    ...post,
    mediaAssetIds: [...post.mediaAssetIds],
  };
}
```

When creating:

```ts
mediaAssetIds: [...(input.mediaAssetIds ?? [])],
```

Do not invent MediaAsset fixtures or validate tenant/media existence in the mock repository.

- [ ] **Step 6: Update existing Post fixtures**

In `src/data/mockData.ts`, add:

```ts
mediaAssetIds: [],
```

to every Post fixture.

Use TypeScript compiler/test failures to find any additional typed `Post` fixtures and add the correct explicit field. Do not make the public `Post.mediaAssetIds` optional just to avoid fixing fixtures.

- [ ] **Step 7: Verify frontend GREEN**

Run:

```bash
npm run test:frontend -- \
  src/data/posts/HttpPostsRepository.test.ts \
  src/data/posts/MockPostsRepository.test.ts
```

Expected: PASS.

Then run:

```bash
npm run test:frontend
```

Expected: PASS.

---

### Task 5: Documentation, immutable-migration check, and full verification

**Files:**
- Modify: `README.md`
- Inspect only: `server/migrations/008_add_media_assets.sql`
- Inspect: all changed files.

**Interfaces:**
- No new runtime interfaces.
- Produces deploy notes: migration 009 only, no new env/Docker/Nginx requirements.

- [ ] **Step 1: Update README**

Document:

```text
media_assets = uploaded media metadata
post_media = relation between Post and MediaAsset
POST /posts accepts mediaAssetIds
6B limit = 0 or 1 media ID
post_media.position prepares future ordered multi-media support
cross-tenant relation is blocked by composite PostgreSQL FKs
same MediaAsset may be reused by Posts in the same Workspace
Composer still has no media picker
media binary still has no public endpoint/URL
Meta publishing is not part of 6B
```

Do not reintroduce removed legacy/publishing-academic README sections.

- [ ] **Step 2: Prove migration 008 is untouched**

Run:

```bash
git diff -- server/migrations/008_add_media_assets.sql
```

Expected: no output.

If there is any output, revert only the unintended changes to migration 008 before proceeding.

- [ ] **Step 3: Review migration 009 before full suite**

Run:

```bash
git diff -- server/migrations/009_add_post_media.sql
```

Check explicitly:

```text
tenant-aware composite FK to posts
tenant-aware composite FK to media_assets
ON DELETE CASCADE for Post relation
ON DELETE RESTRICT for MediaAsset
nonnegative position
same-media-per-post uniqueness
same-position-per-post uniqueness
reverse lookup index
no destructive DDL
```

- [ ] **Step 4: Run complete fresh verification**

Run exactly:

```bash
npm run build
npm test
npm run test:integration
npm run lint
git diff --check
```

For `npm run test:integration`, `TEST_DATABASE_URL` must point to the dedicated database whose name ends in `_test`. Skipped PostgreSQL integration tests do not count as successful verification.

Expected: every command exits 0 and integration actually runs.

- [ ] **Step 5: Inspect final diff and forbidden scope**

Run:

```bash
git status --short
git diff --stat
git diff --name-only
git diff -- server/migrations/008_add_media_assets.sql
```

Confirm there are no unexpected changes to:

```text
Composer visual behavior
OAuth Meta
SocialAccounts lifecycle
Docker/Nginx/Tailscale configuration
MEDIA_STORAGE_PATH behavior
physical media files
migration 008
package dependencies
```

If `package.json` or `package-lock.json` changed only because of a new dependency, remove that dependency unless a concrete 6B requirement proves it necessary.

- [ ] **Step 6: Prepare the completion report without committing**

Report:

1. audit findings;
2. created/modified files;
3. explicit confirmation migration 008 is unchanged;
4. migration 009 schema and constraints;
5. how composite FKs enforce cross-tenant isolation;
6. exact `Post` / `CreatePostInput` changes;
7. how legacy Posts produce `mediaAssetIds: []`;
8. transaction/rollback design;
9. unavailable/cross-tenant/deleted media behavior;
10. reuse/concurrency behavior;
11. test cases added;
12. fresh command results and test counts;
13. deploy requirement: pull/build/apply migration 009/restart/smoke test;
14. confirmation that no env, Docker, Nginx or Tailscale change is needed;
15. confirmation that no commit or push was performed.

Do **not** claim completion from prior command output. Apply `superpowers:verification-before-completion`: completion claims require fresh command output from this implementation session.

---

## Execution Notes for Codex

- Follow tasks in order.
- For every behavior change, apply RED → verify RED → minimal GREEN → verify GREEN.
- Do not write production implementation before its failing test.
- If an existing behavior already passes the proposed RED test, strengthen the test so it proves the missing 6B requirement rather than proceeding with a false-green test.
- If implementation reveals a contradiction with the approved design, stop and report it instead of silently changing scope.
- Do not modify applied migration 008.
- Do not commit or push.
