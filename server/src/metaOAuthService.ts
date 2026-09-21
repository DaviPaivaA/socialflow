import { createHash, randomBytes } from "node:crypto";
import type { SocialAccount } from "../../shared/socialAccountContract.ts";
import type { AuthContext } from "./authService.ts";
import {
  META_OAUTH_SCOPES,
  MetaOAuthClientError,
  type MetaOAuthConfig,
  type MetaOAuthProviderClient,
  type MetaPage,
} from "./metaOAuthClient.ts";
import type { MetaOAuthStateRepository } from "./metaOAuthStateRepository.ts";
import type {
  PersistMetaSocialAccountInput,
  SocialAccountsRepository,
} from "./socialAccountsRepository.ts";
import { InvalidMetaAuthorizationContextError } from "./socialAccountsRepository.ts";
import type { SocialTokenCipher } from "./socialTokenCrypto.ts";

export type MetaOAuthCallbackInput = {
  code: string | null;
  error: string | null;
  errorReason: string | null;
  state: string | null;
};

type MetaOAuthFlowErrorCode =
  | "meta_oauth_cancelled"
  | "meta_oauth_expired_state"
  | "meta_oauth_invalid_state"
  | "meta_oauth_no_accounts"
  | "meta_oauth_not_configured"
  | "meta_oauth_provider_error"
  | "meta_oauth_session_invalid";

export class MetaOAuthFlowError extends Error {
  readonly code: MetaOAuthFlowErrorCode;

  constructor(code: MetaOAuthFlowErrorCode) {
    super("Não foi possível concluir a conexão com a Meta.");
    this.name = "MetaOAuthFlowError";
    this.code = code;
  }
}

type MetaOAuthServiceOptions = {
  now?: () => number;
  randomState?: () => string;
};

function stateHash(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

function isValidState(state: string | null): state is string {
  return typeof state === "string" && /^[A-Za-z0-9_-]{43}$/.test(state);
}

function isCancelled(input: MetaOAuthCallbackInput): boolean {
  return (
    input.error === "access_denied" ||
    input.errorReason === "user_denied" ||
    input.errorReason === "user_denied_request"
  );
}

function uniqueGrantedScopes(
  permissions: Awaited<ReturnType<MetaOAuthProviderClient["getPermissions"]>>,
): string[] {
  const scopes = [
    ...new Set(
      permissions
        .filter((permission) => permission.status === "granted")
        .map((permission) => permission.name),
    ),
  ];
  if (scopes.length > 50) {
    throw new MetaOAuthFlowError("meta_oauth_provider_error");
  }
  return scopes;
}

function facebookAccount(
  page: MetaPage,
  cipher: SocialTokenCipher,
): PersistMetaSocialAccountInput {
  return {
    accessTokenEncrypted: cipher.encryptSecret(page.accessToken),
    displayName: page.name,
    metadata: { tasks: page.tasks },
    profileImageUrl: page.profileImageUrl,
    provider: "facebook",
    providerAccountId: page.id,
    tokenExpiresAt: null,
    username: page.username,
  };
}

export class MetaOAuthService {
  private readonly client: MetaOAuthProviderClient | null;
  private readonly config: MetaOAuthConfig;
  private readonly now: () => number;
  private readonly randomState: () => string;
  private readonly socialAccountsRepository: SocialAccountsRepository;
  private readonly stateRepository: MetaOAuthStateRepository;
  private readonly tokenCipher: SocialTokenCipher;

  constructor(
    config: MetaOAuthConfig,
    client: MetaOAuthProviderClient | null,
    stateRepository: MetaOAuthStateRepository,
    socialAccountsRepository: SocialAccountsRepository,
    tokenCipher: SocialTokenCipher,
    { now = Date.now, randomState }: MetaOAuthServiceOptions = {},
  ) {
    this.config = config;
    this.client = client;
    this.stateRepository = stateRepository;
    this.socialAccountsRepository = socialAccountsRepository;
    this.tokenCipher = tokenCipher;
    this.now = now;
    this.randomState =
      randomState ?? (() => randomBytes(32).toString("base64url"));
  }

  async start(context: AuthContext): Promise<string> {
    const client = this.requireClient();
    const state = this.randomState();
    if (!isValidState(state)) {
      throw new Error("O gerador de state OAuth retornou um valor inválido.");
    }
    const expiresAt = new Date(
      this.now() + this.config.stateTtlSeconds * 1_000,
    ).toISOString();
    const created = await this.stateRepository.create(
      context,
      stateHash(state),
      expiresAt,
    );
    if (!created) {
      throw new MetaOAuthFlowError("meta_oauth_session_invalid");
    }
    return client.buildAuthorizationUrl(state);
  }

  async complete(
    context: AuthContext,
    input: MetaOAuthCallbackInput,
  ): Promise<SocialAccount[]> {
    const client = this.requireClient();
    if (!isValidState(input.state)) {
      throw new MetaOAuthFlowError("meta_oauth_invalid_state");
    }
    const consumedStateHash = stateHash(input.state);
    const consumed = await this.stateRepository.consume(
      context,
      consumedStateHash,
    );
    if (!consumed.success) {
      throw new MetaOAuthFlowError(
        consumed.reason === "expired"
          ? "meta_oauth_expired_state"
          : consumed.reason === "session_invalid"
            ? "meta_oauth_session_invalid"
            : "meta_oauth_invalid_state",
      );
    }
    if (isCancelled(input)) {
      throw new MetaOAuthFlowError("meta_oauth_cancelled");
    }
    if (
      input.error ||
      typeof input.code !== "string" ||
      input.code.length === 0 ||
      input.code.length > 4_096
    ) {
      throw new MetaOAuthFlowError("meta_oauth_provider_error");
    }

    try {
      const shortLivedToken = await client.exchangeCode(input.code);
      const userToken = await client.exchangeForLongLivedToken(
        shortLivedToken.accessToken,
      );
      const [identity, permissions] = await Promise.all([
        client.getIdentity(userToken.accessToken),
        client.getPermissions(userToken.accessToken),
      ]);
      const grantedScopes = uniqueGrantedScopes(permissions);
      if (!grantedScopes.includes("pages_show_list")) {
        throw new MetaOAuthFlowError("meta_oauth_provider_error");
      }

      const pages = await client.listPages(userToken.accessToken);
      if (pages.length === 0) {
        throw new MetaOAuthFlowError("meta_oauth_no_accounts");
      }
      const canDiscoverInstagram =
        grantedScopes.includes("instagram_basic") &&
        grantedScopes.includes("pages_read_engagement");
      const accounts = new Map<string, PersistMetaSocialAccountInput>();
      const unverifiedInstagramAccountIds = new Set<string>();

      for (const page of pages) {
        accounts.set(`facebook:${page.id}`, facebookAccount(page, this.tokenCipher));
        if (!page.instagramBusinessAccountId) {
          continue;
        }
        if (!canDiscoverInstagram) {
          unverifiedInstagramAccountIds.add(page.instagramBusinessAccountId);
          continue;
        }
        try {
          const instagram = await client.getInstagramAccount(
            page.instagramBusinessAccountId,
            page.accessToken,
          );
          accounts.set(`instagram:${instagram.id}`, {
            accessTokenEncrypted: this.tokenCipher.encryptSecret(
              page.accessToken,
            ),
            displayName: instagram.displayName,
            metadata: { pageId: page.id },
            profileImageUrl: instagram.profileImageUrl,
            provider: "instagram",
            providerAccountId: instagram.id,
            tokenExpiresAt: null,
            username: instagram.username,
          });
        } catch (error) {
          if (!(error instanceof MetaOAuthClientError)) throw error;
          // O vínculo foi observado na Page, mas o perfil não pôde ser
          // confirmado agora. Preserve somente uma conta já existente; o
          // repository não cria dados a partir deste identificador.
          unverifiedInstagramAccountIds.add(page.instagramBusinessAccountId);
        }
      }

      return await this.socialAccountsRepository.upsertMetaAuthorization(
        {
          authorUserId: context.user.id,
          membershipId: context.membershipId,
          sessionId: context.sessionId,
          stateHash: consumedStateHash,
          tenantId: context.tenant.id,
        },
        {
          accounts: [...accounts.values()],
          externalUserId: identity.id,
          grantedScopes,
          unverifiedInstagramAccountIds: [
            ...unverifiedInstagramAccountIds,
          ],
          userAccessTokenEncrypted: this.tokenCipher.encryptSecret(
            userToken.accessToken,
          ),
          userAccessTokenExpiresAt: userToken.expiresAt,
        },
      );
    } catch (error) {
      if (error instanceof MetaOAuthFlowError) throw error;
      if (error instanceof InvalidMetaAuthorizationContextError) {
        throw new MetaOAuthFlowError("meta_oauth_session_invalid");
      }
      throw new MetaOAuthFlowError("meta_oauth_provider_error");
    }
  }

  private requireClient(): MetaOAuthProviderClient {
    if (!this.config.enabled || !this.client) {
      throw new MetaOAuthFlowError("meta_oauth_not_configured");
    }
    return this.client;
  }
}

export function metaOAuthRequestedScopes(): readonly string[] {
  return META_OAUTH_SCOPES;
}
