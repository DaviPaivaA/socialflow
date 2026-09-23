import { useEffect, useRef, useState } from "react";
import type {
  SocialAccount,
  SocialAccountProvider,
  SocialAccountStatus,
} from "../../shared/socialAccountContract";
import {
  isMetaOAuthCallbackError,
  type MetaOAuthCallbackError,
} from "../../shared/metaOAuthContract";
import { useAuth } from "../auth/useAuth";
import { ChannelBadge } from "../components/ChannelBadge";
import { HttpError } from "../data/api/apiClient";
import type { SocialAccountsRepository } from "../data/socialAccounts/SocialAccountsRepository";
import type { ChannelCode } from "../types/social";

type ChannelsProps = {
  navigateToAuthorization?: (url: string) => void;
  repository: SocialAccountsRepository;
  workspaceId: string;
};

type LoadResult =
  | { accounts: SocialAccount[]; state: "success"; workspaceId: string }
  | { state: "error"; workspaceId: string };

type MetaFeedback = {
  message: string;
  variant: "error" | "success";
  workspaceId: string;
};

const providerDetails: Record<
  SocialAccountProvider,
  { code: ChannelCode; label: string }
> = {
  facebook: { code: "FB", label: "Facebook" },
  instagram: { code: "IG", label: "Instagram" },
  tiktok: { code: "TT", label: "TikTok" },
};

const statusLabels: Record<SocialAccountStatus, string> = {
  connected: "Conectada",
  error: "Com erro",
  expired: "Expirada",
  pending: "Pendente",
  revoked: "Revogada",
};

const pendingListRequests = new WeakMap<
  SocialAccountsRepository,
  Map<string, Promise<SocialAccount[]>>
>();

function getPendingListRequest(
  repository: SocialAccountsRepository,
  workspaceId: string,
): Promise<SocialAccount[]> {
  let requests = pendingListRequests.get(repository);
  if (!requests) {
    requests = new Map();
    pendingListRequests.set(repository, requests);
  }
  const pending = requests.get(workspaceId);
  if (pending) return pending;

  const request = repository.list(workspaceId);
  requests.set(workspaceId, request);
  const clear = () => {
    if (requests?.get(workspaceId) === request) requests.delete(workspaceId);
    if (requests?.size === 0) pendingListRequests.delete(repository);
  };
  void request.then(clear, clear);
  return request;
}

function accountHandle(account: SocialAccount): string {
  if (!account.username) return account.providerAccountId;
  return account.username.startsWith("@")
    ? account.username
    : `@${account.username}`;
}

function expirationLabel(account: SocialAccount): string {
  if (account.status === "revoked") return "Sem credencial ativa";
  if (account.status === "pending") return "Aguardando autorização";
  if (account.status === "error") return "Reconexão necessária";
  const value = account.tokenExpiresAt;
  if (account.status === "expired" && (!value || Date.parse(value) > Date.now())) {
    return "Reconexão necessária";
  }
  if (!value) return "Sem expiração informada";
  const date = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
  }).format(new Date(value));
  return account.status === "expired"
    ? `Token vencido em ${date}`
    : `Token até ${date}`;
}

function defaultNavigateToAuthorization(url: string) {
  window.location.assign(url);
}

function metaCallbackResult(hash: string):
  | { error: MetaOAuthCallbackError; success: false }
  | { success: true }
  | null {
  const rawHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const separator = rawHash.indexOf("?");
  if (separator < 0) return null;
  const path = rawHash.slice(0, separator).toLowerCase();
  if (path !== "/canais") return null;
  const parameters = new URLSearchParams(rawHash.slice(separator + 1));
  if (parameters.get("meta") === "connected") return { success: true };
  const error = parameters.get("meta_error");
  return isMetaOAuthCallbackError(error)
    ? { error, success: false }
    : null;
}

function clearMetaCallbackParameters() {
  const rawHash = window.location.hash.replace(/^#/, "");
  const separator = rawHash.indexOf("?");
  if (separator < 0) return;
  const path = rawHash.slice(0, separator);
  const parameters = new URLSearchParams(rawHash.slice(separator + 1));
  parameters.delete("meta");
  parameters.delete("meta_error");
  const query = parameters.toString();
  const nextHash = `#${path}${query ? `?${query}` : ""}`;
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}${nextHash}`,
  );
}

function httpErrorCode(error: HttpError): string | null {
  const body = error.body;
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "code" in body.error &&
    typeof body.error.code === "string"
  ) {
    return body.error.code;
  }
  return null;
}

const callbackErrorMessages: Record<string, string> = {
  cancelled: "A conexão com a Meta foi cancelada.",
  invalid_state:
    "Não foi possível validar essa conexão. Inicie o processo novamente.",
  no_accounts:
    "Nenhuma Página do Facebook autorizada foi encontrada nessa conta.",
  provider_error:
    "A Meta não conseguiu concluir a conexão. Tente novamente mais tarde.",
  session_expired:
    "Sua sessão expirou durante a conexão. Entre novamente para continuar.",
};

function callbackFeedback(
  callback: ReturnType<typeof metaCallbackResult>,
  workspaceId: string,
): MetaFeedback | null {
  if (!callback) return null;
  return {
    message: callback.success
      ? "Contas Meta conectadas com sucesso."
      : callbackErrorMessages[callback.error],
    variant: callback.success ? "success" : "error",
    workspaceId,
  };
}

export function Channels({
  navigateToAuthorization = defaultNavigateToAuthorization,
  repository,
  workspaceId,
}: ChannelsProps) {
  const { invalidateSession } = useAuth();
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const [actionError, setActionError] = useState<{
    message: string;
    workspaceId: string;
  } | null>(null);
  const [disconnectingIds, setDisconnectingIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [isStartingMeta, setIsStartingMeta] = useState(false);
  const [reconnectingId, setReconnectingId] = useState<string | null>(null);
  const [initialMetaCallback] = useState(() =>
    metaCallbackResult(window.location.hash),
  );
  const [metaFeedback, setMetaFeedback] = useState<MetaFeedback | null>(() =>
    callbackFeedback(initialMetaCallback, workspaceId),
  );
  const generationRef = useRef(0);
  const disconnectingIdsRef = useRef(new Set<string>());
  const metaStartInFlightRef = useRef(false);
  const metaCallbackHandledRef = useRef(false);
  const componentActiveRef = useRef(true);

  const visibleResult =
    loadResult?.workspaceId === workspaceId ? loadResult : null;
  const accounts =
    visibleResult?.state === "success" ? visibleResult.accounts : [];

  useEffect(() => {
    componentActiveRef.current = true;
    return () => {
      componentActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!initialMetaCallback || metaCallbackHandledRef.current) return;
    metaCallbackHandledRef.current = true;
    clearMetaCallbackParameters();
    if (
      !initialMetaCallback.success &&
      initialMetaCallback.error === "session_expired"
    ) {
      invalidateSession();
    }
  }, [initialMetaCallback, invalidateSession]);

  useEffect(() => {
    let active = true;
    const generation = generationRef.current + 1;
    generationRef.current = generation;

    getPendingListRequest(repository, workspaceId)
      .then((loadedAccounts) => {
        if (!active || generationRef.current !== generation) return;
        setLoadResult({
          accounts: loadedAccounts,
          state: "success",
          workspaceId,
        });
      })
      .catch((error: unknown) => {
        if (!active || generationRef.current !== generation) return;
        if (error instanceof HttpError && error.status === 401) {
          invalidateSession();
          return;
        }
        setLoadResult({ state: "error", workspaceId });
      });

    return () => {
      active = false;
    };
  }, [invalidateSession, repository, workspaceId]);

  const startMetaOAuth = async (accountId?: string) => {
    if (metaStartInFlightRef.current || !repository.startMetaOAuth) return;
    const submittedGeneration = generationRef.current;
    metaStartInFlightRef.current = true;
    let navigationStarted = false;
    setIsStartingMeta(true);
    setReconnectingId(accountId ?? null);
    setActionError(null);
    setMetaFeedback(null);
    try {
      const authorizationUrl = await repository.startMetaOAuth(workspaceId);
      if (componentActiveRef.current && generationRef.current === submittedGeneration) {
        navigateToAuthorization(authorizationUrl);
        navigationStarted = true;
      }
    } catch (error) {
      if (!componentActiveRef.current || generationRef.current !== submittedGeneration) return;
      if (error instanceof HttpError && error.status === 401) {
        invalidateSession();
        return;
      }
      const notConfigured =
        error instanceof HttpError &&
        httpErrorCode(error) === "meta_oauth_not_configured";
      setMetaFeedback({
        message: notConfigured
          ? "A conexão Meta não está disponível neste ambiente."
          : "Não foi possível iniciar a conexão com a Meta.",
        variant: "error",
        workspaceId,
      });
    } finally {
      if (!navigationStarted) {
        metaStartInFlightRef.current = false;
        if (componentActiveRef.current) {
          setIsStartingMeta(false);
          setReconnectingId(null);
        }
      }
    }
  };

  const disconnect = async (account: SocialAccount) => {
    if (
      account.status === "revoked" ||
      disconnectingIdsRef.current.has(account.id)
    ) {
      return;
    }
    const submittedWorkspace = workspaceId;
    const submittedGeneration = generationRef.current;
    disconnectingIdsRef.current.add(account.id);
    setDisconnectingIds((current) => new Set(current).add(account.id));
    setActionError(null);
    try {
      const revoked = await repository.disconnect(
        account.id,
        submittedWorkspace,
      );
      if (generationRef.current !== submittedGeneration) return;
      setLoadResult((current) =>
        current?.state === "success" &&
        current.workspaceId === submittedWorkspace
          ? {
              ...current,
              accounts: current.accounts.map((candidate) =>
                candidate.id === revoked.id ? revoked : candidate,
              ),
            }
          : current,
      );
    } catch (error) {
      if (generationRef.current !== submittedGeneration) return;
      if (error instanceof HttpError && error.status === 401) {
        invalidateSession();
        return;
      }
      setActionError({
        message: "Não foi possível desconectar esta conta.",
        workspaceId: submittedWorkspace,
      });
    } finally {
      disconnectingIdsRef.current.delete(account.id);
      if (generationRef.current === submittedGeneration) {
        setDisconnectingIds((current) => {
          const next = new Set(current);
          next.delete(account.id);
          return next;
        });
      }
    }
  };

  if (!visibleResult) {
    return (
      <section className="panel channels-state" role="status">
        <strong>Carregando contas sociais...</strong>
        <p>Consultando as contas deste Workspace.</p>
      </section>
    );
  }

  if (visibleResult.state === "error") {
    return (
      <section className="panel channels-state" role="alert">
        <strong>Não foi possível carregar as contas sociais.</strong>
        <p>Tente novamente ao acessar esta página.</p>
      </section>
    );
  }

  return (
    <>
      {metaFeedback?.workspaceId === workspaceId && (
        <p
          className={`channel-feedback channel-feedback--${metaFeedback.variant}`}
          role={metaFeedback.variant === "error" ? "alert" : "status"}
        >
          {metaFeedback.message}
        </p>
      )}
      {actionError?.workspaceId === workspaceId && (
        <p className="form-error" role="alert">{actionError.message}</p>
      )}
      <section className="channels-grid">
        {accounts.map((account) => {
          const provider = providerDetails[account.provider];
          const isDisconnecting = disconnectingIds.has(account.id);
          const canReconnectWithMeta =
            account.provider === "facebook" || account.provider === "instagram";
          const needsReconnect =
            account.status === "expired" ||
            account.status === "revoked" ||
            account.status === "error";
          return (
            <article className="panel channel-card" key={account.id}>
              <div className="channel-card-top">
                {account.profileImageUrl ? (
                  <img
                    alt={`Perfil de ${account.displayName}`}
                    className="channel-profile-image"
                    src={account.profileImageUrl}
                  />
                ) : (
                  <ChannelBadge code={provider.code} />
                )}
                <span
                  className={`connected-dot channel-status--${account.status}`}
                >
                  <i /> {statusLabels[account.status]}
                </span>
              </div>
              <h2>{account.displayName}</h2>
              <p>{accountHandle(account)}</p>
              <div className="channel-numbers">
                <strong>{provider.label}</strong>
                <span>provedor</span>
              </div>
              <div className="channel-health">
                <span>Credencial</span>
                <b>{expirationLabel(account)}</b>
              </div>
              <button
                className="secondary-button full"
                disabled={
                  isDisconnecting ||
                  account.status === "pending" ||
                  (needsReconnect && (!canReconnectWithMeta || isStartingMeta || !repository.startMetaOAuth))
                }
                onClick={(event) => {
                  if (needsReconnect && canReconnectWithMeta) {
                    if (event.detail > 1) return;
                    void startMetaOAuth(account.id);
                  } else if (account.status === "connected") {
                    void disconnect(account);
                  }
                }}
                type="button"
              >
                {isDisconnecting
                  ? "Desconectando..."
                  : isStartingMeta && reconnectingId === account.id
                    ? "Abrindo Meta..."
                    : account.status === "pending"
                      ? "Pendente"
                      : needsReconnect
                        ? canReconnectWithMeta
                          ? "Reconectar com Meta"
                          : "Reconexão em breve"
                        : "Desconectar"}
              </button>
            </article>
          );
        })}
        <div className="add-channel-card">
          <span>＋</span>
          <strong>
            {accounts.length === 0
              ? "Nenhuma conta conectada"
              : "Conectar nova conta"}
          </strong>
          <div className="add-channel-actions">
            <button
              className="secondary-button"
              disabled={isStartingMeta || !repository.startMetaOAuth}
              onClick={() => void startMetaOAuth()}
              type="button"
            >
              {isStartingMeta
                ? "Abrindo Meta..."
                : "Conectar Facebook / Instagram"}
            </button>
            <button className="secondary-button" disabled type="button">
              TikTok — Em breve
            </button>
          </div>
          {!repository.startMetaOAuth && (
            <small>Conexões reais ficam disponíveis no modo HTTP.</small>
          )}
        </div>
      </section>
    </>
  );
}
