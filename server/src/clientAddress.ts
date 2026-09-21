import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

function normalizeIpAddress(value: string | undefined): string | null {
  const address = value?.trim();
  if (!address) return null;

  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mappedIpv4 && isIP(mappedIpv4[1]) === 4) return mappedIpv4[1];
  if (isIP(address) === 4) return address;
  if (isIP(address) !== 6) return null;

  return new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase();
}

export function resolveClientAddress(
  request: IncomingMessage,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const forwardedHeader = request.headers["x-forwarded-for"];
    const forwardedValues = Array.isArray(forwardedHeader)
      ? forwardedHeader
      : [forwardedHeader];

    for (const value of forwardedValues) {
      for (const candidate of value?.split(",") ?? []) {
        const normalized = normalizeIpAddress(candidate);
        if (normalized) return normalized;
      }
    }
  }

  return normalizeIpAddress(request.socket.remoteAddress) ?? "unknown";
}
