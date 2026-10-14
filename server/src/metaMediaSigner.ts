import { createHmac, timingSafeEqual } from "node:crypto";
import { isUuid } from "../../shared/postContract.ts";

export type MetaMediaConfig = { publicOrigin: string; signingKey: Buffer; ttlSeconds: number } | null;
export type MetaMediaClaims = { v: 1; publicationId: string; assetId: string; issuedAt: number; expiresAt: number };
const DOMAIN = "socialflow:meta-media:v1\n";

function validClaims(value: unknown): value is MetaMediaClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return Object.keys(input).length === 5 && input.v === 1 &&
    isUuid(input.publicationId) && isUuid(input.assetId) &&
    Number.isSafeInteger(input.issuedAt) && Number.isSafeInteger(input.expiresAt) &&
    (input.issuedAt as number) >= 0 &&
    (input.expiresAt as number) - (input.issuedAt as number) >= 1800 &&
    (input.expiresAt as number) - (input.issuedAt as number) <= 7200;
}
function canonical(input: MetaMediaClaims): string {
  return JSON.stringify({ v: input.v, publicationId: input.publicationId, assetId: input.assetId, issuedAt: input.issuedAt, expiresAt: input.expiresAt });
}
function decode(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes : null;
}

export class MetaMediaSigner {
  private readonly config: NonNullable<MetaMediaConfig>;
  constructor(config: NonNullable<MetaMediaConfig>) {
    if (config.signingKey.length !== 32) throw new Error("META_MEDIA_SIGNING_KEY inválida.");
    this.config = { ...config, signingKey: Buffer.from(config.signingKey) };
  }
  createUrl(claims: MetaMediaClaims): string {
    if (!validClaims(claims)) throw new Error("Capability de mídia inválida.");
    const payload = canonical(claims);
    const signature = createHmac("sha256", this.config.signingKey).update(DOMAIN).update(payload).digest("base64url");
    return `${this.config.publicOrigin}/meta-media/${claims.assetId}?ticket=${Buffer.from(payload).toString("base64url")}.${signature}`;
  }
  verify(assetId: string, ticket: string, now: Date): MetaMediaClaims | null {
    if (typeof ticket !== "string" || ticket.length > 1024 || !isUuid(assetId) || !Number.isFinite(now.getTime())) return null;
    const parts = ticket.split(".");
    if (parts.length !== 2) return null;
    const payload = decode(parts[0]); const signature = decode(parts[1]);
    if (!payload || signature?.length !== 32) return null;
    const expected = createHmac("sha256", this.config.signingKey).update(DOMAIN).update(payload).digest();
    if (!timingSafeEqual(signature, expected)) return null;
    try {
      const text = payload.toString("utf8");
      const claims: unknown = JSON.parse(text);
      // A byte-identical canonical form rejects duplicates, extra keys and lossy UTF-8/JSON encodings.
      if (!validClaims(claims) || canonical(claims) !== text || claims.assetId !== assetId ||
        now.getTime() < claims.issuedAt * 1000 || now.getTime() >= claims.expiresAt * 1000) return null;
      return claims;
    } catch { return null; }
  }
}
