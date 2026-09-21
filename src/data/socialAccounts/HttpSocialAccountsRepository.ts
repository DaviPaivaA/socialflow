import {
  isSocialAccount,
  isSocialAccountsResponse,
  type SocialAccount,
  type UpdateSocialAccountInput,
} from "../../../shared/socialAccountContract";
import {
  isMetaOAuthStartResponse,
  type MetaOAuthStartResponse,
} from "../../../shared/metaOAuthContract";
import type { ApiClient } from "../api/apiClient";
import type { SocialAccountsRepository } from "./SocialAccountsRepository";

function assertSocialAccount(value: unknown): SocialAccount {
  if (!isSocialAccount(value)) {
    throw new Error("A API não retornou uma conta social válida.");
  }
  return value;
}

export class HttpSocialAccountsRepository
  implements SocialAccountsRepository
{
  private readonly apiClient: ApiClient;

  constructor(apiClient: ApiClient) {
    this.apiClient = apiClient;
  }

  async list(workspaceKey: string): Promise<SocialAccount[]> {
    void workspaceKey;
    const response = await this.apiClient.get<unknown>("/social-accounts");
    if (!isSocialAccountsResponse(response)) {
      throw new Error("A API não retornou uma lista válida de contas sociais.");
    }
    return response.socialAccounts;
  }

  async startMetaOAuth(workspaceKey: string): Promise<string> {
    void workspaceKey;
    const response = await this.apiClient.post<unknown, Record<string, never>>(
      "/auth/meta/start",
      {},
    );
    if (!isMetaOAuthStartResponse(response)) {
      throw new Error("A API não retornou uma URL OAuth Meta válida.");
    }
    return (response as MetaOAuthStartResponse).authorizationUrl;
  }

  async get(id: string, workspaceKey: string): Promise<SocialAccount> {
    void workspaceKey;
    return assertSocialAccount(
      await this.apiClient.get<unknown>(`/social-accounts/${id}`),
    );
  }

  async update(
    id: string,
    input: UpdateSocialAccountInput,
    workspaceKey: string,
  ): Promise<SocialAccount> {
    void workspaceKey;
    return assertSocialAccount(
      await this.apiClient.patch<unknown, UpdateSocialAccountInput>(
        `/social-accounts/${id}`,
        input,
      ),
    );
  }

  async disconnect(id: string, workspaceKey: string): Promise<SocialAccount> {
    void workspaceKey;
    return assertSocialAccount(
      await this.apiClient.delete<unknown>(`/social-accounts/${id}`),
    );
  }
}
