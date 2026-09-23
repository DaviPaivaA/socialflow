import { describe, expect, it } from "vitest";
import { deriveSocialAccountStatus } from "../src/postgresSocialAccountsRepository.ts";

describe("estado público da conta social", () => {
  const now = Date.parse("2026-09-22T12:00:00.000Z");

  it("marca credencial vencida como expired inclusive no instante exato", () => {
    expect(deriveSocialAccountStatus("active", true, null, "2026-09-22T11:59:59.000Z", now)).toBe("expired");
    expect(deriveSocialAccountStatus("active", true, null, "2026-09-22T12:00:00.000Z", now)).toBe("expired");
  });

  it("não inventa expiração para token sem prazo ou ainda válido", () => {
    expect(deriveSocialAccountStatus("active", true, null, null, now)).toBe("connected");
    expect(deriveSocialAccountStatus("active", true, null, "2026-09-22T12:00:01.000Z", now)).toBe("connected");
  });

  it("preserva os estados explícitos pending, error e revoked", () => {
    expect(deriveSocialAccountStatus("pending", true, null, null, now)).toBe("pending");
    expect(deriveSocialAccountStatus("error", true, null, null, now)).toBe("error");
    expect(deriveSocialAccountStatus("expired", true, null, null, now)).toBe("expired");
    expect(deriveSocialAccountStatus("active", false, "2026-09-20T12:00:00.000Z", null, now)).toBe("revoked");
  });
});
