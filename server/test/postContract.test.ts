import { describe, expect, it } from "vitest";
import { isPost, validateCreatePost } from "../src/postContract.ts";

const validInput = {
  caption: "Conteúdo persistido.",
  scheduledFor: "2027-08-13T13:00:00.000Z",
  status: "scheduled",
  title: "Publicação válida",
} as const;

const validPost = {
  authorUserId: "22222222-2222-4222-8222-222222222222",
  caption: validInput.caption,
  createdAt: "2027-08-10T13:00:00.000Z",
  id: "33333333-3333-4333-8333-333333333333",
  publishedAt: null,
  ragRunId: null,
  scheduledFor: validInput.scheduledFor,
  status: validInput.status,
  tenantId: "11111111-1111-4111-8111-111111111111",
  title: validInput.title,
  updatedAt: "2027-08-10T13:00:00.000Z",
};

describe("contrato oficial de publicação", () => {
  it("aceita o DTO de criação sem tenant, autor, canais ou cor", () => {
    expect(validateCreatePost(validInput)).toEqual({
      success: true,
      data: validInput,
    });
  });

  it.each([
    ["corpo não objeto", null, ["body"]],
    [
      "data impossível",
      { ...validInput, scheduledFor: "2027-02-30T10:00:00-03:00" },
      ["scheduledFor"],
    ],
    [
      "agendamento sem fuso",
      { ...validInput, scheduledFor: "2027-08-13T10:00:00" },
      ["scheduledFor"],
    ],
    [
      "offset fora do domínio ISO persistido",
      { ...validInput, scheduledFor: "2027-08-13T10:00:00+16:00" },
      ["scheduledFor"],
    ],
    [
      "instante normalizado fora do domínio do DTO",
      { ...validInput, scheduledFor: "9999-12-31T23:59:59-03:00" },
      ["scheduledFor"],
    ],
    ["título vazio", { ...validInput, title: "   " }, ["title"]],
    ["legenda vazia", { ...validInput, caption: "" }, ["caption"]],
    ["status não criável", { ...validInput, status: "published" }, ["status"]],
  ])("rejeita %s", (_label, value, fields) => {
    expect(validateCreatePost(value)).toEqual({ success: false, fields });
  });

  it("valida UUIDs e o contrato completo retornado pela API", () => {
    expect(isPost(validPost)).toBe(true);
    expect(isPost({ ...validPost, id: 7 })).toBe(false);
    expect(isPost({ ...validPost, tenantId: "tenant-a" })).toBe(false);
    expect(isPost({ ...validPost, authorUserId: null })).toBe(false);
  });

  it("aceita os limites representáveis com offset ISO válido", () => {
    expect(
      validateCreatePost({
        ...validInput,
        scheduledFor: "9999-12-31T23:59:59.999Z",
      }),
    ).toEqual({
      data: {
        ...validInput,
        scheduledFor: "9999-12-31T23:59:59.999Z",
      },
      success: true,
    });
    expect(
      validateCreatePost({
        ...validInput,
        scheduledFor: "2027-08-13T10:00:00+14:00",
      }).success,
    ).toBe(true);
  });
});
