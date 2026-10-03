import { createHmac } from "node:crypto";
import type { EnabledMetaOAuthConfig } from "./metaOAuthClient.ts";

export type FacebookPublishResult = { providerPostId: string };

type PublishTextInput = { accessToken: string; message: string; pageId: string };
type PublishPhotoInput = PublishTextInput & { source: Blob; mimeType: string };

export interface MetaPublishingProviderClient {
  publishText(input: PublishTextInput): Promise<FacebookPublishResult>;
  publishPhoto(input: PublishPhotoInput): Promise<FacebookPublishResult>;
}

type RequestName = "publish_text" | "publish_photo";
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

  constructor(
    kind: ErrorKind,
    requestName: RequestName,
    options: { status?: number; graphCode?: string } = {},
  ) {
    super("Não foi possível concluir a publicação na Meta.");
    this.name = "MetaPublishingClientError";
    this.kind = kind;
    this.requestName = requestName;
    this.status = options.status;
    this.graphCode = options.graphCode;
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
  if (code === "4" || code === "17" || status === 429) return "meta_rate_limited";
  if (status >= 500) return "meta_provider_error";
  if (status === 401) return "meta_token_invalid";
  if (status === 403) return "meta_permission_denied";
  if (status === 404) return "meta_page_unavailable";
  if (
    code === "100" || code === "324" ||
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
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new Error("O timeout do client Meta deve ficar entre 1 e 60000 ms.");
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

  private credentials(
    input: PublishTextInput,
    requestName: RequestName,
  ): Record<string, string> {
    if (!/^\d{1,255}$/.test(input.pageId)) {
      throw new MetaPublishingClientError("meta_invalid_request", requestName);
    }
    if (
      typeof input.accessToken !== "string" ||
      input.accessToken.length === 0 ||
      input.accessToken.length > 8_192
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL(
        `/${this.config.graphApiVersion}/${pageId}/${edge}`,
        "https://graph.facebook.com",
      );
      const response = await this.fetchImpl(url, {
        ...init,
        method: "POST",
        redirect: "error",
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new MetaPublishingClientError(
          response.ok ? "invalid_response" : failureKind(response.status),
          requestName,
          { status: response.status },
        );
      }
      const code = graphCode(body);
      if (!response.ok || (isRecord(body) && "error" in body)) {
        throw new MetaPublishingClientError(
          failureKind(response.status, code),
          requestName,
          { status: response.status, graphCode: code },
        );
      }
      const id = isRecord(body)
        ? body[edge === "photos" ? "post_id" : "id"]
        : undefined;
      if (typeof id !== "string" || !/^\d{1,255}(?:_\d{1,255})?$/.test(id)) {
        throw new MetaPublishingClientError("invalid_response", requestName, {
          status: response.status,
        });
      }
      return { providerPostId: id };
    } catch (error) {
      if (error instanceof MetaPublishingClientError) throw error;
      throw new MetaPublishingClientError(
        controller.signal.aborted ? "meta_timeout" : "meta_provider_error",
        requestName,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
