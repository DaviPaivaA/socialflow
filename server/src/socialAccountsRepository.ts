import type {
  SocialAccount,
  SocialAccountProvider,
  SocialAccountStatus,
  UpdateSocialAccountInput,
} from "../../shared/socialAccountContract.ts";
import type { PostsContext } from "./postsContext.ts";

export type SocialAccountsContext = PostsContext;

export type MetaAuthorizationContext = SocialAccountsContext & {
  membershipId: string;
  sessionId: string;
  stateHash: string;
};

export type ProviderMetadataValue = string | number | boolean | null;
export type ProviderMetadata = Record<string, ProviderMetadataValue>;

export type RegisterSocialAccountInput = {
  accessToken?: string | null;
  displayName: string;
  profileImageUrl?: string | null;
  provider: SocialAccountProvider;
  providerAccountId: string;
  providerMetadata?: ProviderMetadata;
  refreshToken?: string | null;
  scopes?: string[];
  status?: Exclude<SocialAccountStatus, "revoked">;
  tokenExpiresAt?: string | null;
  username?: string | null;
};

export type PersistSocialAccountInput = Omit<
  RegisterSocialAccountInput,
  "accessToken" | "refreshToken"
> & {
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
};

export type PersistMetaSocialAccountInput = {
  accessTokenEncrypted: string;
  displayName: string;
  metadata: { pageId?: string; tasks?: string[] };
  profileImageUrl: string | null;
  provider: "facebook" | "instagram";
  providerAccountId: string;
  tokenExpiresAt: string | null;
  username: string | null;
};

export type PersistMetaAuthorizationInput = {
  accounts: PersistMetaSocialAccountInput[];
  externalUserId: string;
  grantedScopes: string[];
  unverifiedInstagramAccountIds: string[];
  userAccessTokenEncrypted: string;
  userAccessTokenExpiresAt: string | null;
};

export class InvalidMetaAuthorizationContextError extends Error {
  constructor() {
    super("A sessão usada na autorização Meta não é mais válida.");
    this.name = "InvalidMetaAuthorizationContextError";
  }
}

export interface SocialAccountsRepository {
  assertContext(context: SocialAccountsContext): Promise<void>;
  disconnect(
    context: SocialAccountsContext,
    id: string,
  ): Promise<SocialAccount | null>;
  findById(
    context: SocialAccountsContext,
    id: string,
  ): Promise<SocialAccount | null>;
  list(context: SocialAccountsContext): Promise<SocialAccount[]>;
  register(
    context: SocialAccountsContext,
    input: PersistSocialAccountInput,
  ): Promise<SocialAccount>;
  update(
    context: SocialAccountsContext,
    id: string,
    input: UpdateSocialAccountInput,
  ): Promise<SocialAccount | null>;
  upsertMetaAuthorization(
    context: MetaAuthorizationContext,
    input: PersistMetaAuthorizationInput,
  ): Promise<SocialAccount[]>;
}
