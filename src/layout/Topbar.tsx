import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { AuthUser, TenantRole } from "../../shared/authContract";
import type { PostsLoadState } from "../pages/Posts";
import type { Post } from "../types/social";
import { GlobalPostSearch } from "./GlobalPostSearch";
import { HelpDialog } from "./HelpDialog";
import { NotificationsPopover } from "./NotificationsPopover";

type TopbarProps = {
  currentUser: AuthUser;
  onToggleMenu: () => void;
  posts: readonly Post[];
  postsLoadState: PostsLoadState;
  onOpenPost: (id: string) => void;
  role: TenantRole;
  modalActive: boolean;
};

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Topbar({ currentUser, onToggleMenu, posts, postsLoadState, onOpenPost, role, modalActive }: TopbarProps) {
  const [panel, setPanel] = useState<"search" | "help" | "notifications" | null>(null);
  const close = useCallback(() => setPanel(null), []);
  const notificationRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notificationId = useId();
  // An opened product dialog supersedes local panels, rather than leaving a
  // hidden search/help draft to reappear when that dialog closes.
  if (modalActive && panel !== null) setPanel(null);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (modalActive || panel === "help") return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPanel("search");
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [modalActive, panel]);
  return (
    <>
    <header className="topbar">
      <button
        className="menu-toggle"
        onClick={onToggleMenu}
        aria-label="Abrir menu"
        type="button"
      >
        ☰
      </button>
      <button className="search-box" type="button" aria-label="Pesquisar publicações" disabled={modalActive}
        aria-haspopup="dialog" onClick={() => setPanel("search")}>
        <span>⌕</span>
        <span>Pesquisar conteúdo...</span>
        <kbd>Ctrl/⌘ K</kbd>
      </button>
      <div className="topbar-actions">
        <button aria-label="Ajuda" type="button" disabled={modalActive} aria-haspopup="dialog" onClick={() => setPanel("help")}>
          ?
        </button>
        <button
          aria-label="Notificações"
          className="notification"
          type="button"
          ref={notificationRef}
          disabled={modalActive}
          aria-expanded={!modalActive && panel === "notifications"}
          aria-controls={notificationId}
          onClick={() => setPanel((current) => current === "notifications" ? null : "notifications")}
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
    {!modalActive && panel === "search" && <GlobalPostSearch posts={posts} postsLoadState={postsLoadState} onOpenPost={onOpenPost} onClose={close} inputRef={searchInputRef} />}
    {!modalActive && panel === "help" && <HelpDialog role={role} onClose={close} />}
    {!modalActive && panel === "notifications" && <NotificationsPopover id={notificationId} triggerRef={notificationRef} onClose={close} />}
    </>
  );
}
