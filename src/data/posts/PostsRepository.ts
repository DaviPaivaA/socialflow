import type { Post } from "../../types/social";
import type { CreatePostResponse } from "../../../shared/postPublicationContract";

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
}
