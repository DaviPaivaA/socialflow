import { createHash, randomUUID } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { IncomingMessage } from "node:http";
import type { MediaAsset } from "../../shared/mediaContract.ts";
import { resolveMediaContentFile } from "./mediaContent.ts";
import { MediaContentUnavailableError, MediaRequestError, MediaStorageError } from "./mediaErrors.ts";
import type { MediaAssetsRepository, StoredMediaAsset } from "./mediaAssetsRepository.ts";
import {
  moveMediaToFinalLocation,
  receiveMediaUpload,
  removeMediaFile,
  type MediaLimits,
} from "./mediaStorage.ts";
import type { PostsContext } from "./postsContext.ts";

export class MediaAssetsService {
  private readonly repository: MediaAssetsRepository;
  private readonly root: string;
  private readonly limits: MediaLimits;

  constructor(repository: MediaAssetsRepository, root: string, limits: MediaLimits) {
    this.repository = repository;
    this.root = root;
    this.limits = limits;
  }

  list(context: PostsContext): Promise<MediaAsset[]> {
    return this.repository.list(context);
  }

  async get(context: PostsContext, id: string): Promise<MediaAsset> {
    const asset = await this.repository.findById(context, id);
    if (!asset) throw new MediaRequestError(404, "media_asset_not_found", "A mídia não foi encontrada.");
    return asset;
  }

  async getContent(context: PostsContext, id: string): Promise<{ path: string; mimeType: string; sizeBytes: number }> {
    const asset = await this.repository.findStoredById(context, id);
    if (!asset) throw new MediaRequestError(404, "media_asset_not_found", "A mídia não foi encontrada.");
    return this.resolveContent(context, asset);
  }

  private async resolveContent(context: PostsContext, asset: StoredMediaAsset) {
    try {
      const expectedPrefix = `${context.tenantId}/${asset.id}.`;
      const extension = asset.storageKey.slice(expectedPrefix.length);
      if (
        !asset.storageKey.startsWith(expectedPrefix) ||
        !["jpg", "png", "webp", "mp4", "mov"].includes(extension)
      ) {
        throw new Error("Invalid storage key for asset");
      }
      const file = await resolveMediaContentFile(this.root, asset.storageKey);
      const tenantRoot = resolve(await realpath(this.root), context.tenantId);
      const tenantRelativePath = relative(tenantRoot, file.path);
      if (tenantRelativePath === ".." || tenantRelativePath.startsWith(`..${sep}`) || isAbsolute(tenantRelativePath)) {
        throw new Error("Media outside tenant storage");
      }
      return { path: file.path, mimeType: asset.mimeType, sizeBytes: file.sizeBytes };
    } catch {
      throw new MediaContentUnavailableError();
    }
  }

  async getPublishingContent(context: PostsContext, id: string): Promise<{ source: Blob; mimeType: string; sizeBytes: number }> {
    try {
      const asset = await this.repository.findStoredById(context, id);
      if (!asset || !["image/jpeg", "image/png"].includes(asset.mimeType) ||
        !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 || asset.sizeBytes > 4_000_000) throw new Error();
      const file = await this.resolveContent(context, asset);
      if (file.sizeBytes !== asset.sizeBytes) throw new Error();
      const handle = await open(file.path, "r");
      try {
        const details = await handle.stat();
        if (!details.isFile() || details.size !== asset.sizeBytes) throw new Error();
        // Read only the persisted, bounded size from one handle. Blob copies the verified bytes.
        const bytes = new Uint8Array(asset.sizeBytes);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!bytesRead) throw new Error();
          offset += bytesRead;
        }
        if ((await handle.stat()).size !== asset.sizeBytes ||
          createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error();
        return { source: new Blob([bytes], { type: asset.mimeType }), mimeType: asset.mimeType, sizeBytes: bytes.length };
      } finally {
        await handle.close();
      }
    } catch {
      throw new MediaContentUnavailableError();
    }
  }

  async upload(request: IncomingMessage, context: PostsContext): Promise<MediaAsset> {
    const staged = await receiveMediaUpload(request, this.root, this.limits);
    let finalPath: string | null = null;
    try {
      const id = randomUUID();
      const moved = await moveMediaToFinalLocation(this.root, context.tenantId, id, staged);
      finalPath = moved.finalPath;
      return await this.repository.create(context, {
        id,
        mediaType: staged.format.mediaType,
        mimeType: staged.format.mimeType,
        originalFilename: staged.originalFilename,
        sha256: staged.sha256,
        sizeBytes: staged.sizeBytes,
        storageKey: moved.storageKey,
      });
    } catch (error) {
      try {
        await removeMediaFile(finalPath ?? staged.tempPath);
      } catch {
        throw new MediaStorageError();
      }
      throw error;
    }
  }
}
