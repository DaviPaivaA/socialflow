import { describe, expect, it, vi } from "vitest";
import { isMediaAsset } from "../../../shared/mediaContract";
import { MockMediaAssetsRepository } from "./MockMediaAssetsRepository";

describe("MockMediaAssetsRepository", () => {
  it("começa vazio e mantém upload local no topo sem compartilhar arrays mutáveis", async () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:mock-photo");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));
    const repository = new MockMediaAssetsRepository();
    expect(await repository.list()).toEqual([]);

    const first = await repository.upload(new File(["imagem"], "foto.jpg", { type: "image/jpeg" }));
    const second = await repository.upload(new File(["video"], "filme.mp4", { type: "video/mp4" }));
    expect(isMediaAsset(first)).toBe(true);
    expect(isMediaAsset(second)).toBe(true);
    expect((await repository.list()).map((item) => item.id)).toEqual([second.id, first.id]);
    expect(repository.contentUrl(first.id)).toBe("blob:mock-photo");
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    const snapshot = await repository.list();
    snapshot.splice(0, 1);
    snapshot[0]!.originalFilename = "alterado.jpg";
    expect((await repository.list()).map((item) => item.originalFilename)).toEqual(["filme.mp4", "foto.jpg"]);
  });
});
