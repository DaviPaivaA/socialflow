import type {
  SocialAccount,
  UpdateSocialAccountInput,
} from "../../../shared/socialAccountContract";
import type { SocialAccountsRepository } from "./SocialAccountsRepository";

const DEFAULT_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

export const initialSocialAccounts: SocialAccount[] = [
  {
    createdAt: "2026-01-10T12:00:00.000Z",
    disconnectedAt: null,
    displayName: "Café Aurora",
    id: "70000000-0000-4000-8000-000000000001",
    profileImageUrl: null,
    provider: "instagram",
    providerAccountId: "instagram-cafe-aurora",
    scopes: ["instagram_basic"],
    status: "connected",
    tokenExpiresAt: "2027-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T12:00:00.000Z",
    username: "cafeaurora",
  },
  {
    createdAt: "2026-01-11T12:00:00.000Z",
    disconnectedAt: null,
    displayName: "Café Aurora",
    id: "70000000-0000-4000-8000-000000000002",
    profileImageUrl: null,
    provider: "facebook",
    providerAccountId: "facebook-cafe-aurora",
    scopes: ["pages_show_list"],
    status: "connected",
    tokenExpiresAt: "2027-01-11T12:00:00.000Z",
    updatedAt: "2026-01-11T12:00:00.000Z",
    username: "cafeaurora",
  },
  {
    createdAt: "2026-01-12T12:00:00.000Z",
    disconnectedAt: null,
    displayName: "Café Aurora",
    id: "70000000-0000-4000-8000-000000000003",
    profileImageUrl: null,
    provider: "tiktok",
    providerAccountId: "tiktok-cafe-aurora",
    scopes: [],
    status: "connected",
    tokenExpiresAt: "2027-01-12T12:00:00.000Z",
    updatedAt: "2026-01-12T12:00:00.000Z",
    username: "cafeaurora",
  },
];

function cloneAccount(account: SocialAccount): SocialAccount {
  return { ...account, scopes: [...account.scopes] };
}

export class MockSocialAccountsRepository
  implements SocialAccountsRepository
{
  private readonly accountsByWorkspace = new Map<string, SocialAccount[]>();

  constructor(
    seed: readonly SocialAccount[] = initialSocialAccounts,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ) {
    this.accountsByWorkspace.set(workspaceId, seed.map(cloneAccount));
  }

  async list(workspaceKey: string): Promise<SocialAccount[]> {
    return (this.accountsByWorkspace.get(workspaceKey) ?? []).map(cloneAccount);
  }

  async get(id: string, workspaceKey: string): Promise<SocialAccount> {
    const account = this.accountsByWorkspace
      .get(workspaceKey)
      ?.find((candidate) => candidate.id === id);
    if (!account) throw new Error("A conta social não foi encontrada.");
    return cloneAccount(account);
  }

  async update(
    id: string,
    input: UpdateSocialAccountInput,
    workspaceKey: string,
  ): Promise<SocialAccount> {
    const account = await this.get(id, workspaceKey);
    const updated = {
      ...account,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    const accounts = this.accountsByWorkspace.get(workspaceKey) ?? [];
    this.accountsByWorkspace.set(
      workspaceKey,
      accounts.map((candidate) => (candidate.id === id ? updated : candidate)),
    );
    return cloneAccount(updated);
  }

  async disconnect(id: string, workspaceKey: string): Promise<SocialAccount> {
    const account = await this.get(id, workspaceKey);
    const now = new Date().toISOString();
    const revoked: SocialAccount = {
      ...account,
      disconnectedAt: account.disconnectedAt ?? now,
      status: "revoked",
      updatedAt: now,
    };
    const accounts = this.accountsByWorkspace.get(workspaceKey) ?? [];
    this.accountsByWorkspace.set(
      workspaceKey,
      accounts.map((candidate) => (candidate.id === id ? revoked : candidate)),
    );
    return cloneAccount(revoked);
  }
}
