import type { MediaAsset } from "./mediaContract.ts";
import type { SocialAccountProvider } from "./socialAccountContract.ts";

export type PublishingProvider = Extract<SocialAccountProvider, "facebook" | "instagram">;
export type PublicationMedia = Pick<MediaAsset, "mediaType" | "mimeType" | "sizeBytes">;
export type CompatibilityCode =
  | "media_required"
  | "unsupported_media_type"
  | "media_too_large"
  | "caption_too_long";

const FACEBOOK_PUBLISHING_SCOPES = Object.freeze([
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
]);
const INSTAGRAM_PUBLISHING_SCOPES = Object.freeze([
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
]);

export function requiredPublishingScopes(provider: PublishingProvider): readonly string[] {
  return provider === "facebook" ? FACEBOOK_PUBLISHING_SCOPES : INSTAGRAM_PUBLISHING_SCOPES;
}

export function validatePublicationCompatibility(input: {
  providers: PublishingProvider[];
  media: PublicationMedia | null;
  caption: string;
  maxVideoBytes: number;
}): { valid: true } | { valid: false; code: CompatibilityCode } {
  const hasFacebook = input.providers.includes("facebook");
  const hasInstagram = input.providers.includes("instagram");

  if (hasInstagram && input.caption.length > 2_200) {
    return { valid: false, code: "caption_too_long" };
  }
  if (input.media === null) {
    return hasInstagram ? { valid: false, code: "media_required" } : { valid: true };
  }

  const { mediaType, mimeType, sizeBytes } = input.media;
  if (mediaType === "image") {
    if (mimeType !== "image/jpeg" && (mimeType !== "image/png" || hasInstagram)) {
      return { valid: false, code: "unsupported_media_type" };
    }
    const maxImageBytes = hasFacebook ? 4_000_000 : 8_000_000;
    return sizeBytes > maxImageBytes ? { valid: false, code: "media_too_large" } : { valid: true };
  }

  if (mediaType === "video" && (mimeType === "video/mp4" || mimeType === "video/quicktime")) {
    const maxBytes = Math.min(input.maxVideoBytes, 262_144_000);
    return sizeBytes > maxBytes ? { valid: false, code: "media_too_large" } : { valid: true };
  }

  return { valid: false, code: "unsupported_media_type" };
}
