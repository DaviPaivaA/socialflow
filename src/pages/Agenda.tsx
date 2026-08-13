import { WeekCalendar } from "../components/WeekCalendar";

type AgendaProps = {
  onCompose: () => void;
};

export function Agenda({ onCompose }: AgendaProps) {
  return (
    <section className="panel page-panel">
      <div className="section-heading large">
        <div><span>10 — 16 DE AGOSTO</span><h2>Calendário editorial</h2></div>
        <div className="heading-actions">
          <button className="secondary-button" type="button">‹ Semana ›</button>
          <button className="primary-button" onClick={onCompose} type="button">＋ Novo conteúdo</button>
        </div>
      </div>
      <WeekCalendar />
      <div className="calendar-legend">
        <span><i className="dot purple" /> Educativo</span>
        <span><i className="dot coral" /> Promocional</span>
        <span><i className="dot blue" /> Institucional</span>
        <span><i className="dot green" /> Produto</span>
      </div>
    </section>
  );
}
