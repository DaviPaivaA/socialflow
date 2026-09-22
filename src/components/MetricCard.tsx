import type { Metric } from "../types/social";

export function MetricCard({ label, value, change, icon, tone, showSpark = true }: Metric & { showSpark?: boolean }) {
  return (
    <article className="metric-card">
      <div className={"metric-icon " + tone}>{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{change}</span>
      </div>
      {showSpark && <div className="mini-spark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>}
    </article>
  );
}
