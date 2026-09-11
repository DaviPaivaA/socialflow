import { describe, expect, it } from "vitest";
import type { Post } from "../types/social";
import {
  formatScheduledDate,
  formatScheduledTime,
  isValidScheduledAt,
  localScheduleToIso,
  selectNextScheduledPost,
} from "./scheduling";

function postAt(
  id: number,
  scheduledAt: string,
  status: Post["status"] = "Agendado",
): Post {
  return {
    id,
    title: `Publicação ${id}`,
    caption: `Conteúdo ${id}`,
    scheduledAt,
    channels: ["IG"],
    status,
    color: "purple",
  };
}

describe("agendamento", () => {
  it("converte data e horário locais para instantes UTC distintos por ano", () => {
    const scheduledIn2026 = localScheduleToIso("2026-08-13", "10:00");
    const scheduledIn2027 = localScheduleToIso("2027-08-13", "10:00");

    expect(scheduledIn2026).toBe(
      new Date(2026, 7, 13, 10, 0).toISOString(),
    );
    expect(scheduledIn2027).toBe(
      new Date(2027, 7, 13, 10, 0).toISOString(),
    );
    expect(scheduledIn2026).toBe("2026-08-13T13:00:00.000Z");
    expect(scheduledIn2027).toBe("2027-08-13T13:00:00.000Z");
    expect(scheduledIn2026).not.toBe(scheduledIn2027);
  });

  it.each([
    ["13 ago", "10:00"],
    ["08-13", "10:00"],
    ["2026-02-30", "10:00"],
    ["2026-13-01", "10:00"],
    ["2026-08-13", "24:00"],
  ])("rejeita data ou horário local inválido: %s %s", (date, time) => {
    expect(localScheduleToIso(date, time)).toBeNull();
  });

  it("valida timestamps completos sem normalizar datas impossíveis", () => {
    expect(isValidScheduledAt("2028-02-29T10:00:00.000Z")).toBe(true);
    expect(isValidScheduledAt("2026-08-13T10:00:00-03:00")).toBe(true);

    expect(isValidScheduledAt("2026-02-30T10:00:00.000Z")).toBe(false);
    expect(isValidScheduledAt("08-13T10:00:00.000Z")).toBe(false);
    expect(isValidScheduledAt("2026-08-13T10:00:00")).toBe(false);
    expect(isValidScheduledAt("2026-08-13")).toBe(false);
  });

  it("formata o mesmo instante no calendário e horário locais", () => {
    const scheduledAt = new Date(2026, 7, 13, 10, 5).toISOString();

    expect(formatScheduledDate(scheduledAt)).toBe("13 ago");
    expect(formatScheduledTime(scheduledAt)).toBe("10:05");
  });

  it("seleciona o futuro mais próximo sem depender da ordem ou de outros status", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");
    const posts = [
      postAt(4, "2026-08-13T15:00:00.000Z"),
      postAt(1, "2026-08-13T11:59:59.000Z"),
      postAt(2, "2026-08-13T12:30:00.000Z"),
      postAt(3, "2026-08-13T12:10:00.000Z", "Rascunho"),
      postAt(5, "2026-08-13T12:20:00.000Z"),
    ];
    const originalOrder = posts.map((post) => post.id);

    expect(selectNextScheduledPost(posts, now)?.id).toBe(5);
    expect(posts.map((post) => post.id)).toEqual(originalOrder);
  });

  it("compara horários do mesmo dia e instantes com offsets diferentes", () => {
    const now = Date.parse("2026-12-31T22:00:00.000Z");
    const laterByInstant = postAt(1, "2026-12-31T23:00:00.000Z");
    const earlierAcrossYear = postAt(2, "2027-01-01T00:45:00+02:00");

    expect(
      selectNextScheduledPost([laterByInstant, earlierAcrossYear], now)?.id,
    ).toBe(2);
  });

  it("desempata o mesmo instante pelo menor identificador", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");
    const sameInstant = "2026-08-13T13:00:00.000Z";

    expect(
      selectNextScheduledPost(
        [postAt(9, sameInstant), postAt(3, sameInstant)],
        now,
      )?.id,
    ).toBe(3);
  });

  it("retorna vazio sem candidato agendado para o futuro", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");

    expect(
      selectNextScheduledPost(
        [
          postAt(1, "2026-08-13T12:00:00.000Z"),
          postAt(2, "2026-08-13T11:00:00.000Z"),
          postAt(3, "2026-08-13T13:00:00.000Z", "Publicado"),
          postAt(4, "sem-data"),
        ],
        now,
      ),
    ).toBeUndefined();
  });
});
