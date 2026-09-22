import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthSession,
  AuthWorkspace,
} from "../../shared/authContract";
import App from "../App";
import { AuthProvider } from "./AuthContext";
import type { AuthSyncChannel, AuthSyncEvent } from "./authSync";
import { useAuth } from "./useAuth";
import { HttpError } from "../data/api/apiClient";
import type { AuthRepository } from "../data/auth/AuthRepository";
import { initialPosts } from "../data/mockData";
import type { PostsRepository } from "../data/posts/PostsRepository";

const session: AuthSession = {
  tenant: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Workspace da Ana",
    role: "owner",
    slug: "workspace-da-ana",
  },
  user: {
    displayName: "Ana Souza",
    email: "ana@example.test",
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  },
};

const workspace: AuthWorkspace = {
  name: session.tenant.name,
  role: session.tenant.role,
  selected: true,
  slug: session.tenant.slug,
  tenantId: session.tenant.id,
};

const workspaceB: AuthWorkspace = {
  name: "Workspace do Cliente B",
  role: "admin",
  selected: false,
  slug: "workspace-cliente-b",
  tenantId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

const sessionB: AuthSession = {
  ...session,
  tenant: {
    id: workspaceB.tenantId,
    name: workspaceB.name,
    role: workspaceB.role,
    slug: workspaceB.slug,
  },
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

function createAuthRepository(
  overrides: Partial<AuthRepository> = {},
): AuthRepository {
  return {
    getCurrentSession: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockResolvedValue(session),
    listWorkspaces: vi.fn().mockResolvedValue([workspace]),
    logout: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(session),
    selectWorkspace: vi.fn().mockResolvedValue(session),
    ...overrides,
  };
}

function createPostsRepository(): PostsRepository {
  return {
    create: vi.fn(),
    list: vi.fn().mockResolvedValue(initialPosts),
  };
}

function createAuthSyncBus() {
  const subscriptions = new Map<
    number,
    Set<(event: AuthSyncEvent) => void>
  >();
  const events: AuthSyncEvent[] = [];
  let nextChannelId = 0;

  return {
    createChannel(): AuthSyncChannel {
      const channelId = nextChannelId;
      nextChannelId += 1;
      const listeners = new Set<(event: AuthSyncEvent) => void>();
      subscriptions.set(channelId, listeners);
      return {
        close: () => subscriptions.delete(channelId),
        publish: (event) => {
          events.push(event);
          subscriptions.forEach((targetListeners, targetChannelId) => {
            if (targetChannelId === channelId) return;
            targetListeners.forEach((listener) => listener(event));
          });
        },
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
    },
    events,
  };
}

function AuthSyncProbe({ label }: { label: string }) {
  const { isLoading, logout, selectWorkspace, session } = useAuth();
  return (
    <section>
      <span data-testid={`${label}-tenant`}>
        {isLoading ? "loading" : (session?.tenant.id ?? "none")}
      </span>
      <button onClick={() => void selectWorkspace(workspaceB.tenantId)}>
        {`Trocar ${label}`}
      </button>
      <button onClick={() => void logout()}>{`Sair ${label}`}</button>
    </section>
  );
}

describe("autenticação no frontend", () => {
  beforeEach(() => {
    window.location.hash = "#/login";
  });

  it("renderiza a tela de login e o acesso ao cadastro", () => {
    render(
      <App
        authRepository={createAuthRepository()}
        initialAuthSession={null}
        repository={createPostsRepository()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Criar conta" })).toHaveAttribute(
      "href",
      "#/register",
    );
  });

  it("redireciona usuário autenticado para a aplicação", async () => {
    render(
      <App
        authRepository={createAuthRepository()}
        initialAuthSession={session}
        repository={createPostsRepository()}
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: /Olá, Ana!/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Entrar" })).not.toBeInTheDocument();
  });

  it("valida o formulário antes de tentar login", async () => {
    const authRepository = createAuthRepository();
    const user = userEvent.setup();
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={null}
        repository={createPostsRepository()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "email válido e uma senha com pelo menos 12 caracteres",
    );
    expect(authRepository.login).not.toHaveBeenCalled();
  });

  it("entra, exibe usuário/tenant e mantém posts funcionando", async () => {
    const authRepository = createAuthRepository();
    const postsRepository = createPostsRepository();
    const user = userEvent.setup();
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={null}
        repository={postsRepository}
      />,
    );

    await user.type(screen.getByLabelText("Email"), "ana@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-segura-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: /Olá, Ana!/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Workspace da Ana")).toBeInTheDocument();
    expect(screen.getByText("Ana Souza")).toBeInTheDocument();
    expect(await screen.findByText(initialPosts[0].title)).toBeInTheDocument();
    expect(postsRepository.list).toHaveBeenCalledTimes(1);
  });

  it("mostra erro amigável para credenciais inválidas", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: "invalid_credentials" } }),
      { status: 401, statusText: "Unauthorized" },
    );
    const authRepository = createAuthRepository({
      login: vi
        .fn()
        .mockRejectedValue(new HttpError(response, "/auth/login", null)),
    });
    const user = userEvent.setup();
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={null}
        repository={createPostsRepository()}
      />,
    );

    await user.type(screen.getByLabelText("Email"), "ana@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-incorreta-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email ou senha inválidos.",
    );
  });

  it("mantém o envio bloqueado e informa indisponibilidade do servidor", async () => {
    const pendingLogin = deferred<AuthSession>();
    const authRepository = createAuthRepository({
      login: vi.fn(() => pendingLogin.promise),
    });
    const user = userEvent.setup();
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={null}
        repository={createPostsRepository()}
      />,
    );

    await user.type(screen.getByLabelText("Email"), "ana@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-segura-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(screen.getByRole("button", { name: "Entrando..." })).toBeDisabled();

    await act(async () => {
      pendingLogin.reject(new TypeError("fetch failed"));
      await pendingLogin.promise.catch(() => undefined);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível entrar agora",
    );
  });

  it("protege rota interna e retorna ao destino após login", async () => {
    window.location.hash = "#/agenda";
    const user = userEvent.setup();
    render(
      <App
        authRepository={createAuthRepository()}
        initialAuthSession={null}
        repository={createPostsRepository()}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "ana@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-segura-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByRole("heading", { name: "Agenda de conteúdo" }),
    ).toBeInTheDocument();
  });

  it("mostra loading enquanto verifica /auth/me", async () => {
    const pendingSession = deferred<AuthSession | null>();
    const authRepository = createAuthRepository({
      getCurrentSession: vi.fn(() => pendingSession.promise),
    });
    render(
      <App
        authRepository={authRepository}
        repository={createPostsRepository()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Verificando sessão");
    await act(async () => {
      pendingSession.resolve(null);
      await pendingSession.promise;
    });
    expect(
      await screen.findByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
  });

  it("compartilha a verificação pendente de sessão no StrictMode", async () => {
    const pendingSession = deferred<AuthSession | null>();
    const getCurrentSession = vi.fn(() => pendingSession.promise);
    const authRepository = createAuthRepository({ getCurrentSession });
    render(
      <StrictMode>
        <App
          authRepository={authRepository}
          repository={createPostsRepository()}
        />
      </StrictMode>,
    );

    expect(getCurrentSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      pendingSession.resolve(null);
      await pendingSession.promise;
    });
    expect(
      await screen.findByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
  });

  it("encerra a sessão e volta para login", async () => {
    const authRepository = createAuthRepository();
    const user = userEvent.setup();
    window.location.hash = "#/";
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={session}
        repository={createPostsRepository()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sair" }));

    expect(authRepository.logout).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
  });

  it("valida confirmação e cadastra com autenticação automática", async () => {
    window.location.hash = "#/register";
    const authRepository = createAuthRepository();
    const user = userEvent.setup();
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={null}
        repository={createPostsRepository()}
      />,
    );

    await user.type(screen.getByLabelText("Nome"), "Ana Souza");
    await user.type(screen.getByLabelText("Email"), "ana@example.test");
    await user.type(screen.getByLabelText("Senha"), "senha-segura-123");
    await user.type(
      screen.getByLabelText("Confirmar senha"),
      "senha-diferente-123",
    );
    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "confirmação de senha não corresponde",
    );
    expect(authRepository.register).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Confirmar senha"));
    await user.type(
      screen.getByLabelText("Confirmar senha"),
      "senha-segura-123",
    );
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(authRepository.register).toHaveBeenCalledWith({
      displayName: "Ana Souza",
      email: "ana@example.test",
      password: "senha-segura-123",
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: /Olá, Ana!/ }),
    ).toBeInTheDocument();
  });

  it("mantém simples a interface de usuário com um único workspace", async () => {
    window.location.hash = "#/";
    const authRepository = createAuthRepository();
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={session}
        repository={createPostsRepository()}
      />,
    );

    expect(await screen.findByText(initialPosts[0].title)).toBeInTheDocument();
    await waitFor(() => expect(authRepository.listWorkspaces).toHaveBeenCalled());
    expect(screen.getByText(session.tenant.name)).toBeInTheDocument();
    expect(screen.queryByLabelText("Workspace ativo")).not.toBeInTheDocument();
  });

  it("troca A -> B após confirmação, bloqueia repetição e invalida posts de A", async () => {
    window.location.hash = "#/";
    const pendingSelection = deferred<AuthSession>();
    const pendingPostsB = deferred<typeof initialPosts>();
    const selectWorkspace = vi.fn(() => pendingSelection.promise);
    const authRepository = createAuthRepository({
      listWorkspaces: vi.fn().mockResolvedValue([workspace, workspaceB]),
      selectWorkspace,
    });
    const postB = {
      ...initialPosts[0],
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      tenantId: workspaceB.tenantId,
      title: "Publicação exclusiva do workspace B",
    };
    const list = vi
      .fn<PostsRepository["list"]>()
      .mockResolvedValueOnce(initialPosts)
      .mockImplementationOnce(() => pendingPostsB.promise);
    const postsRepository: PostsRepository = { create: vi.fn(), list };
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={session}
        repository={postsRepository}
      />,
    );

    expect(await screen.findByText(initialPosts[0].title)).toBeInTheDocument();
    expect(screen.getByText("Publicações", { selector: ".metric-card p" }).closest("article")).toHaveTextContent("4");
    const selector = await screen.findByLabelText("Workspace ativo");
    expect(selector).toHaveValue(session.tenant.id);

    fireEvent.change(selector, { target: { value: workspaceB.tenantId } });
    fireEvent.change(selector, { target: { value: workspaceB.tenantId } });
    expect(selectWorkspace).toHaveBeenCalledTimes(1);
    expect(selector).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Trocando");
    expect(selector).toHaveValue(session.tenant.id);
    expect(screen.getByText(initialPosts[0].title)).toBeInTheDocument();

    await act(async () => {
      pendingSelection.resolve(sessionB);
      await pendingSelection.promise;
    });

    expect(await screen.findByLabelText("Workspace ativo")).toHaveValue(
      workspaceB.tenantId,
    );
    expect(screen.queryByText(initialPosts[0].title)).not.toBeInTheDocument();
    expect(screen.getByText("Carregando publicações")).toBeInTheDocument();
    expect(screen.getByText("Publicações", { selector: ".metric-card p" }).closest("article")).toHaveTextContent("—");
    expect(list).toHaveBeenCalledTimes(2);

    await act(async () => {
      pendingPostsB.resolve([postB]);
      await pendingPostsB.promise;
    });
    expect(await screen.findByText(postB.title)).toBeInTheDocument();
    expect(screen.queryByText(initialPosts[0].title)).not.toBeInTheDocument();
    expect(screen.getByText("Publicações", { selector: ".metric-card p" }).closest("article")).toHaveTextContent("1");
  });

  it("sincroniza troca de workspace e logout entre abas sem transmitir segredos", async () => {
    let serverSession: AuthSession | null = session;
    const bus = createAuthSyncBus();
    const tabARepository = createAuthRepository({
      getCurrentSession: vi.fn(async () => serverSession),
      listWorkspaces: vi.fn().mockResolvedValue([workspace, workspaceB]),
      logout: vi.fn(async () => {
        serverSession = null;
      }),
      selectWorkspace: vi.fn(async () => {
        serverSession = sessionB;
        return sessionB;
      }),
    });
    const tabBRepository = createAuthRepository({
      getCurrentSession: vi.fn(async () => serverSession),
      listWorkspaces: vi.fn().mockResolvedValue([workspace, workspaceB]),
    });
    const user = userEvent.setup();

    render(
      <>
        <AuthProvider
          initialSession={session}
          repository={tabARepository}
          syncChannel={bus.createChannel()}
        >
          <AuthSyncProbe label="aba-a" />
        </AuthProvider>
        <AuthProvider
          initialSession={session}
          repository={tabBRepository}
          syncChannel={bus.createChannel()}
        >
          <AuthSyncProbe label="aba-b" />
        </AuthProvider>
      </>,
    );

    await user.click(screen.getByRole("button", { name: "Trocar aba-a" }));

    await waitFor(() => {
      expect(screen.getByTestId("aba-a-tenant")).toHaveTextContent(
        workspaceB.tenantId,
      );
      expect(screen.getByTestId("aba-b-tenant")).toHaveTextContent(
        workspaceB.tenantId,
      );
    });
    expect(tabBRepository.getCurrentSession).toHaveBeenCalledTimes(1);
    expect(bus.events).toEqual([{ type: "workspace-changed" }]);

    await user.click(screen.getByRole("button", { name: "Sair aba-a" }));

    await waitFor(() => {
      expect(screen.getByTestId("aba-a-tenant")).toHaveTextContent("none");
      expect(screen.getByTestId("aba-b-tenant")).toHaveTextContent("none");
    });
    expect(bus.events).toEqual([
      { type: "workspace-changed" },
      { type: "session-invalidated" },
    ]);
    expect(JSON.stringify(bus.events)).not.toMatch(
      /token|cookie|aaaaaaaa|bbbbbbbb|cccccccc/i,
    );
  });

  it("ignora a resposta tardia de posts do workspace anterior", async () => {
    window.location.hash = "#/";
    const pendingPostsA = deferred<typeof initialPosts>();
    const pendingPostsB = deferred<typeof initialPosts>();
    const authRepository = createAuthRepository({
      listWorkspaces: vi.fn().mockResolvedValue([workspace, workspaceB]),
      selectWorkspace: vi.fn().mockResolvedValue(sessionB),
    });
    const postB = {
      ...initialPosts[0],
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      tenantId: workspaceB.tenantId,
      title: "Resposta atual do workspace B",
    };
    const postA = {
      ...initialPosts[0],
      title: "Resposta atrasada do workspace A",
    };
    const list = vi
      .fn<PostsRepository["list"]>()
      .mockImplementationOnce(() => pendingPostsA.promise)
      .mockImplementationOnce(() => pendingPostsB.promise);
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={session}
        repository={{ create: vi.fn(), list }}
      />,
    );

    const selector = await screen.findByLabelText("Workspace ativo");
    fireEvent.change(selector, { target: { value: workspaceB.tenantId } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    await act(async () => {
      pendingPostsB.resolve([postB]);
      await pendingPostsB.promise;
    });
    expect(await screen.findByText(postB.title)).toBeInTheDocument();

    await act(async () => {
      pendingPostsA.resolve([postA]);
      await pendingPostsA.promise;
    });
    expect(screen.getByText(postB.title)).toBeInTheDocument();
    expect(screen.queryByText(postA.title)).not.toBeInTheDocument();
  });

  it("mantém workspace e posts anteriores quando a troca falha", async () => {
    window.location.hash = "#/";
    const failedResponse = new Response(null, {
      status: 500,
      statusText: "Internal Server Error",
    });
    const authRepository = createAuthRepository({
      listWorkspaces: vi.fn().mockResolvedValue([workspace, workspaceB]),
      selectWorkspace: vi
        .fn()
        .mockRejectedValue(
          new HttpError(failedResponse, "/auth/workspaces/select", null),
        ),
    });
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={session}
        repository={createPostsRepository()}
      />,
    );

    expect(await screen.findByText(initialPosts[0].title)).toBeInTheDocument();
    const selector = await screen.findByLabelText("Workspace ativo");
    fireEvent.change(selector, { target: { value: workspaceB.tenantId } });

    expect(
      await screen.findByText("Não foi possível trocar de workspace."),
    ).toHaveAttribute("role", "alert");
    expect(selector).toHaveValue(session.tenant.id);
    expect(screen.getByText(initialPosts[0].title)).toBeInTheDocument();
  });

  it("informa falha ao listar workspaces sem encobrir a sessão atual", async () => {
    window.location.hash = "#/";
    const authRepository = createAuthRepository({
      listWorkspaces: vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    });
    render(
      <App
        authRepository={authRepository}
        initialAuthSession={session}
        repository={createPostsRepository()}
      />,
    );

    expect(
      await screen.findByText("Não foi possível carregar seus workspaces."),
    ).toHaveAttribute("role", "alert");
    expect(screen.getByText(session.tenant.name)).toBeInTheDocument();
    expect(await screen.findByText(initialPosts[0].title)).toBeInTheDocument();
  });

  it("redireciona ao login quando a sessão expira na listagem ou troca", async () => {
    window.location.hash = "#/";
    const unauthorized = new HttpError(
      new Response(null, { status: 401, statusText: "Unauthorized" }),
      "/auth/workspaces",
      null,
    );
    const expiredDuringList = createAuthRepository({
      listWorkspaces: vi.fn().mockRejectedValue(unauthorized),
    });
    const firstRender = render(
      <App
        authRepository={expiredDuringList}
        initialAuthSession={session}
        repository={createPostsRepository()}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
    firstRender.unmount();

    window.location.hash = "#/";
    const expiredDuringSwitch = createAuthRepository({
      listWorkspaces: vi.fn().mockResolvedValue([workspace, workspaceB]),
      selectWorkspace: vi.fn().mockRejectedValue(unauthorized),
    });
    render(
      <App
        authRepository={expiredDuringSwitch}
        initialAuthSession={session}
        repository={createPostsRepository()}
      />,
    );
    const selector = await screen.findByLabelText("Workspace ativo");
    fireEvent.change(selector, { target: { value: workspaceB.tenantId } });
    expect(
      await screen.findByRole("heading", { name: "Entrar" }),
    ).toBeInTheDocument();
  });
});
