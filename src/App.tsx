import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  HashRouter,
  Navigate,
import {
  HashRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import type { Location } from "react-router";
import type { AuthSession } from "../shared/authContract";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import { Toast } from "./components/Toast";
import type { ToastVariant } from "./components/Toast";
import { titles } from "./data/mockData";
import { createConfiguredAppServices } from "./data/createAppServices";
import type { AuthRepository } from "./data/auth/AuthRepository";
import { Toast } from "./components/Toast";
import type { ToastVariant } from "./components/Toast";
import { titles } from "./data/mockData";
import { createConfiguredPostsRepository } from "./data/posts/createPostsRepository";
import type {
  CreatePostInput,
  PostsRepository,
} from "./data/posts/PostsRepository";
import type { SocialAccountsRepository } from "./data/socialAccounts/SocialAccountsRepository";
import {
  getScheduledTimestamp,
  selectNextScheduledPost,
} from "./domain/scheduling";
import { Composer } from "./features/composer/Composer";
import { MainLayout } from "./layout/MainLayout";
import { Agenda } from "./pages/Agenda";
import { Analytics } from "./pages/Analytics";
import { Channels } from "./pages/Channels";
import { NotFound } from "./pages/NotFound";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { Posts } from "./pages/Posts";
import type { PostsLoadState } from "./pages/Posts";
import { Register } from "./pages/Register";
import { Overview } from "./pages/Overview";
import { Posts } from "./pages/Posts";
import type { PostsLoadState } from "./pages/Posts";
import { Settings } from "./pages/Settings";
import { getNavKey, notFoundTitle, routePaths } from "./routing/routes";
import type { NavKey, Post } from "./types/social";

type AppProps = {
  authRepository?: AuthRepository;
  initialAuthSession?: AuthSession | null;
  repository?: PostsRepository;
  socialAccountsRepository?: SocialAccountsRepository;
  repository?: PostsRepository;
};

type RoutedAppProps = {
  repository: PostsRepository;
  socialAccountsRepository: SocialAccountsRepository;
  workspaceId: string;
};

type ListRequest = {
  repository: PostsRepository;
  workspaceId: string;
};

type PostsLoadResult =
  | {
      generation: number;
      posts: Post[];
      request: ListRequest;
      state: "success";
    }
  | {
      generation: number;
      request: ListRequest;
      state: "error";
    };

type ToastNotification = {
  id: number;
  message: string;
  variant: ToastVariant;
};

const MAX_TIMER_DELAY = 2_147_483_647;

const pendingListRequests = new WeakMap<
  PostsRepository,
  Map<string, Promise<Post[]>>
>();

function getPendingListRequest(
  repository: PostsRepository,
  workspaceId: string,
): Promise<Post[]> {
  let requests = pendingListRequests.get(repository);
  if (!requests) {
    requests = new Map();
    pendingListRequests.set(repository, requests);
  }
  const pendingRequest = requests.get(workspaceId);
  if (pendingRequest) return pendingRequest;

  const request = repository.list();
  requests.set(workspaceId, request);

  const clearPendingRequest = () => {
    if (requests?.get(workspaceId) === request) {
      requests.delete(workspaceId);
    }
    if (requests?.size === 0) {
  Promise<Post[]>
>();

function getPendingListRequest(repository: PostsRepository): Promise<Post[]> {
  const pendingRequest = pendingListRequests.get(repository);
  if (pendingRequest) return pendingRequest;

  const request = repository.list();
  pendingListRequests.set(repository, request);

  const clearPendingRequest = () => {
    if (pendingListRequests.get(repository) === request) {
      pendingListRequests.delete(repository);
    }
  };

  void request.then(clearPendingRequest, clearPendingRequest);
  return request;
}

function reconcilePosts(
  loadedPosts: Post[],
  createdPosts: readonly Post[],
): Post[] {
  const seenIds = new Set<string>();
  const seenIds = new Set<number>();

  return [...createdPosts, ...loadedPosts].filter((post) => {
    if (seenIds.has(post.id)) return false;

    seenIds.add(post.id);
    return true;
  });
}

function RoutedApp({
  repository,
  socialAccountsRepository,
  workspaceId,
}: RoutedAppProps) {
  const {
    isLoadingWorkspaces,
    isSwitchingWorkspace,
    logout,
    selectWorkspace,
    session,
    workspaceError,
    workspaces,
  } = useAuth();
  const location = useLocation();
  const routerNavigate = useNavigate();
  const listRequest = useMemo<ListRequest>(
    () => ({ repository, workspaceId }),
    [repository, workspaceId],
  );
function RoutedApp({ repository }: RoutedAppProps) {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const listRequest = useMemo<ListRequest>(() => ({ repository }), [repository]);
  const [createdPosts, setCreatedPosts] = useState<Post[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [toast, setToast] = useState<ToastNotification | null>(null);
  const [mobileNavLocation, setMobileNavLocation] = useState<Location | null>(
    null,
  );
  const [postsLoadResult, setPostsLoadResult] =
    useState<PostsLoadResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [scheduleNow, setScheduleNow] = useState(() => Date.now());
  const submissionInFlightRef = useRef(false);
  const logoutInFlightRef = useRef(false);
  const composerSessionVersionRef = useRef(0);
  const composerDraftRevisionRef = useRef(0);
  const listGenerationRef = useRef(0);
  const activeListGenerationRef = useRef(0);
  const toastIdRef = useRef(0);
  const toastTimeoutRef = useRef<number | null>(null);
  const postsLoadState: PostsLoadState =
    postsLoadResult?.request === listRequest
      ? postsLoadResult.state
      : "loading";
  const isLoadingPosts = postsLoadState === "loading";
  const listedPosts =
    postsLoadResult?.request === listRequest &&
    postsLoadResult.state === "success"
      ? postsLoadResult.posts
      : [];
  const posts =
    postsLoadState === "loading"
      ? []
      : reconcilePosts(listedPosts, createdPosts);
  const active = getNavKey(location);
  const firstName = session?.user.displayName.trim().split(/\s+/)[0] || "";
  const current =
    active === null
      ? notFoundTitle
      : active === "overview" && firstName
        ? { ...titles.overview, title: `Olá, ${firstName}! 👋` }
        : titles[active];
  const current = active === null ? notFoundTitle : titles[active];
  const nextPost =
    postsLoadState === "success"
      ? selectNextScheduledPost(posts, scheduleNow)
      : undefined;
  const mobileNavOpen = mobileNavLocation === location;

  const showToast = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = toastIdRef.current + 1;
      toastIdRef.current = id;

      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
      }

      setToast({ id, message, variant });
      toastTimeoutRef.current = window.setTimeout(() => {
        setToast((currentToast) =>
          currentToast?.id === id ? null : currentToast,
        );
        if (toastIdRef.current === id) toastTimeoutRef.current = null;
      }, 3500);
    },
    [],
  );

  useLayoutEffect(() => {
    let cancelled = false;
    const generation = listGenerationRef.current + 1;
    listGenerationRef.current = generation;
    activeListGenerationRef.current = generation;

    getPendingListRequest(listRequest.repository, listRequest.workspaceId)
    getPendingListRequest(listRequest.repository)
      .then((loadedPosts) => {
        if (
          cancelled ||
          activeListGenerationRef.current !== generation
        ) {
          return;
        }

        setScheduleNow(Date.now());
        setPostsLoadResult({
          generation,
          posts: loadedPosts,
          request: listRequest,
          state: "success",
        });
      })
      .catch(() => {
        if (
          !cancelled &&
          activeListGenerationRef.current === generation
        ) {
          showToast("Não foi possível carregar as publicações.", "error");
          setPostsLoadResult({
            generation,
            request: listRequest,
            state: "error",
          });
        }
      });


        setScheduleNow(Date.now());
        setPostsLoadResult({
          generation,
          posts: loadedPosts,
          request: listRequest,
          state: "success",
        });
      })
      .catch(() => {
        if (
          !cancelled &&
          activeListGenerationRef.current === generation
        ) {
          showToast("Não foi possível carregar as publicações.", "error");
          setPostsLoadResult({
            generation,
            request: listRequest,
            state: "error",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [listRequest, showToast]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!nextPost) return;

    const scheduledTimestamp = getScheduledTimestamp(nextPost.scheduledFor);
    const scheduledTimestamp = getScheduledTimestamp(nextPost.scheduledAt);
    if (scheduledTimestamp === null) return;

    const delay = Math.min(
      Math.max(scheduledTimestamp - Date.now(), 0),
      MAX_TIMER_DELAY,
    );
    const timeout = window.setTimeout(() => {
      setScheduleNow(Date.now());
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [nextPost, scheduleNow]);

  const navigate = (view: NavKey) => {
    routerNavigate(routePaths[view]);
    setMobileNavLocation(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openComposer = () => {
    composerSessionVersionRef.current += 1;
    setComposerOpen(true);
  };

  const closeComposer = () => {
    composerSessionVersionRef.current += 1;
    setComposerOpen(false);
  };

  const reviseComposerDraft = () => {
    composerDraftRevisionRef.current += 1;
  };

  const schedulePost = async (input: CreatePostInput) => {
    if (isLoadingPosts || submissionInFlightRef.current) {
      return;
    }

    const submittedPayload = { ...input };
    const submittedPayload = {
      ...input,
      channels: [...input.channels],
    };
    const submittedComposerSession = composerSessionVersionRef.current;
    const submittedDraftRevision = composerDraftRevisionRef.current;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);

    try {
      const post = await repository.create(submittedPayload);
      setScheduleNow(Date.now());
      setCreatedPosts((currentPosts) => [
        post,
        ...currentPosts.filter((currentPost) => currentPost.id !== post.id),
      ]);
      if (
        composerSessionVersionRef.current === submittedComposerSession &&
        composerDraftRevisionRef.current === submittedDraftRevision
      ) {
        closeComposer();
      }
      showToast("Publicação agendada com sucesso!", "success");
    } catch {
      showToast("Não foi possível agendar a publicação.", "error");
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const signOut = async () => {
    if (logoutInFlightRef.current) return;
    logoutInFlightRef.current = true;
    try {
      await logout();
      routerNavigate("/login", { replace: true });
    } catch {
      showToast("Não foi possível sair. Tente novamente.", "error");
    } finally {
      logoutInFlightRef.current = false;
    }
  };

  if (!session) return null;

  return (
    <MainLayout
      active={active}
      currentTenant={session.tenant}
      currentUser={session.user}
      isLoadingWorkspaces={isLoadingWorkspaces}
      isSwitchingWorkspace={isSwitchingWorkspace}
      mobileNavOpen={mobileNavOpen}
      overlays={
        <>
          {composerOpen && (
            <Composer
              isLoadingPosts={isLoadingPosts}
              isSubmitting={isSubmitting}
              onClose={closeComposer}
              onDraftChange={reviseComposerDraft}
              onSchedule={schedulePost}
            />
          )}
          {toast && (
            <Toast message={toast.message} variant={toast.variant} />
          )}
        </>
      }
      pageTitle={current}
      onCompose={openComposer}
      onLogout={signOut}
      onNavigate={navigate}
      onSelectWorkspace={selectWorkspace}
      onToggleMenu={() =>
        setMobileNavLocation((openLocation) =>
          openLocation === location ? null : location,
        )
      }
      workspaceError={workspaceError}
      workspaces={workspaces}
    >
      <Routes>
        <Route
          path={routePaths.overview}
          element={
            <Overview
              goTo={navigate}
              loadState={postsLoadState}
              nextPost={nextPost}
              onCompose={openComposer}
            />
          }
        />
        <Route
          path={routePaths.agenda}
          element={<Agenda onCompose={openComposer} />}
        />
        <Route
          path={routePaths.posts}
          element={
            <Posts
              loadState={postsLoadState}
              posts={posts}
              onCompose={openComposer}
            />
          }
        />
        <Route path={routePaths.analytics} element={<Analytics />} />
        <Route
          path={routePaths.channels}
          element={
            <Channels
              repository={socialAccountsRepository}
              workspaceId={workspaceId}
            />
          }
        />
        <Route path={routePaths.channels} element={<Channels />} />
        <Route path={routePaths.settings} element={<Settings />} />
        <Route
          path="*"
          element={<NotFound onGoHome={() => navigate("overview")} />}
        />
      </Routes>
    </MainLayout>
  );
}

function SessionLoading() {
  return (
    <main className="auth-shell">
      <section className="auth-card auth-loading" role="status">
        <strong>SocialFlow</strong>
        <p>Verificando sessão...</p>
      </section>
    </main>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoading, session } = useAuth();
  const location = useLocation();
  if (isLoading) return <SessionLoading />;
  if (!session) {
    return (
      <Navigate
        replace
        state={{ from: location.pathname }}
        to="/login"
      />
    );
  }
  return children;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { isLoading, session } = useAuth();
  const location = useLocation();
  if (isLoading) return <SessionLoading />;
  const requestedPath = (location.state as { from?: unknown } | null)?.from;
  const destination =
    typeof requestedPath === "string" && /^\/(?!\/)/.test(requestedPath)
      ? requestedPath
      : "/";
  return session ? <Navigate replace to={destination} /> : children;
}

function AuthenticatedApplication({
  repository,
  socialAccountsRepository,
}: Pick<RoutedAppProps, "repository" | "socialAccountsRepository">) {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <RoutedApp
      key={session.tenant.id}
      repository={repository}
      socialAccountsRepository={socialAccountsRepository}
      workspaceId={session.tenant.id}
    />
  );
}

function AppRoutes({
  repository,
  socialAccountsRepository,
}: Pick<RoutedAppProps, "repository" | "socialAccountsRepository">) {
  return (
    <Routes>
      <Route
        path="/login"
        element={<PublicOnly><Login /></PublicOnly>}
      />
      <Route
        path="/register"
        element={<PublicOnly><Register /></PublicOnly>}
      />
      <Route
        path="*"
        element={
          <RequireAuth>
            <AuthenticatedApplication
              repository={repository}
              socialAccountsRepository={socialAccountsRepository}
            />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App({
  authRepository,
  initialAuthSession,
  repository,
  socialAccountsRepository,
}: AppProps) {
  const configuredServices = useMemo(() => createConfiguredAppServices(), []);
  const resolvedAuthRepository =
    authRepository ?? configuredServices.authRepository;
  const resolvedRepository = repository ?? configuredServices.postsRepository;
  const resolvedSocialAccountsRepository =
    socialAccountsRepository ?? configuredServices.socialAccountsRepository;
  const resolvedInitialSession =
    initialAuthSession !== undefined
      ? initialAuthSession
      : authRepository
        ? undefined
        : configuredServices.initialAuthSession;

  return (
    <HashRouter>
      <AuthProvider
        initialSession={resolvedInitialSession}
        repository={resolvedAuthRepository}
      >
        <AppRoutes
          repository={resolvedRepository}
          socialAccountsRepository={resolvedSocialAccountsRepository}
        />
      </AuthProvider>
export default function App({ repository }: AppProps) {
  const resolvedRepository = useMemo(
    () => repository ?? createConfiguredPostsRepository(),
    [repository],
  );

  return (
    <HashRouter>
      <RoutedApp repository={resolvedRepository} />
    </HashRouter>
  );
}
