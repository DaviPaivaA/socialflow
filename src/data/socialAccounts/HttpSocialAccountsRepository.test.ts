import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../shared/socialAccountContract";
import { ApiClient } from "../api/apiClient";
import { HttpSocialAccountsRepository } from "./HttpSocialAccountsRepository";

const account: SocialAccount = {
  createdAt: "2026-09-19T12:00:00.000Z",
  disconnectedAt: null,
  displayName: "Café Aurora",
  id: "70000000-0000-4000-8000-000000000001",
  profileImageUrl: null,
  provider: "instagram",
  providerAccountId: "ig-123",
  scopes: ["instagram_basic"],
  status: "connected",
  tokenExpiresAt: "2027-01-01T00:00:00.000Z",
  updatedAt: "2026-09-19T12:00:00.000Z",
  username: "cafeaurora",
};

function repositoryWith(fetchImpl: typeof fetch) {
  return new HttpSocialAccountsRepository(
    new ApiClient({ baseUrl: "https://api.example.test", fetchImpl }),
  );
}

describe("HttpSocialAccountsRepository", () => {
  it("lista e consulta somente DTOs públicos válidos", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ socialAccounts: [account] }),
      )
      .mockResolvedValueOnce(Response.json(account));
    const repository = repositoryWith(fetchMock);

    await expect(repository.list("workspace-a")).resolves.toEqual([account]);
    await expect(repository.get(account.id, "workspace-a")).resolves.toEqual(
      account,
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.test/social-accounts",
      `https://api.example.test/social-accounts/${account.id}`,
    ]);
  });

  it("rejeita lista malformada e qualquer resposta com segredo", async () => {
    const malformed = repositoryWith(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ socialAccounts: [{ id: account.id }] }),
      ),
    );
    await expect(malformed.list("workspace-a")).rejects.toThrow(
      "lista válida",
    );

    const leaked = repositoryWith(
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ ...account, accessTokenEncrypted: "ciphertext" }),
      ),
    );
    await expect(leaked.get(account.id, "workspace-a")).rejects.toThrow(
      "conta social válida",
    );
  });

  it("atualiza metadados e desconecta usando os métodos HTTP esperados", async () => {
    const revoked: SocialAccount = {
      ...account,
      disconnectedAt: "2026-09-20T12:00:00.000Z",
      status: "revoked",
      updatedAt: "2026-09-20T12:00:00.000Z",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...account, displayName: "Novo" }))
      .mockResolvedValueOnce(Response.json(revoked));
    const repository = repositoryWith(fetchMock);

    await expect(
      repository.update(account.id, { displayName: "Novo" }, "workspace-a"),
    ).resolves.toEqual({ ...account, displayName: "Novo" });
    await expect(
      repository.disconnect(account.id, "workspace-a"),
    ).resolves.toEqual(revoked);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("inicia OAuth Meta com body vazio e valida a URL versionada", async () => {
    const authorizationUrl =
      "https://www.facebook.com/v26.0/dialog/oauth?client_id=123&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fmeta%2Fcallback&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ authorizationUrl }));
    const repository = repositoryWith(fetchMock);

    await expect(repository.startMetaOAuth("workspace-a")).resolves.toBe(
      authorizationUrl,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/auth/meta/start",
      expect.objectContaining({
        body: "{}",
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("rejeita URL OAuth Meta de host ou contrato inesperado", async () => {
    const repository = repositoryWith(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ authorizationUrl: "https://evil.example/oauth" }),
        ),
    );

    await expect(repository.startMetaOAuth("workspace-a")).rejects.toThrow(
      "URL OAuth Meta válida",
    );
  });
});
