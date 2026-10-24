import { isValidPostTimestamp } from "./postContract.ts";

// Reviewed v26.0 selection, not a statement that other documented metrics are deprecated.
export const INSIGHTS_METRICS = {
  facebook_page: ["page_media_view", "page_total_media_view_unique", "page_video_views"],
  facebook_post: [
    "post_media_view", "post_total_media_view_unique", "post_reactions_by_type_total",
    "post_reactions_like_total", "post_reactions_love_total", "post_reactions_wow_total",
    "post_reactions_haha_total", "post_reactions_sorry_total", "post_reactions_anger_total",
  ],
  instagram_account: ["views", "reach", "accounts_engaged", "total_interactions"],
  instagram_media: ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"],
} as const;

export type InsightsScope = keyof typeof INSIGHTS_METRICS;
export type InsightsPeriod = "day" | "week" | "days_28" | "lifetime";
export type InsightsMetricName<S extends InsightsScope = InsightsScope> =
  (typeof INSIGHTS_METRICS)[S][number];
type PeriodFor<S extends InsightsScope> = S extends "facebook_page"
  ? "day" | "week" | "days_28" : S extends "instagram_account" ? "day" : "lifetime";
export type InsightsSelection = {
  [S in InsightsScope]: {
    scope: S;
    period: PeriodFor<S>;
    metrics: readonly InsightsMetricName<S>[];
  }
}[InsightsScope];
export type InsightsStatus =
  | "available" | "not_available" | "unsupported" | "permission_required"
  | "token_expired" | "rate_limited" | "provider_unavailable";
export const INSIGHTS_REACTIONS = ["like", "love", "wow", "haha", "sorry", "anger"] as const;
export type InsightsReactionMap = Readonly<Record<(typeof INSIGHTS_REACTIONS)[number], number>>;
export type InsightsValue = number | InsightsReactionMap;
export type InsightsPoint = { value: InsightsValue | null; endTime: string | null };
export type InsightsMetric<N extends string = InsightsMetricName> = {
  name: N;
  status: InsightsStatus;
  points: InsightsPoint[];
};
export type InsightsResponse = {
  [S in InsightsScope]: {
    scope: S;
    period: PeriodFor<S>;
    graphApiVersion: "v26.0";
    fetchedAt: string;
    metrics: InsightsMetric<InsightsMetricName<S>>[];
  }
}[InsightsScope];

export function isInsightsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
export function isInsightsCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function isInsightsTimestamp(value: unknown): value is string {
  // Graph fixtures use ISO 8601 offsets without a colon; validate the real date too.
  return typeof value === "string" &&
    isValidPostTimestamp(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}
export function isInsightsReactionMap(value: unknown): value is InsightsReactionMap {
  return isInsightsRecord(value) && hasExactKeys(value, INSIGHTS_REACTIONS) &&
    INSIGHTS_REACTIONS.every((key) => isInsightsCount(value[key]));
}
export function isInsightsSelection(value: unknown): value is InsightsSelection {
  if (
    !isInsightsRecord(value) || !hasExactKeys(value, ["scope", "period", "metrics"]) ||
    typeof value.scope !== "string" || !Object.hasOwn(INSIGHTS_METRICS, value.scope)
  ) return false;
  const scope = value.scope as InsightsScope;
  const periods = scope === "facebook_page" ? ["day", "week", "days_28"]
    : scope === "instagram_account" ? ["day"] : ["lifetime"];
  return typeof value.period === "string" && periods.includes(value.period) &&
    Array.isArray(value.metrics) && value.metrics.length > 0 && value.metrics.length <= 4 &&
    new Set(value.metrics).size === value.metrics.length &&
    value.metrics.every((name: unknown) => typeof name === "string" &&
      (INSIGHTS_METRICS[scope] as readonly string[]).includes(name));
}
export function isInsightsResponse(value: unknown): value is InsightsResponse {
  if (
    !isInsightsRecord(value) ||
    !hasExactKeys(value, ["scope", "period", "graphApiVersion", "fetchedAt", "metrics"]) ||
    value.graphApiVersion !== "v26.0" || !isInsightsTimestamp(value.fetchedAt) ||
    !Array.isArray(value.metrics)
  ) return false;
  if (!isInsightsSelection({
    scope: value.scope,
    period: value.period,
    metrics: value.metrics.map((metric: unknown) =>
      isInsightsRecord(metric) ? metric.name : undefined),
  })) return false;
  let points = 0;
  return value.metrics.every((metric: unknown) => {
    if (
      !isInsightsRecord(metric) || !hasExactKeys(metric, ["name", "status", "points"]) ||
      !Array.isArray(metric.points) || metric.points.length === 0
    ) return false;
    points += metric.points.length;
    if (points > 1000) return false;
    if (metric.status !== "available") {
      return typeof metric.status === "string" && [
        "not_available", "unsupported", "permission_required", "token_expired",
        "rate_limited", "provider_unavailable",
      ].includes(metric.status) && metric.points.length === 1 &&
        isInsightsRecord(metric.points[0]) &&
        hasExactKeys(metric.points[0], ["value", "endTime"]) &&
        metric.points[0].value === null && metric.points[0].endTime === null;
    }
    return metric.points.every((point: unknown) =>
      isInsightsRecord(point) && hasExactKeys(point, ["value", "endTime"]) &&
      ((point.endTime === null && value.scope !== "facebook_page") ||
        isInsightsTimestamp(point.endTime)) &&
      (metric.name === "post_reactions_by_type_total"
        ? isInsightsReactionMap(point.value) : isInsightsCount(point.value)));
  });
}
