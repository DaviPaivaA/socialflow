import { useState } from "react";
import { ChannelBadge } from "../components/ChannelBadge";
import { StatusPill } from "../components/StatusPill";
import type { Post, PostStatus } from "../types/social";

type PostFilter = "Todos" | PostStatus;

const filters: PostFilter[] = [
  "Todos",
  "Agendado",
  "Rascunho",
  "Publicado",
];

type PostsProps = {
  posts: Post[];
  onCompose: () => void;
};

export function Posts({ posts, onCompose }: PostsProps) {
  const [filter, setFilter] = useState<PostFilter>("Todos");
  const visible =
    filter === "Todos"
      ? posts
      : posts.filter((post) => post.status === filter);

  return (
    <section className="panel page-panel">
      <div className="section-heading large">
        <div className="filter-tabs">
          {filters.map((item) => (
            <button
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
          ))}
        </div>
        <button className="primary-button" onClick={onCompose} type="button">
          ＋ Criar publicação
        </button>
      </div>
      <div className="post-list">
        {visible.map((post) => (
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
                <span>▦ {post.date}, {post.time}</span>
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
