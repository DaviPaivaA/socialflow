import { describe, expect, it, vi } from "vitest";
import type { Post } from "../../types/social";
import { ApiClient } from "../api/apiClient";
import { HttpPostsRepository } from "./HttpPostsRepository";
import type { CreatePostInput } from "./PostsRepository";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";
const MEDIA_ID = "44444444-4444-4444-8444-444444444444";
const PAGE_ID = "55555555-5555-4555-8555-555555555555";

const newPost: CreatePostInput = {
  title: "Nova publicação",
  caption: "Conteúdo enviado à API.",
  scheduledFor: "2026-08-14T11:00:00-03:00",
  publicationMode: "scheduled",
  socialAccountIds: [PAGE_ID],
};

const existingPost: Post = {
  authorUserId: AUTHOR_ID,
  caption: newPost.caption,
  createdAt: "2026-08-10T12:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  mediaAssetIds: [],
  publishedAt: null,
  ragRunId: null,
  scheduledFor: "2026-08-14T11:00:00-03:00",
  status: "scheduled",
  tenantId: TENANT_ID,
  title: newPost.title ?? null,
  updatedAt: "2026-08-10T12:00:00.000Z",
};
const publication = {
  createdAt: existingPost.createdAt,
  errorCode: null,
  errorMessage: null,
  failedAt: null,
  id: "66666666-6666-4666-8666-666666666666",
  postId: existingPost.id,
  providerPostId: null,
  publishedAt: null,
  socialAccountId: PAGE_ID,
  startedAt: null,
  status: "scheduled",
  tenantId: TENANT_ID,
  updatedAt: existingPost.updatedAt,
};
const createdResponse = { post: existingPost, publications: [publication] };

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

    await expect(repository.list()).resolves.toEqual([existingPost]);
  });

  it("envia somente o DTO de criação e preserva o instante completo", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(createdResponse, 201));
    const repository = createRepository(fetchMock);

    await expect(repository.create(newPost)).resolves.toEqual(createdResponse);

    const requestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(requestBody).toEqual(newPost);
    expect(requestBody.scheduledFor).toBe("2026-08-14T11:00:00-03:00");
    expect(requestBody).not.toHaveProperty("tenantId");
    expect(requestBody).not.toHaveProperty("authorUserId");
    expect(requestBody).not.toHaveProperty("channels");
    expect(requestBody).not.toHaveProperty("color");
    expect(requestBody).not.toHaveProperty("status");
  });

  it("envia mediaAssetIds quando a criação referencia mídia", async () => {
    const createdPost = { ...existingPost, mediaAssetIds: [MEDIA_ID] };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ post: createdPost, publications: [publication] }, 201));
    const repository = createRepository(fetchMock);

    await expect(repository.create({ ...newPost, mediaAssetIds: [MEDIA_ID] })).resolves.toEqual({ post: createdPost, publications: [publication] });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody.mediaAssetIds).toEqual([MEDIA_ID]);
  });

  it("envia somente campos permitidos, inclusive com propriedades extras em tempo de execução", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(createdResponse, 201));
    const repository = createRepository(fetchMock);
    const contaminated = { ...newPost, status: "published", tenantId: TENANT_ID, authorUserId: AUTHOR_ID, accessToken: "secret", color: "blue" };

    await repository.create(contaminated);

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(newPost);
  });

  it("omite scheduledFor para publicação imediata", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(createdResponse, 201));
    const repository = createRepository(fetchMock);

    await repository.create({ ...newPost, publicationMode: "now", scheduledFor: newPost.scheduledFor });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ caption: newPost.caption, publicationMode: "now", socialAccountIds: [PAGE_ID], title: newPost.title });
  });

  it.each([
    ["post antigo", existingPost],
    ["sem destinos", { post: existingPost }],
    ["destino inválido", { post: existingPost, publications: [{ ...publication, socialAccountId: "bad" }] }],
    ["segredo em destino", { post: existingPost, publications: [{ ...publication, accessToken: "secret" }] }],
  ])("rejeita criação com resposta %s", async (_label, body) => {
    const repository = createRepository(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body, 201)));
    await expect(repository.create(newPost)).rejects.toThrow("A resposta recebida é inválida.");
  });

  it("aceita um array vazio em uma resposta 200", async () => {
    const repository = createRepository(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse([])),
    );

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

    await expect(repository.list()).rejects.toThrow(
      "Resposta JSON inválida recebida",
    );
  });

  it.each([
    ["post incompleto", [{ id: 1 }]],
    ["mediaAssetIds ausente", [(() => {
      const { mediaAssetIds: _removed, ...post } = existingPost;
      void _removed;
      return post;
    })()]],
    ["mediaAssetIds inválido", [{ ...existingPost, mediaAssetIds: ["invalid"] }]],
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

      await expect(repository.create(newPost)).rejects.toThrow(
        "A API não retornou a publicação criada.",
      );
    },
  );

  it("rejeita JSON null ao criar", async () => {
    const repository = createRepository(
      vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(null)),
    );

    await expect(repository.create(newPost)).rejects.toThrow(
      "A resposta recebida é inválida.",
    );
  });

  it("não envia uma criação com agendamento inválido", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const repository = createRepository(fetchMock);

    await expect(
      repository.create({ ...newPost, scheduledFor: "14 ago" }),
    ).rejects.toThrow("agendamento ISO 8601 válido");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
