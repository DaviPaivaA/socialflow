import { useEffect, useState } from "react";
import { WeekCalendar } from "../../components/WeekCalendar";
import { HttpError } from "../../data/api/apiClient";
import type { PostsRepository } from "../../data/posts/PostsRepository";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";
import type { Post } from "../../types/social";

export type AgendaAssociations = {
  workspaceId?: string;
  repository?: Pick<PostsRepository, "get">;
  socialAccountsRepository?: Pick<SocialAccountsRepository, "list">;
  onUnauthorized?: () => void;
};
type Props = AgendaAssociations & { posts: Post[]; platform: "facebook" | "instagram"; today: Date };
type Result = { source: Post[]; workspaceId: string; posts: Post[]; partial: boolean; failed: boolean };
const MAX_IDENTIFICATION_POSTS = 50;
const unavailable = "Identificação de plataforma indisponível. Não é possível informar uma contagem sem verificar os destinos deste Workspace.";

/** GETs adicionais apenas enquanto o filtro Meta está montado, sem cache global. */
export function MetaAgendaFilter({ posts, platform, today, repository, socialAccountsRepository, workspaceId, onUnauthorized }: Props) {
  const [result, setResult] = useState<Result | null>(null);
  const canIdentify = !!repository && !!socialAccountsRepository && !!workspaceId && posts.length <= MAX_IDENTIFICATION_POSTS;
  useEffect(() => {
    let active = true;
    if (!canIdentify || !repository || !socialAccountsRepository || !workspaceId) return;
    const identify = async () => {
      try {
        const accounts = await socialAccountsRepository.list(workspaceId);
        if (!active) return;
        const accountProviders = new Map(accounts.map((account) => [account.id, account.provider]));
        const matched: Post[] = [];
        let partial = false;
        // Bound + sequential reads: never a fan-out across every post/account.
        for (const post of posts) {
          if (!active) return;
          if (post.tenantId !== workspaceId) { partial = true; continue; }
          const detail = await repository.get(post.id);
          if (!active) return;
          if (detail.post.id !== post.id || detail.post.tenantId !== workspaceId || detail.publications.length === 0 ||
            detail.publications.some((publication) => publication.postId !== post.id || publication.tenantId !== workspaceId || !accountProviders.has(publication.socialAccountId))) {
            partial = true; continue;
          }
          if (detail.publications.some((publication) => publication.status !== "cancelled" && accountProviders.get(publication.socialAccountId) === platform)) matched.push(post);
        }
        if (active) setResult({ source: posts, workspaceId, posts: matched, partial, failed: false });
      } catch (error) {
        if (!active) return;
        if (error instanceof HttpError && error.status === 401) onUnauthorized?.();
        if (active) setResult({ source: posts, workspaceId, posts: [], partial: false, failed: true });
      }
    };
    void identify();
    return () => { active = false; };
  }, [canIdentify, onUnauthorized, platform, posts, repository, socialAccountsRepository, workspaceId]);

  if (!canIdentify) return <p role="status">{unavailable}{posts.length > MAX_IDENTIFICATION_POSTS ? " O limite local de identificação é 50 publicações por seleção." : ""}</p>;
  if (!result || result.source !== posts || result.workspaceId !== workspaceId) return <p role="status">Verificando destinos das publicações...</p>;
  if (result.failed) return <p role="alert">{unavailable}</p>;
  return <>
    {result.partial && <p role="status">Identificação parcial: publicações sem associação verificável (incluindo legados) não foram classificadas. O calendário mostra apenas destinos comprovados; não representa o total da plataforma.</p>}
    <WeekCalendar posts={result.posts} today={today} />
  </>;
}
