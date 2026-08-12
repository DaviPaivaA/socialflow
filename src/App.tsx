import { useMemo, useState } from "react";
import type { FormEvent } from "react";

type NavKey = "overview" | "agenda" | "posts" | "analytics" | "channels" | "settings";
type PostStatus = "Agendado" | "Rascunho" | "Publicado";

type Post = {
  id: number;
  title: string;
  caption: string;
  date: string;
  time: string;
  channels: string[];
  status: PostStatus;
  color: string;
};

const navItems: { key: NavKey; label: string; icon: string }[] = [
  { key: "overview", label: "Visão geral", icon: "⌂" },
  { key: "agenda", label: "Agenda", icon: "▦" },
  { key: "posts", label: "Publicações", icon: "✦" },
  { key: "analytics", label: "Análises", icon: "⌁" },
  { key: "channels", label: "Canais", icon: "◎" },
  { key: "settings", label: "Configurações", icon: "⚙" },
];

const initialPosts: Post[] = [
  {
    id: 1,
    title: "Bastidores da torra",
    caption: "Cada grão conta uma história. Hoje mostramos um pouco do cuidado por trás do nosso café especial. ☕",
    date: "Hoje",
    time: "14:30",
    channels: ["IG", "FB"],
    status: "Agendado",
    color: "coral",
  },
  {
    id: 2,
    title: "Dica da semana",
    caption: "Três ajustes simples para deixar o café de casa ainda mais saboroso.",
    date: "Amanhã",
    time: "09:00",
    channels: ["IG", "TT"],
    status: "Agendado",
    color: "purple",
  },
  {
    id: 3,
    title: "Nossa equipe",
    caption: "Gente que acredita em encontros, boas conversas e café de verdade.",
    date: "14 ago",
    time: "18:00",
    channels: ["LI", "FB"],
    status: "Rascunho",
    color: "blue",
  },
  {
    id: 4,
    title: "Novo menu de inverno",
    caption: "O frio chegou por aqui com novas combinações para aquecer o dia.",
    date: "10 ago",
    time: "11:30",
    channels: ["IG", "FB", "TT"],
    status: "Publicado",
    color: "green",
  },
];

const channelMeta: Record<string, { name: string; color: string }> = {
  IG: { name: "Instagram", color: "#d9468f" },
  FB: { name: "Facebook", color: "#3b82f6" },
  TT: { name: "TikTok", color: "#19182d" },
  LI: { name: "LinkedIn", color: "#0a66c2" },
};

const titles: Record<NavKey, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: "QUARTA-FEIRA, 12 DE AGOSTO",
    title: "Olá, Davi! 👋",
    description: "Seu conteúdo está no ritmo certo. Veja o que vem a seguir.",
  },
  agenda: {
    eyebrow: "PLANEJAMENTO",
    title: "Agenda de conteúdo",
    description: "Visualize e organize toda a semana em um só lugar.",
  },
  posts: {
    eyebrow: "CONTEÚDO",
    title: "Publicações",
    description: "Acompanhe posts agendados, rascunhos e resultados.",
  },
  analytics: {
    eyebrow: "DESEMPENHO",
    title: "Análises",
    description: "Transforme métricas em decisões mais inteligentes.",
  },
  channels: {
    eyebrow: "INTEGRAÇÕES",
    title: "Canais conectados",
    description: "Gerencie os perfis que recebem suas publicações.",
  },
  settings: {
    eyebrow: "PREFERÊNCIAS",
    title: "Configurações",
    description: "Personalize o funcionamento da sua área de trabalho.",
  },
};

function ChannelBadge({ code, small = false }: { code: string; small?: boolean }) {
  const channel = channelMeta[code];
  return (
    <span
      className={`channel-badge ${small ? "small" : ""}`}
      style={{ backgroundColor: channel?.color ?? "#6c5ce7" }}
      title={channel?.name ?? code}
      aria-label={channel?.name ?? code}
    >
      {code}
    </span>
  );
}

function StatusPill({ status }: { status: PostStatus }) {
  return <span className={`status-pill ${status.toLowerCase()}`}>{status}</span>;
}

function MetricCard({
  label,
  value,
  change,
  icon,
  tone,
}: {
  label: string;
  value: string;
  change: string;
  icon: string;
  tone: string;
}) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{change}</span>
      </div>
      <div className="mini-spark" aria-hidden="true">
        <i /><i /><i /><i /><i />
      </div>
    </article>
  );
}

function WeekCalendar({ compact = false }: { compact?: boolean }) {
  const days = [
    { day: "SEG", date: "10", items: [{ name: "Menu", color: "green", time: "11:30" }] },
    { day: "TER", date: "11", items: [{ name: "Stories", color: "blue", time: "16:00" }] },
    {
      day: "QUA",
      date: "12",
      today: true,
      items: [
        { name: "Bastidores", color: "coral", time: "14:30" },
        { name: "Enquete", color: "purple", time: "19:00" },
      ],
    },
    { day: "QUI", date: "13", items: [{ name: "Dica", color: "purple", time: "09:00" }] },
    { day: "SEX", date: "14", items: [{ name: "Equipe", color: "blue", time: "18:00" }] },
    { day: "SÁB", date: "15", items: [{ name: "Oferta", color: "coral", time: "10:00" }] },
    { day: "DOM", date: "16", items: [] },
  ];
  return (
    <div className={`week-calendar ${compact ? "compact" : ""}`}>
      {days.map((day) => (
        <div className={`calendar-day ${day.today ? "today" : ""}`} key={day.day}>
          <div className="day-head">
            <span>{day.day}</span>
            <strong>{day.date}</strong>
          </div>
          <div className="day-content">
            {day.items.map((item) => (
              <button className={`calendar-item ${item.color}`} key={item.name} type="button">
                <span>{item.time}</span>
                <strong>{item.name}</strong>
              </button>
            ))}
            {!day.items.length && <span className="empty-day">Livre</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Overview({
  posts,
  onCompose,
  goTo,
}: {
  posts: Post[];
  onCompose: () => void;
  goTo: (view: NavKey) => void;
}) {
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
        <MetricCard label="Publicações" value="48" change="+12% este mês" icon="✦" tone="purple" />
        <MetricCard label="Alcance total" value="87,4 mil" change="+18,6% este mês" icon="↗" tone="blue" />
        <MetricCard label="Engajamento" value="6,8%" change="+1,2 p.p." icon="♡" tone="coral" />
        <MetricCard label="Novos seguidores" value="+2.140" change="+9,4% este mês" icon="＋" tone="green" />
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

function AgendaView({ onCompose }: { onCompose: () => void }) {
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

function PostsView({ posts, onCompose }: { posts: Post[]; onCompose: () => void }) {
  const [filter, setFilter] = useState("Todos");
  const visible = filter === "Todos" ? posts : posts.filter((post) => post.status === filter);
  return (
    <section className="panel page-panel">
      <div className="section-heading large">
        <div className="filter-tabs">
          {["Todos", "Agendado", "Rascunho", "Publicado"].map((item) => (
            <button className={filter === item ? "active" : ""} onClick={() => setFilter(item)} key={item} type="button">
              {item}
              <span>{item === "Todos" ? posts.length : posts.filter((post) => post.status === item).length}</span>
            </button>
          ))}
        </div>
        <button className="primary-button" onClick={onCompose} type="button">＋ Criar publicação</button>
      </div>
      <div className="post-list">
        {visible.map((post) => (
          <article className="post-row" key={post.id}>
            <div className={`post-thumbnail ${post.color}`}><span>{post.color === "coral" ? "☕" : post.color === "purple" ? "✦" : "●"}</span></div>
            <div className="post-main">
              <div><strong>{post.title}</strong><StatusPill status={post.status} /></div>
              <p>{post.caption}</p>
              <div className="post-meta">
                <span>▦ {post.date}, {post.time}</span>
                <div>{post.channels.map((code) => <ChannelBadge code={code} small key={code} />)}</div>
              </div>
            </div>
            <button className="more-button" aria-label={`Opções de ${post.title}`} type="button">•••</button>
          </article>
        ))}
      </div>
    </section>
  );
}

function AnalyticsView() {
  const bars = [38, 52, 46, 72, 64, 88, 76, 96, 81, 100, 92, 118];
  return (
    <>
      <section className="metrics-grid">
        <MetricCard label="Impressões" value="214 mil" change="+21% vs. julho" icon="◉" tone="purple" />
        <MetricCard label="Alcance" value="87,4 mil" change="+18,6% vs. julho" icon="↗" tone="blue" />
        <MetricCard label="Interações" value="14.280" change="+8,3% vs. julho" icon="♡" tone="coral" />
        <MetricCard label="Cliques" value="3.842" change="+14,1% vs. julho" icon="↗" tone="green" />
      </section>
      <section className="content-grid analytics-grid">
        <article className="panel chart-panel">
          <div className="section-heading">
            <div><span>EVOLUÇÃO</span><h2>Alcance por semana</h2></div>
            <button className="secondary-button" type="button">Últimos 90 dias⌄</button>
          </div>
          <div className="chart-y"><span>30k</span><span>20k</span><span>10k</span><span>0</span></div>
          <div className="bar-chart">
            {bars.map((height, index) => <i key={index} style={{ height: `${height}px` }} />)}
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

function ChannelsView() {
  const channels = [
    { code: "IG", user: "@cafeaurora", followers: "18,4 mil", status: "Conectado" },
    { code: "FB", user: "Café Aurora", followers: "8,7 mil", status: "Conectado" },
    { code: "TT", user: "@cafeaurora", followers: "12,1 mil", status: "Conectado" },
    { code: "LI", user: "Café Aurora", followers: "3,2 mil", status: "Conectado" },
  ];
  return (
    <section className="channels-grid">
      {channels.map((channel) => (
        <article className="panel channel-card" key={channel.code}>
          <div className="channel-card-top">
            <ChannelBadge code={channel.code} />
            <span className="connected-dot"><i /> {channel.status}</span>
          </div>
          <h2>{channelMeta[channel.code].name}</h2>
          <p>{channel.user}</p>
          <div className="channel-numbers"><strong>{channel.followers}</strong><span>seguidores</span></div>
          <div className="channel-health"><span>Saúde do canal</span><b>Excelente</b></div>
          <div className="health-track"><i /></div>
          <button className="secondary-button full" type="button">Gerenciar canal</button>
        </article>
      ))}
      <button className="add-channel-card" type="button"><span>＋</span><strong>Conectar novo canal</strong><small>Adicione outro perfil social</small></button>
    </section>
  );
}

function SettingsView() {
  return (
    <section className="settings-layout">
      <article className="panel settings-card">
        <div className="section-heading"><div><span>PERFIL</span><h2>Área de trabalho</h2></div></div>
        <label className="field-label">Nome da marca<input defaultValue="Café Aurora" /></label>
        <label className="field-label">Fuso horário<select defaultValue="America/Sao_Paulo"><option value="America/Sao_Paulo">Brasília (GMT−3)</option></select></label>
        <button className="primary-button" type="button">Salvar alterações</button>
      </article>
      <article className="panel settings-card">
        <div className="section-heading"><div><span>AUTOMAÇÕES</span><h2>Preferências de publicação</h2></div></div>
        {[
          ["Melhor horário automático", "Sugere horários com base no desempenho anterior."],
          ["Avisos antes de publicar", "Notifica você 15 minutos antes de cada post."],
          ["Relatório semanal", "Envia um resumo de desempenho toda segunda-feira."],
        ].map(([title, description], index) => (
          <label className="switch-row" key={title}>
            <span><strong>{title}</strong><small>{description}</small></span>
            <input type="checkbox" defaultChecked={index !== 1} /><i />
          </label>
        ))}
      </article>
    </section>
  );
}

function Composer({
  onClose,
  onSchedule,
}: {
  onClose: () => void;
  onSchedule: (post: Post) => void;
}) {
  const [caption, setCaption] = useState("");
  const [date, setDate] = useState("2026-08-13");
  const [time, setTime] = useState("10:00");
  const [selected, setSelected] = useState<string[]>(["IG", "FB"]);

  const toggleChannel = (code: string) => {
    setSelected((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!caption.trim() || selected.length === 0) return;
    onSchedule({
      id: Date.now(),
      title: caption.trim().split(/[.!?]/)[0].slice(0, 38) || "Nova publicação",
      caption: caption.trim(),
      date: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)).replace(".", ""),
      time,
      channels: selected,
      status: "Agendado",
      color: "purple",
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="composer-modal" onSubmit={submit}>
        <div className="modal-header">
          <div><span>NOVO CONTEÚDO</span><h2>Criar publicação</h2></div>
          <button aria-label="Fechar" onClick={onClose} type="button">×</button>
        </div>
        <div className="composer-body">
          <div className="composer-fields">
            <div className="field-label">
              <span>Publicar em</span>
              <div className="channel-selector">
                {Object.keys(channelMeta).map((code) => (
                  <button className={selected.includes(code) ? "selected" : ""} onClick={() => toggleChannel(code)} type="button" key={code}>
                    <ChannelBadge code={code} small /> {channelMeta[code].name}
                  </button>
                ))}
              </div>
            </div>
            <label className="field-label">Legenda<textarea value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Conte a história por trás desta publicação..." maxLength={500} required /><small>{caption.length}/500</small></label>
            <div className="date-fields">
              <label className="field-label">Data<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label className="field-label">Horário<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label>
            </div>
            <div className="best-time"><span>✦</span><div><strong>Sugestão inteligente</strong><p>10:00 tem 18% mais engajamento às quintas-feiras.</p></div></div>
          </div>
          <div className="composer-preview">
            <span>PRÉ-VISUALIZAÇÃO</span>
            <div className="social-preview">
              <div className="social-user"><div className="avatar tiny">CA</div><div><strong>cafeaurora</strong><span>Patrocinado</span></div><b>•••</b></div>
              <div className="preview-canvas"><span>☕</span><p>PAUSAS QUE<br /><b>RENOVAM.</b></p></div>
              <div className="social-actions">♡　⌁　➤ <span>▣</span></div>
              <p><strong>cafeaurora</strong> {caption || "Sua legenda aparecerá aqui..."}</p>
            </div>
          </div>
        </div>
        <div className="modal-footer"><button className="secondary-button" onClick={onClose} type="button">Salvar rascunho</button><button className="primary-button" type="submit">▦ Agendar publicação</button></div>
      </form>
    </div>
  );
}

export default function Home() {
  const [active, setActive] = useState<NavKey>("overview");
  const [posts, setPosts] = useState(initialPosts);
  const [composerOpen, setComposerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [mobileNav, setMobileNav] = useState(false);

  const current = useMemo(() => titles[active], [active]);

  const navigate = (view: NavKey) => {
    setActive(view);
    setMobileNav(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const schedulePost = (post: Post) => {
    setPosts((currentPosts) => [post, ...currentPosts]);
    setComposerOpen(false);
    setToast("Publicação agendada com sucesso!");
    setTimeout(() => setToast(""), 3500);
  };

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><i /><i /><i /></div>
          <strong>Social<span>Flow</span></strong>
        </div>
        <div className="workspace-switch">
          <div className="avatar">CA</div>
          <div><span>ESPAÇO DE TRABALHO</span><strong>Café Aurora</strong></div>
          <button aria-label="Trocar área de trabalho" type="button">⌄</button>
        </div>
        <nav aria-label="Navegação principal">
          <span className="nav-label">MENU</span>
          {navItems.map((item) => (
            <button className={active === item.key ? "active" : ""} key={item.key} onClick={() => navigate(item.key)} type="button">
              <i>{item.icon}</i><span>{item.label}</span>
              {item.key === "posts" && <b>3</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-tip">
          <span>✦</span>
          <strong>Horário inteligente</strong>
          <p>Seu público está mais ativo hoje às 19h.</p>
          <button onClick={() => setComposerOpen(true)} type="button">Criar post</button>
        </div>
        <div className="sidebar-user">
          <div className="avatar user">DA</div>
          <div><strong>Davi Alvares</strong><span>Plano acadêmico</span></div>
          <button aria-label="Opções do perfil" type="button">•••</button>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <button className="menu-toggle" onClick={() => setMobileNav((open) => !open)} aria-label="Abrir menu" type="button">☰</button>
          <div className="search-box"><span>⌕</span><input aria-label="Pesquisar" placeholder="Pesquisar conteúdo..." /><kbd>⌘ K</kbd></div>
          <div className="topbar-actions">
            <button aria-label="Ajuda" type="button">?</button>
            <button aria-label="Notificações" className="notification" type="button">♢<i /></button>
            <div className="avatar user">DA</div>
          </div>
        </header>

        <div className="page-content">
          <header className="page-header">
            <div><span>{current.eyebrow}</span><h1>{current.title}</h1><p>{current.description}</p></div>
            {active !== "overview" && active !== "settings" && (
              <button className="primary-button desktop-action" onClick={() => setComposerOpen(true)} type="button">＋ Criar publicação</button>
            )}
          </header>

          {active === "overview" && <Overview posts={posts} onCompose={() => setComposerOpen(true)} goTo={navigate} />}
          {active === "agenda" && <AgendaView onCompose={() => setComposerOpen(true)} />}
          {active === "posts" && <PostsView posts={posts} onCompose={() => setComposerOpen(true)} />}
          {active === "analytics" && <AnalyticsView />}
          {active === "channels" && <ChannelsView />}
          {active === "settings" && <SettingsView />}
        </div>
      </section>

      {composerOpen && <Composer onClose={() => setComposerOpen(false)} onSchedule={schedulePost} />}
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
