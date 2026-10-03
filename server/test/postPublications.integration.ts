import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrations.ts";

function testDatabaseUrl(): string {
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

describe("post_publications com PostgreSQL real", () => {
  if (!process.env.TEST_DATABASE_URL) {
    it.skip("exige TEST_DATABASE_URL", () => undefined);
    return;
  }

  it("instala a migration 010 idempotentemente e preserva as nove anteriores", async () => {
    const databaseUrl = testDatabaseUrl();
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await runMigrations(pool);
      await runMigrations(pool);
      const result = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
      expect(result.rows.map((row) => row.name)).toEqual([
        "001_create_posts.sql",
        "002_enforce_post_content.sql",
        "003_reconcile_official_multitenant_schema.sql",
        "004_add_auth_sessions.sql",
        "005_add_social_accounts.sql",
        "006_add_pending_social_connection_status.sql",
        "007_add_oauth_authorization_requests.sql",
        "008_add_media_assets.sql",
        "009_add_post_media.sql",
        "010_add_post_publications.sql",
      ]);

      const columns = await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'post_publications'
      `);
      const byName = new Map(columns.rows.map((row) => [row.column_name, row]));
      expect(byName.size).toBe(13);
      for (const name of ["id", "tenant_id", "post_id", "social_account_id"]) {
        expect(byName.get(name)).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
      }
      expect(byName.get("id")?.column_default).toContain("gen_random_uuid()");
      expect(byName.get("status")).toMatchObject({ is_nullable: "NO" });
      expect(byName.get("status")?.column_default).toContain("scheduled");
      const statuses = await pool.query<{ enumlabel: string }>(`
        SELECT value.enumlabel FROM pg_type type_row
        JOIN pg_enum value ON value.enumtypid = type_row.oid
        JOIN pg_namespace namespace_row ON namespace_row.oid = type_row.typnamespace
        WHERE namespace_row.nspname = current_schema()
          AND type_row.typname = 'post_publication_status'
        ORDER BY value.enumsortorder
      `);
      expect(statuses.rows.map((row) => row.enumlabel)).toEqual([
        "scheduled", "publishing", "published", "failed", "cancelled",
      ]);
      for (const name of ["provider_post_id", "error_code", "error_message", "started_at", "published_at", "failed_at"]) {
        expect(byName.get(name)?.is_nullable).toBe("YES");
      }
      for (const name of ["created_at", "updated_at"]) {
        expect(byName.get(name)).toMatchObject({ data_type: "timestamp with time zone", is_nullable: "NO" });
      }

      const constraints = await pool.query<{ conname: string; contype: string; definition: string }>(`
        SELECT conname, contype, pg_get_constraintdef(oid, true) AS definition
        FROM pg_constraint WHERE conrelid = 'post_publications'::regclass
      `);
      const definitions = constraints.rows.map((row) => row.definition);
      expect(definitions).toContain("UNIQUE (tenant_id, post_id, social_account_id)");
      expect(definitions).toContain("FOREIGN KEY (tenant_id, post_id) REFERENCES posts(tenant_id, id) ON DELETE CASCADE");
      expect(definitions).toContain("FOREIGN KEY (tenant_id, social_account_id) REFERENCES social_accounts(tenant_id, id) ON DELETE RESTRICT");
      const socialKeys = await pool.query<{ definition: string }>(`
        SELECT pg_get_constraintdef(oid, true) AS definition FROM pg_constraint
        WHERE conrelid = 'social_accounts'::regclass AND contype = 'u'
      `);
      expect(socialKeys.rows.map((row) => row.definition)).toContain("UNIQUE (tenant_id, id)");
      const indexes = await pool.query<{ indexdef: string }>(`
        SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'post_publications'
      `);
      expect(indexes.rows.some((row) => /ON .*post_publications USING btree \(status, tenant_id, post_id\)/.test(row.indexdef))).toBe(true);
      const duePostIndexes = await pool.query<{ indexdef: string }>(`
        SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'posts'
      `);
      expect(duePostIndexes.rows.some((row) => /ON .*posts USING btree \(scheduled_for, tenant_id, id\) WHERE \(scheduled_for IS NOT NULL\)/.test(row.indexdef))).toBe(true);

      const tenantId = (await pool.query<{ id: string }>(
        "INSERT INTO tenants (name, slug) VALUES ('Publication Test', $1) RETURNING id",
        [`publication-${randomUUID()}`],
      )).rows[0]!.id;
      const userId = (await pool.query<{ id: string }>(
        "INSERT INTO users (email, display_name, password_hash) VALUES ($1, 'Publication Test', 'fixture-hash') RETURNING id",
        [`publication-${randomUUID()}@example.test`],
      )).rows[0]!.id;
      await pool.query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, userId]);
      const postId = (await pool.query<{ id: string }>(
        "INSERT INTO posts (tenant_id, author_user_id, caption, status, scheduled_for) VALUES ($1, $2, 'Post', 'scheduled', '2027-08-13T13:00:00Z') RETURNING id",
        [tenantId, userId],
      )).rows[0]!.id;
      const oauthId = (await pool.query<{ id: string }>(
        "INSERT INTO oauth_connections (tenant_id, platform, external_user_id) VALUES ($1, 'meta', $2) RETURNING id",
        [tenantId, `oauth-${randomUUID()}`],
      )).rows[0]!.id;
      const socialAccountId = (await pool.query<{ id: string }>(
        "INSERT INTO social_accounts (tenant_id, oauth_connection_id, account_type, external_account_id) VALUES ($1, $2, 'facebook_page', $3) RETURNING id",
        [tenantId, oauthId, `page-${randomUUID()}`],
      )).rows[0]!.id;
      const inserted = await pool.query<{ id: string; status: string }>(
        "INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3) RETURNING id, status",
        [tenantId, postId, socialAccountId],
      );
      expect(inserted.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(inserted.rows[0]?.status).toBe("scheduled");
      for (const status of ["publishing", "published", "failed", "cancelled", "scheduled"]) {
        await pool.query("UPDATE post_publications SET status = $1 WHERE id = $2", [status, inserted.rows[0]!.id]);
      }
      await expect(pool.query("UPDATE post_publications SET status = 'partially_failed' WHERE id = $1", [inserted.rows[0]!.id])).rejects.toThrow();
      await expect(pool.query(
        "INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3)",
        [tenantId, postId, socialAccountId],
      )).rejects.toMatchObject({ code: "23505" });
      await expect(pool.query(
        "INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3)",
        [tenantId, randomUUID(), socialAccountId],
      )).rejects.toMatchObject({ code: "23503" });
      await expect(pool.query(
        "INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3)",
        [tenantId, postId, randomUUID()],
      )).rejects.toMatchObject({ code: "23503" });
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it("atualiza 009 com dados, preserva registros e impede ligações entre tenants", async () => {
    const databaseUrl = testDatabaseUrl();
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    const migrationDirectory = await mkdtemp(join(tmpdir(), "socialflow-6d-migrations-"));
    const sourceDirectory = resolve(process.cwd(), "server/migrations");
    const admin = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const oldMigrations = (await readdir(sourceDirectory))
        .filter((name) => /^00[1-9]_[a-z0-9_]+\.sql$/.test(name))
        .sort();
      expect(oldMigrations).toHaveLength(9);
      for (const name of oldMigrations) {
        await copyFile(resolve(sourceDirectory, name), resolve(migrationDirectory, name));
      }
      await runMigrations(pool, migrationDirectory);
      const beforeMigrations = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM schema_migrations");
      expect(beforeMigrations.rows[0]?.count).toBe(9);

      async function createTenantFixture(label: string, scheduledFor: string) {
        const tenantId = (await pool.query<{ id: string }>(
          "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id",
          [`Tenant ${label}`, `publication-${randomUUID()}`],
        )).rows[0]!.id;
        const userId = (await pool.query<{ id: string }>(
          "INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, 'fixture-hash') RETURNING id",
          [`publication-${randomUUID()}@example.test`, `User ${label}`],
        )).rows[0]!.id;
        await pool.query("INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [tenantId, userId]);
        const postId = (await pool.query<{ id: string }>(
          "INSERT INTO posts (tenant_id, author_user_id, caption, status, scheduled_for) VALUES ($1, $2, $3, 'scheduled', $4) RETURNING id",
          [tenantId, userId, `Post ${label}`, scheduledFor],
        )).rows[0]!.id;
        const oauthId = (await pool.query<{ id: string }>(
          "INSERT INTO oauth_connections (tenant_id, platform, external_user_id) VALUES ($1, 'meta', $2) RETURNING id",
          [tenantId, `oauth-${randomUUID()}`],
        )).rows[0]!.id;
        const socialAccountId = (await pool.query<{ id: string }>(
          "INSERT INTO social_accounts (tenant_id, oauth_connection_id, account_type, external_account_id) VALUES ($1, $2, 'facebook_page', $3) RETURNING id",
          [tenantId, oauthId, `page-${randomUUID()}`],
        )).rows[0]!.id;
        return { tenantId, postId, socialAccountId };
      }

      const due = await createTenantFixture("due", "2027-08-13T13:00:00Z");
      const future = await createTenantFixture("future", "2028-08-13T13:00:00Z");
      const oldPosts = await pool.query<{ id: string; tenant_id: string; caption: string }>(
        "SELECT id, tenant_id, caption FROM posts ORDER BY id",
      );
      const oldAccounts = await pool.query<{ id: string; tenant_id: string; external_account_id: string }>(
        "SELECT id, tenant_id, external_account_id FROM social_accounts ORDER BY id",
      );
      expect(oldPosts.rows).toHaveLength(2);
      expect(oldAccounts.rows).toHaveLength(2);

      await copyFile(resolve(sourceDirectory, "010_add_post_publications.sql"), resolve(migrationDirectory, "010_add_post_publications.sql"));
      await runMigrations(pool, migrationDirectory);
      await runMigrations(pool, migrationDirectory);
      const afterMigrations = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
      expect(afterMigrations.rows).toHaveLength(10);
      expect(afterMigrations.rows.at(-1)?.name).toBe("010_add_post_publications.sql");
      const preservedPosts = await pool.query<{ id: string; tenant_id: string; caption: string }>(
        "SELECT id, tenant_id, caption FROM posts ORDER BY id",
      );
      const preservedAccounts = await pool.query<{ id: string; tenant_id: string; external_account_id: string }>(
        "SELECT id, tenant_id, external_account_id FROM social_accounts ORDER BY id",
      );
      expect(preservedPosts.rows).toEqual(oldPosts.rows);
      expect(preservedAccounts.rows).toEqual(oldAccounts.rows);
      for (const fixture of [due, future]) {
        await pool.query(
          "INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3)",
          [fixture.tenantId, fixture.postId, fixture.socialAccountId],
        );
      }
      await expect(pool.query(
        "INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3)",
        [due.tenantId, future.postId, due.socialAccountId],
      )).rejects.toMatchObject({ code: "23503" });
      await expect(pool.query(
        "INSERT INTO post_publications (tenant_id, post_id, social_account_id) VALUES ($1, $2, $3)",
        [due.tenantId, due.postId, future.socialAccountId],
      )).rejects.toMatchObject({ code: "23503" });

      const dueWork = await pool.query<{ post_id: string }>(`
        SELECT publication.post_id
        FROM posts post_row
        JOIN post_publications publication
          ON publication.tenant_id = post_row.tenant_id
         AND publication.post_id = post_row.id
        WHERE post_row.scheduled_for <= '2027-08-13T13:00:00Z'
          AND publication.status = 'scheduled'
        ORDER BY post_row.scheduled_for, post_row.tenant_id, post_row.id
      `);
      expect(dueWork.rows).toEqual([{ post_id: due.postId }]);
      const planner = await pool.connect();
      try {
        await planner.query("BEGIN");
        await planner.query("SET LOCAL enable_seqscan = off");
        const plan = await planner.query<{ "QUERY PLAN": string }>(`
          EXPLAIN SELECT id FROM posts
          WHERE scheduled_for <= '2027-08-13T13:00:00Z'
        `);
        expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("idx_posts_due_scheduled_for");
      } finally {
        await planner.query("ROLLBACK");
        planner.release();
      }
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      await rm(migrationDirectory, { recursive: true, force: true });
    }
  });
});
