import { describe, expect, it, vi } from "vitest";
import type { Post } from "../../types/social";
import { ApiClient } from "../api/apiClient";
import { HttpPostsRepository } from "./HttpPostsRepository";
import type { CreatePostInput } from "./PostsRepository";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";

const newPost: CreatePostInput = {
  title: "Nova publicação",
  caption: "Conteúdo enviado à API.",
  scheduledFor: "2026-08-14T11:00:00-03:00",
  status: "scheduled",
};

const existingPost: Post = {
  authorUserId: AUTHOR_ID,
  caption: newPost.caption,
  createdAt: "2026-08-10T12:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  publishedAt: null,
  ragRunId: null,
  scheduledFor: newPost.scheduledFor,
  status: newPost.status,
  tenantId: TENANT_ID,
  title: newPost.title ?? null,
  updatedAt: "2026-08-10T12:00:00.000Z",
};
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("HttpPostsRepository", () => {
  it("aceita uma listagem formada somente por posts oficiais válidos", async () => {
    const repository = createRepository(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([existingPost])),
    );
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

  it("envia somente o DTO de criação e preserva o instante completo", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(existingPost, 201));
    const repository = createRepository(fetchMock);

    await expect(repository.create(newPost)).resolves.toEqual(existingPost);
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
    expect(requestBody.scheduledFor).toBe("2026-08-14T11:00:00-03:00");
    expect(requestBody).not.toHaveProperty("tenantId");
    expect(requestBody).not.toHaveProperty("authorUserId");
    expect(requestBody).not.toHaveProperty("channels");
    expect(requestBody).not.toHaveProperty("color");
  });

  it("aceita um array vazio em uma resposta 200", async () => {
    const repository = createRepository(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([])),
    );
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

  it.each([
    ["sem corpo", null],
    ["somente espaços", "   "],
  ])("rejeita uma resposta 200 %s", async (_label, body) => {
    const response =
      body === null
        ? new Response(null, { status: 200 })
        : new Response(body, { status: 200 });
    const repository = createRepository(
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );
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
    const repository = createRepository(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("[}", {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      ),
    );
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

  it.each([
    ["post incompleto", [{ id: 1 }]],
    ["objeto em vez de array", { posts: [] }],
    ["item null", [null]],
    ["id numérico", [{ ...existingPost, id: 1 }]],
    ["tenant inválido", [{ ...existingPost, tenantId: "tenant-a" }]],
    ["autor inválido", [{ ...existingPost, authorUserId: null }]],
    ["agendamento sem ano", [{ ...existingPost, scheduledFor: "14 ago" }]],
    [
      "agendamento impossível",
      [{ ...existingPost, scheduledFor: "2026-02-30T11:00:00-03:00" }],
    ],
    [
      "agendamento sem offset",
      [{ ...existingPost, scheduledFor: "2026-08-14T11:00:00" }],
    ],
    [
      "campos persistentes legados",
      [
        {
          id: existingPost.id,
          caption: existingPost.caption,
          channels: ["IG"],
          color: "purple",
          scheduledAt: existingPost.scheduledFor,
          status: "Agendado",
          title: existingPost.title,
        },
      ],
    ],
  ])("rejeita listagem com %s", async (_label, body) => {
    const repository = createRepository(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)),
    );
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
      const repository = createRepository(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status })),
      );
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
      const repository = createRepository(
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status })),
      );
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status }));
      const repository = createRepository(fetchMock);

      await expect(repository.create(newPost)).rejects.toThrow(
        "A API não retornou a publicação criada.",
      );
    },
  );

  it("rejeita JSON null ao criar", async () => {
    const repository = createRepository(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(null)),
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

  it("não envia uma criação com agendamento inválido", async () => {
  it("não envia uma criação com agendamento sem ano", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const repository = createRepository(fetchMock);

    await expect(
      repository.create({ ...newPost, scheduledFor: "14 ago" }),
    ).rejects.toThrow("agendamento ISO 8601 válido");
    expect(fetchMock).not.toHaveBeenCalled();
  });
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
