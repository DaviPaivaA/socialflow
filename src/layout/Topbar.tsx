import type { AuthUser } from "../../shared/authContract";

type TopbarProps = {
  currentUser: AuthUser;
  onToggleMenu: () => void;
};

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Topbar({ currentUser, onToggleMenu }: TopbarProps) {
  return (
    <header className="topbar">
      <button
        className="menu-toggle"
        onClick={onToggleMenu}
        aria-label="Abrir menu"
        type="button"
      >
        ☰
      </button>
      <div className="search-box">
        <span>⌕</span>
        <input aria-label="Pesquisar" placeholder="Pesquisar conteúdo..." />
        <kbd>⌘ K</kbd>
      </div>
      <div className="topbar-actions">
        <button aria-label="Ajuda" type="button">
          ?
        </button>
        <button
          aria-label="Notificações"
          className="notification"
          type="button"
        >
          ♢
        </button>
        <div
          aria-label={`Usuário ${currentUser.displayName}`}
          className="avatar user"
        >
          {initials(currentUser.displayName)}
        </div>
      </div>
    </header>
  );
}
