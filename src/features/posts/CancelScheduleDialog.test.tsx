import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { initialPosts } from "../../data/mockData";
import { CancelScheduleDialog } from "./CancelScheduleDialog";

describe("CancelScheduleDialog", () => {
  it("uses the approved exclusion wording, focuses Cancelar and never confirms from dismissal or Escape", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<CancelScheduleDialog post={initialPosts[0]} isSubmitting={false} error={null} onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Excluir agendamento?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows a safe error and prevents confirmation/dismissal while submitting", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<CancelScheduleDialog post={initialPosts[0]} isSubmitting error="Não foi possível confirmar o cancelamento." onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível confirmar o cancelamento.");
    expect(screen.getByRole("button", { name: /Cancelando/ })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(/não interrompe|aguarde/i);
  });
});
