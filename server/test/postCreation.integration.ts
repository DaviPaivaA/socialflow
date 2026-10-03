import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrations.ts";
import type { CreatePostInput } from "../src/postContract.ts";
import { PostgresPostsStore } from "../src/postsStore.ts";

const SCHEDULED_FOR = "2027-08-13T13:00:00.000Z";
const REQUIRED_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];

function databaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("TEST_DATABASE_URL não foi definida.");
  const testUrl = new URL(value);
  if (!decodeURIComponent(testUrl.pathname).replace(/^\/+/, "").endsWith("_test")) {
    throw new Error("O banco de integração deve terminar em _test.");
  }
  const production = process.env.DATABASE_URL?.trim();
  if (production) {
    const url = new URL(production);
    const identity = (input: URL) => `${input.searchParams.get("host") ?? input.hostname}:${input.port || "5432"}${input.pathname}`;
    if (identity(testUrl) === identity(url)) throw new Error("TEST_DATABASE_URL não pode ser igual a DATABASE_URL.");
  }
  return value;
}

function input(socialAccountIds: string[], mediaAssetIds: string[] = []): CreatePostInput {
  return {
    caption: "Publicação de teste",
    mediaAssetIds,
    publicationMode: "scheduled",
    scheduledFor: SCHEDULED_FOR,
    socialAccountIds,
    title: "Título de teste",
  };
}

describe("criação atômica de posts com Facebook Pages", () => {
  if (!process.env.TEST_DATABASE_URL) {
    it.skip("exige TEST_DATABASE_URL", () => undefined);
    return;
  }

  const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool;
  let pool: Pool;
  let store: PostgresPostsStore;

  beforeAll(async () => {
    const url = databaseUrl();
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
    await runMigrations(pool);
    store = new PostgresPostsStore(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  async function tenant() {
    const tenantId = (await pool.query<{ id: string }>(
      "INSERT INTO tenants (name, slug) VALUES ('Creation Test', $1) RETURNING id",
      [`creation-${randomUUID()}`],
    )).rows[0]!.id;
    const authorUserId = (await pool.query<{ id: string }>(
      "INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Creation Test', 'fixture-hash') RETURNING id",
      [`creation-${randomUUID()}@example.test`],
    )).rows[0]!.id;
    await pool.query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, authorUserId]);
    return { tenantId, authorUserId };
  }

  async function account(tenantId: string, kind: "facebook_page" | "instagram_business" | "tiktok_account" = "facebook_page") {
    const platform = kind === "tiktok_account" ? "tiktok" : "meta";
    const connectionId = (await pool.query<{ id: string }>(
      `INSERT INTO oauth_connections (tenant_id, platform, external_user_id, access_token_encrypted, scopes, status)
       VALUES ($1, $2, $3, $4, $5::text[], 'active') RETURNING id`,
      [tenantId, platform, `user-${randomUUID()}`, Buffer.from("encrypted-user-token"), REQUIRED_SCOPES],
    )).rows[0]!.id;
    const accountId = (await pool.query<{ id: string }>(
      `INSERT INTO social_accounts (tenant_id, oauth_connection_id, account_type, external_account_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
      [tenantId, connectionId, kind, `page-${randomUUID()}`, JSON.stringify({ tasks: ["CREATE_CONTENT"] })],
    )).rows[0]!.id;
    await pool.query(
      `INSERT INTO social_account_credentials (tenant_id, social_account_id, access_token_encrypted)
       VALUES ($1, $2, $3)`,
      [tenantId, accountId, Buffer.from("encrypted-page-token")],
    );
    return { accountId, connectionId };
  }

  async function media(tenantId: string, authorUserId: string, mimeType: string, sizeBytes = 8) {
    const mediaId = randomUUID();
    const mediaType = mimeType.startsWith("image/") ? "image" : "video";
    const suffix = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : mimeType === "video/mp4" ? "mp4" : "jpg";
    await pool.query(
      `INSERT INTO media_assets (id, tenant_id, uploaded_by_user_id, storage_key,
        original_filename, media_type, mime_type, size_bytes, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [mediaId, tenantId, authorUserId, `${tenantId}/${mediaId}.${suffix}`, `fixture.${suffix}`, mediaType, mimeType, sizeBytes, "a".repeat(64)],
    );
    return mediaId;
  }

  async function counts(tenantId: string) {
    const result = await pool.query<{ posts: number; media: number; publications: number }>(
      `SELECT
         (SELECT count(*)::int FROM posts WHERE tenant_id = $1) AS posts,
         (SELECT count(*)::int FROM post_media WHERE tenant_id = $1) AS media,
         (SELECT count(*)::int FROM post_publications WHERE tenant_id = $1) AS publications`,
      [tenantId],
    );
    return result.rows[0]!;
  }

  it("persiste post, imagem e publicação da Page na mesma criação", async () => {
    const context = await tenant();
    const page = await account(context.tenantId);
    const imageId = await media(context.tenantId, context.authorUserId, "image/jpeg");

    const result = await store.create(context, input([page.accountId], [imageId]));

    expect(result.post).toMatchObject({
      tenantId: context.tenantId,
      authorUserId: context.authorUserId,
      status: "scheduled",
      scheduledFor: SCHEDULED_FOR,
      mediaAssetIds: [imageId],
    });
    expect(result.publications).toHaveLength(1);
    expect(result.publications[0]).toMatchObject({
      tenantId: context.tenantId,
      postId: result.post.id,
      socialAccountId: page.accountId,
      status: "scheduled",
    });
    expect(await counts(context.tenantId)).toEqual({ posts: 1, media: 1, publications: 1 });
  });

  it("cria exatamente uma publicação por Page solicitada", async () => {
    const context = await tenant();
    const first = await account(context.tenantId);
    const second = await account(context.tenantId);
    const result = await store.create(context, input([first.accountId, second.accountId]));
    expect(result.publications.map((row) => row.socialAccountId)).toEqual([first.accountId, second.accountId]);
    expect(await counts(context.tenantId)).toEqual({ posts: 1, media: 0, publications: 2 });
  });

  it("usa o relógio do banco para publicação now, ignorando relógio do cliente", async () => {
    const context = await tenant();
    const page = await account(context.tenantId);
    const before = Date.now();
    const result = await store.create(context, { ...input([page.accountId]), publicationMode: "now", scheduledFor: null });
    const after = Date.now();
    expect(new Date(result.post.scheduledFor!).getTime()).toBeGreaterThanOrEqual(before - 1_000);
    expect(new Date(result.post.scheduledFor!).getTime()).toBeLessThanOrEqual(after + 1_000);
  });

  it("aceita imagem JPEG com exatamente 4.000.000 bytes", async () => {
    const context = await tenant();
    const page = await account(context.tenantId);
    const mediaId = await media(context.tenantId, context.authorUserId, "image/jpeg", 4_000_000);
    const result = await store.create(context, input([page.accountId], [mediaId]));
    expect(result.post.mediaAssetIds).toEqual([mediaId]);
    expect(result.publications).toHaveLength(1);
  });

  it("não distingue Page de outro tenant de ID desconhecido", async () => {
    const context = await tenant();
    const other = await tenant();
    const foreign = await account(other.tenantId);
    const missing = randomUUID();
    for (const accountId of [foreign.accountId, missing]) {
      await expect(store.create(context, input([accountId]))).rejects.toMatchObject({ name: "InvalidPostDestinationError" });
      expect(await counts(context.tenantId)).toEqual({ posts: 0, media: 0, publications: 0 });
    }
  });

  it.each(["instagram_business", "tiktok_account"] as const)("rejeita destino %s", async (kind) => {
    const context = await tenant();
    const destination = await account(context.tenantId, kind);
    await expect(store.create(context, input([destination.accountId]))).rejects.toMatchObject({ name: "InvalidPostDestinationError" });
    expect(await counts(context.tenantId)).toEqual({ posts: 0, media: 0, publications: 0 });
  });

  it.each([
    ["inativa", "UPDATE social_accounts SET is_active = false WHERE id = $1"],
    ["desconectada", "UPDATE social_accounts SET disconnected_at = now() WHERE id = $1"],
    ["conexão expirada", "UPDATE oauth_connections SET status = 'expired' WHERE id = $1"],
    ["conexão revogada", "UPDATE oauth_connections SET status = 'revoked', revoked_at = now(), access_token_encrypted = NULL WHERE id = $1"],
    ["token da conexão ausente", "UPDATE oauth_connections SET access_token_encrypted = NULL WHERE id = $1"],
    ["token da conexão vencido", "UPDATE oauth_connections SET access_token_expires_at = now() - interval '1 second' WHERE id = $1"],
    ["credencial ausente", "DELETE FROM social_account_credentials WHERE social_account_id = $1"],
    ["token Page ausente", "UPDATE social_account_credentials SET access_token_encrypted = NULL WHERE social_account_id = $1"],
    ["token Page vencido", "UPDATE social_account_credentials SET access_token_expires_at = now() - interval '1 second' WHERE social_account_id = $1"],
    ["scope ausente", "UPDATE oauth_connections SET scopes = ARRAY['pages_show_list', 'pages_read_engagement'] WHERE id = $1"],
    ["task ausente", "UPDATE social_accounts SET metadata = '{\"tasks\":[]}'::jsonb WHERE id = $1"],
  ])("rejeita Page com %s", async (_label, statement) => {
    const context = await tenant();
    const page = await account(context.tenantId);
    await pool.query(statement, [statement.includes("oauth_connections") ? page.connectionId : page.accountId]);
    await expect(store.create(context, input([page.accountId]))).rejects.toMatchObject({ name: "InvalidPostDestinationError" });
    expect(await counts(context.tenantId)).toEqual({ posts: 0, media: 0, publications: 0 });
  });

  it.each([
    ["video/mp4", 8],
    ["image/webp", 8],
    ["image/png", 4_000_001],
  ])("rejeita mídia %s com tamanho %i sem apagar o upload", async (mimeType, sizeBytes) => {
    const context = await tenant();
    const page = await account(context.tenantId);
    const mediaId = await media(context.tenantId, context.authorUserId, mimeType, sizeBytes);
    await expect(store.create(context, input([page.accountId], [mediaId]))).rejects.toMatchObject({ name: "PostMediaAssetUnsupportedError" });
    expect(await counts(context.tenantId)).toEqual({ posts: 0, media: 0, publications: 0 });
    expect((await pool.query("SELECT id FROM media_assets WHERE id = $1", [mediaId])).rowCount).toBe(1);
  });

  it("faz rollback integral se qualquer destino solicitado for inválido", async () => {
    const context = await tenant();
    const valid = await account(context.tenantId);
    const imageId = await media(context.tenantId, context.authorUserId, "image/png");
    await expect(store.create(context, input([valid.accountId, randomUUID()], [imageId]))).rejects.toMatchObject({ name: "InvalidPostDestinationError" });
    expect(await counts(context.tenantId)).toEqual({ posts: 0, media: 0, publications: 0 });
  });
});
