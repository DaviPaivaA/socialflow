import { isValidScheduledFor } from "../../domain/scheduling";
import type { CreatePostResponse, PostPublication } from "../../../shared/postPublicationContract";
import type { Post } from "../../types/social";
import { initialPosts } from "../mockData";
import type { CreatePostInput, PostsRepository } from "./PostsRepository";
import type { PostDetail, UpdateScheduledPostInput } from "./PostsRepository";
import type { TenantRole } from "../../../shared/authContract";
import { canManagePostAuthor } from "../../../shared/postManagementPolicy";
import { isUuid } from "../../../shared/postContract";
import { HttpError } from "../api/apiClient";

type MockOptions = {
  actor?: () => { userId: string; tenantId: string; role: TenantRole };
  now?: () => Date;
};

const MOCK_TENANT_ID = "11111111-1111-4111-8111-111111111111";
const MOCK_AUTHOR_USER_ID = "22222222-2222-4222-8222-222222222222";

function clonePost(post: Post): Post {
  return { ...post, mediaAssetIds: [...post.mediaAssetIds] };
}

function managementError(status: number, code: string, fields?: string[]): never {
  throw new HttpError(new Response(null, { status }), "/posts", {
    error: { code, message: "Não foi possível gerenciar esta publicação.", ...(fields ? { fields } : {}) },
  });
}

function invalidPatchFields(input: UpdateScheduledPostInput): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length === 0) return ["body"];
  return Object.entries(input).filter(([key, value]) => {
    if (key === "title") return value !== null && (typeof value !== "string" || !value.trim() || value.length > 255);
    if (key === "caption") return typeof value !== "string" || !value.trim();
    if (key === "scheduledFor") return !isValidScheduledFor(value);
    if (key === "socialAccountIds" || key === "mediaAssetIds") {
      return !Array.isArray(value) || value.length < (key === "socialAccountIds" ? 1 : 0) ||
        (key === "mediaAssetIds" && value.length > 1) || !value.every(isUuid) ||
        new Set(value.map(id => id.toLowerCase())).size !== value.length;
    }
    return true;
  }).map(([key]) => key);
}

function hasNoPublicationEvidence(publication: PostPublication): boolean {
  return publication.providerPostId === null && publication.startedAt === null &&
    publication.publishedAt === null && publication.failedAt === null &&
    publication.errorCode === null && publication.errorMessage === null;
}

function untouched(post: Post, publications: readonly PostPublication[]): boolean {
  return post.status === "scheduled" && post.publishedAt === null &&
    (publications.length === 0 || publications.some(p => p.status === "scheduled")) &&
    publications.every(p => (p.status === "scheduled" || p.status === "cancelled") && hasNoPublicationEvidence(p));
}

function equalIds(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = left.map(id => id.toLowerCase()).sort();
  const normalizedRight = right.map(id => id.toLowerCase()).sort();
  return normalizedLeft.length === normalizedRight.length && normalizedLeft.every((id, index) => id === normalizedRight[index]);
}

export class MockPostsRepository implements PostsRepository {
  private readonly posts: Post[];
  private readonly tenantId: string;
  private readonly options: MockOptions;
  private readonly publications = new Map<string, PostPublication[]>();

  constructor(seed: readonly Post[] = initialPosts, options: MockOptions = {}) {
    this.options = options;
    this.posts = seed.map(clonePost);
    this.tenantId = this.posts[0]?.tenantId ?? MOCK_TENANT_ID;
  }

  async get(postId: string): Promise<PostDetail> {
    const actor = this.actor();
    const post = this.find(postId, actor.tenantId);
    const publications = this.publications.get(post.id) ?? [];
    const allowed = canManagePostAuthor(actor, post.authorUserId) && untouched(post, publications);
    return { post: clonePost(post), publications: publications.map(p => ({ ...p })),
      permissions: { canEditSchedule: allowed, canCancelSchedule: allowed } };
  }

  async updateScheduled(postId: string, input: UpdateScheduledPostInput): Promise<PostDetail> {
    const actor = this.actor();
    const post = this.find(postId, actor.tenantId);
    if (!canManagePostAuthor(actor, post.authorUserId)) managementError(403, "post_forbidden");
    const publications = this.publications.get(post.id) ?? [];
    if (!untouched(post, publications)) managementError(409, "post_not_editable");
    const fields = invalidPatchFields(input);
    if (fields.length) managementError(400, "invalid_post", fields);
    const scheduledFor = input.scheduledFor ?? post.scheduledFor;
    const now = (this.options.now ?? (() => new Date()))();
    if (!scheduledFor || Date.parse(scheduledFor) <= now.getTime()) managementError(400, "invalid_post", ["scheduledFor"]);
    const ids = input.socialAccountIds?.map(id => id.toLowerCase()) ?? publications.filter(p => p.status === "scheduled").map(p => p.socialAccountId.toLowerCase());
    const media = input.mediaAssetIds?.map(id => id.toLowerCase()) ?? post.mediaAssetIds;
    const changed = (input.title !== undefined && input.title !== post.title) ||
      (input.caption !== undefined && input.caption !== post.caption) || Date.parse(scheduledFor) !== Date.parse(post.scheduledFor!) ||
      !equalIds(media, post.mediaAssetIds) || !equalIds(ids, publications.filter(p => p.status === "scheduled").map(p => p.socialAccountId));
    if (changed) {
      const timestamp = now.toISOString();
      if (input.title !== undefined) post.title = input.title;
      if (input.caption !== undefined) post.caption = input.caption;
      if (Date.parse(scheduledFor) !== Date.parse(post.scheduledFor!)) post.scheduledFor = scheduledFor;
      post.mediaAssetIds = [...media]; post.updatedAt = timestamp;
      for (const publication of publications) {
        const status = ids.includes(publication.socialAccountId.toLowerCase()) ? "scheduled" : "cancelled";
        if (publication.status !== status) { publication.status = status; publication.updatedAt = timestamp; }
      }
      for (const id of ids) if (!publications.some(p => p.socialAccountId.toLowerCase() === id)) publications.push(this.newPublication(post, id, timestamp));
      this.publications.set(post.id, publications);
    }
    return this.get(postId);
  }

  async cancelScheduled(postId: string): Promise<void> {
    const actor = this.actor();
    const post = this.find(postId, actor.tenantId);
    if (!canManagePostAuthor(actor, post.authorUserId)) managementError(403, "post_forbidden");
    const publications = this.publications.get(post.id) ?? [];
    if (post.status === "cancelled" && post.publishedAt === null && publications.every(p => p.status === "cancelled" && hasNoPublicationEvidence(p))) return;
    if (!untouched(post, publications)) managementError(409, "post_not_cancellable");
    const timestamp = (this.options.now ?? (() => new Date()))().toISOString();
    post.status = "cancelled"; post.updatedAt = timestamp;
    for (const publication of publications) if (publication.status === "scheduled") { publication.status = "cancelled"; publication.updatedAt = timestamp; }
  }

  private actor() {
    return this.options.actor?.() ?? { userId: MOCK_AUTHOR_USER_ID, tenantId: this.tenantId, role: "owner" as const };
  }

  private find(postId: string, tenantId: string): Post {
    if (!isUuid(postId)) managementError(400, "invalid_post_id");
    const post = this.posts.find(post => post.id.toLowerCase() === postId.toLowerCase() && post.tenantId === tenantId);
    if (!post) managementError(404, "post_not_found");
    return post;
  }

  private newPublication(post: Post, socialAccountId: string, timestamp: string): PostPublication {
    const immediate = post.status === "published";
    return { id: crypto.randomUUID(), postId: post.id, tenantId: post.tenantId, socialAccountId,
      status: immediate ? "published" : "scheduled", createdAt: timestamp, updatedAt: timestamp,
      startedAt: immediate ? timestamp : null, publishedAt: immediate ? timestamp : null,
      providerPostId: immediate ? `mock_${crypto.randomUUID()}` : null, failedAt: null, errorCode: null, errorMessage: null };
  }

  async list(): Promise<Post[]> {
    const actor = this.actor();
    return this.posts.filter(post => post.tenantId === actor.tenantId && post.status !== "cancelled").map(clonePost);
  }

  async create(input: CreatePostInput): Promise<CreatePostResponse> {
    if (input.publicationMode === "scheduled" && !isValidScheduledFor(input.scheduledFor)) {
      throw new Error("O agendamento da publicação é inválido.");
    }

    const actor = this.actor();
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    const scheduledFor = input.publicationMode === "now" ? now : input.scheduledFor!;
    const isImmediate = input.publicationMode === "now";
    const post: Post = {
      authorUserId: actor.userId,
      caption: input.caption,
      createdAt: now,
      id: crypto.randomUUID(),
      mediaAssetIds: [...(input.mediaAssetIds ?? [])],
      publishedAt: isImmediate ? now : null,
      ragRunId: null,
      scheduledFor,
      status: isImmediate ? "published" : "scheduled",
      tenantId: actor.tenantId,
      title: input.title ?? null,
      updatedAt: now,
    };
    this.posts.unshift(post);

    const publications = input.socialAccountIds.map(id => this.newPublication(post, id, now));
    this.publications.set(post.id, publications);
    return { post: clonePost(post), publications: publications.map(p => ({ ...p })) };
  }
}
