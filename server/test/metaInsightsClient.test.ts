import { afterEach, describe, expect, it, vi } from "vitest";
import { createInsightsRequestDescriptor, executeInsightsRequest, MetaInsightsClientError, type InsightsCredential, type InsightsRequestInput, type InsightsTransport } from "../src/metaInsightsClient.ts";

const credential: InsightsCredential = { tokenKind: "page", accessToken: "secret-canary", expiresAt: null, grantedScopes: ["read_insights", "pages_read_engagement", "pages_show_list"], tasks: ["ANALYZE"] };
const page: InsightsRequestInput = { scope: "facebook_page", objectId: "123", graphApiVersion: "v26.0", period: "day", metrics: ["page_media_view"] };
const user: InsightsCredential = { ...credential, tokenKind: "user", grantedScopes: ["instagram_basic", "instagram_manage_insights", "pages_read_engagement", "pages_show_list"], tasks: [] };
const account: InsightsRequestInput = { scope: "instagram_account", objectId: "123", graphApiVersion: "v26.0", period: "day", metrics: ["reach"], metricType: "time_series" };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("shared Insights internal core", () => {
  // Catches a provider-specific limit disappearing when Task3 reuses the core.
  it("enforces 1000 datapoints across metrics in the core", async () => {
    const transport: InsightsTransport = async () => ({ status: 200, body: { data: [{ name: "reach", values: Array.from({ length: 501 }, () => ({ value: 1 })) }, { name: "views", values: Array.from({ length: 500 }, () => ({ value: 2 })) }] } });
    await expect(executeInsightsRequest(account, user, { transport })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects oversized UTF-8 bodies, not merely character counts", async () => {
    const transport: InsightsTransport = async () => ({ status: 200, body: { data: [], extra: "界".repeat(400_000) } });
    await expect(executeInsightsRequest(page, credential, { transport })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([0, -1, 10_001, Infinity, 1.5])("rejects unbounded/invalid timeout %s before calling transport", async (timeoutMs) => {
    const transport = vi.fn<InsightsTransport>();
    await expect(executeInsightsRequest(page, credential, { transport, timeoutMs })).rejects.toMatchObject({ code: "invalid_query" });
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    [301, { data: [] }, "provider_unavailable"],
    [401, { data: [] }, "provider_unavailable"],
    [503, { data: [] }, "provider_unavailable"],
    [429, { data: [] }, "rate_limited"],
    [200, { error: "secret-canary" }, "provider_unavailable"],
    [200, undefined, "invalid_response"],
    [0, { data: [] }, "invalid_response"],
    [200.5, { data: [] }, "invalid_response"],
    [600, { data: [] }, "invalid_response"],
  ])("validates HTTP status %s independently from the adapter", async (status, body, code) => {
    await expect(executeInsightsRequest(page, credential, { transport: async () => ({ status, body }) })).rejects.toMatchObject({ code });
  });

  it("does not reuse an injected error instance or expose its secrets", async () => {
    const hostile = Object.assign(new MetaInsightsClientError("token_expired"), { message: "secret-canary", cause: "proof-canary" });
    const error = await executeInsightsRequest(page, credential, { transport: async () => { throw hostile; } }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "provider_unavailable" });
    expect(error).not.toBe(hostile);
    expect(String(error)).not.toContain("canary");
    expect(error).not.toHaveProperty("cause");
  });

  it("keeps unknown constructor codes out of diagnostics", () => {
    const error = new MetaInsightsClientError("secret-canary" as "invalid_query");
    expect(error.code).toBe("provider_unavailable");
    expect(String(error)).not.toContain("canary");
  });

  it("captures a private frozen credential without forwarding extra fields", async () => {
    const transport = vi.fn<InsightsTransport>().mockResolvedValue({ status: 200, body: { data: [] } });
    const mutable = { ...credential, grantedScopes: [...credential.grantedScopes], tasks: [...credential.tasks], appSecret: "unrelated-secret" };
    const pending = executeInsightsRequest(page, mutable, { transport });
    mutable.accessToken = "changed-secret"; mutable.grantedScopes.length = 0;
    await pending;
    const captured = transport.mock.calls[0][1];
    expect(captured.accessToken).toBe("secret-canary");
    expect(captured.grantedScopes).toEqual(["read_insights", "pages_read_engagement", "pages_show_list"]);
    expect(captured).not.toHaveProperty("appSecret");
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.grantedScopes)).toBe(true);
  });

  it("removes the abort listener and timer after successful completion", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await executeInsightsRequest(page, credential, { transport: async () => ({ status: 200, body: { data: [] } }), signal: controller.signal });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("applies a shorter configured timeout without relying on transport abort support", async () => {
    vi.useFakeTimers();
    const pending = executeInsightsRequest(page, credential, { transport: () => new Promise(() => {}), timeoutMs: 20 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("offers a constrained IG descriptor seam with explicit User credential", async () => {
    const transport = vi.fn<InsightsTransport>().mockResolvedValue({ status: 200, body: { data: [] } });
    await expect(executeInsightsRequest(account, user, { transport })).resolves.toEqual({ data: [] });
    expect(transport.mock.calls[0][0].parameters).toEqual({ metric: "reach", period: "day", metric_type: "time_series" });
    await expect(executeInsightsRequest(account, credential, { transport })).rejects.toMatchObject({ code: "permission_required" });
    expect(transport).toHaveBeenCalledTimes(1);
    const media = createInsightsRequestDescriptor({ scope: "instagram_media", objectId: "999", graphApiVersion: "v26.0", period: "lifetime", metrics: ["views", "reach"] });
    expect(media.parameters).toEqual({ metric: "views,reach" });
  });

  it.each([
    { metricType: undefined }, { metricType: "unproven" }, { metrics: ["views"] },
    { period: "week" }, { objectId: "123_456" }, { graphApiVersion: "v27.0" },
    { metric_type: "time_series" }, { appsecret_proof: "secret" },
    { host: "evil.example" }, { objectId: "https://evil.example" },
  ])("rejects invalid descriptor input %#", async (change) => {
    const transport = vi.fn<InsightsTransport>();
    await expect(executeInsightsRequest({ ...account, ...change } as InsightsRequestInput, user, { transport })).rejects.toMatchObject({ code: "invalid_query" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("has no default network for either credential kind", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(executeInsightsRequest(account, user)).rejects.toMatchObject({ code: "transport_blocked" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Graph error 80001 regression", () => {
  it.each([4, 17, 32, 613, 80001])("classifies structured numeric Graph code %i as rate limited", async code => {
    const transport = vi.fn<InsightsTransport>(async () => ({ status: 400, body: { error: { code } } }));
    await expect(executeInsightsRequest(page, credential, { transport })).rejects.toMatchObject({ code: "rate_limited" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "missing code", body: { error: {} } },
    { name: "null code", body: { error: { code: null } } },
    { name: "string code", body: { error: { code: "80001" } } },
    { name: "array code", body: { error: { code: [80001] } } },
    { name: "object code", body: { error: { code: { value: 80001 } } } },
    { name: "boolean code", body: { error: { code: true } } },
    { name: "fractional code", body: { error: { code: 80001.5 } } },
    { name: "adjacent out-of-scope code", body: { error: { code: 80002 } } },
    { name: "top-level code", body: { code: 80001 } },
    { name: "message fragment", body: { error: { message: "Graph 80001" } } },
    { name: "subcode", body: { error: { error_subcode: 80001 } } },
    { name: "nested details", body: { error: { details: { code: 80001 } } } },
    { name: "string error", body: { error: "80001" } },
    { name: "unparsed malformed JSON string", body: '{"error":{"code":80001' },
  ])("does not infer throttling from $name", async ({ body }) => {
    await expect(executeInsightsRequest(page, credential, {
      transport: async () => ({ status: 400, body }),
    })).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it.each([
    [500, { error: { is_transient: true } }, "provider_unavailable"],
    [400, { error: { code: 190, message: "80001" } }, "token_expired"],
    [403, { error: { code: 200, error_subcode: 80001 } }, "permission_required"],
    [400, { error: { code: 100, message: "80001" } }, "invalid_query"],
    [429, { error: { code: "80001" } }, "rate_limited"],
  ] as const)("preserves the existing classification for HTTP %s %#", async (status, body, code) => {
    await expect(executeInsightsRequest(page, credential, {
      transport: async () => ({ status, body }),
    })).rejects.toMatchObject({ code });
  });

  it("does not retry Graph 80001 or retain a retry timer", async () => {
    vi.useFakeTimers();
    const transport = vi.fn<InsightsTransport>(async () => ({ status: 400, body: { error: { code: 80001 } } }));
    await expect(executeInsightsRequest(page, credential, { transport })).rejects.toMatchObject({ code: "rate_limited" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sanitizes Graph 80001 without exposing token or proof in errors or logs", async () => {
    const logs = (["debug", "error", "info", "log", "warn"] as const)
      .map(method => vi.spyOn(console, method).mockImplementation(() => {}));
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    try {
      const error = await executeInsightsRequest(page, credential, {
        transport: async () => ({ status: 400, body: { error: {
          code: 80001, message: "secret-canary proof-canary", fbtrace_id: "proof-canary",
        } } }),
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MetaInsightsClientError);
      expect(error).toMatchObject({ code: "rate_limited" });
      expect(String(error) + JSON.stringify(error)).not.toContain("canary");
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(logs.flatMap(log => log.mock.calls))).not.toContain("canary");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      logs.forEach(log => log.mockRestore());
    }
  });
});
