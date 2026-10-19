import { isPost } from "../../../shared/postContract";
import { isCreatePostResponse, type CreatePostResponse } from "../../../shared/postPublicationContract";
import { isValidScheduledFor } from "../../domain/scheduling";
import type { Post } from "../../types/social";
import type { ApiClient } from "../api/apiClient";
import type { CreatePostInput, PostsRepository } from "./PostsRepository";
import type { PostDetail, UpdateScheduledPostInput } from "./PostsRepository";
import { isPostDetail } from "../../../shared/postManagementContract";

function requirePostDetail(value: unknown): PostDetail {
  if (!isPostDetail(value)) throw new Error("A API não retornou um detalhe válido da publicação.");
  return value;
}

export class HttpPostsRepository implements PostsRepository {
  constructor(private readonly apiClient: ApiClient) {}

  async get(postId: string): Promise<PostDetail> {
    return requirePostDetail(await this.apiClient.get<unknown>(`/posts/${encodeURIComponent(postId)}`));
  }

  async updateScheduled(postId: string, input: UpdateScheduledPostInput): Promise<PostDetail> {
    const payload: UpdateScheduledPostInput = {
      ...(Object.hasOwn(input, "title") ? { title: input.title } : {}),
      ...(Object.hasOwn(input, "caption") ? { caption: input.caption } : {}),
      ...(Object.hasOwn(input, "scheduledFor") ? { scheduledFor: input.scheduledFor } : {}),
      ...(Object.hasOwn(input, "socialAccountIds") && input.socialAccountIds !== undefined ? { socialAccountIds: [...input.socialAccountIds] } : {}),
      ...(Object.hasOwn(input, "mediaAssetIds") && input.mediaAssetIds !== undefined ? { mediaAssetIds: [...input.mediaAssetIds] } : {}),
    };
    return requirePostDetail(await this.apiClient.patch<unknown, UpdateScheduledPostInput>(`/posts/${encodeURIComponent(postId)}`, payload));
  }

  async cancelScheduled(postId: string): Promise<void> {
    await this.apiClient.delete<void>(`/posts/${encodeURIComponent(postId)}`);
  }

  async list(): Promise<Post[]> {
    const { body: posts, status } =
      await this.apiClient.getResponse<unknown>("/posts");

    if (status === 204 || status === 205) return [];

    if (!Array.isArray(posts) || !posts.every(isPost)) {
      throw new Error("A API não retornou uma lista válida de publicações.");
    }

    return posts;
  }

  async create(post: CreatePostInput): Promise<CreatePostResponse> {
    if (post.publicationMode === "scheduled" && !isValidScheduledFor(post.scheduledFor)) {
      throw new Error(
        "A publicação não possui um agendamento ISO 8601 válido.",
      );
    }

    const payload: CreatePostInput = {
      caption: post.caption,
      ...(post.mediaAssetIds !== undefined ? { mediaAssetIds: [...post.mediaAssetIds] } : {}),
      publicationMode: post.publicationMode,
      ...(post.publicationMode === "scheduled" ? { scheduledFor: post.scheduledFor } : {}),
      socialAccountIds: [...post.socialAccountIds],
      ...(post.title !== undefined ? { title: post.title } : {}),
    };
    const createdPost = await this.apiClient.post<unknown, CreatePostInput>(
      "/posts",
      payload,
    );

    if (!isCreatePostResponse(createdPost)) {
      throw new Error(
        "A API não retornou a publicação criada. A resposta recebida é inválida.",
      );
    }

    return createdPost;
  }
}
