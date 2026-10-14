import type { MetaMediaClaims, MetaMediaSigner } from "./metaMediaSigner.ts";
import type { MediaDeliveryBinding, PostgresPublicationOperationsRepository } from "./publicationOperationsRepository.ts";
import type { SocialAccountsRepository } from "./socialAccountsRepository.ts";
import { InvalidSocialAccountsContextError } from "./postgresSocialAccountsRepository.ts";
import { MediaContentUnavailableError, MediaRequestError } from "./mediaErrors.ts";
import type { MediaAssetsService } from "./mediaAssetsService.ts";
import type { VerifiedMediaHandle } from "./mediaContent.ts";
import { requiredPublishingScopes } from "../../shared/publicationPolicy.ts";
import { waitForDatabaseQuery } from "./cancellableDatabaseWait.ts";

function notFound(): MediaRequestError { return new MediaRequestError(404, "media_asset_not_found", "A mídia não foi encontrada."); }

export class MetaMediaDeliveryService {
  private readonly signer: MetaMediaSigner;
  private readonly repository: Pick<PostgresPublicationOperationsRepository, "findDeliveryBinding">;
  private readonly accounts: Pick<SocialAccountsRepository, "findMetaPublishingCredential">;
  private readonly files: Pick<MediaAssetsService, "openPublishingFile">;
  private readonly clock: () => Date;
  constructor(signer: MetaMediaSigner, repository: Pick<PostgresPublicationOperationsRepository, "findDeliveryBinding">,
    accounts: Pick<SocialAccountsRepository, "findMetaPublishingCredential">, files: Pick<MediaAssetsService, "openPublishingFile">, clock: () => Date = () => new Date()) {
    this.signer = signer; this.repository = repository; this.accounts = accounts; this.files = files; this.clock = clock;
  }
  private async authorize(claims: MetaMediaClaims, signal: AbortSignal): Promise<MediaDeliveryBinding> {
    signal.throwIfAborted();
    const binding = await waitForDatabaseQuery(this.repository.findDeliveryBinding(claims.publicationId, claims.assetId), signal);
    if (!binding || binding.issuedAt.getTime() !== claims.issuedAt * 1000 || binding.expiresAt.getTime() !== claims.expiresAt * 1000) throw notFound();
    signal.throwIfAborted();
    const credential = await waitForDatabaseQuery(this.accounts.findMetaPublishingCredential(binding, binding.socialAccountId), signal);
    const current = this.clock().getTime();
    if (binding.deadlineAt.getTime() <= current || current >= claims.expiresAt * 1000) throw notFound();
    if (!credential?.accessTokenEncrypted || credential.provider !== "instagram" || credential.providerAccountId !== binding.providerAccountId ||
      !requiredPublishingScopes("instagram").every(scope => credential.scopes.includes(scope)) ||
      (!credential.tasks.includes("CREATE_CONTENT") && !credential.tasks.includes("MANAGE")) ||
      (credential.tokenExpiresAt !== null && (!Number.isFinite(Date.parse(credential.tokenExpiresAt)) || Date.parse(credential.tokenExpiresAt) <= current))) throw notFound();
    return binding;
  }
  async open(assetId: string, ticket: string, now: Date, signal?: AbortSignal): Promise<VerifiedMediaHandle> {
    let content: VerifiedMediaHandle | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = new AbortController();
    const preparation = signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal;
    const budget = setTimeout(() => cancel.abort(new MediaContentUnavailableError()), 300000);
    try {
      preparation.throwIfAborted();
      const claims = this.signer.verify(assetId, ticket, now);
      if (!claims) throw notFound();
      const ticketMs = claims.expiresAt * 1000 - this.clock().getTime();
      if (ticketMs <= 0) throw notFound();
      timer = setTimeout(() => cancel.abort(notFound()), ticketMs);
      const binding = await this.authorize(claims, preparation);
      const validityMs = Math.min(claims.expiresAt * 1000, binding.deadlineAt.getTime()) - this.clock().getTime();
      if (validityMs <= 0) throw notFound();
      clearTimeout(timer);
      timer = setTimeout(() => cancel.abort(notFound()), validityMs);
      content = await this.files.openPublishingFile(binding, assetId, preparation);
      preparation.throwIfAborted();
      const current = this.clock();
      if (!this.signer.verify(assetId, ticket, current)) throw notFound();
      const latest = await this.authorize(claims, preparation);
      preparation.throwIfAborted();
      // DB I/O can itself cross the deadline; use a fresh clock immediately before return.
      const ready = this.clock();
      if (!this.signer.verify(assetId, ticket, ready) || latest.deadlineAt.getTime() <= ready.getTime()) throw notFound();
      if (binding.kind === "instagram_image" && (content.mimeType !== "image/jpeg" || content.sizeBytes > 8000000) ||
        binding.kind === "instagram_reel" && !["video/mp4", "video/quicktime"].includes(content.mimeType)) throw new MediaContentUnavailableError();
      const verified = content; content = undefined; return verified;
    } catch (error) {
      if (cancel.signal.aborted) throw cancel.signal.reason;
      if (error instanceof InvalidSocialAccountsContextError) throw notFound();
      if (error instanceof MediaRequestError) throw error;
      throw new MediaContentUnavailableError();
    } finally { clearTimeout(budget); if (timer) clearTimeout(timer); await content?.close(); }
  }
}
