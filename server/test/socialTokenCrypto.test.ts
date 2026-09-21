import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseSocialTokenEncryptionKey,
  SocialTokenCipher,
} from "../src/socialTokenCrypto.ts";

describe("SocialTokenCipher", () => {
  it("criptografa sem persistir plaintext e recupera o segredo", () => {
    const cipher = new SocialTokenCipher(randomBytes(32));
    const secret = "access-token-ultrassecreto";
    const encrypted = cipher.encryptSecret(secret);

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain(secret);
    expect(cipher.decryptSecret(encrypted)).toBe(secret);
  });

  it("rejeita ciphertext adulterado pela autenticação GCM", () => {
    const cipher = new SocialTokenCipher(randomBytes(32));
    const encrypted = cipher.encryptSecret("segredo");
    const last = encrypted.at(-1);
    const tampered = `${encrypted.slice(0, -1)}${last === "A" ? "B" : "A"}`;

    expect(() => cipher.decryptSecret(tampered)).toThrow(
      "Não foi possível autenticar o segredo criptografado.",
    );
  });

  it.each([undefined, "", "curta", Buffer.alloc(31).toString("base64")])(
    "rejeita chave de ambiente inválida: %s",
    (value) => {
      expect(() => parseSocialTokenEncryptionKey(value)).toThrow(
        "SOCIAL_TOKEN_ENCRYPTION_KEY",
      );
    },
  );

  it("aceita somente chave Base64 canônica de 32 bytes", () => {
    const encoded = Buffer.alloc(32, 9).toString("base64");
    expect(parseSocialTokenEncryptionKey(encoded)).toEqual(Buffer.alloc(32, 9));
    expect(() => parseSocialTokenEncryptionKey(encoded.replace(/=$/, ""))).toThrow();
  });
});
