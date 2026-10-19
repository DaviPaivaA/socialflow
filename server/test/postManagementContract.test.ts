import { describe, expect, it } from "vitest";
import { isPostDetail } from "../../shared/postManagementContract.ts";
import { validateUpdateScheduledPost } from "../src/postManagementContract.ts";
import {
  PostForbiddenError,
  PostNotCancellableError,
  PostNotEditableError,
  PostNotFoundError,
} from "../src/postManagementErrors.ts";

const ACCOUNT_ID = "55555555-5555-4555-8555-555555555555";
const MEDIA_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_ID = "77777777-7777-4777-8777-777777777777";
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
  socialAccountId: ACCOUNT_ID,
  startedAt: null,
  status: "scheduled",
  tenantId: post.tenantId,
  updatedAt: "2027-08-10T13:00:00.000Z",
};
const permissions = { canEditSchedule: true, canCancelSchedule: false };
const detail = { post, publications: [publication], permissions };

describe("validateUpdateScheduledPost", () => {
  // Adding defaults, stripping null, or copying authority fields corrupts a PATCH.
  it("patch preserves omissions and rejects authority fields", () => {
    expect(validateUpdateScheduledPost({ caption: "nova" })).toEqual({
      success: true, data: { caption: "nova" },
    });
    expect(validateUpdateScheduledPost({ title: null })).toEqual({
      success: true, data: { title: null },
    });
    expect(validateUpdateScheduledPost({ caption: "nova", status: "scheduled" })).toEqual({
      success: false, fields: ["status"],
    });
  });

  it.each([
    { title: "Título" },
    { title: "a".repeat(255) },
    { caption: "  texto preservado  " },
    { scheduledFor: "2027-08-13T10:00:00-03:00" },
    { scheduledFor: "2027-08-13T10:00:00+14:00" },
    { scheduledFor: "9999-12-31T23:59:59.999Z" },
    { scheduledFor: "2000-01-01T00:00:00Z" },
    { socialAccountIds: [ACCOUNT_ID, OTHER_ID] },
    { mediaAssetIds: [] },
    { mediaAssetIds: [MEDIA_ID] },
    { title: null, caption: "nova", scheduledFor: "2027-08-13T13:00:00Z", socialAccountIds: [ACCOUNT_ID], mediaAssetIds: [MEDIA_ID] },
  ])("preserves exactly the supplied valid fields: %j", (input) => {
    expect(validateUpdateScheduledPost(input)).toEqual({ success: true, data: input });
  });

  // These literal field errors catch permissive/null/default/coercion branches.
  it.each([
    ["empty body", {}, "body"],
    ["null body", null, "body"],
    ["string body", "caption", "body"],
    ["array body", [], "body"],
    ["undefined body", undefined, "body"],
    ["empty title", { title: "  " }, "title"],
    ["long title", { title: "a".repeat(256) }, "title"],
    ["nonstring title", { title: 7 }, "title"],
    ["undefined title", { title: undefined }, "title"],
    ["empty caption", { caption: "  " }, "caption"],
    ["null caption", { caption: null }, "caption"],
    ["undefined caption", { caption: undefined }, "caption"],
    ["invalid date", { scheduledFor: "2027-02-30T10:00:00-03:00" }, "scheduledFor"],
    ["missing zone", { scheduledFor: "2027-08-13T10:00:00" }, "scheduledFor"],
    ["out of range offset", { scheduledFor: "2027-08-13T10:00:00+16:00" }, "scheduledFor"],
    ["invalid offset minutes", { scheduledFor: "2027-08-13T10:00:00+14:01" }, "scheduledFor"],
    ["normalized timestamp overflow", { scheduledFor: "9999-12-31T23:59:59-03:00" }, "scheduledFor"],
    ["null timestamp", { scheduledFor: null }, "scheduledFor"],
    ["empty destinations", { socialAccountIds: [] }, "socialAccountIds"],
    ["null destinations", { socialAccountIds: null }, "socialAccountIds"],
    ["nonarray destinations", { socialAccountIds: ACCOUNT_ID }, "socialAccountIds"],
    ["invalid destination", { socialAccountIds: ["bad-id"] }, "socialAccountIds"],
    ["duplicate destination", { socialAccountIds: [ACCOUNT_ID, ACCOUNT_ID] }, "socialAccountIds"],
    ["null media", { mediaAssetIds: null }, "mediaAssetIds"],
    ["nonarray media", { mediaAssetIds: MEDIA_ID }, "mediaAssetIds"],
    ["invalid media", { mediaAssetIds: ["bad-id"] }, "mediaAssetIds"],
    ["two media", { mediaAssetIds: [MEDIA_ID, OTHER_ID] }, "mediaAssetIds"],
    ["duplicate media", { mediaAssetIds: [MEDIA_ID, MEDIA_ID] }, "mediaAssetIds"],
  ])("rejects %s", (_name, input, field) => {
    expect(validateUpdateScheduledPost(input)).toEqual({ success: false, fields: [field] });
  });

  it.each(["status", "publicationMode", "tenant", "tenantId", "author", "authorUserId", "role", "id", "unknown"])("rejects forbidden key %s", (field) => {
    expect(validateUpdateScheduledPost({ caption: "nova", [field]: "untrusted" })).toEqual({
      success: false, fields: [field],
    });
  });

  it("rejects destination UUIDs duplicated with different hexadecimal casing", () => {
    expect(validateUpdateScheduledPost({ socialAccountIds: [
      "abcdefab-cdef-4abc-8def-abcdefabcdef",
      "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
    ] })).toEqual({ success: false, fields: ["socialAccountIds"] });
  });

  it("preserves supplied UUID spelling when destination identities are distinct", () => {
    expect(validateUpdateScheduledPost({ socialAccountIds: [
      "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
      "123456ab-cdef-4abc-8def-abcdefabcdef",
    ] })).toEqual({ success: true, data: { socialAccountIds: [
      "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
      "123456ab-cdef-4abc-8def-abcdefabcdef",
    ] } });
  });
});

describe("isPostDetail", () => {
  // A permissive guard would leak secrets or accept unrelated database rows.
  it("detail enforces safe related rows", () => {
    expect(isPostDetail(detail)).toBe(true);
    expect(isPostDetail({ ...detail, publications: [] })).toBe(true);
    expect(isPostDetail({ ...detail, publications: [{ ...publication, postId: OTHER_ID }] })).toBe(false);
    expect(isPostDetail({ ...detail, publications: [{ ...publication, tenantId: OTHER_ID }] })).toBe(false);
  });

  it.each(["accessToken", "accessTokenEncrypted", "providerPayload", "authorization", "internalNote"])("rejects extra public field %s at every level", (field) => {
    expect(isPostDetail({ ...detail, [field]: "private" })).toBe(false);
    expect(isPostDetail({ ...detail, post: { ...post, [field]: "private" } })).toBe(false);
    expect(isPostDetail({ ...detail, publications: [{ ...publication, [field]: "private" }] })).toBe(false);
    expect(isPostDetail({ ...detail, permissions: { ...permissions, [field]: "private" } })).toBe(false);
  });

  it.each([
    null,
    [],
    {},
    { post, publications: [publication] },
    { ...detail, post: { ...post, id: "bad-id" } },
    { ...detail, post: { ...post, authorUserId: null } },
    { ...detail, publications: null },
    { ...detail, publications: [{ ...publication, status: "draft" }] },
    { ...detail, publications: [{ ...publication, createdAt: "2027-02-30T00:00:00Z" }] },
    { ...detail, permissions: null },
    { ...detail, permissions: [] },
    { ...detail, permissions: { canEditSchedule: true } },
    { ...detail, permissions: { ...permissions, canCancelSchedule: "false" } },
    { ...detail, permissions: { ...permissions, canEditSchedule: 1 } },
    Object.create(detail),
  ])("rejects malformed detail %#", (input) => {
    expect(isPostDetail(input)).toBe(false);
  });

  it("accepts both boolean permission values without inferring state authority", () => {
    expect(isPostDetail({ ...detail, permissions: { canEditSchedule: false, canCancelSchedule: true } })).toBe(true);
  });
});

describe("post management errors", () => {
  // Consumers need distinct typed failures with fixed safe public codes.
  it.each([
    [PostNotFoundError, "post_not_found"],
    [PostForbiddenError, "post_forbidden"],
    [PostNotEditableError, "post_not_editable"],
    [PostNotCancellableError, "post_not_cancellable"],
  ] as const)("exposes a safe code for %s", (ErrorType, code) => {
    const error = new ErrorType();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(ErrorType.name);
    expect(error.code).toBe(code);
    expect(error.message.trim().length).toBeGreaterThan(0);
  });
});
