import { isMediaAsset, type MediaAsset } from "../../../shared/mediaContract";
import type { ApiClient } from "../api/apiClient";
import type { MediaAssetsRepository } from "./MediaAssetsRepository";

export class HttpMediaAssetsRepository implements MediaAssetsRepository {
  private readonly apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async list(): Promise<MediaAsset[]> {
    const response = await this.apiClient.get<unknown>("/media-assets");
    if (
      typeof response !== "object" || response === null || Array.isArray(response) ||
      !Array.isArray((response as { mediaAssets?: unknown }).mediaAssets) ||
      !(response as { mediaAssets: unknown[] }).mediaAssets.every(isMediaAsset)
    ) {
      throw new Error("A API não retornou uma lista válida de mídias.");
    }
    return (response as { mediaAssets: MediaAsset[] }).mediaAssets;
  }

  async upload(file: File): Promise<MediaAsset> {
    const form = new FormData();
    form.append("file", file);
    const asset = await this.apiClient.postForm<unknown>("/media-assets", form);
    if (!isMediaAsset(asset)) throw new Error("A API não retornou uma mídia válida.");
    return asset;
  }

  contentUrl(id: string): string {
    return this.apiClient.resolveUrl(`/media-assets/${id}/content`);
  }
}
