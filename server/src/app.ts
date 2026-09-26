import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Pool } from "pg";
import {
  DuplicateEmailError,
  ForbiddenWorkspaceError,
  InvalidCredentialsError,
  PostgresAuthService,
  UnauthorizedError,
} from "./authService.ts";
import {
  validateLoginInput,
  validateRegisterInput,
  validateSelectWorkspaceInput,
} from "./authContract.ts";
import { validateCreatePost } from "./postContract.ts";
import { AuthenticatedPostsContextResolver } from "./postsContext.ts";
import {
  InvalidPostsContextError,
  PostMediaAssetNotFoundError,
  PostgresPostsStore,
} from "./postsStore.ts";
import {
  clearSessionCookie,
  createSessionCookie,
  type SessionCookieConfig,
} from "./sessionCookie.ts";
import {
  InMemoryRateLimiter,
  type RateLimitConfig,
} from "./rateLimiter.ts";
import { isUuid } from "../../shared/postContract.ts";
import { validateUpdateSocialAccount } from "./socialAccountContract.ts";
import {
  InvalidSocialAccountsContextError,
  PostgresSocialAccountsRepository,
} from "./postgresSocialAccountsRepository.ts";
import {
  SocialAccountNotFoundError,
  SocialAccountsService,
} from "./socialAccountsService.ts";
import type { SocialTokenCipher } from "./socialTokenCrypto.ts";
import {
  HttpMetaOAuthClient,
  requireEnabledMetaOAuthConfig,
  type MetaOAuthConfig,
  type MetaOAuthProviderClient,
} from "./metaOAuthClient.ts";
import {
  MetaOAuthFlowError,
  MetaOAuthService,
} from "./metaOAuthService.ts";
import { PostgresMetaOAuthStateRepository } from "./metaOAuthStateRepository.ts";
import { resolveClientAddress } from "./clientAddress.ts";
import { MediaAssetsService } from "./mediaAssetsService.ts";
import { PostgresMediaAssetsRepository } from "./mediaAssetsRepository.ts";
import { MediaContentUnavailableError, MediaRequestError } from "./mediaErrors.ts";
import { sendMediaContent } from "./mediaContent.ts";
import type { MediaLimits } from "./mediaStorage.ts";

const MAX_BODY_SIZE = 1_048_576;

type ApiLogger = {
  error(message: string, error: unknown): void;
};

type ApiServerOptions = {
  authRateLimit: RateLimitConfig;
  corsOrigin: string;
  logger?: ApiLogger;
  metaOAuth?: MetaOAuthConfig;
  metaOAuthClient?: MetaOAuthProviderClient;
  mediaLimits?: MediaLimits;
  mediaStoragePath?: string;
  pool: Pool;
  sessionCookie: SessionCookieConfig;
  sessionTtlSeconds: number;
  socialTokenCipher: SocialTokenCipher;
  trustProxy?: boolean;
};

const DISABLED_META_OAUTH_CONFIG: MetaOAuthConfig = {
  appId: null,
  appSecret: null,
  enabled: false,
  graphApiVersion: "v26.0",
  redirectUri: null,
  stateTtlSeconds: 600,
};

class RequestError extends Error {
  readonly code: string;
  readonly fields?: string[];
  readonly status: number;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: string[],
  ) {
    super(message);
    this.name = "RequestError";
    this.code = code;
    this.fields = fields;
    this.status = status;
  }
}

function writeCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  allowedOrigin: string,
) {
  response.setHeader("Vary", "Origin");
  if (request.headers.origin === allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, HEAD, POST, PATCH, DELETE, OPTIONS",
    );
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Length": payload.byteLength,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function sendNoContent(response: ServerResponse, status = 204) {
  response.writeHead(status);
  response.end();
}

function sendRedirect(response: ServerResponse, location: string) {
  response.writeHead(302, {
    "Cache-Control": "no-store",
    "Content-Length": "0",
    Location: location,
  });
  response.end();
}

function metaCallbackLocation(
  corsOrigin: string,
  result:
    | {
        error:
          | "cancelled"
          | "invalid_state"
          | "no_accounts"
          | "provider_error"
          | "session_expired";
        success: false;
      }
    | { success: true },
): string {
  const query = result.success
    ? "meta=connected"
    : `meta_error=${encodeURIComponent(result.error)}`;
  return `${corsOrigin}/#/canais?${query}`;
}

function metaCallbackError(error: unknown) {
  if (error instanceof UnauthorizedError) return "session_expired" as const;
  if (!(error instanceof MetaOAuthFlowError)) return "provider_error" as const;
  if (error.code === "meta_oauth_cancelled") return "cancelled" as const;
  if (error.code === "meta_oauth_no_accounts") return "no_accounts" as const;
  if (error.code === "meta_oauth_session_invalid") {
    return "session_expired" as const;
  }
  if (
    error.code === "meta_oauth_invalid_state" ||
    error.code === "meta_oauth_expired_state"
  ) {
    return "invalid_state" as const;
  }
  return "provider_error" as const;
}

function isEmptyJsonObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function sendRequestError(response: ServerResponse, error: RequestError) {
  sendJson(response, error.status, {
    error: {
      code: error.code,
      ...(error.fields ? { fields: error.fields } : {}),
      message: error.message,
    },
  });
}

function isJsonContentType(contentType: string | undefined) {
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json");
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  if (!isJsonContentType(request.headers["content-type"])) {
    throw new RequestError(
      415,
      "unsupported_media_type",
      "O corpo da requisição deve usar Content-Type application/json.",
    );
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  let tooLarge = false;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > MAX_BODY_SIZE) {
      tooLarge = true;
    } else {
      chunks.push(buffer);
    }
  }

  if (tooLarge) {
    throw new RequestError(
      413,
      "payload_too_large",
      "O corpo da requisição excede o limite permitido.",
    );
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) {
    throw new RequestError(400, "invalid_json", "O corpo JSON é obrigatório.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RequestError(400, "invalid_json", "O corpo JSON é inválido.");
  }
}

export function createApiServer({
  authRateLimit,
  corsOrigin,
  logger = console,
  metaOAuth = DISABLED_META_OAUTH_CONFIG,
  metaOAuthClient,
  mediaLimits = { imageBytes: 25 * 1024 * 1024, videoBytes: 250 * 1024 * 1024 },
  mediaStoragePath = "data/media",
  pool,
  sessionCookie,
  sessionTtlSeconds,
  socialTokenCipher,
  trustProxy = false,
}: ApiServerOptions) {
  const authService = new PostgresAuthService(pool, sessionTtlSeconds);
  const authRateLimiter = new InMemoryRateLimiter(authRateLimit);
  const postsContextResolver = new AuthenticatedPostsContextResolver(authService);
  const postsStore = new PostgresPostsStore(pool);
  const mediaAssetsService = new MediaAssetsService(
    new PostgresMediaAssetsRepository(pool),
    mediaStoragePath,
    mediaLimits,
  );
  const socialAccountsRepository = new PostgresSocialAccountsRepository(pool);
  const socialAccountsService = new SocialAccountsService(
    socialAccountsRepository,
    socialTokenCipher,
  );
  let resolvedMetaOAuthClient = metaOAuthClient ?? null;
  if (metaOAuth.enabled && !resolvedMetaOAuthClient) {
    requireEnabledMetaOAuthConfig(metaOAuth);
    resolvedMetaOAuthClient = new HttpMetaOAuthClient(metaOAuth);
  }
  const metaOAuthService = new MetaOAuthService(
    metaOAuth,
    resolvedMetaOAuthClient,
    new PostgresMetaOAuthStateRepository(pool),
    socialAccountsRepository,
    socialTokenCipher,
  );

  return createServer(async (request, response) => {
    writeCorsHeaders(request, response, corsOrigin);

    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      const method = request.method ?? "GET";
      const isMetaCallback =
        url.pathname === "/auth/meta/callback" && method === "GET";
      if (url.pathname.startsWith("/auth/")) {
        response.setHeader("Cache-Control", "no-store");
      }
      if (url.pathname.startsWith("/social-accounts")) {
        response.setHeader("Cache-Control", "no-store");
      }
      if (url.pathname === "/posts") {
        response.setHeader("Cache-Control", "no-store");
      }
      if (url.pathname === "/media-assets" || url.pathname.startsWith("/media-assets/")) {
        response.setHeader("Cache-Control", "no-store");
      }

      if (
        !isMetaCallback &&
        request.headers.origin !== undefined &&
        request.headers.origin !== corsOrigin
      ) {
        throw new RequestError(
          403,
          "origin_not_allowed",
          "A origem da requisição não é permitida.",
        );
      }

      if (method === "OPTIONS") {
        sendNoContent(response);
        return;
      }

      if (method !== "GET" && method !== "HEAD") {
        if (request.headers.origin !== corsOrigin) {
          throw new RequestError(
            403,
            "origin_not_allowed",
            "A origem da requisição não é permitida.",
          );
        }
      }

      if (url.pathname === "/health" && method === "GET") {
        try {
          await pool.query("SELECT 1");
          sendJson(response, 200, { status: "ok" });
        } catch (error) {
          logger.error("Falha na verificação de saúde do banco.", error);
          sendJson(response, 503, {
            error: {
              code: "database_unavailable",
              message: "O serviço está temporariamente indisponível.",
            },
          });
        }
        return;
      }

      if (url.pathname === "/auth/register" && method === "POST") {
        const rateLimit = authRateLimiter.consume(
          `${url.pathname}:${resolveClientAddress(request, trustProxy)}`,
        );
        if (!rateLimit.allowed) {
          response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
          throw new RequestError(
            429,
            "rate_limited",
            "Muitas tentativas. Aguarde um instante antes de tentar novamente.",
          );
        }
        const validation = validateRegisterInput(await readJsonBody(request));
        if (!validation.success) {
          throw new RequestError(
            400,
            "invalid_registration",
            "Os dados de cadastro são inválidos.",
            validation.fields,
          );
        }
        const created = await authService.register(validation.data);
        response.setHeader(
          "Set-Cookie",
          createSessionCookie(created.token, sessionCookie),
        );
        sendJson(response, 201, {
          tenant: created.context.tenant,
          user: created.context.user,
        });
        return;
      }

      if (url.pathname === "/auth/login" && method === "POST") {
        const rateLimit = authRateLimiter.consume(
          `${url.pathname}:${resolveClientAddress(request, trustProxy)}`,
        );
        if (!rateLimit.allowed) {
          response.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
          throw new RequestError(
            429,
            "rate_limited",
            "Muitas tentativas. Aguarde um instante antes de tentar novamente.",
          );
        }
        const validation = validateLoginInput(await readJsonBody(request));
        if (!validation.success) {
          throw new RequestError(
            400,
            "invalid_login",
            "Os dados de login são inválidos.",
            validation.fields,
          );
        }
        const created = await authService.login(validation.data);
        response.setHeader(
          "Set-Cookie",
          createSessionCookie(created.token, sessionCookie),
        );
        sendJson(response, 200, {
          tenant: created.context.tenant,
          user: created.context.user,
        });
        return;
      }

      if (url.pathname === "/auth/meta/start" && method === "POST") {
        const context = await authService.require(request);
        if (!isEmptyJsonObject(await readJsonBody(request))) {
          throw new RequestError(
            400,
            "invalid_meta_oauth_start",
            "O início da conexão Meta não aceita parâmetros.",
            ["body"],
          );
        }
        sendJson(response, 200, {
          authorizationUrl: await metaOAuthService.start(context),
        });
        return;
      }

      if (isMetaCallback) {
        try {
          const context = await authService.require(request);
          await metaOAuthService.complete(context, {
            code: url.searchParams.get("code"),
            error: url.searchParams.get("error"),
            errorReason: url.searchParams.get("error_reason"),
            state: url.searchParams.get("state"),
          });
          sendRedirect(
            response,
            metaCallbackLocation(corsOrigin, { success: true }),
          );
        } catch (error) {
          if (
            !(error instanceof MetaOAuthFlowError) &&
            !(error instanceof UnauthorizedError)
          ) {
            logger.error("Falha interna no callback OAuth Meta.", {
              name: error instanceof Error ? error.name : "UnknownError",
            });
          }
          sendRedirect(
            response,
            metaCallbackLocation(corsOrigin, {
              error: metaCallbackError(error),
              success: false,
            }),
          );
        }
        return;
      }

      if (url.pathname === "/auth/me" && method === "GET") {
        const context = await authService.require(request);
        sendJson(response, 200, {
          tenant: context.tenant,
          user: context.user,
        });
        return;
      }

      if (url.pathname === "/auth/workspaces" && method === "GET") {
        sendJson(response, 200, {
          workspaces: await authService.listWorkspaces(request),
        });
        return;
      }

      if (url.pathname === "/auth/workspaces/select" && method === "POST") {
        const validation = validateSelectWorkspaceInput(
          await readJsonBody(request),
        );
        if (!validation.success) {
          throw new RequestError(
            400,
            "invalid_workspace_selection",
            "O workspace informado é inválido.",
            validation.fields,
          );
        }
        const rotated = await authService.selectWorkspace(
          request,
          validation.data.tenantId,
        );
        response.setHeader(
          "Set-Cookie",
          createSessionCookie(rotated.token, sessionCookie),
        );
        sendJson(response, 200, {
          tenant: rotated.context.tenant,
          user: rotated.context.user,
        });
        return;
      }

      if (url.pathname === "/auth/logout" && method === "POST") {
        await authService.logout(request);
        response.setHeader("Set-Cookie", clearSessionCookie(sessionCookie));
        sendNoContent(response);
        return;
      }

      if (url.pathname === "/posts" && method === "GET") {
        const context = await postsContextResolver.resolve(request);
        sendJson(response, 200, await postsStore.list(context));
        return;
      }

      if (url.pathname === "/posts" && method === "POST") {
        const context = await postsContextResolver.resolve(request);
        const validation = validateCreatePost(await readJsonBody(request));
        if (!validation.success) {
          throw new RequestError(
            400,
            "invalid_post",
            "Os dados da publicação são inválidos.",
            validation.fields,
          );
        }

        sendJson(
          response,
          201,
          await postsStore.create(context, validation.data),
        );
        return;
      }

      if (url.pathname === "/media-assets" && method === "GET") {
        const context = await postsContextResolver.resolve(request);
        sendJson(response, 200, { mediaAssets: await mediaAssetsService.list(context) });
        return;
      }

      if (url.pathname === "/media-assets" && method === "POST") {
        const context = await postsContextResolver.resolve(request);
        sendJson(response, 201, await mediaAssetsService.upload(request, context));
        return;
      }

      const mediaContentMatch = /^\/media-assets\/([^/]+)\/content$/.exec(url.pathname);
      if (mediaContentMatch) {
        const context = await postsContextResolver.resolve(request);
        const id = mediaContentMatch[1];
        if (!isUuid(id)) {
          throw new RequestError(400, "invalid_media_asset_id", "O identificador da mídia é inválido.", ["id"]);
        }
        if (method === "GET" || method === "HEAD") {
          response.setHeader("Cache-Control", "private, no-store");
          const content = await mediaAssetsService.getContent(context, id);
          try {
            await sendMediaContent(request, response, content);
          } catch {
            if (response.headersSent) {
              response.destroy();
              return;
            }
            throw new MediaContentUnavailableError();
          }
          return;
        }
      }

      const mediaAssetMatch = /^\/media-assets\/([^/]+)$/.exec(url.pathname);
      if (mediaAssetMatch) {
        const context = await postsContextResolver.resolve(request);
        const id = mediaAssetMatch[1];
        if (!isUuid(id)) {
          throw new RequestError(400, "invalid_media_asset_id", "O identificador da mídia é inválido.", ["id"]);
        }
        if (method === "GET") {
          sendJson(response, 200, await mediaAssetsService.get(context, id));
          return;
        }
      }

      if (url.pathname === "/social-accounts" && method === "GET") {
        const context = await postsContextResolver.resolve(request);
        sendJson(response, 200, {
          socialAccounts: await socialAccountsService.list(context),
        });
        return;
      }

      const socialAccountMatch =
        /^\/social-accounts\/([^/]+)$/.exec(url.pathname);
      if (socialAccountMatch) {
        const id = socialAccountMatch[1];
        if (!isUuid(id)) {
          throw new RequestError(
            400,
            "invalid_social_account_id",
            "O identificador da conta social é inválido.",
            ["id"],
          );
        }
        const context = await postsContextResolver.resolve(request);

        if (method === "GET") {
          sendJson(response, 200, await socialAccountsService.get(context, id));
          return;
        }
        if (method === "PATCH") {
          const validation = validateUpdateSocialAccount(
            await readJsonBody(request),
          );
          if (!validation.success) {
            throw new RequestError(
              400,
              "invalid_social_account",
              "Os dados da conta social são inválidos.",
              validation.fields,
            );
          }
          sendJson(
            response,
            200,
            await socialAccountsService.update(context, id, validation.data),
          );
          return;
        }
        if (method === "DELETE") {
          sendJson(
            response,
            200,
            await socialAccountsService.disconnect(context, id),
          );
          return;
        }
      }

      if (
        url.pathname === "/health" ||
        url.pathname === "/posts" ||
        url.pathname === "/social-accounts" ||
        url.pathname === "/media-assets" ||
        mediaContentMatch ||
        mediaAssetMatch ||
        socialAccountMatch ||
        url.pathname.startsWith("/auth/")
      ) {
        response.setHeader(
          "Allow",
          url.pathname === "/posts"
            ? "GET, POST, OPTIONS"
            : url.pathname === "/media-assets"
              ? "GET, POST, OPTIONS"
            : mediaAssetMatch
              ? "GET, OPTIONS"
            : mediaContentMatch
              ? "GET, HEAD, OPTIONS"
            : url.pathname.startsWith("/social-accounts/")
              ? "GET, PATCH, DELETE, OPTIONS"
            : url.pathname === "/social-accounts"
                ? "GET, OPTIONS"
            : url.pathname === "/auth/me" ||
                url.pathname === "/auth/workspaces" ||
                url.pathname === "/auth/meta/callback" ||
                url.pathname === "/health"
              ? "GET, OPTIONS"
              : "POST, OPTIONS",
        );
        throw new RequestError(
          405,
          "method_not_allowed",
          "Método não permitido para este recurso.",
        );
      }

      throw new RequestError(
        404,
        "not_found",
        "O recurso solicitado não foi encontrado.",
      );
    } catch (error) {
      if (error instanceof RequestError) {
        sendRequestError(response, error);
        return;
      }

      if (error instanceof MediaRequestError) {
        sendJson(response, error.status, {
          error: { code: error.code, message: error.message },
        });
        return;
      }

      if (error instanceof InvalidPostsContextError) {
        sendJson(response, 403, {
          error: {
            code: "invalid_posts_context",
            message:
              "O usuário autenticado não possui acesso às publicações deste tenant.",
          },
        });
        return;
      }

      if (error instanceof PostMediaAssetNotFoundError) {
        sendJson(response, 404, {
          error: {
            code: "media_asset_not_found",
            message: error.message,
          },
        });
        return;
      }

      if (error instanceof InvalidSocialAccountsContextError) {
        sendJson(response, 403, {
          error: {
            code: "invalid_social_accounts_context",
            message:
              "O usuário autenticado não possui acesso às contas sociais deste tenant.",
          },
        });
        return;
      }

      if (error instanceof SocialAccountNotFoundError) {
        sendJson(response, 404, {
          error: {
            code: "social_account_not_found",
            message: "A conta social não foi encontrada.",
          },
        });
        return;
      }

      if (error instanceof MetaOAuthFlowError) {
        const notConfigured = error.code === "meta_oauth_not_configured";
        const sessionInvalid = error.code === "meta_oauth_session_invalid";
        sendJson(response, notConfigured ? 503 : sessionInvalid ? 401 : 400, {
          error: {
            code: error.code,
            message: notConfigured
              ? "A conexão Meta não está disponível neste ambiente."
              : sessionInvalid
                ? "A sessão usada para iniciar a conexão Meta não é mais válida."
                : "Não foi possível concluir a conexão com a Meta.",
          },
        });
        return;
      }

      if (error instanceof ForbiddenWorkspaceError) {
        sendJson(response, 403, {
          error: {
            code: "workspace_forbidden",
            message: error.message,
          },
        });
        return;
      }

      if (error instanceof DuplicateEmailError) {
        sendJson(response, 409, {
          error: {
            code: "email_already_registered",
            message: error.message,
          },
        });
        return;
      }

      if (error instanceof InvalidCredentialsError) {
        sendJson(response, 401, {
          error: {
            code: "invalid_credentials",
            message: error.message,
          },
        });
        return;
      }

      if (error instanceof UnauthorizedError) {
        sendJson(response, 401, {
          error: {
            code: "unauthorized",
            message: error.message,
          },
        });
        return;
      }

      logger.error("Erro interno ao processar a requisição.", error);
      sendJson(response, 500, {
        error: {
          code: "internal_error",
          message: "Não foi possível concluir a operação.",
        },
      });
    }
  });
}
