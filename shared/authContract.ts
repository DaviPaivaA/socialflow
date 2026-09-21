import { isUuid } from "./postContract.ts";

export const TENANT_ROLES = ["owner", "admin", "member"] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export type AuthUser = {
  displayName: string;
  email: string;
  id: string;
};

export type AuthTenant = {
  id: string;
  name: string;
  role: TenantRole;
  slug: string;
};

export type AuthSession = {
  tenant: AuthTenant;
  user: AuthUser;
};

export type AuthWorkspace = {
  name: string;
  role: TenantRole;
  selected: boolean;
  slug: string;
  tenantId: string;
};

export type AuthWorkspacesResponse = {
  workspaces: AuthWorkspace[];
};

export type SelectWorkspaceInput = {
  tenantId: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type RegisterInput = LoginInput & {
  displayName: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTenantRole(value: unknown): value is TenantRole {
  return (
    typeof value === "string" &&
    TENANT_ROLES.some((role) => role === value)
  );
}

export function isAuthWorkspace(value: unknown): value is AuthWorkspace {
  return (
    isRecord(value) &&
    isUuid(value.tenantId) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.slug === "string" &&
    value.slug.length > 0 &&
    isTenantRole(value.role) &&
    typeof value.selected === "boolean"
  );
}

export function isAuthWorkspacesResponse(
  value: unknown,
): value is AuthWorkspacesResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.workspaces) &&
    value.workspaces.every(isAuthWorkspace) &&
    value.workspaces.filter((workspace) => workspace.selected).length === 1
  );
}

export function isAuthSession(value: unknown): value is AuthSession {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.tenant)) {
    return false;
  }

  return (
    isUuid(value.user.id) &&
    typeof value.user.displayName === "string" &&
    value.user.displayName.length > 0 &&
    typeof value.user.email === "string" &&
    value.user.email.length > 0 &&
    isUuid(value.tenant.id) &&
    typeof value.tenant.name === "string" &&
    value.tenant.name.length > 0 &&
    typeof value.tenant.slug === "string" &&
    value.tenant.slug.length > 0 &&
    isTenantRole(value.tenant.role)
  );
}
