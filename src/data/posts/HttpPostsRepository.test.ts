import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/apiClient";
import { HttpPostsRepository } from "./HttpPostsRepository";
import type { CreatePostInput } from "./PostsRepository";

const newPost: CreatePostInput = {
  title: "Nova publicação",
  caption: "Conteúdo enviado à API.",
  scheduledAt: "2026-08-14T11:00:00-03:00",
  channels: ["IG"],
  status: "Agendado",
  color: "purple",
};

const existingPost = { ...newPost, id: 1 };

function createRepository(fetchImpl: typeof fetch) {
  return new HttpPostsRepository(
    new ApiClient({
      baseUrl: "https://api.socialflow.example",
      fetchImpl,
    }),
  );
}

describe("HttpPostsRepository", () => {
  it("aceita uma listagem formada somente por posts válidos", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([existingPost]), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.list()).resolves.toEqual([existingPost]);
  });

  it("preserva o instante completo ao criar uma publicação", async () => {
    const createdPost = { ...newPost, id: 2 };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(createdPost), {
        headers: { "Content-Type": "application/json" },
        status: 201,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.create(newPost)).resolves.toEqual(createdPost);

    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(requestBody).toEqual(newPost);
    expect(requestBody.scheduledAt).toBe("2026-08-14T11:00:00-03:00");
    expect(requestBody).not.toHaveProperty("date");
    expect(requestBody).not.toHaveProperty("time");
  });

  it("aceita um array vazio em uma resposta 200", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("[]", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.list()).resolves.toEqual([]);
  });

  it("rejeita uma resposta 200 sem corpo", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const repository = createRepository(fetchMock);

    await expect(repository.list()).rejects.toThrow(
      "A API não retornou uma lista válida de publicações.",
    );
  });

  it("rejeita uma resposta 200 com corpo formado apenas por espaços", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("   ", { status: 200 }));
    const repository = createRepository(fetchMock);

    await expect(repository.list()).rejects.toThrow(
      "A API não retornou uma lista válida de publicações.",
    );
  });

  it("rejeita JSON sintaticamente inválido na listagem", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("[}", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.list()).rejects.toThrow(
      "Resposta JSON inválida recebida",
    );
  });

  it("rejeita uma listagem com um post incompleto", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ id: 1 }]), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.list()).rejects.toThrow(
      "A API não retornou uma lista válida de publicações.",
    );
  });

  it("rejeita uma resposta de listagem que não seja um array", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ posts: [] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.list()).rejects.toThrow(
      "A API não retornou uma lista válida de publicações.",
    );
  });

  it("rejeita uma listagem contendo null", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([null]), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.list()).rejects.toThrow(
      "A API não retornou uma lista válida de publicações.",
    );
  });

  it.each([
    [
      "sem ano",
      { ...existingPost, scheduledAt: "08-14T11:00:00-03:00" },
    ],
    [
      "com data impossível",
      { ...existingPost, scheduledAt: "2026-02-30T11:00:00-03:00" },
    ],
    [
      "sem offset",
      { ...existingPost, scheduledAt: "2026-08-14T11:00:00" },
    ],
    [
      "com campos legados",
      {
        id: 1,
        title: newPost.title,
        caption: newPost.caption,
        date: "14 ago",
        time: "11:00",
        channels: newPost.channels,
        status: newPost.status,
        color: newPost.color,
      },
    ],
  ])("rejeita uma listagem com agendamento %s", async (_label, invalidPost) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([invalidPost]), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.list()).rejects.toThrow(
      "A API não retornou uma lista válida de publicações.",
    );
  });

  it.each([204, 205])(
    "normaliza uma listagem %i sem corpo como lista vazia",
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      const repository = createRepository(fetchMock);

      await expect(repository.list()).resolves.toEqual([]);
    },
  );

  it.each([204, 205])(
    "rejeita uma criação %i quando a API não retorna o post",
    async (status) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      const repository = createRepository(fetchMock);

      await expect(repository.create(newPost)).rejects.toThrow(
        "A API não retornou a publicação criada.",
      );
    },
  );

  it("rejeita uma resposta 200 com JSON null ao criar", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("null", {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.create(newPost)).rejects.toThrow(
      "A resposta recebida é inválida.",
    );
  });

  it("rejeita uma resposta de criação com agendamento impossível", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...existingPost,
          scheduledAt: "2026-02-30T11:00:00-03:00",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      ),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.create(newPost)).rejects.toThrow(
      "A resposta recebida é inválida.",
    );
  });

  it("não envia uma criação com agendamento sem ano", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const repository = createRepository(fetchMock);

    await expect(
      repository.create({ ...newPost, scheduledAt: "08-14T11:00:00Z" }),
    ).rejects.toThrow("agendamento ISO 8601 válido");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejeita um objeto incompatível com Post ao criar", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 1, title: "Incompleto" }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const repository = createRepository(fetchMock);

    await expect(repository.create(newPost)).rejects.toThrow(
      "A resposta recebida é inválida.",
    );
  });
});
