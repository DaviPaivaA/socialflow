import { Readable } from "node:stream";
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpMetaPublishingClient } from "../src/metaPublishingClient.ts";
import type { EnabledMetaOAuthConfig } from "../src/metaOAuthClient.ts";

const config: EnabledMetaOAuthConfig = {
  appId: "123456789", appSecret: "secret", enabled: true,
  graphApiVersion: "v26.0", redirectUri: "http://localhost/auth/meta/callback", stateTtlSeconds: 600,
};
const operation = { graphApiVersion: "v25.0", accessToken: "private-page-token" };
const caption = "Café & + 🌎\nnext line";
const mediaUrl = "https://delivery.example/meta-media/asset?cap=private-signature";
const proof = createHmac("sha256", "secret").update(operation.accessToken).digest("hex");
const fbStatus = {
  video_status: "ready", uploading_phase: { status: "completed", bytes_transfered: 16 },
  processing_phase: { status: "complete" }, publishing_phase: { status: "not_started" },
};
function setup(body: unknown, status = 200) {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
  return { client: new HttpMetaPublishingClient(config, { fetchImpl }), fetchImpl };
}
function sentForm(fetchImpl: ReturnType<typeof setup>["fetchImpl"]) {
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(init).toMatchObject({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) });
  expect(init!.body).toBeInstanceOf(URLSearchParams);
  expect(new Headers(init!.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
  expect(String(url)).not.toContain(operation.accessToken);
  return { url: String(url), body: Object.fromEntries(new URLSearchParams(String(init!.body))) };
}
afterEach(() => { vi.useRealTimers(); });

describe("Instagram publishing HTTP contracts", () => {
  it.each(["image", "reel"] as const)("creates %s container with operation version, not global version", async kind => {
    const s = setup({ id: "456" });
    await expect(s.client.createInstagramContainer({ ...operation, accountId: "123", caption, media: { kind, url: mediaUrl } })).resolves.toEqual({ containerId: "456" });
    const sent = sentForm(s.fetchImpl);
    expect(sent.url).toBe("https://graph.facebook.com/v25.0/123/media");
    expect(sent.body).toEqual(kind === "image"
      ? { access_token: operation.accessToken, appsecret_proof: proof, caption, image_url: mediaUrl }
      : { access_token: operation.accessToken, appsecret_proof: proof, caption, video_url: mediaUrl, media_type: "REELS", share_to_feed: "true" });
  });
  it.each(["FINISHED", "IN_PROGRESS", "ERROR", "EXPIRED", "PUBLISHED"])("reads one closed-set status %s without polling", async status => {
    const s = setup({ id: "456", status_code: status });
    await expect(s.client.getInstagramContainerStatus({ ...operation, containerId: "456" })).resolves.toEqual({ status });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = s.fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`https://graph.facebook.com/v25.0/456?fields=status_code&appsecret_proof=${proof}`);
    expect(init).toMatchObject({ method: "GET", redirect: "error", signal: expect.any(AbortSignal) });
    expect(new Headers(init!.headers).get("authorization")).toBe(`Bearer ${operation.accessToken}`);
    expect(init!.body).toBeUndefined();
  });
  it("publishes creation_id and returns final media id, never input container id", async () => {
    const s = setup({ id: "789" });
    await expect(s.client.publishInstagramContainer({ ...operation, accountId: "123", containerId: "456" })).resolves.toEqual({ providerPostId: "789" });
    expect(sentForm(s.fetchImpl)).toEqual({ url: "https://graph.facebook.com/v25.0/123/media_publish", body: { access_token: operation.accessToken, appsecret_proof: proof, creation_id: "456" } });
  });
});

describe("Facebook Reel HTTP contracts", () => {
  it.each(["https://rupload.facebook.com/video-upload/456", "https://rupload.facebook.com/video-upload/v25.0/456"])("accepts documented start upload URL %s", async upload_url => {
    const s = setup({ video_id: "456", upload_url });
    await expect(s.client.startFacebookReel({ ...operation, pageId: "123" })).resolves.toEqual({ videoId: "456" });
    expect(sentForm(s.fetchImpl)).toEqual({ url: "https://graph.facebook.com/v25.0/123/video_reels", body: { access_token: operation.accessToken, appsecret_proof: proof, upload_phase: "start" } });
  });
  it("streams local bytes with fixed rupload host, OAuth, offset and size", async () => {
    const source = Readable.from([Buffer.from([0, 1]), Buffer.from([2, 3])]);
    const seen: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      expect(String(url)).toBe("https://rupload.facebook.com/video-upload/v25.0/456");
      expect(init).toMatchObject({ method: "POST", redirect: "error", duplex: "half", signal: expect.any(AbortSignal) });
      expect(Object.fromEntries(new Headers(init!.headers))).toEqual({ accept: "application/json", authorization: "OAuth private-page-token", "content-type": "application/octet-stream", file_size: "4", offset: "0" });
      expect(init!.body).not.toBeInstanceOf(Blob);
      const body = init!.body as unknown as AsyncIterable<Uint8Array>;
      for await (const bytes of body) seen.push(...bytes);
      return Response.json({ success: true });
    });
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).uploadFacebookReel({ ...operation, videoId: "456", source, sizeBytes: 4 })).resolves.toBeUndefined();
    expect(seen).toEqual([0, 1, 2, 3]);
    expect(source.destroyed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("finishes for immediate publication without native scheduling or retries", async () => {
    const s = setup({ success: true });
    await expect(s.client.finishFacebookReel({ ...operation, pageId: "123", videoId: "456", caption })).resolves.toBeUndefined();
    expect(sentForm(s.fetchImpl)).toEqual({ url: "https://graph.facebook.com/v25.0/123/video_reels", body: { access_token: operation.accessToken, appsecret_proof: proof, upload_phase: "finish", video_state: "PUBLISHED", video_id: "456", description: caption } });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("normalizes complete/completed but does not mistake ready for published", async () => {
    const s = setup({ status: fbStatus, id: "456" });
    await expect(s.client.getFacebookReelStatus({ ...operation, videoId: "456" })).resolves.toEqual({ uploadingPhase: "complete", processingPhase: "complete", publishingPhase: "not_started", published: false, uploadedBytes: 16, videoStatus: "ready" });
    const [url, init] = s.fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(`https://graph.facebook.com/v25.0/456?fields=status&appsecret_proof=${proof}`);
    expect(init!.method).toBe("GET");
    expect(new Headers(init!.headers).get("authorization")).toBe(`Bearer ${operation.accessToken}`);
  });
  it.each([
    { publishing: { status: "completed" }, expected: "complete" },
    { publishing: { status: "in_progress", publish_status: "published" }, expected: "in_progress" },
  ])("requires publishing evidence $publishing", async ({ publishing, expected }) => {
    const s = setup({ status: { ...fbStatus, publishing_phase: publishing } });
    await expect(s.client.getFacebookReelStatus({ ...operation, videoId: "456" })).resolves.toMatchObject({ published: true, publishingPhase: expected });
  });
  it("reports documented phase errors without raw messages", async () => {
    const s = setup({ status: { ...fbStatus, processing_phase: { status: "not_started", error: { message: mediaUrl } }, uploading_phase: { status: "complete", errors: [{ message: operation.accessToken }] }, publishing_phase: { status: "not_started", publish_status: "error" } } });
    const result = await s.client.getFacebookReelStatus({ ...operation, videoId: "456" });
    expect(result).toMatchObject({ processingPhase: "error", uploadingPhase: "error", publishingPhase: "error", published: false });
    expect(JSON.stringify(result)).not.toContain(operation.accessToken);
    expect(JSON.stringify(result)).not.toContain(mediaUrl);
  });
});

describe("finite and unambiguous Meta HTTP boundaries", () => {
  it.each([
    "http://rupload.facebook.com/video-upload/456", "https://attacker.example/video-upload/456",
    "https://rupload.facebook.com.evil.example/video-upload/456", "https://rupload.facebook.com:444/video-upload/456",
    "https://user:pass@rupload.facebook.com/video-upload/456", "https://rupload.facebook.com/video-upload/456?leak=x",
    "https://rupload.facebook.com/video-upload/456#fragment", "https://rupload.facebook.com/video-upload/789",
    "https://rupload.facebook.com/video-upload/v26.0/456", "https://rupload.facebook.com/video-upload/456/",
    "https://rupload.facebook.com/video-upload/456?", "https://rupload.facebook.com/video-upload/456#",
    "https://rupload.facebook.com/video-upload/../video-upload/456",
  ])("does not accept forged start authority/path %s", async upload_url => {
    const s = setup({ video_id: "456", upload_url });
    await expect(s.client.startFacebookReel({ ...operation, pageId: "123" })).rejects.toMatchObject({ kind: "invalid_response", outcome: "unknown", requestName: "start_facebook_reel" });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    { status: 400, code: 190, outcome: "rejected", kind: "meta_token_invalid" },
    { status: 400, code: 10, outcome: "rejected", kind: "meta_permission_denied" },
    { status: 403, code: 200, outcome: "rejected", kind: "meta_permission_denied" },
    { status: 429, code: 4, outcome: "rejected", kind: "meta_rate_limited" },
    { status: 400, code: 32, outcome: "rejected", kind: "meta_rate_limited" },
    { status: 400, code: 613, outcome: "rejected", kind: "meta_rate_limited" },
    { status: 400, code: 100, outcome: "rejected", kind: "meta_invalid_request" },
    { status: 400, code: 1363128, outcome: "rejected", kind: "meta_invalid_request" },
    { status: 503, code: 190, outcome: "unknown", kind: "meta_token_invalid" },
    { status: 200, code: 190, outcome: "unknown", kind: "meta_token_invalid" },
    { status: 400, code: 999999, outcome: "unknown", kind: "meta_provider_error" },
    { status: 429, code: undefined, outcome: "unknown", kind: "meta_rate_limited" },
    { status: 403, code: 999999, outcome: "unknown", kind: "meta_permission_denied" },
  ])("mutation distinguishes structured $status/$code as $outcome", async ({ status, code, outcome, kind }) => {
    const s = setup({ error: { code, message: `${operation.accessToken} ${mediaUrl}`, error_user_msg: mediaUrl } }, status);
    const error = await s.client.publishInstagramContainer({ ...operation, accountId: "123", containerId: "456" }).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind, outcome, requestName: "publish_instagram_container", status });
    for (const serialized of [JSON.stringify(error), String(error)]) {
      expect(serialized).not.toContain(operation.accessToken);
      expect(serialized).not.toContain(mediaUrl);
    }
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each(["legacy", "instagram", "facebook"])("non-JSON 2xx %s mutation remains unknown", async method => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret invalid json"));
    const client = new HttpMetaPublishingClient(config, { fetchImpl });
    const pending = method === "legacy" ? client.publishText({ ...operation, pageId: "123", message: caption })
      : method === "instagram" ? client.publishInstagramContainer({ ...operation, accountId: "123", containerId: "456" })
      : client.finishFacebookReel({ ...operation, pageId: "123", videoId: "456", caption });
    await expect(pending).rejects.toMatchObject({ kind: "invalid_response", outcome: "unknown", status: 200 });
  });
  it.each([{}, { id: "456_789" }, { id: 456 }, { id: mediaUrl }])("does not invent container id from malformed response %j", async body => {
    const s = setup(body);
    await expect(s.client.createInstagramContainer({ ...operation, accountId: "123", caption, media: { kind: "image", url: mediaUrl } })).rejects.toMatchObject({ kind: "invalid_response", outcome: "unknown" });
  });
  it.each([{}, { success: false }, { success: "true" }])("requires positive finish acknowledgment %j", async body => {
    const s = setup(body);
    await expect(s.client.finishFacebookReel({ ...operation, pageId: "123", videoId: "456", caption })).rejects.toMatchObject({ kind: "invalid_response", outcome: "unknown" });
  });
  it.each(["UNKNOWN", "finished", 123, undefined])("rejects undocumented Instagram status %s", async status_code => {
    const s = setup({ status_code });
    await expect(s.client.getInstagramContainerStatus({ ...operation, containerId: "456" })).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it.each([
    { ...fbStatus, video_status: "published" }, { ...fbStatus, processing_phase: { status: "finished" } },
    { ...fbStatus, uploading_phase: { status: "complete", bytes_transfered: -1 } },
    { ...fbStatus, uploading_phase: { status: "complete", bytes_transfered: "16" } },
    { ...fbStatus, publishing_phase: { status: "complete", publish_status: "arbitrary" } },
  ])("rejects undocumented/malformed FB status %j", async status => {
    const s = setup({ status });
    await expect(s.client.getFacebookReelStatus({ ...operation, videoId: "456" })).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it.each(["v25.0/path", "v25.0?token=x", "", "not-version"])("rejects operation version path injection %s before network", async graphApiVersion => {
    const s = setup({ id: "456" });
    await expect(s.client.createInstagramContainer({ ...operation, graphApiVersion, accountId: "123", caption, media: { kind: "image", url: mediaUrl } })).rejects.toMatchObject({ outcome: "rejected" });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["../media", "123?token=x", "", "a123"])("rejects numeric ID path injection %s before network", async accountId => {
    const s = setup({ id: "456" });
    await expect(s.client.publishInstagramContainer({ ...operation, accountId, containerId: "456" })).rejects.toMatchObject({ outcome: "rejected" });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { caption: 123, media: { kind: "image", url: mediaUrl } },
    { caption: "a".repeat(2201), media: { kind: "image", url: mediaUrl } },
    { caption, media: { kind: "unknown", url: mediaUrl } },
    { caption, media: { kind: "image", url: "file:///private/media.png" } },
    { caption, media: { kind: "image", url: "https://user:pass@delivery.example/media" } },
  ])("rejects invalid Instagram fields before network %j", async fields => {
    const s = setup({ id: "456" });
    const input = { ...operation, accountId: "123", ...fields };
    // Exercise runtime input validation at the typed/private boundary.
    // @ts-expect-error intentional invalid fields
    await expect(s.client.createInstagramContainer(input)).rejects.toMatchObject({ outcome: "rejected", kind: "meta_invalid_request" });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it.each(["legacy", "instagram"])("limits %s response to 1 MiB and cancels unread body", async method => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1_048_577)); }, cancel,
    }));
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const client = new HttpMetaPublishingClient(config, { fetchImpl });
    const pending = method === "legacy" ? client.publishText({ accessToken: operation.accessToken, pageId: "123", message: caption })
      : client.publishInstagramContainer({ ...operation, accountId: "123", containerId: "456" });
    await expect(pending).rejects.toMatchObject({ kind: "invalid_response", outcome: "unknown" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(["fetch", "body"])("Graph default 10s deadline is finite when %s ignores abort", async phase => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => phase === "fetch"
      ? new Promise<Response>(() => {})
      : new Response(new ReadableStream({ cancel })));
    const pending = new HttpMetaPublishingClient(config, { fetchImpl }).startFacebookReel({ ...operation, pageId: "123" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchImpl.mock.calls[0]![1]!.signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ kind: "meta_timeout", outcome: "unknown" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    if (phase === "body") expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("normalizes transport failures and does not retry", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error(`${operation.accessToken} ${mediaUrl}`));
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).finishFacebookReel({ ...operation, pageId: "123", videoId: "456", caption })).rejects.toMatchObject({ kind: "meta_provider_error", outcome: "unknown" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not infer a definite rejection from a transient structured Graph error", async () => {
    const s = setup({ error: { code: 100, is_transient: true } }, 400);
    await expect(s.client.startFacebookReel({ ...operation, pageId: "123" })).rejects.toMatchObject({ outcome: "unknown" });
  });
  it("does not allow injected timeouts to exceed the Graph 10s ceiling", () => {
    expect(() => new HttpMetaPublishingClient(config, { timeoutMs: 10_001 })).toThrow();
  });
  it("upload stream applies backpressure before first fetch demand", async () => {
    let reads = 0;
    const source = new Readable({ read() { reads++; this.push(Buffer.alloc(4096)); } });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise(resolve => setImmediate(resolve));
      expect(reads).toBe(0);
      const reader = (init!.body as ReadableStream<Uint8Array>).getReader();
      const chunk = await reader.read();
      expect(chunk.value?.byteLength).toBe(4096);
      await reader.cancel();
      return Response.json({ success: true });
    });
    await new HttpMetaPublishingClient(config, { fetchImpl }).uploadFacebookReel({ ...operation, videoId: "456", sizeBytes: 4096, source });
    expect(source.destroyed).toBe(true);
  });
  it("upload source errors are finite and sanitized", async () => {
    const source = new Readable({ read() { this.destroy(new Error(`${operation.accessToken} ${mediaUrl}`)); } });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const reader = (init!.body as ReadableStream<Uint8Array>).getReader();
      await reader.read();
      return Response.json({ success: true });
    });
    const error = await new HttpMetaPublishingClient(config, { fetchImpl }).uploadFacebookReel({ ...operation, videoId: "456", sizeBytes: 4096, source }).catch((e: unknown) => e);
    expect(error).toMatchObject({ outcome: "unknown", requestName: "upload_facebook_reel" });
    expect(JSON.stringify(error) + String(error)).not.toContain(operation.accessToken);
    expect(source.destroyed).toBe(true);
  });
  it("upload deadline is 300s, destroys private source even when fetch ignores abort", async () => {
    vi.useFakeTimers();
    const source = new Readable({ read() {} });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}));
    const pending = new HttpMetaPublishingClient(config, { fetchImpl }).uploadFacebookReel({ ...operation, videoId: "456", sizeBytes: 4, source }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(source.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ kind: "meta_timeout", outcome: "unknown", requestName: "upload_facebook_reel" });
    expect(source.destroyed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["rejection", "network", "malformed"])("early upload %s closes source without sending more chunks", async mode => {
    let reads = 0;
    const source = new Readable({ read() { reads++; this.push(Buffer.alloc(1024)); } });
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (mode === "network") throw new Error(operation.accessToken);
      return mode === "rejection" ? Response.json({ error: { code: 190 } }, { status: 400 }) : Response.json({});
    });
    await expect(new HttpMetaPublishingClient(config, { fetchImpl }).uploadFacebookReel({ ...operation, videoId: "456", sizeBytes: 5_000_000, source })).rejects.toMatchObject({ requestName: "upload_facebook_reel" });
    expect(source.destroyed).toBe(true);
    expect(reads).toBeLessThan(100);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])("rejects invalid upload size %s and closes source before network", async sizeBytes => {
    const s = setup({ success: true });
    const source = Readable.from([Buffer.from([0, 1])]);
    await expect(s.client.uploadFacebookReel({ ...operation, videoId: "456", sizeBytes, source })).rejects.toMatchObject({ outcome: "rejected" });
    expect(source.destroyed).toBe(true);
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
  it("normalizes invalid private upload source before network without cleanup masking validation", async () => {
    const s = setup({ success: true });
    const invalidInput = { ...operation, videoId: "456", sizeBytes: 4, source: {} };
    // @ts-expect-error intentional invalid source at the runtime boundary
    await expect(s.client.uploadFacebookReel(invalidInput)).rejects.toMatchObject({ kind: "meta_invalid_request", outcome: "rejected", requestName: "upload_facebook_reel" });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
});
