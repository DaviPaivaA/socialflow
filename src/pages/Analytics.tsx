import { MetricCard } from "../components/MetricCard";

export function Analytics() {
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="Impressões" value="—" change="Ainda indisponível" icon="◉" tone="purple" showSpark={false} />
        <MetricCard label="Alcance" value="—" change="Ainda indisponível" icon="↗" tone="blue" showSpark={false} />
        <MetricCard label="Interações" value="—" change="Ainda indisponível" icon="♡" tone="coral" showSpark={false} />
        <MetricCard label="Cliques" value="—" change="Ainda indisponível" icon="↗" tone="green" showSpark={false} />
      </section>
      <section className="content-grid analytics-grid">
        <article className="panel chart-panel">
          <div className="section-heading">
            <div><span>EVOLUÇÃO</span><h2>Alcance por semana</h2></div>
          </div>
          <p>Dados de análise ainda não disponíveis. Conecte seus canais e aguarde a sincronização das métricas.</p>
        </article>
        <article className="panel top-content">
          <div className="section-heading"><div><span>DESTAQUE</span><h2>Melhor conteúdo</h2></div></div>
          <p>Dados de análise ainda não disponíveis. O conteúdo de destaque aparecerá após a sincronização das métricas.</p>
        </article>
      </section>
    </>
  );
}
