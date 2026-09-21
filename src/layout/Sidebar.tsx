import { navItems } from "../data/mockData";
import type {
  AuthTenant,
  AuthUser,
  AuthWorkspace,
} from "../../shared/authContract";
import type { NavKey } from "../types/social";

type SidebarProps = {
  active: NavKey | null;
  currentTenant: AuthTenant;
  currentUser: AuthUser;
  isLoadingWorkspaces: boolean;
  isSwitchingWorkspace: boolean;
  mobileOpen: boolean;
  onCompose: () => void;
  onLogout: () => Promise<void> | void;
  onNavigate: (view: NavKey) => void;
  onSelectWorkspace: (tenantId: string) => Promise<void> | void;
  workspaceError: string | null;
  workspaces: AuthWorkspace[];
};

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

const roleLabels = {
  admin: "Administrador",
  member: "Membro",
  owner: "Proprietário",
} as const;

export function Sidebar({
  active,
  currentTenant,
  currentUser,
  isLoadingWorkspaces,
  isSwitchingWorkspace,
  mobileOpen,
  onCompose,
  onLogout,
  onNavigate,
  onSelectWorkspace,
  workspaceError,
  workspaces,
}: SidebarProps) {
  const hasMultipleWorkspaces = workspaces.length > 1;

  return (
    <aside className={"sidebar " + (mobileOpen ? "mobile-open" : "")}>
      <div className="brand">
        <div className="brand-mark">
          <i />
          <i />
          <i />
        </div>
        <strong>
          Social<span>Flow</span>
        </strong>
      </div>
      <div className="workspace-switch">
        <div className="avatar">{initials(currentTenant.name)}</div>
        <div>
          <span>WORKSPACE</span>
          {hasMultipleWorkspaces ? (
            <select
              aria-busy={isSwitchingWorkspace}
              aria-label="Workspace ativo"
              disabled={isLoadingWorkspaces || isSwitchingWorkspace}
              onChange={(event) => {
                void onSelectWorkspace(event.target.value);
              }}
              value={currentTenant.id}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.tenantId} value={workspace.tenantId}>
                  {workspace.name}
                </option>
              ))}
            </select>
          ) : (
            <strong>{currentTenant.name}</strong>
          )}
          {isLoadingWorkspaces && !isSwitchingWorkspace && (
            <small aria-live="polite">Carregando...</small>
          )}
          {isSwitchingWorkspace && <small role="status">Trocando...</small>}
          {workspaceError && (
            <small className="workspace-error" role="alert">
              {workspaceError}
            </small>
          )}
        </div>
      </div>
      <nav aria-label="Navegação principal">
        <span className="nav-label">MENU</span>
        {navItems.map((item) => (
          <button
            className={active === item.key ? "active" : ""}
            key={item.key}
            onClick={() => onNavigate(item.key)}
            type="button"
          >
            <i>{item.icon}</i>
            <span>{item.label}</span>
            {item.key === "posts" && <b>3</b>}
          </button>
        ))}
      </nav>
      <div className="sidebar-tip">
        <span>✦</span>
        <strong>Horário inteligente</strong>
        <p>Seu público está mais ativo hoje às 19h.</p>
        <button onClick={onCompose} type="button">
          Criar post
        </button>
      </div>
      <div className="sidebar-user">
        <div className="avatar user">{initials(currentUser.displayName)}</div>
        <div>
          <strong>{currentUser.displayName}</strong>
          <span>{roleLabels[currentTenant.role]}</span>
        </div>
        <button aria-label="Sair" onClick={onLogout} type="button">
          Sair
        </button>
      </div>
    </aside>
  );
}
