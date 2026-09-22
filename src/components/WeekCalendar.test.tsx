import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initialPosts } from "../data/mockData";
import { getCurrentWeekLabel } from "../domain/calendarWeek";
import type { Post } from "../types/social";
import { WeekCalendar } from "./WeekCalendar";

describe("WeekCalendar", () => {
  it("monta a semana local atual e usa somente posts reais daquela semana", () => {
    const today = new Date(2026, 7, 12, 12);
    const scheduled: Post = {
      ...initialPosts[0],
      scheduledFor: new Date(2026, 7, 12, 16, 45).toISOString(),
      title: "Conteúdo da quarta-feira",
    };
    const outsideWeek: Post = {
      ...initialPosts[1],
      scheduledFor: new Date(2026, 7, 20, 11).toISOString(),
      title: "Conteúdo de outra semana",
    };

    render(<WeekCalendar posts={[outsideWeek, scheduled]} today={today} />);

    expect(getCurrentWeekLabel(today)).toBe("10 — 16 DE AGOSTO DE 2026");
    const item = screen.getByText("Conteúdo da quarta-feira").closest(".calendar-item");
    expect(item).toHaveTextContent("16:45");
    expect(item).toHaveClass("purple");
    expect(screen.queryByText(outsideWeek.title!)).not.toBeInTheDocument();
    expect(screen.getAllByText("Livre")).toHaveLength(6);
    expect(within(screen.getByText("12").closest(".calendar-day") as HTMLElement).getByText("QUA")).toBeInTheDocument();
  });

  it("identifica semana que cruza meses e anos sem usar agosto fixo", () => {
    expect(getCurrentWeekLabel(new Date(2026, 11, 31, 12))).toBe(
      "28 DE DEZEMBRO DE 2026 — 3 DE JANEIRO DE 2027",
    );
  });
});
