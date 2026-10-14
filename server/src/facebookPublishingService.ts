import type { MediaAssetsService } from "./mediaAssetsService.ts";
import { MetaPublishingClientError, type MetaPublishingProviderClient } from "./metaPublishingClient.ts";
import type { ClaimedPublication, PostPublicationsRepository } from "./postPublicationsRepository.ts";
import { InvalidSocialAccountsContextError } from "./postgresSocialAccountsRepository.ts";
import { PublicationError, PublicationOperationalError } from "./publicationErrors.ts";
import type { SocialAccountsRepository } from "./socialAccountsRepository.ts";
import type { SocialTokenCipher } from "./socialTokenCrypto.ts";
import { MetaPublishingSteps, type OperationRepositories, type PublishingStep } from "./publishingService.ts";
import { loadMetaPublishingContext, decryptMetaAccessToken, type MetaPublishingContext } from "./metaPublishingContext.ts";
import { createReadStream, read } from "node:fs";
import { finished } from "node:stream/promises";

export class FacebookPublishingService {
  private readonly repository: Pick<PostPublicationsRepository, "findPostForPublication" | "markPublished">;
  private readonly accounts: Pick<SocialAccountsRepository, "findById" | "findMetaPublishingCredential">;
  private readonly cipher: Pick<SocialTokenCipher, "decryptSecret">;
  private readonly media: Pick<MediaAssetsService, "getPublishingContent"> & Partial<Pick<MediaAssetsService, "openPublishingFile">>;
  private readonly provider: MetaPublishingProviderClient;
  private readonly now: () => Date;
  private readonly operations?: OperationRepositories;

  constructor(
    repository: Pick<PostPublicationsRepository, "findPostForPublication" | "markPublished">,
    accounts: Pick<SocialAccountsRepository, "findById" | "findMetaPublishingCredential">,
    cipher: Pick<SocialTokenCipher, "decryptSecret">,
    media: Pick<MediaAssetsService, "getPublishingContent"> & Partial<Pick<MediaAssetsService, "openPublishingFile">>,
    provider: MetaPublishingProviderClient,
    now: () => Date = () => new Date(),
    operations?: OperationRepositories,
  ) {
    this.repository = repository;
    this.accounts = accounts;
    this.cipher = cipher;
    this.media = media;
    this.provider = provider;
    this.now = now;
    this.operations = operations;
  }

  async advance(step: PublishingStep, resolved?: MetaPublishingContext): Promise<void> {
    if (!step.operation) { await this.publish(step.target); return; }
    if (!this.operations || !this.media.openPublishingFile) throw new PublicationOperationalError();
    const dependencies = { repository: this.repository, accounts: this.accounts, cipher: this.cipher, now: this.now,
      client: this.provider, operations: this.operations, media: { openPublishingFile: this.media.openPublishingFile.bind(this.media) } };
    const steps = new MetaPublishingSteps(dependencies);
    await steps.run(step, resolved, "facebook", async (lease, context) => {
      if (["prepared", "created", "ready"].includes(lease.stage)) {
        await steps.preparedFile(step, lease, async (file, latest, mayEmit) => {
          if (!["video/mp4", "video/quicktime"].includes(file.mimeType) || file.sizeBytes > 262144000) throw new PublicationError("media_unavailable");
          const accessToken = decryptMetaAccessToken(dependencies, latest);
          const input = { graphApiVersion: lease.graphApiVersion, accessToken, pageId: lease.providerAccountId };
          if (lease.stage === "prepared") {
            if (!await steps.checkpoint(lease, "creating", { nextActionAt: null })) return;
            if (!mayEmit()) return;
            const intent = { ...lease, stage: "creating" as const }; let result: { videoId: string } | undefined;
            await steps.mutation(intent, async () => { result = await this.provider.startFacebookReel(input); }, async () => {});
            if (result) await steps.checkpoint(intent, "created", { externalId: result.videoId });
          } else if (lease.stage === "created") {
            if (!lease.externalId || !await steps.checkpoint(lease, "uploading", { nextActionAt: null })) return;
            if (!mayEmit()) return;
            const intent = { ...lease, stage: "uploading" as const };
            // The stream is non-owning even on destroy/error. This service closes the verified handle.
            const source = createReadStream("", { fd: file.handle.fd, autoClose: false,
              fs: { read, close: (_fd, callback) => callback(null) }, start: 0, end: file.sizeBytes - 1 });
            // Observe stream errors immediately, including destruction by the HTTP client.
            const settled = finished(source, { cleanup: true }).catch(() => {});
            let uploaded = false;
            try {
              await steps.mutation(intent, async () => { await this.provider.uploadFacebookReel({ ...input, videoId: lease.externalId!, source, sizeBytes: file.sizeBytes }); uploaded = true; },
                async () => { await steps.checkpoint(intent, "uploading", { nextActionAt: steps.nextPoll(intent) }); });
            } finally { source.destroy(); await settled; }
            if (uploaded) await steps.checkpoint(intent, "processing", { nextActionAt: steps.nextPoll(intent) });
          } else {
            if (!lease.externalId || !await steps.checkpoint(lease, "publishing", { nextActionAt: null })) return;
            if (!mayEmit()) return;
            const intent = { ...lease, stage: "publishing" as const }; let accepted = false;
            await steps.mutation(intent, async () => { await this.provider.finishFacebookReel({ ...input, videoId: lease.externalId!, caption: latest.post.caption }); accepted = true; },
              async () => { await steps.checkpoint(intent, "verifying", { nextActionAt: steps.nextPoll(intent) }); });
            if (accepted) await steps.checkpoint(intent, "verifying", { nextActionAt: steps.nextPoll(intent) });
          }
        });
      } else if (["uploading", "processing", "publishing", "verifying"].includes(lease.stage)) {
        if (!lease.externalId || !await steps.reserve(lease)) return;
        if (!steps.mayQuery(step, lease, context)) return;
        const accessToken = decryptMetaAccessToken(dependencies, context);
        let result: Awaited<ReturnType<MetaPublishingProviderClient["getFacebookReelStatus"]>>;
        try { result = await this.provider.getFacebookReelStatus({ graphApiVersion: lease.graphApiVersion, accessToken, videoId: lease.externalId }); }
        catch (error) { await steps.pollFailure(lease, error); return; }
        if (result.published && (lease.stage === "publishing" || lease.stage === "verifying")) { await steps.succeeded(lease, lease.externalId); return; }
        if ([result.uploadingPhase, result.processingPhase, result.publishingPhase].includes("error") ||
          ["error", "expired", "upload_failed"].includes(result.videoStatus)) { await steps.fail(lease, "meta_container_error"); return; }
        if (lease.stage === "uploading" && result.uploadingPhase === "not_started" && result.uploadedBytes !== null && result.uploadedBytes > 0) {
          await steps.fail(lease, "media_unavailable"); return;
        }
        const completeUpload = result.uploadingPhase === "complete" || result.videoStatus === "upload_complete";
        const nextStage = lease.stage === "publishing" ? "verifying" : completeUpload && lease.stage === "uploading" ? "processing" :
          completeUpload && lease.stage === "processing" ? "ready" : lease.stage;
        await steps.checkpoint(lease, nextStage, { nextActionAt: nextStage === "ready" ? steps.now() : steps.nextPoll(lease) });
      }
    });
  }

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
    const dependencies = { repository: this.repository, accounts: this.accounts, cipher: this.cipher, now: this.now };
    let context = await loadMetaPublishingContext(dependencies, publication);
    const { post } = context;
    if (context.provider !== "facebook") throw new PublicationError("meta_page_unavailable");
    let image: Awaited<ReturnType<MediaAssetsService["getPublishingContent"]>> | undefined;
    if (post.mediaAssetIds.length > 0) {
      if (post.mediaAssetIds.length !== 1) throw new PublicationError("media_unavailable");
      try {
        image = await this.media.getPublishingContent({ tenantId: context.tenantId, authorUserId: context.authorUserId }, post.mediaAssetIds[0]);
        if (!["image/jpeg", "image/png"].includes(image.mimeType) || image.sizeBytes > 4_000_000) throw new Error();
      } catch {
        throw new PublicationError("media_unavailable");
      }
      // Media I/O can outlive authority or token validity. Reload through the same
      // tenant/author-qualified loader and decrypt only the current credential.
      context = await loadMetaPublishingContext(dependencies, publication);
      if (context.provider !== "facebook") throw new PublicationError("meta_page_unavailable");
    }
    const { credential } = context;
    const accessToken = decryptMetaAccessToken(dependencies, context);
    let providerPostId: string;
    try {
      const input = { accessToken, pageId: credential.providerAccountId, message: post.caption };
      const result = image
        ? await this.provider.publishPhoto({ ...input, source: image.source, mimeType: image.mimeType })
        : await this.provider.publishText(input);
      providerPostId = result.providerPostId;
    } catch (error) {
      if (error instanceof MetaPublishingClientError) {
        if (error.outcome === "unknown") throw new PublicationOperationalError();
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
