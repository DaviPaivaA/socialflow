import type { ReactNode } from "react";
import type { NavKey, PageTitle } from "../types/social";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

type MainLayoutProps = {
  active: NavKey;
  children: ReactNode;
  mobileNavOpen: boolean;
  overlays: ReactNode;
  pageTitle: PageTitle;
  onCompose: () => void;
  onNavigate: (view: NavKey) => void;
  onToggleMenu: () => void;
};

export function MainLayout({
  active,
  children,
  mobileNavOpen,
  overlays,
  pageTitle,
  onCompose,
  onNavigate,
  onToggleMenu,
}: MainLayoutProps) {
  return (
    <main className="app-shell">
      <Sidebar
        active={active}
        mobileOpen={mobileNavOpen}
        onCompose={onCompose}
        onNavigate={onNavigate}
      />

      <section className="main-area">
        <Topbar onToggleMenu={onToggleMenu} />

        <div className="page-content">
          <header className="page-header">
            <div>
              <span>{pageTitle.eyebrow}</span>
              <h1>{pageTitle.title}</h1>
              <p>{pageTitle.description}</p>
            </div>
            {active !== "overview" && active !== "settings" && (
              <button
                className="primary-button desktop-action"
                onClick={onCompose}
                type="button"
              >
                ＋ Criar publicação
              </button>
            )}
          </header>

          {children}
        </div>
      </section>

      {overlays}
    </main>
  );
}
