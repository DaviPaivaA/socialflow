import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

describe("publication modules in native Node strip-only runtime", () => {
  // Restoring parameter properties or introducing import-time I/O must fail:
  // these are real imports in a fresh Node process, not Vitest-transformed modules.
  it.each([
    ["postPublicationsRepository", "PostgresPostPublicationsRepository"],
    ["publicationScheduler", "PublicationScheduler"],
    ["publicationErrors", "PublicationError"],
  ])("imports %s without database/network, HTTP server or timer side effects", (module, exportedClass) => {
    const script = `
      import assert from "node:assert/strict";
      import net from "node:net";
      import http from "node:http";
      import https from "node:https";
      import timers from "node:timers";
      import { syncBuiltinESMExports } from "node:module";

      assert.deepEqual({ ...process.env }, { NODE_ENV: "test" });
      const attempts = { connection: 0, http: 0, listen: 0, timer: 0 };
      function forbidden(kind) {
        return () => {
          attempts[kind]++;
          throw new Error("Import attempted forbidden " + kind + " side effect");
        };
      }
      net.Socket.prototype.connect = forbidden("connection");
      net.Server.prototype.listen = forbidden("listen");
      http.request = http.get = https.request = https.get = forbidden("http");
      globalThis.fetch = forbidden("http");
      for (const name of ["setTimeout", "setInterval", "setImmediate"]) {
        globalThis[name] = timers[name] = forbidden("timer");
      }
      syncBuiltinESMExports();

      const imported = await import(${JSON.stringify(`./server/src/${module}.ts`)});
      assert.equal(typeof imported[${JSON.stringify(exportedClass)}], "function");
      ${module === "publicationErrors" ? `
      // Literal expectations characterize the native error contract, including
      // the distinction used by the coordinator to avoid false terminal failure.
      const messages = [
        ["publication_unavailable", "A publicação não está disponível."],
        ["publication_author_unavailable", "O autor da publicação não está disponível."],
        ["meta_token_invalid", "A autorização da Página precisa ser renovada."],
        ["meta_page_unavailable", "A Página não está disponível para publicação."],
        ["meta_permission_denied", "A autorização não permite publicar nesta Página."],
        ["media_unavailable", "A mídia não está disponível para publicação."],
        ["meta_invalid_request", "O conteúdo não pôde ser publicado na Página."],
        ["meta_rate_limited", "O limite de publicações da Meta foi atingido."],
        ["meta_provider_error", "Não foi possível concluir a publicação na Meta."],
        ["meta_timeout", "A Meta não respondeu dentro do prazo de publicação."],
        ["meta_processing_timeout", "A mídia não ficou pronta dentro do prazo de publicação."],
        ["meta_container_error", "A Meta não conseguiu processar a mídia."],
        ["meta_container_expired", "O prazo do container de mídia expirou."],
        ["publication_state_unknown", "Não foi possível confirmar o resultado da publicação."],
      ];
      for (const [code, message] of messages) {
        const error = new imported.PublicationError(code);
        assert.equal(error.code, code);
        assert.equal(error.message, message);
        assert.equal(error.name, "PublicationError");
        assert.ok(error instanceof Error);
        assert.ok(error instanceof imported.PublicationError);
        assert.equal(error instanceof imported.PublicationOperationalError, false);
      }
      const uncertain = new imported.PublicationOperationalError();
      assert.equal(uncertain.message, "Não foi possível confirmar o resultado da publicação.");
      assert.equal(uncertain.name, "PublicationOperationalError");
      assert.ok(uncertain instanceof Error);
      assert.ok(uncertain instanceof imported.PublicationOperationalError);
      assert.equal(uncertain instanceof imported.PublicationError, false);
      assert.equal("code" in uncertain, false);
      ` : ""}
      assert.deepEqual(attempts, { connection: 0, http: 0, listen: 0, timer: 0 });
      console.log(JSON.stringify({ version: process.version, attempts, environment: { ...process.env } }));
    `;
    // No inherited DATABASE_URL, Meta credentials, NODE_OPTIONS, preload or .env.
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: root,
      env: { NODE_ENV: "test" },
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(JSON.parse(stdout)).toEqual({
      version: process.version,
      attempts: { connection: 0, http: 0, listen: 0, timer: 0 },
      environment: { NODE_ENV: "test" },
    });
  });
});
