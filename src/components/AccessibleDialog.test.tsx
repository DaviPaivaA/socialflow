import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccessibleDialog } from "./AccessibleDialog";

describe("AccessibleDialog", () => {
  it("labels the modal, focuses the requested control and traps Tab in both directions", async () => {
    const user = userEvent.setup();
    const focus = createRef<HTMLButtonElement>();
    render(<AccessibleDialog title="Confirmação" description="Revise a ação" initialFocusRef={focus} onClose={vi.fn()}>
      <button>Primeiro</button><button ref={focus}>Último</button>
    </AccessibleDialog>);
    expect(screen.getByRole("dialog", { name: "Confirmação", description: "Revise a ação" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Último" })).toHaveFocus();
  });

  it("does not close on mount or content click, closes on Escape and restores the opener", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(<AccessibleDialog title="Confirmação" onClose={onClose}><button>Dentro</button></AccessibleDialog>);
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Dentro" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it("focuses the dialog when empty and closes only on the backdrop itself", () => {
    const onClose = vi.fn();
    render(<AccessibleDialog title="Vide" onClose={onClose}><p>Conteúdo</p></AccessibleDialog>);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
