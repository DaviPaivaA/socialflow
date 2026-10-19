import { useId, useLayoutEffect, useRef, useState } from "react";
import { getPostTitle } from "../../domain/postPresentation";
import type { Post } from "../../types/social";

type Props = {
  post: Post;
  canManageAuthor: boolean;
  onDetails: () => void;
  onEdit: () => void;
  onCancel: () => void;
};

export function PostActionsMenu({
  post, canManageAuthor, onDetails, onEdit, onCancel,
}: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const initialIndex = useRef(0);
  const id = useId();
  const actions = [
    { label: "Ver detalhes", run: onDetails },
    ...(post.status === "scheduled" && canManageAuthor ? [
      { label: "Editar agendamento", run: onEdit },
      { label: "Cancelar agendamento", run: onCancel },
    ] : []),
  ];
  useLayoutEffect(() => {
    if (!open) return;
    const items = root.current!.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items[initialIndex.current]?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="post-actions" ref={root} onBlur={(event) => {
      // Let native Tab move focus before removing the focused menu item.
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button
        className="more-button" type="button" ref={trigger}
        id={`${id}-trigger`} aria-label={`Opções de ${getPostTitle(post)}`}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
        onClick={() => { initialIndex.current = 0; setOpen(!open); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            initialIndex.current = event.key === "ArrowUp" ? actions.length - 1 : 0;
            setOpen(true);
          }
        }}
      >•••</button>
      {open && (
        <div
          className="post-actions-menu" role="menu" id={id}
          aria-labelledby={`${id}-trigger`}
          aria-describedby={post.status === "scheduled" && !canManageAuthor ? `${id}-permission` : undefined}
          onKeyDown={(event) => {
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const next = event.key === "Home" ? 0
                : event.key === "End" ? items.length - 1
                  : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }
          }}
        >
          {actions.map((action) => (
            <button key={action.label} role="menuitem" type="button" tabIndex={-1}
              onClick={() => { close(); action.run(); }}>
              {action.label}
            </button>
          ))}
          {post.status === "scheduled" && !canManageAuthor && (
            <p className="post-actions-note" id={`${id}-permission`} role="note">
              Somente o autor, proprietários ou administradores podem gerenciar este agendamento.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
