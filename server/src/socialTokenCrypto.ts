import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_BYTES = 16;
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const PAYLOAD_VERSION = "v1";
const ADDITIONAL_AUTHENTICATED_DATA = Buffer.from(
  "socialflow:social-token:v1",
  "utf8",
);
const BASE64_KEY = /^[A-Za-z0-9+/]{43}=$/;

export function parseSocialTokenEncryptionKey(value: string | undefined): Buffer {
  const encoded = value?.trim();
  if (!encoded) {
    throw new Error(
      "SOCIAL_TOKEN_ENCRYPTION_KEY deve ser definida em Base64 com 32 bytes.",
    );
  }
  if (!BASE64_KEY.test(encoded)) {
    throw new Error(
      "SOCIAL_TOKEN_ENCRYPTION_KEY deve ser Base64 canônico com 32 bytes.",
    );
  }

  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== KEY_BYTES || key.toString("base64") !== encoded) {
    throw new Error(
      "SOCIAL_TOKEN_ENCRYPTION_KEY deve decodificar exatamente 32 bytes.",
    );
  }
  return key;
}

function decodePayloadPart(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("O segredo criptografado possui formato inválido.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error("O segredo criptografado possui formato inválido.");
  }
  return decoded;
}

export class SocialTokenCipher {
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (key.byteLength !== KEY_BYTES) {
      throw new Error("A chave de tokens sociais deve possuir 32 bytes.");
    }
    this.key = Buffer.from(key);
  }

  encryptSecret(value: string): string {
    if (!value) throw new Error("Não é possível criptografar um segredo vazio.");

    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(ADDITIONAL_AUTHENTICATED_DATA);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      PAYLOAD_VERSION,
      nonce.toString("base64url"),
      authTag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decryptSecret(payload: string): string {
    const [version, noncePart, authTagPart, ciphertextPart, extra] =
      payload.split(".");
    if (
      version !== PAYLOAD_VERSION ||
      !noncePart ||
      !authTagPart ||
      !ciphertextPart ||
      extra !== undefined
    ) {
      throw new Error("O segredo criptografado possui formato inválido.");
    }

    try {
      const nonce = decodePayloadPart(noncePart);
      const authTag = decodePayloadPart(authTagPart);
      const ciphertext = decodePayloadPart(ciphertextPart);
      if (nonce.byteLength !== NONCE_BYTES || authTag.byteLength !== AUTH_TAG_BYTES) {
        throw new Error("invalid encrypted payload length");
      }

      const decipher = createDecipheriv(ALGORITHM, this.key, nonce, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAAD(ADDITIONAL_AUTHENTICATED_DATA);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      throw new Error(
        "Não foi possível autenticar o segredo criptografado.",
        { cause: error },
      );
    }
  }
}
