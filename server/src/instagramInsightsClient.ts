import {
  isInsightsCount, isInsightsRecord, isInsightsResponse, isInsightsTimestamp,
  type InsightsMetric, type InsightsPoint, type InsightsSelection, type InsightsResponse,
} from "../../shared/insightsContract.ts";
import {
  createInsightsRequestDescriptor, executeInsightsRequest, MetaInsightsClientError,
  type InsightsCallOptions, type InsightsClientOptions, type InsightsCredential,
  type InsightsRequestInput,
} from "./metaInsightsClient.ts";

export type InstagramInsightsQuery = (
  | (Extract<InsightsSelection, { scope: "instagram_account" }> & {
    metricType: "total_value" | "time_series";
    since?: number;
    until?: number;
  })
  | (Extract<InsightsSelection, { scope: "instagram_media" }> & {
    expectedAccountId: string;
    subject: {
      mediaId: string;
      ownerAccountId: string;
      mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
      mediaProductType: "FEED" | "REELS";
      formatVerified: true;
      isAlbumChild: false;
    };
    topLevelEvidence: { mediaId: string; accountId: string; isTopLevel: true };
  })
) & { objectId: string; graphApiVersion: string };
export type InstagramInsightsResponse = Extract<InsightsResponse, { scope: "instagram_account" | "instagram_media" }>;

function requireMediaEvidence(query: Extract<InstagramInsightsQuery, { scope: "instagram_media" }>): void {
  const { subject, topLevelEvidence: evidence } = query;
  if (
    typeof query.expectedAccountId !== "string" || !/^\d{1,32}$/.test(query.expectedAccountId) ||
    !isInsightsRecord(subject) || subject.mediaId !== query.objectId ||
    subject.ownerAccountId !== query.expectedAccountId || subject.formatVerified !== true ||
    subject.isAlbumChild !== false ||
    !["IMAGE", "VIDEO", "CAROUSEL_ALBUM"].includes(subject.mediaType) ||
    !["FEED", "REELS"].includes(subject.mediaProductType) ||
    (subject.mediaProductType === "REELS" && subject.mediaType !== "VIDEO") ||
    !isInsightsRecord(evidence) || evidence.isTopLevel !== true ||
    evidence.mediaId !== query.objectId || evidence.accountId !== query.expectedAccountId
  ) throw new MetaInsightsClientError("unsupported_object");
}

function parseInstagramMetrics(body: unknown, query: InstagramInsightsQuery): InsightsMetric[] {
  if (!isInsightsRecord(body) || !Array.isArray(body.data)) {
    throw new MetaInsightsClientError("invalid_response");
  }
  const byName = new Map<string, InsightsPoint[]>();
  const totalValue = query.scope === "instagram_account" && query.metricType === "total_value";
  for (const row of body.data) {
    if (
      !isInsightsRecord(row) || typeof row.name !== "string" ||
      !(query.metrics as readonly string[]).includes(row.name) ||
      row.period !== query.period || byName.has(row.name) ||
      (Object.hasOwn(row, "metric_type") && (
        query.scope !== "instagram_account" || row.metric_type !== query.metricType
      ))
    ) throw new MetaInsightsClientError("invalid_response");
    if (totalValue) {
      // No breakdowns or alternate aggregates in this slice. A missing/invalid total is not absence.
      if (
        Object.hasOwn(row, "values") || !isInsightsRecord(row.total_value) ||
        Object.keys(row.total_value).some((key) => key !== "value") ||
        !isInsightsCount(row.total_value.value)
      ) throw new MetaInsightsClientError("invalid_response");
      byName.set(row.name, [{ value: row.total_value.value, endTime: null }]);
    } else {
      if (Object.hasOwn(row, "total_value") || !Array.isArray(row.values)) {
        throw new MetaInsightsClientError("invalid_response");
      }
      const seenTimes = new Set<number | null>();
      const points: InsightsPoint[] = row.values.map((raw: unknown) => {
        if (!isInsightsRecord(raw) || !isInsightsCount(raw.value)) {
          throw new MetaInsightsClientError("invalid_response");
        }
        const endTime = query.scope === "instagram_media" && raw.end_time === undefined
          ? null : raw.end_time;
        if (
          (endTime !== null && !isInsightsTimestamp(endTime)) ||
          (query.scope === "instagram_account" && endTime === null)
        ) throw new MetaInsightsClientError("invalid_response");
        // Identity is the UTC instant; retain original provider text in the safe DTO.
        const key = endTime === null ? null : Date.parse(endTime as string);
        if (seenTimes.has(key)) throw new MetaInsightsClientError("invalid_response");
        seenTimes.add(key);
        return { value: raw.value, endTime: endTime as string | null };
      });
      byName.set(row.name, points);
    }
  }
  return query.metrics.map((name) => {
    const points = byName.get(name);
    return points?.length ? { name, status: "available", points }
      : { name, status: "not_available", points: [{ value: null, endTime: null }] };
  });
}

export class InstagramInsightsClient {
  private readonly options: InsightsClientOptions;
  constructor(options: InsightsClientOptions = {}) { this.options = { ...options }; }

  // Internal pre-authorized inputs ONLY, not HTTP fields or a discovery implementation.
  // subject/formatVerified and independent topLevelEvidence must eventually come from an
  // authorized backend verifier tied to this exact media/account. This slice implements no
  // real top-level proof solution: fixtures are not Meta evidence and enable no external media.
  async query(
    query: InstagramInsightsQuery,
    credential: InsightsCredential,
    callOptions: InsightsCallOptions = {},
  ): Promise<InstagramInsightsResponse> {
    if (!isInsightsRecord(query) || !["instagram_account", "instagram_media"].includes(query.scope)) {
      throw new MetaInsightsClientError("invalid_query");
    }
    const allowed = query.scope === "instagram_account"
      ? ["scope", "objectId", "graphApiVersion", "period", "metrics", "metricType", "since", "until"]
      : ["scope", "objectId", "graphApiVersion", "period", "metrics", "expectedAccountId", "subject", "topLevelEvidence"];
    if (Object.keys(query).some((key) => !allowed.includes(key))) {
      throw new MetaInsightsClientError("invalid_query");
    }
    const input = {
      scope: query.scope, objectId: query.objectId, graphApiVersion: query.graphApiVersion,
      period: query.period, metrics: query.metrics,
      ...(query.scope === "instagram_account" ? {
        metricType: query.metricType,
        ...(query.since !== undefined ? { since: query.since } : {}),
        ...(query.until !== undefined ? { until: query.until } : {}),
      } : {}),
    } as InsightsRequestInput;
    createInsightsRequestDescriptor(input);
    if (query.scope === "instagram_media") requireMediaEvidence(query);
    else if (query.since !== undefined) {
      const now = (this.options.now ?? Date.now)();
      if (query.since * 1000 < now - 90 * 86400 * 1000 || query.until! * 1000 > now) {
        throw new MetaInsightsClientError("invalid_query");
      }
    }
    // Snapshot response authority before awaiting; credential snapshots/timeouts/errors belong to core.
    const snapshot = { ...query, metrics: [...query.metrics] } as InstagramInsightsQuery;
    const body = await executeInsightsRequest(input, credential, {
      ...this.options, signal: callOptions.signal,
    });
    const result = {
      scope: snapshot.scope, period: snapshot.period, graphApiVersion: "v26.0",
      fetchedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
      metrics: parseInstagramMetrics(body, snapshot),
    };
    if (!isInsightsResponse(result)) throw new MetaInsightsClientError("invalid_response");
    return result as InstagramInsightsResponse;
  }
}
