import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChannelBadge } from "./ChannelBadge";

describe("ChannelBadge", () => {
  it.each([false, true])("identifica TikTok com símbolo gráfico acessível (small=%s)", (small) => {
    render(<ChannelBadge code="TT" small={small} />);
    const badge = screen.getByRole("img", { name: "TikTok" });
    const graphic = badge.querySelector("svg");
    expect(graphic).not.toBeNull();
    expect(graphic).toHaveAttribute("aria-hidden", "true");
    expect(graphic).toHaveAttribute("focusable", "false");
    expect(badge).toHaveAttribute("title", "TikTok");
  });

  it.each([["IG", "Instagram"], ["FB", "Facebook"]] as const)("preserva o badge %s", (code, name) => {
    render(<ChannelBadge code={code} />);
    expect(screen.getByLabelText(name)).toHaveTextContent(code);
  });
});
