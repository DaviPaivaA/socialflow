import type {
  AuthSession,
  AuthWorkspace,
  LoginInput,
  RegisterInput,
} from "../../../shared/authContract";
import type { AuthRepository } from "./AuthRepository";

export const demoAuthSession: AuthSession = {
  tenant: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Café Aurora",
    role: "owner",
    slug: "cafe-aurora",
  },
  user: {
    displayName: "Davi Alvares",
    email: "davi@socialflow.local",
    id: "22222222-2222-4222-8222-222222222222",
  },
};

function cloneSession(session: AuthSession): AuthSession {
  return {
    tenant: { ...session.tenant },
    user: { ...session.user },
  };
}

function workspaceFromSession(session: AuthSession): AuthWorkspace {
  return {
    name: session.tenant.name,
    role: session.tenant.role,
    selected: true,
    slug: session.tenant.slug,
    tenantId: session.tenant.id,
  };
}

function cloneWorkspace(workspace: AuthWorkspace): AuthWorkspace {
  return { ...workspace };
}

export class MockAuthRepository implements AuthRepository {
  private session: AuthSession | null;
  private workspaces: AuthWorkspace[];

  constructor(
    initialSession: AuthSession | null = demoAuthSession,
    workspaces?: AuthWorkspace[],
  ) {
    this.session = initialSession ? cloneSession(initialSession) : null;
    this.workspaces = workspaces
      ? workspaces.map(cloneWorkspace)
      : initialSession
        ? [workspaceFromSession(initialSession)]
        : [];
  }

  async getCurrentSession(): Promise<AuthSession | null> {
    return this.session ? cloneSession(this.session) : null;
  }

  async login(input: LoginInput): Promise<AuthSession> {
    this.session = {
      ...cloneSession(demoAuthSession),
      user: { ...demoAuthSession.user, email: input.email },
    };
    this.workspaces = [workspaceFromSession(this.session)];
    return cloneSession(this.session);
  }

  async listWorkspaces(): Promise<AuthWorkspace[]> {
    if (!this.session) throw new Error("Autenticação necessária.");
    return this.workspaces.map(cloneWorkspace);
  }

  async register(input: RegisterInput): Promise<AuthSession> {
    this.session = {
      ...cloneSession(demoAuthSession),
      tenant: {
        ...demoAuthSession.tenant,
        name: `Workspace de ${input.displayName}`,
      },
      user: {
        ...demoAuthSession.user,
        displayName: input.displayName,
        email: input.email,
      },
    };
    this.workspaces = [workspaceFromSession(this.session)];
    return cloneSession(this.session);
  }

  async logout(): Promise<void> {
    this.session = null;
  }

  async selectWorkspace(tenantId: string): Promise<AuthSession> {
    if (!this.session) throw new Error("Autenticação necessária.");
    const selected = this.workspaces.find(
      (workspace) => workspace.tenantId === tenantId,
    );
    if (!selected) throw new Error("Workspace não autorizado.");

    this.workspaces = this.workspaces.map((workspace) => ({
      ...workspace,
      selected: workspace.tenantId === selected.tenantId,
    }));
    this.session = {
      ...this.session,
      tenant: {
        id: selected.tenantId,
        name: selected.name,
        role: selected.role,
        slug: selected.slug,
      },
    };
    return cloneSession(this.session);
  }
}
