import { useRef } from "react";
import { AccessibleDialog } from "../../components/AccessibleDialog";
import { getPostTitle } from "../../domain/postPresentation";
import type { Post } from "../../types/social";

type Props = {
  post: Post;
  isSubmitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
};

export function CancelScheduleDialog({
  post, isSubmitting, error, onConfirm, onClose,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AccessibleDialog
      title="Excluir agendamento?"
      description={`A publicação “${getPostTitle(post)}” não será enviada aos destinos agendados após a confirmação do servidor.`}
      initialFocusRef={cancelRef}
      onClose={() => { if (!isSubmitting) onClose(); }}
    >
      {error && <p role="alert">{error}</p>}
      {isSubmitting && <p role="status">Aguarde a confirmação. Fechar a tela não interrompe uma solicitação enviada.</p>}
      <div className="dialog-actions">
        <button className="secondary-button" type="button" ref={cancelRef} disabled={isSubmitting} onClick={onClose}>Cancelar</button>
        <button className="primary-button" type="button" disabled={isSubmitting} onClick={onConfirm}>
          {isSubmitting ? "Cancelando…" : "Confirmar cancelamento"}
        </button>
      </div>
    </AccessibleDialog>
  );
}
