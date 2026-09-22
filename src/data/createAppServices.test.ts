import { describe, expect, it, vi } from "vitest";

describe("configuração dos serviços em produção", () => {
  it("não aceita fallback silencioso para repositórios mock", async () => {
    const { createConfiguredAppServices } = await vi.importActual<
      typeof import("./createAppServices")
    >("./createAppServices");
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_POSTS_REPOSITORY", "mock");

    expect(() => createConfiguredAppServices()).toThrow(
      "Em produção, configure VITE_POSTS_REPOSITORY=http.",
    );
    vi.stubEnv("VITE_POSTS_REPOSITORY", "");
    expect(() => createConfiguredAppServices()).toThrow(
      "Em produção, configure VITE_POSTS_REPOSITORY=http.",
    );
  });

  it("mantém o modo HTTP configurado em produção", async () => {
    const { createConfiguredAppServices } = await vi.importActual<
      typeof import("./createAppServices")
    >("./createAppServices");
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_POSTS_REPOSITORY", "http");
    vi.stubEnv("VITE_API_URL", "https://api.example.test");

    expect(createConfiguredAppServices().postsRepository.constructor.name).toBe(
      "HttpPostsRepository",
    );
  });
});
