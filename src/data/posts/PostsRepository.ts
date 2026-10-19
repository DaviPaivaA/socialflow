import type { Post } from "../../types/social";
import type { CreatePostResponse } from "../../../shared/postPublicationContract";
import type { PostDetail, UpdateScheduledPostInput } from "../../../shared/postManagementContract";
export type { PostDetail, UpdateScheduledPostInput } from "../../../shared/postManagementContract";

export type CreatePostInput = {
  caption: string;
  mediaAssetIds?: string[];
  publicationMode: "now" | "scheduled";
  scheduledFor?: string;
  socialAccountIds: string[];
  title?: string;
};

export interface PostsRepository {
  list(): Promise<Post[]>;
  create(post: CreatePostInput): Promise<CreatePostResponse>;
  get(postId: string): Promise<PostDetail>;
  updateScheduled(postId: string, input: UpdateScheduledPostInput): Promise<PostDetail>;
  cancelScheduled(postId: string): Promise<void>;
}
