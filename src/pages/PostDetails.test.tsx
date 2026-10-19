import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { PostDetail, PostsRepository } from "../data/posts/PostsRepository";
import { initialPosts } from "../data/mockData";
import { HttpError } from "../data/api/apiClient";
import { MockSocialAccountsRepository, initialSocialAccounts } from "../data/socialAccounts/MockSocialAccountsRepository";
import type { PostPublication } from "../../shared/postPublicationContract";
import { PostDetails } from "./PostDetails";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const post = { ...initialPosts[0], title: "Detalhe real" };
const detail: PostDetail = { post, publications: [], permissions: { canEditSchedule: true, canCancelSchedule: true } };
const accounts = () => new MockSocialAccountsRepository();
function repository(get: PostsRepository["get"]): PostsRepository {
  return { get, list: vi.fn().mockResolvedValue([]), create: vi.fn(), updateScheduled: vi.fn(), cancelScheduled: vi.fn() };
}
function publication(status: PostPublication["status"], index: number): PostPublication {
  return { id: `00000000-0000-4000-8000-00000000000${index}`, postId: post.id, tenantId: post.tenantId,
    socialAccountId: index === 1 ? initialSocialAccounts[0].id : `00000000-0000-4000-8000-00000000010${index}`,
    status, providerPostId: status === "published" ? "opaque-provider-id" : null,
    errorCode: status === "failed" ? "meta_provider_error" : null, errorMessage: status === "failed" ? "access_token=DO_NOT_ECHO <script>secret</script>" : null,
    createdAt: post.createdAt, updatedAt: post.updatedAt, startedAt: null, publishedAt: null, failedAt: null };
}
function route(element: React.ReactNode) {
  return <MemoryRouter initialEntries={[`/publicacoes/${post.id}`]}><Routes><Route path="/publicacoes/:postId" element={element} /></Routes></MemoryRouter>;
}

describe("PostDetails", () => {
  it("loads by route ID, retries GET failures and renders an honest legacy destination absence", async () => {
    const user = userEvent.setup();
    const request = deferred<PostDetail>();
    const get = vi.fn<PostsRepository["get"]>().mockReturnValueOnce(request.promise).mockResolvedValueOnce(detail);
    render(route(<PostDetails repository={repository(get)} socialAccountsRepository={accounts()} workspaceId={post.tenantId} onEdit={vi.fn()} onCancel={vi.fn()} />));
    expect(screen.getByRole("status")).toHaveTextContent(/Carregando/);
    await act(async () => { request.reject(new Error("DO_NOT_ECHO")); });
    expect(await screen.findByRole("alert")).not.toHaveTextContent("DO_NOT_ECHO");
    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(await screen.findByRole("heading", { name: "Detalhe real" })).toBeInTheDocument();
    expect(screen.getByText("Nenhum destino associado")).toBeInTheDocument();
    expect(get).toHaveBeenNthCalledWith(1, post.id);
    expect(get).toHaveBeenNthCalledWith(2, post.id);
  });

  it("renders each destination outcome, real account names and safe failures without guessed links", async () => {
    const outcomes: PostPublication["status"][] = ["published", "scheduled", "publishing", "failed", "cancelled"];
    const value = { ...detail, publications: outcomes.map((status, i) => publication(status, i + 1)) };
    render(route(<PostDetails repository={repository(vi.fn().mockResolvedValue(value))} socialAccountsRepository={accounts()} workspaceId={post.tenantId} onEdit={vi.fn()} onCancel={vi.fn()} />));
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent(initialSocialAccounts[0].displayName);
    expect(rows[0]).toHaveTextContent("Publicado");
    expect(rows[1]).toHaveTextContent(/Agendado.*pendente/);
    expect(rows[2]).toHaveTextContent(/Publicando.*pendente/);
    expect(rows[3]).toHaveTextContent(/Falha/);
    expect(rows[3]).not.toHaveTextContent("DO_NOT_ECHO");
    expect(rows[4]).toHaveTextContent(/Cancelado/);
    expect(rows[1]).toHaveTextContent(value.publications[1].socialAccountId);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("opaque-provider-id");
  });

  it("uses authoritative permissions for actions and never mutates on mount", async () => {
    const user = userEvent.setup();
    const source = repository(vi.fn().mockResolvedValue({ ...detail, permissions: { canEditSchedule: false, canCancelSchedule: true } }));
    const onCancel = vi.fn();
    render(route(<PostDetails repository={source} socialAccountsRepository={accounts()} workspaceId={post.tenantId} onEdit={vi.fn()} onCancel={onCancel} />));
    await screen.findByRole("heading", { name: "Detalhe real" });
    expect(screen.queryByRole("button", { name: "Editar agendamento" })).not.toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    expect(source.cancelScheduled).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancelar agendamento" }));
    expect(onCancel).toHaveBeenCalledWith(post);
  });

  it("manually refreshes a pending destination into its confirmed result using GET only", async () => {
    const user = userEvent.setup();
    const refreshed = deferred<PostDetail>();
    const pendingDetail: PostDetail = {
      ...detail, post: { ...post, status: "publishing" },
      publications: [publication("publishing", 1)],
      permissions: { canEditSchedule: false, canCancelSchedule: false },
    };
    const get = vi.fn<PostsRepository["get"]>().mockResolvedValueOnce(pendingDetail).mockReturnValueOnce(refreshed.promise);
    const source = repository(get);
    render(route(<PostDetails repository={source} socialAccountsRepository={accounts()} workspaceId={post.tenantId} onEdit={vi.fn()} onCancel={vi.fn()} />));
    expect(await screen.findByRole("listitem")).toHaveTextContent("Publicando — resultado pendente");
    await user.click(screen.getByRole("button", { name: "Atualizar resultados" }));
    expect(screen.getByRole("status")).toHaveTextContent("Carregando detalhes");
    expect(screen.queryByText("Publicado")).not.toBeInTheDocument();
    await act(async () => {
      refreshed.resolve({ ...pendingDetail, post: { ...post, status: "published", publishedAt: post.updatedAt },
        publications: [{ ...publication("published", 1), publishedAt: post.updatedAt }] });
      await refreshed.promise;
    });
    expect(await screen.findByRole("listitem")).toHaveTextContent("Publicado");
    expect(screen.queryByText(/resultado pendente/)).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(2, post.id);
    expect(source.create).not.toHaveBeenCalled();
    expect(source.updateScheduled).not.toHaveBeenCalled();
    expect(source.cancelScheduled).not.toHaveBeenCalled();
  });

  it.each([
    { code: "meta_token_invalid", reason: "A autorização da Página precisa ser renovada." },
    { code: "media_unavailable", reason: "A mídia não está disponível para publicação." },
    { code: "meta_rate_limited", reason: "O limite de publicações da Meta foi atingido." },
    { code: "publication_state_unknown", reason: "Não foi possível confirmar o resultado da publicação." },
    { code: "unrecognized-provider-detail", reason: "O motivo da falha não está disponível." },
  ])("explains the individual safe failure for $code without exposing raw provider messages", async ({ code, reason }) => {
    const failed = { ...publication("failed", 1), errorCode: code };
    render(route(<PostDetails repository={repository(vi.fn().mockResolvedValue({ ...detail, publications: [failed] }))} socialAccountsRepository={accounts()} workspaceId={post.tenantId} onEdit={vi.fn()} onCancel={vi.fn()} />));
    const destination = await screen.findByRole("listitem");
    expect(destination).toHaveTextContent(reason);
    expect(destination).not.toHaveTextContent(/DO_NOT_ECHO|access_token|<script>|unrecognized-provider-detail/);
    expect(screen.queryByRole("button", { name: /tentar novamente|republicar/i })).not.toBeInTheDocument();
  });

  it("keeps cancelled historical posts accessible by ID without management actions", async () => {
    const value = { ...detail, post: { ...post, status: "cancelled" as const }, permissions: { canEditSchedule: false, canCancelSchedule: false } };
    render(route(<PostDetails repository={repository(vi.fn().mockResolvedValue(value))} socialAccountsRepository={accounts()} workspaceId={post.tenantId} onEdit={vi.fn()} onCancel={vi.fn()} />));
    await screen.findByRole("heading", { name: "Detalhe real" });
    expect(screen.getByText("Cancelado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /agendamento/ })).not.toBeInTheDocument();
  });

  it("does not invent account names when the accounts repository fails", async () => {
    const source = accounts();
    vi.spyOn(source, "list").mockRejectedValue(new Error("sensitive"));
    render(route(<PostDetails repository={repository(vi.fn().mockResolvedValue({ ...detail, publications: [publication("scheduled", 1)] }))} socialAccountsRepository={source} workspaceId={post.tenantId} onEdit={vi.fn()} onCancel={vi.fn()} />));
    const row = await screen.findByRole("listitem");
    expect(row).toHaveTextContent(initialSocialAccounts[0].id);
    expect(row).not.toHaveTextContent(initialSocialAccounts[0].displayName);
    expect(screen.getByRole("alert")).not.toHaveTextContent("sensitive");
  });

  it("hides previous Workspace data immediately and ignores A resolving after B", async () => {
    const old = deferred<PostDetail>();
    const source = repository(vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...detail, post: { ...post, title: "Post B", tenantId: "workspace-b" } }));
    const props = { repository: source, socialAccountsRepository: accounts(), onEdit: vi.fn(), onCancel: vi.fn() };
    const view = render(route(<PostDetails {...props} workspaceId={post.tenantId} />));
    view.rerender(route(<PostDetails {...props} workspaceId="workspace-b" />));
    expect(await screen.findByRole("heading", { name: "Post B" })).toBeInTheDocument();
    await act(async () => { old.resolve(detail); await old.promise; });
    expect(screen.queryByText("Detalhe real")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Post B" })).toBeInTheDocument();
  });

  it.each([403, 404, 409])("handles GET %s without leaking server error details", async (status) => {
    const error = new HttpError(new Response(null, { status }), "https://api.test", { message: "DO_NOT_ECHO" });
    render(route(<PostDetails repository={repository(vi.fn().mockRejectedValue(error))} socialAccountsRepository={accounts()} workspaceId={post.tenantId} onEdit={vi.fn()} onCancel={vi.fn()} />));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("DO_NOT_ECHO");
    expect(screen.queryByRole("button", { name: "Cancelar agendamento" })).not.toBeInTheDocument();
  });

  it("invalidates auth for current GET401, but not a late previous Workspace401", async () => {
    const old = deferred<PostDetail>();
    const source = repository(vi.fn().mockReturnValueOnce(old.promise).mockRejectedValueOnce(new HttpError(new Response(null, { status: 401 }), "https://api.test", null)));
    const onUnauthorized = vi.fn();
    const props = { repository: source, socialAccountsRepository: accounts(), onEdit: vi.fn(), onCancel: vi.fn(), onUnauthorized };
    const view = render(route(<PostDetails {...props} workspaceId={post.tenantId} />));
    view.rerender(route(<PostDetails {...props} workspaceId="workspace-b" />));
    await screen.findByRole("alert");
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    await act(async () => { old.reject(new HttpError(new Response(null, { status: 401 }), "https://api.test", null)); });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
