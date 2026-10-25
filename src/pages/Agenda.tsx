import { WeekCalendar } from "../components/WeekCalendar";
import { getCurrentWeekLabel } from "../domain/calendarWeek";
import type { PostsLoadState } from "./Posts";
import type { Post } from "../types/social";
import { useState } from "react";
import { ChannelBadge } from "../components/ChannelBadge";
import "../features/tiktok/tiktok.css";
import { MetaAgendaFilter, type AgendaAssociations } from "../features/tiktok/MetaAgendaFilter";

type AgendaProps = AgendaAssociations & {
  loadState: PostsLoadState;
  onCompose: () => void;
  posts: Post[];
};

export function Agenda(props: AgendaProps) {
  return <AgendaContent key={props.workspaceId ?? "local"} {...props} />;
}

function AgendaContent({ loadState, onCompose, posts, ...associations }: AgendaProps) {
  const [platform, setPlatform] = useState("all");
  const today = new Date();
  return (
    <section className="panel page-panel">
      <div className="section-heading large">
        <div><span>{getCurrentWeekLabel(today)}</span><h2>Calendário editorial</h2></div>
        <div className="heading-actions">
          <button className="primary-button" onClick={onCompose} type="button">＋ Novo conteúdo</button>
        </div>
      </div>
      <div className="platform-controls"><label>Plataforma da agenda<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="all">Todos</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="tiktok">TikTok</option></select></label>{platform !== "all" && <ChannelBadge code={platform === "facebook" ? "FB" : platform === "instagram" ? "IG" : "TT"} />}</div>
      {platform === "tiktok" ? <><p>Nenhuma publicação agendada.</p><WeekCalendar posts={[]} today={today} /></> : loadState === "loading" ? (
        <p role="status">Carregando publicações</p>
      ) : loadState === "error" ? (
        <p role="alert">Não foi possível carregar a agenda deste Workspace.</p>
      ) : platform === "facebook" || platform === "instagram" ? <MetaAgendaFilter key={platform} {...associations} posts={posts} platform={platform} today={today} /> : (
        <WeekCalendar posts={posts} today={today} />
      )}
    </section>
  );
}
