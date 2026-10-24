import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { demoAuthSession } from "../data/auth/MockAuthRepository";
import { initialPosts } from "../data/mockData";
import { Topbar } from "./Topbar";
import type { PostsLoadState } from "../pages/Posts";

const posts = [
  { ...initialPosts[0], id: "title-result", title: "CAFÉ especial", caption: "Outro texto" },
  { ...initialPosts[0], id: "caption-result", title: "Segundo", caption: "Conheça nosso café" },
  { ...initialPosts[0], id: "cancelled", title: "Café cancelado", status: "cancelled" as const },
];
function props() {
  return { currentUser: demoAuthSession.user, role: demoAuthSession.tenant.role,
    onToggleMenu: vi.fn(), posts, postsLoadState: "success" as PostsLoadState,
    onOpenPost: vi.fn(), modalActive: false };
}
async function openSearch(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  const dialog = screen.getByRole("dialog", { name: "Pesquisar publicações" });
  const input = within(dialog).getByRole("combobox");
  await user.type(input, "cAfÉ");
  return { dialog, input };
}

describe("Topbar controls", () => {
  it("searches real loaded title/caption without cancelled posts and opens the exact keyboard selection", async () => {
    const user = userEvent.setup();
    const config = props();
    render(<Topbar {...config} />);
    const { input } = await openSearch(user);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.queryByText("Café cancelado")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(config.onOpenPost).toHaveBeenCalledExactlyOnceWith("caption-result");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["loading", "error", "success"] as const)("shows honest %s search state without stale results", async (state) => {
    const user = userEvent.setup();
    render(<Topbar {...props()} postsLoadState={state} posts={state === "success" ? [] : posts} />);
    await openSearch(user);
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    expect(screen.getByText(state === "loading" ? /Carregando publicações/ : state === "error"
      ? /Não foi possível carregar as publicações/ : /Nenhuma publicação encontrada/)).toBeInTheDocument();
  });

  it("bounds results to twenty, reports overflow and opens a clicked result", async () => {
    const user = userEvent.setup();
    const config = props();
    render(<Topbar {...config} posts={Array.from({ length: 23 }, (_, i) => ({ ...posts[0], id: `result-${i}`, title: `Café ${i}` }))} />);
    await openSearch(user);
    expect(screen.getAllByRole("option")).toHaveLength(20);
    expect(screen.getByText(/20 de 23/)).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: /Café 19/ }));
    expect(config.onOpenPost).toHaveBeenCalledExactlyOnceWith("result-19");
  });

  it("reveals the active keyboard result with nearest scrolling while keeping input focus before Enter navigation", async () => {
    const user = userEvent.setup();
    const config = props();
    render(<Topbar {...config} posts={Array.from({ length: 20 }, (_, index) => ({ ...posts[0], id: `scroll-${index}`, title: `Café ${index}` }))} />);
    const { input } = await openSearch(user);
    const options = screen.getAllByRole("option");
    const first = options[0];
    const last = options[19];
    // jsdom has no layout/scrollIntoView; observe the component's browser API
    // requests on the actual rendered options, not simulated scroll geometry.
    const revealFirst = vi.fn();
    const revealLast = vi.fn();
    Object.defineProperty(first, "scrollIntoView", { configurable: true, value: revealFirst });
    Object.defineProperty(last, "scrollIntoView", { configurable: true, value: revealLast });

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(last).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", last.id);
    expect(input).toHaveFocus();
    expect(revealLast).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });
    expect(revealFirst).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", first.id);
    expect(input).toHaveFocus();
    expect(revealFirst).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", last.id);
    expect(input).toHaveFocus();
    expect(revealLast).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(config.onOpenPost).toHaveBeenCalledExactlyOnceWith("scroll-19");
  });

  it("opens via Cmd K, closes via Escape/outside and restores focus without retaining query", async () => {
    const user = userEvent.setup();
    render(<Topbar {...props()} />);
    const trigger = screen.getByRole("button", { name: "Pesquisar publicações" });
    trigger.focus();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.type(screen.getByRole("combobox"), "café");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole("combobox")).toHaveValue("");
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["owner", "admin", "member"] as const)("explains actual role-aware actions for %s", async (role) => {
    const user = userEvent.setup();
    render(<Topbar {...props()} role={role} />);
    const trigger = screen.getByRole("button", { name: "Ajuda" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Ajuda do SocialFlow" });
    expect(within(dialog).getByText(role === "member" ? /somente os seus próprios agendamentos/ : /agendamentos de qualquer membro/)).toBeInTheDocument();
    expect(within(dialog).getByText(/envio já iniciado/)).toBeInTheDocument();
    expect(within(dialog).getByText(/não exclui conteúdo das redes sociais/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
  });

  it("shows an honestly empty notification popover, closes outside/Escape and restores focus", async () => {
    const user = userEvent.setup();
    render(<Topbar {...props()} />);
    const trigger = screen.getByRole("button", { name: "Notificações" });
    expect(trigger).toHaveTextContent("🔔");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveClass("notification");
    expect(trigger.querySelector("i")).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole("region", { name: "Notificações" })).toHaveTextContent("Nenhuma notificação disponível");
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Notificações" })).not.toBeInTheDocument();
  });

  it("does not open a second focus trap or intercept shortcuts while a product modal is active", () => {
    render(<Topbar {...props()} modalActive />);
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Ajuda" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refocuses an already-open search with the shortcut without losing the query", async () => {
    const user = userEvent.setup();
    render(<Topbar {...props()} />);
    const { input } = await openSearch(user);
    await user.tab();
    expect(input).not.toHaveFocus();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("cAfÉ");
  });

  it("uses updated rows immediately and removes cancelled selections without a search cache", async () => {
    const user = userEvent.setup();
    const config = props();
    const view = render(<Topbar {...config} />);
    const { input } = await openSearch(user);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    view.rerender(<Topbar {...config} posts={[{ ...posts[0], status: "cancelled" }, { ...posts[1], title: "Título atualizado" }]} />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Título atualizado");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(config.onOpenPost).toHaveBeenCalledExactlyOnceWith("caption-result");
  });

  it("does not resurrect a local panel when a superseding product modal closes", async () => {
    const user = userEvent.setup();
    const config = props();
    const view = render(<Topbar {...config} />);
    await openSearch(user);
    view.rerender(<Topbar {...config} modalActive />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<Topbar {...config} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
