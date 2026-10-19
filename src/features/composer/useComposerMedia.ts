import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { MediaAsset, MediaType } from "../../../shared/mediaContract";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";

export type ComposerMediaPreview = { mediaType: MediaType; src: string } | null;

type MediaState = {
  workspaceId: string;
  error: string | null;
  isLoadingMedia: boolean;
  isUploadingMedia: boolean;
  mediaAssets: MediaAsset[];
  selectedMediaAsset: MediaAsset | null;
  selectedMediaAssetId: string | null;
  temporaryPreview: ComposerMediaPreview;
};

const pendingLists = new WeakMap<MediaAssetsRepository, Map<string, Promise<MediaAsset[]>>>();

function listWhilePending(repository: MediaAssetsRepository, workspaceId: string): Promise<MediaAsset[]> {
  let byWorkspace = pendingLists.get(repository);
  if (!byWorkspace) {
    byWorkspace = new Map();
    pendingLists.set(repository, byWorkspace);
  }
  const existing = byWorkspace.get(workspaceId);
  if (existing) return existing;
  const pending = repository.list();
  byWorkspace.set(workspaceId, pending);
  void pending.then(
    () => { if (byWorkspace.get(workspaceId) === pending) byWorkspace.delete(workspaceId); },
    () => { if (byWorkspace.get(workspaceId) === pending) byWorkspace.delete(workspaceId); },
  );
  return pending;
}

function blankState(workspaceId: string, initialMediaAssetId: string | null = null): MediaState {
  return {
    workspaceId,
    error: null,
    isLoadingMedia: true,
    isUploadingMedia: false,
    mediaAssets: [],
    selectedMediaAsset: null,
    selectedMediaAssetId: initialMediaAssetId,
    temporaryPreview: null,
  };
}

function mergeAssets(listed: MediaAsset[], existing: MediaAsset[]): MediaAsset[] {
  const seen = new Set<string>();
  return [...existing, ...listed].filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

export function useComposerMedia({ repository, workspaceId, onDraftChange, initialMediaAssetId = null }: {
  repository: MediaAssetsRepository;
  workspaceId: string;
  onDraftChange: () => void;
  initialMediaAssetId?: string | null;
}) {
  const readInitialSelection = useEffectEvent(() => initialMediaAssetId);
  const [state, setState] = useState<MediaState>(() => blankState(workspaceId, initialMediaAssetId));
  const generation = useRef(0);
  const listVersion = useRef(0);
  const uploadVersion = useRef(0);
  const temporaryUrl = useRef<string | null>(null);

  const revokeTemporaryUrl = useCallback(() => {
    if (!temporaryUrl.current) return;
    URL.revokeObjectURL(temporaryUrl.current);
    temporaryUrl.current = null;
  }, []);

  const load = useCallback((activeGeneration: number) => {
    const version = ++listVersion.current;
    setState((current) => current.workspaceId === workspaceId
      ? { ...current, isLoadingMedia: true, error: null }
      : current);
    void listWhilePending(repository, workspaceId).then(
      (listed) => {
        if (generation.current !== activeGeneration || listVersion.current !== version) return;
        setState((current) => {
          if (current.workspaceId !== workspaceId) return current;
          const mediaAssets = mergeAssets(listed, current.mediaAssets);
          return { ...current, error: null, isLoadingMedia: false, mediaAssets,
            selectedMediaAsset: mediaAssets.find((asset) => asset.id === current.selectedMediaAssetId) ?? null };
        });
      },
      () => {
        if (generation.current !== activeGeneration || listVersion.current !== version) return;
        setState((current) => current.workspaceId === workspaceId ? {
          ...current,
          error: "Não foi possível carregar sua biblioteca de mídia.",
          isLoadingMedia: false,
        } : current);
      },
    );
  }, [repository, workspaceId]);

  useEffect(() => {
    const initialId = readInitialSelection();
    const activeGeneration = ++generation.current;
    ++uploadVersion.current;
    revokeTemporaryUrl();
    queueMicrotask(() => {
      if (generation.current !== activeGeneration) return;
      setState(blankState(workspaceId, initialId));
      load(activeGeneration);
    });
    return () => {
      generation.current = activeGeneration + 1;
      revokeTemporaryUrl();
    };
  }, [load, revokeTemporaryUrl, workspaceId]);

  const retryList = useCallback(() => load(generation.current), [load]);

  const clearSelection = useCallback(() => {
    ++uploadVersion.current;
    revokeTemporaryUrl();
    setState((current) => current.workspaceId === workspaceId ? {
      ...current,
      isUploadingMedia: false,
      selectedMediaAsset: null,
      selectedMediaAssetId: null,
      temporaryPreview: null,
    } : current);
    onDraftChange();
  }, [onDraftChange, revokeTemporaryUrl, workspaceId]);

  const selectMedia = useCallback((asset: MediaAsset) => {
    ++uploadVersion.current;
    revokeTemporaryUrl();
    setState((current) => {
      if (current.workspaceId !== workspaceId) return current;
      const selected = current.mediaAssets.find((item) => item.id === asset.id);
      if (!selected) return current;
      return { ...current, isUploadingMedia: false, selectedMediaAsset: selected, selectedMediaAssetId: selected.id, temporaryPreview: null };
    });
    onDraftChange();
  }, [onDraftChange, revokeTemporaryUrl, workspaceId]);

  const uploadFile = useCallback(async (file: File): Promise<void> => {
    const activeGeneration = generation.current;
    const version = ++uploadVersion.current;
    revokeTemporaryUrl();
    const src = URL.createObjectURL(file);
    temporaryUrl.current = src;
    const mediaType: MediaType = file.type.startsWith("video/") ? "video" : "image";
    setState((current) => current.workspaceId === workspaceId ? {
      ...current,
      error: null,
      isUploadingMedia: true,
      temporaryPreview: { mediaType, src },
    } : current);
    onDraftChange();
    try {
      const uploaded = await repository.upload(file);
      if (generation.current !== activeGeneration || uploadVersion.current !== version) return;
      revokeTemporaryUrl();
      setState((current) => current.workspaceId === workspaceId ? {
        ...current,
        error: null,
        isUploadingMedia: false,
        mediaAssets: [uploaded, ...current.mediaAssets.filter((item) => item.id !== uploaded.id)],
        selectedMediaAsset: uploaded,
        selectedMediaAssetId: uploaded.id,
        temporaryPreview: null,
      } : current);
      onDraftChange();
    } catch {
      if (generation.current !== activeGeneration || uploadVersion.current !== version) return;
      revokeTemporaryUrl();
      setState((current) => current.workspaceId === workspaceId ? {
        ...current,
        error: "Não foi possível enviar esta mídia.",
        isUploadingMedia: false,
        temporaryPreview: null,
      } : current);
    }
  }, [onDraftChange, repository, revokeTemporaryUrl, workspaceId]);

  const visible = state.workspaceId === workspaceId ? state : blankState(workspaceId);
  const preview = visible.temporaryPreview ?? (visible.selectedMediaAsset ? {
    mediaType: visible.selectedMediaAsset.mediaType,
    src: repository.contentUrl(visible.selectedMediaAsset.id),
  } : null);

  return {
    error: visible.error,
    isLoadingMedia: visible.isLoadingMedia,
    isUploadingMedia: visible.isUploadingMedia,
    mediaAssets: visible.mediaAssets,
    preview,
    selectedMediaAsset: visible.selectedMediaAsset,
    selectedMediaAssetId: visible.selectedMediaAssetId,
    initialSelectionUnavailable: !visible.isLoadingMedia && visible.selectedMediaAssetId !== null && visible.selectedMediaAsset === null,
    clearSelection,
    retryList,
    selectMedia,
    uploadFile,
  };
}
