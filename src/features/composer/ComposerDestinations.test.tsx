import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ComposerDestinations } from "./ComposerDestinations";
import type { ComposerDestinationsState } from "./useComposerDestinations";

describe("ComposerDestinations — integrações futuras", () => {
  it("mostra CTA TikTok informativa sem permitir selecioná-lo como destino Meta", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const destinations: ComposerDestinationsState = {
      accounts: [], selectedIds: [], unavailableSelectedIds: [], isLoading: false,
      error: null, reconnectionRequired: false, toggle: onToggle,
    };
    render(<ComposerDestinations destinations={destinations} onToggle={onToggle} />);
    const button = screen.getByRole("button", { name: "Conectar TikTok" });
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription(/publicação e métricas indisponíveis/);
    expect(screen.queryByRole("checkbox", { name: /TikTok/ })).not.toBeInTheDocument();
    await user.click(button);
    expect(screen.getByRole("status")).toHaveTextContent(/integração TikTok não está habilitada/i);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText(/Não há contas elegíveis de Facebook ou Instagram/)).toBeInTheDocument();
  });
});
