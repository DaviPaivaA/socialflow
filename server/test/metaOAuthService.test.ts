import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../shared/socialAccountContract.ts";
import type { AuthContext } from "../src/authService.ts";
import {
  MetaOAuthClientError,
  type EnabledMetaOAuthConfig,
  type MetaOAuthProviderClient,
} from "../src/metaOAuthClient.ts";
import {
  MetaOAuthFlowError,
  MetaOAuthService,
} from "../src/metaOAuthService.ts";
import type { MetaOAuthStateRepository } from "../src/metaOAuthStateRepository.ts";
import type {
  MetaAuthorizationContext,
  PersistMetaAuthorizationInput,
  SocialAccountsRepository,
} from "../src/socialAccountsRepository.ts";
import { InvalidMetaAuthorizationContextError } from "../src/socialAccountsRepository.ts";
import { SocialTokenCipher } from "../src/socialTokenCrypto.ts";

const config: EnabledMetaOAuthConfig = {
  appId: "123456789012345",
  appSecret: "a".repeat(32),
  enabled: true,
  graphApiVersion: "v26.0",
  redirectUri: "http://localhost:3001/auth/meta/callback",
  stateTtlSeconds: 600,
};

const context: AuthContext = {
  membershipId: "30000000-0000-4000-8000-000000000001",
  sessionId: "40000000-0000-4000-8000-000000000001",
  tenant: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Workspace A",
    role: "owner",
    slug: "workspace-a",
  },
  user: {
    displayName: "Ana",
    email: "ana@example.test",
    id: "20000000-0000-4000-8000-000000000001",
  },
};

const publicAccounts: SocialAccount[] = [
  {
    createdAt: "2026-09-20T12:00:00.000Z",
    disconnectedAt: null,
    displayName: "Page A",
    id: "70000000-0000-4000-8000-000000000001",
    profileImageUrl: null,
    provider: "facebook",
    providerAccountId: "1001",
    scopes: ["pages_show_list"],
    status: "connected",
    tokenExpiresAt: null,
    updatedAt: "2026-09-20T12:00:00.000Z",
    username: null,
  },
];

function fakeClient(
  overrides: Partial<MetaOAuthProviderClient> = {},
): MetaOAuthProviderClient {
  return {
    buildAuthorizationUrl: vi.fn(
      (state) =>
        `https://www.facebook.com/v26.0/dialog/oauth?state=${state}`,
    ),
    exchangeCode: vi.fn().mockResolvedValue({
      accessToken: "short-user-token",
      expiresAt: null,
    }),
    exchangeForLongLivedToken: vi.fn().mockResolvedValue({
      accessToken: "long-user-token",
      expiresAt: "2026-11-20T12:00:00.000Z",
    }),
    getIdentity: vi.fn().mockResolvedValue({ id: "9001" }),
    getInstagramAccount: vi.fn().mockResolvedValue({
      displayName: "Instagram Pro",
      id: "2001",
      profileImageUrl: null,
      username: "instagram_pro",
    }),
    getPermissions: vi.fn().mockResolvedValue([
      { name: "pages_show_list", status: "granted" },
      { name: "pages_read_engagement", status: "granted" },
      { name: "instagram_basic", status: "granted" },
    ]),
    listPages: vi.fn().mockResolvedValue([
      {
        accessToken: "page-access-token",
        id: "1001",
        instagramBusinessAccountId: "2001",
        name: "Page A",
        profileImageUrl: null,
        tasks: ["ANALYZE"],
        username: "page_a",
      },
    ]),
    ...overrides,
  };
}

function fakeStateRepository(
  overrides: Partial<MetaOAuthStateRepository> = {},
): MetaOAuthStateRepository {
  return {
    consume: vi.fn().mockResolvedValue({ success: true }),
    create: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function fakeSocialRepository(
  upsertMetaAuthorization = vi.fn().mockResolvedValue(publicAccounts),
): SocialAccountsRepository {
  return {
    assertContext: vi.fn(),
    disconnect: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    register: vi.fn(),
    update: vi.fn(),
    upsertMetaAuthorization,
  };
}

const callback = {
  code: "authorization-code",
  error: null,
  errorReason: null,
  state: "s".repeat(43),
};

describe("MetaOAuthService", () => {
  it("gera state aleatório e persiste somente SHA-256 com expiração", async () => {
    const stateRepository = fakeStateRepository();
    const client = fakeClient();
    const service = new MetaOAuthService(
      config,
      client,
      stateRepository,
      fakeSocialRepository(),
      new SocialTokenCipher(Buffer.alloc(32, 8)),
      { now: () => Date.parse("2026-09-20T12:00:00.000Z") },
    );

    const firstUrl = new URL(await service.start(context));
    const secondUrl = new URL(await service.start(context));
    const firstState = firstUrl.searchParams.get("state")!;
    const secondState = secondUrl.searchParams.get("state")!;
    expect(firstState).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondState).not.toBe(firstState);
    expect(stateRepository.create).toHaveBeenNthCalledWith(
      1,
      context,
      createHash("sha256").update(firstState).digest("hex"),
      "2026-09-20T12:10:00.000Z",
    );
    expect(JSON.stringify(vi.mocked(stateRepository.create).mock.calls)).not.toContain(
      firstState,
    );
  });

  it("troca tokens, descobre Page + Instagram e cifra antes do repository", async () => {
    let persistedContext: MetaAuthorizationContext | undefined;
    let persisted: PersistMetaAuthorizationInput | undefined;
    const upsert = vi.fn(async (authorizationContext, input) => {
      persistedContext = authorizationContext;
      persisted = input;
      return publicAccounts;
    });
    const cipher = new SocialTokenCipher(Buffer.alloc(32, 9));
    const client = fakeClient();
    const service = new MetaOAuthService(
      config,
      client,
      fakeStateRepository(),
      fakeSocialRepository(upsert),
      cipher,
    );

    await expect(service.complete(context, callback)).resolves.toEqual(
      publicAccounts,
    );
    expect(client.exchangeCode).toHaveBeenCalledWith("authorization-code");
    expect(client.exchangeForLongLivedToken).toHaveBeenCalledWith(
      "short-user-token",
    );
    expect(persistedContext).toEqual({
      authorUserId: context.user.id,
      membershipId: context.membershipId,
      sessionId: context.sessionId,
      stateHash: createHash("sha256").update(callback.state).digest("hex"),
      tenantId: context.tenant.id,
    });
    expect(persisted?.externalUserId).toBe("9001");
    expect(persisted?.grantedScopes).toEqual([
      "pages_show_list",
      "pages_read_engagement",
      "instagram_basic",
    ]);
    expect(persisted?.accounts.map((account) => account.provider)).toEqual([
      "facebook",
      "instagram",
    ]);
    expect(persisted?.unverifiedInstagramAccountIds).toEqual([]);
    expect(cipher.decryptSecret(persisted!.userAccessTokenEncrypted)).toBe(
      "long-user-token",
    );
    expect(
      persisted?.accounts.map((account) =>
        cipher.decryptSecret(account.accessTokenEncrypted),
      ),
    ).toEqual(["page-access-token", "page-access-token"]);
    expect(JSON.stringify(persisted)).not.toContain("page-access-token");
    expect(JSON.stringify(persisted)).not.toContain("long-user-token");
  });

  it("omite Instagram quando scopes foram negados e persiste a Page", async () => {
    let persisted: PersistMetaAuthorizationInput | undefined;
    const client = fakeClient({
      getPermissions: vi.fn().mockResolvedValue([
        { name: "pages_show_list", status: "granted" },
        { name: "pages_read_engagement", status: "granted" },
        { name: "instagram_basic", status: "declined" },
      ]),
    });
    const service = new MetaOAuthService(
      config,
      client,
      fakeStateRepository(),
      fakeSocialRepository(
        vi.fn(async (_context, input) => {
          persisted = input;
          return publicAccounts;
        }),
      ),
      new SocialTokenCipher(Buffer.alloc(32, 10)),
    );

    await service.complete(context, callback);
    expect(client.getInstagramAccount).not.toHaveBeenCalled();
    expect(persisted?.accounts).toHaveLength(1);
    expect(persisted?.accounts[0]?.provider).toBe("facebook");
    expect(persisted?.unverifiedInstagramAccountIds).toEqual(["2001"]);
  });

  it("preserva a Page quando o enriquecimento opcional do Instagram falha", async () => {
    let persisted: PersistMetaAuthorizationInput | undefined;
    const client = fakeClient({
      getInstagramAccount: vi.fn().mockRejectedValue(
        new MetaOAuthClientError("graph", "instagram_profile", {
          graphCode: "100",
          status: 400,
        }),
      ),
    });
    const service = new MetaOAuthService(
      config,
      client,
      fakeStateRepository(),
      fakeSocialRepository(
        vi.fn(async (_context, input) => {
          persisted = input;
          return publicAccounts;
        }),
      ),
      new SocialTokenCipher(Buffer.alloc(32, 11)),
    );

    await service.complete(context, callback);
    expect(persisted?.accounts.map((account) => account.provider)).toEqual([
      "facebook",
    ]);
    expect(persisted?.unverifiedInstagramAccountIds).toEqual(["2001"]);
  });

  it("distingue ausência conclusiva de Instagram de falha de verificação", async () => {
    let persisted: PersistMetaAuthorizationInput | undefined;
    const client = fakeClient({
      listPages: vi.fn().mockResolvedValue([
        {
          accessToken: "page-access-token",
          id: "1001",
          instagramBusinessAccountId: null,
          name: "Page A",
          profileImageUrl: null,
          tasks: ["ANALYZE"],
          username: "page_a",
        },
      ]),
    });
    const service = new MetaOAuthService(
      config,
      client,
      fakeStateRepository(),
      fakeSocialRepository(
        vi.fn(async (_context, input) => {
          persisted = input;
          return publicAccounts;
        }),
      ),
      new SocialTokenCipher(Buffer.alloc(32, 13)),
    );

    await service.complete(context, callback);
    expect(client.getInstagramAccount).not.toHaveBeenCalled();
    expect(persisted?.accounts.map((account) => account.provider)).toEqual([
      "facebook",
    ]);
    expect(persisted?.unverifiedInstagramAccountIds).toEqual([]);
  });

  it("recusa ausência de pages_show_list e zero Pages", async () => {
    const missingScope = new MetaOAuthService(
      config,
      fakeClient({
        getPermissions: vi.fn().mockResolvedValue([
          { name: "pages_show_list", status: "declined" },
        ]),
      }),
      fakeStateRepository(),
      fakeSocialRepository(),
      new SocialTokenCipher(Buffer.alloc(32, 12)),
    );
    await expect(missingScope.complete(context, callback)).rejects.toMatchObject({
      code: "meta_oauth_provider_error",
    });

    const noPages = new MetaOAuthService(
      config,
      fakeClient({ listPages: vi.fn().mockResolvedValue([]) }),
      fakeStateRepository(),
      fakeSocialRepository(),
      new SocialTokenCipher(Buffer.alloc(32, 13)),
    );
    await expect(noPages.complete(context, callback)).rejects.toMatchObject({
      code: "meta_oauth_no_accounts",
    });
  });

  it("traduz invalidação transacional da sessão antes da persistência", async () => {
    const service = new MetaOAuthService(
      config,
      fakeClient(),
      fakeStateRepository(),
      fakeSocialRepository(
        vi.fn().mockRejectedValue(new InvalidMetaAuthorizationContextError()),
      ),
      new SocialTokenCipher(Buffer.alloc(32, 19)),
    );

    await expect(service.complete(context, callback)).rejects.toMatchObject({
      code: "meta_oauth_session_invalid",
    });
  });

  it.each([
    ["expired", "meta_oauth_expired_state"],
    ["invalid", "meta_oauth_invalid_state"],
    ["session_invalid", "meta_oauth_session_invalid"],
  ] as const)(
    "traduz state %s sem chamar a Meta",
    async (reason, expectedCode) => {
      const client = fakeClient();
      const service = new MetaOAuthService(
        config,
        client,
        fakeStateRepository({
          consume: vi.fn().mockResolvedValue({ reason, success: false }),
        }),
        fakeSocialRepository(),
        new SocialTokenCipher(Buffer.alloc(32, 14)),
      );

      await expect(service.complete(context, callback)).rejects.toMatchObject({
        code: expectedCode,
      });
      expect(client.exchangeCode).not.toHaveBeenCalled();
    },
  );

  it("consome state antes de tratar cancelamento e impede fluxo desabilitado", async () => {
    const stateRepository = fakeStateRepository();
    const client = fakeClient();
    const service = new MetaOAuthService(
      config,
      client,
      stateRepository,
      fakeSocialRepository(),
      new SocialTokenCipher(Buffer.alloc(32, 15)),
    );
    await expect(
      service.complete(context, {
        ...callback,
        code: null,
        error: "access_denied",
        errorReason: "user_denied",
      }),
    ).rejects.toMatchObject({ code: "meta_oauth_cancelled" });
    expect(stateRepository.consume).toHaveBeenCalledTimes(1);
    expect(client.exchangeCode).not.toHaveBeenCalled();

    const disabled = new MetaOAuthService(
      { ...config, appId: null, appSecret: null, enabled: false, redirectUri: null },
      null,
      stateRepository,
      fakeSocialRepository(),
      new SocialTokenCipher(Buffer.alloc(32, 16)),
    );
    await expect(disabled.start(context)).rejects.toBeInstanceOf(
      MetaOAuthFlowError,
    );
    await expect(disabled.start(context)).rejects.toMatchObject({
      code: "meta_oauth_not_configured",
    });
  });
});
