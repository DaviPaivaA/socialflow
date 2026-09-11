import { describe, expect, it, vi } from "vitest";
import { consumeBlockedNetworkRequests } from "../../test/setup";
import type { Post } from "../../types/social";
import { createPostsRepository } from "./createPostsRepository";
import { MockPostsRepository } from "./MockPostsRepository";
import type { CreatePostInput } from "./PostsRepository";

const existingPost: Post = {
  id: 7,
  title: "Publicação existente",
  caption: "Conteúdo já agendado.",
  scheduledAt: "2026-08-13T10:00:00-03:00",
  channels: ["IG"],
  status: "Agendado",
  color: "coral",
};

const newPost: CreatePostInput = {
  title: "Nova publicação",
  caption: "Conteúdo criado no repositório mock.",
  scheduledAt: "2026-08-14T11:00:00-03:00",
  channels: ["FB"],
  status: "Agendado",
  color: "purple",
};

describe("MockPostsRepository", () => {
  it("lista e cria publicações em memória", async () => {
    const repository = new MockPostsRepository([existingPost]);

    expect(await repository.list()).toEqual([existingPost]);

    const created = await repository.create(newPost);

    expect(created).toEqual({ ...newPost, id: 8 });
    expect(await repository.list()).toEqual([created, existingPost]);
  });

  it("rejeita uma criação sem instante de agendamento válido", async () => {
    const repository = new MockPostsRepository([existingPost]);

    await expect(
      repository.create({ ...newPost, scheduledAt: "14 ago" }),
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
