export type NavKey =
  | "overview"
  | "agenda"
  | "posts"
  | "analytics"
  | "channels"
  | "settings";

export type ChannelCode = "IG" | "FB" | "TT" | "LI";
export type PostStatus = "Agendado" | "Rascunho" | "Publicado";
export type ContentColor = "coral" | "purple" | "blue" | "green";

export type Post = {
  id: number;
  title: string;
  caption: string;
  scheduledAt: string;
  channels: ChannelCode[];
  status: PostStatus;
  color: ContentColor;
};

export type NavItem = {
  key: NavKey;
  label: string;
  icon: string;
};

export type ChannelDetails = {
  name: string;
  color: string;
};

export type PageTitle = {
  eyebrow: string;
  title: string;
  description: string;
};

export type Metric = {
  label: string;
  value: string;
  change: string;
  icon: string;
  tone: ContentColor;
};

export type CalendarItem = {
  name: string;
  color: ContentColor;
  time: string;
};

export type CalendarDay = {
  day: string;
  date: string;
  today?: boolean;
  items: CalendarItem[];
};

export type ConnectedChannel = {
  code: ChannelCode;
  user: string;
  followers: string;
  status: string;
};

export type SettingPreference = {
  title: string;
  description: string;
};
