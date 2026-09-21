import type { Post } from "../types/social";
import { isValidPostTimestamp } from "../../shared/postContract";

const ISO_TIMESTAMP_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isRealCalendarDate(year: number, month: number, day: number) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;

  const candidate = new Date(0);
  candidate.setUTCFullYear(year, month - 1, day);
  candidate.setUTCHours(0, 0, 0, 0);

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function getScheduledTimestamp(
  scheduledFor: string | null | undefined,
): number | null {
  if (typeof scheduledFor !== "string") return null;

  const match = ISO_TIMESTAMP_WITH_ZONE.exec(scheduledFor);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isRealCalendarDate(year, month, day)) return null;

  const timestamp = Date.parse(scheduledFor);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function isValidScheduledFor(value: unknown): value is string {
  return isValidPostTimestamp(value);
}

export function localScheduleToIso(
  localDate: string,
  localTime: string,
): string | null {
  const dateMatch = LOCAL_DATE.exec(localDate);
  const timeMatch = LOCAL_TIME.exec(localTime);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (!isRealCalendarDate(year, month, day)) return null;

  const scheduledDate = new Date(0);
  scheduledDate.setFullYear(year, month - 1, day);
  scheduledDate.setHours(hour, minute, 0, 0);

  if (
    scheduledDate.getFullYear() !== year ||
    scheduledDate.getMonth() !== month - 1 ||
    scheduledDate.getDate() !== day ||
    scheduledDate.getHours() !== hour ||
    scheduledDate.getMinutes() !== minute
  ) {
    return null;
  }

  return scheduledDate.toISOString();
}

export function formatScheduledDate(
  scheduledFor: string | null | undefined,
): string {
  const timestamp = getScheduledTimestamp(scheduledFor);
  if (timestamp === null) return "";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  })
    .format(new Date(timestamp))
    .replace(".", "")
    .replace(/\s+de\s+/g, " ")
    .replace(/^0(?=\d)/, "");
}

export function formatScheduledTime(
  scheduledFor: string | null | undefined,
): string {
  const timestamp = getScheduledTimestamp(scheduledFor);
  if (timestamp === null) return "";

  const scheduledDate = new Date(timestamp);
  return `${String(scheduledDate.getHours()).padStart(2, "0")}:${String(
    scheduledDate.getMinutes(),
  ).padStart(2, "0")}`;
}

export function isScheduledToday(
  scheduledFor: string | null | undefined,
  today = new Date(),
): boolean {
  const timestamp = getScheduledTimestamp(scheduledFor);
  if (timestamp === null) return false;

  const scheduledDate = new Date(timestamp);
  return (
    scheduledDate.getFullYear() === today.getFullYear() &&
    scheduledDate.getMonth() === today.getMonth() &&
    scheduledDate.getDate() === today.getDate()
  );
}

export function selectNextScheduledPost(
  posts: readonly Post[],
  now = Date.now(),
): Post | undefined {
  let selectedPost: Post | undefined;
  let selectedTimestamp = Number.POSITIVE_INFINITY;

  for (const post of posts) {
    if (post.status !== "scheduled") continue;

    const timestamp = getScheduledTimestamp(post.scheduledFor);
    if (timestamp === null || timestamp <= now) continue;

    if (
      timestamp < selectedTimestamp ||
      (timestamp === selectedTimestamp &&
        selectedPost !== undefined &&
        post.id.localeCompare(selectedPost.id) < 0)
    ) {
      selectedPost = post;
      selectedTimestamp = timestamp;
    }
  }

  return selectedPost;
}
