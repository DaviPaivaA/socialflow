import { describe, expect, it } from "vitest";
import type { Post } from "../types/social";
import {
  formatScheduledDate,
  formatScheduledTime,
  isValidScheduledFor,
  localScheduleToIso,
  selectNextScheduledPost,
} from "./scheduling";

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function postAt(
  id: number,
  scheduledFor: string | null,
  status: Post["status"] = "scheduled",
): Post {
  return {
    authorUserId: "22222222-2222-4222-8222-222222222222",
    caption: `Conteúdo ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: uuid(id),
    mediaAssetIds: [],
    publishedAt: null,
    ragRunId: null,
    scheduledFor,
    status,
    tenantId: "11111111-1111-4111-8111-111111111111",
    title: `Publicação ${id}`,
    updatedAt: "2026-01-01T00:00:00.000Z",
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
    expect(isValidScheduledFor("2028-02-29T10:00:00.000Z")).toBe(true);
    expect(isValidScheduledFor("2026-08-13T10:00:00-03:00")).toBe(true);

    expect(isValidScheduledFor("2026-02-30T10:00:00.000Z")).toBe(false);
    expect(isValidScheduledFor("08-13T10:00:00.000Z")).toBe(false);
    expect(isValidScheduledFor("2026-08-13T10:00:00")).toBe(false);
    expect(isValidScheduledFor("2026-08-13")).toBe(false);
  });

  it("formata o mesmo instante no calendário e horário locais", () => {
    const scheduledFor = new Date(2026, 7, 13, 10, 5).toISOString();

    expect(formatScheduledDate(scheduledFor)).toBe("13 ago");
    expect(formatScheduledTime(scheduledFor)).toBe("10:05");
  });

  it("seleciona o futuro mais próximo sem depender da ordem ou de outros status", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");
    const posts = [
      postAt(4, "2026-08-13T15:00:00.000Z"),
      postAt(1, "2026-08-13T11:59:59.000Z"),
      postAt(2, "2026-08-13T12:30:00.000Z"),
      postAt(3, "2026-08-13T12:10:00.000Z", "draft"),
      postAt(5, "2026-08-13T12:20:00.000Z"),
    ];
    const originalOrder = posts.map((post) => post.id);

    expect(selectNextScheduledPost(posts, now)?.id).toBe(uuid(5));
    expect(posts.map((post) => post.id)).toEqual(originalOrder);
  });

  it("compara horários do mesmo dia e instantes com offsets diferentes", () => {
    const now = Date.parse("2026-12-31T22:00:00.000Z");
    const laterByInstant = postAt(1, "2026-12-31T23:00:00.000Z");
    const earlierAcrossYear = postAt(2, "2027-01-01T00:45:00+02:00");

    expect(
      selectNextScheduledPost([laterByInstant, earlierAcrossYear], now)?.id,
    ).toBe(uuid(2));
  });

  it("desempata o mesmo instante pelo menor UUID", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");
    const sameInstant = "2026-08-13T13:00:00.000Z";

    expect(
      selectNextScheduledPost(
        [postAt(9, sameInstant), postAt(3, sameInstant)],
        now,
      )?.id,
    ).toBe(uuid(3));
  });

  it("retorna vazio sem candidato agendado para o futuro", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");

    expect(
      selectNextScheduledPost(
        [
          postAt(1, "2026-08-13T12:00:00.000Z"),
          postAt(2, "2026-08-13T11:00:00.000Z"),
          postAt(3, "2026-08-13T13:00:00.000Z", "published"),
          postAt(4, "sem-data"),
          postAt(5, null),
        ],
        now,
      ),
    ).toBeUndefined();
  });
});
