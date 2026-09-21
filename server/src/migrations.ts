import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool, PoolClient, QueryResultRow } from "pg";

const MIGRATION_FILE = /^\d+_[a-z0-9_]+\.sql$/;
const MIGRATION_LOCK_ID = 1_903_601_107;
const BASELINE_MIGRATION = "001_create_posts.sql";
const EXPECTED_POST_STATUSES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "partially_failed",
  "failed",
  "cancelled",
];
const EXPECTED_MEMBER_ROLES = ["owner", "admin", "member"];

type AppliedMigrationRow = QueryResultRow & {
  checksum: string;
  name: string;
};

type Migration = {
  checksum: string;
  name: string;
  sql: string;
};

type SchemaColumn = QueryResultRow & {
  column_name: string;
  data_type: string;
  is_nullable: "NO" | "YES";
  table_name: string;
  udt_name: string;
};

type SchemaConstraint = QueryResultRow & {
  columns: string[];
  constraint_type: "FOREIGN KEY" | "PRIMARY KEY" | "UNIQUE";
  delete_action: string;
  is_deferrable: boolean;
  initially_deferred: boolean;
  match_type: string;
  referenced_columns: string[];
  referenced_schema: string | null;
  referenced_table: string | null;
  table_schema: string;
  table_name: string;
  update_action: string;
};

async function readMigrations(directory: string): Promise<Migration[]> {
  const names = (await readdir(directory))
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(resolve(directory, name), "utf8");
      return {
        checksum: createHash("sha256").update(sql).digest("hex"),
        name,
        sql,
      };
    }),
  );
}

async function applyMigration(
  client: PoolClient,
  migration: Migration,
): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(
      `
        INSERT INTO schema_migrations (name, checksum)
        VALUES ($1, $2)
      `,
      [migration.name, migration.checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function hasColumns(
  columns: Map<string, SchemaColumn>,
  expected: ReadonlyArray<[string, string, string, "NO" | "YES"]>,
): boolean {
  return expected.every(([table, column, type, nullable]) => {
    const actual = columns.get(`${table}.${column}`);
    return (
      (actual?.data_type === type || actual?.udt_name === type) &&
      actual.is_nullable === nullable
    );
  });
}

async function enumValues(
  client: PoolClient,
  enumName: string,
): Promise<string[]> {
  const result = await client.query<QueryResultRow & { enumlabel: string }>(
    `
      SELECT enum_row.enumlabel
      FROM pg_type type_row
      JOIN pg_enum enum_row ON enum_row.enumtypid = type_row.oid
      JOIN pg_namespace namespace_row
        ON namespace_row.oid = type_row.typnamespace
      WHERE namespace_row.nspname = current_schema()
        AND type_row.typname = $1
      ORDER BY enum_row.enumsortorder
    `,
    [enumName],
  );
  return result.rows.map((row) => row.enumlabel);
}

async function hasRequiredConstraints(client: PoolClient): Promise<boolean> {
  const result = await client.query<SchemaConstraint>(`
    SELECT
      namespace_row.nspname AS table_schema,
      table_row.relname AS table_name,
      CASE constraint_row.contype
        WHEN 'p' THEN 'PRIMARY KEY'
        WHEN 'f' THEN 'FOREIGN KEY'
        WHEN 'u' THEN 'UNIQUE'
      END AS constraint_type,
      ARRAY(
        SELECT attribute_row.attname
        FROM unnest(constraint_row.conkey) WITH ORDINALITY
          AS key_row(attnum, ordinality)
        JOIN pg_attribute attribute_row
          ON attribute_row.attrelid = constraint_row.conrelid
         AND attribute_row.attnum = key_row.attnum
        ORDER BY key_row.ordinality
      )::text[] AS columns,
      referenced_namespace.nspname AS referenced_schema,
      referenced_table.relname AS referenced_table,
      ARRAY(
        SELECT attribute_row.attname
        FROM unnest(constraint_row.confkey) WITH ORDINALITY
          AS key_row(attnum, ordinality)
        JOIN pg_attribute attribute_row
          ON attribute_row.attrelid = constraint_row.confrelid
         AND attribute_row.attnum = key_row.attnum
        ORDER BY key_row.ordinality
      )::text[] AS referenced_columns,
      constraint_row.confdeltype::text AS delete_action,
      constraint_row.confupdtype::text AS update_action,
      constraint_row.confmatchtype::text AS match_type,
      constraint_row.condeferrable AS is_deferrable,
      constraint_row.condeferred AS initially_deferred
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    LEFT JOIN pg_class referenced_table
      ON referenced_table.oid = constraint_row.confrelid
    LEFT JOIN pg_namespace referenced_namespace
      ON referenced_namespace.oid = referenced_table.relnamespace
    WHERE namespace_row.nspname = current_schema()
      AND table_row.relname = ANY (
        ARRAY['users', 'tenants', 'tenant_members', 'posts']
      )
      AND constraint_row.contype IN ('p', 'f', 'u')
  `);
  const sameColumns = (actual: string[], expected: string[]) =>
    actual.length === expected.length &&
    actual.every((column, index) => column === expected[index]);
  const hasLocalConstraint = (
    table: string,
    type: SchemaConstraint["constraint_type"],
    columns: string[],
  ) =>
    result.rows.some(
      (constraint) =>
        constraint.table_name === table &&
        constraint.constraint_type === type &&
        sameColumns(constraint.columns, columns),
    );

  const expectedLocalConstraints: Array<{
    columns: string[];
    table: string;
    type: SchemaConstraint["constraint_type"];
  }> = [
    { columns: ["id"], table: "users", type: "PRIMARY KEY" },
    { columns: ["id"], table: "tenants", type: "PRIMARY KEY" },
    {
      columns: ["tenant_id", "user_id"],
      table: "tenant_members",
      type: "PRIMARY KEY",
    },
    { columns: ["id"], table: "posts", type: "PRIMARY KEY" },
    {
      columns: ["tenant_id", "id"],
      table: "posts",
      type: "UNIQUE",
    },
  ];

  if (
    !expectedLocalConstraints.every(({ columns, table, type }) =>
      hasLocalConstraint(table, type, columns),
    )
  ) {
    return false;
  }

  const expectedForeignKeys = [
    {
      columns: ["tenant_id"],
      deleteAction: "c",
      referencedColumns: ["id"],
      referencedTable: "tenants",
      table: "tenant_members",
    },
    {
      columns: ["user_id"],
      deleteAction: "c",
      referencedColumns: ["id"],
      referencedTable: "users",
      table: "tenant_members",
    },
    {
      columns: ["tenant_id"],
      deleteAction: "c",
      referencedColumns: ["id"],
      referencedTable: "tenants",
      table: "posts",
    },
    {
      columns: ["created_by_user_id"],
      deleteAction: "n",
      referencedColumns: ["id"],
      referencedTable: "users",
      table: "posts",
    },
  ];

  return expectedForeignKeys.every((expected) => {
    const candidates = result.rows.filter(
      (constraint) =>
        constraint.table_name === expected.table &&
        constraint.constraint_type === "FOREIGN KEY" &&
        sameColumns(constraint.columns, expected.columns),
    );
    if (candidates.length !== 1) return false;

    const actual = candidates[0];
    return (
      actual?.referenced_schema === actual?.table_schema &&
      actual.referenced_table === expected.referencedTable &&
      sameColumns(actual.referenced_columns, expected.referencedColumns) &&
      actual.delete_action === expected.deleteAction &&
      actual.update_action === "a" &&
      actual.match_type === "s" &&
      !actual.is_deferrable &&
      !actual.initially_deferred
    );
  });
}

async function hasRequiredDatabaseObjects(client: PoolClient): Promise<boolean> {
  const result = await client.query<
    QueryResultRow & {
      has_posts_scheduled_index: boolean;
      has_posts_status_index: boolean;
      has_posts_updated_trigger: boolean;
      has_tenant_slug_index: boolean;
      has_user_email_index: boolean;
    }
  >(`
    SELECT
      to_regclass(format('%I.uq_users_email', current_schema())) IS NOT NULL
        AS has_user_email_index,
      to_regclass(format('%I.uq_tenants_slug', current_schema())) IS NOT NULL
        AS has_tenant_slug_index,
      to_regclass(format('%I.idx_posts_scheduled', current_schema())) IS NOT NULL
        AS has_posts_scheduled_index,
      to_regclass(format('%I.idx_posts_status', current_schema())) IS NOT NULL
        AS has_posts_status_index,
      EXISTS (
        SELECT 1
        FROM pg_trigger trigger_row
        WHERE trigger_row.tgrelid = 'posts'::regclass
          AND trigger_row.tgname = 'trg_posts_updated_at'
          AND NOT trigger_row.tgisinternal
      ) AS has_posts_updated_trigger
  `);
  const objects = result.rows[0];
  return Boolean(
    objects?.has_user_email_index &&
      objects.has_tenant_slug_index &&
      objects.has_posts_scheduled_index &&
      objects.has_posts_status_index &&
      objects.has_posts_updated_trigger,
  );
}

async function existingSchemaMatchesBaseline(
  client: PoolClient,
): Promise<"empty" | "compatible" | "incompatible"> {
  const tables = await client.query<QueryResultRow & { table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_type = 'BASE TABLE'
      AND table_name = ANY (
        ARRAY['users', 'tenants', 'tenant_members', 'posts']
      )
  `);
  if (tables.rows.length === 0) return "empty";

  const presentTables = new Set(tables.rows.map((row) => row.table_name));
  if (
    !["users", "tenants", "tenant_members", "posts"].every((table) =>
      presentTables.has(table),
    )
  ) {
    return "incompatible";
  }

  const result = await client.query<SchemaColumn>(`
    SELECT table_name, column_name, data_type, udt_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ANY (
        ARRAY['users', 'tenants', 'tenant_members', 'posts']
      )
  `);
  const columns = new Map(
    result.rows.map((column) => [
      `${column.table_name}.${column.column_name}`,
      column,
    ]),
  );
  const requiredColumns: ReadonlyArray<
    [string, string, string, "NO" | "YES"]
  > = [
    ["users", "id", "uuid", "NO"],
    ["users", "email", "text", "NO"],
    ["users", "password_hash", "text", "YES"],
    ["users", "display_name", "text", "NO"],
    ["users", "created_at", "timestamp with time zone", "NO"],
    ["users", "updated_at", "timestamp with time zone", "NO"],
    ["tenants", "id", "uuid", "NO"],
    ["tenants", "name", "text", "NO"],
    ["tenants", "slug", "text", "NO"],
    ["tenants", "created_at", "timestamp with time zone", "NO"],
    ["tenants", "updated_at", "timestamp with time zone", "NO"],
    ["tenant_members", "tenant_id", "uuid", "NO"],
    ["tenant_members", "user_id", "uuid", "NO"],
    ["tenant_members", "role", "tenant_member_role", "NO"],
    ["tenant_members", "created_at", "timestamp with time zone", "NO"],
    ["posts", "id", "uuid", "NO"],
    ["posts", "tenant_id", "uuid", "NO"],
    ["posts", "created_by_user_id", "uuid", "YES"],
    ["posts", "rag_run_id", "uuid", "YES"],
    ["posts", "caption", "text", "NO"],
    ["posts", "status", "post_status", "NO"],
    ["posts", "scheduled_at", "timestamp with time zone", "YES"],
    ["posts", "published_at", "timestamp with time zone", "YES"],
    ["posts", "created_at", "timestamp with time zone", "NO"],
    ["posts", "updated_at", "timestamp with time zone", "NO"],
  ];

  const postStatuses = await enumValues(client, "post_status");
  const memberRoles = await enumValues(client, "tenant_member_role");

  return hasColumns(columns, requiredColumns) &&
    postStatuses.join(",") === EXPECTED_POST_STATUSES.join(",") &&
    memberRoles.join(",") === EXPECTED_MEMBER_ROLES.join(",") &&
    (await hasRequiredConstraints(client)) &&
    (await hasRequiredDatabaseObjects(client))
    ? "compatible"
    : "incompatible";
}

async function baselineExistingSchema(
  client: PoolClient,
  migrations: readonly Migration[],
  applied: Map<string, string>,
): Promise<void> {
  if (applied.has(BASELINE_MIGRATION)) return;

  const schemaState = await existingSchemaMatchesBaseline(client);
  if (schemaState === "empty") return;
  if (schemaState === "incompatible") {
    throw new Error(
      "O schema existente não corresponde ao baseline oficial validado da Etapa 3. Nenhuma migration foi marcada nem aplicada.",
    );
  }

  const baseline = migrations.find(
    (migration) => migration.name === BASELINE_MIGRATION,
  );
  if (!baseline) {
    throw new Error(`A migration de baseline ${BASELINE_MIGRATION} não existe.`);
  }

  await client.query(
    `
      INSERT INTO schema_migrations (name, checksum)
      VALUES ($1, $2)
    `,
    [baseline.name, baseline.checksum],
  );
  applied.set(baseline.name, baseline.checksum);
}

export async function runMigrations(
  pool: Pool,
  directory = resolve(process.cwd(), "server", "migrations"),
): Promise<void> {
  const migrations = await readMigrations(directory);
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const appliedResult = await client.query<AppliedMigrationRow>(`
      SELECT name, checksum
      FROM schema_migrations
    `);
    const applied = new Map(
      appliedResult.rows.map(({ name, checksum }) => [name, checksum]),
    );

    await baselineExistingSchema(client, migrations, applied);

    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.name);
      if (appliedChecksum === migration.checksum) continue;
      if (appliedChecksum !== undefined) {
        throw new Error(
          `A migration ${migration.name} já foi aplicada com outro conteúdo.`,
        );
      }

      await applyMigration(client, migration);
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch(() => undefined);
    client.release();
  }
}
