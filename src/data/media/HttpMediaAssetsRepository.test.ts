import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../../../shared/mediaContract";
import { ApiClient } from "../api/apiClient";
import { HttpMediaAssetsRepository } from "./HttpMediaAssetsRepository";

const asset: MediaAsset = {
  createdAt: "2026-09-25T12:00:00.000Z",
  durationMs: null,
  height: null,
  id: "70000000-0000-4000-8000-000000000001",
  mediaType: "image",
  mimeType: "image/jpeg",
  originalFilename: "foto.jpg",
  sizeBytes: 12,
  tenantId: "70000000-0000-4000-8000-000000000002",
  updatedAt: "2026-09-25T12:00:00.000Z",
  uploadedByUserId: "70000000-0000-4000-8000-000000000003",
  width: null,
};

function repositoryWith(fetchImpl: typeof fetch) {
  return new HttpMediaAssetsRepository(new ApiClient({ baseUrl: "https://api.example.test/", fetchImpl }));
}

describe("HttpMediaAssetsRepository", () => {
  it("valida o wrapper e todos os itens da listagem", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ mediaAssets: [asset] }));
    await expect(repositoryWith(fetchMock).list()).resolves.toEqual([asset]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/media-assets",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );

    for (const response of [{}, { mediaAssets: null }, { mediaAssets: [{ id: asset.id }] }]) {
      await expect(repositoryWith(vi.fn<typeof fetch>().mockResolvedValue(Response.json(response))).list())
        .rejects.toThrow("lista válida de mídias");
    }
  });

  it("envia um único arquivo via FormData e valida o DTO retornado", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json(asset));
    const repository = repositoryWith(fetchMock);
    const file = new File(["imagem"], "foto.jpg", { type: "image/jpeg" });

    await expect(repository.upload(file)).resolves.toEqual(asset);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example.test/media-assets");
    expect(init).toEqual(expect.objectContaining({ credentials: "include", method: "POST" }));
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("file")).toBe(file);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);

    await expect(repositoryWith(vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: asset.id }))).upload(file))
      .rejects.toThrow("mídia válida");
  });

  it("forma URL autenticada sem parâmetros de tenant, token ou storage", () => {
    const repository = repositoryWith(vi.fn<typeof fetch>());
    const url = repository.contentUrl(asset.id);
    expect(url).toBe(`https://api.example.test/media-assets/${asset.id}/content`);
    expect(url).not.toMatch(/tenant|token|storage/i);
  });
});
