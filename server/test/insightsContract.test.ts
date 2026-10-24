import { describe, expect, it } from "vitest";
import { isInsightsResponse, isInsightsSelection } from "../../shared/insightsContract.ts";

const response = {
  scope: "facebook_page", period: "day", graphApiVersion: "v26.0",
  fetchedAt: "2026-10-20T12:00:00.000Z",
  metrics: [{ name: "page_media_view", status: "available", points: [{ value: 0, endTime: "2026-10-19T07:00:00+0000" }] }],
};

describe("Insights safe contract", () => {
  // Catches widening scope/period/metric combinations beyond the reviewed selection.
  it.each([
    ["facebook_page", "day", "page_media_view", true],
    ["facebook_page", "week", "page_video_views", true],
    ["facebook_page", "days_28", "page_total_media_view_unique", true],
    ["facebook_post", "lifetime", "post_media_view", true],
    ["instagram_account", "day", "reach", true],
    ["instagram_media", "lifetime", "saved", true],
    ["facebook_page", "lifetime", "page_media_view", false],
    ["facebook_post", "day", "post_media_view", false],
    ["instagram_account", "week", "reach", false],
    ["instagram_media", "day", "reach", false],
    ["facebook_page", "day", "post_media_view", false],
    ["instagram_account", "day", "profile_views", false],
    ["instagram_media", "lifetime", "accounts_engaged", false],
  ])("validates %s/%s/%s", (scope, period, name, valid) => {
    expect(isInsightsSelection({ scope, period, metrics: [name] })).toBe(valid);
  });

  it("preserves a real zero with a validated timestamp", () => {
    expect(isInsightsResponse(response)).toBe(true);
  });

  // A Page series cannot be available without a period-end timestamp.
  it.each(["day", "week", "days_28"])("rejects an available Facebook Page %s point with null endTime", (period) => {
    expect(isInsightsResponse({ ...response, period, metrics: [
      { name: "page_media_view", status: "available", points: [{ value: 0, endTime: null }] },
    ] })).toBe(false);
  });

  // Characterization: tightening Page validation must not reject timestamp-free totals.
  it.each([
    ["instagram_account", "day", "views"],
    ["facebook_post", "lifetime", "post_media_view"],
  ])("accepts an available %s/%s total without a timestamp", (scope, period, name) => {
    expect(isInsightsResponse({ ...response, scope, period, metrics: [
      { name, status: "available", points: [{ value: 0, endTime: null }] },
    ] })).toBe(true);
  });

  it.each(["not_available", "unsupported", "permission_required", "token_expired", "rate_limited", "provider_unavailable"])("accepts %s only with explicit null absence", (status) => {
    const metrics = [{ name: "page_media_view", status, points: [{ value: null, endTime: null }] }];
    expect(isInsightsResponse({ ...response, metrics })).toBe(true);
    expect(isInsightsResponse({ ...response, metrics: [{ ...metrics[0], points: [{ value: 0, endTime: null }] }] })).toBe(false);
  });

  // Catches coercion admitting malformed JSON statuses or throwing during validation.
  it.each([
    ["single-element array", ["not_available"]],
    ["nested array", [["not_available"]]],
    ["object with null toString", { toString: null }],
  ])("rejects a non-string %s status without throwing", (_label, status) => {
    expect(isInsightsResponse({ ...response, metrics: [
      { name: "page_media_view", status, points: [{ value: null, endTime: null }] },
    ] })).toBe(false);
  });

  // Catches loose DTO guards admitting provider objects, secrets, or fabricated absence.
  it.each([
    { ...response, accessToken: "secret" },
    { ...response, paging: { next: "secret" } },
    { ...response, scope: "facebook_post" },
    { ...response, graphApiVersion: "v25.0" },
    { ...response, fetchedAt: "2026-02-30T12:00:00Z" },
    { ...response, metrics: [] },
    { ...response, metrics: [response.metrics[0], response.metrics[0]] },
    { ...response, metrics: [{ ...response.metrics[0], raw: "secret" }] },
    { ...response, metrics: [{ ...response.metrics[0], points: [{ value: null, endTime: null }] }] },
    { ...response, metrics: [{ ...response.metrics[0], points: [{ value: 0, endTime: null, accessToken: "secret" }] }] },
    { ...response, metrics: [{ ...response.metrics[0], points: [{ value: -1, endTime: null }] }] },
    { ...response, metrics: [{ ...response.metrics[0], points: [{ value: Infinity, endTime: null }] }] },
    { ...response, metrics: [{ ...response.metrics[0], points: [{ value: { like: 2 }, endTime: null }] }] },
  ])("rejects unsafe or inconsistent response %#", (candidate) => {
    expect(isInsightsResponse(candidate)).toBe(false);
  });

  it("accepts canonical reaction maps without inventing totals or care", () => {
    const candidate = { ...response, scope: "facebook_post", period: "lifetime", metrics: [{ name: "post_reactions_by_type_total", status: "available", points: [{ value: { like: 0, love: 2, wow: 1, haha: 0, sorry: 0, anger: 0 }, endTime: null }] }] };
    expect(isInsightsResponse(candidate)).toBe(true);
    for (const value of [{ like: 0 }, { care: 1 }, { LIKE: 1 }, { like: -1 }, { like: "1" }, {}, 5]) {
      expect(isInsightsResponse({ ...candidate, metrics: [{ ...candidate.metrics[0], points: [{ value, endTime: null }] }] })).toBe(false);
    }
  });
});
