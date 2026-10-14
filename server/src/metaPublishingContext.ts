import type { Post } from "../../shared/postContract.ts";
import type { SocialAccount } from "../../shared/socialAccountContract.ts";
import { requiredPublishingScopes, type PublishingProvider } from "../../shared/publicationPolicy.ts";
import type { ClaimedPublication, PostPublicationsRepository } from "./postPublicationsRepository.ts";
import type { MetaPublishingCredential, SocialAccountsRepository } from "./socialAccountsRepository.ts";
import type { SocialTokenCipher } from "./socialTokenCrypto.ts";
import { InvalidSocialAccountsContextError } from "./postgresSocialAccountsRepository.ts";
import { PublicationError } from "./publicationErrors.ts";
import { waitForDatabaseQuery } from "./cancellableDatabaseWait.ts";

export type MetaContextDependencies = {
  repository: Pick<PostPublicationsRepository, "findPostForPublication">;
  accounts: Pick<SocialAccountsRepository, "findById" | "findMetaPublishingCredential">;
  cipher: Pick<SocialTokenCipher, "decryptSecret">;
  now?: () => Date;
};
/** Private server-side context. No request session or caller-supplied author is authoritative. */
export type MetaPublishingContext = {
  post: Post; account: SocialAccount; credential: MetaPublishingCredential;
  tenantId: string; authorUserId: string; provider: PublishingProvider;
};

export async function loadMetaPublishingContext(dependencies: MetaContextDependencies, target: ClaimedPublication,
  signal?: AbortSignal): Promise<MetaPublishingContext> {
  try {
    signal?.throwIfAborted();
    const post = await waitForDatabaseQuery(dependencies.repository.findPostForPublication(target.tenantId, target.postId), signal);
    if (!post) throw new PublicationError("publication_unavailable");
    const identity = { tenantId: target.tenantId, authorUserId: post.authorUserId };
    const account = await waitForDatabaseQuery(dependencies.accounts.findById(identity, target.socialAccountId), signal);
    if (!account || (account.provider !== "facebook" && account.provider !== "instagram") || account.disconnectedAt ||
      (account.status !== "connected" && account.status !== "expired")) throw new PublicationError("meta_page_unavailable");
    const credential = await waitForDatabaseQuery(dependencies.accounts.findMetaPublishingCredential(identity, target.socialAccountId), signal);
    if (credential && (credential.provider !== account.provider || credential.providerAccountId !== account.providerAccountId)) throw new PublicationError("meta_page_unavailable");
    const current = (dependencies.now?.() ?? new Date()).getTime();
    if (!credential?.accessTokenEncrypted || account.status === "expired" ||
      (credential.tokenExpiresAt !== null && (!Number.isFinite(Date.parse(credential.tokenExpiresAt)) || Date.parse(credential.tokenExpiresAt) <= current))) throw new PublicationError("meta_token_invalid");
    if (!Array.isArray(credential.scopes) || !requiredPublishingScopes(credential.provider).every(scope => credential.scopes.includes(scope)) ||
      !Array.isArray(credential.tasks) || (!credential.tasks.includes("CREATE_CONTENT") &&
        !(credential.provider === "instagram" && credential.tasks.includes("MANAGE")))) throw new PublicationError("meta_permission_denied");
    signal?.throwIfAborted();
    return { post, account, credential, ...identity, provider: account.provider };
  } catch (error) {
    if (error instanceof InvalidSocialAccountsContextError) throw new PublicationError("publication_author_unavailable");
    throw error;
  }
}

export function decryptMetaAccessToken(dependencies: MetaContextDependencies, context: MetaPublishingContext): string {
  try {
    const token = dependencies.cipher.decryptSecret(context.credential.accessTokenEncrypted!);
    if (!token) throw new Error();
    return token;
  } catch { throw new PublicationError("meta_token_invalid"); }
}
