import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../shared/socialAccountContract.ts";
import type {
  PersistSocialAccountInput,
  RegisterSocialAccountInput,
  SocialAccountsRepository,
} from "../src/socialAccountsRepository.ts";
import {
  InvalidSocialAccountInputError,
  SocialAccountsService,
} from "../src/socialAccountsService.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";

const context = {
  authorUserId: "22222222-2222-4222-8222-222222222222",
  tenantId: "11111111-1111-4111-8111-111111111111",
};

const publicAccount: SocialAccount = {
  createdAt: "2026-09-19T12:00:00.000Z",
  disconnectedAt: null,
  displayName: "Café Aurora",
  id: "70000000-0000-4000-8000-000000000001",
  profileImageUrl: null,
  provider: "instagram",
  providerAccountId: "ig-123",
  scopes: [],
  status: "connected",
  tokenExpiresAt: null,
  updatedAt: "2026-09-19T12:00:00.000Z",
  username: null,
};

function fakeRepository(register: SocialAccountsRepository["register"]) {
  return {
    assertContext: vi.fn(),
    disconnect: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    register,
    update: vi.fn(),
    upsertMetaAuthorization: vi.fn(),
  } satisfies SocialAccountsRepository;
}

describe("SocialAccountsService", () => {
  it("encaminha somente ciphertext ao repository", async () => {
    let persisted: PersistSocialAccountInput | undefined;
    const cipher = new SocialTokenCipher(Buffer.alloc(32, 12));
    const service = new SocialAccountsService(
      fakeRepository(
        vi.fn(async (_context, input) => {
          persisted = input;
          return publicAccount;
        }),
      ),
      cipher,
    );

    await expect(
      service.register(context, {
        accessToken: "access-secreto",
        displayName: "  Café Aurora  ",
        provider: "instagram",
        providerAccountId: " ig-123 ",
        providerMetadata: { accountType: "business" },
        refreshToken: "refresh-secreto",
        scopes: ["instagram_basic"],
        status: "connected",
      }),
    ).resolves.toEqual(publicAccount);

    expect(persisted).toBeDefined();
    expect(Object.hasOwn(persisted ?? {}, "accessToken")).toBe(false);
    expect(Object.hasOwn(persisted ?? {}, "refreshToken")).toBe(false);
    expect(persisted?.accessTokenEncrypted).not.toContain("access-secreto");
    expect(persisted?.refreshTokenEncrypted).not.toContain("refresh-secreto");
    expect(cipher.decryptSecret(persisted!.accessTokenEncrypted!)).toBe(
      "access-secreto",
    );
  });

  it.each([
    {
      displayName: "Conta",
      provider: "linkedin",
      providerAccountId: "external",
    },
    {
      displayName: "Conta",
      provider: "instagram",
      providerAccountId: "external",
      providerMetadata: { accessToken: "não permitido" },
    },
    {
      displayName: "Conta",
      profileImageUrl: "javascript:alert(1)",
      provider: "instagram",
      providerAccountId: "external",
    },
  ])("rejeita registro interno inválido: %#", async (input) => {
    const service = new SocialAccountsService(
      fakeRepository(vi.fn()),
      new SocialTokenCipher(Buffer.alloc(32, 13)),
    );

    await expect(
      service.register(context, input as RegisterSocialAccountInput),
    ).rejects.toBeInstanceOf(InvalidSocialAccountInputError);
  });
});
