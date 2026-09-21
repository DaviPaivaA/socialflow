import { Pool } from "pg";

export function createDatabasePool(databaseUrl: string): Pool {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", () => {
    console.error("Uma conexão ociosa com o PostgreSQL foi interrompida.");
  });
  return pool;
}
