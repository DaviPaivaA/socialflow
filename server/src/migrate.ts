import { loadDatabaseConfig } from "./config.ts";
import { createDatabasePool } from "./database.ts";
import { runMigrations } from "./migrations.ts";

async function main() {
  const config = loadDatabaseConfig();
  const pool = createDatabasePool(config.databaseUrl);

  try {
    await runMigrations(pool);
    console.log("Migrations aplicadas com sucesso.");
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? `Falha ao executar migrations: ${error.message}`
      : "Falha ao executar migrations.",
  );
  process.exitCode = 1;
});
