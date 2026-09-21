import type {
  LoginInput,
  RegisterInput,
  SelectWorkspaceInput,
} from "../../shared/authContract.ts";
import { isUuid } from "../../shared/postContract.ts";

export type AuthInputValidation<T> =
  | { data: T; success: true }
  | { fields: string[]; success: false };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateCredentials(
  value: Record<string, unknown>,
): { email?: string; fields: string[]; password?: string } {
  const fields: string[] = [];
  const email =
    typeof value.email === "string" ? normalizeEmail(value.email) : undefined;
  const password =
    typeof value.password === "string" ? value.password : undefined;

  if (
    email === undefined ||
    email.length > 254 ||
    !EMAIL_PATTERN.test(email)
  ) {
    fields.push("email");
  }
  if (
    password === undefined ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    fields.push("password");
  }

  return { email, fields, password };
}

export function validateLoginInput(
  value: unknown,
): AuthInputValidation<LoginInput> {
  if (!isRecord(value)) return { fields: ["body"], success: false };

  const { email, fields, password } = validateCredentials(value);
  if (fields.length > 0 || email === undefined || password === undefined) {
    return { fields, success: false };
  }

  return { data: { email, password }, success: true };
}

export function validateRegisterInput(
  value: unknown,
): AuthInputValidation<RegisterInput> {
  if (!isRecord(value)) return { fields: ["body"], success: false };

  const { email, fields, password } = validateCredentials(value);
  const displayName =
    typeof value.displayName === "string" ? value.displayName.trim() : "";
  if (displayName.length < 2 || displayName.length > 100) {
    fields.unshift("displayName");
  }

  if (fields.length > 0 || email === undefined || password === undefined) {
    return { fields, success: false };
  }

  return {
    data: { displayName, email, password },
    success: true,
  };
}

export function validateSelectWorkspaceInput(
  value: unknown,
): AuthInputValidation<SelectWorkspaceInput> {
  if (!isRecord(value) || !isUuid(value.tenantId)) {
    return { fields: ["tenantId"], success: false };
  }

  return { data: { tenantId: value.tenantId }, success: true };
}
