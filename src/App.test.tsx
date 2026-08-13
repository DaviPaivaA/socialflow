import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("SocialFlow", () => {
  it("renderiza a aplicação", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: /Olá, Davi!/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Navegação principal" }),
    ).toBeInTheDocument();
  });

  it("navega para Publicações", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Publicações/ }));

    expect(
      screen.getByRole("heading", { level: 1, name: "Publicações" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bastidores da torra")).toBeInTheDocument();
  });

  it("abre o formulário Criar publicação", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Criar publicação" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /^Legenda/ }),
    ).toBeInTheDocument();
  });

  it("cria uma publicação simulada", async () => {
    const user = userEvent.setup();
    const caption =
      "Café especial para a comunidade! Uma nova experiência no SocialFlow.";

    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /Criar publicação/i }),
    );
    await user.type(screen.getByRole("textbox", { name: /^Legenda/ }), caption);
    await user.click(
      screen.getByRole("button", { name: /Agendar publicação/i }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Publicação agendada com sucesso!",
    );

    await user.click(screen.getByRole("button", { name: /Publicações/ }));

    expect(
      screen.getByText("Café especial para a comunidade"),
    ).toBeInTheDocument();
    expect(screen.getByText(caption)).toBeInTheDocument();
  });
});
