import type { MediaAsset, MediaType } from "../../../shared/mediaContract";
import type { MediaAssetsRepository } from "./MediaAssetsRepository";

const MOCK_TENANT_ID = "90000000-0000-4000-8000-000000000001";
const MOCK_USER_ID = "90000000-0000-4000-8000-000000000002";

function mediaTypeFor(mimeType: string): MediaType {
  if (["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return "image";
  if (["video/mp4", "video/quicktime"].includes(mimeType)) return "video";
  throw new Error("Formato de mídia não suportado no modo simulado.");
}

export class MockMediaAssetsRepository implements MediaAssetsRepository {
  private readonly assets: MediaAsset[] = [];
  private readonly urls = new Map<string, string>();

  async list(): Promise<MediaAsset[]> {
    return this.assets.map((asset) => ({ ...asset }));
  }

  async upload(file: File): Promise<MediaAsset> {
    if (file.size <= 0) throw new Error("O arquivo está vazio.");
    const now = new Date().toISOString();
    const asset: MediaAsset = {
      createdAt: now,
      durationMs: null,
      height: null,
      id: globalThis.crypto.randomUUID(),
      mediaType: mediaTypeFor(file.type),
      mimeType: file.type,
      originalFilename: file.name,
      sizeBytes: file.size,
      tenantId: MOCK_TENANT_ID,
      updatedAt: now,
      uploadedByUserId: MOCK_USER_ID,
      width: null,
    };
    this.urls.set(asset.id, URL.createObjectURL(file));
    this.assets.unshift(asset);
    return { ...asset };
  }

  contentUrl(id: string): string {
    const url = this.urls.get(id);
    if (!url) throw new Error("A mídia não foi encontrada no modo simulado.");
    return url;
  }
}
