import { MetaPublishingSteps, type MetaStepDependencies, type PublishingStep } from "./publishingService.ts";
import { decryptMetaAccessToken, type MetaPublishingContext } from "./metaPublishingContext.ts";
import type { MetaMediaConfig, MetaMediaSigner } from "./metaMediaSigner.ts";
import { PublicationError } from "./publicationErrors.ts";

export class InstagramPublishingService {
  private readonly steps: MetaPublishingSteps;
  private readonly dependencies: MetaStepDependencies & { signer: Pick<MetaMediaSigner, "createUrl">; config: NonNullable<MetaMediaConfig> };
  constructor(dependencies: InstagramPublishingService["dependencies"]) {
    this.dependencies = dependencies;
    this.steps = new MetaPublishingSteps(dependencies);
  }
  async advance(step: PublishingStep, resolved?: MetaPublishingContext): Promise<void> {
    await this.steps.run(step, resolved, "instagram", async (lease, context) => {
      const client = this.dependencies.client;
      if (lease.stage === "prepared" || lease.stage === "ready") {
        await this.steps.preparedFile(step, lease, async (file, latest, mayEmit) => {
          if ((lease.kind === "instagram_image" && (file.mimeType !== "image/jpeg" || file.sizeBytes > 8000000)) ||
            (lease.kind === "instagram_reel" && (!["video/mp4", "video/quicktime"].includes(file.mimeType) || file.sizeBytes > 262144000))) throw new PublicationError("media_unavailable");
          if (latest.post.caption.length > 2200) throw new PublicationError("meta_invalid_request");
          const accessToken = decryptMetaAccessToken(this.dependencies, latest);
          const input = { graphApiVersion: lease.graphApiVersion, accessToken, accountId: lease.providerAccountId };
          if (lease.stage === "prepared") {
            const issuedAt = Math.floor(this.steps.now().getTime() / 1000); const expiresAt = issuedAt + this.dependencies.config.ttlSeconds;
            const url = this.dependencies.signer.createUrl({ v: 1, publicationId: lease.publicationId, assetId: lease.mediaAssetId, issuedAt, expiresAt });
            if (!await this.steps.checkpoint(lease, "creating", { delivery: { issuedAt: new Date(issuedAt * 1000), expiresAt: new Date(expiresAt * 1000) }, nextActionAt: null })) return;
            if (!mayEmit()) return;
            const intent = { ...lease, stage: "creating" as const };
            let result: { containerId: string } | undefined;
            await this.steps.mutation(intent, async () => { result = await client.createInstagramContainer({ ...input, caption: latest.post.caption,
              media: { kind: lease.kind === "instagram_image" ? "image" : "reel", url } }); }, async () => {});
            if (result) await this.steps.checkpoint(intent, "created", { externalId: result.containerId });
          } else {
            if (!lease.externalId) throw new PublicationError("publication_unavailable");
            if (!await this.steps.checkpoint(lease, "publishing", { nextActionAt: null })) return;
            if (!mayEmit()) return;
            const intent = { ...lease, stage: "publishing" as const };
            let result: { providerPostId: string } | undefined;
            await this.steps.mutation(intent, async () => { result = await client.publishInstagramContainer({ ...input, containerId: lease.externalId! }); },
              async () => { await this.steps.checkpoint(intent, "verifying", { nextActionAt: this.steps.nextPoll(intent) }); });
            if (result) await this.steps.succeeded(intent, result.providerPostId);
          }
        });
      } else if (lease.stage === "created") {
        await this.steps.checkpoint(lease, "processing", { nextActionAt: this.steps.nextPoll(lease) });
      } else if (["processing", "publishing", "verifying"].includes(lease.stage)) {
        if (!lease.externalId || !await this.steps.reserve(lease)) return;
        if (!this.steps.mayQuery(step, lease, context)) return;
        const accessToken = decryptMetaAccessToken(this.dependencies, context);
        let result: Awaited<ReturnType<typeof client.getInstagramContainerStatus>>;
        try { result = await client.getInstagramContainerStatus({ graphApiVersion: lease.graphApiVersion, accessToken, containerId: lease.externalId }); }
        catch (error) { await this.steps.pollFailure(lease, error); return; }
        if (result.status === "ERROR" || result.status === "EXPIRED") await this.steps.fail(lease, result.status === "ERROR" ? "meta_container_error" : "meta_container_expired");
        else if (result.status === "PUBLISHED") {
          // PUBLISHED is recovery evidence, never use the container ID as a media ID.
          if (lease.stage === "publishing" || lease.stage === "verifying") await this.steps.succeeded(lease, null);
          else await this.steps.fail(lease, "publication_state_unknown", true);
        } else await this.steps.checkpoint(lease, lease.stage === "processing" && result.status === "FINISHED" ? "ready" :
          lease.stage === "publishing" ? "verifying" : lease.stage, { nextActionAt: result.status === "FINISHED" && lease.stage === "processing" ? this.steps.now() : this.steps.nextPoll(lease) });
      }
    });
  }
}
