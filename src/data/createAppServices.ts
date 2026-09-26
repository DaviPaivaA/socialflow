import type { AuthSession } from "../../shared/authContract";
import { ApiClient } from "./api/apiClient";
import type { AuthRepository } from "./auth/AuthRepository";
import { HttpAuthRepository } from "./auth/HttpAuthRepository";
import {
  demoAuthSession,
  MockAuthRepository,
} from "./auth/MockAuthRepository";
import { HttpMediaAssetsRepository } from "./media/HttpMediaAssetsRepository";
import { MockMediaAssetsRepository } from "./media/MockMediaAssetsRepository";
import type { MediaAssetsRepository } from "./media/MediaAssetsRepository";
import { HttpPostsRepository } from "./posts/HttpPostsRepository";
import { MockPostsRepository } from "./posts/MockPostsRepository";
import type { PostsRepository } from "./posts/PostsRepository";
import { HttpSocialAccountsRepository } from "./socialAccounts/HttpSocialAccountsRepository";
import { MockSocialAccountsRepository } from "./socialAccounts/MockSocialAccountsRepository";
import type { SocialAccountsRepository } from "./socialAccounts/SocialAccountsRepository";

export type AppServices = {
  authRepository: AuthRepository;
  initialAuthSession?: AuthSession;
  mediaAssetsRepository: MediaAssetsRepository;
  postsRepository: PostsRepository;
  socialAccountsRepository: SocialAccountsRepository;
};

type CreateAppServicesOptions = {
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  mode?: string;
};

export function createAppServices({
  apiUrl,
  fetchImpl,
  mode = "mock",
}: CreateAppServicesOptions = {}): AppServices {
  const normalizedMode = mode.trim().toLowerCase();
  if (normalizedMode === "mock") {
    return {
      authRepository: new MockAuthRepository(demoAuthSession),
      initialAuthSession: demoAuthSession,
      mediaAssetsRepository: new MockMediaAssetsRepository(),
      postsRepository: new MockPostsRepository(),
      socialAccountsRepository: new MockSocialAccountsRepository(),
    };
  }

  if (normalizedMode === "http") {
    if (!apiUrl?.trim()) {
      throw new Error(
        "VITE_API_URL deve ser definida quando VITE_POSTS_REPOSITORY=http.",
      );
    }
    const apiClient = new ApiClient({
      baseUrl: apiUrl,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    return {
      authRepository: new HttpAuthRepository(apiClient),
      mediaAssetsRepository: new HttpMediaAssetsRepository(apiClient),
      postsRepository: new HttpPostsRepository(apiClient),
      socialAccountsRepository: new HttpSocialAccountsRepository(apiClient),
    };
  }

  throw new Error(
    `VITE_POSTS_REPOSITORY inválido: "${mode}". Use "mock" ou "http".`,
  );
}

export function createConfiguredAppServices(): AppServices {
  const mode = import.meta.env.VITE_POSTS_REPOSITORY;
  if (import.meta.env.PROD && mode?.trim().toLowerCase() !== "http") {
    throw new Error("Em produção, configure VITE_POSTS_REPOSITORY=http.");
  }
  return createAppServices({
    apiUrl: import.meta.env.VITE_API_URL,
    mode,
  });
}
