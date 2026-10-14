import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import type { EnabledMetaOAuthConfig } from "./metaOAuthClient.ts";

export type FacebookPublishResult = { providerPostId: string };

type PublishTextInput = { accessToken: string; message: string; pageId: string };
type PublishPhotoInput = PublishTextInput & { source: Blob; mimeType: string };
type OperationInput = { graphApiVersion: string; accessToken: string };
type InstagramContainerInput = OperationInput & { accountId: string; caption: string; media: { kind: "image" | "reel"; url: string } };
type InstagramStatusInput = OperationInput & { containerId: string };
type InstagramPublishInput = InstagramStatusInput & { accountId: string };
type FacebookStartInput = OperationInput & { pageId: string };
type FacebookStatusInput = OperationInput & { videoId: string };
type FacebookUploadInput = FacebookStatusInput & { source: Readable; sizeBytes: number };
type FacebookFinishInput = FacebookStatusInput & { pageId: string; caption: string };
export type InstagramContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";
export type FacebookReelPhase = "not_started" | "in_progress" | "complete" | "error";
export type FacebookVideoStatus = "error" | "expired" | "processing" | "ready" | "uploading" | "upload_failed" | "upload_complete";
export type FacebookReelStatus = {
  uploadingPhase: FacebookReelPhase; processingPhase: FacebookReelPhase; publishingPhase: FacebookReelPhase;
  published: boolean; uploadedBytes: number | null; videoStatus: FacebookVideoStatus;
};

export interface MetaPublishingProviderClient {
  publishText(input: PublishTextInput): Promise<FacebookPublishResult>;
  publishPhoto(input: PublishPhotoInput): Promise<FacebookPublishResult>;
  createInstagramContainer(input: InstagramContainerInput): Promise<{ containerId: string }>;
  getInstagramContainerStatus(input: InstagramStatusInput): Promise<{ status: InstagramContainerStatus }>;
  publishInstagramContainer(input: InstagramPublishInput): Promise<FacebookPublishResult>;
  startFacebookReel(input: FacebookStartInput): Promise<{ videoId: string }>;
  uploadFacebookReel(input: FacebookUploadInput): Promise<void>;
  getFacebookReelStatus(input: FacebookStatusInput): Promise<FacebookReelStatus>;
  finishFacebookReel(input: FacebookFinishInput): Promise<void>;
}

type RequestName = "publish_text" | "publish_photo" | "create_instagram_container" | "get_instagram_container_status" | "publish_instagram_container" | "start_facebook_reel" | "upload_facebook_reel" | "get_facebook_reel_status" | "finish_facebook_reel";
type ErrorKind =
  | "invalid_response"
  | "meta_invalid_request"
  | "meta_permission_denied"
  | "meta_token_invalid"
  | "meta_page_unavailable"
  | "meta_rate_limited"
  | "meta_provider_error"
  | "meta_timeout"
  | "media_unavailable";

export class MetaPublishingClientError extends Error {
  readonly kind: ErrorKind;
  readonly requestName: RequestName;
  readonly status?: number;
  readonly graphCode?: string;
  readonly outcome: "rejected" | "unknown";

  constructor(
    kind: ErrorKind,
    requestName: RequestName,
    options: { status?: number; graphCode?: string; outcome?: "rejected" | "unknown" } = {},
  ) {
    super("Não foi possível concluir a publicação na Meta.");
    this.name = "MetaPublishingClientError";
    this.kind = kind;
    this.requestName = requestName;
    this.status = options.status;
    this.graphCode = options.graphCode;
    this.outcome = options.outcome ?? "rejected";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function graphCode(body: unknown): string | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined;
  const code = body.error.code;
  // Graph codes are numeric (possibly JSON strings), never arbitrary provider text.
  if (typeof code !== "number" && typeof code !== "string") return undefined;
  return /^\d{1,10}$/.test(String(code)) ? String(code) : undefined;
}

function failureKind(status: number, code?: string): ErrorKind {
  if (code === "190" || code === "102") return "meta_token_invalid";
  if (
    code === "10" ||
    (code !== undefined && Number(code) >= 200 && Number(code) <= 299)
  ) return "meta_permission_denied";
  if (code === "4" || code === "17" || code === "32" || code === "613" || status === 429) return "meta_rate_limited";
  if (status >= 500) return "meta_provider_error";
  if (status === 401) return "meta_token_invalid";
  if (status === 403) return "meta_permission_denied";
  if (status === 404) return "meta_page_unavailable";
  if (
    code === "100" || code === "324" || code === "1363040" || code === "1363127" || code === "1363128" || code === "1363129" ||
    (code === undefined && status === 400)
  ) return "meta_invalid_request";
  return "meta_provider_error";
}

export class HttpMetaPublishingClient implements MetaPublishingProviderClient {
  private readonly config: EnabledMetaOAuthConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    config: EnabledMetaOAuthConfig,
    {
      fetchImpl = globalThis.fetch,
      timeoutMs = 10_000,
    }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
      throw new Error("O timeout do client Meta deve ficar entre 1 e 10000 ms.");
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async publishText(input: PublishTextInput): Promise<FacebookPublishResult> {
    const requestName = "publish_text";
    const body = new URLSearchParams(this.credentials(input, requestName));
    body.set("message", input.message);
    return this.request(input.pageId, "feed", requestName, {
      body,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  }

  async publishPhoto(input: PublishPhotoInput): Promise<FacebookPublishResult> {
    const requestName = "publish_photo";
    const credentials = this.credentials(input, requestName);
    if (input.mimeType !== "image/jpeg" && input.mimeType !== "image/png") {
      throw new MetaPublishingClientError("meta_invalid_request", requestName);
    }
    const photo = input.source;
    if (!(photo instanceof Blob)) {
      throw new MetaPublishingClientError("media_unavailable", requestName);
    }
    if (photo.size === 0 || photo.size > 4_000_000 || photo.type !== input.mimeType) {
      throw new MetaPublishingClientError("meta_invalid_request", requestName);
    }
    const body = new FormData();
    for (const [name, value] of Object.entries(credentials)) body.set(name, value);
    body.set("caption", input.message);
    body.set(
      "source", photo, input.mimeType === "image/jpeg" ? "photo.jpg" : "photo.png",
    );
    return this.request(input.pageId, "photos", requestName, {
      body,
      headers: { Accept: "application/json" },
    });
  }

  async createInstagramContainer(input: InstagramContainerInput): Promise<{ containerId: string }> {
    const name = "create_instagram_container";
    const body = this.operationBody(input, name, input.accountId);
    if (typeof input.caption !== "string" || Array.from(input.caption).length > 2200 ||
      !input.media || (input.media.kind !== "image" && input.media.kind !== "reel") || typeof input.media.url !== "string" || input.media.url.length > 8192) throw new MetaPublishingClientError("meta_invalid_request", name);
    let mediaUrl: URL;
    try { mediaUrl = new URL(input.media.url); } catch { throw new MetaPublishingClientError("meta_invalid_request", name); }
    if (mediaUrl.protocol !== "https:" || mediaUrl.username || mediaUrl.password || mediaUrl.hash) throw new MetaPublishingClientError("meta_invalid_request", name);
    body.set("caption", input.caption);
    if (input.media.kind === "image") body.set("image_url", input.media.url);
    else {
      body.set("video_url", input.media.url);
      body.set("media_type", "REELS");
      body.set("share_to_feed", "true");
    }
    const result = await this.operationPost(input.graphApiVersion, input.accountId, "media", name, body);
    return { containerId: this.numericResultId(result, "id", name) };
  }

  async getInstagramContainerStatus(input: InstagramStatusInput): Promise<{ status: InstagramContainerStatus }> {
    const name = "get_instagram_container_status";
    const result = await this.operationGet(input, input.containerId, "status_code", name);
    const status = isRecord(result) ? result.status_code : undefined;
    if (status !== "IN_PROGRESS" && status !== "FINISHED" && status !== "ERROR" && status !== "EXPIRED" && status !== "PUBLISHED") throw this.invalidResult(name);
    return { status };
  }

  async publishInstagramContainer(input: InstagramPublishInput): Promise<FacebookPublishResult> {
    const name = "publish_instagram_container";
    const body = this.operationBody(input, name, input.accountId, input.containerId);
    body.set("creation_id", input.containerId);
    const result = await this.operationPost(input.graphApiVersion, input.accountId, "media_publish", name, body);
    return { providerPostId: this.numericResultId(result, "id", name) };
  }

  async startFacebookReel(input: FacebookStartInput): Promise<{ videoId: string }> {
    const name = "start_facebook_reel";
    const body = this.operationBody(input, name, input.pageId);
    body.set("upload_phase", "start");
    const result = await this.operationPost(input.graphApiVersion, input.pageId, "video_reels", name, body);
    const videoId = this.numericResultId(result, "video_id", name);
    // Provider URLs are validated but never used as request authority.
    if (!isRecord(result) || typeof result.upload_url !== "string") throw this.invalidResult(name);
    // Match the documented forms before URL normalization can hide query/fragment
    // delimiters or dot segments. Both authority and returned numeric ID are fixed.
    if (result.upload_url !== `https://rupload.facebook.com/video-upload/${videoId}` &&
      result.upload_url !== `https://rupload.facebook.com/video-upload/${input.graphApiVersion}/${videoId}`) throw this.invalidResult(name);
    return { videoId };
  }

  async uploadFacebookReel(input: FacebookUploadInput): Promise<void> {
    const name = "upload_facebook_reel";
    try {
      this.operationBody(input, name, input.videoId);
      if (!(input.source instanceof Readable) || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) throw new MetaPublishingClientError("meta_invalid_request", name);
      // Zero prefetch: fetch demand drives the Node iterator, preserving backpressure.
      const iterator = input.source[Symbol.asyncIterator]();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await iterator.next();
          if (next.done) controller.close();
          else if (next.value instanceof Uint8Array) controller.enqueue(next.value);
          else throw new MetaPublishingClientError("media_unavailable", name, { outcome: "unknown" });
        },
        cancel() { input.source.destroy(); },
      }, { highWaterMark: 0 });
      const init: RequestInit & { duplex: "half" } = {
        method: "POST", duplex: "half", body,
        headers: { Accept: "application/json", Authorization: `OAuth ${input.accessToken}`, offset: "0", file_size: String(input.sizeBytes), "Content-Type": "application/octet-stream" },
      };
      const result = await this.operationRequest(new URL(`https://rupload.facebook.com/video-upload/${input.graphApiVersion}/${input.videoId}`), name, init, 300_000, input.source);
      this.requireSuccess(result, name);
    } finally { if (input.source instanceof Readable) input.source.destroy(); }
  }

  async getFacebookReelStatus(input: FacebookStatusInput): Promise<FacebookReelStatus> {
    const name = "get_facebook_reel_status";
    const result = await this.operationGet(input, input.videoId, "status", name);
    if (!isRecord(result) || !isRecord(result.status)) throw this.invalidResult(name);
    const status = result.status;
    if (isRecord(status.publishing_phase)) {
      const publishStatus = status.publishing_phase.publish_status;
      if (publishStatus !== undefined && publishStatus !== "draft" && publishStatus !== "error" && publishStatus !== "published" && publishStatus !== "scheduled") throw this.invalidResult(name);
    }
    const videoStatus = status.video_status;
    if (videoStatus !== "error" && videoStatus !== "expired" && videoStatus !== "processing" && videoStatus !== "ready" && videoStatus !== "uploading" && videoStatus !== "upload_failed" && videoStatus !== "upload_complete") throw this.invalidResult(name);
    const phase = (value: unknown): FacebookReelPhase => {
      if (!isRecord(value)) throw this.invalidResult(name);
      const raw = value.status;
      if (raw !== "complete" && raw !== "completed" && raw !== "error" && raw !== "not_started" && raw !== "in_progress") throw this.invalidResult(name);
      if (value.error || (Array.isArray(value.errors) && value.errors.length) || value.publish_status === "error") return "error";
      return raw === "completed" ? "complete" : raw;
    };
    const uploadingPhase = phase(status.uploading_phase);
    const processingPhase = phase(status.processing_phase);
    const publishingPhase = phase(status.publishing_phase);
    const bytes = isRecord(status.uploading_phase) ? status.uploading_phase.bytes_transfered : undefined;
    if (bytes !== undefined && (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0)) throw this.invalidResult(name);
    return { uploadingPhase, processingPhase, publishingPhase, videoStatus, uploadedBytes: bytes === undefined ? null : bytes,
      published: publishingPhase === "complete" || (isRecord(status.publishing_phase) && status.publishing_phase.publish_status === "published") };
  }

  async finishFacebookReel(input: FacebookFinishInput): Promise<void> {
    const name = "finish_facebook_reel";
    const body = this.operationBody(input, name, input.pageId, input.videoId);
    if (typeof input.caption !== "string") throw new MetaPublishingClientError("meta_invalid_request", name);
    body.set("upload_phase", "finish");
    body.set("video_id", input.videoId);
    body.set("video_state", "PUBLISHED");
    body.set("description", input.caption);
    this.requireSuccess(await this.operationPost(input.graphApiVersion, input.pageId, "video_reels", name, body), name);
  }

  private invalidResult(name: RequestName): MetaPublishingClientError {
    return new MetaPublishingClientError("invalid_response", name, { outcome: "unknown" });
  }

  private numericResultId(result: unknown, field: "id" | "video_id", name: RequestName): string {
    const value = isRecord(result) ? result[field] : undefined;
    if (typeof value !== "string" || !/^\d{1,255}$/.test(value)) throw this.invalidResult(name);
    return value;
  }

  private requireSuccess(result: unknown, name: RequestName): void {
    if (!isRecord(result) || result.success !== true) throw this.invalidResult(name);
  }

  private operationBody(input: OperationInput, name: RequestName, ...ids: string[]): URLSearchParams {
    if (typeof input.graphApiVersion !== "string" || !/^v\d{1,3}\.\d{1,2}$/.test(input.graphApiVersion) || ids.some(id => typeof id !== "string" || !/^\d{1,255}$/.test(id))) throw new MetaPublishingClientError("meta_invalid_request", name);
    return new URLSearchParams(this.credentials({ pageId: ids[0]!, accessToken: input.accessToken, message: "" }, name));
  }

  private async operationPost(version: string, id: string, edge: "media" | "media_publish" | "video_reels", name: RequestName, body: URLSearchParams): Promise<unknown> {
    return this.operationRequest(new URL(`https://graph.facebook.com/${version}/${id}/${edge}`), name, {
      method: "POST", body, headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    }, this.timeoutMs);
  }

  private async operationGet(input: OperationInput, id: string, fields: "status" | "status_code", name: RequestName): Promise<unknown> {
    const credentials = this.operationBody(input, name, id);
    const url = new URL(`https://graph.facebook.com/${input.graphApiVersion}/${id}`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("appsecret_proof", credentials.get("appsecret_proof")!);
    return this.operationRequest(url, name, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${input.accessToken}` } }, this.timeoutMs);
  }

  private async operationRequest(url: URL, name: RequestName, init: RequestInit, timeoutMs: number, source?: Readable): Promise<unknown> {
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancelBody = () => { void reader?.cancel().catch(() => {}); };
    const timeout = setTimeout(() => { controller.abort(); source?.destroy(); cancelBody(); }, timeoutMs);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new MetaPublishingClientError("meta_timeout", name, { outcome: "unknown" }));
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      const request = async () => {
        const response = await this.fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw new MetaPublishingClientError("meta_timeout", name, { outcome: "unknown" });
        }
        const invalidBody = () => new MetaPublishingClientError(response.ok ? "invalid_response" : failureKind(response.status), name, { status: response.status, outcome: "unknown" });
        const limit = 1_048_576;
        if (!response.body) throw invalidBody();
        reader = response.body.getReader();
        const declared = response.headers.get("content-length");
        if (declared && /^\d+$/.test(declared) && Number(declared) > limit) throw invalidBody();
        const decoder = new TextDecoder();
        let bytes = 0;
        let text = "";
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > limit) throw invalidBody();
          text += decoder.decode(next.value, { stream: true });
        }
        text += decoder.decode();
        let result: unknown;
        try { result = JSON.parse(text); } catch { throw invalidBody(); }
        const code = graphCode(result);
        if (!response.ok || (isRecord(result) && "error" in result)) {
          const kind = failureKind(response.status, code);
          // A read failure never proves a previous mutation was rejected. Unknown
          // Graph codes, transient errors, malformed errors and 2xx stay ambiguous.
          const rejected = init.method === "POST" && response.status >= 400 && response.status < 500 && code !== undefined &&
            isRecord(result) && isRecord(result.error) && result.error.is_transient !== true &&
            (code === "190" || code === "102" || code === "10" || (Number(code) >= 200 && Number(code) <= 299) ||
              code === "4" || code === "17" || code === "32" || code === "613" || code === "100" || code === "324" ||
              code === "1363040" || code === "1363127" || code === "1363128" || code === "1363129");
          throw new MetaPublishingClientError(kind, name, { status: response.status, graphCode: code, outcome: rejected ? "rejected" : "unknown" });
        }
        return result;
      };
      return await Promise.race([request(), aborted]);
    } catch (error) {
      if (error instanceof MetaPublishingClientError) throw error;
      throw new MetaPublishingClientError(controller.signal.aborted ? "meta_timeout" : "meta_provider_error", name, { outcome: "unknown" });
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", onAbort);
      cancelBody();
      // cancellation is deliberately not awaited: a hostile stream must not
      // extend the HTTP deadline; real fetch cancellation releases the socket.
    }
  }

  private credentials(
    input: PublishTextInput,
    requestName: RequestName,
  ): Record<string, string> {
    if (typeof input.pageId !== "string" || !/^\d{1,255}$/.test(input.pageId)) {
      throw new MetaPublishingClientError("meta_invalid_request", requestName);
    }
    if (
      typeof input.accessToken !== "string" ||
      input.accessToken.length === 0 ||
      input.accessToken.length > 8_192 || /[\r\n]/.test(input.accessToken) || input.accessToken.includes("\0")
    ) {
      throw new MetaPublishingClientError("meta_token_invalid", requestName);
    }
    return {
      access_token: input.accessToken,
      appsecret_proof: createHmac("sha256", this.config.appSecret)
        .update(input.accessToken, "utf8")
        .digest("hex"),
    };
  }

  private async request(
    pageId: string,
    edge: "feed" | "photos",
    requestName: RequestName,
    init: RequestInit,
  ): Promise<FacebookPublishResult> {
    if (!/^v\d{1,3}\.\d{1,2}$/.test(this.config.graphApiVersion)) throw new MetaPublishingClientError("meta_invalid_request", requestName);
    const url = new URL(`https://graph.facebook.com/${this.config.graphApiVersion}/${pageId}/${edge}`);
    const body = await this.operationRequest(url, requestName, { ...init, method: "POST" }, this.timeoutMs);
    const id = isRecord(body) ? body[edge === "photos" ? "post_id" : "id"] : undefined;
    if (typeof id !== "string" || !/^\d{1,255}(?:_\d{1,255})?$/.test(id)) throw this.invalidResult(requestName);
    return { providerPostId: id };
  }
}
