import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthSession,
  AuthWorkspace,
  LoginInput,
  RegisterInput,
} from "../../shared/authContract";
import type { AuthRepository } from "../data/auth/AuthRepository";
import { HttpError } from "../data/api/apiClient";
import { AuthContext, type AuthContextValue } from "./authContextValue";
import {
  createBrowserAuthSyncChannel,
  type AuthSyncChannel,
} from "./authSync";

type AuthProviderProps = {
  children: ReactNode;
  initialSession?: AuthSession | null;
  repository: AuthRepository;
  syncChannel?: AuthSyncChannel;
};

const pendingSessionRequests = new WeakMap<
  AuthRepository,
  Promise<AuthSession | null>
>();

const pendingWorkspaceRequests = new WeakMap<
  AuthRepository,
  Map<string, Promise<AuthWorkspace[]>>
>();

function getPendingSession(repository: AuthRepository) {
  const pending = pendingSessionRequests.get(repository);
  if (pending) return pending;

  const request = repository.getCurrentSession();
  pendingSessionRequests.set(repository, request);
  const clear = () => {
    if (pendingSessionRequests.get(repository) === request) {
      pendingSessionRequests.delete(repository);
    }
  };
  void request.then(clear, clear);
  return request;
}

function getPendingWorkspaces(repository: AuthRepository, userId: string) {
  let requests = pendingWorkspaceRequests.get(repository);
  if (!requests) {
    requests = new Map();
    pendingWorkspaceRequests.set(repository, requests);
  }
  const pending = requests.get(userId);
  if (pending) return pending;

  const request = repository.listWorkspaces();
  requests.set(userId, request);
  const clear = () => {
    if (requests?.get(userId) === request) requests.delete(userId);
    if (requests?.size === 0) pendingWorkspaceRequests.delete(repository);
  };
  void request.then(clear, clear);
  return request;
}

function workspaceFromSession(session: AuthSession): AuthWorkspace {
  return {
    name: session.tenant.name,
    role: session.tenant.role,
    selected: true,
    slug: session.tenant.slug,
    tenantId: session.tenant.id,
  };
}

export function AuthProvider({
  children,
  initialSession,
  repository,
  syncChannel,
}: AuthProviderProps) {
  const hasInitialSession = initialSession !== undefined;
  const [session, setSession] = useState<AuthSession | null>(
    initialSession ?? null,
  );
  const [isLoading, setIsLoading] = useState(!hasInitialSession);
  const [workspaces, setWorkspaces] = useState<AuthWorkspace[]>(() =>
    initialSession ? [workspaceFromSession(initialSession)] : [],
  );
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(
    initialSession !== undefined && initialSession !== null,
  );
  const [isSwitchingWorkspace, setIsSwitchingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );
  const workspaceGenerationRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const workspaceSwitchInFlightRef = useRef(false);
  const syncChannelRef = useRef<AuthSyncChannel | null>(syncChannel ?? null);
  const authenticatedUserId = session?.user.id ?? null;

  const clearSessionState = useCallback(() => {
    sessionGenerationRef.current += 1;
    workspaceGenerationRef.current += 1;
    workspaceSwitchInFlightRef.current = false;
    setSession(null);
    setWorkspaces([]);
    setIsLoading(false);
    setIsLoadingWorkspaces(false);
    setIsSwitchingWorkspace(false);
    setWorkspaceError(null);
  }, []);

  useEffect(() => {
    if (hasInitialSession) return;
    const generation = sessionGenerationRef.current + 1;
    sessionGenerationRef.current = generation;
    let active = true;
    getPendingSession(repository)
      .then((currentSession) => {
        if (!active || sessionGenerationRef.current !== generation) return;
        setSession(currentSession);
        if (currentSession) {
          setWorkspaces([workspaceFromSession(currentSession)]);
          setIsLoadingWorkspaces(true);
        }
        setInitializationError(null);
      })
      .catch(() => {
        if (!active || sessionGenerationRef.current !== generation) return;
        setSession(null);
        setInitializationError(
          "Não foi possível verificar sua sessão. Tente entrar novamente.",
        );
      })
      .finally(() => {
        if (active && sessionGenerationRef.current === generation) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [hasInitialSession, repository]);

  useEffect(() => {
    const activeSyncChannel = syncChannel ?? createBrowserAuthSyncChannel();
    syncChannelRef.current = activeSyncChannel;
    const unsubscribe = activeSyncChannel.subscribe((event) => {
      if (event.type === "session-invalidated") {
        clearSessionState();
        setIsLoading(false);
        return;
      }

      const generation = sessionGenerationRef.current + 1;
      sessionGenerationRef.current = generation;
      workspaceGenerationRef.current += 1;
      workspaceSwitchInFlightRef.current = false;
      setSession(null);
      setWorkspaces([]);
      setIsLoading(true);
      setIsLoadingWorkspaces(false);
      setIsSwitchingWorkspace(false);
      setWorkspaceError(null);

      void repository
        .getCurrentSession()
        .then((currentSession) => {
          if (sessionGenerationRef.current !== generation) return;
          setSession(currentSession);
          setWorkspaces(
            currentSession ? [workspaceFromSession(currentSession)] : [],
          );
          setIsLoadingWorkspaces(Boolean(currentSession));
          setInitializationError(null);
        })
        .catch(() => {
          if (sessionGenerationRef.current !== generation) return;
          clearSessionState();
          setInitializationError(
            "Não foi possível verificar sua sessão. Tente entrar novamente.",
          );
        })
        .finally(() => {
          if (sessionGenerationRef.current === generation) setIsLoading(false);
        });
    });

    return () => {
      unsubscribe();
      if (syncChannelRef.current === activeSyncChannel) {
        syncChannelRef.current = null;
      }
      if (!syncChannel) activeSyncChannel.close();
    };
  }, [clearSessionState, repository, syncChannel]);

  useEffect(() => {
    const generation = workspaceGenerationRef.current + 1;
    workspaceGenerationRef.current = generation;
    if (!authenticatedUserId) return;

    let active = true;
    getPendingWorkspaces(repository, authenticatedUserId)
      .then((loadedWorkspaces) => {
        if (!active || workspaceGenerationRef.current !== generation) return;
        setWorkspaces(loadedWorkspaces);
      })
      .catch((error: unknown) => {
        if (!active || workspaceGenerationRef.current !== generation) return;
        if (error instanceof HttpError && error.status === 401) {
          setSession(null);
          setWorkspaces([]);
          setIsLoadingWorkspaces(false);
          return;
        }
        setWorkspaceError("Não foi possível carregar seus workspaces.");
      })
      .finally(() => {
        if (active && workspaceGenerationRef.current === generation) {
          setIsLoadingWorkspaces(false);
        }
      });

    return () => {
      active = false;
    };
  }, [authenticatedUserId, repository]);

  const login = useCallback(
    async (input: LoginInput) => {
      const nextSession = await repository.login(input);
      sessionGenerationRef.current += 1;
      setSession(nextSession);
      setWorkspaces([workspaceFromSession(nextSession)]);
      setIsLoadingWorkspaces(true);
      setWorkspaceError(null);
      setInitializationError(null);
    },
    [repository],
  );
  const register = useCallback(
    async (input: RegisterInput) => {
      const nextSession = await repository.register(input);
      sessionGenerationRef.current += 1;
      setSession(nextSession);
      setWorkspaces([workspaceFromSession(nextSession)]);
      setIsLoadingWorkspaces(true);
      setWorkspaceError(null);
      setInitializationError(null);
    },
    [repository],
  );
  const invalidateSession = useCallback(() => {
    clearSessionState();
    syncChannelRef.current?.publish({ type: "session-invalidated" });
  }, [clearSessionState]);
  const logout = useCallback(async () => {
    await repository.logout();
    clearSessionState();
    syncChannelRef.current?.publish({ type: "session-invalidated" });
  }, [clearSessionState, repository]);

  const selectWorkspace = useCallback(
    async (tenantId: string) => {
      if (
        !session ||
        session.tenant.id === tenantId ||
        workspaceSwitchInFlightRef.current
      ) {
        return;
      }

      workspaceSwitchInFlightRef.current = true;
      const sessionGeneration = sessionGenerationRef.current;
      setIsSwitchingWorkspace(true);
      setWorkspaceError(null);
      try {
        const nextSession = await repository.selectWorkspace(tenantId);
        if (sessionGenerationRef.current !== sessionGeneration) return;
        sessionGenerationRef.current += 1;
        workspaceGenerationRef.current += 1;
        setSession(nextSession);
        setWorkspaces((currentWorkspaces) =>
          currentWorkspaces.map((workspace) => ({
            ...workspace,
            selected: workspace.tenantId === nextSession.tenant.id,
          })),
        );
        syncChannelRef.current?.publish({ type: "workspace-changed" });
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          invalidateSession();
        } else {
          setWorkspaceError(
            error instanceof HttpError && error.status === 403
              ? "Você não possui acesso a este workspace."
              : "Não foi possível trocar de workspace.",
          );
        }
      } finally {
        workspaceSwitchInFlightRef.current = false;
        setIsSwitchingWorkspace(false);
      }
    },
    [invalidateSession, repository, session],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      initializationError,
      invalidateSession,
      isLoading,
      isLoadingWorkspaces,
      isSwitchingWorkspace,
      login,
      logout,
      register,
      selectWorkspace,
      session,
      workspaceError,
      workspaces,
    }),
    [
      initializationError,
      invalidateSession,
      isLoading,
      isLoadingWorkspaces,
      isSwitchingWorkspace,
      login,
      logout,
      register,
      selectWorkspace,
      session,
      workspaceError,
      workspaces,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
