import { afterEach, describe, expect, it, vi } from "vitest";
import { FacebookInsightsClient, type FacebookInsightsQuery } from "../src/facebookInsightsClient.ts";
import { MetaInsightsClientError, type InsightsCredential, type InsightsTransport, type InsightsRequestDescriptor } from "../src/metaInsightsClient.ts";
import { isInsightsResponse } from "../../shared/insightsContract.ts";

const now = () => Date.parse("2026-10-20T12:00:00.000Z");
const credential: InsightsCredential = { tokenKind: "page", accessToken: "page-secret-canary", expiresAt: null, grantedScopes: ["read_insights", "pages_read_engagement", "pages_show_list"], tasks: ["ANALYZE"] };
const page: FacebookInsightsQuery = { scope: "facebook_page", objectId: "123456", graphApiVersion: "v26.0", period: "day", metrics: ["page_media_view"] };
const post: FacebookInsightsQuery = { scope: "facebook_post", objectId: "123456_789", objectType: "feed_post", graphApiVersion: "v26.0", period: "lifetime", metrics: ["post_media_view"] };
const datum = (name = "page_media_view", period = "day", value: unknown = 0) => ({ name, period, values: [{ value, ...(period === "lifetime" ? {} : { end_time: "2026-10-19T07:00:00+0000" }) }], title: "Provider title", description: "Provider description", id: `123456/insights/${name}/${period}` });
function withBody(body: unknown, status = 200) {
  const transport = vi.fn<InsightsTransport>().mockResolvedValue({ status, body });
  return { client: new FacebookInsightsClient({ transport, now }), transport };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("local Facebook Insights", () => {
  // Removing any whitelist/validation gate must cause a transport call and fail these tests.
  it.each([
    { metrics: ["page_impressions"] }, { metrics: ["page_post_engagements"] },
    { metrics: ["page_follows"] }, { metrics: ["post_clicks"] }, { metrics: ["unknown"] },
    { metrics: [] }, { metrics: ["page_media_view", "page_media_view"] },
    { period: "lifetime" }, { graphApiVersion: "v25.0" },
    { objectId: "https://graph.facebook.com/123456" }, { objectId: "../123" },
    { objectId: "123?access_token=secret" }, { objectId: "123_456" }, { objectId: "9".repeat(33) },
    { since: 100 }, { since: 100, until: 99 }, { since: "100", until: 101 },
    { since: 1, until: 100 }, { since: 1780000000, until: 1790000000 },
    { since: 1792497600, until: 1792584001 },
    { host: "evil.example" }, { access_token: "secret" }, { fields: "secret" },
  ])("rejects invalid page query %# before transport", async (changes) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query({ ...page, ...changes } as FacebookInsightsQuery, credential)).rejects.toMatchObject({ code: "invalid_query" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["video", "reel", "unknown", undefined])("never infers a feed post from %s", async (objectType) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query({ ...post, objectType } as FacebookInsightsQuery, credential)).rejects.toMatchObject({ code: "unsupported_object" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects more than four distinct metrics", async () => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query({ ...post, metrics: ["post_media_view", "post_total_media_view_unique", "post_reactions_like_total", "post_reactions_love_total", "post_reactions_wow_total"] }, credential)).rejects.toMatchObject({ code: "invalid_query" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { tokenKind: "user" }, { grantedScopes: ["read_insights", "pages_show_list"] },
    { grantedScopes: ["pages_read_engagement", "pages_show_list"] },
    { grantedScopes: ["read_insights", "pages_read_engagement"] }, { tasks: ["CREATE_CONTENT"] },
    { accessToken: "" },
  ])("requires the actual page credential authority %#", async (changes) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query(page, { ...credential, ...changes } as InsightsCredential)).rejects.toMatchObject({ code: "permission_required" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["2026-10-20T12:00:00.000Z", "invalid"])("rejects expired/invalid credential expiry %s", async (expiresAt) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query(page, { ...credential, expiresAt })).rejects.toMatchObject({ code: "token_expired" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("builds only an immutable fixed-host allowlisted descriptor with separate credentials", async () => {
    const { client, transport } = withBody({ data: [datum()], paging: { next: "https://evil.example/?access_token=secret" }, secret: "secret" });
    const result = await client.query({ ...page, since: 1792281600, until: 1792454400 }, credential);
    expect(result).toEqual({ scope: "facebook_page", period: "day", graphApiVersion: "v26.0", fetchedAt: "2026-10-20T12:00:00.000Z", metrics: [{ name: "page_media_view", status: "available", points: [{ value: 0, endTime: "2026-10-19T07:00:00+0000" }] }] });
    expect(isInsightsResponse(result)).toBe(true);
    const [descriptor, privateCredential, signal] = transport.mock.calls[0];
    expect(descriptor).toEqual({ host: "graph.facebook.com", graphApiVersion: "v26.0", method: "GET", objectId: "123456", edge: "insights", scope: "facebook_page", parameters: { metric: "page_media_view", period: "day", since: 1792281600, until: 1792454400 } });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.parameters)).toBe(true);
    expect(privateCredential).toEqual(credential);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify({ descriptor, result })).not.toContain("secret");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["day", "week", "days_28"] as const)("accepts all selected Page metrics in %s without aggregation", async (period) => {
    const names = ["page_media_view", "page_total_media_view_unique", "page_video_views"] as const;
    const { client } = withBody({ data: names.map((name) => ({ ...datum(name, period, 0), values: [{ value: 0, end_time: "2026-10-18T07:00:00+0000" }, { value: 3, end_time: "2026-10-19T07:00:00+0000" }] })) });
    const result = await client.query({ ...page, period, metrics: names }, credential);
    expect(result.metrics.map((metric) => metric.points.map((point) => point.value))).toEqual([[0, 3], [0, 3], [0, 3]]);
  });

  it.each(["post_media_view", "post_total_media_view_unique", "post_reactions_like_total", "post_reactions_love_total", "post_reactions_wow_total", "post_reactions_haha_total", "post_reactions_sorry_total", "post_reactions_anger_total"] as const)("accepts selected Post count %s", async (name) => {
    const { client } = withBody({ data: [datum(name, "lifetime", 0)] });
    expect((await client.query({ ...post, metrics: [name] }, credential)).metrics).toEqual([{ name, status: "available", points: [{ value: 0, endTime: null }] }]);
  });

  // Comparing timestamp text instead of instants admits conflicting values for one period.
  it.each([
    ["2026-10-19T07:00:00+0000", "2026-10-19T07:00:00Z"],
    ["2026-10-19T10:00:00-03:00", "2026-10-19T13:00:00Z"],
  ])("rejects equivalent timestamp representations %s and %s", async (first, second) => {
    const { client } = withBody({ data: [{ ...datum(), values: [
      { value: 1, end_time: first }, { value: 2, end_time: second },
    ] }] });
    await expect(client.query(page, credential)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("preserves original timestamps for distinct instants across offset formats", async () => {
    const { client } = withBody({ data: [{ ...datum(), values: [
      { value: 1, end_time: "2026-10-19T10:00:00-03:00" },
      { value: 2, end_time: "2026-10-19T14:00:00+0000" },
    ] }] });
    expect((await client.query(page, credential)).metrics[0].points).toEqual([
      { value: 1, endTime: "2026-10-19T10:00:00-03:00" },
      { value: 2, endTime: "2026-10-19T14:00:00+0000" },
    ]);
  });

  it("rejects duplicate lifetime points without timestamps", async () => {
    const { client } = withBody({ data: [{ ...datum("post_media_view", "lifetime"), values: [
      { value: 1 }, { value: 2, end_time: null },
    ] }] });
    await expect(client.query(post, credential)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("preserves complete canonical reaction maps without summing or synthesizing care", async () => {
    const value = { like: 0, love: 2, wow: 1, haha: 0, sorry: 0, anger: 0 };
    const { client } = withBody({ data: [datum("post_reactions_by_type_total", "lifetime", value)] });
    const result = await client.query({ ...post, metrics: ["post_reactions_by_type_total"] }, credential);
    expect(result.metrics).toEqual([{ name: "post_reactions_by_type_total", status: "available", points: [{ value, endTime: null }] }]);
    expect(isInsightsResponse(result)).toBe(true);
  });

  it.each([{ data: [] }, { data: [{ ...datum(), values: [] }] }])("returns explicit absence for an empty response %#", async (body) => {
    const { client } = withBody(body);
    expect((await client.query(page, credential)).metrics).toEqual([{ name: "page_media_view", status: "not_available", points: [{ value: null, endTime: null }] }]);
  });

  it("preserves partial response and request order without making absent metrics zero", async () => {
    const { client } = withBody({ data: [datum()] });
    expect((await client.query({ ...page, metrics: ["page_video_views", "page_media_view"] }, credential)).metrics).toEqual([
      { name: "page_video_views", status: "not_available", points: [{ value: null, endTime: null }] },
      { name: "page_media_view", status: "available", points: [{ value: 0, endTime: "2026-10-19T07:00:00+0000" }] },
    ]);
  });

  it.each([
    null, {}, { data: null }, { data: {} }, { data: [null] },
    { data: [datum(), datum()] }, { data: [datum("unknown")] }, { data: [datum("page_media_view", "week")] },
    { data: [{ ...datum(), values: {} }] }, { data: [{ ...datum(), values: [null] }] },
    ...[null, "0", -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, true, {}].map((value) => ({ data: [datum("page_media_view", "day", value)] })),
    { data: [{ ...datum(), values: [{ end_time: "2026-10-19T07:00:00+0000" }] }] },
    ...[undefined, null, "not-date", "2026-02-30T07:00:00+0000", "2026-10-19", "2026-10-19T07:00:00+9999"].map((end_time) => ({ data: [{ ...datum(), values: [{ value: 0, end_time }] }] })),
    { data: [{ ...datum(), values: [{ value: 1, end_time: "2026-10-19T07:00:00+0000" }, { value: 2, end_time: "2026-10-19T07:00:00+0000" }] }] },
  ])("rejects malformed/ambiguous data instead of laundering it into absence %#", async (body) => {
    const { client } = withBody(body);
    await expect(client.query(page, credential)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([{ like: 1 }, { LIKE: 1 }, { care: 1 }, {}, 4, { like: 0, love: 2, wow: 1, haha: 0, sorry: 0, anger: 0, care: 1 }])("rejects unproven reaction shape %#", async (value) => {
    const { client } = withBody({ data: [datum("post_reactions_by_type_total", "lifetime", value)] });
    await expect(client.query({ ...post, metrics: ["post_reactions_by_type_total"] }, credential)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects over 1000 datapoints and over 1MiB even in ignored metadata", async () => {
    for (const body of [{ data: [{ ...datum(), values: Array.from({ length: 1001 }, () => ({ value: 0, end_time: "2026-10-19T07:00:00+0000" })) }] }, { data: [], metadata: "x".repeat(1024 * 1024) }]) {
      await expect(withBody(body).client.query(page, credential)).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it.each([
    [190, 400, false, "token_expired"], [200, 403, false, "permission_required"],
    [4, 400, false, "rate_limited"], [17, 400, false, "rate_limited"],
    [32, 400, false, "rate_limited"], [613, 400, false, "rate_limited"],
    [80001, 400, false, "rate_limited"],
    [999, 429, false, "rate_limited"], [100, 400, false, "invalid_query"],
    [999, 500, true, "provider_unavailable"], [10, 400, false, "provider_unavailable"],
    [190, 200, false, "token_expired"],
  ])("maps Graph %s/HTTP%s safely", async (code, status, is_transient, expected) => {
    const { client } = withBody({ error: { code, is_transient, message: "page-secret-canary proof-canary", error_user_title: "secret", fbtrace_id: "secret" } }, status);
    const error = await client.query(page, credential).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MetaInsightsClientError);
    expect(error).toMatchObject({ code: expected });
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(String(error)).not.toContain("canary");
    expect(error).not.toHaveProperty("cause");
  });

  it("blocks default transport without touching global fetch", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(new FacebookInsightsClient({ now }).query(page, credential)).rejects.toMatchObject({ code: "transport_blocked" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sanitizes synchronous and asynchronous transport failures", async () => {
    for (const transport of [() => { throw new Error("page-secret-canary"); }, async () => { throw new Error("proof-canary"); }]) {
      const error = await new FacebookInsightsClient({ transport, now }).query(page, credential).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "provider_unavailable" });
      expect(String(error)).not.toContain("canary");
      expect(error).not.toHaveProperty("cause");
    }
  });

  it("settles an uncooperative pending fake at the 10-second default timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const transport: InsightsTransport = (_descriptor, _credential, observedSignal) => { signal = observedSignal; return new Promise(() => {}); };
    const pending = new FacebookInsightsClient({ transport, now }).query(page, credential);
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(9999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a pending fake and does not send a pre-aborted request", async () => {
    const transport = vi.fn<InsightsTransport>(() => new Promise(() => {}));
    const client = new FacebookInsightsClient({ transport, now });
    const controller = new AbortController();
    const pending = client.query(page, credential, { signal: controller.signal });
    controller.abort("secret-reason");
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(transport.mock.calls[0]?.[2].aborted).toBe(true);
    transport.mockClear();
    await expect(client.query(page, credential, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("isolates simultaneous credentials and descriptor snapshots with reversed completion", async () => {
    const calls: { descriptor: InsightsRequestDescriptor; credential: InsightsCredential; resolve: (value: { status: number; body: unknown }) => void }[] = [];
    const transport: InsightsTransport = (descriptor, privateCredential) => new Promise((resolve) => calls.push({ descriptor, credential: privateCredential, resolve }));
    const client = new FacebookInsightsClient({ transport, now });
    const a = client.query(page, credential);
    const b = client.query({ ...page, objectId: "999" }, { ...credential, accessToken: "second-canary" });
    expect(calls.map((call) => [call.descriptor.objectId, call.credential.accessToken])).toEqual([["123456", "page-secret-canary"], ["999", "second-canary"]]);
    calls[1].resolve({ status: 200, body: { data: [datum("page_media_view", "day", 2)] } });
    calls[0].resolve({ status: 200, body: { data: [datum("page_media_view", "day", 1)] } });
    expect((await a).metrics[0].points[0].value).toBe(1);
    expect((await b).metrics[0].points[0].value).toBe(2);
  });

  it("does not allow per-call extras to replace the configured blocked transport", async () => {
    const injected = vi.fn<InsightsTransport>().mockResolvedValue({ status: 200, body: { data: [] } });
    await expect(new FacebookInsightsClient({ now }).query(page, credential, { transport: injected } as { signal?: AbortSignal })).rejects.toMatchObject({ code: "transport_blocked" });
    expect(injected).not.toHaveBeenCalled();
  });
});
