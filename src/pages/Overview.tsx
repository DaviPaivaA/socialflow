import { MetricCard } from "../components/MetricCard";
import { WeekCalendar } from "../components/WeekCalendar";
import { getPostTitle } from "../domain/postPresentation";
import {
  formatScheduledDate,
  formatScheduledTime,
  isScheduledToday,
} from "../domain/scheduling";
import type { PostsLoadState } from "./Posts";
import type { NavKey, Post } from "../types/social";

type OverviewProps = {
  goTo: (view: NavKey) => void;
  loadState: PostsLoadState;
  nextPost?: Post;
  onCompose: () => void;
  posts: Post[];
};

export function Overview({
  goTo,
  loadState,
  nextPost,
  onCompose,
  posts,
}: OverviewProps) {
  return (
    <>
      <section className="hero-grid">
        <article className="hero-card">
          <div className="hero-copy">
            <span className="live-pill"><i /> Gerencie seus canais conectados</span>
            <h2>Planeje uma vez.<br />Publique em todo lugar.</h2>
            <p>Centralize suas ideias, mantenha a frequência e ganhe tempo para criar.</p>
            <button className="primary-button light" onClick={onCompose} type="button">
              <span>＋</span> Criar publicação
            </button>
          </div>
          <div className="phone-preview" aria-label="Prévia de publicação no celular">
            <div className="phone-top"><span /><b /><i /></div>
            <div className="post-image">
              <div className="coffee-cup">✦</div>
              <span>seu conteúdo<br /><b>em um só lugar.</b></span>
            </div>
            <div className="phone-lines"><i /><i /><i /></div>
          </div>
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
        </article>

        {loadState === "success" && nextPost ? (
          <article className="next-post-card">
            <div className="card-heading">
              <div>
                <span>PRÓXIMA PUBLICAÇÃO</span>
                <h3>
                  {isScheduledToday(nextPost.scheduledFor)
                    ? "Hoje"
                    : formatScheduledDate(nextPost.scheduledFor)}
                  , {formatScheduledTime(nextPost.scheduledFor)}
                </h3>
              </div>
            </div>
            <div className="next-post-preview">
              <div className="preview-art coral-art"><span>✦</span></div>
              <div>
                <strong>{getPostTitle(nextPost)}</strong>
                <p>{nextPost.caption}</p>
                <button onClick={() => goTo("posts")} type="button">Ver detalhes →</button>
              </div>
            </div>
          </article>
        ) : (
          <article aria-live="polite" className="next-post-card">
            <div className="card-heading">
              <div>
                <span>PUBLICAÇÕES</span>
                <h3>
                  {loadState === "loading"
                    ? "Carregando publicações"
                    : loadState === "error"
                      ? "Não foi possível carregar as publicações"
                      : "Nenhuma publicação agendada"}
                </h3>
              </div>
            </div>
          </article>
        )}
      </section>

      <section className="metrics-grid" aria-label="Resumo de desempenho">
        <MetricCard label="Publicações" value={loadState === "success" ? String(posts.length) : "—"} change={loadState === "success" ? "Neste Workspace" : "Aguardando publicações"} icon="✦" tone="purple" showSpark={false} />
        <MetricCard label="Alcance total" value="—" change="Disponível após Analytics" icon="↗" tone="blue" showSpark={false} />
        <MetricCard label="Engajamento" value="—" change="Disponível após Analytics" icon="♡" tone="coral" showSpark={false} />
        <MetricCard label="Novos seguidores" value="—" change="Disponível após Analytics" icon="＋" tone="green" showSpark={false} />
      </section>

      <section className="content-grid">
        <article className="panel calendar-panel">
          <div className="section-heading">
            <div><span>CONTEÚDO PROGRAMADO</span><h2>Sua semana</h2></div>
            <button className="text-button" onClick={() => goTo("agenda")} type="button">Abrir agenda →</button>
          </div>
          {loadState === "loading" ? (
            <p role="status">Carregando agenda</p>
          ) : loadState === "error" ? (
            <p role="alert">Não foi possível carregar a agenda.</p>
          ) : (
            <WeekCalendar compact posts={posts} />
          )}
        </article>

        <article className="panel performance-panel">
          <div className="section-heading">
            <div><span>MÉTRICAS</span><h2>Desempenho</h2></div>
          </div>
          <div className="donut-wrap">
            <p style={{ gridColumn: "1 / -1" }}>Ainda não há dados de desempenho. As métricas aparecerão após conectar e sincronizar seus canais.</p>
          </div>
          <button className="secondary-button full" onClick={() => goTo("analytics")} type="button">Ver relatório completo</button>
        </article>
      </section>
    </>
  );
}
