import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SocialAccount } from "../../../shared/socialAccountContract";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";
import { useComposerDestinations } from "./useComposerDestinations";

const pageA: SocialAccount = {
  createdAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null, displayName: "Página A",
  id: "70000000-0000-4000-8000-000000000001", profileImageUrl: null,
  provider: "facebook", providerAccountId: "page-a", scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
  status: "connected", tokenExpiresAt: null, updatedAt: "2026-09-25T12:00:00.000Z", username: null,
};
const pageB: SocialAccount = { ...pageA, id: "70000000-0000-4000-8000-000000000002", displayName: "Página B", providerAccountId: "page-b" };
const instagram: SocialAccount = {
  ...pageA, id: "70000000-0000-4000-8000-000000000003", provider: "instagram", username: "perfil.a",
  scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"],
};

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
  it("retains ineligible and missing initial selections for explicit removal, without enabling them as choices", async () => {
    const source = repository(vi.fn().mockResolvedValue([{ ...pageA, status: "expired" }, pageB]));
    const { result, rerender } = renderHook(({ initialSelectedIds }) => useComposerDestinations({ repository: source, workspaceId: "workspace-a", initialSelectedIds }),
      { initialProps: { initialSelectedIds: [pageA.id, "missing"] } });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.accounts).toEqual([pageB]);
    expect(result.current.selectedIds).toEqual([pageA.id, "missing"]);
    expect(result.current.unavailableSelectedIds).toEqual([pageA.id, "missing"]);
    act(() => result.current.toggle(pageA.id));
    act(() => result.current.toggle("missing"));
    rerender({ initialSelectedIds: [pageA.id] });
    expect(result.current.selectedIds).toEqual([]);
    act(() => result.current.toggle(pageA.id));
    expect(result.current.selectedIds).toEqual([]);
  });

  it("does not discard the initial IDs when listing fails", async () => {
    const source = repository(vi.fn().mockRejectedValue(new Error("offline")));
    const { result } = renderHook(() => useComposerDestinations({ repository: source, workspaceId: "workspace-a", initialSelectedIds: [pageA.id] }));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.selectedIds).toEqual([pageA.id]);
    act(() => result.current.toggle(pageA.id));
    expect(result.current.selectedIds).toEqual([]);
  });

  it("lista Facebook e Instagram elegíveis e alterna seleção mista", async () => {
    const disconnected = { ...pageA, id: "expired", status: "expired" as const };
    const source = repository(vi.fn().mockResolvedValue([pageA, disconnected, instagram, pageB]));
    const { result } = renderHook(() => useComposerDestinations({ repository: source, workspaceId: "workspace-a" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(source.list).toHaveBeenCalledWith("workspace-a");
    expect(result.current.accounts).toEqual([pageA, instagram, pageB]);
    act(() => { result.current.toggle(pageA.id); result.current.toggle(instagram.id); });
    expect(result.current.selectedIds).toEqual([pageA.id, instagram.id]);
    act(() => result.current.toggle(pageA.id));
    expect(result.current.selectedIds).toEqual([instagram.id]);
    act(() => { result.current.toggle(disconnected.id); result.current.toggle("unknown"); });
    expect(result.current.selectedIds).toEqual([instagram.id]);
    expect(source.startMetaOAuth).not.toHaveBeenCalled();
  });

  it("exclui provider, status, scopes e expiração inelegíveis sem iniciar OAuth", async () => {
    const excluded: SocialAccount[] = [
      { ...pageA, id: "tiktok", provider: "tiktok" },
      ...(["expired", "revoked", "pending", "error"] as const).map((status) => ({ ...pageA, id: status, status })),
      { ...pageA, id: "missing-fb", scopes: ["pages_manage_posts"] },
      { ...instagram, id: "missing-ig", scopes: ["instagram_basic"] },
      { ...instagram, id: "expired-token", tokenExpiresAt: "2000-01-01T00:00:00.000Z" },
      { ...pageA, id: "invalid-expiry", tokenExpiresAt: "invalid" },
    ];
    const source = repository(vi.fn().mockResolvedValue([...excluded, instagram, pageA]));
    const { result } = renderHook(() => useComposerDestinations({ repository: source, workspaceId: "workspace-a" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.accounts).toEqual([instagram, pageA]);
    expect(result.current.reconnectionRequired).toBe(true);
    act(() => excluded.forEach((account) => result.current.toggle(account.id)));
    expect(result.current.selectedIds).toEqual([]);
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
    expect(result.current.accounts).toEqual([]);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    act(() => result.current.toggle(pageA.id));
    expect(result.current.selectedIds).toEqual([]);
    await waitFor(() => expect(source.list).toHaveBeenCalledWith("workspace-b"));
    await act(async () => oldList.resolve([pageA]));
    expect(result.current.accounts).toEqual([]);
    await act(async () => newList.resolve([pageB]));
    expect(result.current.accounts).toEqual([pageB]);
  });

  it("limpa seleção sincronamente após trocar de Workspace com Pages já carregadas", async () => {
    const source = repository(vi.fn().mockResolvedValue([pageA]));
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useComposerDestinations({ repository: source, workspaceId }),
      { initialProps: { workspaceId: "workspace-a" } },
    );
    await waitFor(() => expect(result.current.accounts).toHaveLength(1));
    act(() => result.current.toggle(pageA.id));
    expect(result.current.selectedIds).toEqual([pageA.id]);
    rerender({ workspaceId: "workspace-b" });
    expect(result.current.accounts).toEqual([]);
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
    await waitFor(() => expect(result.current.accounts).toEqual([pageB]));
    await act(async () => oldList.reject(new Error("old failure")));
    expect(result.current.error).toBeNull();
    expect(result.current.accounts).toEqual([pageB]);
  });

  it("expõe falha atual e limpa Pages e seleção previamente carregadas", async () => {
    const first = repository(vi.fn().mockResolvedValue([pageA]));
    const failed = repository(vi.fn().mockRejectedValue(new Error("offline")));
    const { result, rerender } = renderHook(
      ({ source }) => useComposerDestinations({ repository: source, workspaceId: "workspace-a" }),
      { initialProps: { source: first } },
    );
    await waitFor(() => expect(result.current.accounts).toHaveLength(1));
    act(() => result.current.toggle(pageA.id));
    rerender({ source: failed });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.accounts).toEqual([]);
    expect(result.current.selectedIds).toEqual([]);
  });

  it("não introduz token no estado exposto mesmo se a fonte trouxer campo extra", async () => {
    const source = repository(vi.fn().mockResolvedValue([{ ...pageA, accessToken: "secret" }]));
    const { result } = renderHook(() => useComposerDestinations({ repository: source, workspaceId: "workspace-a" }));
    await waitFor(() => expect(result.current.accounts).toHaveLength(1));
    expect(result.current.accounts[0]).not.toHaveProperty("accessToken");
    expect(result.current).not.toHaveProperty("accessToken");
    expect(source.startMetaOAuth).not.toHaveBeenCalled();
  });
});
