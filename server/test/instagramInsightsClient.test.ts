import { afterEach, describe, expect, it, vi } from "vitest";
import { InstagramInsightsClient, type InstagramInsightsQuery } from "../src/instagramInsightsClient.ts";
import { MetaInsightsClientError, type InsightsCredential, type InsightsRequestDescriptor, type InsightsTransport } from "../src/metaInsightsClient.ts";
import { isInsightsResponse } from "../../shared/insightsContract.ts";

const now = () => Date.parse("2026-10-20T12:00:00.000Z");
const credential: InsightsCredential = { tokenKind: "user", accessToken: "ig-secret-canary", expiresAt: null, grantedScopes: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"], tasks: [] };
const account: InstagramInsightsQuery = { scope: "instagram_account", objectId: "123456", graphApiVersion: "v26.0", period: "day", metrics: ["views"], metricType: "total_value" };
const media: InstagramInsightsQuery = { scope: "instagram_media", objectId: "789", graphApiVersion: "v26.0", period: "lifetime", metrics: ["views"], expectedAccountId: "123456", subject: { mediaId: "789", ownerAccountId: "123456", mediaType: "IMAGE", mediaProductType: "FEED", formatVerified: true, isAlbumChild: false }, topLevelEvidence: { mediaId: "789", accountId: "123456", isTopLevel: true } };
const total = (name = "views", value: unknown = 0) => ({ name, period: "day", title: "Provider title", description: "Provider description", id: `123456/insights/${name}/day`, total_value: { value } });
const series = (name = "reach", period = "day", values: unknown = [{ value: 0, end_time: "2026-10-19T07:00:00+0000" }]) => ({ name, period, title: "Provider title", description: "Provider description", id: `123456/insights/${name}/${period}`, values });
const reach: InstagramInsightsQuery = { ...account, metrics: ["reach"], metricType: "time_series" };
function withBody(body: unknown, status = 200) {
  const transport = vi.fn<InsightsTransport>().mockResolvedValue({ status, body });
  return { client: new InstagramInsightsClient({ transport, now }), transport };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("local Instagram Insights", () => {
  // Missing query gates would allow forbidden combinations or arbitrary hosts onto the transport.
  it.each([
    { metrics: ["profile_views"] }, { metrics: ["impressions"] }, { metrics: ["likes"] }, { metrics: ["saved"] },
    { metrics: [] }, { metrics: ["views", "views"] }, { period: "week" }, { period: "days_28" }, { period: "lifetime" },
    { metricType: undefined }, { metricType: "total_values" }, { metricType: "time_series" },
    { graphApiVersion: "v25.0" }, { objectId: "https://graph.facebook.com/123" }, { objectId: "../123" }, { objectId: "123_456" }, { objectId: "1?access_token=secret" }, { objectId: "9".repeat(33) },
    { host: "evil.example" }, { breakdown: "media_product_type" }, { access_token: "secret" },
    { since: 100 }, { since: 100, until: 99 }, { since: "100", until: 101 },
    { since: now() / 1000 - 90 * 86400 - 1, until: now() / 1000 },
    { since: now() / 1000 - 86400, until: now() / 1000 + 1 },
    { since: now() / 1000 - 365 * 86400, until: now() / 1000 - 364 * 86400 },
  ])("rejects invalid account query %# before transport", async (changes) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query({ ...account, ...changes } as InstagramInsightsQuery, credential)).rejects.toMatchObject({ code: "invalid_query" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["views", "reach", "accounts_engaged", "total_interactions"] as const)("projects %s total_value preserving zero", async (name) => {
    const { client } = withBody({ data: [total(name)], secret: "ig-secret-canary", paging: { next: "https://evil/?access_token=secret" } });
    const result = await client.query({ ...account, metrics: [name] }, credential);
    expect(result).toEqual({ scope: "instagram_account", period: "day", graphApiVersion: "v26.0", fetchedAt: "2026-10-20T12:00:00.000Z", metrics: [{ name, status: "available", points: [{ value: 0, endTime: null }] }] });
    expect(isInsightsResponse(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("uses UTC seconds and accepts precisely the 90-day retention boundary", async () => {
    const { client, transport } = withBody({ data: [total()] });
    await client.query({ ...account, since: now() / 1000 - 90 * 86400, until: now() / 1000 }, credential);
    const [descriptor, privateCredential, signal] = transport.mock.calls[0];
    expect(descriptor).toEqual({ host: "graph.facebook.com", graphApiVersion: "v26.0", method: "GET", objectId: "123456", edge: "insights", scope: "instagram_account", parameters: { metric: "views", period: "day", metric_type: "total_value", since: 1784721600, until: 1792497600 } });
    expect(Object.isFrozen(descriptor.parameters)).toBe(true);
    expect(privateCredential).toEqual(credential);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(descriptor)).not.toContain("secret");
  });

  it("preserves reach series timestamps and independent values without summing unique counts", async () => {
    const { client, transport } = withBody({ data: [series("reach", "day", [{ value: 0, end_time: "2026-10-19T10:00:00-03:00" }, { value: 7, end_time: "2026-10-19T14:00:00+0000" }])] });
    expect((await client.query(reach, credential)).metrics).toEqual([{ name: "reach", status: "available", points: [{ value: 0, endTime: "2026-10-19T10:00:00-03:00" }, { value: 7, endTime: "2026-10-19T14:00:00+0000" }] }]);
    expect(transport.mock.calls[0][0].parameters).toEqual({ metric: "reach", period: "day", metric_type: "time_series" });
  });

  it.each([
    ["IMAGE", "FEED"], ["VIDEO", "FEED"], ["CAROUSEL_ALBUM", "FEED"], ["VIDEO", "REELS"],
  ] as const)("accepts an internally proven %s/%s and omits period on wire", async (mediaType, mediaProductType) => {
    const { client, transport } = withBody({ data: [series("views", "lifetime", [{ value: 0 }])] });
    const result = await client.query({ ...media, subject: { ...media.subject, mediaType, mediaProductType } }, credential);
    expect(result.metrics).toEqual([{ name: "views", status: "available", points: [{ value: 0, endTime: null }] }]);
    expect(transport.mock.calls[0][0]).toEqual({ host: "graph.facebook.com", graphApiVersion: "v26.0", method: "GET", objectId: "789", edge: "insights", scope: "instagram_media", parameters: { metric: "views" } });
  });

  it.each(["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"] as const)("accepts selected lifetime media metric %s", async (name) => {
    const { client } = withBody({ data: [series(name, "lifetime", [{ value: 2 }])] });
    expect((await client.query({ ...media, metrics: [name] }, credential)).metrics).toEqual([{ name, status: "available", points: [{ value: 2, endTime: null }] }]);
  });

  it.each([
    { subject: undefined }, { expectedAccountId: undefined }, { expectedAccountId: "999" }, { expectedAccountId: "../123" },
    { subject: { ...media.subject, ownerAccountId: "999" } }, { subject: { ...media.subject, mediaId: "999" } },
    { subject: { ...media.subject, formatVerified: false } }, { subject: { ...media.subject, formatVerified: undefined } },
    { subject: { ...media.subject, isAlbumChild: true } }, { subject: { ...media.subject, isAlbumChild: undefined } },
    { subject: { ...media.subject, mediaType: "STORY" } }, { subject: { ...media.subject, mediaProductType: "STORY" } },
    { subject: { ...media.subject, mediaProductType: "REELS" } },
    { subject: { ...media.subject, mediaType: "CAROUSEL_ALBUM", mediaProductType: "REELS" } },
    { topLevelEvidence: undefined }, { topLevelEvidence: { ...media.topLevelEvidence, isTopLevel: false } },
    { topLevelEvidence: { ...media.topLevelEvidence, mediaId: "999" } }, { topLevelEvidence: { ...media.topLevelEvidence, accountId: "999" } },
    { objectId: "999" },
  ])("blocks absent, mismatched or ineligible media proof %#", async (changes) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query({ ...media, ...changes } as InstagramInsightsQuery, credential)).rejects.toMatchObject({ code: "unsupported_object" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { period: "day" }, { metrics: ["accounts_engaged"] }, { metrics: ["profile_views"] }, { metrics: ["saves"] },
    { metrics: ["views", "reach", "likes", "comments", "saved"] }, { metricType: "total_value" }, { since: 10, until: 20 },
  ])("rejects invalid media selection %#", async (changes) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query({ ...media, ...changes } as InstagramInsightsQuery, credential)).rejects.toMatchObject({ code: "invalid_query" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    { tokenKind: "page" }, { accessToken: "" },
    ...credential.grantedScopes.map((missing) => ({ grantedScopes: credential.grantedScopes.filter((scope) => scope !== missing) })),
  ])("requires actual user credential and every IG grant %#", async (changes) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query(account, { ...credential, ...changes } as InsightsCredential)).rejects.toMatchObject({ code: "permission_required" });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["invalid", "2026-10-20T12:00:00.000Z"])("rejects expired/invalid expiry %s", async (expiresAt) => {
    const { client, transport } = withBody({ data: [] });
    await expect(client.query(account, { ...credential, expiresAt })).rejects.toMatchObject({ code: "token_expired" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([account, reach, media])("preserves missing metrics as explicit absence in $scope", async (query) => {
    expect((await withBody({ data: [] }).client.query(query, credential)).metrics).toEqual([{ name: query.metrics[0], status: "not_available", points: [{ value: null, endTime: null }] }]);
  });
  it.each([reach, media])("preserves empty values as absence in $scope", async (query) => {
    expect((await withBody({ data: [series(query.metrics[0], query.period, [])] }).client.query(query, credential)).metrics[0]).toMatchObject({ status: "not_available", points: [{ value: null, endTime: null }] });
  });
  it("preserves request order, partial data and zero without filling missing metrics", async () => {
    const { client } = withBody({ data: [total()] });
    expect((await client.query({ ...account, metrics: ["reach", "views"] }, credential)).metrics).toEqual([
      { name: "reach", status: "not_available", points: [{ value: null, endTime: null }] },
      { name: "views", status: "available", points: [{ value: 0, endTime: null }] },
    ]);
  });

  // Wrong shape/period/count must reject the entire response, not turn corruption into absence.
  it.each([
    null, {}, { data: null }, { data: {} }, { data: [null] }, { data: [total(), total()] },
    { data: [total("unknown")] }, { data: [{ ...total(), period: "lifetime" }] },
    { data: [{ ...total(), total_value: undefined }] }, { data: [{ ...total(), total_value: null }] },
    { data: [{ ...total(), total_value: {} }] }, { data: [{ ...total(), total_value: { value: 0, breakdowns: [] } }] },
    { data: [{ ...total(), values: [] }] }, { data: [series("views")] },
    ...[null, "0", -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, true, {}].map((value) => ({ data: [total("views", value)] })),
  ])("rejects malformed account totals %#", async (body) => {
    await expect(withBody(body).client.query(account, credential)).rejects.toMatchObject({ code: "invalid_response" });
  });
  it.each([
    { data: [total("reach")] }, { data: [series("reach", "week")] }, { data: [series("reach", "day", {})] },
    { data: [series("reach", "day", [null])] }, { data: [series("reach", "day", [{ value: null, end_time: "2026-10-19T07:00:00Z" }])] },
    ...[undefined, null, "not-date", "2026-02-30T07:00:00Z", "2026-10-19", "2026-10-19T07:00:00+9999"].map((end_time) => ({ data: [series("reach", "day", [{ value: 0, end_time }])] })),
    ...[["2026-10-19T07:00:00+0000", "2026-10-19T07:00:00Z"], ["2026-10-19T10:00:00-03:00", "2026-10-19T13:00:00Z"]].map(([first, second]) => ({ data: [series("reach", "day", [{ value: 0, end_time: first }, { value: 2, end_time: second }])] })),
  ])("rejects malformed/duplicate-instant reach series %#", async (body) => {
    await expect(withBody(body).client.query(reach, credential)).rejects.toMatchObject({ code: "invalid_response" });
  });
  it.each([
    { data: [series("views", "day")] }, { data: [{ ...series("views", "lifetime"), total_value: { value: 0 } }] },
    { data: [series("views", "lifetime", [{ value: "0" }])] }, { data: [series("views", "lifetime", [{ value: 0 }, { value: 1 }])] },
  ])("rejects malformed media response %#", async (body) => {
    await expect(withBody(body).client.query(media, credential)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([[190, 400, "token_expired"], [10, 400, "provider_unavailable"], [999, 429, "rate_limited"], [80001, 400, "rate_limited"], [100, 400, "invalid_query"], [200, 403, "permission_required"]])("maps Graph %s/HTTP %s without original secrets", async (code, status, expected) => {
    const error = await withBody({ error: { code, message: "ig-secret-canary proof-canary", fbtrace_id: "secret" } }, Number(status)).client.query(account, credential).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MetaInsightsClientError);
    expect(error).toMatchObject({ code: expected });
    expect(String(error)).not.toContain("canary");
    expect(JSON.stringify(error)).not.toContain("secret");
    expect(error).not.toHaveProperty("cause");
  });

  it("does not use global fetch or per-call transport injection", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const injected = vi.fn<InsightsTransport>().mockResolvedValue({ status: 200, body: { data: [] } });
    await expect(new InstagramInsightsClient({ now }).query(account, credential, { transport: injected } as { signal?: AbortSignal })).rejects.toMatchObject({ code: "transport_blocked" });
    expect(fetch).not.toHaveBeenCalled(); expect(injected).not.toHaveBeenCalled();
  });
  it("sanitizes synchronous and asynchronous fake transport failures", async () => {
    for (const transport of [() => { throw new Error("ig-secret-canary"); }, async () => { throw new Error("proof-canary"); }]) {
      const error = await new InstagramInsightsClient({ transport, now }).query(account, credential).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "provider_unavailable" });
      expect(String(error)).not.toContain("canary"); expect(error).not.toHaveProperty("cause");
    }
  });
  it("settles an uncooperative fake at default timeout and cancels its signal", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const transport: InsightsTransport = (_descriptor, _credential, observed) => { signal = observed; return new Promise(() => {}); };
    const pending = new InstagramInsightsClient({ transport, now }).query(account, credential);
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(9999); expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); await assertion;
    expect(signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a pending request and never sends an already aborted request", async () => {
    const transport = vi.fn<InsightsTransport>(() => new Promise(() => {}));
    const client = new InstagramInsightsClient({ transport, now });
    const controller = new AbortController();
    const pending = client.query(account, credential, { signal: controller.signal }); controller.abort("secret-reason");
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(transport.mock.calls[0]?.[2].aborted).toBe(true); transport.mockClear();
    await expect(client.query(account, credential, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("keeps frozen inputs and concurrent credential/selection snapshots isolated with reversed completion", async () => {
    const calls: { descriptor: InsightsRequestDescriptor; credential: InsightsCredential; resolve: (value: { status: number; body: unknown }) => void }[] = [];
    const transport: InsightsTransport = (descriptor, privateCredential) => new Promise((resolve) => calls.push({ descriptor, credential: privateCredential, resolve }));
    const client = new InstagramInsightsClient({ transport, now });
    const mutable = { ...account, metrics: ["views"] } as InstagramInsightsQuery;
    const mutableCredential = { ...credential, grantedScopes: [...credential.grantedScopes] };
    const a = client.query(mutable, mutableCredential);
    mutable.metrics = ["reach"]; mutableCredential.accessToken = "changed-canary"; mutableCredential.grantedScopes.length = 0;
    const frozen = Object.freeze({ ...account, objectId: "999", metrics: Object.freeze(["views"] as const) });
    const b = client.query(frozen, Object.freeze({ ...credential, accessToken: "second-canary", grantedScopes: Object.freeze([...credential.grantedScopes]) }));
    expect(calls.map((call) => [call.descriptor.objectId, call.descriptor.parameters.metric, call.credential.accessToken])).toEqual([["123456", "views", "ig-secret-canary"], ["999", "views", "second-canary"]]);
    calls[1].resolve({ status: 200, body: { data: [total("views", 2)] } }); calls[0].resolve({ status: 200, body: { data: [total("views", 1)] } });
    expect((await a).metrics).toEqual([{ name: "views", status: "available", points: [{ value: 1, endTime: null }] }]);
    expect((await b).metrics[0].points[0].value).toBe(2);
  });
});
