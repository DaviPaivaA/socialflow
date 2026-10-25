import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../composer/Composer";
import { TikTokComingSoon } from "../../components/TikTokComingSoon";
import { Agenda } from "../../pages/Agenda";
import { Analytics } from "../../pages/Analytics";
import type { SocialAccount } from "../../../shared/socialAccountContract";
import type { MediaAssetsRepository } from "../../data/media/MediaAssetsRepository";
import type { SocialAccountsRepository } from "../../data/socialAccounts/SocialAccountsRepository";

// Vitest stubs CSS imports; exercise the actual stylesheet in the DOM instead.
const tiktokStyles = readFileSync("src/features/tiktok/tiktok.css", "utf8");

const facebook: SocialAccount = {
  id: "facebook-id", provider: "facebook", displayName: "Página real", providerAccountId: "page",
  username: null, profileImageUrl: null, status: "connected", disconnectedAt: null,
  scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"], tokenExpiresAt: null,
  createdAt: "2026-10-23T00:00:00Z", updatedAt: "2026-10-23T00:00:00Z",
};
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
function props(workspaceId = "workspace-a") {
  const mediaAssetsRepository: MediaAssetsRepository = {
    list: vi.fn().mockResolvedValue([]), upload: vi.fn(), contentUrl: vi.fn(),
  };
  const socialAccountsRepository: SocialAccountsRepository = {
    list: vi.fn().mockResolvedValue([facebook]), get: vi.fn(), disconnect: vi.fn(), update: vi.fn(), startMetaOAuth: vi.fn(),
  };
  return { workspaceId, mediaAssetsRepository, socialAccountsRepository,
    isLoadingPosts: false, isSubmitting: false, onClose: vi.fn(), onDraftChange: vi.fn(), onSubmit: vi.fn() };
}
function selectTikTok() {
  fireEvent.click(screen.getByRole("checkbox", { name: "TikTok" }));
  fireEvent.click(screen.getByRole("tab", { name: "TikTok" }));
}
function chooseVideo(file = new File(["video"], "local.mp4", { type: "video/mp4" })) {
  fireEvent.change(screen.getByLabelText("Vídeo TikTok"), { target: { files: [file] } });
}
beforeEach(() => {
  createObjectURL.mockReset().mockImplementation(() => `blob:local-${createObjectURL.mock.calls.length}`);
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
});

describe("TikTok 11A: experiência exclusivamente local", () => {
  it("preserva nomes longos de vídeo e capa com contenção e quebra responsiva", async () => {
    const style = document.createElement("style");
    style.textContent = tiktokStyles;
    document.head.append(style);
    try {
      render(<Composer {...props()} />);
      await screen.findByRole("checkbox", { name: "Facebook — Página real" });
      selectTikTok();
      const videoName = `${"video-sem-espacos".repeat(30)}.mp4`;
      const posterName = `${"capa-sem-espacos".repeat(30)}.png`;
      chooseVideo(new File(["video"], videoName, { type: "video/mp4" }));
      fireEvent.change(screen.getByLabelText("Capa TikTok"), { target: { files: [new File(["cover"], posterName, { type: "image/png" })] } });
      for (const name of [videoName, posterName]) {
        const filename = screen.getByText(name);
        expect(filename.textContent).toBe(name);
        expect(filename).toHaveClass("tiktok-file-name");
        expect(getComputedStyle(filename).overflowWrap).toBe("anywhere");
        expect(getComputedStyle(filename).minWidth).toBe("0px");
      }
    } finally {
      style.remove();
    }
  });

  it("conexão informativa permanece desconectada sem navegação nem sucesso", () => {
    render(<TikTokComingSoon />);
    const button = screen.getByRole("button", { name: "Conectar TikTok" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(screen.getByRole("status")).toHaveTextContent("Conexão TikTok indisponível.");
    expect(screen.queryByText(/conectad[ao] com sucesso/i)).not.toBeInTheDocument();
  });

  it("seleciona vídeo, capa e legenda apenas em memória; somente TikTok nunca envia", async () => {
    const input = props(); render(<Composer {...input} />);
    await screen.findByRole("checkbox", { name: "Facebook — Página real" });
    const lists = [vi.mocked(input.mediaAssetsRepository.list).mock.calls.length, vi.mocked(input.socialAccountsRepository.list).mock.calls.length];
    selectTikTok();
    chooseVideo();
    fireEvent.change(screen.getByLabelText("Capa TikTok"), { target: { files: [new File(["cover"], "cover.webp", { type: "image/webp" })] } });
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda TikTok" }), { target: { value: "Legenda privada TT" } });
    expect(screen.getByText("18 caracteres")).toBeInTheDocument();
    const preview = screen.getByLabelText("Prévia da publicação TikTok");
    expect(preview.querySelector("video")).toHaveAttribute("src", "blob:local-1");
    expect(preview.querySelector("video")).toHaveAttribute("poster", "blob:local-2");
    expect(preview.querySelector("video")).toHaveAttribute("controls");
    expect(preview.querySelector("video")).not.toHaveAttribute("autoplay");
    fireEvent.loadedMetadata(preview.querySelector("video")!);
    expect(within(preview).queryByText(/carregando vídeo/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publicar no TikTok" })).toHaveAttribute("aria-disabled", "true");
    fireEvent.submit(screen.getByRole("dialog"));
    expect(input.onSubmit).not.toHaveBeenCalled();
    expect(input.mediaAssetsRepository.upload).not.toHaveBeenCalled();
    expect(input.socialAccountsRepository.startMetaOAuth).not.toHaveBeenCalled();
    expect(input.socialAccountsRepository.list).toHaveBeenCalledTimes(lists[1]);
    expect(input.mediaAssetsRepository.list).toHaveBeenCalledTimes(lists[0]);
    expect(preview.querySelector("img")).toBeNull();
    expect(preview).not.toHaveTextContent(/curtidas|seguidores|@|1.2k/i);
  });

  it("modo misto envia exclusivamente IDs e legenda Meta, nunca arquivo/capa/texto TT", async () => {
    const input = props(); render(<Composer {...input} />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Facebook — Página real" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda" }), { target: { value: "Meta pública" } });
    selectTikTok(); chooseVideo();
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda TikTok" }), { target: { value: "TT secreta" } });
    fireEvent.submit(screen.getByRole("dialog"));
    expect(input.onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Facebook e Instagram" }));
    fireEvent.submit(screen.getByRole("button", { name: "Publicar agora" }).closest("form")!);
    expect(input.onSubmit).toHaveBeenCalledWith({ title: "Meta pública", caption: "Meta pública", socialAccountIds: ["facebook-id"], mediaAssetIds: [], publicationMode: "now" });
    expect(input.mediaAssetsRepository.upload).not.toHaveBeenCalled();
  });

  it("revoga URLs ao substituir, remover e desmontar; descarta legenda ao trocar Workspace em StrictMode", async () => {
    const input = props(); const view = render(<StrictMode><Composer {...input} /></StrictMode>);
    await screen.findByRole("checkbox", { name: "Facebook — Página real" });
    selectTikTok(); chooseVideo();
    const oldVideo = screen.getByLabelText("Prévia da publicação TikTok").querySelector("video")!;
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda TikTok" }), { target: { value: "segredo" } });
    chooseVideo(new File(["replacement"], "second.webm", { type: "video/webm" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-1");
    fireEvent.error(oldVideo);
    expect(screen.queryByText(/não foi possível reproduzir/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remover vídeo TikTok" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-2");
    chooseVideo();
    view.rerender(<StrictMode><Composer {...input} workspaceId="workspace-b" /></StrictMode>);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-3");
    expect(screen.getByRole("checkbox", { name: "TikTok" })).not.toBeChecked();
    selectTikTok();
    expect(screen.getByRole("textbox", { name: "Legenda TikTok" })).toHaveValue("");
    chooseVideo(); view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-4");
  });

  it.each([
    ["vazio", new File([], "empty.mp4", { type: "video/mp4" }), /vazio/i],
    ["MOV", new File(["x"], "bad.mov", { type: "video/quicktime" }), /MP4 ou WebM/i],
  ] as const)("rejeita vídeo inválido %s antes de criar URL", async (_case, file, message) => {
    render(<Composer {...props()} />); await screen.findByRole("checkbox", { name: "Facebook — Página real" });
    selectTikTok(); chooseVideo(file);
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("oferece retry para falha de URL/reprodução sem enviar arquivo", async () => {
    render(<Composer {...props()} />); await screen.findByRole("checkbox", { name: "Facebook — Página real" });
    selectTikTok(); createObjectURL.mockImplementationOnce(() => { throw new Error("indisponível"); }); chooseVideo();
    expect(screen.getByRole("alert")).toHaveTextContent(/prévia/i);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente vídeo TikTok" }));
    const video = screen.getByLabelText("Prévia da publicação TikTok").querySelector("video")!;
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent(/reproduzir/i);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente vídeo TikTok" }));
    expect(screen.getByLabelText("Prévia da publicação TikTok").querySelector("video")).toBeInTheDocument();
  });

  it.each([
    ["vídeo acima do teto", "video", "video/mp4", 104_857_601, /100 MiB/],
    ["capa acima do teto", "poster", "image/png", 10_485_761, /10 MiB/],
    ["capa vazia", "poster", "image/jpeg", 0, /vazio/],
    ["capa GIF", "poster", "image/gif", 5, /JPEG, PNG ou WebP/],
  ] as const)("rejeita %s sem alocar URL", async (_case, kind, type, size, message) => {
    const input = props(); render(<Composer {...input} />);
    await screen.findByRole("checkbox", { name: "Facebook — Página real" }); selectTikTok();
    const file = new File(["x"], "arquivo-local", { type });
    Object.defineProperty(file, "size", { value: size });
    fireEvent.change(screen.getByLabelText(kind === "video" ? "Vídeo TikTok" : "Capa TikTok"), { target: { files: [file] } });
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(createObjectURL).not.toHaveBeenCalled(); expect(input.mediaAssetsRepository.upload).not.toHaveBeenCalled();
  });

  it.each(["image/jpeg", "image/png", "image/webp"])("aceita capa %s, trata erro/retry e revoga na remoção", async (type) => {
    render(<Composer {...props()} />); await screen.findByRole("checkbox", { name: "Facebook — Página real" }); selectTikTok(); chooseVideo();
    fireEvent.change(screen.getByLabelText("Capa TikTok"), { target: { files: [new File(["cover"], "cover", { type })] } });
    fireEvent.error(screen.getByRole("img", { name: "Capa TikTok" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/exibir a capa/i);
    expect(screen.getByLabelText("Prévia da publicação TikTok").querySelector("video")).not.toHaveAttribute("poster");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente capa TikTok" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-2");
    fireEvent.load(screen.getByRole("img", { name: "Capa TikTok" }));
    expect(screen.queryByText("Carregando capa...")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remover capa TikTok" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-3");
    expect(screen.getByLabelText("Prévia da publicação TikTok").querySelector("video")).not.toHaveAttribute("poster");
  });

  it("ignora eventos de capa/vídeo antigos após substituir e revoga todos os recursos ao desmarcar", async () => {
    render(<StrictMode><Composer {...props()} /></StrictMode>);
    await screen.findByRole("checkbox", { name: "Facebook — Página real" }); selectTikTok(); chooseVideo();
    const oldVideo = screen.getByLabelText("Prévia da publicação TikTok").querySelector("video")!;
    const coverInput = screen.getByLabelText("Capa TikTok");
    const cover = new File(["cover"], "cover.png", { type: "image/png" });
    Object.defineProperty(cover, "size", { value: 10_485_760 });
    fireEvent.change(coverInput, { target: { files: [cover] } });
    const oldCover = screen.getByRole("img", { name: "Capa TikTok" });
    chooseVideo(); fireEvent.change(coverInput, { target: { files: [cover] } });
    fireEvent.error(oldCover); fireEvent.error(oldVideo); fireEvent.loadedMetadata(oldVideo);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Prévia da publicação TikTok").querySelector("video")).toHaveAttribute("src", "blob:local-3");
    expect(screen.getByLabelText("Prévia da publicação TikTok").querySelector("video")).toHaveAttribute("poster", "blob:local-4");
    selectTikTok();
    expect(revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual(["blob:local-1", "blob:local-2", "blob:local-3", "blob:local-4"]);
  });

  it("aceita o teto local exato, descarta no desmarcar e não persiste nem usa o upload Meta no modo TT", async () => {
    const input = props(); const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<Composer {...input} />); await screen.findByRole("checkbox", { name: "Facebook — Página real" }); selectTikTok();
    expect(screen.getByLabelText("Enviar foto ou vídeo").closest('[role="tabpanel"]')).toHaveAttribute("hidden");
    expect(screen.queryByRole("textbox", { name: "Legenda" })).not.toBeInTheDocument();
    const file = new File(["x"], "teto.webm", { type: "video/webm" }); Object.defineProperty(file, "size", { value: 104_857_600 }); chooseVideo(file);
    fireEvent.change(screen.getByRole("textbox", { name: "Legenda TikTok" }), { target: { value: "local".repeat(200) } });
    expect(screen.getByText("1000 caracteres")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Legenda TikTok" })).not.toHaveAttribute("maxlength");
    expect(input.onDraftChange).toHaveBeenCalledTimes(3);
    selectTikTok(); expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-1");
    selectTikTok(); expect(screen.getByRole("textbox", { name: "Legenda TikTok" })).toHaveValue("");
    expect(setItem).not.toHaveBeenCalled(); setItem.mockRestore();
    expect(input.onSubmit).not.toHaveBeenCalled(); expect(input.mediaAssetsRepository.upload).not.toHaveBeenCalled();
  });

  it("agenda TikTok é vazia real e filtros Meta sem associação não dizem zero", () => {
    render(<Agenda loadState="success" onCompose={vi.fn()} posts={[]} />);
    fireEvent.change(screen.getByLabelText("Plataforma da agenda"), { target: { value: "tiktok" } });
    expect(screen.getByText("Nenhuma publicação agendada.")).toBeInTheDocument();
    expect(document.querySelectorAll(".calendar-day")).toHaveLength(7);
    fireEvent.change(screen.getByLabelText("Plataforma da agenda"), { target: { value: "facebook" } });
    expect(screen.getByText(/identificação.*indisponível/i)).toBeInTheDocument();
  });

  it("analytics muda plataforma/período localmente mantendo valores ausentes e gráfico vazio", () => {
    render(<Analytics />);
    fireEvent.change(screen.getByLabelText("Plataforma de análise"), { target: { value: "tiktok" } });
    fireEvent.change(screen.getByLabelText("Período de análise"), { target: { value: "90" } });
    expect(screen.getByRole("heading", { name: "TikTok" })).toBeInTheDocument();
    expect(screen.getByLabelText("Período de análise")).toHaveValue("90");
    expect(screen.getByText("Não conectado")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(document.querySelector(".mini-spark")).toBeNull();
    expect(screen.getByLabelText("Gráfico sem dados")).toBeInTheDocument();
  });
});
