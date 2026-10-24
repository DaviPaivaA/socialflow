import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Agenda } from "../../pages/Agenda";
import { HttpError } from "../../data/api/apiClient";
import type { PostDetail } from "../../data/posts/PostsRepository";
import type { Post } from "../../types/social";
import type { SocialAccount } from "../../../shared/socialAccountContract";

const today = new Date();
const post: Post = { id: "post-1", tenantId: "workspace-a", authorUserId: "author", caption: "TikTok Instagram Facebook não classificam", title: "Post com destino real", mediaAssetIds: [], createdAt: today.toISOString(), updatedAt: today.toISOString(), scheduledFor: today.toISOString(), status: "scheduled", publishedAt: null, ragRunId: null };
const accounts: SocialAccount[] = [
  { id: "fb", provider: "facebook", displayName: "FB", providerAccountId: "fb-external", username: null, profileImageUrl: null, scopes: [], status: "connected", createdAt: today.toISOString(), updatedAt: today.toISOString(), disconnectedAt: null, tokenExpiresAt: null },
  { id: "ig", provider: "instagram", displayName: "IG", providerAccountId: "ig-external", username: null, profileImageUrl: null, scopes: [], status: "connected", createdAt: today.toISOString(), updatedAt: today.toISOString(), disconnectedAt: null, tokenExpiresAt: null },
];
function detail(target: Post, accountId: string): PostDetail {
  return { post: target, permissions: { canEditSchedule: true, canCancelSchedule: true }, publications: [{ id: `pub-${target.id}`, postId: target.id, tenantId: target.tenantId, socialAccountId: accountId, status: "scheduled", createdAt: today.toISOString(), updatedAt: today.toISOString(), errorCode: null, errorMessage: null, failedAt: null, startedAt: null, publishedAt: null, providerPostId: null }] };
}
function setup(posts = [post]) {
  return { loadState: "success" as const, onCompose: vi.fn(), posts, workspaceId: "workspace-a", onUnauthorized: vi.fn(),
    repository: { get: vi.fn().mockImplementation(async (id: string) => detail(posts.find((candidate) => candidate.id === id)!, id === "post-1" ? "fb" : "ig")) },
    socialAccountsRepository: { list: vi.fn().mockResolvedValue(accounts) } };
}
function select(value: string) { fireEvent.change(screen.getByLabelText("Plataforma da agenda"), { target: { value } }); }

describe("Agenda: associações Meta verificadas apenas sob filtro explícito", () => {
  it("Todos e TikTok não fazem leituras extras; Facebook/Instagram usam destinos reais sequencialmente", async () => {
    const second = { ...post, id: "post-2", title: "Instagram real" };
    const input = setup([post, second]); render(<Agenda {...input} />);
    expect(input.repository.get).not.toHaveBeenCalled(); expect(input.socialAccountsRepository.list).not.toHaveBeenCalled();
    select("tiktok"); expect(screen.queryByText("Post com destino real")).not.toBeInTheDocument();
    expect(input.repository.get).not.toHaveBeenCalled(); expect(input.socialAccountsRepository.list).not.toHaveBeenCalled();
    select("facebook");
    await waitFor(() => expect(input.repository.get).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Post com destino real")).toBeInTheDocument(); expect(screen.queryByText("Instagram real")).not.toBeInTheDocument();
    expect(input.socialAccountsRepository.list).toHaveBeenCalledWith("workspace-a");
    select("instagram");
    await screen.findByText("Instagram real"); expect(screen.queryByText("Post com destino real")).not.toBeInTheDocument();
    select("all"); expect(screen.getByText("Post com destino real")).toBeInTheDocument();
    expect(input.repository.get).toHaveBeenCalledTimes(4);
  });

  it("não classifica legado, associação desconhecida ou outro tenant por texto/MIME", async () => {
    const input = setup(); input.repository.get.mockResolvedValue({ ...detail(post, "fb"), publications: [] });
    const view = render(<Agenda {...input} />); select("instagram");
    expect(await screen.findByText(/identificação parcial/i)).toBeInTheDocument();
    expect(screen.queryByText("Post com destino real")).not.toBeInTheDocument();
    view.unmount(); input.repository.get.mockResolvedValue(detail({ ...post, tenantId: "workspace-foreign" }, "fb"));
    render(<Agenda {...input} />); select("facebook");
    expect(await screen.findByText(/identificação parcial/i)).toBeInTheDocument();
    expect(screen.queryByText("Post com destino real")).not.toBeInTheDocument();
  });

  it("ignora 401 tardio após trocar Workspace e interrompe lookup ao escolher TikTok", async () => {
    let reject!: (error: unknown) => void;
    const input = setup(); input.repository.get.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const view = render(<Agenda {...input} />); select("facebook");
    await waitFor(() => expect(input.repository.get).toHaveBeenCalledTimes(1));
    view.rerender(<Agenda {...input} workspaceId="workspace-b" posts={[]} />);
    await act(async () => reject(new HttpError(new Response(null, { status: 401 }), "/posts", null)));
    expect(input.onUnauthorized).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Plataforma da agenda")).toHaveValue("all");
    select("tiktok"); expect(screen.getByText(/agendamento TikTok.*bloqueado/i)).toBeInTheDocument();
  });

  it("limita o custo do lookup e informa indisponibilidade sem assumir zero", async () => {
    const input = setup(Array.from({ length: 51 }, (_, index) => ({ ...post, id: `post-${index}` })));
    render(<Agenda {...input} />); select("facebook");
    expect(await screen.findByText(/identificação.*indisponível/i)).toBeInTheDocument();
    expect(input.repository.get).not.toHaveBeenCalled();
  });

  it("não inicia o próximo GET enquanto o anterior está pendente e ignora resposta após selecionar TikTok", async () => {
    const second = { ...post, id: "post-2" }; const input = setup([post, second]);
    let resolve!: (value: PostDetail) => void;
    input.repository.get.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    render(<Agenda {...input} />); select("facebook");
    await waitFor(() => expect(input.repository.get).toHaveBeenCalledTimes(1));
    expect(input.repository.get).toHaveBeenCalledWith("post-1");
    select("tiktok"); await act(async () => resolve(detail(post, "fb")));
    expect(input.repository.get).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Post com destino real")).not.toBeInTheDocument();
  });

  it("cancelled não aparece no filtro e 401 atual é informado sem inventar registros", async () => {
    const input = setup(); const cancelled = detail(post, "fb"); cancelled.publications[0].status = "cancelled";
    input.repository.get.mockResolvedValue(cancelled);
    const view = render(<Agenda {...input} />); select("facebook");
    await waitFor(() => expect(screen.queryByText("Verificando destinos das publicações...")).not.toBeInTheDocument());
    expect(screen.queryByText("Post com destino real")).not.toBeInTheDocument(); view.unmount();
    input.repository.get.mockRejectedValue(new HttpError(new Response(null, { status: 401 }), "/posts", null));
    render(<Agenda {...input} />); select("facebook");
    expect(await screen.findByRole("alert")).toHaveTextContent(/indisponível/i);
    expect(input.onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
