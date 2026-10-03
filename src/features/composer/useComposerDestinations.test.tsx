import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../shared/socialAccountContract";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";
import { useComposerDestinations } from "./useComposerDestinations";

const pageA: SocialAccount = {
  createdAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null, displayName: "Página A",
  id: "70000000-0000-4000-8000-000000000001", profileImageUrl: null,
  provider: "facebook", providerAccountId: "page-a", scopes: ["pages_manage_posts"],
  status: "connected", tokenExpiresAt: null, updatedAt: "2026-09-25T12:00:00.000Z", username: null,
};
const pageB: SocialAccount = { ...pageA, id: "70000000-0000-4000-8000-000000000002", displayName: "Página B", providerAccountId: "page-b" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function repository(list: SocialAccountsRepository["list"]): SocialAccountsRepository {
  return {
    list,
    get: vi.fn(),
    disconnect: vi.fn(),
    update: vi.fn(),
    startMetaOAuth: vi.fn(),
  };
}

describe("useComposerDestinations", () => {
  it("mostra somente Facebook connected e alterna várias Pages", async () => {
    const disconnected = { ...pageA, id: "expired", status: "expired" as const };
    const instagram = { ...pageA, id: "instagram", provider: "instagram" as const };
    const source = repository(vi.fn().mockResolvedValue([pageA, disconnected, instagram, pageB]));
    const { result } = renderHook(() => useComposerDestinations({ repository: source, workspaceId: "workspace-a" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(source.list).toHaveBeenCalledWith("workspace-a");
    expect(result.current.facebookPages.map((page) => page.id)).toEqual([pageA.id, pageB.id]);
    act(() => { result.current.toggle(pageA.id); result.current.toggle(pageB.id); });
    expect(result.current.selectedIds).toEqual([pageA.id, pageB.id]);
    act(() => result.current.toggle(pageA.id));
    expect(result.current.selectedIds).toEqual([pageB.id]);
    act(() => { result.current.toggle(disconnected.id); result.current.toggle(instagram.id); result.current.toggle("unknown"); });
    expect(result.current.selectedIds).toEqual([pageB.id]);
    expect(source.startMetaOAuth).not.toHaveBeenCalled();
  });

  it("limpa Pages e seleção no render da troca de Workspace e ignora resposta antiga", async () => {
    const oldList = deferred<SocialAccount[]>();
    const newList = deferred<SocialAccount[]>();
    const source = repository(vi.fn().mockReturnValueOnce(oldList.promise).mockReturnValueOnce(newList.promise));
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useComposerDestinations({ repository: source, workspaceId }),
      { initialProps: { workspaceId: "workspace-a" } },
    );
    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
    rerender({ workspaceId: "workspace-b" });
    expect(result.current.facebookPages).toEqual([]);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    act(() => result.current.toggle(pageA.id));
    expect(result.current.selectedIds).toEqual([]);
    await waitFor(() => expect(source.list).toHaveBeenCalledWith("workspace-b"));
    await act(async () => oldList.resolve([pageA]));
    expect(result.current.facebookPages).toEqual([]);
    await act(async () => newList.resolve([pageB]));
    expect(result.current.facebookPages.map((page) => page.id)).toEqual([pageB.id]);
  });

  it("limpa seleção sincronamente após trocar de Workspace com Pages já carregadas", async () => {
    const source = repository(vi.fn().mockResolvedValue([pageA]));
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useComposerDestinations({ repository: source, workspaceId }),
      { initialProps: { workspaceId: "workspace-a" } },
    );
    await waitFor(() => expect(result.current.facebookPages).toHaveLength(1));
    act(() => result.current.toggle(pageA.id));
    expect(result.current.selectedIds).toEqual([pageA.id]);
    rerender({ workspaceId: "workspace-b" });
    expect(result.current.facebookPages).toEqual([]);
    expect(result.current.selectedIds).toEqual([]);
  });

  it("ignora erro de Workspace anterior após carregar Pages do atual", async () => {
    const oldList = deferred<SocialAccount[]>();
    const source = repository(vi.fn().mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([pageB]));
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useComposerDestinations({ repository: source, workspaceId }),
      { initialProps: { workspaceId: "workspace-a" } },
    );
    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
    rerender({ workspaceId: "workspace-b" });
    await waitFor(() => expect(result.current.facebookPages.map((page) => page.id)).toEqual([pageB.id]));
    await act(async () => oldList.reject(new Error("old failure")));
    expect(result.current.error).toBeNull();
    expect(result.current.facebookPages.map((page) => page.id)).toEqual([pageB.id]);
  });

  it("expõe falha atual e limpa Pages e seleção previamente carregadas", async () => {
    const first = repository(vi.fn().mockResolvedValue([pageA]));
    const failed = repository(vi.fn().mockRejectedValue(new Error("offline")));
    const { result, rerender } = renderHook(
      ({ source }) => useComposerDestinations({ repository: source, workspaceId: "workspace-a" }),
      { initialProps: { source: first } },
    );
    await waitFor(() => expect(result.current.facebookPages).toHaveLength(1));
    act(() => result.current.toggle(pageA.id));
    rerender({ source: failed });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.facebookPages).toEqual([]);
    expect(result.current.selectedIds).toEqual([]);
  });

  it("não introduz token no estado exposto mesmo se a fonte trouxer campo extra", async () => {
    const source = repository(vi.fn().mockResolvedValue([{ ...pageA, accessToken: "secret" }]));
    const { result } = renderHook(() => useComposerDestinations({ repository: source, workspaceId: "workspace-a" }));
    await waitFor(() => expect(result.current.facebookPages).toHaveLength(1));
    expect(result.current.facebookPages[0]).not.toHaveProperty("accessToken");
    expect(result.current).not.toHaveProperty("accessToken");
    expect(source.startMetaOAuth).not.toHaveBeenCalled();
  });
});
