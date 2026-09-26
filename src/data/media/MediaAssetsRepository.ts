import type { MediaAsset } from "../../../shared/mediaContract";

export interface MediaAssetsRepository {
  list(): Promise<MediaAsset[]>;
  upload(file: File): Promise<MediaAsset>;
  contentUrl(id: string): string;
}
