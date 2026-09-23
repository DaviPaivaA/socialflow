import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  tokenExpiresAt: "2026-01-01T00:00:00.000Z",
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
    expect(screen.getByText("Pendente", { selector: ".connected-dot" })).toBeInTheDocument();
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
      await screen.findByRole("button", { name: "Reconectar com Meta" }),
    ).toBeDisabled();
    expect(screen.getByText("Revogada")).toBeInTheDocument();
    expect(screen.getByText("Sem credencial ativa")).toBeInTheDocument();
  });

  it("não inicia reconexão acidental no segundo clique de um disconnect rápido", async () => {
    const disconnect = vi.fn().mockResolvedValue({
      ...instagram,
      disconnectedAt: "2026-09-22T12:00:00.000Z",
      status: "revoked",
    });
    const startMetaOAuth = vi.fn();
    const user = userEvent.setup();
    render(
      <Channels
        repository={repository({
          disconnect,
          list: vi.fn().mockResolvedValue([instagram]),
          startMetaOAuth,
        })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    await user.dblClick(await screen.findByRole("button", { name: "Desconectar" }));
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(startMetaOAuth).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reconectar com Meta" })).toBeEnabled();
  });

  it("oferece reconexão Meta para expired, revoked e error sem iniciar TikTok", async () => {
    const start = deferred<string>();
    const startMetaOAuth = vi.fn(() => start.promise);
    const navigateToAuthorization = vi.fn();
    const revoked = {
      ...instagram,
      disconnectedAt: "2026-09-20T12:00:00.000Z",
      status: "revoked" as const,
    };
    const errored = {
      ...instagram,
      id: "70000000-0000-4000-8000-000000000004",
      displayName: "Instagram com erro",
      status: "error" as const,
    };
    const user = userEvent.setup();
    render(
      <Channels
        navigateToAuthorization={navigateToAuthorization}
        repository={repository({
          list: vi.fn().mockResolvedValue([facebook, revoked, errored, tiktok]),
          startMetaOAuth,
        })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    const facebookCard = (await screen.findByText("Facebook A")).closest("article") as HTMLElement;
    const instagramCard = screen.getByText("Instagram A").closest("article") as HTMLElement;
    const errorCard = screen.getByText("Instagram com erro").closest("article") as HTMLElement;
    const tiktokCard = screen.getByText("TikTok B").closest("article") as HTMLElement;
    expect(within(facebookCard).getByText(/Token vencido em/)).toBeInTheDocument();
    expect(within(instagramCard).getByText("Sem credencial ativa")).toBeInTheDocument();
    expect(within(errorCard).getByText("Reconexão necessária")).toBeInTheDocument();
    expect(within(tiktokCard).getByRole("button", { name: "Pendente" })).toBeDisabled();

    await user.dblClick(within(facebookCard).getByRole("button", { name: "Reconectar com Meta" }));
    expect(startMetaOAuth).toHaveBeenCalledTimes(1);
    expect(startMetaOAuth).toHaveBeenCalledWith(workspaceA);
    expect(within(facebookCard).getByRole("button", { name: "Abrindo Meta..." })).toBeDisabled();
    expect(within(instagramCard).getByRole("button", { name: "Reconectar com Meta" })).toBeDisabled();
    expect(within(errorCard).getByRole("button", { name: "Reconectar com Meta" })).toBeDisabled();
    expect(navigateToAuthorization).not.toHaveBeenCalled();

    await act(async () => start.resolve("https://www.facebook.com/v26.0/dialog/oauth?client_id=123&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fmeta%2Fcallback&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
    expect(navigateToAuthorization).toHaveBeenCalledTimes(1);
  });

  it("mantém o estado anterior quando a reconexão não pode começar", async () => {
    const user = userEvent.setup();
    render(
      <Channels
        repository={repository({
          list: vi.fn().mockResolvedValue([facebook]),
          startMetaOAuth: vi.fn().mockRejectedValue(new Error("Meta indisponível")),
        })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    await user.click(await screen.findByRole("button", { name: "Reconectar com Meta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível iniciar");
    expect(screen.getByText("Expirada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconectar com Meta" })).toBeEnabled();
  });

  it("não repete OAuth após uma resposta imediata enquanto a navegação está começando", async () => {
    const startMetaOAuth = vi.fn().mockResolvedValue(
      "https://www.facebook.com/v26.0/dialog/oauth?client_id=123&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fmeta%2Fcallback&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    const navigateToAuthorization = vi.fn();
    const user = userEvent.setup();
    render(
      <Channels
        navigateToAuthorization={navigateToAuthorization}
        repository={repository({
          list: vi.fn().mockResolvedValue([facebook]),
          startMetaOAuth,
        })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    await user.dblClick(await screen.findByRole("button", { name: "Reconectar com Meta" }));
    expect(startMetaOAuth).toHaveBeenCalledTimes(1);
    expect(navigateToAuthorization).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Abrindo Meta..." }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
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

  it("mantém cada botão ocupado enquanto desconexões distintas estão pendentes", async () => {
    const first = deferred<SocialAccount>();
    const second = deferred<SocialAccount>();
    const facebookConnected: SocialAccount = {
      ...facebook,
      status: "connected",
      tokenExpiresAt: null,
    };
    const disconnect = vi.fn((id: string) =>
      id === instagram.id ? first.promise : second.promise,
    );
    const user = userEvent.setup();
    render(
      <Channels
        repository={repository({
          disconnect,
          list: vi.fn().mockResolvedValue([instagram, facebookConnected]),
        })}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );

    const instagramCard = (await screen.findByText("Instagram A")).closest("article") as HTMLElement;
    const facebookCard = screen.getByText("Facebook A").closest("article") as HTMLElement;
    await user.click(within(instagramCard).getByRole("button", { name: "Desconectar" }));
    await user.click(within(facebookCard).getByRole("button", { name: "Desconectar" }));
    expect(within(instagramCard).getByRole("button", { name: "Desconectando..." })).toBeDisabled();
    expect(within(facebookCard).getByRole("button", { name: "Desconectando..." })).toBeDisabled();
    expect(disconnect).toHaveBeenCalledTimes(2);

    await act(async () => first.resolve({
      ...instagram,
      disconnectedAt: "2026-09-22T12:00:00.000Z",
      status: "revoked",
    }));
    expect(within(facebookCard).getByRole("button", { name: "Desconectando..." })).toBeDisabled();
    await act(async () => second.resolve({
      ...facebookConnected,
      disconnectedAt: "2026-09-22T12:00:00.000Z",
      status: "revoked",
    }));
    expect(disconnect).toHaveBeenCalledTimes(2);
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

  it("não navega para OAuth iniciado no Workspace anterior após a troca", async () => {
    const pendingStart = deferred<string>();
    const navigateToAuthorization = vi.fn();
    const socialRepository = repository({
      list: vi.fn().mockResolvedValue([]),
      startMetaOAuth: vi.fn(() => pendingStart.promise),
    });
    const user = userEvent.setup();
    const view = render(
      <Channels
        navigateToAuthorization={navigateToAuthorization}
        repository={socialRepository}
        workspaceId={workspaceA}
      />,
      { wrapper: Wrapper },
    );
    await user.click(await screen.findByRole("button", { name: "Conectar Facebook / Instagram" }));
    view.rerender(
      <Wrapper>
        <Channels
          navigateToAuthorization={navigateToAuthorization}
          repository={socialRepository}
          workspaceId={workspaceB}
        />
      </Wrapper>,
    );
    await act(async () => pendingStart.resolve(
      "https://www.facebook.com/v26.0/dialog/oauth?client_id=123&redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fauth%2Fmeta%2Fcallback&state=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ));
    expect(navigateToAuthorization).not.toHaveBeenCalled();
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
    expect(screen.getByText("Conectada")).toBeInTheDocument();
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
