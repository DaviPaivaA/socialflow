import type {
  CalendarDay,
  ChannelCode,
  ChannelDetails,
  ConnectedChannel,
  Metric,
  NavItem,
  NavKey,
  PageTitle,
  Post,
  SettingPreference,
} from "../types/social";

export const navItems: NavItem[] = [
  { key: "overview", label: "Visão geral", icon: "⌂" },
  { key: "agenda", label: "Agenda", icon: "▦" },
  { key: "posts", label: "Publicações", icon: "✦" },
  { key: "analytics", label: "Análises", icon: "⌁" },
  { key: "channels", label: "Canais", icon: "◎" },
  { key: "settings", label: "Configurações", icon: "⚙" },
];

export const initialPosts: Post[] = [
  {
    id: 1,
    title: "Bastidores da torra",
    caption:
      "Cada grão conta uma história. Hoje mostramos um pouco do cuidado por trás do nosso café especial. ☕",
    scheduledAt: "2099-08-12T14:30:00-03:00",
    channels: ["IG", "FB"],
    status: "Agendado",
    color: "coral",
  },
  {
    id: 2,
    title: "Dica da semana",
    caption:
      "Três ajustes simples para deixar o café de casa ainda mais saboroso.",
    scheduledAt: "2099-08-13T09:00:00-03:00",
    channels: ["IG", "TT"],
    status: "Agendado",
    color: "purple",
  },
  {
    id: 3,
    title: "Nossa equipe",
    caption:
      "Gente que acredita em encontros, boas conversas e café de verdade.",
    scheduledAt: "2099-08-14T18:00:00-03:00",
    channels: ["LI", "FB"],
    status: "Rascunho",
    color: "blue",
  },
  {
    id: 4,
    title: "Novo menu de inverno",
    caption:
      "O frio chegou por aqui com novas combinações para aquecer o dia.",
    scheduledAt: "2099-08-10T11:30:00-03:00",
    channels: ["IG", "FB", "TT"],
    status: "Publicado",
    color: "green",
  },
];

export const channelCodes: ChannelCode[] = ["IG", "FB", "TT", "LI"];

export const channelMeta: Record<ChannelCode, ChannelDetails> = {
  IG: { name: "Instagram", color: "#d9468f" },
  FB: { name: "Facebook", color: "#3b82f6" },
  TT: { name: "TikTok", color: "#19182d" },
  LI: { name: "LinkedIn", color: "#0a66c2" },
};

export const titles: Record<NavKey, PageTitle> = {
  overview: {
    eyebrow: "QUARTA-FEIRA, 12 DE AGOSTO",
    title: "Olá, Davi! 👋",
    description:
      "Seu conteúdo está no ritmo certo. Veja o que vem a seguir.",
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

export const calendarDays: CalendarDay[] = [
  {
    day: "SEG",
    date: "10",
    items: [{ name: "Menu", color: "green", time: "11:30" }],
  },
  {
    day: "TER",
    date: "11",
    items: [{ name: "Stories", color: "blue", time: "16:00" }],
  },
  {
    day: "QUA",
    date: "12",
    today: true,
    items: [
      { name: "Bastidores", color: "coral", time: "14:30" },
      { name: "Enquete", color: "purple", time: "19:00" },
    ],
  },
  {
    day: "QUI",
    date: "13",
    items: [{ name: "Dica", color: "purple", time: "09:00" }],
  },
  {
    day: "SEX",
    date: "14",
    items: [{ name: "Equipe", color: "blue", time: "18:00" }],
  },
  {
    day: "SÁB",
    date: "15",
    items: [{ name: "Oferta", color: "coral", time: "10:00" }],
  },
  { day: "DOM", date: "16", items: [] },
];

export const overviewMetrics: Metric[] = [
  {
    label: "Publicações",
    value: "48",
    change: "+12% este mês",
    icon: "✦",
    tone: "purple",
  },
  {
    label: "Alcance total",
    value: "87,4 mil",
    change: "+18,6% este mês",
    icon: "↗",
    tone: "blue",
  },
  {
    label: "Engajamento",
    value: "6,8%",
    change: "+1,2 p.p.",
    icon: "♡",
    tone: "coral",
  },
  {
    label: "Novos seguidores",
    value: "+2.140",
    change: "+9,4% este mês",
    icon: "＋",
    tone: "green",
  },
];

export const analyticsMetrics: Metric[] = [
  {
    label: "Impressões",
    value: "214 mil",
    change: "+21% vs. julho",
    icon: "◉",
    tone: "purple",
  },
  {
    label: "Alcance",
    value: "87,4 mil",
    change: "+18,6% vs. julho",
    icon: "↗",
    tone: "blue",
  },
  {
    label: "Interações",
    value: "14.280",
    change: "+8,3% vs. julho",
    icon: "♡",
    tone: "coral",
  },
  {
    label: "Cliques",
    value: "3.842",
    change: "+14,1% vs. julho",
    icon: "↗",
    tone: "green",
  },
];

export const analyticsBars = [
  38, 52, 46, 72, 64, 88, 76, 96, 81, 100, 92, 118,
];

export const connectedChannels: ConnectedChannel[] = [
  {
    code: "IG",
    user: "@cafeaurora",
    followers: "18,4 mil",
    status: "Conectado",
  },
  {
    code: "FB",
    user: "Café Aurora",
    followers: "8,7 mil",
    status: "Conectado",
  },
  {
    code: "TT",
    user: "@cafeaurora",
    followers: "12,1 mil",
    status: "Conectado",
  },
  {
    code: "LI",
    user: "Café Aurora",
    followers: "3,2 mil",
    status: "Conectado",
  },
];

export const settingPreferences: SettingPreference[] = [
  {
    title: "Melhor horário automático",
    description: "Sugere horários com base no desempenho anterior.",
  },
  {
    title: "Avisos antes de publicar",
    description: "Notifica você 15 minutos antes de cada post.",
  },
  {
    title: "Relatório semanal",
    description: "Envia um resumo de desempenho toda segunda-feira.",
  },
];
