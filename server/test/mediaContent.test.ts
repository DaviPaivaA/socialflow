import { appendFileSync } from "node:fs";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { parseSingleByteRange, resolveMediaContentFile, sendMediaContent } from "../src/mediaContent.ts";

const tempDirectories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
  for (const directory of tempDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function makeStorageFixture() {
  const directory = await mkdtemp(join(tmpdir(), "socialflow-media-content-"));
  tempDirectories.push(directory);
  const root = join(directory, "storage");
  await mkdir(join(root, "tenant"), { recursive: true });
  return { directory, root };
}

async function makeContentServer() {
  const { root } = await makeStorageFixture();
  const file = join(root, "tenant", "asset.mp4");
  await writeFile(file, "abcdefghij");
  const server = createServer((request, response) => {
    void sendMediaContent(request, response, {
      path: file,
      mimeType: "video/mp4",
      sizeBytes: 10,
    });
  });
  servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}/content`;
}

describe("parseSingleByteRange", () => {
  it("trata ausência de Range como resposta completa", () => {
    expect(parseSingleByteRange(undefined, 10)).toEqual({ kind: "none" });
  });

  it.each([
    ["bytes=0-3", 10, { kind: "range", range: { start: 0, end: 3 } }],
    ["bytes=4-", 10, { kind: "range", range: { start: 4, end: 9 } }],
    ["bytes=-4", 10, { kind: "range", range: { start: 6, end: 9 } }],
    ["bytes=-999", 10, { kind: "range", range: { start: 0, end: 9 } }],
    ["bytes=9-9", 10, { kind: "range", range: { start: 9, end: 9 } }],
  ] as const)("aceita %s para um arquivo de %i bytes", (header, size, expected) => {
    expect(parseSingleByteRange(header, size)).toEqual(expected);
  });

  it.each([
    "bytes=-0",
    "bytes=7-3",
    "bytes=10-",
    "bytes=0-1,3-4",
    "items=0-3",
    "bytes=foo-bar",
    "bytes=-999999999999999999999999",
    "bytes=0-999999999999999999999999",
  ])("rejeita Range inválido ou não satisfazível %s", (header) => {
    expect(parseSingleByteRange(header, 10)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("resolveMediaContentFile", () => {
  it("resolve arquivo regular dentro do storage e informa tamanho físico", async () => {
    const { root } = await makeStorageFixture();
    const file = join(root, "tenant", "asset.jpg");
    await writeFile(file, Buffer.from([1, 2, 3, 4]));

    await expect(resolveMediaContentFile(root, "tenant/asset.jpg")).resolves.toEqual({
      path: await realpath(file),
      sizeBytes: 4,
    });
  });

  it.each(["../outside.jpg", "/etc/passwd", "tenant/missing.jpg"])(
    "não revela nem lê storageKey inválida ou indisponível %s",
    async (key) => {
      const { root } = await makeStorageFixture();
      await expect(resolveMediaContentFile(root, key)).rejects.toThrow(
        "Não foi possível acessar o conteúdo da mídia.",
      );
    },
  );

  it("bloqueia symlink interno cujo alvo sai do storage", async () => {
    const { directory, root } = await makeStorageFixture();
    const outside = join(directory, "outside.jpg");
    await writeFile(outside, Buffer.from([9, 8, 7]));
    await symlink(outside, join(root, "tenant", "asset.jpg"));

    await expect(resolveMediaContentFile(root, "tenant/asset.jpg")).rejects.toThrow(
      "Não foi possível acessar o conteúdo da mídia.",
    );
  });
});

describe("sendMediaContent", () => {
  it("não envia bytes anexados ao arquivo depois do Content-Length de GET completo", async () => {
    const { root } = await makeStorageFixture();
    const file = join(root, "tenant", "growing.mp4");
    const originalSize = 128 * 1024;
    await writeFile(file, Buffer.alloc(originalSize, 0x61));
    let writtenBytes = 0;
    let appended = false;
    const headers = new Map<string, string | number>();
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        writtenBytes += chunk.length;
        if (!appended) {
          appended = true;
          appendFileSync(file, Buffer.alloc(64 * 1024, 0x62));
        }
        callback();
      },
    });
    const response = Object.assign(output, {
      statusCode: 200,
      setHeader(name: string, value: string | number) { headers.set(name, value); },
    }) as unknown as ServerResponse;

    await sendMediaContent(
      { method: "GET", headers: {} } as IncomingMessage,
      response,
      { path: file, mimeType: "video/mp4", sizeBytes: originalSize },
    );

    expect(appended).toBe(true);
    expect(headers.get("Content-Length")).toBe(originalSize);
    expect(writtenBytes).toBe(originalSize);
  });

  it("envia GET completo com tipo, tamanho, cache privado e nosniff", async () => {
    const url = await makeContentServer();
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abcdefghij");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("envia HEAD sem body e ignora Range", async () => {
    const url = await makeContentServer();
    const response = await fetch(url, { method: "HEAD", headers: { Range: "bytes=2-4" } });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-length")).toBe("10");
    expect(response.headers.get("content-range")).toBeNull();
    expect(response.headers.get("accept-ranges")).toBe("bytes");
  });

  it("envia apenas o intervalo solicitado com 206", async () => {
    const url = await makeContentServer();
    const response = await fetch(url, { headers: { Range: "bytes=2-5" } });

    expect(response.status).toBe(206);
    expect(await response.text()).toBe("cdef");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("content-type")).toBe("video/mp4");
  });

  it("rejeita Range inválido com 416 e informa o tamanho total", async () => {
    const url = await makeContentServer();
    const response = await fetch(url, { headers: { Range: "bytes=-0" } });

    expect(response.status).toBe(416);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-range")).toBe("bytes */10");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
