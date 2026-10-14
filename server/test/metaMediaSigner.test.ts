import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as signerModule from "../src/metaMediaSigner.ts";

const key = Buffer.alloc(32, 31);
const claims = { v: 1 as const, publicationId: "00000000-0000-4000-8000-000000000001", assetId: "00000000-0000-4000-8000-000000000002", issuedAt: 1800000000, expiresAt: 1800003600 };
const now = new Date(1800000100 * 1000);
function rawTicket(payload: string, domain = "socialflow:meta-media:v1\n") {
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${createHmac("sha256", key).update(domain).update(payload).digest("base64url")}`;
}
function signer() { return new signerModule.MetaMediaSigner({ publicOrigin: "https://media.example.com", signingKey: key, ttlSeconds: 3600 }); }

describe("MetaMediaSigner", () => {
  it("issues reproducible canonical capabilities without tenant or storage data", () => {
    const instance = signer();
    const url = instance.createUrl(claims);
    expect(url).toBe(`https://media.example.com/meta-media/${claims.assetId}?ticket=${rawTicket(JSON.stringify(claims))}`);
    expect(instance.verify(claims.assetId, new URL(url).searchParams.get("ticket")!, now)).toEqual(claims);
    expect(instance.createUrl(claims)).toBe(url);
  });
  it("rejects altered signature, payload and asset and a different domain", () => {
    const instance = signer(); const ticket = rawTicket(JSON.stringify(claims));
    expect(instance.verify(claims.assetId, `${ticket.slice(0, -2)}aa`, now)).toBeNull();
    expect(instance.verify(claims.assetId, `${Buffer.from(JSON.stringify({ ...claims, expiresAt: claims.expiresAt + 1 })).toString("base64url")}.${ticket.split(".")[1]}`, now)).toBeNull();
    expect(instance.verify(claims.publicationId, ticket, now)).toBeNull();
    expect(instance.verify(claims.assetId, rawTicket(JSON.stringify(claims), ""), now)).toBeNull();
  });
  it("uses inclusive expiry and rejects future issuance", () => {
    const instance = signer(); const ticket = rawTicket(JSON.stringify(claims));
    expect(instance.verify(claims.assetId, ticket, new Date(claims.expiresAt * 1000))).toBeNull();
    expect(instance.verify(claims.assetId, ticket, new Date(claims.issuedAt * 1000 - 1))).toBeNull();
  });
  it.each([
    { v: 2 }, { publicationId: "not-uuid" }, { assetId: "not-uuid" }, { issuedAt: 1800000000.1 },
    { issuedAt: "1800000000" }, { expiresAt: 1800001799 }, { expiresAt: 1800007201 },
    { tenantId: "private" }, { expiresAt: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects signed but invalid claims %j", change => {
    expect(signer().verify(claims.assetId, rawTicket(JSON.stringify({ ...claims, ...change })), now)).toBeNull();
  });
  it("rejects duplicate fields, noncanonical JSON, malformed encoding and excess length", () => {
    const canonical = JSON.stringify(claims);
    for (const ticket of [rawTicket(canonical.replace('{', '{"v":1,')), rawTicket(` ${canonical}`), rawTicket(canonical).replace(".", "=.") , "a.b", "!abc.def", "a".repeat(1025), `${rawTicket(canonical)}.x`]) {
      expect(signer().verify(claims.assetId, ticket, now)).toBeNull();
    }
  });
  it.each([1800, 7200])("accepts valid TTL boundary %i", ttl => {
    const input = { ...claims, expiresAt: claims.issuedAt + ttl };
    expect(signer().verify(claims.assetId, rawTicket(JSON.stringify(input)), now)).toEqual(input);
  });
});
