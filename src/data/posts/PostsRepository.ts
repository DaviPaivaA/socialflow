import type { Post } from "../../types/social";

export type CreatePostInput = {
  caption: string;
  mediaAssetIds?: string[];
  scheduledFor: string;
  status: "scheduled";
  title?: string;
};

export interface PostsRepository {
  list(): Promise<Post[]>;
  create(post: CreatePostInput): Promise<Post>;
}
