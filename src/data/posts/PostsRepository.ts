import type {
  ChannelCode,
  ContentColor,
  Post,
  PostStatus,
} from "../../types/social";

export type CreatePostInput = {
  title: string;
  caption: string;
  scheduledAt: string;
  channels: ChannelCode[];
  status: PostStatus;
  color: ContentColor;
};

export interface PostsRepository {
  list(): Promise<Post[]>;
  create(post: CreatePostInput): Promise<Post>;
}
