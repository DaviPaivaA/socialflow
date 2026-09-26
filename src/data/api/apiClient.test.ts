import { describe, expect, it, vi } from "vitest";
import { ApiClient, HttpError, JsonParseError } from "./apiClient";

describe("ApiClient", () => {
  it("resolve a URL sem barras duplicadas e envia FormData sem Content-Type manual", async () => {
    const form = new FormData();
    form.append("file", new Blob(["imagem"], { type: "image/jpeg" }), "foto.jpg");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "ok" }));
    const client = new ApiClient({ baseUrl: "https://api.socialflow.example/", fetchImpl: fetchMock });

    expect(client.resolveUrl("/media-assets/id/content")).toBe("https://api.socialflow.example/media-assets/id/content");
    await expect(client.postForm("/media-assets", form)).resolves.toEqual({ id: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.socialflow.example/media-assets");
    expect(init).toEqual(expect.objectContaining({ body: form, credentials: "include", method: "POST" }));
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("invoca o fetch global com globalThis como receiver", async () => {
    const fetchGlobal = vi.fn(function (
      this: typeof globalThis,
      input: RequestInfo | URL,
      init?: RequestInit,
    ) {
      expect(this).toBe(globalThis);
      expect(input).toBe("https://api.socialflow.example/health");
      expect(init).toEqual(
        expect.objectContaining({ credentials: "include", method: "GET" }),
      );
      return Promise.resolve(
        new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchGlobal);
    const client = new ApiClient({ baseUrl: "https://api.socialflow.example" });

    await expect(client.get("/health")).resolves.toEqual({ status: "ok" });
    expect(fetchGlobal).toHaveBeenCalledTimes(1);
  });

  it("retorna uma resposta de sucesso sem acessar a rede", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ posts: [{ id: 1 }] }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    const client = new ApiClient({
      baseUrl: "https://api.socialflow.example/v1/",
      fetchImpl: fetchMock,
    });

    await expect(client.get("/posts")).resolves.toEqual({
      posts: [{ id: 1 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.socialflow.example/v1/posts",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("padroniza uma resposta HTTP de erro sem acessar a rede", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Dados inválidos" }), {
        headers: { "Content-Type": "application/json" },
        status: 422,
        statusText: "Unprocessable Content",
      }),
    );
    const client = new ApiClient({
      baseUrl: "https://api.socialflow.example",
      fetchImpl: fetchMock,
    });

    const request = client.post("/posts", { caption: "" });

    await expect(request).rejects.toEqual(
      expect.objectContaining({
        body: { message: "Dados inválidos" },
        message: "Erro HTTP 422 Unprocessable Content",
        name: "HttpError",
        status: 422,
        url: "https://api.socialflow.example/posts",
      }),
    );
    await expect(request).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserva o status de uma resposta sem conteúdo", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 205 }));
    const client = new ApiClient({
      baseUrl: "https://api.socialflow.example",
      fetchImpl: fetchMock,
    });

    await expect(client.getResponse<unknown>("/posts")).resolves.toEqual({
      body: undefined,
      status: 205,
    });
  });

  it.each(["application/json; charset=utf-8", "application/problem+json"])(
    "rejeita uma resposta 200 com JSON inválido em %s",
    async (contentType) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"posts":[}', {
          headers: { "Content-Type": contentType },
          status: 200,
        }),
      );
      const client = new ApiClient({
        baseUrl: "https://api.socialflow.example",
        fetchImpl: fetchMock,
      });
      let caughtError: unknown;

      try {
        await client.get<string>("/posts");
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toBeInstanceOf(JsonParseError);
      expect(caughtError).toEqual(
        expect.objectContaining({
          message:
            "Resposta JSON inválida recebida de https://api.socialflow.example/posts.",
          name: "JsonParseError",
          url: "https://api.socialflow.example/posts",
        }),
      );
      expect((caughtError as JsonParseError).cause).toBeInstanceOf(SyntaxError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
