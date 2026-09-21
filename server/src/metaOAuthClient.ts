import { createHmac } from "node:crypto";

export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
] as const;

const AUTHORIZATION_ORIGIN = "https://www.facebook.com";
const GRAPH_ORIGIN = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_GRAPH_PAGES = 20;
const MAX_DISCOVERED_PAGES = 200;
const MAX_TOKEN_LENGTH = 8_192;

export type MetaOAuthConfig = {
  appId: string | null;
  appSecret: string | null;
  enabled: boolean;
  graphApiVersion: string;
  redirectUri: string | null;
  stateTtlSeconds: number;
};

export type EnabledMetaOAuthConfig = MetaOAuthConfig & {
  appId: string;
  appSecret: string;
  enabled: true;
  redirectUri: string;
};

export type MetaAccessToken = {
  accessToken: string;
  expiresAt: string | null;
};

export type MetaPermissionStatus = "declined" | "expired" | "granted";

export type MetaPermission = {
  name: string;
  status: MetaPermissionStatus;
};

export type MetaPage = {
  accessToken: string;
  id: string;
  instagramBusinessAccountId: string | null;
  name: string;
  profileImageUrl: string | null;
  tasks: string[];
  username: string | null;
};

export type MetaInstagramAccount = {
  displayName: string;
  id: string;
  profileImageUrl: string | null;
  username: string;
};

export interface MetaOAuthProviderClient {
  buildAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<MetaAccessToken>;
  exchangeForLongLivedToken(accessToken: string): Promise<MetaAccessToken>;
  getIdentity(accessToken: string): Promise<{ id: string }>;
  getInstagramAccount(
    id: string,
    pageAccessToken: string,
  ): Promise<MetaInstagramAccount>;
  getPermissions(accessToken: string): Promise<MetaPermission[]>;
  listPages(accessToken: string): Promise<MetaPage[]>;
}

type MetaOAuthClientErrorKind =
  | "graph"
  | "http"
  | "invalid_response"
  | "timeout";

export class MetaOAuthClientError extends Error {
  readonly graphCode?: string;
  readonly kind: MetaOAuthClientErrorKind;
  readonly requestName: string;
  readonly status?: number;

  constructor(
    kind: MetaOAuthClientErrorKind,
    requestName: string,
    options: { graphCode?: string; status?: number } = {},
  ) {
    super("A Meta não retornou uma resposta válida para esta operação.");
    this.name = "MetaOAuthClientError";
    this.graphCode = options.graphCode;
    this.kind = kind;
    this.requestName = requestName;
    this.status = options.status;
  }
}

type HttpMetaOAuthClientOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,255}$/.test(value);
}

function normalizeOptionalHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function parsePictureUrl(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  return normalizeOptionalHttpUrl(value.data.url);
}

function normalizeTasks(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some(
      (task) =>
        typeof task !== "string" ||
        task.trim().length === 0 ||
        task.length > 100,
    )
  ) {
    throw new Error("invalid Meta Page tasks");
  }
  return [...new Set(value.map((task) => task.trim()))];
}

function graphCode(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;
  const code = value.error.code;
  return typeof code === "string" || typeof code === "number"
    ? String(code)
    : undefined;
}

function requireToken(value: unknown, requestName: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TOKEN_LENGTH
  ) {
    throw new MetaOAuthClientError("invalid_response", requestName);
  }
  return value;
}

export function requireEnabledMetaOAuthConfig(
  config: MetaOAuthConfig,
): asserts config is EnabledMetaOAuthConfig {
  if (
    !config.enabled ||
    !config.appId ||
    !config.appSecret ||
    !config.redirectUri
  ) {
    throw new Error("A configuração OAuth Meta não está habilitada.");
  }
}

export class HttpMetaOAuthClient implements MetaOAuthProviderClient {
  private readonly config: EnabledMetaOAuthConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(
    config: EnabledMetaOAuthConfig,
    {
      fetchImpl = globalThis.fetch,
      now = Date.now,
      timeoutMs = DEFAULT_TIMEOUT_MS,
    }: HttpMetaOAuthClientOptions = {},
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new Error("O timeout do client Meta deve ficar entre 1 e 60000 ms.");
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
  }

  buildAuthorizationUrl(state: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new Error("O state OAuth Meta possui formato inválido.");
    }
    const url = new URL(
      `/${this.config.graphApiVersion}/dialog/oauth`,
      AUTHORIZATION_ORIGIN,
    );
    url.searchParams.set("client_id", this.config.appId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", META_OAUTH_SCOPES.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<MetaAccessToken> {
    if (!code || code.length > 4_096) {
      throw new MetaOAuthClientError("invalid_response", "code_exchange");
    }
    return this.requestToken("code_exchange", {
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      code,
      redirect_uri: this.config.redirectUri,
    });
  }

  async exchangeForLongLivedToken(
    accessToken: string,
  ): Promise<MetaAccessToken> {
    const token = requireToken(accessToken, "long_lived_token_exchange");
    return this.requestToken("long_lived_token_exchange", {
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: token,
      grant_type: "fb_exchange_token",
    });
  }

  async getIdentity(accessToken: string): Promise<{ id: string }> {
    const body = await this.graphGet("identity", "/me", accessToken, {
      fields: "id",
    });
    if (!isRecord(body) || !isProviderId(body.id)) {
      throw new MetaOAuthClientError("invalid_response", "identity");
    }
    return { id: body.id };
  }

  async getPermissions(accessToken: string): Promise<MetaPermission[]> {
    const body = await this.graphGet(
      "permissions",
      "/me/permissions",
      accessToken,
    );
    if (!isRecord(body) || !Array.isArray(body.data)) {
      throw new MetaOAuthClientError("invalid_response", "permissions");
    }
    if (body.data.length > 100) {
      throw new MetaOAuthClientError("invalid_response", "permissions");
    }

    return body.data.map((permission) => {
      if (
        !isRecord(permission) ||
        typeof permission.permission !== "string" ||
        permission.permission.trim().length === 0 ||
        permission.permission.length > 100 ||
        (permission.status !== "granted" &&
          permission.status !== "declined" &&
          permission.status !== "expired")
      ) {
        throw new MetaOAuthClientError("invalid_response", "permissions");
      }
      return {
        name: permission.permission.trim(),
        status: permission.status,
      };
    });
  }

  async listPages(accessToken: string): Promise<MetaPage[]> {
    const pages: MetaPage[] = [];
    const cursors = new Set<string>();
    let after: string | undefined;

    for (let requestIndex = 0; requestIndex < MAX_GRAPH_PAGES; requestIndex += 1) {
      const body = await this.graphGet(
        "pages",
        "/me/accounts",
        accessToken,
        {
          ...(after ? { after } : {}),
          fields:
            "id,name,username,access_token,tasks,picture{url},instagram_business_account",
          limit: "100",
        },
      );
      if (!isRecord(body) || !Array.isArray(body.data)) {
        throw new MetaOAuthClientError("invalid_response", "pages");
      }

      for (const value of body.data) {
        pages.push(this.parsePage(value));
        if (pages.length > MAX_DISCOVERED_PAGES) {
          throw new MetaOAuthClientError("invalid_response", "pages");
        }
      }

      const hasNext =
        isRecord(body.paging) && typeof body.paging.next === "string";
      if (!hasNext) return pages;
      const cursor =
        isRecord(body.paging) &&
        isRecord(body.paging.cursors) &&
        typeof body.paging.cursors.after === "string"
          ? body.paging.cursors.after
          : null;
      if (
        !cursor ||
        cursor.length > 2_048 ||
        cursors.has(cursor)
      ) {
        throw new MetaOAuthClientError("invalid_response", "pages");
      }
      cursors.add(cursor);
      after = cursor;
    }

    throw new MetaOAuthClientError("invalid_response", "pages");
  }

  async getInstagramAccount(
    id: string,
    pageAccessToken: string,
  ): Promise<MetaInstagramAccount> {
    if (!isProviderId(id)) {
      throw new MetaOAuthClientError("invalid_response", "instagram_profile");
    }
    const body = await this.graphGet(
      "instagram_profile",
      `/${id}`,
      pageAccessToken,
      { fields: "id,username,name,profile_picture_url" },
    );
    if (
      !isRecord(body) ||
      body.id !== id ||
      typeof body.username !== "string" ||
      body.username.trim().length === 0 ||
      body.username.length > 100
    ) {
      throw new MetaOAuthClientError(
        "invalid_response",
        "instagram_profile",
      );
    }
    const username = body.username.trim();
    const displayName =
      typeof body.name === "string" &&
      body.name.trim().length > 0 &&
      body.name.length <= 120
        ? body.name.trim()
        : username;
    return {
      displayName,
      id,
      profileImageUrl: normalizeOptionalHttpUrl(body.profile_picture_url),
      username,
    };
  }

  private parsePage(value: unknown): MetaPage {
    if (
      !isRecord(value) ||
      !isProviderId(value.id) ||
      typeof value.name !== "string" ||
      value.name.trim().length === 0 ||
      value.name.length > 120
    ) {
      throw new MetaOAuthClientError("invalid_response", "pages");
    }
    const instagramBusinessAccountId =
      value.instagram_business_account === undefined
        ? null
        : isRecord(value.instagram_business_account) &&
            isProviderId(value.instagram_business_account.id)
          ? value.instagram_business_account.id
          : undefined;
    if (instagramBusinessAccountId === undefined) {
      throw new MetaOAuthClientError("invalid_response", "pages");
    }
    const username =
      value.username === undefined || value.username === null
        ? null
        : typeof value.username === "string" &&
            value.username.trim().length > 0 &&
            value.username.length <= 100
          ? value.username.trim()
          : undefined;
    if (username === undefined) {
      throw new MetaOAuthClientError("invalid_response", "pages");
    }

    try {
      return {
        accessToken: requireToken(value.access_token, "pages"),
        id: value.id,
        instagramBusinessAccountId,
        name: value.name.trim(),
        profileImageUrl: parsePictureUrl(value.picture),
        tasks: normalizeTasks(value.tasks),
        username,
      };
    } catch (error) {
      if (error instanceof MetaOAuthClientError) throw error;
      throw new MetaOAuthClientError("invalid_response", "pages");
    }
  }

  private appSecretProof(accessToken: string): string {
    return createHmac("sha256", this.config.appSecret)
      .update(accessToken, "utf8")
      .digest("hex");
  }

  private graphUrl(
    path: string,
    accessToken: string,
    query: Record<string, string> = {},
  ): URL {
    const url = new URL(
      `/${this.config.graphApiVersion}${path}`,
      GRAPH_ORIGIN,
    );
    for (const [name, value] of Object.entries(query)) {
      url.searchParams.set(name, value);
    }
    url.searchParams.set("appsecret_proof", this.appSecretProof(accessToken));
    return url;
  }

  private async graphGet(
    requestName: string,
    path: string,
    accessToken: string,
    query: Record<string, string> = {},
  ): Promise<unknown> {
    const token = requireToken(accessToken, requestName);
    return this.fetchJson(requestName, this.graphUrl(path, token, query), {
      headers: { Authorization: `Bearer ${token}` },
      method: "GET",
    });
  }

  private async requestToken(
    requestName: string,
    values: Record<string, string>,
  ): Promise<MetaAccessToken> {
    const url = new URL(
      `/${this.config.graphApiVersion}/oauth/access_token`,
      GRAPH_ORIGIN,
    );
    const body = await this.fetchJson(requestName, url, {
      body: new URLSearchParams(values),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      method: "POST",
    });
    if (!isRecord(body)) {
      throw new MetaOAuthClientError("invalid_response", requestName);
    }
    const accessToken = requireToken(body.access_token, requestName);
    let expiresAt: string | null = null;
    if (body.expires_in !== undefined) {
      if (
        typeof body.expires_in !== "number" ||
        !Number.isInteger(body.expires_in) ||
        body.expires_in <= 0 ||
        body.expires_in > 315_360_000
      ) {
        throw new MetaOAuthClientError("invalid_response", requestName);
      }
      expiresAt = new Date(this.now() + body.expires_in * 1_000).toISOString();
    }
    return { accessToken, expiresAt };
  }

  private async fetchJson(
    requestName: string,
    url: URL,
    init: RequestInit,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown;
      try {
        body = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        throw new MetaOAuthClientError(
          "invalid_response",
          requestName,
          { status: response.status },
        );
      }
      const code = graphCode(body);
      if (code !== undefined) {
        throw new MetaOAuthClientError("graph", requestName, {
          graphCode: code,
          status: response.status,
        });
      }
      if (!response.ok) {
        throw new MetaOAuthClientError("http", requestName, {
          status: response.status,
        });
      }
      return body;
    } catch (error) {
      if (error instanceof MetaOAuthClientError) throw error;
      if (controller.signal.aborted) {
        throw new MetaOAuthClientError("timeout", requestName);
      }
      throw new MetaOAuthClientError("http", requestName);
    } finally {
      clearTimeout(timeout);
    }
  }
}
