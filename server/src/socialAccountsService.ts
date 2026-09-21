import {
  isHttpUrl,
  isSocialAccountProvider,
  isSocialAccountStatus,
  type SocialAccount,
  type UpdateSocialAccountInput,
} from "../../shared/socialAccountContract.ts";
import { isValidPostTimestamp } from "../../shared/postContract.ts";
import type {
  ProviderMetadata,
  RegisterSocialAccountInput,
  SocialAccountsContext,
  SocialAccountsRepository,
} from "./socialAccountsRepository.ts";
import type { SocialTokenCipher } from "./socialTokenCrypto.ts";

const MAX_SECRET_LENGTH = 8_192;
const ALLOWED_PROVIDER_METADATA_KEYS = new Set([
  "accountType",
  "businessAccountId",
  "category",
  "locale",
  "pageId",
]);

export class SocialAccountNotFoundError extends Error {
  constructor() {
    super("A conta social não foi encontrada.");
    this.name = "SocialAccountNotFoundError";
  }
}

export class InvalidSocialAccountInputError extends Error {
  constructor(message = "Os dados da conta social são inválidos.") {
    super(message);
    this.name = "InvalidSocialAccountInputError";
  }
}

function isValidSecret(value: string | null | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    (value.length > 0 && value.length <= MAX_SECRET_LENGTH)
  );
}

function isValidMetadata(metadata: ProviderMetadata | undefined): boolean {
  if (metadata === undefined) return true;
  const entries = Object.entries(metadata);
  return (
    entries.length <= 20 &&
    entries.every(
      ([key, value]) =>
        ALLOWED_PROVIDER_METADATA_KEYS.has(key) &&
        (value === null ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" && value.length <= 500)),
    )
  );
}

function normalizeRegisterInput(
  input: RegisterSocialAccountInput,
): RegisterSocialAccountInput {
  const providerAccountId = input.providerAccountId.trim();
  const displayName = input.displayName.trim();
  const username = input.username?.trim() || null;
  const scopes = input.scopes ?? [];
  const status: unknown = input.status;
  if (
    !isSocialAccountProvider(input.provider) ||
    providerAccountId.length === 0 ||
    providerAccountId.length > 255 ||
    displayName.length === 0 ||
    displayName.length > 120 ||
    (username !== null && username.length > 100) ||
    (input.profileImageUrl !== undefined &&
      input.profileImageUrl !== null &&
      !isHttpUrl(input.profileImageUrl)) ||
    (status !== undefined &&
      (!isSocialAccountStatus(status) || status === "revoked")) ||
    (input.tokenExpiresAt !== undefined &&
      input.tokenExpiresAt !== null &&
      !isValidPostTimestamp(input.tokenExpiresAt)) ||
    scopes.length > 50 ||
    new Set(scopes).size !== scopes.length ||
    scopes.some(
      (scope) => scope.trim().length === 0 || scope.length > 100,
    ) ||
    !isValidSecret(input.accessToken) ||
    !isValidSecret(input.refreshToken) ||
    (status === "connected" && !input.accessToken) ||
    !isValidMetadata(input.providerMetadata)
  ) {
    throw new InvalidSocialAccountInputError();
  }

  return {
    ...input,
    displayName,
    providerAccountId,
    scopes: scopes.map((scope) => scope.trim()),
    username,
  };
}

export class SocialAccountsService {
  private readonly cipher: SocialTokenCipher;
  private readonly repository: SocialAccountsRepository;

  constructor(
    repository: SocialAccountsRepository,
    cipher: SocialTokenCipher,
  ) {
    this.repository = repository;
    this.cipher = cipher;
  }

  list(context: SocialAccountsContext): Promise<SocialAccount[]> {
    return this.repository.list(context);
  }

  async get(
    context: SocialAccountsContext,
    id: string,
  ): Promise<SocialAccount> {
    const account = await this.repository.findById(context, id);
    if (!account) throw new SocialAccountNotFoundError();
    return account;
  }

  async register(
    context: SocialAccountsContext,
    input: RegisterSocialAccountInput,
  ): Promise<SocialAccount> {
    const normalized = normalizeRegisterInput(input);
    const { accessToken, refreshToken, ...persistable } = normalized;
    return this.repository.register(context, {
      ...persistable,
      accessTokenEncrypted: accessToken
        ? this.cipher.encryptSecret(accessToken)
        : null,
      refreshTokenEncrypted: refreshToken
        ? this.cipher.encryptSecret(refreshToken)
        : null,
    });
  }

  async update(
    context: SocialAccountsContext,
    id: string,
    input: UpdateSocialAccountInput,
  ): Promise<SocialAccount> {
    const account = await this.repository.update(context, id, input);
    if (!account) throw new SocialAccountNotFoundError();
    return account;
  }

  async disconnect(
    context: SocialAccountsContext,
    id: string,
  ): Promise<SocialAccount> {
    const account = await this.repository.disconnect(context, id);
    if (!account) throw new SocialAccountNotFoundError();
    return account;
  }
}
