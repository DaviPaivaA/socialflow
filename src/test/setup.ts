import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

vi.mock("../data/posts/createPostsRepository", async (importOriginal) => {
  const repositoryModule =
    await importOriginal<
      typeof import("../data/posts/createPostsRepository")
    >();

  return {
    ...repositoryModule,
    createConfiguredPostsRepository: () =>
      repositoryModule.createPostsRepository({ mode: "mock" }),
  };
});

process.env.TZ = "America/Sao_Paulo";

const blockedNetworkRequests: string[] = [];
let blockedNetworkFetch!: typeof fetch;

export function consumeBlockedNetworkRequests(): string[] {
  return blockedNetworkRequests.splice(0);
}

beforeEach(() => {
  blockedNetworkRequests.splice(0);
  blockedNetworkFetch = vi.fn<typeof fetch>((input) => {
    blockedNetworkRequests.push(String(input));
    throw new Error(
      `Requisição de rede não simulada bloqueada no teste: ${String(input)}`,
    );
  });
  vi.stubGlobal("fetch", blockedNetworkFetch);
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
  writable: true,
});

afterEach(() => {
  cleanup();
  const unexpectedNetworkRequests = consumeBlockedNetworkRequests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  expect(
    unexpectedNetworkRequests,
    "O teste tentou acessar a rede sem um fetch simulado.",
  ).toEqual([]);
});
