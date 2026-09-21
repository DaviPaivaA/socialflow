import { createContext } from "react";
import type {
  AuthSession,
  AuthWorkspace,
  LoginInput,
  RegisterInput,
} from "../../shared/authContract";

export type AuthContextValue = {
  initializationError: string | null;
  invalidateSession(): void;
  isLoading: boolean;
  isLoadingWorkspaces: boolean;
  isSwitchingWorkspace: boolean;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  selectWorkspace(tenantId: string): Promise<void>;
  session: AuthSession | null;
  workspaceError: string | null;
  workspaces: AuthWorkspace[];
};

export const AuthContext = createContext<AuthContextValue | null>(null);
