import type { Post } from "../../types/social";
import { ApiClient } from "../api/apiClient";
import { HttpPostsRepository } from "./HttpPostsRepository";
import { MockPostsRepository } from "./MockPostsRepository";
import type { PostsRepository } from "./PostsRepository";

export type PostsRepositoryMode = "mock" | "http";

type CreatePostsRepositoryOptions = {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  mode?: PostsRepositoryMode | string;
  seed?: readonly Post[];
};

export function createPostsRepository({
  apiUrl,
  fetchImpl,
  mode = "mock",
  seed,
}: CreatePostsRepositoryOptions = {}): PostsRepository {
  const normalizedMode = mode.trim().toLowerCase();

  if (normalizedMode === "mock") return new MockPostsRepository(seed);

  if (normalizedMode === "http") {
    if (!apiUrl?.trim()) {
      throw new Error(
        "VITE_API_URL deve ser definida quando VITE_POSTS_REPOSITORY=http.",
      );
    }

    return new HttpPostsRepository(
      new ApiClient({
        baseUrl: apiUrl,
        ...(fetchImpl ? { fetchImpl } : {}),
      }),
    );
  }

  throw new Error(
    `VITE_POSTS_REPOSITORY inválido: "${mode}". Use "mock" ou "http".`,
  );
}

export function createConfiguredPostsRepository(): PostsRepository {
  return createPostsRepository({
    apiUrl: import.meta.env.VITE_API_URL,
    mode: import.meta.env.VITE_POSTS_REPOSITORY,
  });
}
