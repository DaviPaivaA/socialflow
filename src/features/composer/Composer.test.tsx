import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../../../shared/mediaContract";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import { Composer } from "./Composer";

const image: MediaAsset = {
  createdAt: "2026-09-25T12:00:00.000Z", durationMs: null, height: null,
  id: "70000000-0000-4000-8000-000000000001", mediaType: "image", mimeType: "image/jpeg",
  originalFilename: "retrato.jpg", sizeBytes: 1024,
  tenantId: "70000000-0000-4000-8000-000000000002", updatedAt: "2026-09-25T12:00:00.000Z",
  uploadedByUserId: "70000000-0000-4000-8000-000000000003", width: null,
};
const video: MediaAsset = { ...image, id: "70000000-0000-4000-8000-000000000004", mediaType: "video", mimeType: "video/mp4", originalFilename: "clipe.mp4", sizeBytes: 2048 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function repository(overrides: Partial<MediaAssetsRepository> = {}): MediaAssetsRepository {
  return {
    list: vi.fn().mockResolvedValue([]), upload: vi.fn().mockResolvedValue(image),
    contentUrl: vi.fn((id: string) => `https://api.test/media-assets/${id}/content`),
    ...overrides,
  };
}

function renderComposer(source: MediaAssetsRepository, onSchedule = vi.fn()) {
  render(<Composer
    isLoadingPosts={false} isSubmitting={false} mediaAssetsRepository={source}
    workspaceId="workspace-a" onClose={vi.fn()} onDraftChange={vi.fn()} onSchedule={onSchedule}
  />);
  return onSchedule;
}

async function fillPost() {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: /legenda/i }), "Post de teste");
  fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2027-09-25" } });
  fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "14:30" } });
  return user;
}

describe("Composer com mídia", () => {
  it("mostra carregamento, biblioteca e retry sem bloquear Post sem mídia", async () => {
    const pending = deferred<MediaAsset[]>();
    const source = repository({ list: vi.fn().mockReturnValue(pending.promise) });
    const onSchedule = renderComposer(source);
    expect(screen.getByText(/carregando biblioteca/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Enviar foto ou vídeo")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,video/mp4,video/quicktime");
    expect(screen.getByRole("button", { name: "Agendar publicação" })).toBeEnabled();
    pending.resolve([image, video]);
    expect(await screen.findByText("retrato.jpg")).toBeInTheDocument();
    expect(screen.getByText("clipe.mp4")).toBeInTheDocument();
    expect(screen.getByText(/1 KB/i)).toBeInTheDocument();
    expect(screen.getByText(/^Vídeo · 2 KB$/)).toBeInTheDocument();

    const user = await fillPost();
    await user.click(screen.getByRole("button", { name: "Agendar publicação" }));
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetIds: [] }));
  });

  it("erro da biblioteca permite retry e agendamento sem mídia", async () => {
    const source = repository({ list: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([image]) });
    const onSchedule = renderComposer(source);
    expect(await screen.findByText("Não foi possível carregar sua biblioteca de mídia.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agendar publicação" })).toBeEnabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /tentar novamente/i }));
    expect(await screen.findByText("retrato.jpg")).toBeInTheDocument();
    await fillPost();
    await user.click(screen.getByRole("button", { name: "Agendar publicação" }));
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetIds: [] }));
  });

  it("prévia usa mídia real e remover seleção restaura placeholder", async () => {
    renderComposer(repository({ list: vi.fn().mockResolvedValue([image, video]) }));
    const imageCard = await screen.findByRole("button", { name: /selecionar retrato.jpg/i });
    await userEvent.click(imageCard);
    expect(imageCard).toHaveAttribute("aria-pressed", "true");
    const mainPreview = screen.getByTestId("composer-main-preview");
    expect(within(mainPreview).getByRole("img")).toHaveAttribute("src", `https://api.test/media-assets/${image.id}/content`);
    await userEvent.click(screen.getByRole("button", { name: /selecionar clipe.mp4/i }));
    const mainVideo = mainPreview.querySelector("video");
    expect(mainVideo).toHaveAttribute("src", `https://api.test/media-assets/${video.id}/content`);
    expect(mainVideo).toHaveAttribute("controls");
    expect(mainVideo).toHaveAttribute("preload", "metadata");
    const gridVideo = screen.getByTestId(`media-card-preview-${video.id}`).querySelector("video");
    expect(gridVideo).toHaveProperty("muted", true);
    expect(gridVideo).toHaveAttribute("preload", "metadata");
    expect(gridVideo).not.toHaveAttribute("autoplay");
    await userEvent.click(screen.getByRole("button", { name: "Remover seleção" }));
    expect(mainPreview).toHaveTextContent("SEU CONTEÚDO");
  });

  it("upload imediato desabilita agendamento, mostra preview local e envia mediaAssetIds", async () => {
    const upload = deferred<MediaAsset>();
    const source = repository({ upload: vi.fn().mockReturnValue(upload.promise) });
    const createObjectURL = vi.fn().mockReturnValue("blob:novo");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const onSchedule = renderComposer(source);
    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
    const file = new File(["imagem"], "nova.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Enviar foto ou vídeo"), { target: { files: [file] } });
    expect(source.upload).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: "Agendar publicação" })).toBeDisabled();
    expect(screen.getByTestId("composer-main-preview").querySelector("img")).toHaveAttribute("src", "blob:novo");
    upload.resolve(image);
    await waitFor(() => expect(screen.getByRole("button", { name: "Agendar publicação" })).toBeEnabled());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:novo");
    const user = await fillPost();
    await user.click(screen.getByRole("button", { name: "Agendar publicação" }));
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetIds: [image.id] }));
  });
});
