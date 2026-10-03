import {
  isPost,
  isUuid,
  isValidPostTimestamp,
  type Post,
} from "./postContract.ts";

export type PostPublicationStatus =
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export type PostPublication = {
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  failedAt: string | null;
  id: string;
  postId: string;
  providerPostId: string | null;
  publishedAt: string | null;
  socialAccountId: string;
  startedAt: string | null;
  status: PostPublicationStatus;
  tenantId: string;
  updatedAt: string;
};

export type CreatePostResponse = {
  post: Post;
  publications: PostPublication[];
};

const PUBLICATION_FIELDS = [
  "createdAt", "errorCode", "errorMessage", "failedAt", "id", "postId",
  "providerPostId", "publishedAt", "socialAccountId", "startedAt", "status",
  "tenantId", "updatedAt",
] as const;

const POST_FIELDS = [
  "authorUserId", "caption", "createdAt", "id", "mediaAssetIds",
  "publishedAt", "ragRunId", "scheduledFor", "status", "tenantId",
  "title", "updatedAt",
] as const;

const PUBLICATION_STATUSES: readonly PostPublicationStatus[] = [
  "scheduled", "publishing", "published", "failed", "cancelled",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isValidPostTimestamp(value);
}

export function isPostPublication(value: unknown): value is PostPublication {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).length !== PUBLICATION_FIELDS.length ||
    !Object.keys(value).every((key) => PUBLICATION_FIELDS.some((field) => field === key))
  ) return false;

  return (
    isUuid(value.id) &&
    isUuid(value.tenantId) &&
    isUuid(value.postId) &&
    isUuid(value.socialAccountId) &&
    typeof value.status === "string" &&
    PUBLICATION_STATUSES.some((status) => status === value.status) &&
    isNullableString(value.providerPostId) &&
    isNullableString(value.errorCode) &&
    isNullableString(value.errorMessage) &&
    isNullableTimestamp(value.startedAt) &&
    isNullableTimestamp(value.publishedAt) &&
    isNullableTimestamp(value.failedAt) &&
    isValidPostTimestamp(value.createdAt) &&
    isValidPostTimestamp(value.updatedAt)
  );
}

export function isCreatePostResponse(value: unknown): value is CreatePostResponse {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isRecord(value.post) &&
    Object.keys(value.post).length === POST_FIELDS.length &&
    Object.keys(value.post).every((key) => POST_FIELDS.some((field) => field === key)) &&
    isPost(value.post) &&
    Array.isArray(value.publications) &&
    value.publications.every(isPostPublication)
  );
}
