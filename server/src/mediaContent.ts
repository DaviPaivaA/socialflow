import { createReadStream } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

export type ByteRange = { start: number; end: number };
export type ByteRangeResult =
  | { kind: "none" }
  | { kind: "range"; range: ByteRange }
  | { kind: "unsatisfiable" };

export function parseSingleByteRange(
  value: string | undefined,
  sizeBytes: number,
): ByteRangeResult {
  if (value === undefined) return { kind: "none" };
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return { kind: "unsatisfiable" };
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) {
    return { kind: "unsatisfiable" };
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { kind: "unsatisfiable" };
    }
    return {
      kind: "range",
      range: { start: Math.max(sizeBytes - suffixLength, 0), end: sizeBytes - 1 },
    };
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : sizeBytes - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= sizeBytes ||
    end < start
  ) {
    return { kind: "unsatisfiable" };
  }
  return { kind: "range", range: { start, end: Math.min(end, sizeBytes - 1) } };
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot);
}

export async function resolveMediaContentFile(
  root: string,
  storageKey: string,
): Promise<{ path: string; sizeBytes: number }> {
  try {
    if (
      !storageKey ||
      isAbsolute(storageKey) ||
      storageKey.includes("\\") ||
      storageKey.includes("\0") ||
      storageKey.split("/").includes("..")
    ) {
      throw new Error("Invalid storage key");
    }

    const rootPath = resolve(root);
    const candidate = resolve(rootPath, storageKey);
    if (!isInside(rootPath, candidate)) throw new Error("Path outside storage");

    const realRoot = await realpath(rootPath);
    const realFile = await realpath(candidate);
    if (!isInside(realRoot, realFile)) throw new Error("Path outside storage");

    const details = await stat(realFile);
    if (!details.isFile() || !Number.isSafeInteger(details.size)) {
      throw new Error("Invalid storage file");
    }
    return { path: realFile, sizeBytes: details.size };
  } catch {
    throw new Error("Não foi possível acessar o conteúdo da mídia.");
  }
}
export async function sendMediaContent(
  request: IncomingMessage,
  response: ServerResponse,
  input: { path: string; mimeType: string; sizeBytes: number },
): Promise<void> {
  const handle = await open(input.path, "r");
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size !== input.sizeBytes) {
      throw new Error("Não foi possível acessar o conteúdo da mídia.");
    }

    const sizeBytes = details.size;
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", input.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Disposition", "inline");

    if (request.method === "HEAD") {
      response.statusCode = 200;
      response.setHeader("Content-Length", sizeBytes);
      response.end();
      return;
    }

    const parsed = parseSingleByteRange(request.headers.range, sizeBytes);
    if (parsed.kind === "unsatisfiable") {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${sizeBytes}`);
      response.end();
      return;
    }

    const range = parsed.kind === "range" ? parsed.range : null;
    response.statusCode = range ? 206 : 200;
    response.setHeader("Content-Length", range ? range.end - range.start + 1 : sizeBytes);
    if (range) {
      response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${sizeBytes}`);
    }
    const stream = createReadStream(input.path, {
      fd: handle.fd,
      autoClose: false,
      start: range?.start ?? 0,
      end: range?.end ?? sizeBytes - 1,
    });
    await pipeline(stream, response);
  } finally {
    await handle.close();
  }
}
