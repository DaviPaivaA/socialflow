import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Agenda } from "./Agenda";

it("identifica filtros Meta com ícones equivalentes e mantém a agenda TikTok vazia", () => {
  render(<Agenda loadState="success" onCompose={vi.fn()} posts={[]} />);
  const select = screen.getByLabelText("Plataforma da agenda");
  for (const [value, name] of [["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"]]) {
    fireEvent.change(select, { target: { value } });
    expect(screen.getByRole("img", { name }).querySelector("svg")).not.toBeNull();
  }
  expect(screen.getByText("Nenhuma publicação agendada.")).toBeInTheDocument();
  expect(document.querySelectorAll(".calendar-day")).toHaveLength(7);
  expect(document.querySelectorAll(".calendar-item")).toHaveLength(0);
});

it("preserva erro e loading da agenda sem mostrar calendário vazio como resultado", () => {
  const view = render(<Agenda loadState="loading" onCompose={vi.fn()} posts={[]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Carregando publicações");
  expect(document.querySelectorAll(".calendar-day")).toHaveLength(0);
  view.rerender(<Agenda loadState="error" onCompose={vi.fn()} posts={[]} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar a agenda");
  expect(document.querySelectorAll(".calendar-day")).toHaveLength(0);
});
