import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { runMigrations } from "../src/migrations.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";

export const now = new Date("2027-08-13T13:00:00.000Z");
export const cipher = new SocialTokenCipher(Buffer.alloc(32, 7));
export const token = "private-page-token";

export async function publicationFixture() {
  const url = process.env.TEST_DATABASE_URL!;
  const parsed = new URL(url);
  if (!decodeURIComponent(parsed.pathname).endsWith("_test")) throw new Error("Expected isolated _test database");
  const identity = (value: string) => {
    const input = new URL(value);
    return `${input.searchParams.get("host") ?? input.hostname}:${input.port || "5432"}${input.pathname}`;
  };
  if (process.env.DATABASE_URL && identity(url) === identity(process.env.DATABASE_URL)) throw new Error("Refusing production database");
  const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
  await runMigrations(pool);
  async function post(count = 1, scheduledFor: Date | null = now) {
    const tenantId = (await pool.query("INSERT INTO tenants (name, slug) VALUES ('Publishing test', $1) RETURNING id", [randomUUID()])).rows[0].id as string;
    const authorUserId = (await pool.query("INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Publisher', 'fixture') RETURNING id", [`${randomUUID()}@example.test`])).rows[0].id as string;
    await pool.query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, authorUserId]);
    const postId = (await pool.query("INSERT INTO posts (tenant_id, author_user_id, caption, status, scheduled_for) VALUES ($1, $2, 'Message', $3, $4) RETURNING id", [tenantId, authorUserId, scheduledFor === null ? 'draft' : 'scheduled', scheduledFor])).rows[0].id as string;
    const connectionId = (await pool.query(`INSERT INTO oauth_connections (tenant_id, platform, external_user_id, access_token_encrypted, scopes, status)
      VALUES ($1, 'meta', $2, $3, $4, 'active') RETURNING id`, [tenantId, randomUUID(), Buffer.from(cipher.encryptSecret("user-token")), ["pages_manage_posts", "pages_show_list", "pages_read_engagement"]])).rows[0].id as string;
    const publications = [];
    for (let index = 0; index < count; index++) {
      const socialAccountId = (await pool.query(`INSERT INTO social_accounts (tenant_id, oauth_connection_id, account_type, external_account_id, metadata)
        VALUES ($1, $2, 'facebook_page', $3, '{"tasks":["CREATE_CONTENT"]}') RETURNING id`, [tenantId, connectionId, String(100 + index)])).rows[0].id as string;
      await pool.query("INSERT INTO social_account_credentials (tenant_id, social_account_id, access_token_encrypted) VALUES ($1, $2, $3)", [tenantId, socialAccountId, Buffer.from(cipher.encryptSecret(token))]);
      const id = (await pool.query("INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3) RETURNING id", [tenantId, postId, socialAccountId])).rows[0].id as string;
      publications.push({ id, tenantId, postId, socialAccountId });
    }
    return { tenantId, authorUserId, postId, connectionId, publications };
  }
  return { pool, post, async close() {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  } };
}
