import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import type { Readable } from "node:stream";
import Busboy from "busboy";
import { MediaRequestError, MediaStorageError } from "./mediaErrors.ts";
import {
  detectMediaFileFormat,
  isAllowedMediaMimeType,
  type MediaFileFormat,
} from "./mediaFileFormat.ts";

export type MediaLimits = { imageBytes: number; videoBytes: number };

export type StagedMediaFile = {
  format: MediaFileFormat;
  originalFilename: string;
  sha256: string;
  sizeBytes: number;
  tempPath: string;
};

const MAX_MULTIPART_OVERHEAD = 64 * 1024;

export function sanitizeMediaFilename(value: string): string {
  const basename = value.split(/[\\/]/).pop() ?? "";
  return Array.from(basename)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && !(codePoint >= 127 && codePoint <= 159) &&
        !(codePoint >= 0x202a && codePoint <= 0x202e) &&
        !(codePoint >= 0x2066 && codePoint <= 0x2069);
    })
    .slice(0, 255)
    .join("")
    .trim();
}

export async function ensureMediaStorageReady(root: string): Promise<void> {
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await mkdir(join(root, ".tmp"), { recursive: true, mode: 0o700 });
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
    await access(root, constants.W_OK | constants.X_OK);
    const probe = join(root, ".tmp", `probe-${randomUUID()}`);
    const handle = await open(probe, "wx", 0o600);
    await handle.close();
    await unlink(probe);
  } catch {
    throw new Error("MEDIA_STORAGE_PATH deve apontar para um diretório utilizável.");
  }
}

async function writeStreamedFile(
  stream: Readable & { truncated?: boolean },
  tempPath: string,
  originalFilename: string,
  declaredMimeType: string,
  limits: MediaLimits,
): Promise<StagedMediaFile> {
  const digest = createHash("sha256");
  let sizeBytes = 0;
  let prefix = Buffer.alloc(0);
  const preliminaryLimit = declaredMimeType.startsWith("image/")
    ? limits.imageBytes
    : limits.videoBytes;
  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
    for await (const piece of stream) {
      const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      sizeBytes += chunk.byteLength;
      if (sizeBytes > preliminaryLimit) {
        throw new MediaRequestError(413, "media_too_large", "O arquivo excede o limite permitido.");
      }
      if (prefix.length < 32) {
        prefix = Buffer.concat([prefix, chunk.subarray(0, 32 - prefix.length)]);
      }
      digest.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const result = await handle.write(chunk, offset, chunk.length - offset);
        offset += result.bytesWritten;
      }
    }
    if (stream.truncated || sizeBytes > limits.videoBytes) {
      throw new MediaRequestError(413, "media_too_large", "O arquivo excede o limite permitido.");
    }
    if (sizeBytes === 0) {
      throw new MediaRequestError(400, "invalid_media_upload", "O arquivo está vazio.");
    }
    const format = detectMediaFileFormat(prefix);
    if (!format || format.mimeType !== declaredMimeType) {
      throw new MediaRequestError(415, "unsupported_media_type", "O conteúdo não corresponde a um formato permitido.");
    }
    if (format.mediaType === "image" && sizeBytes > limits.imageBytes) {
      throw new MediaRequestError(413, "media_too_large", "A imagem excede o limite permitido.");
    }
    await handle.close();
    return {
      format,
      originalFilename,
      sha256: digest.digest("hex"),
      sizeBytes,
      tempPath,
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error instanceof MediaRequestError) throw error;
    throw new MediaStorageError();
  }
}

export async function receiveMediaUpload(
  request: IncomingMessage,
  root: string,
  limits: MediaLimits,
): Promise<StagedMediaFile> {
  const contentType = request.headers["content-type"];
  if (!contentType || !/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new MediaRequestError(415, "unsupported_media_type", "Use multipart/form-data para enviar a mídia.");
  }
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > limits.videoBytes + MAX_MULTIPART_OVERHEAD) {
    throw new MediaRequestError(413, "media_too_large", "O arquivo excede o limite permitido.");
  }
  const tempPath = join(root, ".tmp", `${randomUUID()}.upload`);
  let parser;
  try {
    parser = Busboy({
      headers: request.headers,
      limits: {
        fieldSize: 256,
        fields: 1,
        fileSize: limits.videoBytes,
        files: 2,
        headerPairs: 32,
        parts: 3,
      },
    });
  } catch {
    throw new MediaRequestError(400, "invalid_media_upload", "O formulário multipart é inválido.");
  }

  let fileCount = 0;
  const uploads: Promise<StagedMediaFile>[] = [];
  let formError: MediaRequestError | null = null;
  let interrupted = false;
  const setFormError = (error: MediaRequestError) => { formError ??= error; };

  parser.on("file", (fieldName, stream, info) => {
    // Busboy may error the child stream while destroying an incomplete request.
    stream.on("error", () => undefined);
    fileCount += 1;
    const filename = typeof info.filename === "string" ? sanitizeMediaFilename(info.filename) : "";
    const declaredMimeType = typeof info.mimeType === "string" ? info.mimeType.toLowerCase() : "";
    if (fileCount > 1) {
      setFormError(new MediaRequestError(400, "multiple_media_files", "Envie exatamente um arquivo."));
      stream.resume();
      return;
    }
    if (fieldName !== "file" || !filename) {
      setFormError(new MediaRequestError(400, "invalid_media_upload", "O campo file deve conter um nome de arquivo válido."));
      stream.resume();
      return;
    }
    if (!isAllowedMediaMimeType(declaredMimeType)) {
      setFormError(new MediaRequestError(415, "unsupported_media_type", "O tipo de mídia não é permitido."));
      stream.resume();
      return;
    }
    const uploadPromise = writeStreamedFile(stream, tempPath, filename, declaredMimeType, limits);
    uploads.push(uploadPromise);
    void uploadPromise.catch((error: unknown) => {
      if (!parser.destroyed) parser.destroy(error instanceof Error ? error : new MediaStorageError());
    });
  });
  parser.on("field", () => setFormError(new MediaRequestError(400, "invalid_media_upload", "Campos adicionais não são permitidos.")));
  parser.on("filesLimit", () => setFormError(new MediaRequestError(400, "multiple_media_files", "Envie exatamente um arquivo.")));
  parser.on("fieldsLimit", () => setFormError(new MediaRequestError(400, "invalid_media_upload", "Campos adicionais não são permitidos.")));
  parser.on("partsLimit", () => setFormError(new MediaRequestError(400, "invalid_media_upload", "O formulário multipart excede o limite de campos.")));
  const onAborted = () => { interrupted = true; parser.destroy(); };
  const onRequestError = () => { interrupted = true; parser.destroy(); };
  request.once("aborted", onAborted);
  request.once("error", onRequestError);
  try {
    await new Promise<void>((resolve, reject) => {
      parser.once("close", resolve);
      parser.once("error", reject);
      request.pipe(parser);
    });
    if (interrupted) throw new MediaRequestError(400, "invalid_media_upload", "O envio foi interrompido.");
    if (formError) throw formError;
    if (fileCount === 0 || !uploads[0]) {
      throw new MediaRequestError(400, "missing_media_file", "Envie um arquivo no campo file.");
    }
    return await uploads[0];
  } catch (error) {
    await Promise.all(uploads.map((upload) => upload.catch(() => undefined)));
    await unlink(tempPath).catch(() => undefined);
    if (error instanceof MediaRequestError) throw error;
    throw new MediaRequestError(400, "invalid_media_upload", "Não foi possível ler o formulário multipart.");
  } finally {
    request.off("aborted", onAborted);
    request.off("error", onRequestError);
  }
}

export async function moveMediaToFinalLocation(
  root: string,
  tenantId: string,
  mediaId: string,
  staged: StagedMediaFile,
): Promise<{ finalPath: string; storageKey: string }> {
  const storageKey = `${tenantId}/${mediaId}.${staged.format.extension}`;
  const finalPath = join(root, storageKey);
  try {
    await mkdir(join(root, tenantId), { recursive: true, mode: 0o700 });
    await rename(staged.tempPath, finalPath);
    return { finalPath, storageKey };
  } catch {
    throw new MediaStorageError();
  }
}

export async function removeMediaFile(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  });
}
