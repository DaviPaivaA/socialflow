import { useState } from "react";
import type { FormEvent } from "react";
import type { CreatePostInput } from "../../data/posts/PostsRepository";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import { localScheduleToIso } from "../../domain/scheduling";
import { ComposerMediaPicker } from "./ComposerMediaPicker";
import { useComposerMedia } from "./useComposerMedia";

type ComposerProps = {
  isLoadingPosts: boolean;
  isSubmitting: boolean;
  mediaAssetsRepository: MediaAssetsRepository;
  onClose: () => void;
  onDraftChange: () => void;
  onSchedule: (post: CreatePostInput) => Promise<void> | void;
  workspaceId: string;
};

export function Composer({
  isLoadingPosts,
  isSubmitting,
  mediaAssetsRepository,
  onClose,
  onDraftChange,
  onSchedule,
  workspaceId,
}: ComposerProps) {
  const [initialSchedule] = useState(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    return {
      date: `${nextHour.getFullYear()}-${String(nextHour.getMonth() + 1).padStart(2, "0")}-${String(nextHour.getDate()).padStart(2, "0")}`,
      time: `${String(nextHour.getHours()).padStart(2, "0")}:00`,
    };
  });
  const [caption, setCaption] = useState("");
  const [date, setDate] = useState(initialSchedule.date);
  const [time, setTime] = useState(initialSchedule.time);
  const media = useComposerMedia({ repository: mediaAssetsRepository, workspaceId, onDraftChange });
  const [failedPreviewSrc, setFailedPreviewSrc] = useState<string | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);

  const changeCaption = (value: string) => {
    onDraftChange();
    setCaption(value);
  };

  const changeDate = (value: string) => {
    onDraftChange();
    setDate(value);
  };

  const changeTime = (value: string) => {
    onDraftChange();
    setTime(value);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const scheduledFor = localScheduleToIso(date, time);
    if (!caption.trim() || scheduledFor === null || media.isUploadingMedia || isLoadingPosts || isSubmitting) {
      return;
    }

    onSchedule({
      title:
        caption.trim().split(/[.!?]/)[0].slice(0, 38) || "Nova publicação",
      caption: caption.trim(),
      mediaAssetIds: media.selectedMediaAsset ? [media.selectedMediaAsset.id] : [],
      scheduledFor,
      status: "scheduled",
    });
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="composer-modal" onSubmit={submit}>
        <div className="modal-header">
          <div><span>NOVO CONTEÚDO</span><h2>Criar publicação</h2></div>
          <button aria-label="Fechar" onClick={onClose} type="button">×</button>
        </div>
        <div className="composer-body">
          <div className="composer-fields">
            <label className="field-label">Legenda<textarea value={caption} onChange={(event) => changeCaption(event.target.value)} placeholder="Conte a história por trás desta publicação..." maxLength={500} required /><small>{caption.length}/500</small></label>
            <div className="date-fields">
              <label className="field-label">Data<input type="date" value={date} onChange={(event) => changeDate(event.target.value)} required /></label>
              <label className="field-label">Horário<input type="time" value={time} onChange={(event) => changeTime(event.target.value)} required /></label>
            </div>
            <div className="best-time"><span>✦</span><div><strong>Agendamento</strong><p>Escolha a data e o horário da publicação.</p></div></div>
            <ComposerMediaPicker media={media} repository={mediaAssetsRepository} />
          </div>
          <div className="composer-preview">
            <span>PRÉ-VISUALIZAÇÃO</span>
            <div className="social-preview">
              <div className="social-user"><div className="avatar tiny">SF</div><div><strong>Seu perfil</strong><span>Prévia ilustrativa</span></div><b>•••</b></div>
              <div className={`preview-canvas${media.preview ? " media-preview-canvas" : ""}`} data-testid="composer-main-preview">
                {media.preview && failedPreviewSrc !== media.preview.src
                  ? media.preview.mediaType === "image"
                    ? <img alt="Prévia da publicação" decoding="async" key={`${media.preview.src}-${previewRetry}`} loading="lazy" onError={() => setFailedPreviewSrc(media.preview?.src ?? null)} src={media.preview.src} />
                    : <video controls key={`${media.preview.src}-${previewRetry}`} onError={() => setFailedPreviewSrc(media.preview?.src ?? null)} preload="metadata" src={media.preview.src} />
                  : media.preview
                    ? <div className="media-preview-unavailable"><span>Prévia indisponível</span><button onClick={() => { setFailedPreviewSrc(null); setPreviewRetry((value) => value + 1); }} type="button">Tentar novamente</button></div>
                    : <><span>✦</span><p>SEU CONTEÚDO<br /><b>AQUI.</b></p></>}
              </div>
              <div className="social-actions">♡　⌁　➤ <span>▣</span></div>
              <p><strong>Seu perfil</strong> {caption || "Sua legenda aparecerá aqui..."}</p>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            Fechar sem salvar
          </button>
          <button
            aria-busy={isSubmitting}
            aria-label="Agendar publicação"
            className="primary-button"
            disabled={isLoadingPosts || isSubmitting || media.isUploadingMedia}
            type="submit"
          >
            {isSubmitting
              ? "▦ Agendando publicação..."
              : isLoadingPosts
                ? "▦ Carregando publicações..."
                : media.isUploadingMedia
                  ? "▦ Enviando mídia..."
                : "▦ Agendar publicação"}
          </button>
        </div>
      </form>
    </div>
  );
}
