import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Pool } from "pg";
import type { TenantRole } from "../../shared/authContract.ts";
import { PostgresAuthService, type CreatedAuthSession } from "../src/authService.ts";
import { runMigrations } from "../src/migrations.ts";

export function requirePostManagementTestDatabase(): string {
  const value = process.env.TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("TEST_DATABASE_URL is required; integration must not skip.");
  const identity = (input: string) => {
    const url = new URL(input);
    return JSON.stringify([
      url.searchParams.get("host") ?? url.hostname,
      url.port || "5432",
      decodeURIComponent(url.pathname.replace(/^\/+/, "")),
    ]);
  };
  const database = decodeURIComponent(new URL(value).pathname.replace(/^\/+/, ""));
  if (!database.endsWith("_test")) throw new Error("Expected exclusive _test database.");
  if (process.env.DATABASE_URL && identity(value) === identity(process.env.DATABASE_URL)) {
    throw new Error("Refusing application database identity.");
  }
  return value;
}

export function sessionRequest(session: CreatedAuthSession): IncomingMessage {
  return { headers: { cookie: `socialflow_session=${session.token}` } } as IncomingMessage;
}

export async function postManagementFixture() {
  const connectionString = requirePostManagementTestDatabase();
  const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = new Pool({ connectionString });
  let pool: Pool | undefined;
  async function close() {
    try {
      if (pool) await pool.end();
    } finally {
      try {
        await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await adminPool.end();
      }
    }
  }
  try {
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString, options: `-c search_path=${schema},public` });
    const db = pool;
    await runMigrations(db);
    const auth = new PostgresAuthService(db, 3_600);
    const register = (name: string) => auth.register({
      displayName: name, email: `${randomUUID()}@example.test`, password: "fixture-password-secret",
    });
    const author = await register("Author");
    const foreign = await register("Foreign owner");
    const tenantId = author.context.tenant.id;
    async function actor(name: string, role: TenantRole) {
      const original = await register(name);
      await db.query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, $3)",
        [tenantId, original.context.user.id, role]);
      return auth.selectWorkspace(sessionRequest(original), tenantId);
    }
    const member = await actor("Other member", "member");
    const administrator = await actor("Administrator", "admin");
    const owner = await actor("Owner", "owner");
    // The original author is a regular member; owner/admin are distinct actors.
    await db.query("UPDATE tenant_members SET role = 'member' WHERE id = $1", [author.context.membershipId]);
    author.context = await auth.require(sessionRequest(author));

    let nextExternalAccountId = 100;
    async function post(options: { tenantId?: string; authorUserId?: string; count?: number } = {}) {
      const postTenantId = options.tenantId ?? tenantId;
      const authorUserId = options.authorUserId ?? author.context.user.id;
      const postId = (await db.query<{ id: string }>(
        `INSERT INTO posts (tenant_id, author_user_id, caption, title, status, scheduled_for)
         VALUES ($1, $2, 'Scheduled message', 'Title', 'scheduled', clock_timestamp() + interval '1 day') RETURNING id`,
        [postTenantId, authorUserId],
      )).rows[0]!.id;
      const publications: { id: string; socialAccountId: string }[] = [];
      if ((options.count ?? 1) > 0) {
        const connectionId = (await db.query<{ id: string }>(
          `INSERT INTO oauth_connections (tenant_id, platform, external_user_id, access_token_encrypted, scopes, status)
           VALUES ($1, 'meta', $2, $3, ARRAY['pages_manage_posts'], 'active') RETURNING id`,
          [postTenantId, randomUUID(), Buffer.from("connection-token-secret")],
        )).rows[0]!.id;
        for (let index = 0; index < (options.count ?? 1); index++) {
          const socialAccountId = (await db.query<{ id: string }>(
            `INSERT INTO social_accounts (tenant_id, oauth_connection_id, account_type, external_account_id, metadata)
             VALUES ($1, $2, 'facebook_page', $3, '{"private":"account-metadata-secret"}') RETURNING id`,
            [postTenantId, connectionId, String(nextExternalAccountId++)],
          )).rows[0]!.id;
          await db.query(`INSERT INTO social_account_credentials (tenant_id, social_account_id, access_token_encrypted)
            VALUES ($1, $2, $3)`, [postTenantId, socialAccountId, Buffer.from("page-token-secret")]);
          const id = (await db.query<{ id: string }>(
            "INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3) RETURNING id",
            [postTenantId, postId, socialAccountId],
          )).rows[0]!.id;
          publications.push({ id, socialAccountId });
        }
      }
      return { postId, tenantId: postTenantId, authorUserId, publications };
    }
    async function eligible() {
      await db.query(`UPDATE social_accounts SET metadata='{"tasks":["CREATE_CONTENT"]}'`);
      await db.query(`UPDATE oauth_connections SET scopes=ARRAY['pages_show_list','pages_manage_posts','instagram_basic','instagram_content_publish','pages_read_engagement']`);
    }
    async function media(mime = "image/jpeg", mediaTenantId = tenantId, uploader = author.context.user.id) {
      const id = randomUUID();
      const extension = mime === "image/jpeg" ? "jpg" : mime === "video/quicktime" ? "mov" : mime.split("/")[1]!;
      await db.query(`INSERT INTO media_assets (id,tenant_id,uploaded_by_user_id,storage_key,
        original_filename,media_type,mime_type,size_bytes,sha256)
        VALUES ($1,$2,$3,$4,'asset',$5,$6,100,$7)`,
      [id, mediaTenantId, uploader, `${mediaTenantId}/${id}.${extension}`, mime.startsWith("video/") ? "video" : "image", mime, "a".repeat(64)]);
      return id;
    }
    return { pool: db, auth, author, member, administrator, owner, foreign, tenantId, post, eligible, media, close };
  } catch (error) {
    await close();
    throw error;
  }
}
