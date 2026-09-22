import { describe, expect, it, vi } from "vitest";
import { consumeBlockedNetworkRequests } from "../../test/setup";
import type { Post } from "../../types/social";
import { createPostsRepository } from "./createPostsRepository";
import { MockPostsRepository } from "./MockPostsRepository";
import type { CreatePostInput } from "./PostsRepository";

const existingPost: Post = {
  authorUserId: "22222222-2222-4222-8222-222222222222",
  caption: "Conteúdo já agendado.",
  createdAt: "2026-08-10T12:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
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
  status: "scheduled",
};

describe("MockPostsRepository", () => {
  it("lista e cria publicações UUID em memória no mesmo tenant", async () => {
    const repository = new MockPostsRepository([existingPost]);

    expect(await repository.list()).toEqual([existingPost]);

    const created = await repository.create(newPost);

    expect(created).toEqual(
      expect.objectContaining({
        ...newPost,
        authorUserId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        tenantId: existingPost.tenantId,
      }),
    );
    expect(await repository.list()).toEqual([created, existingPost]);
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
