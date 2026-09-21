import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { resolveClientAddress } from "../src/clientAddress.ts";
import { InMemoryRateLimiter } from "../src/rateLimiter.ts";

function requestWith(
  remoteAddress: string,
  forwardedFor?: string,
): IncomingMessage {
  return {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
    socket: { remoteAddress },
  } as IncomingMessage;
}

describe("endereço do cliente para rate limiting", () => {
  it("ignora X-Forwarded-For quando o proxy não é confiável", () => {
    const request = requestWith("::ffff:192.0.2.10", "198.51.100.20");

    expect(resolveClientAddress(request, false)).toBe("192.0.2.10");
  });

  it("usa o primeiro endereço válido encaminhado por um proxy confiável", () => {
    const request = requestWith(
      "10.0.0.2",
      "inválido, 2001:0db8:0:0:0:0:0:1, 10.0.0.2",
    );

    expect(resolveClientAddress(request, true)).toBe("2001:db8::1");
  });

  it("mantém clientes encaminhados diferentes em chaves diferentes", () => {
    const limiter = new InMemoryRateLimiter({
      maxAttempts: 1,
      windowMs: 60_000,
    });
    const first = resolveClientAddress(
      requestWith("10.0.0.2", "198.51.100.10"),
      true,
    );
    const second = resolveClientAddress(
      requestWith("10.0.0.2", "198.51.100.11"),
      true,
    );

    expect(limiter.consume(`login:${first}`, 1_000).allowed).toBe(true);
    expect(limiter.consume(`login:${second}`, 1_000).allowed).toBe(true);
    expect(limiter.consume(`login:${first}`, 1_001).allowed).toBe(false);
  });

  it("normaliza IPv4 mapeado e usa o socket se o header for inválido", () => {
    expect(
      resolveClientAddress(requestWith("::ffff:203.0.113.9", "forjado"), true),
    ).toBe("203.0.113.9");
  });
});
