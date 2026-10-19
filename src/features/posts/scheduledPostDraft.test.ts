import { describe, expect, it } from "vitest";
import type { PostDetail } from "../../data/posts/PostsRepository";
import { initialPosts } from "../../data/mockData";
import { buildScheduledPostPatch, createScheduledPostDraft } from "./scheduledPostDraft";

const original: PostDetail = {
  post: { ...initialPosts[0], title: null, caption: "l".repeat(700), scheduledFor: "2098-12-12T15:30:42.123-03:00", mediaAssetIds: ["media-original"] },
  publications: [], permissions: { canEditSchedule: true, canCancelSchedule: true },
};

describe("scheduled post draft", () => {
  it("prefills null title, full caption and media without deriving a new title", () => {
    const draft = createScheduledPostDraft(original);
    expect(draft.title).toBeNull();
    expect(draft.caption).toBe("l".repeat(700));
    expect(draft.mediaAssetIds).toEqual(["media-original"]);
    expect(draft.localDate).toMatch(/^2098-12-1[23]$/);
    expect(draft.localTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it("omits untouched timestamps, destinations and all identity/status fields from a text patch", () => {
    const draft = createScheduledPostDraft(original);
    draft.caption = "Atualizada";
    draft.dirty.caption = true;
    expect(buildScheduledPostPatch(original, draft)).toEqual({ caption: "Atualizada" });
    expect(original.post.scheduledFor).toBe("2098-12-12T15:30:42.123-03:00");
    expect(original.post.caption).toHaveLength(700);
  });

  it("converts only a dirty valid local schedule and allowlists dirty values", () => {
    const draft = createScheduledPostDraft(original);
    draft.title = "Título explícito";
    draft.localDate = "2099-01-02";
    draft.localTime = "11:35";
    draft.socialAccountIds = ["account-b"];
    draft.mediaAssetIds = [];
    draft.dirty = { title: true, caption: false, schedule: true, destinations: true, media: true };
    const patch = buildScheduledPostPatch(original, draft);
    const scheduled = new Date(patch.scheduledFor!);
    expect([scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate(), scheduled.getHours(), scheduled.getMinutes(), scheduled.getSeconds()])
      .toEqual([2099, 0, 2, 11, 35, 0]);
    expect(patch).toEqual({ title: "Título explícito", scheduledFor: scheduled.toISOString(), socialAccountIds: ["account-b"], mediaAssetIds: [] });
  });

  it("rejects an invalid dirty schedule instead of silently retaining the old one", () => {
    const draft = createScheduledPostDraft(original);
    draft.localDate = "2099-02-30";
    draft.dirty.schedule = true;
    expect(() => buildScheduledPostPatch(original, draft)).toThrow();
  });

  it("does not send values changed back to the original or invent legacy destinations", () => {
    const draft = createScheduledPostDraft(original);
    draft.dirty = { title: true, caption: true, schedule: false, destinations: false, media: true };
    expect(buildScheduledPostPatch(original, draft)).toEqual({});
    expect(draft.socialAccountIds).toEqual([]);
  });

  it("initializes and compares only effective targets, retaining cancelled rows as history", () => {
    const row: PostDetail["publications"][number] = {
      id: "target-a", postId: original.post.id, tenantId: original.post.tenantId, socialAccountId: "account-a", status: "scheduled",
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", errorCode: null, errorMessage: null,
      startedAt: null, publishedAt: null, failedAt: null, providerPostId: null,
    };
    const withHistory: PostDetail = { ...original, publications: [row, { ...row, id: "target-b", socialAccountId: "account-b", status: "cancelled" }] };
    const draft = createScheduledPostDraft(withHistory);
    expect(draft.socialAccountIds).toEqual(["account-a"]);
    draft.dirty.destinations = true;
    expect(buildScheduledPostPatch(withHistory, draft)).toEqual({});
    expect(withHistory.publications).toHaveLength(2);
  });
});
