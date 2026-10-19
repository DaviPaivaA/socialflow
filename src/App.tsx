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
  matchPath,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import type { Location } from "react-router";
import type { AuthSession } from "../shared/authContract";
import { canManagePostAuthor } from "../shared/postManagementPolicy";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import { Toast } from "./components/Toast";
import type { ToastVariant } from "./components/Toast";
import { HttpError } from "./data/api/apiClient";
import { titles } from "./data/mockData";
import { createConfiguredAppServices } from "./data/createAppServices";
import type { MediaAssetsRepository } from "./data/media/MediaAssetsRepository";
import type { AuthRepository } from "./data/auth/AuthRepository";
import type {
  CreatePostInput,
  PostDetail,
  PostsRepository,
  UpdateScheduledPostInput,
} from "./data/posts/PostsRepository";
import type { SocialAccountsRepository } from "./data/socialAccounts/SocialAccountsRepository";
import {
  getScheduledTimestamp,
  selectNextScheduledPost,
} from "./domain/scheduling";
import { Composer } from "./features/composer/Composer";
import { CancelScheduleDialog } from "./features/posts/CancelScheduleDialog";
import { ScheduledPostEditor } from "./features/posts/ScheduledPostEditor";
import { AccessibleDialog } from "./components/AccessibleDialog";
import { MainLayout } from "./layout/MainLayout";
import { Agenda } from "./pages/Agenda";
import { Analytics } from "./pages/Analytics";
import { Channels } from "./pages/Channels";
import { NotFound } from "./pages/NotFound";
import { Login } from "./pages/Login";
import { Overview } from "./pages/Overview";
import { Posts } from "./pages/Posts";
import { PostDetails } from "./pages/PostDetails";
import type { PostsLoadState } from "./pages/Posts";
import { Register } from "./pages/Register";
import { Settings } from "./pages/Settings";
import {
  getNavKey, notFoundTitle, postDetailsPath, postDetailsTitle, routePaths,
} from "./routing/routes";
import type { NavKey, Post } from "./types/social";

type AppProps = {
  authRepository?: AuthRepository;
  initialAuthSession?: AuthSession | null;
  mediaAssetsRepository?: MediaAssetsRepository;
  repository?: PostsRepository;
  socialAccountsRepository?: SocialAccountsRepository;
};

type RoutedAppProps = {
  mediaAssetsRepository: MediaAssetsRepository;
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

type Cancellation = {
  request: ListRequest;
  post: Post;
  isSubmitting: boolean;
  error: string | null;
};

type Editing = {
  request: ListRequest;
  identity: object;
  postId: string;
  detail: PostDetail | null;
  isSubmitting: boolean;
  error: string | null;
};

type ConfirmedManagementChange = { kind: "cancelled"; postId: string } | { kind: "updated"; detail: PostDetail };

const MAX_TIMER_DELAY = 2_147_483_647;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpiredScheduledForError(error: unknown): error is HttpError {
  if (!(error instanceof HttpError) || error.status !== 400 || !isRecord(error.body) || !isRecord(error.body.error)) return false;
  const details = error.body.error;
  return details.code === "invalid_post" && Array.isArray(details.fields) && details.fields.includes("scheduledFor");
}

const pendingListRequests = new WeakMap<
  PostsRepository,
  Map<string, Promise<Post[]>>
>();

// Only mounted consumers subscribe. No posts/auth data or tombstones are kept
// globally; authoritative mutations reach only the current matching scope.
const confirmedManagementListeners = new WeakMap<
  PostsRepository,
  Map<string, Set<(change: ConfirmedManagementChange) => void>>
>();

function subscribeToConfirmedManagementChanges(
  request: ListRequest,
  onChange: (change: ConfirmedManagementChange) => void,
): () => void {
  let workspaces = confirmedManagementListeners.get(request.repository);
  if (!workspaces) {
    workspaces = new Map();
    confirmedManagementListeners.set(request.repository, workspaces);
  }
  let listeners = workspaces.get(request.workspaceId);
  if (!listeners) {
    listeners = new Set();
    workspaces.set(request.workspaceId, listeners);
  }
  const subscribedWorkspaces = workspaces;
  const subscribedListeners = listeners;
  subscribedListeners.add(onChange);
  return () => {
    subscribedListeners.delete(onChange);
    if (subscribedListeners.size === 0) subscribedWorkspaces.delete(request.workspaceId);
    if (subscribedWorkspaces.size === 0) confirmedManagementListeners.delete(request.repository);
  };
}

function notifyConfirmedCancellation(request: ListRequest, postId: string) {
  notifyConfirmedManagementChange(request, { kind: "cancelled", postId });
}

function notifyConfirmedManagementChange(request: ListRequest, change: ConfirmedManagementChange) {
  // Invalidate even if the originating Workspace has already unmounted.
  pendingListRequests.get(request.repository)?.delete(request.workspaceId);
  const listeners = confirmedManagementListeners.get(request.repository)?.get(request.workspaceId);
  for (const onChange of listeners ?? []) onChange(change);
}

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

  return [...createdPosts, ...loadedPosts].filter((post) => {
    if (seenIds.has(post.id)) return false;

    seenIds.add(post.id);
    return true;
  });
}

function RoutedApp({
  mediaAssetsRepository,
  repository,
  socialAccountsRepository,
  workspaceId,
}: RoutedAppProps) {
  const {
    invalidateSession,
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
  const [createdPosts, setCreatedPosts] = useState<Post[]>([]);
  const [cancelledPosts, setCancelledPosts] = useState<{ request: ListRequest; ids: Set<string> } | null>(null);
  const [cancellation, setCancellation] = useState<Cancellation | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [pendingSave, setPendingSave] = useState<{ request: ListRequest; identity: object } | null>(null);
  const [updatedPosts, setUpdatedPosts] = useState<{ request: ListRequest; posts: Post[] } | null>(null);
  const [listRevision, setListRevision] = useState(0);
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
  const managementContextRef = useRef<ListRequest | null>(null);
  const cancellationInFlightRef = useRef<Cancellation | null>(null);
  const editorIdentityRef = useRef<object | null>(null);
  const editorRevisionRef = useRef(0);
  const saveInFlightRef = useRef<object | null>(null);
  const currentEditing = editing?.request === listRequest ? editing : null;
  const currentCancellation = cancellation?.request === listRequest ? cancellation : null;
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
      : reconcilePosts(reconcilePosts(listedPosts, createdPosts), updatedPosts?.request === listRequest ? updatedPosts.posts : []).filter((post) =>
          post.status !== "cancelled" &&
          !(cancelledPosts?.request === listRequest && cancelledPosts.ids.has(post.id)),
        );
  const active = getNavKey(location);
  const firstName = session?.user.displayName.trim().split(/\s+/)[0] || "";
  const current =
    matchPath(postDetailsPath, location.pathname)
      ? postDetailsTitle
      : active === null
        ? notFoundTitle
        : active === "overview" && firstName
          ? { ...titles.overview, title: `Olá, ${firstName}! 👋` }
          : titles[active];
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
    managementContextRef.current = listRequest;
    cancellationInFlightRef.current = null;
    editorIdentityRef.current = null;
    saveInFlightRef.current = null;
    const unsubscribe = subscribeToConfirmedManagementChanges(listRequest, (change) => {
      if (managementContextRef.current !== listRequest) return;
      if (change.kind === "cancelled") {
        setCancelledPosts((currentPosts) => ({
          request: listRequest,
          ids: new Set([...(currentPosts?.request === listRequest ? currentPosts.ids : []), change.postId]),
        }));
      } else {
        setUpdatedPosts((currentPosts) => ({ request: listRequest,
          posts: [change.detail.post, ...(currentPosts?.request === listRequest ? currentPosts.posts : []).filter((post) => post.id !== change.detail.post.id)] }));
      }
      setListRevision((revision) => revision + 1);
      setScheduleNow(Date.now());
    });
    return () => {
      managementContextRef.current = null;
      unsubscribe();
    };
  }, [listRequest]);

  useLayoutEffect(() => {
    let cancelled = false;
    const generation = listGenerationRef.current + 1;
    listGenerationRef.current = generation;
    activeListGenerationRef.current = generation;

    getPendingListRequest(listRequest.repository, listRequest.workspaceId)
      .then((loadedPosts) => {
        if (
          cancelled ||
          activeListGenerationRef.current !== generation
        ) {
          return;
        }

        setUpdatedPosts((currentPosts) => {
          if (currentPosts?.request !== listRequest) return currentPosts;
          const loadedById = new Map(loadedPosts.map((post) => [post.id, post]));
          return {
            request: listRequest,
            posts: currentPosts.posts.map((post) => {
              const loaded = loadedById.get(post.id);
              // Keep the newest confirmed row in the overlay so a later stale
              // list cannot roll it back. Ties do not displace a PATCH response.
              return loaded && Date.parse(loaded.updatedAt) > Date.parse(post.updatedAt)
                ? loaded
                : post;
            }),
          };
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
  }, [listRequest, listRevision, showToast]);

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
    if (currentCancellation || currentEditing) return;
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

  const openDetails = (post: Post) => {
    routerNavigate(`/publicacoes/${encodeURIComponent(post.id)}`);
    setMobileNavLocation(null);
  };

  const closeEditor = () => {
    editorIdentityRef.current = null;
    setEditing(null);
  };

  const openEditor = (post: Post) => {
    if (managementContextRef.current !== listRequest || currentCancellation) return;
    closeComposer();
    const identity = {};
    editorIdentityRef.current = identity;
    editorRevisionRef.current = 0;
    const opened: Editing = { request: listRequest, identity, postId: post.id, detail: null, isSubmitting: false, error: null };
    setEditing(opened);
    void listRequest.repository.get(post.id).then((detail) => {
      if (managementContextRef.current !== opened.request || editorIdentityRef.current !== identity) return;
      setEditing({ ...opened, detail, error: detail.permissions.canEditSchedule ? null : "Você não tem permissão para editar este agendamento." });
    }).catch((error: unknown) => {
      if (managementContextRef.current !== opened.request || editorIdentityRef.current !== identity) return;
      if (error instanceof HttpError && error.status === 401) { invalidateSession(); return; }
      setEditing({ ...opened, error: error instanceof HttpError && error.status === 403
        ? "Você não tem permissão para editar este agendamento." : "Não foi possível carregar o agendamento. Consulte os detalhes da publicação." });
    });
  };

  const saveScheduled = async (input: UpdateScheduledPostInput) => {
    if (!currentEditing?.detail || !currentEditing.detail.permissions.canEditSchedule || saveInFlightRef.current
      || managementContextRef.current !== currentEditing.request || editorIdentityRef.current !== currentEditing.identity) return;
    const submitted = currentEditing;
    const revision = editorRevisionRef.current;
    saveInFlightRef.current = submitted.identity;
    setPendingSave({ request: submitted.request, identity: submitted.identity });
    setEditing({ ...submitted, isSubmitting: true, error: null });
    try {
      const detail = await submitted.request.repository.updateScheduled(submitted.postId, input);
      notifyConfirmedManagementChange(submitted.request, { kind: "updated", detail });
      if (managementContextRef.current !== submitted.request || editorIdentityRef.current !== submitted.identity) return;
      if (editorRevisionRef.current === revision) closeEditor();
      else setEditing((current) => current?.identity === submitted.identity ? { ...current, detail, isSubmitting: false } : current);
      showToast("Agendamento atualizado com sucesso.", "success");
    } catch (error: unknown) {
      if (managementContextRef.current !== submitted.request || editorIdentityRef.current !== submitted.identity) return;
      if (error instanceof HttpError && error.status === 401) { invalidateSession(); return; }
      const message = isExpiredScheduledForError(error)
        ? "A data do agendamento já passou. Escolha uma nova data futura e tente novamente."
        : error instanceof HttpError && error.status === 403
        ? "Você não tem permissão para editar este agendamento. Consulte os detalhes da publicação."
        : error instanceof HttpError && error.status === 409
          ? "A publicação mudou e não pode ser editada. Consulte os detalhes atualizados."
          : error instanceof HttpError && error.status === 404
            ? "Publicação não encontrada. Consulte os detalhes."
            : "Não foi possível confirmar as alterações. Consulte os detalhes antes de tentar novamente.";
      setEditing((current) => current?.identity === submitted.identity ? { ...current, isSubmitting: false, error: message } : current);
    } finally {
      if (saveInFlightRef.current === submitted.identity) saveInFlightRef.current = null;
      setPendingSave((current) => current?.identity === submitted.identity ? null : current);
    }
  };

  const openCancellation = (post: Post) => {
    if (managementContextRef.current !== listRequest || cancellationInFlightRef.current) return;
    closeComposer();
    closeEditor();
    setCancellation({ request: listRequest, post, isSubmitting: false, error: null });
  };

  const closeCancellation = () => {
    if (!cancellationInFlightRef.current) setCancellation(null);
  };

  const confirmCancellation = async () => {
    if (!currentCancellation || cancellationInFlightRef.current || managementContextRef.current !== listRequest) return;
    const submitted = currentCancellation;
    cancellationInFlightRef.current = submitted;
    setCancellation({ ...submitted, isSubmitting: true, error: null });
    try {
      await submitted.request.repository.cancelScheduled(submitted.post.id);
      notifyConfirmedCancellation(submitted.request, submitted.post.id);
      if (managementContextRef.current !== submitted.request) return;
      setCancellation(null);
      showToast("Agendamento cancelado com sucesso.", "success");
    } catch (error: unknown) {
      if (managementContextRef.current !== submitted.request) return;
      if (error instanceof HttpError && error.status === 401) {
        invalidateSession();
        return;
      }
      const message = error instanceof HttpError && error.status === 403
        ? "Você não tem permissão para cancelar este agendamento. Consulte os detalhes da publicação."
        : error instanceof HttpError && error.status === 409
          ? "A publicação mudou e o agendamento não pode ser cancelado. Consulte os detalhes atualizados da publicação."
          : error instanceof HttpError && error.status === 404
            ? "Publicação não encontrada. Consulte os detalhes para verificar a situação atual."
            : "Não foi possível confirmar o cancelamento. Verifique os detalhes da publicação antes de tentar novamente.";
      setCancellation({ ...submitted, isSubmitting: false, error: message });
    } finally {
      if (cancellationInFlightRef.current === submitted) cancellationInFlightRef.current = null;
    }
  };

  const submitPost = async (input: CreatePostInput) => {
    if (isLoadingPosts || submissionInFlightRef.current) {
      return;
    }

    const submittedPayload = { ...input };
    const submittedComposerSession = composerSessionVersionRef.current;
    const submittedDraftRevision = composerDraftRevisionRef.current;
    submissionInFlightRef.current = true;
    setIsSubmitting(true);

    try {
      const result = await repository.create(submittedPayload);
      const { post, publications } = result;
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
      if (input.publicationMode === "scheduled") {
        showToast("Publicação agendada com sucesso!", "success");
      } else {
        const publishedCount = publications.filter((publication) => publication.status === "published").length;
        const failedCount = publications.filter((publication) => publication.status === "failed").length;
        const pendingCount = publications.length - publishedCount - failedCount;
        if (pendingCount > 0) {
          showToast(`Publicação salva, mas o resultado ainda não foi confirmado: ${publishedCount} publicada(s), ${failedCount} falha(s), ${pendingCount} pendente(s).`, "error");
        } else if (publishedCount > 0 && failedCount === 0) {
          showToast("Publicação publicada com sucesso!", "success");
        } else if (publishedCount > 0) {
          showToast(`${publishedCount} publicada(s), ${failedCount} falha(s). A publicação foi salva.`, "error");
        } else if (failedCount > 0) {
          showToast(`${failedCount} destino(s) falharam. A publicação foi salva.`, "error");
        } else {
          showToast("Publicação salva, mas o resultado ainda não foi confirmado.", "error");
        }
      }
    } catch {
      showToast(input.publicationMode === "scheduled" ? "Não foi possível agendar a publicação." : "Não foi possível criar a publicação.", "error");
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
      posts={posts}
      postsLoadState={postsLoadState}
      onOpenPost={(id) => { routerNavigate(`/publicacoes/${encodeURIComponent(id)}`); setMobileNavLocation(null); }}
      modalActive={composerOpen || currentEditing !== null || currentCancellation !== null}
      overlays={
        <>
          {composerOpen && (
            <Composer
              isLoadingPosts={isLoadingPosts}
              isSubmitting={isSubmitting}
              mediaAssetsRepository={mediaAssetsRepository}
              onClose={closeComposer}
              onDraftChange={reviseComposerDraft}
              onSubmit={submitPost}
              socialAccountsRepository={socialAccountsRepository}
              workspaceId={workspaceId}
            />
          )}
          {currentCancellation && (
            <CancelScheduleDialog
              post={currentCancellation.post}
              isSubmitting={currentCancellation.isSubmitting}
              error={currentCancellation.error}
              onConfirm={() => { void confirmCancellation(); }}
              onClose={closeCancellation}
            />
          )}
          {currentEditing && (currentEditing.detail?.permissions.canEditSchedule ? <ScheduledPostEditor
            key={`${workspaceId}:${currentEditing.postId}`}
            detail={currentEditing.detail}
            workspaceId={workspaceId}
            mediaAssetsRepository={mediaAssetsRepository}
            socialAccountsRepository={socialAccountsRepository}
            isSubmitting={currentEditing.isSubmitting || pendingSave?.request === listRequest}
            error={currentEditing.error}
            onSave={saveScheduled}
            onClose={closeEditor}
            onDraftChange={() => { editorRevisionRef.current += 1; }}
          /> : <AccessibleDialog title="Editar agendamento" onClose={closeEditor}>
            {currentEditing.error ? <><p role="alert">{currentEditing.error}</p><a href={`#/publicacoes/${encodeURIComponent(currentEditing.postId)}`} onClick={closeEditor}>Consultar detalhes da publicação</a></>
              : <p role="status">Carregando agendamento…</p>}
            <button type="button" onClick={closeEditor}>Cancelar</button>
          </AccessibleDialog>)}
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
              onOpenPost={(id) => { routerNavigate(`/publicacoes/${encodeURIComponent(id)}`); setMobileNavLocation(null); }}
              posts={posts}
            />
          }
        />
        <Route
          path={postDetailsPath}
          element={
            <PostDetails
              key={listRevision}
              repository={repository}
              socialAccountsRepository={socialAccountsRepository}
              workspaceId={workspaceId}
              onEdit={openEditor}
              onCancel={openCancellation}
              onUnauthorized={invalidateSession}
            />
          }
        />
        <Route
          path={routePaths.agenda}
          element={<Agenda loadState={postsLoadState} onCompose={openComposer} posts={posts} />}
        />
        <Route
          path={routePaths.posts}
          element={
            <Posts
              loadState={postsLoadState}
              posts={posts}
              onCompose={openComposer}
              canManageAuthor={(post) => canManagePostAuthor({ userId: session.user.id, role: session.tenant.role }, post.authorUserId)}
              onDetails={openDetails}
              onEdit={openEditor}
              onCancel={openCancellation}
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
        <Route path={routePaths.settings} element={<Settings workspaceName={session.tenant.name} />} />
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
  mediaAssetsRepository,
  repository,
  socialAccountsRepository,
}: Pick<RoutedAppProps, "mediaAssetsRepository" | "repository" | "socialAccountsRepository">) {
  const { session } = useAuth();
  if (!session) return null;
  return (
    <RoutedApp
      key={session.tenant.id}
      mediaAssetsRepository={mediaAssetsRepository}
      repository={repository}
      socialAccountsRepository={socialAccountsRepository}
      workspaceId={session.tenant.id}
    />
  );
}

function AppRoutes({
  mediaAssetsRepository,
  repository,
  socialAccountsRepository,
}: Pick<RoutedAppProps, "mediaAssetsRepository" | "repository" | "socialAccountsRepository">) {
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
              mediaAssetsRepository={mediaAssetsRepository}
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
  mediaAssetsRepository,
  repository,
  socialAccountsRepository,
}: AppProps) {
  const configuredServices = useMemo(() => createConfiguredAppServices(), []);
  const resolvedAuthRepository =
    authRepository ?? configuredServices.authRepository;
  const resolvedRepository = repository ?? configuredServices.postsRepository;
  const resolvedMediaAssetsRepository = mediaAssetsRepository ?? configuredServices.mediaAssetsRepository;
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
          mediaAssetsRepository={resolvedMediaAssetsRepository}
          repository={resolvedRepository}
          socialAccountsRepository={resolvedSocialAccountsRepository}
        />
      </AuthProvider>
    </HashRouter>
  );
}
