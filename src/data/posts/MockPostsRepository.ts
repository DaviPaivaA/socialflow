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
    if (!isValidScheduledAt(input.scheduledAt)) {
      throw new Error("O agendamento da publicação é inválido.");
    }

    const post = clonePost({ ...input, id: this.nextId++ });
    this.posts.unshift(post);

    return clonePost(post);
  }
}
