import { isPost } from "../../../shared/postContract";
import { isValidScheduledFor } from "../../domain/scheduling";
import type { Post } from "../../types/social";
import type { ApiClient } from "../api/apiClient";
import type { CreatePostInput, PostsRepository } from "./PostsRepository";

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
