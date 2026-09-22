import type {
  ChannelCode,
  ChannelDetails,
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

export const initialPosts = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    tenantId: "11111111-1111-4111-8111-111111111111",
    authorUserId: "22222222-2222-4222-8222-222222222222",
    ragRunId: null,
    title: "Bastidores da torra",
    caption:
      "Cada grão conta uma história. Hoje mostramos um pouco do cuidado por trás do nosso café especial. ☕",
    status: "scheduled",
    scheduledFor: "2099-08-12T14:30:00-03:00",
    publishedAt: null,
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    tenantId: "11111111-1111-4111-8111-111111111111",
    authorUserId: "22222222-2222-4222-8222-222222222222",
    ragRunId: null,
    title: "Dica da semana",
    caption:
      "Três ajustes simples para deixar o café de casa ainda mais saboroso.",
    status: "scheduled",
    scheduledFor: "2099-08-13T09:00:00-03:00",
    publishedAt: null,
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    tenantId: "11111111-1111-4111-8111-111111111111",
    authorUserId: "22222222-2222-4222-8222-222222222222",
    ragRunId: null,
    title: "Nossa equipe",
    caption:
      "Gente que acredita em encontros, boas conversas e café de verdade.",
    status: "draft",
    scheduledFor: "2099-08-14T18:00:00-03:00",
    publishedAt: null,
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-01-01T00:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    tenantId: "11111111-1111-4111-8111-111111111111",
    authorUserId: "22222222-2222-4222-8222-222222222222",
    ragRunId: null,
    title: "Novo menu de inverno",
    caption:
      "O frio chegou por aqui com novas combinações para aquecer o dia.",
    status: "published",
    scheduledFor: "2099-08-10T11:30:00-03:00",
    publishedAt: "2099-08-10T14:30:00.000Z",
    createdAt: "2099-01-01T00:00:00.000Z",
    updatedAt: "2099-08-10T14:30:00.000Z",
  },
] satisfies Post[];

export const channelCodes: ChannelCode[] = ["IG", "FB", "TT", "LI"];

export const channelMeta: Record<ChannelCode, ChannelDetails> = {
  IG: { name: "Instagram", color: "#d9468f" },
  FB: { name: "Facebook", color: "#3b82f6" },
  TT: { name: "TikTok", color: "#19182d" },
  LI: { name: "LinkedIn", color: "#0a66c2" },
};

export const titles: Record<NavKey, PageTitle> = {
  overview: {
    eyebrow: "VISÃO GERAL",
    title: "Boas-vindas ao SocialFlow",
    description: "Veja suas publicações e planeje os próximos conteúdos.",
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
