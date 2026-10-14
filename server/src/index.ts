import { createApiServer } from "./app.ts";
import { loadServerConfig } from "./config.ts";
import { createDatabasePool } from "./database.ts";
import { SocialTokenCipher } from "./socialTokenCrypto.ts";
import { ensureMediaStorageReady } from "./mediaStorage.ts";

const config = loadServerConfig();
const pool = createDatabasePool(config.databaseUrl);
const server = createApiServer({
  authRateLimit: config.authRateLimit,
  corsOrigin: config.corsOrigin,
  metaOAuth: config.metaOAuth,
  metaMedia: config.metaMedia,
  mediaLimits: config.mediaLimits,
  mediaStoragePath: config.mediaStoragePath,
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
  // External AbortSignal cancels preparation/pre-emit only. A Reel upload already
  // sent can run for its own 300 s timeout; drain it plus a 30 s persistence margin.
  const deadline = setTimeout(() => {
    console.error("Prazo de encerramento do backend excedido; checkpoints serão retomados no reinício.");
    process.exit(1);
  }, 330_000);
  server.publicationScheduler.stop();
  // Stop accepting HTTP requests before draining; close and drain proceed together.
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  try {
    const [closing] = await Promise.allSettled([closed, server.publicationScheduler.whenIdle()]);
    await pool.end();
    if (closing.status === "rejected") throw closing.reason;
  } finally { clearTimeout(deadline); }
}

server.once("error", (error) => {
  console.error("Não foi possível iniciar o backend.", error);
  server.publicationScheduler.stop();
  void server.publicationScheduler.whenIdle().then(() => pool.end()).finally(() => {
    process.exitCode = 1;
  });
});

try {
  await ensureMediaStorageReady(config.mediaStoragePath);
  server.listen(config.port, config.host, () => {
    server.publicationScheduler.start();
    console.log(`Backend disponível em http://${config.host}:${config.port}.`);
  });
} catch (error) {
  await pool.end();
  throw error;
}

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
