import { ChannelBadge } from "../components/ChannelBadge";
import { MetricCard } from "../components/MetricCard";
import { WeekCalendar } from "../components/WeekCalendar";
import { overviewMetrics } from "../data/mockData";
import type { NavKey, Post } from "../types/social";

type OverviewProps = {
  posts: Post[];
  onCompose: () => void;
  goTo: (view: NavKey) => void;
};

export function Overview({ posts, onCompose, goTo }: OverviewProps) {
  return (
    <>
      <section className="hero-grid">
        <article className="hero-card">
          <div className="hero-copy">
            <span className="live-pill"><i /> 4 canais ativos</span>
            <h2>Planeje uma vez.<br />Publique em todo lugar.</h2>
            <p>Centralize suas ideias, mantenha a frequência e ganhe tempo para criar.</p>
            <button className="primary-button light" onClick={onCompose} type="button">
              <span>＋</span> Criar publicação
            </button>
          </div>
          <div className="phone-preview" aria-label="Prévia de publicação no celular">
            <div className="phone-top"><span /><b /><i /></div>
            <div className="post-image">
              <div className="coffee-cup">☕</div>
              <span>feito com<br /><b>propósito.</b></span>
            </div>
            <div className="phone-lines"><i /><i /><i /></div>
          </div>
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
        </article>

        <article className="next-post-card">
          <div className="card-heading">
            <div>
              <span>PRÓXIMA PUBLICAÇÃO</span>
              <h3>Hoje, 14:30</h3>
            </div>
            <div className="channel-stack"><ChannelBadge code="IG" small /><ChannelBadge code="FB" small /></div>
          </div>
          <div className="next-post-preview">
            <div className="preview-art coral-art"><span>☕</span></div>
            <div>
              <strong>{posts[0]?.title}</strong>
              <p>{posts[0]?.caption}</p>
              <button onClick={() => goTo("posts")} type="button">Ver detalhes →</button>
            </div>
          </div>
          <div className="progress-row"><span>Fila de hoje</span><b>2 de 3</b></div>
          <div className="progress-track"><i /></div>
        </article>
      </section>

      <section className="metrics-grid" aria-label="Resumo de desempenho">
        {overviewMetrics.map((metric) => (
          <MetricCard {...metric} key={metric.label} />
        ))}
      </section>

      <section className="content-grid">
        <article className="panel calendar-panel">
          <div className="section-heading">
            <div><span>CONTEÚDO PROGRAMADO</span><h2>Sua semana</h2></div>
            <button className="text-button" onClick={() => goTo("agenda")} type="button">Abrir agenda →</button>
          </div>
          <WeekCalendar compact />
        </article>

        <article className="panel performance-panel">
          <div className="section-heading">
            <div><span>ÚLTIMOS 30 DIAS</span><h2>Desempenho</h2></div>
            <button className="more-button" aria-label="Mais opções" type="button">•••</button>
          </div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>87,4k</strong><span>alcance</span></div></div>
            <ul>
              <li><i className="instagram" /><span>Instagram</span><b>42%</b></li>
              <li><i className="facebook" /><span>Facebook</span><b>27%</b></li>
              <li><i className="tiktok" /><span>TikTok</span><b>19%</b></li>
              <li><i className="linkedin" /><span>LinkedIn</span><b>12%</b></li>
            </ul>
          </div>
          <button className="secondary-button full" onClick={() => goTo("analytics")} type="button">Ver relatório completo</button>
        </article>
      </section>
    </>
  );
}
