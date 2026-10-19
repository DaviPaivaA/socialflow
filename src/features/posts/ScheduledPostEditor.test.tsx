import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PostDetail } from "../../data/posts/PostsRepository";
import { initialPosts } from "../../data/mockData";
import { initialSocialAccounts, MockSocialAccountsRepository } from "../../data/socialAccounts/MockSocialAccountsRepository";
import type { MediaAsset } from "../../../shared/mediaContract";
import { ScheduledPostEditor, type ScheduledPostEditorProps } from "./ScheduledPostEditor";

const account = initialSocialAccounts.find((item) => item.provider === "facebook")!;
const instagram = { ...account, id: "instagram", provider: "instagram" as const,
  scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_content_publish"] };
const jpeg: MediaAsset = { id: "jpeg", tenantId: initialPosts[0].tenantId, uploadedByUserId: initialPosts[0].authorUserId,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", durationMs: null, height: null, width: null,
  mimeType: "image/jpeg", mediaType: "image", originalFilename: "original.jpg", sizeBytes: 1024 };
const webp = { ...jpeg, id: "webp", originalFilename: "legado.webp", mimeType: "image/webp", sizeBytes: 100 };
const png = { ...jpeg, id: "png", originalFilename: "troca.png", mimeType: "image/png" };
const video = { ...jpeg, id: "video", originalFilename: "reel.mp4", mimeType: "video/mp4", mediaType: "video" as const };
const detail: PostDetail = { post: { ...initialPosts[0], caption: "l".repeat(700), title: null, scheduledFor: "2099-12-01T12:23:45.678-03:00", mediaAssetIds: [jpeg.id] },
  publications: [{ id: "publication", postId: initialPosts[0].id, tenantId: initialPosts[0].tenantId, socialAccountId: account.id,
    status: "scheduled", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", failedAt: null, startedAt: null,
    publishedAt: null, providerPostId: null, errorCode: null, errorMessage: null }], permissions: { canEditSchedule: true, canCancelSchedule: true } };

function props(overrides: Partial<ScheduledPostEditorProps> = {}): ScheduledPostEditorProps {
  return { detail, workspaceId: detail.post.tenantId, isSubmitting: false, error: null, onSave: vi.fn(), onClose: vi.fn(),
    socialAccountsRepository: new MockSocialAccountsRepository([account, instagram], detail.post.tenantId),
    mediaAssetsRepository: { list: vi.fn().mockResolvedValue([jpeg, png, video]), upload: vi.fn().mockResolvedValue(png), contentUrl: (id) => `/private/media/${id}` }, ...overrides };
}

describe("ScheduledPostEditor", () => {
  it("prefills complete text, explicit nullable title, schedule and selections, without publish-now", async () => {
    const source = props();
    render(<ScheduledPostEditor {...source} />);
    expect(screen.getByRole("dialog", { name: "Editar agendamento" })).toBeInTheDocument();
    expect(screen.getByLabelText("Título")).toHaveValue("");
    expect(screen.getByLabelText("Legenda")).toHaveValue("l".repeat(700));
    expect(screen.getByLabelText("Legenda")).not.toHaveAttribute("maxlength", "500");
    expect(screen.getByLabelText("Data")).not.toHaveValue("");
    expect(await screen.findByRole("checkbox", { name: /Facebook/ })).toBeChecked();
    expect(await screen.findByRole("button", { name: "Selecionar original.jpg" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText("Publicar agora")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(source.onClose).toHaveBeenCalledOnce();
    expect(source.onSave).not.toHaveBeenCalled();
  });

  it("saves only the changed title once, leaves original schedule precision and ignores unchanged detail rerenders", async () => {
    let resolve!: () => void;
    const source = props({ onSave: vi.fn(() => new Promise<void>((yes) => { resolve = yes; })) });
    const view = render(<ScheduledPostEditor {...source} />);
    await screen.findByRole("button", { name: "Selecionar original.jpg" });
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Título deliberado" } });
    const save = screen.getByRole("button", { name: "Salvar alterações" });
    act(() => { fireEvent.submit(save.closest("form")!); fireEvent.submit(save.closest("form")!); });
    expect(source.onSave).toHaveBeenCalledExactlyOnceWith({ title: "Título deliberado" });
    view.rerender(<ScheduledPostEditor {...source} detail={{ ...detail, post: { ...detail.post, caption: "Resposta de lista" } }} />);
    expect(screen.getByLabelText("Legenda")).toHaveValue("l".repeat(700));
    await act(async () => resolve());
  });

  it("blocks unresolved media/accounts and preserves them until explicit removal, including legacy zero destinations", async () => {
    const source = props({ detail: { ...detail, publications: [] }, mediaAssetsRepository: { list: vi.fn().mockResolvedValue([]), upload: vi.fn(), contentUrl: (id) => `/private/${id}` } });
    render(<ScheduledPostEditor {...source} />);
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Novo título" } });
    expect(await screen.findByText(/Mídia selecionada indisponível/)).toHaveTextContent("jpeg");
    expect(screen.getByText(/sem seleção explícita/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Remover mídia indisponível" }));
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(source.onSave).toHaveBeenCalledWith({ title: "Novo título", mediaAssetIds: [] });
  });

  it("preserves existing media while saving a title-only edit for a legacy post without destinations", async () => {
    const legacyDetail = { ...detail, post: { ...detail.post, mediaAssetIds: [webp.id] }, publications: [] };
    const source = props({ detail: legacyDetail,
      socialAccountsRepository: new MockSocialAccountsRepository([], detail.post.tenantId),
      mediaAssetsRepository: { list: vi.fn().mockResolvedValue([webp]), upload: vi.fn(), contentUrl: (id) => `/private/${id}` } });
    render(<ScheduledPostEditor {...source} />);
    expect(await screen.findByRole("button", { name: "Selecionar legado.webp" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Título preservado" } });
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Salvar alterações" }));
    expect(source.onSave).toHaveBeenCalledExactlyOnceWith({ title: "Título preservado" });
  });

  it("applies destination compatibility after explicitly adding a destination to a legacy post", async () => {
    const legacyDetail = { ...detail, post: { ...detail.post, mediaAssetIds: [webp.id] }, publications: [] };
    const source = props({ detail: legacyDetail,
      socialAccountsRepository: new MockSocialAccountsRepository([instagram], detail.post.tenantId),
      mediaAssetsRepository: { list: vi.fn().mockResolvedValue([webp]), upload: vi.fn(), contentUrl: (id) => `/private/${id}` } });
    render(<ScheduledPostEditor {...source} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Instagram/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/Formato incompatível/);
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    expect(source.onSave).not.toHaveBeenCalled();
  });

  it("shows unavailable selected accounts separately and does not silently drop them", async () => {
    render(<ScheduledPostEditor {...props({ socialAccountsRepository: new MockSocialAccountsRepository([], detail.post.tenantId) })} />);
    expect(await screen.findByRole("button", { name: `Remover conta ${account.id}` })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Legenda"), { target: { value: "Revisada" } });
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
  });

  it("uses shared JPEG/PNG/video destination policy and blocks while uploading", async () => {
    let resolve!: (asset: MediaAsset) => void;
    const source = props();
    source.mediaAssetsRepository.upload = vi.fn(() => new Promise<MediaAsset>((yes) => { resolve = yes; }));
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => "blob:editor"), revokeObjectURL: vi.fn() }));
    render(<ScheduledPostEditor {...source} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Instagram/ }));
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Selecionar troca.png" }));
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/JPEG|compatível/);
    await userEvent.click(screen.getByRole("button", { name: "Selecionar reel.mp4" }));
    expect(screen.getByText(/Reel/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeEnabled();
    await userEvent.upload(screen.getByLabelText("Enviar foto ou vídeo"), new File(["jpeg"], "nova.jpg", { type: "image/jpeg" }));
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    await act(async () => resolve(jpeg));
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeEnabled());
    expect(within(screen.getByRole("dialog")).queryByText("Publicar agora")).not.toBeInTheDocument();
  });
});
