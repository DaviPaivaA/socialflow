import { useState } from "react";
import { StatusPill } from "../components/StatusPill";
import {
  getPostPresentationColor,
  getPostTitle,
} from "../domain/postPresentation";
import {
  formatScheduledDate,
  formatScheduledTime,
} from "../domain/scheduling";
import type { Post, PostStatus } from "../types/social";

type PostFilter = "all" | "scheduled" | "draft" | "published";
type PostFilter = "Todos" | PostStatus;
export type PostsLoadState = "loading" | "success" | "error";

const filters: Array<{ label: string; value: PostFilter }> = [
  { label: "Todos", value: "all" },
  { label: "Agendado", value: "scheduled" },
  { label: "Rascunho", value: "draft" },
  { label: "Publicado", value: "published" },
];

type PostsProps = {
  loadState: PostsLoadState;
  posts: Post[];
  onCompose: () => void;
};

function postMatchesFilter(post: Post, filter: PostFilter) {
  return filter === "all" || post.status === filter;
}

function postThumbnailSymbol(status: PostStatus) {
  if (status === "published") return "●";
  if (status === "scheduled" || status === "publishing") return "✦";
  return "☕";
}

export function Posts({ loadState, posts, onCompose }: PostsProps) {
  const [filter, setFilter] = useState<PostFilter>("all");
  const visible =
    loadState !== "success" || filter === "all"
export function Posts({ loadState, posts, onCompose }: PostsProps) {
  const [filter, setFilter] = useState<PostFilter>("Todos");
  const visible =
    loadState !== "success" || filter === "Todos"
      ? posts
      : posts.filter((post) => postMatchesFilter(post, filter));

  return (
    <section className="panel page-panel">
      <div className="section-heading large">
        <div className="filter-tabs">
          {loadState === "loading" ? (
            <p role="status">Carregando publicações</p>
          ) : loadState === "error" ? (
            <p role="alert">
              Não foi possível carregar as publicações. Os dados exibidos podem
              estar incompletos.
            </p>
          ) : (
            filters.map((item) => (
              <button
                className={filter === item.value ? "active" : ""}
                onClick={() => setFilter(item.value)}
                key={item.value}
                type="button"
              >
                {item.label}
                <span>
                  {item.value === "all"
                    ? posts.length
                    : posts.filter((post) => postMatchesFilter(post, item.value))
                        .length}
                className={filter === item ? "active" : ""}
                onClick={() => setFilter(item)}
                key={item}
                type="button"
              >
                {item}
                <span>
                  {item === "Todos"
                    ? posts.length
                    : posts.filter((post) => post.status === item).length}
                </span>
              </button>
            ))
          )}
        </div>
        <button className="primary-button" onClick={onCompose} type="button">
          ＋ Criar publicação
        </button>
      </div>
      <div className="post-list">
        {loadState !== "loading" &&
          visible.map((post) => {
            const color = getPostPresentationColor(post);
            const title = getPostTitle(post);
            const schedule = post.scheduledFor
              ? `${formatScheduledDate(post.scheduledFor)}, ${formatScheduledTime(post.scheduledFor)}`
              : "Sem agendamento";

            return (
              <article className="post-row" key={post.id}>
                <div className={"post-thumbnail " + color}>
                  <span>{postThumbnailSymbol(post.status)}</span>
                </div>
                <div className="post-main">
                  <div>
                    <strong>{title}</strong>
                    <StatusPill status={post.status} />
                  </div>
                  <p>{post.caption}</p>
                  <div className="post-meta">
                    <span>▦ {schedule}</span>
                  </div>
                </div>
                <button
                  className="more-button"
                  aria-label={"Opções de " + title}
                  type="button"
                >
                  •••
                </button>
              </article>
            );
          })}
          visible.map((post) => (
            <article className="post-row" key={post.id}>
              <div className={"post-thumbnail " + post.color}>
                <span>
                  {post.color === "coral"
                    ? "☕"
                    : post.color === "purple"
                      ? "✦"
                      : "●"}
                </span>
              </div>
              <div className="post-main">
                <div>
                  <strong>{post.title}</strong>
                  <StatusPill status={post.status} />
                </div>
                <p>{post.caption}</p>
                <div className="post-meta">
                  <span>
                    ▦ {formatScheduledDate(post.scheduledAt)}, {" "}
                    {formatScheduledTime(post.scheduledAt)}
                  </span>
                  <div>
                    {post.channels.map((code) => (
                      <ChannelBadge code={code} small key={code} />
                    ))}
                  </div>
                </div>
              </div>
              <button
                className="more-button"
                aria-label={"Opções de " + post.title}
                type="button"
              >
                •••
              </button>
            </article>
          ))}
      </div>
    </section>
  );
}
