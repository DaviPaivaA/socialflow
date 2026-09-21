import type { ReactNode } from "react";
import type {
  AuthTenant,
  AuthUser,
  AuthWorkspace,
} from "../../shared/authContract";
import type { NavKey, PageTitle } from "../types/social";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

type MainLayoutProps = {
  active: NavKey | null;
  children: ReactNode;
  currentTenant: AuthTenant;
  currentUser: AuthUser;
  isLoadingWorkspaces: boolean;
  isSwitchingWorkspace: boolean;
  mobileNavOpen: boolean;
  overlays: ReactNode;
  pageTitle: PageTitle;
  onCompose: () => void;
  onLogout: () => Promise<void> | void;
  onNavigate: (view: NavKey) => void;
  onSelectWorkspace: (tenantId: string) => Promise<void> | void;
  onToggleMenu: () => void;
  workspaceError: string | null;
  workspaces: AuthWorkspace[];
};

export function MainLayout({
  active,
  children,
  currentTenant,
  currentUser,
  isLoadingWorkspaces,
  isSwitchingWorkspace,
  mobileNavOpen,
  overlays,
  pageTitle,
  onCompose,
  onLogout,
  onNavigate,
  onSelectWorkspace,
  onToggleMenu,
  workspaceError,
  workspaces,
}: MainLayoutProps) {
  return (
    <main className="app-shell">
      <Sidebar
        active={active}
        currentTenant={currentTenant}
        currentUser={currentUser}
        isLoadingWorkspaces={isLoadingWorkspaces}
        isSwitchingWorkspace={isSwitchingWorkspace}
        mobileOpen={mobileNavOpen}
        onCompose={onCompose}
        onLogout={onLogout}
        onNavigate={onNavigate}
        onSelectWorkspace={onSelectWorkspace}
        workspaceError={workspaceError}
        workspaces={workspaces}
      />

      <section className="main-area">
        <Topbar currentUser={currentUser} onToggleMenu={onToggleMenu} />

        <div className="page-content">
          <header className="page-header">
            <div>
              <span>{pageTitle.eyebrow}</span>
              <h1>{pageTitle.title}</h1>
              <p>{pageTitle.description}</p>
            </div>
            {active !== null &&
              active !== "overview" &&
              active !== "settings" && (
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
