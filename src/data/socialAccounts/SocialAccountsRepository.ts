import type {
  SocialAccount,
  UpdateSocialAccountInput,
} from "../../../shared/socialAccountContract";

export interface SocialAccountsRepository {
  disconnect(id: string, workspaceKey: string): Promise<SocialAccount>;
  get(id: string, workspaceKey: string): Promise<SocialAccount>;
  list(workspaceKey: string): Promise<SocialAccount[]>;
  startMetaOAuth?(workspaceKey: string): Promise<string>;
  update(
    id: string,
    input: UpdateSocialAccountInput,
    workspaceKey: string,
  ): Promise<SocialAccount>;
}
