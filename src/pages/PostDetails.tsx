import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import type { SocialAccount } from "../../shared/socialAccountContract";
import { StatusPill } from "../components/StatusPill";
import { HttpError } from "../data/api/apiClient";
import type { PostDetail, PostsRepository } from "../data/posts/PostsRepository";
import type { SocialAccountsRepository } from "../data/socialAccounts/SocialAccountsRepository";
import { getPostTitle } from "../domain/postPresentation";
import { formatScheduledDate, formatScheduledTime } from "../domain/scheduling";
import type { Post } from "../types/social";

type Props = {
  repository: PostsRepository;
  socialAccountsRepository: SocialAccountsRepository;
  workspaceId: string;
  onEdit: (post: Post) => void;
  onCancel: (post: Post) => void;
  onUnauthorized?: () => void;
};

const outcomeLabels = {
  scheduled: "Agendado — resultado pendente",
  publishing: "Publicando — resultado pendente",
  published: "Publicado",
  failed: "Falha ao publicar neste destino.",
  cancelled: "Cancelado",
};

// Present only known public failure codes, never a raw provider error message.
const failureReasons: Readonly<Record<string, string>> = {
  publication_unavailable: "A publicação não está disponível.",
  publication_author_unavailable: "O autor da publicação não está disponível.",
  meta_token_invalid: "A autorização da Página precisa ser renovada.",
  meta_page_unavailable: "A Página não está disponível para publicação.",
  meta_permission_denied: "A autorização não permite publicar nesta Página.",
  media_unavailable: "A mídia não está disponível para publicação.",
  meta_invalid_request: "O conteúdo não pôde ser publicado na Página.",
  meta_rate_limited: "O limite de publicações da Meta foi atingido.",
  meta_provider_error: "Não foi possível concluir a publicação na Meta.",
  meta_timeout: "A Meta não respondeu dentro do prazo de publicação.",
  meta_processing_timeout: "A mídia não ficou pronta dentro do prazo de publicação.",
  meta_container_error: "A Meta não conseguiu processar a mídia.",
  meta_container_expired: "O prazo do container de mídia expirou.",
  publication_state_unknown: "Não foi possível confirmar o resultado da publicação. Não reenvie automaticamente: o destino pode ter recebido o conteúdo.",
};

function safeFailureReason(code: string | null): string {
  return code && Object.hasOwn(failureReasons, code)
    ? failureReasons[code]
    : "O motivo da falha não está disponível.";
}

export function PostDetails({
  repository, socialAccountsRepository, workspaceId, onEdit, onCancel, onUnauthorized,
}: Props) {
  const { postId = "" } = useParams();
  const [attempt, setAttempt] = useState(0);
  const scope = useMemo(
    () => ({ repository, socialAccountsRepository, workspaceId, postId, attempt }),
    [repository, socialAccountsRepository, workspaceId, postId, attempt],
  );
  const [result, setResult] = useState<{ scope: typeof scope; detail?: PostDetail; error?: string } | null>(null);
  const [accountResult, setAccountResult] = useState<{ scope: typeof scope; accounts: SocialAccount[]; failed?: boolean } | null>(null);
  const unauthorizedRef = useRef(onUnauthorized);
  useLayoutEffect(() => { unauthorizedRef.current = onUnauthorized; }, [onUnauthorized]);
  useLayoutEffect(() => {
    let active = true;
    void repository.get(postId).then((detail) => {
      if (active) setResult({ scope, detail });
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof HttpError && error.status === 401) unauthorizedRef.current?.();
      const message = error instanceof HttpError && error.status === 404
        ? "Publicação não encontrada."
        : error instanceof HttpError && error.status === 403 ? "Você não tem permissão para ver esta publicação."
          : error instanceof HttpError && error.status === 409 ? "A publicação mudou. Atualize os detalhes."
            : "Não foi possível carregar os detalhes da publicação.";
      setResult({ scope, error: message });
    });
    void socialAccountsRepository.list(workspaceId).then((accounts) => {
      if (active) setAccountResult({ scope, accounts });
    }).catch((error: unknown) => {
      if (!active) return;
      if (error instanceof HttpError && error.status === 401) unauthorizedRef.current?.();
      setAccountResult({ scope, accounts: [], failed: true });
    });
    return () => { active = false; };
  }, [scope, repository, socialAccountsRepository, workspaceId, postId]);
  const current = result?.scope === scope ? result : null;
  if (!current) {
    return <section className="panel page-panel"><p role="status">Carregando detalhes da publicação…</p></section>;
  }
  if (!current.detail) {
    return (
      <section className="panel page-panel">
        <p role="alert">{current.error}</p>
        <button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
          Tentar novamente
        </button>
      </section>
    );
  }
  const { post, publications, permissions } = current.detail;
  const currentAccounts = accountResult?.scope === scope ? accountResult : null;
  return (
    <section className="panel page-panel post-detail">
      <div className="section-heading">
        <h2>{getPostTitle(post)}</h2><StatusPill status={post.status} />
      </div>
      <p className="post-detail-caption">{post.caption}</p>
      <p>{post.scheduledFor ? `${formatScheduledDate(post.scheduledFor)}, ${formatScheduledTime(post.scheduledFor)}` : "Sem agendamento"}</p>
      <div className="dialog-actions">
        <button className="secondary-button" type="button" onClick={() => setAttempt((value) => value + 1)}>
          Atualizar resultados
        </button>
        {post.status === "scheduled" && permissions.canEditSchedule && (
          <button className="secondary-button" type="button" onClick={() => onEdit(post)}>Editar agendamento</button>
        )}
        {post.status === "scheduled" && permissions.canCancelSchedule && (
          <button className="secondary-button" type="button" onClick={() => onCancel(post)}>Cancelar agendamento</button>
        )}
      </div>
      <h3>Destinos</h3>
      {currentAccounts?.failed && <p role="alert">Não foi possível carregar os nomes dos destinos. Os identificadores e resultados continuam disponíveis.</p>}
      {publications.length === 0 ? <p>Nenhum destino associado</p> : (
        <ul className="destination-results">
          {publications.map((publication) => {
            const account = currentAccounts?.accounts.find((item) => item.id === publication.socialAccountId);
            return (
              <li key={publication.id}>
                <strong>{account?.displayName ?? `Conta indisponível — ${publication.socialAccountId}`}</strong>
                <p>{outcomeLabels[publication.status]}</p>
                {publication.status === "failed" && <p>{safeFailureReason(publication.errorCode)}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
