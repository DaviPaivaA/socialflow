import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrations.ts";
import { now, publicationFixture } from "./publicationFixtures.ts";
import { PostgresPostPublicationsRepository } from "../src/postPublicationsRepository.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("publication_operations schema (PostgreSQL)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  beforeAll(async () => { fixture = await publicationFixture(); });
  afterAll(async () => { await fixture?.close(); });

  async function target() {
    const post = await fixture.post();
    const mediaId = randomUUID();
    await fixture.pool.query(`INSERT INTO media_assets (id, tenant_id, uploaded_by_user_id, storage_key,
      original_filename, media_type, mime_type, size_bytes, sha256)
      VALUES ($1,$2,$3,$4,'video.mp4','video','video/mp4',8,$5)`,
    [mediaId, post.tenantId, post.authorUserId, `${post.tenantId}/${mediaId}.mp4`, "a".repeat(64)]);
    await fixture.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, mediaId]);
    return { ...post.publications[0], mediaId };
  }

  async function insert(input: Awaited<ReturnType<typeof target>>, extra: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      tenant_id: input.tenantId, publication_id: input.id, media_asset_id: input.mediaId,
      kind: "facebook_reel", stage: "prepared", provider_account_id: "123", graph_api_version: "v26.0",
      created_at: now, updated_at: now, stage_started_at: now, deadline_at: new Date(now.getTime() + 1_800_000),
      ...extra,
    };
    return fixture.pool.query(`INSERT INTO publication_operations (${Object.keys(values).join(",")})
      VALUES (${Object.keys(values).map((_, i) => `$${i + 1}`).join(",")})`, Object.values(values));
  }

  it("installs 001–011 twice with only the private operation fields and recovery indexes", async () => {
    await runMigrations(fixture.pool);
    const migrations = await fixture.pool.query("SELECT name FROM schema_migrations ORDER BY name");
    expect(migrations.rows).toHaveLength(11);
    expect(migrations.rows.at(-1).name).toBe("011_add_publication_operations.sql");
    const columns = await fixture.pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='publication_operations'");
    expect(columns.rows.map(row => row.column_name).sort()).toEqual([
      "tenant_id", "publication_id", "media_asset_id", "kind", "stage", "provider_account_id", "graph_api_version",
      "external_id", "lease_token", "lease_expires_at", "next_action_at", "deadline_at", "stage_started_at",
      "poll_count", "delivery_issued_at", "delivery_expires_at", "created_at", "updated_at",
    ].sort());
    const indexes = await fixture.pool.query("SELECT indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename='publication_operations'");
    expect(indexes.rows.some(row => /\(next_action_at, tenant_id, publication_id\).*WHERE/.test(row.indexdef))).toBe(true);
    expect(indexes.rows.some(row => /\(lease_expires_at\).*WHERE/.test(row.indexdef))).toBe(true);
  });

  it("allows one operation per destination and rejects cross-tenant destination/media bindings", async () => {
    const first = await target();
    const foreign = await target();
    await expect(insert(foreign, { publication_id: first.id })).rejects.toMatchObject({ code: "23503" });
    await expect(insert(foreign, { media_asset_id: first.mediaId })).rejects.toMatchObject({ code: "23503" });
    await insert(first);
    await expect(insert(first)).rejects.toMatchObject({ code: "23505" });
    await fixture.pool.query("DELETE FROM post_media WHERE media_asset_id=$1", [first.mediaId]);
    await expect(fixture.pool.query("DELETE FROM media_assets WHERE id=$1", [first.mediaId])).rejects.toMatchObject({ code: "23001" });
    await fixture.pool.query("DELETE FROM post_publications WHERE id=$1", [first.id]);
    expect((await fixture.pool.query("SELECT * FROM publication_operations WHERE publication_id=$1", [first.id])).rows).toEqual([]);
  });

  it.each([
    { kind: "wrong" }, { stage: "wrong" }, { kind: "instagram_image", stage: "uploading", external_id: "12" },
    { provider_account_id: "https://secret" }, { provider_account_id: "1".repeat(256) },
    { graph_api_version: "26" }, { external_id: "token" }, { stage: "created" },
    { stage: "succeeded" }, { lease_token: randomUUID() }, { lease_expires_at: now },
    { poll_count: -1 }, { deadline_at: now }, { stage_started_at: new Date(now.getTime() - 1) },
    { updated_at: new Date(now.getTime() - 1) },
    { delivery_issued_at: now }, { delivery_expires_at: now },
    { delivery_issued_at: now, delivery_expires_at: new Date(now.getTime() + 1) },
    { kind: "instagram_image", delivery_issued_at: now, delivery_expires_at: now },
  ])("rejects invalid persisted state %j", async extra => {
    await expect(insert(await target(), extra)).rejects.toMatchObject({ code: "23514" });
  });

  it("permits every documented stage and numeric external IDs with paired delivery/lease timestamps", async () => {
    for (const stage of ["prepared", "creating", "created", "uploading", "processing", "ready", "publishing", "verifying", "succeeded", "failed", "unknown"]) {
      await insert(await target(), { stage, external_id: "123", lease_token: randomUUID(), lease_expires_at: new Date(now.getTime() + 30_000) });
    }
    await insert(await target(), { kind: "instagram_reel", delivery_issued_at: now, delivery_expires_at: new Date(now.getTime() + 300_000) });
  });

  it("accepts delivery issued at integer seconds within the operation creation second", async () => {
    const createdAt = new Date(now.getTime() + 123);
    await expect(insert(await target(), { kind: "instagram_image", created_at: createdAt,
      updated_at: createdAt, stage_started_at: createdAt, delivery_issued_at: now,
      delivery_expires_at: new Date(now.getTime() + 300_000) })).resolves.toMatchObject({ rowCount: 1 });
  });

  it("upgrades populated 010 without backfilling terminal history or changing old checksums", async () => {
    const directory = await mkdtemp(join(tmpdir(), "socialflow-011-upgrade-"));
    const schema = `socialflow_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const source = resolve("server/migrations");
      for (const name of (await readdir(source)).filter(name => /^(00[1-9]|010)_/.test(name))) await copyFile(join(source, name), join(directory, name));
      await runMigrations(pool, directory);
      await pool.query(`INSERT INTO tenants (id,name,slug) VALUES ('00000000-0000-0000-0000-000000000001','old','old');
        INSERT INTO users (id,email,display_name,password_hash) VALUES ('00000000-0000-0000-0000-000000000002','old@example.test','old','hash');
        INSERT INTO posts (id,tenant_id,author_user_id,caption,status) VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','old','published');
        INSERT INTO oauth_connections (id,tenant_id,platform,external_user_id) VALUES ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','meta','123');
        INSERT INTO social_accounts (id,tenant_id,oauth_connection_id,account_type,external_account_id) VALUES ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','facebook_page','123');
        INSERT INTO post_publications (tenant_id,post_id,social_account_id,status,provider_post_id) VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000005','published','123_456')`);
      const old = (await pool.query("SELECT * FROM post_publications")).rows;
      const checksums = (await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
      await runMigrations(pool);
      await runMigrations(pool);
      expect((await pool.query("SELECT * FROM post_publications")).rows).toEqual(old);
      expect((await pool.query("SELECT * FROM publication_operations")).rows).toEqual([]);
      expect((await pool.query("SELECT name,checksum FROM schema_migrations WHERE name < '011' ORDER BY name")).rows).toEqual(checksums);
    } finally {
      await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("publication operation claims/checkpoints (PostgreSQL)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  let destinations: PostgresPostPublicationsRepository;
  // Dynamic import lets schema RED run independently before the repository exists.
  let operations: import("../src/publicationOperationsRepository.ts").PostgresPublicationOperationsRepository;
  let prepare: typeof import("../src/publicationOperationsRepository.ts").preparePublicationOperation;
  beforeAll(async () => {
    fixture = await publicationFixture();
    destinations = new PostgresPostPublicationsRepository(fixture.pool, "v26.0");
    const module = await import("../src/publicationOperationsRepository.ts");
    operations = new module.PostgresPublicationOperationsRepository(fixture.pool);
    prepare = module.preparePublicationOperation;
  });
  afterAll(async () => { await fixture?.close(); });

  async function target(provider: "facebook" | "instagram" = "facebook", media: "video" | "image" | null = "video") {
    const post = await fixture.post();
    const createdAt = new Date(Date.now() - 5000);
    await fixture.pool.query("UPDATE posts SET scheduled_for=$1 WHERE id=$2", [createdAt, post.postId]);
    if (provider === "instagram") await fixture.pool.query("UPDATE social_accounts SET account_type='instagram_business' WHERE id=$1", [post.publications[0].socialAccountId]);
    if (media) {
      const mediaId = randomUUID();
      await fixture.pool.query(`INSERT INTO media_assets (id,tenant_id,uploaded_by_user_id,storage_key,original_filename,media_type,mime_type,size_bytes,sha256)
        VALUES ($1,$2,$3,$4,$5,$6,$7,8,$8)`, [mediaId, post.tenantId, post.authorUserId, `${post.tenantId}/${mediaId}.${media === "video" ? "mp4" : "jpg"}`,
        media === "video" ? "v.mp4" : "i.jpg", media, media === "video" ? "video/mp4" : "image/jpeg", "a".repeat(64)]);
      await fixture.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, mediaId]);
    }
    return { ...post.publications[0], createdAt };
  }
  async function claimed(provider: "facebook" | "instagram" = "facebook", media: "video" | "image" = "video") {
    const input = await target(provider, media);
    await destinations.claimPost(input.tenantId, input.postId, input.createdAt);
    const lease = await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() });
    expect(lease).not.toBeNull();
    return { input, lease: lease! };
  }
  async function row(id: string) { return (await fixture.pool.query("SELECT * FROM publication_operations WHERE publication_id=$1", [id])).rows[0]; }
  async function setStage(id: string, stage: string, externalId: string | null = "789") {
    await fixture.pool.query("UPDATE publication_operations SET stage=$2,external_id=$3,lease_token=NULL,lease_expires_at=NULL,next_action_at=clock_timestamp() WHERE publication_id=$1", [id, stage, externalId]);
  }

  it("claims concurrent destinations exactly once and snapshots only asynchronous flows", async () => {
    for (const [provider, media, kind] of [["facebook", "video", "facebook_reel"], ["instagram", "image", "instagram_image"], ["instagram", "video", "instagram_reel"], ["facebook", "image", null], ["facebook", null, null]] as const) {
      const input = await target(provider, media);
      const claims = await Promise.all([destinations.claimPost(input.tenantId, input.postId, input.createdAt), destinations.claimPost(input.tenantId, input.postId, input.createdAt)]);
      expect(claims.flat()).toHaveLength(1);
      const persisted = await row(input.id);
      if (kind) expect(persisted).toMatchObject({ kind, stage: "prepared", external_id: null, provider_account_id: "100", graph_api_version: "v26.0", deadline_at: new Date(input.createdAt.getTime() + 1_800_000) });
      else expect(persisted).toBeUndefined();
    }
  });

  it("rolls back the destination claim if preparing the operation fails", async () => {
    const input = await target();
    await fixture.pool.query("UPDATE social_accounts SET external_account_id='not-numeric' WHERE id=$1", [input.socialAccountId]);
    await expect(destinations.claimPost(input.tenantId, input.postId, input.createdAt)).rejects.toThrow();
    expect((await destinations.listForPost(input.tenantId, input.postId))[0]).toMatchObject({ status: "scheduled", startedAt: null });
    expect(await row(input.id)).toBeUndefined();
  });

  it("classifies structurally without rolling back claims for removed membership or unavailable credentials", async () => {
    const input = await target("instagram", "image");
    await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1", [input.tenantId]);
    await fixture.pool.query("DELETE FROM social_account_credentials WHERE social_account_id=$1", [input.socialAccountId]);
    await fixture.pool.query("UPDATE social_accounts SET is_active=false WHERE id=$1", [input.socialAccountId]);
    expect(await destinations.claimPost(input.tenantId, input.postId, input.createdAt)).toHaveLength(1);
    expect((await row(input.id)).kind).toBe("instagram_image");
    expect((await destinations.listForPost(input.tenantId, input.postId))[0].status).toBe("publishing");
  });

  it("does not keep a transaction/row lock open while the executor prepares the file", async () => {
    const { input, lease } = await claimed();
    expect(lease.leaseExpiresAt.getTime() - lease.updatedAt.getTime()).toBe(330_000);
    const independent = await fixture.pool.connect();
    try {
      await independent.query("BEGIN");
      expect((await independent.query("SELECT publication_id FROM publication_operations WHERE publication_id=$1 FOR UPDATE NOWAIT", [input.id])).rowCount).toBe(1);
    } finally { await independent.query("ROLLBACK"); independent.release(); }
  });

  it("preparation preserves the immutable provider/version/media snapshot on repeat", async () => {
    const { input } = await claimed();
    const before = await row(input.id);
    await fixture.pool.query("UPDATE social_accounts SET external_account_id='999' WHERE id=$1", [input.socialAccountId]);
    const client = await fixture.pool.connect();
    try { await client.query("BEGIN"); await prepare(client, input, { graphApiVersion: "v27.0", now: new Date() }); await client.query("COMMIT"); }
    finally { client.release(); }
    expect(await row(input.id)).toEqual(before);
  });

  it("leases one action concurrently, renews intentions and preserves created external IDs", async () => {
    const input = await target();
    await destinations.claimPost(input.tenantId, input.postId, input.createdAt);
    const claims = await Promise.all([operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() }), operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() })]);
    const lease = claims.find(value => value !== null)!;
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(lease.leaseExpiresAt.getTime() - lease.updatedAt.getTime()).toBe(330_000);
    expect(await operations.checkpoint({ lease, expectedStage: "prepared", nextStage: "creating", nextActionAt: null })).toBe(true);
    const creating = await row(input.id);
    expect(creating.lease_expires_at.getTime() - creating.updated_at.getTime()).toBe(30_000);
    expect(await operations.checkpoint({ lease, expectedStage: "creating", nextStage: "created", externalId: "789", nextActionAt: new Date() })).toBe(true);
    const next = await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() });
    expect(next?.externalId).toBe("789");
    expect(await operations.checkpoint({ lease: next!, expectedStage: "created", nextStage: "uploading", nextActionAt: null })).toBe(true);
    const uploading = await row(input.id);
    expect(uploading.lease_expires_at.getTime() - uploading.updated_at.getTime()).toBe(330_000);
  });

  it("rejects correct tokens after expiry even without takeover and fences an old executor after takeover", async () => {
    const { input, lease } = await claimed();
    await fixture.pool.query("UPDATE publication_operations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE publication_id=$1", [input.id]);
    expect(await operations.checkpoint({ lease, expectedStage: "prepared", nextStage: "creating", nextActionAt: null })).toBe(false);
    expect(await operations.complete({ lease, result: { status: "failed", code: "late", message: "late", unknown: false }, now: new Date() })).toBe(false);
    const replacement = await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() });
    expect(replacement?.leaseToken).not.toBe(lease.leaseToken);
    expect(await operations.checkpoint({ lease, expectedStage: "prepared", nextStage: "creating", nextActionAt: null })).toBe(false);
    expect((await row(input.id)).stage).toBe("prepared");
  });

  it("rejects checkpoint/complete across tenant/token/stage and refuses early success", async () => {
    const { input, lease } = await claimed();
    const transition = { expectedStage: "prepared", nextStage: "creating", nextActionAt: null } as const;
    expect(await operations.checkpoint({ ...transition, lease: { ...lease, tenantId: randomUUID() } })).toBe(false);
    expect(await operations.checkpoint({ ...transition, lease: { ...lease, leaseToken: randomUUID() } })).toBe(false);
    expect(await operations.checkpoint({ ...transition, expectedStage: "ready", nextStage: "publishing", lease })).toBe(false);
    expect(await operations.complete({ lease, result: { status: "published", providerPostId: "123" }, now: new Date() })).toBe(false);
    const failed = { status: "failed", code: "test", message: "Erro seguro.", unknown: false } as const;
    expect(await operations.complete({ lease: { ...lease, tenantId: randomUUID() }, result: failed, now: new Date() })).toBe(false);
    expect(await operations.complete({ lease: { ...lease, leaseToken: randomUUID() }, result: failed, now: new Date() })).toBe(false);
    expect((await row(input.id)).stage).toBe("prepared");
  });

  it("rechecks lease expiry after waiting for a row lock held without changing the row", async () => {
    const { input, lease } = await claimed();
    await fixture.pool.query("UPDATE publication_operations SET lease_expires_at=clock_timestamp()+interval '250 milliseconds' WHERE publication_id=$1", [input.id]);
    const lock = await fixture.pool.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("SELECT publication_id FROM publication_operations WHERE publication_id=$1 FOR UPDATE", [input.id]);
      const pending = operations.checkpoint({ lease, expectedStage: "prepared", nextStage: "creating", nextActionAt: null });
      // Keep the lock until the authoritative DB clock proves expiry, without altering the row.
      await lock.query("SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM lease_expires_at-clock_timestamp()))+0.02) FROM publication_operations WHERE publication_id=$1", [input.id]);
      await lock.query("COMMIT");
      expect(await pending).toBe(false);
      expect((await row(input.id)).stage).toBe("prepared");
    } finally { await lock.query("ROLLBACK"); lock.release(); }
  });

  it("reclaims expired mutation intentions without rewinding or sending them again", async () => {
    for (const stage of ["creating", "uploading", "publishing"] as const) {
      const { input } = await claimed();
      await setStage(input.id, stage, stage === "creating" ? null : "789");
      await fixture.pool.query("UPDATE publication_operations SET lease_token=$2,lease_expires_at=clock_timestamp()-interval '1 second',next_action_at=NULL WHERE publication_id=$1", [input.id, randomUUID()]);
      const lease = await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() });
      expect(lease?.stage).toBe(stage);
      expect(await operations.checkpoint({ lease: lease!, expectedStage: stage, nextStage: "prepared", nextActionAt: new Date() })).toBe(false);
      expect((await row(input.id)).stage).toBe(stage);
    }
  });

  it("enforces kind-specific transitions, immutable IDs and fixed IG delivery expiry", async () => {
    const { input, lease } = await claimed("instagram", "image");
    const issuedAt = new Date(); const expiresAt = new Date(issuedAt.getTime() + 300_000);
    expect(await operations.checkpoint({ lease, expectedStage: "prepared", nextStage: "creating", nextActionAt: null, delivery: { issuedAt, expiresAt } })).toBe(true);
    expect(await operations.checkpoint({ lease, expectedStage: "creating", nextStage: "created", externalId: "789", nextActionAt: new Date() })).toBe(true);
    const next = (await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() }))!;
    expect(await operations.checkpoint({ lease: next, expectedStage: "created", nextStage: "uploading", nextActionAt: null })).toBe(false);
    expect(await operations.checkpoint({ lease: next, expectedStage: "created", nextStage: "processing", externalId: "999", nextActionAt: new Date() })).toBe(false);
    expect(await operations.checkpoint({ lease: next, expectedStage: "created", nextStage: "processing", delivery: { issuedAt, expiresAt: new Date(expiresAt.getTime() + 1) }, nextActionAt: new Date() })).toBe(false);
    expect(await operations.checkpoint({ lease: next, expectedStage: "created", nextStage: "processing", nextActionAt: new Date() })).toBe(true);
    expect(await row(input.id)).toMatchObject({ external_id: "789", delivery_expires_at: expiresAt });
  });

  it("claims bounded due actions by due time/tenant/id and excludes future/terminal/leased rows", async () => {
    const isolated = await publicationFixture();
    try {
      const { PostgresPublicationOperationsRepository } = await import("../src/publicationOperationsRepository.ts");
      const repo = new PostgresPublicationOperationsRepository(isolated.pool);
      const publisher = new PostgresPostPublicationsRepository(isolated.pool);
      // All rows in this isolated schema have deterministic scheduling order.
      const inputs = [];
      for (let i = 0; i < 3; i++) {
        const post = await isolated.post();
        const id = randomUUID();
        await isolated.pool.query(`INSERT INTO media_assets (id,tenant_id,uploaded_by_user_id,storage_key,original_filename,media_type,mime_type,size_bytes,sha256) VALUES ($1,$2,$3,$4,'v.mp4','video','video/mp4',8,$5)`, [id, post.tenantId, post.authorUserId, `${post.tenantId}/${id}.mp4`, "a".repeat(64)]);
        await isolated.pool.query("INSERT INTO post_media (tenant_id,post_id,media_asset_id,position) VALUES ($1,$2,$3,0)", [post.tenantId, post.postId, id]);
        const due = new Date(Date.now() - 5000 + i * 1000);
        await isolated.pool.query("UPDATE posts SET scheduled_for=$1 WHERE id=$2", [due, post.postId]);
        await publisher.claimPost(post.tenantId, post.postId, due);
        inputs.push(post.publications[0]);
      }
      expect((await repo.claimDueActions(new Date(), 1)).map(item => item.publicationId)).toEqual([inputs[0].id]);
      await isolated.pool.query("UPDATE publication_operations SET next_action_at=clock_timestamp()+interval '1 hour' WHERE publication_id=$1", [inputs[1].id]);
      await isolated.pool.query("UPDATE publication_operations SET stage='failed',next_action_at=NULL WHERE publication_id=$1", [inputs[2].id]);
      expect(await repo.claimDueActions(new Date(), 2)).toEqual([]);
      await expect(repo.claimDueActions(new Date(), 0)).rejects.toThrow();
    } finally { await isolated.close(); }
  });

  it("atomically completes operation/destination, preserves nullable final IDs and rejects late results", async () => {
    for (const result of [{ status: "published", providerPostId: "12345" }, { status: "published", providerPostId: null }, { status: "failed", code: "provider_rejected", message: "Rejeitado.", unknown: false }, { status: "failed", code: "arbitrary", message: "Resultado incerto.", unknown: true }] as const) {
      const { input } = await claimed("instagram");
      await setStage(input.id, "publishing");
      const lease = (await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() }))!;
      expect(await operations.complete({ lease, result, now: new Date() })).toBe(true);
      const persisted = await row(input.id);
      expect(persisted.stage).toBe(result.status === "published" ? "succeeded" : result.unknown ? "unknown" : "failed");
      expect(persisted.lease_token).toBeNull(); expect(persisted.next_action_at).toBeNull();
      const destination = (await destinations.listForPost(input.tenantId, input.postId))[0];
      expect(destination.status).toBe(result.status);
      if (result.status === "published") expect(destination.providerPostId).toBe(result.providerPostId);
      else expect(destination.errorCode).toBe(result.unknown ? "publication_state_unknown" : result.code);
      expect(await operations.complete({ lease, result, now: new Date() })).toBe(false);
    }
  });

  it("rolls back both terminal writes if destination persistence fails", async () => {
    const { input } = await claimed(); await setStage(input.id, "publishing");
    const lease = (await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() }))!;
    await fixture.pool.query(`CREATE FUNCTION reject_terminal_destination() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='published' THEN RAISE EXCEPTION 'injected terminal failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_terminal_destination BEFORE UPDATE ON post_publications FOR EACH ROW EXECUTE FUNCTION reject_terminal_destination()`);
    try {
      await expect(operations.complete({ lease, result: { status: "published", providerPostId: "789" }, now: new Date() })).rejects.toThrow("injected terminal failure");
      expect((await row(input.id)).stage).toBe("publishing");
      expect((await destinations.listForPost(input.tenantId, input.postId))[0].status).toBe("publishing");
    } finally { await fixture.pool.query("DROP TRIGGER reject_terminal_destination ON post_publications; DROP FUNCTION reject_terminal_destination()"); }
  });

  it("leaves asynchronous checkpoints out of the legacy ten-minute unknown sweep", async () => {
    const { input } = await claimed();
    const later = new Date(Date.now() + 900_000);
    await destinations.failStalePublishing(new Date(Date.now() + 1), later);
    expect((await destinations.listForPost(input.tenantId, input.postId))[0].status).toBe("publishing");
    expect((await row(input.id)).stage).toBe("prepared");
  });

  it("counts only explicitly reserved status GETs and atomically prevents a 31st query", async () => {
    const { input } = await claimed();
    await setStage(input.id, "processing");
    const lease = (await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() }))!;
    expect(lease.pollCount).toBe(0);
    for (let count = 0; count < 30; count++) {
      // Each reservation represents a different due poll, without a 60-second wall wait.
      await fixture.pool.query("UPDATE publication_operations SET next_action_at=clock_timestamp() WHERE publication_id=$1", [input.id]);
      expect(await operations.reserveStatusPoll({ lease, expectedStage: "processing" })).toBe(true);
    }
    expect(await operations.reserveStatusPoll({ lease, expectedStage: "processing" })).toBe(false);
    const persisted = await row(input.id);
    expect(persisted.poll_count).toBe(30);
    expect(persisted.lease_expires_at.getTime() - persisted.updated_at.getTime()).toBe(30_000);
    expect(persisted.next_action_at.getTime() - persisted.updated_at.getTime()).toBe(60_000);
    expect(persisted.deadline_at).toEqual(lease.deadlineAt);
    expect(persisted.delivery_expires_at).toBeNull();
  });

  it("reserves one due GET under concurrency and preserves its floor through a polling checkpoint", async () => {
    const { input } = await claimed(); await setStage(input.id, "publishing");
    const lease = (await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() }))!;
    expect((await Promise.all([operations.reserveStatusPoll({ lease, expectedStage: "publishing" }), operations.reserveStatusPoll({ lease, expectedStage: "publishing" })])).sort()).toEqual([false, true]);
    const reserved = await row(input.id);
    expect(await operations.checkpoint({ lease, expectedStage: "publishing", nextStage: "verifying", nextActionAt: new Date() })).toBe(true);
    expect((await row(input.id)).next_action_at).toEqual(reserved.next_action_at);
    expect(await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() })).toBeNull();
    expect(await operations.reserveStatusPoll({ lease, expectedStage: "publishing" })).toBe(false);
    expect((await row(input.id)).poll_count).toBe(1);
  });

  it("fences status reservations by tenant/token/stage/expiry and refuses mutation-only stages", async () => {
    const { input } = await claimed("instagram");
    await setStage(input.id, "verifying");
    const lease = (await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() }))!;
    expect(await operations.reserveStatusPoll({ lease: { ...lease, tenantId: randomUUID() }, expectedStage: "verifying" })).toBe(false);
    expect(await operations.reserveStatusPoll({ lease: { ...lease, leaseToken: randomUUID() }, expectedStage: "verifying" })).toBe(false);
    expect(await operations.reserveStatusPoll({ lease, expectedStage: "processing" })).toBe(false);
    await fixture.pool.query("UPDATE publication_operations SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE publication_id=$1", [input.id]);
    expect(await operations.reserveStatusPoll({ lease, expectedStage: "verifying" })).toBe(false);
    expect((await row(input.id)).poll_count).toBe(0);
    const prepared = await claimed();
    expect(await operations.reserveStatusPoll({ lease: prepared.lease, expectedStage: "prepared" })).toBe(false);
  });

  it("reserves the last permitted status query only once across concurrent workers", async () => {
    const { input } = await claimed(); await setStage(input.id, "uploading");
    const lease = (await operations.claimAction({ tenantId: input.tenantId, publicationId: input.id, now: new Date() }))!;
    await fixture.pool.query("UPDATE publication_operations SET poll_count=29 WHERE publication_id=$1", [input.id]);
    expect((await Promise.all([operations.reserveStatusPoll({ lease, expectedStage: "uploading" }), operations.reserveStatusPoll({ lease, expectedStage: "uploading" })])).sort()).toEqual([false, true]);
    expect((await row(input.id)).poll_count).toBe(30);
  });

  it("rolls back a terminal operation if its destination was independently finalized", async () => {
    const { input, lease } = await claimed();
    await fixture.pool.query("UPDATE post_publications SET status='cancelled' WHERE id=$1", [input.id]);
    expect(await operations.complete({ lease, result: { status: "failed", code: "test", message: "Erro seguro.", unknown: false }, now: new Date() })).toBe(false);
    expect((await row(input.id)).stage).toBe("prepared");
    expect((await destinations.listForPost(input.tenantId, input.postId))[0].status).toBe("cancelled");
  });
});
