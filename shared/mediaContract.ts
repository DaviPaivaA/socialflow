import { isUuid, isValidPostTimestamp } from "./postContract.ts";

export type MediaType = "image" | "video";

export type MediaAsset = {
  createdAt: string;
  durationMs: number | null;
  height: number | null;
  id: string;
  mediaType: MediaType;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  tenantId: string;
  updatedAt: string;
  uploadedByUserId: string;
  width: number | null;
};

export type MediaAssetsResponse = { mediaAssets: MediaAsset[] };

export function isMediaAsset(value: unknown): value is MediaAsset {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const asset = value as Record<string, unknown>;
  return (
    isUuid(asset.id) &&
    isUuid(asset.tenantId) &&
    isUuid(asset.uploadedByUserId) &&
    typeof asset.originalFilename === "string" &&
    asset.originalFilename.length > 0 &&
    asset.originalFilename.length <= 255 &&
    (asset.mediaType === "image" || asset.mediaType === "video") &&
    typeof asset.mimeType === "string" &&
    Number.isSafeInteger(asset.sizeBytes) &&
    (asset.sizeBytes as number) > 0 &&
    (asset.width === null || (Number.isInteger(asset.width) && (asset.width as number) > 0)) &&
    (asset.height === null || (Number.isInteger(asset.height) && (asset.height as number) > 0)) &&
    (asset.durationMs === null || (Number.isSafeInteger(asset.durationMs) && (asset.durationMs as number) > 0)) &&
    isValidPostTimestamp(asset.createdAt) &&
    isValidPostTimestamp(asset.updatedAt) &&
    !Object.hasOwn(asset, "storageKey") &&
    !Object.hasOwn(asset, "sha256")
  );
}
