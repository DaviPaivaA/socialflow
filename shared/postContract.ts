export const POST_STATUSES = [
  "draft",
  "scheduled",
  "publishing",
  "published",
  "partially_failed",
  "failed",
  "cancelled",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export type Post = {
  authorUserId: string;
  caption: string;
  createdAt: string;
  id: string;
  mediaAssetIds: string[];
  publishedAt: string | null;
  ragRunId: string | null;
  scheduledFor: string | null;
  status: PostStatus;
  tenantId: string;
  title: string | null;
  updatedAt: string;
};

const ISO_TIMESTAMP_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,3})?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_POST_TIMESTAMP = Date.parse("0001-01-01T00:00:00.000Z");
const MAX_POST_TIMESTAMP = Date.parse("9999-12-31T23:59:59.999Z");

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

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isValidPostTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = ISO_TIMESTAMP_WITH_ZONE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const offsetHours = match[7] === "Z" ? 0 : Number(match[9]);
  const offsetMinutes = match[7] === "Z" ? 0 : Number(match[10]);
  if (
    offsetHours > 14 ||
    (offsetHours === 14 && offsetMinutes !== 0)
  ) {
    return false;
  }

  const timestamp = Date.parse(value);
  return (
    isRealCalendarDate(year, month, day) &&
    Number.isFinite(timestamp) &&
    timestamp >= MIN_POST_TIMESTAMP &&
    timestamp <= MAX_POST_TIMESTAMP
  );
}

export function isPostStatus(value: unknown): value is PostStatus {
  return (
    typeof value === "string" &&
    POST_STATUSES.some((status) => status === value)
  );
}

function isMediaAssetIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 1 &&
    value.every(isUuid) &&
    new Set(value).size === value.length
  );
}

export function isPost(value: unknown): value is Post {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const post = value as Record<string, unknown>;
  return (
    isUuid(post.id) &&
    isUuid(post.tenantId) &&
    isUuid(post.authorUserId) &&
    isMediaAssetIds(post.mediaAssetIds) &&
    (post.ragRunId === null || isUuid(post.ragRunId)) &&
    (typeof post.title === "string" || post.title === null) &&
    typeof post.caption === "string" &&
    isPostStatus(post.status) &&
    (post.scheduledFor === null || isValidPostTimestamp(post.scheduledFor)) &&
    (post.publishedAt === null || isValidPostTimestamp(post.publishedAt)) &&
    isValidPostTimestamp(post.createdAt) &&
    isValidPostTimestamp(post.updatedAt)
  );
}
