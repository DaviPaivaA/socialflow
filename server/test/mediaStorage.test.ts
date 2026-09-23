import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectMediaFileFormat } from "../src/mediaFileFormat.ts";
import { MediaAssetsService } from "../src/mediaAssetsService.ts";
import type { MediaAssetsRepository } from "../src/mediaAssetsRepository.ts";
import { ensureMediaStorageReady, receiveMediaUpload, sanitizeMediaFilename } from "../src/mediaStorage.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const WEBP = Buffer.from("RIFF0000WEBPcontents");
const MP4 = Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypisom0000")]);
const MOV = Buffer.from([0, 0, 0, 16, ...Buffer.from("ftypqt  0000")]);
const LIMITS = { imageBytes: 20, videoBytes: 40 };
const directories: string[] = [];

async function testRoot() {
  const root = await mkdtemp(join(tmpdir(), "socialflow-media-unit-"));
  directories.push(root);
  await ensureMediaStorageReady(root);
  return root;
}

function multipartRequest(bytes: Buffer, mime: string, filename = "file.jpg", extra = ""): IncomingMessage {
  const boundary = `test-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n${extra}--${boundary}--\r\n`),
  ]);
  return Object.assign(Readable.from([body]), {
    headers: {
      "content-length": String(body.length),
      "content-type": `multipart/form-data; boundary=${boundary}`,
    },
  }) as unknown as IncomingMessage;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("mídia por streaming", () => {
  it.each([
    ["image/jpeg", JPEG, "jpg"],
    ["image/png", PNG, "png"],
    ["image/webp", WEBP, "webp"],
    ["video/mp4", MP4, "mp4"],
    ["video/quicktime", MOV, "mov"],
  ])("detecta assinatura %s e calcula SHA-256", async (mime, bytes, extension) => {
    expect(detectMediaFileFormat(bytes)?.extension).toBe(extension);
    const root = await testRoot();
    const staged = await receiveMediaUpload(multipartRequest(bytes, mime), root, LIMITS);
    expect(staged.format.extension).toBe(extension);
    expect(staged.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(staged.sizeBytes).toBe(bytes.length);
  });

  it("rejeita vazio, assinatura incompatível, MIME mentiroso e arquivo grande sem manter temporário", async () => {
    const root = await testRoot();
    await expect(receiveMediaUpload(multipartRequest(Buffer.alloc(0), "image/jpeg"), root, LIMITS)).rejects.toMatchObject({ code: "invalid_media_upload" });
    await expect(receiveMediaUpload(multipartRequest(Buffer.from("<svg/>"), "image/svg+xml"), root, LIMITS)).rejects.toMatchObject({ code: "unsupported_media_type" });
    await expect(receiveMediaUpload(multipartRequest(PNG, "image/jpeg"), root, LIMITS)).rejects.toMatchObject({ code: "unsupported_media_type" });
    await expect(receiveMediaUpload(multipartRequest(Buffer.concat([JPEG, Buffer.alloc(30)]), "image/jpeg"), root, LIMITS)).rejects.toMatchObject({ code: "media_too_large", status: 413 });
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
  });

  it("neutraliza separadores, controles e nomes longos", () => {
    expect(sanitizeMediaFilename("../../etc/passwd.jpg")).toBe("passwd.jpg");
    expect(sanitizeMediaFilename("..\\..\\arquivo.jpg")).toBe("arquivo.jpg");
    expect(sanitizeMediaFilename(`a\u0000${"b".repeat(300)}`).length).toBe(255);
  });

  it.each(["aborted", "error"])("remove o temporário quando a requisição emite %s", async (event) => {
    const root = await testRoot();
    const request = Object.assign(new PassThrough(), {
      headers: { "content-type": "multipart/form-data; boundary=aborted-test" },
    }) as unknown as IncomingMessage;
    const pending = receiveMediaUpload(request, root, LIMITS);
    request.write("--aborted-test\r\nContent-Disposition: form-data; name=\"file\"; filename=\"foto.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n");
    request.write(JPEG);
    if (event === "error") request.emit("error", new Error("network failure"));
    else request.emit("aborted");
    await expect(pending).rejects.toMatchObject({ code: "invalid_media_upload" });
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
    request.destroy();
  });

  it("falha antes do primeiro upload quando o storage não é diretório", async () => {
    const root = await testRoot();
    const invalidPath = join(root, "arquivo");
    await writeFile(invalidPath, "não é diretório");
    await expect(ensureMediaStorageReady(invalidPath)).rejects.toThrow("MEDIA_STORAGE_PATH deve apontar para um diretório utilizável");
  });

  it("usa UUIDs no storage key e compensa falha de INSERT", async () => {
    const root = await testRoot();
    const tenantId = randomUUID();
    const create = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const repository = { create, findById: vi.fn(), list: vi.fn() } as MediaAssetsRepository;
    const service = new MediaAssetsService(repository, root, LIMITS);
    await expect(service.upload(multipartRequest(JPEG, "image/jpeg", "../../secret.jpg"), {
      authorUserId: randomUUID(), tenantId,
    })).rejects.toThrow("database unavailable");
    expect(create).toHaveBeenCalledOnce();
    const record = create.mock.calls[0]?.[1] as { storageKey: string; originalFilename: string };
    expect(record.originalFilename).toBe("secret.jpg");
    expect(record.storageKey).toMatch(new RegExp(`^${tenantId}/[a-f0-9-]{36}\\.jpg$`));
    expect(await readdir(join(root, tenantId))).toEqual([]);
    expect(await readdir(join(root, ".tmp"))).toEqual([]);
  });
});
