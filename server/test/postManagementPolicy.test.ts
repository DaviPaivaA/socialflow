import { describe, expect, it } from "vitest";
import { canManagePostAuthor } from "../../shared/postManagementPolicy.ts";
import type { TenantRole } from "../../shared/authContract.ts";

const memberId = "22222222-2222-4222-8222-222222222222";
const otherId = "77777777-7777-4777-8777-777777777777";

describe("canManagePostAuthor", () => {
  // Removing the member author comparison grants cross-author management.
  it("role and author matrix", () => {
    expect(canManagePostAuthor({ userId: memberId, role: "member" }, otherId)).toBe(false);
    expect(canManagePostAuthor({ userId: memberId, role: "member" }, memberId)).toBe(true);
    expect(canManagePostAuthor({ userId: memberId, role: "owner" }, otherId)).toBe(true);
    expect(canManagePostAuthor({ userId: memberId, role: "admin" }, otherId)).toBe(true);
  });

  it.each([null, undefined, "", "not-a-uuid", 7, {}, []])("denies member an unknown/invalid author %j", (authorUserId) => {
    expect(canManagePostAuthor({ userId: memberId, role: "member" }, authorUserId)).toBe(false);
  });

  it.each(["owner", "admin"] satisfies TenantRole[])("allows %s to manage posts without a known author", (role) => {
    expect(canManagePostAuthor({ userId: memberId, role }, null)).toBe(true);
    expect(canManagePostAuthor({ userId: memberId, role }, undefined)).toBe(true);
    expect(canManagePostAuthor({ userId: memberId, role }, memberId)).toBe(true);
  });

  it("denies a matching but invalid author identifier", () => {
    expect(canManagePostAuthor({ userId: "invalid", role: "member" }, "invalid")).toBe(false);
  });
});
