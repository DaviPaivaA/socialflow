import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import { createReadStream, read } from "node:fs";
import { MediaRequestError } from "./mediaErrors.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

export type ByteRange = { start: number; end: number };
export type VerifiedMediaHandle = { handle: FileHandle; mimeType: string; sizeBytes: number; close(): Promise<void> };
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

    await sendOpenMediaContent(request, response, { handle, mimeType: input.mimeType, sizeBytes: details.size, close: () => handle.close() });
  } finally { await handle.close(); }
}

/** The opener owns close(), including HEAD, failures and client cancellation. */
export async function sendOpenMediaContent(request: IncomingMessage, response: ServerResponse,
  input: VerifiedMediaHandle, expiresAt?: Date): Promise<void> {
    if (expiresAt && expiresAt.getTime() <= Date.now()) throw new MediaRequestError(404, "media_asset_not_found", "A mídia não foi encontrada.");
    const sizeBytes = input.sizeBytes;
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", input.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Disposition", "inline");
    response.setHeader("Referrer-Policy", "no-referrer");

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
    const stream = createReadStream("", {
      fd: input.handle.fd,
      autoClose: false,
      // Even autoClose:false streams invoke close on explicit destroy/error.
      // The stream owns its I/O, but the opener alone owns the descriptor.
      fs: { read, close: (_fd, callback) => { callback(null); } },
      start: range?.start ?? 0,
      end: range?.end ?? sizeBytes - 1,
    });
    const timer = expiresAt ? setTimeout(() => stream.destroy(new Error("Prazo da mídia encerrado.")), Math.max(0, expiresAt.getTime() - Date.now())) : undefined;
    try { await pipeline(stream, response); }
    finally { if (timer) clearTimeout(timer); }
}
