import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSocialAccountsRepository, InvalidSocialAccountsContextError } from "../src/postgresSocialAccountsRepository.ts";
import { cipher, publicationFixture, token } from "./publicationFixtures.ts";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Meta publishing credentials (isolated PostgreSQL schema)", () => {
  let fixture: Awaited<ReturnType<typeof publicationFixture>>;
  let repository: PostgresSocialAccountsRepository;
  beforeAll(async () => {
    fixture = await publicationFixture();
    repository = new PostgresSocialAccountsRepository(fixture.pool);
  });
  afterAll(async () => { await fixture?.close(); });

  async function instagram(tasks: unknown = ["MANAGE"]) {
    const post = await fixture.post();
    const id = post.publications[0].socialAccountId;
    await fixture.pool.query("UPDATE social_accounts SET account_type='instagram_business', external_account_id='200', metadata=$1 WHERE id=$2", [JSON.stringify({ pageId: "100", tasks }), id]);
    await fixture.pool.query("UPDATE oauth_connections SET scopes=$1 WHERE id=$2", [["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"], post.connectionId]);
    return { ...post, id, context: { tenantId: post.tenantId, authorUserId: post.authorUserId } };
  }

  it.each([["MANAGE"], ["CREATE_CONTENT"]])("reads the account's encrypted Page token and actual Instagram evidence %j", async task => {
    const a = await instagram([task]);
    const b = await instagram();
    const credential = await repository.findMetaPublishingCredential(a.context, a.id);
    expect(credential).toEqual({
      provider: "instagram", providerAccountId: "200", accessTokenEncrypted: expect.stringMatching(/^v1\./),
      scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"],
      tasks: [task], tokenExpiresAt: null,
    });
    expect(cipher.decryptSecret(credential!.accessTokenEncrypted!)).toBe(token);
    expect(JSON.stringify(credential)).not.toContain(token);
    await expect(repository.findMetaPublishingCredential(b.context, a.id)).resolves.toBeNull();
    await expect(repository.findMetaPublishingCredential(a.context, b.id)).resolves.toBeNull();
    const publicAccount = await repository.findById(a.context, a.id);
    expect(JSON.stringify(publicAccount)).not.toMatch(/accessToken|tasks|pageId|Encrypted/);
  });

  it("rejects non-Meta account and connection providers without token fallback", async () => {
    const a = await instagram();
    await fixture.pool.query("UPDATE social_accounts SET account_type='tiktok_account' WHERE id=$1", [a.id]);
    await expect(repository.findMetaPublishingCredential(a.context, a.id)).resolves.toBeNull();
    await fixture.pool.query("UPDATE social_accounts SET account_type='instagram_business' WHERE id=$1", [a.id]);
    await fixture.pool.query("UPDATE oauth_connections SET platform='tiktok' WHERE id=$1", [a.connectionId]);
    await expect(repository.findMetaPublishingCredential(a.context, a.id)).resolves.toBeNull();
  });

  it.each([{ tasks: [] }, { tasks: null }, { tasks: "CREATE_CONTENT" }, { tasks: ["CREATE_CONTENT", 42] }])("does not infer missing/malformed tasks from granted scopes %j", async ({ tasks }) => {
    const a = await instagram(tasks);
    expect(await repository.findMetaPublishingCredential(a.context, a.id)).toMatchObject({ tasks: [] });
  });

  it("does not borrow scopes or token from another OAuth connection", async () => {
    const a = await instagram();
    await fixture.pool.query("UPDATE oauth_connections SET scopes=ARRAY['instagram_basic'] WHERE id=$1", [a.connectionId]);
    const credential = await repository.findMetaPublishingCredential(a.context, a.id);
    expect(credential?.scopes).toEqual(["instagram_basic"]);
    await fixture.pool.query("DELETE FROM social_account_credentials WHERE social_account_id=$1", [a.id]);
    await expect(repository.findMetaPublishingCredential(a.context, a.id)).resolves.toBeNull();
  });

  it("preserves expired account-token evidence for the consumer's safe token error", async () => {
    const a = await instagram();
    await fixture.pool.query("UPDATE social_account_credentials SET access_token_expires_at='2000-01-01T00:00:00Z' WHERE social_account_id=$1", [a.id]);
    expect(await repository.findMetaPublishingCredential(a.context, a.id)).toMatchObject({ tokenExpiresAt: "2000-01-01T00:00:00.000Z" });
    expect(await repository.findById(a.context, a.id)).toMatchObject({ status: "expired" });
  });

  it.each(["revoked", "inactive-account", "disconnected", "inactive-user", "removed-membership"])("never reads credentials for %s even with another active member", async state => {
    const a = await instagram();
    const b = await fixture.post();
    await fixture.pool.query("INSERT INTO tenant_members (tenant_id,user_id,role) VALUES ($1,$2,'member')", [a.tenantId, b.authorUserId]);
    if (state === "revoked") await fixture.pool.query("UPDATE oauth_connections SET status='revoked', revoked_at=now(), access_token_encrypted=NULL, refresh_token_encrypted=NULL WHERE id=$1", [a.connectionId]);
    if (state === "inactive-account") await fixture.pool.query("UPDATE social_accounts SET is_active=false WHERE id=$1", [a.id]);
    if (state === "disconnected") await fixture.pool.query("UPDATE social_accounts SET is_active=false, disconnected_at=now() WHERE id=$1", [a.id]);
    if (state === "inactive-user") await fixture.pool.query("UPDATE users SET is_active=false WHERE id=$1", [a.authorUserId]);
    if (state === "removed-membership") await fixture.pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2", [a.tenantId, a.authorUserId]);
    const result = repository.findMetaPublishingCredential(a.context, a.id);
    if (state === "inactive-user" || state === "removed-membership") await expect(result).rejects.toBeInstanceOf(InvalidSocialAccountsContextError);
    else await expect(result).resolves.toBeNull();
  });
});
