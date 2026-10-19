import type { PostDetail, UpdateScheduledPostInput } from "../../data/posts/PostsRepository";
import { localScheduleToIso } from "../../domain/scheduling";

export type ScheduledPostDraft = {
  title: string | null;
  caption: string;
  localDate: string;
  localTime: string;
  socialAccountIds: string[];
  mediaAssetIds: string[];
  dirty: { title: boolean; caption: boolean; schedule: boolean; destinations: boolean; media: boolean };
};

export function createScheduledPostDraft(original: PostDetail): ScheduledPostDraft {
  const date = original.post.scheduledFor ? new Date(original.post.scheduledFor) : null;
  return { title: original.post.title, caption: original.post.caption,
    localDate: date ? `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : "",
    localTime: date ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : "",
    socialAccountIds: [...new Set(original.publications.filter((publication) => publication.status !== "cancelled").map((publication) => publication.socialAccountId))],
    mediaAssetIds: [...original.post.mediaAssetIds],
    dirty: { title: false, caption: false, schedule: false, destinations: false, media: false } };
}

export function buildScheduledPostPatch(original: PostDetail, draft: ScheduledPostDraft): UpdateScheduledPostInput {
  const patch: UpdateScheduledPostInput = {};
  if (draft.dirty.title && draft.title !== original.post.title) patch.title = draft.title;
  if (draft.dirty.caption && draft.caption !== original.post.caption) patch.caption = draft.caption;
  if (draft.dirty.schedule) {
    const initial = createScheduledPostDraft(original);
    if (draft.localDate !== initial.localDate || draft.localTime !== initial.localTime) {
      const scheduledFor = localScheduleToIso(draft.localDate, draft.localTime);
      if (!scheduledFor) throw new Error("Data ou horário inválido.");
      patch.scheduledFor = scheduledFor;
    }
  }
  const sameIds = (left: string[], right: string[]) => left.length === right.length && left.every((id) => right.includes(id));
  if (draft.dirty.destinations && !sameIds(draft.socialAccountIds, createScheduledPostDraft(original).socialAccountIds)) {
    patch.socialAccountIds = [...draft.socialAccountIds];
  }
  if (draft.dirty.media && !sameIds(draft.mediaAssetIds, original.post.mediaAssetIds)) patch.mediaAssetIds = [...draft.mediaAssetIds];
  return patch;
}
