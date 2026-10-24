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
      next = { [localResourceBrand]: true, file, url: null, loading: false, error: "Não foi possível criar a prévia local." };
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
      : file.size > limits[kind] ? `O arquivo excede o limite local de segurança de ${kind === "video" ? 100 : 10} MiB.` : null;
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
    const next = { ...source, loading: false, error: failed ? kind === "video" ? "Não foi possível reproduzir o vídeo local." : "Não foi possível exibir a capa local." : null };
    current.current = next; setResource(next);
  };
  return { resource, validationError, select, remove, retry, settle };
}

type LocalFileState = ReturnType<typeof useLocalResource>;

/** Recebe apenas recursos que este módulo cria a partir de File; não aceita URL externa. */
export function TikTokVideoPreview({ video, poster, caption }: { video: LocalFileState; poster: LocalFileState; caption: string }) {
  const source = video.resource?.[localResourceBrand] ? video.resource : null;
  const cover = poster.resource?.[localResourceBrand] ? poster.resource : null;
  return <section aria-label="Prévia TikTok local" className="tiktok-preview">
    <h3 className="tiktok-preview-heading"><ChannelBadge code="TT" small />Prévia TikTok</h3>
    <div className="tiktok-preview-frame">
      {source?.url && !source.error ? <video
        controls key={source.url} preload="metadata" src={source.url}
        poster={cover?.error ? undefined : cover?.url ?? undefined}
        onLoadedMetadata={() => video.settle(source, false)} onError={() => video.settle(source, true)}
      /> : <p>{source?.error ? "Prévia indisponível" : "Escolha um vídeo local para visualizar."}</p>}
      {source?.loading && <p className="tiktok-loading" role="status">Carregando vídeo local...</p>}
    </div>
    <p className="tiktok-caption">{caption || "Sua legenda TikTok local aparecerá aqui."}</p>
    <small>Enquadramento 9:16 apenas na prévia: não converte o vídeo nem comprova requisitos do TikTok.</small>
  </section>;
}

function TikTokDraft({ onDraftChange }: { onDraftChange: () => void }) {
  const [caption, setCaption] = useState("");
  const video = useLocalResource("video", onDraftChange);
  const poster = useLocalResource("poster", onDraftChange);
  return <div className="tiktok-local-grid">
    <div>
      <label className="field-label">Vídeo TikTok local<input accept="video/mp4,video/webm" type="file" onChange={(event) => { video.select(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <small>MP4 / WebM · teto LOCAL de segurança: 100 MiB. Não é um limite oficial do TikTok.</small>
      {video.resource && <><p className="tiktok-file-name">{video.resource.file.name}</p><button className="secondary-button" type="button" onClick={video.remove}>Remover vídeo TikTok</button></>}
      {video.validationError && <p role="alert">{video.validationError}</p>}
      {video.resource?.error && <><p role="alert">{video.resource.error}</p><button type="button" onClick={video.retry}>Tentar novamente vídeo TikTok</button></>}
      <label className="field-label">Capa TikTok local (opcional)<input accept="image/jpeg,image/png,image/webp" type="file" onChange={(event) => { poster.select(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <small>JPEG / PNG / WebP · teto LOCAL de segurança: 10 MiB, não oficial.</small>
      {poster.resource && <><p className="tiktok-file-name">{poster.resource.file.name}</p><button className="secondary-button" type="button" onClick={poster.remove}>Remover capa TikTok</button></>}
      {poster.validationError && <p role="alert">{poster.validationError}</p>}
      {poster.resource?.url && !poster.resource.error && <img className="tiktok-cover-check" alt="Capa TikTok local" key={poster.resource.url} src={poster.resource.url} onLoad={() => { if (poster.resource) poster.settle(poster.resource, false); }} onError={() => { if (poster.resource) poster.settle(poster.resource, true); }} />}
      {poster.resource?.loading && <p role="status">Carregando capa local...</p>}
      {poster.resource?.error && <><p role="alert">{poster.resource.error}</p><button type="button" onClick={poster.retry}>Tentar novamente capa TikTok</button></>}
      <label className="field-label">Legenda TikTok local<textarea aria-label="Legenda TikTok local" value={caption} onChange={(event) => { onDraftChange(); setCaption(event.target.value); }} /><small>{caption.length} caracteres · somente neste compositor</small></label>
    </div>
    <TikTokVideoPreview video={video} poster={poster} caption={caption} />
  </div>;
}

export function TikTokLocalComposer({ metaSelected, onDraftChange, selected, onSelect }: { metaSelected: boolean; onDraftChange: () => void; selected: boolean; onSelect: (selected: boolean) => void }) {
  return <section className="tiktok-local panel" aria-label="Compositor TikTok local">
    <label className="tiktok-local-toggle"><input aria-label="TikTok — prévia local" type="checkbox" checked={selected} onChange={(event) => { onDraftChange(); onSelect(event.target.checked); }} /><ChannelBadge code="TT" small />TikTok — prévia local</label>
    <p>Não conectado. Arquivos e legenda ficam somente em memória; fechar, desmarcar ou trocar de Workspace descarta esta prévia. Nada é salvo ou enviado ao TikTok.</p>
    {selected && <>
      <p className="tiktok-notice">{metaSelected ? "Somente Facebook e Instagram serão enviados, com a legenda e a mídia Meta. O rascunho TikTok não é publicado, agendado ou persistido, nem conta como sucesso TikTok." : "Publicação e agendamento TikTok bloqueados. Selecione um destino Meta e preencha sua legenda Meta para publicar; aqui é apenas uma prévia local."}</p>
      <TikTokDraft onDraftChange={onDraftChange} />
    </>}
  </section>;
}
