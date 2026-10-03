import { isValidScheduledFor } from "../../domain/scheduling";
import type { CreatePostResponse, PostPublication } from "../../../shared/postPublicationContract";
import type { Post } from "../../types/social";
import { initialPosts } from "../mockData";
import type { CreatePostInput, PostsRepository } from "./PostsRepository";

const MOCK_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const MOCK_AUTHOR_USER_ID = "22222222-2222-4222-8222-222222222222";

function clonePost(post: Post): Post {
  return { ...post, mediaAssetIds: [...post.mediaAssetIds] };
}

export class MockPostsRepository implements PostsRepository {
  private readonly posts: Post[];
  private readonly tenantId: string;

  constructor(seed: readonly Post[] = initialPosts) {
    this.posts = seed.map(clonePost);
    this.tenantId = this.posts[0]?.tenantId ?? MOCK_TENANT_ID;
  }

  async list(): Promise<Post[]> {
    return this.posts.map(clonePost);
  }

  async create(input: CreatePostInput): Promise<CreatePostResponse> {
    if (input.publicationMode === "scheduled" && !isValidScheduledFor(input.scheduledFor)) {
      throw new Error("O agendamento da publicação é inválido.");
    }

    const now = new Date().toISOString();
    const scheduledFor = input.publicationMode === "now" ? now : input.scheduledFor!;
    const isImmediate = input.publicationMode === "now";
    const post: Post = {
      authorUserId: MOCK_AUTHOR_USER_ID,
      caption: input.caption,
      createdAt: now,
      id: crypto.randomUUID(),
      mediaAssetIds: [...(input.mediaAssetIds ?? [])],
      publishedAt: isImmediate ? now : null,
      ragRunId: null,
      scheduledFor,
      status: isImmediate ? "published" : "scheduled",
      tenantId: this.tenantId,
      title: input.title ?? null,
      updatedAt: now,
    };
    this.posts.unshift(post);

    const publications: PostPublication[] = input.socialAccountIds.map((socialAccountId) => ({
      createdAt: now,
      errorCode: null,
      errorMessage: null,
      failedAt: null,
      id: crypto.randomUUID(),
      postId: post.id,
      providerPostId: isImmediate ? `mock_${crypto.randomUUID()}` : null,
      publishedAt: isImmediate ? now : null,
      socialAccountId,
      startedAt: isImmediate ? now : null,
      status: isImmediate ? "published" : "scheduled",
      tenantId: this.tenantId,
      updatedAt: now,
    }));
    return { post: clonePost(post), publications };
  }
}
