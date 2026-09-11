import { navItems } from "../data/mockData";
import type { NavKey } from "../types/social";

type SidebarProps = {
  active: NavKey | null;
  mobileOpen: boolean;
  onCompose: () => void;
  onNavigate: (view: NavKey) => void;
};

export function Sidebar({
  active,
  mobileOpen,
  onCompose,
  onNavigate,
}: SidebarProps) {
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
        <div className="avatar">CA</div>
        <div>
          <span>ESPAÇO DE TRABALHO</span>
          <strong>Café Aurora</strong>
        </div>
        <button aria-label="Trocar área de trabalho" type="button">
          ⌄
        </button>
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
        <div className="avatar user">DA</div>
        <div>
          <strong>Davi Alvares</strong>
          <span>Plano acadêmico</span>
        </div>
        <button aria-label="Opções do perfil" type="button">
          •••
        </button>
      </div>
    </aside>
  );
}
