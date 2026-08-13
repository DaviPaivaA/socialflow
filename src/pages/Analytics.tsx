import { MetricCard } from "../components/MetricCard";
import { analyticsBars, analyticsMetrics } from "../data/mockData";

export function Analytics() {
  return (
    <>
      <section className="metrics-grid">
        {analyticsMetrics.map((metric) => (
          <MetricCard {...metric} key={metric.label} />
        ))}
      </section>
      <section className="content-grid analytics-grid">
        <article className="panel chart-panel">
          <div className="section-heading">
            <div><span>EVOLUÇÃO</span><h2>Alcance por semana</h2></div>
            <button className="secondary-button" type="button">Últimos 90 dias⌄</button>
          </div>
          <div className="chart-y"><span>30k</span><span>20k</span><span>10k</span><span>0</span></div>
          <div className="bar-chart">
            {analyticsBars.map((height, index) => (
              <i key={index} style={{ height: height + "px" }} />
            ))}
          </div>
          <div className="chart-x"><span>Mai</span><span>Jun</span><span>Jul</span><span>Ago</span></div>
        </article>
        <article className="panel top-content">
          <div className="section-heading"><div><span>DESTAQUE</span><h2>Melhor conteúdo</h2></div></div>
          <div className="top-art"><span>CAFÉ<br /><b>QUE INSPIRA.</b></span><i>☕</i></div>
          <strong>Conheça a origem do nosso café</strong>
          <div className="top-stats"><span><b>18,9k</b> alcance</span><span><b>1.482</b> interações</span><span><b>7,8%</b> engajamento</span></div>
        </article>
      </section>
    </>
  );
}
