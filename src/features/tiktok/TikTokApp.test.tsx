import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../App";
import { initialPosts } from "../../data/mockData";
import { demoAuthSession, MockAuthRepository } from "../../data/auth/MockAuthRepository";
import { MockSocialAccountsRepository } from "../../data/socialAccounts/MockSocialAccountsRepository";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import type { PostsRepository } from "../../data/posts/PostsRepository";
import type { CreatePostResponse } from "../../../shared/postPublicationContract";

function services() {
  const repository: PostsRepository = { list: vi.fn().mockResolvedValue([]), create: vi.fn(), get: vi.fn(), updateScheduled: vi.fn(), cancelScheduled: vi.fn() };
  const mediaAssetsRepository: MediaAssetsRepository = { list: vi.fn().mockResolvedValue([]), upload: vi.fn(), contentUrl: vi.fn() };
  const socialAccountsRepository = new MockSocialAccountsRepository();
  vi.spyOn(socialAccountsRepository, "list");
  return { repository, mediaAssetsRepository, socialAccountsRepository };
}
beforeEach(() => { window.location.hash = "#/"; });

describe("Navegação App com interface TikTok 11A", () => {
  it("navega Canais, Agenda e Analytics sem APIs TikTok nem leituras extras por filtros locais", async () => {
    const input = services(); render(<App {...input} />);
    const nav = within(screen.getByRole("navigation", { name: "Navegação principal" }));
    fireEvent.click(nav.getByRole("button", { name: /Canais/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Conectar TikTok" }));
    expect(screen.getByRole("status")).toHaveTextContent(/não está habilitada/);
    const lists = vi.mocked(input.socialAccountsRepository.list).mock.calls.length;
    fireEvent.click(nav.getByRole("button", { name: /Agenda/ }));
    fireEvent.change(screen.getByLabelText("Plataforma da agenda"), { target: { value: "tiktok" } });
    expect(document.querySelectorAll(".calendar-item")).toHaveLength(0);
    fireEvent.click(nav.getByRole("button", { name: /Análises/ }));
    fireEvent.change(screen.getByLabelText("Plataforma de análise"), { target: { value: "tiktok" } });
    expect(screen.getByRole("heading", { name: "TikTok" })).toBeInTheDocument();
    expect(input.socialAccountsRepository.list).toHaveBeenCalledTimes(lists);
    expect(input.repository.get).not.toHaveBeenCalled(); expect(input.repository.create).not.toHaveBeenCalled();
    expect(input.mediaAssetsRepository.upload).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Notificações" })).toBeInTheDocument();
  });

  it("edita TT durante resposta Meta tardia sem descartar o rascunho local e limpa URLs ao fechar", async () => {
    const input = services(); let resolve!: (response: CreatePostResponse) => void;
    vi.mocked(input.repository.create).mockImplementation(() => new Promise((yes) => { resolve = yes; }));
    const revokeObjectURL = vi.fn(); vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue("blob:private"), revokeObjectURL }));
    render(<App {...input} />); await waitFor(() => expect(input.repository.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "＋ Criar publicação" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Facebook — Café Aurora" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda" }), { target: { value: "Meta somente" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "TikTok — prévia local" }));
    fireEvent.submit(screen.getByRole("button", { name: "Publicar agora" }).closest("form")!);
    await waitFor(() => expect(input.repository.create).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Vídeo TikTok local"), { target: { files: [new File(["private"], "private.mp4", { type: "video/mp4" })] } });
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda TikTok local" }), { target: { value: "TT permanece" } });
    const post = { ...initialPosts[0], status: "published" as const, caption: "Meta somente", tenantId: demoAuthSession.tenant.id };
    await act(async () => resolve({ post, publications: [{ id: "publication", postId: post.id, tenantId: post.tenantId, socialAccountId: "70000000-0000-4000-8000-000000000002", status: "published", createdAt: post.createdAt, updatedAt: post.updatedAt, errorCode: null, errorMessage: null, failedAt: null, startedAt: null, publishedAt: post.updatedAt, providerPostId: "remote" }] }));
    expect(screen.getByRole("textbox", { name: "Legenda TikTok local" })).toHaveValue("TT permanece");
    expect(input.repository.create).toHaveBeenCalledWith(expect.objectContaining({ caption: "Meta somente", mediaAssetIds: [] }));
    expect(JSON.stringify(vi.mocked(input.repository.create).mock.calls)).not.toMatch(/private|TT permanece|blob:/);
    fireEvent.click(screen.getByRole("button", { name: "Fechar sem salvar" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:private");
    fireEvent.click(screen.getByRole("button", { name: "＋ Criar publicação" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "TikTok — prévia local" }));
    expect(screen.getByRole("textbox", { name: "Legenda TikTok local" })).toHaveValue("");
  });

  it("trocar Workspace pelo App desmonta o compositor e descarta arquivos locais", async () => {
    const input = services(); const tenant = { ...demoAuthSession.tenant, id: "70000000-0000-4000-8000-000000000099", name: "Workspace B", slug: "workspace-b" };
    const authRepository = new MockAuthRepository(demoAuthSession, [
      { tenantId: demoAuthSession.tenant.id, name: demoAuthSession.tenant.name, slug: demoAuthSession.tenant.slug, role: "owner", selected: true },
      { tenantId: tenant.id, name: tenant.name, slug: tenant.slug, role: "owner", selected: false },
    ]);
    const revokeObjectURL = vi.fn(); vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue("blob:workspace-a"), revokeObjectURL }));
    render(<App {...input} authRepository={authRepository} initialAuthSession={demoAuthSession} />);
    fireEvent.click(screen.getByRole("button", { name: "＋ Criar publicação" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "TikTok — prévia local" }));
    fireEvent.change(screen.getByLabelText("Vídeo TikTok local"), { target: { files: [new File(["video"], "a.mp4", { type: "video/mp4" })] } });
    fireEvent.change(await screen.findByLabelText("Workspace ativo"), { target: { value: tenant.id } });
    await waitFor(() => expect(screen.getByLabelText("Workspace ativo")).toHaveValue(tenant.id));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:workspace-a");
    expect(screen.queryByRole("textbox", { name: "Legenda TikTok local" })).not.toBeInTheDocument();
  });
});
