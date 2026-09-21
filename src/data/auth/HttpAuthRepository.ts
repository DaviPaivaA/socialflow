import {
  isAuthSession,
  isAuthWorkspacesResponse,
  type AuthSession,
  type AuthWorkspace,
  type LoginInput,
  type RegisterInput,
} from "../../../shared/authContract";
import { HttpError, type ApiClient } from "../api/apiClient";
import type { AuthRepository } from "./AuthRepository";

function requireAuthSession(value: unknown): AuthSession {
  if (!isAuthSession(value)) {
    throw new Error("A API não retornou uma sessão de usuário válida.");
  }
  return value;
}

export class HttpAuthRepository implements AuthRepository {
  constructor(private readonly apiClient: ApiClient) {}

  async getCurrentSession(): Promise<AuthSession | null> {
    try {
      return requireAuthSession(
        await this.apiClient.get<unknown>("/auth/me"),
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return null;
      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthSession> {
    return requireAuthSession(
      await this.apiClient.post<unknown, LoginInput>("/auth/login", input),
    );
  }

  async listWorkspaces(): Promise<AuthWorkspace[]> {
    const response = await this.apiClient.get<unknown>("/auth/workspaces");
    if (!isAuthWorkspacesResponse(response)) {
      throw new Error("A API não retornou uma lista de workspaces válida.");
    }
    return response.workspaces;
  }

  async register(input: RegisterInput): Promise<AuthSession> {
    return requireAuthSession(
      await this.apiClient.post<unknown, RegisterInput>(
        "/auth/register",
        input,
      ),
    );
  }

  async logout(): Promise<void> {
    await this.apiClient.post<unknown, Record<string, never>>(
      "/auth/logout",
      {},
    );
  }

  async selectWorkspace(tenantId: string): Promise<AuthSession> {
    return requireAuthSession(
      await this.apiClient.post<unknown, { tenantId: string }>(
        "/auth/workspaces/select",
        { tenantId },
      ),
    );
  }
}
