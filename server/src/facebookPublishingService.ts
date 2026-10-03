import type { MediaAssetsService } from "./mediaAssetsService.ts";
import { MetaPublishingClientError, type MetaPublishingProviderClient } from "./metaPublishingClient.ts";
import type { ClaimedPublication, PostPublicationsRepository } from "./postPublicationsRepository.ts";
import { InvalidSocialAccountsContextError } from "./postgresSocialAccountsRepository.ts";
import { PublicationError, PublicationOperationalError } from "./publicationErrors.ts";
import type { SocialAccountsRepository } from "./socialAccountsRepository.ts";
import type { SocialTokenCipher } from "./socialTokenCrypto.ts";

export class FacebookPublishingService {
  constructor(
    private readonly repository: Pick<PostPublicationsRepository, "findPostForPublication" | "markPublished">,
    private readonly accounts: Pick<SocialAccountsRepository, "findById" | "findFacebookPublishingCredential">,
    private readonly cipher: Pick<SocialTokenCipher, "decryptSecret">,
    private readonly media: Pick<MediaAssetsService, "getPublishingContent">,
    private readonly provider: MetaPublishingProviderClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publish(publication: ClaimedPublication): Promise<void> {
    try {
      await this.publishClaim(publication);
    } catch (error) {
      if (error instanceof PublicationError || error instanceof PublicationOperationalError) throw error;
      if (error instanceof InvalidSocialAccountsContextError) throw new PublicationError("publication_author_unavailable");
      // Storage/DB exceptions are never exposed and must not become provider failures.
      throw new PublicationOperationalError();
    }
  }

  private async publishClaim(publication: ClaimedPublication): Promise<void> {
    const post = await this.repository.findPostForPublication(publication.tenantId, publication.postId);
    if (!post) throw new PublicationError("publication_unavailable");
    const context = { tenantId: publication.tenantId, authorUserId: post.authorUserId };
    const account = await this.accounts.findById(context, publication.socialAccountId);
    if (!account || account.provider !== "facebook" || account.disconnectedAt || (account.status !== "connected" && account.status !== "expired")) {
      throw new PublicationError("meta_page_unavailable");
    }
    const credential = await this.accounts.findFacebookPublishingCredential(context, publication.socialAccountId);
    if (!credential?.accessTokenEncrypted || account.status === "expired" ||
      (credential.tokenExpiresAt !== null && (!Number.isFinite(Date.parse(credential.tokenExpiresAt)) || Date.parse(credential.tokenExpiresAt) <= this.now().getTime()))) {
      throw new PublicationError("meta_token_invalid");
    }
    if (!["pages_show_list", "pages_read_engagement", "pages_manage_posts"].every(scope => credential.scopes.includes(scope)) ||
      !Array.isArray(credential.tasks) || !credential.tasks.includes("CREATE_CONTENT")) {
      throw new PublicationError("meta_permission_denied");
    }
    let image: Awaited<ReturnType<MediaAssetsService["getPublishingContent"]>> | undefined;
    if (post.mediaAssetIds.length > 0) {
      if (post.mediaAssetIds.length !== 1) throw new PublicationError("media_unavailable");
      try {
        image = await this.media.getPublishingContent(context, post.mediaAssetIds[0]);
        if (!["image/jpeg", "image/png"].includes(image.mimeType) || image.sizeBytes > 4_000_000) throw new Error();
      } catch {
        throw new PublicationError("media_unavailable");
      }
    }
    let accessToken: string;
    try {
      accessToken = this.cipher.decryptSecret(credential.accessTokenEncrypted);
      if (!accessToken) throw new Error();
    } catch {
      throw new PublicationError("meta_token_invalid");
    }
    let providerPostId: string;
    try {
      const input = { accessToken, pageId: credential.providerAccountId, message: post.caption };
      const result = image
        ? await this.provider.publishPhoto({ ...input, source: image.source, mimeType: image.mimeType })
        : await this.provider.publishText(input);
      providerPostId = result.providerPostId;
    } catch (error) {
      if (error instanceof MetaPublishingClientError) {
        throw new PublicationError(error.kind === "invalid_response" ? "meta_provider_error" : error.kind);
      }
      throw new PublicationOperationalError();
    }
    // Keep this outside provider error normalization: Meta may already have published.
    try {
      await this.repository.markPublished({ id: publication.id, tenantId: publication.tenantId, providerPostId, publishedAt: this.now() });
    } catch {
      throw new PublicationOperationalError();
    }
  }
}
