import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { SocialAccount } from "../../../shared/socialAccountContract";
import { requiredPublishingScopes } from "../../../shared/publicationPolicy";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";

export type ComposerDestinationsState = {
  error: string | null;
  accounts: SocialAccount[];
  reconnectionRequired: boolean;
  isLoading: boolean;
  selectedIds: string[];
  unavailableSelectedIds: string[];
  toggle(id: string): void;
};

type DestinationState = Omit<ComposerDestinationsState, "toggle" | "unavailableSelectedIds"> & { workspaceId: string };

function blankState(workspaceId: string, initialSelectedIds: readonly string[] = []): DestinationState {
  return { workspaceId, error: null, accounts: [], reconnectionRequired: false, isLoading: true, selectedIds: [...initialSelectedIds] };
}

function eligible(account: SocialAccount): boolean {
  return (account.provider === "facebook" || account.provider === "instagram")
    && account.status === "connected"
    && requiredPublishingScopes(account.provider).every((scope) => account.scopes.includes(scope))
    && (account.tokenExpiresAt === null || Date.parse(account.tokenExpiresAt) > Date.now());
}

function publicAccount(account: SocialAccount): SocialAccount {
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

export function useComposerDestinations({ repository, workspaceId, initialSelectedIds }: {
  repository: SocialAccountsRepository;
  workspaceId: string;
  initialSelectedIds?: readonly string[];
}): ComposerDestinationsState {
  const readInitialSelection = useEffectEvent(() => initialSelectedIds);
  const [state, setState] = useState<DestinationState>(() => blankState(workspaceId, initialSelectedIds));
  const generation = useRef(0);

  useEffect(() => {
    const initialIds = readInitialSelection();
    const activeGeneration = ++generation.current;
    queueMicrotask(() => {
      if (generation.current === activeGeneration) setState(blankState(workspaceId, initialIds));
    });
    void Promise.resolve().then(() => repository.list(workspaceId)).then(
      (accounts) => {
        if (generation.current !== activeGeneration) return;
        setState((current) => current.workspaceId === workspaceId ? {
          ...current,
          error: null,
          accounts: accounts.filter(eligible).map(publicAccount),
          reconnectionRequired: accounts.some((account) => (account.provider === "facebook" || account.provider === "instagram")
            && account.status !== "pending" && !eligible(account)),
          isLoading: false,
        } : current);
      },
      () => {
        if (generation.current !== activeGeneration) return;
        setState((current) => current.workspaceId === workspaceId ? {
          ...current,
          error: "Não foi possível carregar as contas conectadas.",
          accounts: [],
          reconnectionRequired: false,
          isLoading: false,
          selectedIds: current.selectedIds,
        } : current);
      },
    );
    return () => { generation.current = activeGeneration + 1; };
  }, [repository, workspaceId]);

  const toggle = useCallback((id: string) => {
    setState((current) => {
      if (current.workspaceId !== workspaceId || (!current.selectedIds.includes(id) && !current.accounts.some((account) => account.id === id))) return current;
      return { ...current, selectedIds: current.selectedIds.includes(id)
        ? current.selectedIds.filter((selectedId) => selectedId !== id)
        : [...current.selectedIds, id] };
    });
  }, [workspaceId]);

  const visible = state.workspaceId === workspaceId ? state : blankState(workspaceId);
  return {
    error: visible.error,
    accounts: visible.accounts,
    reconnectionRequired: visible.reconnectionRequired,
    isLoading: visible.isLoading,
    selectedIds: visible.selectedIds,
    unavailableSelectedIds: visible.selectedIds.filter((id) => !visible.accounts.some((account) => account.id === id)),
    toggle,
  };
}
