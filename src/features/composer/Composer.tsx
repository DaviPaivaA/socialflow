import { useState } from "react";
import type { FormEvent } from "react";
import type { CreatePostInput } from "../../data/posts/PostsRepository";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";
import { localScheduleToIso } from "../../domain/scheduling";
import { ComposerDestinations } from "./ComposerDestinations";
import { ComposerMediaPicker } from "./ComposerMediaPicker";
import { useComposerDestinations } from "./useComposerDestinations";
import { useComposerMedia } from "./useComposerMedia";

type ComposerProps = {
  isLoadingPosts: boolean;
  isSubmitting: boolean;
  mediaAssetsRepository: MediaAssetsRepository;
  socialAccountsRepository: SocialAccountsRepository;
  onClose: () => void;
  onDraftChange: () => void;
  onSubmit: (post: CreatePostInput) => Promise<void> | void;
  workspaceId: string;
};

export function Composer({
  isLoadingPosts,
  isSubmitting,
  mediaAssetsRepository,
  socialAccountsRepository,
  onClose,
  onDraftChange,
  onSubmit,
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
  const [publicationMode, setPublicationMode] = useState<CreatePostInput["publicationMode"]>("now");
  const [date, setDate] = useState(initialSchedule.date);
  const [time, setTime] = useState(initialSchedule.time);
  const media = useComposerMedia({ repository: mediaAssetsRepository, workspaceId, onDraftChange });
  const destinations = useComposerDestinations({ repository: socialAccountsRepository, workspaceId });
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

  const changeMode = (mode: CreatePostInput["publicationMode"]) => {
    onDraftChange();
    setPublicationMode(mode);
  };

  const toggleDestination = (id: string) => {
    destinations.toggle(id);
    onDraftChange();
  };

  const scheduledFor = publicationMode === "scheduled" ? localScheduleToIso(date, time) : null;
  const hasPages = !destinations.isLoading && !destinations.error && destinations.facebookPages.length > 0;
  const selectedMedia = media.selectedMediaAsset;
  const mediaError = selectedMedia?.mediaType === "video"
    ? "Vídeo ainda não é compatível com publicação no Facebook. Use uma foto JPEG ou PNG, ou remova a mídia."
    : selectedMedia && !["image/jpeg", "image/png"].includes(selectedMedia.mimeType)
      ? "Este formato de imagem não é compatível com publicação no Facebook. Use uma foto JPEG ou PNG."
      : selectedMedia && selectedMedia.sizeBytes > 4_000_000
        ? "Esta imagem excede 4 MB. Use uma foto JPEG ou PNG de até 4 MB."
        : null;
  const cannotSubmit = !hasPages || destinations.selectedIds.length === 0 || !caption.trim()
    || (publicationMode === "scheduled" && scheduledFor === null)
    || mediaError !== null || media.isUploadingMedia || isLoadingPosts || isSubmitting;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (cannotSubmit) {
      return;
    }

    onSubmit({
      title:
        caption.trim().split(/[.!?]/)[0].slice(0, 38) || "Nova publicação",
      caption: caption.trim(),
      mediaAssetIds: media.selectedMediaAsset ? [media.selectedMediaAsset.id] : [],
      publicationMode,
      socialAccountIds: destinations.selectedIds,
      ...(publicationMode === "scheduled" && scheduledFor ? { scheduledFor } : {}),
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
            <ComposerDestinations destinations={destinations} onToggle={toggleDestination} />
            <fieldset className="composer-mode" disabled={!hasPages}>
              <legend>Publicação</legend>
              <label><input checked={publicationMode === "now"} onChange={() => changeMode("now")} name="publicationMode" type="radio" />Publicar agora</label>
              <label><input checked={publicationMode === "scheduled"} onChange={() => changeMode("scheduled")} name="publicationMode" type="radio" />Agendar</label>
            </fieldset>
            {publicationMode === "scheduled" ? <><div className="date-fields">
              <label className="field-label">Data<input type="date" value={date} onChange={(event) => changeDate(event.target.value)} required /></label>
              <label className="field-label">Horário<input type="time" value={time} onChange={(event) => changeTime(event.target.value)} required /></label>
            </div>
            <div className="best-time"><span>✦</span><div><strong>Agendamento</strong><p>Escolha a data e o horário da publicação.</p></div></div></> : null}
            <ComposerMediaPicker media={media} repository={mediaAssetsRepository} />
            {mediaError ? <p className="composer-format-error" role="alert">{mediaError}</p> : null}
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
            aria-label={publicationMode === "scheduled" ? "Agendar publicação" : "Publicar agora"}
            className="primary-button"
            disabled={cannotSubmit}
            type="submit"
          >
            {isSubmitting
              ? publicationMode === "scheduled" ? "▦ Agendando publicação..." : "▦ Publicando publicação..."
              : isLoadingPosts
                ? "▦ Carregando publicações..."
                : media.isUploadingMedia
                  ? "▦ Enviando mídia..."
                : publicationMode === "scheduled" ? "▦ Agendar publicação" : "▦ Publicar agora"}
          </button>
        </div>
      </form>
    </div>
  );
}
