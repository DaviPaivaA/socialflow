import { describe, expect, it, vi } from "vitest";
import type { AuthSession } from "../../../shared/authContract";
import { ApiClient } from "../api/apiClient";
import { HttpAuthRepository } from "./HttpAuthRepository";

const session: AuthSession = {
  tenant: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Workspace de Davi",
    role: "owner",
    slug: "workspace-de-davi",
  },
  user: {
    displayName: "Davi",
    email: "davi@example.test",
    id: "22222222-2222-4222-8222-222222222222",
  },
};

const workspaces = [
  {
    name: session.tenant.name,
    role: session.tenant.role,
    selected: true,
    slug: session.tenant.slug,
    tenantId: session.tenant.id,
  },
  {
    name: "Cliente B",
    role: "member" as const,
    selected: false,
    slug: "cliente-b",
    tenantId: "33333333-3333-4333-8333-333333333333",
  },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function repository(fetchImpl: typeof fetch) {
  return new HttpAuthRepository(
    new ApiClient({ baseUrl: "https://api.socialflow.test", fetchImpl }),
  );
}

describe("HttpAuthRepository", () => {
  it("retorna a sessão atual válida", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(session));
    await expect(repository(fetchMock).getCurrentSession()).resolves.toEqual(
      session,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.socialflow.test/auth/me",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("interpreta 401 em /auth/me como ausência de sessão", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: {} }, 401));
    await expect(repository(fetchMock).getCurrentSession()).resolves.toBeNull();
  });

  it("envia credenciais de login e valida a resposta", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(session));
    await expect(
      repository(fetchMock).login({
        email: "davi@example.test",
        password: "senha-segura-123",
      }),
    ).resolves.toEqual(session);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      email: "davi@example.test",
      password: "senha-segura-123",
    });
  });

  it("lista workspaces e envia somente a intenção de seleção", async () => {
    const selectedSession: AuthSession = {
      ...session,
      tenant: {
        id: workspaces[1].tenantId,
        name: workspaces[1].name,
        role: workspaces[1].role,
        slug: workspaces[1].slug,
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ workspaces }))
      .mockResolvedValueOnce(jsonResponse(selectedSession));
    const authRepository = repository(fetchMock);

    await expect(authRepository.listWorkspaces()).resolves.toEqual(workspaces);
    await expect(
      authRepository.selectWorkspace(workspaces[1].tenantId),
    ).resolves.toEqual(selectedSession);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.socialflow.test/auth/workspaces/select",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      tenantId: workspaces[1].tenantId,
    });
  });

  it("rejeita uma listagem de workspaces sem seleção única", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        workspaces: workspaces.map((workspace) => ({
          ...workspace,
          selected: false,
        })),
      }),
    );
    await expect(repository(fetchMock).listWorkspaces()).rejects.toThrow(
      "A API não retornou uma lista de workspaces válida.",
    );
  });

  it("rejeita resposta que exponha um contrato inválido", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ...session,
        user: { ...session.user, id: 7 },
      }),
    );
    await expect(repository(fetchMock).getCurrentSession()).rejects.toThrow(
      "A API não retornou uma sessão de usuário válida.",
    );
  });
});
