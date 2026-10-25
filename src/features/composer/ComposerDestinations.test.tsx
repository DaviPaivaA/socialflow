import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComposerDestinations } from "./ComposerDestinations";
import type { ComposerDestinationsState } from "./useComposerDestinations";

describe("ComposerDestinations — integrações futuras", () => {
  it("reserva a seleção Meta para contas elegíveis sem duplicar a ação TikTok", () => {
    const onToggle = vi.fn();
    const destinations: ComposerDestinationsState = {
      accounts: [], selectedIds: [], unavailableSelectedIds: [], isLoading: false,
      error: null, reconnectionRequired: false, toggle: onToggle,
    };
    render(<ComposerDestinations destinations={destinations} onToggle={onToggle} />);
    expect(screen.queryByRole("button", { name: "Conectar TikTok" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /TikTok/ })).not.toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText(/Não há contas elegíveis de Facebook ou Instagram/)).toBeInTheDocument();
  });
});
