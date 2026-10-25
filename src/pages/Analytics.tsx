import { MetricCard } from "../components/MetricCard";
import { useState } from "react";
import { ChannelBadge } from "../components/ChannelBadge";
import "../features/tiktok/tiktok.css";

export function Analytics() {
  const [platform, setPlatform] = useState("facebook");
  const [period, setPeriod] = useState("30");
  return (
    <>
      <section className="panel page-panel analytics-filters-panel">
        <div className="platform-controls">
          <label>Plataforma de análise<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select></label>
          <label>Período de análise<select value={period} onChange={(event) => setPeriod(event.target.value)}><option value="7">7 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></select></label>
        </div>
        <div className="section-heading"><ChannelBadge code={platform === "tiktok" ? "TT" : platform === "instagram" ? "IG" : "FB"} /><h2>{platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : "Facebook"}</h2></div>
        <p>{platform === "tiktok" ? "Não conectado" : "Métricas indisponíveis."}</p>
        <small>Últimos {period} dias · Nenhuma consulta de métricas é realizada.</small>
      </section>
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
          <p>Sem dados de alcance neste período.</p>
          <div className="empty-analytics-chart" aria-label="Gráfico sem dados"><span>Sem dados</span><small>Tempo · últimos {period} dias</small></div>
        </article>
        <article className="panel top-content">
          <div className="section-heading"><div><span>DESTAQUE</span><h2>Melhor conteúdo</h2></div></div>
          <p>Sem dados para destacar conteúdo.</p>
        </article>
      </section>
    </>
  );
}
