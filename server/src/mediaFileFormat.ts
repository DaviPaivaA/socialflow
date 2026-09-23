import type { MediaType } from "../../shared/mediaContract.ts";

export type MediaFileFormat = {
  extension: "jpg" | "png" | "webp" | "mp4" | "mov";
  mediaType: MediaType;
  mimeType: string;
};

const JPEG: MediaFileFormat = { extension: "jpg", mediaType: "image", mimeType: "image/jpeg" };
const PNG: MediaFileFormat = { extension: "png", mediaType: "image", mimeType: "image/png" };
const WEBP: MediaFileFormat = { extension: "webp", mediaType: "image", mimeType: "image/webp" };
const MP4: MediaFileFormat = { extension: "mp4", mediaType: "video", mimeType: "video/mp4" };
const QUICKTIME: MediaFileFormat = { extension: "mov", mediaType: "video", mimeType: "video/quicktime" };

const MP4_BRANDS = new Set(["isom", "iso2", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "M4A "]);

export function detectMediaFileFormat(bytes: Buffer): MediaFileFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return JPEG;
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return PNG;
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return WEBP;
  if (bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp") {
    const boxSize = bytes.readUInt32BE(0);
    if (boxSize < 12) return null;
    const brand = bytes.toString("ascii", 8, 12);
    if (brand === "qt  ") return QUICKTIME;
    if (MP4_BRANDS.has(brand)) return MP4;
  }
  return null;
}

export function isAllowedMediaMimeType(value: string): boolean {
  return [JPEG.mimeType, PNG.mimeType, WEBP.mimeType, MP4.mimeType, QUICKTIME.mimeType].includes(value);
}
