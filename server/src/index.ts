import { createApiServer } from "./app.ts";
import { loadServerConfig } from "./config.ts";
import { createDatabasePool } from "./database.ts";
import { SocialTokenCipher } from "./socialTokenCrypto.ts";

const config = loadServerConfig();
const pool = createDatabasePool(config.databaseUrl);
const server = createApiServer({
  authRateLimit: config.authRateLimit,
  corsOrigin: config.corsOrigin,
  metaOAuth: config.metaOAuth,
  pool,
  sessionCookie: config.sessionCookie,
  sessionTtlSeconds: config.sessionTtlSeconds,
  socialTokenCipher: new SocialTokenCipher(config.socialTokenEncryptionKey),
  trustProxy: config.trustProxy,
});
let shutdownStarted = false;

async function shutdown(signal: string) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`Encerrando backend após ${signal}.`);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
}

server.once("error", (error) => {
  console.error("Não foi possível iniciar o backend.", error);
  void pool.end().finally(() => {
    process.exitCode = 1;
  });
});

server.listen(config.port, config.host, () => {
  console.log(`Backend disponível em http://${config.host}:${config.port}.`);
});

process.once("SIGINT", () => {
  void shutdown("SIGINT").catch((error: unknown) => {
    console.error("Falha ao encerrar o backend.", error);
    process.exitCode = 1;
  });
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM").catch((error: unknown) => {
    console.error("Falha ao encerrar o backend.", error);
    process.exitCode = 1;
  });
});
