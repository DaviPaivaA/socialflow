import { describe, expect, it, vi } from "vitest";
import { isCreatePostResponse } from "../../../shared/postPublicationContract";
import { consumeBlockedNetworkRequests } from "../../test/setup";
import type { Post } from "../../types/social";
import { createPostsRepository } from "./createPostsRepository";
import { MockPostsRepository } from "./MockPostsRepository";
import type { CreatePostInput } from "./PostsRepository";
import type { TenantRole } from "../../../shared/authContract";
import { isPostDetail } from "../../../shared/postManagementContract";

const existingPost: Post = {
  authorUserId: "22222222-2222-4222-8222-222222222222",
  caption: "Conteúdo já agendado.",
  createdAt: "2026-08-10T12:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  mediaAssetIds: [],
  publishedAt: null,
  ragRunId: null,
  scheduledFor: "2026-08-13T10:00:00-03:00",
  status: "scheduled",
  tenantId: "11111111-1111-4111-8111-111111111111",
  title: "Publicação existente",
  updatedAt: "2026-08-10T12:00:00.000Z",
};

const newPost: CreatePostInput = {
  title: "Nova publicação",
  caption: "Conteúdo criado no repositório mock.",
  scheduledFor: "2026-08-14T11:00:00-03:00",
  publicationMode: "scheduled",
  socialAccountIds: ["55555555-5555-4555-8555-555555555555"],
};

describe("MockPostsRepository", () => {
  const clock = () => new Date("2026-08-11T12:00:00.000Z");
  const actor = (role: TenantRole = "owner", userId = existingPost.authorUserId, tenantId = existingPost.tenantId) => ({ userId, tenantId, role });
  const repositoryFor = (role: TenantRole = "owner", userId = existingPost.authorUserId) => new MockPostsRepository([existingPost], { actor: () => actor(role, userId), now: clock });

  it("retains legacy zero targets, identity and omitted fields on update", async () => {
    const repository = repositoryFor();
    const result = await repository.updateScheduled(existingPost.id, { title: null });
    expect(isPostDetail(result)).toBe(true);
    expect(result.post).toEqual({ ...existingPost, title: null, updatedAt: clock().toISOString() });
    expect(result.publications).toEqual([]);
    result.post.mediaAssetIds.push("44444444-4444-4444-8444-444444444444");
    expect((await repository.get(existingPost.id)).post.mediaAssetIds).toEqual([]);
  });

  it("persists created destinations, deep clones and restores removed targets using the original IDs", async () => {
    const repository = repositoryFor();
    const supplied = [...newPost.socialAccountIds];
    const created = await repository.create({ ...newPost, socialAccountIds: supplied });
    const originalId = created.publications[0]!.id;
    created.publications[0]!.status = "failed"; created.publications.splice(0); supplied.push(existingPost.id);
    const detail = await repository.get(created.post.id);
    expect(detail.publications).toMatchObject([{ id: originalId, status: "scheduled" }]);
    const newId = "66666666-6666-4666-8666-666666666666";
    const removed = await repository.updateScheduled(created.post.id, { socialAccountIds: [newId] });
    expect(removed.publications.find(p => p.id === originalId)?.status).toBe("cancelled");
    const restored = await repository.updateScheduled(created.post.id, { socialAccountIds: newPost.socialAccountIds });
    expect(restored.publications.find(p => p.id === originalId)).toMatchObject({ socialAccountId: newPost.socialAccountIds[0], status: "scheduled" });
    restored.publications[0]!.status = "failed";
    expect((await repository.get(created.post.id)).publications.find(p => p.id === originalId)?.status).toBe("scheduled");
  });

  it("preserves the sole uppercase destination identity across repeated caption-only updates", async () => {
    const repository = repositoryFor();
    const created = await repository.create({ ...newPost, socialAccountIds: ["AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"] });
    for (const caption of ["First edit", "Second edit", "Third edit"]) {
      const detail = await repository.updateScheduled(created.post.id, { caption });
      expect(detail.post.caption).toBe(caption);
      expect.soft(detail.publications).toEqual(created.publications);
      expect.soft(detail.publications.map(p => ({ id: p.id, status: p.status }))).toEqual([
        { id: created.publications[0]!.id, status: "scheduled" },
      ]);
    }
    expect((await repository.get(created.post.id)).publications).toEqual(created.publications);
  });

  it.each(["owner", "admin", "member"] as const)("allows %s management of own post and cancellation stays historical", async role => {
    const repository = repositoryFor(role);
    expect((await repository.get(existingPost.id)).permissions).toEqual({ canEditSchedule: true, canCancelSchedule: true });
    await repository.cancelScheduled(existingPost.id); await repository.cancelScheduled(existingPost.id);
    expect(await repository.list()).toEqual([]);
    expect(await repository.get(existingPost.id)).toMatchObject({ post: { status: "cancelled" }, permissions: { canEditSchedule: false, canCancelSchedule: false } });
    await expect(repository.updateScheduled(existingPost.id, { caption: "No" })).rejects.toMatchObject({ status: 409 });
  });

  it("uses current actor policy before idempotent cancellation, without allowing foreign tenant access", async () => {
    let current = actor();
    const repository = new MockPostsRepository([existingPost], { actor: () => current, now: clock });
    await repository.cancelScheduled(existingPost.id);
    current = actor("member", "77777777-7777-4777-8777-777777777777");
    await expect(repository.cancelScheduled(existingPost.id)).rejects.toMatchObject({ status: 403 });
    await expect(repository.updateScheduled(existingPost.id, { title: "No" })).rejects.toMatchObject({ status: 403 });
    current = actor("owner", current.userId, "88888888-8888-4888-8888-888888888888");
    for (const id of [existingPost.id, "99999999-9999-4999-8999-999999999999"]) {
      await expect(repository.get(id)).rejects.toMatchObject({ status: 404, body: { error: { code: "post_not_found" } } });
    }
    expect(await repository.list()).toEqual([]);
  });

  it.each(["owner", "admin", "member"] as const)("denies %s mutations of published posts", async role => {
    const repository = new MockPostsRepository([{ ...existingPost, status: "published", publishedAt: existingPost.createdAt }], { actor: () => actor(role), now: clock });
    await expect(repository.cancelScheduled(existingPost.id)).rejects.toMatchObject({ status: 409 });
    await expect(repository.updateScheduled(existingPost.id, { title: "No" })).rejects.toMatchObject({ status: 409 });
    expect((await repository.get(existingPost.id)).post.status).toBe("published");
  });

  it("checks member author, future date and preserves no-op timestamps", async () => {
    const other = repositoryFor("member", "77777777-7777-4777-8777-777777777777");
    expect((await other.get(existingPost.id)).permissions.canEditSchedule).toBe(false);
    await expect(other.updateScheduled(existingPost.id, { caption: "No" })).rejects.toMatchObject({ status: 403 });
    const repository = repositoryFor();
    expect((await repository.updateScheduled(existingPost.id, { title: existingPost.title })).post).toEqual(existingPost);
    await expect(repository.updateScheduled(existingPost.id, { scheduledFor: "2020-01-01T00:00:00.000Z" })).rejects.toMatchObject({ status: 400, body: { error: { code: "invalid_post", fields: ["scheduledFor"] } } });
  });

  it.each([{}, { socialAccountIds: [] }, { mediaAssetIds: ["bad"] }, { title: " " }, { caption: " " }, { tenantId: existingPost.tenantId }])("rejects invalid mock PATCH %j without mutation", async patch => {
    const repository = repositoryFor();
    await expect(repository.updateScheduled(existingPost.id, patch)).rejects.toMatchObject({ status: 400 });
    expect((await repository.get(existingPost.id)).post).toEqual(existingPost);
  });

  it("normaliza e clona mediaAssetIds sem compartilhar a referência", async () => {
    const mediaId = "44444444-4444-4444-8444-444444444444";
    const seed = { ...existingPost, mediaAssetIds: [mediaId] };
    const repository = new MockPostsRepository([seed]);
    seed.mediaAssetIds.push("55555555-5555-4555-8555-555555555555");
    const first = await repository.list();
    first[0]!.mediaAssetIds.push("66666666-6666-4666-8666-666666666666");
    const second = await repository.list();
    expect(second[0]!.mediaAssetIds).toEqual([mediaId]);

    const createdWithout = await repository.create(newPost);
    expect(createdWithout.post.mediaAssetIds).toEqual([]);
    const supplied = [mediaId];
    const createdWith = await repository.create({ ...newPost, mediaAssetIds: supplied });
    supplied.push("77777777-7777-4777-8777-777777777777");
    createdWith.post.mediaAssetIds.push("88888888-8888-4888-8888-888888888888");
    const listed = await repository.list();
    expect(listed[0]!.mediaAssetIds).toEqual([mediaId]);
  });

  it("lista e cria publicações UUID em memória no mesmo tenant", async () => {
    const repository = new MockPostsRepository([existingPost]);

    expect(await repository.list()).toEqual([existingPost]);

    const created = await repository.create(newPost);
    expect(isCreatePostResponse(created)).toBe(true);

    expect(created.post).toEqual(
      expect.objectContaining({
        caption: newPost.caption,
        scheduledFor: newPost.scheduledFor,
        status: "scheduled",
        title: newPost.title,
        authorUserId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        tenantId: existingPost.tenantId,
      }),
    );
    expect(created.publications).toEqual([
      expect.objectContaining({
        postId: created.post.id,
        socialAccountId: newPost.socialAccountIds[0],
        status: "scheduled",
      }),
    ]);
    expect(await repository.list()).toEqual([created.post, existingPost]);
  });

  it("cria uma publicação por destino e retorna cópias independentes", async () => {
    const repository = new MockPostsRepository([existingPost]);
    const ids = ["55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666"];
    const result = await repository.create({ ...newPost, publicationMode: "now", socialAccountIds: ids });
    expect(isCreatePostResponse(result)).toBe(true);
    ids.push("77777777-7777-4777-8777-777777777777");
    expect(result.post.status).toBe("published");
    expect(result.publications.map((item) => item.socialAccountId)).toEqual(ids.slice(0, 2));
    expect(result.publications.map((item) => item.status)).toEqual(["published", "published"]);
    expect(result.post.scheduledFor).toBeTruthy();
    result.post.mediaAssetIds.push("44444444-4444-4444-8444-444444444444");
    result.publications.splice(0, 1);
    expect((await repository.list())[0]?.mediaAssetIds).toEqual([]);
  });

  it("rejeita uma criação sem instante de agendamento válido", async () => {
    const repository = new MockPostsRepository([existingPost]);

    await expect(
      repository.create({ ...newPost, scheduledFor: "14 ago" }),
    ).rejects.toThrow("O agendamento da publicação é inválido.");
  });

  it("é selecionado por padrão sem chamar fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const repository = createPostsRepository({
      fetchImpl: fetchMock,
      seed: [existingPost],
    });

    expect(await repository.list()).toEqual([existingPost]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("seleciona a implementação HTTP por configuração", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([existingPost]), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createPostsRepository({
      apiUrl: "https://api.socialflow.example/v1",
      fetchImpl: fetchMock,
      mode: "http",
    });

    expect(await repository.list()).toEqual([existingPost]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.socialflow.example/v1/posts",
    );
  });

  it("bloqueia a configuração HTTP sem fetch simulado", async () => {
    vi.clearAllMocks();
    const repository = createPostsRepository({
      apiUrl: "https://api-nao-deve-ser-acessada.invalid",
      mode: "http",
    });

    await expect(repository.list()).rejects.toThrow(
      "Requisição de rede não simulada bloqueada no teste",
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(consumeBlockedNetworkRequests()).toEqual([
      "https://api-nao-deve-ser-acessada.invalid/posts",
    ]);
  });
});
