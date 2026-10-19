import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

export function NotificationsPopover({ id, triggerRef, onClose }: {
  id: string; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = ref.current!;
    panel.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) onClose();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); triggerRef.current?.focus(); }
    };
    const focusout = (event: FocusEvent) => {
      if (!panel.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusout);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusout);
    };
  }, [onClose, triggerRef]);
  return <section className="notifications-popover" id={id} ref={ref} tabIndex={-1} role="region" aria-label="Notificações">
    <h2>Notificações</h2>
    <p>Nenhuma notificação disponível.</p>
    <p>Esta versão ainda não disponibiliza eventos de notificações.</p>
    <button className="secondary-button" type="button" onClick={() => { onClose(); triggerRef.current?.focus(); }}>Fechar notificações</button>
  </section>;
}
