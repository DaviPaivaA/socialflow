import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelBadge } from "./ChannelBadge";

describe("ChannelBadge", () => {
  it.each([
    ["FB", "Facebook", false], ["IG", "Instagram", false], ["TT", "TikTok", false],
    ["FB", "Facebook", true], ["IG", "Instagram", true], ["TT", "TikTok", true],
  ] as const)("identifica %s como %s com símbolo gráfico acessível (small=%s)", (code, name, small) => {
    render(<ChannelBadge code={code} small={small} />);
    const badge = screen.getByRole("img", { name });
    const graphic = badge.querySelector("svg");
    expect(graphic).not.toBeNull();
    expect(graphic).toHaveAttribute("aria-hidden", "true");
    expect(graphic).toHaveAttribute("focusable", "false");
    expect(badge).toHaveAttribute("title", name);
    expect(badge).not.toHaveTextContent(code);
    expect(badge.classList.contains("small")).toBe(small);
  });

  it("preserva a identificação textual do LinkedIn fora do conjunto de ícones redesenhados", () => {
    render(<ChannelBadge code="LI" />);
    expect(screen.getByLabelText("LinkedIn")).toHaveTextContent("LI");
  });
});
