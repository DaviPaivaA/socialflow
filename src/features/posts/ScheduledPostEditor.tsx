import type { PostDetail, UpdateScheduledPostInput } from "../../data/posts/PostsRepository";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";
import { useRef, useState, type FormEvent } from "react";
import { AccessibleDialog } from "../../components/AccessibleDialog";
import { validatePublicationCompatibility } from "../../../shared/publicationPolicy";
import { localScheduleToIso } from "../../domain/scheduling";
import { ComposerDestinations } from "../composer/ComposerDestinations";
import { ComposerMediaPicker } from "../composer/ComposerMediaPicker";
import { useComposerDestinations } from "../composer/useComposerDestinations";
import { useComposerMedia } from "../composer/useComposerMedia";
import { buildScheduledPostPatch, createScheduledPostDraft } from "./scheduledPostDraft";

export type ScheduledPostEditorProps = {
  detail: PostDetail;
  workspaceId: string;
  mediaAssetsRepository: MediaAssetsRepository;
  socialAccountsRepository: SocialAccountsRepository;
  isSubmitting: boolean;
  error: string | null;
  onSave: (input: UpdateScheduledPostInput) => void | Promise<void>;
  onClose: () => void;
  onDraftChange?: () => void;
};

export function ScheduledPostEditor({ detail, workspaceId, mediaAssetsRepository, socialAccountsRepository,
  isSubmitting, error, onSave, onClose, onDraftChange }: ScheduledPostEditorProps) {
  // The parent keys each editor by Workspace + post + opening. List refreshes
  // must never replace the original snapshot or an in-progress user draft.
  const [original] = useState(detail);
  const [draft, setDraft] = useState(() => createScheduledPostDraft(original));
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const markMediaChanged = () => {
    setDraft((current) => ({ ...current, dirty: { ...current.dirty, media: true } }));
    onDraftChange?.();
  };
  const media = useComposerMedia({ repository: mediaAssetsRepository, workspaceId,
    initialMediaAssetId: original.post.mediaAssetIds[0] ?? null, onDraftChange: markMediaChanged });
  const destinations = useComposerDestinations({ repository: socialAccountsRepository, workspaceId,
    initialSelectedIds: draft.socialAccountIds });
  const currentDraft = { ...draft, socialAccountIds: destinations.selectedIds,
    mediaAssetIds: draft.dirty.media ? media.selectedMediaAssetId ? [media.selectedMediaAssetId] : [] : draft.mediaAssetIds };
  const legacyUntouched = original.publications.length === 0 && !draft.dirty.destinations;
  const providers = destinations.accounts.filter((account) => destinations.selectedIds.includes(account.id))
    .flatMap(({ provider }) => provider === "facebook" || provider === "instagram" ? [provider] : []);
  const compatibility = validatePublicationCompatibility({ providers, caption: draft.caption,
    media: media.selectedMediaAsset, maxVideoBytes: 262_144_000 });
  const mediaError = compatibility.valid || legacyUntouched ? null : {
    media_required: "Instagram exige mídia. Escolha uma foto JPEG ou vídeo MP4/MOV, ou remova Instagram.",
    unsupported_media_type: "Formato incompatível com os destinos. Instagram aceita JPEG; Facebook aceita JPEG/PNG; vídeos MP4/MOV usam Reel.",
    media_too_large: "A mídia excede o limite dos destinos selecionados (imagem: Facebook 4 MB, Instagram 8 MB; vídeo: 250 MiB).",
    caption_too_long: "A legenda excede o limite de 2.200 caracteres do Instagram.",
  }[compatibility.code];
  const scheduleValid = !draft.dirty.schedule || localScheduleToIso(draft.localDate, draft.localTime) !== null;
  // App advances this baseline only for this editor's successful PATCH. The
  // initial snapshot above still owns all prefilled fields and picker IDs.
  const patch = scheduleValid ? buildScheduledPostPatch(detail, currentDraft) : {};
  const blocked = isSubmitting || saving || media.isUploadingMedia || media.isLoadingMedia || destinations.isLoading
    || media.initialSelectionUnavailable || destinations.unavailableSelectedIds.length > 0 || !!destinations.error
    || !draft.caption.trim() || !scheduleValid || mediaError !== null
    || (!legacyUntouched && destinations.selectedIds.length === 0) || Object.keys(patch).length === 0;

  const changeText = (field: "title" | "caption" | "localDate" | "localTime", value: string) => {
    const dirty = field === "localDate" || field === "localTime" ? "schedule" : field;
    setDraft((current) => ({ ...current, [field]: field === "title" && value === "" ? null : value,
      dirty: { ...current.dirty, [dirty]: true } }));
    onDraftChange?.();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (blocked || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try { await onSave(patch); }
    catch { /* Mutation errors are owned and presented by the parent. */ }
    finally { inFlight.current = false; setSaving(false); }
  };

  return <AccessibleDialog title="Editar agendamento" onClose={onClose} initialFocusRef={titleRef}>
    <form className="scheduled-post-editor" onSubmit={(event) => { void submit(event); }}>
      <label className="field-label">Título<input ref={titleRef} value={draft.title ?? ""} onChange={(event) => changeText("title", event.target.value)} /></label>
      <label className="field-label">Legenda<textarea value={draft.caption} onChange={(event) => changeText("caption", event.target.value)} required /></label>
      <div className="date-fields">
        <label className="field-label">Data<input type="date" value={draft.localDate} onChange={(event) => changeText("localDate", event.target.value)} required /></label>
        <label className="field-label">Horário<input type="time" value={draft.localTime} onChange={(event) => changeText("localTime", event.target.value)} required /></label>
      </div>
      {!scheduleValid && <p role="alert">Data ou horário inválido.</p>}
      <ComposerDestinations destinations={destinations} onToggle={(id) => {
        destinations.toggle(id);
        setDraft((current) => ({ ...current, dirty: { ...current.dirty, destinations: true } }));
        onDraftChange?.();
      }} />
      {legacyUntouched && <p>Este agendamento legado não possui destinos. Não será enviado sem seleção explícita de uma conta.</p>}
      <ComposerMediaPicker media={media} repository={mediaAssetsRepository} />
      {media.initialSelectionUnavailable && <div role="alert">
        <p>Mídia selecionada indisponível — {media.selectedMediaAssetId}. Remova ou substitua para salvar.</p>
        <button type="button" onClick={media.clearSelection}>Remover mídia indisponível</button>
      </div>}
      {mediaError && <p role="alert">{mediaError}</p>}
      {media.selectedMediaAsset?.mediaType === "video" && providers.length > 0 && <p role="status">O vídeo usa o formato Reel.{providers.includes("facebook") ? " Na Facebook Page, a audiência é pública." : ""}</p>}
      {error && <div role="alert"><p>{error}</p><a href={`#/publicacoes/${encodeURIComponent(original.post.id)}`} onClick={onClose}>Consultar detalhes da publicação</a></div>}
      {(isSubmitting || saving) && <p role="status">Aguarde a confirmação. Fechar não interrompe a solicitação enviada.</p>}
      <div className="dialog-actions">
        <button className="secondary-button" type="button" onClick={onClose}>Cancelar</button>
        <button className="primary-button" type="submit" aria-busy={isSubmitting || saving} disabled={blocked}>Salvar alterações</button>
      </div>
    </form>
  </AccessibleDialog>;
}
