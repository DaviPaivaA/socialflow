import {
  INSIGHTS_REACTIONS, isInsightsCount, isInsightsReactionMap, isInsightsRecord,
  isInsightsResponse, isInsightsTimestamp, type InsightsMetric, type InsightsPoint,
  type InsightsResponse, type InsightsSelection,
} from "../../shared/insightsContract.ts";
import {
  createInsightsRequestDescriptor, executeInsightsRequest, MetaInsightsClientError,
  type InsightsCallOptions, type InsightsClientOptions, type InsightsCredential,
  type InsightsRequestInput,
} from "./metaInsightsClient.ts";

export type FacebookInsightsQuery = (
  | Extract<InsightsSelection, { scope: "facebook_page" }>
  | (Extract<InsightsSelection, { scope: "facebook_post" }> & { objectType: "feed_post" })
) & {
  objectId: string;
  graphApiVersion: string;
  since?: number;
  until?: number;
};
export type FacebookInsightsResponse = Extract<
  InsightsResponse, { scope: "facebook_page" | "facebook_post" }
>;

function parseFacebookMetrics(body: unknown, query: FacebookInsightsQuery): InsightsMetric[] {
  if (!isInsightsRecord(body) || !Array.isArray(body.data)) {
    throw new MetaInsightsClientError("invalid_response");
  }
  const byName = new Map<string, InsightsPoint[]>();
  let datapoints = 0;
  for (const row of body.data) {
    if (
      !isInsightsRecord(row) || typeof row.name !== "string" ||
      !(query.metrics as readonly string[]).includes(row.name) ||
      row.period !== query.period || byName.has(row.name) || !Array.isArray(row.values)
    ) throw new MetaInsightsClientError("invalid_response");
    datapoints += row.values.length;
    if (datapoints > 1000) throw new MetaInsightsClientError("invalid_response");
    const seenTimes = new Set<number | null>();
    const points: InsightsPoint[] = row.values.map((raw: unknown) => {
      if (!isInsightsRecord(raw)) throw new MetaInsightsClientError("invalid_response");
      const endTime = raw.end_time === undefined && query.period === "lifetime"
        ? null : raw.end_time;
      if (
        (endTime !== null && !isInsightsTimestamp(endTime)) ||
        (query.period !== "lifetime" && endTime === null)
      ) throw new MetaInsightsClientError("invalid_response");
      // Compare validated instants, but preserve the provider's timestamp text in the DTO.
      const timeKey = endTime === null ? null : Date.parse(endTime as string);
      if (seenTimes.has(timeKey)) throw new MetaInsightsClientError("invalid_response");
      seenTimes.add(timeKey);
      if (row.name === "post_reactions_by_type_total") {
        if (!isInsightsReactionMap(raw.value)) throw new MetaInsightsClientError("invalid_response");
        // Copy validated canonical keys only; no care inference or total/reaction summation.
        const reactions = raw.value;
        const value = Object.fromEntries(INSIGHTS_REACTIONS.map((key) => [key, reactions[key]]));
        return {
          value: value as NonNullable<InsightsPoint["value"]>,
          endTime: endTime as string | null,
        };
      }
      if (!isInsightsCount(raw.value)) throw new MetaInsightsClientError("invalid_response");
      return { value: raw.value, endTime: endTime as string | null };
    });
    byName.set(row.name, points);
  }
  return query.metrics.map((name) => {
    const points = byName.get(name);
    return points?.length ? { name, status: "available", points }
      : { name, status: "not_available", points: [{ value: null, endTime: null }] };
  });
}

export class FacebookInsightsClient {
  private readonly options: InsightsClientOptions;
  constructor(options: InsightsClientOptions = {}) { this.options = { ...options }; }

  // Internal pre-authorized subject only: no route, repository, object discovery, or ID inference.
  async query(
    query: FacebookInsightsQuery,
    credential: InsightsCredential,
    callOptions: InsightsCallOptions = {},
  ): Promise<FacebookInsightsResponse> {
    if (
      !isInsightsRecord(query) || !["facebook_page", "facebook_post"].includes(query.scope) ||
      Object.keys(query).some((key) => ![
        "scope", "objectId", "objectType", "graphApiVersion", "period", "metrics", "since", "until",
      ].includes(key))
    ) throw new MetaInsightsClientError("invalid_query");
    if (query.scope === "facebook_post" && query.objectType !== "feed_post") {
      throw new MetaInsightsClientError("unsupported_object");
    }
    if (query.scope === "facebook_page" && Object.hasOwn(query, "objectType")) {
      throw new MetaInsightsClientError("invalid_query");
    }
    const input = {
      scope: query.scope,
      objectId: query.objectId,
      graphApiVersion: query.graphApiVersion,
      period: query.period,
      metrics: query.metrics,
      ...(query.since !== undefined ? { since: query.since } : {}),
      ...(query.until !== undefined ? { until: query.until } : {}),
    } as InsightsRequestInput;
    createInsightsRequestDescriptor(input);
    const now = (this.options.now ?? Date.now)();
    if (query.since !== undefined) {
      const oldest = new Date(now);
      oldest.setUTCFullYear(oldest.getUTCFullYear() - 2);
      if (
        query.since * 1000 < oldest.getTime() || query.until! * 1000 > now ||
        (query.until! - query.since) > 90 * 86400
      ) throw new MetaInsightsClientError("invalid_query");
    }
    // Snapshot selection before awaiting transport so callers cannot mutate response authority.
    const snapshot = { ...query, metrics: [...query.metrics] } as FacebookInsightsQuery;
    const body = await executeInsightsRequest(input, credential, {
      ...this.options, signal: callOptions.signal,
    });
    const result = {
      scope: snapshot.scope,
      period: snapshot.period,
      graphApiVersion: "v26.0",
      fetchedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
      metrics: parseFacebookMetrics(body, snapshot),
    };
    if (!isInsightsResponse(result)) throw new MetaInsightsClientError("invalid_response");
    return result as FacebookInsightsResponse;
  }
}
