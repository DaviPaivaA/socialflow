import { WeekCalendar } from "../components/WeekCalendar";
import { getCurrentWeekLabel } from "../domain/calendarWeek";
import type { PostsLoadState } from "./Posts";
import type { Post } from "../types/social";

type AgendaProps = {
  loadState: PostsLoadState;
  onCompose: () => void;
  posts: Post[];
};

export function Agenda({ loadState, onCompose, posts }: AgendaProps) {
  const today = new Date();
  return (
    <section className="panel page-panel">
      <div className="section-heading large">
        <div><span>{getCurrentWeekLabel(today)}</span><h2>Calendário editorial</h2></div>
        <div className="heading-actions">
          <button className="primary-button" onClick={onCompose} type="button">＋ Novo conteúdo</button>
        </div>
      </div>
      {loadState === "loading" ? (
        <p role="status">Carregando publicações</p>
      ) : loadState === "error" ? (
        <p role="alert">Não foi possível carregar a agenda deste Workspace.</p>
      ) : (
        <WeekCalendar posts={posts} today={today} />
      )}
    </section>
  );
}
