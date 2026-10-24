import { useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { useDialogFocus } from "./useDialogFocus";

export type AccessibleDialogProps = {
  title: string;
  description?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
};

export function AccessibleDialog({
  title, description, initialFocusRef, onClose, children,
}: AccessibleDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose, initialFocusRef);
  return (
    <div className="modal-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="accessible-dialog" role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1} ref={dialogRef}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        {description && <p id={`${id}-description`}>{description}</p>}
        {children}
      </section>
    </div>
  );
}
