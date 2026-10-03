import { useCallback, useEffect, useRef, useState } from "react";
import type { SocialAccount } from "../../../shared/socialAccountContract";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";

export type ComposerDestinationsState = {
  error: string | null;
  facebookPages: SocialAccount[];
  isLoading: boolean;
  selectedIds: string[];
  toggle(id: string): void;
};

type DestinationState = Omit<ComposerDestinationsState, "toggle"> & { workspaceId: string };

function blankState(workspaceId: string): DestinationState {
  return { workspaceId, error: null, facebookPages: [], isLoading: true, selectedIds: [] };
}

function publicPage(account: SocialAccount): SocialAccount {
  return {
    createdAt: account.createdAt,
    disconnectedAt: account.disconnectedAt,
    displayName: account.displayName,
    id: account.id,
    profileImageUrl: account.profileImageUrl,
    provider: account.provider,
    providerAccountId: account.providerAccountId,
    scopes: [...account.scopes],
    status: account.status,
    tokenExpiresAt: account.tokenExpiresAt,
    updatedAt: account.updatedAt,
    username: account.username,
  };
}

export function useComposerDestinations({ repository, workspaceId }: {
  repository: SocialAccountsRepository;
  workspaceId: string;
}): ComposerDestinationsState {
  const [state, setState] = useState<DestinationState>(() => blankState(workspaceId));
  const generation = useRef(0);

  useEffect(() => {
    const activeGeneration = ++generation.current;
    queueMicrotask(() => {
      if (generation.current === activeGeneration) setState(blankState(workspaceId));
    });
    void Promise.resolve().then(() => repository.list(workspaceId)).then(
      (accounts) => {
        if (generation.current !== activeGeneration) return;
        setState((current) => current.workspaceId === workspaceId ? {
          ...current,
          error: null,
          facebookPages: accounts
            .filter((account) => account.provider === "facebook" && account.status === "connected")
            .map(publicPage),
          isLoading: false,
        } : current);
      },
      () => {
        if (generation.current !== activeGeneration) return;
        setState((current) => current.workspaceId === workspaceId ? {
          ...current,
          error: "Não foi possível carregar as Pages conectadas.",
          facebookPages: [],
          isLoading: false,
          selectedIds: [],
        } : current);
      },
    );
    return () => { generation.current = activeGeneration + 1; };
  }, [repository, workspaceId]);

  const toggle = useCallback((id: string) => {
    setState((current) => {
      if (current.workspaceId !== workspaceId || !current.facebookPages.some((page) => page.id === id)) return current;
      return { ...current, selectedIds: current.selectedIds.includes(id)
        ? current.selectedIds.filter((selectedId) => selectedId !== id)
        : [...current.selectedIds, id] };
    });
  }, [workspaceId]);

  const visible = state.workspaceId === workspaceId ? state : blankState(workspaceId);
  return {
    error: visible.error,
    facebookPages: visible.facebookPages,
    isLoading: visible.isLoading,
    selectedIds: visible.selectedIds,
    toggle,
  };
}
