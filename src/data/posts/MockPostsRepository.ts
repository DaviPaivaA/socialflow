import { isValidScheduledFor } from "../../domain/scheduling";
import type { Post } from "../../types/social";
import { initialPosts } from "../mockData";
import type { CreatePostInput, PostsRepository } from "./PostsRepository";

const MOCK_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const MOCK_AUTHOR_USER_ID = "22222222-2222-4222-8222-222222222222";

function clonePost(post: Post): Post {
  return { ...post };
}

export class MockPostsRepository implements PostsRepository {
  private readonly posts: Post[];
  private readonly tenantId: string;

  constructor(seed: readonly Post[] = initialPosts) {
    this.posts = seed.map(clonePost);
    this.tenantId = this.posts[0]?.tenantId ?? MOCK_TENANT_ID;
import { initialPosts } from "../mockData";
import { isValidScheduledAt } from "../../domain/scheduling";
import type { Post } from "../../types/social";
import type { CreatePostInput, PostsRepository } from "./PostsRepository";

function clonePost(post: Post): Post {
  return { ...post, channels: [...post.channels] };
}

export class MockPostsRepository implements PostsRepository {
  private nextId: number;
  private readonly posts: Post[];

  constructor(seed: readonly Post[] = initialPosts) {
    this.posts = seed.map(clonePost);
    this.nextId = Math.max(0, ...this.posts.map((post) => post.id)) + 1;
  }

  async list(): Promise<Post[]> {
    return this.posts.map(clonePost);
  }

  async create(input: CreatePostInput): Promise<Post> {
    if (!isValidScheduledFor(input.scheduledFor)) {
      throw new Error("O agendamento da publicação é inválido.");
    }

    const now = new Date().toISOString();
    const post: Post = {
      authorUserId: MOCK_AUTHOR_USER_ID,
      caption: input.caption,
      createdAt: now,
      id: crypto.randomUUID(),
      publishedAt: null,
      ragRunId: null,
      scheduledFor: input.scheduledFor,
      status: input.status,
      tenantId: this.tenantId,
      title: input.title ?? null,
      updatedAt: now,
    };
    if (!isValidScheduledAt(input.scheduledAt)) {
      throw new Error("O agendamento da publicação é inválido.");
    }

    const post = clonePost({ ...input, id: this.nextId++ });
    this.posts.unshift(post);

    return clonePost(post);
  }
}
