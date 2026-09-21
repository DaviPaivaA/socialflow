import argon2 from "argon2";

const ARGON2_OPTIONS = {
  hashLength: 32,
  memoryCost: 19_456,
  parallelism: 1,
  timeCost: 2,
  type: argon2.argon2id,
} as const;

const dummyHash = argon2.hash("socialflow-dummy-credential", ARGON2_OPTIONS);

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash ?? (await dummyHash), password);
  } catch {
    return false;
  }
}
