import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MediaAsset } from "../../../shared/mediaContract";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import type { SocialAccount } from "../../../shared/socialAccountContract";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";
import { Composer } from "./Composer";

const image: MediaAsset = {
  createdAt: "2026-09-25T12:00:00.000Z", durationMs: null, height: null,
  id: "70000000-0000-4000-8000-000000000001", mediaType: "image", mimeType: "image/jpeg",
  originalFilename: "retrato.jpg", sizeBytes: 1024,
  tenantId: "70000000-0000-4000-8000-000000000002", updatedAt: "2026-09-25T12:00:00.000Z",
  uploadedByUserId: "70000000-0000-4000-8000-000000000003", width: null,
};
const video: MediaAsset = { ...image, id: "70000000-0000-4000-8000-000000000004", mediaType: "video", mimeType: "video/mp4", originalFilename: "clipe.mp4", sizeBytes: 2048 };
const webp: MediaAsset = { ...image, id: "70000000-0000-4000-8000-000000000005", mimeType: "image/webp", originalFilename: "arte.webp" };
const oversized: MediaAsset = { ...image, id: "70000000-0000-4000-8000-000000000006", sizeBytes: 4_000_001, originalFilename: "grande.jpg" };
const pageA: SocialAccount = {
  createdAt: "2026-09-25T12:00:00.000Z", disconnectedAt: null, displayName: "Página A",
  id: "70000000-0000-4000-8000-000000000011", profileImageUrl: null,
  provider: "facebook", providerAccountId: "page-a", scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
  status: "connected", tokenExpiresAt: null, updatedAt: "2026-09-25T12:00:00.000Z", username: null,
};
const pageB: SocialAccount = { ...pageA, id: "70000000-0000-4000-8000-000000000012", displayName: "Página B", providerAccountId: "page-b" };
const instagram: SocialAccount = {
  ...pageA, id: "70000000-0000-4000-8000-000000000013", provider: "instagram", username: "perfil.a",
  scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"],
};
const png: MediaAsset = { ...image, mimeType: "image/png", originalFilename: "arte.png" };
const mov: MediaAsset = { ...video, mimeType: "video/quicktime", originalFilename: "clipe.mov" };

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

function socialRepository(accounts: SocialAccount[] = [pageA]): SocialAccountsRepository {
  return { list: vi.fn().mockResolvedValue(accounts), get: vi.fn(), disconnect: vi.fn(), update: vi.fn(), startMetaOAuth: vi.fn() };
}

function renderComposer(source: MediaAssetsRepository, onSubmit = vi.fn(), accounts = socialRepository(), overrides: { isSubmitting?: boolean; onDraftChange?: () => void } = {}) {
  render(<Composer
    isLoadingPosts={false} isSubmitting={overrides.isSubmitting ?? false} mediaAssetsRepository={source}
    socialAccountsRepository={accounts} workspaceId="workspace-a" onClose={vi.fn()}
    onDraftChange={overrides.onDraftChange ?? vi.fn()} onSubmit={onSubmit}
  />);
  return onSubmit;
}

async function fillPost() {
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: /legenda/i }), "Post de teste");
  const date = screen.queryByLabelText("Data");
  const time = screen.queryByLabelText("Horário");
  if (date) fireEvent.change(date, { target: { value: "2027-09-25" } });
  if (time) fireEvent.change(time, { target: { value: "14:30" } });
  return user;
}

function submitGuardedForm() {
  const form = screen.getByRole("textbox", { name: /legenda/i }).closest("form");
  if (!form) throw new Error("Composer form missing");
  fireEvent.submit(form);
}

describe("Composer com mídia", () => {
  it("mostra carregamento, biblioteca e retry sem bloquear Post sem mídia", async () => {
    const pending = deferred<MediaAsset[]>();
    const source = repository({ list: vi.fn().mockReturnValue(pending.promise) });
    const onSchedule = renderComposer(source);
    expect(screen.getByText(/carregando biblioteca/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Enviar foto ou vídeo")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,video/mp4,video/quicktime");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeDisabled();
    pending.resolve([image, video]);
    expect(await screen.findByText("retrato.jpg")).toBeInTheDocument();
    expect(screen.getByText("clipe.mp4")).toBeInTheDocument();
    expect(screen.getByText(/1 KB/i)).toBeInTheDocument();
    expect(screen.getByText(/^Vídeo · 2 KB$/)).toBeInTheDocument();

    const user = await fillPost();
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Publicar agora" }));
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetIds: [] }));
  });

  it("erro da biblioteca permite retry e agendamento sem mídia", async () => {
    const source = repository({ list: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([image]) });
    const onSchedule = renderComposer(source);
    expect(await screen.findByText("Não foi possível carregar sua biblioteca de mídia.")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /tentar novamente/i }));
    expect(await screen.findByText("retrato.jpg")).toBeInTheDocument();
    await fillPost();
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Publicar agora" }));
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

  it("upload imediato bloqueia envio, mostra preview local e depois envia mediaAssetIds", async () => {
    const upload = deferred<MediaAsset>();
    const source = repository({ upload: vi.fn().mockReturnValue(upload.promise) });
    const createObjectURL = vi.fn().mockReturnValue("blob:novo");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const onSchedule = renderComposer(source);
    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    const user = await fillPost();
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled();
    const file = new File(["imagem"], "nova.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Enviar foto ou vídeo"), { target: { files: [file] } });
    expect(source.upload).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeDisabled();
    submitGuardedForm();
    expect(onSchedule).not.toHaveBeenCalled();
    expect(screen.getByTestId("composer-main-preview").querySelector("img")).toHaveAttribute("src", "blob:novo");
    upload.resolve(image);
    await waitFor(() => expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled());
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:novo");
    await user.click(screen.getByRole("button", { name: "Publicar agora" }));
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetIds: [image.id] }));
  });
});

describe("Composer destinos e publicação", () => {
  it("publica agora nas Pages selecionadas sem scheduledFor nem campos do servidor", async () => {
    const onSubmit = renderComposer(repository(), vi.fn(), socialRepository([pageA, pageB]));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    await user.click(screen.getByRole("checkbox", { name: "Facebook — Página B" }));
    await user.type(screen.getByRole("textbox", { name: /legenda/i }), "Post de teste");
    expect(screen.queryByLabelText("Data")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Horário")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publicar agora" }));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Post de teste", caption: "Post de teste", mediaAssetIds: [],
      publicationMode: "now", socialAccountIds: [pageA.id, pageB.id],
    });
  });

  it("exige horário no modo agendado e envia ISO somente depois de preenchê-lo", async () => {
    const onSubmit = renderComposer(repository());
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    await user.click(screen.getByRole("radio", { name: "Agendar" }));
    await user.type(screen.getByRole("textbox", { name: /legenda/i }), "Post agendado");
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Agendar publicação" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2027-09-25" } });
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "14:30" } });
    await user.click(screen.getByRole("button", { name: "Agendar publicação" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      publicationMode: "scheduled", socialAccountIds: [pageA.id], scheduledFor: expect.stringMatching(/^2027-09-25T/),
    }));
  });

  it("sem Pages indica Canais e bloqueia ambos os modos", async () => {
    const onSubmit = renderComposer(repository(), vi.fn(), socialRepository([]));
    expect(await screen.findByText(/Canais/)).toBeInTheDocument();
    await fillPost();
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Agendar" })).toBeDisabled();
    submitGuardedForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("publica vídeo como Reel e avisa sobre audiência pública da Facebook Page", async () => {
    const onSubmit = renderComposer(repository({ list: vi.fn().mockResolvedValue([video]) }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    await fillPost();
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled();
    await user.click(await screen.findByRole("button", { name: /selecionar clipe.mp4/i }));
    expect(screen.getByTestId("composer-main-preview").querySelector("video")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Reel.*Facebook.*públic/i);
    expect(screen.getByRole("status")).toHaveTextContent(/orientação.*não.*verifica/i);
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled();
    submitGuardedForm();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetIds: [video.id] }));
  });

  it.each([
    ["WebP", webp, /JPEG ou PNG/i],
    ["imagem acima de 4 MB", oversized, /4 MB/i],
  ] as const)("mantém %s na prévia mas bloqueia envio incompatível", async (_case, asset, guidance) => {
    const onSubmit = renderComposer(repository({ list: vi.fn().mockResolvedValue([asset]) }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    await fillPost();
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled();
    await user.click(await screen.findByRole("button", { name: new RegExp(`selecionar ${asset.originalFilename}`, "i") }));
    expect(screen.getByTestId("composer-main-preview").querySelector("img")).toHaveAttribute("src", `https://api.test/media-assets/${asset.id}/content`);
    expect(screen.getByRole("alert")).toHaveTextContent(guidance);
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeDisabled();
    submitGuardedForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("bloqueia novo envio enquanto a publicação está em andamento", async () => {
    const onSubmit = renderComposer(repository(), vi.fn(), socialRepository(), { isSubmitting: true });
    await userEvent.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    await fillPost();
    expect(screen.getByRole("button", { name: "Publicar agora" })).toHaveTextContent(/publicando publicação/i);
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeDisabled();
    submitGuardedForm();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("notifica alterações de destino e modo para preservar a revisão do rascunho", async () => {
    const onDraftChange = vi.fn();
    renderComposer(repository(), vi.fn(), socialRepository(), { onDraftChange });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    await user.click(screen.getByRole("radio", { name: "Agendar" }));
    expect(onDraftChange).toHaveBeenCalledTimes(2);
  });

  it("identifica providers, usa fallback Instagram e orienta reconexão sem OAuth", async () => {
    const accounts = socialRepository([
      pageA, instagram, { ...instagram, id: "fallback", username: null, displayName: "Perfil sem username" },
      { ...pageB, scopes: [] },
    ]);
    renderComposer(repository(), vi.fn(), accounts);
    expect(await screen.findByRole("checkbox", { name: "Facebook — Página A" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Instagram — @perfil.a" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Instagram — Perfil sem username" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Página B/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/reconect.*Canais/i);
    expect(accounts.startMetaOAuth).not.toHaveBeenCalled();
  });

  it.each([
    ["texto Facebook", [pageA], null, true],
    ["texto Instagram", [instagram], null, false],
    ["texto misto", [pageA, instagram], null, false],
    ["JPEG Facebook", [pageA], image, true],
    ["JPEG Instagram", [instagram], image, true],
    ["JPEG misto", [pageA, instagram], image, true],
    ["PNG Facebook", [pageA], png, true],
    ["PNG Instagram", [instagram], png, false],
    ["PNG misto", [pageA, instagram], png, false],
    ["JPEG 4 MB misto", [pageA, instagram], { ...image, sizeBytes: 4_000_000 }, true],
    ["JPEG acima de 4 MB Facebook", [pageA], oversized, false],
    ["JPEG acima de 4 MB Instagram", [instagram], oversized, true],
    ["JPEG acima de 4 MB misto", [pageA, instagram], oversized, false],
    ["JPEG 8 MB Instagram", [instagram], { ...image, sizeBytes: 8_000_000 }, true],
    ["JPEG acima de 8 MB Instagram", [instagram], { ...image, sizeBytes: 8_000_001 }, false],
    ["WebP Instagram", [instagram], webp, false],
    ["MP4 Facebook", [pageA], video, true],
    ["MP4 Instagram", [instagram], video, true],
    ["MP4 misto", [pageA, instagram], video, true],
    ["MOV Facebook", [pageA], mov, true],
    ["MOV Instagram", [instagram], mov, true],
    ["MOV misto", [pageA, instagram], mov, true],
    ["MP4 no teto misto", [pageA, instagram], { ...video, sizeBytes: 262_144_000 }, true],
    ["MP4 acima do teto misto", [pageA, instagram], { ...video, sizeBytes: 262_144_001 }, false],
  ] as const)("aplica matriz: %s preservando escolhas", async (_case, accounts, asset, valid) => {
    const onSubmit = renderComposer(repository({ list: vi.fn().mockResolvedValue(asset ? [asset] : []) }), vi.fn(), socialRepository([...accounts]));
    const user = userEvent.setup();
    for (const account of accounts) {
      await user.click(await screen.findByRole("checkbox", {
        name: account.provider === "facebook" ? "Facebook — Página A" : "Instagram — @perfil.a",
      }));
    }
    await fillPost();
    if (asset) await user.click(await screen.findByRole("button", { name: `Selecionar ${asset.originalFilename}` }));
    const button = screen.getByRole("button", { name: "Publicar agora" });
    if (valid) expect(button).toBeEnabled();
    else {
      expect(button).toBeDisabled();
      expect(screen.getByRole("alert")).toBeInTheDocument();
    }
    for (const checkbox of within(screen.getByRole("region", { name: "Destinos" })).getAllByRole("checkbox")) expect(checkbox).toBeChecked();
    if (asset) expect(screen.getByRole("button", { name: `Selecionar ${asset.originalFilename}` })).toHaveAttribute("aria-pressed", "true");
    submitGuardedForm();
    if (valid) expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      socialAccountIds: accounts.map((account) => account.id), mediaAssetIds: asset ? [asset.id] : [], publicationMode: "now",
    }));
    else expect(onSubmit).not.toHaveBeenCalled();
  });

  it("revalida PNG ao alternar Instagram sem remover a mídia ou outros destinos", async () => {
    renderComposer(repository({ list: vi.fn().mockResolvedValue([png]) }), vi.fn(), socialRepository([pageA, instagram]));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    await fillPost();
    await user.click(await screen.findByRole("button", { name: "Selecionar arte.png" }));
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "Instagram — @perfil.a" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Instagram.*JPEG/i);
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Instagram — @perfil.a" }));
    expect(screen.getByRole("button", { name: "Publicar agora" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Facebook — Página A" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Selecionar arte.png" })).toHaveAttribute("aria-pressed", "true");
  });

  it("agenda Reel misto enviando somente IDs e horário, sem gerar URL ou iniciar OAuth", async () => {
    const source = repository({ list: vi.fn().mockResolvedValue([mov]) });
    const accounts = socialRepository([pageA, instagram]);
    const onSubmit = renderComposer(source, vi.fn(), accounts);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Facebook — Página A" }));
    await user.click(screen.getByRole("checkbox", { name: "Instagram — @perfil.a" }));
    await user.click(screen.getByRole("radio", { name: "Agendar" }));
    await fillPost();
    await user.click(await screen.findByRole("button", { name: "Selecionar clipe.mov" }));
    await user.click(screen.getByRole("button", { name: "Agendar publicação" }));
    expect(onSubmit).toHaveBeenCalledWith({
      title: "Post de teste", caption: "Post de teste", mediaAssetIds: [mov.id],
      publicationMode: "scheduled", socialAccountIds: [pageA.id, instagram.id],
      scheduledFor: new Date("2027-09-25T14:30:00").toISOString(),
    });
    expect(accounts.startMetaOAuth).not.toHaveBeenCalled();
    expect(source.list).toHaveBeenCalledTimes(1);
    expect(source.upload).not.toHaveBeenCalled();
  });
});
