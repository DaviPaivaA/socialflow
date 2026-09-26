import { useState } from "react";
import type { MediaAsset } from "../../../shared/mediaContract";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import type { useComposerMedia } from "./useComposerMedia";

type ComposerMediaController = ReturnType<typeof useComposerMedia>;

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

function MediaCard({ asset, contentUrl, isSelected, onSelect }: {
  asset: MediaAsset;
  contentUrl: string;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  return <button
    aria-label={`Selecionar ${asset.originalFilename}`}
    aria-pressed={isSelected}
    className={`media-card${isSelected ? " media-card--selected" : ""}`}
    onClick={onSelect}
    type="button"
  >
    <span className="media-card-preview" data-testid={`media-card-preview-${asset.id}`}>
      {previewFailed ? <span>Prévia indisponível</span> : asset.mediaType === "image"
        ? <img alt="" decoding="async" loading="lazy" onError={() => setPreviewFailed(true)} src={contentUrl} />
        : <video aria-label={`Prévia de ${asset.originalFilename}`} muted onError={() => setPreviewFailed(true)} preload="metadata" src={contentUrl} />}
    </span>
    <span className="media-card-info"><strong title={asset.originalFilename}>{asset.originalFilename}</strong><small>{asset.mediaType === "image" ? "Imagem" : "Vídeo"} · {readableSize(asset.sizeBytes)}</small></span>
    <span className="media-card-indicator" aria-hidden="true">{isSelected ? "✓" : "+"}</span>
  </button>;
}

export function ComposerMediaPicker({ media, repository }: {
  media: ComposerMediaController;
  repository: MediaAssetsRepository;
}) {
  const [lastFile, setLastFile] = useState<File | null>(null);
  const uploadError = media.error === "Não foi possível enviar esta mídia.";

  return <section aria-label="Biblioteca de mídia" className="composer-media-library">
    <div className="media-library-heading"><strong>Mídia</strong><span>Escolha até uma foto ou vídeo</span></div>
    <label className="media-upload-button">
      <span>Enviar foto ou vídeo</span>
      <input
        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
        aria-label="Enviar foto ou vídeo"
        className="media-upload-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setLastFile(file);
          void media.uploadFile(file);
        }}
        type="file"
      />
    </label>
    {media.isUploadingMedia && <p className="media-upload-progress" role="status">Enviando mídia...</p>}
    {media.error && <div className="media-library-error" role="alert"><p>{media.error}</p>
      {uploadError
        ? lastFile && <button onClick={() => void media.uploadFile(lastFile)} type="button">Tentar enviar novamente</button>
        : <button onClick={media.retryList} type="button">Tentar novamente</button>}
    </div>}
    {media.isLoadingMedia && <p className="media-library-loading" role="status">Carregando biblioteca de mídia...</p>}
    {!media.isLoadingMedia && media.mediaAssets.length === 0 && <p className="media-library-empty">Nenhuma mídia neste Workspace. Você pode agendar sem mídia.</p>}
    {media.mediaAssets.length > 0 && <div className="media-library-grid">
      {media.mediaAssets.map((asset) => <MediaCard
        asset={asset}
        contentUrl={repository.contentUrl(asset.id)}
        isSelected={media.selectedMediaAsset?.id === asset.id}
        key={asset.id}
        onSelect={() => media.selectMedia(asset)}
      />)}
    </div>}
    {media.selectedMediaAsset && <button className="media-library-remove" onClick={media.clearSelection} type="button">Remover seleção</button>}
  </section>;
}
