import { StrictMode, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../../../shared/mediaContract";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import { useComposerMedia } from "./useComposerMedia";

const assetA: MediaAsset = {
  createdAt: "2026-09-25T12:00:00.000Z", durationMs: null, height: null,
  id: "70000000-0000-4000-8000-000000000001", mediaType: "image", mimeType: "image/jpeg",
  originalFilename: "A.jpg", sizeBytes: 10,
  tenantId: "70000000-0000-4000-8000-000000000002", updatedAt: "2026-09-25T12:00:00.000Z",
  uploadedByUserId: "70000000-0000-4000-8000-000000000003", width: null,
};
const assetB: MediaAsset = { ...assetA, id: "70000000-0000-4000-8000-000000000004", originalFilename: "B.jpg" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function repository(overrides: Partial<MediaAssetsRepository> = {}): MediaAssetsRepository {
  return {
    list: vi.fn().mockResolvedValue([]),
    upload: vi.fn().mockResolvedValue(assetA),
    contentUrl: vi.fn((id: string) => `https://api.test/media-assets/${id}/content`),
    ...overrides,
  };
}

function mockObjectUrls() {
  const createObjectURL = vi.fn().mockReturnValue("blob:preview");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
  return { createObjectURL, revokeObjectURL };
}

describe("useComposerMedia", () => {
  it("compartilha listagem pendente no StrictMode, seleciona e remove uma mídia", async () => {
    const list = deferred<MediaAsset[]>();
    const source = repository({ list: vi.fn().mockReturnValue(list.promise) });
    const onDraftChange = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useComposerMedia({ repository: source, workspaceId: "workspace-a", onDraftChange }), { wrapper });
    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
    await act(async () => list.resolve([assetA]));
    expect(result.current.mediaAssets).toEqual([assetA]);
    act(() => result.current.selectMedia(assetA));
    expect(result.current.selectedMediaAsset).toEqual(assetA);
    expect(result.current.preview).toEqual({ mediaType: "image", src: `https://api.test/media-assets/${assetA.id}/content` });
    act(() => result.current.clearSelection());
    expect(result.current.selectedMediaAsset).toBeNull();
    expect(onDraftChange).toHaveBeenCalledTimes(2);
  });

  it("mostra preview local durante upload, seleciona resultado e revoga Object URL", async () => {
    const { createObjectURL, revokeObjectURL } = mockObjectUrls();
    const upload = deferred<MediaAsset>();
    const source = repository({ upload: vi.fn().mockReturnValue(upload.promise) });
    const { result, unmount } = renderHook(() => useComposerMedia({ repository: source, workspaceId: "workspace-a", onDraftChange: vi.fn() }));
    const file = new File(["imagem"], "nova.jpg", { type: "image/jpeg" });
    let promise!: Promise<void>;
    act(() => { promise = result.current.uploadFile(file); });
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(result.current.isUploadingMedia).toBe(true);
    expect(result.current.preview).toEqual({ mediaType: "image", src: "blob:preview" });
    await act(async () => { upload.resolve(assetA); await promise; });
    expect(result.current.isUploadingMedia).toBe(false);
    expect(result.current.selectedMediaAsset?.id).toBe(assetA.id);
    expect(result.current.mediaAssets.map((item) => item.id)).toEqual([assetA.id]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it("trocar de arquivo revoga preview anterior e ignora o upload ultrapassado", async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce("blob:primeiro").mockReturnValueOnce("blob:segundo");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const first = deferred<MediaAsset>();
    const second = deferred<MediaAsset>();
    const source = repository({ upload: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise) });
    const { result, unmount } = renderHook(() => useComposerMedia({ repository: source, workspaceId: "workspace-a", onDraftChange: vi.fn() }));
    await waitFor(() => expect(result.current.isLoadingMedia).toBe(false));
    let firstPending!: Promise<void>;
    let secondPending!: Promise<void>;
    act(() => { firstPending = result.current.uploadFile(new File(["a"], "A.jpg", { type: "image/jpeg" })); });
    act(() => { secondPending = result.current.uploadFile(new File(["b"], "B.jpg", { type: "image/jpeg" })); });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:primeiro");
    expect(result.current.preview?.src).toBe("blob:segundo");
    await act(async () => { first.resolve(assetA); await firstPending; });
    expect(result.current.isUploadingMedia).toBe(true);
    await act(async () => { second.resolve(assetB); await secondPending; });
    expect(result.current.selectedMediaAsset?.id).toBe(assetB.id);
    expect(result.current.mediaAssets.map((item) => item.id)).toEqual([assetB.id]);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:segundo");
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("revoga preview temporário ao desmontar durante upload", () => {
    const { revokeObjectURL } = mockObjectUrls();
    const source = repository({ upload: vi.fn().mockReturnValue(new Promise<MediaAsset>(() => undefined)) });
    const { result, unmount } = renderHook(() => useComposerMedia({ repository: source, workspaceId: "workspace-a", onDraftChange: vi.fn() }));
    act(() => { void result.current.uploadFile(new File(["a"], "A.jpg", { type: "image/jpeg" })); });
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("listagem pendente não remove mídia enviada primeiro", async () => {
    mockObjectUrls();
    const list = deferred<MediaAsset[]>();
    const source = repository({ list: vi.fn().mockReturnValue(list.promise), upload: vi.fn().mockResolvedValue(assetA) });
    const { result } = renderHook(() => useComposerMedia({ repository: source, workspaceId: "workspace-a", onDraftChange: vi.fn() }));
    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.uploadFile(new File(["a"], "A.jpg", { type: "image/jpeg" })); });
    await act(async () => list.resolve([]));
    expect(result.current.mediaAssets.map((item) => item.id)).toEqual([assetA.id]);
  });

  it("ignora upload antigo após troca de Workspace", async () => {
    mockObjectUrls();
    const upload = deferred<MediaAsset>();
    const source = repository({ upload: vi.fn().mockReturnValue(upload.promise) });
    const onDraftChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useComposerMedia({ repository: source, workspaceId, onDraftChange }),
      { initialProps: { workspaceId: "workspace-a" } },
    );
    await waitFor(() => expect(result.current.isLoadingMedia).toBe(false));
    let promise!: Promise<void>;
    act(() => { promise = result.current.uploadFile(new File(["a"], "A.jpg", { type: "image/jpeg" })); });
    rerender({ workspaceId: "workspace-b" });
    await act(async () => { upload.resolve(assetA); await promise; });
    expect(result.current.mediaAssets).toEqual([]);
    expect(result.current.selectedMediaAsset).toBeNull();
    expect(result.current.preview).toBeNull();
  });

  it("ignora resposta de listagem antiga após troca de Workspace", async () => {
    const listA = deferred<MediaAsset[]>();
    const listB = deferred<MediaAsset[]>();
    const source = repository({ list: vi.fn().mockReturnValueOnce(listA.promise).mockReturnValueOnce(listB.promise) });
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useComposerMedia({ repository: source, workspaceId, onDraftChange: vi.fn() }),
      { initialProps: { workspaceId: "workspace-a" } },
    );
    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
    rerender({ workspaceId: "workspace-b" });
    await act(async () => listA.resolve([assetA]));
    expect(result.current.mediaAssets).toEqual([]);
    await act(async () => listB.resolve([assetB]));
    expect(result.current.mediaAssets).toEqual([assetB]);
  });

  it("falha de upload mantém seleção anterior e permite retry de listagem", async () => {
    const { revokeObjectURL } = mockObjectUrls();
    const upload = deferred<MediaAsset>();
    const source = repository({ list: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([assetA]), upload: vi.fn().mockReturnValue(upload.promise) });
    const { result } = renderHook(() => useComposerMedia({ repository: source, workspaceId: "workspace-a", onDraftChange: vi.fn() }));
    await waitFor(() => expect(result.current.error).toContain("biblioteca"));
    act(() => result.current.retryList());
    await waitFor(() => expect(result.current.mediaAssets).toEqual([assetA]));
    act(() => result.current.selectMedia(assetA));
    let promise!: Promise<void>;
    act(() => { promise = result.current.uploadFile(new File(["b"], "B.jpg", { type: "image/jpeg" })); });
    await act(async () => { upload.reject(new Error("offline")); await promise; });
    expect(result.current.selectedMediaAsset).toEqual(assetA);
    expect(result.current.preview?.src).toContain(assetA.id);
    expect(result.current.error).toBe("Não foi possível enviar esta mídia.");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
