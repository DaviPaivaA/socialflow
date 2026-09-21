import { describe, expect, it } from "vitest";
import {
  isSocialAccount,
  isSocialAccountProvider,
  isSocialAccountStatus,
} from "../../shared/socialAccountContract.ts";
import { validateUpdateSocialAccount } from "../src/socialAccountContract.ts";

const account = {
  createdAt: "2026-09-19T12:00:00.000Z",
  disconnectedAt: null,
  displayName: "Café Aurora",
  id: "70000000-0000-4000-8000-000000000001",
  profileImageUrl: "https://cdn.example.test/avatar.png",
  provider: "instagram",
  providerAccountId: "ig-123",
  scopes: ["instagram_basic"],
  status: "connected",
  tokenExpiresAt: "2027-01-01T00:00:00.000Z",
  updatedAt: "2026-09-19T12:00:00.000Z",
  username: "cafeaurora",
} as const;

describe("contrato de contas sociais", () => {
  it.each(["instagram", "facebook", "tiktok"])(
    "aceita o provider suportado %s",
    (provider) => expect(isSocialAccountProvider(provider)).toBe(true),
  );

  it("rejeita providers e status arbitrários", () => {
    expect(isSocialAccountProvider("linkedin")).toBe(false);
    expect(isSocialAccountStatus("enabled")).toBe(false);
  });

  it("aceita DTO público válido e rejeita segredo ou dado inválido", () => {
    expect(isSocialAccount(account)).toBe(true);
    expect(isSocialAccount({ ...account, accessToken: "segredo" })).toBe(false);
    expect(isSocialAccount({ ...account, profileImageUrl: "javascript:x" })).toBe(false);
    expect(isSocialAccount({ ...account, status: "revoked" })).toBe(false);
    expect(
      isSocialAccount({
        ...account,
        disconnectedAt: "2026-09-20T12:00:00.000Z",
        status: "revoked",
      }),
    ).toBe(true);
  });

  it("limita atualização pública aos metadados permitidos", () => {
    expect(
      validateUpdateSocialAccount({
        displayName: "  Novo nome  ",
        profileImageUrl: null,
        username: "novo_usuario",
      }),
    ).toEqual({
      data: {
        displayName: "Novo nome",
        profileImageUrl: null,
        username: "novo_usuario",
      },
      success: true,
    });
    expect(
      validateUpdateSocialAccount({ tenantId: account.id }),
    ).toEqual({ fields: ["tenantId"], success: false });
    expect(validateUpdateSocialAccount({ status: "connected" })).toEqual({
      fields: ["status"],
      success: false,
    });
  });
});
