import { describe, expect, it } from "vitest";
import {
  isCreatePostResponse,
  isPostPublication,
} from "../../shared/postPublicationContract.ts";

const post = {
  authorUserId: "22222222-2222-4222-8222-222222222222",
  caption: "Conteúdo agendado",
  createdAt: "2027-08-10T13:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  mediaAssetIds: [],
  publishedAt: null,
  ragRunId: null,
  scheduledFor: "2027-08-13T13:00:00.000Z",
  status: "scheduled",
  tenantId: "11111111-1111-4111-8111-111111111111",
  title: "Publicação",
  updatedAt: "2027-08-10T13:00:00.000Z",
};

const publication = {
  createdAt: "2027-08-10T13:00:00.000Z",
  errorCode: null,
  errorMessage: null,
  failedAt: null,
  id: "44444444-4444-4444-8444-444444444444",
  postId: post.id,
  providerPostId: null,
  publishedAt: null,
  socialAccountId: "55555555-5555-4555-8555-555555555555",
  startedAt: null,
  status: "scheduled",
  tenantId: post.tenantId,
  updatedAt: "2027-08-10T13:00:00.000Z",
};

describe("PostPublication público", () => {
  it("aceita o DTO completo e os cinco estados oficiais", () => {
    for (const status of ["scheduled", "publishing", "published", "failed", "cancelled"]) {
      expect(isPostPublication({ ...publication, status })).toBe(true);
    }
    expect(isPostPublication({ ...publication, providerPostId: "provider-123", startedAt: "2027-08-10T13:01:00Z" })).toBe(true);
  });

  it.each(["id", "tenantId", "postId", "socialAccountId"])("rejeita UUID inválido em %s", (field) => {
    expect(isPostPublication({ ...publication, [field]: "not-a-uuid" })).toBe(false);
  });

  it.each(["createdAt", "updatedAt", "startedAt", "publishedAt", "failedAt"])("rejeita timestamp inválido em %s", (field) => {
    expect(isPostPublication({ ...publication, [field]: "2027-02-30T13:00:00Z" })).toBe(false);
  });

  it("rejeita estados não pertencentes ao contrato", () => {
    expect(isPostPublication({ ...publication, status: "partially_failed" })).toBe(false);
  });

  it.each(["accessToken", "accessTokenEncrypted", "providerPayload", "authorization"])("rejeita o campo sensível %s", (field) => {
    expect(isPostPublication({ ...publication, [field]: "secret" })).toBe(false);
  });

  it("exige todos os campos, incluindo os nullable", () => {
    const { errorCode: _removed, ...withoutErrorCode } = publication;
    void _removed;
    expect(isPostPublication(withoutErrorCode)).toBe(false);
    expect(isPostPublication({ ...publication, errorMessage: 7 })).toBe(false);
    expect(isPostPublication(null)).toBe(false);
  });
});

describe("CreatePostResponse público", () => {
  it("aceita um Post válido e uma lista de publicações válidas", () => {
    expect(isCreatePostResponse({ post, publications: [publication] })).toBe(true);
    expect(isCreatePostResponse({ post, publications: [] })).toBe(true);
  });

  it("rejeita Post inválido, publicações inválidas ou ausentes", () => {
    expect(isCreatePostResponse({ post: { ...post, id: "bad" }, publications: [] })).toBe(false);
    expect(isCreatePostResponse({ post, publications: [{ ...publication, status: "draft" }] })).toBe(false);
    expect(isCreatePostResponse({ post, publications: null })).toBe(false);
    expect(isCreatePostResponse({ publications: [publication] })).toBe(false);
  });

  it.each(["accessToken", "accessTokenEncrypted", "providerPayload", "authorization"])("rejeita %s no Post aninhado", (field) => {
    expect(isCreatePostResponse({ post: { ...post, [field]: "secret" }, publications: [publication] })).toBe(false);
  });

  it("rejeita qualquer campo fora do contrato público no Post aninhado", () => {
    expect(isCreatePostResponse({ post: { ...post, internalNote: "private" }, publications: [] })).toBe(false);
  });
});
