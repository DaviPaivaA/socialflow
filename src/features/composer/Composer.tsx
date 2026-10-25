import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CreatePostInput } from "../../data/posts/PostsRepository";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";
import { validatePublicationCompatibility } from "../../../shared/publicationPolicy";
import { localScheduleToIso } from "../../domain/scheduling";
import { ComposerDestinations } from "./ComposerDestinations";
import { ComposerMediaPicker } from "./ComposerMediaPicker";
import { useComposerDestinations } from "./useComposerDestinations";
import { useComposerMedia } from "./useComposerMedia";
import { TikTokLocalComposer } from "../tiktok/TikTokLocalComposer";
import { useDialogFocus } from "../../components/useDialogFocus";
import { ChannelBadge } from "../../components/ChannelBadge";

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

export function Composer(props: ComposerProps) {
  return <ComposerContent key={props.workspaceId} {...props} />;
}

function ComposerContent({
  isLoadingPosts,
  isSubmitting,
  mediaAssetsRepository,
  socialAccountsRepository,
  onClose,
  onDraftChange,
  onSubmit,
  workspaceId,
}: ComposerProps) {
  const dialogRef = useRef<HTMLFormElement>(null);
  const titleId = useId();
  const tabsId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useDialogFocus(dialogRef, onClose);
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
  const [tiktokSelected, setTikTokSelected] = useState(false);
  const [activeTab, setActiveTab] = useState<"meta" | "tiktok">("meta");
  const [tiktokFeedback, setTikTokFeedback] = useState(false);
  const activateTab = (tab: "meta" | "tiktok") => {
    setActiveTab(tab);
    setTikTokFeedback(false);
  };

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
  const hasAccounts = !destinations.isLoading && !destinations.error && destinations.accounts.length > 0;
  const selectedMedia = media.selectedMediaAsset;
  const selectedProviders = destinations.accounts
    .filter((account) => destinations.selectedIds.includes(account.id))
    .flatMap(({ provider }) => provider === "facebook" || provider === "instagram" ? [provider] : []);
  const hasFacebook = selectedProviders.includes("facebook");
  const hasInstagram = selectedProviders.includes("instagram");
  const compatibility = selectedProviders.length > 0
    ? validatePublicationCompatibility({
      providers: selectedProviders, media: selectedMedia, caption: caption.trim(),
      // Conservative public ceiling; the server remains authoritative for configured limits.
      maxVideoBytes: 262_144_000,
    })
    : { valid: true as const };
  const mediaError = compatibility.valid ? null : {
    media_required: "Instagram exige mídia. Escolha uma foto JPEG ou um vídeo MP4/MOV, ou remova o destino Instagram.",
    unsupported_media_type: hasInstagram
      ? "Instagram aceita foto JPEG ou vídeo MP4/MOV. PNG e WebP não são compatíveis com esse destino."
      : "Facebook aceita foto JPEG ou PNG, ou vídeo MP4/MOV. Este formato não é compatível.",
    media_too_large: selectedMedia?.mediaType === "video"
      ? "Este vídeo excede 250 MiB (262.144.000 bytes). O servidor pode aplicar um limite menor."
      : hasFacebook
        ? "Esta imagem excede 4 MB. Use uma foto JPEG ou PNG de até 4 MB para Facebook."
        : "Esta imagem excede 8 MB. Use uma foto JPEG de até 8 MB para Instagram.",
    caption_too_long: "A legenda excede o limite de 2.200 caracteres do Instagram.",
  }[compatibility.code];
  const cannotSubmit = !hasAccounts || destinations.selectedIds.length === 0 || !caption.trim()
    || (publicationMode === "scheduled" && scheduledFor === null)
    || mediaError !== null || media.isUploadingMedia || isLoadingPosts || isSubmitting;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (activeTab === "tiktok") {
      setTikTokFeedback(true);
      return;
    }
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
      <form className="composer-modal" onSubmit={submit} ref={dialogRef}
        role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-header">
          <div><span>NOVO CONTEÚDO</span><h2 id={titleId}>Criar publicação</h2></div>
          <button aria-label="Fechar" onClick={onClose} type="button">×</button>
        </div>
        <div className="composer-destination-bar">
          <ComposerDestinations destinations={destinations} onToggle={toggleDestination} />
          <label className="composer-page composer-tiktok-destination"><input aria-label="TikTok" type="checkbox" checked={tiktokSelected} onChange={(event) => { onDraftChange(); setTikTokSelected(event.target.checked); }} /><ChannelBadge code="TT" small /><span><strong>TikTok</strong><small>Publicação indisponível</small></span></label>
        </div>
        <div className="composer-tabs" role="tablist" aria-label="Editar publicação">
          {(["meta", "tiktok"] as const).map((tab, index) => <button
            key={tab} ref={(element) => { tabRefs.current[index] = element; }}
            type="button" role="tab" id={`${tabsId}-${tab}-tab`} aria-controls={`${tabsId}-${tab}-panel`}
            aria-label={tab === "meta" ? "Facebook e Instagram" : "TikTok"}
            aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1}
            onClick={() => activateTab(tab)} onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
              activateTab(next === 0 ? "meta" : "tiktok");
              tabRefs.current[next]?.focus();
            }}>
            {tab === "meta" ? <><ChannelBadge code="FB" small /><ChannelBadge code="IG" small />Facebook e Instagram</> : <><ChannelBadge code="TT" small />TikTok</>}
          </button>)}
        </div>
        <div className="composer-scroll">
        <div role="tabpanel" id={`${tabsId}-meta-panel`} aria-labelledby={`${tabsId}-meta-tab`} hidden={activeTab !== "meta"}>
        <div className="composer-body">
          <div className="composer-fields">
            <label className="field-label">Legenda<textarea aria-label="Legenda" value={caption} onChange={(event) => changeCaption(event.target.value)} placeholder="Conte a história por trás desta publicação..." maxLength={500} required={activeTab === "meta"} /><small>{caption.length}/500</small></label>
            <fieldset className="composer-mode" disabled={!hasAccounts}>
              <legend>Publicação</legend>
              <label><input checked={publicationMode === "now"} onChange={() => changeMode("now")} name="publicationMode" type="radio" />Publicar agora</label>
              <label><input checked={publicationMode === "scheduled"} onChange={() => changeMode("scheduled")} name="publicationMode" type="radio" />Agendar</label>
            </fieldset>
            {publicationMode === "scheduled" ? <><div className="date-fields">
              <label className="field-label">Data<input type="date" value={date} onChange={(event) => changeDate(event.target.value)} required={activeTab === "meta"} /></label>
              <label className="field-label">Horário<input type="time" value={time} onChange={(event) => changeTime(event.target.value)} required={activeTab === "meta"} /></label>
            </div>
            <div className="best-time"><span>✦</span><div><strong>Agendamento</strong><p>Escolha a data e o horário da publicação.</p></div></div></> : null}
            <ComposerMediaPicker media={media} repository={mediaAssetsRepository} />
            {mediaError ? <p className="composer-format-error" role="alert">{mediaError}</p> : null}
            {selectedMedia?.mediaType === "video" && selectedProviders.length > 0 ? <p role="status">
              O vídeo usa o formato Reel.{hasFacebook ? " Na Facebook Page, a audiência é pública." : ""}
              {" Orientação: H264/AAC, 9:16, 3–90 segundos e 24–60 FPS. O SocialFlow não verifica localmente codec, duração, FPS ou proporção; a aceitação do arquivo depende da Meta."}
            </p> : null}
          </div>
          <div className="composer-preview">
            <span>PRÉVIA DA PUBLICAÇÃO</span>
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
        </div>
        <div role="tabpanel" id={`${tabsId}-tiktok-panel`} aria-labelledby={`${tabsId}-tiktok-tab`} hidden={activeTab !== "tiktok"}>
          <TikTokLocalComposer selected={tiktokSelected} onDraftChange={onDraftChange} />
        </div>
        </div>
        <div className="modal-footer">
          <div className="composer-action-target" aria-live="polite">{activeTab === "meta" ? "Facebook e Instagram" : tiktokFeedback ? <span role="status">Publicação TikTok indisponível.</span> : "TikTok"}</div>
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            Fechar sem salvar
          </button>
          {activeTab === "tiktok" ? <button className="primary-button" type="button" aria-disabled="true" onClick={() => setTikTokFeedback(true)}>Publicar no TikTok</button> : <button
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
          </button>}
        </div>
      </form>
    </div>
  );
}
