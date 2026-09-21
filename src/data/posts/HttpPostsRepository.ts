import { isPost } from "../../../shared/postContract";
import { isValidScheduledFor } from "../../domain/scheduling";
import type { Post } from "../../types/social";
import type { ApiClient } from "../api/apiClient";
import type { CreatePostInput, PostsRepository } from "./PostsRepository";

import type { ApiClient } from "../api/apiClient";
import { isValidScheduledAt } from "../../domain/scheduling";
import type { Post } from "../../types/social";
import type { CreatePostInput, PostsRepository } from "./PostsRepository";

const channelCodes: readonly unknown[] = ["IG", "FB", "TT", "LI"];
const postStatuses: readonly unknown[] = ["Agendado", "Rascunho", "Publicado"];
const contentColors: readonly unknown[] = ["coral", "purple", "blue", "green"];

function isPost(value: unknown): value is Post {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const post = value as Record<string, unknown>;

  return (
    typeof post.id === "number" &&
    Number.isFinite(post.id) &&
    typeof post.title === "string" &&
    typeof post.caption === "string" &&
    isValidScheduledAt(post.scheduledAt) &&
    Array.isArray(post.channels) &&
    post.channels.every((channel) => channelCodes.includes(channel)) &&
    postStatuses.includes(post.status) &&
    contentColors.includes(post.color)
  );
}

export class HttpPostsRepository implements PostsRepository {
  constructor(private readonly apiClient: ApiClient) {}

  async list(): Promise<Post[]> {
    const { body: posts, status } =
      await this.apiClient.getResponse<unknown>("/posts");

    if (status === 204 || status === 205) return [];

    if (!Array.isArray(posts) || !posts.every(isPost)) {
      throw new Error("A API não retornou uma lista válida de publicações.");
    }

    return posts;
  }

  async create(post: CreatePostInput): Promise<Post> {
    if (!isValidScheduledFor(post.scheduledFor)) {
    if (!isValidScheduledAt(post.scheduledAt)) {
      throw new Error(
        "A publicação não possui um agendamento ISO 8601 válido.",
      );
    }

    const createdPost = await this.apiClient.post<unknown, CreatePostInput>(
      "/posts",
      post,
    );

    if (!isPost(createdPost)) {
      throw new Error(
        "A API não retornou a publicação criada. A resposta recebida é inválida.",
      );
    }

    return createdPost;
  }
}
