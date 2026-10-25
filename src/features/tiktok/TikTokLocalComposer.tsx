import { useEffect, useRef, useState } from "react";
import { ChannelBadge } from "../../components/ChannelBadge";
import "./tiktok.css";

const localResourceBrand: unique symbol = Symbol("owned-local-file");
type LocalResource = { readonly [localResourceBrand]: true; file: File; url: string | null; error: string | null; loading: boolean };
type FileKind = "video" | "poster";
const limits = { video: 100 * 1024 * 1024, poster: 10 * 1024 * 1024 };
const allowed = { video: ["video/mp4", "video/webm"], poster: ["image/jpeg", "image/png", "image/webp"] };

function useLocalResource(kind: FileKind, onDraftChange: () => void) {
  const [resource, setResource] = useState<LocalResource | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const current = useRef<LocalResource | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (current.current?.url) URL.revokeObjectURL(current.current.url);
      current.current = null;
    };
  }, []);

  const release = () => {
    if (current.current?.url) URL.revokeObjectURL(current.current.url);
    current.current = null;
  };
  const open = (file: File) => {
    release();
    let next: LocalResource;
    try {
      const url = URL.createObjectURL(file);
      if (!url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
        throw new Error("ObjectURL indisponível");
      }
      next = { [localResourceBrand]: true, file, url, loading: true, error: null };
    } catch {
      next = { [localResourceBrand]: true, file, url: null, loading: false, error: "Não foi possível criar a prévia." };
    }
    current.current = next;
    setResource(next);
  };
  const select = (file: File | undefined) => {
    if (!file) return;
    onDraftChange();
    release();
    setResource(null);
    const error = !file.size ? "O arquivo está vazio."
      : !allowed[kind].includes(file.type) ? kind === "video" ? "Escolha um vídeo MP4 ou WebM." : "Escolha uma capa JPEG, PNG ou WebP."
      : file.size > limits[kind] ? `O arquivo excede o limite de arquivo de ${kind === "video" ? 100 : 10} MiB.` : null;
    setValidationError(error);
    if (!error) open(file);
  };
  const remove = () => {
    onDraftChange(); release(); setResource(null); setValidationError(null);
  };
  const retry = () => {
    const file = current.current?.file;
    if (file) { onDraftChange(); open(file); }
  };
  const settle = (source: LocalResource, failed: boolean) => {
    if (!active.current || current.current !== source) return;
    const next = { ...source, loading: false, error: failed ? kind === "video" ? "Não foi possível reproduzir o vídeo." : "Não foi possível exibir a capa." : null };
    current.current = next; setResource(next);
  };
  return { resource, validationError, select, remove, retry, settle };
}

type LocalFileState = ReturnType<typeof useLocalResource>;

/** Recebe apenas recursos que este módulo cria a partir de File; não aceita URL externa. */
export function TikTokVideoPreview({ video, poster, caption }: { video: LocalFileState; poster: LocalFileState; caption: string }) {
  const source = video.resource?.[localResourceBrand] ? video.resource : null;
  const cover = poster.resource?.[localResourceBrand] ? poster.resource : null;
  return <section aria-label="Prévia da publicação TikTok" className="tiktok-preview">
    <h3 className="tiktok-preview-heading"><ChannelBadge code="TT" small />Prévia da publicação</h3>
    <div className="tiktok-preview-frame">
      {source?.url && !source.error ? <video
        controls key={source.url} preload="metadata" src={source.url}
        poster={cover?.error ? undefined : cover?.url ?? undefined}
        onLoadedMetadata={() => video.settle(source, false)} onError={() => video.settle(source, true)}
      /> : <p>{source?.error ? "Prévia indisponível" : "Selecione um vídeo para visualizar."}</p>}
      {source?.loading && <p className="tiktok-loading" role="status">Carregando vídeo...</p>}
    </div>
    <p className="tiktok-caption">{caption || "Sua legenda aparecerá aqui."}</p>
    <small>Prévia em 9:16. O arquivo original não será alterado.</small>
  </section>;
}

function TikTokDraft({ onDraftChange, selected }: { onDraftChange: () => void; selected: boolean }) {
  const [caption, setCaption] = useState("");
  const video = useLocalResource("video", onDraftChange);
  const poster = useLocalResource("poster", onDraftChange);
  return <div className="tiktok-local-grid">
    <fieldset className="tiktok-editor-fields" disabled={!selected}>
      <legend className="tiktok-editor-heading">Vídeo e legenda</legend>
      <span className="field-label">Vídeo</span>
      <label className="tiktok-file-picker">Selecionar vídeo<input aria-label="Vídeo TikTok" accept="video/mp4,video/webm" type="file" onChange={(event) => { video.select(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <small>MP4 ou WebM · até 100 MiB por arquivo.</small>
      {video.resource && <><p className="tiktok-file-name">{video.resource.file.name}</p><button className="secondary-button" type="button" onClick={video.remove}>Remover vídeo TikTok</button></>}
      {video.validationError && <p role="alert">{video.validationError}</p>}
      {video.resource?.error && <><p role="alert">{video.resource.error}</p><button type="button" onClick={video.retry}>Tentar novamente vídeo TikTok</button></>}
      <span className="field-label">Capa <span className="tiktok-optional">(opcional)</span></span>
      <label className="tiktok-file-picker">Selecionar capa<input aria-label="Capa TikTok" accept="image/jpeg,image/png,image/webp" type="file" onChange={(event) => { poster.select(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <small>JPEG, PNG ou WebP · até 10 MiB por arquivo.</small>
      {poster.resource && <><p className="tiktok-file-name">{poster.resource.file.name}</p><button className="secondary-button" type="button" onClick={poster.remove}>Remover capa TikTok</button></>}
      {poster.validationError && <p role="alert">{poster.validationError}</p>}
      {poster.resource?.url && !poster.resource.error && <img className="tiktok-cover-check" alt="Capa TikTok" key={poster.resource.url} src={poster.resource.url} onLoad={() => { if (poster.resource) poster.settle(poster.resource, false); }} onError={() => { if (poster.resource) poster.settle(poster.resource, true); }} />}
      {poster.resource?.loading && <p role="status">Carregando capa...</p>}
      {poster.resource?.error && <><p role="alert">{poster.resource.error}</p><button type="button" onClick={poster.retry}>Tentar novamente capa TikTok</button></>}
      <label className="field-label">Legenda<textarea aria-label="Legenda TikTok" value={caption} onChange={(event) => { onDraftChange(); setCaption(event.target.value); }} /><small>{caption.length} caracteres</small></label>
    </fieldset>
    <TikTokVideoPreview video={video} poster={poster} caption={caption} />
  </div>;
}

export function TikTokLocalComposer({ onDraftChange, selected }: { onDraftChange: () => void; selected: boolean }) {
  return <section className="tiktok-local" aria-label="Editor TikTok">
    <TikTokDraft key={selected ? "selected" : "unselected"} selected={selected} onDraftChange={onDraftChange} />
  </section>;
}
