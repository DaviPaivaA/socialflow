import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpMetaPublishingClient, MetaPublishingClientError } from "../src/metaPublishingClient.ts";
import type { EnabledMetaOAuthConfig } from "../src/metaOAuthClient.ts";

const config: EnabledMetaOAuthConfig = {
  appId: "123456789", appSecret: "secret", enabled: true,
  graphApiVersion: "v26.0", redirectUri: "http://localhost/auth/meta/callback", stateTtlSeconds: 600,
};
const input = { accessToken: "page-token", pageId: "123", message: "Olá & café + 🌎\nsegunda linha" };
afterEach(async () => {
  vi.useRealTimers();
});

describe("HttpMetaPublishingClient errors", () => {
  it.each([
    { code: 200, status: 403, kind: "meta_permission_denied" },
    { code: 10, status: 400, kind: "meta_permission_denied" },
    { code: 299, status: 400, kind: "meta_permission_denied" },
    { code: "283", status: 400, kind: "meta_permission_denied" },
    { code: 190, status: 400, kind: "meta_token_invalid" },
    { code: 102, status: 400, kind: "meta_token_invalid" },
    { code: 4, status: 400, kind: "meta_rate_limited" },
    { code: 17, status: 400, kind: "meta_rate_limited" },
    { code: 100, status: 400, kind: "meta_invalid_request" },
    { code: 324, status: 400, kind: "meta_invalid_request" },
    { code: undefined, status: 401, kind: "meta_token_invalid" },
    { code: undefined, status: 403, kind: "meta_permission_denied" },
    { code: undefined, status: 404, kind: "meta_page_unavailable" },
    { code: undefined, status: 429, kind: "meta_rate_limited" },
    { code: undefined, status: 400, kind: "meta_invalid_request" },
    { code: 2, status: 503, kind: "meta_provider_error" },
    { code: 999999, status: 400, kind: "meta_provider_error" },
    { code: 190, status: 200, kind: "meta_token_invalid" },
  ])("normalizes $status / $code to $kind without leaking raw provider data", async ({ code, status, kind }) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      error: { code, message: `RAW_PROVIDER_MESSAGE ${input.accessToken} /private/media/secret.png`, error_user_msg: input.accessToken },
    }, { status }));
    const error = await new HttpMetaPublishingClient(config, { fetchImpl }).publishText(input).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(MetaPublishingClientError);
    expect(error).toMatchObject({ kind, requestName: "publish_text", status, graphCode: code === undefined ? undefined : String(code) });
    const failure = error as MetaPublishingClientError;
    const loggerPayload = { event: "publication_failed", kind: failure.kind, requestName: failure.requestName, status: failure.status, graphCode: failure.graphCode };
    for (const serialized of [failure.message, JSON.stringify(failure), JSON.stringify(loggerPayload)]) {
      expect(serialized).not.toContain(input.accessToken);
      expect(serialized).not.toContain("RAW_PROVIDER_MESSAGE");
      expect(serialized).not.toContain("/private/media");
    }
    expect(failure.cause).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([input.accessToken, "x".repeat(1000), { secret: input.accessToken }])("does not echo unsafe error codes %j", async (code) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code, message: input.accessToken } }, { status: 400 }));
    const error = await new HttpMetaPublishingClient(config, { fetchImpl }).publishText(input).catch((error: unknown) => error);
    expect(error).toMatchObject({ graphCode: undefined });
    expect(JSON.stringify(error)).not.toContain(input.accessToken);
  });

  it.each(["<html>page-token</html>", "{broken-json", ""])("sanitizes non-JSON success body %j", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishText(input)).rejects.toMatchObject({ kind: "invalid_response", status: 200 });
  });

  it.each([{ status: 503, kind: "meta_provider_error" }, { status: 429, kind: "meta_rate_limited" }])("classifies non-JSON HTTP $status without exposing body", async ({ status, kind }) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(input.accessToken, { status }));
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishText(input)).rejects.toMatchObject({ kind, status });
  });

  it("does not accept success identifiers alongside a malformed provider error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "123_456", error: { message: input.accessToken } }));
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishText(input)).rejects.toMatchObject({ kind: "meta_provider_error" });
  });

  it("normalizes a transport failure without retry or unsafe cause", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error(`network ${input.accessToken} /private/local.png`));
    const error = await new HttpMetaPublishingClient(config, { fetchImpl }).publishText(input).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: "meta_provider_error", requestName: "publish_text" });
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error) + (error as Error).message).not.toContain(input.accessToken);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["fetch", "body"])("aborts a stalled %s and normalizes timeout with no retry", async (phase) => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const stall = () => new Promise<never>((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(new Error(input.accessToken)), { once: true });
      });
      if (phase === "fetch") return stall();
      return { status: 200, ok: true, json: stall } as Response;
    });
    const pending = new HttpMetaPublishingClient(config, { fetchImpl, timeoutMs: 10 }).publishText(input).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ kind: "meta_timeout", requestName: "publish_text" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, 60_001, Number.NaN, 1.5])("rejects an invalid timeout %s", (timeoutMs) => {
    expect(() => new HttpMetaPublishingClient(config, { timeoutMs })).toThrow();
  });

  it.each(["", "x".repeat(8_193)])("rejects invalid tokens before dispatch", async (accessToken) => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishText({ ...input, accessToken })).rejects.toMatchObject({ kind: "meta_token_invalid" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function photoSource(mimeType = "image/png", bytes: Uint8Array<ArrayBuffer> = new Uint8Array([137, 80, 78, 71, 0, 255])) {
  return new Blob([bytes], { type: mimeType });
}

describe("HttpMetaPublishingClient text", () => {
  it("publishes encoded text to versioned feed with credentials only in POST body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "123_456" }));
    const client = new HttpMetaPublishingClient(config, { fetchImpl });
    await expect(client.publishText(input)).resolves.toEqual({ providerPostId: "123_456" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v26.0/123/feed");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.body).toBeInstanceOf(URLSearchParams);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("message")).toBe(input.message);
    expect(body.get("access_token")).toBe("page-token");
    expect(body.get("appsecret_proof")).toBe("58c48136d9507c3c8f5112ca4b42928f913c3338700a30bf9a6626368ff7748b");
    expect([...body.keys()].sort()).toEqual(["access_token", "appsecret_proof", "message"]);
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded");
  });

  it.each([{}, null, [], { id: "" }, { id: 123 }, { id: "raw-secret" }])("rejects malformed success %j", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body));
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishText(input)).rejects.toMatchObject({
      name: "MetaPublishingClientError", kind: "invalid_response", requestName: "publish_text",
    });
  });

  it("does not allow Page IDs to change the request path or URL query", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishText({ ...input, pageId: "123/feed?access_token=leak" })).rejects.toBeInstanceOf(MetaPublishingClientError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("HttpMetaPublishingClient photo", () => {
  it.each(["image/png", "image/jpeg"])("uploads a local %s file as source, using caption and the post_id, not photo id", async (mimeType) => {
    const source = photoSource(mimeType);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "999", post_id: "123_456" }));
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishPhoto({ ...input, source, mimeType })).resolves.toEqual({ providerPostId: "123_456" });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://graph.facebook.com/v26.0/123/photos");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
    const body = init!.body as FormData;
    expect([...body.keys()].sort()).toEqual(["access_token", "appsecret_proof", "caption", "source"]);
    expect(body.get("caption")).toBe(input.message);
    expect(body.get("access_token")).toBe(input.accessToken);
    expect(body.get("appsecret_proof")).toBe("58c48136d9507c3c8f5112ca4b42928f913c3338700a30bf9a6626368ff7748b");
    const uploaded = body.get("source") as File;
    expect(uploaded).toBeInstanceOf(Blob);
    expect(uploaded.type).toBe(mimeType);
    expect(uploaded.name).not.toContain("tenant-private-name");
    expect(new Uint8Array(await uploaded.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 0, 255]));
  });

  it("rejects a photo-only id instead of reporting a Page publication", async () => {
    const source = photoSource();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "999" }));
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishPhoto({ ...input, source, mimeType: "image/png" })).rejects.toMatchObject({ kind: "invalid_response", requestName: "publish_photo" });
  });

  it("normalizes absent snapshot without leaking token", async () => {
    const source = undefined as unknown as Blob;
    const filePath = "/private/tenant/sensitive-file.png";
    const fetchImpl = vi.fn<typeof fetch>();
    const error = await new HttpMetaPublishingClient(config, { fetchImpl }).publishPhoto({ ...input, source, mimeType: "image/png" }).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: "media_unavailable", requestName: "publish_photo" });
    const publicError = error as Error;
    expect(publicError.message + JSON.stringify(error)).not.toContain(filePath);
    expect(publicError.message + JSON.stringify(error)).not.toContain(input.accessToken);
    expect(publicError.cause).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(["image/webp", "video/mp4"])("rejects unsupported %s before fetching", async (mimeType) => {
    const source = photoSource();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishPhoto({ ...input, source, mimeType })).rejects.toMatchObject({ kind: "meta_invalid_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects photos exceeding the verified 4 MB limit before fetching", async () => {
    const source = photoSource("image/png", new Uint8Array(4_000_001));
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).publishPhoto({ ...input, source, mimeType: "image/png" })).rejects.toMatchObject({ kind: "meta_invalid_request" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
