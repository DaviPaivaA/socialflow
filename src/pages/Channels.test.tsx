import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../shared/socialAccountContract";
import { AuthContext, type AuthContextValue } from "../auth/authContextValue";
import { HttpError } from "../data/api/apiClient";
import type { SocialAccountsRepository } from "../data/socialAccounts/SocialAccountsRepository";
import { Channels } from "./Channels";

const workspaceA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspaceB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const instagram: SocialAccount = {
  createdAt: "2026-09-19T12:00:00.000Z",
  disconnectedAt: null,
  displayName: "Instagram A",
  id: "70000000-0000-4000-8000-000000000001",
  profileImageUrl: null,
  provider: "instagram",
  providerAccountId: "ig-a",
  scopes: ["instagram_basic"],
  status: "connected",
  tokenExpiresAt: "2027-01-01T00:00:00.000Z",
  updatedAt: "2026-09-19T12:00:00.000Z",
  username: "instagram_a",
};

const facebook: SocialAccount = {
  ...instagram,
  displayName: "Facebook A",
  id: "70000000-0000-4000-8000-000000000002",
  provider: "facebook",
  providerAccountId: "fb-a",
  status: "expired",
  username: null,
};

const tiktok: SocialAccount = {
  ...instagram,
  displayName: "TikTok B",
  id: "70000000-0000-4000-8000-000000000003",
  provider: "tiktok",
  providerAccountId: "tt-b",
  status: "pending",
  username: "tiktok_b",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function repository(
  overrides: Partial<SocialAccountsRepository> = {},
): SocialAccountsRepository {
  return {
    disconnect: vi.fn(),
    get: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    ...overrides,
  };
}

function authValue(
  invalidateSession = vi.fn(),
): AuthContextValue {
  return {
    initializationError: null,
    invalidateSession,
    isLoading: false,
    isLoadingWorkspaces: false,
    isSwitchingWorkspace: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    selectWorkspace: vi.fn(),
    session: null,
    workspaceError: null,
    workspaces: [],
  };
}

function Wrapper({
  children,
  value = authValue(),
}: {
  children: ReactNode;
  value?: AuthContextValue;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

describe("Channels", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/#/canais");
  });

  it("mostra loading e depois um estado vazio sem simular OAuth", async () => {
    const pending = deferred<SocialAccount[]>();
    const socialRepository = repository({
      list: vi.fn(() => pending.promise),
    });
    render(
      <Channels repository={socialRepository} workspaceId={workspaceA} />,
      { wrapper: Wrapper },
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Carregando contas sociais",
    );
    await act(async () => pending.resolve([]));
    expect(await screen.findByText("Nenhuma conta conectada")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Conectar Facebook / Instagram" }),
    ).toBeDisabled();
    expect(screen.getByText(/modo HTTP/)).toBeInTheDocument();
  });

  it("renderiza Instagram, Facebook e TikTok com estados reais", async () => {
    render(
      <Channels
        repository={repository({
          list: vi.fn().mockResolvedValue([instagram, facebook, tiktok]),
        })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    expect(await screen.findByText("Instagram A")).toBeInTheDocument();
    expect(screen.getByText("Facebook A")).toBeInTheDocument();
    expect(screen.getByText("TikTok B")).toBeInTheDocument();
    expect(screen.getByText("Conectada")).toBeInTheDocument();
    expect(screen.getByText("Expirada")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByLabelText("Instagram")).toBeInTheDocument();
    expect(screen.getByLabelText("Facebook")).toBeInTheDocument();
    expect(screen.getByLabelText("TikTok")).toBeInTheDocument();
  });

  it("mostra erro da API e invalida uma sessão expirada", async () => {
    const failedRepository = repository({
      list: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const view = render(
      <Channels repository={failedRepository} workspaceId={workspaceA} />,
      { wrapper: Wrapper },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível carregar",
    );

    const invalidateSession = vi.fn();
    const unauthorized = new HttpError(
      new Response(null, { status: 401 }),
      "/social-accounts",
      null,
    );
    view.unmount();
    render(
      <AuthContext.Provider value={authValue(invalidateSession)}>
        <Channels
          repository={repository({
            list: vi.fn().mockRejectedValue(unauthorized),
          })}
          workspaceId={workspaceA}
        />
      </AuthContext.Provider>,
    );
    await waitFor(() => expect(invalidateSession).toHaveBeenCalledTimes(1));
  });

  it("desconecta uma vez, atualiza o status e preserva dados na falha", async () => {
    const pendingDisconnect = deferred<SocialAccount>();
    const disconnect = vi.fn(() => pendingDisconnect.promise);
    const socialRepository = repository({
      disconnect,
      list: vi.fn().mockResolvedValue([instagram]),
    });
    const user = userEvent.setup();
    render(
      <Channels repository={socialRepository} workspaceId={workspaceA} />,
      { wrapper: Wrapper },
    );

    const button = await screen.findByRole("button", { name: "Desconectar" });
    await user.dblClick(button);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Desconectando..." })).toBeDisabled();

    await act(async () =>
      pendingDisconnect.resolve({
        ...instagram,
        disconnectedAt: "2026-09-20T12:00:00.000Z",
        status: "revoked",
        updatedAt: "2026-09-20T12:00:00.000Z",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Conta desconectada" }),
    ).toBeDisabled();
    expect(screen.getByText("Revogada")).toBeInTheDocument();
  });

  it("mantém a conta e informa quando a desconexão falha", async () => {
    const user = userEvent.setup();
    render(
      <Channels
        repository={repository({
          disconnect: vi.fn().mockRejectedValue(new Error("falha")),
          list: vi.fn().mockResolvedValue([instagram]),
        })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );
    await user.click(await screen.findByRole("button", { name: "Desconectar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível desconectar",
    );
    expect(screen.getByText("Instagram A")).toBeInTheDocument();
  });

  it("descarta resposta tardia do Workspace anterior", async () => {
    const pendingA = deferred<SocialAccount[]>();
    const pendingB = deferred<SocialAccount[]>();
    const socialRepository = repository({
      list: vi.fn((workspaceId) =>
        workspaceId === workspaceA ? pendingA.promise : pendingB.promise,
      ),
    });
    const view = render(
      <Channels repository={socialRepository} workspaceId={workspaceA} />,
      { wrapper: Wrapper },
    );

    view.rerender(
      <Wrapper>
        <Channels repository={socialRepository} workspaceId={workspaceB} />
      </Wrapper>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Carregando");
    await act(async () => pendingB.resolve([tiktok]));
    expect(await screen.findByText("TikTok B")).toBeInTheDocument();
    await act(async () => pendingA.resolve([instagram]));
    expect(screen.queryByText("Instagram A")).not.toBeInTheDocument();
    expect(screen.getByText("TikTok B")).toBeInTheDocument();
  });

  it("inicia OAuth Meta uma única vez e navega somente após confirmação", async () => {
    const pendingStart = deferred<string>();
    const startMetaOAuth = vi.fn(() => pendingStart.promise);
    const navigateToAuthorization = vi.fn();
    const user = userEvent.setup();
    render(
      <Channels
        navigateToAuthorization={navigateToAuthorization}
        repository={repository({ startMetaOAuth })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    const button = await screen.findByRole("button", {
      name: "Conectar Facebook / Instagram",
    });
    await user.dblClick(button);
    expect(startMetaOAuth).toHaveBeenCalledTimes(1);
    expect(startMetaOAuth).toHaveBeenCalledWith(workspaceA);
    expect(screen.getByRole("button", { name: "Abrindo Meta..." })).toBeDisabled();
    expect(navigateToAuthorization).not.toHaveBeenCalled();

    await act(async () =>
      pendingStart.resolve(
        "https://www.facebook.com/v26.0/dialog/oauth?client_id=123&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fmeta%2Fcallback&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    );
    expect(navigateToAuthorization).toHaveBeenCalledTimes(1);
  });

  it("mostra configuração Meta indisponível e invalida resposta 401", async () => {
    const user = userEvent.setup();
    const notConfigured = new HttpError(
      Response.json(
        { error: { code: "meta_oauth_not_configured" } },
        { status: 503 },
      ),
      "/auth/meta/start",
      { error: { code: "meta_oauth_not_configured" } },
    );
    const view = render(
      <Channels
        repository={repository({
          startMetaOAuth: vi.fn().mockRejectedValue(notConfigured),
        })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Conectar Facebook / Instagram",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "não está disponível",
    );

    const invalidateSession = vi.fn();
    const unauthorized = new HttpError(
      new Response(null, { status: 401 }),
      "/auth/meta/start",
      null,
    );
    view.unmount();
    render(
      <AuthContext.Provider value={authValue(invalidateSession)}>
        <Channels
          repository={repository({
            startMetaOAuth: vi.fn().mockRejectedValue(unauthorized),
          })}
          workspaceId={workspaceA}
        />
      </AuthContext.Provider>,
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Conectar Facebook / Instagram",
      }),
    );
    await waitFor(() => expect(invalidateSession).toHaveBeenCalledTimes(1));
  });

  it("processa retorno Meta seguro, recarrega contas e limpa o parâmetro", async () => {
    window.history.replaceState({}, "", "/#/canais?meta=connected");
    const list = vi.fn().mockResolvedValue([instagram]);
    render(
      <Channels
        repository={repository({ list, startMetaOAuth: vi.fn() })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    expect(await screen.findByText("Instagram A")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Contas Meta conectadas com sucesso",
    );
    expect(window.location.hash).toBe("#/canais");
    expect(list).toHaveBeenCalledWith(workspaceA);
  });

  it.each([
    ["cancelled", "foi cancelada"],
    ["invalid_state", "Não foi possível validar"],
    ["no_accounts", "Nenhuma Página do Facebook"],
    ["provider_error", "não conseguiu concluir"],
  ])(
    "mostra retorno Meta %s sem detalhes do provider",
    async (errorCode, expectedMessage) => {
      window.history.replaceState(
        {},
        "",
        `/#/canais?meta_error=${errorCode}`,
      );
      render(
        <Channels repository={repository()} workspaceId={workspaceA} />,
        { wrapper: Wrapper },
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        expectedMessage,
      );
      expect(window.location.hash).toBe("#/canais");
    },
  );

  it("invalida a sessão quando o callback informa expiração", async () => {
    window.history.replaceState(
      {},
      "",
      "/#/canais?meta_error=session_expired",
    );
    const invalidateSession = vi.fn();
    render(
      <AuthContext.Provider value={authValue(invalidateSession)}>
        <Channels repository={repository()} workspaceId={workspaceA} />
      </AuthContext.Provider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sua sessão expirou",
    );
    await waitFor(() => expect(invalidateSession).toHaveBeenCalledTimes(1));
    expect(window.location.hash).toBe("#/canais");
  });

  it("mantém TikTok fora do OAuth Meta", async () => {
    const startMetaOAuth = vi.fn();
    const user = userEvent.setup();
    render(
      <Channels
        repository={repository({ startMetaOAuth })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    const tiktokButton = await screen.findByRole("button", {
      name: "TikTok — Em breve",
    });
    expect(tiktokButton).toBeDisabled();
    await user.click(tiktokButton);
    expect(startMetaOAuth).not.toHaveBeenCalled();
  });
});
