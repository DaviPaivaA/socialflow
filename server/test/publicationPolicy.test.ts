import { describe, expect, it } from "vitest";
import {
  requiredPublishingScopes,
  validatePublicationCompatibility,
  type PublicationMedia,
  type PublishingProvider,
} from "../../shared/publicationPolicy.ts";

type PolicyInput = Parameters<typeof validatePublicationCompatibility>[0];
type PolicyResult = ReturnType<typeof validatePublicationCompatibility>;

const jpeg: PublicationMedia = { mediaType: "image", mimeType: "image/jpeg", sizeBytes: 4_000_000 };
const png: PublicationMedia = { mediaType: "image", mimeType: "image/png", sizeBytes: 4_000_000 };
const webp: PublicationMedia = { mediaType: "image", mimeType: "image/webp", sizeBytes: 1_000_000 };
const mp4: PublicationMedia = { mediaType: "video", mimeType: "video/mp4", sizeBytes: 262_144_000 };
const mov: PublicationMedia = { mediaType: "video", mimeType: "video/quicktime", sizeBytes: 262_144_000 };

// Each literal expectation catches an incorrectly allowed/blocked provider-media branch.
const matrix: { name: string; providers: PublishingProvider[]; media: PublicationMedia | null; want: PolicyResult }[] = [
  { name: "Facebook aceita texto sem mídia", providers: ["facebook"], media: null, want: { valid: true } },
  { name: "Instagram exige mídia", providers: ["instagram"], media: null, want: { valid: false, code: "media_required" } },
  { name: "misto exige mídia", providers: ["facebook", "instagram"], media: null, want: { valid: false, code: "media_required" } },
  { name: "Facebook aceita JPEG no limite de 4 MB", providers: ["facebook"], media: jpeg, want: { valid: true } },
  { name: "Instagram aceita JPEG de 4 MB", providers: ["instagram"], media: jpeg, want: { valid: true } },
  { name: "misto aceita JPEG de 4 MB", providers: ["facebook", "instagram"], media: jpeg, want: { valid: true } },
  { name: "Facebook rejeita JPEG de 6 MB", providers: ["facebook"], media: { ...jpeg, sizeBytes: 6_000_000 }, want: { valid: false, code: "media_too_large" } },
  { name: "Instagram aceita JPEG de 6 MB", providers: ["instagram"], media: { ...jpeg, sizeBytes: 6_000_000 }, want: { valid: true } },
  { name: "misto rejeita JPEG de 6 MB", providers: ["facebook", "instagram"], media: { ...jpeg, sizeBytes: 6_000_000 }, want: { valid: false, code: "media_too_large" } },
  { name: "Facebook aceita PNG no limite de 4 MB", providers: ["facebook"], media: png, want: { valid: true } },
  { name: "Instagram rejeita PNG sem conversão", providers: ["instagram"], media: png, want: { valid: false, code: "unsupported_media_type" } },
  { name: "misto rejeita PNG", providers: ["facebook", "instagram"], media: png, want: { valid: false, code: "unsupported_media_type" } },
  { name: "Facebook rejeita WebP", providers: ["facebook"], media: webp, want: { valid: false, code: "unsupported_media_type" } },
  { name: "Instagram rejeita WebP", providers: ["instagram"], media: webp, want: { valid: false, code: "unsupported_media_type" } },
  { name: "misto rejeita WebP", providers: ["facebook", "instagram"], media: webp, want: { valid: false, code: "unsupported_media_type" } },
  { name: "Facebook aceita MP4 no teto local", providers: ["facebook"], media: mp4, want: { valid: true } },
  { name: "Instagram aceita MP4 no teto local", providers: ["instagram"], media: mp4, want: { valid: true } },
  { name: "misto aceita MP4 no teto local", providers: ["facebook", "instagram"], media: mp4, want: { valid: true } },
  { name: "Facebook aceita MOV no teto local", providers: ["facebook"], media: mov, want: { valid: true } },
  { name: "Instagram aceita MOV no teto local", providers: ["instagram"], media: mov, want: { valid: true } },
  { name: "misto aceita MOV no teto local", providers: ["facebook", "instagram"], media: mov, want: { valid: true } },
];

const boundaries: { name: string; input: PolicyInput; want: PolicyResult }[] = [
  { name: "JPEG Facebook rejeita 4 MB + 1 byte", input: { providers: ["facebook"], media: { ...jpeg, sizeBytes: 4_000_001 }, caption: "Legenda", maxVideoBytes: 262_144_000 }, want: { valid: false, code: "media_too_large" } },
  { name: "JPEG misto rejeita 4 MB + 1 byte", input: { providers: ["facebook", "instagram"], media: { ...jpeg, sizeBytes: 4_000_001 }, caption: "Legenda", maxVideoBytes: 262_144_000 }, want: { valid: false, code: "media_too_large" } },
  { name: "PNG Facebook rejeita 4 MB + 1 byte", input: { providers: ["facebook"], media: { ...png, sizeBytes: 4_000_001 }, caption: "Legenda", maxVideoBytes: 262_144_000 }, want: { valid: false, code: "media_too_large" } },
  { name: "JPEG Instagram aceita 8 MB exatos", input: { providers: ["instagram"], media: { ...jpeg, sizeBytes: 8_000_000 }, caption: "Legenda", maxVideoBytes: 262_144_000 }, want: { valid: true } },
  { name: "JPEG Instagram rejeita 8 MB + 1 byte", input: { providers: ["instagram"], media: { ...jpeg, sizeBytes: 8_000_001 }, caption: "Legenda", maxVideoBytes: 262_144_000 }, want: { valid: false, code: "media_too_large" } },
  { name: "vídeo Facebook rejeita teto absoluto + 1", input: { providers: ["facebook"], media: { ...mp4, sizeBytes: 262_144_001 }, caption: "Legenda", maxVideoBytes: 300_000_000 }, want: { valid: false, code: "media_too_large" } },
  { name: "vídeo Instagram rejeita teto absoluto + 1", input: { providers: ["instagram"], media: { ...mov, sizeBytes: 262_144_001 }, caption: "Legenda", maxVideoBytes: 300_000_000 }, want: { valid: false, code: "media_too_large" } },
  { name: "vídeo misto rejeita teto absoluto + 1", input: { providers: ["facebook", "instagram"], media: { ...mp4, sizeBytes: 262_144_001 }, caption: "Legenda", maxVideoBytes: 300_000_000 }, want: { valid: false, code: "media_too_large" } },
];

describe("validatePublicationCompatibility", () => {
  it.each(matrix)("$name", ({ providers, media, want }) => {
    expect(validatePublicationCompatibility({ providers, media, caption: "Legenda", maxVideoBytes: 262_144_000 })).toEqual(want);
  });

  // These cases catch off-by-one limits and failure to cap the configured video ceiling.
  it.each(boundaries)("$name", ({ input, want }) => {
    expect(validatePublicationCompatibility(input)).toEqual(want);
  });

  it.each<PublishingProvider[]>([["facebook"], ["instagram"], ["facebook", "instagram"]])("respeita teto configurado de vídeo menor para %j", (...providers) => {
    const input: PolicyInput = { providers, media: { ...mp4, sizeBytes: 10_000_000 }, caption: "Legenda", maxVideoBytes: 10_000_000 };
    expect(validatePublicationCompatibility(input)).toEqual({ valid: true });
    expect(validatePublicationCompatibility({ ...input, media: { ...mov, sizeBytes: 10_000_001 } })).toEqual({ valid: false, code: "media_too_large" });
  });

  it.each<PublishingProvider[]>([["instagram"], ["facebook", "instagram"]])("limita caption Instagram a 2200 caracteres para %j", (...providers) => {
    const input: PolicyInput = { providers, media: jpeg, caption: "a".repeat(2_200), maxVideoBytes: 262_144_000 };
    expect(validatePublicationCompatibility(input)).toEqual({ valid: true });
    expect(validatePublicationCompatibility({ ...input, caption: "a".repeat(2_201) })).toEqual({ valid: false, code: "caption_too_long" });
  });

  it("não aplica o limite Instagram ao texto Facebook", () => {
    expect(validatePublicationCompatibility({ providers: ["facebook"], media: null, caption: "a".repeat(2_201), maxVideoBytes: 262_144_000 })).toEqual({ valid: true });
  });

  it.each([
    { mediaType: "image", mimeType: "video/mp4", sizeBytes: 1_000 },
    { mediaType: "video", mimeType: "image/jpeg", sizeBytes: 1_000 },
    { mediaType: "video", mimeType: "video/webm", sizeBytes: 1_000 },
    { mediaType: "image", mimeType: "image/gif", sizeBytes: 1_000 },
  ] satisfies PublicationMedia[])("rejeita tipo/formato incompatível $mediaType/$mimeType", (media) => {
    expect(validatePublicationCompatibility({ providers: ["facebook", "instagram"], media, caption: "Legenda", maxVideoBytes: 262_144_000 })).toEqual({ valid: false, code: "unsupported_media_type" });
  });

  it.each([
    { media: null, want: { valid: false, code: "media_required" } },
    { media: png, want: { valid: false, code: "unsupported_media_type" } },
    { media: { ...jpeg, sizeBytes: 6_000_000 }, want: { valid: false, code: "media_too_large" } },
    { media: mov, want: { valid: true } },
  ] satisfies { media: PublicationMedia | null; want: PolicyResult }[])("valida todos os destinos mesmo com Instagram primeiro: $media", ({ media, want }) => {
    expect(validatePublicationCompatibility({ providers: ["instagram", "facebook"], media, caption: "Legenda", maxVideoBytes: 262_144_000 })).toEqual(want);
  });
});

describe("requiredPublishingScopes", () => {
  // Missing required permissions or adding unrelated permissions breaks these consumer-facing sets.
  it.each([
    { provider: "facebook", want: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"] },
    { provider: "instagram", want: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"] },
  ] satisfies { provider: PublishingProvider; want: string[] }[])("retorna apenas scopes de publicação de $provider", ({ provider, want }) => {
    expect([...requiredPublishingScopes(provider)].sort()).toEqual([...want].sort());
  });
});
