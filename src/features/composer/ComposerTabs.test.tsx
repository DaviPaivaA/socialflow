import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import type { SocialAccount } from "../../../shared/socialAccountContract";

const account: SocialAccount = {
  id: "facebook-id", provider: "facebook", displayName: "Teste", providerAccountId: "page",
  username: null, profileImageUrl: null, status: "connected", disconnectedAt: null,
  scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"], tokenExpiresAt: null,
  createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z",
};
const revokeObjectURL = vi.fn();
function setup() {
  const input = {
    workspaceId: "a", isLoadingPosts: false, isSubmitting: false,
    onClose: vi.fn(), onDraftChange: vi.fn(), onSubmit: vi.fn(),
    mediaAssetsRepository: { list: vi.fn().mockResolvedValue([]), upload: vi.fn(), contentUrl: vi.fn() },
    socialAccountsRepository: { list: vi.fn().mockResolvedValue([account]), get: vi.fn(), update: vi.fn(), disconnect: vi.fn() },
  };
  const view = render(<Composer {...input} />);
  return { ...input, view };
}
beforeEach(() => {
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: vi.fn().mockReturnValue("blob:draft"), revokeObjectURL }));
});

describe("Composer — abas independentes", () => {
  it("troca de aba sem selecionar destinos e mostra o editor TikTok completo desabilitado", async () => {
    setup();
    await screen.findByRole("checkbox", { name: "Facebook — Teste" });
    fireEvent.click(screen.getByRole("tab", { name: "TikTok" }));
    expect(screen.getByRole("checkbox", { name: "TikTok" })).not.toBeChecked();
    expect(screen.getByRole("textbox", { name: "Legenda TikTok" })).toBeDisabled();
    expect(screen.getByLabelText("Vídeo TikTok")).toBeDisabled();
    expect(screen.getByLabelText("Capa TikTok")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Publicar agora" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fechar sem salvar" })).toBeInTheDocument();
    expect(screen.getByRole("tabpanel", { name: "TikTok" })).not.toHaveAttribute("hidden");
    const metaTab = screen.getByRole("tab", { name: "Facebook e Instagram" });
    expect(document.getElementById(metaTab.getAttribute("aria-controls")!)).toHaveAttribute("hidden");
    expect(screen.getByRole("dialog")).not.toHaveTextContent(/prévia local|rascunho|persistido|teto local|compositor|não oficial/i);
  });

  it("preserva arquivos/legendas nas abas, bloqueia submit TikTok misto e volta ao payload Meta", async () => {
    const input = setup();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Facebook — Teste" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda" }), { target: { value: "Meta pública" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "TikTok" }));
    fireEvent.click(screen.getByRole("tab", { name: "TikTok" }));
    fireEvent.change(screen.getByLabelText("Vídeo TikTok"), { target: { files: [new File(["video"], "private.mp4", { type: "video/mp4" })] } });
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda TikTok" }), { target: { value: "TT privada" } });
    const publish = screen.getByRole("button", { name: "Publicar no TikTok" });
    expect(publish).toHaveAttribute("type", "button");
    expect(publish).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(publish);
    expect(screen.getByText("Publicação TikTok indisponível.")).toHaveAttribute("role", "status");
    fireEvent.submit(screen.getByRole("dialog"));
    expect(input.onSubmit).not.toHaveBeenCalled();
    expect(input.mediaAssetsRepository.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Facebook e Instagram" }));
    expect(screen.getByRole("textbox", { name: "Legenda" })).toHaveValue("Meta pública");
    expect(revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "TikTok" }));
    expect(screen.getByRole("textbox", { name: "Legenda TikTok" })).toHaveValue("TT privada");
    expect(within(screen.getByRole("tabpanel", { name: "TikTok" })).getByLabelText("Prévia da publicação TikTok").querySelector("video")).toHaveAttribute("src", "blob:draft");
    fireEvent.click(screen.getByRole("tab", { name: "Facebook e Instagram" }));
    fireEvent.submit(screen.getByRole("dialog"));
    expect(input.onSubmit).toHaveBeenCalledWith({ title: "Meta pública", caption: "Meta pública", socialAccountIds: ["facebook-id"], mediaAssetIds: [], publicationMode: "now" });
    fireEvent.click(screen.getByRole("checkbox", { name: "TikTok" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:draft");
    fireEvent.click(screen.getByRole("checkbox", { name: "TikTok" }));
    fireEvent.click(screen.getByRole("tab", { name: "TikTok" }));
    expect(screen.getByRole("textbox", { name: "Legenda TikTok" })).toHaveValue("");
  });

  it("navega abas com setas, Home e End mantendo o foco no diálogo", async () => {
    setup();
    const user = userEvent.setup();
    const meta = screen.getByRole("tab", { name: "Facebook e Instagram" });
    const tiktok = screen.getByRole("tab", { name: "TikTok" });
    meta.focus(); await user.keyboard("{ArrowRight}");
    expect(tiktok).toHaveFocus(); expect(tiktok).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Home}"); expect(meta).toHaveFocus();
    await user.keyboard("{ArrowLeft}"); expect(tiktok).toHaveFocus();
    await user.keyboard("{Home}{End}"); expect(tiktok).toHaveFocus();
  });
});
