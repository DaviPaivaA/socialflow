import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../../shared/mediaContract.ts";
import { createApiServer } from "../src/app.ts";
import { ensureMediaStorageReady } from "../src/mediaStorage.ts";
import { runMigrations } from "../src/migrations.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";

const ORIGIN = "http://localhost:5173";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL?.trim();
  if (!url) throw new Error("TEST_DATABASE_URL não foi definida.");
  const parsed = new URL(url);
  if (!decodeURIComponent(parsed.pathname).endsWith("_test")) throw new Error("O banco de integração deve terminar em _test.");
  const productionUrl = process.env.DATABASE_URL?.trim();
  if (productionUrl) {
    const production = new URL(productionUrl);
    if (production.host === parsed.host && production.pathname === parsed.pathname) {
      throw new Error("TEST_DATABASE_URL não pode ser igual a DATABASE_URL.");
    }
  }
  return url;
}

async function startServer(pool: Pool, storagePath: string) {
  const server = createApiServer({
    authRateLimit: { maxAttempts: 1_000, windowMs: 60_000 },
    corsOrigin: ORIGIN,
    logger: { error: vi.fn() },
    mediaLimits: { imageBytes: 40, videoBytes: 80 },
    mediaStoragePath: storagePath,
    pool,
    sessionCookie: { maxAgeSeconds: 3600, sameSite: "Lax", secure: false },
    sessionTtlSeconds: 3600,
    socialTokenCipher: new SocialTokenCipher(Buffer.alloc(32, 7)),
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

async function stopServer(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function apiFetch(url: string, init: RequestInit = {}, cookie?: string) {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET") headers.set("Origin", ORIGIN);
  if (cookie) headers.set("Cookie", cookie);
  return fetch(url, { ...init, headers });
}

async function register(baseUrl: string, email: string) {
  const response = await apiFetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: "Mídia Teste", email, password: "senha-segura-123" }),
  });
  expect(response.status).toBe(201);
  const body = await response.json() as { user: { id: string }; tenant: { id: string } };
  return { ...body, cookie: response.headers.get("set-cookie")!.split(";", 1)[0] };
}

function uploadForm(bytes: Buffer, mimeType: string, filename = "foto.jpg") {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
  return form;
}

describe("media_assets com PostgreSQL real", () => {
  if (!process.env.TEST_DATABASE_URL) {
    it.skip("exige TEST_DATABASE_URL", () => undefined);
    return;
  }

  it("migra, isola por Workspace, persiste após reinício e compensa erro de banco", async () => {
    const databaseUrl = testDatabaseUrl();
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
    const storagePath = await mkdtemp(join(tmpdir(), "socialflow-media-integration-"));
    let running: Awaited<ReturnType<typeof startServer>> | null = null;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await runMigrations(pool);
      await runMigrations(pool);
      const migrations = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
      expect(migrations.rows.at(-1)?.name).toBe("009_add_post_media.sql");
      expect(migrations.rows).toHaveLength(9);

      const columns = await pool.query<{ column_name: string; data_type: string }>(`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'media_assets'
      `);
      const byName = new Map(columns.rows.map((row) => [row.column_name, row.data_type]));
      expect(byName.get("id")).toBe("uuid");
      expect(byName.get("tenant_id")).toBe("uuid");
      expect(byName.get("uploaded_by_user_id")).toBe("uuid");
      expect(byName.get("size_bytes")).toBe("bigint");
      expect(byName.get("created_at")).toBe("timestamp with time zone");
      const constraints = await pool.query<{ conname: string; definition: string }>(`
        SELECT conname, pg_get_constraintdef(oid, true) AS definition
        FROM pg_constraint WHERE conrelid = 'media_assets'::regclass
      `);
      expect(constraints.rows.find((row) => row.conname === "media_assets_tenant_id_fkey")?.definition).toContain("REFERENCES tenants(id) ON DELETE RESTRICT");
      expect(constraints.rows.find((row) => row.conname === "media_assets_uploaded_by_user_id_fkey")?.definition).toContain("REFERENCES users(id) ON DELETE RESTRICT");
      const indexes = await pool.query<{ indexname: string }>(`
        SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'media_assets'
      `);
      expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
        "media_assets_storage_key_key", "idx_media_assets_tenant_id", "idx_media_assets_tenant_created_at",
      ]));

      await ensureMediaStorageReady(storagePath);
      running = await startServer(pool, storagePath);
      const baseUrl = running.baseUrl;
      expect((await apiFetch(`${baseUrl}/media-assets`)).status).toBe(401);
      const a = await register(baseUrl, `media-a-${randomUUID()}@example.test`);
      const b = await register(baseUrl, `media-b-${randomUUID()}@example.test`);

      const createdResponse = await apiFetch(`${baseUrl}/media-assets?tenantId=${b.tenant.id}`, {
        method: "POST", body: uploadForm(JPEG, "image/jpeg", "foto.jpg"),
      }, a.cookie);
      expect(createdResponse.status).toBe(201);
      expect(createdResponse.headers.get("cache-control")).toBe("no-store");
      const asset = await createdResponse.json() as MediaAsset;
      expect(asset).toMatchObject({ tenantId: a.tenant.id, uploadedByUserId: a.user.id, mediaType: "image", mimeType: "image/jpeg", originalFilename: "foto.jpg", sizeBytes: JPEG.length });
      expect(JSON.stringify(asset)).not.toMatch(/storageKey|sha256|\/tmp\/|storage_key/);

      const stored = await pool.query<{ storage_key: string; sha256: string }>("SELECT storage_key, sha256 FROM media_assets WHERE id = $1::uuid", [asset.id]);
      const storageKey = stored.rows[0]!.storage_key;
      expect(storageKey).toMatch(new RegExp(`^${a.tenant.id}/[0-9a-f-]{36}\\.jpg$`));
      expect(await readFile(join(storagePath, storageKey))).toEqual(JPEG);
      expect(stored.rows[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect((await stat(join(storagePath, storageKey))).size).toBe(JPEG.length);

      const second = await apiFetch(`${baseUrl}/media-assets`, { method: "POST", body: uploadForm(PNG, "image/png", "foto.jpg") }, b.cookie);
      expect(second.status).toBe(201);
      const assetB = await second.json() as MediaAsset;
      expect(assetB.id).not.toBe(asset.id);
      expect(assetB.tenantId).toBe(b.tenant.id);

      const listA = await apiFetch(`${baseUrl}/media-assets`, {}, a.cookie);
      expect(listA.headers.get("cache-control")).toBe("no-store");
      expect((await listA.json() as { mediaAssets: MediaAsset[] }).mediaAssets.map((item) => item.id)).toEqual([asset.id]);
      expect((await apiFetch(`${baseUrl}/media-assets/${assetB.id}`, {}, a.cookie)).status).toBe(404);
      expect((await apiFetch(`${baseUrl}/media-assets/${randomUUID()}`, {}, a.cookie)).status).toBe(404);
      expect((await apiFetch(`${baseUrl}/media-assets/${asset.id}`, {}, a.cookie)).status).toBe(200);

      const multiple = new FormData();
      multiple.append("file", new Blob([new Uint8Array(JPEG)], { type: "image/jpeg" }), "one.jpg");
      multiple.append("file", new Blob([new Uint8Array(JPEG)], { type: "image/jpeg" }), "two.jpg");
      const multipleResponse = await apiFetch(`${baseUrl}/media-assets`, { method: "POST", body: multiple }, a.cookie);
      expect(multipleResponse.status).toBe(400);
      expect((await multipleResponse.json() as { error: { code: string } }).error.code).toBe("multiple_media_files");
      const missing = await apiFetch(`${baseUrl}/media-assets`, { method: "POST", body: new FormData() }, a.cookie);
      expect(missing.status).toBe(400);
      expect((await missing.json() as { error: { code: string } }).error.code).toBe("missing_media_file");
      const forgedTenant = uploadForm(JPEG, "image/jpeg");
      forgedTenant.append("tenantId", b.tenant.id);
      const forgedResponse = await apiFetch(`${baseUrl}/media-assets`, { method: "POST", body: forgedTenant }, a.cookie);
      expect(forgedResponse.status).toBe(400);
      expect((await forgedResponse.json() as { error: { code: string } }).error.code).toBe("invalid_media_upload");
      const wrongOrigin = await fetch(`${baseUrl}/media-assets`, {
        method: "POST", body: uploadForm(JPEG, "image/jpeg"),
        headers: { Origin: "https://attacker.example", Cookie: a.cookie },
      });
      expect(wrongOrigin.status).toBe(403);

      const invalid = await apiFetch(`${baseUrl}/media-assets`, { method: "POST", body: uploadForm(Buffer.from("not a photo"), "image/jpeg") }, a.cookie);
      expect(invalid.status).toBe(415);
      const tooLarge = await apiFetch(`${baseUrl}/media-assets`, { method: "POST", body: uploadForm(Buffer.concat([JPEG, Buffer.alloc(50)]), "image/jpeg") }, a.cookie);
      expect(tooLarge.status).toBe(413);
      expect(await readdir(join(storagePath, ".tmp"))).toEqual([]);

      await stopServer(running.server);
      running = await startServer(pool, storagePath);
      const afterRestart = await apiFetch(`${running.baseUrl}/media-assets/${asset.id}`, {}, a.cookie);
      expect(afterRestart.status).toBe(200);
      expect((await afterRestart.json() as MediaAsset).id).toBe(asset.id);
      expect(await readFile(join(storagePath, storageKey))).toEqual(JPEG);

      await pool.query("ALTER TABLE media_assets ADD CONSTRAINT test_reject_insert CHECK (original_filename <> 'reject.jpg')");
      const failedInsert = await apiFetch(`${running.baseUrl}/media-assets`, { method: "POST", body: uploadForm(JPEG, "image/jpeg", "reject.jpg") }, a.cookie);
      expect(failedInsert.status).toBe(500);
      expect(await readdir(join(storagePath, a.tenant.id))).toEqual([`${asset.id}.jpg`]);
      expect(await readdir(join(storagePath, ".tmp"))).toEqual([]);
    } finally {
      if (running) await stopServer(running.server);
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      await rm(storagePath, { recursive: true, force: true });
    }
  });
});
