import { describe, expect, it } from "vitest";
import { MockSocialAccountsRepository } from "./MockSocialAccountsRepository";

describe("MockSocialAccountsRepository — disponibilidade", () => {
  it("não inventa uma conexão TikTok nos dados iniciais", async () => {
    const repository = new MockSocialAccountsRepository();
    const accounts = await repository.list("11111111-1111-4111-8111-111111111111");
    expect(accounts.some(account => account.provider === "tiktok")).toBe(false);
    expect(accounts.filter(account => account.status === "connected").map(account => account.provider))
      .toEqual(["instagram", "facebook"]);
  });
});
