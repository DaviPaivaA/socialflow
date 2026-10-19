import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initialPosts } from "../../data/mockData";
import type { PostStatus } from "../../types/social";
import { PostActionsMenu } from "./PostActionsMenu";

function setup(status: PostStatus = "scheduled", canManageAuthor = true) {
  const callbacks = { onDetails: vi.fn(), onEdit: vi.fn(), onCancel: vi.fn() };
  render(<><PostActionsMenu post={{ ...initialPosts[0], status }} canManageAuthor={canManageAuthor} {...callbacks} /><button>Depois</button></>);
  return callbacks;
}

describe("PostActionsMenu", () => {
  it("scheduled owner offers three actions and invokes only the selected callback", async () => {
    const user = userEvent.setup();
    const callbacks = setup();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Opções de/ }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
    await user.click(screen.getByRole("menuitem", { name: "Editar agendamento" }));
    expect(callbacks.onEdit).toHaveBeenCalledTimes(1);
    expect(callbacks.onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("member non-author sees details only", async () => {
    const user = userEvent.setup();
    const callbacks = setup("scheduled", false);
    await user.click(screen.getByRole("button", { name: /^Opções de/ }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    expect(screen.getByRole("note")).toHaveTextContent(/Somente o autor, proprietários ou administradores/);
    await user.click(screen.getByRole("menuitem", { name: "Ver detalhes" }));
    expect(callbacks.onDetails).toHaveBeenCalledTimes(1);
    expect(callbacks.onEdit).not.toHaveBeenCalled();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it.each<PostStatus>(["publishing", "published", "failed", "partially_failed", "cancelled", "draft"])("%s never offers edit cancel retry", async (status) => {
    const user = userEvent.setup();
    setup(status);
    await user.click(screen.getByRole("button", { name: /^Opções de/ }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Ver detalhes"]);
  });

  it("opens by keyboard, supports arrows/Home/End and restores trigger focus on Escape", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole("button", { name: /^Opções de/ });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Ver detalhes" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Editar agendamento" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Cancelar agendamento" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Ver detalhes" })).toHaveFocus();
    await user.keyboard("{Home}{ArrowUp}");
    expect(screen.getByRole("menuitem", { name: "Cancelar agendamento" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("Tab leaves the menu and clicking outside closes without an action", async () => {
    const user = userEvent.setup();
    const callbacks = setup();
    const trigger = screen.getByRole("button", { name: /^Opções de/ });
    await user.click(trigger);
    await user.tab();
    expect(screen.getByRole("button", { name: "Depois" })).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });
});
