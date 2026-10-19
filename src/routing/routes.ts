import { matchRoutes } from "react-router";
import type { Location } from "react-router";
import type { NavKey, PageTitle } from "../types/social";

type NavigationRoute = {
  navKey: NavKey;
  path: string;
};

const navigationRoutes: NavigationRoute[] = [
  { navKey: "overview", path: "/" },
  { navKey: "agenda", path: "/agenda" },
  { navKey: "posts", path: "/publicacoes" },
  { navKey: "analytics", path: "/analises" },
  { navKey: "channels", path: "/canais" },
  { navKey: "settings", path: "/configuracoes" },
];

export const routePaths = Object.fromEntries(
  navigationRoutes.map(({ navKey, path }) => [navKey, path]),
) as Record<NavKey, string>;

export const notFoundTitle: PageTitle = {
  eyebrow: "ERRO 404",
  title: "Página não encontrada",
  description: "O endereço informado não existe no SocialFlow.",
};

export const postDetailsPath = "/publicacoes/:postId";
export const postDetailsTitle: PageTitle = {
  eyebrow: "PUBLICAÇÕES",
  title: "Detalhes da publicação",
  description: "Consulte o agendamento e o resultado de cada destino.",
};

export function getNavKey(location: Partial<Location> | string): NavKey | null {
  const matches = matchRoutes([...navigationRoutes, { navKey: "posts" as const, path: postDetailsPath }], location);

  return matches?.at(-1)?.route.navKey ?? null;
}
