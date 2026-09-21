import type {
  AuthSession,
  AuthWorkspace,
  LoginInput,
  RegisterInput,
} from "../../../shared/authContract";

export interface AuthRepository {
  getCurrentSession(): Promise<AuthSession | null>;
  login(input: LoginInput): Promise<AuthSession>;
  listWorkspaces(): Promise<AuthWorkspace[]>;
  logout(): Promise<void>;
  register(input: RegisterInput): Promise<AuthSession>;
  selectWorkspace(tenantId: string): Promise<AuthSession>;
}
