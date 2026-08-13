type TopbarProps = {
  onToggleMenu: () => void;
};

export function Topbar({ onToggleMenu }: TopbarProps) {
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
          ♢<i />
        </button>
        <div className="avatar user">DA</div>
      </div>
    </header>
  );
}
